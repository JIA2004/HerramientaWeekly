// Weekly summary renderer. Turns the result of analizarWeekly() into Spanish
// Markdown text. Pure: no services. Every line shows the compared values so a
// reader can check the claim against the sheet.

function resumirWeekly(resultado, opciones) {
  const maximo = (opciones && opciones.maximoDestacados) || 15;
  const lineas = [];
  const agrega = texto => lineas.push(texto);
  agrega('# Resumen Weekly — semana del ' + resultado.semana);
  agrega('');
  agrega('Comparación principal: semana del ' + resultado.semana + ' contra la del ' +
    resultado.semanaAnterior + '. Historia disponible: ' + resultado.semanasDisponibles + ' semanas.');
  agrega('');
  const desfavorables = resultado.performance.filter(a => a.favorable === false).length;
  const favorables = resultado.performance.filter(a => a.favorable === true).length;
  agrega('- Alertas de calidad de datos: ' + resultado.calidad.length +
    ' (' + resultado.calidad.filter(h => h.severidad === 'alta').length + ' altas)');
  agrega('- Alertas de performance: ' + resultado.performance.length +
    ' (' + desfavorables + ' desfavorables, ' + favorables + ' favorables)');
  agrega('- KPIs analizados: ' + resultado.catalogo.analizados + ' de ' + resultado.catalogo.total + ' filas');
  agrega('');
  if (resultado.globales.length) {
    agrega('## Estado de la carga');
    agrega('');
    resultado.globales.forEach(g => agrega('- **' + g.regla + '**: ' + g.detalle));
    agrega('');
  }
  agrega('## Movimientos destacados');
  agrega('');
  if (!resultado.performance.length) agrega('Sin movimientos fuera de lo habitual.');
  resultado.performance.slice(0, maximo).forEach((alerta, i) => {
    agrega((i + 1) + '. ' + weeklyResumenAlerta_(alerta));
    weeklyResumenExplicaciones_(alerta).forEach(texto => agrega('   - ' + texto));
  });
  agrega('');
  agrega('## Datos a revisar');
  agrega('');
  const graves = resultado.calidad.filter(h => h.severidad !== 'baja');
  if (!graves.length) agrega('Sin hallazgos de calidad altos o medios.');
  weeklyResumenAgrupaCalidad_(graves).forEach(texto => agrega('- ' + texto));
  const bajas = resultado.calidad.length - graves.length;
  if (bajas) agrega('- Además hay ' + bajas + ' observaciones menores (huecos aislados, valores repetidos o KPIs que dependen de un dato observado).');
  agrega('');
  agrega('## Por mercado');
  agrega('');
  const entidades = {};
  resultado.performance.forEach(a => { (entidades[a.entidad] = entidades[a.entidad] || []).push(a); });
  Object.keys(entidades).sort().forEach(nombre => {
    agrega('### ' + nombre + (entidades[nombre][0].tipoEntidad === 'LATAM' ? ' (agregado regional)' : ''));
    agrega('');
    entidades[nombre].forEach(alerta => agrega('- ' + weeklyResumenAlerta_(alerta, true)));
    agrega('');
  });
  if (resultado.catalogo.advertencias.length) {
    agrega('## Advertencias del catálogo de KPIs');
    agrega('');
    resultado.catalogo.advertencias.forEach(texto => agrega('- ' + texto));
    agrega('');
  }
  agrega('## Límites de este análisis');
  agrega('');
  resultado.limites.forEach(texto => agrega('- ' + texto));
  agrega('- Una alerta de performance exige una variación de al menos ' +
    weeklyResumenDecimal_(resultado.parametros.zAlerta, 1) + ' veces la variabilidad semanal típica del KPI en ese mercado (últimas ' +
    resultado.parametros.semanasHistoria + ' semanas) y un piso de ' +
    weeklyResumenCambio_(resultado.parametros.pisoRelativo, 'rel').replace('+', '') + ' o ' +
    weeklyResumenCambio_(resultado.parametros.pisoPuntos, 'pp').replace('+', '') + '.');
  agrega('');
  return lineas.join('\n');
}

