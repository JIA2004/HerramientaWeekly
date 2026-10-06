const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const REGISTRO = 'Weekly_Tool_Registro';
const KPIS = '2) Weekly por pais';
const DATOS = '[Extract] Tabla Weekly';

const SUMIFS = fila => `=IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C${fila}, X!$1:$1, 0)), X!$A:$A, M$6), "")`;
const LUNES = i => new Date(Date.UTC(2026, 0, 5 + i * 7, 3));
const iso = fecha => fecha.toISOString().slice(0, 10);

function hojaKpis() {
  const valores = [];
  const formulas = [];
  const pone = (fila, col, valor, formula) => {
    while (valores.length < fila) { valores.push(new Array(16).fill('')); formulas.push(new Array(16).fill('')); }
    valores[fila - 1][col] = valor;
    if (formula) formulas[fila - 1][col] = formula;
  };
  pone(6, 3, 'KPI');
  for (let i = 0; i < 9; i++) pone(6, 4 + i, LUNES(31 + i));
  pone(6, 14, 'WoW');
  pone(8, 3, 'Overall');
  pone(9, 1, 1); pone(9, 2, 'orders'); pone(9, 3, 'Orders'); pone(9, 12, 1, SUMIFS(9)); pone(9, 14, 0, '=M9/L9-1');
  pone(11, 1, -1); pone(11, 2, 'fail_rate'); pone(11, 3, 'Fail Rate'); pone(11, 12, 1, SUMIFS(11)); pone(11, 14, 0, '=(M11-L11)*100');
  return { valores, formulas };
}

// semanas: how many weeks the extract holds; ajuste edits the last week's rows.
function hojaDatos(semanas, ajuste) {
  const valores = [['week_date', 'country_id', 'country_name', 'orders', 'fail_rate', 'last_update']];
  const ultimas = {};
  ['Argentina', 'Chile'].forEach((pais, k) => {
    for (let i = 0; i < semanas; i++) {
      const fila = [LUNES(i), k + 1, pais, Math.round(10000 * (1 + Math.sin(i * 1.7 + k) * 0.01)),
        0.02 + Math.sin(i + k) * 0.0005, new Date(Date.UTC(2026, 9, 5, 18))];
      valores.push(fila);
      ultimas[pais] = fila;
    }
  });
  if (ajuste) ajuste(ultimas);
  return { valores, formulas: [] };
}

function estricto(metodos, nombre) {
  return new Proxy(metodos, {
    get(objetivo, clave) {
      if (typeof clave === 'symbol' || clave === 'then' || clave === 'toJSON') return undefined;
      assert.ok(Object.hasOwn(objetivo, clave), `Forbidden API on ${nombre}: ${String(clave)}`);
      return objetivo[clave];
    }
  });
}

