function probarSelectorWebApp() {
  const config = weeklyDiagnosticConfig_;
  const options = config.experiment;
  const started = Date.now();
  const result = {
    status: 'NOT_STARTED', original: null, requested: null, attempts: [],
    durationMs: 0, differentCells: 0, observedStability: false,
    restoration: { status: 'NOT_NEEDED', selector: null },
    errors: { primary: null, restoration: null, release: null },
    verification: { countryCorrespondence: 'unverified', freshness: 'unverified',
      completeness: 'unverified', recalculation: 'unverified',
      restoredDataRecalculation: 'unverified', atomicSnapshot: 'unverified' }
  };
  let lock;
  let acquired = false;
  let possibleWrite = false;
  let sheet;
  let zone;
  let original;
  const budget = { used: 0, limit: 0, reserve: 4 };
  try {
    weeklySelectorConfig_(config);
    result.requested = options.testCountry;
    budget.limit = options.totalReadBudget;
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(options.lockWaitMs);
    if (!acquired) throw new Error('SELECTOR_LOCK_UNAVAILABLE');
    const document = SpreadsheetApp.openById(config.documentId);
    sheet = document.getSheetByName(config.tabName);
    if (!sheet || sheet.getName() !== config.tabName) throw new Error('SELECTOR_DESTINATION');
    zone = document.getSpreadsheetTimeZone();
    original = weeklySelectorRead_(sheet, zone, budget);
    result.original = original;
    if (original.hasFormula) throw new Error('SELECTOR_INITIAL_FORMULA');
    if (!weeklySelectorLiteral_(original.value)) throw new Error('SELECTOR_UNSAFE_ORIGINAL');
    if (options.testCountry.trim() === '' || options.testCountry === original.value) {
      result.status = 'SKIPPED_NO_CHANGE';
    } else {
      if (!weeklySelectorLiteral_(options.testCountry)) throw new Error('SELECTOR_UNSAFE_COUNTRY');
      weeklySelectorValidation_(sheet, options, budget);
      const deadline = started + options.deadlineMs;
      const baseline = weeklySelectorSnapshot_(sheet, zone, budget, original.value, deadline);
      // Reserve a complete worst-case plan for the current dimensions, not a truncated sample.
      weeklySelectorBudget_(budget, baseline.readCost * options.maxAttempts + 4, false);
      weeklySelectorDeadline_(deadline);
      weeklySelectorExpect_(weeklySelectorRead_(sheet, zone, budget), original.value);
      possibleWrite = true; // setValue may apply the edit and then throw.
      sheet.getRange(config.selector).setValue(options.testCountry);
      SpreadsheetApp.flush(); // Applies pending edits; it is not a recalculation barrier.
      let previous = null;
      for (let index = 0; index < options.maxAttempts; index++) {
        const attempt = { number: index + 1, startedMs: Date.now() - started,
          durationMs: 0, status: 'STARTED', differences: [], sameAsPrevious: false };
        result.attempts.push(attempt);
        try {
          weeklySelectorDeadline_(deadline, options.pollIntervalMs);
          Utilities.sleep(options.pollIntervalMs);
          const snapshot = weeklySelectorSnapshot_(sheet, zone, budget, options.testCountry, deadline);
          attempt.differences = weeklySelectorDiff_(baseline.cells, snapshot.cells);
          attempt.sameAsPrevious = previous !== null &&
            weeklySelectorDiff_(previous.cells, snapshot.cells).length === 0;
          attempt.status = 'OBSERVED_UNVERIFIED';
          result.differentCells = attempt.differences.length;
          result.observedStability = attempt.sameAsPrevious;
          previous = snapshot;
        } catch (error) {
          attempt.status = weeklySelectorError_(error);
          throw error;
        } finally {
          attempt.durationMs = Date.now() - started - attempt.startedMs;
        }
        if (attempt.sameAsPrevious) break;
      }
      result.status = result.differentCells === 0 ? 'INCONCLUSIVE_UNCHANGED_BASELINE' :
        result.observedStability ? 'OBSERVED_STABILITY_UNVERIFIED' : 'OBSERVED_CHANGE_UNVERIFIED';
    }
  } catch (error) {
    result.errors.primary = weeklySelectorError_(error);
    result.status = result.errors.primary === 'SELECTOR_UNEXPECTED' ?
      'INVALIDATED_SELECTOR_CHANGED' : 'FAILED';
  } finally {
    if (possibleWrite) {
      result.restoration.status = 'ATTEMPTED';
      try {
        if (!original || original.hasFormula || !weeklySelectorLiteral_(original.value)) {
          throw new Error('SELECTOR_UNSAFE_ORIGINAL');
        }
        sheet.getRange(config.selector).setValue(original.value);
        SpreadsheetApp.flush();
        budget.reserve = 0; // Cleanup has its own four reserved cell-field reads.
        result.restoration.selector = weeklySelectorRead_(sheet, zone, budget);
        weeklySelectorExpect_(result.restoration.selector, original.value);
        result.restoration.status = 'SELECTOR_RESTORED_DATA_UNVERIFIED';
      } catch (error) {
        result.errors.restoration = weeklySelectorError_(error);
        result.restoration.status = 'FAILED_MANUAL_RESTORATION_REQUIRED';
      }
    }
    if (acquired) {
      try {
        lock.releaseLock();
      } catch (error) {
        result.errors.release = weeklySelectorError_(error);
      }
    }
  }
  if (result.errors.restoration || result.errors.release) result.status = 'FAILED_CLEANUP';
  result.durationMs = Date.now() - started;
  result.readBudget = { used: budget.used, limit: budget.limit, unit: 'cell-field reads plus validation' };
  console.log(JSON.stringify({ original: original ? String(original.value).slice(0, 100) : null, requested: result.requested,
    status: result.status, attempts: result.attempts.length, durationMs: result.durationMs,
    differentCells: result.differentCells, restoration: result.restoration.status,
    errors: result.errors }));
  // Set a debugger breakpoint here; inspect result without logging its cell details.
  return result;
}

