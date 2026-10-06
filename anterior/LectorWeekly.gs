// Weekly structured reader pilot. Reuses the shared configuration and the safe
// selector/diagnostic helpers from DiagnosticoSheets.gs / PruebaSelector.gs.
// Reads only the exact WebApp tab, temporarily writes only H4, restores it in
// finally and releases the script lock even on failure. Returns a versioned,
// serializable response; it never certifies completeness, country/data
// correspondence or recalculation. datosUtilizables only means two consecutive
// equal captures were observed; it is fitness for pilot inspection, never a
// production or alerting signal.
//
// Schema v3: semanas contains ONLY date-typed weekly headers; comparison and
// benchmark headers are classified by normalized label into
// columnasAdicionales (interpretacionValidada:false, never inferring formula,
// unit, favorable direction or reference period), their per-row values are
// read before restoring the selector and included in the stability comparison
// and the read budget. Unknown non-date headers remain ambiguous outside
// semanas. Availability counts only rows after headerRow; intentos counts
// captures initiated inside the observation loop and survives errors inside
// it. No existing comparison is recalculated or substituted.

function leerWeeklyPorPais(pais) {
  const config = weeklyDiagnosticConfig_;
  const options = config.experiment;
  const started = Date.now();
  const respuesta = weeklyLecturaEnvelope_(config, pais, started);
  const budget = { used: 0, limit: options.totalReadBudget, reserve: 4 };
  let lock;
  let acquired = false;
  let possibleWrite = false;
  let sheet;
  let zone;
  let original;
  let principalError = null;
  let restoreError = null;
  let releaseError = null;
  let capture = null;
  let detalle = null;
  let estableObservada = false;
  const contadorIntentos = { valor: 0 };
  try {
    if (typeof pais === 'string' && pais.trim() === '') throw new Error('SELECTOR_COUNTRY_BLANK');
    if (!weeklySelectorLiteral_(pais)) throw new Error('SELECTOR_UNSAFE_COUNTRY');
    weeklySelectorConfig_(config);
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(options.lockWaitMs);
    if (!acquired) throw new Error('SELECTOR_LOCK_UNAVAILABLE');
    const document = SpreadsheetApp.openById(config.documentId);
    sheet = document.getSheetByName(config.tabName);
    if (!sheet || sheet.getName() !== config.tabName) throw new Error('SELECTOR_DESTINATION');
    zone = document.getSpreadsheetTimeZone();
    respuesta.origen.zonaHorariaDocumento = zone;
    weeklyLecturaValidation_(sheet, config, budget, pais);
    original = weeklySelectorRead_(sheet, zone, budget);
    respuesta.selector.original = original.value;
    if (original.hasFormula) throw new Error('SELECTOR_INITIAL_FORMULA');
    if (!weeklySelectorLiteral_(original.value)) throw new Error('SELECTOR_UNSAFE_ORIGINAL');
    const deadline = started + options.deadlineMs;
    if (pais === original.value) {
      possibleWrite = false;
      const observada = weeklyLecturaObservaEstable_(sheet, zone, budget, original.value, deadline, options, null, contadorIntentos);
      if (!observada.estable) throw new Error('LECTURA_SIN_ESTABILIDAD');
      capture = observada.capture;
      estableObservada = true;
    } else {
      const baseline = weeklyLecturaSnapshot_(sheet, zone, budget, original.value, deadline);
      possibleWrite = true;
      sheet.getRange(config.selector).setValue(pais);
      SpreadsheetApp.flush();
      const observada = weeklyLecturaObservaEstable_(sheet, zone, budget, pais, deadline, options, baseline, contadorIntentos);
      if (!observada.estable) throw new Error('LECTURA_SIN_ESTABILIDAD');
      capture = observada.capture;
      estableObservada = true;
    }
    detalle = weeklyLecturaDetalle_(capture, config, respuesta.entidad);
    respuesta.selector.observado = capture.selectorValue;
  } catch (error) {
    principalError = weeklyLecturaError_(error);
  } finally {
    if (possibleWrite) {
      try {
        if (!original || original.hasFormula || !weeklySelectorLiteral_(original.value)) {
          throw new Error('SELECTOR_UNSAFE_ORIGINAL');
        }
        sheet.getRange(config.selector).setValue(original.value);
        SpreadsheetApp.flush();
        budget.reserve = 0;
        weeklySelectorExpect_(weeklySelectorRead_(sheet, zone, budget), original.value);
        respuesta.selector.restaurado = original.value;
        respuesta.selector.restauracionVerificada = true;
      } catch (error) {
        restoreError = weeklyLecturaError_(error);
        respuesta.selector.restauracionVerificada = false;
      }
    }
    if (acquired) {
      try {
        lock.releaseLock();
      } catch (error) {
        releaseError = weeklyLecturaError_(error);
      }
    }
  }
  respuesta.lectura.intentos = contadorIntentos.valor;
  const exitoso = !principalError && !restoreError && !releaseError && detalle !== null;
  if (exitoso) {
    respuesta.estado = 'ok';
    respuesta.datosUtilizables = true;
    respuesta.selector.escrita = possibleWrite ? pais : null;
    respuesta.semanas = detalle.semanas;
    respuesta.columnasAdicionales = detalle.columnasAdicionales;
    respuesta.filas = detalle.filas;
    respuesta.calidad = detalle.calidad;
    respuesta.advertencias = detalle.advertencias;
    respuesta.lectura.estableObservada = estableObservada;
  } else {
    respuesta.estado = 'error';
    respuesta.datosUtilizables = false;
    const codigo = restoreError || principalError || releaseError || 'SELECTOR_SERVICE_ERROR';
    respuesta.error = {
      codigo: codigo,
      requiereRestauracionManual: restoreError !== null,
      restauracionCodigo: restoreError,
      liberacionCodigo: releaseError
    };
  }
  respuesta.lectura.finIso = new Date().toISOString();
  respuesta.lectura.duracionMs = Date.now() - started;
  return respuesta;
}

