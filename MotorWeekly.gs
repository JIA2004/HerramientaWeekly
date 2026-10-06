// Weekly analysis engine. Pure functions: no spreadsheet service, no network, no
// clock. The caller hands over a normalized dataset (entity x field x week) and
// the KPI catalog; the engine returns data-quality findings, performance
// alerts and data-backed hypotheses. Runs unchanged in Apps Script and in Node.
//
// Honesty rules the engine keeps:
// - null is never turned into zero and zero is never turned into "missing";
// - a KPI with a quality finding that blocks interpretation gets no
//   performance alert for that entity;
// - "explicaciones" are observations from the same dataset (scope, parts,
//   components, simultaneous moves, last year). They are hypotheses to check,
//   never a demonstrated cause;
// - LATAM is analysed as its own entity and never counted among countries.

const weeklyMotorConfig_ = Object.freeze({
  semanasVentana: 9,
  semanasHistoria: 26,
  minimoHistoria: 12,
  zAlerta: 3.5,
  zAlta: 6,
  zCoMovimiento: 2,
  pisoRelativo: 0.03,
  pisoPuntos: 0.005,
  umbralFijoRelativo: 0.10,
  umbralFijoPuntos: 0.02,
  saltoImplausibleBaja: -0.7,
  saltoImplausibleSuba: 3,
  saltoImplausiblePuntos: 0.20,
  nulosParaInestable: 3,
  saltosParaInestable: 2,
  toleranciaPartes: 0.005,
  semanasAnio: 52,
  maxCoMovimientos: 5,
  maxDestacados: 3,
  // A market whose last week carries less than this share of the fields its
  // previous weeks carried is read as a load still in progress.
  coberturaMinima: 0.8,
  semanasCobertura: 3,
  // With only a handful of fields one gap is not a load problem.
  camposParaCobertura: 10,
  // How many block leaders make the headline of the weekly overview.
  maxTopline: 3
});

function analizarWeekly(entrada) {
  const cfg = Object.assign({}, weeklyMotorConfig_, entrada.opciones || {});
  const semanas = entrada.semanas.slice().sort();
  const n = semanas.length;
  const ctx = { cfg, semanas, datos: entrada.datos, cache: {}, porId: {} };
  const kpis = entrada.catalogo.kpis;
  kpis.forEach(kpi => { ctx.porId[kpi.id] = kpi; });
  const analizables = kpis.filter(kpi => kpi.def && !kpi.duplicadoDe);
  const globales = weeklyMotorGlobales_(entrada, semanas, cfg);
  const parciales = {};
  globales.forEach(g => (g.entidades || []).forEach(nombre => { parciales[nombre] = true; }));
  const calidad = [];
  const performance = [];
  const noOpera = [];
  const movimientos = {};
  if (n >= 2) {
    entrada.entidades.forEach(entidad => {
      movimientos[entidad.nombre] = {};
      // A market still loading is not interpreted at all: one finding for the
      // load instead of one per missing KPI, and no performance on half a week.
      if (parciales[entidad.nombre]) return;
      const revisiones = {};
      analizables.forEach(kpi => {
        const serie = weeklyMotorSerie_(ctx, entidad.nombre, kpi.id, 0);
        const revision = weeklyMotorRevisa_(ctx, entidad, kpi, revisiones, 0);
        if (revision.noOpera) noOpera.push({ entidad: entidad.nombre, kpi: weeklyMotorKpiRef_(kpi) });
        revision.hallazgos.forEach(hallazgo => calidad.push(hallazgo));
        if (revision.noOpera || revision.bloquea) return;
        const movimiento = weeklyMotorMovimiento_(ctx, kpi, serie);
        if (movimiento) movimientos[entidad.nombre][kpi.id] = movimiento;
      });
    });
    entrada.entidades.forEach(entidad => {
      analizables.forEach(kpi => {
        const movimiento = movimientos[entidad.nombre][kpi.id];
        if (!movimiento || !movimiento.alerta) return;
        performance.push(weeklyMotorAlerta_(ctx, entrada, entidad, kpi, movimiento, movimientos));
      });
    });
  }
  const orden = { alta: 0, media: 1, baja: 2 };
  calidad.sort((a, b) => orden[a.severidad] - orden[b.severidad] ||
    a.entidad.localeCompare(b.entidad) || a.kpi.fila - b.kpi.fila);
  performance.sort((a, b) => b.score - a.score);
  return {
    schemaVersion: 'weekly-analisis/2',
    semana: n ? semanas[n - 1] : null,
    semanaAnterior: n > 1 ? semanas[n - 2] : null,
    semanasDisponibles: n,
    globales,
    provisoria: globales.some(g => g.provisoria),
    cargaParcial: Object.keys(parciales).sort(),
    calidad,
    performance,
    noOpera,
    panorama: n >= 2 ? weeklyMotorPanorama_(ctx, entrada, analizables, movimientos) : [],
    catalogo: { total: kpis.length, analizados: analizables.length,
      advertencias: entrada.catalogo.advertencias },
    parametros: cfg,
    limites: [
      'Las explicaciones son hipótesis apoyadas en los mismos datos; no demuestran causa.',
      'Feriados, clima, campañas, competencia e incidentes no están en la fuente y no se evalúan.',
      'Un KPI con un hallazgo de calidad que bloquea la interpretación no genera alerta de performance.'
    ]
  };
}

