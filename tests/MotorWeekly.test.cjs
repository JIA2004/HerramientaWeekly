const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { desplaza, fechaDeSerial } = require('../herramientas/xlsx.cjs');

function motor() {
  const contexto = vm.createContext({});
  ['MotorWeekly.gs', 'ResumenWeekly.gs', 'FuenteWeekly.gs'].forEach(nombre => {
    vm.runInContext(fs.readFileSync(path.join(root, nombre), 'utf8'), contexto, { filename: nombre });
  });
  return contexto;
}

// Synthetic sheet rows mirroring the real layout: a section header, a total
// with its parts, a share sub-block, a rate and a "lower is better" KPI.
const FILAS = [
  { fila: 8, direccion: null, clave: 'Nombre tabla BQ', nombre: 'Overall', formulaValor: null, formulaVariacion: null },
  { fila: 9, direccion: 1, clave: 'orders', nombre: 'Orders - Total', formulaValor: 'IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C9, X!$1:$1, 0)), X!$A:$A, M$6, X!$C:$C, $E$4), "")', formulaVariacion: 'M9/L9-1' },
  { fila: 10, direccion: 1, clave: 'orders_food', nombre: 'Food', formulaValor: 'IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C10, X!$1:$1, 0)), X!$A:$A, M$6, X!$C:$C, $E$4), "")', formulaVariacion: 'M10/L10-1' },
  { fila: 11, direccion: 1, clave: 'orders_dmarts', nombre: 'Dmarts', formulaValor: 'IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C11, X!$1:$1, 0)), X!$A:$A, M$6, X!$C:$C, $E$4), "")', formulaVariacion: 'M11/L11-1' },
  { fila: 12, direccion: 1, clave: '', nombre: 'Order Share ', formulaValor: null, formulaVariacion: null },
  { fila: 13, direccion: 1, clave: '', nombre: 'Food', formulaValor: 'M10/M9', formulaVariacion: '' },
  { fila: 15, direccion: null, clave: '', nombre: 'Quality', formulaValor: null, formulaVariacion: null },
  { fila: 16, direccion: -1, clave: 'fail_rate', nombre: 'Fail Rate', formulaValor: 'IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C16, X!$1:$1, 0)), X!$A:$A, M$6, X!$C:$C, $E$4), "")', formulaVariacion: '(M16-L16)*100' },
  { fila: 17, direccion: 1, clave: 'orders_dmarts', nombre: 'Confirmed Orders', formulaValor: 'IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C17, X!$1:$1, 0)), X!$A:$A, M$6, X!$C:$C, $E$4), "")', formulaVariacion: 'M17/L17-1' },
  { fila: 18, direccion: 1, clave: 'x', nombre: 'Rara', formulaValor: 'M9+M10-3', formulaVariacion: 'M18/L18-1' }
];

function semanas(n) {
  const lista = [];
  for (let i = 0; i < n; i++) lista.push(new Date(Date.UTC(2026, 0, 5) + i * 7 * 86400000).toISOString().slice(0, 10));
  return lista;
}

// Deterministic small noise so every series has a measurable typical variation.
function ruido(i, k) { return Math.sin(i * 1.7 + k) * 0.01; }

function escenario(ajuste) {
  const m = motor();
  const lista = semanas(40);
  const paises = ['Argentina', 'Bolivia', 'Chile', 'Perú', 'LATAM'];
  const datos = {};
  paises.forEach((pais, k) => {
    datos[pais] = { orders: {}, orders_food: {}, orders_dmarts: {}, fail_rate: {} };
    lista.forEach((semana, i) => {
      const food = Math.round(7000 * (1 + ruido(i, k)));
      const dmarts = Math.round(3000 * (1 + ruido(i, k + 3)));
      datos[pais].orders_food[semana] = food;
      datos[pais].orders_dmarts[semana] = dmarts;
      datos[pais].orders[semana] = food + dmarts;
      datos[pais].fail_rate[semana] = 0.02 + ruido(i, k + 5) * 0.05;
    });
  });
  const ultima = lista[lista.length - 1];
  if (ajuste) ajuste(datos, ultima, lista);
  const entrada = { semanas: lista, datos, catalogo: m.weeklyMotorCatalogo_(FILAS), semanaEsperada: ultima,
    entidades: paises.map(nombre => ({ nombre, tipo: nombre === 'LATAM' ? 'LATAM' : 'pais' })) };
  return { m, entrada, ultima, resultado: m.analizarWeekly(entrada) };
}

