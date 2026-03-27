# Jellyroll Battery Cell Designer — Claude Code Handoff Spec

## Project Overview

A single-page web application for designing and computing tab positions on wound cylindrical battery cells (jellyroll construction). The app simulates the variable-pitch spiral winding, computes where cathode and anode tabs will land after the drill-through tab placement process, and visualises the results in 4 views.

**Target deployment:** GitHub Pages  
**Stack:** Single `index.html` — all CSS, JS, and Three.js (CDN) inline. No build step, no framework, no backend.  
**GitHub repo name:** `jellyroll-designer`

---

## Physical Cell Context

This is a 220Ah cylindrical dry cell (Godrej & Boyce drawing DRG NO. 26111717SD00028).

| Parameter | Value |
|-----------|-------|
| Mandrel diameter | 10.75mm (10 + 0.75mm) |
| Finished OD | max 94mm |
| Cell height | 222mm REF |
| Cathode width | 188 ± 3mm |
| Anode width | 222mm REF |
| Nickel tabs (cathode) | 0.13 × 10mm NDS |
| Copper tabs (anode) | 0.08 × 6mm NDS |
| Tab terminal overlap | 2.65mm each side |

---

## Default Layer Stack

Listed innermost to outermost. These are the defaults loaded on startup.

| # | Name | Type | Thickness (mm) | Width (mm) | Length (mm) | Start Offset (mm) | Color hex |
|---|------|------|----------------|------------|-------------|-------------------|-----------|
| 0 | Mandrel | mandrel | 5.375 | 230 | 0 | 0 | #888899 |
| 1 | Anode | anode | 1.0 | 222 | 1800 | 30 | #16a34a |
| 2 | Kraft paper | separator | 0.15 | 228 | 2600 | 0 | #b45309 |
| 3 | Cellophane A | separator | 0.05 | 226 | 2440 | 0 | #38bdf8 |
| 4 | Cellophane B | separator | 0.05 | 226 | 2440 | 0 | #7dd3fc |
| 5 | Cathode | cathode | 2.0 | 188 | 1920 | 0 | #3b82f6 |
| 6 | Cellophane C | separator | 0.05 | 226 | 2590 | 0 | #38bdf8 |
| 7 | Cellophane D | separator | 0.05 | 226 | 2590 | 0 | #7dd3fc |
| 8 | Kraft paper 2 | separator | 0.15 | 228 | 2670 | 0 | #d97706 |
| 9 | PVA lam. | separator | 0.1 | 224 | 1862 | 0 | #a855f7 |

**Layer types:** `mandrel`, `anode`, `cathode`, `separator`, `collector`, `tape`, `other`

**Notes on thicknesses:** The cathode=2.0mm and anode=1.0mm values are assumed (not from drawing). Real measured values should replace these when available. All separator thicknesses are similarly assumed.

---

## Simulation Engine

### Core Parameters (user-editable)
- `mandrel_d` — mandrel diameter in mm (default 10.75)
- `target_od` — finished cell OD in mm (default 94)
- `cell_h` — cell height in mm (default 222)
- `tab_w` — tab width in mm (default 10)
- `tab_h` — tab height in mm (default 15)
- `skip_turns` — number of inner turns to skip before placing tabs (default 2)
- `cath_angle` — cathode drill angle in degrees (default 90)
- `anod_angle` — anode drill angle in degrees (default 270)

### Variable-Pitch Spiral Algorithm

```
r0 = mandrel_d / 2
r = r0
arc = 0   // cumulative arc length in mm
turns = []

WHILE r < target_od/2 AND n < 500:
    pitch = 0
    FOR each non-mandrel layer l:
        IF arc >= l.off AND arc < l.off + l.len:
            pitch += l.t
    IF pitch < 0.001: pitch = 0.001
    IF r + pitch > target_od/2: BREAK
    
    circ = 2 * PI * (r + pitch/2)   // circumference at midpoint of pitch band
    n += 1
    arc += circ
    r += pitch
    
    active = [layers where (arc-circ) >= l.off AND (arc-circ) < l.off+l.len]
    turns.push({ turn: n, r, arc, pitch, circ, active })
```

