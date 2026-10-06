const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const pagina = fs.readFileSync(path.join(root, 'Resumen.txt'), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(pagina)[1];

function motor(extra) {
  const ctx = vm.createContext(Object.assign({}, extra));
  ['MotorWeekly.gs', 'ResumenWeekly.gs', 'FuenteWeekly.gs', 'RegistroWeekly.gs'].forEach(nombre => {
    vm.runInContext(fs.readFileSync(path.join(root, nombre), 'utf8'), ctx, { filename: nombre });
  });
  return ctx;
}

const FORMULA = fila => `=IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C${fila}, X!$1:$1, 0)), X!$A:$A, M$6), "")`;

function resultado() {
  const m = motor();
  const semanas = [];
  for (let i = 0; i < 40; i++) semanas.push(new Date(Date.UTC(2026, 0, 5) + i * 7 * 86400000).toISOString().slice(0, 10));
  const datos = {};
  ['Argentina', 'Chile', 'LATAM'].forEach((pais, k) => {
    datos[pais] = { orders: {}, fail_rate: {}, dmarts: {} };
    semanas.forEach((semana, i) => {
      datos[pais].orders[semana] = Math.round(10000 * (1 + Math.sin(i * 1.7 + k) * 0.01));
      datos[pais].fail_rate[semana] = 0.02 + Math.sin(i + k) * 0.0005;
      datos[pais].dmarts[semana] = pais === 'Chile' ? 0 : 500 + i;
    });
  });
  const ultima = semanas[semanas.length - 1];
  datos.Argentina.fail_rate[ultima] = 0.05;
  datos.LATAM.fail_rate[ultima] = 0.04;
  datos.Chile.orders[ultima] = null;
  const catalogo = m.weeklyMotorCatalogo_([
    { fila: 8, direccion: null, clave: '', nombre: 'Overall', formulaValor: null, formulaVariacion: null },
    { fila: 9, direccion: 1, clave: 'orders', nombre: 'Orders', formulaValor: FORMULA(9), formulaVariacion: '=M9/L9-1' },
    { fila: 11, direccion: -1, clave: 'fail_rate', nombre: 'Fail Rate', formulaValor: FORMULA(11), formulaVariacion: '=(M11-L11)*100' },
    { fila: 13, direccion: 1, clave: 'dmarts', nombre: 'Dmarts', formulaValor: FORMULA(13), formulaVariacion: '=M13/L13-1' }
  ]);
  const analisis = m.analizarWeekly({ semanas, datos, catalogo, semanaEsperada: ultima,
    entidades: [{ nombre: 'Argentina', tipo: 'pais' }, { nombre: 'Chile', tipo: 'pais' }, { nombre: 'LATAM', tipo: 'LATAM' }] });
  return { m, analisis, ultima };
}

test('normalization: page and view files use LF without BOM or trailing whitespace', () => {
  for (const name of ['Resumen.txt', 'tests/Resumen.test.cjs', 'herramientas/vista-previa.cjs']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.ok(!text.startsWith('﻿'), `${name}: unexpected BOM`);
    assert.doesNotMatch(text, /\r|[\t ]+$/m, `${name}: non-normalized whitespace`);
    assert.ok(text.endsWith('\n'), `${name}: missing final newline`);
  }
});

test('page content policy: text only, nothing external, single read-only server call', () => {
  assert.doesNotMatch(pagina, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  assert.doesNotMatch(pagina.replace('http://www.w3.org/2000/svg', ''), /https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i);
  assert.doesNotMatch(pagina, /<link\b|<script\s+src|@import|localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
  const llamadas = script.match(/\.(\w+)\(\w*\);/g).filter(texto => /obtener|leer|analizar|probar/.test(texto));
  assert.deepEqual(llamadas, ['.obtenerVistaWeekly(forzar);']);
  assert.doesNotMatch(script, /leerWeeklyPorPais|obtenerOpcionesWeekly|setValue/);
  assert.doesNotMatch(pagina, /Al día/);
});

test('page: every id the script uses exists once in the markup', () => {
  const usados = new Set([...script.matchAll(/\bid\('([\w-]+)'\)/g)].map(m => m[1]));
  assert.ok(usados.size >= 15);
  for (const nombre of usados) {
    assert.equal(pagina.split(`id="${nombre}"`).length - 1, 1, `id ${nombre}`);
  }
});

test('page: accepts only an ok weekly-vista/2 answer and keeps the previous result on failure', () => {
  assert.match(script, /respuesta\.schemaVersion === 'weekly-vista\/2' && respuesta\.estado === 'ok' && respuesta\.vista/);
  assert.match(script, /resultado anterior/);
  assert.match(pagina, /no demuestran la causa/);
});

test('view model: display-ready movements with values, measure, explanations and series', () => {
  const { m, analisis, ultima } = resultado();
  const vista = m.vistaWeekly(analisis);
  assert.equal(vista.semana, ultima);
  const mov = vista.movimientos.find(x => x.entidad === 'Argentina');
  assert.equal(mov.kpi, 'Overall › Fail Rate');
  assert.equal(mov.fila, 11);
  assert.equal(mov.clave, 'fail_rate');
  assert.equal(mov.favorable, false);
  assert.equal(mov.sentido, 'sube');
  assert.match(mov.cambio, /^\+\d,\d\d pp$/);
  assert.equal(mov.a, '5,00 %');
  assert.match(mov.medida, /× su variación típica$/);
  assert.equal(mov.serie.length, 9);
  assert.equal(mov.serie[8].semana, ultima);
  assert.equal(mov.serie[8].texto, '5,00 %');
  assert.ok(mov.explicaciones.every(texto => typeof texto === 'string' && texto.length > 0));
  assert.equal(vista.movimientos.find(x => x.entidad === 'LATAM').esRegional, true);
  assert.equal(vista.conteos.movimientos, vista.movimientos.length);
  assert.equal(vista.conteos.desfavorables, 2);
});

test('view model: quality findings carry a readable title, the gap stays a gap', () => {
  const { m, analisis } = resultado();
  const vista = m.vistaWeekly(analisis);
  const falta = vista.calidad.find(x => x.entidad === 'Chile' && x.regla === 'FALTANTE_ULTIMA_SEMANA');
  assert.equal(falta.titulo, 'Falta el dato de la última semana');
  assert.equal(falta.severidad, 'alta');
  assert.equal(falta.serie[8].valor, null);
  assert.equal(falta.serie[8].texto, 'sin dato');
  assert.equal(falta.serie[7].texto.includes(','), false, 'whole counts are shown without decimals');
  assert.deepEqual(JSON.parse(JSON.stringify(vista.sinOperacion)), [{ entidad: 'Chile', kpis: ['Overall › Dmarts'] }]);
  const chile = vista.mercados.find(x => x.nombre === 'Chile');
  assert.equal(chile.calidad, 1);
  assert.equal(chile.movimientos, 0);
  assert.equal(vista.conteos.calidadAltas, 1);
  assert.ok(vista.limites.some(texto => /no demuestran causa/.test(texto)));
  assert.ok(vista.limites.some(texto => /3,5 veces/.test(texto)));
  assert.doesNotMatch(JSON.stringify(vista), /undefined|NaN/);
});

test('number format: integers, zero, rates and small decimals', () => {
  const m = motor();
  assert.equal(m.weeklyResumenValor_(27, 'rel'), '27');
  assert.equal(m.weeklyResumenValor_(0, 'rel'), '0');
  assert.equal(m.weeklyResumenValor_(3369726, 'rel'), '3.369.726');
  assert.equal(m.weeklyResumenValor_(1.9684, 'rel'), '1,968');
  assert.equal(m.weeklyResumenValor_(0.7884, 'pp'), '78,84 %');
  assert.equal(m.weeklyResumenValor_(null, 'pp'), 'sin dato');
});

test('obtenerVistaWeekly: a failed read returns the error and no view', () => {
  const m = motor({ SpreadsheetApp: { openById: () => { throw new Error('boom'); } },
    Utilities: { formatDate: () => '2026-10-06' } });
  const respuesta = m.obtenerVistaWeekly();
  assert.equal(respuesta.schemaVersion, 'weekly-vista/2');
  assert.equal(respuesta.estado, 'error');
  assert.equal(respuesta.error.codigo, 'FUENTE_ERROR_DE_SERVICIO');
  assert.equal(respuesta.vista, null);
});

test('weekly story: region, one card per country, lists and closing come from computed values', () => {
  const { m, analisis, ultima } = resultado();
  assert.equal(analisis.panorama.length, 3);
  const historia = m.vistaWeekly(analisis).historia;
  assert.equal(historia.regional.nombre, 'LATAM');
  assert.match(historia.regional.titular, /^LATAM (creció en|cayó en|mantuvo sus) órdenes/);
  assert.equal(historia.regional.topline[0].nombre, 'Órdenes');
  assert.deepEqual(historia.paises.map(p => p.nombre), ['Argentina', 'Chile'], 'LATAM is never listed as a country');
  assert.equal(historia.paisInicial, 'Argentina');
  const argentina = historia.paises[0];
  assert.equal(argentina.grafico.nombre, 'Fail Rate');
  assert.equal(argentina.grafico.serie.length, 9);
  assert.equal(argentina.grafico.serie[8].semana, ultima);
  assert.equal(argentina.grafico.semanasPromedio, 8);
  assert.equal(argentina.tarjetas[0].nombre, 'Órdenes');
  assert.match(argentina.texto, /^Órdenes [+−]?\d/);
  assert.equal(historia.totalPerformance, analisis.performance.length);
  assert.equal(historia.cierre.pasos.length, 3);
  assert.ok(Array.isArray(historia.cierre.pasos[2].lista));
  assert.doesNotMatch(JSON.stringify(historia), /undefined|NaN|porque|debido a|estacionalidad/);
});

test('weekly story: a headline KPI held back by a data finding keeps its value and gets no change', () => {
  const { m, analisis } = resultado();
  const historia = m.vistaWeekly(analisis).historia;
  const chile = historia.paises.find(p => p.nombre === 'Chile');
  assert.equal(chile.tarjetas.length + (chile.grafico ? 1 : 0) >= 1, true);
  assert.match(chile.texto, /no se pueden comparar: el dato está a revisar/);
  assert.equal(chile.calidadAltas, 1);
  assert.match(chile.hipotesis, /Hay 1 dato\(s\) de Chile a revisar/);
  const ordenes = analisis.panorama.find(e => e.entidad === 'Chile').topline[0];
  assert.equal(ordenes.valor, null);
  assert.equal(ordenes.cambio, null);
});

test('page: the four chapters of the weekly story are in the markup', () => {
  for (const texto of ['Capítulo 1 · LATAM', 'Capítulo 2 · País por país', 'Capítulo 3 · Para tener en cuenta',
    'Capítulo 4 · Resumen semanal LATAM', 'Posible causa · hipótesis a validar']) {
    assert.ok(pagina.includes(texto), texto);
  }
});

test('weekly story: the regional tour shows each section through its block leaders', () => {
  const { m, analisis } = resultado();
  const region = analisis.panorama.find(e => e.tipoEntidad === 'LATAM');
  assert.ok(analisis.panorama.filter(e => e.tipoEntidad !== 'LATAM').every(e => e.recorrido === undefined));
  assert.deepEqual(Array.from(region.recorrido.map(s => s.seccion)), ['Overall']);
  const recorrido = m.vistaWeekly(analisis).historia.regional.recorrido;
  assert.equal(recorrido.length, 1);
  assert.equal(recorrido[0].tarjetas.length, 1, 'no block column: one leader per section');
  assert.equal(recorrido[0].tarjetas[0].nombre, 'Órdenes');
  assert.equal(recorrido[0].tarjetas[0].estado, 'habitual');
  assert.equal(recorrido[0].tarjetas[0].hipotesis, null);
  assert.match(recorrido[0].texto, /El KPI principal se movió dentro de lo habitual. Fuera de los principales, lo que más se movió en la sección: Overall › Fail Rate/);
});

test('page: the tour is a carousel moved by the reader, never by a timer', () => {
  assert.match(pagina, /id="lamina-anterior"/);
  assert.match(pagina, /id="lamina-siguiente"/);
  assert.doesNotMatch(script, /setInterval|setTimeout/);
});
