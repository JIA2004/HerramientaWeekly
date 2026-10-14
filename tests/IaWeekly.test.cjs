const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ARCHIVOS = ['MotorWeekly.gs', 'ResumenWeekly.gs', 'FuenteWeekly.gs', 'RegistroWeekly.gs', 'IaWeekly.gs'];
const REGISTRO = 'Weekly_Tool_Registro';
const TEXTOS = 'Weekly_Tool_Textos_IA';
const KPIS = '2) Weekly por pais';
const DATOS = '[Extract] Tabla Weekly';
const CLAVE = 'CLAVE-SECRETA-DE-PRUEBA';
const MODELO = 'modelo-de-prueba';

const SUMIFS = fila => `=IFERROR(SUMIFS(INDEX(X!$A:$BS, 0, MATCH($C${fila}, X!$1:$1, 0)), X!$A:$A, M$6), "")`;
const LUNES = i => new Date(Date.UTC(2026, 0, 5 + i * 7, 3));
const iso = fecha => fecha.toISOString().slice(0, 10);
const hoyPara = semanas => iso(new Date(LUNES(semanas).getTime() + 86400000));

function cargaCodigo(extra) {
  const ctx = vm.createContext(Object.assign({}, extra));
  ARCHIVOS.forEach(nombre => vm.runInContext(fs.readFileSync(path.join(root, nombre), 'utf8'), ctx, { filename: nombre }));
  return ctx;
}

// ---- Analysis with synthetic values (no company figures) -----------------------

function analisis() {
  const m = cargaCodigo();
  const semanas = [];
  for (let i = 0; i < 40; i++) semanas.push(iso(LUNES(i)));
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
  const catalogo = m.weeklyMotorCatalogo_([
    { fila: 8, direccion: null, clave: '', nombre: 'Overall', formulaValor: null, formulaVariacion: null },
    { fila: 9, direccion: 1, clave: 'orders', nombre: 'Orders', formulaValor: SUMIFS(9), formulaVariacion: '=M9/L9-1' },
    { fila: 11, direccion: -1, clave: 'fail_rate', nombre: 'Fail Rate', formulaValor: SUMIFS(11), formulaVariacion: '=(M11-L11)*100' },
    { fila: 13, direccion: 1, clave: 'dmarts', nombre: 'Dmarts', formulaValor: SUMIFS(13), formulaVariacion: '=M13/L13-1' }
  ]);
  const resultado = m.analizarWeekly({ semanas, datos, catalogo, semanaEsperada: ultima,
    entidades: [{ nombre: 'Argentina', tipo: 'pais' }, { nombre: 'Chile', tipo: 'pais' }, { nombre: 'LATAM', tipo: 'LATAM' }] });
  return { m, resultado, ultima };
}

// A valid answer for a package: every KPI gets its sentence made of references.
function respuestaValida(paquete) {
  const kpis = {};
  paquete.kpis.forEach(k => {
    kpis[k.id] = { dato: 'Pasó de {{' + k.id + '.anterior}} a {{' + k.id + '.valor}}.',
      hipotesis: k.fuera_de_lo_habitual ? 'Coincide con otros movimientos del mercado.' : null };
  });
  const salida = { texto: 'Semana del {{S.semana}} para ' + paquete.entidad + '.', kpis: kpis };
  if (paquete.tipo === 'region') {
    salida.titular = 'LATAM en la semana del {{S.semana}}';
    salida.cierre = { titular: 'En resumen, una semana con {{G.movimientos}} movimientos.', que_paso: 'Pasó lo que muestran los KPIs.',
      que_hay_detras: 'Se movieron {{G.paises_con_movimientos}} países.', que_mirar: ['Si se sostiene el nivel.'] };
  }
  return salida;
}

// ---- Static ------------------------------------------------------------------------

test('normalization: IaWeekly.gs and its test use LF without BOM or trailing whitespace', () => {
  for (const name of ['IaWeekly.gs', 'tests/IaWeekly.test.cjs']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.ok(!text.startsWith('﻿'), `${name}: unexpected BOM`);
    assert.doesNotMatch(text, /\r|[\t ]+$/m, `${name}: non-normalized whitespace`);
    assert.ok(text.endsWith('\n'), `${name}: missing final newline`);
  }
});

