# Weekly reader: separate additional comparison columns (schema v3)

## Objective and authorized scope
Extend `LectorWeekly.gs` (pilot reader) so `semanas` contains exclusively
date-typed weekly headers while the comparison/benchmark headers (WoW,
vs. W-4, vs. W-8, Bench entre mercados) and their per-row values are carried in
a new top-level `columnasAdicionales` plus per-row `fila.adicionales`. Unknown
non-date headers remain recorded as ambiguous, outside `semanas`. Preserve the
existing public functions, helpers, lock, restoration, deadlines, read budget,
selector logic and all constraints of the previous pilot round. Changes are
limited to the reader, strictly necessary helpers, tests and documentation; no
frontend, no calculations, no formula edits, no web deployment.

## Problem and approach
The current contract mixes date and non-date weekly headers into `semanas`
(non-date headers become `ambigua: true`), does not read the values of the
comparison columns, counts numeric observations for rows at or above the header
row, and loses the attempts counter when a capture inside the stability loop
fails. This round separates concerns:

- Classify non-date headers by a normalized label (strip accents, lowercase,
  collapse whitespace/newlines, strip periods) against a reader-local frozen
  known-label map; never fix R/S/T/V positions. Preserve original text and
  coordinate. Header labels never imply formula, unit, favorable direction or
  reference period: `interpretacionValidada: false`.
- Read and preserve, per row, the additional-column values (coordinate, value,
  displayed text, format, type, hasFormula) before restoring the selector, and
  include those cells in the stability comparison and the read budget.
- Keep `semanasConObservacionesNumericas` to rows strictly after `headerRow`;
  keep every named row in the inventory; an observed number never certifies a
  validated KPI or complete load.
- Define attempts as captures initiated inside the observation loop (excluding
  the pre-write baseline); retain the counter even on timeout, read error or
  structure change inside the loop. Any error still returns
  `datosUtilizables:false`.

Evidence from the operator (bitácora 2026-09-21): Chile read `ok`, stable in 2
attempts, 119 rows, 9 weekly dates without duplicates or non-Monday dates,
selector restored to Argentina, and the four non-date headers are R8 "WoW",
S8 "vs. W-4", T8 "vs. W-8", V8 "Bench entre mercados" (may contain line breaks).

## Tasks and acceptance
- [x] T1: Schema and headers. Bump `schemaVersion` to `weekly-lectura/3`; add
      top-level `columnasAdicionales`. `semanas` only date-typed headers; each
      additional column entry carries `indice`, `celda`, `columna`,
      `etiquetaOriginal`, `etiquetaNormalizada`, `clasificacion` and
      `interpretacionValidada:false`. Unknown non-date headers stay in
      `calidad.encabezadosAmbiguos`. No formula/unit/direction/period inference.
- [x] T2: Values. Snapshot reads the classified additional columns per named row
      (budgeted, before restoration) and folds them into the stability cells and
      `fila.adicionales` keyed by classification (coordinate-suffixed when the
      classification repeats). Zero, empty, text and errorOrText are preserved
      without conversions to zero; existing comparisons are never recalculated
      or substituted.
- [x] T3: Availability and attempts. `semanasConObservacionesNumericas` counts
      only rows `> headerRow`. Attempts = captures initiated in the observation
      loop; the counter survives timeout/read error/structure change inside the
      loop; errors keep `datosUtilizables:false`; restore and release still run.
- [x] T4: Tests. Update the synthetic harness fixture (9 weekly dates, four
      known additional labels including a line-break label, one unknown header)
      and add the required scenarios: 9 weeks + 4 additional columns; relocated
      additional columns yet classified by label; unknown header preserved as
      ambiguous; additional values captured before restoration and included in
      stability; numbers at/above headerRow with empty body produce zero numeric
      count; timeout after initiated captures keeps the counter, data unusable,
      restore attempted. Keep every existing reader/selector/diagnostic test
      green.
- [x] T5: `probarLectorWeekly()` summary includes the additional-column count.
      Update `LECTOR_WEEKLY.md` with the v2 -> v3 delta and add the bitácora
      entry with the operator-reported evidence. Refresh the Engram mirror.

## Progress and verification
- Implementation: done locally in `LectorWeekly.gs` (schema `weekly-lectura/3`,
  `columnasAdicionales`, `fila.adicionales`, availability restricted to rows
  after `headerRow`, attempt counter set once the capture is initiated) and in
  `tests/LectorWeekly.test.cjs` (fixture with nine weekly dates, four additional
  labels, one unknown non-date header, plus the six v3 scenarios).
- Local verification: `node --test tests/*.test.cjs` → 108 tests, 108 pass, 0
  fail (24 diagnostic + 42 selector + 42 reader). During the first run three
  failures were found and fixed: the feature document was missing its final
  newline; the attempt counter was incremented before the pre-capture spacing
  guard, so a capture aborted before starting was reported as an attempt; and
  the synthetic sheet reported fewer maximum columns than the relocated-layout
  fixture uses.
- Documentation: `LECTOR_WEEKLY.md` now documents v3 (deltas, new fields,
  additional-column reading and stability participation, availability scoping,
  attempt semantics) and `BITACORA.md` records the operator-reported evidence of
  2026-09-21.
- Evidence and limits: the Chile figures are operator-reported operational
  evidence as recorded in the bitácora; nothing was executed in Apps Script.
  Delivery status unchanged: implemented locally, tested locally, NOT tested in
  Apps Script, NOT deployed, no commits (repo still has no commits/remote).

## Constraints and checks
- Single tab read `WebApp`; single temporary write `H4`; keep lock, restore,
  deadline and read budget; no BigQuery / other tabs / external services; do not
  modify formulas, `Web.gs.txt` or `Index.txt`; no deployment or triggers.
- Reader-local frozen constants only (known-label map); `weeklyDiagnosticConfig_`
  stays untouched.
- All new private helpers keep the `weeklyLectura*_` naming pattern; public
  entries remain `leerWeeklyPorPais` and `probarLectorWeekly`.
- Normalization: LF, no BOM, final newline, no trailing whitespace.
- TDD: not configured in this project; ordinary functional verification, not
  strict TDD. Runner: `node --test tests/*.test.cjs`.
- Delivery status: implemented locally, tested locally, NOT tested in Apps
  Script, NOT deployed; commits not requested (repo has no commits/remote and
  the previous rounds left changes local and uncommitted).

## Tasks disabled by the runtime
Delegation of the exploration step to a sub-agent failed because this runtime
rejects Task launches ("OpenCode's free tier can only be used from within
OpenCode"). That is an environment/runtime limitation, not a Gentle AI or
repository defect; no defect report applies. Work is executed inline by the
orchestrator with the same bounded-read discipline.