const de = (lista, entidad, id) => lista.filter(h => h.entidad === entidad && h.kpi.id === id);

test('normalization: engine files use LF without BOM or trailing whitespace', () => {
  for (const name of ['MotorWeekly.gs', 'ResumenWeekly.gs', 'herramientas/xlsx.cjs',
    'herramientas/analizar.cjs', 'tests/MotorWeekly.test.cjs']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.ok(!text.startsWith('﻿'), `${name}: unexpected BOM`);
    assert.doesNotMatch(text, /\r|[\t ]+$/m, `${name}: non-normalized whitespace`);
    assert.ok(text.endsWith('\n'), `${name}: missing final newline`);
  }
});

test('static isolation: the engine touches no Apps Script service, network or clock', () => {
  for (const name of ['MotorWeekly.gs', 'ResumenWeekly.gs']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(text, /SpreadsheetApp|UrlFetchApp|LockService|BigQuery|Utilities\.|new Date\(\)|Date\.now|Math\.random/, name);
  }
});

test('catalog: sections, context labels, units, derived definitions, parts and duplicates', () => {
  const catalogo = motor().weeklyMotorCatalogo_(FILAS);
  const porId = Object.fromEntries(catalogo.kpis.map(k => [k.id, k]));
  assert.deepEqual(Array.from(catalogo.kpis.map(k => k.id)), ['F9', 'F10', 'F11', 'F13', 'F16', 'F17', 'F18']);
  assert.equal(porId.F9.etiqueta, 'Overall › Orders');
  assert.equal(porId.F10.etiqueta, 'Overall › Orders › Food');
  assert.equal(porId.F13.etiqueta, 'Overall › Order Share › Food');
  assert.equal(porId.F16.etiqueta, 'Quality › Fail Rate');
  assert.deepEqual(JSON.parse(JSON.stringify(porId.F9.partes)), ['F10', 'F11']);
  assert.deepEqual(JSON.parse(JSON.stringify(porId.F13.def)), { tipo: 'razon', num: 'F10', den: 'F9' });
  assert.equal(porId.F13.unidad, 'pp');
  assert.equal(porId.F16.unidad, 'pp');
  assert.equal(porId.F16.direccion, -1);
  assert.equal(porId.F9.unidad, 'rel');
  assert.equal(porId.F17.duplicadoDe, 'F11');
  assert.equal(porId.F18.def, null);
  assert.ok(catalogo.advertencias.some(texto => /Fila 18/.test(texto) && /no reconocida/.test(texto)));
});

test('catalog: a ratio over the extracted field and a sum range are recognized', () => {
  const m = motor();
  assert.deepEqual(JSON.parse(JSON.stringify(m.weeklyMotorDefinicion_(
    'IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C82, X!$1:$1, 0)), X!$A:$A, M$6), "") / M63', 82, 'orders_dt_35'))),
  { tipo: 'campoSobre', campo: 'orders_dt_35', den: 'F63' });
  assert.deepEqual(JSON.parse(JSON.stringify(m.weeklyMotorDefinicion_('sum(M23:M25)', 22, 'gmv'))),
    { tipo: 'suma', partes: ['F23', 'F24', 'F25'] });
  assert.deepEqual(JSON.parse(JSON.stringify(m.weeklyMotorDefinicion_('M111*M114', 116, 'FORMULA'))),
    { tipo: 'producto', a: 'F111', b: 'F114' });
});

