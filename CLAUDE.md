# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WeeklyTool: a Google Apps Script web app that reads a corporate Google Sheets ("Weekly Performance Review") and tells, as a three-chapter story, what happened last week (Monday to Sunday) in 15 countries plus LATAM. `README.md` (Spanish) is the source of truth for current state, product rules, the Apps Script deployment guide and the checklist of what has not been verified live.

There is no build step, no package.json, no linter and no dependencies. The `.gs` files are pasted by hand into the Apps Script editor; `Resumen.txt` is pasted as an HTML file named `Resumen`.

## Commands

Node 24 only (no Python on this machine).

```bash
node --test tests/*.test.cjs                 # current tool (86 tests)
node --test anterior/tests/*.test.cjs        # archived selector-based reader (146 tests)
node --test tests/MotorWeekly.test.cjs       # one file
node --test --test-name-pattern="story page" tests/*.test.cjs   # tests matching a name

# Run the engine on a downloaded .xlsx copy; writes salidas/weekly-<week>.{md,json}
node herramientas/analizar.cjs "C:/Users/juan.aguirre/Downloads/Weekly Performance Review.xlsx"

# KPI dictionary and reading validation of a copy (roadmap steps 2 and 3); write to salidas/
node herramientas/diccionario.cjs "<xlsx>"                        # also writes contexto-agente.{md,json} for a data agent
node herramientas/validar.cjs "<xlsx>" ["<another copy>" ...]     # exit code 1 if a control fails

# Serve the page locally with a stand-in for google.script.run
node herramientas/vista-previa.cjs "<xlsx>" --puerto=8125
```

Both tools accept `--hoy=AAAA-MM-DD` to simulate another date (e.g. a Monday before the data refresh). `.claude/launch.json` has preview configurations for both cases (ports 8125 and 8126).

## Architecture

One pipeline, the same code in Apps Script and in Node:

```
"2) Weekly por pais"  (values + formulas)  ─┐
                                            ├─ weeklyFuenteEntrada_  →  analizarWeekly  →  vistaWeekly  →  Resumen page
"[Extract] Tabla Weekly"  (values)         ─┘   FuenteWeekly.gs         MotorWeekly.gs     ResumenWeekly.gs   Resumen.txt
```

