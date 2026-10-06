# Weekly consultation frontend (first pilot UI)

## Objective and authorized scope
Replace the previous BigQuery consultation frontend with a first consultation UI
for the Weekly pilot, plus the minimum server support it needs:

- `Index.txt` (the single HTML file served by the single existing `doGet()` in
  `Web.gs.txt`) becomes a sober Spanish consultation frontend built on
  `leerWeeklyPorPais(pais)`.
- A new server file provides the country options without reading the sheet body.
- The reader's additional-column phase gets the selector/deadline controls it is
  missing, because those reads happen after `weeklySelectorSnapshot_` performed
  its own closing controls.

Preserve untouched: `DiagnosticoSheets.gs`, `PruebaSelector.gs`,
`ReportePaises.gs.txt` (previous BigQuery backend kept as a backup) and
`Web.gs.txt`. No BigQuery, no other tabs, no external services, no libraries, no
new fonts, no new calculations, no formula edits, no deployments, no triggers.
Every change stays local.

## Problem and approach
The old `Index.txt` calls `google.script.run.probarBigQuery()`, a function that
does not exist anywhere in this repository, and it injects sheet-derived content
through `innerHTML`. It cannot serve the pilot and it exposes a fictitious
fallback (`LOCAL_PREVIEW`/`MOCK_DATA`). This round replaces it and closes two
gaps the UI would otherwise inherit:

1. **Reader controls around the additional columns.** `weeklyLecturaSnapshot_`
   reads the WoW / vs. W-4 / vs. W-8 / Bench columns *after*
   `weeklySelectorSnapshot_` already verified the selector and the deadline.
   Without extra controls, a selector change or an exhausted deadline during
   that phase would still be folded into an accepted capture. Add one budgeted
   selector control read before and one after the additional block, plus a
   deadline check between/around the additional reads. A failure there throws,
   invalidates the whole capture and still restores and releases through the
   existing `finally`. No atomicity is claimed: the sheet is read in several
   separate batches.
2. **Options without touching the sheet body.** The UI needs the allowed country
   list. `obtenerOpcionesWeekly()` reads only the `H4` data-validation rule and
   mirrors `weeklySelectorValidation_` semantics exactly: a literal list is used
   as-is, a range or absent rule falls back to the manual allowlist (the range is
   never requested, no country is ever invented), and any other criterion type
   fails closed. It takes no script lock because it never writes and never reads
   sheet content, following the `diagnosticarWeeklySheets()` precedent.

The frontend accepts a reading only when the envelope is
`weekly-lectura/3`, `estado === 'ok'`, `datosUtilizables === true`,
`lectura.estableObservada === true` and `paisSolicitado` equals the country that
was requested, and it interprets every cell through the reader's own states
(`fecha`, `numero`, `cero`, `texto`, `vacio`, `errorOrText`) instead of
`valor || ''`.

## Tasks and acceptance
- [x] T1: Add the missing controls to `weeklyLecturaSnapshot_` in
      `LectorWeekly.gs`: `weeklySelectorDeadline_` before, between and after the
      additional readings and one budgeted `weeklySelectorExpect_(weeklySelectorRead_)`
      control before and one after the additional block. Keep schema v3, the
      public entries, the lock/restore/deadline/budget behavior and every other
      reader guarantee. No new public function, no config change.
- [x] T2: New `OpcionesWeekly.gs` with the public `obtenerOpcionesWeekly()` and
      `weeklyOpciones*_` private helpers: read only `H4`'s data validation,
      return the structured option list with `tipo` (`pais` / `LATAM`), plus the
      source that produced it and honest evidence/limitations. Never read the
      sheet body, never take the lock, never write, never invent countries.
- [x] T3: Replace `Index.txt` with the consultation frontend: country selector
      and "Consultar" only, options loaded once at start, `leerWeeklyPorPais`
      called only on demand, no server call from the local filters, table of
      names x weeks with an optional additional-columns group, local name search,
      a week filter with "Todas", per-cell detail (original value, shown text,
      format, state, WebApp coordinate), the `C:F` metadata as read-only
      reference, reading timestamp, expected last closed week and header
      presence, the pending-interpretation note for the additional values, the
      visible "Lectura piloto. Carga y recálculo no verificados" notice, the
      "Nunca se muestra 'Al día'" rule, warnings in a collapsible panel, the
      complete named-row inventory with its technical id, and explicit states
      for initial / loading / success / error / no matches. It must degrade
      honestly: errors keep the previous result marked as older with its own
      country and timestamp, a busy lock is explained with a manual retry, and a
      failed restoration points at reviewing `WebApp!H4`. No fictitious
      fallback, no HTML injection, no automatic retry, no cancel button.
