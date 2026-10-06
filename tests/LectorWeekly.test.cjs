const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'DiagnosticoSheets.gs'), 'utf8');
const selector = fs.readFileSync(path.join(root, 'PruebaSelector.gs'), 'utf8');
const source = fs.readFileSync(path.join(root, 'LectorWeekly.gs'), 'utf8');

test('normalization: touched scripts, tests and guides use LF without BOM or trailing whitespace', () => {
  for (const name of ['DiagnosticoSheets.gs', 'PruebaSelector.gs', 'LectorWeekly.gs',
    'DIAGNOSTICO_SHEETS.md', 'PRUEBA_SELECTOR.md', 'LECTOR_WEEKLY.md', 'BITACORA.md',
    'tests/DiagnosticoSheets.test.cjs', 'tests/PruebaSelector.test.cjs', 'tests/LectorWeekly.test.cjs',
    'odd/tasks/webapp-selector-experiment.md', 'odd/tasks/weekly-reader-pilot.md',
    'odd/tasks/weekly-reader-additional-columns.md']) {
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
  // Fixed instant: 2026-09-20 is a Sunday; the expected last closed week is
  // 2026-09-07 and I8 holds exactly that date, so its warning does not fire.
  let time = Date.UTC(2026, 8, 20);
  class ClockDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(time);
      else super(...args);
    }
    static now() { return time; }
  }
  const events = [];
  const writes = [];
  const logs = [];
  let selectorValue = options.original ?? 'Argentina';
  let selectorReads = 0;
  let locked = false;
  let released = false;
  let changed = false;
  let metadataReads = 0;
  let mutationTick = 0;
  const values = new Map();
  const formulas = new Map();
  const put = (row, column, value, formula = '') => {
    values.set(`${row},${column}`, value);
    formulas.set(`${row},${column}`, formula);
  };
  // Seeded layout mirrors the operator-reported live shape: header row 8, nine
  // weekly date columns I..Q (9..17), four comparison/benchmark columns and one
  // unknown non-date header. The relocated variant moves the known labels to
  // different coordinates to prove classification is by normalized label.
  const weekDays = ['2026-09-07', '2026-09-08', '2026-09-14', '2026-09-21', '2026-09-28',
    '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
  const weekColumns = weekDays.map((day, index) => 9 + index);
  const additionalLayout = options.relocatedAdditional
    ? [{ column: 24, label: 'WoW' }, { column: 25, label: 'vs. W-4' },
      { column: 26, label: 'vs. W-8' }, { column: 28, label: 'Bench entre\nmercados' }]
    : [{ column: 18, label: 'WoW' }, { column: 19, label: 'vs. W-4' },
      { column: 20, label: 'vs. W-8' }, { column: 22, label: 'Bench entre\nmercados' }];
  const additionalColumns = additionalLayout.map(entry => entry.column);
  const unknownColumn = 23;
  const lastColumn = options.relocatedAdditional ? 28 : unknownColumn;
  const usedRows = options.rows || 11;
  for (const row of [1, 6, 8, 9, 10, 11]) {
    const name = row === 8 ? 'Name header' :
      row === 10 && options.repeatedName ? 'Private name 9' :
        row === 10 && options.latamName ? 'LATAM Private 10' : `Private name ${row}`;
    put(row, 7, name);
  }
  for (let offset = 0; offset < weekDays.length; offset++) {
    const day = offset === 1 && options.duplicateDates ? '2026-09-07' : weekDays[offset];
    put(8, weekColumns[offset], new ClockDate(`${day}T00:00:00Z`));
  }
  put(9, 9, 0);
  put(9, 10, '', '=""');
  put(9, 11, '#N/A', '="#N/A"');
  put(9, 12, '0');
  put(9, 13, 7);
  additionalLayout.forEach((entry, index) => {
    const seeded = [0, '', '#N/A', 'texto'][index];
    put(8, entry.column, entry.label);
    put(9, entry.column, seeded);
  });
  put(8, unknownColumn, 'Misterio');
  if (options.emptyBody) {
    // Headers stay; every candidate weekly body cell of the named rows becomes
    // empty. Row 2 is only seeded by numberAboveHeader and is never cleared.
    for (const row of [1, 6, 9, 10, 11]) {
      for (const column of weekColumns) put(row, column, '');
    }
  }
  if (options.numberAboveHeader) {
    put(2, 7, 'Private name 2');
    put(2, weekColumns[0], 5);
  }
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
    getLastColumn: () => lastColumn,
    getMaxRows: () => options.rows || 100,
    // A sheet holding used content through column `lastColumn` never reports
    // fewer maximum columns than that.
    getMaxColumns: () => Math.max(26, lastColumn),
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
            selectorValue = value;
            changed = writes.length === 1;
            if (writes.length === 1 && options.writeFailure) throw new Error('PRIVATE uncertain write');
          }
        });
      }
      const [row, column, height, width] = args;
      events.push(`range:${args.join(',')}`);
      const isSelector = row === 4 && column === 8 && height === 1 && width === 1;
      const isHeaderBatch = row === 8 && column === 1 && height === 1 && width === lastColumn;
      const isMetadataBatch = row === 1 && column === 3 && width === 5;
      const isWeekColumn = row === 1 && height === usedRows && width === 1 &&
        weekColumns.indexOf(column) !== -1;
      const isAdditionalColumn = row === 1 && height === usedRows && width === 1 &&
        additionalColumns.indexOf(column) !== -1;
      assert.ok(isSelector || isHeaderBatch || isMetadataBatch || isWeekColumn || isAdditionalColumn,
        `Unexpected content range ${args}`);
      if (isSelector) {
        selectorReads++;
        if (selectorReads === options.unexpectedAt) selectorValue = 'Unexpected';
      }
      if (isAdditionalColumn) {
        // The additional-column readings sit between the selector controls of
        // the same capture, so a change injected only here can be caught by
        // nothing else. Both knobs are gated on the post-write state so the
        // pre-write baseline capture stays undisturbed.
        if (options.additionalSelectorChange && changed) selectorValue = 'Unexpected';
        if (options.additionalDeadline && changed) time += options.additionalDeadline;
      }
      if (options.timeWarpAtCandidateBatch && isWeekColumn) {
        time += options.timeWarpAtCandidateBatch;
      }
      if (isMetadataBatch) {
        metadataReads++;
        if (options.structureChange && metadataReads === 2) values.set('8,7', 'Name header CHANGED');
        // Always-different captures: M9 changes once per snapshot (incl. baseline).
        if (options.changing) values.set('9,13', 90 + metadataReads);
        // An always-changing additional cell proves the extra columns take part
        // in the stability comparison instead of being read after the fact.
        if (options.additionalChanging) values.set(`9,${additionalColumns[0]}`, 200 + metadataReads);
      }
      // Delayed recalculation settlement: the first N post-write M9 reads differ,
      // then the stable value 93 settles (r1=92, r2=93, r3=93 -> stable at r3).
      let m9Override = null;
      if (isWeekColumn && column === 13 && changed && options.mutations !== undefined) {
        mutationTick++;
        m9Override = mutationTick <= options.mutations ? 91 + mutationTick : 93;
      }
      if (changed && !isSelector && options.pollFailure) throw new Error('PRIVATE read error');
      const matrix = kind => Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => {
          const key = `${row + y},${column + x}`;
          let value = isSelector ? selectorValue : (values.get(key) ?? '');
          let formula = isSelector ? (options.initialFormula && writes.length === 0 ? '=COUNTRY()' : '') :
            (formulas.get(key) || '');
          if (row + y === 9 && column + x === 13) {
            if (m9Override !== null) value = m9Override;
            else if (changed && !options.changing && !options.emptyBody) value = 99;
          }
          // Simulated post-write recalculation of the first additional column:
          // the value must come from the capture taken BEFORE restoration.
          if (row + y === 9 && column + x === additionalColumns[0] && options.additionalRecalc &&
              changed && !options.emptyBody) value = 55;
          if (kind === 'value') return value;
          if (kind === 'formula') return formula;
          if (kind === 'format') return '0.00';
          return value instanceof Date ? value.toISOString() : String(value);
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
          getSpreadsheetTimeZone: () => options.zone || 'America/Argentina/Buenos_Aires'
        });
      },
      flush: () => {
        events.push('flush');
        if (options.flushFailure && writes.length === 1) throw new Error('PRIVATE flush error');
      }
    }),
    Utilities: allow({
      // The synthetic calendar is fixed at UTC midnight; Buenos Aires keeps the
      // UTC date, America/Santiago is one day behind in this deterministic clock.
      formatDate: (date, zone) => {
        const iso = date.toISOString().slice(0, 10);
        if (zone === 'America/Argentina/Buenos_Aires') return iso;
        return new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      },
      sleep: ms => {
        events.push(`sleep:${ms}`);
        time += ms;
      }
    }),
    console: allow({ log: text => logs.push(text) }),
    BigQuery: allow({}), UrlFetchApp: allow({}), ScriptApp: allow({}), Sheets: allow({})
  });
  let configured = shared;
  if (options.testCountry !== undefined) {
    configured = configured.replace("testCountry: ''", `testCountry: ${JSON.stringify(options.testCountry)}`);
  }
  configured = configured.replace('manualCountryAllowlist: Object.freeze([])',
    `manualCountryAllowlist: Object.freeze(${JSON.stringify(options.manual || [])})`);
  for (const key of ['totalReadBudget', 'maxAttempts', 'deadlineMs', 'pollIntervalMs']) {
    if (options[key] !== undefined) configured = configured.replace(new RegExp(`${key}: \\d+`), `${key}: ${options[key]}`);
  }
  if (options.tab) configured = configured.replace("tabName: 'WebApp'", `tabName: ${JSON.stringify(options.tab)}`);
  vm.runInContext(configured + '\n' + selector + '\n' + source, context, { timeout: 1000 });
  return { run: (pais) => JSON.parse(JSON.stringify(vm.runInContext(
    `leerWeeklyPorPais(${JSON.stringify(pais)})`, context, { timeout: 2000 }))),
    runProbar: () => JSON.parse(JSON.stringify(vm.runInContext('probarLectorWeekly()', context,
      { timeout: 2000 }))),
    events, writes, logs, put, selector: () => selectorValue, released: () => released };
}

