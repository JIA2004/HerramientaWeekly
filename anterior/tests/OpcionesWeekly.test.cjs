const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'DiagnosticoSheets.gs'), 'utf8');
const selector = fs.readFileSync(path.join(root, 'PruebaSelector.gs'), 'utf8');
const reader = fs.readFileSync(path.join(root, 'LectorWeekly.gs'), 'utf8');
const source = fs.readFileSync(path.join(root, 'OpcionesWeekly.gs'), 'utf8');

test('normalization: touched scripts, tests and guides use LF without BOM or trailing whitespace', () => {
  for (const name of ['DiagnosticoSheets.gs', 'PruebaSelector.gs', 'LectorWeekly.gs', 'OpcionesWeekly.gs',
    'Index.txt', 'DIAGNOSTICO_SHEETS.md', 'PRUEBA_SELECTOR.md', 'LECTOR_WEEKLY.md',
    'CONSULTA_WEEKLY.md', '../BITACORA.md',
    'tests/DiagnosticoSheets.test.cjs', 'tests/PruebaSelector.test.cjs', 'tests/LectorWeekly.test.cjs',
    'tests/OpcionesWeekly.test.cjs', 'tests/Index.test.cjs',
    'odd/tasks/webapp-selector-experiment.md', 'odd/tasks/weekly-reader-pilot.md',
    'odd/tasks/weekly-reader-additional-columns.md', 'odd/tasks/weekly-consulta-frontend.md']) {
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
  const events = [];
  const rule = options.validation === 'NONE' ? null : allow({
    getCriteriaType: () => options.validation || 'VALUE_IN_LIST',
    getCriteriaValues: () => {
      events.push('criteriaValues');
      assert.notEqual(options.validation, 'VALUE_IN_RANGE', 'Range criteria must never be inspected');
      return [options.list || ['Argentina', 'Chile'], true];
    }
  });
  const sheet = allow({
    getName: () => options.tab || 'WebApp',
    getRange: (...args) => {
      assert.deepEqual(args, ['H4'], 'Only the H4 validation rule may be read');
      return allow({ getDataValidation: () => rule });
    }
  });
  const context = vm.createContext({
    __sheet: sheet,
    Date: Date,
    SpreadsheetApp: allow({
      openById: id => {
        assert.equal(id, '1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk');
        return allow({
          getSheetByName: name => { assert.equal(name, 'WebApp'); return sheet; },
          getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires'
        });
      }
    }),
    console: allow({ log: () => {} })
  });
  // No LockService, no flush and no body API is provided: the options endpoint
  // must work without a lock and without reading or writing sheet content.
  let configured = shared;
  if (options.tab) configured = configured.replace("tabName: 'WebApp'", `tabName: ${JSON.stringify(options.tab)}`);
  configured = configured.replace('manualCountryAllowlist: Object.freeze([])',
    `manualCountryAllowlist: Object.freeze(${JSON.stringify(options.manual || [])})`);
  vm.runInContext(configured + '\n' + selector + '\n' + reader + '\n' + source, context, { timeout: 1000 });
  return {
    run: () => JSON.parse(JSON.stringify(vm.runInContext('obtenerOpcionesWeekly()', context,
      { timeout: 2000 }))),
    probe: pais => JSON.parse(JSON.stringify(vm.runInContext(`(function () {
      const pais = ${JSON.stringify(pais)};
      let aceptado = weeklySelectorLiteral_(pais);
      if (aceptado) {
        try {
          weeklySelectorValidation_(__sheet, { testCountry: pais,
            manualCountryAllowlist: weeklyDiagnosticConfig_.experiment.manualCountryAllowlist },
            { used: 0, limit: 1000, reserve: 4 });
        } catch (error) { aceptado = false; }
      }
      return { aceptado: aceptado, tipo: weeklyLecturaEntidad_(pais).tipo };
    })()`, context, { timeout: 2000 }))),
    // The reader's own pre-lock guard: proves which values would be refused.
    // It answers with an error code instead of throwing.
    readerError: pais => {
      const salida = vm.runInContext(
        `JSON.stringify(leerWeeklyPorPais(${JSON.stringify(pais)}))`, context, { timeout: 2000 });
      const data = JSON.parse(salida);
      return data.error ? data.error.codigo : null;
    },
    context: context,
    sheet: sheet,
    events: events
  };
}

test('static isolation: one public entry, no body, no lock, no write and no remote API', () => {
  assert.deepEqual([...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1])
    .filter(name => !name.endsWith('_')), ['obtenerOpcionesWeekly']);
  assert.ok([...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1])
    .filter(name => name.endsWith('_')).every(name => /^weeklyOpciones.*_$/.test(name)));
  assert.doesNotMatch(source, /\b(BigQuery|UrlFetchApp|ScriptApp|HtmlService|DriveApp|PropertiesService|LockService|fetch)\b/);
  assert.doesNotMatch(source, /\.(setValue|setValues|setFormula\w*|clear\w*|getLastRow|getLastColumn|getSheets|getActive\w*)\s*\(/);
  assert.doesNotMatch(source, /probarSelectorWebApp|diagnosticarWeeklySheets|leerWeeklyPorPais|probarLectorWeekly/);
});

test('a literal validation list is offered as-is with its reader entity type', () => {
  const f = fixture({ list: ['Argentina', 'Chile', 'LATAM'] });
  const result = f.run();
  assert.equal(result.schemaVersion, 'weekly-opciones/1');
  assert.equal(result.estado, 'ok');
  assert.equal(result.fuente, 'VALUE_IN_LIST');
  assert.deepEqual(result.opciones, [{ nombre: 'Argentina', tipo: 'pais' },
    { nombre: 'Chile', tipo: 'pais' }, { nombre: 'LATAM', tipo: 'LATAM' }]);
  assert.equal(result.total, 3);
  assert.equal(result.error, null);
  assert.deepEqual(result.origen.coordenada, 'H4');
  assert.deepEqual(f.events, ['criteriaValues']);
});

test('every offered option is accepted by the reader validation and shares its entity type', () => {
  const f = fixture({ list: ['Argentina', 'Chile', 'LATAM'] });
  const result = f.run();
  for (const opcion of result.opciones) {
    const probe = f.probe(opcion.nombre);
    assert.equal(probe.aceptado, true, `${opcion.nombre} must be accepted by the reader`);
    assert.equal(opcion.tipo, probe.tipo, `${opcion.nombre} type must match the reader`);
  }
  const g = fixture({ list: ['Argentina', 'Chile'] });
  for (const opcion of g.run().opciones) assert.equal(g.probe(opcion.nombre).aceptado, true);
});

test('the manual allowlist narrows the literal list to the intersection', () => {
  const f = fixture({ list: ['Argentina', 'Chile', 'Brasil'], manual: ['Chile'] });
  const result = f.run();
  assert.equal(result.fuente, 'VALUE_IN_LIST');
  assert.deepEqual(result.opciones, [{ nombre: 'Chile', tipo: 'pais' }]);
  assert.equal(result.total, 1);
  assert.equal(f.probe('Chile').aceptado, true);
  assert.equal(f.probe('Argentina').aceptado, false);
});

test('range or absent validation falls back to the manual list without reading the range', () => {
  for (const validation of ['VALUE_IN_RANGE', 'NONE']) {
    const f = fixture({ validation: validation, manual: ['Chile'] });
    const result = f.run();
    assert.equal(result.estado, 'ok');
    assert.equal(result.fuente, 'LISTA_MANUAL');
    assert.deepEqual(result.opciones, [{ nombre: 'Chile', tipo: 'pais' }]);
    assert.deepEqual(f.events, []);
  }
  const empty = fixture({ validation: 'VALUE_IN_RANGE' });
  const result = empty.run();
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'SELECTOR_OPTIONS_EMPTY');
  assert.deepEqual(result.opciones, []);
  assert.equal(result.total, 0);
});

