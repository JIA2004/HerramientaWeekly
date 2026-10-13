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

test('page: accepts only an ok weekly-vista/3 answer and keeps the previous result on failure', () => {
  assert.match(script, /respuesta\.schemaVersion === 'weekly-vista\/3' && respuesta\.estado === 'ok' && respuesta\.vista/);
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
  assert.equal(respuesta.schemaVersion, 'weekly-vista/3');
  assert.equal(respuesta.estado, 'error');
  assert.equal(respuesta.error.codigo, 'FUENTE_ERROR_DE_SERVICIO');
  assert.equal(respuesta.vista, null);
});

test('weekly story: region, one card per country and closing come from computed values', () => {
  const { m, analisis, ultima } = resultado();
  assert.equal(analisis.panorama.length, 3);
  const historia = m.vistaWeekly(analisis).historia;
  assert.equal(historia.regional.nombre, 'LATAM');
  assert.match(historia.regional.titular, /^LATAM (creció en|cayó en|mantuvo) Orders/);
  assert.equal(historia.regional.topline[0].nombre, 'Orders', 'the name of the sheet, never a translation');
  assert.deepEqual(historia.paises.map(p => p.nombre), ['Argentina', 'Chile'], 'LATAM is never listed as a country');
  assert.equal(historia.paisInicial, 'Argentina');
  const argentina = historia.paises[0];
  const general = argentina.segmentos[0];
  assert.equal(general.general, true);
  assert.deepEqual(Array.from(general.kpis.map(k => k.nombre)), ['Fail Rate', 'Orders'], 'the strongest move opens, then orders');
  assert.equal(historia.semanasGrafico.length, 9);
  assert.equal(historia.semanasGrafico[8], ultima);
  assert.ok(general.kpis.every(k => k.grafico.valores.length === 9 && k.grafico.textos.length === 9),
    'every KPI of the market can be charted');
  assert.equal(general.kpis[0].grafico.semanasPromedio, 8);
  assert.equal(general.kpis[0].favorable, false);
  assert.match(general.kpis[0].cambio, /^\+\d,\d\d pp$/);
  assert.match(argentina.texto, /^Orders [+−]?\d/);
  assert.equal(historia.totalPerformance, analisis.performance.length);
  assert.equal(historia.cierre.pasos.length, 3);
  assert.ok(Array.isArray(historia.cierre.pasos[2].lista));
  assert.doesNotMatch(JSON.stringify(historia), /undefined|NaN|porque|debido a|estacionalidad/);
});

test('weekly story: a headline KPI held back by a data finding keeps its value and gets no change', () => {
  const { m, analisis } = resultado();
  const historia = m.vistaWeekly(analisis).historia;
  const chile = historia.paises.find(p => p.nombre === 'Chile');
  const primero = chile.segmentos[0].kpis[0];
  assert.equal(primero.nombre, 'Orders');
  assert.equal(primero.cambio, null, 'a KPI held back has a chart and no change');
  assert.equal(primero.grafico.valores[8], null);
  assert.equal(primero.grafico.textos[8], 'sin dato');
  assert.match(primero.dato, /no se puede comparar/);
  assert.equal(primero.hipotesis, null, 'nothing is explained without a comparison');
  assert.match(chile.texto, /^Orders no se puede comparar esta semana: el dato está a revisar/);
  assert.equal(chile.calidadAltas, 1);
  assert.match(chile.nota, /Hay 1 dato\(s\) de Chile a revisar/);
  const ordenes = analisis.panorama.find(e => e.entidad === 'Chile').topline[0];
  assert.equal(ordenes.valor, null);
  assert.equal(ordenes.cambio, null);
});

test('page: the three chapters of the weekly story and the data lists are in the markup', () => {
  for (const texto of ['Capítulo 1 · LATAM', 'Capítulo 2 · País por país', 'Capítulo 3 · Resumen semanal LATAM',
    'Lo que más se movió', 'Posible causa · hipótesis a validar', 'Datos a revisar esta semana', 'Datos a revisar semana pasada']) {
    assert.ok(pagina.includes(texto), texto);
  }
  assert.doesNotMatch(pagina, /Capítulo 4/);
});

test('weekly story: the region is told through its high and low performers', () => {
  const { m, analisis } = resultado();
  const region = analisis.panorama.find(e => e.tipoEntidad === 'LATAM');
  assert.ok(analisis.panorama.filter(e => e.tipoEntidad !== 'LATAM').every(e => e.movidas === undefined));
  assert.equal(region.recorrido, undefined);
  const movidas = m.vistaWeekly(analisis).historia.regional.movidas;
  assert.equal(movidas.length, 1, 'only what moved beyond its usual variation');
  assert.equal(movidas[0].nombre, 'Fail Rate');
  assert.equal(movidas[0].favorable, false);
  assert.match(movidas[0].dato, /^Pasó de .+ a 4,00 %: .+× su variación típica\./);
  assert.equal(typeof movidas[0].hipotesis, 'string');
});

