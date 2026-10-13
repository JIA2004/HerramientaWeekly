// Validation of the reading by market and week on one or more downloaded .xlsx
// copies. It answers, with counts and examples, the three things a reading can
// get wrong:
//   - zero, blank and error taken for one another;
//   - one market's or one week's number shown under another;
//   - a number that is not the one the sheet shows.
//
//   node herramientas/validar.cjs "<copia.xlsx>" ["<otra copia.xlsx>" ...] [--hoy=AAAA-MM-DD]
//
// Each copy carries the visible values of the one market its selector held
// when it was downloaded, so several copies (one per market) widen the
// comparison against the sheet. Output goes to salidas/ (ignored by git).

const fs = require('node:fs');
const path = require('node:path');
const { construirEntrada } = require('./analizar.cjs');
const { abrirXlsx } = require('./xlsx.cjs');
const { matrices } = require('./analizar.cjs');

const raiz = path.resolve(__dirname, '..');
const DIA = 86400000;
const plano = valor => String(valor === null || valor === undefined ? '' : valor).replace(/\s+/g, ' ').trim();
const esLunes = iso => new Date(iso + 'T00:00:00Z').getUTCDay() === 1;

// armado: what weeklyFuenteEntrada_ returns plus the engine context (motor).
// valoresDatos is the raw getValues() matrix of the extract, read here on its
// own, without going through the builders under test.
function validarLectura(armado, valoresDatos) {
  const motor = armado.motor;
  const aIso = valor => motor.weeklyFuenteFecha_(valor, fecha => fecha.toISOString().slice(0, 10));
  const entrada = armado.entrada;
  const semanas = entrada.semanas.slice().sort();
  const titulos = valoresDatos[0].map(plano);
  const colSemana = titulos.indexOf('week_date');
  const colPais = titulos.indexOf('country_name');
  const colId = titulos.indexOf('country_id');

  // ---- The extract, row by row ----------------------------------------------
  const filasDe = {};
  const idsDe = {};
  const nombresDe = {};
  const integridad = { filas: valoresDatos.length - 1, sinPais: 0, sinSemana: 0, noLunes: [], duplicadas: [],
    idsConVariosNombres: [], nombresConVariosIds: [], saltos: [], mercados: [] };
  for (let f = 1; f < valoresDatos.length; f++) {
    const fila = valoresDatos[f];
    if (fila.every(valor => plano(valor) === '')) { integridad.filas--; continue; }
    const semana = aIso(fila[colSemana]);
    const pais = plano(fila[colPais]);
    if (pais === '') integridad.sinPais++;
    if (!semana) integridad.sinSemana++;
    if (pais === '' || !semana) continue;
    if (!esLunes(semana) && integridad.noLunes.indexOf(semana) === -1) integridad.noLunes.push(semana);
    const clave = pais + '|' + semana;
    if (filasDe[clave]) integridad.duplicadas.push({ mercado: pais, semana });
    (filasDe[clave] = filasDe[clave] || []).push(fila);
    if (colId !== -1) {
      const id = plano(fila[colId]);
      (idsDe[pais] = idsDe[pais] || {})[id] = true;
      (nombresDe[id] = nombresDe[id] || {})[pais] = true;
    }
  }
  Object.keys(idsDe).forEach(pais => { if (Object.keys(idsDe[pais]).length > 1) integridad.nombresConVariosIds.push(pais); });
  Object.keys(nombresDe).forEach(id => { if (Object.keys(nombresDe[id]).length > 1) integridad.idsConVariosNombres.push(id + ': ' + Object.keys(nombresDe[id]).join(', ')); });
  for (let i = 1; i < semanas.length; i++) {
    const dias = (Date.parse(semanas[i]) - Date.parse(semanas[i - 1])) / DIA;
    if (dias !== 7) integridad.saltos.push(semanas[i - 1] + ' → ' + semanas[i] + ' (' + dias + ' días)');
  }
  entrada.entidades.forEach(entidad => {
    const propias = semanas.filter(semana => filasDe[entidad.nombre + '|' + semana]);
    const desde = semanas.indexOf(propias[0]);
    integridad.mercados.push({ nombre: entidad.nombre, tipo: entidad.tipo, semanas: propias.length, primera: propias[0], ultima: propias[propias.length - 1],
      faltantes: semanas.slice(desde).filter(semana => !filasDe[entidad.nombre + '|' + semana]) });
  });

  // ---- Zero, blank and error, kept apart --------------------------------------
  // Only the extract columns the catalog actually reads, over the weeks the
  // sheet shows.
  const kpisDeCampo = entrada.catalogo.kpis.filter(kpi => kpi.def && kpi.def.tipo === 'campo' && !kpi.duplicadoDe);
  const campos = {};
  entrada.catalogo.kpis.forEach(kpi => {
    if (kpi.def && (kpi.def.tipo === 'campo' || kpi.def.tipo === 'campoSobre')) campos[kpi.def.campo] = titulos.indexOf(kpi.def.campo);
  });
  const ventana = armado.lectura.semanasHoja.filter(semana => semanas.indexOf(semana) !== -1);
  const estados = { semanas: ventana, campos: Object.keys(campos).length, mercados: [], textos: [],
    total: { numero: 0, cero: 0, vacio: 0, texto: 0 } };
  entrada.entidades.forEach(entidad => {
    const cuenta = { nombre: entidad.nombre, numero: 0, cero: 0, vacio: 0, texto: 0, sinFila: 0 };
    ventana.forEach(semana => {
      const filas = filasDe[entidad.nombre + '|' + semana];
      if (!filas) { cuenta.sinFila++; return; }
      const fila = filas[filas.length - 1];
      Object.keys(campos).forEach(campo => {
        const crudo = fila[campos[campo]];
        const estado = crudo === '' || crudo === null || crudo === undefined ? 'vacio'
          : typeof crudo === 'number' && isFinite(crudo) ? (crudo === 0 ? 'cero' : 'numero') : 'texto';
        cuenta[estado]++;
        estados.total[estado]++;
        if (estado === 'texto' && estados.textos.length < 10) estados.textos.push({ mercado: entidad.nombre, semana, campo, valor: plano(crudo).slice(0, 30) });
        // What the reading must have kept: null, 0, the number or the text.
        const leido = entrada.datos[entidad.nombre][campo][semana];
        const bien = estado === 'vacio' ? leido === null : estado === 'texto' ? typeof leido === 'string' : leido === crudo;
        if (!bien) (estados.malLeidos = estados.malLeidos || []).push({ mercado: entidad.nombre, semana, campo });
      });
    });
    estados.mercados.push(cuenta);
  });
  estados.malLeidos = estados.malLeidos || [];

  // ---- Every market, every week: the engine against the sheet's own rule -----
  // The sheet fills a cell with SUMIFS(column of the key; week; market). The
  // same rule is applied here straight on the raw rows, for the 16 markets,
  // and compared with the value the engine works with.
  const relectura = { comparadas: 0, diferencias: 0, muestras: [], porMercado: [] };
  entrada.entidades.forEach(entidad => {
    const motorValores = motor.weeklyMotorValores_(entrada, entidad.nombre);
    let propias = 0;
    let distintas = 0;
    kpisDeCampo.forEach(kpi => {
      const columna = campos[kpi.def.campo];
      const serie = motorValores.valores[kpi.id];
      motorValores.semanas.forEach((semana, i) => {
        const filas = filasDe[entidad.nombre + '|' + semana] || [];
        const numeros = filas.map(fila => fila[columna]).filter(valor => typeof valor === 'number' && isFinite(valor));
        const esperado = numeros.length ? numeros.reduce((a, b) => a + b, 0) : null;
        propias++;
        if (esperado === serie[i]) return;
        distintas++;
        if (relectura.muestras.length < 10) relectura.muestras.push({ mercado: entidad.nombre, semana, fila: kpi.fila, kpi: kpi.etiqueta, hoja: esperado, motor: serie[i] });
      });
    });
    relectura.comparadas += propias;
    relectura.diferencias += distintas;
    relectura.porMercado.push({ nombre: entidad.nombre, comparadas: propias, diferencias: distintas });
  });

  // ---- Periods ---------------------------------------------------------------
  const hoja = armado.lectura.semanasHoja;
  const periodos = { semanasHoja: hoja, ultimaExtract: semanas[semanas.length - 1], esperada: entrada.semanaEsperada,
    hojaSonLunes: hoja.every(esLunes),
    hojaConsecutivas: hoja.every((semana, i) => i === 0 || Date.parse(semana) - Date.parse(hoja[i - 1]) === 7 * DIA),
    hojaEnExtract: hoja.every(semana => semanas.indexOf(semana) !== -1),
    mismaUltima: hoja[hoja.length - 1] === semanas[semanas.length - 1] };

  const paises = entrada.entidades.filter(entidad => entidad.tipo === 'pais').length;
  const latam = entrada.entidades.filter(entidad => entidad.tipo === 'LATAM').length;
  const c = armado.coincidencia;
  const controles = [
    { nombre: 'Mercados', ok: latam === 1, detalle: paises + ' países y ' + (latam === 1 ? 'LATAM aparte, como agregado' : latam + ' agregados regionales') + '.' },
    { nombre: 'Toda fila del extract tiene país y semana', ok: integridad.sinPais + integridad.sinSemana === 0,
      detalle: integridad.filas + ' filas; ' + integridad.sinPais + ' sin país y ' + integridad.sinSemana + ' sin una fecha de semana legible (esas filas no se leen).' },
    { nombre: 'Una sola fila por país y semana', ok: integridad.duplicadas.length === 0,
      detalle: integridad.duplicadas.length ? integridad.duplicadas.length + ' combinaciones repetidas, por ejemplo ' + integridad.duplicadas[0].mercado + ' ' + integridad.duplicadas[0].semana + '. La hoja las suma; la herramienta usa la última y lo avisa.'
        : 'Ninguna combinación repetida.' },
    { nombre: 'Cada país con un solo identificador', ok: !integridad.idsConVariosNombres.length && !integridad.nombresConVariosIds.length,
      detalle: colId === -1 ? 'El extract no trae country_id; no se pudo cruzar.' : integridad.idsConVariosNombres.concat(integridad.nombresConVariosIds).join('; ') || 'Cada country_id corresponde a un solo nombre y al revés.' },
    { nombre: 'Semanas de lunes a domingo, sin saltos', ok: !integridad.noLunes.length && !integridad.saltos.length,
      detalle: semanas.length + ' semanas, del ' + semanas[0] + ' al ' + semanas[semanas.length - 1] + '.' +
        (integridad.noLunes.length ? ' No empiezan en lunes: ' + integridad.noLunes.slice(0, 5).join(', ') + '.' : ' Todas empiezan en lunes.') +
        (integridad.saltos.length ? ' Saltos: ' + integridad.saltos.slice(0, 5).join('; ') + '.' : ' Sin saltos.') },
    { nombre: 'Todos los mercados tienen todas las semanas', ok: integridad.mercados.every(m => !m.faltantes.length),
      detalle: integridad.mercados.filter(m => m.faltantes.length).map(m => m.nombre + ' (' + m.faltantes.length + ')').join(', ') || 'Ningún mercado tiene semanas faltantes desde su primera semana.' },
    { nombre: 'Las semanas de la hoja son las del extract', ok: periodos.hojaSonLunes && periodos.hojaConsecutivas && periodos.hojaEnExtract && periodos.mismaUltima,
      detalle: 'La hoja muestra ' + hoja.length + ' semanas, del ' + hoja[0] + ' al ' + hoja[hoja.length - 1] + '; la última del extract es ' + periodos.ultimaExtract +
        (periodos.esperada ? ' y la última semana cerrada a la fecha de la corrida es ' + periodos.esperada : '') + '.' },
    { nombre: 'Cero, vacío y error se leen como lo que son', ok: estados.malLeidos.length === 0,
      detalle: (estados.total.numero + estados.total.cero + estados.total.vacio + estados.total.texto) + ' celdas del extract revisadas (' + estados.campos + ' columnas × ' +
        ventana.length + ' semanas × ' + entrada.entidades.length + ' mercados): ' + estados.total.numero + ' números, ' + estados.total.cero + ' ceros, ' +
        estados.total.vacio + ' vacías y ' + estados.total.texto + ' con texto o error. ' +
        (estados.malLeidos.length ? estados.malLeidos.length + ' se leyeron como otra cosa.' : 'Cada una se leyó en su estado: el vacío no pasó a cero ni el cero a vacío.') },
    { nombre: 'Ningún número cambia de país o de semana', ok: relectura.diferencias === 0,
      detalle: relectura.comparadas + ' valores (' + kpisDeCampo.length + ' KPIs leídos del extract × ' + semanas.length + ' semanas × ' + entrada.entidades.length +
        ' mercados) recalculados con la regla de la hoja (columna de la clave, semana y país): ' +
        (relectura.diferencias ? relectura.diferencias + ' no coinciden.' : 'todos coinciden con los del motor.') },
    { nombre: 'Lo que muestra la hoja coincide (' + (c.entidad || 'sin mercado') + ')', ok: c.estado === 'coincide',
      detalle: motor.weeklyFuenteCoincidenciaTexto_(c) }
  ];
  return { semana: semanas[semanas.length - 1], controles, integridad, estados, relectura, periodos, coincidencia: c };
}

