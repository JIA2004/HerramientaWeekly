const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { cargarMotor } = require('../herramientas/analizar.cjs');
const { leerGlosario, construirDiccionario, textoDiccionario, contextoAgente, textoAgente } =require('../herramientas/diccionario.cjs');
const { validarLectura, filasIncompletas, textoValidacion } = require('../herramientas/validar.cjs');

const LUNES = i => new Date(Date.UTC(2026, 0, 5 + i * 7, 3));
const iso = fecha => fecha.toISOString().slice(0, 10);
const SUMIFS = (fila, col) => `=IFERROR(SUMIFS(INDEX('Extract Tabla Weekly'!$A:$BS; 0; MATCH($C${fila}; 'Extract Tabla Weekly'!$1:$1; 0)); 'Extract Tabla Weekly'!$A:$A; ${col}$6; 'Extract Tabla Weekly'!$C:$C; $E$4); "")`;
const CAMPOS = ['orders', 'orders_food', 'share_a', 'share_b', 'food_quality', 'incentives'];
const SEMANAS = 'EFGHIJKLM';

// Synthetic extract: three markets, 40 weeks, no real figure.
function extract(ajuste) {
  const valores = [['week_date', 'country_id', 'country_name'].concat(CAMPOS, ['last_update'])];
  ['Argentina', 'Chile', 'LATAM'].forEach((pais, k) => {
    for (let i = 0; i < 40; i++) {
      const food = Math.round(7000 * (1 + Math.sin(i * 1.7 + k) * 0.01));
      valores.push([LUNES(i), k + 1, pais, food + 3000, food, 0.3 + Math.sin(i + k) * 0.001, 0.2 + Math.cos(i + k) * 0.001,
        0.02 + Math.sin(i * 2 + k) * 0.0005, 500000 + i * 10 + k, new Date(Date.UTC(2026, 9, 5, 18))]);
    }
  });
  if (ajuste) ajuste(valores);
  return valores;
}

// Synthetic "2) Weekly por pais" showing what the extract holds for the market
// in the selector (E4): direction in B, key in C, name in D, weeks in E:M, WoW in O.
function hoja(datos, pais) {
  const vacia = () => new Array(16).fill('');
  const valores = [];
  const formulas = [];
  const pone = (fila, col, valor, formula) => {
    while (valores.length < fila) { valores.push(vacia()); formulas.push(vacia()); }
    valores[fila - 1][col] = valor;
    if (formula) formulas[fila - 1][col] = formula;
  };
  const desde = datos.findIndex(fila => fila[2] === pais);
  const crudo = (campo, i) => datos[desde + 31 + i][3 + CAMPOS.indexOf(campo)];
  const fila = (n, direccion, clave, nombre, variacion, valor, formula) => {
    if (direccion !== null) pone(n, 1, direccion);
    pone(n, 2, clave); pone(n, 3, nombre);
    for (let i = 0; i < 9; i++) pone(n, 4 + i, valor(i), formula ? formula(SEMANAS[i]) : SUMIFS(n, SEMANAS[i]));
    pone(n, 14, 0, variacion);
  };
  const campo = nombre => i => crudo(nombre, i);
  pone(4, 3, 'Country'); pone(4, 4, pais);
  pone(6, 3, 'KPI');
  for (let i = 0; i < 9; i++) pone(6, 4 + i, LUNES(31 + i), '=TODAY()');
  pone(6, 14, 'WoW');
  pone(8, 3, 'Overall');
  fila(9, 1, 'orders', 'Orders - Total', '=M9/L9-1', campo('orders'));
  fila(10, 1, 'orders_food', 'Food', '=M10/L10-1', campo('orders_food'));
  formulas[9][2] = '=IFERROR(VLOOKUP(D10; Weekly_Glossary!$B$4:$C$148; 2; FALSE); "")';
  fila(11, 1, 'share_a', 'Share A', '=(M11-L11)*100', campo('share_a'));
  fila(12, 1, 'share_b', 'Share B', '=(M12-L12)*100', campo('share_b'));
  fila(13, 1, 'FORMULA', 'Share resto', '=IF(C13="";"";M13-L13)', i => 1 - crudo('share_a', i) - crudo('share_b', i), col => `=100%-${col}11-${col}12`);
  pone(14, 3, 'Quality');
  fila(15, -1, 'food_quality', 'Food', '=(M15-L15)*100', campo('food_quality'));
  fila(16, null, '', 'Sin clave', '=M16/L16-1', () => '');
  fila(17, 1, 'incentives', 'Incentivos (M eur)', '=M17/L17-1', campo('incentives'));
  return { valores, formulas };
}