test('high and low performers: both sides are taken, in order of strength', () => {
  const m = motor();
  const ctx = { porId: { a: { direccion: 1 }, b: { direccion: 1 }, c: { direccion: -1 }, d: { direccion: 1 }, e: { direccion: null }, f: { direccion: 1 } } };
  const propios = { a: { cambio: -1 }, b: { cambio: -1 }, c: { cambio: 1 }, d: { cambio: -1 }, e: { cambio: 1 }, f: { cambio: 1 } };
  const fuertes = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(Array.from(m.weeklyMotorAltosYBajos_(ctx, propios, fuertes, 4)), ['a', 'b', 'c', 'f'],
    'two unfavourable, then the only favourable one and the next strongest');
  assert.deepEqual(Array.from(m.weeklyMotorAltosYBajos_(ctx, propios, ['f', 'e'], 4)), ['f', 'e']);
  assert.deepEqual(Array.from(m.weeklyMotorAltosYBajos_(ctx, propios, [], 4)), []);
});

test('page: nothing moves by itself, the reader picks the KPI of the chart', () => {
  assert.doesNotMatch(script, /setInterval|setTimeout/);
  assert.match(script, /estado\.orden\[0\] = indice;/);
  assert.match(script, /estado\.segmento = s\.nombre;/);
  assert.doesNotMatch(pagina, /carrusel|lamina/);
});

