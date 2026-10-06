const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const fuentes = ['MotorWeekly.gs', 'ResumenWeekly.gs', 'FuenteWeekly.gs'];

const SUMIFS = fila => `=IFERROR(SUMIFS(INDEX('Extract Tabla Weekly'!$A:$BS; 0; MATCH($C${fila}; 'Extract Tabla Weekly'!$1:$1; 0)); 'Extract Tabla Weekly'!$A:$A; M$6); "")`;
const LUNES = i => new Date(Date.UTC(2026, 0, 5 + i * 7, 3));
const iso = fecha => fecha.toISOString().slice(0, 10);

// Synthetic "2) Weekly por pais": header on row 6, direction in B, key in C,
// name in D, weeks in E:M, WoW in O. Formulas use ";" like a Spanish locale.
function hojaKpis() {
  const ancho = 17;
  const vacia = () => new Array(ancho).fill('');
  const valores = [];
  const formulas = [];
  const pone = (fila, col, valor, formula) => {
    while (valores.length < fila) { valores.push(vacia()); formulas.push(vacia()); }
    valores[fila - 1][col] = valor;
    if (formula) formulas[fila - 1][col] = formula;
  };
  pone(4, 3, 'Country'); pone(4, 4, 'Argentina');
  pone(6, 3, 'KPI');
  for (let i = 0; i < 9; i++) pone(6, 4 + i, LUNES(31 + i), '=TODAY()');
  pone(6, 14, 'WoW'); pone(6, 15, 'vs. W-4');
  pone(8, 2, 'Nombre tabla BQ'); pone(8, 3, 'Overall');
  pone(9, 1, 1); pone(9, 2, 'orders'); pone(9, 3, 'Orders - Total'); pone(9, 12, 10000, SUMIFS(9)); pone(9, 14, 0.01, '=M9/L9-1');
  pone(10, 1, 1); pone(10, 2, 'orders_food'); pone(10, 3, 'Food'); pone(10, 12, 7000, SUMIFS(10)); pone(10, 14, 0.01, '=M10/L10-1');
  pone(13, 1, -1); pone(13, 2, 'fail_rate'); pone(13, 3, 'Fail Rate'); pone(13, 12, 0.02, SUMIFS(13)); pone(13, 14, 0.1, '=(M13-L13)*100');
  pone(14, 1, 1); pone(14, 2, 'no_existe'); pone(14, 3, 'Fantasma'); pone(14, 12, '', SUMIFS(14)); pone(14, 14, '', '=M14/L14-1');
  return { valores, formulas };
}

function hojaDatos(ajuste) {
  const valores = [['week_date', 'country_id', 'country_name', 'orders', 'orders_food', 'fail_rate', 'last_update']];
  ['Argentina', 'Chile', 'LATAM'].forEach((pais, k) => {
    for (let i = 0; i < 40; i++) {
      const food = Math.round(7000 * (1 + Math.sin(i * 1.7 + k) * 0.01));
      valores.push([LUNES(i), k + 1, pais, food + 3000, food, 0.02 + Math.sin(i + k) * 0.0005, new Date(Date.UTC(2026, 9, 5, 18))]);
    }
  });
  if (ajuste) ajuste(valores);
  return valores;
}

function contexto(extra) {
  const ctx = vm.createContext(Object.assign({}, extra));
  fuentes.forEach(nombre => vm.runInContext(fs.readFileSync(path.join(root, nombre), 'utf8'), ctx, { filename: nombre }));
  return ctx;
}

const aIso = ctx => valor => ctx.weeklyFuenteFecha_(valor, iso);

function estricto(metodos) {
  return new Proxy(metodos, {
    get(objetivo, clave) {
      if (typeof clave === 'symbol' || clave === 'then' || clave === 'toJSON') return undefined;
      assert.ok(Object.hasOwn(objetivo, clave), `Forbidden API: ${String(clave)}`);
      return objetivo[clave];
    }
  });
}