function probarLectorWeekly() {
  const config = weeklyDiagnosticConfig_;
  const testCountry = config.experiment.testCountry;
  if (typeof testCountry !== 'string' || testCountry.trim() === '') {
    const envelope = weeklyLecturaEnvelope_(config, '', Date.now());
    envelope.error = { codigo: 'SELECTOR_TEST_COUNTRY_NOT_CONFIGURED',
      requiereRestauracionManual: false, restauracionCodigo: null, liberacionCodigo: null };
    console.log(JSON.stringify({ estado: envelope.estado,
      codigo: envelope.error.codigo, aviso: 'Configure experiment.testCountry.' }));
    return envelope;
  }
  const resultado = leerWeeklyPorPais(testCountry);
  console.log(JSON.stringify({
    estado: resultado.estado,
    pais: resultado.paisSolicitado,
    datosUtilizables: resultado.datosUtilizables,
    estableObservada: resultado.lectura.estableObservada,
    intentos: resultado.lectura.intentos,
    semanas: resultado.semanas.length,
    columnasAdicionales: resultado.columnasAdicionales.length,
    filas: resultado.filas.length,
    calidad: resultado.calidad ? {
      semanasDeclaradas: resultado.calidad.semanasDeclaradas,
      semanasConObservacionesNumericas: resultado.calidad.semanasConObservacionesNumericas,
      duplicados: resultado.calidad.duplicados.length,
      fechasNoLunes: resultado.calidad.fechasNoLunes.length,
      encabezadosAmbiguos: resultado.calidad.encabezadosAmbiguos.length
    } : null,
    selectorEscrito: resultado.selector.escrita,
    selectorRestaurado: resultado.selector.restaurado,
    restauracionVerificada: resultado.selector.restauracionVerificada,
    duracionMs: resultado.lectura.duracionMs,
    error: resultado.error ? resultado.error.codigo : null
  }));
  return resultado;
}

