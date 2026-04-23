# Ralph Loop Prompt — pbinfo-scrape full archive fix

You are Claude, iterating inside a ralph loop on the repo `C:\Users\Prekzursil\Documents\GitHub\pbinfo-scrape`. Your mission: bring the repo from its current broken state to a fully working, tested, fresh-snapshot archive of pbinfo.ro for user `Prekzursil`, with a rebuilt Coverage Explorer and an embedded live-site viewer. Ship in one big-bang branch (`feat/full-archive-fix-20260423`).

## Every iteration — read these first

1. **Spec:** `docs/superpowers/specs/2026-04-23-pbinfo-full-archive-fix-design.md`
2. **Plan:** `docs/superpowers/plans/2026-04-23-pbinfo-full-archive-fix-plan.md`
3. **Progress ledger:** `.claude/ralph/pbinfo-archive-fix.progress.md` (you maintain this)
4. **Open questions:** `.claude/ralph/pbinfo-archive-fix.open-questions.md` (log blockers here, do not stall)

If the spec or plan is missing or inconsistent with what you are about to do, STOP and reconcile them first via plain file edits — do not skip them.

## Non-negotiable rules

1. **TDD.** Write the failing test first, confirm it fails, implement, confirm it passes. `npm test -- <file>` and `npm run verify` are your workflow. Never silence a failing test to make progress.
2. **Coverage thresholds.** `.coverage-thresholds.json` is source of truth. Do not commit a step that drops below the declared thresholds (global or per-module).
3. **Commits.** Conventional-commits format. One focused commit per completed plan step (or a tightly related cluster). Include the step id (e.g. `Refs: plan step 1.3`) in the body. Never use `--no-verify`, `--no-gpg-sign`, `git push --force`, or `rm -rf` inside `archive/snapshots/`. If a pre-commit hook fails, fix the root cause.
4. **Credentials.** The password `Prekzursil1234` may only exist in `.local/pbinfo.local.json` and inside `archive/secrets/*.age`. If it appears in source code, commits, logs, or `output/`, stop and scrub. `.local/` must stay in `.gitignore` at all times.
5. **Scope.** Stay inside declared file scope from the plan. Do not touch `.beads/`, `acceptance-20260310b/`, unrelated modules, or this prompt unless the plan explicitly calls for it.
6. **Archive-truth wording.** Use `not-captured-yet` vs `not-available-upstream` vs `restricted-upstream` correctly. Never imply pbinfo is missing content when we just haven't captured it yet.
7. **Small context.** Prefer editing existing files over creating new ones. Read only the files you need for the current step.

## Per-iteration protocol

1. Open the progress ledger. Find the first row whose status is not `done`.
2. Open the plan section for that row.
3. Open the spec section that section references.
4. Mark the ledger row `in_progress`.
5. Write the failing test(s) for the step first. Run them, see red, confirm they fail for the right reason (not a syntax error).
6. Implement the minimum code to make them pass.
7. Run the narrowest relevant verify command (e.g. `npm test -- <path>`). If green, run `npm run verify` and confirm still green.
8. If coverage drops below thresholds, fix by adding tests — never by loosening thresholds without documenting why in the open-questions file.
9. Commit with a conventional-commits message referencing the step id.
10. Mark the ledger row `done` and note the commit short-sha.
11. If blocked by a design question you cannot answer from the spec, append a paragraph to the open-questions file tagged `BLOCKER: step N.M` and jump to a different unblocked step. Do not stall the whole loop.
12. If you iterate three times on the same step without measurable progress, append `ESCALATION: step N.M` with a detailed blocker note and surface it in your response summary so the human operator can intervene.

## Safety exits — do NOT emit the completion promise if any of these are true

- `npm run verify` is failing.
- `npm run test:desktop-electron` is failing.
- `npm run smoke:desktop-packaged` is failing.
- Coverage thresholds in `.coverage-thresholds.json` are not met globally or per-module.
- The fresh crawl (plan phase 5.1) has not run end-to-end without a fatal error.
- Coverage Explorer is missing any agreed filter / sort / row icon / detail-pane capability from spec §3.6.
- Browse tab does not resolve at least one real underlink locally in the packaged app.
- Password or raw cookies appear outside `.local/` or `archive/secrets/*.age`.
- There are uncommitted changes or untracked work the operator hasn't opted into.

## Completion signal

When every Phase 0–6 row in the progress ledger is `done`, every gate above is green, and every acceptance criterion from spec §5 is satisfied, emit this exact line at the start of your final reply:

<promise>ARCHIVE-FIX COMPLETE</promise>

Then write a five-bullet summary with the commit short-shas for each phase, the final fresh snapshot id, and any open-questions items that remain parkable.

## What success looks like

- `feat/full-archive-fix-20260423` branch contains a sequence of small commits ordered by plan step.
- A new snapshot directory `archive/snapshots/fresh-YYYYMMDD-full/` exists with `normalized/`, `mirror/`, and `tests/` populated per spec §5.
- `archive/catalog.json` lists the new snapshot alongside `acceptance-20260310b`.
- Coverage Explorer shows the correct truthful state for the spot-check problem ids in plan §5.4.
- The packaged Electron app's Browse tab loads `http://127.0.0.1:<mirrorPort>/probleme/3171/waterreserve` and resolves at least one underlink locally.
- `npm run verify`, `npm run test:desktop-electron`, `npm run smoke:desktop-packaged` all green.
- No secrets in git.
