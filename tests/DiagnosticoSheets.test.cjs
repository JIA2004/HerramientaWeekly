const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const originals = ['ReportePaises.gs.txt', 'Web.gs.txt', 'Index.txt'];
function checksums() {
  return Object.fromEntries(originals.map(name => [name,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]));
}
if (process.env.WEEKLY_CAPTURE_HASHES === '1') {
  console.log(JSON.stringify(checksums(), null, 2));
}

const expectedHashes = {
  'ReportePaises.gs.txt': '121495a000e0f80f6e144153d2db7ef2ccea7cbc2df6de7e9c073d70bef00d9a',
  'Web.gs.txt': '08133763ee1f221877553f8edb14733ef2aa4ef9931583dab2e9b1d50cfe87f4',
  // Replaced on purpose on 2026-09-21: Index.txt is now the consultation frontend.
  // The legacy backend and the shell above must stay byte-identical.
  'Index.txt': 'a79e2f5dd3115caa00bca2c0b3b17c15071fe3ac37a588ad7cdb487549aa5348'
};
const source = fs.readFileSync(path.join(root, 'DiagnosticoSheets.gs'), 'utf8');
function allow(methods) {
  return new Proxy(methods, {
    get(target, key) {
      if (!Object.hasOwn(target, key)) throw new Error(`Forbidden API: ${String(key)}`);
      return target[key];
    },
    set() { throw new Error('Writes forbidden'); }
  });
}
function fixture(options = {}) {
  const values = new Map();
  const formulas = new Map();
  const logs = [];
  const calls = [];
  const put = (r, c, value, formula = '') => {
    values.set(`${r},${c}`, value);
    formulas.set(`${r},${c}`, formula);
  };
  put(1, 7, 'Earlier name');
  put(8, 7, 'Name header');
  put(9, 7, 'Repeated secret name');
  put(10, 7, 'Repeated secret name');
  put(11, 7, 'No weekly values');
  put(9, 3, 'Metadata secret');
  put(9, 4, 0);
  put(9, 5, false);
  put(9, 6, new Date('2026-09-01T00:00:00Z'));
  put(8, 1, '2026-09-01');
  put(8, 2, 46000);
  for (let c = 9; c <= 13; c++) put(8, c, new Date(`2026-09-${String(c).padStart(2, '0')}T01:00:00Z`));
  put(8, 10, new Date('2026-09-08T23:00:00Z'));
  put(9, 9, 0);
  put(9, 10, '', '=""');
  put(9, 11, 42);
  put(9, 12, '#N/A', '="#N/A"');
  put(10, 9, '42');
  put(10, 10, '#REF!');
  put(10, 11, true);
  let selectorReads = 0;
  let sheet;
  const validation = options.validation ? allow({
    getCriteriaType: () => options.validation,
    getCriteriaValues: () => {
      if (options.validation === 'VALUE_IN_LIST') return [['Argentina', 'Chile'], true];
      if (options.validation === 'VALUE_IN_RANGE') return [allow({
        getA1Notation: () => 'A1:A9',
        getSheet: () => allow({
          getName: () => options.sameTab ? 'WebApp' : 'Reference only',
          getSheetId: () => options.sameTab ? 77 : 99
        })
      }), true];
      throw new Error('Other criterion arguments must not be read');
    }
  }) : null;
  sheet = allow({
    getLastRow: () => options.rows ?? 11,
    getLastColumn: () => 13,
    getMaxRows: () => options.rows ?? 100,
    getMaxColumns: () => 26,
    getSheetId: () => 77,
    getRange: (...args) => {
      calls.push(args);
      if (args.length === 1) {
        assert.equal(args[0], 'H4');
        return allow({ getDataValidation: () => validation });
      }
      const [r, c, h, w] = args;
      const selector = r === 4 && c === 8 && h === 1 && w === 1;
      const permitted = selector || (r === 8 && c === 1 && h === 1 && w === 13) ||
        (r === 1 && c === 3 && h === 11 && w === 5) ||
        (r === 1 && c >= 9 && c <= 12 && h === 11 && w === 1);
      assert.ok(permitted, `Unexpected content range ${args}`);
      if (selector) selectorReads++;
      const matrix = kind => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
        const key = `${r + y},${c + x}`;
        let value = values.has(key) ? values.get(key) : '';
        if (selector) value = selectorReads > 1 && options.changed ? 'Chile' : 'Argentina';
        if (kind === 'value') return value;
        if (kind === 'formula') return formulas.get(key) || '';
        if (kind === 'format') return '0.00%';
        return String(value);
      }));
      return allow({
        getValues: () => options.badMatrix ? [] : matrix('value'),
        getDisplayValues: () => matrix('display'),
        getNumberFormats: () => matrix('format'),
        getFormulas: () => matrix('formula')
      });
    }
  });
  const document = allow({
    getSheetByName: name => {
      assert.equal(name, 'WebApp');
      return options.missing ? null : sheet;
    },
    getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires'
  });
  const context = vm.createContext({
    Date,
    SpreadsheetApp: allow({ openById: id => {
      assert.equal(id, '1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk');
      if (options.access) throw new Error('PRIVATE SERVICE MESSAGE');
      return document;
    } }),
    Utilities: allow({ formatDate: (date, zone, pattern) => {
      assert.equal(zone, 'America/Argentina/Buenos_Aires');
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).formatToParts(date).map(p => [p.type, p.value]));
      const day = `${parts.year}-${parts.month}-${parts.day}`;
      assert.ok(['yyyy-MM-dd', "yyyy-MM-dd'T'HH:mm:ssZ"].includes(pattern));
      return pattern === 'yyyy-MM-dd' ? day : `${day}T${parts.hour}:${parts.minute}:${parts.second}-0300`;
    } }),
    console: allow({ log: text => logs.push(text) }),
    BigQuery: allow({}), UrlFetchApp: allow({}), ScriptApp: allow({}),
    Sheets: allow({}), HtmlService: allow({}), google: allow({})
  });
  vm.runInContext(source, context, { timeout: 1000 });
  return { run: () => vm.runInContext('diagnosticarWeeklySheets()', context, { timeout: 2000 }),
    put, logs, calls };
}
function noDates(value) {
  assert.notEqual(Object.prototype.toString.call(value), '[object Date]');
  if (value && typeof value === 'object') Object.values(value).forEach(noDates);
  else assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
}