// State of the load, before any KPI is read. The sheet is refreshed on Mondays
// and a Monday morning run can find it not refreshed yet, refreshed without
// the new week, or refreshed half way. Those three make the run provisional
// (provisoria): it is shown with the warning and must not be kept as the
// week's result.
function weeklyMotorGlobales_(entrada, semanas, cfg) {
  const hallazgos = [];
  const ultima = semanas.length ? semanas[semanas.length - 1] : null;
  if (entrada.semanaEsperada && ultima !== entrada.semanaEsperada) {
    const lunesActual = new Date(Date.parse(entrada.semanaEsperada) + 7 * 86400000).toISOString().slice(0, 10);
    const actualizada = entrada.ultimaActualizacion || null;
    if (actualizada && actualizada < lunesActual && ultima < entrada.semanaEsperada) {
      hallazgos.push({ regla: 'ACTUALIZACION_PENDIENTE', severidad: 'alta', provisoria: true,
        detalle: 'Los datos se actualizaron por última vez el ' + actualizada + ', antes del lunes ' + lunesActual +
          '. Todavía no traen la semana del ' + entrada.semanaEsperada + '; lo que se muestra es la semana del ' + ultima + '.' });
    } else {
      hallazgos.push({ regla: 'SEMANA_ESPERADA_AUSENTE', severidad: 'alta', provisoria: true,
        detalle: 'La última semana cerrada esperada es ' + entrada.semanaEsperada +
          ' y la última semana con datos es ' + ultima + '.' +
          (actualizada && actualizada >= lunesActual ? ' Los datos sí se actualizaron el ' + actualizada + ': la semana falta en la fuente.' : '') });
    }
  }
  for (let i = 1; i < semanas.length; i++) {
    const dias = (Date.parse(semanas[i]) - Date.parse(semanas[i - 1])) / 86400000;
    if (dias !== 7 && i >= semanas.length - 26) {
      hallazgos.push({ regla: 'SEMANA_SALTEADA', severidad: 'alta',
        detalle: 'Entre ' + semanas[i - 1] + ' y ' + semanas[i] + ' hay ' + dias + ' días.' });
    }
  }
  const n = semanas.length;
  if (n > cfg.semanasCobertura) {
    const cuenta = (campos, semana) => Object.keys(campos).filter(campo => typeof campos[campo][semana] === 'number').length;
    const cortos = [];
    entrada.entidades.forEach(entidad => {
      const campos = entrada.datos[entidad.nombre];
      if (!campos) return;
      const previas = weeklyMotorMediana_(semanas.slice(n - 1 - cfg.semanasCobertura, n - 1).map(semana => cuenta(campos, semana)));
      const actual = cuenta(campos, semanas[n - 1]);
      if (previas >= cfg.camposParaCobertura && actual < cfg.coberturaMinima * previas) cortos.push({ nombre: entidad.nombre, actual: actual, previas: previas });
    });
    if (cortos.length) {
      hallazgos.push({ regla: 'CARGA_PARCIAL', severidad: 'alta', provisoria: true, entidades: cortos.map(c => c.nombre),
        detalle: 'La semana del ' + semanas[n - 1] + ' trae menos datos que las anteriores en ' +
          cortos.map(c => c.nombre + ' (' + c.actual + ' campos con dato; antes ' + c.previas + ')').join(', ') +
          '. Esos mercados no se interpretan hasta que la carga termine.' });
    }
  }
  if (entrada.filasDuplicadas > 0) {
    hallazgos.push({ regla: 'FILAS_DUPLICADAS', severidad: 'media',
      detalle: entrada.filasDuplicadas + ' combinaciones de mercado y semana aparecen más de una vez en los datos; se usó la última de cada una.' });
  }
  entrada.entidades.forEach(entidad => {
    if (!entrada.datos[entidad.nombre]) {
      hallazgos.push({ regla: 'ENTIDAD_SIN_DATOS', severidad: 'alta',
        detalle: entidad.nombre + ' no tiene ninguna fila en la fuente.' });
    }
  });
  return hallazgos;
}

// ---- Series -----------------------------------------------------------------