const GLOSARIO = [
  ['', '', '', ''],
  ['', 'Metrica', 'Nombre tabla weekly', 'Descripción'],
  ['', 'Orders - Total', 'orders', 'Órdenes confirmadas.'],
  ['', 'Food', 'orders_food', ''],
  ['', 'Food', 'food_quality', 'Calidad de Food.'],
  ['', 'Sin uso', 'otra_cosa', 'No está en la hoja.']
];

function armar(ajusteDatos, ajusteHoja) {
  const motor = cargarMotor();
  const datos = extract(ajusteDatos);
  const kpis = hoja(datos, 'Argentina');
  if (ajusteHoja) ajusteHoja(kpis);
  const aIso = valor => motor.weeklyFuenteFecha_(valor, iso);
  const armado = Object.assign(motor.weeklyFuenteEntrada_(kpis.valores, kpis.formulas, datos, aIso, '2026-10-14'), { motor });
  return { armado, datos, kpis };
}

const control = (validacion, nombre) => validacion.controles.find(c => c.nombre.indexOf(nombre) === 0);

test('normalization: the tools use LF without BOM or trailing whitespace', () => {
  for (const name of ['herramientas/diccionario.cjs', 'herramientas/validar.cjs', 'tests/Herramientas.test.cjs', 'MotorWeekly.gs']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.ok(!text.startsWith('﻿'), `${name}: unexpected BOM`);
    assert.doesNotMatch(text, /\r|[\t ]+$/m, `${name}: non-normalized whitespace`);
    assert.ok(text.endsWith('\n'), `${name}: missing final newline`);
  }
});

test('engine: the remainder of 100 % is read from the sheet formula and stays unknown when a share is missing', () => {
  const { armado } = armar(valores => { valores[40][5] = ''; });
  const resto = armado.entrada.catalogo.kpis.find(kpi => kpi.fila === 13);
  assert.deepEqual(JSON.parse(JSON.stringify(resto.def)), { tipo: 'complemento', partes: ['F11', 'F12'] });
  assert.equal(resto.uid, '1-share_a-share_b');
  assert.equal(resto.unidad, 'pp');
  const serie = armado.motor.weeklyMotorValores_(armado.entrada, 'Argentina').valores.F13;
  assert.equal(serie[39], null, 'a blank share is not taken as zero');
  assert.ok(Math.abs(serie[38] - 0.5) < 0.01);
  assert.equal(armado.coincidencia.diferencias, 0);
});

test('glossary: header, name, key and description columns are found by content', () => {
  const glosario = leerGlosario(GLOSARIO);
  assert.equal(glosario.filas.length, 4);
  assert.equal(glosario.porClave.orders.descripcion, 'Órdenes confirmadas.');
  assert.deepEqual(glosario.porNombre.food.map(g => g.clave), ['orders_food', 'food_quality']);
  assert.equal(leerGlosario(null).filas.length, 0);
  assert.equal(leerGlosario([['a', 'b']]).filas.length, 0);
});

