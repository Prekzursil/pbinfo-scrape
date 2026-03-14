# Desktop Simplification Design

**Date:** 2026-03-15
**Approved direction:** Option A - Easy-mode dashboard with quick actions, Coverage-first, and tabs for Data and Setup.

## Problem
The desktop app exposes too many primary panels at once. Important actions, status, and browsing surfaces all compete for attention. The result is a powerful but heavy operator console.

## Goals
- Make the default screen easy to understand in under 10 seconds.
- Keep the main archive workflow obvious: check health, continue crawl if needed, build/open mirror, inspect coverage.
- Preserve all current functionality without removing power-user capabilities.
- Reduce visual weight and panel sprawl.

## Chosen design
### Shell
Replace the oversized hero with a compact top status header:
- product title
- active snapshot
- active profile
- one publish/health status chip

### Navigation
Use a lightweight tab row directly under the header:
- Overview
- Coverage
- Data
- Setup

### Overview
This becomes the default landing surface and contains only:
- snapshot health cards
- quick actions card
- compact mirror access card
- compact recent activity list
- optional embedded mirror preview collapsed behind a toggle

### Coverage
Keep Coverage Explorer as the main audit surface and make it the first detailed tab.

### Data
Keep Data Explorer for low-level structured inspection, but move it out of the default landing view.

### Setup
Move workspace/profile/auth/import/advanced controls into one place so they stop competing with the main archive workflow.

## UX rules
- Overview answers: Is the archive okay? What do I do next? Where do I browse it?
- Advanced diagnostics remain available, but never dominate the first screen.
- The UI must use archive-truth wording and not imply missing upstream content when the archive simply has not captured it yet.
- Embedded preview should be opt-in instead of always occupying a large region.

## Verification targets
- Renderer smoke confirms the simpler tabs and default Overview landing.
- Desktop smoke confirms the app still loads workspace state and dataset views.
- Full verify + desktop Electron smoke stay green.
