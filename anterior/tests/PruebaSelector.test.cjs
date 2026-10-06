const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'DiagnosticoSheets.gs'), 'utf8');
const source = fs.readFileSync(path.join(root, 'PruebaSelector.gs'), 'utf8');

test('normalization: touched scripts, tests and guides use LF without BOM or trailing whitespace', () => {
  for (const name of ['DiagnosticoSheets.gs', 'PruebaSelector.gs', 'DIAGNOSTICO_SHEETS.md',
    'PRUEBA_SELECTOR.md', 'tests/DiagnosticoSheets.test.cjs', 'tests/PruebaSelector.test.cjs',
    'odd/tasks/webapp-selector-experiment.md']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.ok(!text.startsWith('\uFEFF'), `${name}: unexpected BOM`);
    assert.doesNotMatch(text, /\r|[\t ]+$/m, `${name}: non-normalized whitespace`);
    assert.ok(text.endsWith('\n'), `${name}: missing final newline`);
  }
});

function allow(methods) {
  return new Proxy(methods, {
    get(target, key) {
      assert.ok(Object.hasOwn(target, key), `Forbidden API: ${String(key)}`);
      return target[key];
    },
    set() { throw new Error('Unexpected mutation'); }
  });
}

function fixture(options = {}) {
  let time = 0;
  class ClockDate extends Date { static now() { return time; } }
  const events = [];
  const writes = [];
  const logs = [];
  let selector = options.original ?? 'Argentina';
  let selectorReads = 0;
  let locked = false;
  let released = false;
  let changed = false;
  const values = new Map();
  const formulas = new Map();
  const put = (row, column, value, formula = '') => {
    values.set(`${row},${column}`, value);
    formulas.set(`${row},${column}`, formula);
  };
  for (const row of [1, 8, 9, 10, 11]) put(row, 7, `Private name ${row}`);
  for (let column = 9; column <= 13; column++) {
    put(8, column, new ClockDate(`2026-09-${column + 1}T00:00:00Z`));
  }
  put(9, 9, 0);
  put(9, 10, '', '=""');
  put(9, 11, '#N/A', '="#N/A"');
  put(9, 12, '0');
  put(9, 13, 7);
  const rule = options.validation === 'NONE' ? null : allow({
    getCriteriaType: () => options.validation || 'VALUE_IN_LIST',
    getCriteriaValues: () => {
      events.push('criteriaValues');
      assert.notEqual(options.validation, 'VALUE_IN_RANGE', 'Range criteria must never be inspected');
      return [options.list || ['Argentina', 'Chile'], true];
    }
  });
  const sheet = allow({
    getName: () => 'WebApp',
    getLastRow: () => (changed && options.changedRows) || options.rows || 11,
    getLastColumn: () => 13,
    getMaxRows: () => options.rows || 100,
    getMaxColumns: () => 26,
    getRange: (...args) => {
      assert.ok(locked && !released, 'Every sheet access must hold the script lock');
      if (args.length === 1) {
        assert.equal(args[0], 'H4', 'Only H4 may be written or validated');
        return allow({
          getDataValidation: () => rule,
          setValue: value => {
            writes.push(value);
            events.push(`write:${value}`);
            assert.ok(!/^[\s]*[=+\-@']/.test(String(value)), 'No injected formula writes');
            if (writes.length > 1 && options.restoreFailure) throw new Error('PRIVATE restoration error');
            selector = value;
            changed = writes.length === 1;
            if (writes.length === 1 && options.writeFailure) throw new Error('PRIVATE uncertain write');
          }
        });
      }
      const [row, column, height, width] = args;
      events.push(`range:${args.join(',')}`);
      const isSelector = row === 4 && column === 8 && height === 1 && width === 1;
      assert.ok(isSelector || (row === 8 && column === 1 && height === 1 && width === 13) ||
        (row === 1 && column === 3 && width === 5) ||
        (row === 1 && column >= 9 && column <= 13 && width === 1));
      if (isSelector) {
        selectorReads++;
        if (selectorReads === options.unexpectedAt) selector = 'Unexpected';
      }
      if (changed && !isSelector && options.pollFailure) throw new Error('PRIVATE read error');
      const matrix = kind => Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => {
          const key = `${row + y},${column + x}`;
          let value = isSelector ? selector : (values.get(key) ?? '');
          let formula = isSelector ? (options.initialFormula && writes.length === 0 ? '=COUNTRY()' : '') :
            (formulas.get(key) || '');
          if (changed && !options.oldData && row + y === 9 && column + x >= 9) {
            value = options.typedChanges ? ['text', 0, '', '#REF!', 99][column + x - 9] :
              column + x === 13 ? 99 : value;
            if (options.typedChanges) formula = '';
          }
          if (changed && options.movingData && row + y === 9 && column + x === 13) value = time;
          if (changed && options.earlyAndEmptyRows && [1, 11].includes(row + y) && column + x === 13) value = 123;
          if (kind === 'value') return value;
          if (kind === 'formula') return formula;
          if (kind === 'format') return '0.00';
          return String(value);
        }));
      return allow({ getValues: () => matrix('value'), getDisplayValues: () => matrix('display'),
        getNumberFormats: () => matrix('format'), getFormulas: () => matrix('formula') });
    }
  });
  const context = vm.createContext({
    Date: ClockDate,
    LockService: allow({ getScriptLock: () => allow({
      tryLock: wait => {
        events.push(`lock:${wait}`);
        assert.ok(wait >= 0 && wait <= 5000);
        locked = !options.noLock;
        return locked;
      },
      releaseLock: () => {
        events.push('release');
        released = true;
        if (options.releaseFailure) throw new Error('PRIVATE release error');
      }
    }) }),
    SpreadsheetApp: allow({
      openById: id => {
        assert.ok(locked);
        assert.equal(id, '1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk');
        return allow({
          getSheetByName: name => { assert.equal(name, 'WebApp'); return sheet; },
          getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires'
        });
      },
      flush: () => {
        events.push('flush');
        if (options.flushFailure && writes.length === 1) throw new Error('PRIVATE flush error');
      }
    }),
    Utilities: allow({
      sleep: ms => { events.push(`sleep:${ms}`); time += ms + (options.sleepOverrun || 0); },
      formatDate: date => date.toISOString().slice(0, 10)
    }),
    console: allow({ log: text => logs.push(text) }),
    BigQuery: allow({}), UrlFetchApp: allow({}), ScriptApp: allow({}), Sheets: allow({})
  });
  let configured = shared.replace("testCountry: ''", `testCountry: ${JSON.stringify(options.country ?? 'Chile')}`);
  configured = configured.replace('manualCountryAllowlist: Object.freeze([])',
    `manualCountryAllowlist: Object.freeze(${JSON.stringify(options.manual || [])})`);
  for (const key of ['totalReadBudget', 'maxAttempts', 'deadlineMs', 'pollIntervalMs']) {
    if (options[key] !== undefined) configured = configured.replace(new RegExp(`${key}: \\d+`), `${key}: ${options[key]}`);
  }
  if (options.tab) configured = configured.replace("tabName: 'WebApp'", `tabName: ${JSON.stringify(options.tab)}`);
  vm.runInContext(configured + '\n' + source, context, { timeout: 1000 });
  return { run: () => JSON.parse(JSON.stringify(vm.runInContext('probarSelectorWebApp()', context,
    { timeout: 2000 }))), events, writes, logs, put, selector: () => selector, released: () => released };
}