test('quiet week: no performance alert and no quality finding', () => {
  const { resultado } = escenario();
  assert.equal(resultado.performance.length, 0);
  assert.equal(resultado.calidad.length, 0);
  assert.equal(resultado.globales.length, 0);
  assert.equal(resultado.catalogo.analizados, 5);
});

test('performance: an unusual drop is alerted with its values, direction and evidence of scope', () => {
  const { resultado, ultima } = escenario((datos, semana) => {
    datos.Argentina.orders_food[semana] = 5600;
    datos.Argentina.orders[semana] = 5600 + datos.Argentina.orders_dmarts[semana];
  });
  const total = de(resultado.performance, 'Argentina', 'F9')[0];
  assert.ok(total, 'orders total must be alerted');
  assert.equal(total.semana, ultima);
  assert.equal(total.sentido, 'baja');
  assert.equal(total.favorable, false);
  assert.equal(total.metodo, 'historico');
  assert.ok(Math.abs(total.z) >= 3.5);
  assert.ok(Math.abs(total.cambio - (total.valor / total.valorAnterior - 1)) < 1e-12);
  assert.equal(total.explicaciones.alcance.lectura, 'local');
  assert.equal(total.explicaciones.alcance.otrosPaisesComparables, 3, 'LATAM is never counted as a country');
  assert.equal(total.explicaciones.partes[0].kpi.id, 'F10');
  assert.ok(total.explicaciones.partes[0].aporte > 0.9);
  const share = de(resultado.performance, 'Argentina', 'F13')[0];
  assert.deepEqual(Array.from(share.explicaciones.componentes.map(c => c.rol)), ['numerador', 'denominador']);
  assert.equal(de(resultado.performance, 'Chile', 'F9').length, 0);
});

test('performance: a rise in a lower-is-better KPI is unfavourable and measured in points', () => {
  const { resultado } = escenario((datos, semana) => { datos.Chile.fail_rate[semana] = 0.05; });
  const alerta = de(resultado.performance, 'Chile', 'F16')[0];
  assert.equal(alerta.unidad, 'pp');
  assert.equal(alerta.sentido, 'sube');
  assert.equal(alerta.favorable, false);
  assert.ok(Math.abs(alerta.cambio - (alerta.valor - alerta.valorAnterior)) < 1e-12);
});

test('performance: the same move in several countries is read as widespread', () => {
  const { resultado } = escenario((datos, semana) => {
    ['Argentina', 'Bolivia', 'Chile'].forEach(pais => { datos[pais].fail_rate[semana] = 0.05; });
  });
  const alerta = de(resultado.performance, 'Argentina', 'F16')[0];
  assert.equal(alerta.explicaciones.alcance.lectura, 'extendido');
  assert.deepEqual(Array.from(alerta.explicaciones.alcance.otrosPaisesMismoSentido), ['Bolivia', 'Chile']);
});

test('quality: a missing last week is reported, never read as zero, and blocks performance', () => {
  const { resultado } = escenario((datos, semana) => { datos.Bolivia.orders[semana] = null; });
  const hallazgo = de(resultado.calidad, 'Bolivia', 'F9')[0];
  assert.equal(hallazgo.regla, 'FALTANTE_ULTIMA_SEMANA');
  assert.equal(hallazgo.valor, null);
  assert.equal(hallazgo.bloqueaPerformance, true);
  assert.equal(de(resultado.performance, 'Bolivia', 'F9').length, 0);
  const dependiente = de(resultado.calidad, 'Bolivia', 'F13')[0];
  assert.equal(dependiente.regla, 'DEPENDE_DE_DATO_OBSERVADO');
  assert.equal(dependiente.severidad, 'baja');
  assert.equal(de(resultado.performance, 'Bolivia', 'F13').length, 0);
});