test('captured files keep the reviewed bytes', () => assert.deepEqual(checksums(), expectedHashes));
test('retains early/header/repeated/empty-week names and metadata coordinates', () => {
  const result = fixture().run();
  assert.deepEqual(Array.from(result.rows, row => row.row), [1, 8, 9, 10, 11]);
  assert.equal(result.rows[2].name.a1, 'G9');
  assert.equal(result.rows[2].name.value, result.rows[3].name.value);
  assert.deepEqual(Array.from(result.rows[2].metadata, cell => cell.a1), ['C9', 'D9', 'E9', 'F9']);
  assert.ok(result.rows[4].samples.every(cell => cell.observation === 'empty'));
  assert.equal(result.dimensions.used.rows, 11);
  assert.equal(result.dimensions.allocated.columns, 26);
  assert.equal(result.tab.id, 77);
});
test('preserves zero, numeric, text, formula empty and physical empty', () => {
  const result = fixture().run();
  const [zero, empty, number, token] = result.rows[2].samples;
  assert.equal(zero.value, 0);
  assert.equal(zero.observation, 'zero');
  assert.equal(empty.emptyKind, 'formulaEmpty');
  assert.equal(number.value, 42);
  assert.equal(number.observation, 'number');
  assert.equal(result.rows[3].samples[0].value, '42');
  assert.equal(result.rows[3].samples[0].observation, 'text');
  assert.equal(result.rows[4].samples[0].emptyKind, 'physicalEmptyObservation');
  assert.equal(token.observation, 'errorOrText');
  assert.equal(token.errorConfirmed, false);
  assert.equal(token.errorMarker, '#N/A');
  assert.match(token.uncertainty, /indistinguishable/);
  assert.equal(result.rows[3].samples[1].observation, 'errorOrText');
  assert.match(result.limitations[0], /no typed error discriminator/);
});
test('scans all headers, bounds samples and groups dates in document calendar timezone', () => {
  const result = fixture().run();
  assert.equal(result.headers.dateCandidates.length, 5);
  assert.deepEqual(Array.from(result.sampleColumns), [9, 10, 11, 12]);
  assert.equal(result.headers.dateCandidates[0].cell.value, '2026-09-09T01:00:00.000Z');
  assert.equal(result.headers.dateCandidates[0].cell.sheetDate, '2026-09-08');
  assert.equal(result.headers.duplicateDates[0].sheetDate, '2026-09-08');
  assert.deepEqual(Array.from(result.headers.duplicateDates[0].coordinates), ['I8', 'J8']);
  assert.deepEqual(Array.from(result.headers.ambiguous, entry => entry.cell.a1), ['A8', 'B8', 'G8']);
  assert.equal(result.readRanges.length, 8);
});
test('result is recursively Date-free and JSON serializable', () => {
  const result = fixture().run();
  noDates(result);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.match(result.timestamp, /Z$/);
  assert.match(result.readLocalTimestamp, /-0300$/);
});
test('unchanged selector never certifies validity, country or recalculation', () => {
  const result = fixture().run();
  assert.equal(result.valid, null);
  assert.equal(result.selector.changed, false);
  assert.equal(result.selector.before.cell.value, 'Argentina');
  assert.equal(result.selector.after.cell.a1, 'H4');
  assert.ok(Object.values(result.verification).every(value => value === 'unverified'));
});
test('selector change invalidates observations', () => {
  const result = fixture({ changed: true }).run();
  assert.equal(result.valid, false);
  assert.equal(result.status, 'INVALIDATED_SELECTOR_CHANGED');
  assert.equal(result.selector.after.cell.value, 'Chile');
});
test('literal validation lists are retained', () => {
  const result = fixture({ validation: 'VALUE_IN_LIST' }).run();
  assert.deepEqual(Array.from(result.selector.before.validation.literalList), ['Argentina', 'Chile']);
});
for (const sameTab of [false, true]) {
  test(`validation range is reference-only, sameTab=${sameTab}`, () => {
    const result = fixture({ validation: 'VALUE_IN_RANGE', sameTab }).run();
    assert.equal(result.selector.before.validation.reference.contentsRead, false);
    assert.equal(result.selector.before.validation.reference.a1, 'A1:A9');
    assert.equal(result.selector.before.validation.reference.sheetId, sameTab ? 77 : 99);
  });
}
test('other validation types expose no criterion arguments', () => {
  assert.equal(fixture({ validation: 'CUSTOM_FORMULA' }).run().selector.before.validation.type, 'CUSTOM_FORMULA');
});
for (const [options, code] of [
  [{ access: true }, 'WEEKLY_ACCESS'], [{ missing: true }, 'WEEKLY_MISSING_TAB'],
  [{ rows: 2 }, 'WEEKLY_STRUCTURE'], [{ rows: 100000 }, 'WEEKLY_STRUCTURE'],
  [{ badMatrix: true }, 'WEEKLY_STRUCTURE']
]) {
  test(`safe failure ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    assert.throws(f.run, error => error.message.startsWith(code) && !error.message.includes('PRIVATE'));
    assert.equal(f.logs.length, 0);
  });
}
for (const value of [null, undefined, {}, NaN, Infinity, new Date('invalid')]) {
  test(`unknown value fails safely: ${String(value)}`, () => {
    const f = fixture();
    f.put(9, 9, value);
    assert.throws(f.run, /WEEKLY_STRUCTURE/);
  });
}
test('bounded summary never logs raw names, matrices, errors, formulas or selector', () => {
  const f = fixture();
  f.run();
  assert.equal(f.logs.length, 1);
  assert.ok(f.logs[0].length < 200);
  assert.deepEqual(Object.keys(JSON.parse(f.logs[0])), ['status', 'namedRows', 'candidateColumns', 'sampledColumns']);
  assert.doesNotMatch(f.logs[0], /secret|Argentina|#N\/A|Metadata/);
});
test('static isolation and prohibited API check', () => {
  assert.doesNotMatch(source, /\b(BigQuery|UrlFetchApp|ScriptApp|HtmlService|Sheets|DriveApp|google|fetch)\b/);
  assert.doesNotMatch(source, /\.(set\w*|clear\w*|delete\w*|insert\w*|append\w*|flush|refresh\w*|getSheets|getActive\w*)\s*\(/);
  const names = [...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1]);
  assert.deepEqual(names.filter(name => !name.endsWith('_')), ['diagnosticarWeeklySheets']);
  assert.ok(names.slice(1).every(name => /^weeklyDiagnostic.*_$/.test(name)));
  assert.equal((source.match(/\.getSheetByName\(/g) || []).length, 1);
  assert.deepEqual(checksums(), expectedHashes);
});
