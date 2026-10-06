# Controlled Weekly structured reader pilot

> **Superseded (2026-10-06).** This document describes the earlier reader, which wrote the country selector of a `WebApp` tab.
> That tab no longer exists and the web app no longer uses this code. Current state: `README.md`. Kept as history.

`LectorWeekly.gs` adds `leerWeeklyPorPais(pais)` (manual pilot reading) and `probarLectorWeekly()` (manual driver). It reuses the shared configuration and the safe selector/diagnostic helpers. It reads only the exact **WebApp tab**, temporarily writes only H4, restores it in `finally` and releases the script lock even on failure. The returned envelope is versioned and serializable; it never certifies completeness, country/data correspondence or recalculation. Schema v3 keeps `semanas` for date-typed weekly headers only and carries comparison/benchmark headers, classified by normalized label, in `columnasAdicionales` with their per-row values in `fila.adicionales`. Because those additional reads happen after `weeklySelectorSnapshot_` closed its own controls, the additional block is bracketed by budgeted H4 control reads and deadline checks: a selector change or an exhausted deadline inside that phase invalidates the whole capture instead of being folded into an accepted reading. Default configuration is inert for `probarLectorWeekly()`: the test country is blank. Local synthetic tests are evidence about control flow, not live spreadsheet behavior. No Apps Script execution or deployment has been performed.

## Future manual use — requires separate authorization

1. Arrange exclusive editing for the entire execution. Record H4's original literal value outside the script for emergency recovery. Do not run originals, triggers, or another selector experiment concurrently.
2. In the intended Apps Script project, preserve existing files and add `DiagnosticoSheets.gs`, `PruebaSelector.gs` and `LectorWeekly.gs`. Review spreadsheet scopes before consenting. No manifest is supplied, and these files do not narrow any existing project permissions. No web deployment is needed.
3. Confirm the document ID in `weeklyDiagnosticConfig_` and exact `tabName: 'WebApp'`. The safety check rejects any other tab or selector coordinates; it does not trim or perform fuzzy lookup.
4. Call `leerWeeklyPorPais(pais)` with an exact country literal, or set `experiment.testCountry` and run `probarLectorWeekly()`. Blank/whitespace or formula-like countries are rejected before any lock. For range-based validation, manually copy the allowed country labels into `manualCountryAllowlist`. The reader never reads the validation source, requests its range criteria values, or opens another sheet. No validation also requires this manual list. Literal validation must contain the requested exact label; a nonempty manual list is an additional restriction. Other validation types fail closed.
5. Set a debugger breakpoint on the reader's final `return respuesta;`, select **only** the reader function, and use **Debug**. Inspect `respuesta`, especially `error` and `selector.restaurado`. The Run button does not expose a returned object automatically. Do not log, persist, or publish the detailed cells. Debugger pauses can consume the deadline; avoid pausing while the selector is changed.
6. Check H4 manually afterward. The reader returns the capture obtained **before** restoring the selector, plus the restoration outcome. Compare the returned filas with the intended WebApp cells using separately authorized manual checks. Do not infer that a changed number belongs to the requested country. Reset `testCountry` to blank after use.

## Defaults and bounds

All options live in the shared configuration; the reader does not duplicate document or inventory coordinates.

| Option | Default | Accepted bounds / meaning |
|---|---:|---|
| `testCountry` | `''` | Only used by `probarLectorWeekly()`. Blank: clear failure with no service access. |
| `manualCountryAllowlist` | `[]` | Exact manually copied labels; required for range validation or no rule. |
| `lockWaitMs` | 1,000 | 0–5,000 ms; script lock acquired before reading original H4. |
| `pollIntervalMs` | 1,000 | 100–5,000 ms; spacing between observed-state captures in the stability loop. |
| `deadlineMs` | 15,000 | 1,000–60,000 ms from entry; includes acquisition, baseline, capture spacing and `maxAttempts`. |
| `maxAttempts` | 5 | 2–20; maximum observed-state captures before exhaustion (`LECTURA_SIN_ESTABILIDAD`). |
| `totalReadBudget` | 500,000 | 20–2,000,000 cell-field reads plus validation; cleanup reservation included. |

The read budget counts four fields per cell (`getValues`, displays, formats, formulas), plus one validation access. Metadata service calls such as dimensions are not cell-field reads. Full headers, C:G metadata and each candidate column through the last used row are read, plus one budgeted batch per classified additional column through the same last used row; all named rows (including early/header/repeated names and empty weekly values) and **all** typed-Date candidate columns are snapshotted. Candidate dates remain candidates, not verified weekly columns, and additional columns are read before any restoration.

