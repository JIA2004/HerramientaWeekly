// Weekly pilot: consultation options.
//
// obtenerOpcionesWeekly() exists only so the frontend can offer exactly the
// countries the reader is able to accept. It reads the H4 data-validation rule
// and nothing else: no sheet body, no named rows, no weekly columns, no
// selector write and no script lock, because it never mutates the document and
// never needs exclusive access. The option list is evidence of the configured
// validation only; it does not prove that a reading works, that the sheet is
// complete or that a country has data.

function obtenerOpcionesWeekly() {
  const config = weeklyDiagnosticConfig_;
  const started = Date.now();
  const respuesta = weeklyOpcionesEnvelope_(config, started);
  const budget = { used: 0, limit: config.experiment.totalReadBudget, reserve: 4 };
  try {
    weeklySelectorConfig_(config);
    const document = SpreadsheetApp.openById(config.documentId);
    const sheet = document.getSheetByName(config.tabName);
    if (!sheet || sheet.getName() !== config.tabName) throw new Error('SELECTOR_DESTINATION');
    respuesta.zonaHorariaDocumento = document.getSpreadsheetTimeZone();
    const fuente = weeklyOpcionesFuente_(sheet, config, budget);
    const opciones = weeklyOpcionesLista_(fuente.permitidos, config, respuesta.advertencias);
    if (!opciones.length) throw new Error('SELECTOR_OPTIONS_EMPTY');
    respuesta.fuente = fuente.fuente;
    respuesta.opciones = opciones;
    respuesta.total = opciones.length;
    respuesta.estado = 'ok';
  } catch (error) {
    respuesta.estado = 'error';
    respuesta.error = { codigo: weeklyOpcionesCodigo_(error) };
  }
  const ended = Date.now();
  respuesta.finIso = new Date(ended).toISOString();
  respuesta.duracionMs = ended - started;
  return respuesta;
}

function weeklyOpcionesEnvelope_(config, started) {
  return {
    schemaVersion: 'weekly-opciones/1',
    estado: 'error',
    // Scope of the evidence this envelope carries: selector validation only.
    alcance: 'solo_validacion_selector',
    fuente: null,
    opciones: [],
    total: 0,
    origen: { documento: config.documentId, pestana: config.tabName,
      coordenada: config.selector },
    zonaHorariaDocumento: null,
    inicioIso: new Date(started).toISOString(),
    finIso: null,
    duracionMs: 0,
    verificacion: { lectura: 'no_verificada', completitud: 'no_verificada',
      correspondenciaPaisDatos: 'no_verificada' },
    advertencias: weeklyOpcionesAdvertenciasBase_(),
    error: null
  };
}

function weeklyOpcionesAdvertenciasBase_() {
  return [
    'These options come from the H4 validation rule only: they do not verify the reading, the load or the recalculation of the data.',
    'Choosing a country only enables the consultation; it does not confirm that the country has data or that the result matches its data.',
    'Additional report columns are shown as they are stored in the sheet and are never recalculated.'
  ];
}

function weeklyOpcionesFuente_(sheet, config, budget) {
  // Mirrors weeklySelectorValidation_ so the offered list and the reader's own
  // acceptance rule can never drift apart: a literal list is used as-is, a
  // range or absent rule falls back to the manual allowlist (the range criteria
  // values are never even requested), and any other criterion fails closed.
  weeklySelectorBudget_(budget, 1, true);
  const rule = sheet.getRange(config.selector).getDataValidation();
  const type = rule ? String(rule.getCriteriaType()) : 'NONE';
  if (type === 'VALUE_IN_LIST') {
    const values = rule.getCriteriaValues()[0];
    if (!Array.isArray(values) || !values.every(value => typeof value === 'string')) {
      throw new Error('SELECTOR_VALIDATION');
    }
    return { fuente: 'VALUE_IN_LIST', permitidos: values };
  }
  if (type === 'VALUE_IN_RANGE' || type === 'NONE') {
    return { fuente: 'LISTA_MANUAL', permitidos: config.experiment.manualCountryAllowlist };
  }
  throw new Error('SELECTOR_VALIDATION');
}

function weeklyOpcionesLista_(permitidos, config, advertencias) {
  const manual = config.experiment.manualCountryAllowlist;
  const base = manual.length ? permitidos.filter(nombre => manual.includes(nombre)) : permitidos;
  const opciones = [];
  const vistos = [];
  let vacias = 0;
  let inseguras = 0;
  let duplicadas = 0;
  base.forEach(nombre => {
    // The reader rejects a blank or whitespace-only country (SELECTOR_COUNTRY_BLANK)
    // before it takes the lock, so offering one would only produce a guaranteed
    // failure. Valid names are offered exactly as configured: no trimming, no
    // case folding and no other transformation.
    if (typeof nombre !== 'string' || nombre.trim() === '') {
      vacias++;
      return;
    }
    if (vistos.indexOf(nombre) !== -1) {
      duplicadas++;
      return;
    }
    vistos.push(nombre);
    // Never offer a value the reader itself would reject, and never transform
    // it into something acceptable: report it instead.
    if (!weeklySelectorLiteral_(nombre)) {
      inseguras++;
      return;
    }
    opciones.push({ nombre: nombre, tipo: weeklyOpcionesTipo_(nombre) });
  });
  if (vacias) {
    advertencias.push(`${vacias} configured option(s) were left out because they are empty or only whitespace.`);
  }
  if (inseguras) {
    advertencias.push(`${inseguras} configured option(s) were left out because they are not safe literal values for the selector.`);
  }
  if (duplicadas) {
    advertencias.push(`${duplicadas} duplicated configured option(s) were listed once.`);
  }
  return opciones;
}

function weeklyOpcionesTipo_(nombre) {
  return nombre.toUpperCase() === 'LATAM' ? 'LATAM' : 'pais';
}

function weeklyOpcionesCodigo_(error) {
  const message = error && error.message;
  return typeof message === 'string' && /^SELECTOR_[A-Z_]+$/.test(message)
    ? message : 'SELECTOR_SERVICE_ERROR';
}
