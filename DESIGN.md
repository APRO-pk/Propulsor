---
name: Propulsor
description: Liquid rocket engine design workbench; calm graphite instruments around one live 3D engine.
colors:
  stage-black: "#0d0e10"
  graphite-ground: "#121417"
  graphite-panel: "#181a1e"
  graphite-raised: "#1f2227"
  graphite-pressed: "#272b31"
  field-well: "#0f1114"
  field-edge: "#686f7a"
  rule: "#2a2e35"
  rule-strong: "#3d424a"
  ink: "#e9ebee"
  ink-2: "#b8bdc5"
  ink-3: "#8f959e"
  ink-faint: "#7b828c"
  steel-blue: "#78a9e6"
  steel-blue-light: "#a9c8f0"
  on-solid: "#0d1118"
  heat: "#ff7a2e"
  heat-2: "#ffb066"
  heat-3: "#ffe9cf"
  ok: "#5fbf8b"
  warn: "#d9b45a"
  fail: "#e5636a"
  series-violet: "#a99be6"
  oxidiser: "#8fb4e8"
  fuel: "#e0b062"
  sheet-black: "#050505"
  sheet-ink: "#f2f2f2"
  sheet-grey: "#bdbdbd"
  sheet-faded: "#6e6e6e"
  sheet-rule: "#5a5a5a"
typography:
  headline:
    fontFamily: "Sofia Sans Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.4
  title:
    fontFamily: "Sofia Sans Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Sofia Sans Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  caption:
    fontFamily: "Sofia Sans Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Sofia Sans Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0.06em"
  readout:
    fontFamily: "Sofia Sans Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  sheet-display:
    fontFamily: "Archivo Variable, Sofia Sans Variable, system-ui, sans-serif"
    fontSize: "clamp(28px, 2.9vw, 42px)"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 125"
  sheet-cap:
    fontFamily: "Archivo Variable, Sofia Sans Variable, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 125"
  sheet-stat:
    fontFamily: "Archivo Variable, Sofia Sans Variable, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "5px"
  overlay: "6px"
  window: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  topbar: "44px"
  statusline: "26px"
  left-panel: "340px"
  value-column: "108px"
  unit-slot: "52px"
  select-span: "164px"
components:
  button-solve:
    backgroundColor: "{colors.steel-blue}"
    textColor: "{colors.on-solid}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "28px"
  button-solve-hover:
    backgroundColor: "{colors.steel-blue-light}"
  button-action:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 9px"
    height: "28px"
  button-action-hover:
    backgroundColor: "{colors.graphite-pressed}"
    textColor: "{colors.ink}"
  button-tool:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 11px"
    height: "28px"
  button-tool-hover:
    backgroundColor: "{colors.graphite-pressed}"
  input-number:
    backgroundColor: "{colors.field-well}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "26px"
    width: "{spacing.value-column}"
  select-unit:
    backgroundColor: "{colors.field-well}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    height: "26px"
    width: "{spacing.unit-slot}"
  select-choice:
    backgroundColor: "{colors.field-well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "26px"
    width: "{spacing.select-span}"
  tree-row:
    textColor: "{colors.ink-2}"
    height: "28px"
  tree-row-selected:
    textColor: "{colors.ink}"
  segmented-pressed:
    backgroundColor: "{colors.graphite-pressed}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  results-window:
    backgroundColor: "{colors.graphite-panel}"
    rounded: "{rounded.window}"
  statusline:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.ink-3}"
    height: "{spacing.statusline}"
---

# Design System: Propulsor

## Overview

**Creative North Star: "The Quiet Workbench"**

A CAD workbench where the engine never leaves the screen. Graphite chrome, hairline rules and small, dense type frame one live 3D engine; the only intensity in the product is inside that viewport, where hot gas and the plume burn orange-white. Everything outside the stage is instrument: tabular numbers, aligned value columns, one steel-blue accent for what is selected, focused, or about to be solved.

The same engine has a second register. One key turns it into the Spec sheet: a pure-black presentation board, monochrome render, expanded Archivo headings, hairline leaders, metric figures over faded imperial. It is a separate world with its own palette and face, used only for that mode.

Density is high and desktop-first (900×640 up to wide). Panels are flat, separated by 1px rules rather than cards. Confirmed rejections: the neon blueprint HUD with glows, grids and brackets on every panel; the rounded-card SaaS dashboard; the grey Qt workbench.