test('dictionary: every row says how it is obtained, its unit, direction and what is left to settle', () => {
  const { armado, kpis } = armar();
  const diccionario = construirDiccionario(armado, kpis.formulas, leerGlosario(GLOSARIO));
  const fila = n => diccionario.entradas.find(k => k.fila === n);
  const tipos = n => fila(n).observaciones.map(o => o.tipo);
  assert.equal(diccionario.entradas.length, 8);
  assert.equal(fila(9).origen, 'Columna `orders` del extract');
  assert.equal(fila(9).descripcion, 'Órdenes confirmadas.');
  assert.equal(fila(9).lider, true);
  assert.equal(fila(9).paisesConDato, 2, 'LATAM is not counted as a country');
  assert.equal(fila(9).latamConDato, true);
  assert.equal(fila(13).origen, '100 % − fila 11 (Share A) − fila 12 (Share B)');
  assert.equal(fila(13).unidad, 'pp');
  assert.ok(tipos(13).includes('unidadInferida'), 'a WoW formula that is neither simple pattern is reported');
  assert.ok(!tipos(11).includes('unidadInferida'));
  // Same visible name in two sections: told apart by uid, and the looked-up key is flagged.
  assert.ok(tipos(10).includes('nombreRepetido') && tipos(15).includes('nombreRepetido'));
  assert.ok(tipos(10).includes('claveAmbigua'));
  assert.ok(!tipos(15).includes('claveAmbigua'), 'a typed key is not ambiguous');
  assert.equal(fila(15).descripcion, 'Calidad de Food.');
  assert.equal(fila(15).direccion, -1);
  assert.ok(tipos(10).includes('sinDescripcion'));
  assert.equal(fila(16).enPrimeraVersion, false);
  assert.match(fila(16).observaciones[0].texto, /clave técnica está vacía.*tampoco tiene dirección/);
  assert.ok(tipos(17).includes('escala'), 'a name in millions with values in units is reported');
  assert.deepEqual(diccionario.glosario.sinUso, ['otra_cosa']);
  const texto = textoDiccionario(diccionario, 'copia de prueba');
  assert.match(texto, /Entran en la primera versión: \*\*7\*\*/);
  assert.match(texto, /Quedan fuera: \*\*1\*\*/);
  assert.match(texto, /\| 16 \| Sin clave \|/);
  assert.doesNotThrow(() => JSON.stringify(diccionario));
});

test('agent context: one entry per extract column, formulas for calculated KPIs, rules and no figures', () => {
  const { armado, kpis } = armar();
  const contexto = contextoAgente(construirDiccionario(armado, kpis.formulas, leerGlosario(GLOSARIO)));
  assert.deepEqual(contexto.columnas.map(c => c.columna), ['orders', 'orders_food', 'share_a', 'share_b', 'food_quality', 'incentives']);
  const columna = nombre => contexto.columnas.find(c => c.columna === nombre);
  assert.equal(columna('orders').definicion, 'Órdenes confirmadas.');
  assert.match(columna('orders').formato, /^Número/);
  assert.match(columna('share_a').formato, /^Proporción entre 0 y 1/);
  assert.equal(columna('food_quality').favorable, 'baja');
  assert.match(columna('orders_food').advertencias[0], /Sin definición validada/);
  assert.match(columna('incentives').advertencias.join(' '), /millones/);
  assert.deepEqual(contexto.calculados.map(c => c.formula), ['1-share_a-share_b']);
  // "Food" is two different columns: the agent is told to choose by context.
  assert.deepEqual(contexto.homonimos.map(h => h.nombre), ['Food']);
  assert.deepEqual(contexto.homonimos[0].opciones.map(o => o.columna), ['orders_food', 'food_quality']);
  assert.ok(contexto.reglas.some(regla => /2 países: Argentina, Chile\. LATAM es el agregado regional/.test(regla)));
  assert.deepEqual(Array.from(contexto.columnasSinContexto), []);
  const texto = textoAgente(contexto);
  assert.match(texto, /- `orders` — Overall › Orders\. Órdenes confirmadas\. Número\./);
  assert.match(texto, /Overall › Orders › Share resto = `1-share_a-share_b`/);
  assert.doesNotMatch(texto, /\d{3}[.,]?\d{3}/, 'no value of the extract is written into the context');
});

