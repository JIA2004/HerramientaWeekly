const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'Index.txt'), 'utf8');
const lector = fs.readFileSync(path.join(root, 'LectorWeekly.gs'), 'utf8');
const opciones = fs.readFileSync(path.join(root, 'OpcionesWeekly.gs'), 'utf8');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(scripts.length, 1, 'Index.txt must contain exactly one script block');
const script = scripts[0];

function nodoDom(tag) {
  const listeners = {};
  let texto = '';
  const elemento = {
    tagName: String(tag).toUpperCase(),
    children: [],
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    className: '',
    title: '',
    type: '',
    appendChild(hijo) { elemento.children.push(hijo); return hijo; },
    addEventListener(tipo, fn) { (listeners[tipo] = listeners[tipo] || []).push(fn); },
    dispatch(tipo) { (listeners[tipo] || []).forEach(fn => fn({ target: elemento })); }
  };
  Object.defineProperty(elemento, 'textContent', {
    get: () => texto,
    set: valor => { texto = String(valor); elemento.children.length = 0; },
    enumerable: true
  });
  return elemento;
}

const VACIOS = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'area',
  'base', 'col', 'embed', 'param', 'track', 'wbr']);

function decodificar(texto) {
  const entidades = { ntilde: 'ñ', Ntilde: 'Ñ', iacute: 'í', aacute: 'á', eacute: 'é',
    oacute: 'ó', uacute: 'ú', uuml: 'ü', quot: '"', amp: '&', lt: '<', gt: '>',
    apos: "'", nbsp: ' ' };
  return texto.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (crudo, cuerpo) => {
    if (cuerpo.charAt(0) === '#') {
      const hexadecimal = cuerpo.charAt(1) === 'x' || cuerpo.charAt(1) === 'X';
      const codigo = parseInt(hexadecimal ? cuerpo.slice(2) : cuerpo.slice(1), hexadecimal ? 16 : 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : crudo;
    }
    return Object.prototype.hasOwnProperty.call(entidades, cuerpo) ? entidades[cuerpo] : crudo;
  });
}

// Seeds the initial DOM from the real markup so hidden/disabled attributes and the
// always-visible texts are exercised as served, not as the script left them.
function sembrar(registro, html) {
  const pila = [];
  const patron = /<!--[\s\S]*?-->|<\/([A-Za-z][A-Za-z0-9]*)>|<([A-Za-z][A-Za-z0-9]*)([^<>]*?)(\/?)>|([^<]+)/g;
  let coincidencia;
  while ((coincidencia = patron.exec(html)) !== null) {
    if (coincidencia[1]) { pila.pop(); continue; }
    if (!coincidencia[2]) {
      const actual = pila[pila.length - 1];
      const texto = coincidencia[5];
      if (actual && /[^\s]/.test(texto) && !actual.children.length) actual.textContent = decodificar(texto);
      continue;
    }
    const tag = coincidencia[2];
    const atributos = coincidencia[3] || '';
    const elemento = nodoDom(tag);
    const id = /\bid="([^"]+)"/.exec(atributos);
    if (id) elemento.id = id[1];
    if (/(^|\s)hidden(\s|$)/.test(atributos)) elemento.hidden = true;
    if (/(^|\s)disabled(\s|$)/.test(atributos)) elemento.disabled = true;
    const tipo = /\btype="([^"]+)"/.exec(atributos);
    if (tipo) elemento.type = tipo[1];
    const padre = pila[pila.length - 1];
    if (padre) padre.appendChild(elemento);
    if (elemento.id) registro.set(elemento.id, elemento);
    if (coincidencia[4] !== '/' && !VACIOS.has(tag.toLowerCase())) pila.push(elemento);
  }
}