function weeklyResumenAlerta_(alerta, sinEntidad) {
  const signo = alerta.favorable === true ? 'favorable' : alerta.favorable === false ? 'desfavorable' : 'sin dirección definida';
  const medida = alerta.metodo === 'historico'
    ? weeklyResumenDecimal_(Math.abs(alerta.z), 1) + '× su variación típica'
    : 'umbral fijo: su historia no permite medir la variación típica';
  return (sinEntidad ? '' : '**' + alerta.entidad + '** — ') + alerta.kpi.etiqueta + ' ' + alerta.sentido + ' ' +
    weeklyResumenCambio_(alerta.cambio, alerta.unidad) + ' (' + weeklyResumenValor_(alerta.valorAnterior, alerta.unidad) +
    ' → ' + weeklyResumenValor_(alerta.valor, alerta.unidad) + '), ' + signo + ', ' + medida +
    '. Fila ' + alerta.kpi.fila + '.';
}

function weeklyResumenExplicaciones_(alerta) {
  const e = alerta.explicaciones;
  const textos = [];
  if (e.alcance.lectura === 'extendido') {
    textos.push('Alcance: también se movió en el mismo sentido en ' + e.alcance.otrosPaisesMismoSentido.length +
      ' de ' + e.alcance.otrosPaisesComparables + ' países (' + e.alcance.otrosPaisesMismoSentido.join(', ') +
      '). Sugiere un factor común o un cambio en la fuente.');
  } else if (e.alcance.lectura === 'parcial') {
    textos.push('Alcance: también en ' + e.alcance.otrosPaisesMismoSentido.join(', ') + '.');
  } else if (e.alcance.lectura === 'local') {
    textos.push('Alcance: ningún otro país muestra un movimiento comparable; parece propio de este mercado.');
  }
  if (e.partes) {
    textos.push('Composición del cambio: ' + e.partes.slice(0, 3).map(p =>
      p.kpi.etiqueta + ' aporta ' + (p.aporte * 100).toFixed(0) + ' %').join('; ') + '.');
  }
  if (e.componentes) {
    textos.push('Componentes: ' + e.componentes.map(c => c.rol + ' ' + c.kpi.etiqueta + ' ' +
      (c.cambio === null ? 'sin dato' : weeklyResumenCambio_(c.cambio, c.unidad))).join('; ') + '.');
  }
  if (e.movimientosSimultaneos.length) {
    textos.push('También se movieron en este mercado: ' + e.movimientosSimultaneos.map(m =>
      m.kpi.etiqueta + ' ' + weeklyResumenCambio_(m.cambio, m.unidad)).join('; ') + '. (Coincidencia, no causa demostrada.)');
  }
  if (e.anioAnterior && e.anioAnterior.patronSimilar) {
    textos.push('La misma semana del año anterior tuvo un movimiento parecido (' +
      weeklyResumenCambio_(e.anioAnterior.cambio, alerta.unidad) + '). Es una sola observación: no alcanza para hablar de estacionalidad.');
  }
  if (alerta.vsW4 !== null) {
    textos.push('Contexto: ' + weeklyResumenCambio_(alerta.vsW4, alerta.unidad) + ' vs. W-4' +
      (alerta.vsW8 !== null ? ', ' + weeklyResumenCambio_(alerta.vsW8, alerta.unidad) + ' vs. W-8' : '') +
      (alerta.vsAnioAnterior !== null ? ', ' + weeklyResumenCambio_(alerta.vsAnioAnterior, alerta.unidad) + ' vs. un año atrás' : '') + '.');
  }
  return textos;
}

function weeklyResumenAgrupaCalidad_(hallazgos) {
  const grupos = {};
  hallazgos.forEach(h => {
    const clave = h.regla + '|' + h.kpi.id;
    (grupos[clave] = grupos[clave] || { regla: h.regla, kpi: h.kpi, detalle: h.detalle, entidades: [] })
      .entidades.push(h.entidad);
  });
  return Object.keys(grupos).map(clave => grupos[clave])
    .sort((a, b) => b.entidades.length - a.entidades.length || a.kpi.fila - b.kpi.fila)
    .map(g => '**' + g.regla + '** — ' + g.kpi.etiqueta + ' (fila ' + g.kpi.fila +
      (g.kpi.clave ? ', `' + g.kpi.clave + '`' : '') + ') en ' +
      (g.entidades.length > 4 ? g.entidades.length + ' mercados' : g.entidades.join(', ')) +
      (g.entidades.length === 1 ? '. ' + g.detalle : '.'));
}