### Tab Placement Physics

The physical process is: wind the cell → drill holes on both sides at the drill angles → unwind → mark tab locations → re-wind with tabs attached.

**Cathode tabs** (at `cath_angle`, e.g. 90°):
- One tab per turn (after skipping `skip_turns` inner turns)
- Tab arc length = `turn.arc` (cumulative arc at end of that turn)
- Only place tab if the cathode layer is active at that turn

**Anode tabs** (at `anod_angle`, e.g. 270°):
- Same turns as cathode
- Tab arc length = `turn.arc + π × turn.r`
- The `π × r` offset = half circumference, because the drill exits the opposite side of the jellyroll
- Result: cathode and anode tabs at the same turn are physically on opposite sides of the cell

```javascript
// Cathode tabs
for (ti = 0; ti < turns.length; ti++) {
    if (ti < skip_turns) continue;
    t = turns[ti];
    tS = t.arc - t.circ;
    if (tS >= cathode.off && tS < cathode.off + cathode.len && t.arc <= cathode.off + cathode.len) {
        cTabs.push({ turn: t.turn, r: t.r, pitch: t.pitch, arcLen: t.arc, idx: cTabs.length + 1 });
    }
}

// Anode tabs
for (ti = 0; ti < turns.length; ti++) {
    if (ti < skip_turns) continue;
    t = turns[ti];
    tS = t.arc - t.circ;
    half = Math.PI * t.r;
    aArc = t.arc + half;
    if (tS >= anode.off && tS < anode.off + anode.len && aArc <= anode.off + anode.len) {
        aTabs.push({ turn: t.turn, r: t.r, pitch: t.pitch, arcLen: aArc, idx: aTabs.length + 1 });
    }
}
```

### Expected Simulation Output (default params)
- ~11 turns
- Computed OD ~88mm
- Pitch range: 2.60–3.60mm (variable because layers have different start offsets and lengths)
- 9 cathode tabs, 9 anode tabs, 18 total

---

## Views

The app has 4 views selectable via tab buttons: **Side | Top | Unroll | 3D**

All views share the same simulation state and layer stack. A single "Run simulation" button recomputes everything and refreshes the active view.

---

### View 1: Side View

A rectangular cross-section of the cell seen from the side.

**What to draw:**
- A rectangle representing the cell: width = OD, height = cell_h
- A shaded center band: width = mandrel diameter (the mandrel)
- Faint vertical lines at `cx ± t.r * sc` for each turn — these are the ring positions
- **Cathode tabs** (blue) protruding upward from the TOP edge, positioned LEFT of center at `cx - t.r * sc`
- **Anode tabs** (green) protruding upward from the TOP edge, positioned RIGHT of center at `cx + t.r * sc`
- Each tab is a thin narrow rectangle, pointing upward, labeled C1/C2... and A1/A2...
- Dimension annotations: cell height (right side), cell OD (bottom), mandrel diameter (bottom inner), tab height (left side)

**Key sizing logic:**
```
sc = min((availW - PAD_L - PAD_R) / (outerR * 2), (availH - tabHeight - PAD_BOT) / cellH)
tabWpx = avgPitchSpacingInPx * 0.6   // auto-sized so tabs align with turn rings
tabWpx = max(3px, tabWpx)
```

**Controls:** Strip height slider, Tab height slider, Show dimensions toggle, Show turn numbers toggle.

---

### View 2: Top View

Looking straight down at the top face of the cell.

