// Minimal dependency-free .xlsx reader for local analysis of a downloaded copy
// of the Sheets. Reads the zip with node:zlib and parses only what the weekly
// analysis needs: sheet names, cell values and formulas (shared formulas are
// expanded so every cell carries its own text).

const fs = require('node:fs');
const zlib = require('node:zlib');

function abrirXlsx(ruta) {
  const buffer = fs.readFileSync(ruta);
  let fin = buffer.length - 22;
  while (fin >= 0 && buffer.readUInt32LE(fin) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error('XLSX_INVALIDO: no se encontró el directorio del zip.');
  const total = buffer.readUInt16LE(fin + 10);
  let cursor = buffer.readUInt32LE(fin + 16);
  const entradas = {};
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('XLSX_INVALIDO: directorio dañado.');
    const largoNombre = buffer.readUInt16LE(cursor + 28);
    const nombre = buffer.toString('utf8', cursor + 46, cursor + 46 + largoNombre);
    entradas[nombre] = { metodo: buffer.readUInt16LE(cursor + 10),
      comprimido: buffer.readUInt32LE(cursor + 20), local: buffer.readUInt32LE(cursor + 42) };
    cursor += 46 + largoNombre + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  const leer = nombre => {
    const entrada = entradas[nombre];
    if (!entrada) throw new Error('XLSX_INVALIDO: falta ' + nombre);
    const inicio = entrada.local + 30 + buffer.readUInt16LE(entrada.local + 26) +
      buffer.readUInt16LE(entrada.local + 28);
    const crudo = buffer.subarray(inicio, inicio + entrada.comprimido);
    return (entrada.metodo === 0 ? crudo : zlib.inflateRawSync(crudo)).toString('utf8');
  };
  const relaciones = {};
  for (const m of leer('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]);
    const destino = /Target="([^"]+)"/.exec(m[0]);
    if (id && destino) relaciones[id[1]] = destino[1].replace(/^\/?xl\//, '');
  }
  const hojas = {};
  for (const m of leer('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = /name="([^"]*)"/.exec(m[0]);
    const id = /r:id="([^"]+)"/.exec(m[0]);
    if (nombre && id) hojas[decodifica(nombre[1])] = 'xl/' + relaciones[id[1]];
  }
  let textos = null;
  const compartidos = () => {
    if (textos) return textos;
    textos = [];
    for (const m of leer('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      textos.push(decodifica([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
    }
    return textos;
  };
  return {
    nombres: Object.keys(hojas),
    hoja(nombre) {
      if (!hojas[nombre]) throw new Error('XLSX_SIN_HOJA: no existe la pestaña "' + nombre + '".');
      return leerHoja(leer(hojas[nombre]), compartidos());
    }
  };
}

// Returns { celdas: { A1: { valor, formula, error } }, filas, columnas }.
function leerHoja(xml, textos) {
  const celdas = {};
  const maestras = {};
  const pendientes = [];
  let filas = 0;
  let columnas = 0;
  for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const cuerpo = m[4];
    if (cuerpo === undefined) continue;
    const columna = m[1];
    const fila = Number(m[2]);
    const tipo = (/\bt="(\w+)"/.exec(m[3]) || [])[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo);
    const enLinea = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cuerpo);
    const f = /<f([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(cuerpo);
    const celda = { valor: null, formula: null, error: false };
    if (v) {
      const crudo = decodifica(v[1]);
      if (tipo === 's') celda.valor = textos[Number(crudo)];
      else if (tipo === 'b') celda.valor = crudo === '1';
      else if (tipo === 'e') { celda.valor = crudo; celda.error = true; }
      else if (tipo === 'str') celda.valor = crudo;
      else celda.valor = crudo !== '' && !isNaN(Number(crudo)) ? Number(crudo) : crudo;
    } else if (enLinea) {
      celda.valor = decodifica(enLinea[1]);
    }
    let compartida = false;
    if (f) {
      const indice = (/\bsi="(\d+)"/.exec(f[1]) || [])[1];
      if (f[2] !== undefined && f[2] !== '') {
        celda.formula = decodifica(f[2]);
        if (indice !== undefined) maestras[indice] = { columna: numeroDeColumna(columna), fila, texto: celda.formula };
      } else if (indice !== undefined) {
        compartida = true;
        pendientes.push({ celda, indice, columna: numeroDeColumna(columna), fila });
      }
    }
    if (celda.valor === null && celda.formula === null && !compartida) continue;
    celdas[columna + fila] = celda;
    filas = Math.max(filas, fila);
    columnas = Math.max(columnas, numeroDeColumna(columna));
  }
  pendientes.forEach(p => {
    const maestra = maestras[p.indice];
    if (maestra) p.celda.formula = desplaza(maestra.texto, p.fila - maestra.fila, p.columna - maestra.columna);
  });
  return { celdas, filas, columnas };
}

// Shifts the relative A1 references of a shared formula, leaving quoted text,
// sheet names and absolute ($) parts untouched.
function desplaza(formula, df, dc) {
  return formula.split(/("[^"]*"|'[^']*')/).map((trozo, i) => {
    if (i % 2) return trozo;
    return trozo.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (todo, absC, col, absF, fila, pos, texto) => {
      if (pos > 0 && /[A-Za-z_.]/.test(texto[pos - 1])) return todo;
      const nuevaCol = absC ? col : letraDeColumna(numeroDeColumna(col) + dc);
      const nuevaFila = absF ? fila : String(Number(fila) + df);
      return absC + nuevaCol + absF + nuevaFila;
    });
  }).join('');
}

function numeroDeColumna(letras) {
  let numero = 0;
  for (let i = 0; i < letras.length; i++) numero = numero * 26 + letras.charCodeAt(i) - 64;
  return numero;
}

function letraDeColumna(numero) {
  let letras = '';
  while (numero > 0) {
    letras = String.fromCharCode(65 + (numero - 1) % 26) + letras;
    numero = Math.floor((numero - 1) / 26);
  }
  return letras;
}

function decodifica(texto) {
  return texto.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function fechaDeSerial(serial) {
  return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);
}

module.exports = { abrirXlsx, desplaza, numeroDeColumna, letraDeColumna, fechaDeSerial };