function weeklyLecturaEnvelope_(config, pais, started) {
  return {
    schemaVersion: 'weekly-lectura/3',
    estado: 'error',
    datosUtilizables: false,
    paisSolicitado: pais,
    entidad: weeklyLecturaEntidad_(pais),
    selector: { original: null, solicitado: pais, observado: null, escrita: null,
      restaurado: null, restauracionVerificada: false },
    lectura: { inicioIso: new Date(started).toISOString(), finIso: null,
      zonaHorariaSemanaCerrada: config.readTimezone, estableObservada: false,
      intentos: 0, duracionMs: 0 },
    origen: { documento: config.documentId, pestana: config.tabName,
      coordenadas: { selector: config.selector, filaEncabezados: config.headerRow,
        columnaNombres: config.nameColumn, metadatos: 'C:F' },
      zonaHorariaDocumento: null },
    semanas: [],
    columnasAdicionales: [],
    filas: [],
    calidad: null,
    advertencias: weeklyLecturaAdvertenciasBase_(),
    verificacion: { completitud: 'no_verificada', correspondenciaPaisDatos: 'no_verificada',
      recalculo: 'no_verificada', lecturaEstableEsObservacion: true }
  };
}

function weeklyLecturaEntidad_(pais) {
  return { nombre: pais,
    tipo: typeof pais === 'string' && pais.toUpperCase() === 'LATAM' ? 'LATAM' : 'pais' };
}

function weeklyLecturaValidation_(sheet, config, budget, pais) {
  // Semantics of weeklySelectorValidation_: VALUE_IN_LIST exact list,
  // VALUE_IN_RANGE/NONE fall back to the manual allowlist, other criteria fail closed.
  weeklySelectorValidation_(sheet, { testCountry: pais,
    manualCountryAllowlist: config.experiment.manualCountryAllowlist }, budget);
}

function weeklyLecturaSnapshot_(sheet, zone, budget, expected, deadline) {
  const snapshot = weeklySelectorSnapshot_(sheet, zone, budget, expected, deadline);
  const derivado = weeklyLecturaDerivada_(snapshot.cells);
  // Additional comparison/benchmark columns are classified by normalized
  // label, never by a fixed position. Their values are read here, before any
  // selector restoration, and folded into the same cells object so they take
  // part in the stability comparison; the read is budgeted like every other
  // batch. Existing comparisons are neither recalculated nor substituted.
  //
  // These readings happen after weeklySelectorSnapshot_ already ran its own
  // closing selector and deadline checks, so the same controls are repeated
  // here: one budgeted selector read before the additional block, a deadline
  // check between every additional read, and one budgeted selector read plus a
  // final deadline check after it. A selector change or an exhausted deadline
  // at any of these points throws, so the whole capture is discarded instead of
  // accepting additional values taken while the selector or the clock was no
  // longer trustworthy. The sheet is still read in separate batches: no
  // atomicity is claimed.
  weeklySelectorDeadline_(deadline);
  weeklySelectorExpect_(weeklySelectorRead_(sheet, zone, budget), expected);
  derivado.adicionales.forEach(entry => {
    weeklySelectorDeadline_(deadline);
    weeklySelectorBudget_(budget, derivado.usedRows * 4, false);
    const batch = weeklySelectorBatch_(sheet, 1, entry.column, derivado.usedRows, 1, zone, budget);
    derivado.namedRows.forEach(named => {
      const cell = batch[named.row - 1][0];
      snapshot.cells[cell.a1] = cell;
    });
  });
  weeklySelectorExpect_(weeklySelectorRead_(sheet, zone, budget), expected);
  weeklySelectorDeadline_(deadline);
  return { cells: snapshot.cells, selectorValue: expected,
    usedRows: derivado.usedRows, usedColumns: derivado.usedColumns,
    headers: derivado.headers, dateCandidates: derivado.dateCandidates,
    additionalCandidates: derivado.adicionales, namedRows: derivado.namedRows,
    estructura: JSON.stringify(derivado.estructura) };
}