function weeklySelectorConfig_(config) {
  const options = config.experiment;
  // Deliberate safety invariants, not a second configurable destination.
  if (config.tabName !== 'WebApp' || config.selector !== 'H4' ||
      config.selectorRow !== 4 || config.selectorColumn !== 8) throw new Error('SELECTOR_DESTINATION');
  const limits = { lockWaitMs: [0, 5000], pollIntervalMs: [100, 5000],
    deadlineMs: [1000, 60000], maxAttempts: [2, 20], totalReadBudget: [20, 2000000] };
  if (!options || typeof options.testCountry !== 'string' || options.testCountry.length > 100 ||
      !Array.isArray(options.manualCountryAllowlist) ||
      !options.manualCountryAllowlist.every(value => typeof value === 'string' &&
        value.trim() !== '' && weeklySelectorLiteral_(value)) ||
      !Object.keys(limits).every(key => Number.isSafeInteger(options[key]) &&
        options[key] >= limits[key][0] && options[key] <= limits[key][1])) {
    throw new Error('SELECTOR_CONFIG');
  }
}

function weeklySelectorLiteral_(value) {
  // Reject formula-like prefixes and leading apostrophes rather than transform input.
  return typeof value === 'string' ? value.length <= 100 && !/^[\s\u0000-\u001f]*[=+\-@']/.test(value) :
    typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function weeklySelectorBudget_(budget, cost, consume) {
  if (!Number.isSafeInteger(cost) || cost < 0 || budget.used + cost + budget.reserve > budget.limit) {
    throw new Error('SELECTOR_READ_BUDGET');
  }
  if (consume) budget.used += cost;
}

function weeklySelectorBatch_(sheet, row, column, height, width, zone, budget) {
  weeklySelectorBudget_(budget, height * width * 4, true);
  return weeklyDiagnosticBatch_(sheet, row, column, height, width, zone, []);
}

function weeklySelectorRead_(sheet, zone, budget) {
  const config = weeklyDiagnosticConfig_;
  return weeklySelectorBatch_(sheet, config.selectorRow, config.selectorColumn, 1, 1, zone, budget)[0][0];
}

function weeklySelectorExpect_(cell, expected) {
  if (cell.hasFormula || cell.value !== expected) throw new Error('SELECTOR_UNEXPECTED');
}

function weeklySelectorValidation_(sheet, options, budget) {
  weeklySelectorBudget_(budget, 1, true);
  const rule = sheet.getRange(weeklyDiagnosticConfig_.selector).getDataValidation();
  const type = rule ? String(rule.getCriteriaType()) : 'NONE';
  let allowed;
  if (type === 'VALUE_IN_LIST') {
    allowed = rule.getCriteriaValues()[0];
    if (!Array.isArray(allowed) || !allowed.every(value => typeof value === 'string')) {
      throw new Error('SELECTOR_VALIDATION');
    }
  } else if (type === 'VALUE_IN_RANGE' || type === 'NONE') {
    // Do not request range criteria values: even reference metadata is out of scope here.
    allowed = options.manualCountryAllowlist;
  } else {
    throw new Error('SELECTOR_VALIDATION');
  }
  if (!allowed.includes(options.testCountry) ||
      (options.manualCountryAllowlist.length && !options.manualCountryAllowlist.includes(options.testCountry))) {
    throw new Error('SELECTOR_COUNTRY_NOT_ALLOWED');
  }
}

function weeklySelectorDeadline_(deadline, extraMs) {
  if (Date.now() + (extraMs || 0) >= deadline) throw new Error('SELECTOR_DEADLINE');
}

function weeklySelectorSnapshot_(sheet, zone, budget, expected, deadline) {
  const config = weeklyDiagnosticConfig_;
  const initialCost = budget.used;
  weeklySelectorDeadline_(deadline);
  weeklySelectorExpect_(weeklySelectorRead_(sheet, zone, budget), expected);
  const rows = sheet.getLastRow();
  const columns = sheet.getLastColumn();
  if (![rows, columns].every(Number.isSafeInteger) || rows < config.headerRow ||
      columns < config.nameColumn || rows > sheet.getMaxRows() || columns > sheet.getMaxColumns()) {
    throw new Error('SELECTOR_STRUCTURE');
  }
  const width = config.nameColumn - config.metadataStartColumn + 1;
  weeklySelectorBudget_(budget, (columns + rows * width) * 4 + 4, false);
  const headers = weeklySelectorBatch_(sheet, config.headerRow, 1, 1, columns, zone, budget)[0];
  const candidates = headers.filter(cell => cell.type === 'date');
  if (!candidates.length) throw new Error('SELECTOR_NO_CANDIDATES');
  weeklySelectorBudget_(budget, rows * (width + candidates.length) * 4 + 4, false);
  const metadata = weeklySelectorBatch_(sheet, 1, config.metadataStartColumn, rows, width, zone, budget);
  const named = metadata.map((cells, index) => ({ row: index + 1, cells: cells }))
    .filter(entry => entry.cells[width - 1].value !== '' || entry.cells[width - 1].display !== '');
  if (!named.length) throw new Error('SELECTOR_NO_NAMED_ROWS');
  const cells = {};
  headers.forEach(cell => { cells[cell.a1] = cell; });
  named.forEach(entry => entry.cells.forEach(cell => { cells[cell.a1] = cell; }));
  headers.forEach((header, index) => {
    if (header.type !== 'date') return;
    weeklySelectorDeadline_(deadline);
    const values = weeklySelectorBatch_(sheet, 1, index + 1, rows, 1, zone, budget);
    named.forEach(entry => { const cell = values[entry.row - 1][0]; cells[cell.a1] = cell; });
  });
  weeklySelectorExpect_(weeklySelectorRead_(sheet, zone, budget), expected);
  weeklySelectorDeadline_(deadline);
  return { cells: cells, readCost: budget.used - initialCost };
}

function weeklySelectorDiff_(before, after) {
  const coordinates = Array.from(new Set(Object.keys(before).concat(Object.keys(after))));
  return coordinates.filter(a1 => JSON.stringify(before[a1]) !== JSON.stringify(after[a1]))
    .map(a1 => ({ a1: a1, before: before[a1] || null, after: after[a1] || null }));
}

function weeklySelectorError_(error) {
  const message = error && error.message;
  return typeof message === 'string' && /^SELECTOR_[A-Z_]+$/.test(message) ? message : 'SELECTOR_SERVICE_ERROR';
}