function weeklyMotorSerie_(ctx, entidad, id, profundidad) {
  const propia = ctx.cache[entidad] = ctx.cache[entidad] || {};
  if (propia[id]) return propia[id];
  const kpi = ctx.porId[id];
  const vacia = ctx.semanas.map(() => null);
  if (!kpi || !kpi.def || profundidad > 6) return vacia;
  const def = kpi.def;
  const otra = ref => weeklyMotorSerie_(ctx, entidad, ctx.porId[ref] && ctx.porId[ref].duplicadoDe || ref, profundidad + 1);
  let serie;
  if (def.tipo === 'campo') {
    serie = weeklyMotorCampo_(ctx, entidad, def.campo);
  } else if (def.tipo === 'campoSobre') {
    const num = weeklyMotorCampo_(ctx, entidad, def.campo);
    const den = otra(def.den);
    serie = num.map((v, i) => weeklyMotorDivide_(v, den[i]));
  } else if (def.tipo === 'razon') {
    const num = otra(def.num);
    const den = otra(def.den);
    serie = num.map((v, i) => weeklyMotorDivide_(v, den[i]));
  } else if (def.tipo === 'producto') {
    const a = otra(def.a);
    const b = otra(def.b);
    serie = a.map((v, i) => (v === null || b[i] === null ? null : v * b[i]));
  } else if (def.tipo === 'suma') {
    // A part with no activity in the whole recent history (a vertical the market
    // does not operate) counts as zero, like the sheet's SUM does. A part that
    // has data and is missing for some week still makes that week's total null.
    const alcance = ctx.cfg.semanasVentana + ctx.cfg.semanasHistoria;
    const partes = def.partes.map(otra);
    const ausentes = partes.map(parte => parte.slice(-alcance).every(v => v === null || v === 0));
    serie = ctx.semanas.map((_, i) => {
      let total = 0;
      for (let k = 0; k < partes.length; k++) {
        if (partes[k][i] === null && !ausentes[k]) return null;
        total += partes[k][i] || 0;
      }
      return total;
    });
  } else {
    serie = vacia;
  }
  propia[id] = serie;
  return serie;
}

// The weekly values the engine works with for one entity, by KPI id, in the
// order of the returned weeks. Lets a caller compare them with what the sheet
// shows for that entity.
function weeklyMotorValores_(entrada, entidad) {
  const semanas = entrada.semanas.slice().sort();
  const ctx = { cfg: Object.assign({}, weeklyMotorConfig_, entrada.opciones || {}), semanas,
    datos: entrada.datos, cache: {}, porId: {} };
  entrada.catalogo.kpis.forEach(kpi => { ctx.porId[kpi.id] = kpi; });
  const valores = {};
  entrada.catalogo.kpis.forEach(kpi => {
    if (kpi.def) valores[kpi.id] = weeklyMotorSerie_(ctx, entidad, kpi.duplicadoDe || kpi.id, 0);
  });
  return { semanas, valores };
}

function weeklyMotorCampo_(ctx, entidad, campo) {
  const fuente = ctx.datos[entidad] && ctx.datos[entidad][campo];
  return ctx.semanas.map(semana => {
    const valor = fuente ? fuente[semana] : null;
    return typeof valor === 'number' && isFinite(valor) ? valor : null;
  });
}

function weeklyMotorDivide_(num, den) {
  return num === null || den === null || den === 0 ? null : num / den;
}

function weeklyMotorCambio_(unidad, actual, base) {
  if (actual === null || base === null) return null;
  if (unidad === 'pp') return actual - base;
  return base === 0 ? null : actual / base - 1;
}

// ---- Data quality -----------------------------------------------------------

// Quality review with dependencies: a derived KPI (ratio, product, sum) whose
// input already has a blocking finding gets a single low-severity note that
// points at the input, instead of repeating the same problem on every row.
function weeklyMotorRevisa_(ctx, entidad, kpi, revisiones, profundidad) {
  if (revisiones[kpi.id]) return revisiones[kpi.id];
  const serie = weeklyMotorSerie_(ctx, entidad.nombre, kpi.id, 0);
  const def = kpi.def;
  const refs = ['num', 'den', 'a', 'b'].map(k => def[k]).filter(Boolean).concat(def.partes || []);
  let origen = null;
  if (profundidad <= 6) {
    refs.forEach(ref => {
      const otro = ctx.porId[ctx.porId[ref].duplicadoDe || ref];
      if (origen || !otro.def) return;
      const revision = weeklyMotorRevisa_(ctx, entidad, otro, revisiones, profundidad + 1);
      if (revision.bloquea && !revision.noOpera) origen = otro;
    });
  }
  let revision;
  if (origen && !serie.slice(-ctx.cfg.semanasVentana).every(v => v === null || v === 0)) {
    const n = serie.length;
    revision = { bloquea: true, noOpera: false, hallazgos: [{ tipo: 'calidad', regla: 'DEPENDE_DE_DATO_OBSERVADO',
      severidad: 'baja', entidad: entidad.nombre, tipoEntidad: entidad.tipo, kpi: weeklyMotorKpiRef_(kpi), unidad: kpi.unidad,
      semana: ctx.semanas[n - 1], valor: serie[n - 1], valorAnterior: serie[n - 2],
      detalle: 'Se calcula a partir de ' + origen.etiqueta + ' (fila ' + origen.fila + '), que tiene un hallazgo de calidad.',
      bloqueaPerformance: true, evidencia: [] }] };
  } else {
    revision = weeklyMotorCalidad_(ctx, entidad, kpi, serie);
  }
  revisiones[kpi.id] = revision;
  return revision;
}