function weeklyLecturaObservaEstable_(sheet, zone, budget, expected, deadline, options, baseline, contador) {
  // Observed-state stability loop. Captures are spaced by pollIntervalMs and
  // bounded by maxAttempts while sharing the same deadline and read budget.
  // The pre-write baseline (write path only) is used exclusively for structure
  // change detection and never counts toward intentos. Two consecutive equal
  // captures are required; exhaustion without stability returns estable:false
  // so the caller fails with LECTURA_SIN_ESTABILIDAD while preserving intentos.
  // Stability remains an observation, never proof of recalculation or of
  // country/data correspondence.
  //
  // v3 counter semantics: intentos counts every capture initiated inside the
  // observation loop. The counter is set once the capture is actually
  // initiated, so a timeout, a read error or a structure change inside the
  // capture still preserves it, while the pre-capture spacing guard (which
  // aborts before any capture starts) does not invent an attempt; the pre-write
  // baseline and the initial original-country read never count.
  let prev = null;
  contador.valor = 0;
  for (let k = 1; k <= options.maxAttempts; k++) {
    if (k > 1) {
      if (Date.now() + options.pollIntervalMs > deadline) throw new Error('SELECTOR_DEADLINE');
      Utilities.sleep(options.pollIntervalMs);
    }
    contador.valor = k;
    const actual = weeklyLecturaSnapshot_(sheet, zone, budget, expected, deadline);
    if (k === 1) {
      if (baseline) weeklyLecturaStructureCheck_(baseline, actual);
    } else {
      weeklyLecturaStructureCheck_(prev, actual);
    }
    if (k > 1 && weeklyLecturaIguales_(prev, actual)) {
      return { capture: actual, intentos: contador.valor, estable: true };
    }
    prev = actual;
  }
  return { capture: null, intentos: contador.valor, estable: false };
}

function weeklyLecturaDerivada_(cells) {
  const config = weeklyDiagnosticConfig_;
  const keys = Object.keys(cells);
  const parsed = keys.map(a1 => weeklyLecturaA1_(a1));
  const usedRows = Math.max.apply(null, parsed.map(entry => entry.row));
  const usedColumns = Math.max.apply(null, parsed.map(entry => entry.column));
  const headers = parsed.filter(entry => entry.row === config.headerRow)
    .sort((a, b) => a.column - b.column)
    .map(entry => ({ a1: entry.a1, column: entry.column, cell: cells[entry.a1] }));
  const dateCandidates = headers
    .filter(entry => entry.cell.type === 'date')
    .map(entry => ({ column: entry.column, cell: entry.cell }));
  const adicionales = headers
    .filter(entry => entry.column !== config.nameColumn && entry.cell.type !== 'date' &&
      (entry.cell.value !== '' || entry.cell.display !== '' || entry.cell.hasFormula))
    .map(entry => {
      const clasificado = weeklyLecturaClasificaAdicional_(entry.cell);
      return clasificado ? { column: entry.column, a1: entry.a1, cell: entry.cell,
        clasificacion: clasificado.clasificacion,
        etiquetaNormalizada: clasificado.etiquetaNormalizada } : null;
    })
    .filter(entry => entry !== null);
  const nameLetter = weeklyLecturaColumnaLetra_(config.nameColumn);
  const namedRows = parsed
    .filter(entry => entry.column === config.nameColumn &&
      (cells[entry.a1].value !== '' || cells[entry.a1].display !== ''))
    .map(entry => ({ row: entry.row, nameCell: cells[entry.a1],
      metadata: weeklyLecturaMetadatos_(cells, entry.row, config) }))
    .sort((a, b) => a.row - b.row);
  const estructura = {
    headers: headers.map(entry => ({ a1: entry.a1,
      valor: weeklyLecturaValorSerial_(entry.cell), texto: entry.cell.display })),
    nombradas: namedRows.map(entry => ({ a1: weeklyLecturaColumnaLetra_(config.nameColumn) + entry.row,
      nombre: weeklyLecturaNombre_(entry.nameCell) })),
    adicionales: adicionales.map(entry => ({ a1: entry.a1,
      clasificacion: entry.clasificacion, etiquetaNormalizada: entry.etiquetaNormalizada }))
  };
  return { usedRows, usedColumns, headers, dateCandidates, adicionales, namedRows, estructura };
}