// Strict Apps Script mock: any call outside the read-only set fails the test.
function servicios(hojas, registro) {
  const rango = datos => estricto({
    getNumRows: () => datos.valores.length,
    getNumColumns: () => datos.valores[0].length,
    getValues: () => { registro.push('getValues'); return datos.valores; },
    getFormulas: () => { registro.push('getFormulas'); return datos.formulas; }
  });
  return {
    SpreadsheetApp: estricto({ openById: id => {
      registro.push('openById:' + id);
      return estricto({ getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires', getName: () => 'Libro de prueba',
        getSheets: () => Object.keys(hojas).map(nombre => estricto({ getName: () => nombre })),
        getSheetByName: nombre => (hojas[nombre] ? estricto({ getDataRange: () => rango(hojas[nombre]) }) : null) });
    } }),
    Utilities: estricto({ formatDate: (fecha, zona, formato) => {
      assert.ok(['yyyy-MM-dd', 'HH:mm'].includes(formato));
      if (formato === 'HH:mm') {
        return new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(fecha);
      }
      return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(fecha);
    } }),
    console: { log: texto => registro.push('log:' + texto) }
  };
}

test('normalization: source files use LF without BOM or trailing whitespace', () => {
  for (const name of ['FuenteWeekly.gs', 'tests/FuenteWeekly.test.cjs', 'herramientas/analizar.cjs']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.ok(!text.startsWith('﻿'), `${name}: unexpected BOM`);
    assert.doesNotMatch(text, /\r|[\t ]+$/m, `${name}: non-normalized whitespace`);
    assert.ok(text.endsWith('\n'), `${name}: missing final newline`);
  }
});

