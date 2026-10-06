// Local runner: analyses a downloaded .xlsx copy of the Sheets with the same
// source builders and the same engine the Apps Script project uses. Nothing
// leaves the machine.
//
//   node herramientas/analizar.cjs "<ruta al .xlsx>" [--hoy=AAAA-MM-DD]
//
// The copy is turned into the plain 2D arrays Apps Script would return
// (getValues / getFormulas) and handed to weeklyFuenteEntrada_ in
// FuenteWeekly.gs. Output goes to salidas/ (ignored by git: company data).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { abrirXlsx, numeroDeColumna, letraDeColumna } = require('./xlsx.cjs');

const raiz = path.resolve(__dirname, '..');
const HOJA_LATAM = 'Weekly LATAM';

function cargarMotor() {
  const contexto = vm.createContext({});
  ['MotorWeekly.gs', 'ResumenWeekly.gs', 'FuenteWeekly.gs', 'RegistroWeekly.gs'].forEach(nombre => {
    vm.runInContext(fs.readFileSync(path.join(raiz, nombre), 'utf8'), contexto, { filename: nombre });
  });
  return contexto;
}

// Same shape as Range.getValues() / Range.getFormulas(): blank cells are '',
// formulas carry their leading '='. Date cells stay as day serials.
function matrices(hoja) {
  const valores = [];
  const formulas = [];
  for (let fila = 1; fila <= hoja.filas; fila++) {
    const filaValores = new Array(hoja.columnas).fill('');
    const filaFormulas = new Array(hoja.columnas).fill('');
    valores.push(filaValores);
    formulas.push(filaFormulas);
  }
  Object.keys(hoja.celdas).forEach(a1 => {
    const partes = /^([A-Z]+)(\d+)$/.exec(a1);
    const celda = hoja.celdas[a1];
    const f = Number(partes[2]) - 1;
    const c = numeroDeColumna(partes[1]) - 1;
    if (celda.valor !== null) valores[f][c] = celda.valor;
    if (celda.formula) formulas[f][c] = '=' + celda.formula.replace(/^=/, '');
  });
  return { valores, formulas };
}

// Structural audit of the visible sheet: the LATAM columns must point at the
// row of the same KPI in "Weekly LATAM".
function auditarReferenciasLatam(hojaKpis, hojaLatam, lectura) {
  const hallazgos = [];
  const columnaNombre = letraDeColumna(lectura.columnaNombre);
  // Every text cell of the row's left block (technical key, visible name).
  const textosLatam = fila => {
    const textos = [];
    for (let col = 1; col <= 6; col++) {
      const celda = hojaLatam.celdas[letraDeColumna(col) + fila];
      if (celda && typeof celda.valor === 'string' && celda.valor.trim() !== '') textos.push(celda.valor.replace(/\s+/g, ' ').trim());
    }
    return textos;
  };
  Object.keys(hojaKpis.celdas).forEach(a1 => {
    const celda = hojaKpis.celdas[a1];
    const ref = celda.formula && /^'?Weekly LATAM'?!\$?([A-Z]+)\$?(\d+)$/.exec(celda.formula.replace(/^=/, ''));
    if (!ref) return;
    const fila = Number(a1.replace(/\D/g, ''));
    const propio = hojaKpis.celdas[columnaNombre + fila];
    const nombre = propio ? String(propio.valor).replace(/\s+/g, ' ').trim() : '';
    const destino = textosLatam(Number(ref[2]));
    if (nombre !== '' && destino.indexOf(nombre) === -1) {
      hallazgos.push({ celda: a1, fila, kpi: nombre, apuntaA: 'Weekly LATAM!' + ref[1] + ref[2],
        kpiDestino: destino.length ? destino[destino.length - 1] : '' });
    }
  });
  return hallazgos.sort((a, b) => a.fila - b.fila || numeroDeColumna(a.celda.replace(/\d/g, '')) - numeroDeColumna(b.celda.replace(/\d/g, '')));
}