function weeklyLecturaMetadatos_(cells, row, config) {
  const fila = [];
  for (let column = config.metadataStartColumn; column < config.nameColumn; column++) {
    const a1 = weeklyLecturaColumnaLetra_(column) + row;
    fila.push({ a1, cell: cells[a1] });
  }
  return fila;
}

function weeklyLecturaStructureCheck_(antes, despues) {
  if (antes.estructura !== despues.estructura) throw new Error('LECTURA_ESTRUCTURA_CAMBIADA');
}

function weeklyLecturaIguales_(antes, despues) {
  return JSON.stringify(antes.cells) === JSON.stringify(despues.cells);
}

function weeklyLecturaDetalle_(capture, config, entidad) {
  const semanas = [];
  const columnasAdicionales = [];
  const conteoFechas = {};
  capture.dateCandidates.forEach(candidate => {
    const fechaLocal = candidate.cell.sheetDate;
    conteoFechas[fechaLocal] = (conteoFechas[fechaLocal] || 0) + 1;
  });
  const filas = capture.namedRows.map(row => weeklyLecturaFila_(row, capture, config));
  const repetidas = weeklyLecturaNombresRepetidos_(filas);
  // v3: semanas carries exclusively date-typed weekly headers.
  capture.dateCandidates.forEach(candidate => {
    const cell = candidate.cell;
    const fechaLocal = cell.sheetDate;
    semanas.push({ indice: semanas.length + 1, celda: cell.a1, fechaLocal: fechaLocal,
      textoMostrado: cell.display, duplicada: (conteoFechas[fechaLocal] || 0) > 1,
      noEsLunes: !weeklyLecturaEsLunes_(fechaLocal), ambigua: false });
  });
  // Comparison/benchmark headers are classified by normalized label; original
  // text and coordinate are preserved and no semantics are inferred.
  capture.additionalCandidates.forEach(entry => {
    columnasAdicionales.push({ indice: columnasAdicionales.length + 1, celda: entry.a1,
      columna: entry.column, etiquetaOriginal: weeklyLecturaEtiquetaOriginal_(entry.cell),
      etiquetaNormalizada: entry.etiquetaNormalizada, clasificacion: entry.clasificacion,
      interpretacionValidada: false });
  });
  const ambiguos = capture.headers
    .filter(entry => entry.column !== config.nameColumn && entry.cell.type !== 'date' &&
      (entry.cell.value !== '' || entry.cell.display !== '' || entry.cell.hasFormula) &&
      !capture.additionalCandidates.some(adicional => adicional.column === entry.column))
    .map(entry => ({ celda: entry.a1, textoMostrado: entry.cell.display }));
  const calidad = weeklyLecturaCalidad_(semanas, ambiguos, filas);
  return { semanas, columnasAdicionales, filas, calidad,
    advertencias: weeklyLecturaAdvertencias_(semanas, columnasAdicionales, filas, calidad,
      repetidas, config, entidad) };
}

function weeklyLecturaEtiquetaOriginal_(cell) {
  return cell.display !== '' ? cell.display : String(cell.value);
}