- [x] T4: Tests. Extend `tests/LectorWeekly.test.cjs` with the control-read
      scenarios (selector change during the additional readings, deadline
      exhaustion between additional readings, control reads budgeted and
      bracketing the additional block) and update the two guard-index tests
      whose read ordering changed. New `tests/OpcionesWeekly.test.cjs` (option
      source semantics, parity with the reader's own validation acceptance for
      every returned option, no sheet-body access, no lock). New
      `tests/Index.test.cjs` driving the frontend in a `vm` with a minimal DOM
      stub. Update `expectedHashes['Index.txt']` and the normalization list.
- [x] T5: Documentation. New `CONSULTA_WEEKLY.md` (how to use and test the UI,
      states, limits), `LECTOR_WEEKLY.md` (control reads and their budget),
      the `BITACORA.md` entry, and the Engram mirror.

## Progress and verification
- Delivered in one round, inline (see "Tasks disabled by the runtime"). Forecast of
  authored changed lines: `Index.txt` (replacing a ~1260-line file), `OpcionesWeekly.gs`,
  the reader delta, three test files and four documents land well above the 400-line
  planning heuristic. There are no commits, no remote and no open PR in this repository,
  and the user asked for the whole deliverable in one round, so the change is kept
  coherent instead of being split artificially. No pull request is created.
- Delivery strategy: `ask-on-risk`; no PR planned. Chain strategy: not applicable.
- TDD: not configured in this project; ordinary functional verification.
  Runner: `node --test tests/*.test.cjs`.

### T1 — additional-block controls (done)
- `weeklyLecturaSnapshot_` now takes a deadline check before the additional block, a
  budgeted `weeklySelectorExpect_(weeklySelectorRead_)` control read before the first
  additional batch and another one after the last batch, plus a deadline check between
  the additional reads. A mismatch or an overrun throws, so the whole capture is
  discarded and the existing `finally` still restores H4 and releases the lock. Schema
  v3, the public entries and the configuration are unchanged.
- Test evidence: `tests/LectorWeekly.test.cjs` 45/45. One intermediate full-suite run
  was 106/108, failing exactly the two guard-index tests whose read ordering changed;
  both were updated (`unexpectedAt < 4` -> `< 6` and the restoration-verification index
  `8` -> `14`). Three scenarios were added: a selector change during the additional
  readings (`SELECTOR_UNEXPECTED`, `intentos` 1, restoration verified, writes
  `['Chile','Argentina']`), a deadline exhausted between additional readings
  (`SELECTOR_DEADLINE`, only the first failing range read), and the bracket/budget
  accounting (fourteen H4 reads in order and `SELECTOR_READ_BUDGET` at one below the
  spent budget). Fixture knobs `additionalSelectorChange` and `additionalDeadline` are
  gated on the post-write phase so the pre-write baseline stays untouched.

### T2 — option source (done)
- `OpcionesWeekly.gs` exposes only `obtenerOpcionesWeekly()`; helpers are
  `weeklyOpciones*_`. It reads only the `H4` data validation within a budget of one
  access, never the sheet body, never the range criteria values, and takes no lock. The
  envelope is `weekly-opciones/1` with `alcance: 'solo_validacion_selector'`, `fuente`
  (`VALUE_IN_LIST` or `LISTA_MANUAL`), `opciones[{nombre, tipo}]`, `origen`, document
  timezone, duration, `verificacion` (all `no_verificada`, correspondence
  `no_verificada`) and English `advertencias`. Unsafe literals and duplicates are
  dropped with explicit warnings; an empty effective list is `SELECTOR_OPTIONS_EMPTY`,
  a wrong tab `SELECTOR_DESTINATION`, an unsupported criterion `SELECTOR_VALIDATION`.
- Test evidence: `tests/OpcionesWeekly.test.cjs` 11/11 (one of which is the file
  normalization guard). Parity with the reader is asserted by running the reader's own
  `weeklySelectorValidation_`/`weeklyLecturaEntidad_`/`weeklySelectorLiteral_` over every
  returned option.

### T3 — frontend (done)
- `Index.txt` was replaced (LF, no `innerHTML`, no absolute URLs, no `Al día`, single
  script block, Spanish UI). Element ids are stable and covered by the test.