test('static isolation: the source never writes, locks, triggers or calls out', () => {
  const text = fs.readFileSync(path.join(root, 'FuenteWeekly.gs'), 'utf8');
  assert.doesNotMatch(text, /\.set[A-Z]\w*\(|\.clear\w*\(|appendRow|insert\w+\(|delete\w+\(|LockService|UrlFetchApp|ScriptApp|PropertiesService|BigQuery|MailApp|flush\(/);
});

test('layout is located by content and formulas with ";" are understood', () => {
  const ctx = contexto();
  const hoja = hojaKpis();
  const lectura = ctx.weeklyFuenteFilasKpi_(hoja.valores, hoja.formulas, aIso(ctx));
  assert.equal(lectura.filaEncabezado, 6);
  assert.equal(lectura.columnaNombre, 4);
  assert.equal(lectura.semanasHoja.length, 9);
  assert.equal(lectura.semanasHoja[8], iso(LUNES(39)));
  const catalogo = ctx.weeklyMotorCatalogo_(lectura.filas);
  const porId = Object.fromEntries(catalogo.kpis.map(k => [k.id, k]));
  assert.equal(porId.F9.def.campo, 'orders');
  assert.equal(porId.F9.etiqueta, 'Overall › Orders');
  assert.equal(porId.F13.unidad, 'pp');
  assert.equal(porId.F13.direccion, -1);
});

test('layout shifted one column and two rows is still found', () => {
  const ctx = contexto();
  const hoja = hojaKpis();
  const corre = matriz => [new Array(18).fill(''), new Array(18).fill('')].concat(matriz.map(fila => [''].concat(fila)));
  const lectura = ctx.weeklyFuenteFilasKpi_(corre(hoja.valores), corre(hoja.formulas), aIso(ctx));
  assert.equal(lectura.filaEncabezado, 8);
  assert.equal(lectura.columnaNombre, 5);
  assert.equal(lectura.filas.find(f => f.nombre === 'Fail Rate').direccion, -1);
});

test('extract: blank stays null, zero stays zero, text stays text, duplicates are counted', () => {
  const ctx = contexto();
  const fuente = ctx.weeklyFuenteDatos_(hojaDatos(valores => {
    valores[40][3] = '';
    valores[39][3] = 0;
    valores[38][3] = '#N/A';
    valores.push(valores[40].slice());
    valores.push(['', 9, 'Sin semana', 1, 1, 1, '']);
  }), aIso(ctx));
  const orders = fuente.datos.Argentina.orders;
  assert.equal(orders[iso(LUNES(39))], null);
  assert.equal(orders[iso(LUNES(38))], 0);
  assert.equal(orders[iso(LUNES(37))], '#N/A');
  assert.equal(fuente.filasDuplicadas, 1);
  assert.equal(fuente.semanas.length, 40);
  assert.deepEqual(Object.keys(fuente.datos), ['Argentina', 'Chile', 'LATAM']);
  assert.deepEqual(Array.from(fuente.campos), ['orders', 'orders_food', 'fail_rate']);
  assert.equal(fuente.ultimaActualizacion, '2026-10-05');
});

test('dates: Date objects and day serials give the same ISO week', () => {
  const ctx = contexto();
  assert.equal(ctx.weeklyFuenteFecha_(46293, iso), '2026-09-28');
  assert.equal(ctx.weeklyFuenteFecha_(new Date(Date.UTC(2026, 8, 28, 3)), iso), '2026-09-28');
  assert.equal(ctx.weeklyFuenteFecha_('2026-09-28', iso), null);
  assert.equal(ctx.weeklyFuenteFecha_(3369726, iso), null);
});

test('structure errors are explicit', () => {
  const ctx = contexto();
  const hoja = hojaKpis();
  assert.throws(() => ctx.weeklyFuenteFilasKpi_([['a']], [['']], aIso(ctx)), /FUENTE_ESTRUCTURA/);
  hoja.valores[5][14] = 'Otra';
  assert.throws(() => ctx.weeklyFuenteFilasKpi_(hoja.valores, hoja.formulas, aIso(ctx)), /FUENTE_ESTRUCTURA/);
  assert.throws(() => ctx.weeklyFuenteDatos_([['semana', 'pais']], aIso(ctx)), /FUENTE_ESTRUCTURA/);
});

test('analizarWeeklyAhora: read-only run returns the analysis, its text and the source state', () => {
  const registro = [];
  const hojas = { '2) Weekly por pais': hojaKpis(),
    '[Extract] Tabla Weekly': { valores: hojaDatos(valores => { valores[40][5] = 0.06; }), formulas: [] } };
  const ctx = contexto(servicios(hojas, registro));
  const corrida = ctx.analizarWeeklyAhora();
  assert.equal(corrida.estado, 'ok', JSON.stringify(corrida.error));
  assert.equal(corrida.error, null);
  assert.equal(corrida.resultado.semana, iso(LUNES(39)));
  assert.equal(corrida.resultado.catalogo.analizados, 3);
  assert.ok(corrida.resultado.catalogo.advertencias.some(texto => /no_existe/.test(texto)));
  assert.equal(corrida.resultado.globales[0].regla, 'SEMANA_ESPERADA_AUSENTE');
  const alerta = corrida.resultado.performance.find(a => a.entidad === 'Argentina' && a.kpi.id === 'F13');
  assert.equal(alerta.favorable, false);
  assert.match(corrida.texto, /\*\*Argentina\*\* — Overall › Fail Rate sube/);
  assert.equal(corrida.origen.ultimaActualizacionExtract, '2026-10-05');
  assert.equal(corrida.origen.semanasHoja.length, 9);
  assert.deepEqual(registro.filter(paso => !paso.startsWith('openById')), ['getValues', 'getFormulas', 'getValues']);
  assert.doesNotThrow(() => JSON.stringify(corrida));
});

test('analizarWeeklyAhora: failures come back as codes without raw service text', () => {
  const sinHoja = contexto(servicios({ '2) Weekly por pais': hojaKpis() }, [])).analizarWeeklyAhora();
  assert.equal(sinHoja.estado, 'error');
  assert.equal(sinHoja.error.codigo, 'FUENTE_SIN_HOJA');
  assert.equal(sinHoja.resultado, null);
  assert.equal(sinHoja.error.detalle, 'FUENTE_SIN_HOJA: en "Libro de prueba" no existe la pestaña ' +
    '"[Extract] Tabla Weekly". Pestañas encontradas: "2) Weekly por pais".');
  const roto = servicios({}, []);
  roto.SpreadsheetApp = { openById: () => { throw new Error('Secret cell content 123'); } };
  const fallo = contexto(roto).analizarWeeklyAhora();
  assert.equal(fallo.error.codigo, 'FUENTE_ERROR_DE_SERVICIO');
  assert.doesNotMatch(JSON.stringify(fallo), /Secret/);
  const hoja = hojaKpis();
  hoja.valores[5][3] = 'Indicador';
  const estructura = contexto(servicios({ '2) Weekly por pais': hoja,
    'Extract Tabla Weekly': { valores: hojaDatos(), formulas: [] } }, [])).analizarWeeklyAhora();
  assert.equal(estructura.error.codigo, 'FUENTE_ESTRUCTURA');
});

test('probarAnalisisWeekly: logs a count summary and the text, and returns the run', () => {
  const registro = [];
  const hojas = { '2) Weekly por pais': hojaKpis(), 'Extract Tabla Weekly': { valores: hojaDatos(), formulas: [] } };
  const corrida = contexto(servicios(hojas, registro)).probarAnalisisWeekly();
  const logs = registro.filter(paso => paso.startsWith('log:'));
  assert.equal(corrida.estado, 'ok');
  assert.equal(JSON.parse(logs[0].slice(4)).kpisAnalizados, 3);
  assert.match(logs[1], /# Resumen Weekly/);
});

test('a column inserted between the key and the name does not break key or direction', () => {
  const ctx = contexto();
  const hoja = hojaKpis();
  // Same change the real sheet had: a new grouping column right before the names.
  const inserta = (matriz, relleno) => matriz.map((fila, f) => fila.slice(0, 3).concat([relleno(f)], fila.slice(3)));
  const valores = inserta(hoja.valores, f => (f === 8 ? 'Orders' : ''));
  const formulas = inserta(hoja.formulas, () => '');
  const lectura = ctx.weeklyFuenteFilasKpi_(valores, formulas, aIso(ctx));
  assert.equal(lectura.columnaNombre, 5);
  const orders = lectura.filas.find(f => f.fila === 9);
  assert.equal(orders.clave, 'orders');
  assert.equal(orders.nombre, 'Orders - Total');
  assert.equal(orders.direccion, 1);
  assert.equal(lectura.filas.find(f => f.nombre === 'Fail Rate').direccion, -1);
  const catalogo = ctx.weeklyMotorCatalogo_(lectura.filas);
  assert.equal(catalogo.kpis.find(k => k.fila === 9).def.campo, 'orders');
  assert.equal(catalogo.advertencias.filter(texto => /dirección|no reconocida/.test(texto)).length, 0);
});

// Sheet whose weekly cells show what the extract holds for the selected market,
// with the market filter ($E$4) in the formulas like the real sheet.
function hojaConValores(pais, datos) {
  const hoja = hojaKpis();
  const filtro = fila => SUMIFS(fila).replace('M$6);', "M$6; 'Extract Tabla Weekly'!$C:$C; $E$4);");
  hoja.valores[3][4] = pais;
  const desde = datos.findIndex(fila => fila[2] === pais);
  [[9, 3], [10, 4], [13, 5]].forEach(([fila, campo]) => {
    for (let i = 0; i < 9; i++) hoja.valores[fila - 1][4 + i] = desde === -1 ? '' : datos[desde + 31 + i][campo];
    hoja.formulas[fila - 1][12] = filtro(fila);
  });
  return hoja;
}

function coincidencia(pais, ajusteHoja, ajusteDatos) {
  const ctx = contexto();
  const datos = hojaDatos(ajusteDatos);
  const hoja = hojaConValores(pais, datos);
  if (ajusteHoja) ajusteHoja(hoja);
  return ctx.weeklyFuenteEntrada_(hoja.valores, hoja.formulas, datos, aIso(ctx), null).coincidencia;
}

test('cross-check: the sheet of the selected market matches the extract', () => {
  const chile = coincidencia('Chile');
  assert.equal(chile.estado, 'coincide');
  assert.equal(chile.entidad, 'Chile');
  assert.equal(chile.comparadas, 27);
  assert.equal(chile.diferencias, 0);
});

test('cross-check: a different number is reported with its row and week', () => {
  const resultado = coincidencia('Argentina', hoja => { hoja.valores[9][12] += 1; });
  assert.equal(resultado.estado, 'difiere');
  assert.equal(resultado.diferencias, 1);
  assert.equal(resultado.muestras[0].fila, 10);
  assert.equal(resultado.muestras[0].semana, iso(LUNES(39)));
  const ctx = contexto();
  assert.match(ctx.weeklyFuenteCoincidenciaTexto_(resultado), /1 no coinciden \(por ejemplo, fila 10/);
});

test('cross-check: a blank in the extract matches the zero or the blank the sheet shows', () => {
  const vacio = valores => { valores[40][3] = ''; };
  assert.equal(coincidencia('Argentina', hoja => { hoja.valores[8][12] = 0; }, vacio).estado, 'coincide');
  assert.equal(coincidencia('Argentina', null, vacio).estado, 'coincide');
  assert.equal(coincidencia('Argentina', hoja => { hoja.valores[8][12] = 5; }, vacio).estado, 'difiere');
});

test('cross-check: without a known market or a market cell nothing is compared', () => {
  const ajeno = coincidencia('Atlantis');
  assert.equal(ajeno.estado, 'no_evaluable');
  assert.match(ajeno.motivo, /no existe en el extract/);
  const ctx = contexto();
  const hoja = hojaKpis();
  const sinCelda = ctx.weeklyFuenteEntrada_(hoja.valores, hoja.formulas, hojaDatos(), aIso(ctx), null).coincidencia;
  assert.equal(sinCelda.estado, 'no_evaluable');
  assert.equal(sinCelda.comparadas, 0);
});

test('block column: found by content, a block name applies from its row until the next one', () => {
  const ctx = contexto();
  const hoja = hojaKpis();
  hoja.valores[8][0] = 'Orders';
  hoja.valores[12][0] = 'Quality';
  const lectura = ctx.weeklyFuenteFilasKpi_(hoja.valores, hoja.formulas, aIso(ctx));
  assert.equal(lectura.filas.find(f => f.fila === 9).bloque, 'Orders');
  assert.equal(lectura.filas.find(f => f.fila === 10).bloque, '');
  const catalogo = ctx.weeklyMotorCatalogo_(lectura.filas);
  const porId = Object.fromEntries(catalogo.kpis.map(k => [k.id, k]));
  assert.equal(porId.F10.bloque, 'Orders');
  assert.equal(porId.F13.bloque, 'Quality');
  assert.deepEqual(Array.from(ctx.weeklyMotorLideres_(catalogo.kpis).map(k => k.id)), ['F9', 'F13']);
  const sinColumna = ctx.weeklyMotorCatalogo_(ctx.weeklyFuenteFilasKpi_(hojaKpis().valores, hojaKpis().formulas, aIso(ctx)).filas);
  assert.deepEqual(Array.from(ctx.weeklyMotorLideres_(sinColumna.kpis).map(k => k.id)), ['F9'], 'without blocks: the first KPI of each section');
});