function weeklyResumenCambio_(cambio, unidad) {
  const signo = cambio > 0 ? '+' : cambio < 0 ? '−' : '';
  const magnitud = Math.abs(cambio) * 100;
  return signo + weeklyResumenDecimal_(magnitud, unidad === 'pp' ? 2 : 1) + (unidad === 'pp' ? ' pp' : ' %');
}

function weeklyResumenValor_(valor, unidad) {
  if (valor === null || valor === undefined) return 'sin dato';
  if (unidad === 'pp' && Math.abs(valor) <= 1.5) return weeklyResumenDecimal_(valor * 100, 2) + ' %';
  const absoluto = Math.abs(valor);
  if (Number.isInteger(valor)) return weeklyResumenDecimal_(valor, 0);
  return weeklyResumenDecimal_(valor, absoluto >= 1000 ? 0 : absoluto >= 10 ? 1 : 3);
}

// Spanish number format without depending on the runtime locale data.
function weeklyResumenDecimal_(numero, decimales) {
  const partes = Math.abs(numero).toFixed(decimales).split('.');
  const entero = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (numero < 0 ? '−' : '') + entero + (partes[1] ? ',' + partes[1] : '');
}

// ---- Display model for the web page -------------------------------------------
//
// vistaWeekly() turns the analysis into display-ready text so the page only
// renders: every number is already formatted and every explanation is already
// a sentence. The page never recalculates anything.

const weeklyResumenReglas_ = Object.freeze({
  FALTANTE_ULTIMA_SEMANA: 'Falta el dato de la última semana',
  CERO_SOSPECHOSO: 'Cero sospechoso',
  SIN_DATOS_EN_VENTANA: 'Sin datos en las últimas semanas',
  VALOR_NO_NUMERICO: 'Texto o error en lugar de un número',
  FUERA_DE_RANGO: 'Proporción fuera de 0–100 %',
  SERIE_INESTABLE: 'Serie inestable',
  SALTO_FUERA_DE_ESCALA: 'Salto fuera de escala',
  HUECOS_EN_VENTANA: 'Semanas faltantes en la ventana',
  VALOR_REPETIDO: 'Valor repetido',
  DEPENDE_DE_DATO_OBSERVADO: 'Depende de un dato observado',
  SEMANA_ESPERADA_AUSENTE: 'Falta la última semana cerrada',
  ACTUALIZACION_PENDIENTE: 'Los datos todavía no se actualizaron',
  CARGA_PARCIAL: 'La carga de la semana está incompleta',
  FILAS_DUPLICADAS: 'Filas repetidas en los datos',
  SEMANA_SALTEADA: 'Semana salteada',
  ENTIDAD_SIN_DATOS: 'Mercado sin datos'
});