- Test evidence: `tests/Index.test.cjs` 18/18 driving the real script block in `vm` with
  a DOM seeded from the served markup and a recording `google.script.run` stub.

### T4 — tests (done)
- Full suite: 140 tests, 140 passing (24 diagnostic + 42 selector + 45 reader + 11
  option source + 18 frontend) at that point; the correction round below raises it to 146.
- `expectedHashes['Index.txt']` updated to
  `6c985f8b650284ace4df1c9788dc320a1b6323b4af3a22b935685d1b0fbe47b9`; the other two
  captures stay byte-identical. The hash test now says what it pins, and the
  normalization list covers the new files.

### T5 — documentation (done)
- New `CONSULTA_WEEKLY.md` (use, acceptance gate, states, code mapping, limits, local
  verification, rollback with the old `Index.txt` hash to verify a saved copy).
- `LECTOR_WEEKLY.md`: control reads and their budget, updated test counts and the
  reader-only scope. `BITACORA.md`: local-only round entry. Engram mirror refreshed.

## Correction round (operator-reported defects, local only)

### T6 — clear the cell detail when the result changes (done)
- `Index.txt` keeps the open detail in `estado.detalleObservacion`/`detalleContexto` and
  repaints it with `pintarDetalle()`. Accepting a reading calls `limpiarDetalle()`, so the
  panel returns to `Seleccioná una celda de la tabla para ver su detalle.`; no previous
  cell can be read next to a newer result. `renderResultado()` repaints the detail so it
  follows the result state, and a failed query keeps the previous detail marked
  `(resultado anterior)` with an explicit notice.
- The detail is self-identifying: entity of the result (`País del resultado` /
  `Agregado regional`), reading time, indicator, period (week or additional column) and
  coordinate, plus the previous value/format/state/type rows and warnings.
- LATAM: `estado.resultadoTipo` comes from `entidad.tipo`, and `etiquetaEntidad()` renders
  `Agregado regional: LATAM` instead of presenting the regional aggregate as a country.

### T7 — option source excludes blank options (done)
- `weeklyOpcionesLista_` in `OpcionesWeekly.gs` drops options that are empty or only
  whitespace, counting them in their own warning. The reader rejects them with
  `SELECTOR_COUNTRY_BLANK` before taking the lock, so offering one could only produce a
  guaranteed failure. Valid names are still offered exactly as configured (no trimming).
  Duplicate counting was split from the rejection counters so each warning states its own
  reason.

### T8 — corrected tests and hash (done)
- Test evidence: `node --test tests/*.test.cjs` 146/146 (24 diagnostic + 42 selector +
  45 reader + 12 option source + 23 frontend). New cases: a LATAM result is identified as
  a regional aggregate; the detail identifies result, reading time, indicator, period and
  coordinate; a new accepted reading (another country, and the same country again) clears
  the detail; an error after a success keeps country, date and detail marked as previous;
  a list with blank options offers only the valid ones and the excluded values are the ones
  the reader refuses.
- `expectedHashes['Index.txt']` is now
  `a79e2f5dd3115caa00bca2c0b3b17c15071fe3ac37a588ad7cdb487549aa5348`; the two other
  captures remain byte-identical.

### T9 — documentation for the correction (done)
- `CONSULTA_WEEKLY.md`: selector excludes blank options, header/aggregate wording, detail
  content and clearing behavior, states table, test description and the new pinned hash.
- `BITACORA.md`: local-only correction entry. Engram mirror refreshed.

## Constraints and checks
- Single tab read `WebApp`; single temporary write `H4`; keep lock, restoration,
  deadline and read budget everywhere.
- The frontend must never show Argentina data under another country's heading,
  never present the additional values as validated comparisons, never recalculate
  them, never fake a fallback, never claim "Al día", and never render sheet
  content as HTML.
- Options must never read the validation range nor the sheet body, and the
  reader's validation stays the authority on what is allowed.
- Normalization: LF, no BOM, final newline, no trailing whitespace.
- Delivery status: implemented locally, tested locally (146/146), NOT tested in Apps
  Script, NOT deployed, no commits. Manual steps for the operators are in
  `CONSULTA_WEEKLY.md`; they require separate authorization and deployment settings
  that restrict who can open the web app.

## Tasks disabled by the runtime
Delegation of the exploration/implementation steps to a sub-agent failed because
this runtime rejects Task launches ("OpenCode's free tier can only be used from
within OpenCode"). That is an environment/runtime limitation, not a Gentle AI or
repository defect; no defect report applies. Work is executed inline by the
orchestrator with the same bounded-read discipline.