// Rows of the sheet whose weekly cells are not all formulas: the usual reason
// for a sheet cell that is blank while the extract has the number.
function filasIncompletas(armado, formulasKpi) {
  const columnas = armado.lectura.columnasSemana.map(semana => semana.columna);
  return armado.entrada.catalogo.kpis.filter(kpi => kpi.def).map(kpi => {
    const con = columnas.filter(columna => plano((formulasKpi[kpi.fila - 1] || [])[columna]) !== '').length;
    return { fila: kpi.fila, kpi: kpi.etiqueta, conFormula: con, semanas: columnas.length };
  }).filter(fila => fila.conFormula < fila.semanas);
}

function textoValidacion(copias) {
  const lineas = [];
  const agrega = texto => lineas.push(texto);
  agrega('# Validación de la lectura por país y semana');
  agrega('');
  agrega('Hecha sobre ' + (copias.length === 1 ? 'una copia' : copias.length + ' copias') + ' `.xlsx` del Sheets, en local. ' +
    'Vale para esas copias: no reemplaza la comprobación en el Sheets vivo.');
  agrega('');
  agrega('## Resultado');
  agrega('');
  agrega('| Copia | Mercado en el selector | Semana | Controles que pasan | Valores comparados contra la hoja | No coinciden |');
  agrega('|---|---|---|---|---|---|');
  copias.forEach(copia => {
    const v = copia.validacion;
    agrega('| ' + copia.nombre + ' | ' + (v.coincidencia.entidad || '—') + ' | ' + v.semana + ' | ' +
      v.controles.filter(control => control.ok).length + ' de ' + v.controles.length + ' | ' + v.coincidencia.comparadas + ' | ' + v.coincidencia.diferencias + ' |');
  });
  agrega('');
  const vistos = copias.map(copia => copia.validacion.coincidencia.entidad).filter(Boolean);
  const todos = copias[0].validacion.integridad.mercados.map(m => m.nombre);
  const sinVer = todos.filter(nombre => vistos.indexOf(nombre) === -1);
  agrega('Mercados comparados contra lo que la hoja muestra: ' + (vistos.join(', ') || 'ninguno') + '. ' +
    (sinVer.length ? 'Sin comparar contra la hoja visible: ' + sinVer.join(', ') + ' (hace falta una copia bajada con cada uno en el selector, o abrir la web con el selector en ese mercado). ' +
      'Para esos mercados sí corre el control "Ningún número cambia de país o de semana", que aplica la misma regla que las fórmulas de la hoja.' : 'Están los ' + todos.length + '.'));
  agrega('');
  copias.forEach(copia => {
    const v = copia.validacion;
    agrega('## ' + copia.nombre);
    agrega('');
    agrega('| Control | Resultado | Detalle |');
    agrega('|---|---|---|');
    v.controles.forEach(control => agrega('| ' + control.nombre + ' | ' + (control.ok ? 'Pasa' : '**Revisar**') + ' | ' + control.detalle.replace(/\|/g, '\\|') + ' |'));
    agrega('');
    if (v.coincidencia.muestras.length) {
      agrega('### Diferencias contra la hoja (' + v.coincidencia.entidad + ')');
      agrega('');
      agrega('| Fila | KPI | Semana | La hoja muestra | El extract tiene |');
      agrega('|---|---|---|---|---|');
      v.coincidencia.muestras.forEach(m => agrega('| ' + m.fila + ' | ' + m.kpi + ' | ' + m.semana + ' | ' + (m.hoja === '' ? '(vacío)' : m.hoja) + ' | ' + m.extract + ' |'));
      agrega('');
      const incompletas = copia.incompletas.filter(fila => v.coincidencia.muestras.some(m => m.fila === fila.fila));
      incompletas.forEach(fila => agrega('- La fila ' + fila.fila + ' (' + fila.kpi + ') tiene fórmula en ' + fila.conFormula + ' de las ' + fila.semanas +
        ' columnas semanales de la hoja: las otras están vacías en la hoja, no en los datos. Es un arreglo de la hoja, no de la lectura.'));
      if (incompletas.length) agrega('');
    }
    if (v.relectura.muestras.length) {
      agrega('### Valores que no siguen la regla de la hoja');
      agrega('');
      v.relectura.muestras.forEach(m => agrega('- ' + m.mercado + ', ' + m.semana + ', fila ' + m.fila + ' (' + m.kpi + '): la regla de la hoja da ' + m.hoja + ' y el motor usa ' + m.motor + '.'));
      agrega('');
    }
    agrega('### Estado de las celdas del extract por mercado');
    agrega('');
    agrega('Columnas que usa el catálogo, en las ' + v.estados.semanas.length + ' semanas que muestra la hoja. Un vacío es un dato faltante; un cero es un cero.');
    agrega('');
    agrega('| Mercado | Con número | En cero | Vacías | Texto o error | Semanas sin fila |');
    agrega('|---|---|---|---|---|---|');
    v.estados.mercados.forEach(m => agrega('| ' + [m.nombre, m.numero, m.cero, m.vacio, m.texto, m.sinFila].join(' | ') + ' |'));
    agrega('');
    if (v.estados.textos.length) {
      agrega('Celdas con texto o error: ' + v.estados.textos.map(t => t.mercado + ' ' + t.semana + ' `' + t.campo + '` = "' + t.valor + '"').join('; ') + '.');
      agrega('');
    }
    const conHuecos = v.integridad.mercados.filter(m => m.faltantes.length);
    if (conHuecos.length) {
      agrega('### Semanas faltantes por mercado');
      agrega('');
      conHuecos.forEach(m => agrega('- ' + m.nombre + ': ' + m.faltantes.length + ' (' + m.faltantes.slice(-5).join(', ') + (m.faltantes.length > 5 ? ', …' : '') + ').'));
      agrega('');
    }
  });
  return lineas.join('\n');
}

