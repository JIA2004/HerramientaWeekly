// Weekly run registry and web endpoint.
//
// This is the ONLY file of the tool that writes to the spreadsheet, and it
// writes to a single tab of its own (weeklyRegistroConfig_.hoja), created on
// the first save. Every write re-checks the tab name; no other tab, no source
// cell and no selector is ever touched. One row per analysed week: the saved
// run lets the page open at once and lets the next week tell which findings
// are new, which continue and which are gone.

const weeklyRegistroConfig_ = Object.freeze({
  hoja: 'Weekly_Tool_Registro',
  encabezados: Object.freeze(['semana', 'guardado', 'ultima_actualizacion_datos', 'movimientos',
    'desfavorables', 'favorables', 'datos_a_revisar', 'datos_prioridad_alta', 'partes']),
  maxPartes: 20,
  largoParte: 45000,
  // A leading "=" or "+" would be read as a formula; every stored part starts
  // with this marker instead.
  marca: '~',
  semanasConDetalle: 8,
  esperaLockMs: 10000
});

// Web endpoint for Resumen.html. Without forzar it returns the saved run when
// it already covers the last closed week; otherwise it reads and analyses the
// sheet, compares against the previous week's saved run and saves the result.
function obtenerVistaWeekly(forzar) {
  const fuente = weeklyFuenteConfig_;
  const inicio = new Date();
  const respuesta = { schemaVersion: 'weekly-vista/2', estado: 'error', error: null, procedencia: null,
    generadoIso: null, semanaEsperada: null, avisos: [],
    origen: { hojaKpis: fuente.hojaKpis, hojaDatos: fuente.hojaDatos, hojaRegistro: weeklyRegistroConfig_.hoja,
      ultimaActualizacionExtract: null, ultimaActualizacionHora: null, controlHoja: null },
    vista: null };
  let documento = null;
  let zona = null;
  let guardada = null;
  try {
    documento = SpreadsheetApp.openById(fuente.documentId);
    zona = documento.getSpreadsheetTimeZone();
    respuesta.semanaEsperada = weeklyFuenteUltimaCerrada_(Utilities.formatDate(inicio, fuente.zonaSemana, 'yyyy-MM-dd'));
    guardada = weeklyRegistroUltima_(documento, zona);
  } catch (error) {
    respuesta.avisos.push('No se pudo leer el registro de corridas anteriores.');
  }
  const sirveGuardada = () => {
    respuesta.estado = 'ok';
    respuesta.procedencia = 'guardado';
    respuesta.generadoIso = guardada.guardado;
    respuesta.origen.ultimaActualizacionExtract = guardada.ultimaActualizacion;
    respuesta.vista = guardada.paquete.vista;
    return respuesta;
  };
  // A saved run where most KPI rows could not be interpreted is never served,
  // nor one saved before the page had its weekly story.
  if (guardada && guardada.paquete && (weeklyRegistroDegradada_(guardada.paquete.vista) || !guardada.paquete.vista.historia ||
    guardada.paquete.vista.provisoria)) guardada = null;
  if (!forzar && guardada && guardada.paquete && respuesta.semanaEsperada && guardada.semana >= respuesta.semanaEsperada) {
    return sirveGuardada();
  }
  const corrida = analizarWeeklyAhora();
  if (corrida.estado !== 'ok') {
    if (guardada && guardada.paquete) {
      respuesta.avisos.push('No se pudo leer el Sheets ahora (' + corrida.error.codigo + '). Se muestra la última corrida guardada.');
      return sirveGuardada();
    }
    respuesta.error = corrida.error;
    return respuesta;
  }
  const vista = vistaWeekly(corrida.resultado);
  let anteriores = null;
  try {
    anteriores = weeklyRegistroClaves_(documento, zona, vista.semanaAnterior);
  } catch (error) {
    respuesta.avisos.push('No se pudo comparar contra la semana anterior.');
  }
  weeklyRegistroCompara_(vista, anteriores);
  respuesta.estado = 'ok';
  respuesta.procedencia = 'lectura';
  respuesta.generadoIso = corrida.finIso;
  respuesta.origen.ultimaActualizacionExtract = corrida.origen.ultimaActualizacionExtract;
  respuesta.origen.ultimaActualizacionHora = corrida.origen.ultimaActualizacionHora || null;
  // Only a fresh read can be checked against what the sheet shows right now.
  respuesta.origen.controlHoja = weeklyFuenteCoincidenciaTexto_(corrida.origen.coincidencia) || null;
  if (corrida.origen.coincidencia && corrida.origen.coincidencia.estado === 'difiere') {
    respuesta.avisos.push('Los valores leídos del extract no coinciden con los que muestra la hoja: ' + respuesta.origen.controlHoja);
  }
  respuesta.vista = vista;
  if (weeklyRegistroDegradada_(vista)) {
    respuesta.avisos.push('Solo se pudieron interpretar ' + vista.conteos.kpisAnalizados + ' de ' + vista.conteos.filasKpi +
      ' filas de KPIs: la estructura o las fórmulas de la hoja cambiaron. Este resultado está incompleto y no se guardó. ' +
      'El motivo de cada fila está en "Advertencias del catálogo de KPIs".');
    return respuesta;
  }
  // A run on a load that is pending or half way is shown and never kept: the
  // next opening reads again, so the week's saved result is always a full one.
  if (vista.provisoria) {
    respuesta.avisos.push('Esta lectura es provisoria y no se guardó: la próxima vez que se abra la página se vuelve a leer el Sheets.');
    return respuesta;
  }
  try {
    weeklyRegistroGuarda_(documento, zona, vista, corrida.finIso, corrida.origen.ultimaActualizacionExtract);
  } catch (error) {
    const mensaje = error && error.message;
    respuesta.avisos.push('El resultado se calculó pero no se pudo guardar en la pestaña ' + weeklyRegistroConfig_.hoja +
      (typeof mensaje === 'string' && /^REGISTRO_[A-Z_]+$/.test(mensaje) ? ' (' + mensaje + ').' : '.'));
  }
  return respuesta;
}