The additional block is bracketed by two budgeted H4 control reads (`weeklySelectorRead_` checked with `weeklySelectorExpect_`) placed immediately before the first additional batch and immediately after the last one, and the deadline is re-checked before the block, between the additional reads and after the closing control. Both control reads and every deadline check draw from the same read budget. A selector mismatch there raises `SELECTOR_UNEXPECTED` and a spent deadline raises `SELECTOR_DEADLINE`; either one discards the whole capture, reports `datosUtilizables: false` and still restores H4 and releases the lock through the existing `finally`. No atomicity is claimed: the additional columns are still read in separate batches, so a change between the control reads and the batches is not detectable.

Both paths require two consecutive equal captures of the observed state before data is usable. Captures are spaced by `pollIntervalMs` and bounded by `maxAttempts` while sharing the same deadline and read budget. The already-selected path captures s1 then s2..sN without writing. The write path takes a pre-write baseline snapshot used ONLY for structure-change detection (it never counts toward `intentos`), writes the requested literal, flushes, then captures r1..rN; the baseline is never part of the stability pairing. Each capture compares every cell, including the additional-column cells, so a changing comparison column is never read after the fact. On equality the LAST stable capture is returned, obtained before restoring H4. Exhaustion without stability (`LECTURA_SIN_ESTABILIDAD`), a deadline overrun, a structure change or an unexpected selector keeps `datosUtilizables: false` with empty weeks/filas; restoration is still attempted and the lock release is attempted even if restoration fails. `lectura.intentos` counts the captures actually initiated inside the observation loop, also on failure; the pre-capture spacing guard aborts before a capture starts, so it never reports a capture that was not taken.

## Interpret the result

| Result detail | Meaning |
|---|---|
| `entidad` | `{ nombre, tipo }`: `tipo` is `LATAM` when the validated requested country is exactly `LATAM` (case-insensitive), `pais` otherwise. Classification happens at the response level, never by row-name inference. |
| `estado` / `datosUtilizables` | `ok`/`true` only when primary, restoration and release all succeeded AND two consecutive equal captures were observed. Any failure keeps `error`/`false` and returns empty weeks/filas. `datosUtilizables` is fitness for PILOT INSPECTION only — never for alerting or automatic conclusions. |
| `selector` | Original literal, requested, observed, written, restored and restoration-verified flags. `escrita` is `null` on the already-selected path. |
| `lectura` | ISO start/finish, `zonaHorariaSemanaCerrada` (the configured Buenos Aires zone, used only for the expected last closed week), `estableObservada`, `intentos` and duration. Snapshots are observations, not verification. |
| `origen` | Document id, exact tab, coordinates and `zonaHorariaDocumento` (the spreadsheet timezone used to produce every `sheetDate`). |
| `semanas` | **Date-typed weekly headers only** (v3): 1-based index, cell, local date (`yyyy-MM-dd` from `cell.sheetDate`, document timezone), displayed text, duplicate flag, non-Monday flag, ambiguity flag (always `false` in v3 — a non-date header is never a week). Header dates are never reinterpreted with the Buenos Aires zone. |
| `columnasAdicionales` | (v3) Known comparison/benchmark headers, one entry per column: 1-based index, cell, column number, original displayed label (line breaks preserved), normalized label, `clasificacion` and `interpretacionValidada: false`. Classification is by normalized label (accents stripped, lowercase, whitespace/newlines collapsed, periods removed) against a reader-local frozen map: `wow`, `vs-w4`, `vs-w8`, `bench-entre-mercados`. No position is fixed and no formula, unit, favorable direction or reference period is inferred. |
| `filas` | Exact name, row, technical id `WebApp!F{row}`, `clasificacion: pendiente`, empty KPI fields, C:F metadata, per-week observations keyed by local date (per-column suffix when duplicated) and, in v3, per-row `adicionales` keyed by `clasificacion` (coordinate-suffixed when the classification repeats). Additional values come from the same pre-restoration capture. |
| `observaciones` | Serialized value, displayed text, number format, type, `cero`/`vacio`/`errorOrText`/`texto`/`numero`/`fecha` state and `hasFormula`. |
| `calidad` | Duplicated dates, non-Monday headers, ambiguous headers, last header, expected last closed week (computed in the configured Buenos Aires zone), presence of that week, declared weeks and `semanasConObservacionesNumericas` (declared weeks with at least one `cero`/`numero` observation in rows **strictly after** the header row). Header presence is separate from the availability count; the count never certifies complete load or validated KPI. Rows at or above the header row stay in `filas` but never support weekly availability. |
| `advertencias` | Fixed pilot warnings plus conditional duplicates/non-Monday/ambiguous/missing-week/orphan-week/LATAM/repeated-name/format hints, and in v3 a warning that recognized additional columns are read with `interpretacionValidada:false` and that unrecognized non-date headers remain ambiguous outside `semanas`. |
| `verificacion` | Completeness, country/data correspondence and recalculation stay `no_verificada`; a stable read is an observation (`lecturaEstableEsObservacion: true`). |
| `error` | Code plus restoration/release codes; `requiereRestauracionManual` is true only when the restore itself failed. Codes follow `/^(SELECTOR|LECTURA)_[A-Z_]+$/`; raw service errors become `SELECTOR_SERVICE_ERROR`. `LECTURA_SIN_ESTABILIDAD` means the captures never stabilized within `maxAttempts`. |