function vistaWeekly(resultado) {
  const serie = (evidencia, unidad) => evidencia.map(punto => ({ semana: punto.semana,
    valor: typeof punto.valor === 'number' ? punto.valor : null,
    texto: weeklyResumenValor_(punto.valor, unidad) }));
  const movimientos = resultado.performance.map(alerta => ({
    entidad: alerta.entidad, esRegional: alerta.tipoEntidad === 'LATAM',
    kpi: alerta.kpi.etiqueta, fila: alerta.kpi.fila, clave: alerta.kpi.clave,
    sentido: alerta.sentido, favorable: alerta.favorable, severidad: alerta.severidad,
    cambio: weeklyResumenCambio_(alerta.cambio, alerta.unidad),
    de: weeklyResumenValor_(alerta.valorAnterior, alerta.unidad),
    a: weeklyResumenValor_(alerta.valor, alerta.unidad),
    medida: alerta.metodo === 'historico'
      ? weeklyResumenDecimal_(Math.abs(alerta.z), 1) + '× su variación típica'
      : 'umbral fijo: su historia no permite medir la variación típica',
    explicaciones: weeklyResumenExplicaciones_(alerta),
    serie: serie(alerta.evidencia, alerta.unidad)
  }));
  const calidad = resultado.calidad.map(hallazgo => ({
    entidad: hallazgo.entidad, esRegional: hallazgo.tipoEntidad === 'LATAM',
    regla: hallazgo.regla, titulo: weeklyResumenReglas_[hallazgo.regla] || hallazgo.regla,
    severidad: hallazgo.severidad, kpi: hallazgo.kpi.etiqueta, fila: hallazgo.kpi.fila,
    clave: hallazgo.kpi.clave, detalle: hallazgo.detalle,
    serie: serie(hallazgo.evidencia, hallazgo.unidad)
  }));
  const mercados = {};
  const cuenta = (nombre, esRegional, campo) => {
    const mercado = mercados[nombre] = mercados[nombre] || { nombre: nombre, esRegional: esRegional, movimientos: 0, calidad: 0 };
    mercado[campo]++;
  };
  movimientos.forEach(m => cuenta(m.entidad, m.esRegional, 'movimientos'));
  calidad.forEach(c => cuenta(c.entidad, c.esRegional, 'calidad'));
  const sinOperacion = {};
  resultado.noOpera.forEach(x => { (sinOperacion[x.entidad] = sinOperacion[x.entidad] || []).push(x.kpi.etiqueta); });
  const p = resultado.parametros;
  return {
    semana: resultado.semana, semanaAnterior: resultado.semanaAnterior,
    semanasDisponibles: resultado.semanasDisponibles,
    conteos: { movimientos: movimientos.length,
      desfavorables: movimientos.filter(m => m.favorable === false).length,
      favorables: movimientos.filter(m => m.favorable === true).length,
      calidad: calidad.length, calidadAltas: calidad.filter(c => c.severidad === 'alta').length,
      kpisAnalizados: resultado.catalogo.analizados, filasKpi: resultado.catalogo.total },
    estadoCarga: resultado.globales.map(g => ({ titulo: weeklyResumenReglas_[g.regla] || g.regla,
      detalle: g.detalle.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1'),
      provisoria: !!g.provisoria })),
    provisoria: !!resultado.provisoria,
    mercados: Object.keys(mercados).sort().map(nombre => mercados[nombre]),
    movimientos: movimientos, calidad: calidad,
    sinOperacion: Object.keys(sinOperacion).sort().map(nombre => ({ entidad: nombre, kpis: sinOperacion[nombre] })),
    advertencias: resultado.catalogo.advertencias,
    historia: weeklyResumenHistoria_(resultado),
    limites: resultado.limites.concat(['Una alerta de performance exige una variación de al menos ' +
      weeklyResumenDecimal_(p.zAlerta, 1) + ' veces la variabilidad semanal típica del KPI en ese mercado (últimas ' +
      p.semanasHistoria + ' semanas) y un piso de ' + weeklyResumenCambio_(p.pisoRelativo, 'rel').replace('+', '') +
      ' o ' + weeklyResumenCambio_(p.pisoPuntos, 'pp').replace('+', '') + '.'])
  };
}

// ---- Weekly story ---------------------------------------------------------------
//
// weeklyResumenHistoria_() arranges the same analysis as the four chapters of
// the weekly page: the region, one market at a time, what to look at and the
// closing summary. Every sentence is assembled by rule from computed values;
// nothing here interprets, and what the page labels as a possible cause is
// only what else moved in the same data.

const weeklyResumenNombres_ = Object.freeze({ orders: 'Órdenes', gmv_overall: 'GMV confirmado', active_customers: 'Clientes activos' });

// Short name of a KPI for a card: Spanish for the headline ones (by technical
// key), otherwise the row's own name in the sheet.
function weeklyResumenCorto_(kpi) {
  if (weeklyResumenNombres_[kpi.clave]) return weeklyResumenNombres_[kpi.clave];
  const partes = String(kpi.etiqueta).split(' › ');
  if (partes.length === 2 && partes[1] === 'Confirmed GMV') return weeklyResumenNombres_.gmv_overall;
  return partes.slice(partes.length > 2 ? -2 : -1).join(' › ');
}