test('validation: a clean copy passes every control for every market and week', () => {
  const { armado, datos, kpis } = armar();
  const v = validarLectura(armado, datos);
  assert.deepEqual(v.controles.filter(c => !c.ok).map(c => c.nombre), []);
  assert.equal(v.relectura.comparadas, 6 * 40 * 3, 'six extract KPIs, 40 weeks, three markets');
  assert.equal(v.estados.total.numero, 6 * 9 * 3);
  assert.equal(v.coincidencia.entidad, 'Argentina');
  assert.match(control(v, 'Mercados').detalle, /2 países y LATAM aparte/);
  assert.equal(filasIncompletas(armado, kpis.formulas).length, 0);
  const texto = textoValidacion([{ nombre: 'copia', validacion: v, incompletas: [] }]);
  assert.match(texto, /\| copia \| Argentina \| 2026-10-05 \| 10 de 10 \|/);
  assert.match(texto, /Sin comparar contra la hoja visible: Chile, LATAM/);
});

test('validation: zero, blank and error are counted apart and each is read as what it is', () => {
  const { armado, datos } = armar(valores => {
    valores[40][3] = '';
    valores[39][3] = 0;
    valores[38][3] = '#N/A';
  });
  const v = validarLectura(armado, datos);
  const argentina = v.estados.mercados.find(m => m.nombre === 'Argentina');
  assert.equal(argentina.vacio, 1);
  assert.equal(argentina.cero, 1);
  assert.equal(argentina.texto, 1);
  assert.equal(v.estados.textos[0].valor, '#N/A');
  assert.equal(control(v, 'Cero, vacío y error').ok, true);
  assert.equal(control(v, 'Ningún número cambia').ok, true);
  assert.equal(armado.entrada.datos.Argentina.orders[iso(LUNES(39))], null);
  assert.equal(armado.entrada.datos.Argentina.orders[iso(LUNES(38))], 0);
});

test('validation: repeated, orphan and off-calendar rows of the extract are reported', () => {
  const { armado, datos } = armar(valores => {
    valores.push(valores[40].slice());
    valores.push([LUNES(39), 9, '', 1, 1, 1, 1, 1, 1, '']);
    valores.push(['sin fecha', 2, 'Chile', 1, 1, 1, 1, 1, 1, '']);
    valores.push([new Date(Date.UTC(2026, 9, 7, 3)), 2, 'Chile', 1, 1, 1, 1, 1, 1, '']);
    valores.push([LUNES(5), 7, 'Chile', 1, 1, 1, 1, 1, 1, '']);
  });
  const v = validarLectura(armado, datos);
  assert.equal(control(v, 'Toda fila del extract').ok, false);
  assert.equal(v.integridad.sinPais, 1);
  assert.equal(v.integridad.sinSemana, 1);
  assert.equal(control(v, 'Una sola fila por país y semana').ok, false);
  assert.equal(control(v, 'Semanas de lunes a domingo').ok, false);
  assert.equal(control(v, 'Cada país con un solo identificador').ok, false);
  // The sheet's SUMIFS adds the repeated row; the engine keeps the last one.
  assert.equal(control(v, 'Ningún número cambia').ok, false);
  assert.ok(v.relectura.muestras.some(m => m.mercado === 'Argentina' && m.semana === iso(LUNES(39))));
});

test('validation: a sheet row with formulas in only some weeks explains its blank cells', () => {
  const { armado, datos, kpis } = armar(null, copia => {
    for (let c = 4; c < 12; c++) { copia.valores[10][c] = ''; copia.formulas[10][c] = ''; }
  });
  const v = validarLectura(armado, datos);
  assert.equal(control(v, 'Lo que muestra la hoja coincide').ok, false);
  const incompletas = filasIncompletas(armado, kpis.formulas);
  assert.ok(incompletas.some(f => f.fila === 11 && f.conFormula === 1 && f.semanas === 9));
  const texto = textoValidacion([{ nombre: 'copia', validacion: v, incompletas }]);
  assert.match(texto, /La fila 11 \(Overall › Orders › Share A\) tiene fórmula en 1 de las 9 columnas/);
});