// In-memory spreadsheet. Source tabs expose read methods only, so any write to
// them fails the test; only the registry tab accepts writes, and all are logged.
function mundo(fuentes, hoyIso) {
  const estado = { registro: null, escrituras: [], lecturasFuente: 0, lock: { tomado: 0, liberado: 0 }, ocupado: false };
  const hojaRegistro = () => estricto({
    getName: () => REGISTRO,
    getLastRow: () => estado.registro.length,
    setFrozenRows: n => estado.escrituras.push('frozen:' + n),
    getRange: (fila, col, filas, columnas) => estricto({
      getValues: () => {
        const salida = [];
        for (let f = 0; f < filas; f++) {
          const origen = estado.registro[fila - 1 + f] || [];
          const linea = [];
          for (let c = 0; c < columnas; c++) linea.push(origen[col - 1 + c] === undefined ? '' : origen[col - 1 + c]);
          salida.push(linea);
        }
        return salida;
      },
      setNumberFormat: formato => estado.escrituras.push('formato:' + formato + '@fila' + fila),
      setValues: valores => {
        estado.escrituras.push('setValues@fila' + fila);
        valores.forEach((linea, f) => {
          const destino = estado.registro[fila - 1 + f] = estado.registro[fila - 1 + f] || [];
          linea.forEach((valor, c) => { destino[col - 1 + c] = valor; });
        });
      },
      clearContent: () => {
        estado.escrituras.push('clear@fila' + fila);
        const destino = estado.registro[fila - 1];
        for (let c = 0; c < columnas; c++) destino[col - 1 + c] = '';
      }
    }, 'registry range')
  }, 'registry sheet');
  const hojaFuente = datos => estricto({ getDataRange: () => estricto({
    getNumRows: () => datos.valores.length, getNumColumns: () => datos.valores[0].length,
    getValues: () => { estado.lecturasFuente++; return datos.valores; },
    getFormulas: () => datos.formulas }, 'source range') }, 'source sheet');
  const documento = estricto({
    getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires',
    getName: () => 'Libro',
    getSheets: () => [],
    getSheetByName: nombre => {
      if (nombre === REGISTRO) return estado.registro ? hojaRegistro() : null;
      return fuentes[nombre] ? hojaFuente(fuentes[nombre]) : null;
    },
    insertSheet: nombre => {
      assert.equal(nombre, REGISTRO, 'only the registry tab may be created');
      estado.escrituras.push('insertSheet');
      estado.registro = [];
      return hojaRegistro();
    }
  }, 'spreadsheet');
  const RealDate = Date;
  class FechaFija extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(hoyIso + 'T15:00:00Z'); }
  }
  const ctx = vm.createContext({
    Date: FechaFija,
    SpreadsheetApp: estricto({ openById: () => documento }, 'SpreadsheetApp'),
    Utilities: estricto({ formatDate: (fecha, zona) => new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(fecha) }, 'Utilities'),
    LockService: estricto({ getScriptLock: () => estricto({
      tryLock: () => { if (estado.ocupado) return false; estado.lock.tomado++; return true; },
      releaseLock: () => { estado.lock.liberado++; } }, 'lock') }, 'LockService')
  });
  ['MotorWeekly.gs', 'ResumenWeekly.gs', 'FuenteWeekly.gs', 'RegistroWeekly.gs'].forEach(nombre => {
    vm.runInContext(fs.readFileSync(path.join(root, nombre), 'utf8'), ctx, { filename: nombre });
  });
  return { ctx, estado, fuentes };
}

const hoyPara = semanas => iso(new Date(LUNES(semanas).getTime() + 86400000));

test('normalization: registry files use LF without BOM or trailing whitespace', () => {
  for (const name of ['RegistroWeekly.gs', 'tests/RegistroWeekly.test.cjs']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.ok(!text.startsWith('﻿'), `${name}: unexpected BOM`);
    assert.doesNotMatch(text, /\r|[\t ]+$/m, `${name}: non-normalized whitespace`);
    assert.ok(text.endsWith('\n'), `${name}: missing final newline`);
  }
});