// Large counts in millions or thousands so a card reads at a glance.
function weeklyResumenCompacto_(valor, unidad) {
  if (valor === null || valor === undefined) return 'sin dato';
  const absoluto = Math.abs(valor);
  if (unidad !== 'pp' && absoluto >= 1e6) return weeklyResumenDecimal_(valor / 1e6, 2) + ' M';
  if (unidad !== 'pp' && absoluto >= 1e4) return weeklyResumenDecimal_(valor / 1e3, 1) + ' mil';
  return weeklyResumenValor_(valor, unidad);
}

function weeklyResumenMedida_(alerta) {
  return alerta.metodo === 'historico'
    ? weeklyResumenDecimal_(Math.abs(alerta.z), 1) + '× su variación típica'
    : 'su historia no permite medir la variación típica';
}

function weeklyResumenTarjeta_(item) {
  return { nombre: weeklyResumenCorto_(item.kpi), contexto: item.kpi.etiqueta.split(' › ')[0], fila: item.kpi.fila,
    valor: weeklyResumenCompacto_(item.valor, item.unidad), anterior: weeklyResumenCompacto_(item.valorAnterior, item.unidad),
    cambio: item.cambio === null ? null : weeklyResumenCambio_(item.cambio, item.unidad),
    sentido: item.cambio === null || item.cambio === 0 ? 'igual' : item.cambio > 0 ? 'sube' : 'baja',
    favorable: item.favorable };
}

function weeklyResumenGrafico_(item) {
  const puntos = item.evidencia.map(punto => ({ semana: punto.semana,
    valor: typeof punto.valor === 'number' ? punto.valor : null, texto: weeklyResumenCompacto_(punto.valor, item.unidad) }));
  const previos = puntos.slice(0, -1).map(punto => punto.valor).filter(valor => valor !== null);
  const promedio = previos.length ? previos.reduce((suma, valor) => suma + valor, 0) / previos.length : null;
  return { nombre: weeklyResumenCorto_(item.kpi), contexto: item.kpi.etiqueta.split(' › ')[0], fila: item.kpi.fila,
    favorable: item.favorable, cambio: item.cambio === null ? null : weeklyResumenCambio_(item.cambio, item.unidad),
    serie: puntos, promedioPrevio: promedio, semanasPromedio: previos.length,
    promedioTexto: promedio === null ? null : weeklyResumenCompacto_(promedio, item.unidad) };
}

// One highlighted move: what the data shows, and what else moved with it.
function weeklyResumenDestacado_(alerta, esRegional) {
  const tarjeta = weeklyResumenTarjeta_(alerta);
  const alcance = alerta.explicaciones.alcance;
  let dato = 'Pasó de ' + tarjeta.anterior + ' a ' + tarjeta.valor + ': ' + weeklyResumenMedida_(alerta) + '.';
  if (alcance.otrosPaisesComparables > 0) {
    const fuertes = alcance.cambios.slice(0, 2).map(c => c.pais + ' (' + weeklyResumenCambio_(c.cambio, alerta.unidad) + ')');
    dato += alcance.otrosPaisesMismoSentido.length === 0
      ? (esRegional ? ' Ningún país muestra un movimiento comparable.' : ' Ningún otro país muestra un movimiento comparable.')
      : ' Se movió en el mismo sentido en ' + alcance.otrosPaisesMismoSentido.length + ' de ' + alcance.otrosPaisesComparables +
        (esRegional ? ' países' : ' otros países') + '. Los más fuertes: ' + fuertes.join(' y ') + '.';
  }
  // Short on purpose: how the KPI is built and the three strongest moves of
  // the same market. The full list stays in the detail of each movement.
  const relacionadas = weeklyResumenExplicaciones_(alerta).filter(texto => /^(Composición|Componentes)/.test(texto));
  const aLaVez = alerta.explicaciones.movimientosSimultaneos.slice(0, 3);
  if (aLaVez.length) {
    relacionadas.push('A la vez se movieron: ' + aLaVez.map(m => m.kpi.etiqueta + ' ' +
      weeklyResumenCambio_(m.cambio, m.unidad)).join('; ') + '. Es una coincidencia a revisar, no una causa demostrada.');
  }
  return Object.assign(tarjeta, { dato: dato, esAlerta: !!alerta.esAlerta,
    hipotesis: relacionadas.length ? relacionadas.join(' ')
      : 'Los datos disponibles no muestran otro KPI que se haya movido a la vez.' });
}