test('an unsupported criteria fails closed with a code and no options', () => {
  const f = fixture({ validation: 'CUSTOM_FORMULA' });
  const result = f.run();
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'SELECTOR_VALIDATION');
  assert.deepEqual(result.opciones, []);
  assert.equal(result.fuente, null);
  assert.equal(result.total, 0);
  assert.equal(f.probe('Chile').aceptado, false);
});

test('unsafe literals and duplicates are left out with an explicit warning', () => {
  const f = fixture({ list: ['Chile', 'Chile', '=SUM(1)', '@import', 'Chile'] });
  const result = f.run();
  assert.equal(result.estado, 'ok');
  assert.deepEqual(result.opciones, [{ nombre: 'Chile', tipo: 'pais' }]);
  assert.ok(result.advertencias.some(text => /not safe literal/.test(text)));
  assert.ok(result.advertencias.some(text => /duplicated configured option/.test(text)));
  assert.equal(f.probe('Chile').aceptado, true);
  assert.equal(f.probe('=SUM(1)').aceptado, false);
});

test('blank or whitespace-only configured options are never offered and valid names stay exact', () => {
  const f = fixture({ list: ['Chile', '', '   ', ' Costa Rica ', 'Argentina'] });
  const result = f.run();
  assert.equal(result.estado, 'ok');
  assert.deepEqual(result.opciones, [{ nombre: 'Chile', tipo: 'pais' },
    { nombre: ' Costa Rica ', tipo: 'pais' }, { nombre: 'Argentina', tipo: 'pais' }]);
  assert.equal(result.total, 3);
  const aviso = result.advertencias.filter(texto => /empty or only whitespace/.test(texto));
  assert.equal(aviso.length, 1);
  assert.match(aviso[0], /^2 configured option/);
  assert.ok(!result.advertencias.some(texto => /duplicated configured option/.test(texto)));
  // The excluded values are exactly the ones the reader refuses before it locks.
  assert.equal(f.readerError(''), 'SELECTOR_COUNTRY_BLANK');
  assert.equal(f.readerError('   '), 'SELECTOR_COUNTRY_BLANK');
  // A valid name is offered verbatim, so the reader's own validation accepts it.
  assert.equal(f.probe(' Costa Rica ').aceptado, true);
});