test('static isolation: the model is reachable only from IaWeekly.gs, and the page path never calls it', () => {
  const ia = fs.readFileSync(path.join(root, 'IaWeekly.gs'), 'utf8');
  assert.doesNotMatch(ia, /setFormula|\.setValue\(|deleteSheet|deleteRow|MailApp|BigQuery|\.clear\w*\(|appendRow/);
  // Every call out happens inside the two functions that read the key from the properties.
  const llamadas = [...ia.matchAll(/UrlFetchApp/g)].length;
  assert.equal(llamadas, 3, 'UrlFetchApp in weeklyIaLlama_ (twice, retry) and in probarClaveIaWeekly');
  assert.doesNotMatch(ia, /console\.log\([^)]*(clave|respuesta\.getContentText|usuario)/, 'key, prompt and answer are never logged');
  // The writer only ever opens its own tab.
  assert.equal([...ia.matchAll(/insertSheet\(/g)].length, 1);
  assert.match(ia, /insertSheet\(cfg\.hoja\)/);
  for (const nombre of ['MotorWeekly.gs', 'ResumenWeekly.gs', 'FuenteWeekly.gs', 'RegistroWeekly.gs', 'Web.gs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, nombre), 'utf8'),
      /UrlFetchApp|ScriptApp|weeklyIaLlama_|weeklyIaCorrida_|generarTextosIaWeekly|GEMINI/, nombre);
  }
  const pagina = fs.readFileSync(path.join(root, 'Resumen.txt'), 'utf8');
  assert.doesNotMatch(pagina, /generarTextos|weeklyIa|GEMINI|gemini/i);
});

// ---- Package -----------------------------------------------------------------------

test('package: one per market plus LATAM; the model sees references, never a number', () => {
  const { m, resultado } = analisis();
  const paquetes = m.weeklyIaPaquetes_(resultado);
  assert.deepEqual(Array.from(paquetes.map(p => p.entidad)), ['Argentina', 'Chile', 'LATAM']);
  assert.deepEqual(Array.from(paquetes.map(p => p.tipo)), ['pais', 'pais', 'region']);
  for (const p of paquetes) {
    // The ids (K1, K2...) are the only digits: they name a card and are never text.
    const visible = JSON.stringify(p.paquete).replace(/\{\{[A-Za-z0-9_.]+\}\}/g, ' ').replace(/"id":"K\d+"/g, ' ');
    assert.doesNotMatch(visible, /\d/, p.entidad + ': a digit reached the model');
    assert.ok(Object.keys(p.kpis).length > 0);
    assert.equal(p.valores['S.semana'], '05/10/2026');
    // Every reference named in the package has a value.
    for (const ref of JSON.stringify(p.paquete).match(/\{\{[A-Za-z0-9_.]+\}\}/g)) {
      assert.ok(Object.hasOwn(p.valores, ref.slice(2, -2)), p.entidad + ': ' + ref);
    }
  }
  const argentina = paquetes[0];
  const fallos = argentina.paquete.kpis.find(k => k.kpi === 'Fail Rate');
  assert.equal(fallos.sentido, 'sube');
  assert.equal(fallos.favorable, false);
  assert.equal(argentina.valores[fallos.id + '.valor'], '5,00 %');
  assert.match(argentina.valores[fallos.id + '.cambio'], /^\+\d,\d\d pp$/);
  const chile = paquetes[1];
  assert.equal(chile.paquete.kpis.every(k => k.kpi !== 'Dmarts'), true, 'a KPI the market does not operate is not offered');
  const region = paquetes[2].paquete;
  assert.ok(region.mercados.ordenes_por_pais.length >= 2);
  assert.equal(paquetes[2].valores['G.paises_total'], '2', 'LATAM is not counted as a country');
});

test('prompt: states the rules the verifier enforces', () => {
  const { m } = analisis();
  const texto = m.weeklyIaInstrucciones_();
  for (const regla of [/NUNCA escribas un dígito/, /porque/, /null/, /LATAM es un agregado/, /no menciones feriados/i]) {
    assert.match(texto, regla);
  }
});

// ---- Verifier ----------------------------------------------------------------------

function paraVerificar() {
  const { m, resultado } = analisis();
  const paquetes = m.weeklyIaPaquetes_(resultado);
  return { m, argentina: paquetes[0], region: paquetes[2] };
}

test('verifier: a good answer comes back with the references replaced and the KPIs keyed by uid', () => {
  const { m, argentina } = paraVerificar();
  const control = m.weeklyIaVerifica_(respuestaValida(argentina.paquete), argentina);
  assert.equal(control.ok, true, JSON.stringify(control.motivos));
  assert.equal(control.textos.texto, 'Semana del 05/10/2026 para Argentina.');
  const fallos = argentina.paquete.kpis.find(k => k.kpi === 'Fail Rate');
  const uid = argentina.kpis[fallos.id].uid;
  assert.match(control.textos.kpis[uid].dato, /^Pasó de .+ a 5,00 %\.$/);
  assert.equal(typeof control.textos.kpis[uid].hipotesis, 'string');
  const quieto = argentina.paquete.kpis.find(k => !k.fuera_de_lo_habitual);
  assert.equal(control.textos.kpis[argentina.kpis[quieto.id].uid].hipotesis, null, 'null is a valid hypothesis');
});

test('verifier: rejects what the design forbids, with a code and where', () => {
  const { m, argentina, region } = paraVerificar();
  const base = () => respuestaValida(argentina.paquete);
  const k1 = argentina.paquete.kpis[0].id;
  const codigos = salida => Array.from(m.weeklyIaVerifica_(salida, argentina).motivos.map(x => x.codigo));
  const conTexto = texto => Object.assign(base(), { texto: texto });
  assert.ok(codigos(conTexto('Orders subió 3 %.')).includes('IA_CIFRA_PROPIA'));
  assert.ok(codigos(conTexto('Orders subió {{K99.cambio}}.')).includes('IA_REFERENCIA_INEXISTENTE'));
  assert.ok(codigos(conTexto('Orders cayó porque llovió.')).includes('IA_LENGUAJE_CAUSAL'));
  assert.ok(codigos(conTexto('Se explica por la campaña.')).includes('IA_LENGUAJE_CAUSAL'));
  assert.ok(codigos(conTexto('Orders cayó debido a algo.')).includes('IA_LENGUAJE_CAUSAL'));
  assert.ok(codigos(conTexto('Quedó {{K1.cambio')).includes('IA_REFERENCIA_MAL_FORMADA'));
  assert.ok(codigos(conTexto('x'.repeat(2000))).includes('IA_LARGO'));
  assert.ok(codigos(conTexto('')).includes('IA_VACIO'));
  assert.ok(codigos({ kpis: {} }).includes('IA_FALTA'));
  assert.ok(codigos(Object.assign(base(), { extra: 1 })).includes('IA_CLAVE_DESCONOCIDA'));
  assert.ok(codigos(Object.assign(base(), { kpis: { K99: { dato: 'x' } } })).includes('IA_KPI_INEXISTENTE'));
  assert.ok(codigos(Object.assign(base(), { kpis: { [k1]: { dato: 'x', otra: 'y' } } })).includes('IA_CLAVE_DESCONOCIDA'));
  assert.ok(codigos(Object.assign(base(), { texto: 7 })).includes('IA_TIPO'));
  assert.deepEqual(Array.from(m.weeklyIaVerifica_(null, argentina).motivos.map(x => x.codigo)), ['IA_NO_ES_OBJETO']);
  assert.deepEqual(Array.from(m.weeklyIaVerifica_([], argentina).motivos.map(x => x.codigo)), ['IA_NO_ES_OBJETO']);
  const regional = respuestaValida(region.paquete);
  delete regional.cierre;
  assert.ok(Array.from(m.weeklyIaVerifica_(regional, region).motivos.map(x => x.codigo)).includes('IA_FALTA'));
  assert.equal(m.weeklyIaVerifica_(respuestaValida(region.paquete), region).ok, true);
  assert.equal(m.weeklyIaVerifica_(base(), argentina).textos !== null, true);
  assert.equal(m.weeklyIaVerifica_(conTexto('Cayó porque sí.'), argentina).textos, null, 'a rejected answer carries no text');
});

test('verifier: a verdict on a KPI without direction is rejected, on one with direction it is allowed', () => {
  const { m, argentina } = paraVerificar();
  const sinDireccion = Object.assign({}, argentina, { kpis: { K1: { uid: 'u1', favorable: null }, K2: { uid: 'u2', favorable: false } } });
  const dato = texto => ({ texto: 'Resumen.', kpis: { K1: { dato: texto }, K2: { dato: texto } } });
  const control = m.weeklyIaVerifica_(dato('Es un resultado negativo.'), sinDireccion);
  assert.deepEqual(Array.from(control.motivos.map(x => x.codigo + '@' + x.ruta)), ['IA_VALORACION_SIN_DIRECCION@kpis.K1.dato']);
  const correcto = m.weeklyIaVerifica_(dato('Sube sin más valoración.'), sinDireccion);
  assert.equal(correcto.ok, true);
});

test('verifier: a KPI name that carries a digit is not taken for a figure the model wrote', () => {
  const { m } = paraVerificar();
  const entidad = { tipo: 'pais', valores: { 'K1.valor': '1' }, kpis: { K1: { uid: 'u1', favorable: true } }, literales: ['Retention D7'] };
  const bien = m.weeklyIaVerifica_({ texto: 'Retention D7 acompaña.', kpis: {} }, entidad);
  assert.equal(bien.ok, true, JSON.stringify(bien.motivos));
  const mal = m.weeklyIaVerifica_({ texto: 'Retention D7 subió 4 puntos.', kpis: {} }, entidad);
  assert.deepEqual(Array.from(mal.motivos.map(x => x.codigo)), ['IA_CIFRA_PROPIA']);
  const semanas = m.weeklyIaVerifica_({ texto: 'Frente a W-4 y W-8.', kpis: {} }, entidad);
  assert.equal(semanas.ok, true, 'W-4 and W-8 are the allowed exceptions');
});

test('rejection note names the rules and never repeats the model text', () => {
  const { m } = paraVerificar();
  const nota = m.weeklyIaObjeciones_([{ codigo: 'IA_CIFRA_PROPIA', ruta: 'texto', detalle: '…subió 3…' },
    { codigo: 'IA_FALTA', ruta: 'cierre', detalle: null }]);
  assert.match(nota, /IA_CIFRA_PROPIA en texto/);
  assert.match(nota, /IA_FALTA en cierre/);
});

// ---- Request and response ------------------------------------------------------------

test('request: the key is not part of the address or the body, and JSON is asked for', () => {
  const { m } = paraVerificar();
  const pedido = m.weeklyIaPedido_('un-modelo', 'sistema', 'usuario');
  assert.equal(pedido.url, 'https://generativelanguage.googleapis.com/v1beta/models/un-modelo:generateContent');
  assert.doesNotMatch(JSON.stringify(pedido), /key|clave/i);
  assert.equal(pedido.cuerpo.generationConfig.responseMimeType, 'application/json');
  assert.equal(pedido.cuerpo.systemInstruction.parts[0].text, 'sistema');
  assert.equal(pedido.cuerpo.contents[0].parts[0].text, 'usuario');
  assert.ok(pedido.cuerpo.generationConfig.maxOutputTokens >= 8192);
});

test('response: only codes come back for a failure, and a cut answer is not accepted', () => {
  const { m } = paraVerificar();
  const cuerpo = texto => JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(m.weeklyIaRespuesta_(200, cuerpo('{"a":1}')))), { ok: true, texto: '{"a":1}' });
  assert.equal(m.weeklyIaRespuesta_(429, 'texto con datos').codigo, 'IA_CUOTA');
  assert.equal(m.weeklyIaRespuesta_(403, 'x').codigo, 'IA_PERMISO');
  assert.equal(m.weeklyIaRespuesta_(400, 'API key not valid').codigo, 'IA_PEDIDO_O_CLAVE');
  assert.equal(m.weeklyIaRespuesta_(500, 'x').codigo, 'IA_HTTP_500');
  assert.doesNotMatch(JSON.stringify(m.weeklyIaRespuesta_(400, 'API key not valid')), /valid/);
  assert.equal(m.weeklyIaRespuesta_(200, 'no es json').codigo, 'IA_RESPUESTA_ILEGIBLE');
  assert.equal(m.weeklyIaRespuesta_(200, JSON.stringify({ promptFeedback: { blockReason: 'X' } })).codigo, 'IA_BLOQUEADA');
  assert.equal(m.weeklyIaRespuesta_(200, JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] })).codigo, 'IA_CORTADA_MAX_TOKENS');
  assert.equal(m.weeklyIaRespuesta_(200, cuerpo('  ')).codigo, 'IA_VACIA');
  assert.deepEqual(JSON.parse(JSON.stringify(m.weeklyIaParsea_('```json\n{"a":1}\n```'))), { a: 1 });
  assert.equal(m.weeklyIaParsea_('texto'), null);
});

