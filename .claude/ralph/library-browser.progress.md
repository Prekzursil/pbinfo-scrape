# Library Browser Redesign — Ralph Loop Progress

**Plan:** `docs/superpowers/plans/2026-04-23-library-browser-redesign-plan.md` (5,553 lines, 11 tasks)
**Branch:** `feat/full-archive-fix-20260423`
**Loop started:** 2026-04-23T15:17:15Z

## Safety gates (MUST be enforced on every iteration)

- **TASK-9-STOP-GATE**: Task 9 is the single destructive commit (deletes dashboard/app-shell/coverage-explorer/workspace-store + flips `sandbox: true`). Ralph MUST NOT execute Task 9 autonomously. After Task 8 is green, the loop stops and surfaces a user-approval ask before crossing this line.
- **TEST-REGRESSION-STOP**: If an existing test (not one I added this iteration) starts failing, STOP the iteration and surface the diff to the user.
- **COVERAGE-FLOOR-STOP**: If `.coverage-thresholds.json` `perModule` entries drop below floor, STOP and surface — this is a quality regression, not noise.

## Completion definition

The loop terminates ONLY when ALL of:
- [ ] Tasks 1–8 green (all commits pushed, `npm run verify` green)
- [ ] User explicitly approves Task 9 execution
- [ ] Task 9 green (packaged smoke green after destructive cut-over)
- [ ] Task 10 green (coverage threshold bump lands + gate passes)
- [ ] Task 11 green (E2E + packaged smoke measure all §12.3 metrics)
- [ ] User confirms visual inspection (light + dark palettes, drawer open, operator menu)

On that full success, emit the sentinel: `LIBRARY_BROWSER_REDESIGN_COMPLETE — all 11 tasks merged, verify green, user-confirmed visual pass`.

## Current position

- **Task:** 4 — LibraryShell scaffolding (non-virtualized)
- **Step:** 4.1 (write failing useFilters test)
- **Last committed:** `14274ad9d` (Task 2, verify green 335/335)

## Plan deviations

- **Task 3 deferred into Task 9.** The plan's Task 3 is a mechanical workspace→archive rename across `desktop-controller.ts` (957 LOC) + AppShell rewiring. This is strictly cleanup — `archive:state` (Task 1) already runs additively alongside `workspaceRoot`. The renames are only load-bearing at Task 9's destructive cutover, so bundling them with Task 9 avoids destabilizing the legacy shell and keeps mid-pipeline commits small. Rollout reordered: 1→2→4→5→6→7→8→(user approval)→Task-3-merged-into-9→10→11.

## Commit log

| SHA | Task | Summary |
|---|---|---|
| `1dd8e81f3` | plan | design spec + implementation plan |
| `668d3381b` | Task 1 | archive-resolver + empty-state shell |
| `14274ad9d` | Task 2 | theme token system + nativeTheme bridge |
| _pending_  | Task 4 | LibraryShell scaffold (non-virtualized) behind PBINFO_USE_LIBRARY_SHELL dev flag |

## Open questions / notes for user

- Pre-existing bug fixed as part of Task 1: `app-shell.tsx` had two `case 'problems':` labels that didn't match the `AppShellView` union. Switched to `case 'coverage':` for type soundness. This was a pre-existing blocker on `npm run typecheck`.
