# Controlled WebApp selector experiment

> **Superseded (2026-10-06).** This document describes the earlier reader, which wrote the country selector of a `WebApp` tab.
> That tab no longer exists and the web app no longer uses this code. Current state: `README.md`. Kept as history.

`probarSelectorWebApp()` is a manually operated, non-production experiment on the exact **WebApp tab**, not a web endpoint. It changes only H4, compares observations, and attempts to restore H4. Default configuration is inert: the test country is blank. Local synthetic tests are evidence about control flow, not live spreadsheet behavior. No Apps Script execution or deployment has been performed.

## Future manual use — requires separate authorization

1. Arrange exclusive editing for the entire execution. Record H4's original literal value outside the script for emergency recovery. Do not run originals, triggers, or another selector experiment concurrently.
2. In the intended Apps Script project, preserve existing files and add `DiagnosticoSheets.gs` and `PruebaSelector.gs`. Review spreadsheet scopes before consenting. No manifest is supplied, and these files do not narrow any existing project permissions. No web deployment is needed.
3. Confirm the document ID in `weeklyDiagnosticConfig_` and exact `tabName: 'WebApp'`. Do not point this experiment at the original tab. The safety check rejects any other tab or selector coordinates; it does not trim or perform fuzzy lookup.
4. Set `experiment.testCountry` to the exact different country. For range-based validation, manually copy the allowed country labels into `manualCountryAllowlist`. The experiment never reads the validation source, requests its range criteria values, or opens another sheet. No validation also requires this manual list. Literal validation must contain the requested exact label; a nonempty manual list is an additional restriction. Other validation types fail closed.
5. Set a debugger breakpoint on the experiment's final `return result;`, select **only `probarSelectorWebApp`**, and use **Debug**. Inspect `result`, especially `errors`, `restoration`, and `attempts[n].differences`. The Run button does not expose a returned object automatically. Do not log, persist, or publish the detailed cells. Debugger pauses can consume the deadline; avoid pausing while the selector is changed.
6. Check H4 manually afterward. Compare the returned coordinate-level before/after values, displays, formulas, and observations with the intended WebApp cells using separately authorized manual checks. Do not infer that a changed number belongs to the requested country. Reset `testCountry` to blank after the experiment.

## Defaults and bounds

All options live in the shared configuration; the experiment does not duplicate document or inventory coordinates.

| Option | Default | Accepted bounds / meaning |
|---|---:|---|
| `testCountry` | `''` | Blank/whitespace-only or equal to original: no writes. Exact matching otherwise; maximum 100 characters. |
| `manualCountryAllowlist` | `[]` | Exact manually copied labels; required for range validation or no rule. |
| `lockWaitMs` | 1,000 | 0–5,000 ms; script lock acquired before reading original H4. |
| `pollIntervalMs` | 1,000 | 100–5,000 ms; wait before each observation. |
| `deadlineMs` | 15,000 | 1,000–60,000 ms from entry; includes acquisition and baseline. |
| `maxAttempts` | 5 | 2–20; stops early after two consecutive equal observations. |
| `totalReadBudget` | 500,000 | 20–2,000,000 cell-field reads plus validation; cleanup reservation included. |

The read budget counts four fields per cell (`getValues`, displays, formats, formulas), plus one validation access. Metadata service calls such as dimensions are not cell-field reads. Full headers, C:G metadata and each candidate column through the last used row are read; all named rows (including early/header/repeated names and empty weekly values) and **all** typed-Date candidate columns are compared. The diagnostic's first-four sample setting does not apply here. Headers and named-row metadata participate in coordinate diffs too. Candidate dates remain candidates, not verified weekly columns.

Before writing, the current full snapshot cost times all configured attempts must fit the remaining budget, with a prewrite selector read and four cell-field reads reserved for restoration verification. This conservative plan can reject a sheet that would fit an early-stopping run. Changed dimensions/candidates are re-read and budgeted on every attempt. Exceeding budget fails the experiment rather than accepting a truncated or partially read comparison. Cleanup is attempted even after a deadline/budget failure. Service calls cannot be interrupted by these local deadline checks, so wall-clock completion is not guaranteed within the configured deadline.

## Interpret the result