// ---- Saved text on the page -----------------------------------------------------------

function filaOk(entidad, textos) {
  return { estado: 'ok', entidad: entidad, texto: JSON.stringify(textos), modelo: MODELO, generado: '2026-10-06T12:00:00.000Z' };
}

test('merge: AI text replaces the rule text it was written for and nothing else', () => {
  const { m, resultado } = analisis();
  const vista = m.vistaWeekly(resultado);
  const antes = JSON.parse(JSON.stringify(vista));
  const argentina = vista.historia.paises.find(p => p.nombre === 'Argentina');
  const tarjeta = argentina.segmentos[0].kpis[0];
  assert.equal(typeof tarjeta.uid, 'string', 'cards carry the uid the texts are keyed by');
  const movida = vista.historia.regional.movidas[0];
  const aplicados = m.weeklyIaAplica_(vista, [
    filaOk('Argentina', { texto: 'Texto IA de Argentina.', kpis: { [tarjeta.uid]: { dato: 'Dato IA.', hipotesis: 'Hipótesis IA.' } } }),
    filaOk('LATAM', { titular: 'Titular IA', texto: 'Texto IA de LATAM.', kpis: { [movida.uid]: { dato: 'Dato IA de LATAM.', hipotesis: null } },
      cierre: { titular: 'Cierre IA', paso1: 'Paso uno IA', paso2: 'Paso dos IA', mirar: ['Mirar IA'] } }),
    { estado: 'fallido', entidad: 'Chile', texto: JSON.stringify({ texto: 'No debería verse' }), modelo: MODELO, generado: '' },
    filaOk('Atlantis', { texto: 'No existe.' }),
    filaOk('_COMPLETA', {})
  ]);
  assert.equal(aplicados, 2);
  assert.equal(argentina.texto, 'Texto IA de Argentina.');
  assert.equal(argentina.segmentos[0].kpis[0].dato, 'Dato IA.');
  assert.equal(argentina.segmentos[0].kpis[0].hipotesis, 'Hipótesis IA.');
  assert.equal(vista.historia.regional.titular, 'Titular IA');
  assert.equal(vista.historia.regional.movidas[0].dato, 'Dato IA de LATAM.');
  assert.equal(vista.historia.regional.movidas[0].hipotesis, antes.historia.regional.movidas[0].hipotesis, 'a null hypothesis keeps the rule text');
  assert.equal(vista.historia.cierre.titular, 'Cierre IA');
  assert.equal(vista.historia.cierre.pasos[0].texto, 'Paso uno IA');
  assert.equal(vista.historia.cierre.pasos[1].texto, 'Paso dos IA');
  assert.deepEqual(Array.from(vista.historia.cierre.pasos[2].lista), ['Mirar IA']);
  const chile = vista.historia.paises.find(p => p.nombre === 'Chile');
  assert.equal(chile.texto, antes.historia.paises.find(p => p.nombre === 'Chile').texto, 'a failed market keeps the rule text');
  assert.deepEqual(JSON.parse(JSON.stringify(vista.textoIa)), { entidades: 2, modelo: MODELO, generado: '2026-10-06T12:00:00.000Z' });
  assert.match(vista.limites[vista.limites.length - 1], /redactada con IA \(modelo-de-prueba\)/);
  assert.match(vista.limites[vista.limites.length - 1], /no escribe números/);
});

