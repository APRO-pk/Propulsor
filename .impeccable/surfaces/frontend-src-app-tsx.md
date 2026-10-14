---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: ["frontend/src/styles.css", "frontend/src/RequirementsWindow.tsx", "frontend/src/FloatingWindow.tsx", "frontend/src/ContourView.tsx", "frontend/src/EngineViewer.tsx", "frontend/src/SpecSheet.tsx"]
---

# Propulsor app shell

## Scope and mode
The desktop app shell (top bar, a left panel holding the feature tree that drills into a part, the always-on 3D viewport, a floating Results window, status line; plus the separate Requirements window and the full-window Contour view), the global component styles every subsystem view inherits, and the Spec sheet presentation mode. Mode: **Operate** (Spec sheet is a presentation view inside it). Build path: code-led (no image generation). Approved sketches: .impeccable/mocks/workbench-sketch.html and .impeccable/mocks/specsheet-sketch.html (both approved by the user, 2026-10-14).

## Audience and job
University teams, hobby builders and startup engineers in long solo sessions and screen-shared team reviews. Job: keep the engine in view while selecting a part, editing its inputs and reading results; present the design as a board in reviews.

## Constraints
- User rejected the blueprint/neon shell as "too much everywhere"; wants "sleek but engineering advanced", calibre of Siemens NX / Ansys / Onshape with SpaceX / Tesla restraint. Bold treatment only in the 3D viewport.
- Two panels only (user, 2026-10-14: "too many panels"): no right-hand inspector. Requirements open in their own window with Solve; Performance, Cooling jacket, Injector & structure, Turbomachinery, Feed, Control and Studies drill into the left panel, with their results in a movable window over the stage; Contour opens full-window; Vehicle has no side panel content beyond the tree.
- Every subsystem view stays reachable from the feature tree; keyboard-operable tree; WCAG AA; works from 900×640 to wide desktop.
- Always-on WebGL must render on demand except while something animates; reduced motion respected.
- Fonts self-hosted (offline desktop app). Printed report stays light.
- Readout units toggle says what it scopes; solve state and failed checks stay visible.

## Direction contract
THESIS: A CAD workbench where the engine never leaves the screen: calm graphite instruments around one live 3D engine, and a one-key switch that turns the same engine into a monochrome spec-sheet board. Refuses the neon HUD, the rounded-card SaaS dashboard, and the grey Qt workbench.

OWN-WORLD: Neutral graphite chrome (#121417 ground, #181a1e panels, 1px #2a2e35 rules), Sofia Sans throughout with tabular numerals, 4–5px radii, no glows, no grids or brackets on panels. One steel-blue accent (#78a9e6) only for selection, focus and Solve. Heat colour exists only inside the viewport (hot gas, plume). Spec sheet: pure black board, white/grey monochrome render, Archivo Expanded headings, hairline leaders with end dots, metric bold over faded imperial.

STORY: The engineer sets requirements in their own window and hits Solve; the workbench picks up the engine. They pick a part in the tree, the left panel drills into its inputs, the engine highlights the part and refits beside a floating Results window, and the Results window plots the part along the axis above its numbers; in a review they press Spec sheet and present the same engine as a numbered board, then export it.

FIRST VIEWPORT: Top bar 44px: brand, design identity + spec (propellant, F, Pc, O/F), New/Open/Save, Undo/Redo, accent Solve, SI/Imperial units, a checks bell with a count badge (opens the findings list), help. Left 340px panel (320 ≤1279, 300 ≤1099): feature tree with status dots and filter; selecting a part drills in (back link, crumb, title, Show/Hide results, the part's inputs, Outcome headline numbers at the foot). Centre: always-on 3D engine (half section, hot gas, plume), display-mode segmented control top-left (Shaded · Hot gas · Stress · Flow · Spec sheet) with Section/Plume/Channels toggles, dimensioned section inset top-right (hidden while Results is open), temperature legend bottom-left. Results: a draggable, resizable window docked top-right of the stage (≤460px, 46% on narrow stages); the camera refits the engine into the uncovered width. No drawer (user, 2026-10-14: remove it; drop tiers entirely): the stage runs to the status line. Status line 26px: solve state in plain words, failed check (opens the checks list), backend.

FORM: User-pinned direction from the shape round (workbench sketch + Spec sheet sketch, both approved). The earlier concept roll (seed key d4188467) and the blueprint build are superseded.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- Subsystem views keep their internal compositions; inputs and results are split at runtime row by row (roles.ts), not recomposed by hand.
- The Tauri WebviewWindow path for Requirements is untested; in a browser Requirements open in-app (verified).