// ---- Reading the registry -----------------------------------------------------

function weeklyRegistroHoja_(documento) {
  const hoja = documento.getSheetByName(weeklyRegistroConfig_.hoja);
  return hoja && hoja.getName() === weeklyRegistroConfig_.hoja ? hoja : null;
}

// [{ fila, semana }] for every saved week, reading only the first column.
function weeklyRegistroIndice_(hoja, zona) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  return hoja.getRange(2, 1, ultima - 1, 1).getValues()
    .map((fila, i) => ({ fila: i + 2, semana: weeklyRegistroFecha_(fila[0], zona) }))
    .filter(entrada => entrada.semana !== null);
}

function weeklyRegistroFecha_(valor, zona) {
  if (Object.prototype.toString.call(valor) === '[object Date]') return Utilities.formatDate(valor, zona, 'yyyy-MM-dd');
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor.trim()) ? valor.trim() : null;
}

function weeklyRegistroLeeFila_(hoja, fila, zona) {
  const cfg = weeklyRegistroConfig_;
  const celdas = hoja.getRange(fila, 1, 1, cfg.encabezados.length + cfg.maxPartes).getValues()[0];
  return { semana: weeklyRegistroFecha_(celdas[0], zona), guardado: String(celdas[1]),
    ultimaActualizacion: weeklyRegistroFecha_(celdas[2], zona),
    paquete: weeklyRegistroPaquete_(celdas.slice(cfg.encabezados.length)) };
}

function weeklyRegistroUltima_(documento, zona) {
  const hoja = weeklyRegistroHoja_(documento);
  if (!hoja) return null;
  const indice = weeklyRegistroIndice_(hoja, zona).sort((a, b) => b.semana.localeCompare(a.semana));
  return indice.length ? weeklyRegistroLeeFila_(hoja, indice[0].fila, zona) : null;
}

function weeklyRegistroClaves_(documento, zona, semana) {
  const hoja = documento && weeklyRegistroHoja_(documento);
  if (!hoja || !semana) return null;
  const entrada = weeklyRegistroIndice_(hoja, zona).filter(e => e.semana === semana)[0];
  if (!entrada) return null;
  const guardada = weeklyRegistroLeeFila_(hoja, entrada.fila, zona);
  return guardada.paquete ? guardada.paquete.claves : null;
}

// ---- Writing the registry -----------------------------------------------------