**What to draw:**
- Mandrel as a filled grey circle at center
- For each turn, subdivide the pitch band among active layers. Each active layer gets an arc at `rMid = innerR + (bandW / nActive) * (layerPos + 0.5)` with `lw = bandW / nActive * arcThickMult`
- The arcs should show the actual START and END of each layer (not full circles) — partial arcs where the layer begins/ends mid-turn, with endpoint markers (white dot = start, colored dot = end)
- Outer cell boundary circle
- **Tab lines**: Both cathode and anode tabs point straight UP in canvas coordinates
  - Cathode tabs at `x = cx - t.r * sc` (left side), line from `y = cy` to `y = cy - tabLen`
  - Anode tabs at `x = cx + t.r * sc` (right side), same vertical line
  - Arrow tip at top, label above (C1/A1 etc.)
  - White outline stroke behind colored stroke for visibility
- **Clickable legend** (bottom-right overlay): all Cellophane layers grouped as one entry, click to hide/show groups of layers
- "All" and "None" buttons in legend

**Angle convention:**
```
// Cell 0° = 3 o'clock, 90° = 12 o'clock (top)
// Canvas: 0 = 3 o'clock, -π/2 = 12 o'clock
// So cathode at 90° = left side in top view, anode at 270° = right side
```

**Scale:**
```
PAD_TOP = tabLen + 30   // room for tabs above the circle
sc = min((W - PAD_SIDES*2) / (outerR*2), (H - PAD_TOP - PAD_BOT) / (outerR*2))
cy = PAD_TOP + outerR * sc   // circle center shifted down
```

**Controls:** Layer opacity slider, Arc thickness slider, Tab length input, Tab thickness input, Show turn numbers toggle, Show tab labels toggle.

---

### View 3: Unroll View

All layers laid flat as horizontal strips — what the jellyroll would look like if you unwound it.

**Layout:**
```
PAD_L = 112px    // room for layer name labels on left
PAD_R = 20px
RULER_H = 36px   // sticky ruler at top
```

**Ruler:** mm scale at bottom of ruler bar, turn markers (T1, T2...) at top of ruler bar — keep them in separate rows to avoid overlap.

**For each non-mandrel layer (top to bottom):**
- Electrode layers (cathode/anode) get a `tabZone` of extra space above them (default 50px)
- Each strip is a colored rectangle: x starts at `PAD_L + layer.off * sc`, width = `layer.len * sc`
- Faint full-length background rectangle shows the total winding space
- Layer name label on the left (bold for electrodes)
- Length label inside the strip if wide enough
- Start marker (triangle) if `layer.off > 0`
- End marker (triangle) at right end of strip

**Tab rendering — CRITICAL RULE:**
- Cathode tabs appear ONLY above the cathode strip
- Anode tabs appear ONLY above the anode strip
- Tabs are vertical lines from `stripY - 4` down to `stripY - tabZone + 10`
- Arrow tip points DOWNWARD toward the strip (the tab is connecting to the electrode)
- Label at the TOP of the tab line (above the base)
- Arc length annotation below the strip

**Faint vertical turn boundary lines** span the full height of the canvas.

**Scale:** `sc = (W - PAD_L - PAD_R) / maxLen` where `maxLen = max(layer.off + layer.len)` across all layers.

**Canvas height:** Must be computed and set explicitly so the canvas is tall enough for all strips + tab zones + dimension annotations. The containing div should scroll vertically. Do NOT constrain canvas height to the viewport.

**Controls:** Strip height slider, Strip gap slider, Tab zone height slider, Show turns toggle, Show arc lengths toggle, Show dimensions toggle.

---

### View 4: 3D View