Repeated names are never merged; each is a separate row with technical id `WebApp!F{row}` (tab + row), and the id may change if rows are inserted. No row is auto-labeled as KPI: `clasificacion` stays `pendiente` and `unidad`/`interpretacion`/`sentidoFavorable` remain null; the number format is only a hint. The entity is classified at the response level from the validated requested country (`LATAM` vs `pais`); rows are indicators or pending-classification content and are NEVER summed entities — the regional LATAM aggregate must never be summed with country rows.

## Schema version

The envelope is `schemaVersion: 'weekly-lectura/3'`. The v2 -> v3 delta is:

| Area | v2 | v3 |
|---|---|---|
| `semanas` | date **and** non-date headers, non-date ones marked `ambigua: true` | only date-typed weekly headers; `ambigua` stays `false` |
| Additional columns | absent | top-level `columnasAdicionales` (index, cell, column, original and normalized label, `clasificacion`, `interpretacionValidada:false`) classified by normalized label against a reader-local frozen map; never by a fixed position |
| Additional values | absent | per-row `fila.adicionales`, keyed by `clasificacion` (coordinate-suffixed on repeats), read in the same budgeted capture before restoration and compared for stability |
| Unknown non-date headers | mixed into `semanas` as ambiguous | stay in `calidad.encabezadosAmbiguos` only, outside `semanas` and `columnasAdicionales` |
| Availability | counted on rows at or above the header row | rows strictly **after** `headerRow` only; the inventory keeps every named row |
| Attempts | captures observed after a spacing guard | captures actually initiated inside the loop; a spacing-guard abort no longer reports a capture that was never taken |

The v1 -> v2 delta is:

| Area | v1 | v2 |
|---|---|---|
| Usable data | `datosUtilizables:true` after a clean read regardless of capture equality | requires TWO consecutive equal captures (`LECTURA_SIN_ESTABILIDAD` otherwise) |
| Date sources | raw values reinterpreted with the configured Buenos Aires zone | `cell.sheetDate` (document timezone) for headers, keys and duplicates; Buenos Aires only for the expected closed week |
| Zones | `lectura.zonaHoraria` | renamed `lectura.zonaHorariaSemanaCerrada` + new `origen.zonaHorariaDocumento` |
| LATAM | `esLATAM` per row via `/latam/i` name inference, `calidad.latamSeparada` | top-level `entidad {nombre, tipo}` derived only from the requested country; row `esLATAM` and `latamSeparada` removed |
| Availability | `calidad.semanasConDatos` (header-tied) | `calidad.semanasConObservacionesNumericas` (numeric body observations only; header presence separate) |
| Row ids | `F{row}` | `WebApp!F{row}` (tab + row) |
| Attempts | — | `lectura.intentos` |

**Completeness, country/data correspondence and recalculation always remain unverified**, even after a stable read. `SpreadsheetApp.flush()` applies pending edits only; it is not a refresh or recalculation barrier.

## Failure recovery and unavoidable races