function arranque() {
  const registro = new Map();
  sembrar(registro, html);
  const documento = {
    getElementById(id) {
      if (!registro.has(id)) registro.set(id, nodoDom('div'));
      return registro.get(id);
    },
    createElement: tag => nodoDom(tag)
  };
  const llamadas = [];
  let ultima = null;
  const runner = {
    _exito: null,
    _fallo: null,
    withSuccessHandler(fn) { runner._exito = fn; return runner; },
    withFailureHandler(fn) { runner._fallo = fn; return runner; },
    obtenerOpcionesWeekly() {
      llamadas.push('obtenerOpcionesWeekly');
      ultima = { metodo: 'obtenerOpcionesWeekly', exito: runner._exito, fallo: runner._fallo };
      runner._exito = null;
      runner._fallo = null;
    },
    leerWeeklyPorPais(pais) {
      llamadas.push('leerWeeklyPorPais:' + String(pais));
      ultima = { metodo: 'leerWeeklyPorPais', pais: pais, exito: runner._exito, fallo: runner._fallo };
      runner._exito = null;
      runner._fallo = null;
    }
  };
  const context = vm.createContext({
    document: documento,
    google: { script: { run: runner } },
    console: { log: () => {} }
  });
  vm.runInContext(script, context, { timeout: 2000 });
  return {
    llamadas: llamadas,
    nodo: id => documento.getElementById(id),
    responder: payload => { assert.ok(ultima, 'no pending server call'); ultima.exito(payload); },
    fallar: error => { assert.ok(ultima, 'no pending server call'); ultima.fallo(error); },
    ultimo: () => ultima
  };
}

const OPCIONES = {
  schemaVersion: 'weekly-opciones/1',
  estado: 'ok',
  alcance: 'solo_validacion_selector',
  fuente: 'VALUE_IN_LIST',
  opciones: [{ nombre: 'Chile', tipo: 'pais' }, { nombre: 'LATAM', tipo: 'LATAM' }],
  total: 2,
  origen: { documento: 'doc', pestana: 'WebApp', coordenada: 'H4' },
  zonaHorariaDocumento: 'America/Argentina/Buenos_Aires',
  inicioIso: '2026-09-20T00:00:00.000Z',
  finIso: '2026-09-20T00:00:00.100Z',
  duracionMs: 100,
  verificacion: { lectura: 'no_verificada', completitud: 'no_verificada', correspondenciaPaisDatos: 'no_verificada' },
  advertencias: ['These options come from the H4 validation rule only.'],
  error: null
};

function celda(overrides = {}) {
  return Object.assign({ coordenada: 'I9', valor: 0, textoMostrado: '0', formato: '0.00',
    tipo: 'number', estado: 'cero', hasFormula: false }, overrides);
}

function filaBase(numero, nombre, extra = {}) {
  return Object.assign({
    id: 'WebApp!F' + numero, nombre: nombre, fila: numero, clasificacion: 'pendiente', kpi: null,
    unidad: null, interpretacion: null, sentidoFavorable: null,
    metadatos: { C: celda({ coordenada: 'C9', valor: 'meta C', textoMostrado: 'meta C', formato: '', tipo: 'string', estado: 'texto' }),
      D: celda({ coordenada: 'D9', valor: '', textoMostrado: '', formato: '', tipo: 'string', estado: 'vacio' }),
      E: celda({ coordenada: 'E9', valor: 3, textoMostrado: '3', tipo: 'number', estado: 'numero' }),
      F: celda({ coordenada: 'F9', valor: 'F', textoMostrado: 'F', formato: '', tipo: 'string', estado: 'texto' }) },
    observaciones: { '2026-09-07': celda({ coordenada: 'I' + numero }),
      '2026-09-14': celda({ coordenada: 'J' + numero }) },
    adicionales: { wow: celda({ coordenada: 'R' + numero, valor: 12, textoMostrado: '12',
      tipo: 'number', estado: 'numero' }) }
  }, extra);
}