test('static isolation: only RegistroWeekly.gs writes, and nothing calls out or installs triggers', () => {
  const escribe = /\.set[A-Z]\w*\(|\.clear\w*\(|appendRow|insertSheet|deleteSheet|deleteRow/;
  for (const name of ['MotorWeekly.gs', 'ResumenWeekly.gs', 'FuenteWeekly.gs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, name), 'utf8'), escribe, name);
  }
  const registro = fs.readFileSync(path.join(root, 'RegistroWeekly.gs'), 'utf8');
  assert.match(registro, escribe);
  assert.doesNotMatch(registro, /UrlFetchApp|ScriptApp|MailApp|BigQuery|deleteSheet|deleteRow|setFormula|\.setValue\(/);
});

test('first open: reads the sheet, creates only the registry tab and saves the run', () => {
  const { ctx, estado } = mundo({ [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40, u => { u.Argentina[4] = 0.05; }) }, hoyPara(40));
  const respuesta = ctx.obtenerVistaWeekly(false);
  assert.equal(respuesta.estado, 'ok', JSON.stringify(respuesta.error));
  assert.equal(respuesta.procedencia, 'lectura');
  assert.equal(respuesta.semanaEsperada, iso(LUNES(39)));
  assert.equal(respuesta.vista.semana, iso(LUNES(39)));
  assert.equal(respuesta.vista.conHistorial, false);
  assert.equal(respuesta.vista.movimientos[0].historial, null);
  assert.deepEqual(Array.from(respuesta.avisos), []);
  assert.deepEqual(estado.escrituras, ['insertSheet', 'setValues@fila1', 'frozen:1', 'formato:@@fila2', 'setValues@fila2']);
  assert.deepEqual(estado.registro[0].slice(0, 9), ['semana', 'guardado', 'ultima_actualizacion_datos', 'movimientos',
    'desfavorables', 'favorables', 'datos_a_revisar', 'datos_prioridad_alta', 'partes']);
  assert.equal(estado.registro[1][0], iso(LUNES(39)));
  assert.equal(estado.registro[1].length, 29);
  assert.ok(estado.registro[1].slice(9).every(celda => celda === '' || celda.charAt(0) === '~'), 'no stored cell can start a formula');
  assert.deepEqual(estado.lock, { tomado: 1, liberado: 1 });
  assert.doesNotThrow(() => JSON.stringify(respuesta));
});

test('second open the same week: served from the registry without reading the source', () => {
  const { ctx, estado } = mundo({ [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40, u => { u.Argentina[4] = 0.05; }) }, hoyPara(40));
  const primera = ctx.obtenerVistaWeekly(false);
  const lecturas = estado.lecturasFuente;
  const escrituras = estado.escrituras.length;
  const segunda = ctx.obtenerVistaWeekly(false);
  assert.equal(segunda.procedencia, 'guardado');
  assert.equal(estado.lecturasFuente, lecturas);
  assert.equal(estado.escrituras.length, escrituras);
  assert.equal(segunda.generadoIso, primera.generadoIso);
  assert.deepEqual(JSON.parse(JSON.stringify(segunda.vista)), JSON.parse(JSON.stringify(primera.vista)));
  const forzada = ctx.obtenerVistaWeekly(true);
  assert.equal(forzada.procedencia, 'lectura');
  assert.ok(estado.lecturasFuente > lecturas);
  assert.equal(estado.registro.length, 2, 'the same week is overwritten, not appended');
});

test('next week: new, continuing and gone findings are told apart using the saved run', () => {
  const fuentes = { [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40, u => { u.Argentina[4] = 0.05; u.Chile[3] = null; }) };
  const { ctx, estado } = mundo(fuentes, hoyPara(40));
  ctx.obtenerVistaWeekly(false);
  // Week 41 arrives: Argentina's fail rate jumps again, Chile's orders are back
  // and Chile's fail rate is now missing.
  const siguiente = hojaDatos(41, u => { u.Argentina[4] = 0.09; u.Chile[4] = null; });
  siguiente.valores.filter(f => f[2] === 'Argentina' && iso(f[0]) === iso(LUNES(39)))[0][4] = 0.05;
  fuentes[DATOS] = siguiente;
  const semana2 = mundo(fuentes, hoyPara(41));
  semana2.estado.registro = estado.registro;
  const respuesta = semana2.ctx.obtenerVistaWeekly(false);
  assert.equal(respuesta.procedencia, 'lectura', 'a saved run of an older week is not served');
  assert.equal(respuesta.vista.semana, iso(LUNES(40)));
  assert.equal(respuesta.vista.conHistorial, true);
  assert.equal(respuesta.vista.movimientos.find(m => m.entidad === 'Argentina' && m.fila === 11).historial, 'continua');
  const falta = respuesta.vista.calidad.find(c => c.entidad === 'Chile' && c.fila === 11);
  assert.equal(falta.historial, 'nueva');
  assert.deepEqual(JSON.parse(JSON.stringify(respuesta.vista.resueltos)),
    [{ entidad: 'Chile', kpi: 'Overall › Orders', fila: 9, titulo: 'Falta el dato de la última semana' }]);
  assert.equal(semana2.estado.registro.length, 3);
  assert.equal(semana2.estado.registro[2][0], iso(LUNES(40)));
});

test('failures: unreadable source falls back to the saved run; a busy lock still returns the result', () => {
  const fuentes = { [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40) };
  const { ctx, estado } = mundo(fuentes, hoyPara(40));
  ctx.obtenerVistaWeekly(false);
  delete fuentes[DATOS];
  const caida = ctx.obtenerVistaWeekly(true);
  assert.equal(caida.estado, 'ok');
  assert.equal(caida.procedencia, 'guardado');
  assert.match(caida.avisos[0], /FUENTE_SIN_HOJA/);
  const sinNada = mundo({ [KPIS]: hojaKpis() }, hoyPara(40)).ctx.obtenerVistaWeekly(false);
  assert.equal(sinNada.estado, 'error');
  assert.equal(sinNada.error.codigo, 'FUENTE_SIN_HOJA');
  assert.equal(sinNada.vista, null);
  const ocupado = mundo({ [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40) }, hoyPara(40));
  ocupado.estado.ocupado = true;
  const respuesta = ocupado.ctx.obtenerVistaWeekly(false);
  assert.equal(respuesta.estado, 'ok');
  assert.match(respuesta.avisos[0], /no se pudo guardar.*REGISTRO_OCUPADO/);
  assert.deepEqual(ocupado.estado.escrituras, []);
  assert.equal(estado.lock.tomado, estado.lock.liberado);
});

test('registry rows: round trip, damaged content and detail kept only for recent weeks', () => {
  const { ctx, estado } = mundo({ [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40) }, hoyPara(40));
  const vista = ctx.obtenerVistaWeekly(false).vista;
  const fila = ctx.weeklyRegistroFilaDe_(vista, '2026-10-06T12:00:00.000Z', '2026-10-05');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.weeklyRegistroPaquete_(fila.slice(9)).vista)), JSON.parse(JSON.stringify(vista)));
  assert.equal(ctx.weeklyRegistroPaquete_(['~{"vista":', 'x']), null);
  assert.equal(ctx.weeklyRegistroPaquete_(['', '']), null);
  for (let i = 0; i < 9; i++) {
    const copia = estado.registro[1].slice();
    copia[0] = iso(LUNES(20 + i));
    estado.registro.push(copia);
  }
  estado.escrituras.length = 0;
  ctx.obtenerVistaWeekly(true);
  const limpiadas = estado.escrituras.filter(paso => paso.startsWith('clear@'));
  assert.equal(limpiadas.length, 2, 'ten saved weeks keep the detail of the newest eight');
  const sinDetalle = estado.registro.filter(f => f[0] === iso(LUNES(20)))[0];
  assert.equal(sinDetalle[9], '');
  assert.equal(sinDetalle[3] !== '', true, 'counts of old weeks are kept');
});

test('degraded catalog: an incomplete run is shown with a warning, never saved and never served', () => {
  const rota = hojaKpis();
  // Formulas the catalog cannot read (as after an unexpected change in the sheet).
  rota.formulas[8][12] = '=QUERY(X!A:Z)';
  rota.formulas[10][12] = '=QUERY(X!A:Z)';
  const fuentes = { [KPIS]: rota, [DATOS]: hojaDatos(40) };
  const { ctx, estado } = mundo(fuentes, hoyPara(40));
  const respuesta = ctx.obtenerVistaWeekly(false);
  assert.equal(respuesta.estado, 'ok');
  assert.equal(respuesta.vista.conteos.kpisAnalizados, 0);
  assert.match(respuesta.avisos[0], /Solo se pudieron interpretar 0 de 2 filas/);
  assert.deepEqual(estado.escrituras, []);
  // A degraded run that was saved by an earlier version is ignored on the next open.
  const sana = mundo({ [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40) }, hoyPara(40));
  const buena = sana.ctx.obtenerVistaWeekly(false).vista;
  const mala = JSON.parse(JSON.stringify(buena));
  mala.conteos.kpisAnalizados = 0;
  sana.estado.registro[1] = Array.from(sana.ctx.weeklyRegistroFilaDe_(mala, '2026-10-06T12:00:00.000Z', '2026-10-05'));
  const lecturas = sana.estado.lecturasFuente;
  const otra = sana.ctx.obtenerVistaWeekly(false);
  assert.equal(otra.procedencia, 'lectura');
  assert.ok(sana.estado.lecturasFuente > lecturas);
  assert.equal(otra.vista.conteos.kpisAnalizados, 2);
  assert.equal(sana.estado.registro.length, 2, 'the degraded row is replaced by the good run');
});

test('a run on data not refreshed yet is shown with its warning and never saved', () => {
  const { ctx, estado } = mundo({ [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40) }, hoyPara(41));
  const respuesta = ctx.obtenerVistaWeekly(false);
  assert.equal(respuesta.estado, 'ok', JSON.stringify(respuesta.error));
  assert.equal(respuesta.semanaEsperada, iso(LUNES(40)));
  assert.equal(respuesta.vista.semana, iso(LUNES(39)));
  assert.equal(respuesta.vista.provisoria, true);
  assert.equal(respuesta.vista.estadoCarga[0].titulo, 'Los datos todavía no se actualizaron');
  assert.match(respuesta.vista.estadoCarga[0].detalle, /antes del lunes \d{2}\/\d{2}\/\d{4}\./, 'dates are shown as day/month/year');
  assert.match(respuesta.avisos.join(' '), /provisoria y no se guardó/);
  assert.deepEqual(estado.escrituras, []);
  const lecturas = estado.lecturasFuente;
  assert.equal(ctx.obtenerVistaWeekly(false).procedencia, 'lectura');
  assert.ok(estado.lecturasFuente > lecturas, 'the next opening reads the source again');
});

test('history: a finding is recognised by KPI uid, not by row or visible name', () => {
  const ctx = mundo({ [KPIS]: hojaKpis(), [DATOS]: hojaDatos(40) }, hoyPara(40)).ctx;
  const vista = uid => ({ movimientos: [{ entidad: 'Chile', kpi: 'Nombre nuevo › Orders', uid: uid, sentido: 'baja' }],
    calidad: [{ entidad: 'Chile', kpi: 'Nombre nuevo › Fail Rate', uid: 'fail_rate', regla: 'CERO_SOSPECHOSO', fila: 99,
      titulo: 'Cero sospechoso', severidad: 'alta' }] });
  const anterior = vista('orders');
  anterior.movimientos[0].kpi = 'Overall › Orders';
  anterior.calidad[0].kpi = 'Overall › Fail Rate';
  const claves = ctx.weeklyRegistroClavesDe_(anterior);
  assert.equal(claves.version, 2);
  assert.equal(claves.movimientos[0].k, 'Chile|orders');
  const actual = ctx.weeklyRegistroCompara_(vista('orders'), claves);
  assert.equal(actual.movimientos[0].historial, 'continua', 'renamed and moved, still the same KPI');
  assert.equal(actual.calidad[0].historial, 'continua');
  assert.equal(actual.resueltos.length, 0);
  const viejas = { movimientos: [{ k: 'Chile|Overall › Orders', sentido: 'baja' }], calidad: [] };
  const sinHistoria = ctx.weeklyRegistroCompara_(vista('orders'), viejas);
  assert.equal(sinHistoria.conHistorial, false, 'a run saved with name-based keys is not compared');
  assert.equal(sinHistoria.movimientos[0].historial, null);
});