- The script lock coordinates only cooperating executions in the same project. It cannot block humans or other script projects. Selector reads before/after snapshots cannot detect every intervening change, same-value rewrite, or change-and-revert. Reads of different fields are not atomic.
- Marking the write as possible **before** `setValue` covers calls that apply an edit and then fail. `finally` attempts restoration even when the primary operation fails and releases the lock even when restoration fails. Restoration and release errors are separate from the primary error.
- Restoration deliberately writes the original literal even after an unexpected selector observation. A concurrent editor's newer choice could therefore be overwritten. Exclusive editing is an operational prerequisite, not an enforceable guarantee.
- Forced cancellation, platform termination, or execution limits can skip `finally`. If execution is interrupted or restoration is not confirmed, manually restore the previously recorded H4 literal and inspect the sheet. Do not assume restored formulas/data have recalculated. Never restart blindly while another execution might remain active.
- `probarLectorWeekly()` logs only a bounded summary (state, requested country, `datosUtilizables`, `estableObservada`, `intentos`, week and additional-column counts, row count, quality counts, selector write/restore outcome, duration, error code); the reader itself logs nothing. Detailed cells stay in the in-memory returned result/debugger only.

## Local verification and rollback

```text
node --test tests/LectorWeekly.test.cjs
node --test tests/*.test.cjs
```

The dependency-free synthetic harness evaluates the diagnostic, the experiment, the reader and the option source together in `vm`. Strict API mocks cover pre-lock guards, no-lock, unsafe destinations, formula-like originals, already-selected no-write, the full write path, typed states, repeated names, duplicated dates, structure change, deadline, read budget, unexpected selector guards, write/flush/poll/restore/release failures, validation modes and both `probarLectorWeekly()` paths. Original files are only read as bytes for SHA-256 checks, never executed. The full `node --test tests/*.test.cjs` run also keeps the existing diagnostic and selector suites green (24 diagnostic + 42 selector = 66 existing tests, plus 45 reader, 12 option-source and 23 frontend tests = 146 total) and verifies the captured hashes: `ReportePaises.gs.txt` and `Web.gs.txt` stay byte-identical, while `Index.txt` is pinned to the reviewed consultation frontend (see `CONSULTA_WEEKLY.md`).

Additional-block controls (2026-09-21): the reader keeps `schemaVersion: 'weekly-lectura/3'` and adds three required scenarios (a selector change during the additional readings reported as `SELECTOR_UNEXPECTED` with one initiated attempt and a verified restoration, a deadline exhausted between additional readings reported as `SELECTOR_DEADLINE` without counting the failing capture as stable, and the bracket/budget accounting over the full write path: fourteen H4 reads in order with the control reads included, and a limit of one below the spent budget reported as `SELECTOR_READ_BUDGET`). The two guard-index tests in the reader suite moved with the new read ordering (the pre/post-write boundary and the restoration-verification index).

Additional-columns round (2026-09-21): the reader bumps to `schemaVersion: 'weekly-lectura/3'` and adds six required scenarios (nine weekly dates plus four known additional columns separated; relocated additional columns still classified by normalized label; unknown non-date header preserved as ambiguous; additional values captured before restoration and included in the stability comparison; numbers at or above `headerRow` never confirm availability with an empty body; a timeout after initiated captures keeps the counter and still restores). The synthetic fixture mirrors the operator-reported layout: nine weekly date columns, four known comparison/benchmark labels (including one with a line break) and one unknown non-date header.

Corrections round (2026-09-20): the reader now requires two consecutive equal captures (`datosUtilizables`), uses `cell.sheetDate` for every date, classifies the entity from the requested country (no `/latam/i` inference), counts numeric observations separately from header presence, exposes tab+row technical ids, reports `intentos` and satisfies the nine regression scenarios (R1–R9 in the test suite: always-changing captures, late stabilization, already-selected waiting, document zone shift, LATAM entity, LATAM-named indicator under a country, empty body, zero counting, timeout/restore failure).

This is one cohesive local work unit; it exceeds the advisory 400-line size to retain safety coverage and readability. No commits, remote access, deployment, original execution, BigQuery, triggers, SDD or review commands are included. Rollback removes `LectorWeekly.gs`, its test and this guide, removes the `BITACORA.md` entry, and reverts the single `Index`/`Index.txt` harness reference if rolling back the entire work unit. Preserve the prior diagnostic/experiment and all original files; task tracking can be reverted separately. The consultation frontend and the option source are a separate round documented in `CONSULTA_WEEKLY.md`; rolling this reader work unit back also requires reverting the additional-block controls described above.

Options and frontend round (2026-09-21): `OpcionesWeekly.gs` (`obtenerOpcionesWeekly()`) exposes the H4 option list without reading the sheet body and without taking the lock, and `Index.txt` is now the consultation UI served by `doGet()`. Their tests are `tests/OpcionesWeekly.test.cjs` and `tests/Index.test.cjs`; their manual steps, states and limits live in `CONSULTA_WEEKLY.md`. This guide keeps describing the reader only.
