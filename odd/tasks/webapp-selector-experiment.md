# Controlled WebApp selector experiment

## Objective and scope
Implement a manually executed, non-production `probarSelectorWebApp()` experiment. Reuse the diagnostic configuration, target the exact `WebApp` tab and H4 only, preserve existing functions and the read-only diagnostic. No remote execution, BigQuery, source-tab reads, frontend changes, triggers, deployments, or report persistence.

## Constraints and acceptance
- Blank configurable test country; missing/equal country produces no writes.
- Script lock before original selector read; bounded acquisition and polling.
- Reject formulas; literal validation or manually supplied list without source-range reads.
- Compare all named rows and date candidate columns under an explicit total read budget.
- Guard each snapshot with selector observations, preserve typed cells and uncertainty.
- Always attempt restoration after a possible write; separately report primary/restoration errors and release lock.
- Return serializable differences and concise logs only. No claim of verified country, freshness, completeness, or recalculation.
- Document exclusive editing, forced-cancellation recovery and manual comparison.

## Tasks
- [x] T1: Implement isolated experiment, shared configuration update, synthetic tests and operator guide; run both test suites.
- [x] T2: Independently verify safety, failure paths, complete candidate coverage and instructions; record results.

## Verification and workflow
TDD: not configured in inspected project; ordinary functional checks, not strict TDD. Runner: `node --test tests/*.test.cjs`.
Receipt-driven development: off (default). Independent functional verification required if assessment unavailable.
Delivery strategy: ask-on-risk; no PR or push requested. Commits not authorized explicitly; leave changes local and uncommitted.
Forecast: implementation and tests may exceed 400 lines; prioritize cohesive readable behavior and full safety coverage, no artificial compression.
Initial state: all existing project files untracked on master. Preserve unrelated contents.
Rollback: remove new experiment/test/guide and revert only experiment configuration/documentation edits; do not remove prior diagnostic.

## Evidence and next step
Inspected existing scripts, tests and docs before editing. No manifest found or added. Changed the shared exact tab from `2) Weekly por pais` (without external spaces) to `WebApp`; no trimming/fuzzy lookup. WebApp means the tab, not an endpoint. No live tab inspection performed.

### Implemented local work unit
- Added `PruebaSelector.gs` with public `probarSelectorWebApp()`, reusing shared configuration and typed read helpers. The original diagnostic functions and first-four read-only sampling behavior are preserved.
- Added shared experiment defaults: blank test country, empty manual country allowlist, 1,000 ms lock wait, 1,000 ms poll interval, 15,000 ms deadline, 5 attempts, 500,000 total cell-field reads plus validation. Destination invariants reject anything except WebApp/H4.
- Script lock precedes original selector read. Formula selectors and formula-like requested/restoration literals fail before writing. Blank/equal requests produce no writes. Range validation never requests criteria values or source metadata/content; it requires a manually copied allowlist.
- Baseline/polls cover all named rows and every typed-Date candidate column, preserving typed values, display, formula/status and coordinates. Complete-plan budget preflight rejects before writing; dynamic budget exhaustion fails rather than truncates. Four reads are reserved for restoration verification.
- Selector guards surround snapshots and precede the write. Polling is interval/deadline/attempt bounded. Possible write is recorded before setValue; finally restores the original and verifies the selector, then releases the lock even if restoration fails. Primary, restoration and release errors are separate.
- Added `tests/PruebaSelector.test.cjs` and `PRUEBA_SELECTOR.md`. Updated only tab expectations in diagnostic tests and shared-tab/config explanation in `DIAGNOSTICO_SHEETS.md`; original regression expectations remain intact.

### Observed verification
All commands ran locally in the foreground with synthetic services; no original application function was evaluated.

| Command | Observed result |
|---|---|
| `node --test --test-name-pattern="normalization" tests/PruebaSelector.test.cjs` | 1 passed, 0 failed, 0 skipped; LF, no BOM/trailing whitespace, final newline verified before final suites. |
| `node --test tests/DiagnosticoSheets.test.cjs` | Final run: 24 passed, 0 failed, 0 skipped, 0 cancelled. |
| `node --test tests/*.test.cjs` | Final run: 66 passed, 0 failed, 0 skipped, 0 cancelled. |

Earlier implementation run: diagnostic 24/24 and combined 62/62 passed, with no failures/skips. Added further coverage afterward for all named rows, attempt limits, post-edit budget exhaustion and normalization. Failure-path evidence is synthetic injection: no lock; initial formulas; literal/range rejection; uncertain applied write, flush and poll errors; unexpected selectors before/after baseline and polls; restoration mismatch/failure and release failure; budget/deadline exhaustion. All expected error assertions passed. There is no known failing baseline and no claimed strict TDD history.

Original `Index.html`, `Web.gs.txt` and `ReportePaises.gs.txt` SHA-256 checks passed unchanged in both final suites. Runtime harness: synthetic Apps Script service boundary only; actual Apps Script execution/deployment not performed or authorized. No BigQuery, remote access, source-sheet reads, frontend/AI/triggers, SDD, review commands, commits, pushes or PRs.

### Limits, workflow and handoff
- Equal observations mean observed stability only; unchanged baseline is inconclusive. Country correspondence, freshness, completeness, recalculation, restored-data recalculation and snapshot atomicity always remain unverified. Flush applies pending edits only.
- Script lock cannot exclude humans/other projects; selectors can change and revert between observations. Restoration can overwrite a concurrent editor. Exclusive editing is required. Service calls can overrun local deadline checks; forced cancellation can bypass finally and require manual H4 restoration.
- Returned details are serializable per-attempt timings and coordinate before/after diffs; full matrices are not logged or persisted. Guide explains debugger inspection at the final return after cleanup, manual comparison and recovery.
- `skill_resolution`: paths-injected; loaded exact `C:\Users\juan.aguirre\.config\opencode\skills\work-unit-commits\SKILL.md` and `C:\Users\juan.aguirre\.config\opencode\skills\cognitive-doc-design\SKILL.md` before work. One cohesive local work unit exceeds the advisory 400-line size; coverage/readability retained. Higher-priority explicit authorization boundary means no commit was created.
- Rollback boundary: remove experiment/test/guide, remove experiment options and revert authorized shared-tab/test/doc references if rolling back this work unit; preserve the prior diagnostic and original bytes. Task tracking can be reverted separately.

### Independent verification and final readback
An independent read-only worker inspected implementation, shared helpers, both suites and guide: no demonstrated defect. `node --test tests/*.test.cjs`: 66 passed, zero failed/skipped/cancelled. Parent repeated the same command: 66 passed, zero failed/skipped/cancelled (262 ms).
Native risk assessment was unavailable because repository files are untracked; no review transaction was started, and RDD remains off. Independent functional checking was used, not a fabricated review approval.

Re-verified 2026-09-19 in a later session: `node --test tests/*.test.cjs` → 66 passed, 0 failed, 0 skipped (328 ms). No manifest found (`appsscript.json` absent); configured destination remains exact `tabName: 'WebApp'`, `selector: 'H4'`, no trimming. No code, test, guide or config changes made in that session.

Next: operator performs the controlled Apps Script experiment using the guide after confirming exclusive editing and exact live tab name. Apps Script testing, deployment and live operations remain unperformed. Full task content is mirrored under Engram topic `odd/webapp-selector-experiment/tasks` in project `herramientaweekly`.