test('the envelope never claims verified data and is stable across runs', () => {
  const f = fixture({ list: ['Argentina', 'Chile'] });
  const result = f.run();
  assert.equal(result.alcance, 'solo_validacion_selector');
  assert.deepEqual(result.verificacion, { lectura: 'no_verificada', completitud: 'no_verificada',
    correspondenciaPaisDatos: 'no_verificada' });
  assert.ok(result.advertencias.length >= 3);
  assert.match(result.inicioIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(result.finIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.ok(Number.isSafeInteger(result.duracionMs) && result.duracionMs >= 0);
  const again = fixture({ list: ['Argentina', 'Chile'] }).run();
  assert.deepEqual(again.opciones, result.opciones);
  assert.deepEqual(again.advertencias, result.advertencias);
});

test('only the H4 validation is reachable: no body read, no lock and no write', () => {
  const f = fixture({ list: ['Chile'] });
  const result = f.run();
  assert.equal(result.estado, 'ok');
  // The endpoint ran without LockService being available at all.
  assert.equal(vm.runInContext('typeof LockService', f.context), 'undefined');
  assert.ok(!Object.hasOwn(f.sheet, 'getLastRow'));
  assert.ok(!Object.hasOwn(f.sheet, 'getDataValidation'));
  assert.throws(() => vm.runInContext('__sheet.getLastRow()', f.context), /Forbidden API/);
  assert.throws(() => vm.runInContext('__sheet.getRange(1, 1, 1, 1)', f.context), /Only the H4/);
  assert.throws(() => vm.runInContext('__sheet.getRange("H4").setValue("Chile")', f.context),
    /Forbidden API|Only the H4/);
});

test('a wrong destination fails before any option is offered', () => {
  const f = fixture({ tab: '2) Weekly por pais', list: ['Chile'] });
  const result = f.run();
  assert.equal(result.estado, 'error');
  assert.equal(result.error.codigo, 'SELECTOR_DESTINATION');
  assert.deepEqual(result.opciones, []);
  assert.deepEqual(f.events, []);
});