Uses **Three.js r128** from CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`

**What to render:**
- Concentric cylinder layers representing the jellyroll cross-section
- Each layer as a `CylinderGeometry` arc (not full cylinder) — cutaway controlled by slider
- Cutaway reveals the interior layers
- Top and bottom face rings (`RingGeometry`) to cap each layer
- Planar cuts at the cutaway edges (`PlaneGeometry`)

**Coordinate system — CRITICAL:**
- Use ONE consistent unit: 1 scene unit = 1mm for height
- Radii are exaggerated by `rScale` (default 8×) for visual clarity ONLY
- Height stays in real mm
- All tab positions must use the SAME scale as the cylinder geometry

**Tab placement:**
```
// Find the scaled radius for each electrode layer
cScaledR = radii3d.find(cathode).outer   // in rScale*mm units
// Tab position:
mesh.position.set(
    cScaledR * Math.cos(cAngRad),
    cellH/2 + tabH/2,    // base on top face, extending upward
    cScaledR * Math.sin(cAngRad)
)
mesh.rotation.y = -cAngRad
```

**Camera:** Orbit camera. Distance = `max(outerScaledR * 2.5, cellH * 1.2)`. Mouse drag = azimuth/elevation. Scroll = zoom.

**Lighting:** AmbientLight(white, 0.55) + two DirectionalLights.

**Controls:** Cutaway slider (10–360°), Layer scale slider (1–20×), Auto-spin toggle, Reset view button.

---

## App Structure (index.html)

```
<head>
  Three.js CDN script tag
  All CSS inline in <style>
</head>
<body>
  <div class="app">   <!-- CSS grid: left panel + right panel -->
    
    <!-- LEFT PANEL: parameters + layer stack -->
    <div class="left">
      Cell parameters panel (mandrel_d, target_od, cell_h, tab_w, tab_h, skip_turns, cath_angle, anod_angle)
      3D display panel (cut slider, rscale slider, spin/reset buttons)  -- only shown in 3D view
      Layer stack panel (layer cards, add button)
      Run simulation button + last-run timestamp
    </div>
    
    <!-- RIGHT PANEL: view tabs + canvas + results table -->
    <div class="right">
      Info bar (turns, OD, pitch range, tab counts)
      View tab buttons: Side | Top | Unroll | 3D
      Canvas area (switches between WebGL renderer and 2D canvas)
      Summary cards (5 metrics)
      Tab positions table
    </div>
    
  </div>
  
  <script>
    // All JavaScript inline
  </script>
</body>
```

---

## Layer Stack Editor

Each layer has a card in the left panel with:
- Color picker (`<input type="color">`)
- Name text input
- Type dropdown (mandrel/anode/cathode/separator/collector/tape/other)
- Up/Down reorder buttons
- Delete button (×)
- Three number inputs in a 3-column grid: Thickness (mm), Width (mm), Length (mm)
- Start offset input (mm)
- Badge showing drill angle if type is cathode or anode

Changes to layer parameters should highlight the Run button (yellow) to indicate re-simulation is needed. After running, all yellow highlights clear.

---

## CSV Export

Button labeled "Export CSV" in the results area. Downloads a file named `jellyroll-tabs-{timestamp}.csv`.

Format:
```csv
Type,Tab#,Turn,Radius_mm,Pitch_mm,ArcLen_mm,Spacing_mm,Angle_deg
Cathode,1,3,18.432,3.12,187.4,—,90
Cathode,2,4,21.552,3.24,294.1,106.7,90
...
Anode,1,3,18.432,3.12,235.1,—,270
...
```

---

## Save/Load Configuration

**Save:** Serialises the full app state to JSON and triggers a browser download.
```json
{
  "version": "1.0",
  "params": {
    "mandrel_d": 10.75,
    "target_od": 94,
    "cell_h": 222,
    "tab_w": 10,
    "tab_h": 15,
    "skip_turns": 2,
    "cath_angle": 90,
    "anod_angle": 270
  },
  "layers": [ ...full layer array... ]
}
```

**Load:** `<input type="file" accept=".json">` — reads the file, validates version, restores params and layers, rebuilds UI, auto-runs simulation.

---

## GitHub Actions Deployment

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
```