function weeklyMotorCalidad_(ctx, entidad, kpi, serie) {
  const cfg = ctx.cfg;
  const n = serie.length;
  const actual = serie[n - 1];
  const anterior = serie[n - 2];
  const ventana = serie.slice(-cfg.semanasVentana);
  const previa = serie.slice(-(cfg.semanasVentana + cfg.semanasHistoria), -cfg.semanasVentana);
  const sinActividad = lista => lista.every(valor => valor === null || valor === 0);
  const hallazgos = [];
  let bloquea = false;
  const agrega = (regla, severidad, detalle, bloqueaPerformance) => {
    if (bloqueaPerformance) bloquea = true;
    hallazgos.push({ tipo: 'calidad', regla, severidad, entidad: entidad.nombre,
      tipoEntidad: entidad.tipo, kpi: weeklyMotorKpiRef_(kpi), unidad: kpi.unidad,
      semana: ctx.semanas[n - 1], valor: actual, valorAnterior: anterior, detalle,
      bloqueaPerformance: !!bloqueaPerformance,
      evidencia: ventana.map((valor, i) => ({ semana: ctx.semanas[n - ventana.length + i], valor })) });
  };
  if (sinActividad(ventana)) {
    if (sinActividad(previa)) return { hallazgos, bloquea: true, noOpera: true };
    agrega('SIN_DATOS_EN_VENTANA', 'alta',
      'Sin valores en las últimas ' + ventana.length + ' semanas, aunque antes sí había datos.', true);
    return { hallazgos, bloquea, noOpera: false };
  }
  const crudo = weeklyMotorCrudo_(ctx, entidad.nombre, kpi, ctx.semanas[n - 1]);
  if (typeof crudo === 'string' && crudo.trim() !== '') {
    agrega('VALOR_NO_NUMERICO', 'alta',
      'La fuente trae texto o un error ("' + crudo.slice(0, 40) + '") en lugar de un número.', true);
  } else if (actual === null) {
    agrega('FALTANTE_ULTIMA_SEMANA', 'alta',
      'No hay valor para la última semana y sí para semanas anteriores.', true);
  } else if (actual === 0 && weeklyMotorMediana_(ventana.slice(0, -1).filter(v => v !== null)) !== 0) {
    agrega('CERO_SOSPECHOSO', 'alta',
      'El valor es 0 y la mediana de las semanas previas no lo es. Puede ser un cero real o una carga incompleta.', true);
  }
  const conocidos = serie.filter(valor => valor !== null);
  const esProporcion = kpi.unidad === 'pp' && weeklyMotorMediana_(conocidos.map(Math.abs)) <= 1;
  if (esProporcion && actual !== null && (actual < 0 || actual > 1.0001)) {
    agrega('FUERA_DE_RANGO', 'alta',
      'Es una proporción y el valor queda fuera de 0–100 %.', true);
  }
  const nulos = ventana.slice(0, -1).filter(valor => valor === null).length;
  let saltos = 0;
  for (let i = 1; i < ventana.length; i++) {
    if (weeklyMotorImplausible_(cfg, kpi.unidad, ventana[i], ventana[i - 1])) saltos++;
  }
  if (nulos >= cfg.nulosParaInestable || saltos >= cfg.saltosParaInestable) {
    agrega('SERIE_INESTABLE', 'media',
      'En las últimas ' + ventana.length + ' semanas hay ' + nulos + ' faltantes y ' + saltos +
      ' saltos fuera de escala. La serie no es confiable para interpretar variaciones.', true);
  } else {
    if (!bloquea && weeklyMotorImplausible_(cfg, kpi.unidad, actual, anterior)) {
      agrega('SALTO_FUERA_DE_ESCALA', 'alta',
        'La variación contra la semana anterior es demasiado grande para leerla como performance sin revisar el dato.', true);
    }
    if (nulos > 0) {
      agrega('HUECOS_EN_VENTANA', 'baja',
        'Faltan ' + nulos + ' semana(s) dentro de la ventana; las comparaciones contra esas semanas no están disponibles.', false);
    }
  }
  if (!bloquea && actual !== null && actual === anterior && actual !== 0 && !Number.isInteger(actual)) {
    agrega('VALOR_REPETIDO', 'baja',
      'El valor es idéntico al de la semana anterior con todos sus decimales; puede ser un dato arrastrado.', false);
  }
  return { hallazgos, bloquea, noOpera: false };
}

function weeklyMotorCrudo_(ctx, entidad, kpi, semana) {
  if (kpi.def.tipo !== 'campo' && kpi.def.tipo !== 'campoSobre') return null;
  const fuente = ctx.datos[entidad] && ctx.datos[entidad][kpi.def.campo];
  return fuente ? fuente[semana] : null;
}

function weeklyMotorImplausible_(cfg, unidad, actual, base) {
  const cambio = weeklyMotorCambio_(unidad, actual, base);
  if (cambio === null) return false;
  if (unidad === 'pp') return Math.abs(cambio) >= cfg.saltoImplausiblePuntos;
  return cambio <= cfg.saltoImplausibleBaja || cambio >= cfg.saltoImplausibleSuba;
}

// ---- Performance ------------------------------------------------------------