// One slide of the regional tour: a section of the sheet told through the
// KPIs that open each of its blocks, plus the strongest move outside them.
function weeklyResumenLamina_(seccion) {
  const tarjetas = seccion.lideres.map(item => {
    if (item.sinComparacion) {
      return Object.assign(weeklyResumenTarjeta_(item), { bloque: item.bloque, estado: 'sin_comparacion',
        dato: 'Esta semana no se puede comparar: el dato falta o está a revisar.', hipotesis: null });
    }
    const tarjeta = weeklyResumenDestacado_(item, true);
    tarjeta.bloque = item.bloque;
    tarjeta.estado = item.habitual ? 'habitual' : 'fuera';
    if (item.habitual) {
      tarjeta.dato = 'Pasó de ' + tarjeta.anterior + ' a ' + tarjeta.valor + ': dentro de su variación habitual.';
      tarjeta.hipotesis = null;
    }
    return tarjeta;
  });
  const fuera = tarjetas.filter(tarjeta => tarjeta.estado === 'fuera');
  let texto = fuera.length
    ? fuera.length + ' de ' + tarjetas.length + ' KPIs principales se salieron de lo habitual: ' +
      fuera.map(tarjeta => tarjeta.nombre + ' ' + tarjeta.cambio).join('; ') + '.'
    : (tarjetas.length === 1 ? 'El KPI principal se movió' : 'Los ' + tarjetas.length + ' KPIs principales se movieron') +
      ' dentro de lo habitual.';
  if (seccion.otro) {
    const otro = weeklyResumenTarjeta_(seccion.otro);
    texto += ' Fuera de los principales, lo que más se movió en la sección: ' + seccion.otro.kpi.etiqueta + ' ' + otro.cambio +
      ' (' + otro.anterior + ' → ' + otro.valor + ').';
  }
  return { seccion: seccion.seccion, texto: texto, fuera: fuera.length, tarjetas: tarjetas };
}

