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

## 2026-10-07 — Roadmap steps 1 to 3: KPI dictionary and reading validation (local only)

Recorded by the operators. Local verification: `node --test tests/*.test.cjs` (72 tests, all passing),
`node --test anterior/tests/*.test.cjs` (146, all passing) and the three tools run on the copy
`Weekly Performance Review.xlsx` downloaded that day. Nothing here was run in Apps Script.

- The copy has 131 KPI rows (126 in copy `(3)`). New rows without a technical key or a direction are reported and
  not analysed; four rows are out of the first version for that reason.
- `MotorWeekly.gs`: a row whose formula is the remainder of 100 % (`=100%-N71-N73`) is now read (`complemento`),
  with a missing share leaving it unknown. Its nine visible values match the sheet in this copy. This file has to be
  pasted again into Apps Script for the row to show up there.
- `herramientas/diccionario.cjs` (step 2, and the KPI scope of step 1): per row, stable uid, how it is obtained, unit,
  favourable direction, coverage and the description found in `Weekly_Glossary`. On this copy: 127 rows in the first
  version, 70 with a description, 18 whose key is looked up by a name that is repeated in the glossary, 4 whose name
  says millions while the values are in units.
- `herramientas/validar.cjs` (step 3): ten controls. On this copy nine pass; the tenth (visible sheet against the
  extract, selector on Argentina) reports 7 of 1143 values, all on one row that has a formula in only one of its nine
  weekly columns, so the sheet is blank where the extract has data. No extract cell held text or an error.
- Only one market per copy is compared against the visible sheet. The other fifteen are covered by recomputing every
  market and week with the rule of the sheet's formulas, not by looking at the sheet.
- The copy carries a `Weekly_Tool_Registro` tab with one saved run (week 2026-09-28): seen in the export, not
  operator-reported.
- Added the same day, local only: `diccionario.cjs` also writes `contexto-agente.md` / `.json`, the dictionary turned
  into context for a data agent that queries the weekly table: one entry per extract column, the calculated KPIs as
  formulas over column names, the reading rules and the visible names shared by several columns. It carries no
  figure. On this copy: 100 columns (43 without a definition in the glossary) and 19 calculated KPIs. Not tried with
  any agent.

## 2026-10-07 — Page redesign: three chapters, chart picked by the reader, data-to-review lists (local only)

Recorded by the operators. Local verification: `node --test tests/*.test.cjs` (74 tests, all passing),
`node --test anterior/tests/*.test.cjs` (146, all passing) and the page opened in the local preview on the copy
`Weekly Performance Review.xlsx` downloaded that day. Nothing here was run in Apps Script.

- The page follows the three mock-ups Juani sent. Chapter 1: headline, topline and "Lo que más se movió" with up to
  four KPIs of LATAM taken from both sides (`weeklyMotorAltosYBajos_`). Chapter 2: per country, the KPI that moved
  the most opens in the chart and the others are cards; picking a card swaps it with the charted one. Chapter 3: the
  closing summary. Below it, "Datos a revisar esta semana" and "Datos a revisar semana pasada" (the second read from
  the run saved in `Weekly_Tool_Registro`), plus the reading notes.
- Removed from the page: the carousel by section, the chapter "Qué mirar esta semana" and the full detail with
  filters. The engine no longer builds the section tour; all movements are still computed and saved.
- The page payload changed shape: `weekly-vista/3`, `vista.formato = 3`, `vista.revisar`, `historia.regional.movidas`
  and `kpis` per country. A run saved with the previous shape is read again instead of being served.
- Seen in the preview on that copy: four cards for LATAM, four KPIs for each of the 15 countries, 25 groups of data
  to review for the week. The previous-week list showed the "no saved run" notice, because the preview has no
  registry; with keys built by hand in a script it listed and tagged the groups.
- `MotorWeekly`, `ResumenWeekly`, `RegistroWeekly` and `Resumen` have to be pasted again together.
- The texts are still assembled by rule. An agent writing them is an idea, not designed or connected.

## 2026-10-09 — Segments per market and KPI names as written in the sheet (local only)