function weeklyMotorMovimiento_(ctx, kpi, serie) {
  const cfg = ctx.cfg;
  const n = serie.length;
  const cambio = weeklyMotorCambio_(kpi.unidad, serie[n - 1], serie[n - 2]);
  if (cambio === null) return null;
  const historia = [];
  for (let i = Math.max(1, n - 1 - cfg.semanasHistoria); i < n - 1; i++) {
    const previo = weeklyMotorCambio_(kpi.unidad, serie[i], serie[i - 1]);
    if (previo !== null) historia.push(previo);
  }
  const piso = kpi.unidad === 'pp' ? cfg.pisoPuntos : cfg.pisoRelativo;
  const fijo = kpi.unidad === 'pp' ? cfg.umbralFijoPuntos : cfg.umbralFijoRelativo;
  let z = null;
  let escala = null;
  let metodo = 'umbral_fijo';
  if (historia.length >= cfg.minimoHistoria) {
    const centro = weeklyMotorMediana_(historia);
    escala = weeklyMotorMediana_(historia.map(valor => Math.abs(valor - centro))) * 1.4826;
    if (escala > 0) {
      z = (cambio - centro) / escala;
      metodo = 'historico';
    }
  }
  const alerta = metodo === 'historico'
    ? Math.abs(z) >= cfg.zAlerta && Math.abs(cambio) >= piso
    : Math.abs(cambio) >= fijo;
  const intensidad = metodo === 'historico' ? Math.abs(z) : Math.abs(cambio) / fijo * cfg.zAlerta;
  return { cambio, z, escala, metodo, alerta, intensidad, observaciones: historia.length,
    valor: serie[n - 1], valorAnterior: serie[n - 2] };
}

function weeklyMotorAlerta_(ctx, entrada, entidad, kpi, movimiento, movimientos) {
  const cfg = ctx.cfg;
  const serie = weeklyMotorSerie_(ctx, entidad.nombre, kpi.id, 0);
  const n = serie.length;
  const favorable = kpi.direccion === 1 || kpi.direccion === -1
    ? movimiento.cambio * kpi.direccion > 0 : null;
  const hace = k => (n - 1 - k >= 0 ? weeklyMotorCambio_(kpi.unidad, serie[n - 1], serie[n - 1 - k]) : null);
  const severidad = movimiento.intensidad >= cfg.zAlta ? 'alta' : 'media';
  return {
    tipo: 'performance', severidad, entidad: entidad.nombre, tipoEntidad: entidad.tipo,
    kpi: weeklyMotorKpiRef_(kpi), unidad: kpi.unidad,
    semana: ctx.semanas[n - 1], semanaAnterior: ctx.semanas[n - 2],
    valor: movimiento.valor, valorAnterior: movimiento.valorAnterior,
    cambio: movimiento.cambio, sentido: movimiento.cambio > 0 ? 'sube' : 'baja', favorable,
    metodo: movimiento.metodo, z: movimiento.z, variabilidadTipica: movimiento.escala,
    observacionesHistoria: movimiento.observaciones,
    vsW4: hace(4), vsW8: hace(8), vsAnioAnterior: hace(cfg.semanasAnio),
    explicaciones: {
      alcance: weeklyMotorAlcance_(entrada, entidad, kpi, movimiento, movimientos, cfg),
      partes: weeklyMotorPartes_(ctx, entidad.nombre, kpi),
      componentes: weeklyMotorComponentes_(ctx, entidad.nombre, kpi),
      movimientosSimultaneos: weeklyMotorSimultaneos_(ctx, entidad.nombre, kpi, movimientos),
      anioAnterior: weeklyMotorAnioAnterior_(cfg, kpi, serie, movimiento)
    },
    evidencia: serie.slice(-cfg.semanasVentana).map((valor, i, ventana) => ({ semana: ctx.semanas[n - ventana.length + i], valor: valor })),
    score: Math.min(movimiento.intensidad, 30) * (favorable === false ? 1.25 : 1)
  };
}

// How many other countries moved the same way on the same KPI this week.
function weeklyMotorAlcance_(entrada, entidad, kpi, movimiento, movimientos, cfg) {
  const paises = entrada.entidades.filter(otra => otra.tipo === 'pais' && otra.nombre !== entidad.nombre);
  const mismos = [];
  let comparables = 0;
  paises.forEach(pais => {
    const otro = movimientos[pais.nombre] && movimientos[pais.nombre][kpi.id];
    if (!otro) return;
    comparables++;
    if (otro.cambio * movimiento.cambio > 0 && otro.intensidad >= cfg.zCoMovimiento) mismos.push(pais.nombre);
  });
  let lectura = 'sin_comparacion';
  if (comparables > 0) {
    const proporcion = mismos.length / comparables;
    lectura = proporcion >= 1 / 3 ? 'extendido' : mismos.length === 0 ? 'local' : 'parcial';
  }
  return { lectura, otrosPaisesMismoSentido: mismos, otrosPaisesComparables: comparables,
    cambios: mismos.map(nombre => ({ pais: nombre, cambio: movimientos[nombre][kpi.id].cambio }))
      .sort((a, b) => Math.abs(b.cambio) - Math.abs(a.cambio)) };
}