function weeklyResumenHistoria_(resultado) {
  const panorama = resultado.panorama || [];
  const paises = panorama.filter(e => e.tipoEntidad !== 'LATAM');
  const region = panorama.filter(e => e.tipoEntidad === 'LATAM')[0] || null;
  const alertasDe = nombre => resultado.performance.filter(a => a.entidad === nombre);
  const calidadAltaDe = nombre => resultado.calidad.filter(h => h.entidad === nombre && h.severidad === 'alta').length;
  const dePaises = resultado.performance.filter(a => a.tipoEntidad !== 'LATAM');
  const desfavorables = dePaises.filter(a => a.favorable === false).length;
  const favorables = dePaises.filter(a => a.favorable === true).length;
  const conAlertas = {};
  dePaises.forEach(a => { conAlertas[a.entidad] = (conAlertas[a.entidad] || 0) + 1; });
  const ordenes = entrada => entrada.topline.filter(item => item.kpi.clave === 'orders')[0] || null;

  // Region.
  let regional = null;
  let clausula = 'Semana del ' + resultado.semana;
  if (region) {
    const propias = ordenes(region);
    const cambio = propias ? propias.cambio : null;
    clausula = cambio === null ? 'LATAM, semana del ' + resultado.semana
      : cambio >= 0.01 ? 'LATAM creció en órdenes' : cambio <= -0.01 ? 'LATAM cayó en órdenes' : 'LATAM mantuvo sus órdenes';
    // Only a clear majority earns a second clause in the headline.
    const sesgo = desfavorables - favorables >= 3 ? ', con más movimientos en contra que a favor'
      : favorables - desfavorables >= 3 ? ', con más movimientos a favor que en contra' : '';
    const cifras = region.topline.filter(item => item.cambio !== null)
      .map(item => weeklyResumenCorto_(item.kpi) + ' ' + weeklyResumenCambio_(item.cambio, item.unidad));
    const recorrido = (region.recorrido || []).map(weeklyResumenLamina_);
    const agitadas = recorrido.filter(lamina => lamina.fuera > 0).map(lamina => lamina.seccion);
    const mayor = Object.keys(conAlertas).sort((a, b) => conAlertas[b] - conAlertas[a] || a.localeCompare(b))[0];
    regional = { nombre: region.entidad, titular: clausula + sesgo,
      texto: (cifras.length ? cifras.join(', ') + ' contra la semana anterior. ' : '') +
        (dePaises.length ? dePaises.length + ' movimientos fuera de lo habitual en ' + Object.keys(conAlertas).length + ' de ' +
          paises.length + ' países (' + desfavorables + ' desfavorables, ' + favorables + ' favorables). ' +
          mayor + ' es el mercado con más movimientos.' : 'Ningún país tuvo movimientos fuera de lo habitual.') +
        (agitadas.length ? ' En el agregado regional, los KPIs principales se salieron de lo habitual en ' + agitadas.join(', ') + '.' : ''),
      topline: region.topline.map(weeklyResumenTarjeta_), recorrido: recorrido };
  }

  // One market at a time.
  const fichas = paises.map(entrada => {
    const destacados = entrada.destacados.map(a => weeklyResumenDestacado_(a, false));
    const propias = ordenes(entrada);
    const principal = entrada.destacados[0] || propias || entrada.topline[0] || null;
    const tarjetas = [];
    const usadas = {};
    if (principal) usadas[principal.kpi.id] = true;
    const suma = item => {
      if (!item || usadas[item.kpi.id] || tarjetas.length >= 3) return;
      usadas[item.kpi.id] = true;
      tarjetas.push(weeklyResumenTarjeta_(item));
    };
    suma(propias);
    entrada.destacados.slice(1).forEach(suma);
    entrada.topline.forEach(suma);
    const altas = calidadAltaDe(entrada.entidad);
    const cargando = (resultado.cargaParcial || []).indexOf(entrada.entidad) !== -1;
    let texto = cargando
      ? 'La carga de esta semana está incompleta para ' + entrada.entidad + ': faltan datos que las semanas anteriores sí traían. '
      : propias && propias.cambio !== null
      ? 'Órdenes ' + weeklyResumenCambio_(propias.cambio, propias.unidad) + ' (' + weeklyResumenCompacto_(propias.valorAnterior, propias.unidad) +
        ' → ' + weeklyResumenCompacto_(propias.valor, propias.unidad) + '). '
      : 'Las órdenes de esta semana no se pueden comparar: el dato está a revisar. ';
    texto += cargando ? 'No se interpreta hasta que la carga termine.' : destacados.length
      ? 'Lo que más se movió: ' + destacados.map(d => d.contexto + ' › ' + d.nombre + ' ' + d.cambio +
        ' (' + d.anterior + ' → ' + d.valor + ')').join('; ') + '.'
      : 'Ningún KPI se movió fuera de lo habitual.';
    return { nombre: entrada.entidad, texto: texto,
      hipotesis: (destacados.length ? destacados[0].hipotesis : '') +
        (altas ? (destacados.length ? ' ' : '') + 'Hay ' + altas + ' dato(s) de ' + entrada.entidad +
          ' a revisar con prioridad alta: conviene verificar la carga antes de concluir.' : ''),
      grafico: principal ? weeklyResumenGrafico_(principal) : null, tarjetas: tarjetas,
      movimientos: alertasDe(entrada.entidad).length, calidadAltas: altas };
  });
  const peso = nombre => alertasDe(nombre).reduce((suma, a) => suma + a.score, 0);
  const inicial = fichas.slice().sort((a, b) => peso(b.nombre) - peso(a.nombre) || a.nombre.localeCompare(b.nombre))[0];

  // What to look at.
  const listaPerformance = resultado.performance.slice(0, 5).map(a => ({ entidad: a.entidad, esRegional: a.tipoEntidad === 'LATAM',
    titulo: a.kpi.etiqueta, fila: a.kpi.fila,
    detalle: weeklyResumenValor_(a.valorAnterior, a.unidad) + ' → ' + weeklyResumenValor_(a.valor, a.unidad) + ', ' + weeklyResumenMedida_(a) + '.',
    cambio: weeklyResumenCambio_(a.cambio, a.unidad), sentido: a.sentido, favorable: a.favorable }));
  const grupos = {};
  resultado.calidad.filter(h => h.severidad === 'alta').forEach(h => {
    const clave = h.regla + '|' + h.kpi.id;
    (grupos[clave] = grupos[clave] || { regla: h.regla, kpi: h.kpi, detalle: h.detalle, entidades: [] }).entidades.push(h.entidad);
  });
  const todos = Object.keys(grupos).map(clave => grupos[clave])
    .sort((a, b) => b.entidades.length - a.entidades.length || a.kpi.fila - b.kpi.fila);
  const listaCalidad = todos.slice(0, 5).map(g => ({
    entidad: g.entidades.length === 1 ? g.entidades[0] : g.entidades.length + ' mercados',
    titulo: g.kpi.etiqueta, fila: g.kpi.fila,
    detalle: (weeklyResumenReglas_[g.regla] || g.regla) + '. ' +
      (g.entidades.length === 1 ? g.detalle : g.entidades.slice(0, 6).join(', ') + (g.entidades.length > 6 ? ' y más' : '') + '.') }));

  // Closing summary.
  const conOrdenes = paises.map(entrada => ({ nombre: entrada.entidad, item: ordenes(entrada) }))
    .filter(par => par.item && par.item.cambio !== null);
  const bajan = conOrdenes.filter(par => par.item.cambio < 0).sort((a, b) => a.item.cambio - b.item.cambio);
  const suben = conOrdenes.filter(par => par.item.cambio > 0);
  const pasos = [];
  pasos.push({ titulo: 'Qué pasó', texto: (regional && regional.topline.length
      ? 'LATAM cerró la semana con ' + regional.topline.map(t => t.nombre + ' ' + t.valor +
        (t.cambio ? ' (' + t.cambio + ')' : '')).join(', ') + '. ' : '') +
    (conOrdenes.length ? suben.length + ' de ' + conOrdenes.length + ' países crecieron en órdenes' +
      (bajan.length ? '; retrocedieron ' + bajan.slice(0, 4).map(par => par.nombre + ' (' +
        weeklyResumenCambio_(par.item.cambio, par.item.unidad) + ')').join(', ') + (bajan.length > 4 ? ' y otros' : '') + '.' : '.') : '') });
  pasos.push({ titulo: 'Qué hay detrás', texto: resultado.performance.length
    ? 'Los movimientos más fuertes: ' + resultado.performance.slice(0, 3).map(a => a.entidad + ', ' + a.kpi.etiqueta + ' ' +
      weeklyResumenCambio_(a.cambio, a.unidad)).join('; ') + '. Lo que se movió a la vez es una pista para revisar, no una causa demostrada.'
    : 'Ningún KPI se movió fuera de su variación habitual.' });
  const mirar = resultado.performance.slice(0, 3).map(a => 'Si ' + a.kpi.etiqueta + ' de ' + a.entidad +
    ' vuelve a su rango habitual o sostiene el nuevo nivel.');
  if (todos.length) mirar.push('Si se corrigen los ' + todos.length + ' datos a revisar con prioridad alta.');
  pasos.push({ titulo: 'Qué mirar la semana que viene', lista: mirar.length ? mirar : ['Sin puntos abiertos.'] });

  return { regional: regional, paises: fichas, paisInicial: inicial ? inicial.nombre : null,
    performance: listaPerformance, totalPerformance: resultado.performance.length,
    calidad: listaCalidad, totalCalidad: todos.length,
    cierre: { titular: 'En resumen: ' + clausula, pasos: pasos } };
}