function weeklyLecturaFila_(namedRow, capture, config) {
  const fila = namedRow.row;
  const nombre = weeklyLecturaNombre_(namedRow.nameCell);
  const metadatos = {};
  namedRow.metadata.forEach(entry => {
    metadatos[weeklyLecturaLetraDeA1_(entry.a1)] =
      entry.cell ? weeklyLecturaObs_(entry.cell) : null;
  });
  const observaciones = {};
  capture.dateCandidates.forEach(candidate => {
    const fechaLocal = candidate.cell.sheetDate;
    const a1 = weeklyLecturaColumnaLetra_(candidate.column) + fila;
    const cell = capture.cells[a1];
    if (!cell) return;
    const clave = weeklyLecturaClaveSemana_(fechaLocal, candidate.column, capture);
    observaciones[clave] = weeklyLecturaObs_(cell);
  });
  // Additional-column values stay separate from the weekly observations and
  // are read from the same pre-restoration capture.
  const adicionales = {};
  capture.additionalCandidates.forEach(entry => {
    const a1 = weeklyLecturaColumnaLetra_(entry.column) + fila;
    const cell = capture.cells[a1];
    if (!cell) return;
    const clave = weeklyLecturaClaveAdicional_(entry.clasificacion, entry.column, capture);
    adicionales[clave] = weeklyLecturaObs_(cell);
  });
  return { id: config.tabName + '!F' + fila, nombre, fila,
    clasificacion: 'pendiente', kpi: null, unidad: null,
    interpretacion: null, sentidoFavorable: null,
    metadatos, observaciones, adicionales };
}

function weeklyLecturaClaveAdicional_(clasificacion, column, capture) {
  const repetidas = capture.additionalCandidates.filter(entry => entry.clasificacion === clasificacion);
  if (repetidas.length > 1) {
    return clasificacion + ' (' + weeklyLecturaColumnaLetra_(column) + weeklyDiagnosticConfig_.headerRow + ')';
  }
  return clasificacion;
}

function weeklyLecturaClaveSemana_(fechaLocal, column, capture) {
  const duplicadas = capture.dateCandidates.filter(candidate =>
    candidate.cell.sheetDate === fechaLocal);
  if (duplicadas.length > 1) {
    return fechaLocal + ' (' + weeklyLecturaColumnaLetra_(column) + weeklyDiagnosticConfig_.headerRow + ')';
  }
  return fechaLocal;
}

function weeklyLecturaObs_(cell) {
  let valor;
  if (cell.type === 'date') {
    valor = cell.sheetDate;
  } else if (cell.type === 'string' && cell.value === '') {
    valor = null;
  } else {
    valor = cell.value;
  }
  return { coordenada: cell.a1, valor, textoMostrado: cell.display,
    formato: cell.numberFormat, tipo: cell.type,
    estado: weeklyLecturaEstado_(cell), hasFormula: cell.hasFormula };
}

function weeklyLecturaEstado_(cell) {
  if (cell.type === 'date') return 'fecha';
  if (cell.type === 'number') return cell.observation === 'zero' ? 'cero' : 'numero';
  if (cell.type === 'boolean') return 'texto';
  if (cell.observation === 'empty') return 'vacio';
  if (cell.observation === 'errorOrText') return 'errorOrText';
  return 'texto';
}

function weeklyLecturaCalidad_(semanas, ambiguos, filas) {
  const declaradas = semanas.filter(week => week.fechaLocal !== null);
  const porFecha = {};
  declaradas.forEach(week => {
    (porFecha[week.fechaLocal] = porFecha[week.fechaLocal] || []).push(week.celda);
  });
  const duplicados = Object.keys(porFecha)
    .filter(fecha => porFecha[fecha].length > 1)
    .map(fecha => ({ fechaLocal: fecha, coordenadas: porFecha[fecha].slice() }))
    .sort((a, b) => a.fechaLocal.localeCompare(b.fechaLocal));
  const fechasNoLunes = declaradas.filter(week => week.noEsLunes)
    .map(week => ({ fechaLocal: week.fechaLocal, celda: week.celda }));
  const encabezadosAmbiguos = ambiguos.slice();
  const ultimoEncabezado = declaradas.length
    ? declaradas.map(week => week.fechaLocal).sort().slice(-1)[0] : null;
  const ultimaSemanaCerradaEsperada = weeklyLecturaUltimaCerrada_();
  const semanaCerradaEsperadaPresente = declaradas
    .some(week => week.fechaLocal === ultimaSemanaCerradaEsperada);
  const semanasConObservacionesNumericas = declaradas
    .filter(week => weeklyLecturaSemanaConObservacionesNumericas_(week, filas));
  return { duplicados, fechasNoLunes, encabezadosAmbiguos,
    ultimaSemanaCerradaEsperada, ultimoEncabezado,
    semanaCerradaEsperadaPresente, semanasDeclaradas: declaradas.length,
    semanasConObservacionesNumericas: semanasConObservacionesNumericas.length };
}