// The KPIs that open each block of the sheet, in sheet order: the first
// analysable row of every (section, block). Without a block column it is the
// first row of every section. The sheet decides what leads; nothing is listed here.
function weeklyMotorLideres_(kpis) {
  const vistos = {};
  return kpis.filter(kpi => {
    const clave = kpi.seccion + '|' + kpi.bloque;
    if (!kpi.def || vistos[clave]) return false;
    vistos[clave] = true;
    return true;
  });
}

// Weekly overview per entity, alerts or not: the headline KPIs (the first block
// leaders), the KPIs that moved the most against their own usual variation
// and, for the regional aggregate, a tour of every section through its block
// leaders. A leader held back by a quality finding keeps its value and gets no
// change (cambio null), so it is never read as performance.
function weeklyMotorPanorama_(ctx, entrada, analizables, movimientos) {
  const cfg = ctx.cfg;
  const n = ctx.semanas.length;
  const lideres = weeklyMotorLideres_(entrada.catalogo.kpis);
  const esLider = {};
  lideres.forEach(kpi => { esLider[kpi.duplicadoDe || kpi.id] = true; });
  return entrada.entidades.map(entidad => {
    const propios = movimientos[entidad.nombre] || {};
    const ficha = kpi => {
      const id = kpi.duplicadoDe || kpi.id;
      const movimiento = propios[id] || null;
      const propia = { kpi: weeklyMotorKpiRef_(kpi), seccion: kpi.seccion, bloque: kpi.bloque };
      if (movimiento) {
        return Object.assign(weeklyMotorAlerta_(ctx, entrada, entidad, ctx.porId[id], movimiento, movimientos), propia,
          { esAlerta: movimiento.alerta, habitual: movimiento.intensidad < cfg.zCoMovimiento });
      }
      const serie = weeklyMotorSerie_(ctx, entidad.nombre, id, 0);
      return Object.assign(propia, { unidad: kpi.unidad, valor: serie[n - 1], valorAnterior: serie[n - 2], cambio: null,
        favorable: null, sinComparacion: true,
        evidencia: serie.slice(-cfg.semanasVentana).map((valor, i, ventana) => ({ semana: ctx.semanas[n - ventana.length + i], valor: valor })) });
    };
    const fuertes = Object.keys(propios)
      .filter(id => propios[id].intensidad >= cfg.zCoMovimiento && propios[id].cambio !== 0)
      .sort((a, b) => (propios[b].alerta - propios[a].alerta) || propios[b].intensidad - propios[a].intensidad);
    const salida = { entidad: entidad.nombre, tipoEntidad: entidad.tipo,
      topline: lideres.slice(0, cfg.maxTopline).map(ficha),
      destacados: fuertes.slice(0, cfg.maxDestacados).map(id => ficha(ctx.porId[id])) };
    if (entidad.tipo === 'LATAM') {
      const secciones = [];
      lideres.forEach(kpi => {
        let ultima = secciones[secciones.length - 1];
        if (!ultima || ultima.seccion !== kpi.seccion) secciones.push(ultima = { seccion: kpi.seccion, lideres: [], otro: null });
        ultima.lideres.push(ficha(kpi));
      });
      secciones.forEach(seccion => {
        const id = fuertes.filter(otro => ctx.porId[otro].seccion === seccion.seccion && !esLider[otro])[0];
        if (id) seccion.otro = ficha(ctx.porId[id]);
      });
      salida.recorrido = secciones;
    }
    return salida;
  });
}

// Additive split of a total into its parts, only when the parts really add up.
function weeklyMotorPartes_(ctx, entidad, kpi) {
  if (!kpi.partes || !kpi.partes.length) return null;
  const n = ctx.semanas.length;
  const total = weeklyMotorSerie_(ctx, entidad, kpi.id, 0);
  const delta = total[n - 1] - total[n - 2];
  let sumaActual = 0;
  let sumaAnterior = 0;
  const filas = [];
  for (let i = 0; i < kpi.partes.length; i++) {
    const parte = ctx.porId[kpi.partes[i]];
    const serie = weeklyMotorSerie_(ctx, entidad, parte.duplicadoDe || parte.id, 0);
    if (serie[n - 1] === null || serie[n - 2] === null) return null;
    sumaActual += serie[n - 1];
    sumaAnterior += serie[n - 2];
    filas.push({ kpi: weeklyMotorKpiRef_(parte), valor: serie[n - 1], valorAnterior: serie[n - 2],
      diferencia: serie[n - 1] - serie[n - 2] });
  }
  const tolera = (suma, valor) => Math.abs(suma - valor) <= ctx.cfg.toleranciaPartes * Math.abs(valor);
  if (delta === 0 || !tolera(sumaActual, total[n - 1]) || !tolera(sumaAnterior, total[n - 2])) return null;
  filas.forEach(fila => { fila.aporte = fila.diferencia / delta; });
  filas.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
  return filas;
}