**Key Characteristics:**
- Two panels only: a left drill-in panel and the stage; no right inspector.
- Bold only in the 3D viewport; chrome stays calm graphite.
- One accent (steel blue) for selection, focus and Solve.
- Status colours mean pass, warn or fail and nothing else.
- Tabular numerals everywhere; inputs share one value column.
- Spec sheet is a distinct monochrome board, not a theme of the workbench.

## Colors

A five-step graphite ladder with cool grey ink, one steel-blue accent, heat reserved for the viewport, and three state colours.

### Primary
- **Steel Blue** (steel-blue): selection (tree row tint and 2px bar, 3D outline tube, lit drawing zone, annotation label), focus rings, the Solve button, pressed tool buttons, the custom-value dot, caret and native accent colour. Lighter **Steel Blue Light** is Solve's hover. The soft tint (`rgba(120,169,230,0.14)`) backs selected rows and focus halos.

### Tertiary
- **Heat** (heat, heat-2, heat-3): hot gas, plume, warm rim light and the temperature legend bar. Lives in the viewport and its legend.

### Neutral
- **Stage Black / Graphite Ground / Panel / Raised / Pressed** (stage-black through graphite-pressed): ground, panels (top bar, left panel, status line, Results window), raised tool buttons, and the pressed/hover fill.
- **Field Well** (field-well): inside of every input and select; darker than the panel so values sit in a recess.
- **Rule / Rule Strong** (rule, rule-strong): 1px panel dividers; control borders and segmented-control seams.
- **Ink ladder** (ink, ink-2, ink-3, ink-faint): values and headings; labels; secondary text, captions, axis ticks; placeholders and disabled.
- **Stage gradient**: the viewport ground is a radial falloff `#1c1f24 → #121417 → #0b0c0e`, the only gradient in the chrome.

### State and data
- **OK / Warn / Fail** (ok, warn, fail) with 13% soft fills: tree status dots, check tags, solved/stale/failed badges, pass/fail values in Outcome, the failed-check and offline notices in the status line.
- **Oxidiser / Fuel** (oxidiser, fuel): propellant identity, shared by P&ID and 3D. **Series Violet** (series-violet): a categorical chart series in older subsystem views.
- **Ordered sweep ramp**: `#c4dbf6 #9cc2ef #78a9e6 #5689cc #3b6aa8`, light (lean) to deep (rich), one hue around the accent (Performance map O/F lines).

### Spec sheet
- **Sheet Black / Sheet Ink / Sheet Grey / Sheet Faded / Sheet Rule**: the board, primary figures, body and leaders, imperial values, and 1px rules. No accent, no state colour, no heat.

### Named Rules
**The One Accent Rule.** Steel blue marks selection, focus and Solve. If it is not one of those, it is not blue.

**The Heat Stays Inside Rule.** Orange appears only where the engine is hot: the viewport's gas, plume and rim light, and the legend that reads them.

**The Status Means Status Rule.** Green, amber and red report pass, warn and fail. Ordered series take the single-hue accent ramp; never a red-to-green scale.

## Typography

**UI Font:** Sofia Sans Variable (with Segoe UI, system-ui), self-hosted via @fontsource, tabular numerals on body.
**Sheet Font:** Archivo Variable at width 125 (expanded), Spec sheet only.

**Character:** Sofia Sans is narrow and technical enough to fit long engineering labels at 13px; Archivo Expanded gives the presentation board a drafted, engraved title block.

### Hierarchy
- **Headline** (700, 18px): drilled part title, full-window view title.
- **Title** (600, 13px): Results window and dialog headers, design name, selected tree row.
- **Body** (400–500, 13px, 1.4): labels, values, buttons. Values are 600 in ink.
- **Caption** (12.5px, ink-3): part descriptions, readout keys, status line (12px).
- **Label** (600, 11.5px, +0.06em, uppercase, ink-3): fieldset legends, figure titles, tree head, Outcome heading. Names the group it sits on; never an eyebrow above a headline.
- **Readout** (600, 22px, -0.01em): Outcome headline numbers, unit in 12.5px ink-3.
- **Sheet display / cap / stat**: Archivo expanded 800 title; 700 11px caps for column heads and leader numbers; stats in 24px sheet ink over imperial at 19px sheet-faded.

### Named Rules
**The Tabular Rule.** Every number aligns: tabular numerals on body, inputs and drawings.

**The Second Face Rule.** Archivo appears only on the Spec sheet. The workbench is Sofia Sans throughout.

## Layout

