// Weekly data source. Read-only: it never writes a cell, never changes the
// country selector and takes no lock, so it cannot interfere with whoever is
// using the sheet.
//
// KPI definitions (visible name, technical key, favourable direction, unit and
// derived formulas) come from "2) Weekly por pais". Values come from
// "Extract Tabla Weekly", the long table the formulas of that sheet read: every
// market and every week in one read, with blanks still distinguishable from
// zeros.
//
// The weeklyFuente*_ builders are pure (plain 2D arrays in, plain objects out)
// so the same code is exercised locally against a downloaded copy.

const weeklyFuenteConfig_ = Object.freeze({
  documentId: '1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk',
  hojaKpis: '2) Weekly por pais',
  hojaDatos: '[Extract] Tabla Weekly',
  // A downloaded .xlsx copy drops the brackets from the tab name.
  hojaDatosEnCopia: 'Extract Tabla Weekly',
  zonaSemana: 'America/Argentina/Buenos_Aires',
  maxCeldas: 1500000
});

// Public entry: reads, analyses and returns the result plus its Spanish text.
// Never throws: a failure comes back as estado 'error' with a code.
function analizarWeeklyAhora() {
  const config = weeklyFuenteConfig_;
  const inicio = new Date();
  const respuesta = { schemaVersion: 'weekly-corrida/1', estado: 'error', inicioIso: inicio.toISOString(),
    finIso: null, duracionMs: 0, origen: { documento: config.documentId, hojaKpis: config.hojaKpis,
      hojaDatos: config.hojaDatos, zonaHorariaDocumento: null, ultimaActualizacionExtract: null, ultimaActualizacionHora: null,
      filasDuplicadas: 0, semanasHoja: [], coincidencia: null },
    resultado: null, texto: null, error: null };
  try {
    const documento = SpreadsheetApp.openById(config.documentId);
    const zona = documento.getSpreadsheetTimeZone();
    respuesta.origen.zonaHorariaDocumento = zona;
    const hojaKpis = documento.getSheetByName(config.hojaKpis);
    const hojaDatos = documento.getSheetByName(config.hojaDatos) || documento.getSheetByName(config.hojaDatosEnCopia);
    if (!hojaKpis || !hojaDatos) {
      // Tab names are structure, not cell contents, so they are safe to report.
      const faltan = [hojaKpis ? null : config.hojaKpis, hojaDatos ? null : config.hojaDatos].filter(Boolean);
      throw new Error('FUENTE_SIN_HOJA: en "' + documento.getName() + '" no existe la pestaña ' +
        faltan.map(nombre => '"' + nombre + '"').join(' ni ') + '. Pestañas encontradas: ' +
        documento.getSheets().map(hoja => '"' + hoja.getName() + '"').join(', ') + '.');
    }
    const rangoKpis = hojaKpis.getDataRange();
    const rangoDatos = hojaDatos.getDataRange();
    if (rangoDatos.getNumRows() * rangoDatos.getNumColumns() > config.maxCeldas) throw new Error('FUENTE_DEMASIADO_GRANDE');
    const aIso = valor => weeklyFuenteFecha_(valor, fecha => Utilities.formatDate(fecha, zona, 'yyyy-MM-dd'));
    const hoy = Utilities.formatDate(inicio, config.zonaSemana, 'yyyy-MM-dd');
    const armado = weeklyFuenteEntrada_(rangoKpis.getValues(), rangoKpis.getFormulas(),
      rangoDatos.getValues(), aIso, hoy, fecha => Utilities.formatDate(fecha, zona, 'HH:mm'));
    respuesta.origen.ultimaActualizacionExtract = armado.fuente.ultimaActualizacion;
    respuesta.origen.ultimaActualizacionHora = armado.fuente.ultimaActualizacionHora;
    respuesta.origen.filasDuplicadas = armado.fuente.filasDuplicadas;
    respuesta.origen.semanasHoja = armado.lectura.semanasHoja;
    respuesta.origen.coincidencia = armado.coincidencia;
    respuesta.resultado = analizarWeekly(armado.entrada);
    respuesta.texto = resumirWeekly(respuesta.resultado);
    respuesta.estado = 'ok';
  } catch (error) {
    const mensaje = error && error.message;
    const codigo = typeof mensaje === 'string' && /^FUENTE_[A-Z_]+/.exec(mensaje);
    // Raw service messages may carry cell contents, so only our own are passed on.
    respuesta.error = { codigo: codigo ? codigo[0] : 'FUENTE_ERROR_DE_SERVICIO',
      detalle: codigo ? mensaje : 'No se pudo leer el documento o las pestañas configuradas.' };
  }
  const fin = new Date();
  respuesta.finIso = fin.toISOString();
  respuesta.duracionMs = fin.getTime() - inicio.getTime();
  return respuesta;
}