test('quality: a real zero after normal values is suspicious, not a -100% performance alert', () => {
  const { resultado } = escenario((datos, semana) => { datos.Perú.orders_dmarts[semana] = 0; });
  assert.equal(de(resultado.calidad, 'Perú', 'F11')[0].regla, 'CERO_SOSPECHOSO');
  assert.equal(de(resultado.performance, 'Perú', 'F11').length, 0);
});

test('quality: a vertical that never operated is silent and listed apart', () => {
  const { resultado } = escenario((datos, semana, lista) => {
    lista.forEach(s => { datos.Chile.orders_dmarts[s] = 0; });
  });
  assert.equal(de(resultado.calidad, 'Chile', 'F11').length, 0);
  assert.ok(resultado.noOpera.some(x => x.entidad === 'Chile' && x.kpi.id === 'F11'));
});

test('quality: a proportion outside 0-100%, a text value and an out-of-scale jump', () => {
  const fuera = escenario((datos, semana) => { datos.Chile.fail_rate[semana] = 1.2; }).resultado;
  assert.ok(de(fuera.calidad, 'Chile', 'F16').some(h => h.regla === 'FUERA_DE_RANGO'));
  assert.equal(de(fuera.performance, 'Chile', 'F16').length, 0);
  const texto = escenario((datos, semana) => { datos.Chile.orders[semana] = '#N/A'; }).resultado;
  assert.equal(de(texto.calidad, 'Chile', 'F9')[0].regla, 'VALOR_NO_NUMERICO');
  const salto = escenario((datos, semana) => { datos.Chile.orders[semana] = 400; }).resultado;
  assert.equal(de(salto.calidad, 'Chile', 'F9')[0].regla, 'SALTO_FUERA_DE_ESCALA');
  assert.equal(de(salto.performance, 'Chile', 'F9').length, 0);
});

test('quality: an erratic series is flagged as unreliable instead of alerting every week', () => {
  const { resultado } = escenario((datos, semana, lista) => {
    lista.slice(-8).forEach((s, i) => { datos.Chile.fail_rate[s] = i % 2 ? 0.9 : 0.1; });
  });
  assert.ok(de(resultado.calidad, 'Chile', 'F16').some(h => h.regla === 'SERIE_INESTABLE'));
  assert.equal(de(resultado.performance, 'Chile', 'F16').length, 0);
});

test('load state: an outdated last week and a skipped week are global findings', () => {
  const m = motor();
  const { entrada } = escenario();
  entrada.semanaEsperada = '2026-12-28';
  assert.equal(m.analizarWeekly(entrada).globales[0].regla, 'SEMANA_ESPERADA_AUSENTE');
  entrada.semanaEsperada = null;
  entrada.semanas = entrada.semanas.filter((_, i) => i !== 36);
  assert.ok(m.analizarWeekly(entrada).globales.some(g => g.regla === 'SEMANA_SALTEADA'));
});

test('sum: an absent part counts as zero, a part missing one week makes the total unknown', () => {
  const m = motor();
  const filas = FILAS.filter(f => f.fila !== 18).map(f => (f.fila === 9
    ? Object.assign({}, f, { formulaValor: 'sum(M10:M11)' }) : f));
  const { entrada, ultima } = escenario();
  entrada.catalogo = m.weeklyMotorCatalogo_(filas);
  entrada.semanas.forEach(s => { entrada.datos.Chile.orders_dmarts[s] = null; });
  entrada.datos.Perú.orders_dmarts[ultima] = null;
  const resultado = m.analizarWeekly(entrada);
  assert.equal(de(resultado.calidad, 'Chile', 'F9').length, 0);
  assert.equal(de(resultado.calidad, 'Perú', 'F11')[0].regla, 'FALTANTE_ULTIMA_SEMANA');
  assert.equal(de(resultado.calidad, 'Perú', 'F9')[0].regla, 'DEPENDE_DE_DATO_OBSERVADO');
});

