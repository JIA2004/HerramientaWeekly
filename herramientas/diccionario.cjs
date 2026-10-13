// KPI dictionary of a downloaded .xlsx copy: what every row of "2) Weekly por
// pais" is, how it is obtained, in which unit it is compared, which direction
// is favourable, what the sheet's own glossary says about it and what still
// has to be settled with the team. Nothing is invented: a field the sheet does
// not state is reported as missing.
//
//   node herramientas/diccionario.cjs "<ruta al .xlsx>"
//
// It also writes the same knowledge as context for a data agent that queries
// the weekly table (contexto-agente.md / .json): per column, not per sheet row.
//
// Output goes to salidas/ (ignored by git: company data).

const fs = require('node:fs');
const path = require('node:path');
const { abrirXlsx } = require('./xlsx.cjs');
const { construirEntrada, matrices } = require('./analizar.cjs');

const raiz = path.resolve(__dirname, '..');
const HOJA_GLOSARIO = 'Weekly_Glossary';

const plano = valor => String(valor === null || valor === undefined ? '' : valor).replace(/\s+/g, ' ').trim();
const sinAcentos = texto => plano(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// The glossary tab is located by content: the header row is the one with a
// description column; the name column is "Metrica"; the key column is the
// remaining header of that row.
function leerGlosario(valores) {
  const vacio = { filas: [], porClave: {}, porNombre: {} };
  if (!valores) return vacio;
  for (let f = 0; f < Math.min(valores.length, 20); f++) {
    const titulos = valores[f].map(sinAcentos);
    const colDescripcion = titulos.findIndex(t => /^descripcion/.test(t));
    const colNombre = titulos.findIndex(t => /^metrica$/.test(t));
    if (colDescripcion === -1 || colNombre === -1) continue;
    const colClave = titulos.findIndex((t, c) => t !== '' && c !== colDescripcion && c !== colNombre);
    if (colClave === -1) return vacio;
    const glosario = { filas: [], porClave: {}, porNombre: {} };
    for (let g = f + 1; g < valores.length; g++) {
      const entrada = { fila: g + 1, nombre: plano(valores[g][colNombre]), clave: plano(valores[g][colClave]),
        descripcion: plano(valores[g][colDescripcion]) };
      if (entrada.nombre === '' && entrada.clave === '') continue;
      glosario.filas.push(entrada);
      if (entrada.clave !== '' && !glosario.porClave[entrada.clave]) glosario.porClave[entrada.clave] = entrada;
      if (entrada.nombre !== '') {
        const nombre = sinAcentos(entrada.nombre);
        (glosario.porNombre[nombre] = glosario.porNombre[nombre] || []).push(entrada);
      }
    }
    return glosario;
  }
  return vacio;
}

function mediana(lista) {
  if (!lista.length) return null;
  const orden = lista.slice().sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

// armado: what construirEntrada / weeklyFuenteEntrada_ return, plus the engine
// context (motor). formulasKpi is the getFormulas() matrix of the KPI sheet.
function construirDiccionario(armado, formulasKpi, glosario) {
  const motor = armado.motor;
  const kpis = armado.entrada.catalogo.kpis;
  const porId = {};
  kpis.forEach(kpi => { porId[kpi.id] = kpi; });
  const filaHoja = {};
  armado.lectura.filas.forEach(fila => { filaHoja[fila.fila] = fila; });
  const ref = id => (porId[id] ? 'fila ' + porId[id].fila + ' (' + porId[id].nombre + ')' : 'una fila sin KPI');
  const mismos = {};
  kpis.forEach(kpi => { (mismos[sinAcentos(kpi.nombre)] = mismos[sinAcentos(kpi.nombre)] || []).push(kpi.fila); });
  const lideres = {};
  motor.weeklyMotorLideres_(kpis).forEach(kpi => { lideres[kpi.id] = true; });
  const semana = armado.entrada.semanas.slice().sort().pop();
  const valores = {};
  armado.entrada.entidades.forEach(entidad => {
    const propios = motor.weeklyMotorValores_(armado.entrada, entidad.nombre);
    valores[entidad.nombre] = { tipo: entidad.tipo, valores: propios.valores, ultima: propios.semanas.length - 1 };
  });
  const paises = armado.entrada.entidades.filter(entidad => entidad.tipo === 'pais').length;

  const entradas = kpis.map(kpi => {
    const def = kpi.def;
    const hoja = filaHoja[kpi.fila] || {};
    const observaciones = [];
    let origen;
    if (!def) origen = 'No se pudo interpretar';
    else if (def.tipo === 'campo') origen = 'Columna `' + def.campo + '` del extract';
    else if (def.tipo === 'campoSobre') origen = 'Columna `' + def.campo + '` del extract ÷ ' + ref(def.den);
    else if (def.tipo === 'razon') origen = ref(def.num) + ' ÷ ' + ref(def.den);
    else if (def.tipo === 'producto') origen = ref(def.a) + ' × ' + ref(def.b);
    else if (def.tipo === 'suma') origen = 'Suma de las filas ' + porId[def.partes[0]].fila + ' a ' + porId[def.partes[def.partes.length - 1]].fila;
    else origen = '100 % − ' + def.partes.map(ref).join(' − ');

    const variacion = plano(hoja.formulaVariacion).replace(/\s+/g, '');
    const unidadDeLaHoja = /^=?\([A-Z$]+\d+-[A-Z$]+\d+\)\*100$/.test(variacion) || /^=?[A-Z$]+\d+\/[A-Z$]+\d+-1$/.test(variacion);

    // Coverage and typical size on the last week, countries only.
    const conDato = [];
    let latam = null;
    Object.keys(valores).forEach(nombre => {
      const serie = valores[nombre].valores[kpi.id];
      const valor = serie ? serie[valores[nombre].ultima] : null;
      if (valores[nombre].tipo === 'LATAM') latam = valor;
      else if (valor !== null) conDato.push(valor);
    });
    const tipico = mediana(conDato.map(Math.abs));

    // How the technical key got into its cell: typed, or looked up by the
    // visible name in the glossary (ambiguous when the name is there twice).
    const busca = /MATCH\(\$?([A-Z]{1,3})\$?\d+\s*[,;]/i.exec(plano(hoja.formulaValor));
    const formulaClave = busca && formulasKpi[kpi.fila - 1]
      ? plano(formulasKpi[kpi.fila - 1][motor.weeklyFuenteColumna_(busca[1].toUpperCase())]) : '';
    const homonimos = glosario.porNombre[sinAcentos(kpi.nombre)] || [];
    const clavePorNombre = /VLOOKUP|BUSCARV/i.test(formulaClave);
    const claveAmbigua = clavePorNombre && homonimos.length > 1;

    const enGlosario = kpi.clave !== '' ? glosario.porClave[kpi.clave] : (homonimos.length === 1 ? homonimos[0] : null);
    const descripcion = enGlosario ? enGlosario.descripcion : '';

    if (!def) {
      // Said in terms of the cell to fill in, not of the parser.
      const lee = /SUMIFS\(/i.test(plano(hoja.formulaValor));
      const motivo = [lee && kpi.clave === '' ? 'la celda de la clave técnica está vacía, así que la fórmula no sabe qué columna del extract leer'
        : lee ? 'la clave `' + kpi.clave + '` no es una columna del extract' : 'su fórmula no es de un tipo que la herramienta sepa leer'];
      if (kpi.direccion === null) motivo.push('tampoco tiene dirección favorable (1 o -1)');
      observaciones.push({ tipo: 'fuera', texto: 'Fuera de la primera versión: ' + motivo.join('; ') + '.' });
    }
    if (kpi.duplicadoDe) {
      observaciones.push({ tipo: 'mismoDato', texto: 'Es el mismo dato que la ' + ref(kpi.duplicadoDe) + ': se muestra, pero se analiza una sola vez.' });
    }
    if (mismos[sinAcentos(kpi.nombre)].length > 1) {
      observaciones.push({ tipo: 'nombreRepetido', texto: 'El nombre "' + kpi.nombre + '" está en las filas ' +
        mismos[sinAcentos(kpi.nombre)].join(', ') + '; se distingue por la sección y por el identificador.' });
    }
    if (claveAmbigua) {
      observaciones.push({ tipo: 'claveAmbigua', texto: 'La clave se busca por nombre en ' + HOJA_GLOSARIO + ', donde "' + kpi.nombre +
        '" está ' + homonimos.length + ' veces (' + homonimos.map(h => '`' + (h.clave || 'sin clave') + '`').join(', ') +
        '). Hoy toma `' + kpi.clave + '`. Conviene escribir la clave fija en la celda.' });
    }
    if (def && kpi.direccion === null) observaciones.push({ tipo: 'sinDireccion', texto: 'Sin dirección favorable: no se dice si un cambio es bueno o malo.' });
    if (def && !unidadDeLaHoja) {
      observaciones.push({ tipo: 'unidadInferida', texto: 'La columna WoW de esta fila no usa ninguna de las dos fórmulas simples de la hoja (N/M-1 o (N-M)*100); la unidad (' +
        (kpi.unidad === 'pp' ? 'pp' : '%') + ') se dedujo del tipo de cálculo.' });
    }
    if (def && kpi.unidad === 'pp' && tipico !== null && tipico > 1.0001) {
      observaciones.push({ tipo: 'escala', texto: 'Se compara en puntos porcentuales pero sus valores no son una proporción entre 0 y 1 (valor típico ' +
        numero(tipico) + '). Revisar la unidad.' });
    }
    if (def && /\(M\s*(eur|€|usd)\)/i.test(kpi.nombre) && tipico !== null && tipico >= 10000) {
      observaciones.push({ tipo: 'escala', texto: 'El nombre dice millones y el valor típico es ' + numero(tipico) + ': parece estar en unidades, no en millones.' });
    }
    if (def && conDato.length === 0) {
      observaciones.push({ tipo: 'sinDatos', texto: 'Ningún país tiene dato en la semana del ' + semana + '.' });
    }
    if (descripcion === '') {
      observaciones.push({ tipo: 'sinDescripcion', texto: enGlosario ? 'Está en ' + HOJA_GLOSARIO + ' sin descripción.'
        : (def && def.tipo !== 'campo' && def.tipo !== 'campoSobre' ? 'Es un cálculo de la hoja; no tiene descripción propia en ' + HOJA_GLOSARIO + '.'
          : 'No está en ' + HOJA_GLOSARIO + '.') });
    }
    return { fila: kpi.fila, uid: kpi.uid, seccion: kpi.seccion, bloque: kpi.bloque, nombre: kpi.nombre, etiqueta: kpi.etiqueta,
      clave: kpi.clave, origen, unidad: def ? kpi.unidad : null, unidadDeLaHoja, direccion: kpi.direccion,
      descripcion, enPrimeraVersion: !!def, lider: !!lideres[kpi.id], mismoDatoQueFila: kpi.duplicadoDe ? porId[kpi.duplicadoDe].fila : null,
      clavePorNombre, paisesConDato: conDato.length, latamConDato: latam !== null, valorTipico: tipico, observaciones,
      tipo: def ? def.tipo : null, campo: def && (def.tipo === 'campo' || def.tipo === 'campoSobre') ? def.campo : null,
      formula: def && def.tipo === 'campoSobre' ? def.campo + '/' + porId[porId[def.den].duplicadoDe || def.den].uid
        : def && def.tipo !== 'campo' ? kpi.uid : null };
  });
  const usadas = {};
  entradas.forEach(k => { if (k.campo) usadas[k.campo] = true; });
  return { semana, paises, entradas, mercados: armado.entrada.entidades.map(entidad => ({ nombre: entidad.nombre, tipo: entidad.tipo })),
    columnasSinUso: (armado.fuente ? armado.fuente.campos : []).filter(campo => !usadas[campo]), glosario: { filas: glosario.filas.length,
    sinUso: glosario.filas.filter(g => g.clave !== '' && !kpis.some(kpi => kpi.clave === g.clave)).map(g => g.clave) } };
}

function numero(valor) {
  const abs = Math.abs(valor);
  return valor.toLocaleString('es-AR', { maximumFractionDigits: abs >= 100 ? 0 : abs >= 1 ? 2 : 4 });
}

const celda = texto => String(texto).replace(/\|/g, '\\|');
const UNIDAD = { rel: 'Variación en %', pp: 'Variación en puntos porcentuales (pp)' };
const DIRECCION = { '1': 'Subir es favorable', '-1': 'Bajar es favorable' };

function textoDiccionario(diccionario, origen) {
  const e = diccionario.entradas;
  const dentro = e.filter(k => k.enPrimeraVersion);
  const propios = dentro.filter(k => k.mismoDatoQueFila === null);
  const fuera = e.filter(k => !k.enPrimeraVersion);
  const con = tipo => e.filter(k => k.observaciones.some(o => o.tipo === tipo));
  const lineas = [];
  const agrega = texto => lineas.push(texto);
  agrega('# Diccionario de KPIs — ' + origen);
  agrega('');
  agrega('Generado a partir de `2) Weekly por pais` (qué KPIs hay y cómo se leen), del extract (valores) y de `' + HOJA_GLOSARIO +
    '` (descripciones). Semana de referencia: ' + diccionario.semana + '. Nada de esto está validado por el equipo todavía: ' +
    'la unidad, la dirección y la descripción son las que la hoja declara.');
  agrega('');
  agrega('## 1. Qué entra en la primera versión');
  agrega('');
  agrega('- Filas con KPI en la hoja: **' + e.length + '**.');
  agrega('- Entran en la primera versión: **' + dentro.length + '** (' + propios.length + ' KPIs distintos; ' +
    (dentro.length - propios.length) + ' filas repiten un dato que ya está en otra fila).');
  agrega('- Quedan fuera: **' + fuera.length + '**, porque la hoja no trae lo necesario para leerlas (detalle abajo).');
  agrega('- La regla es de la hoja, no del código: entra toda fila con clave técnica o fórmula interpretable. Completando la celda que falta, la fila entra sola.');
  agrega('');
  agrega('### KPIs que abren cada bloque (los que cuenta la web)');
  agrega('');
  agrega('Los tres primeros son el titular de cada mercado. El orden es el de la hoja.');
  agrega('');
  agrega('| # | Sección | Bloque | KPI | Fila | Identificador |');
  agrega('|---|---|---|---|---|---|');
  e.filter(k => k.lider).forEach((k, i) => agrega('| ' + (i + 1) + ' | ' + celda(k.seccion) + ' | ' + celda(k.bloque || '—') + ' | ' +
    celda(k.nombre) + ' | ' + k.fila + ' | `' + celda(k.uid) + '` |'));
  agrega('');
  agrega('### Filas que quedan fuera');
  agrega('');
  if (!fuera.length) agrega('Ninguna.');
  fuera.forEach(k => agrega('- Fila ' + k.fila + ', ' + k.etiqueta + ': ' +
    k.observaciones.filter(o => o.tipo === 'fuera').map(o => o.texto.replace(/^Fuera de la primera versión: /, '')).join(' ')));
  agrega('');
  agrega('## 2. Qué hay que resolver con el equipo');
  agrega('');
  const bloque = (titulo, tipo, explica) => {
    const lista = con(tipo);
    if (!lista.length) return;
    agrega('### ' + titulo + ' (' + lista.length + ')');
    agrega('');
    if (explica) { agrega(explica); agrega(''); }
    lista.forEach(k => agrega('- Fila ' + k.fila + ', ' + k.etiqueta + ': ' +
      k.observaciones.filter(o => o.tipo === tipo).map(o => o.texto).join(' ')));
    agrega('');
  };
  bloque('Claves que dependen del orden del glosario', 'claveAmbigua',
    'La celda de la clave técnica usa una búsqueda por nombre visible. Cuando el nombre está repetido en el glosario, la búsqueda devuelve la primera coincidencia: ' +
    'hoy puede ser la correcta, pero reordenar el glosario o mover la fila de sección la cambia sin aviso.');
  bloque('Unidad a revisar', 'escala');
  bloque('Unidad deducida, no declarada por la hoja', 'unidadInferida');
  bloque('Sin dirección favorable', 'sinDireccion');
  bloque('Sin datos en ningún país', 'sinDatos');
  const sinDescripcion = con('sinDescripcion').filter(k => k.enPrimeraVersion);
  agrega('### Sin descripción (' + sinDescripcion.length + ' de ' + dentro.length + ')');
  agrega('');
  agrega('La herramienta no escribe definiciones: muestra la que está en `' + HOJA_GLOSARIO + '`. Estas filas no tienen una.');
  agrega('');
  sinDescripcion.forEach(k => agrega('- Fila ' + k.fila + ', ' + k.etiqueta + (k.clave ? ' (`' + k.clave + '`)' : '') + ': ' +
    k.observaciones.filter(o => o.tipo === 'sinDescripcion').map(o => o.texto).join(' ')));
  agrega('');
  const repetidos = con('nombreRepetido');
  agrega('### Nombres repetidos (' + repetidos.length + ' filas)');
  agrega('');
  agrega('No es un error: el mismo nombre visible vive en varias secciones. Por eso ningún KPI se identifica por su nombre; el identificador es la clave técnica o, si es un cálculo, sus componentes.');
  agrega('');
  const grupos = {};
  repetidos.forEach(k => { (grupos[sinAcentos(k.nombre)] = grupos[sinAcentos(k.nombre)] || []).push(k); });
  Object.keys(grupos).sort().forEach(nombre => agrega('- ' + grupos[nombre][0].nombre + ': ' +
    grupos[nombre].map(k => 'fila ' + k.fila + ' (' + k.seccion + (k.bloque ? ' › ' + k.bloque : '') + ') `' + k.uid + '`').join('; ')));
  agrega('');
  agrega('## 3. Diccionario completo');
  agrega('');
  agrega('Unidad: cómo se compara una semana con la anterior. Cobertura: países con dato en la semana de referencia (de ' + diccionario.paises + ') y si LATAM lo trae.');
  agrega('');
  let seccion = null;
  e.forEach(k => {
    if (k.seccion !== seccion) {
      seccion = k.seccion;
      agrega('### ' + (seccion || 'Sin sección'));
      agrega('');
      agrega('| Fila | KPI | Identificador | Cómo se obtiene | Unidad | Favorable | Cobertura | Descripción de la hoja | Observaciones |');
      agrega('|---|---|---|---|---|---|---|---|---|');
    }
    agrega('| ' + [k.fila, celda((k.bloque ? k.bloque + ' › ' : '') + k.nombre), '`' + celda(k.uid) + '`', celda(k.origen),
      k.unidad ? UNIDAD[k.unidad] : '—', DIRECCION[String(k.direccion)] || 'Sin definir',
      k.enPrimeraVersion ? k.paisesConDato + '/' + diccionario.paises + (k.latamConDato ? ' + LATAM' : '') : '—',
      celda(k.descripcion || '—'),
      celda(k.observaciones.filter(o => o.tipo !== 'sinDescripcion' && o.tipo !== 'nombreRepetido').map(o => o.texto).join(' ') || '—')].join(' | ') + ' |');
  });
  agrega('');
  return lineas.join('\n');
}

// ---- Context for a data agent ------------------------------------------------
//
// The same dictionary turned around: one entry per column of the weekly table
// (what an agent querying BigQuery sees), the KPIs that exist only as a
// calculation, and the rules a reader of this table has to keep. It carries no
// figure, only names, definitions and rules.
function contextoAgente(diccionario) {
  const proporcion = k => k.unidad === 'pp' && (k.valorTipico === null || k.valorTipico <= 1.0001);
  const formato = k => (proporcion(k) ? 'Proporción entre 0 y 1 (0,25 es 25 %). Sus cambios se expresan en puntos porcentuales.'
    : k.unidad === 'pp' ? 'Se compara en puntos porcentuales, pero sus valores no son una proporción entre 0 y 1: unidad a confirmar.'
      : 'Número. Sus cambios se expresan en % contra la semana anterior.');
  // Without the figure the dictionary quotes: the context must stay free of values.
  const escala = k => (k.observaciones.some(o => o.tipo === 'escala' && /millones/.test(o.texto))
    ? ['El nombre dice millones, pero los valores están en unidades: no los leas como millones.'] : []);
  const avisos = k => escala(k)
    .concat(k.descripcion === '' ? ['Sin definición validada: no supongas su significado a partir del nombre; decí que no está definida.'] : [])
    .concat(k.paisesConDato === 0 ? ['Sin datos en ningún país en la última semana revisada.'] : []);
  const donde = k => k.seccion + (k.bloque ? ' › ' + k.bloque : '') + ' › ' + k.nombre;
  const columnas = {};
  const calculados = [];
  diccionario.entradas.filter(k => k.enPrimeraVersion).forEach(k => {
    if (k.tipo === 'campo') {
      if (columnas[k.campo]) { columnas[k.campo].aparece.push(donde(k)); return; }
      columnas[k.campo] = { columna: k.campo, nombre: k.etiqueta, aparece: [donde(k)], definicion: k.descripcion, formato: formato(k),
        favorable: k.direccion === 1 ? 'sube' : k.direccion === -1 ? 'baja' : null, seccion: k.seccion, advertencias: avisos(k) };
    } else {
      calculados.push({ nombre: k.etiqueta, aparece: donde(k), formula: k.formula, definicion: k.descripcion, formato: formato(k),
        favorable: k.direccion === 1 ? 'sube' : k.direccion === -1 ? 'baja' : null, seccion: k.seccion,
        advertencias: escala(k) });
    }
  });
  const porNombre = {};
  Object.keys(columnas).forEach(columna => {
    columnas[columna].aparece.forEach(lugar => {
      const visible = lugar.split(' › ').pop();
      (porNombre[sinAcentos(visible)] = porNombre[sinAcentos(visible)] || { nombre: visible, opciones: [] }).opciones.push({ columna, contexto: lugar });
    });
  });
  const homonimos = Object.keys(porNombre).map(nombre => porNombre[nombre])
    .filter(grupo => grupo.opciones.map(o => o.columna).filter((c, i, lista) => lista.indexOf(c) === i).length > 1)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const paises = diccionario.mercados.filter(m => m.tipo === 'pais').map(m => m.nombre);
  const agregados = diccionario.mercados.filter(m => m.tipo !== 'pais').map(m => m.nombre);
  const reglas = [
    'Cada fila de la tabla es un mercado (`country_name`) en una semana (`week_date`). La semana va de lunes a domingo y `week_date` es su lunes.',
    'Los mercados son ' + paises.length + ' países: ' + paises.join(', ') + '.' +
      (agregados.length ? ' ' + agregados.join(', ') + ' es el agregado regional: ya incluye a los países. Nunca lo sumes con ellos, no lo cuentes como país y no lo incluyas en rankings de países.' : ''),
    'Para "la semana pasada" usá la última semana completa: la mayor `week_date` que tenga datos. Compará siempre contra la `week_date` de 7 días antes, no contra la fila anterior.',
    'Una celda vacía (NULL) es un dato faltante, no un cero. No la reemplaces por 0 ni la trates como una caída; decí que falta. Un 0 escrito sí es un cero.',
    'Si un total o una proporción dependen de una columna que está vacía esa semana, el resultado es desconocido: no lo calcules con lo que haya.',
    'Las columnas que son proporciones (0 a 1) se comparan en puntos porcentuales: de 0,20 a 0,25 son +5 pp, no +25 %. Los volúmenes y montos se comparan en %.',
    'No sumes ni promedies proporciones, tasas, tiempos promedio ni usuarios activos (MAUs, clientes activos) entre países o entre semanas: no son aditivos. Para la región usá la fila del agregado regional.',
    'Varias columnas tienen nombres parecidos y miden cosas distintas según la vertical (general, Food, Dmart, AAAs, Local Stores). Usá la columna exacta de la lista; si la pregunta no dice la vertical, preguntá o aclaralo en la respuesta.',
    '"Favorable" dice si es bueno que la métrica suba o que baje. Si una métrica no lo tiene definido, describí el cambio sin calificarlo.',
    'Que dos métricas se muevan a la vez no prueba que una cause la otra. La tabla no tiene feriados, clima, campañas, competencia ni incidentes: no los des como causa.',
    'Si la pregunta usa una métrica que no está en esta lista, decilo en vez de elegir la columna de nombre más parecido.'
  ];
  return { semanaDeReferencia: diccionario.semana, reglas, homonimos, columnas: Object.keys(columnas).map(columna => columnas[columna]),
    calculados, columnasSinContexto: diccionario.columnasSinUso };
}

function textoAgente(contexto) {
  const lineas = [];
  const agrega = texto => lineas.push(texto);
  const favorable = valor => (valor === 'sube' ? 'Que suba' : valor === 'baja' ? 'Que baje' : 'Sin definir');
  agrega('# Contexto de la tabla Weekly');
  agrega('');
  agrega('Describe la tabla semanal de performance por país: qué es cada columna, cómo se lee y qué no hay que hacer con ella. ' +
    'Las definiciones son las del glosario del equipo; donde dice "sin definición validada" no hay ninguna.');
  agrega('');
  agrega('## Reglas');
  agrega('');
  contexto.reglas.forEach((regla, i) => agrega((i + 1) + '. ' + regla));
  agrega('');
  if (contexto.homonimos.length) {
    agrega('## Nombres que se repiten');
    agrega('');
    agrega('El mismo nombre visible corresponde a columnas distintas. Elegí por el contexto de la pregunta.');
    agrega('');
    contexto.homonimos.forEach(grupo => agrega('- **' + grupo.nombre + '**: ' +
      grupo.opciones.map(o => '`' + o.columna + '` (' + o.contexto.split(' › ').slice(0, -1).join(' › ') + ')').join('; ') + '.'));
    agrega('');
  }
  agrega('## Columnas');
  agrega('');
  let seccion = null;
  contexto.columnas.forEach(c => {
    if (c.seccion !== seccion) {
      seccion = c.seccion;
      agrega('### ' + seccion);
      agrega('');
    }
    agrega('- `' + c.columna + '` — ' + c.nombre + '. ' + (c.definicion || 'Sin definición validada.') + ' ' + c.formato + ' Favorable: ' +
      favorable(c.favorable).toLowerCase() + '.' + (c.aparece.length > 1 ? ' También figura como ' + c.aparece.slice(1).join('; ') + '.' : '') +
      (c.advertencias.length ? ' Atención: ' + c.advertencias.join(' ') : ''));
  });
  agrega('');
  agrega('## Métricas que se calculan');
  agrega('');
  agrega('No existen como columna. La fórmula está escrita con los nombres de las columnas; `sum(a+b)` es la suma de esas columnas y `1-a-b` es lo que queda del 100 %.');
  agrega('');
  contexto.calculados.forEach(c => agrega('- ' + c.nombre + ' = `' + c.formula + '`. ' + (c.definicion ? c.definicion + ' ' : '') + c.formato +
    ' Favorable: ' + favorable(c.favorable).toLowerCase() + '.' + (c.advertencias.length ? ' Atención: ' + c.advertencias.join(' ') : '')));
  agrega('');
  if (contexto.columnasSinContexto.length) {
    agrega('## Columnas sin contexto');
    agrega('');
    agrega('Están en la tabla y el reporte semanal no las usa, así que no tienen definición acá. No las uses para responder sin avisar que no están documentadas: ' +
      contexto.columnasSinContexto.map(c => '`' + c + '`').join(', ') + '.');
    agrega('');
  }
  return lineas.join('\n');
}

function diccionarioDeCopia(ruta, hoyIso) {
  const armado = construirEntrada(ruta, hoyIso);
  const libro = abrirXlsx(ruta);
  const config = armado.motor.weeklyFuenteConfig_ || require('node:vm').runInContext('weeklyFuenteConfig_', armado.motor);
  const formulas = matrices(libro.hoja(config.hojaKpis)).formulas;
  const glosario = leerGlosario(libro.nombres.indexOf(HOJA_GLOSARIO) === -1 ? null : matrices(libro.hoja(HOJA_GLOSARIO)).valores);
  return construirDiccionario(armado, formulas, glosario);
}

function principal(argumentos) {
  const ruta = argumentos.find(a => !a.startsWith('--'));
  if (!ruta) {
    console.error('Uso: node herramientas/diccionario.cjs "<ruta al .xlsx>"');
    process.exit(2);
  }
  const diccionario = diccionarioDeCopia(ruta, null);
  const salidas = path.join(raiz, 'salidas');
  fs.mkdirSync(salidas, { recursive: true });
  const base = path.join(salidas, 'diccionario-kpis');
  fs.writeFileSync(base + '.md', textoDiccionario(diccionario, path.basename(ruta)));
  fs.writeFileSync(base + '.json', JSON.stringify(diccionario, null, 1));
  const contexto = contextoAgente(diccionario);
  const agente = path.join(salidas, 'contexto-agente');
  fs.writeFileSync(agente + '.md', textoAgente(contexto));
  fs.writeFileSync(agente + '.json', JSON.stringify(contexto, null, 1));
  const e = diccionario.entradas;
  const cuenta = tipo => e.filter(k => k.observaciones.some(o => o.tipo === tipo)).length;
  console.log('Filas con KPI: ' + e.length + ' | en la primera versión: ' + e.filter(k => k.enPrimeraVersion).length +
    ' | fuera: ' + e.filter(k => !k.enPrimeraVersion).length);
  console.log('Con descripción: ' + e.filter(k => k.descripcion !== '').length + ' | clave ambigua: ' + cuenta('claveAmbigua') +
    ' | unidad a revisar: ' + cuenta('escala') + ' | sin dirección: ' + cuenta('sinDireccion') + ' | sin datos: ' + cuenta('sinDatos'));
  console.log('Diccionario: ' + path.relative(raiz, base + '.md'));
  console.log('Contexto para el agente: ' + path.relative(raiz, agente + '.md') + ' (' + contexto.columnas.length + ' columnas, ' +
    contexto.calculados.length + ' métricas calculadas, ' + contexto.columnas.filter(c => !c.definicion).length + ' columnas sin definición)');
}

if (require.main === module) principal(process.argv.slice(2));

module.exports = { leerGlosario, construirDiccionario, textoDiccionario, contextoAgente, textoAgente, diccionarioDeCopia };