// Manual driver for the Apps Script editor: run it and read the execution log.
// The log holds the weekly summary, visible to whoever can open the script.
function probarAnalisisWeekly() {
  const corrida = analizarWeeklyAhora();
  if (corrida.estado !== 'ok') {
    console.log(JSON.stringify({ estado: corrida.estado, error: corrida.error, duracionMs: corrida.duracionMs }));
    return corrida;
  }
  const resultado = corrida.resultado;
  console.log(JSON.stringify({ estado: corrida.estado, semana: resultado.semana,
    semanasDisponibles: resultado.semanasDisponibles, kpisAnalizados: resultado.catalogo.analizados,
    calidad: resultado.calidad.length, performance: resultado.performance.length,
    estadoCarga: resultado.globales.map(g => g.regla), advertenciasCatalogo: resultado.catalogo.advertencias.length,
    ultimaActualizacionExtract: corrida.origen.ultimaActualizacionExtract, duracionMs: corrida.duracionMs }));
  // The log truncates long entries, so the text goes out in blocks.
  const lineas = corrida.texto.split('\n');
  for (let i = 0; i < lineas.length; i += 40) console.log(lineas.slice(i, i + 40).join('\n'));
  return corrida;
}

// ---- Pure builders ----------------------------------------------------------

function weeklyFuenteEntrada_(valoresKpi, formulasKpi, valoresDatos, aIso, hoyIso, aHora) {
  const lectura = weeklyFuenteFilasKpi_(valoresKpi, formulasKpi, aIso);
  const catalogo = weeklyMotorCatalogo_(lectura.filas);
  const fuente = weeklyFuenteDatos_(valoresDatos, aIso, aHora);
  catalogo.kpis.forEach(kpi => {
    const campo = kpi.def && (kpi.def.tipo === 'campo' || kpi.def.tipo === 'campoSobre') ? kpi.def.campo : null;
    if (campo && fuente.campos.indexOf(campo) === -1) {
      catalogo.advertencias.push('Fila ' + kpi.fila + ' (' + kpi.nombre + '): la clave `' + campo +
        '` no existe como columna del extract; el KPI no se analiza.');
      kpi.def = null;
    }
  });
  const entidades = Object.keys(fuente.datos).sort()
    .map(nombre => ({ nombre: nombre, tipo: nombre.toUpperCase() === 'LATAM' ? 'LATAM' : 'pais' }));
  const entrada = { semanas: fuente.semanas, entidades: entidades, datos: fuente.datos, catalogo: catalogo,
    semanaEsperada: hoyIso ? weeklyFuenteUltimaCerrada_(hoyIso) : null,
    ultimaActualizacion: fuente.ultimaActualizacion, filasDuplicadas: fuente.filasDuplicadas };
  return { lectura: lectura, fuente: fuente, entrada: entrada,
    coincidencia: weeklyFuenteCoincidencia_(valoresKpi, lectura, entrada) };
}

