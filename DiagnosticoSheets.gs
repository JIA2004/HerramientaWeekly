const weeklyDiagnosticConfig_ = Object.freeze({
  documentId: '1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk',
  tabName: 'WebApp',
  selector: 'H4',
  selectorRow: 4,
  selectorColumn: 8,
  headerRow: 8,
  nameColumn: 7,
  metadataStartColumn: 3,
  readTimezone: 'America/Argentina/Buenos_Aires',
  sampleColumns: 4,
  maxReadCells: 100000,
  experiment: Object.freeze({
    testCountry: '',
    manualCountryAllowlist: Object.freeze([]),
    lockWaitMs: 1000,
    pollIntervalMs: 1000,
    deadlineMs: 15000,
    maxAttempts: 5,
    totalReadBudget: 500000
  })
});

function diagnosticarWeeklySheets() {
  const config = weeklyDiagnosticConfig_;
  const started = new Date();
  let document;
  let sheet;
  try {
    document = SpreadsheetApp.openById(config.documentId);
    sheet = document.getSheetByName(config.tabName);
  } catch (error) {
    throw new Error('WEEKLY_ACCESS: Unable to open the configured document/tab.');
  }
  if (!sheet) throw new Error('WEEKLY_MISSING_TAB: Exact configured tab was not found.');

  let result;
  try {
    result = weeklyDiagnosticRead_(document, sheet, started);
  } catch (error) {
    // Never propagate service errors that might include cell contents.
    if (error && /^WEEKLY_STRUCTURE:/.test(error.message)) throw error;
    throw new Error('WEEKLY_READ: Unable to read authorized sheet metadata or values.');
  }
  console.log(JSON.stringify({
    status: result.status,
    namedRows: result.rows.length,
    candidateColumns: result.headers.dateCandidates.length,
    sampledColumns: result.sampleColumns.length
  }));
  // Set a debugger breakpoint here to inspect result without logging details.
  return result;
}

function weeklyDiagnosticRead_(document, sheet, started) {
  const config = weeklyDiagnosticConfig_;
  const zone = document.getSpreadsheetTimeZone();
  const used = { rows: sheet.getLastRow(), columns: sheet.getLastColumn() };
  const allocated = { rows: sheet.getMaxRows(), columns: sheet.getMaxColumns() };
  if (![used.rows, used.columns, allocated.rows, allocated.columns].every(Number.isSafeInteger) ||
      used.rows < config.headerRow || used.columns < config.nameColumn ||
      allocated.rows < Math.max(config.selectorRow, used.rows) ||
      allocated.columns < Math.max(config.selectorColumn, used.columns)) {
    throw new Error('WEEKLY_STRUCTURE: Missing header/name coordinates or inconsistent dimensions.');
  }
  const metadataWidth = config.nameColumn - config.metadataStartColumn + 1;
  const upperBound = used.columns + used.rows * (metadataWidth + config.sampleColumns) + 2;
  if (upperBound > config.maxReadCells) {
    throw new Error('WEEKLY_STRUCTURE: Read size exceeds configured cell budget; inventory not truncated.');
  }
  const ranges = [];
  const before = weeklyDiagnosticSelector_(sheet, zone, ranges);
  const header = weeklyDiagnosticBatch_(sheet, config.headerRow, 1, 1, used.columns, zone, ranges)[0];
  const dateCandidates = [];
  const ambiguous = [];
  const dates = {};
  header.forEach((cell, index) => {
    if (cell.type === 'date') {
      const candidate = { column: index + 1, cell: cell };
      dateCandidates.push(candidate);
      const key = cell.sheetDate;
      if (!dates[key]) dates[key] = [];
      dates[key].push(cell.a1);
    } else if (cell.value !== '' || cell.display !== '' || cell.hasFormula) {
      ambiguous.push({ column: index + 1, cell: cell, reason: 'Not a typed Date; no date interpretation attempted.' });
    }
  });
  const metadata = weeklyDiagnosticBatch_(sheet, 1, config.metadataStartColumn,
    used.rows, metadataWidth, zone, ranges);
  const selected = dateCandidates.slice(0, config.sampleColumns);
  const samples = selected.map(candidate => weeklyDiagnosticBatch_(sheet, 1,
    candidate.column, used.rows, 1, zone, ranges));
  const rows = [];
  metadata.forEach((cells, index) => {
    const name = cells[metadataWidth - 1];
    // Include earlier rows and the header row; never deduplicate names.
    if (name.value === '' && name.display === '') return;
    rows.push({ row: index + 1, name: name, metadata: cells.slice(0, metadataWidth - 1),
      samples: samples.map(column => column[index][0]) });
  });
  const after = weeklyDiagnosticSelector_(sheet, zone, ranges);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  return {
    status: changed ? 'INVALIDATED_SELECTOR_CHANGED' : 'OBSERVED_UNVERIFIED',
    valid: changed ? false : null,
    timestamp: started.toISOString(),
    readLocalTimestamp: Utilities.formatDate(started, config.readTimezone, "yyyy-MM-dd'T'HH:mm:ssZ"),
    readTimezone: config.readTimezone,
    documentTimezone: zone,
    tab: { name: config.tabName, id: sheet.getSheetId() },
    dimensions: { used: used, allocated: allocated },
    readRanges: ranges,
    selector: { before: before, after: after, changed: changed },
    verification: { completeness: 'unverified', freshness: 'unverified',
      countryCorrespondence: 'unverified', recalculation: 'unverified', atomicSnapshot: 'unverified' },
    limitations: [
      'Native getValues has no typed error discriminator: error-like strings, including formula-produced strings, are errorOrText, never confirmed errors.',
      'Unchanged selector observations do not prove recalculation or exclude intervening edits; reads are not atomic.',
      'Date headers are candidates, not confirmed weekly columns. Number formats do not establish units.',
      'Only the first configured Date candidate columns are sampled; completeness is unverified.'
    ],
    headers: { dateCandidates: dateCandidates, ambiguous: ambiguous,
      duplicateDates: Object.keys(dates).filter(key => dates[key].length > 1)
        .map(key => ({ sheetDate: key, coordinates: dates[key] })) },
    sampleColumns: selected.map(candidate => candidate.column),
    rows: rows
  };
}