test('summary: Spanish text carries the compared values, the row and the stated limits', () => {
  const { m, resultado } = escenario((datos, semana) => {
    datos.Chile.fail_rate[semana] = 0.05;
    datos.Bolivia.orders[semana] = null;
  });
  const texto = m.resumirWeekly(resultado);
  assert.match(texto, /\*\*Chile\*\* — Quality › Fail Rate sube \+\d,\d\d pp \(\d,\d\d % → 5,00 %\), desfavorable/);
  assert.match(texto, /Fila 16\./);
  assert.match(texto, /FALTANTE_ULTIMA_SEMANA/);
  assert.match(texto, /no demuestran causa/);
  assert.doesNotMatch(texto, /undefined|NaN|null/);
  assert.equal(m.weeklyResumenDecimal_(1234567.891, 1), '1.234.567,9');
});

test('local reader helpers: shared formula shifting, serial dates and the last closed week', () => {
  assert.equal(desplaza('M9/L9-1', 3, 0), 'M12/L12-1');
  assert.equal(desplaza("'Weekly LATAM'!N9", 2, 1), "'Weekly LATAM'!O11");
  assert.equal(desplaza('E10/E$22', 1, 2), 'G11/G$22');
  assert.equal(desplaza('IF($E$4="LATAM A1", SUM(A1:B2), 0)', 1, 1), 'IF($E$4="LATAM A1", SUM(B2:C3), 0)');
  assert.equal(fechaDeSerial(46293), '2026-09-28');
  assert.equal(motor().weeklyFuenteUltimaCerrada_('2026-10-06'), '2026-09-28');
  assert.equal(motor().weeklyFuenteUltimaCerrada_('2026-10-05'), '2026-09-28');
  assert.equal(motor().weeklyFuenteUltimaCerrada_('2026-10-04'), '2026-09-21');
});

test('catalog: the key column may be any letter, the row must be the KPI own row', () => {
  const m = motor();
  const formula = col => 'IFERROR(SUMIFS(INDEX(X!$A:$BS; 0; MATCH($' + col + '9; X!$1:$1; 0)); X!$A:$A; N$6); "")';
  assert.equal(m.weeklyMotorDefinicion_(formula('C'), 9, 'orders').campo, 'orders');
  assert.equal(m.weeklyMotorDefinicion_(formula('D'), 9, 'orders').campo, 'orders');
  assert.equal(m.weeklyMotorDefinicion_(formula('AB'), 9, 'orders').campo, 'orders');
  assert.equal(m.weeklyMotorDefinicion_(formula('C'), 10, 'orders'), null);
});

// Twelve extra fields so a market carries enough of them for the coverage check.
function conCampos(entrada) {
  Object.keys(entrada.datos).forEach(pais => {
    for (let k = 0; k < 12; k++) {
      const serie = entrada.datos[pais]['extra_' + k] = {};
      entrada.semanas.forEach(semana => { serie[semana] = 100 + k; });
    }
  });
  return entrada;
}

test('load state: not refreshed yet is told apart from refreshed without the week', () => {
  const m = motor();
  const { entrada, ultima } = escenario();
  const siguiente = new Date(Date.parse(ultima) + 7 * 86400000).toISOString().slice(0, 10);
  const lunesActual = new Date(Date.parse(ultima) + 14 * 86400000).toISOString().slice(0, 10);
  entrada.semanaEsperada = siguiente;
  entrada.ultimaActualizacion = new Date(Date.parse(lunesActual) - 3 * 86400000).toISOString().slice(0, 10);
  const pendiente = m.analizarWeekly(entrada);
  assert.equal(pendiente.globales[0].regla, 'ACTUALIZACION_PENDIENTE');
  assert.equal(pendiente.provisoria, true);
  assert.match(pendiente.globales[0].detalle, new RegExp('lo que se muestra es la semana del ' + ultima));
  entrada.ultimaActualizacion = lunesActual;
  const ausente = m.analizarWeekly(entrada);
  assert.equal(ausente.globales[0].regla, 'SEMANA_ESPERADA_AUSENTE');
  assert.match(ausente.globales[0].detalle, /sí se actualizaron/);
  entrada.semanaEsperada = ultima;
  const alDia = m.analizarWeekly(entrada);
  assert.equal(alDia.provisoria, false);
  assert.equal(alDia.globales.length, 0);
});

