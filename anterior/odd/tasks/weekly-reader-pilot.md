# Weekly structured reader pilot (LectorWeekly)

## Objective and authorized scope
Add a local, manually executed `LectorWeekly.gs` pilot reader with public
`leerWeeklyPorPais(pais)` and manual `probarLectorWeekly()`. It reuses the shared
configuration, typed cell classification and safe selector logic from the existing
diagnostic/experiment, reads exclusively the `WebApp` tab, temporarily writes only
`H4`, restores it in `finally` and releases the lock even on failure. No changes to
`Web.gs.txt`, `ReportePaises.gs.txt` or `Index.txt`. No BigQuery execution, frontend,
comparisons, alerts, executive summary, triggers, cache, persisted reports,
notifications, AI, or deployment. The previously working diagnosis and the selector
experiment must remain intact.

## Problem and approach
The pilot needs structured, traceable, serializable weekly data by country without
certifying completeness, country/data correspondence or recalculation. It must return
the capture obtained BEFORE restoring the selector, keep quality signals (duplicated /
non-Monday / ambiguous headers, expected last closed week), never merge repeated names,
never auto-label rows as KPI, and only mark a stable read as an unverified observation.
On timeout, unexpected selector, structure change or restore failure it must NOT return
data as usable.

## Tasks and acceptance
- [x] T1: Implement `LectorWeekly.gs` with `leerWeeklyPorPais(pais)` and
      `probarLectorWeekly()`; reuse shared config/helpers; one script lock; H4-only
      temporary write; `finally` restore + verify + release; validate country and keep
      deadline/read budget; versioned serializable schema; quality section; PILOT
      warnings. Do not modify originals or existing readers.
- [x] T2: Add `tests/LectorWeekly.test.cjs` covering: already-selected country (no
      write, stability observed); zero / empty / errorOrText / repeated names; duplicated
      dates and structure change between reads; timeout and unexpected selector; read /
      restore failure and lock release; returned values belong to the pre-restoration
      capture; static checks that only `WebApp` is read, no BigQuery, no persistence.
      Reconcile stale `Index.html` -> `Index.txt` reference in
      `tests/DiagnosticoSheets.test.cjs` (same SHA, verified). Run both suites.
- [x] T3: Add `LECTOR_WEEKLY.md` guide mirroring existing doc conventions; update local
      bitácora (`BITACORA.md`) with the USER-REPORTED selector evidence (Argentina ->
      Chile -> Argentina: two stable reads, no errors, selector restored; manual Chile
      sample matched) explicitly marked as operator-reported, not an OpenCode test;
      independent verification + parent readback; refresh Engram mirror.

## Constraints and checks
- Configuration: reuse `weeklyDiagnosticConfig_` as-is (document
  `1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk`, exact tab `WebApp`, selector `H4`,
  header row 8, name column G, C:F metadata, zone `America/Argentina/Buenos_Aires`,
  experiment lock/budget/deadline bounds). Do not mutate the frozen config; add
  reader-local constants only if needed.
- No nested locks: acquire exactly one script lock; never call `probarSelectorWebApp()`
  or any function that locks again. Release in a nested `try/finally` with separate
  release error even when restoration fails.
- Only write `H4`; set `possibleWrite` before write; restore literal original and verify
  selector after; on restore failure return an unusable result and require manual H4
  restoration.
- Return serializable data only: no `Date` objects in the returned payload, no full
  formulas (`hasFormula` only), no raw names beyond bounded logs.
- Country validation: formula-like literals rejected; literal validation or manual
  allowlist; blank/unconfigured test country fails clearly without writes.
- Response schema (versioned): estado, país solicitado, selector observado, inicio/fin
  de lectura + zona horaria + estado de restauración, documento/tab/coordenadas,
  semanas (fecha local, texto, celda), filas (nombre exacto, fila, metadatos C:F,
  observaciones por semana), observaciones (valor serializado, texto, formato, tipo,
  cero/vacío/errorOrText, coordenada), calidad, advertencias.
- Repeated names: keep separate rows with technical id `F{row}`; note id may change if
  rows are inserted. No KPI auto-label: `clasificacion: pendiente` when ambiguous.
  Unidad/interpretación/sentido favorable stay pending; format is only a hint.
- Quality: detect duplicated dates, non-Monday dates, ambiguous headers; never resolve
  duplicates by overwriting; compute last closed week with the configured zone;
  distinguish last weekly header from data availability; never turn missing/error into
  zero; `LATAM` identified separately and never summed with countries.
- Completitud / correspondencia país-datos / recálculo stay `no_verificada`; a stable
  read is an observation, not verification.
- TDD: not configured in this project; ordinary functional testing, not strict TDD.
  Runner: `node --test tests/*.test.cjs` (dependency-free synthetic harness).
- Verification: both suites pass locally; independent read-only source review; parent
  re-run of the exact commands.