test('merge: without rows or with damaged rows the page is exactly the rule-based one', () => {
  const { m, resultado } = analisis();
  const vista = m.vistaWeekly(resultado);
  const antes = JSON.stringify(vista);
  assert.equal(m.weeklyIaAplica_(vista, []), 0);
  assert.equal(m.weeklyIaAplica_(vista, [{ estado: 'ok', entidad: 'Argentina', texto: '{no es json', modelo: '', generado: '' }]), 0);
  assert.equal(m.weeklyIaAplica_(vista, [{ estado: 'ok', entidad: 'Argentina', texto: '', modelo: '', generado: '' }]), 0);
  assert.equal(m.weeklyIaAplica_(vista, null), 0);
  assert.equal(m.weeklyIaAplica_(null, []), 0);
  assert.equal(JSON.stringify(vista), antes);
});

test('row: a text too big for a cell is refused instead of cut', () => {
  const { m } = analisis();
  const fila = m.weeklyIaFilaDe_('2026-10-05', 'Chile', 'ok', 1, '2026-10-06T12:00:00.000Z', MODELO, { texto: 'a' }, '');
  assert.equal(fila.length, 8);
  assert.equal(fila[6].charAt(0), '~', 'a stored text can never start a formula');
  assert.throws(() => m.weeklyIaFilaDe_('2026-10-05', 'Chile', 'ok', 1, '', MODELO, { texto: 'a'.repeat(50000) }, ''), /IA_FILA_GRANDE/);
  assert.equal(m.weeklyIaFilaDe_('2026-10-05', 'Chile', 'fallido', 2, '', MODELO, null, 'IA_CUOTA')[6], '');
});