function construirEntrada(ruta, hoyIso) {
  const libro = abrirXlsx(ruta);
  const motor = cargarMotor();
  const config = motor.weeklyFuenteConfig_ || vm.runInContext('weeklyFuenteConfig_', motor);
  const hojaKpis = libro.hoja(config.hojaKpis);
  const kpis = matrices(hojaKpis);
  const datos = matrices(libro.hoja(libro.nombres.indexOf(config.hojaDatos) !== -1 ? config.hojaDatos : config.hojaDatosEnCopia));
  const aIso = valor => motor.weeklyFuenteFecha_(valor, fecha => fecha.toISOString().slice(0, 10));
  const armado = motor.weeklyFuenteEntrada_(kpis.valores, kpis.formulas, datos.valores, aIso, hoyIso);
  const referencias = libro.nombres.indexOf(HOJA_LATAM) === -1 ? []
    : auditarReferenciasLatam(hojaKpis, libro.hoja(HOJA_LATAM), armado.lectura);
  return { motor, lectura: armado.lectura, fuente: armado.fuente, referencias, entrada: armado.entrada,
    coincidencia: armado.coincidencia };
}

function principal(argumentos) {
  const ruta = argumentos.find(a => !a.startsWith('--'));
  if (!ruta) {
    console.error('Uso: node herramientas/analizar.cjs "<ruta al .xlsx>" [--hoy=AAAA-MM-DD]');
    process.exit(2);
  }
  const hoy = (argumentos.find(a => a.startsWith('--hoy=')) || '').slice(6) ||
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const armado = construirEntrada(ruta, hoy);
  const resultado = armado.motor.analizarWeekly(armado.entrada);
  let texto = armado.motor.resumirWeekly(resultado);
  if (armado.referencias.length) {
    const porFila = {};
    armado.referencias.forEach(r => { (porFila[r.fila] = porFila[r.fila] || { r, celdas: [] }).celdas.push(r.celda); });
    texto += '\n## Referencias a LATAM que apuntan a otro KPI\n\n' + Object.keys(porFila).map(fila =>
      '- Fila ' + fila + ' (' + porFila[fila].r.kpi + '): `' + porFila[fila].celdas.join('`, `') + '` leen la fila ' +
      porFila[fila].r.apuntaA.replace(/^.*?(\d+)$/, '$1') + ' de Weekly LATAM (' + (porFila[fila].r.kpiDestino || 'vacío') + ').').join('\n') + '\n';
  }
  if (armado.fuente.filasDuplicadas) {
    texto += '\n> Atención: ' + armado.fuente.filasDuplicadas + ' combinaciones país/semana aparecen más de una vez en el extract.\n';
  }
  const salidas = path.join(raiz, 'salidas');
  fs.mkdirSync(salidas, { recursive: true });
  const base = path.join(salidas, 'weekly-' + resultado.semana);
  fs.writeFileSync(base + '.md', texto);
  fs.writeFileSync(base + '.json', JSON.stringify({ resultado, referenciasLatam: armado.referencias,
    semanasHoja: armado.lectura.semanasHoja, ultimaActualizacionExtract: armado.fuente.ultimaActualizacion }, null, 1));
  console.log('Semana analizada: ' + resultado.semana + ' (esperada: ' + armado.entrada.semanaEsperada + ')');
  console.log('Mercados: ' + armado.entrada.entidades.length + ' | KPIs analizados: ' + resultado.catalogo.analizados +
    ' | calidad: ' + resultado.calidad.length + ' | performance: ' + resultado.performance.length +
    ' | sin operación: ' + resultado.noOpera.length);
  console.log('Control contra la hoja: ' + armado.motor.weeklyFuenteCoincidenciaTexto_(armado.coincidencia));
  armado.coincidencia.muestras.forEach(m => console.log('  fila ' + m.fila + ' | ' + m.kpi + ' | ' + m.semana +
    ' | hoja: ' + m.hoja + ' | extract: ' + m.extract));
  console.log('Resumen: ' + path.relative(raiz, base + '.md'));
}

if (require.main === module) principal(process.argv.slice(2));

module.exports = { construirEntrada, cargarMotor, matrices };