function validarCopia(ruta, hoyIso) {
  const armado = construirEntrada(ruta, hoyIso);
  const libro = abrirXlsx(ruta);
  const config = armado.motor.weeklyFuenteConfig_ || require('node:vm').runInContext('weeklyFuenteConfig_', armado.motor);
  const datos = matrices(libro.hoja(libro.nombres.indexOf(config.hojaDatos) !== -1 ? config.hojaDatos : config.hojaDatosEnCopia)).valores;
  return { nombre: path.basename(ruta), validacion: validarLectura(armado, datos),
    incompletas: filasIncompletas(armado, matrices(libro.hoja(config.hojaKpis)).formulas) };
}

function principal(argumentos) {
  const rutas = argumentos.filter(a => !a.startsWith('--'));
  if (!rutas.length) {
    console.error('Uso: node herramientas/validar.cjs "<copia.xlsx>" ["<otra copia.xlsx>" ...] [--hoy=AAAA-MM-DD]');
    process.exit(2);
  }
  const hoy = (argumentos.find(a => a.startsWith('--hoy=')) || '').slice(6) ||
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const copias = rutas.map(ruta => validarCopia(ruta, hoy));
  const salidas = path.join(raiz, 'salidas');
  fs.mkdirSync(salidas, { recursive: true });
  const destino = path.join(salidas, 'validacion-lectura.md');
  fs.writeFileSync(destino, textoValidacion(copias));
  copias.forEach(copia => {
    console.log(copia.nombre + ' — selector en ' + (copia.validacion.coincidencia.entidad || 'sin mercado') + ', semana ' + copia.validacion.semana);
    copia.validacion.controles.forEach(control => console.log('  ' + (control.ok ? 'PASA   ' : 'REVISAR') + ' ' + control.nombre + ': ' + control.detalle));
  });
  console.log('Validación: ' + path.relative(raiz, destino));
  if (copias.some(copia => copia.validacion.controles.some(control => !control.ok))) process.exitCode = 1;
}

if (require.main === module) principal(process.argv.slice(2));

module.exports = { validarLectura, filasIncompletas, textoValidacion, validarCopia };