**Repo structure:**
```
jellyroll-designer/
├── index.html          # entire app — single file
├── README.md           # brief description + screenshot
└── .github/
    └── workflows/
        └── deploy.yml
```

---

## UI Design Guidelines

- **Color scheme:** Dark background (`#111827`), light text. Support both dark and light mode via `matchMedia('(prefers-color-scheme:dark)')`.
- **Left panel:** Fixed width ~220px, scrollable, contains all controls
- **Right panel:** Remaining width, canvas fills available space
- **Typography:** `sans-serif`, 12px base, 11px for labels
- **Controls:** Consistent input styling with subtle borders, range sliders with blue accent
- **Canvas backgrounds:** `#111827` (dark) or `#ffffff` (light)
- **Layer colors:** Each layer has a user-editable hex color. Defaults are set per the layer table above.
- **Cathode color:** `#3b82f6` (blue)
- **Anode color:** `#16a34a` (green)

---

## Summary Stats Bar

Show these 5 cards below the info bar:

| Label | Value |
|-------|-------|
| Computed OD | `(outerR*2).toFixed(1)mm` — red if exceeds target |
| Total turns | integer |
| Pitch range | `minP.toFixed(2)–maxP.toFixed(2)mm` |
| Cathode tabs | count in blue |
| Anode tabs | count in green |

---

## Tab Positions Table

Columns: Electrode | Tab# | Turn | Radius (mm) | Pitch (mm) | Arc Length (mm) | Spacing (mm) | Angle

Rows interleaved: C1, A1, C2, A2, ... (or all cathode then all anode — either is fine).

Spacing column = arc length difference from previous tab of same type. First tab shows "—".

---

## Known Issues / Previous Iteration Notes

1. **Spiral view was removed** — replaced by the Unroll view which is more useful for manufacturing. Do not implement a spiral view.

2. **3D tab coordinate system** — tabs were floating because cylinder height was in real mm but radii were in rScale units. Fix: use one consistent scale. Either everything in real mm (radius exaggeration applied only visually through geometry scale) or compute a single dScale for the whole scene.

3. **Top view color** — previously all rings showed as one color (the outermost active layer dominated). Fix: subdivide each turn's pitch band among ALL active layers, each getting its own arc at a different radius within the band.

4. **Spiral arc straight lines** — using `ctx.arc()` for each complete turn instead of trying to interpolate multi-turn spirals eliminates straight connector artifacts between turns.

5. **Canvas height clipping in Unroll view** — canvas must be sized to its natural content height. The parent container scrolls; the canvas does not have a fixed height.

6. **Tab width in Side view** — tabs should be auto-sized to `avgPitchSpacing * 0.6` so they align with their turn ring, not a fixed pixel width.

---

## Claude Code Setup Instructions

Run these commands to scaffold the project:

```bash
mkdir jellyroll-designer
cd jellyroll-designer
git init
# Create index.html with full app
# Create .github/workflows/deploy.yml
# Create README.md
git add .
git commit -m "Initial commit: Jellyroll Battery Cell Designer"
# Push to GitHub:
git remote add origin https://github.com/YOUR_USERNAME/jellyroll-designer.git
git branch -M main
git push -u origin main
```

Then in the GitHub repo settings: Settings → Pages → Source: GitHub Actions.

The app will be live at: `https://YOUR_USERNAME.github.io/jellyroll-designer`

---

## Prompt for Claude Code

Use this prompt when starting Claude Code in the project folder:

> "Build a single-page web app called Jellyroll Battery Cell Designer as a single index.html file with all CSS and JS inline. This is a tool for computing tab positions on wound cylindrical battery cells. The full specification is in `jellyroll-designer-spec.md` in this folder — read it completely before writing any code. Key requirements: 4 views (Side, Top, Unroll, 3D with Three.js r128 from CDN), variable-pitch spiral simulation engine, layer stack editor, CSV export, JSON save/load, and GitHub Actions deployment workflow. Make it production quality with clean UI."