- **`FuenteWeekly.gs`** — read-only adapter. `analizarWeeklyAhora()` touches `SpreadsheetApp`; the `weeklyFuente*_` builders are pure (2D arrays in, plain objects out). KPI *definitions* (name, section, block, favourable direction, technical key, derived formulas) come from `2) Weekly por pais`; the *numbers* come from the extract, which keeps null distinct from zero and holds all 16 markets. `weeklyFuenteCoincidencia_` cross-checks engine values against what the sheet shows for the market currently in its selector, without writing it.
- **`MotorWeekly.gs`** — pure engine, no services, no clock. `weeklyMotorCatalogo_` turns sheet rows into the KPI catalog (parsing each row's formula into a `def`, assigning the stable `uid`); `analizarWeekly(entrada)` produces load-state findings (`globales`), data-quality findings, performance alerts with "explicaciones", and the per-market overview. All thresholds live in `weeklyMotorConfig_` and are unvalidated proposals.
- **`ResumenWeekly.gs`** — rule-based Spanish text and the view model: `resumirWeekly` (markdown), `vistaWeekly` (page payload), `weeklyResumenHistoria_` (the three chapters; per market, one segment for the whole country plus one per section of the sheet). KPIs are shown with the name of their row in the sheet, never translated. No AI model is involved.
- **`RegistroWeekly.gs`** — `obtenerVistaWeekly(forzar)` is the endpoint the page calls. It serves the saved run if it covers the last closed week, otherwise reads, compares against the previous week's saved run (new / continuing, by market + `uid`; it also builds `vista.revisar`, the data-to-review lists of this week and of the saved previous week) and saves. A saved run whose `vista.formato` differs from `weeklyResumenFormato_` is read again, so bump that constant whenever the page payload changes shape. **The only file that writes**, and only to its own tab `Weekly_Tool_Registro`. Provisional or degraded runs are shown but never saved.
- **`Web.gs`** — the single `doGet`, serving `Resumen`.
- **`herramientas/`** — `xlsx.cjs` is a dependency-free .xlsx reader; `analizar.cjs` converts a copy into the arrays `getValues()`/`getFormulas()` would return and feeds the same builders; `vista-previa.cjs` serves `Resumen.txt` as-is; `diccionario.cjs` and `validar.cjs` build the KPI dictionary and the reading validation report from a copy (local only, nothing to paste into Apps Script).

### How the `.gs` files are loaded locally

Tests and tools read the `.gs` sources and evaluate them with `node:vm` in one shared context, in the order Motor → Resumen → Fuente → Registro. Consequences:

- `.gs` files must stay plain script JS: top-level `function`/`const` globals, no `require`, `import` or `module.exports`.
- Anything that should be testable must not call Apps Script services (`SpreadsheetApp`, `Utilities`, `LockService`…); keep those in the thin public entry functions and put logic in pure `weekly<File>…_` helpers.
- Functions ending in `_` are private in Apps Script; the public ones (`doGet`, `obtenerVistaWeekly`, `analizarWeeklyAhora`, `probarAnalisisWeekly`, `probarCompuertaIaWeekly`) are callable from the editor or the page.

## Constraints that are easy to break

- **Never locate anything in the sheet by fixed coordinate or by label.** `2) Weekly por pais` gets columns and rows inserted and sections renamed often. The reader finds the "KPI" header, date columns, "WoW", direction (column with most 1/−1), technical key (the cell each row's `MATCH` references), block and selector by content. Configuring KPIs by visible name already broke once; headline KPIs are the block leaders by sheet position, Spanish names are keyed by technical key.
- **Engine honesty rules** (README "Reglas que el código respeta"): null never becomes zero or vice versa; a KPI with a blocking quality finding gets no performance alert; relative % and percentage points are never mixed (the unit comes from the sheet's WoW formula); no favourable direction means no good/bad verdict; LATAM is an aggregate, never counted as a country; "explicaciones" are co-movements in the same data, never a stated cause.
- **AI text is planned, not built.** The design (README "Plan: texto con IA", `DISENO_AGENTES.md` §10): a time-driven trigger generates the text once a week and saves it; the page only reads it. The model must never be reachable from `obtenerVistaWeekly`/`forzar`. Gemini only writes; every figure comes from the engine. `weeklyMotorCompuertaIa_` (pure, in `MotorWeekly.gs`) decides whether the week is safe to write about; its thresholds are unvalidated and nothing was run in Apps Script or Vertex AI.
- **Read-only towards the source.** Nothing may write to the KPI sheet, the extract or the selector. The archived reader in `anterior/` did change the selector; that approach was abandoned on purpose.
- **Tab names differ between live and copies**: live Sheets uses `[Extract] Tabla Weekly`; the .xlsx export drops the brackets (`hojaDatosEnCopia`).
- **The GitHub remote is public.** `salidas/` and `presentacion/` are git-ignored because they hold company figures; never commit business numbers, and keep test fixtures synthetic.
- `anterior/` is history: not used by the web app, do not extend it. Its tests pin file hashes, so editing files there breaks them.

## Verified vs. not

Claude cannot reach the live spreadsheet or the Apps Script project: the user downloads `.xlsx` copies and pastes code by hand. Passing local tests means "works on a copy", not "works live". Keep that distinction explicit in answers and docs, and do not tick items in the README's "Qué falta verificar en vivo" list unless the user reports having run them.

## Conventions

- Identifiers and user-facing text are in Spanish; code comments, test names and commit messages are in English. Reply to the user in Spanish.
- `BITACORA.md` is a chronological log of what was actually executed (and by whom: local test run vs. operator-reported in Apps Script); add entries only after the fact. Keep `README.md` current when behaviour changes. `DISENO_AGENTES.md` is a design for adding an AI model, not implemented.
- Work is committed directly on `main`.