- Apps Script execution/deployment: not authorized/performed in this session. Delivery
  status reports implemented / tested locally / NOT tested in Apps Script / NOT deployed.

## Delivery and progress
- Forecast: cohesive reader + tests + guide + docs, likely > 400 authored lines;
  advisory estimate, no coverage removal or artificial compression.
- Delivery strategy: ask-on-risk; no PR or push requested.
- Git: master branch has no commits and no remote; leave changes local and uncommitted.
- RDD: off (default); native risk assessment unavailable because files are untracked;
  independent functional verification is used, not a fabricated review approval.
- Rollback: remove `LectorWeekly.gs`, `tests/LectorWeekly.test.cjs`, `LECTOR_WEEKLY.md`,
  the `BITACORA.md` entry and revert the single `Index.html` -> `Index.txt` harness
  reference; originals remain unchanged.

## Corrections round (user review, 2026-09-20) — reopens part of the reader contract
User review of `LectorWeekly.gs` found defects that the reported tests did not catch.
New tasks revise the acceptance checks of the completed tasks; the diagnosis, selector
experiment, `Web.gs`, `Index` and the BigQuery backend remain untouched.
- [x] T4 (estabilidad): `datosUtilizables` must REQUIRE two consecutive equal captures.
      Spaced observations with the shared `pollIntervalMs`, `maxAttempts`, `deadlineMs`
      and read budget; exhaustion without stability -> `datosUtilizables:false` +
      explicit error (`LECTURA_SIN_ESTABILIDAD`), including for the already-selected
      country. Return the last stable capture, obtained before restoring H4. Stability
      never verifies recalculation or country/data correspondence.
- [x] T5 (fechas): use `cell.sheetDate` (document timezone, already produced by the
      diagnostic classifier) for header dates, week keys and duplicates; never
      reinterpret with `readTimezone`. Keep `America/Argentina/Buenos_Aires` ONLY for
      the expected last closed week. Expose the document timezone in the response.
- [x] T6 (LATAM): remove the `/latam/i` row-name inference. Classify the entity at the
      response level from the validated requested country: `LATAM` regional aggregate
      vs `pais`. Rows are indicators/pending classification; never sum entities.
- [x] T7 (disponibilidad): headers, earlier rows or generic text are NOT proof of
      weekly data availability. Separate header presence from the count of NUMERIC
      observations in candidate body rows (zero counted as observed number). Rename
      `semanasConDatos` to a name that does not over-promise. The count never certifies
      complete load or validated KPI. Keep every row in the inventory.
- [x] T8 (identificadores): technical ids include tab + row (e.g., `WebApp!F5`);
      document that the id may change if rows are inserted.
- [x] T9 (tests y documentación): regression scenarios below pass; `probarLectorWeekly`
      summary includes `datosUtilizables`, `estableObservada` and attempts; document
      `datosUtilizables` as fitness for PILOT INSPECTION only (never alerting or
      automatic conclusions); runtime stays local, no Apps Script execution/deployment.

Regression scenarios (synthetic, differentiated from live Apps Script runs):
1. Always-different captures -> `datosUtilizables:false`.
2. Different captures that later stabilize -> returns the last stable capture.
3. Already-selected country -> same waiting and stability control (no write).
4. Document zone different from Buenos Aires -> local date (sheetDate) preserved;
   last closed week still computed in Buenos Aires.
5. LATAM requested with indicator names without "LATAM" -> entity classified LATAM.
6. Country requested with an indicator whose name contains "LATAM" -> entity is country.
7. Headers present and empty body -> no data-availability claim.
8. Real numeric zero counted; empties never converted to zero.
9. Timeout/error/restore failure -> no usable lectura; restore attempted, lock released.

Rollback of this round: revert the reader/test/guide to the pre-correction state or
apply the round's corrections in reverse; originals and prior readers stay unchanged.

## User-reported evidence (bitácora entry, not an OpenCode test)
2026-09-20 (operator): selector experiment on the live spreadsheet — Argentina -> Chile
-> Argentina produced two stable reads, no errors, and the selector was restored; the
operator manually compared a Chile sample and it matched. This is operator-reported
evidence; it is not a guarantee of general recalculation or completeness and it was not
performed by OpenCode.

## Evidence and next step
- Exploration mapped shared config/helpers (single frozen `weeklyDiagnosticConfig_`;
  tab exact `WebApp`, H4, header 8, name G, C:F, zone America/Argentina/Buenos_Aires)
  and found the harness referenced `Index.html` while the repo holds `Index.txt` with
  the identical recorded SHA-256 (renamed file), making the previously documented
  24/66 green claims stale at 2 failing checksum tests.
- Writer (fresh context) implemented `LectorWeekly.gs` (450 lines), 27-test synthetic
  suite, `LECTOR_WEEKLY.md`, `BITACORA.md` entry, and the single `Index.html` ->
  `Index.txt` harness reference reconciliation. Reported 93/93 local pass; originals'
  SHA-256 unchanged.
