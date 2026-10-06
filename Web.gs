// Web entry point of the Apps Script project: serves the weekly story page,
// the HTML file named "Resumen" (Resumen.txt in this repository). The page
// asks for its data through obtenerVistaWeekly() in RegistroWeekly.gs.
// A project can hold only one doGet: this one replaces any earlier one.
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Resumen')
    .setTitle('Weekly Performance Review')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