// Cross-check: the numbers the engine takes from the extract against the ones
// "2) Weekly por pais" shows for whichever market its selector holds right
// now. The selector is only read, never changed, and is found by content: the
// fixed cell ($F$4) the sheet's own SUMIFS formulas filter the market by.
// A blank or a 0 in the sheet matches "no data" in the extract, because the
// sheet's SUMIFS cannot tell them apart.
function weeklyFuenteCoincidencia_(valoresKpi, lectura, entrada) {
  const respuesta = { estado: 'no_evaluable', entidad: null, motivo: null, comparadas: 0, diferencias: 0,
    muestras: [], conFaltante: 0, ejemploFaltante: null, semanasSinExtract: [] };
  const selector = lectura.celdaSelector;
  if (!selector) {
    respuesta.motivo = 'Las fórmulas de la hoja no apuntan a una celda de mercado.';
    return respuesta;
  }
  const elegido = weeklyFuenteTexto_((valoresKpi[selector.fila] || [])[selector.columna]);
  if (!entrada.entidades.some(entidad => entidad.nombre === elegido)) {
    respuesta.motivo = 'El mercado elegido en la hoja no existe en el extract.';
    return respuesta;
  }
  respuesta.entidad = elegido;
  const motor = weeklyMotorValores_(entrada, respuesta.entidad);
  const columnas = [];
  lectura.columnasSemana.forEach(semana => {
    const indice = motor.semanas.indexOf(semana.fecha);
    if (indice === -1) respuesta.semanasSinExtract.push(semana.fecha);
    else columnas.push({ columna: semana.columna, fecha: semana.fecha, indice: indice });
  });
  entrada.catalogo.kpis.forEach(kpi => {
    const serie = motor.valores[kpi.id];
    if (!serie) return;
    columnas.forEach(semana => {
      const hoja = valoresKpi[kpi.fila - 1][semana.columna];
      const calculado = serie[semana.indice];
      const esNumero = typeof hoja === 'number' && isFinite(hoja);
      const coincide = calculado === null ? !esNumero || hoja === 0
        : esNumero && Math.abs(hoja - calculado) <= 1e-9 + 1e-6 * Math.max(Math.abs(hoja), Math.abs(calculado));
      respuesta.comparadas++;
      if (coincide) return;
      // A total or a ratio the sheet still shows because it counts a missing
      // input as zero: the engine leaves it without a value on purpose.
      if (calculado === null && kpi.def.tipo !== 'campo') {
        respuesta.conFaltante++;
        if (!respuesta.ejemploFaltante) respuesta.ejemploFaltante = { fila: kpi.fila, kpi: kpi.etiqueta, semana: semana.fecha };
        return;
      }
      respuesta.diferencias++;
      if (respuesta.muestras.length < 10) {
        respuesta.muestras.push({ fila: kpi.fila, kpi: kpi.etiqueta, semana: semana.fecha,
          hoja: esNumero ? hoja : weeklyFuenteTexto_(hoja), extract: calculado });
      }
    });
  });
  if (!respuesta.comparadas) respuesta.motivo = 'Ninguna semana de la hoja está en el extract.';
  else respuesta.estado = respuesta.diferencias ? 'difiere' : 'coincide';
  return respuesta;
}

// One Spanish sentence for the cross-check, shared by the page and the local runner.
function weeklyFuenteCoincidenciaTexto_(coincidencia) {
  if (!coincidencia) return '';
  if (coincidencia.estado === 'no_evaluable') {
    return 'No se pudo comparar contra los valores visibles de la hoja: ' + coincidencia.motivo;
  }
  const base = coincidencia.comparadas + ' valores de ' + coincidencia.entidad + ' comparados contra la hoja';
  const ejemplo = e => ' (por ejemplo, fila ' + e.fila + ', ' + e.kpi + ', semana del ' + e.semana + ')';
  const faltantes = coincidencia.conFaltante ? ' En ' + coincidencia.conFaltante +
    ' la hoja muestra un total o una proporción calculados con un dato faltante tomado como cero' +
    ejemplo(coincidencia.ejemploFaltante) + '; aquí quedan sin valor.' : '';
  if (coincidencia.estado === 'coincide') {
    return base + (coincidencia.conFaltante ? ': no hay números distintos.' : ': todos coinciden.') + faltantes;
  }
  return base + ': ' + coincidencia.diferencias + ' no coinciden' + ejemplo(coincidencia.muestras[0]) + '.' + faltantes;
}