Recorded by the operators. Local verification: `node --test tests/*.test.cjs` (78 tests, all passing) and the page
opened in the local preview on the copy `Weekly Performance Review (2).xlsx` downloaded that day. Nothing here was
run in Apps Script.

- Asked by the team lead through Juani: the four KPIs that moved the most in a country can leave out more
  interesting ones, so chapter 2 now has one button per section of the sheet plus "Todo el país".
  `weeklyMotorPanorama_` adds `secciones` to every entity and `weeklyMotorDeSeccion_` picks up to four KPIs per
  section: the strongest moves against their own usual variation first, the KPI that opens the section always
  among them, then the other block leaders. KPIs a market does not operate are left out.
- Every KPI of a segment carries its own `dato` and `hipotesis`; the left side of the page tells about the KPI in
  the chart. A move inside the usual range gets only how it is built (parts or numerator and denominator), without
  the list of simultaneous moves.
- KPI names: the Spanish names by technical key (Órdenes, GMV confirmado, Clientes activos) were removed. Cards and
  sentences use the row's name in the sheet ("Orders - Total"), with its group when it has one ("Order Share › Food").
- Payload: `vista.formato = 4`; per country `segmentos` and `nota` replace `kpis` and `hipotesis`; chart data is
  compact (`grafico.valores` / `textos`, weeks once in `historia.semanasGrafico`). On that copy the saved run takes 12
  of the 20 cells the registry allows (it took 4 before).
- Seen in the preview on that copy: nine sections as buttons in the 15 countries, the count of moved KPIs next to each
  name, the segment kept when changing country, the card swap working inside a segment, no console errors and no
  horizontal scroll at phone width.
- The priority column Juani proposed for the sheet does not exist yet; nothing reads it.
- `MotorWeekly`, `ResumenWeekly` and `Resumen` have to be pasted again together.

## 2026-10-13 — AI-text gate (local only)

- Added `weeklyMotorCompuertaIa_` to `MotorWeekly.gs` (pure) and `probarCompuertaIaWeekly` to `FuenteWeekly.gs`. It blocks on provisional load findings, a degraded catalog, or zeros in bulk (`CEROS_EN_BLOQUE`: share of a market's read KPIs flagged `CERO_SOSPECHOSO`; thresholds `iaCeroPorMercado` 0.25 and `iaMercadosConCeroMax` 0 are unvalidated proposals).
- Tests: 7 gate tests in `MotorWeekly.test.cjs` and one for `probarCompuertaIaWeekly` in `FuenteWeekly.test.cjs`; `node --test tests/*.test.cjs` → 86 passing. Four deliberate breakages of the gate were each caught by a test.
- Fixed a test that depended on the real clock: `analizarWeeklyAhora` read the system date, so once Monday 2026-10-12 passed, the fixture's last week became the expected one and the "week absent" test failed (it was failing before this change, 77 of 78). The clock is now pinned in the test.
- Not run: Apps Script, triggers, Vertex AI. `probarCompuertaIaWeekly` has not been run live.

## 2026-10-13 — probarCompuertaIaWeekly in Apps Script (operator-reported)

Operator-reported, not produced by a local test: running `probarCompuertaIaWeekly` on the live sheet at 15:49 logged `{"puede":true,"semana":"2026-10-05","motivos":[]}`. A local run of the gate on the .xlsx copy downloaded afterwards gave the same result. The blocked case (week not loaded) has not been seen live.

## 2026-10-14 — LATAM topline chart (local only)

- Chapter 1 now charts the region's headline KPIs with the same chart as the markets. `weeklyResumenHistoria_` adds `grafico` to each `regional.topline` item; on the page the three topline cards are buttons and the chosen one (the first by default) is charted below them. The chart box code is shared with chapter 2 (`pintaCaja`).
- Payload: `vista.formato = 5`, so a run saved with format 4 is read again once.
- Tests: `node --test tests/*.test.cjs` → 86 passing (assertions added to existing tests). Seen in the preview on the 2026-10-09 copy: chart drawn, switching cards changes the KPI, the market chart still works, no console errors.
- Not run in Apps Script. `ResumenWeekly` and `Resumen` have to be pasted again together.