// ---- The whole path with the services replaced ------------------------------------------

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

function hojaDatos(semanas) {
  const valores = [['week_date', 'country_id', 'country_name', 'orders', 'fail_rate', 'last_update']];
  ['Argentina', 'Chile', 'LATAM'].forEach((pais, k) => {
    for (let i = 0; i < semanas; i++) {
      const fila = [LUNES(i), k + 1, pais, Math.round(10000 * (1 + Math.sin(i * 1.7 + k) * 0.01)),
        0.02 + Math.sin(i + k) * 0.0005, new Date(Date.UTC(2026, 9, 5, 18))];
      if (pais === 'Argentina' && i === semanas - 1) fila[4] = 0.05;
      valores.push(fila);
    }
  });
  return { valores, formulas: [] };
}

// opciones.responder(paquete, numeroDeLlamada, entidad) -> the object the "model" answers, or a string
// to answer verbatim, or { http: 429 } for a failure.
function mundo(hoyIso, opciones) {
  const estado = { tabs: {}, escrituras: [], llamadas: [], lecturasFuente: 0, propiedades: Object.assign({}, opciones.propiedades) };
  const hoja = nombre => ({
    getName: () => nombre,
    getLastRow: () => estado.tabs[nombre].length,
    setFrozenRows: () => {},
    getRange: (fila, col, filas, columnas) => ({
      getValues: () => {
        const salida = [];
        for (let f = 0; f < filas; f++) {
          const origen = estado.tabs[nombre][fila - 1 + f] || [];
          const linea = [];
          for (let c = 0; c < columnas; c++) linea.push(origen[col - 1 + c] === undefined ? '' : origen[col - 1 + c]);
          salida.push(linea);
        }
        return salida;
      },
      setNumberFormat: () => {},
      setValues: valores => {
        estado.escrituras.push(nombre);
        valores.forEach((linea, f) => {
          const destino = estado.tabs[nombre][fila - 1 + f] = estado.tabs[nombre][fila - 1 + f] || [];
          linea.forEach((valor, c) => { destino[col - 1 + c] = valor; });
        });
      }
    })
  });
  const fuente = datos => ({ getDataRange: () => ({
    getNumRows: () => datos.valores.length, getNumColumns: () => datos.valores[0].length,
    getValues: () => { estado.lecturasFuente++; return datos.valores; }, getFormulas: () => datos.formulas }) });
  const fuentes = { [KPIS]: hojaKpis(), [DATOS]: hojaDatos(opciones.semanas || 40) };
  const documento = {
    getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires', getName: () => 'Libro', getSheets: () => [],
    getSheetByName: nombre => (fuentes[nombre] ? fuente(fuentes[nombre]) : estado.tabs[nombre] ? hoja(nombre) : null),
    insertSheet: nombre => {
      assert.ok([REGISTRO, TEXTOS].includes(nombre), 'only the registry and the AI text tabs may be created: ' + nombre);
      estado.tabs[nombre] = [];
      return hoja(nombre);
    }
  };
  const RealDate = Date;
  class FechaFija extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(hoyIso + 'T15:00:00Z'); }
  }
  const ctx = cargaCodigo({
    Date: FechaFija,
    SpreadsheetApp: { openById: () => documento },
    Utilities: { formatDate: (fecha, zona) => new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(fecha), sleep: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
      getUserLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: nombre => (estado.propiedades[nombre] === undefined ? null : estado.propiedades[nombre]) }) },
    UrlFetchApp: { fetch: (url, opts) => {
      const cuerpo = JSON.parse(opts.payload);
      const usuario = cuerpo.contents[0].parts[0].text;
      const paquete = JSON.parse(/Paquete del mercado:\n([\s\S]*?)\n\nDevolvé/.exec(usuario)[1]);
      const llamada = { url: url, headers: opts.headers, usuario: usuario, paquete: paquete,
        numero: estado.llamadas.filter(l => l.paquete.entidad === paquete.entidad).length + 1, payload: opts.payload };
      estado.llamadas.push(llamada);
      const salida = opciones.responder(paquete, llamada.numero, llamada);
      if (salida && salida.http) return { getResponseCode: () => salida.http, getContentText: () => 'detalle que no debe salir' };
      const texto = typeof salida === 'string' ? salida : JSON.stringify(salida);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: texto }] } }] }) };
    } },
    console: { log: () => {} }
  });
  return { ctx, estado, documento };
}