// Locates the layout by content, never by fixed coordinates: the header row is
// the one with the "KPI" label; weekly columns are its date cells; the unit of
// each KPI is taken from the formula under the first "WoW" header.
function weeklyFuenteFilasKpi_(valores, formulas, aIso) {
  let encabezado = -1;
  let colNombre = -1;
  for (let f = 0; f < Math.min(valores.length, 30) && encabezado === -1; f++) {
    for (let c = 0; c < Math.min(valores[f].length, 12); c++) {
      if (String(valores[f][c]).trim() === 'KPI') { encabezado = f; colNombre = c; break; }
    }
  }
  if (encabezado === -1) throw new Error('FUENTE_ESTRUCTURA: no se encontró el encabezado "KPI".');
  const semanas = [];
  let colVariacion = -1;
  for (let c = colNombre + 1; c < valores[encabezado].length; c++) {
    const celda = valores[encabezado][c];
    const fecha = aIso(celda);
    if (fecha) semanas.push({ columna: c, fecha: fecha });
    else if (colVariacion === -1 && String(celda).trim() === 'WoW') colVariacion = c;
  }
  if (semanas.length < 2 || colVariacion === -1) throw new Error('FUENTE_ESTRUCTURA: faltan las columnas semanales o la columna WoW.');
  const colUltima = semanas[semanas.length - 1].columna;
  // Neither helper column has a fixed place (columns get inserted in this
  // sheet). The favourable direction is the column left of the names that
  // holds the most 1 / -1 values; the technical key is the cell each row's own
  // formula looks up: MATCH($C9, ...) says the key of row 9 is in column C.
  let colDireccion = -1;
  let mejor = 0;
  for (let c = 0; c < colNombre; c++) {
    let cuenta = 0;
    for (let f = encabezado + 1; f < valores.length; f++) {
      if (valores[f][c] === 1 || valores[f][c] === -1) cuenta++;
    }
    if (cuenta > mejor) { mejor = cuenta; colDireccion = c; }
  }
  const filas = [];
  const columnasClave = {};
  let celdaSelector = null;
  for (let f = encabezado + 1; f < valores.length; f++) {
    const direccion = colDireccion === -1 ? null : valores[f][colDireccion];
    const formula = formulas[f][colUltima] || null;
    const fija = !celdaSelector && formula && /SUMIFS\(/i.test(formula) && /\$([A-Z]{1,3})\$(\d+)/.exec(formula);
    if (fija) celdaSelector = { fila: Number(fija[2]) - 1, columna: weeklyFuenteColumna_(fija[1]) };
    const busca = formula && new RegExp('MATCH\\(\\$?([A-Z]{1,3})\\$?' + (f + 1) + '\\s*[,;]', 'i').exec(formula);
    const colClave = busca ? weeklyFuenteColumna_(busca[1].toUpperCase()) : -1;
    if (colClave >= 0) columnasClave[colClave] = true;
    filas.push({ fila: f + 1, direccion: direccion === 1 || direccion === -1 ? direccion : null,
      clave: colClave >= 0 && colClave < valores[f].length ? weeklyFuenteTexto_(valores[f][colClave]) : '',
      nombre: weeklyFuenteTexto_(valores[f][colNombre]),
      formulaValor: formula, formulaVariacion: formulas[f][colVariacion] || null });
  }
  // The block of each KPI (Orders, GMV, User Base...) is the remaining text
  // column left of the names: not the direction and not a key column.
  let colBloque = -1;
  let masTextos = 0;
  for (let c = 0; c < colNombre; c++) {
    if (c === colDireccion || columnasClave[c]) continue;
    const textos = filas.filter(fila => fila.formulaValor && weeklyFuenteTexto_(valores[fila.fila - 1][c]) !== '').length;
    if (textos > masTextos) { masTextos = textos; colBloque = c; }
  }
  filas.forEach(fila => { fila.bloque = colBloque === -1 ? '' : weeklyFuenteTexto_(valores[fila.fila - 1][colBloque]); });
  return { filas: filas, filaEncabezado: encabezado + 1, columnaNombre: colNombre + 1,
    columnasSemana: semanas, celdaSelector: celdaSelector, semanasHoja: semanas.map(semana => semana.fecha) };
}

function weeklyFuenteDatos_(valores, aIso, aHora) {
  if (!valores.length) throw new Error('FUENTE_ESTRUCTURA: el extract está vacío.');
  const titulos = valores[0].map(weeklyFuenteTexto_);
  const colSemana = titulos.indexOf('week_date');
  const colEntidad = titulos.indexOf('country_name');
  const colActualizacion = titulos.indexOf('last_update');
  if (colSemana === -1 || colEntidad === -1) throw new Error('FUENTE_ESTRUCTURA: el extract no tiene week_date o country_name.');
  const campos = [];
  titulos.forEach((titulo, c) => {
    if (titulo !== '' && c !== colSemana && c !== colEntidad && c !== colActualizacion && titulo !== 'country_id') {
      campos.push({ columna: c, nombre: titulo });
    }
  });
  const datos = {};
  const semanas = {};
  const vistas = {};
  let duplicadas = 0;
  let ultimaActualizacion = null;
  let ultimaHora = null;
  for (let f = 1; f < valores.length; f++) {
    const fila = valores[f];
    const semana = aIso(fila[colSemana]);
    const entidad = weeklyFuenteTexto_(fila[colEntidad]);
    if (!semana || entidad === '') continue;
    const clave = entidad + '|' + semana;
    if (vistas[clave]) duplicadas++;
    vistas[clave] = true;
    semanas[semana] = true;
    const propia = datos[entidad] = datos[entidad] || {};
    for (let k = 0; k < campos.length; k++) {
      const serie = propia[campos[k].nombre] = propia[campos[k].nombre] || {};
      serie[semana] = weeklyFuenteValor_(fila[campos[k].columna]);
    }
    if (colActualizacion !== -1) {
      const marca = aIso(fila[colActualizacion]);
      const hora = marca ? weeklyFuenteHora_(fila[colActualizacion], aHora) : null;
      if (marca && (ultimaActualizacion === null || marca > ultimaActualizacion ||
        (marca === ultimaActualizacion && hora !== null && (ultimaHora === null || hora > ultimaHora)))) {
        ultimaActualizacion = marca;
        ultimaHora = hora;
      }
    }
  }
  if (!Object.keys(datos).length) throw new Error('FUENTE_ESTRUCTURA: el extract no tiene filas con semana y país.');
  return { datos: datos, semanas: Object.keys(semanas).sort(), campos: campos.map(campo => campo.nombre),
    filasDuplicadas: duplicadas, ultimaActualizacion: ultimaActualizacion, ultimaActualizacionHora: ultimaHora };
}

// Blank stays unknown (null), a number stays a number (zero included) and
// anything else (text, "#N/A") is kept as text so the engine can report it.
function weeklyFuenteValor_(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return isFinite(valor) ? valor : String(valor);
  return String(valor);
}

// Zero-based index of a column letter ("A" -> 0, "AB" -> 27).
function weeklyFuenteColumna_(letras) {
  let numero = 0;
  for (let i = 0; i < letras.length; i++) numero = numero * 26 + letras.charCodeAt(i) - 64;
  return numero - 1;
}

function weeklyFuenteTexto_(valor) {
  return valor === null || valor === undefined ? '' : String(valor).replace(/\s+/g, ' ').trim();
}

// A date cell arrives as a Date (Apps Script) or as a day serial (xlsx copy).
function weeklyFuenteFecha_(valor, formatea) {
  if (Object.prototype.toString.call(valor) === '[object Date]') return isNaN(valor.getTime()) ? null : formatea(valor);
  if (typeof valor === 'number' && valor > 40000 && valor < 60000) {
    return new Date(Math.round((valor - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  return null;
}

// Time of day (HH:mm) of a date-time cell, or null when it carries no time.
function weeklyFuenteHora_(valor, formatea) {
  if (Object.prototype.toString.call(valor) === '[object Date]') return formatea && !isNaN(valor.getTime()) ? formatea(valor) : null;
  if (typeof valor !== 'number' || valor <= 40000 || valor >= 60000) return null;
  const minutos = Math.floor((valor - Math.floor(valor)) * 1440 + 1e-6);
  if (minutos === 0 || minutos >= 1440) return null;
  return ('0' + Math.floor(minutos / 60)).slice(-2) + ':' + ('0' + minutos % 60).slice(-2);
}

// Last fully closed Monday-to-Sunday week, identified by its Monday.
function weeklyFuenteUltimaCerrada_(hoyIso) {
  const hoy = Date.parse(hoyIso + 'T00:00:00Z');
  const desdeLunes = (new Date(hoy).getUTCDay() + 6) % 7;
  return new Date(hoy - (desdeLunes + 7) * 86400000).toISOString().slice(0, 10);
}