function weeklyDiagnosticSelector_(sheet, zone, ranges) {
  const config = weeklyDiagnosticConfig_;
  const cell = weeklyDiagnosticBatch_(sheet, config.selectorRow, config.selectorColumn, 1, 1, zone, ranges)[0][0];
  const rule = sheet.getRange(weeklyDiagnosticConfig_.selector).getDataValidation();
  ranges[ranges.length - 1].fields.push('dataValidation');
  let validation = { type: 'NONE' };
  if (rule) {
    const type = String(rule.getCriteriaType());
    validation = { type: type };
    if (type === 'VALUE_IN_LIST') {
      const values = rule.getCriteriaValues()[0];
      if (!Array.isArray(values) || !values.every(value => typeof value === 'string')) {
        throw new Error('WEEKLY_STRUCTURE: Unexpected validation literal list.');
      }
      validation.literalList = values.slice();
    } else if (type === 'VALUE_IN_RANGE') {
      const reference = rule.getCriteriaValues()[0];
      // Reference identity only: never read contents or open the referenced tab.
      const referencedSheet = reference.getSheet();
      validation.reference = { a1: reference.getA1Notation(),
        sheetName: referencedSheet.getName(), sheetId: referencedSheet.getSheetId(), contentsRead: false };
    }
  }
  return { cell: cell, validation: validation };
}

function weeklyDiagnosticBatch_(sheet, row, column, height, width, zone, ranges) {
  const range = sheet.getRange(row, column, height, width);
  const a1 = weeklyDiagnosticA1_(row, column) + ':' + weeklyDiagnosticA1_(row + height - 1, column + width - 1);
  ranges.push({ a1: a1, rows: height, columns: width,
    fields: ['values', 'displayValues', 'numberFormats', 'formulas'] });
  const matrices = [range.getValues(), range.getDisplayValues(), range.getNumberFormats(), range.getFormulas()];
  if (!matrices.every(matrix => Array.isArray(matrix) && matrix.length === height &&
      matrix.every(cells => Array.isArray(cells) && cells.length === width))) {
    throw new Error('WEEKLY_STRUCTURE: Unexpected read matrix dimensions.');
  }
  return matrices[0].map((cells, r) => cells.map((value, c) => {
    const display = matrices[1][r][c];
    const format = matrices[2][r][c];
    const formula = matrices[3][r][c];
    if (![display, format, formula].every(item => typeof item === 'string')) {
      throw new Error('WEEKLY_STRUCTURE: Unexpected cell metadata type.');
    }
    return weeklyDiagnosticCell_(value, display, format, formula, weeklyDiagnosticA1_(row + r, column + c), zone);
  }));
}

function weeklyDiagnosticCell_(value, display, format, formula, a1, zone) {
  const cell = { a1: a1, value: value, display: display, numberFormat: format,
    formula: formula, hasFormula: formula !== '', type: typeof value };
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('WEEKLY_STRUCTURE: Invalid Date value.');
    cell.type = 'date';
    cell.value = value.toISOString();
    cell.sheetDate = Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    cell.observation = value === 0 ? 'zero' : 'number';
  } else if (typeof value === 'string') {
    const marker = /^(#N\/A|#REF!|#DIV\/0!|#VALUE!|#NAME\?|#NUM!|#NULL!|#ERROR!|#SPILL!|#CALC!|#GETTING_DATA)$/i.test(value);
    cell.observation = value === '' ? 'empty' : marker ? 'errorOrText' : 'text';
    if (value === '') cell.emptyKind = formula === '' ? 'physicalEmptyObservation' : 'formulaEmpty';
    if (marker) {
      cell.errorMarker = value;
      cell.errorConfirmed = false;
      cell.uncertainty = 'A literal, formula-returned text, and a cell error are indistinguishable through getValues.';
    }
  } else if (typeof value !== 'boolean') {
    throw new Error('WEEKLY_STRUCTURE: Unsupported cell value type; no coercion performed.');
  }
  return cell;
}

function weeklyDiagnosticA1_(row, column) {
  let letters = '';
  while (column > 0) {
    column--;
    letters = String.fromCharCode(65 + column % 26) + letters;
    column = Math.floor(column / 26);
  }
  return letters + row;
}
