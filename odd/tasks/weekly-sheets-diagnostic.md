# Weekly Sheets read diagnostic

## Objective and authorized scope
Add an isolated `DiagnosticoSheets.gs` public `diagnosticarWeeklySheets()` function for the specified spreadsheet and only `2) Weekly por pais`. Preserve all three received files. No frontend rebuild, comparisons, AI, existing function execution, BigQuery, external-service calls, cell writes, selector changes, refresh, triggers, or deployment.

## Problem and approach
The received frontend calls missing `probarBigQuery()` and expects a contract different from `consultarOrdenesPorPais()`. This stage does not repair either. Inspect the authorized sheet read-only and return serializable observations, never verification of completeness, freshness, recalculation, or country correspondence.

## Tasks and acceptance
- [x] T1: Implement isolated configured reader with timestamps, document timezone, dimensions, H4 before/after and validation metadata, date/ambiguous headers, duplicate dates, all named G rows with C:F metadata, and bounded cell samples. Preserve raw types and uncertainty; invalidate observed selector changes.
- [x] T2: Run synthetic regression and access-boundary tests; document manual Apps Script execution and limitations. Independently check source and rerun tests.

## Constraints and checks
- Configuration: document `1rM2xKI-978nhn7-G9WWP02CPmwelxpWLRDArQ8VHmfk`, tab `2) Weekly por pais`, H4, header row 8, name column G.
- No Date objects in returned data. Logs contain only bounded summary.
- Never read validation source cells, including sources on another tab.
- Preserve zero, blank, text, and error-like observations without claiming unavailable typed error evidence.
- Retain repeated names and rows without weekly values.
- TDD: not configured in received snapshot; ordinary functional testing, not a claim of configured strict TDD. Runner: `node --test tests/DiagnosticoSheets.test.cjs` (new dependency-free synthetic harness).
- Verification: above test command plus independent read-only source/access review and original-file SHA-256 checks.
- Actual Apps Script execution and deployment: not authorized/performed in this session.

## Delivery and progress
- Forecast: one coherent diagnostic and synthetic harness, approximately 350–600 authored lines; advisory estimate, no code reduction to fit a budget.
- Delivery strategy: ask-on-risk; no PR or remote delivery requested.
- Git: directory is not a repository. No repository initialization or commits; commit evidence unavailable. Local implementation can proceed independently.
- RDD: off, deciding source default. No native review transaction.
- Rollback: remove newly added diagnostic, tests, guide, and this task document; originals remain unchanged.
- T2 implementation verification: `node --test tests/DiagnosticoSheets.test.cjs` observed 24 tests passed, 0 failed. Synthetic allowlisted service mocks and static checks only; original sources never executed.
- T2 verified: parent and independent verifier each reran the exact test command, 24 passed, 0 failed. Independent source/access inspection found no additional concrete defects; live service behavior remains untested.
- Added: `DiagnosticoSheets.gs`, `tests/DiagnosticoSheets.test.cjs`, `DIAGNOSTICO_SHEETS.md`.
- Original SHA-256 before source edits and after tests: `ReportePaises.gs.txt` = `121495a000e0f80f6e144153d2db7ef2ccea7cbc2df6de7e9c073d70bef00d9a`; `Web.gs.txt` = `08133763ee1f221877553f8edb14733ef2aa4ef9931583dab2e9b1d50cfe87f4`; `Index.html` = `97958bf348802da7812dba94644eb27735cbeee487c9c9ef25b8104bd0dc6c67`.
- Native typed cell errors remain unverifiable: recognized error strings are explicitly `errorOrText`, including formula-produced strings. Returned limitations and guide expose this boundary.
- Skill resolution: paths-injected `work-unit-commits` and `cognitive-doc-design` read from the requested absolute paths; no registry available. Runtime default model; no explicit model configuration.
- Full pre-edit task mirror saved and read back as Engram observation 2, topic `odd/weekly-sheets-diagnostic/tasks`; refresh after verification.
- Advisory 400-line budget exceeded for a cohesive implementation/test/guide unit; no minification or coverage removal, PR, Git initialization or commit.
- Native risk assessment unavailable: required an explicit untracked-file declaration. RDD remains off; no native review transaction or approval. Independent functional verification completed instead.
- Next: manually inspect the returned diagnostic in Apps Script when authorized; typed cell-error identity, real document access/structure and runtime compatibility remain unverified. No live Apps Script execution or deployment.