test('web entry point: the only doGet serves the story page', () => {
  const web = fs.readFileSync(path.join(root, 'Web.gs'), 'utf8');
  assert.match(web, /createHtmlOutputFromFile\('Resumen'\)/);
  assert.doesNotMatch(web, /\r|[\t ]+$/m);
  const conDoGet = fs.readdirSync(root).filter(nombre => /\.gs$/.test(nombre))
    .filter(nombre => /function doGet\(/.test(fs.readFileSync(path.join(root, nombre), 'utf8')));
  assert.deepEqual(conDoGet, ['Web.gs']);
  let pedido = null;
  const salida = { setTitle: titulo => { salida.titulo = titulo; return salida; }, addMetaTag: () => salida };
  const ctx = vm.createContext({ HtmlService: { createHtmlOutputFromFile: nombre => { pedido = nombre; return salida; } } });
  vm.runInContext(web, ctx);
  assert.equal(ctx.doGet(), salida);
  assert.equal(pedido, 'Resumen');
  assert.equal(salida.titulo, 'Weekly Performance Review');
});

test('apps script project: no global name is declared in two files', () => {
  const vistos = {};
  fs.readdirSync(root).filter(nombre => /\.gs$/.test(nombre)).forEach(nombre => {
    const texto = fs.readFileSync(path.join(root, nombre), 'utf8');
    for (const hallado of texto.matchAll(/^(?:function|const|let|var) +([A-Za-z_0-9]+)/gm)) {
      assert.equal(vistos[hallado[1]], undefined, hallado[1] + ' is declared in ' + vistos[hallado[1]] + ' and ' + nombre);
      vistos[hallado[1]] = nombre;
    }
  });
  assert.ok(Object.keys(vistos).length > 40);
});

test('data to review: this week and the saved previous week, each telling what is still open', () => {
  const { m, analisis } = resultado();
  const vista = m.vistaWeekly(analisis);
  assert.equal(vista.formato, 4);
  m.weeklyRegistroCompara_(vista, null);
  assert.equal(vista.revisar.anterior, null);
  const chile = vista.revisar.actual.find(g => g.entidades.includes('Chile') && g.titulo === 'Falta el dato de la última semana');
  assert.equal(chile.kpi, 'Overall › Orders');
  assert.equal(chile.severidad, 'alta');
  assert.equal(chile.marcados, null, 'without a saved previous week nothing is tagged');
  assert.equal(typeof chile.detalle, 'string');
  assert.equal(vista.revisar.actual[0].severidad, 'alta', 'high priority first');
  const claves = m.weeklyRegistroClavesDe_(vista);
  claves.calidad.push({ k: 'Argentina|orders|CERO_SOSPECHOSO', entidad: 'Argentina', kpi: 'Overall › Orders', fila: 9,
    titulo: 'Cero sospechoso', severidad: 'alta' });
  m.weeklyRegistroCompara_(vista, claves);
  assert.equal(vista.revisar.actual.find(g => g.kpi === 'Overall › Orders').marcados, 0, 'known since the previous week');
  assert.equal(vista.revisar.anterior.semana, vista.semanaAnterior);
  const cero = vista.revisar.anterior.grupos.find(g => g.titulo === 'Cero sospechoso');
  assert.deepEqual(Array.from(cero.entidades), ['Argentina']);
  assert.equal(cero.marcados, 0, 'gone this week');
  assert.equal(vista.revisar.anterior.grupos.find(g => g.titulo === 'Falta el dato de la última semana').marcados, 1, 'still open');
  assert.doesNotMatch(JSON.stringify(vista.revisar), /undefined|NaN/);
});

test('segments: every market carries the sections of the sheet with what moved the most first', () => {
  const { m, analisis } = resultado();
  const historia = m.vistaWeekly(analisis).historia;
  const argentina = historia.paises.find(p => p.nombre === 'Argentina');
  assert.deepEqual(Array.from(argentina.segmentos.map(s => s.nombre)), ['Todo el país', 'Overall'], 'sections keep the name of the sheet');
  const overall = argentina.segmentos[1];
  assert.equal(overall.movidos, 1);
  assert.equal(overall.total, 3);
  assert.match(overall.texto, /^1 de 3 KPIs de Overall se movió por encima de su variación habitual/);
  assert.deepEqual(Array.from(overall.kpis.map(k => k.nombre)), ['Fail Rate', 'Orders', 'Dmarts'], 'the move first, then the KPI that opens the section');
  assert.match(overall.kpis[0].dato, /^Pasó de .+ a 5,00 %: .+× su variación típica\./);
  assert.equal(typeof overall.kpis[0].hipotesis, 'string');
  const quieto = overall.kpis.find(k => k.nombre === 'Orders');
  assert.match(quieto.dato, /Está dentro de lo habitual\.$/);
  assert.equal(quieto.hipotesis, null, 'a move inside the usual range is not given company');
  const chile = historia.paises.find(p => p.nombre === 'Chile').segmentos[1];
  assert.equal(chile.total, 2, 'a KPI the market does not operate is not counted');
  assert.ok(chile.kpis.every(k => k.nombre !== 'Dmarts'));
  assert.match(chile.texto, /^Ningún KPI de Overall se movió/);
  assert.doesNotMatch(JSON.stringify(historia), /Órdenes|GMV confirmado|Clientes activos/);
});

test('segments: the KPI that opens the section keeps a place when more KPIs moved than fit', () => {
  const m = motor();
  const kpi = (fila, bloque) => ({ id: 'F' + fila, fila: fila, seccion: 'Users', bloque: bloque, def: { tipo: 'campo' } });
  const propias = [kpi(1, 'A'), kpi(2, 'A'), kpi(3, 'A'), kpi(4, 'B'), kpi(5, 'B'), kpi(6, 'B')];
  const mov = (intensidad, alerta) => ({ intensidad: intensidad, alerta: !!alerta, cambio: 0.1 });
  const propios = { F1: mov(0.5), F2: mov(9, true), F3: mov(4), F4: mov(3), F5: mov(7, true), F6: mov(2.5) };
  const ctx = { cfg: { zCoMovimiento: 2 } };
  const corte = m.weeklyMotorDeSeccion_(ctx, propias, propios, {}, 4);
  assert.deepEqual(Array.from(corte.elegidos.map(k => k.id)), ['F2', 'F5', 'F3', 'F1']);
  assert.equal(corte.movidos, 5);
  assert.equal(corte.total, 6);
  const sinMovimiento = m.weeklyMotorDeSeccion_(ctx, propias, {}, { F1: true }, 3);
  assert.deepEqual(Array.from(sinMovimiento.elegidos.map(k => k.id)), ['F2', 'F4', 'F3'], 'block leaders, then sheet order');
  assert.equal(sinMovimiento.movidos, 0);
  assert.equal(sinMovimiento.total, 5);
});

test('KPI names: the name of the row in the sheet, with its group when it has one', () => {
  const m = motor();
  assert.equal(m.weeklyResumenCorto_({ etiqueta: 'Overall › Orders', nombre: 'Orders - Total', clave: 'orders' }), 'Orders - Total');
  assert.equal(m.weeklyResumenCorto_({ etiqueta: 'Overall › Order Share › Food', nombre: 'Food', clave: '' }), 'Order Share › Food');
  assert.equal(m.weeklyResumenCorto_({ etiqueta: 'Users › Active Customers', nombre: 'Active Customers', clave: 'active_customers' }), 'Active Customers');
});

test('page: the segments of the sheet are buttons inside the market', () => {
  for (const nombre of ['segmentos', 'segmento-texto', 'kpi-elegido', 'kpi-dato', 'kpi-hipotesis', 'pais-nota']) {
    assert.ok(pagina.includes('id="' + nombre + '"'), nombre);
  }
  assert.match(script, /pais\.segmentos\.forEach/);
  assert.doesNotMatch(script, /pais\.kpis|pais\.hipotesis|grafico\.serie/);
});