test('static isolation: only two public entries, H4-only setValue, no remote or persistence APIs', () => {
  assert.deepEqual([...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1])
    .filter(name => !name.endsWith('_')), ['leerWeeklyPorPais', 'probarLectorWeekly']);
  assert.ok([...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1])
    .filter(name => name.endsWith('_')).every(name => /^weeklyLectura.*_$/.test(name)));
  assert.doesNotMatch(source, /\b(BigQuery|UrlFetchApp|ScriptApp|HtmlService|DriveApp|PropertiesService|fetch)\b/);
  assert.doesNotMatch(source, /\.(setFormula\w*|setValues|clear\w*|getSheets|getActive\w*)\s*\(/);
  assert.equal((source.match(/\.setValue\(/g) || []).length, 2);
  assert.equal((source.match(/sheet\.getRange\(config\.selector\)\.setValue\(/g) || []).length, 2);
  assert.equal((source.match(/\.openById\(/g) || []).length, 1);
  assert.equal((source.match(/\.getSheetByName\(/g) || []).length, 1);
  assert.equal((source.match(/getScriptLock\(/g) || []).length, 1);
  assert.doesNotMatch(source, /probarSelectorWebApp|diagnosticarWeeklySheets/);
});

test('blank or unsafe country fails before any lock or service access', () => {
  for (const pais of ['', '   ', '=SUM(1)', ' +1', "@import", '=IMPORTXML("url")']) {
    const f = fixture();
    const result = f.run(pais);
    assert.equal(result.estado, 'error');
    assert.equal(result.datosUtilizables, false);
    assert.match(result.error.codigo, /^SELECTOR_(COUNTRY_BLANK|UNSAFE_COUNTRY)$/);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.events, []);
    assert.ok(!f.released());
  }
});

test('no lock means no reads and no writes', () => {
  const f = fixture({ noLock: true });
  const result = f.run('Chile');
  assert.equal(result.error.codigo, 'SELECTOR_LOCK_UNAVAILABLE');
  assert.equal(result.datosUtilizables, false);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.events, ['lock:1000']);
});

test('unsafe or nonexact destination fails before any service access', () => {
  const f = fixture({ tab: '2) Weekly por pais' });
  const result = f.run('Chile');
  assert.equal(result.error.codigo, 'SELECTOR_DESTINATION');
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.writes, []);
});

test('formula-like original rejects before a write; unsafe original literal rejects too', () => {
  const initial = fixture({ initialFormula: true });
  assert.equal(initial.run('Chile').error.codigo, 'SELECTOR_INITIAL_FORMULA');
  assert.deepEqual(initial.writes, []);
  const unsafe = fixture({ original: '=IMPORTXML("url")' });
  assert.equal(unsafe.run('Chile').error.codigo, 'SELECTOR_UNSAFE_ORIGINAL');
  assert.deepEqual(unsafe.writes, []);
});

test('already-selected country is observed without any write and stability is observed', () => {
  const f = fixture();
  const result = f.run('Argentina');
  assert.equal(result.estado, 'ok');
  assert.equal(result.datosUtilizables, true);
  assert.equal(result.selector.escrita, null);
  assert.equal(result.selector.observado, 'Argentina');
  assert.equal(result.selector.restaurado, null);
  assert.equal(result.selector.restauracionVerificada, false);
  assert.equal(result.lectura.estableObservada, true);
  // The stability loop still spaced by pollIntervalMs: s1 then s2 with one sleep.
  assert.equal(result.lectura.intentos, 2);
  assert.equal(result.lectura.duracionMs, 1000);
  assert.equal(f.events.filter(event => event.startsWith('sleep:')).length, 1);
  assert.deepEqual(f.writes, []);
  assert.equal(result.semanas[4].fechaLocal, '2026-09-28');
  assert.equal(result.filas[3].observaciones['2026-09-28'].valor, 7);
  assert.ok(f.released());
});

test('main write path returns the pre-restoration capture with a verified restore', () => {
  const f = fixture();
  const result = f.run('Chile');
  assert.equal(result.schemaVersion, 'weekly-lectura/3');
  assert.equal(result.estado, 'ok');
  assert.equal(result.datosUtilizables, true);
  assert.equal(result.paisSolicitado, 'Chile');
  assert.deepEqual(result.entidad, { nombre: 'Chile', tipo: 'pais' });
  assert.deepEqual(result.selector, { original: 'Argentina', solicitado: 'Chile', observado: 'Chile',
    escrita: 'Chile', restaurado: 'Argentina', restauracionVerificada: true });
  assert.equal(result.lectura.zonaHorariaSemanaCerrada, 'America/Argentina/Buenos_Aires');
  assert.equal(result.lectura.inicioIso, '2026-09-20T00:00:00.000Z');
  assert.equal(result.lectura.intentos, 2);
  assert.equal(result.lectura.finIso, '2026-09-20T00:00:01.000Z');
  assert.equal(result.lectura.estableObservada, true);
  assert.equal(result.lectura.duracionMs, 1000);
  assert.deepEqual(result.origen, { documento: '1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk',
    pestana: 'WebApp', coordenadas: { selector: 'H4', filaEncabezados: 8, columnaNombres: 7, metadatos: 'C:F' },
    zonaHorariaDocumento: 'America/Argentina/Buenos_Aires' });
  assert.deepEqual(result.verificacion, { completitud: 'no_verificada',
    correspondenciaPaisDatos: 'no_verificada', recalculo: 'no_verificada', lecturaEstableEsObservacion: true });
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.ok(f.released());
  assert.equal(f.selector(), 'Argentina');
  // The fila observations come from the capture taken BEFORE restoration:
  // M9 is 99 (the simulated recalculation) while the selector was already restored.
  assert.equal(result.filas[3].observaciones['2026-09-28'].valor, 99);
});

test('week rows, named filas and quality signals match the seeded sheet', () => {
  const result = fixture().run('Chile');
  assert.deepEqual(result.semanas.map(week => week.fechaLocal),
    ['2026-09-07', '2026-09-08', '2026-09-14', '2026-09-21', '2026-09-28',
      '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(result.semanas.map(week => week.celda),
    ['I8', 'J8', 'K8', 'L8', 'M8', 'N8', 'O8', 'P8', 'Q8']);
  assert.equal(result.semanas[0].textoMostrado, '2026-09-07T00:00:00.000Z');
  assert.deepEqual(result.semanas.map(week => week.noEsLunes),
    [false, true, false, false, false, false, false, false, false]);
  assert.deepEqual(result.filas.map(fila => fila.id),
    ['WebApp!F1', 'WebApp!F6', 'WebApp!F8', 'WebApp!F9', 'WebApp!F10', 'WebApp!F11']);
  assert.deepEqual(result.filas.map(fila => fila.nombre),
    ['Private name 1', 'Private name 6', 'Name header', 'Private name 9', 'Private name 10', 'Private name 11']);
  assert.ok(result.filas.every(fila => fila.clasificacion === 'pendiente' && fila.kpi === null &&
    fila.unidad === null && fila.interpretacion === null && fila.sentidoFavorable === null));
  assert.deepEqual(Object.keys(result.filas[3].metadatos), ['C', 'D', 'E', 'F']);
  const calidad = result.calidad;
  assert.deepEqual(calidad.duplicados, []);
  assert.deepEqual(calidad.fechasNoLunes, [{ fechaLocal: '2026-09-08', celda: 'J8' }]);
  assert.deepEqual(calidad.encabezadosAmbiguos, [{ celda: 'W8', textoMostrado: 'Misterio' }]);
  assert.equal(calidad.ultimoEncabezado, '2026-10-26');
  assert.equal(calidad.ultimaSemanaCerradaEsperada, '2026-09-07');
  assert.equal(calidad.semanaCerradaEsperadaPresente, true);
  assert.equal(calidad.semanasDeclaradas, 9);
  assert.equal(calidad.semanasConObservacionesNumericas, 2);
  assert.equal(result.advertencias.length, 8);
});

test('zero, empty, errorOrText, text and date observations keep typed states', () => {
  const result = fixture().run('Chile');
  const obs = result.filas[3].observaciones;
  const celda = result.filas[2].observaciones;
  assert.deepEqual(obs['2026-09-07'], { coordenada: 'I9', valor: 0, textoMostrado: '0',
    formato: '0.00', tipo: 'number', estado: 'cero', hasFormula: false });
  assert.equal(obs['2026-09-08'].estado, 'vacio');
  assert.equal(obs['2026-09-08'].valor, null);
  assert.equal(obs['2026-09-08'].hasFormula, true);
  assert.equal(obs['2026-09-14'].estado, 'errorOrText');
  assert.equal(obs['2026-09-14'].valor, '#N/A');
  assert.equal(obs['2026-09-21'].estado, 'texto');
  assert.equal(obs['2026-09-21'].valor, '0');
  assert.equal(obs['2026-09-28'].estado, 'numero');
  assert.equal(obs['2026-09-28'].valor, 99);
  assert.equal(celda['2026-09-07'].estado, 'fecha');
  assert.equal(celda['2026-09-07'].valor, '2026-09-07');
});

test('repeated names stay separate with technical tab+row ids and a warning', () => {
  const result = fixture({ repeatedName: true }).run('Chile');
  assert.deepEqual(result.filas.map(fila => fila.id),
    ['WebApp!F1', 'WebApp!F6', 'WebApp!F8', 'WebApp!F9', 'WebApp!F10', 'WebApp!F11']);
  assert.deepEqual([result.filas[3].nombre, result.filas[4].nombre], ['Private name 9', 'Private name 9']);
  assert.ok(result.advertencias.some(text => /Repeated names/.test(text)));
});

test('duplicated header dates keep per-column observation keys and never overwrite', () => {
  const result = fixture({ duplicateDates: true }).run('Chile');
  assert.deepEqual(result.calidad.duplicados,
    [{ fechaLocal: '2026-09-07', coordenadas: ['I8', 'J8'] }]);
  assert.deepEqual(result.semanas.slice(0, 2).map(week => week.duplicada), [true, true]);
  const keys = Object.keys(result.filas[3].observaciones);
  assert.ok(keys.includes('2026-09-07 (I8)') && keys.includes('2026-09-07 (J8)'));
  assert.ok(!keys.includes('2026-09-07'));
  assert.equal(result.filas[3].observaciones['2026-09-07 (I8)'].coordenada, 'I9');
  assert.equal(result.filas[3].observaciones['2026-09-07 (J8)'].coordenada, 'J9');
});

test('structure change between snapshots invalidates the reading and still restores', () => {
  const f = fixture({ structureChange: true });
  const result = f.run('Chile');
  assert.equal(result.error.codigo, 'LECTURA_ESTRUCTURA_CAMBIADA');
  assert.equal(result.estado, 'error');
  assert.equal(result.datosUtilizables, false);
  // The failed capture was initiated inside the observation loop: the counter
  // is preserved instead of collapsing to zero.
  assert.equal(result.lectura.intentos, 1);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(f.selector(), 'Argentina');
  assert.deepEqual(result.semanas, []);
  assert.deepEqual(result.filas, []);
  assert.ok(f.released());
});

test('deadline exhausted between snapshots fails closed and restores', () => {
  const f = fixture({ timeWarpAtCandidateBatch: 1200 });
  const result = f.run('Chile');
  assert.equal(result.error.codigo, 'SELECTOR_DEADLINE');
  assert.equal(result.estado, 'error');
  assert.equal(result.datosUtilizables, false);
  assert.equal(result.lectura.intentos, 1);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(result.selector.restaurado, 'Argentina');
  assert.equal(result.selector.restauracionVerificada, true);
  assert.deepEqual(result.semanas, []);
  assert.ok(f.released());
});

test('read budget exhaustion before the write fails without touching the sheet content', () => {
  const f = fixture({ totalReadBudget: 40 });
  const result = f.run('Chile');
  assert.equal(result.error.codigo, 'SELECTOR_READ_BUDGET');
  assert.equal(result.estado, 'error');
  assert.equal(result.datosUtilizables, false);
  assert.deepEqual(f.writes, []);
  assert.equal(f.selector(), 'Argentina');
  assert.ok(f.released());
});

test('unexpected selector before the write causes no write; after the write it restores', () => {
  // Selector read order on the write path: 1 = the original-country read,
  // 2..5 = the pre-write baseline capture (open, close, control before the
  // additional block, control after it), then the H4 write, then 6..9 and
  // 10..13 = the two observation captures, and finally 14 = the restoration
  // verification. Reads up to 5 happen before the script writes anything and
  // reads from 6 on happen once the requested country is already written.
  for (const unexpectedAt of [2, 3, 4, 5, 6]) {
    const f = fixture({ unexpectedAt });
    const result = f.run('Chile');
    assert.equal(result.estado, 'error');
    assert.equal(result.error.codigo, 'SELECTOR_UNEXPECTED');
    assert.equal(result.datosUtilizables, false);
    assert.deepEqual(f.writes, unexpectedAt < 6 ? [] : ['Chile', 'Argentina']);
    assert.deepEqual(result.semanas, []);
    assert.ok(f.released());
    if (unexpectedAt >= 6) assert.equal(result.selector.restaurado, 'Argentina');
  }
});

test('restored selector mismatch is reported and demands manual restoration', () => {
  // 14 = the restoration verification read, the last selector read of the run.
  const f = fixture({ unexpectedAt: 14 });
  const result = f.run('Chile');
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'SELECTOR_UNEXPECTED');
  assert.equal(result.error.requiereRestauracionManual, true);
  assert.equal(result.error.restauracionCodigo, 'SELECTOR_UNEXPECTED');
  assert.equal(result.error.liberacionCodigo, null);
  assert.equal(result.selector.restaurado, null);
  assert.equal(result.selector.restauracionVerificada, false);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.ok(f.released());
});

test('failure after possible edit restores original and keeps separate error codes', () => {
  for (const failure of ['writeFailure', 'flushFailure', 'pollFailure']) {
    const f = fixture({ [failure]: true });
    const result = f.run('Chile');
    assert.equal(result.estado, 'error');
    assert.equal(result.error.codigo, 'SELECTOR_SERVICE_ERROR');
    assert.equal(result.error.requiereRestauracionManual, false);
    assert.equal(result.selector.restaurado, 'Argentina');
    assert.equal(result.selector.restauracionVerificada, true);
    assert.deepEqual(f.writes, ['Chile', 'Argentina']);
    assert.equal(f.selector(), 'Argentina');
    assert.ok(f.released());
    assert.doesNotMatch(f.logs.join(''), /PRIVATE/);
  }
});

test('restore and release failures still release the lock and require manual restoration', () => {
  const f = fixture({ pollFailure: true, restoreFailure: true, releaseFailure: true });
  const result = f.run('Chile');
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'SELECTOR_SERVICE_ERROR');
  assert.equal(result.error.requiereRestauracionManual, true);
  assert.equal(result.error.restauracionCodigo, 'SELECTOR_SERVICE_ERROR');
  assert.equal(result.error.liberacionCodigo, 'SELECTOR_SERVICE_ERROR');
  assert.equal(result.selector.restaurado, null);
  assert.equal(result.selector.restauracionVerificada, false);
  assert.ok(f.released());
});

