# Weekly control bitácora

Local chronological log of controlled selector/reading operations. Entries are only added here after they are executed; planned or inferred behavior is tracked in the task folders, not here.

## 2026-09-20 — Controlled selector experiment (operator-executed)

Operator-reported result, **not** produced by an automated test, this repository's TDD run, or any OpenCode-proposed operation:

> Argentina → Chile → Argentina: dos lecturas estables, sin errores y selector restaurado; el usuario contrastó manualmente una muestra de Chile y coincide.

Implications recorded by the operators:

- The observed sequence confirms the controlled write/restore flow preserved H4: original literal `Argentina`, single pilot write `Chile`, then restoration back to `Argentina` with a stable re-read.
- The manual sample comparison of Chile used separately authorized manual checks; it does not certify recalculation, country/data correspondence, or completeness of the weekly matrix.
- The subsequent local work unit (selector experiment, read-only diagnostic, weekly reader pilot) keeps this evidence as a user-referenced operational data point, not as a test assertion.

## 2026-09-21 — Weekly reader with additional columns (operator-executed)

Operator-reported result, **not** produced by an automated test, this repository's TDD run, or any OpenCode-proposed operation:

> Chile: lectura `ok` y estable en 2 intentos, 119 filas, 9 fechas semanales sin duplicados ni fechas que no sean lunes, selector restaurado a Argentina; los cuatro encabezados no-fecha son R8 `WoW`, S8 `vs. W-4`, T8 `vs. W-8` y V8 `Bench entre mercados`.

Implications recorded by the operators:

- The observed shape is what the v3 reader classifies: nine date-typed weekly headers for `semanas` and four recognized comparison/benchmark labels for `columnasAdicionales`. Classification is by normalized label, so R/S/T/V are observed coordinates of that run, never fixed positions.
- The two-attempt stability and the restored selector are operational data points from the operator's run. They do not certify recalculation, country/data correspondence or completeness of the weekly matrix, and every additional column carries `interpretacionValidada:false`.
- The header labels are the operator's literal cell text, including a possible line break inside `Bench entre mercados`; the reader preserves the original label and also exposes its normalized form.
- The local work unit that follows this evidence (schema `weekly-lectura/3`) keeps it as a user-referenced operational data point, not as a test assertion; the local suite uses a synthetic fixture that mirrors the reported layout.

## 2026-09-21 — Consultation frontend, option source and additional-block controls (local only)

Recorded by the operators, not produced by an automated test: the frontend, the option
source and the reader's additional-block controls were implemented locally and verified
locally with `node --test tests/*.test.cjs` (140 tests, all passing). There is **no**
entry above for this round because no operation was executed: no Apps Script run, no
deployment, no original execution and no live spreadsheet interaction.

- `Index.txt` (the file served by the existing `doGet()`) is now the Spanish
  consultation UI. It only calls `leerWeeklyPorPais(pais)` on demand and
  `obtenerOpcionesWeekly()` once at start.
- The previous BigQuery frontend is no longer in the repository; no commit exists in
  this repository, so the previous bytes are only recoverable from an operator's own
  copy. `CONSULTA_WEEKLY.md` records the old hash to verify that copy before restoring it.
- How to use, test, restrict and roll back the UI is documented in `CONSULTA_WEEKLY.md`.
  The reader's additional-block controls are documented in `LECTOR_WEEKLY.md`.

## 2026-09-21 — Frontend correction: cell detail and empty options (local only)

Recorded by the operators, not produced by an automated test: a bounded correction of the
consultation frontend was implemented and verified locally with
`node --test tests/*.test.cjs` (146 tests, all passing). Again there is **no** operational
entry, because nothing was executed: no Apps Script run, no deployment and no live
spreadsheet interaction.

- `Index.txt`: accepting a new reading now clears the cell detail, so a stale cell can
  never be read next to a new result. The detail repeats the entity of the result with its
  reading time (again identified as `Agregado regional` when `entidad.tipo` is `LATAM`, not
  as a country) plus the indicator, the period and the coordinate; after a failed query it
  survives marked `(resultado anterior)`.
- `OpcionesWeekly.gs`: an option that is empty or only whitespace is no longer offered,
  because the reader refuses it (`SELECTOR_COUNTRY_BLANK`) before taking the lock. Valid
  names are still offered exactly as configured.
- The pinned `Index.txt` hash in `tests/DiagnosticoSheets.test.cjs` was updated on purpose
  and is now `a79e2f5dd3115caa00bca2c0b3b17c15071fe3ac37a588ad7cdb487549aa5348`;
  `ReportePaises.gs.txt` and `Web.gs.txt` remain byte-identical.
- No backend, schema, destination or lock/restoration behavior changed. Deployment access
  and the sheet-content warning in `CONSULTA_WEEKLY.md` still apply unchanged.

## 2026-10-06 — New read-only source, engine, story page (local; partly operator-executed)

Recorded by the operators. Local verification: `node --test tests/*.test.cjs` (63 tests, all passing) and
`herramientas/analizar.cjs` / `herramientas/vista-previa.cjs` on downloaded `.xlsx` copies.

Operator-reported, **not** produced by an automated test: `probarAnalisisWeekly()` ran in the Apps Script project
(about 11.5 s, same result as the local run) and the first version of the `Resumen` page worked there. Everything
listed below as added later the same day has **not** been run in Apps Script.

- The web app no longer changes the country selector. `FuenteWeekly.gs` reads KPI definitions from
  `2) Weekly por pais` and values from `[Extract] Tabla Weekly`; it never writes. Decision confirmed by Juani.
- `MotorWeekly.gs` (data quality, performance, explanations), `ResumenWeekly.gs` (text and view model) and
  `RegistroWeekly.gs` (the only writer, tab `Weekly_Tool_Registro`; saving not yet run live).
- Added later, local only: the cross-check of engine values against the visible sheet for the selected market; the
  four-chapter story page after the Figma design; the block column of the sheet and the carousel of block leaders.
- Sheet copies analysed: `Weekly Performance Review.xlsx`, `(2)` and `(3)`. In `(3)` sections were renamed and two
  rows (42 `Trials QC`, 68 `VFD/GMV`) have no technical key or direction, so they are reported and not analysed.
- Added later, local only: the load-state gate (data not refreshed yet, refreshed without the week, a market loaded
  half way). Such a run is shown with its warning and never saved. The 80 % coverage threshold is a proposal.
- Added later, local only: a stable KPI `uid` (technical key, or the inputs of a derived row) used to recognise a
  finding from one week to the next. Between copies `(2)` and `(3)` 100 of the 124 common KPIs changed row and 76 changed label;
  all 124 kept their uid.
- Closing the web app for now, local only: `Web.gs` (the single `doGet`, serving `Resumen`), a loading state, the
  new / continuing tag on the short performance list, and a deployment guide with a live checklist in `README.md`.
- The earlier selector-based files, their tests and their documents moved to `anterior/` (146 tests, run with
  `node --test anterior/tests/*.test.cjs`); `tests/` holds the 63 tests of the current tool. Entries above this one
  name those files by their earlier paths at the repository root. Current state: `README.md`.