The shell is a CSS grid: 44px top bar; a left panel (340px, 320px at ≤1279, 300px at ≤1099) beside the stage, which runs down to a 26px status line across the bottom. There is no drawer: a part's axial charts (wall temperature, heat flux, coolant, wall stress) sit in tabs at the top of its Results window; design checks are a bell in the top bar (count badge red for failures, amber for advisories) opening a list that links each finding to its part; SI / Imperial readout units sit in the top bar. Solve state is stated in plain words ("Solved", "Out of date — press Solve"), never as tier names.

- **Left panel** shows the feature tree; selecting a part drills in: back link, crumb, headline, Show/Hide results, the part's inputs, Outcome numbers pinned at the foot. Vehicle shows only the tree.
- **Stage** is the always-on 3D engine. Display-mode segmented control and toggles sit top-left; the section inset sits top-right and hides while Results is open; legends bottom-left. The "Drag to orbit · scroll to zoom" hint teaches once: it goes after the first orbit or zoom and stays away (remembered per user). Stage responds by container query (≤860px moves the inset down, ≤520px strips overlays).
- **Results** is a non-modal window over the stage, docked top-right below the toolbar (default ~48% of the stage, ≤560px; min 320×200; the size the user sets is remembered per user). Drag by the title; resize from any edge or corner; window controls: minimise (title bar docked bottom-right), fill the stage (also double-click the title), full screen over the workbench between top bar and status line, close. Esc leaves full screen / fill first, then closes. It renders at the shell level (the stage's container queries would trap a fixed full-screen window) and reports the width it covers while right-anchored, so the camera refits the engine into the free space.
- **Requirements** live in their own window in the desktop app (Tauri WebviewWindow "requirements", synced over the "propulsor" BroadcastChannel); in a browser they open full-window inside the app (never a pop-up tab: closing one strands the user outside the workbench). Solve sits in the footer. Their decisions (feed type, shaft speed, burnout altitude, expansion strategy) live in the design's param/choice bag, so they are saved with it and match the Feed, Control and Turbopump tabs.
- **Contour** takes the full window between top bar and status line: two drawing columns plus a 300px Outcome aside, single column ≤1099px.
- **Inputs/Results split** happens at runtime per row: views mark rows `data-role` inputs/results; the left panel shows inputs, the Results window results. The hide rule uses `!important` to beat inline display styles. A field or a `<label>` wrapping its caption and control stays whole (the caption never leaves its input); a standalone action button such as "Run sweep" is an input, and so is any Import button; exports, downloads, reports and templates are results.

### Verdicts and series colour
A passing value is tinted text (`.qt-badge.solved`, ok green), never a box; only a failure is boxed (`.qt-badge.failed`, solid red), and a caveat is amber text (`.qt-badge.caveat`). Chart series never use pass/fail colours: series are the accent and violet (ordered sweeps use the accent ramp), a reference such as an optimum or recommendation is a dashed `--ink-3` line, the current design is a solid `--ink` line, and red/amber appear only for limits and failures. Schematic lines (pressurant, P&ID) are neutral ink; only high voltage keeps hazard red. The status line names the failed-check count in red and the message in ink. Floating windows carry a soft shadow (0 10px 28px at 38%); stage chips are opaque graphite, no blur.

### Type roles and spacing tokens
Workbench type sizes are role tokens on `:root`, never raw values: `--t-readout` 22px (headline numbers), `--t-title` 18px (part and full-view headings), `--t-heading` 15px (window and dialog headings), `--t-body` 13px (fields, controls, values, prose; body weight 430 on graphite), `--t-small` 12px (metadata, chrome, dense tables, stage overlays; +0.01em tracking), `--t-label` 11.5px (uppercase tracked group labels), `--t-micro` 11px (tags, counts, chart ticks; the floor, nothing smaller). The Spec sheet keeps its own Archivo scale. Spacing runs on `--s-1` 4 / `--s-2` 8 / `--s-3` 12 / `--s-4` 18 with a 14px `--gutter` at panel edges: groups sit 18px apart with 8px under their label, so a group heading has more space above than below. A field whose control is a row of option buttons keeps its caption on one line and wraps the options inside the value side, right-aligned; a group's closing action sits in `.qt-actions`, right-aligned under the value column. Dimension leaders on the stage never cross the toolbar, inset, legend or a window; a label with no clean placement hides.

### Field rhythm
One value column: number inputs are 108px (92px in the left panel ≤1279), followed by a 52px unit slot (48px ≤1279); selects span both (164px / 144px); inputs without a unit reserve the slot so every right edge lines up. Rows are 30px minimum, labels wrap with `text-wrap: balance`, and the custom-value dot is bound to the label's last word so it never orphans. Field edges use `--field-edge` (#686f7a, ≥3:1 on every surface a field sits on, WCAG 1.4.11), never the hairline rule colour. Spacing runs on 4 / 8 / 12 / 18px.

### Focus and covering surfaces
Anything that covers the workbench takes focus and makes what it covers `inert` (`a11y.ts`: `useInert`, `useReturnFocus`): the in-app Requirements editor focuses its heading and returns focus to the Requirements button; the Contour view returns to the selected tree item; the Results window makes the stage inert when it fills it and the left panel too in full screen, and its title bar moves with arrow keys and resizes with Shift+arrows. The Checks list takes focus on open and closes when focus leaves it; when the solver returns no checks it says so ("Checks couldn't run", with a retry) rather than "All checks pass". Every chart carries a one-sentence text summary (`role="img"`).

### Sizes, zoom and touch
The window's minimum is 900×640; the layout is verified down to the 720×512 CSS px that 125% zoom makes of it, and up to 1920×1080. Ctrl/⌘ + / − / 0 step the desktop webview zoom (80–150%) and the level is remembered (`zoom.ts`; browsers use their own zoom). Below 1100px the top bar drops the revision and the Units caption before the design name; below 760px the left panel narrows to 280px. A stage narrower than 640px docks the Results window along its bottom, full width, and the camera fits the engine into the band between the stage toolbar and the window; a narrow stage keeps its modes, toggles, legend and callouts, and only the section inset and orbit hint give way. On a coarse pointer (touch laptops, tablets) buttons, chips, tabs and fields grow to 34–40px, tree rows to 40px and the window grips to 18–28px; window move and resize work with touch.

### First run
The empty stage says what the four requirements do and offers two ways in (Set requirements, Open a saved design), then the example engines (`presets.ts`, shared with the Requirements editor), each of which loads and solves in one click so the engine ignites. Nothing is pre-filled: an example is the user's choice. A part opened before any engine exists says why it is empty and offers Set requirements. After the first engine appears, one card in the stage corner lists three next steps (pick a part, drag Ambient, Spec sheet); "Got it", Esc, or opening a part dismisses it for good (`propulsor.firstTips`), and Help replays it.

### Motion
One authored moment: **ignition**. On every solve (and when the engine first appears) the hot gas warms from ember red to its temperature colours and the plume grows out of the exit plane: 0.8 s, cubic ease-out, one shared `uIgnite` uniform in both shaders, frames requested only while it runs. Edits do not ignite; they re-solve quietly. Supporting motion explains state only: the camera glides the engine aside when a window opens or closes (0.38 s, quartic ease-out; a first fit, new engine or resized stage lands at once); the left panel slides 10px on drilling in (0.2 s) and out (0.16 s); the Results window scales in from its docked corner (0.18 s); the Checks list drops 4px (0.14 s); a number that changes after an edit glows in the accent and settles (0.9 s, `.fresh`). All use `--ease-out`. Reduced motion: no travel, scaling, plume growth or flicker; ignition becomes a 0.22 s brightness fade and the panels fade.

### The exhaust (physical plume)
The plume is the nozzle's expansion state, raymarched in a shader (`PhysicalPlume.tsx`, physics in `exhaust.ts`). An **Ambient** slider on the stage (sea level → 100 km = vacuum, U.S. Standard Atmosphere 1976) sets Pa; the readout names the state and Pe/Pa. From Pe, Me and γ the fully-expanded jet Mach Mj and diameter Dj follow (isentropic), and shock-cell spacing from Prandtl–Pack (1.306·Dj·√(Mj²−1)), capped at 1.6 exit diameters for display. Over-expanded the jet pinches with a sharp Mach disk at the first cell; below Pe/Pa ≈ 0.4 (Summerfield) the readout warns of separation in amber. Under-expanded it barrels out with recompression knots; in vacuum the cells vanish into a wide, dim bloom. Hot axis, cooler shear layer, knots hotter; premultiplied additive blending keeps empty gas transparent over the CSS stage. Ignition scales its length and brightness. Raymarch samples adapt 56 → 32 → 20 when frames run long; idle cost stays zero; without WebGL2 the previous lathe plume is used.

### Stage rendering budget
The 3D stage renders on demand. The plume flicker and flow particles are paced at 30 fps by `Pacer`, and only while someone works with the engine: after 12 s without pointer, wheel or key input over the viewport (or a design or mode change) they hold still and an idle stage costs nothing. Orbiting and zooming switch to the display-rate loop for as long as the pointer is down (or 250 ms after a wheel). The dimension callouts measure the DOM in one batch before writing, re-measure stage obstacles at most every 250 ms, skip all work while the camera and measurements are unchanged, and write only changed values. Reduced motion holds the plume still entirely.

## Elevation & Depth

Flat by default: panels are tonal steps of the graphite ladder separated by 1px rules. Shadows appear only on things that float above the stage.

### Shadow Vocabulary
- **Floating window** (`box-shadow: 0 18px 44px rgba(0,0,0,0.5)`): the Results window.
- **Dialog** (`box-shadow: 0 24px 60px rgba(0,0,0,0.55)`): help and overlay dialogs.
- **Stage overlays** use translucency, not shadow: `rgba(20–24,…,0.88–0.9)` on chips, inset and toolbar buttons (no blur). Annotation labels carry a 3px dark text-shadow for legibility over the render.

### Named Rules
**The No Glow Rule.** No glows, neon edges or coloured shadows anywhere in the chrome. Depth is tone, rule, and a single dark drop under floating windows.

## Shapes

Small, firm corners: 4px on fields, tags and keycaps; 5px on buttons, segmented controls and chips; 6px on stage overlays; 8px on floating windows and dialogs. Status dots and the custom-value mark are circles; the precision mark is a 7px rotated square outline. No grids, corner brackets or frames on panels.

Section drawings use hairlines: non-scaling strokes (1.25 walls, 1 dimensions), a dash-dot centreline, ~13–14px dimension text, neutral grey linework, and accent only on a selected zone. In 3D, selection is a thin accent tube traced on the outside of the wall: an outline, never a fill.

## Components

### Buttons
- **Solve:** solid steel blue, dark ink, 700 weight, 28px tall; lighter blue on hover; the icon spins while solving. One per surface.
- **Action (top bar):** transparent, ink-2, 28px; hover and pressed take graphite-pressed and full ink.
- **Tool:** graphite-raised fill with rule-strong border; pressed state (`.on`) is the accent soft tint with a 60% accent border.
- **Disabled:** ink-faint, no fill, not-allowed cursor.

### Segmented control and chips
- **Segmented:** rule-strong outline, 1px seams, 12px 500 ink-3 labels; the pressed segment fills graphite-pressed with full ink. Used for display modes and the readout-units toggle (labelled by what it scopes).
- **Stage chips:** translucent graphite with blur for Section / Plume / Channels toggles; on state brightens fill and border, no accent.

### Inputs / Fields
- **Style:** field-well fill, rule-strong border, 4px radius, 26px tall, right-aligned tabular values; selects left-aligned with a drawn chevron.
- **Focus:** accent border plus a 2px accent-soft halo.
- **Custom value:** a 5px accent dot after the label; reset restores the sourced default.

### Feature tree
28px rows indented 18px per level, status dot per part, filter field on top. Selected row: accent-soft tint, 600 weight, 2px accent bar at the left edge. Keyboard focus draws an inset accent outline.

### Outcome strip
Label heading, two Readout numbers with units, then key/value rows; pass/fail values take state colours. Shows nothing for parts without a single clear outcome.

### Results window
Graphite panel at 97% opacity, rule-strong border, 8px radius, floating shadow; 36px grab header with title and close; resizable from the corner; Esc closes.

### Spec sheet
Pure black board, monochrome metal render, numbered hairline leaders ending in white dots with black rings, Archivo expanded title block and caps, six-up stats with metric over faded imperial. Its own buttons are near-black with grey borders.

## Do's and Don'ts

### Do:
- **Do** keep heat colour inside the 3D viewport and its legend.
- **Do** use steel blue only for selection, focus and Solve.
- **Do** put new subsystem inputs in the shared field rhythm (108px value column, 52px unit slot, 164px selects) so the column lines up.
- **Do** mark every row of a new view so the runtime Inputs/Results split can route it; keep inline `display` off rows where possible.
- **Do** draw sections with non-scaling hairlines and accent only on the selected zone.
- **Do** use the single-hue accent ramp for ordered series.
- **Do** self-host fonts; the app runs offline.

### Don't:
- **Don't** add a right-hand inspector or a third panel; results go in the floating Results window.
- **Don't** add glows, neon, grid backgrounds or corner brackets to panels.
- **Don't** wrap panel content in rounded cards; separate with 1px rules.
- **Don't** use green, amber or red for anything but pass, warn and fail.
- **Don't** use Archivo or pure black outside the Spec sheet.
- **Don't** fill a selected 3D part with accent; outline it.