test('load state: a market loaded half way is one finding and is not interpreted', () => {
  const m = motor();
  const { entrada, ultima } = escenario();
  conCampos(entrada);
  entrada.semanaEsperada = ultima;
  const completo = m.analizarWeekly(entrada);
  assert.equal(completo.provisoria, false);
  assert.deepEqual(Array.from(completo.cargaParcial), []);
  Object.keys(entrada.datos.Chile).forEach((campo, i) => { if (i % 2) entrada.datos.Chile[campo][ultima] = null; });
  const parcial = m.analizarWeekly(entrada);
  const hallazgo = parcial.globales.find(g => g.regla === 'CARGA_PARCIAL');
  assert.deepEqual(Array.from(hallazgo.entidades), ['Chile']);
  assert.equal(parcial.provisoria, true);
  assert.deepEqual(Array.from(parcial.cargaParcial), ['Chile']);
  assert.equal(parcial.calidad.filter(h => h.entidad === 'Chile').length, 0, 'no per-KPI noise for a market still loading');
  assert.equal(parcial.performance.filter(a => a.entidad === 'Chile').length, 0);
  assert.ok(parcial.calidad.length + parcial.performance.length >= 0);
  entrada.filasDuplicadas = 2;
  const repetidas = m.analizarWeekly(entrada).globales.find(g => g.regla === 'FILAS_DUPLICADAS');
  assert.equal(repetidas.provisoria, undefined);
});

test('identity: the uid of a KPI survives inserted rows and renamed sections, and is unique', () => {
  const m = motor();
  const antes = m.weeklyMotorCatalogo_(FILAS).kpis;
  assert.equal(new Set(antes.map(k => k.uid)).size, antes.length);
  const porFila = Object.fromEntries(antes.map(k => [k.fila, k]));
  assert.equal(porFila[9].uid, 'orders');
  assert.equal(porFila[13].uid, 'orders_food/orders', 'a derived row is named after its inputs');
  assert.equal(porFila[11].uid, 'orders_dmarts');
  assert.equal(porFila[17].uid, 'orders_dmarts~2', 'the same extract column on a later row');
  // Every row moves three places down, formulas follow, and a section is renamed.
  const corre = texto => (texto ? texto.replace(/([A-Z]\$?)(\d+)/g, (todo, col, fila) => (Number(fila) >= 8 ? col + (Number(fila) + 3) : todo)) : texto);
  const movidas = FILAS.map(f => Object.assign({}, f, { fila: f.fila + 3, nombre: f.nombre === 'Overall' ? 'Resumen general' : f.nombre,
    formulaValor: corre(f.formulaValor), formulaVariacion: corre(f.formulaVariacion) }));
  const despues = m.weeklyMotorCatalogo_(movidas).kpis;
  assert.equal(despues.length, antes.length);
  assert.notDeepEqual(Array.from(despues.map(k => k.id)), Array.from(antes.map(k => k.id)));
  assert.notEqual(despues[0].etiqueta, antes[0].etiqueta);
  assert.deepEqual(Array.from(despues.map(k => k.uid)), Array.from(antes.map(k => k.uid)));
  const ref = m.weeklyMotorKpiRef_(despues[0]);
  assert.equal(ref.uid, 'orders');
  assert.equal(ref.id, 'F12', 'the row-based id is still there for formulas');
});