function weeklyRegistroGuarda_(documento, zona, vista, guardadoIso, ultimaActualizacion) {
  const cfg = weeklyRegistroConfig_;
  const fila = weeklyRegistroFilaDe_(vista, guardadoIso, ultimaActualizacion);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(cfg.esperaLockMs)) throw new Error('REGISTRO_OCUPADO');
  try {
    let hoja = documento.getSheetByName(cfg.hoja);
    if (!hoja) {
      hoja = documento.insertSheet(cfg.hoja);
      hoja.getRange(1, 1, 1, cfg.encabezados.length).setValues([cfg.encabezados.slice()]);
      hoja.setFrozenRows(1);
    }
    if (hoja.getName() !== cfg.hoja) throw new Error('REGISTRO_DESTINO');
    const indice = weeklyRegistroIndice_(hoja, zona);
    const existente = indice.filter(e => e.semana === vista.semana)[0];
    const destino = existente ? existente.fila : Math.max(hoja.getLastRow(), 1) + 1;
    const rango = hoja.getRange(destino, 1, 1, fila.length);
    rango.setNumberFormat('@');
    rango.setValues([fila]);
    // Older weeks keep their counts; only the recent ones keep the full detail.
    if (!existente) indice.push({ fila: destino, semana: vista.semana });
    indice.sort((a, b) => b.semana.localeCompare(a.semana))
      .slice(cfg.semanasConDetalle, cfg.semanasConDetalle + 3)
      .forEach(vieja => hoja.getRange(vieja.fila, cfg.encabezados.length, 1, cfg.maxPartes + 1).clearContent());
  } finally {
    lock.releaseLock();
  }
}

// ---- Pure helpers -------------------------------------------------------------

// True when fewer than half of the KPI rows could be turned into a definition:
// the sheet changed in a way the catalog does not understand.
function weeklyRegistroDegradada_(vista) {
  const c = vista && vista.conteos;
  return !c || !(c.filasKpi > 0) || c.kpisAnalizados < c.filasKpi / 2;
}

function weeklyRegistroFilaDe_(vista, guardadoIso, ultimaActualizacion) {
  const cfg = weeklyRegistroConfig_;
  const texto = JSON.stringify({ vista: vista, claves: weeklyRegistroClavesDe_(vista) });
  const partes = [];
  for (let i = 0; i < texto.length; i += cfg.largoParte) partes.push(cfg.marca + texto.slice(i, i + cfg.largoParte));
  if (partes.length > cfg.maxPartes) throw new Error('REGISTRO_DEMASIADO_GRANDE');
  const c = vista.conteos;
  const fila = [vista.semana, guardadoIso, ultimaActualizacion || '', String(c.movimientos), String(c.desfavorables),
    String(c.favorables), String(c.calidad), String(c.calidadAltas), String(partes.length)];
  for (let i = 0; i < cfg.maxPartes; i++) fila.push(partes[i] || '');
  return fila;
}

function weeklyRegistroPaquete_(celdas) {
  const marca = weeklyRegistroConfig_.marca;
  const texto = celdas.filter(celda => typeof celda === 'string' && celda.charAt(0) === marca)
    .map(celda => celda.slice(1)).join('');
  if (texto === '') return null;
  try {
    const paquete = JSON.parse(texto);
    return paquete && paquete.vista && paquete.claves ? paquete : null;
  } catch (error) {
    return null;
  }
}

function weeklyRegistroClavesDe_(vista) {
  return {
    movimientos: vista.movimientos.map(m => ({ k: m.entidad + '|' + m.kpi, sentido: m.sentido })),
    calidad: vista.calidad.map(c => ({ k: c.entidad + '|' + c.kpi + '|' + c.regla, entidad: c.entidad,
      kpi: c.kpi, fila: c.fila, titulo: c.titulo, severidad: c.severidad }))
  };
}

// Tags every item as 'nueva' or 'continua' against the previous week's saved
// run and lists the data findings that are gone. Without a previous run there
// is nothing to compare and nothing is tagged.
function weeklyRegistroCompara_(vista, anteriores) {
  vista.conHistorial = !!anteriores;
  vista.resueltos = [];
  if (!anteriores) {
    vista.movimientos.forEach(m => { m.historial = null; });
    vista.calidad.forEach(c => { c.historial = null; });
    return vista;
  }
  const movidos = {};
  anteriores.movimientos.forEach(m => { movidos[m.k] = m.sentido; });
  const observados = {};
  anteriores.calidad.forEach(c => { observados[c.k] = true; });
  vista.movimientos.forEach(m => { m.historial = movidos[m.entidad + '|' + m.kpi] ? 'continua' : 'nueva'; });
  const actuales = {};
  vista.calidad.forEach(c => {
    const clave = c.entidad + '|' + c.kpi + '|' + c.regla;
    actuales[clave] = true;
    c.historial = observados[clave] ? 'continua' : 'nueva';
  });
  vista.resueltos = anteriores.calidad.filter(c => !actuales[c.k] && c.severidad !== 'baja')
    .map(c => ({ entidad: c.entidad, kpi: c.kpi, fila: c.fila, titulo: c.titulo }));
  return vista;
}