for (const [options, code, expected] of [
  [{ validation: 'VALUE_IN_LIST' }, null, 'ok'],
  [{ validation: 'VALUE_IN_RANGE', manual: ['Chile'] }, null, 'ok'],
  [{ validation: 'NONE', manual: ['Chile'] }, null, 'ok'],
  [{ validation: 'VALUE_IN_RANGE' }, 'SELECTOR_COUNTRY_NOT_ALLOWED', 'error'],
  [{ validation: 'CUSTOM_FORMULA' }, 'SELECTOR_VALIDATION', 'error']
]) {
  test(`validation ${JSON.stringify(options)} ${code ? 'fails closed' : 'passes'}`, () => {
    const f = fixture(options);
    const result = f.run('Chile');
    if (code) {
      assert.equal(result.error.codigo, code);
      assert.deepEqual(f.writes, []);
      assert.equal(result.estado, 'error');
    } else {
      assert.equal(result.estado, expected);
      assert.deepEqual(f.writes, ['Chile', 'Argentina']);
    }
    assert.ok(!f.events.includes('criteriaValues') || options.validation !== 'VALUE_IN_RANGE');
    assert.ok(f.released());
  });
}

test('literal validation rejects a country outside the exact list before any write', () => {
  const f = fixture();
  const result = f.run('chile');
  assert.equal(result.error.codigo, 'SELECTOR_COUNTRY_NOT_ALLOWED');
  assert.deepEqual(f.writes, []);
  assert.deepEqual(result.semanas, []);
});

