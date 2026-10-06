# Read-only Weekly Sheets diagnostic

`DiagnosticoSheets.gs` adds only `diagnosticarWeeklySheets()`. It observes the configured document and exact tab `WebApp`; it does not fix or execute the received application. Local synthetic verification passed; live Apps Script execution is **untested** and deployment is **none**. The shared configuration also contains inert options for the separate [controlled selector experiment](PRUEBA_SELECTOR.md); this diagnostic remains read-only and samples only its original first four candidate columns.

## Manual editor use — only after separate authorization

1. In the intended Apps Script editor, add a script file named `DiagnosticoSheets` and copy only the new `.gs` contents. Preserve the existing files. No deployment is needed.
2. Review authorization scopes before consenting. Native spreadsheet access may request broad spreadsheet scopes even though this function only reads. Existing BigQuery code can retain project-level scopes; this file does not remove them or narrow the project's permissions.
3. Select **only `diagnosticarWeeklySheets`**. Set a breakpoint on its final `return result;`, then use **Debug** to inspect `result`. The ordinary Run button does not automatically expose a function's returned object. Do not log the detailed result or run the old functions.

These are future manual instructions, not operations performed or authorized by this local implementation task.

## What the result means

| Detail | Interpretation |
|---|---|
| `status`, `valid` | Unchanged H4 yields `OBSERVED_UNVERIFIED` and `null`, never `true`. Observed changes yield invalidated status and `false`. |
| Selector | H4 raw serialized value, display, format, formula and validation before/after. Literal validation lists are returned; range validation is a reference only. Referenced sheet name/id metadata may be read, never its contents. |
| Dates | Typed Date headers only are candidates. ISO values preserve instants; `sheetDate` uses the document timezone. Duplicate dates use that calendar date, not UTC. Text and numeric headers remain ambiguous. |
| Rows | Every nonempty G value/display from row 1 through the last used row, including early/header rows, repeated names and empty weekly samples. C:F metadata and cell coordinates are preserved. No name deduplication. |
| Samples | First four actual typed Date candidate columns; not the full weekly matrix. Raw value, display, number format and formula are retained. Formats do not establish units. |
| Read boundaries | Used and allocated dimensions plus content/validation read ranges are reported. Estimated read cells above 100,000 cause a structure error, not a truncated inventory. |

**Cell errors cannot be confirmed in this scope.** Native `getValues()` returns primitives without a typed error discriminator. A real `#N/A` error, literal `#N/A` text, and a formula returning `"#N/A"` cannot be reliably distinguished here. Recognized tokens are `errorOrText`, with their original marker and explicit uncertainty, never confirmed errors. The token recognizer is not an exhaustive error detector; other strings remain text. Blank and error-like values are never converted to zero. Formula-empty and no-formula empty observations are separate metadata, not a claim about cell history.

Completeness, freshness, country correspondence, recalculation and atomic snapshot consistency are always **unverified**. Equal selector observations do not prove recalculation or exclude an intervening change. Metadata and values are separate service reads. Unknown cell types or malformed structures fail safely; service errors are sanitized and raw error data is not logged. Only a fixed four-field count/status summary is logged.

## Local verification

```text
node --test tests/DiagnosticoSheets.test.cjs
```

Observed: **24 tests passed, 0 failed**, dependency-free `node:test` with synthetic allowlisted service proxies. The harness evaluates only the new `.gs` in `vm`; originals are read solely as bytes for SHA-256. Checks cover access boundaries, range-reference-only validation, selector changes, timezone dates, error/text uncertainty, bounds, serialization, failures, static prohibited API checks and bounded logging. Ordinary testing was used; no configured strict TDD runner existed in the received snapshot. Parent and independent verifier reruns each passed 24/24; independent source/access inspection found no additional defects. This does not establish live Apps Script compatibility or typed cell-error identity.

Original hashes captured before diagnostic source edits and verified unchanged afterward:

| File | SHA-256 |
|---|---|
| `ReportePaises.gs.txt` | `121495a000e0f80f6e144153d2db7ef2ccea7cbc2df6de7e9c073d70bef00d9a` |
| `Web.gs.txt` | `08133763ee1f221877553f8edb14733ef2aa4ef9931583dab2e9b1d50cfe87f4` |
| `Index.txt` (renombrado de `Index.html`, mismo hash) | `97958bf348802da7812dba94644eb27735cbeee487c9c9ef25b8104bd0dc6c67` |

## Existing snapshot and delivery limits

Static inspection confirms that `consultarOrdenesPorPais()` queries BigQuery, while the frontend invokes nonexistent `probarBigQuery()` and expects a single-country response unlike the backend envelope. These discrepancies remain unchanged. No manifest/config/test runner or Git repository was supplied. No original code execution, spreadsheet access, credentials, upload, deployment, triggers, Git initialization or commits occurred.

Review the reader, then the synthetic harness and this guide. This is one cohesive local work unit; the advisory 400-line review budget is exceeded to preserve coverage and readable code. No PR was requested. Rollback removes the new diagnostic, harness and guide; task tracking can be removed separately without altering originals. Task evidence: `odd/tasks/weekly-sheets-diagnostic.md`.