function weeklyLecturaSemanaConObservacionesNumericas_(week, filas) {
  // v3: only rows strictly after headerRow may support the numeric-observation
  // count. Rows at or above the header row stay in the inventory but never
  // confirm weekly availability, and an observed number still never certifies
  // a validated KPI or a complete load.
  const headerRow = weeklyDiagnosticConfig_.headerRow;
  return filas.some(fila => {
    if (fila.fila <= headerRow) return false;
    const obs = fila.observaciones[weeklyLecturaClaveDeSemana_(week)];
    return obs !== null && obs !== undefined &&
      ['cero', 'numero'].indexOf(obs.estado) !== -1;
  });
}

function weeklyLecturaClaveDeSemana_(week) {
  const duplicadas = week.duplicada;
  return duplicadas ? week.fechaLocal + ' (' + week.celda + ')' : week.fechaLocal;
}

function weeklyLecturaUltimaCerrada_() {
  const config = weeklyDiagnosticConfig_;
  const hoy = Utilities.formatDate(new Date(), config.readTimezone, 'yyyy-MM-dd');
  const partes = hoy.split('-').map(Number);
  const instante = Date.UTC(partes[0], partes[1] - 1, partes[2]);
  const dia = new Date(instante).getUTCDay();
  const diasDesdeLunes = (dia + 6) % 7;
  const lunesPasado = instante - diasDesdeLunes * 86400000 - 7 * 86400000;
  return new Date(lunesPasado).toISOString().slice(0, 10);
}

function weeklyLecturaAdvertencias_(semanas, columnasAdicionales, filas, calidad, nombresRepetidos, config, entidad) {
  const advertencias = weeklyLecturaAdvertenciasBase_();
  if (calidad.duplicados.length) {
    advertencias.push('Duplicated header dates are reported with all coordinates; observations for duplicates are keyed per column so no value is overwritten.');
  }
  if (calidad.fechasNoLunes.length) {
    advertencias.push('Some weekly headers are not Mondays; weekly alignment is not assumed for those columns.');
  }
  if (calidad.encabezadosAmbiguos.length) {
    advertencias.push('Non-date headers that are not recognized additional columns remain ambiguous outside semanas; no date interpretation was attempted.');
  }
  if (columnasAdicionales.length) {
    advertencias.push('Additional comparison/benchmark headers are read as extra columns with interpretacionValidada:false; no formula, unit, favorable direction or reference period is inferred from a label.');
  }
  const fechaEsperada = calidad.ultimaSemanaCerradaEsperada;
  if (!calidad.semanaCerradaEsperadaPresente) {
    advertencias.push('The expected last closed week (' + fechaEsperada + ') is missing from the declared weekly headers.');
  } else if (calidad.semanasConObservacionesNumericas === 0 ||
      !semanas.some(week => week.fechaLocal === fechaEsperada &&
        weeklyLecturaSemanaConObservacionesNumericas_(week, filas))) {
    advertencias.push('The expected last closed week (' + fechaEsperada + ') is present but has no numeric observations in the candidate body rows.');
  }
  if (calidad.semanasConObservacionesNumericas > 0) {
    advertencias.push('The numeric observations count does not certify complete load or validated KPI; it only reflects observed numbers in rows after the header row.');
  }
  if (entidad && entidad.tipo === 'LATAM') {
    advertencias.push('The regional LATAM aggregate must never be summed with country rows; rows are indicators or pending-classification content, never summed entities.');
  }
  if (nombresRepetidos.length) {
    advertencias.push('Repeated names are kept as separate rows with technical ids ' + config.tabName +
      '!F<row>; the id may change if rows are inserted.');
  }
  advertencias.push('Weekly number formats are only a hint; KPI classification stays pendiente and unidad/interpretacion/sentidoFavorable remain null.');
  return advertencias;
}