test('probar without a configured test country fails clearly with one bounded log', () => {
  const f = fixture();
  const result = f.runProbar();
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'SELECTOR_TEST_COUNTRY_NOT_CONFIGURED');
  assert.equal(result.datosUtilizables, false);
  assert.equal(f.logs.length, 1);
  assert.ok(f.logs[0].length < 600);
  assert.doesNotMatch(f.logs[0], /Private name|#N\/A|formulas/);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.writes, []);
});

test('probar with a configured country runs the full reading and logs a bounded summary', () => {
  const f = fixture({ testCountry: 'Chile' });
  const result = f.runProbar();
  assert.equal(result.estado, 'ok');
  assert.equal(result.semanas.length, 9);
  assert.equal(result.columnasAdicionales.length, 4);
  assert.equal(result.filas.length, 6);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(f.logs.length, 1);
  assert.ok(f.logs[0].length < 600);
  assert.doesNotMatch(f.logs[0], /Private name|#N\/A|formulas/);
  assert.match(f.logs[0], /"columnasAdicionales":4/);
  assert.match(f.logs[0], /"selectorRestaurado":"Argentina"/);
});

// Corrections round (T4-T9): regression scenarios from the task document.
test('R1: always-different captures never reach datosUtilizables for either path', () => {
  const f = fixture({ changing: true });
  const result = f.run('Chile');
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'LECTURA_SIN_ESTABILIDAD');
  assert.equal(result.datosUtilizables, false);
  assert.equal(result.lectura.estableObservada, false);
  assert.equal(result.lectura.intentos, 5);
  assert.deepEqual(result.semanas, []);
  assert.deepEqual(result.filas, []);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(f.selector(), 'Argentina');
  assert.ok(f.released());
  const g = fixture({ changing: true });
  const already = g.run('Argentina');
  assert.equal(already.error.codigo, 'LECTURA_SIN_ESTABILIDAD');
  assert.equal(already.datosUtilizables, false);
  assert.equal(already.lectura.intentos, 5);
  assert.deepEqual(g.writes, []);
  assert.ok(g.released());
});