// For a ratio or a product: how each side moved.
function weeklyMotorComponentes_(ctx, entidad, kpi) {
  const def = kpi.def;
  const lados = def.tipo === 'razon' ? [['numerador', def.num], ['denominador', def.den]]
    : def.tipo === 'producto' ? [['factor', def.a], ['factor', def.b]] : null;
  if (!lados) return null;
  const n = ctx.semanas.length;
  return lados.map(lado => {
    const otro = ctx.porId[lado[1]];
    const serie = weeklyMotorSerie_(ctx, entidad, otro.duplicadoDe || otro.id, 0);
    return { rol: lado[0], kpi: weeklyMotorKpiRef_(otro), unidad: otro.unidad,
      valor: serie[n - 1], valorAnterior: serie[n - 2],
      cambio: weeklyMotorCambio_(otro.unidad, serie[n - 1], serie[n - 2]) };
  });
}

function weeklyMotorSimultaneos_(ctx, entidad, kpi, movimientos) {
  const propios = movimientos[entidad];
  return Object.keys(propios)
    .filter(id => id !== kpi.id && propios[id].intensidad >= ctx.cfg.zCoMovimiento)
    .map(id => {
      const otro = ctx.porId[id];
      return { kpi: weeklyMotorKpiRef_(otro), unidad: otro.unidad, cambio: propios[id].cambio,
        z: propios[id].z, mismaSeccion: otro.seccion === kpi.seccion, intensidad: propios[id].intensidad };
    })
    .sort((a, b) => (b.mismaSeccion - a.mismaSeccion) || b.intensidad - a.intensidad)
    .slice(0, ctx.cfg.maxCoMovimientos);
}

function weeklyMotorAnioAnterior_(cfg, kpi, serie, movimiento) {
  const i = serie.length - 1 - cfg.semanasAnio;
  if (i < 1) return null;
  const cambio = weeklyMotorCambio_(kpi.unidad, serie[i], serie[i - 1]);
  if (cambio === null) return null;
  return { cambio, patronSimilar: cambio * movimiento.cambio > 0 &&
    Math.abs(cambio) >= 0.5 * Math.abs(movimiento.cambio) };
}

function weeklyMotorKpiRef_(kpi) {
  return { id: kpi.id, uid: kpi.uid, fila: kpi.fila, etiqueta: kpi.etiqueta, clave: kpi.clave };
}