function weeklyLecturaAdvertenciasBase_() {
  return [
    'This reading is a manual pilot observation, not an audit.',
    'Completeness, country/data correspondence and recalculation are NOT verified.',
    'A stable read is an observation, not a verification; equality does not prove recalculation.'
  ];
}

function weeklyLecturaNombresRepetidos_(filas) {
  const conteo = {};
  filas.forEach(fila => { conteo[fila.nombre] = (conteo[fila.nombre] || 0) + 1; });
  return Object.keys(conteo).filter(nombre => conteo[nombre] > 1);
}

function weeklyLecturaNombre_(cell) {
  return cell.type === 'string' ? cell.value : cell.display;
}

function weeklyLecturaValorSerial_(cell) {
  return cell.type === 'date' ? cell.sheetDate : cell.value;
}

function weeklyLecturaEsLunes_(fechaLocal) {
  const partes = fechaLocal.split('-').map(Number);
  return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2])).getUTCDay() === 1;
}

function weeklyLecturaA1_(a1) {
  const match = /^([A-Z]+)(\d+)$/.exec(a1);
  let column = 0;
  const letters = match[1];
  for (let i = 0; i < letters.length; i++) {
    column = column * 26 + (letters.charCodeAt(i) - 64);
  }
  return { a1: a1, column: column, row: Number(match[2]) };
}

function weeklyLecturaColumnaLetra_(column) {
  return weeklyDiagnosticA1_(1, column).replace(/\d+$/, '');
}

function weeklyLecturaLetraDeA1_(a1) {
  return /^([A-Z]+)\d+$/.exec(a1)[1];
}

// Reader-local frozen known-label map. Header positions are never fixed: an
// additional column is recognized only by its normalized label, and the label
// never implies a formula, unit, favorable direction or reference period.
const weeklyLecturaEtiquetasAdicionales_ = Object.freeze([
  Object.freeze({ clasificacion: 'wow', normalizadas: Object.freeze(['wow']) }),
  Object.freeze({ clasificacion: 'vs-w4', normalizadas: Object.freeze(['vs w-4', 'vs w4']) }),
  Object.freeze({ clasificacion: 'vs-w8', normalizadas: Object.freeze(['vs w-8', 'vs w8']) }),
  Object.freeze({ clasificacion: 'bench-entre-mercados',
    normalizadas: Object.freeze(['bench entre mercados']) })
]);

function weeklyLecturaNormalizaEtiqueta_(texto) {
  // Accent-insensitive, case-insensitive, whitespace/newline and period
  // collapsing only: this is a classification aid, never a semantic claim.
  return String(texto)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function weeklyLecturaClasificaAdicional_(cell) {
  const normalizada = weeklyLecturaNormalizaEtiqueta_(
    cell.display !== '' ? cell.display : String(cell.value));
  if (normalizada === '') return null;
  const matches = weeklyLecturaEtiquetasAdicionales_.filter(patron =>
    patron.normalizadas.indexOf(normalizada) !== -1);
  return matches.length === 1 ? { clasificacion: matches[0].clasificacion,
    etiquetaNormalizada: normalizada } : null;
}

function weeklyLecturaError_(error) {
  const message = error && error.message;
  return typeof message === 'string' && /^(SELECTOR|LECTURA)_[A-Z_]+$/.test(message)
    ? message : 'SELECTOR_SERVICE_ERROR';
}