function lectura(overrides = {}) {
  const fila = filaBase;
  const base = {
    schemaVersion: 'weekly-lectura/3',
    estado: 'ok',
    datosUtilizables: true,
    paisSolicitado: 'Chile',
    entidad: { nombre: 'Chile', tipo: 'pais' },
    selector: { original: 'Argentina', solicitado: 'Chile', observado: 'Chile', escrita: 'Chile',
      restaurado: 'Argentina', restauracionVerificada: true },
    lectura: { inicioIso: '2026-09-20T00:00:00.000Z', finIso: '2026-09-20T00:00:01.000Z',
      zonaHorariaSemanaCerrada: 'America/Argentina/Buenos_Aires', estableObservada: true,
      intentos: 2, duracionMs: 1000 },
    origen: { documento: '1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk', pestana: 'WebApp',
      coordenadas: { selector: 'H4', filaEncabezados: 8, columnaNombres: 7, metadatos: 'C:F' },
      zonaHorariaDocumento: 'America/Argentina/Buenos_Aires' },
    semanas: [
      { indice: 1, celda: 'I8', fechaLocal: '2026-09-07', textoMostrado: '2026-09-07',
        duplicada: false, noEsLunes: false, ambigua: false },
      { indice: 2, celda: 'J8', fechaLocal: '2026-09-14', textoMostrado: '2026-09-14',
        duplicada: false, noEsLunes: false, ambigua: false }
    ],
    columnasAdicionales: [
      { indice: 1, celda: 'R8', columna: 18, etiquetaOriginal: 'WoW',
        etiquetaNormalizada: 'wow', clasificacion: 'wow', interpretacionValidada: false }
    ],
    filas: [
      fila(6, 'Fila anterior al encabezado'),
      fila(9, 'Fila con cero'),
      fila(10, 'Fila vacía', { observaciones: { '2026-09-07': celda({ coordenada: 'I10', valor: null,
        textoMostrado: '', formato: '', tipo: 'string', estado: 'vacio' }),
        '2026-09-14': celda({ coordenada: 'J10', valor: '#N/A', textoMostrado: '#N/A', formato: '',
          tipo: 'string', estado: 'errorOrText' }) } }),
      fila(11, 'Fila con formato que oculta', { observaciones: { '2026-09-07': celda({ coordenada: 'I11',
        valor: 5, textoMostrado: '—', formato: '"—"', tipo: 'number', estado: 'numero', hasFormula: true }),
        '2026-09-14': celda({ coordenada: 'J11', valor: 4, textoMostrado: '4', tipo: 'number', estado: 'numero' }) } }),
      fila(12, 'Fila sin lectura', { observaciones: { '2026-09-07': undefined,
        '2026-09-14': celda({ coordenada: 'J12', valor: 7, textoMostrado: '7', tipo: 'number', estado: 'numero' }) } })
    ],
    calidad: { duplicados: [], fechasNoLunes: [], encabezadosAmbiguos: [],
      ultimaSemanaCerradaEsperada: '2026-09-07', ultimoEncabezado: '2026-09-14',
      semanaCerradaEsperadaPresente: true, semanasDeclaradas: 2, semanasConObservacionesNumericas: 1 },
    advertencias: ['This reading is a manual pilot observation, not an audit.'],
    verificacion: { completitud: 'no_verificada', correspondenciaPaisDatos: 'no_verificada',
      recalculo: 'no_verificada', lecturaEstableEsObservacion: true }
  };
  return Object.assign(base, overrides);
}

function lecturaLatam() {
  return lectura({
    paisSolicitado: 'LATAM',
    entidad: { nombre: 'LATAM', tipo: 'LATAM' },
    filas: [
      filaBase(9, 'Fila regional'),
      filaBase(10, 'Fila regional vacía', { observaciones: {
        '2026-09-07': celda({ coordenada: 'I10', valor: null, textoMostrado: '', formato: '',
          tipo: 'string', estado: 'vacio' }),
        '2026-09-14': celda({ coordenada: 'J10', valor: 0, textoMostrado: '0' }) } })
    ]
  });
}

function recolectar(elemento, lista = []) {
  elemento.children.forEach(hijo => { lista.push(hijo); recolectar(hijo, lista); });
  return lista;
}

function textoDe(elemento) {
  if (!elemento) return '';
  if (elemento.children.length) return elemento.children.map(textoDe).join(' | ');
  return elemento.textContent;
}

function etiquetas(elemento, tag) {
  return recolectar(elemento).filter(hijo => hijo.tagName === tag);
}