test('R2: captures that later stabilize return the last stable capture', () => {
  const f = fixture({ mutations: 2 });
  const result = f.run('Chile');
  assert.equal(result.estado, 'ok');
  assert.equal(result.datosUtilizables, true);
  assert.equal(result.lectura.estableObservada, true);
  assert.equal(result.lectura.intentos, 3);
  assert.equal(result.lectura.duracionMs, 2000);
  // r1=92, r2=93, r3=93: the stable pair is r2/r3, so the returned capture is r3.
  assert.equal(result.filas[3].observaciones['2026-09-28'].valor, 93);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(f.selector(), 'Argentina');
  assert.equal(result.selector.restauracionVerificada, true);
  assert.ok(f.released());
});

test('R3: already-selected country keeps the same waiting and stability control without a write', () => {
  const f = fixture();
  const result = f.run('Argentina');
  assert.equal(result.estado, 'ok');
  assert.equal(result.lectura.intentos, 2);
  assert.equal(result.lectura.duracionMs, 1000);
  assert.equal(f.events.filter(event => event.startsWith('sleep:')).length, 1);
  assert.deepEqual(f.writes, []);
  assert.equal(result.selector.escrita, null);
  assert.equal(result.selector.restaurado, null);
  assert.equal(result.selector.restauracionVerificada, false);
  assert.equal(result.filas[3].observaciones['2026-09-28'].valor, 7);
  assert.ok(f.released());
  // An always-changing already-selected country also fails closed without writes.
  const g = fixture({ changing: true });
  const already = g.run('Argentina');
  assert.equal(already.error.codigo, 'LECTURA_SIN_ESTABILIDAD');
  assert.equal(already.datosUtilizables, false);
  assert.deepEqual(g.writes, []);
  assert.ok(g.released());
});