function weeklyMotorMediana_(lista) {
  if (!lista.length) return NaN;
  const orden = lista.slice().sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

// ---- Catalog ----------------------------------------------------------------
//
// Builds the KPI catalog from the rows of "2) Weekly por pais" as they are:
// favourable direction, technical key and visible name come from their
// columns; the unit comes from the sheet's own WoW formula ((M-L)*100 is
// percentage points, M/L-1 is relative); derived KPIs come from the value
// formula of the row. Each entry: { fila, direccion, clave, nombre, bloque,
// formulaValor, formulaVariacion }. bloque is the sheet's own grouping inside a
// section (Orders, GMV, User Base...), written on the first row of each block.

function weeklyMotorCatalogo_(filas) {
  const kpis = [];
  const advertencias = [];
  const porCampo = {};
  let seccion = '';
  let bloque = '';
  let grupo = '';
  let filaPrevia = null;
  let totalAbierto = null;
  filas.slice().sort((a, b) => a.fila - b.fila).forEach(fila => {
    const nombre = String(fila.nombre === null || fila.nombre === undefined ? '' : fila.nombre)
      .replace(/\s+/g, ' ').trim();
    const marca = String(fila.bloque === null || fila.bloque === undefined ? '' : fila.bloque).replace(/\s+/g, ' ').trim();
    if (marca !== '') bloque = marca;
    if (nombre === '') return;
    const contigua = filaPrevia !== null && fila.fila === filaPrevia + 1;
    filaPrevia = fila.fila;
    const formula = String(fila.formulaValor || '');
    const direccion = fila.direccion === 1 || fila.direccion === -1 ? fila.direccion : null;
    if (formula === '') {
      if (direccion === null) { seccion = nombre; grupo = ''; bloque = ''; } else { grupo = nombre; }
      totalAbierto = null;
      return;
    }
    if (!contigua) { grupo = ''; totalAbierto = null; }
    const clave = String(fila.clave || '').trim();
    const def = weeklyMotorDefinicion_(formula, fila.fila, clave);
    const esTotal = /\s-\sTotal$/i.test(nombre);
    const visible = esTotal ? nombre.replace(/\s-\sTotal$/i, '') : nombre;
    const kpi = { id: 'F' + fila.fila, fila: fila.fila, seccion, bloque, nombre,
      etiqueta: [seccion, esTotal ? '' : grupo, visible].filter(parte => parte !== '').join(' › '),
      clave: clave === 'FORMULA' ? '' : clave, direccion, def,
      unidad: weeklyMotorUnidad_(fila.formulaVariacion, def), partes: null, duplicadoDe: null };
    if (!def) {
      advertencias.push('Fila ' + fila.fila + ' (' + nombre + '): fórmula no reconocida; el KPI no se analiza.');
    } else if (def.tipo === 'campo') {
      if (porCampo[def.campo]) kpi.duplicadoDe = porCampo[def.campo];
      else porCampo[def.campo] = kpi.id;
    }
    if (direccion === null) {
      advertencias.push('Fila ' + fila.fila + ' (' + nombre + '): sin dirección favorable (1 o -1).');
    }
    if (esTotal) {
      grupo = visible;
      kpi.partes = [];
      totalAbierto = kpi;
    } else if (totalAbierto && contigua) {
      totalAbierto.partes.push(kpi.id);
    }
    kpis.push(kpi);
  });
  weeklyMotorIdentidades_(kpis);
  const ids = {};
  kpis.forEach(kpi => { ids[kpi.id] = true; });
  kpis.forEach(kpi => {
    if (!kpi.def) return;
    const refs = ['num', 'den', 'a', 'b'].map(k => kpi.def[k]).filter(Boolean).concat(kpi.def.partes || []);
    if (refs.some(ref => !ids[ref])) {
      advertencias.push('Fila ' + kpi.fila + ' (' + kpi.nombre + '): la fórmula apunta a una fila sin KPI; no se analiza.');
      kpi.def = null;
    }
  });
  return { kpis, advertencias };
}

// Gives every KPI a uid that survives edits of the sheet. The id of a KPI is
// its row ('F9'): it is what formulas point at, and it changes when a row is
// inserted. The uid does not depend on the row or on the visible names:
// - a row read from the extract is its technical key (the extract column);
// - a derived row without a key is named after what it is made of
//   ('orders_food/orders', 'sum(a+b)'), so it follows its inputs;
// - a row with neither falls back to its label.
// The same key on a later row gets its order of appearance added ('~2'), so
// uids are unique without leaning on a name that can be edited.
// Anything kept between runs or handed to another program must use the uid.
function weeklyMotorIdentidades_(kpis) {
  const porId = {};
  kpis.forEach(kpi => { porId[kpi.id] = kpi; });
  const limpia = texto => String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const memo = {};
  const base = (kpi, profundidad) => {
    if (memo[kpi.id]) return memo[kpi.id];
    const def = kpi.def;
    const de = ref => (porId[ref] && profundidad < 6 ? base(porId[ref], profundidad + 1) : '?');
    let uid;
    if (kpi.clave !== '') uid = kpi.clave;
    else if (def && def.tipo === 'razon') uid = de(def.num) + '/' + de(def.den);
    else if (def && def.tipo === 'producto') uid = de(def.a) + '*' + de(def.b);
    else if (def && def.tipo === 'suma') uid = 'sum(' + def.partes.map(de).join('+') + ')';
    else uid = 'fila:' + limpia(kpi.etiqueta);
    memo[kpi.id] = uid;
    return uid;
  };
  const usados = {};
  kpis.forEach(kpi => {
    const raiz = base(kpi, 0);
    let uid = raiz;
    for (let n = 2; usados[uid]; n++) uid = raiz + '~' + n;
    usados[uid] = true;
    kpi.uid = uid;
  });
}

function weeklyMotorDefinicion_(formula, fila, clave) {
  const texto = formula.replace(/^=/, '').replace(/\$/g, '').replace(/\s+/g, ' ').trim();
  const sobre = /\)\s*\/\s*[A-Z]{1,3}(\d+)$/.exec(texto);
  if (/SUMIFS\(/i.test(texto)) {
    // Sheets returns formulas with "," or ";" as separator depending on the locale.
    // The key column is found by the caller, so any column letter is accepted
    // here: only the row has to be the KPI's own.
    if (!new RegExp('MATCH\\([A-Z]{1,3}' + fila + '\\s*[,;]', 'i').test(texto) || clave === '' || clave === 'FORMULA') return null;
    return sobre ? { tipo: 'campoSobre', campo: clave, den: 'F' + sobre[1] } : { tipo: 'campo', campo: clave };
  }
  let partes = /^[A-Z]{1,3}(\d+)\s*\/\s*[A-Z]{1,3}(\d+)$/.exec(texto);
  if (partes) return { tipo: 'razon', num: 'F' + partes[1], den: 'F' + partes[2] };
  partes = /^[A-Z]{1,3}(\d+)\s*\*\s*[A-Z]{1,3}(\d+)$/.exec(texto);
  if (partes) return { tipo: 'producto', a: 'F' + partes[1], b: 'F' + partes[2] };
  partes = /^SUM\([A-Z]{1,3}(\d+):[A-Z]{1,3}(\d+)\)$/i.exec(texto);
  if (partes) {
    const lista = [];
    for (let k = Number(partes[1]); k <= Number(partes[2]); k++) lista.push('F' + k);
    return { tipo: 'suma', partes: lista };
  }
  return null;
}

function weeklyMotorUnidad_(formulaVariacion, def) {
  const texto = String(formulaVariacion || '').replace(/\s+/g, '');
  if (/^=?\([A-Z$]+\d+-[A-Z$]+\d+\)\*100$/.test(texto)) return 'pp';
  if (/^=?[A-Z$]+\d+\/[A-Z$]+\d+-1$/.test(texto)) return 'rel';
  return def && def.tipo === 'razon' ? 'pp' : 'rel';
}