| Result detail | Meaning |
|---|---|
| `original`, `requested` | Serialized original selector cell and requested literal. Formula selectors and unsafe formula-like prefixes are rejected before writes. |
| `attempts` | Relative start/duration in milliseconds, status, equality with the preceding observation, and coordinate `before`/`after` diffs against the baseline. No full matrix is logged or persisted. |
| `INCONCLUSIVE_UNCHANGED_BASELINE` | Observations equal the baseline. This could be old data, unchanged data, or another unknown condition. |
| `OBSERVED_STABILITY_UNVERIFIED` | Consecutive observations equal each other but differ from baseline. This is observed stability only, not a completion signal. |
| `OBSERVED_CHANGE_UNVERIFIED` | Changes observed without consecutive equality before the attempt limit. |
| `INVALIDATED_SELECTOR_CHANGED` | A selector guard saw an unexpected value or formula; earlier differences are not valid evidence. |
| `FAILED` / `FAILED_CLEANUP` | No successful experiment claim. Inspect separate primary, restoration and release error codes; raw service errors are not logged. Earlier observations may remain for diagnosis. |
| `SELECTOR_RESTORED_DATA_UNVERIFIED` | Original selector literal was written back and observed without a formula. Restored-data recalculation is still unverified. |

Typed values, displays, formats and formula metadata reuse the diagnostic helpers. Zero is not blank; formula-empty and no-formula empty remain distinct. Recognized error-like strings retain `errorOrText`, their marker and uncertainty; native `getValues()` does not reliably distinguish cell errors from text. Unsupported types fail safely. Restoration supports safe strings, finite numbers and booleans without string coercion; unsafe original literals are rejected before testing.

**Country correspondence, freshness, completeness, recalculation, restored-data recalculation and snapshot atomicity always remain unverified**, even after repeated equal observations. `SpreadsheetApp.flush()` applies pending edits only; it is not a refresh or recalculation barrier.

## Failure recovery and unavoidable races

- The script lock coordinates only cooperating executions in the same project. It cannot block humans or other script projects. Selector reads before/after baseline and polls, plus immediately before writing, cannot detect every intervening change, same-value rewrite, or change-and-revert. Reads of different fields are not atomic.
- Marking the write as possible **before** `setValue` covers calls that apply an edit and then fail. `finally` attempts restoration even when the primary operation fails and releases the lock even when restoration fails. Release errors are separate from primary/restoration errors.
- Restoration deliberately writes the original literal even after an unexpected selector observation. A concurrent editor's newer choice could therefore be overwritten. Exclusive editing is an operational prerequisite, not an enforceable guarantee.
- Forced cancellation, platform termination, or execution limits can skip `finally`. If execution is interrupted or restoration is not confirmed, manually restore the previously recorded H4 literal and inspect the sheet. Do not assume restored formulas/data have recalculated. Never restart blindly while another execution might remain active.
- Logs include only original/requested country (original summary bounded to 100 characters), status, attempt/duration/difference counts, restoration status and sanitized error codes. Treat country names as log-visible. Detailed cells stay in the in-memory returned result/debugger only.

## Local verification and rollback

```text
node --test tests/DiagnosticoSheets.test.cjs
node --test tests/*.test.cjs
```

The dependency-free synthetic harness evaluates only the diagnostic and experiment in `vm`. Strict API mocks cover lock/no-write paths, validation without source access, formula injection, uncertain writes, polling failures, selector interference, restoration/release failures, old-data stability, typed differences, fifth-date-column coverage, complete named rows, budgets, deadlines and attempts. Original files are only read as bytes for SHA-256 checks, never executed. Ordinary functional testing is used; no strict TDD workflow was configured. Independent verification and the parent's repeated check each passed all 66 tests. Final command results and failure/skip evidence are recorded in [the task](odd/tasks/webapp-selector-experiment.md).

This is one cohesive local work unit; it exceeds the advisory 400-line size to retain safety coverage and readability. No commits, remote access, deployment, original execution, BigQuery, frontend/AI work, triggers, SDD or review commands are included. Rollback removes `PruebaSelector.gs`, its test and this guide, removes only the experiment options, and reverts the authorized tab/config references if rolling back the entire work unit. Preserve the prior diagnostic and all original files; task tracking can be reverted separately.