function abrirConResultado(payload, pais = 'Chile') {
  const app = arranque();
  app.responder(OPCIONES);
  app.nodo('country').value = pais;
  app.nodo('consultar').dispatch('click');
  app.responder(payload || lectura());
  return app;
}

test('content policy: one script block, no HTML injection, no remote or previous backend calls', () => {
  assert.doesNotMatch(html, /innerHTML|outerHTML|document\.write|insertAdjacentHTML/);
  assert.doesNotMatch(html, /\beval\s*\(|new Function\s*\(/);
  assert.doesNotMatch(html, /BigQuery|bigquery|consultarOrdenesPorPais|probarBigQuery/);
  assert.doesNotMatch(html, /LOCAL_PREVIEW|MOCK_DATA|UrlFetchApp/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /Al d[ií]a/i);
  assert.match(html, /Lectura piloto\. Carga y rec&aacute;lculo no verificados\./);
  assert.doesNotMatch(script, /\.innerHTML/);
});

test('every element id used by the script exists in the markup', () => {
  const ids = new Set([...script.matchAll(/nodo\('([A-Za-z0-9-]+)'\)/g)].map(match => match[1]));
  assert.ok(ids.size >= 15);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `missing markup for #${id}`);
});

test('the field names the frontend reads still exist in the reader envelope', () => {
  // Rename/removal guard only: the reader's own suite owns the semantics of these fields.
  for (const campo of ['semanas', 'columnasAdicionales', 'filas', 'calidad', 'advertencias',
    'paisSolicitado', 'datosUtilizables', 'estableObservada', 'filaEncabezados', 'intentos',
    'duracionMs', 'zonaHorariaSemanaCerrada', 'ultimoEncabezado', 'semanasDeclaradas',
    'ultimaSemanaCerradaEsperada', 'semanaCerradaEsperadaPresente', 'semanasConObservacionesNumericas',
    'celda', 'fechaLocal', 'duplicada', 'noEsLunes', 'clasificacion', 'etiquetaOriginal',
    'observaciones', 'adicionales', 'coordenada', 'textoMostrado', 'formato', 'estado', 'tipo',
    'hasFormula', 'nombre', 'fila', 'metadatos']) {
    assert.match(lector, new RegExp('(^|[^A-Za-z0-9_])' + campo + '($|[^A-Za-z0-9_])'),
      `the reader no longer exposes ${campo}`);
  }
  assert.match(lector, /weekly-lectura\/3/);
  assert.match(opciones, /schemaVersion: 'weekly-opciones\/1'/);
});

test('options are requested once at start and the button is enabled only afterwards', () => {
  const app = arranque();
  assert.deepEqual(app.llamadas, ['obtenerOpcionesWeekly']);
  assert.equal(app.nodo('consultar').disabled, true);
  app.responder(OPCIONES);
  const etiquetasOpcion = recolectar(app.nodo('country')).filter(hijo => hijo.tagName === 'OPTION');
  assert.deepEqual(etiquetasOpcion.map(opcion => opcion.value), ['', 'Chile', 'LATAM']);
  assert.equal(etiquetasOpcion[2].textContent, 'LATAM — agregado regional');
  assert.equal(app.nodo('consultar').disabled, false);
  assert.equal(app.nodo('country').value, '');
  assert.equal(app.nodo('country').children.length, 3);
});

test('a failed options load disables the consultation and explains the reason', () => {
  const app = arranque();
  app.responder({ schemaVersion: 'weekly-opciones/1', estado: 'error', opciones: [],
    error: { codigo: 'SELECTOR_VALIDATION' } });
  assert.equal(app.nodo('consultar').disabled, true);
  assert.equal(app.nodo('error-panel').hidden, false);
  assert.match(app.nodo('error-mensaje').textContent, /H4/);
  assert.match(app.nodo('error-mensaje').textContent, /Recargá la página/);
});

test('the reading is requested only when Consultar is pressed, with the chosen country', () => {
  const app = arranque();
  app.responder(OPCIONES);
  app.nodo('country').value = 'Chile';
  assert.deepEqual(app.llamadas, ['obtenerOpcionesWeekly']);
  app.nodo('filtro-semana').dispatch('change');
  assert.deepEqual(app.llamadas, ['obtenerOpcionesWeekly']);
  app.nodo('consultar').dispatch('click');
  assert.deepEqual(app.llamadas, ['obtenerOpcionesWeekly', 'leerWeeklyPorPais:Chile']);
  assert.equal(app.nodo('consultar').disabled, true);
  assert.match(app.nodo('estado').textContent, /Consultando Chile/);
  app.responder(lectura());
  assert.equal(app.nodo('consultar').disabled, false);
});

test('a blank country never reaches the server', () => {
  const app = arranque();
  app.responder(OPCIONES);
  app.nodo('consultar').dispatch('click');
  assert.deepEqual(app.llamadas, ['obtenerOpcionesWeekly']);
  assert.match(app.nodo('estado').textContent, /Elegí un país/);
});

test('the accepted reading renders the pilot result with its own country and reading time', () => {
  const app = abrirConResultado();
  assert.equal(app.nodo('resultado').hidden, false);
  assert.equal(app.nodo('sin-resultado').hidden, true);
  assert.equal(app.nodo('resultado-pais').textContent, 'País del resultado: Chile');
  assert.match(app.nodo('resultado-lectura').textContent, /2026-09-20 00:00:01\.000 UTC/);
  assert.match(app.nodo('resultado-lectura').textContent, /intentos: 2/);
  assert.equal(app.nodo('badge-estable').textContent, 'Lectura estable observada');
  assert.match(app.nodo('badge-semana-cerrada').textContent, /2026-09-07 \(presente\)/);
  assert.match(app.nodo('meta-encabezados').textContent, /Último encabezado semanal: 2026-09-14/);
  assert.equal(app.nodo('advertencias-lista').children.length, 1);
  const tabla = recolectar(app.nodo('tabla-envoltura')).filter(hijo => hijo.tagName === 'TABLE')[0];
  const filas = etiquetas(tabla, 'TR');
  assert.equal(filas.length, 5); // header + the four rows after the header row
  assert.match(textoDe(filas[1]), /Fila con cero/);
  assert.doesNotMatch(textoDe(tabla), /Fila anterior al encabezado/);
});

test('the pilot notice is always visible and no state claims the data is up to date', () => {
  const app = arranque();
  assert.match(app.nodo('aviso-piloto').textContent, /Carga y recálculo no verificados/);
  app.responder(OPCIONES);
  app.nodo('country').value = 'Chile';
  app.nodo('consultar').dispatch('click');
  app.responder(lectura());
  const todo = ['resultado', 'badge-estable', 'badge-semana-cerrada', 'meta-encabezados', 'tabla-envoltura']
    .map(id => textoDe(app.nodo(id))).join(' ');
  assert.doesNotMatch(todo, /Al d[ií]a/i);
  assert.match(textoDe(app.nodo('aviso-piloto')), /Lectura piloto/);
});

test('typed states render as text: empty cells say Sin dato and markers keep their warning', () => {
  const app = abrirConResultado();
  const tabla = recolectar(app.nodo('tabla-envoltura')).filter(hijo => hijo.tagName === 'TABLE')[0];
  const texto = textoDe(tabla);
  assert.match(texto, /Sin dato/);
  assert.match(texto, /#N\/A \(marcador sin clasificar\)/);
  assert.match(texto, /0/);
  const vacia = etiquetas(tabla, 'BUTTON').filter(boton => boton.textContent === 'Sin dato');
  assert.equal(vacia.length, 2);
  assert.ok(vacia.every(boton => boton.className.includes('sin-dato')));
});

test('week and name filters are local and never trigger another server call', () => {
  const app = abrirConResultado();
  const antes = app.llamadas.length;
  const selector = app.nodo('filtro-semana');
  const opcionesSemana = [...selector.children];
  assert.equal(opcionesSemana[0].value, '__todas__');
  assert.equal(opcionesSemana[0].textContent, 'Todas');
  selector.value = '2026-09-14';
  selector.dispatch('change');
  const tabla = recolectar(app.nodo('tabla-envoltura')).filter(hijo => hijo.tagName === 'TABLE')[0];
  assert.match(textoDe(etiquetas(tabla, 'TR')[0]), /2026-09-14/);
  assert.doesNotMatch(textoDe(etiquetas(tabla, 'TR')[0]), /2026-09-07/);
  app.nodo('filtro-nombre').value = 'formato';
  app.nodo('filtro-nombre').dispatch('input');
  const filtrada = recolectar(app.nodo('tabla-envoltura')).filter(hijo => hijo.tagName === 'TABLE')[0];
  assert.equal(etiquetas(filtrada, 'TR').length, 2);
  app.nodo('filtro-nombre').value = 'no existe';
  app.nodo('filtro-nombre').dispatch('input');
  assert.match(textoDe(app.nodo('tabla-envoltura')), /Sin coincidencias/);
  assert.equal(app.llamadas.length, antes);
});

test('additional columns are hidden by default and stay unchanged by the week filter', () => {
  const app = abrirConResultado();
  assert.equal(app.nodo('nota-adicionales').hidden, true);
  const tabla = () => recolectar(app.nodo('tabla-envoltura')).filter(hijo => hijo.tagName === 'TABLE')[0];
  assert.doesNotMatch(textoDe(tabla()), /WoW/);
  app.nodo('mostrar-adicionales').checked = true;
  app.nodo('mostrar-adicionales').dispatch('change');
  assert.equal(app.nodo('nota-adicionales').hidden, false);
  assert.match(textoDe(etiquetas(tabla(), 'TR')[0]), /WoW · R8 · interpretación pendiente/);
  const conTodas = etiquetas(tabla(), 'BUTTON').map(boton => boton.textContent);
  app.nodo('filtro-semana').value = '2026-09-14';
  app.nodo('filtro-semana').dispatch('change');
  const conUna = etiquetas(tabla(), 'BUTTON').map(boton => boton.textContent);
  assert.ok(conUna.includes('12'), 'the additional value must survive the week filter');
  assert.ok(conTodas.includes('12'));
  assert.match(textoDe(app.nodo('nota-adicionales')), /no se\s+recalculan y no se comparan con la semana elegida/);
});

test('the cell detail shows the original value, the shown text, format, state and coordinate', () => {
  const app = abrirConResultado();
  const tabla = recolectar(app.nodo('tabla-envoltura')).filter(hijo => hijo.tagName === 'TABLE')[0];
  const oculto = etiquetas(tabla, 'BUTTON').filter(boton => boton.textContent === '—')[0];
  assert.ok(oculto, 'the hidden-number cell must be rendered with its displayed text');
  oculto.dispatch('click');
  const detalle = app.nodo('detalle');
  assert.match(textoDe(detalle), /Fila con formato que oculta/);
  assert.match(textoDe(detalle), /Valor original[^|]*\| 5/);
  assert.match(textoDe(detalle), /Formato[^|]*\| "—"/);
  assert.match(textoDe(detalle), /Estado[^|]*\| numero/);
  assert.match(textoDe(detalle), /Coordenada[^|]*\| WebApp!I11/);
  assert.match(textoDe(detalle), /El formato de la hoja no muestra este número/);
  assert.match(textoDe(detalle), /contiene una fórmula/);
  const vacias = etiquetas(tabla, 'BUTTON').filter(boton => boton.textContent === 'Sin dato');
  vacias[0].dispatch('click');
  assert.match(textoDe(app.nodo('detalle')), /Fila vacía/);
  assert.match(textoDe(app.nodo('detalle')), /\(sin valor\)/);
  assert.match(textoDe(app.nodo('detalle')), /WebApp!I10/);
  vacias[1].dispatch('click');
  assert.match(textoDe(app.nodo('detalle')), /Fila sin lectura/);
  assert.match(textoDe(app.nodo('detalle')), /Sin dato para esta celda/);
});

test('the inventory keeps every named row, including the ones above the header row', () => {
  const app = abrirConResultado();
  const inventario = recolectar(app.nodo('inventario-envoltura')).filter(hijo => hijo.tagName === 'TABLE')[0];
  assert.match(textoDe(inventario), /Fila anterior al encabezado/);
  assert.match(textoDe(inventario), /WebApp!F6/);
  assert.match(textoDe(inventario), /Metadatos C:F \(sin reinterpretar\)/);
  assert.match(textoDe(inventario), /C=meta C/);
  assert.match(textoDe(inventario), /D=Sin dato/);
  assert.match(textoDe(inventario), /pendiente/);
});

test('a rejected reading never shows data and keeps the previous result marked as older', () => {
  const rechazos = [
    () => lectura({ estado: 'error', datosUtilizables: false,
      error: { codigo: 'LECTURA_SIN_ESTABILIDAD', requiereRestauracionManual: false } }),
    () => lectura({ datosUtilizables: false }),
    () => lectura({ lectura: Object.assign(lectura().lectura, { estableObservada: false }) }),
    () => lectura({ paisSolicitado: 'Argentina' }),
    () => ({ schemaVersion: 'weekly-lectura/2', estado: 'ok', datosUtilizables: true })
  ];
  for (const rechazo of rechazos) {
    const app = abrirConResultado();
    app.nodo('country').value = 'LATAM';
    app.nodo('consultar').dispatch('click');
    app.responder(rechazo());
    assert.equal(app.nodo('error-panel').hidden, false);
    assert.equal(app.nodo('resultado-obsoleto').hidden, false);
    assert.match(app.nodo('resultado-obsoleto').textContent, /Resultado anterior de Chile/);
    assert.match(app.nodo('resultado-obsoleto').textContent, /2026-09-20 00:00:01\.000 UTC/);
    assert.equal(app.nodo('resultado-pais').textContent, 'País del resultado: Chile');
    assert.ok(app.nodo('resultado').className.includes('card--obsoleto'));
    assert.equal(app.nodo('consultar').disabled, false);
  }
});

test('the mismatch rejection explains itself instead of showing foreign data', () => {
  const app = abrirConResultado();
  app.nodo('country').value = 'Chile';
  app.nodo('consultar').dispatch('click');
  app.responder(lectura({ paisSolicitado: 'Argentina' }));
  assert.match(app.nodo('error-mensaje').textContent, /no corresponde al país solicitado/);
  assert.doesNotMatch(textoDe(app.nodo('tabla-envoltura')), /Argentina/);
});

test('a busy lock and a failed restoration are explained with the manual exit', () => {
  const app = arranque();
  app.responder(OPCIONES);
  app.nodo('country').value = 'Chile';
  app.nodo('consultar').dispatch('click');
  app.fallar({ codigo: 'SELECTOR_LOCK_UNAVAILABLE' });
  assert.match(app.nodo('error-mensaje').textContent, /otra lectura en curso/);
  assert.match(app.nodo('error-mensaje').textContent, /volvé a presionar Consultar/);
  assert.equal(app.nodo('consultar').disabled, false);
  app.nodo('consultar').dispatch('click');
  app.fallar({ codigo: 'SELECTOR_UNEXPECTED', requiereRestauracionManual: true,
    restauracionCodigo: 'SELECTOR_UNEXPECTED', liberacionCodigo: null });
  assert.match(app.nodo('error-mensaje').textContent, /WebApp!H4/);
  assert.equal(app.nodo('resultado').hidden, true);
});

test('a server failure without a code falls back to the generic message', () => {
  const app = arranque();
  app.responder(OPCIONES);
  app.nodo('country').value = 'Chile';
  app.nodo('consultar').dispatch('click');
  app.fallar(new Error('private'));
  assert.match(app.nodo('error-mensaje').textContent, /error no clasificado/);
  assert.doesNotMatch(app.nodo('error-mensaje').textContent, /private/);
});

const tablaDe = app => recolectar(app.nodo('tabla-envoltura')).filter(hijo => hijo.tagName === 'TABLE')[0];
const boton = (app, texto) => etiquetas(tablaDe(app), 'BUTTON').filter(b => b.textContent === texto)[0];

test('a LATAM result is identified as a regional aggregate, not as a country', () => {
  const app = abrirConResultado(lecturaLatam(), 'LATAM');
  assert.equal(app.nodo('resultado-pais').textContent, 'Agregado regional: LATAM');
  const celdaRegional = boton(app, '0');
  assert.ok(celdaRegional, 'the regional reading must render its cells');
  celdaRegional.dispatch('click');
  const detalle = textoDe(app.nodo('detalle'));
  assert.match(detalle, /Agregado regional[^|]*\| LATAM/);
  assert.match(detalle, /Lectura[^|]*\| 2026-09-20 00:00:01\.000 UTC/);
  assert.doesNotMatch(detalle, /País del resultado/);
});

test('the cell detail identifies the result, its reading time, the indicator, the period and the coordinate', () => {
  const app = abrirConResultado();
  const oculto = boton(app, '—');
  assert.ok(oculto, 'the hidden-number cell must be rendered with its displayed text');
  oculto.dispatch('click');
  const detalle = textoDe(app.nodo('detalle'));
  assert.match(detalle, /País del resultado[^|]*\| Chile/);
  assert.match(detalle, /Lectura[^|]*\| 2026-09-20 00:00:01\.000 UTC/);
  assert.match(detalle, /Indicador[^|]*\| Fila con formato que oculta/);
  assert.match(detalle, /Período[^|]*\| semana 2026-09-07 · columna I8/);
  assert.match(detalle, /Coordenada[^|]*\| WebApp!I11/);
  assert.equal(app.nodo('detalle').children[0].textContent, 'Detalle de celda');
});

test('a new accepted reading clears the cell detail from the previous result', () => {
  const app = abrirConResultado();
  boton(app, '—').dispatch('click');
  assert.match(textoDe(app.nodo('detalle')), /Fila con formato que oculta/);
  app.nodo('country').value = 'LATAM';
  app.nodo('consultar').dispatch('click');
  app.responder(lecturaLatam());
  const detalle = textoDe(app.nodo('detalle'));
  assert.match(detalle, /Seleccioná una celda de la tabla para ver su detalle\./);
  assert.doesNotMatch(detalle, /Fila con formato que oculta/);
  assert.doesNotMatch(detalle, /Chile/);
  assert.doesNotMatch(detalle, /WebApp!I11/);
  assert.equal(app.nodo('resultado-pais').textContent, 'Agregado regional: LATAM');
});

test('a second successful reading of the same country also clears the detail', () => {
  const app = abrirConResultado();
  boton(app, '—').dispatch('click');
  assert.match(textoDe(app.nodo('detalle')), /WebApp!I11/);
  app.nodo('consultar').dispatch('click');
  app.responder(lectura());
  const detalle = textoDe(app.nodo('detalle'));
  assert.match(detalle, /Seleccioná una celda de la tabla para ver su detalle\./);
  assert.doesNotMatch(detalle, /WebApp!I11/);
  assert.doesNotMatch(detalle, /resultado anterior/);
});

test('an error after a success keeps the previous country and date and marks its detail as previous', () => {
  const app = abrirConResultado();
  boton(app, '—').dispatch('click');
  app.nodo('country').value = 'LATAM';
  app.nodo('consultar').dispatch('click');
  app.fallar({ codigo: 'SELECTOR_DEADLINE' });
  const detalle = textoDe(app.nodo('detalle'));
  assert.match(detalle, /Fila con formato que oculta/);
  assert.match(detalle, /País del resultado[^|]*\| Chile/);
  assert.match(detalle, /Lectura[^|]*\| 2026-09-20 00:00:01\.000 UTC \(resultado anterior\)/);
  assert.match(detalle, /Este detalle pertenece a un resultado anterior/);
  assert.equal(app.nodo('resultado-pais').textContent, 'País del resultado: Chile');
  assert.match(app.nodo('resultado-obsoleto').textContent, /Resultado anterior de Chile/);
  assert.match(app.nodo('resultado-obsoleto').textContent, /2026-09-20 00:00:01\.000 UTC/);
  assert.equal(app.nodo('consultar').disabled, false);
});