test('no lock means no selector reads and no writes', () => {
  const f = fixture({ noLock: true });
  assert.equal(f.run().errors.primary, 'SELECTOR_LOCK_UNAVAILABLE');
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.events, ['lock:1000']);
});
for (const country of ['', '   ', 'Argentina']) {
  test(`blank/equal request does not write: ${JSON.stringify(country)}`, () => {
    const f = fixture({ country });
    assert.equal(f.run().status, 'SKIPPED_NO_CHANGE');
    assert.deepEqual(f.writes, []);
    assert.ok(f.released());
  });
}
test('formula selector is rejected before baseline or writes', () => {
  const f = fixture({ initialFormula: true });
  assert.equal(f.run().errors.primary, 'SELECTOR_INITIAL_FORMULA');
  assert.deepEqual(f.writes, []);
  assert.ok(f.released());
});
test('literal validation rejects country outside the exact list', () => {
  const f = fixture({ country: 'chile' });
  assert.equal(f.run().errors.primary, 'SELECTOR_COUNTRY_NOT_ALLOWED');
  assert.deepEqual(f.writes, []);
});
test('range validation requires manual list and never requests source reference', () => {
  const f = fixture({ validation: 'VALUE_IN_RANGE', manual: ['Chile'] });
  assert.equal(f.run().status, 'OBSERVED_STABILITY_UNVERIFIED');
  assert.ok(!f.events.includes('criteriaValues'));
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  const missing = fixture({ validation: 'VALUE_IN_RANGE' });
  assert.equal(missing.run().errors.primary, 'SELECTOR_COUNTRY_NOT_ALLOWED');
  assert.deepEqual(missing.writes, []);
});
test('absent validation requires manual list; unsupported criteria fail closed', () => {
  for (const validation of ['NONE', 'CUSTOM_FORMULA']) {
    const f = fixture({ validation });
    assert.equal(f.run().status, 'FAILED');
    assert.deepEqual(f.writes, []);
  }
  assert.equal(fixture({ validation: 'NONE', manual: ['Chile'] }).run().status,
    'OBSERVED_STABILITY_UNVERIFIED');
});
for (const failure of ['writeFailure', 'flushFailure', 'pollFailure']) {
  test(`failure after possible edit restores original: ${failure}`, () => {
    const f = fixture({ [failure]: true });
    const result = f.run();
    assert.equal(result.errors.primary, 'SELECTOR_SERVICE_ERROR');
    assert.equal(result.errors.restoration, null);
    assert.equal(result.restoration.status, 'SELECTOR_RESTORED_DATA_UNVERIFIED');
    assert.deepEqual(f.writes, ['Chile', 'Argentina']);
    assert.equal(f.selector(), 'Argentina');
    assert.ok(f.released());
    assert.doesNotMatch(f.logs.join(''), /PRIVATE/);
  });
}
test('restoration failure still releases lock and preserves separate errors', () => {
  const f = fixture({ pollFailure: true, restoreFailure: true, releaseFailure: true });
  const result = f.run();
  assert.equal(result.status, 'FAILED_CLEANUP');
  assert.equal(result.restoration.status, 'FAILED_MANUAL_RESTORATION_REQUIRED');
  assert.deepEqual(result.errors, { primary: 'SELECTOR_SERVICE_ERROR',
    restoration: 'SELECTOR_SERVICE_ERROR', release: 'SELECTOR_SERVICE_ERROR' });
  assert.ok(f.released());
});
// Selector read order: original, baseline before/after, prewrite, poll before/after.
for (const unexpectedAt of [2, 3, 4, 5, 6]) {
  test(`unexpected selector invalidates at guard ${unexpectedAt}`, () => {
    const f = fixture({ unexpectedAt });
    const result = f.run();
    assert.equal(result.status, 'INVALIDATED_SELECTOR_CHANGED');
    assert.equal(result.errors.primary, 'SELECTOR_UNEXPECTED');
    assert.deepEqual(f.writes, unexpectedAt < 5 ? [] : ['Chile', 'Argentina']);
    assert.ok(f.released());
  });
}
test('restored selector mismatch is reported, not certified restored', () => {
  const f = fixture({ unexpectedAt: 9 });
  const result = f.run();
  assert.equal(result.errors.primary, null);
  assert.equal(result.errors.restoration, 'SELECTOR_UNEXPECTED');
  assert.equal(result.status, 'FAILED_CLEANUP');
  assert.ok(f.released());
});
test('stable old data is inconclusive and every verification stays unverified', () => {
  const result = fixture({ oldData: true }).run();
  assert.equal(result.status, 'INCONCLUSIVE_UNCHANGED_BASELINE');
  assert.equal(result.observedStability, true);
  assert.equal(result.attempts.length, 2);
  assert.ok(Object.values(result.verification).every(value => value === 'unverified'));
  assert.deepEqual(result.attempts.map(a => a.differences), [[], []]);
});
test('all five date candidates are compared; late column change has typed diffs and timing', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.status, 'OBSERVED_STABILITY_UNVERIFIED');
  assert.equal(result.attempts[0].differences[0].a1, 'M9');
  assert.equal(result.attempts[0].differences[0].before.value, 7);
  assert.equal(result.attempts[0].differences[0].after.value, 99);
  assert.equal(result.attempts[0].durationMs, 1000);
  assert.equal(result.attempts[1].startedMs, 1000);
  for (let column = 9; column <= 13; column++) {
    assert.equal(f.events.filter(event => event === `range:1,${column},11,1`).length, 3);
  }
  assert.ok(result.readBudget.used <= result.readBudget.limit);
});
test('all named rows include early names and formerly empty weekly rows', () => {
  const result = fixture({ earlyAndEmptyRows: true }).run();
  assert.deepEqual(result.attempts[0].differences.map(diff => diff.a1), ['M1', 'M9', 'M11']);
  assert.equal(result.attempts[0].differences[2].before.emptyKind, 'physicalEmptyObservation');
});
test('changing observations stop at maxAttempts without claiming stability', () => {
  const result = fixture({ movingData: true, maxAttempts: 3 }).run();
  assert.equal(result.attempts.length, 3);
  assert.equal(result.status, 'OBSERVED_CHANGE_UNVERIFIED');
  assert.equal(result.observedStability, false);
  assert.equal(result.durationMs, 3000);
});
test('sheet growth exhausting budget after edit fails closed and uses reserved restoration reads', () => {
  const f = fixture({ changedRows: 100, totalReadBudget: 3200 });
  const result = f.run();
  assert.equal(result.errors.primary, 'SELECTOR_READ_BUDGET');
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.attempts[0].differences, []);
  assert.equal(result.restoration.status, 'SELECTOR_RESTORED_DATA_UNVERIFIED');
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.ok(result.readBudget.used <= 3200);
});
test('zero, empties, formula metadata, text and errorOrText survive coordinate diffs', () => {
  const result = fixture({ typedChanges: true }).run();
  const cells = Object.fromEntries(result.attempts[0].differences.map(diff => [diff.a1, diff]));
  assert.equal(cells.I9.before.value, 0);
  assert.equal(cells.I9.before.observation, 'zero');
  assert.equal(cells.I9.after.observation, 'text');
  assert.equal(cells.J9.before.emptyKind, 'formulaEmpty');
  assert.equal(cells.J9.before.formula, '=""');
  assert.equal(cells.J9.after.value, 0);
  assert.equal(cells.K9.before.errorConfirmed, false);
  assert.equal(cells.K9.before.errorMarker, '#N/A');
  assert.equal(cells.K9.before.display, '#N/A');
  assert.equal(cells.K9.after.emptyKind, 'physicalEmptyObservation');
  assert.equal(cells.L9.before.type, 'string');
  assert.equal(cells.L9.after.observation, 'errorOrText');
});
for (const totalReadBudget of [20, 500, 1000]) {
  test(`total read budget fails without partial success or writes: ${totalReadBudget}`, () => {
    const f = fixture({ totalReadBudget });
    const result = f.run();
    assert.equal(result.status, 'FAILED');
    assert.equal(result.errors.primary, 'SELECTOR_READ_BUDGET');
    assert.deepEqual(f.writes, []);
    assert.deepEqual(result.attempts, []);
    assert.ok(result.readBudget.used <= totalReadBudget);
  });
}
test('deadline overrun fails closed and restores, without claiming partial success', () => {
  const f = fixture({ deadlineMs: 2000, sleepOverrun: 2000 });
  const result = f.run();
  assert.equal(result.errors.primary, 'SELECTOR_DEADLINE');
  assert.equal(result.status, 'FAILED');
  assert.equal(result.attempts[0].status, 'SELECTOR_DEADLINE');
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
});
for (const value of ['=IMPORTXML("url")', ' +SUM(1)', '-1', '@formula', "'literal"]) {
  test(`formula-like requested and original literals cannot be written: ${value}`, () => {
    for (const options of [{ country: value }, { original: value }]) {
      const f = fixture(options);
      assert.match(f.run().errors.primary, /^SELECTOR_UNSAFE_/);
      assert.deepEqual(f.writes, []);
    }
  });
}
for (const original of [0, false, '']) {
  test(`original literal restoration preserves type: ${JSON.stringify(original)}`, () => {
    const f = fixture({ original });
    assert.equal(f.run().restoration.selector.value, original);
    assert.deepEqual(f.writes, ['Chile', original]);
  });
}
for (const tab of ['2) Weekly por pais', ' WebApp ', 'webapp']) {
  test(`unsafe/nonexact destination fails before any service access: ${tab}`, () => {
    const f = fixture({ tab });
    assert.equal(f.run().errors.primary, 'SELECTOR_DESTINATION');
    assert.deepEqual(f.events, []);
  });
}
test('logs contain concise summary only, never matrices, names, or formulas', () => {
  const f = fixture({ typedChanges: true });
  f.run();
  assert.equal(f.logs.length, 1);
  assert.ok(f.logs[0].length < 600);
  assert.doesNotMatch(f.logs[0], /Private name|#N\/A|differences|numberFormat/);
});
test('static isolation: single public entry, only selector setValue, no remote/persistence APIs', () => {
  assert.deepEqual([...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1])
    .filter(name => !name.endsWith('_')), ['probarSelectorWebApp']);
  assert.doesNotMatch(source, /\b(BigQuery|UrlFetchApp|ScriptApp|HtmlService|DriveApp|PropertiesService|fetch)\b/);
  assert.doesNotMatch(source, /\.(setFormula\w*|setValues|clear\w*|getSheets|getActive\w*)\s*\(/);
  assert.equal((source.match(/\.setValue\(/g) || []).length, 2);
  assert.equal((source.match(/sheet\.getRange\(config\.selector\)\.setValue\(/g) || []).length, 2);
});