test('R4: document zone different from Buenos Aires keeps sheetDate and the Buenos Aires closed week', () => {
  const f = fixture({ zone: 'America/Santiago' });
  const result = f.run('Chile');
  assert.equal(result.estado, 'ok');
  assert.deepEqual(result.semanas.map(week => week.fechaLocal),
    ['2026-09-06', '2026-09-07', '2026-09-13', '2026-09-20', '2026-09-27',
      '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  assert.equal(result.origen.zonaHorariaDocumento, 'America/Santiago');
  assert.equal(result.lectura.zonaHorariaSemanaCerrada, 'America/Argentina/Buenos_Aires');
  assert.equal(result.calidad.ultimaSemanaCerradaEsperada, '2026-09-07');
  assert.equal(result.calidad.semanaCerradaEsperadaPresente, true);
  // The observation for the last local date M8 still keys on the local sheetDate.
  assert.equal(result.filas[3].observaciones['2026-09-27'].valor, 99);
  assert.ok(f.released());
});

test('R5: LATAM requested with plain indicator names is classified as the LATAM entity', () => {
  const f = fixture({ list: ['Argentina', 'Chile', 'LATAM'] });
  const result = f.run('LATAM');
  assert.equal(result.estado, 'ok');
  assert.deepEqual(result.entidad, { nombre: 'LATAM', tipo: 'LATAM' });
  assert.ok(result.advertencias.some(text => /regional LATAM aggregate/.test(text)));
  assert.ok(result.filas.every(fila => fila.esLATAM === undefined));
  assert.equal(result.calidad.latamSeparada, undefined);
  assert.equal(result.filas[4].nombre, 'Private name 10');
  assert.deepEqual(f.writes, ['LATAM', 'Argentina']);
  assert.ok(f.released());
});

test('R6: a country request with a LATAM-named indicator keeps entity country and no LATAM warning', () => {
  const f = fixture({ latamName: true });
  const result = f.run('Chile');
  assert.equal(result.estado, 'ok');
  assert.deepEqual(result.entidad, { nombre: 'Chile', tipo: 'pais' });
  assert.equal(result.filas[4].nombre, 'LATAM Private 10');
  assert.ok(!result.advertencias.some(text => /regional LATAM aggregate/.test(text)));
  assert.ok(f.released());
});

test('R7: headers present with an empty body never claim data availability', () => {
  const f = fixture({ emptyBody: true });
  const result = f.run('Chile');
  assert.equal(result.estado, 'ok');
  assert.equal(result.calidad.semanasDeclaradas, 9);
  assert.equal(result.calidad.semanaCerradaEsperadaPresente, true);
  assert.equal(result.calidad.semanasConObservacionesNumericas, 0);
  assert.ok(result.advertencias.some(text => /present but has no numeric observations/.test(text)));
  assert.ok(!result.advertencias.some(text => /does not certify complete load/.test(text)));
  assert.ok(result.filas.every(fila => fila.observaciones !== undefined));
  assert.ok(f.released());
});

test('R8: real numeric zero counts as observed; empties and text zeros never count', () => {
  const result = fixture().run('Chile');
  const obs = result.filas[3].observaciones;
  assert.equal(obs['2026-09-07'].estado, 'cero');
  assert.equal(obs['2026-09-07'].valor, 0);
  assert.equal(obs['2026-09-08'].estado, 'vacio');
  assert.equal(obs['2026-09-08'].valor, null);
  assert.equal(obs['2026-09-14'].estado, 'errorOrText');
  assert.equal(obs['2026-09-21'].estado, 'texto');
  assert.equal(obs['2026-09-21'].valor, '0');
  // Exactly two weeks count: 2026-09-07 (cero) and 2026-09-28 (numero).
  // If zeros were excluded, or empties/text/errors included, this would differ.
  assert.equal(result.calidad.semanasConObservacionesNumericas, 2);
  assert.ok(result.filas.filter(fila => fila.fila !== 8)
    .every(fila => fila.observaciones['2026-09-08'].valor === null));
});

test('R9: timeout and restore failure never yield usable data and always restore/release', () => {
  const f = fixture({ changing: true, deadlineMs: 1500 });
  const result = f.run('Chile');
  assert.equal(result.error.codigo, 'SELECTOR_DEADLINE');
  assert.equal(result.estado, 'error');
  assert.equal(result.datosUtilizables, false);
  // One full capture plus the second initiated capture are counted.
  assert.equal(result.lectura.intentos, 2);
  assert.equal(result.selector.restaurado, 'Argentina');
  assert.equal(result.selector.restauracionVerificada, true);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(f.selector(), 'Argentina');
  assert.ok(f.released());
  const g = fixture({ restoreFailure: true });
  const again = g.run('Chile');
  assert.equal(again.estado, 'error');
  assert.equal(again.datosUtilizables, false);
  assert.equal(again.error.requiereRestauracionManual, true);
  assert.equal(again.error.restauracionCodigo, 'SELECTOR_SERVICE_ERROR');
  assert.deepEqual(again.semanas, []);
  assert.deepEqual(again.filas, []);
  assert.ok(g.released());
});

// Additional-columns round (schema v3): the required scenarios.
test('v3: nine weekly dates and four known additional columns are separated', () => {
  const result = fixture().run('Chile');
  assert.equal(result.schemaVersion, 'weekly-lectura/3');
  assert.equal(result.semanas.length, 9);
  assert.equal(result.columnasAdicionales.length, 4);
  assert.ok(result.semanas.every(week => week.fechaLocal !== null && week.ambigua === false));
  assert.deepEqual(result.columnasAdicionales.map(column => column.celda), ['R8', 'S8', 'T8', 'V8']);
  assert.deepEqual(result.columnasAdicionales.map(column => column.columna), [18, 19, 20, 22]);
  assert.deepEqual(result.columnasAdicionales.map(column => column.clasificacion),
    ['wow', 'vs-w4', 'vs-w8', 'bench-entre-mercados']);
  assert.deepEqual(result.columnasAdicionales.map(column => column.etiquetaOriginal),
    ['WoW', 'vs. W-4', 'vs. W-8', 'Bench entre\nmercados']);
  assert.deepEqual(result.columnasAdicionales.map(column => column.etiquetaNormalizada),
    ['wow', 'vs w-4', 'vs w-8', 'bench entre mercados']);
  assert.ok(result.columnasAdicionales.every(column => column.interpretacionValidada === false));
  // The label never fixes a position: no formula/unit/direction/period is inferred.
  assert.ok(!/formula|unidad|sentidoFavorable|periodo/i.test(JSON.stringify(
    result.columnasAdicionales.map(column => Object.keys(column)))));
});

test('v3: relocated additional columns are still classified by normalized label', () => {
  const result = fixture({ relocatedAdditional: true }).run('Chile');
  assert.equal(result.semanas.length, 9);
  assert.equal(result.columnasAdicionales.length, 4);
  assert.deepEqual(result.columnasAdicionales.map(column => column.celda), ['X8', 'Y8', 'Z8', 'AB8']);
  assert.deepEqual(result.columnasAdicionales.map(column => column.clasificacion),
    ['wow', 'vs-w4', 'vs-w8', 'bench-entre-mercados']);
  assert.equal(result.columnasAdicionales[3].etiquetaNormalizada, 'bench entre mercados');
  assert.equal(result.filas[3].adicionales['bench-entre-mercados'].coordenada, 'AB9');
  assert.ok(!result.semanas.some(week => ['X8', 'Y8', 'Z8', 'AB8'].includes(week.celda)));
});

test('v3: an unknown non-date header stays ambiguous outside weeks and additional columns', () => {
  const result = fixture().run('Chile');
  assert.deepEqual(result.calidad.encabezadosAmbiguos, [{ celda: 'W8', textoMostrado: 'Misterio' }]);
  assert.ok(!result.semanas.some(week => week.celda === 'W8'));
  assert.ok(!result.columnasAdicionales.some(column => column.celda === 'W8'));
  assert.ok(result.advertencias.some(text => /remain ambiguous outside semanas/.test(text)));
  assert.ok(result.advertencias.some(text => /interpretacionValidada:false/.test(text)));
});

test('v3: additional values are captured before restoration and take part in stability', () => {
  // Typed preservation from the same pre-restoration capture: zero, empty,
  // errorOrText and text are never converted to zero.
  const base = fixture().run('Chile');
  const fila = base.filas[3];
  assert.equal(fila.adicionales['wow'].coordenada, 'R9');
  assert.equal(fila.adicionales['wow'].valor, 0);
  assert.equal(fila.adicionales['wow'].estado, 'cero');
  assert.equal(fila.adicionales['vs-w4'].estado, 'vacio');
  assert.equal(fila.adicionales['vs-w4'].valor, null);
  assert.equal(fila.adicionales['vs-w8'].estado, 'errorOrText');
  assert.equal(fila.adicionales['vs-w8'].valor, '#N/A');
  assert.equal(fila.adicionales['bench-entre-mercados'].estado, 'texto');
  assert.equal(fila.adicionales['bench-entre-mercados'].valor, 'texto');
  // Values belong to the capture taken BEFORE restoration: the simulated
  // post-write recalculation is visible while H4 is already back to Argentina.
  const recalc = fixture({ additionalRecalc: true }).run('Chile');
  assert.equal(recalc.selector.restaurado, 'Argentina');
  assert.equal(recalc.filas[3].adicionales['wow'].valor, 55);
  // An always-changing additional cell makes the capture unstable: the extra
  // columns are part of the stability comparison, not read after the fact.
  const unstable = fixture({ additionalChanging: true }).run('Chile');
  assert.equal(unstable.error.codigo, 'LECTURA_SIN_ESTABILIDAD');
  assert.equal(unstable.datosUtilizables, false);
  assert.equal(unstable.selector.restaurado, 'Argentina');
});

test('v3: numbers at or above headerRow never count with an empty body', () => {
  const f = fixture({ emptyBody: true, numberAboveHeader: true });
  const result = f.run('Chile');
  assert.equal(result.estado, 'ok');
  assert.equal(result.calidad.semanasDeclaradas, 9);
  assert.equal(result.calidad.semanasConObservacionesNumericas, 0);
  assert.ok(result.advertencias.some(text => /present but has no numeric observations/.test(text)));
  // The row above the header stays in the inventory with its observed number,
  // but it never supports the availability count.
  assert.ok(result.filas.some(fila => fila.fila === 2 &&
    fila.observaciones['2026-09-07'].valor === 5));
  assert.ok(f.released());
});

test('v3: a timeout after initiated captures keeps the counter and still restores', () => {
  const f = fixture({ timeWarpAtCandidateBatch: 1200 });
  const result = f.run('Chile');
  assert.equal(result.error.codigo, 'SELECTOR_DEADLINE');
  assert.equal(result.estado, 'error');
  assert.equal(result.datosUtilizables, false);
  // The first observation-loop capture was initiated before the deadline hit.
  assert.equal(result.lectura.intentos, 1);
  assert.deepEqual(result.semanas, []);
  assert.deepEqual(result.columnasAdicionales, []);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(result.selector.restaurado, 'Argentina');
  assert.equal(result.selector.restauracionVerificada, true);
  assert.ok(f.released());
});

test('v3: a selector change during the additional-column readings invalidates the capture', () => {
  const f = fixture({ additionalSelectorChange: true });
  const result = f.run('Chile');
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'SELECTOR_UNEXPECTED');
  assert.equal(result.datosUtilizables, false);
  // weeklySelectorSnapshot_ already verified the selector before the additional
  // block, so only the added control read can detect this change.
  assert.equal(result.lectura.intentos, 1);
  assert.deepEqual(result.semanas, []);
  assert.deepEqual(result.columnasAdicionales, []);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(result.selector.restaurado, 'Argentina');
  assert.equal(result.selector.restauracionVerificada, true);
  assert.ok(f.released());
});

test('v3: a deadline exhausted between the additional-column readings fails closed', () => {
  const f = fixture({ additionalDeadline: 20000 });
  const result = f.run('Chile');
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'SELECTOR_DEADLINE');
  assert.equal(result.datosUtilizables, false);
  assert.equal(result.lectura.intentos, 1);
  assert.deepEqual(result.semanas, []);
  assert.deepEqual(result.columnasAdicionales, []);
  // The breach is detected between two additional readings of the observation
  // capture: the baseline read its four columns and the failing capture stopped
  // after the first one, so no value of the remaining columns was ever read.
  assert.deepEqual(f.events.filter(event => /^range:1,(18|19|20|22),11,1$/.test(event)),
    ['range:1,18,11,1', 'range:1,19,11,1', 'range:1,20,11,1', 'range:1,22,11,1', 'range:1,18,11,1']);
  assert.deepEqual(f.writes, ['Chile', 'Argentina']);
  assert.equal(result.selector.restaurado, 'Argentina');
  assert.equal(result.selector.restauracionVerificada, true);
  assert.ok(f.released());
});