const PROPIEDADES = { GEMINI_API_KEY: CLAVE, GEMINI_MODEL: MODELO };
const buena = paquete => respuestaValida(paquete);

test('weekly run: writes one row per market and a completion mark, then does nothing more', () => {
  const { ctx, estado } = mundo(hoyPara(40), { propiedades: PROPIEDADES, responder: buena });
  const resumen = ctx.weeklyIaCorrida_();
  assert.equal(resumen.estado, 'ok', JSON.stringify(resumen));
  assert.equal(resumen.generadas, 3);
  assert.equal(estado.llamadas.length, 3);
  assert.deepEqual(Array.from(estado.llamadas.map(l => l.paquete.entidad)), ['Argentina', 'Chile', 'LATAM']);
  for (const l of estado.llamadas) {
    assert.equal(l.headers['x-goog-api-key'], CLAVE);
    assert.doesNotMatch(l.url + l.payload, new RegExp(CLAVE), 'the key travels in the header only');
    assert.equal(l.url, 'https://generativelanguage.googleapis.com/v1beta/models/' + MODELO + ':generateContent');
  }
  const filas = estado.tabs[TEXTOS];
  assert.deepEqual(Array.from(filas[0]), ['semana', 'entidad', 'estado', 'intentos', 'generado', 'modelo', 'texto', 'detalle']);
  assert.deepEqual(Array.from(filas.slice(1).map(f => f[1])), ['Argentina', 'Chile', 'LATAM', '_COMPLETA']);
  assert.ok(filas.slice(1).every(f => f[0] === '2026-10-05' && f[2] === 'ok' && f[5] === MODELO));
  assert.ok(filas.slice(1, 4).every(f => f[6].charAt(0) === '~'));
  assert.doesNotMatch(JSON.stringify(filas), /\{\{/, 'saved text has its references replaced');
  assert.deepEqual(Array.from(new Set(estado.escrituras)), [TEXTOS], 'the run writes only its own tab');
  const lecturas = estado.lecturasFuente;
  const otra = ctx.weeklyIaCorrida_();
  assert.equal(otra.estado, 'ya_completa');
  assert.equal(estado.llamadas.length, 3, 'no new call');
  assert.equal(estado.lecturasFuente, lecturas, 'the big sheet is not read again once the week is done');
});

test('weekly run: the page gets the text and the saved run stays rule-based', () => {
  const { ctx, estado } = mundo(hoyPara(40), { propiedades: PROPIEDADES, responder: buena });
  assert.equal(ctx.weeklyIaCorrida_().estado, 'ok');
  const respuesta = ctx.obtenerVistaWeekly(false);
  assert.equal(respuesta.estado, 'ok', JSON.stringify(respuesta.error));
  assert.deepEqual(Array.from(respuesta.avisos), []);
  assert.equal(respuesta.textoIa, 3);
  assert.equal(respuesta.vista.historia.regional.titular, 'LATAM en la semana del 05/10/2026');
  assert.equal(respuesta.vista.historia.paises[0].texto, 'Semana del 05/10/2026 para Argentina.');
  assert.match(respuesta.vista.limites[respuesta.vista.limites.length - 1], /redactada con IA/);
  const guardado = estado.tabs.Weekly_Tool_Registro[1].slice(9).map(celda => celda.slice(1)).join('');
  assert.doesNotMatch(guardado, /redactada con IA|Semana del 05\/10\/2026 para/, 'the saved run holds no AI text');
  // Served from the saved run, the text is added again.
  const segunda = ctx.obtenerVistaWeekly(false);
  assert.equal(segunda.procedencia, 'guardado');
  assert.equal(segunda.textoIa, 3);
  assert.equal(segunda.vista.historia.paises[0].texto, 'Semana del 05/10/2026 para Argentina.');
});

test('weekly run: opening the page never calls the model', () => {
  const { ctx, estado } = mundo(hoyPara(40), { propiedades: PROPIEDADES, responder: buena });
  const respuesta = ctx.obtenerVistaWeekly(true);
  assert.equal(respuesta.estado, 'ok');
  assert.equal(respuesta.textoIa, 0);
  assert.equal(estado.llamadas.length, 0);
  assert.equal(estado.tabs[TEXTOS], undefined, 'the page does not create the AI tab');
  assert.deepEqual(Array.from(respuesta.avisos), []);
});

test('weekly run: without key or model nothing is read or called', () => {
  for (const [propiedades, codigo] of [[{}, 'IA_SIN_CLAVE'], [{ GEMINI_API_KEY: CLAVE }, 'IA_SIN_MODELO']]) {
    const { ctx, estado } = mundo(hoyPara(40), { propiedades: propiedades, responder: buena });
    const resumen = ctx.weeklyIaCorrida_();
    assert.equal(resumen.estado, 'error');
    assert.equal(resumen.codigo, codigo);
    assert.equal(estado.llamadas.length, 0);
    assert.equal(estado.lecturasFuente, 0);
    assert.doesNotMatch(JSON.stringify(resumen), new RegExp(CLAVE));
  }
});

test('weekly run: a load that is not complete is not written about', () => {
  const { ctx, estado } = mundo(hoyPara(41), { propiedades: PROPIEDADES, responder: buena });
  const resumen = ctx.weeklyIaCorrida_();
  assert.equal(resumen.estado, 'bloqueada');
  assert.ok(resumen.motivos.length > 0);
  assert.equal(estado.llamadas.length, 0);
  assert.equal(estado.tabs[TEXTOS], undefined);
});

test('weekly run: a rejected answer is asked again once, with the rules that failed', () => {
  const { ctx, estado } = mundo(hoyPara(40), { propiedades: PROPIEDADES,
    responder: (paquete, numero) => (paquete.entidad === 'Chile' && numero === 1 ? Object.assign(buena(paquete), { texto: 'Cayó 3 % porque sí.' }) : buena(paquete)) });
  const resumen = ctx.weeklyIaCorrida_();
  assert.equal(resumen.estado, 'ok');
  assert.equal(resumen.generadas, 3);
  const chile = estado.llamadas.filter(l => l.paquete.entidad === 'Chile');
  assert.equal(chile.length, 2);
  assert.match(chile[1].usuario, /IA_CIFRA_PROPIA en texto/);
  assert.match(chile[1].usuario, /IA_LENGUAJE_CAUSAL en texto/);
  assert.doesNotMatch(chile[1].usuario, /Cayó 3 %/, 'the rejected text is not echoed back');
  const fila = estado.tabs[TEXTOS].find(f => f[1] === 'Chile');
  assert.equal(fila[3], '2');
  assert.equal(fila[2], 'ok');
});

test('weekly run: a market that keeps failing stops at three attempts and the week is never marked complete', () => {
  const { ctx, estado } = mundo(hoyPara(40), { propiedades: PROPIEDADES,
    responder: paquete => (paquete.entidad === 'Chile' ? 'esto no es json' : buena(paquete)) });
  const primera = ctx.weeklyIaCorrida_();
  assert.equal(primera.generadas, 2);
  assert.deepEqual(Array.from(primera.fallidas), ['Chile (IA_NO_ES_JSON)']);
  let fila = estado.tabs[TEXTOS].find(f => f[1] === 'Chile');
  assert.equal(fila[2], 'fallido');
  assert.equal(fila[3], '2');
  assert.equal(fila[6], '', 'no text saved for a failed market');
  assert.equal(estado.tabs[TEXTOS].some(f => f[1] === '_COMPLETA'), false);
  const segunda = ctx.weeklyIaCorrida_();
  assert.equal(segunda.fallidas.length, 1);
  fila = estado.tabs[TEXTOS].find(f => f[1] === 'Chile');
  assert.equal(fila[3], '3');
  const llamadas = estado.llamadas.length;
  const tercera = ctx.weeklyIaCorrida_();
  assert.equal(estado.llamadas.length, llamadas, 'attempts are capped');
  assert.deepEqual(Array.from(tercera.pendientes), ['Chile']);
  // The page keeps the rule text for Chile and shows the other two.
  const respuesta = ctx.obtenerVistaWeekly(false);
  assert.equal(respuesta.textoIa, 2);
});

test('weekly run: a quota or permission failure is reported by code and does not spend the other attempts', () => {
  const { ctx, estado } = mundo(hoyPara(40), { propiedades: PROPIEDADES, responder: () => ({ http: 403 }) });
  const resumen = ctx.weeklyIaCorrida_();
  assert.equal(resumen.generadas, 0);
  assert.equal(resumen.fallidas.length, 3);
  assert.ok(resumen.fallidas.every(texto => /IA_PERMISO/.test(texto)));
  assert.equal(estado.llamadas.length, 3, 'one call per market: a permission error is not retried');
  assert.doesNotMatch(JSON.stringify(resumen), /detalle que no debe salir/);
});

test('weekly run: the weekly call cap stops the run', () => {
  const { ctx, estado } = mundo(hoyPara(40), { propiedades: PROPIEDADES, responder: paquete => buena(paquete) });
  const cap = vm.runInContext('weeklyIaConfig_.maxLlamadasPorSemana', ctx);
  assert.ok(cap >= 20);
  // Pre-load the tab with attempts at the cap: nothing more is called.
  ctx.weeklyIaGuardaFila_(estado.documento || ctx.SpreadsheetApp.openById(), 'America/Argentina/Buenos_Aires',
    ctx.weeklyIaFilaDe_('2026-10-05', 'Argentina', 'fallido', 2, '', MODELO, null, 'IA_CUOTA'), null);
  estado.tabs[TEXTOS][1][3] = String(cap);
  const resumen = ctx.weeklyIaCorrida_();
  assert.equal(estado.llamadas.length, 0);
  assert.ok(resumen.pendientes.length >= 1);
});

test('editor helpers: the key check uses no data and the package check does not call the model', () => {
  const { ctx, estado } = mundo(hoyPara(40), { propiedades: PROPIEDADES, responder: () => ({ estado: 'ok' }) });
  const prueba = ctx.probarClaveIaWeekly.toString();
  assert.doesNotMatch(prueba, /analizarWeeklyAhora|weeklyIaPaquetes_/);
  const sinPaquete = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"estado":"ok"}' }] } }] }) }) };
  ctx.UrlFetchApp = sinPaquete;
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.probarClaveIaWeekly())), { ok: true, codigo: null, http: 200, modelo: MODELO });
  ctx.UrlFetchApp = { fetch: () => { throw new Error('the package check must not call the model'); } };
  const resumen = ctx.probarPaquetesIaWeekly();
  assert.deepEqual(Array.from(resumen.map(p => p.entidad)), ['Argentina', 'Chile', 'LATAM']);
  assert.ok(resumen.every(p => p.caracteres > 100 && p.referencias > 3));
  assert.equal(estado.llamadas.length, 0);
});