- Independent read-only verifier (fresh context) reviewed all 16 contract requirements,
  the test coverage list, harness reconciliation, docs and original hashes: VERIFIED,
  no functional defects. Two LOW doc notes corrected by the orchestrator:
  `LECTOR_WEEKLY.md` suite arithmetic ("24 + 66" -> actual 24 + 42 existing + 27 new =
  93) and `DIAGNOSTICO_SHEETS.md` stale `Index.html` file name (now `Index.txt`, same
  hash).
- Parent readbacks: `node --test tests/*.test.cjs` -> 93 passed, 0 failed, 0 skipped
  (run twice, ~316 ms and ~617 ms); originals SHA-256 exactly
  `08133763EE.../121495A000.../97958BF348...`.
- RDD off (deciding source default); `gentle-ai review assess` unavailable because
  files are untracked (canonical inventory required). Independent functional
  verification used; no native review transaction, no approval.
- Apps Script execution and deployment: NOT performed/authorized in this session.
  Delivery: local only, uncommitted (repo has no commits/remote; commits not
  requested).
- Added: `LectorWeekly.gs`, `tests/LectorWeekly.test.cjs`, `LECTOR_WEEKLY.md`,
  `BITACORA.md`; modified: `tests/DiagnosticoSheets.test.cjs` (originals list),
  `DIAGNOSTICO_SHEETS.md` (file name), `LECTOR_WEEKLY.md` (test arithmetic).
- Skill resolution: registry at `.atl/skill-registry.md`; paths-injected
  `work-unit-commits` + `cognitive-doc-design` for the writer and the independent
  verifier.
- Task document mirrored and refreshed as Engram observation 17, topic
  `odd/weekly-reader-pilot/tasks`, project `herramientaweekly`.
- Corrections round (implementation writer, 2026-09-20): rewrote `LectorWeekly.gs`
  (stability-required `datosUtilizables` with a shared observed-state loop,
  `cell.sheetDate` everywhere, response-level `entidad` LATAM/pais classification,
  `semanasConObservacionesNumericas` availability count, `WebApp!F<row>` ids,
  schema `weekly-lectura/2`, `intentos` preserved on failure), extended the harness
  (sleep/zone/time advances, `changing`/`mutations`/`emptyBody`/`latamName`/`list`/
  `zone` knobs), adapted the 27 reader tests and added the 9 regression scenarios
  R1–R9. `node --test tests/*.test.cjs` -> 102 passed, 0 failed, 0 skipped
  (24 diagnostic + 42 selector + 36 reader), run twice; originals SHA-256 unchanged
  (`08133763EE.../121495A000.../97958BF348...`). `LECTOR_WEEKLY.md` updated
  (stability loop semantics, zone rules, entity classification, availability count,
  test arithmetic 93 -> 102).
- Independent verification (corrections round, 2026-09-20): read-only fresh-context
  verifier reviewed T4-T8 and R1-R9 against the contract with file+line evidence:
  T4 stability loop (`weeklyLecturaObservaEstable_`: spaced captures, shared
  deadline/budget, last-stable capture before restore, exhaustion ->
  `LECTURA_SIN_ESTABILIDAD`, `intentos` preserved on failure), T5 `cell.sheetDate`
  everywhere with Buenos Aires only for the expected closed week, T6 `entidad` at
  response level with zero `/latam/i`/`esLATAM` matches, T7
  `semanasConObservacionesNumericas` numeric-only count with header presence kept
  separate, T8 `WebApp!F{row}` ids, T9 probe summary fields + docs. Verdict:
  T4-T8 PASS, R1-R9 PASS, 102/102 observed in its own run, originals' SHA-256
  exact. ONE LOW documentation note: `LECTOR_WEEKLY.md` lacked the explicit
  `weekly-lectura/1` -> `weekly-lectura/2` delta table; fixed by the orchestrator
  (schema-version section added; suite re-run 102/102 after the fix).
- Parent readbacks (corrections round): `node --test tests/*.test.cjs` -> 102
  passed, 0 failed, 0 skipped, 0 todo (24 diagnostic + 42 selector + 36 reader),
  run by writer, verifier and parent; originals SHA-256 exactly
  `08133763EE.../121495A000.../97958BF348...`; `DiagnosticoSheets.gs` /
  `PruebaSelector.gs` untouched (no byte-level baseline exists in this commitless
  repo; content review + preexisting suites green).
- Corrections round CLOSED: T4-T9 all `[x]`. Delivery remains local, uncommitted,
  synthetic-tested; NOT tested in Apps Script, NOT deployed.
- Next: operator runs `probarLectorWeekly()` in the Apps Script debugger after
  configuring `experiment.testCountry`, confirming exclusive editing, exact live
  `WebApp` tab and recording the original H4 value; a `LECTURA_SIN_ESTABILIDAD`
  result on the live sheet must be treated as no usable data. Live Apps Script
  execution/deployment remain unauthorized/unperformed.
