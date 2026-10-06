# Weekly consultation frontend (first pilot UI)

> **Superseded (2026-10-06).** This document describes the earlier reader, which wrote the country selector of a `WebApp` tab.
> That tab no longer exists and the web app no longer uses this code. Current state: `README.md`. Kept as history.

`Index.txt` is the single HTML file served by the existing `doGet()` in `Web.gs.txt`
(`HtmlService.createHtmlOutputFromFile('Index')`). It is a sober Spanish consultation
UI over `leerWeeklyPorPais(pais)` from `LectorWeekly.gs`, with its country list coming
from `obtenerOpcionesWeekly()` in the new `OpcionesWeekly.gs`. It reads only the exact
**WebApp tab** and never writes: the temporary H4 write belongs to the reader. Local
synthetic tests are evidence about control flow and rendering, not live spreadsheet
behavior. **No Apps Script execution and no deployment has been performed.**

## What the UI shows

- Country selector (from the H4 validation rule) and a single **Consultar** button.
  Options are loaded once at start; `leerWeeklyPorPais(pais)` is called only when
  Consultar is pressed, never by a filter. An option that is empty or only whitespace is
  never offered: the reader rejects it (`SELECTOR_COUNTRY_BLANK`) before taking the lock,
  so offering it could only produce a guaranteed failure. Valid names are offered exactly
  as configured, without trimming.
- Result header: the entity of the result itself — `País del resultado: <país>`, or
  `Agregado regional: LATAM` when `entidad.tipo` is `LATAM`, because LATAM is a regional
  aggregate and must not be presented as a country — plus the reading finish time (UTC),
  attempts, duration, the reading timezone and the document timezone.
- Badges: whether two equal readings were observed, the expected last closed week and
  whether it is present, the last weekly header, the declared week count and how many
  weeks have numeric observations.
- Table of names x weekly dates for rows **strictly after** `headerRow`, plus an
  optional group of additional columns (off by default).
- Local filters: name search, week selector with **Todas**, and the additional-columns
  checkbox. They never call the server.
- Per-cell detail: always identifiable on its own, because it repeats the entity of the
  result with its reading time (`País del resultado` / `Agregado regional`, `Lectura`),
  plus the indicator, the period (week or additional column) and the coordinate. Then the
  original value, displayed text, number format, reader state, type, `WebApp!<coordinate>`,
  a formula warning (without the formula text) and, when the format hides a numeric value,
  the original number. Accepting a new reading clears the detail back to
  `Seleccioná una celda de la tabla para ver su detalle.`; if the last query fails, the
  previous detail stays, marked `(resultado anterior)` with an explicit notice.
- Collapsible warnings panel with the reader's own text, and a collapsible full
  inventory of every named row (including early/header/repeated names) with technical
  id and the `C:F` metadata as read, never reinterpreted.
- The pilot notice `Lectura piloto. Carga y recálculo no verificados.` is always
  visible, and no state ever claims the data is "Al día".

Everything is rendered as text (`textContent`); nobody injects HTML. The page has no
external fonts, no libraries and no absolute URLs.

## Acceptance gate

A reading is displayed only when `schemaVersion === 'weekly-lectura/3'`,
`estado === 'ok'`, `datosUtilizables === true`, `lectura.estableObservada === true` and
`paisSolicitado` equals the country that was requested. Anything else is an error, so
Argentina data can never be shown under another country's heading.

## States

| State | What the operator sees |
|---|---|
| Initial | `Cargando las opciones disponibles...`; Consultar disabled. |
| Options failed | Consultar stays disabled, the reason is shown and the operator is told to reload the page. |
| Loading | `Consultando <país>...`; Consultar disabled; a second click is ignored. |
| Success | Result card with the entity of the result (country or regional aggregate), time, badges, table, details, warnings and inventory. |
| Empty result | `Sin coincidencias para los filtros elegidos.` when the local filters match no row. |
| Error | Red panel with the Spanish message for the reader's code plus `La consulta no devolvió datos utilizables.` |
| Error with a previous result | The previous result stays visible, marked as `Resultado anterior de <país> (<fecha>)` and styled as outdated; an open cell detail stays too and is marked `(resultado anterior)`. |

Codes are mapped to Spanish messages: `SELECTOR_LOCK_UNAVAILABLE` explains that another
reading holds the lock and asks for a manual retry (never automatic), and
`requiereRestauracionManual` adds an explicit instruction to review `WebApp!H4` before
continuing. A failure that carries no code falls back to `SELECTOR_SERVICE_ERROR`.

