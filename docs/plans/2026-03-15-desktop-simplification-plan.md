# Desktop Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the Problem Archive Crawler desktop UI so the default experience is lightweight and easy while preserving all existing workflows.

**Architecture:** Keep the existing app state and IPC contracts, but reorganize the renderer into a compact header plus a four-tab shell (Overview, Coverage, Data, Setup). Keep Overview as the only default surface, move low-frequency and setup-heavy controls into Setup, and collapse mirror/log detail behind deliberate toggles.

**Tech Stack:** React 19, Vite renderer, Electron shell, Vitest, Testing Library.

---

### Task 1: Lock the new UX in renderer tests

**Files:**

- Modify: `tests/gui/renderer-smoke.test.tsx`
- Test: `tests/gui/renderer-smoke.test.tsx`

**Step 1: Write failing expectations for the simplified shell**
Add checks for:

- Overview / Coverage / Data / Setup tab buttons
- default Overview heading
- Profiles & access moved behind Setup
- Coverage Explorer and Data Explorer not both occupying the default landing surface
- embedded mirror preview controlled by a toggle

**Step 2: Run the renderer smoke test to verify it fails**
Run: `npx vitest run tests/gui/renderer-smoke.test.tsx`
Expected: FAIL because current dashboard still shows the old all-panels layout.

**Step 3: Keep the failure output for comparison**
Note which old headings are still present (for example Profile Login and Import on the default view).

### Task 2: Implement the simplified dashboard shell

**Files:**

- Modify: `src/gui/renderer/dashboard.tsx`
- Modify: `src/gui/renderer/styles.css`

**Step 1: Add local tab state in the dashboard shell**
Create a small internal view model for:

- `overview`
- `coverage`
- `data`
- `setup`

**Step 2: Replace the oversized hero with a compact status header**
Show only:

- product name
- snapshot id
- active profile
- status chip
- refresh action

**Step 3: Build the Overview tab**
Include only:

- snapshot health cards
- quick actions
- mirror access
- compact recent activity
- optional embedded mirror preview toggle

**Step 4: Move setup-heavy panels into Setup**
Group together:

- workspace summary
- profile list
- login/import forms
- advanced settings

**Step 5: Keep Coverage and Data as dedicated tabs**
Render existing `CoverageExplorerPanel` and `DataExplorerPanel` without changing their data contracts.

**Step 6: Reduce visual weight in CSS**
Simplify spacing, reduce decorative density, and make the default screen feel flatter and lighter.

### Task 3: Align desktop smoke expectations with the new shell

**Files:**

- Modify: `src/gui/main/index.ts`
- Modify: `tests/gui/desktop-electron-smoke.test.ts`

**Step 1: Update the desktop smoke probe expectations**
Check for the new tab shell and Overview default instead of relying on old default headings.

**Step 2: Keep existing deep explorer verification**
Do not remove workspace / coverage / data validation; make the probe interact with the new tabs if necessary.

### Task 4: Verify, then refine if needed

**Files:**

- No new files unless needed for small helpers

**Step 1: Run targeted tests**
Run: `npx vitest run tests/gui/renderer-smoke.test.tsx tests/gui/desktop-electron-smoke.test.ts`
Expected: PASS

**Step 2: Run the full required verification**
Run:

- `npm run verify`
- `npm run test:desktop-electron`

Expected: PASS

**Step 3: Optional packaging smoke if main-process behavior changed materially**
Run: `npm run smoke:desktop-packaged`
Expected: PASS

**Step 4: Commit**

```bash
git add docs/plans/2026-03-15-desktop-simplification-design.md docs/plans/2026-03-15-desktop-simplification-plan.md src/gui/renderer/dashboard.tsx src/gui/renderer/styles.css src/gui/main/index.ts tests/gui/renderer-smoke.test.tsx tests/gui/desktop-electron-smoke.test.ts
git commit -m "feat: simplify desktop dashboard shell"
```