test('v3: the additional block is bracketed by budgeted selector controls', () => {
  const f = fixture();
  const result = f.run('Chile');
  assert.equal(result.estado, 'ok');
  const wanted = f.events.filter(event => event === 'range:4,8,1,1' ||
    /^range:1,(18|19|20|22),11,1$/.test(event));
  // Four selector reads per capture (open, close, control before the additional
  // block, control after it) for the baseline plus the two observation captures,
  // one original-country read and one restoration verification read.
  assert.equal(wanted.filter(event => event === 'range:4,8,1,1').length, 14);
  assert.deepEqual(wanted.slice(0, 9), ['range:4,8,1,1',
    'range:4,8,1,1', 'range:4,8,1,1', 'range:4,8,1,1',
    'range:1,18,11,1', 'range:1,19,11,1', 'range:1,20,11,1', 'range:1,22,11,1',
    'range:4,8,1,1']);
  // Every control is a real read, so it consumes the shared budget: the whole
  // run fits in exactly the derived cost and one cell less is refused, which
  // only holds while those reads are accounted for.
  const spent = f.events.filter(event => /^range:/.test(event)).reduce((total, event) => {
    const [row, column, height, width] = event.slice('range:'.length).split(',').map(Number);
    return total + height * width * 4;
  }, 1); // + 1 for the H4 data-validation read.
  const exact = fixture({ totalReadBudget: spent });
  assert.equal(exact.run('Chile').estado, 'ok');
  assert.ok(exact.released());
  assert.equal(fixture({ totalReadBudget: spent - 1 }).run('Chile').error.codigo, 'SELECTOR_READ_BUDGET');
});
