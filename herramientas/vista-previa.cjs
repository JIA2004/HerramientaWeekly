// Local preview of the summary page with the data of a downloaded .xlsx copy.
// Serves Resumen.txt as-is plus a stand-in for google.script.run, so the page
// behaves like in Apps Script. Listens on localhost only.
//
//   node herramientas/vista-previa.cjs "<ruta al .xlsx>" [--puerto=8123] [--hoy=AAAA-MM-DD]

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { construirEntrada } = require('./analizar.cjs');

const raiz = path.resolve(__dirname, '..');
const argumentos = process.argv.slice(2);
const ruta = argumentos.find(a => !a.startsWith('--')) || process.env.WEEKLY_XLSX;
const puerto = Number((argumentos.find(a => a.startsWith('--puerto=')) || '').slice(9) || process.env.PORT || 8123);
const hoy = (argumentos.find(a => a.startsWith('--hoy=')) || '').slice(6) ||
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

if (!ruta) {
  console.error('Uso: node herramientas/vista-previa.cjs "<ruta al .xlsx>" [--puerto=8123]');
  process.exit(2);
}

function respuesta() {
  const armado = construirEntrada(ruta, hoy);
  const resultado = armado.motor.analizarWeekly(armado.entrada);
  const vista = armado.motor.vistaWeekly(resultado);
  armado.motor.weeklyRegistroCompara_(vista, null);
  return { schemaVersion: 'weekly-vista/2', estado: 'ok', error: null, procedencia: 'lectura', avisos: [],
    generadoIso: new Date().toISOString(),
    origen: { hojaKpis: '2) Weekly por pais', hojaDatos: 'copia local: ' + path.basename(ruta),
      ultimaActualizacionExtract: armado.fuente.ultimaActualizacion,
      ultimaActualizacionHora: armado.fuente.ultimaActualizacionHora, zonaHorariaDocumento: null,
      controlHoja: armado.motor.weeklyFuenteCoincidenciaTexto_(armado.coincidencia) },
    vista };
}

const sustituto = datos => `<script>
window.google = { script: { run: (function () {
  var exito = function () {}, falla = function () {};
  var api = {
    withSuccessHandler: function (f) { exito = f; return api; },
    withFailureHandler: function (f) { falla = f; return api; },
    obtenerVistaWeekly: function () { setTimeout(function () { exito(${datos}); }, 300); }
  };
  return api;
})() } };
</script>`;

http.createServer((peticion, salida) => {
  try {
    const datos = JSON.stringify(respuesta()).replace(/</g, '\\u003c');
    const pagina = fs.readFileSync(path.join(raiz, 'Resumen.txt'), 'utf8').replace('<script>', sustituto(datos) + '\n<script>');
    salida.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    salida.end(pagina);
  } catch (error) {
    salida.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    salida.end('No se pudo generar la vista previa: ' + error.message);
  }
}).listen(puerto, '127.0.0.1', () => console.log('Vista previa en http://localhost:' + puerto));