## Future manual use — requires separate authorization

1. Arrange exclusive editing of the sheet for the whole session. Record H4's literal
   value outside the script for emergency recovery.
2. In the intended Apps Script project add `DiagnosticoSheets.gs`, `PruebaSelector.gs`,
   `LectorWeekly.gs`, `OpcionesWeekly.gs` and the HTML file. The HTML content must be
   stored as an Apps Script HTML file named `Index` (that is the name `doGet()` passes
   to `createHtmlOutputFromFile`); in this repository it is versioned as `Index.txt`.
   No manifest is supplied and these files do not narrow existing project permissions.
3. Create or reuse a web app deployment executing as the owner. **Restrict access**: the
   reading envelope carries sheet content into the browser, so anything broader than
   "only myself" or a specific group exposes the matrix. Deployment settings are chosen
   by the operators; no deployment was made from this repository.
4. Call `obtenerOpcionesWeekly()` once and confirm the option list matches the current
   H4 rule. A range-based or absent rule uses `manualCountryAllowlist`.
5. Run one consultation per country, one at a time. Confirm the result header shows the
   requested country, compare a small sample of cells against the sheet using separately
   authorized manual checks, then check H4 manually.
6. If the browser reports a lock or a restoration problem, stop and inspect
   `WebApp!H4` before retrying.

## Limits

- A stable reading is an **observation**, not an audit: completeness, country/data
  correspondence and recalculation stay `no_verificada` in the returned envelope.
- Additional columns (`WoW`, `vs. W-4`, `vs. W-8`, `Bench entre mercados`) are shown as
  they are read, with `interpretacionValidada: false`. The UI never recalculates them
  and never compares them against the selected week; the week filter does not change
  them.
- The `C:F` metadata is displayed as read, without interpretation.
- The reader keeps its own deadline, attempt count and read budget; the UI adds no
  retries and no cancel action, and cannot interrupt a running server call.
- The page keeps only the current reading in memory. Reloading loses it and re-reads
  the options.

## Local verification and rollback

```text
node --test tests/Index.test.cjs
node --test tests/*.test.cjs
```

`tests/Index.test.cjs` extracts the single `<script>` block, seeds a minimal DOM from
the served markup (so hidden/disabled attributes and the always-visible texts are
exercised as served) and runs the frontend in `vm` with a recording
`google.script.run` stub. It asserts the content policy (no `innerHTML`,
`document.write`, `eval`, BigQuery/previous backend calls, `LOCAL_PREVIEW`/`MOCK_DATA`,
absolute URLs or "Al día"), that every id used by the script exists in the markup, the
options and reading flows, the acceptance gate and rejections, local filters issuing no
server call, the cell detail including the hidden-number warning, the lock and
restoration messages, the stale previous result, the additional values surviving a week
change, the inventory/main-table split, and a rename/removal guard over the reader
fields the frontend consumes. A second group of cases covers the correction round: the
detail is cleared by any newly accepted reading (another country and the same country),
an error after a success keeps the previous country, date and detail marked as previous,
and a `LATAM` result is identified as a regional aggregate instead of a country. It does
not exercise a real browser, real Apps Script or a live spreadsheet.

`expectedHashes` in `tests/DiagnosticoSheets.test.cjs` pins the three originally
captured files. `ReportePaises.gs.txt` and `Web.gs.txt` are still byte-identical;
`Index.txt` is now `a79e2f5dd3115caa00bca2c0b3b17c15071fe3ac37a588ad7cdb487549aa5348` and
the hash was updated on purpose together with this frontend. The previous BigQuery
frontend is no longer in the repository (nothing was committed, so it is not in git
either); a saved copy can be verified against its old hash
`97958bf348802da7812dba94644eb27735cbeee487c9c9ef25b8104bd0dc6c67`.

Rollback: restore the previous `Index.txt` from a copy verified against that hash (or
remove the frontend), restore `LectorWeekly.gs` to the state without the additional-block
controls, remove `OpcionesWeekly.gs`, `tests/Index.test.cjs`,
`tests/OpcionesWeekly.test.cjs` and this guide, and revert the corresponding test and
documentation edits. Preserve `DiagnosticoSheets.gs`, `PruebaSelector.gs`,
`ReportePaises.gs.txt` and `Web.gs.txt` unchanged.
