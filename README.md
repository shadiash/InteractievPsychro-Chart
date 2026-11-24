# PsychroChart Ultra 3.0

**Engineering-grade interactive ASHRAE 2021 psychrometric studio, HVAC systems simulator, thermal comfort engine, and climate analytics suite — compiled into a single zero-dependency HTML file.**

![Version](https://img.shields.io/badge/version-3.0.0%20Ultra-0ea5e9.svg)
![ASHRAE](https://img.shields.io/badge/ASHRAE-Fundamentals%202021-1d4ed8.svg)
![Dependencies](https://img.shields.io/badge/dependencies-zero-10b981.svg)
![License](https://img.shields.io/badge/license-MIT-64748b.svg)

Built for HVAC engineers, mechanical designers, building scientists, and commissioning specialists. Runs 100% client-side with zero installation, zero server requirement, and full offline capability.

> **Backward Compatibility:** `PsychroChart Pro 2.6.6.html` is preserved intact in this repository, and PsychroChart Ultra 3.0 automatically migrates and loads legacy **v2.6.6 `.json`** project files (including legacy IP axis limits, display-unit humidity scales, index-based processes, and theme names).

---

## What's New in Ultra 3.0 vs Pro 2.6.6

| Capability | PsychroChart Pro 2.6.6 | PsychroChart Ultra 3.0 |
|---|---|---|
| **Thermodynamic Wet-Bulb** | Constant-enthalpy approximation | Exact **ASHRAE 2021 Ch. 1 Eqs. 35 & 37** (liquid + ice `< 0 °C` phase transition, `< 10⁻⁶ °C` error) |
| **IP Enthalpy & Unit Invariance** | Scaled SI enthalpy display | **True `0 °F` IP enthalpy datum** (`0.240·T_F + W·(1061 + 0.444·T_F)`) + strict internal SI coordinate invariant (`°C, kg/kg, Pa, kJ/kg, m³/kg`) |
| **Psychrometric State Solver** | `Tdb` + 5 secondary modes | **Universal any-2-of-8 solver** (`Tdb, Twb, Tdp, RH, W, h, v, Pv` — all 25 physically independent pairs) |
| **Thermal Comfort Engine** | Static ET* summer/winter boxes | Real **ISO 7730 / ASHRAE 55 dynamic Fanger PMV/PPD** polygons (`clo`, `met`, `v_air`, `MRT offset`, `±PMV`, altitude-adaptive) + **ASHRAE 160** mold/condensation risk |
| **Building Science Envelopes** | None | **Givoni Bioclimatic** passive strategies (6 zones) + **ASHRAE TC 9.9 Data Center** envelopes (Recommended, A1, A2, A3) |
| **Climate & Weather Analytics** | Manual altitude/pressure only | **47-city global ASHRAE design database** (Zones `0A`–`8`), deterministic **8,760-hr synthetic TMY**, real **EnergyPlus `.epw` & smart CSV/TSV** parser, density heatmap & bin analytics |
| **HVAC Systems Designer** | Point-to-point processes + 2-stream mix | **AHU Cycle Builder** (4 modes), **ERV / Enthalpy Wheel** (frost alert), **1- & 2-Stage Evaporative Cooler** (DEC/IEC/IDEC), **Solid Desiccant Wheel**, **Steam & Adiabatic Humidifiers**, 3-stream adiabatic mixing with fog solver, **6 one-click HVAC presets** |
| **Coil ADP & Ventilation** | Straight-line ADP/BPF + basic OA load | **Curved cooling-coil ADP/BPF/CF** trajectory + **hydronic chilled-water flow** (`L/s` & `GPM`) + **ASHRAE 62.1-2022** (12 spaces, `Vbz/Voz`) + **steady-state CO₂ balance** |
| **Scenario Analysis** | Single active workspace | **Multi-scenario snapshots** with chart ghost overlays and live load-delta comparison |
| **Precision Drafting UX** | Click/drag + basic shortcuts | **`Shift`-drag thermodynamic snap** (`ΔW=0`, `ΔT=0`, `Δh=0`), **`Ctrl` 0.5° grid snap**, **caliper measure ruler (`L`)**, **interactive ASHRAE SHR protractor**, **`Alt+Drag` box zoom**, inline annotations (`N`), animated airflow arrows (`A`), **`Ctrl+K` Command Palette** |
| **Rendering Architecture** | Single-canvas full redraw | **Dual-canvas HiDPI architecture** (`#cvBase` fingerprinted cache + `#cvOverlay` 60–120 fps foreground) |
| **History & Sharing** | 80-level unlabeled undo | **100-level labeled Undo/Redo**, debounced `localStorage` autosave, **URL hash sharing (`#p3=...`)** |
| **Export Deliverables** | PNG, HTML, DOCX | **2× HiDPI PNG**, **Clipboard PNG**, **Publication Vector SVG**, **Engineering CSV**, **Executive HTML Report**, **Word `.docx`**, **JSON (`v3.0` + `v2.6.6`)**, **Share URL** |
| **Codebase & Verification** | Monolithic ~2,300-line HTML | **14 zero-circular-dependency ES6 modules** (`src/`) + zero-dependency Node.js single-file bundler + **79-test verification suite** |

---

## Complete Feature Guide

### 1. Physics Engine & Universal State Solver
- **ASHRAE Fundamentals (2021) Ch. 1** formulation across `−100 °C` to `200 °C` and altitudes from `−500 m` to `11,000 m` (or direct barometric pressure override in `kPa` / `psia`).
- **Strict Internal SI Architecture:** All state coordinates and physics run internally in SI (`°C`, `kg/kg`, `Pa`, `kJ/kg`, `m³/kg`). Display conversions to IP (`°F`, `gr/lb`, `Btu/lb` with true `0 °F` datum, `ft³/lb`, `BTU/h`, `Tons TR`, `CFM`, `GPM`) occur exclusively at UI/rendering boundaries — guaranteeing zero drift when toggling `SI ↔ IP`.
- **Universal Any-2-of-8 State Solver:** Enter any independent pair among Dry-Bulb (`Tdb`), Wet-Bulb (`Twb`), Dew-Point (`Tdp`), Relative Humidity (`RH%`), Humidity Ratio (`W`), Enthalpy (`h`), Specific Volume (`v`), and Vapor Pressure (`Pv`) — closed-form analytic solutions where available and 64-step safeguarded bisection for coupled pairs, with physical realizability guards (`0 ≤ RH ≤ 100%`, `Twb ≤ Tdb`, `Tdp ≤ Tdb`).
- **Psychrometric Table Generator:** Generate and copy custom saturation/psychrometric property tables over any temperature range and step size in SI or IP.

### 2. Thermal Comfort & Building Science
- **ISO 7730:2005 / ASHRAE Standard 55 Analytical Fanger PMV/PPD:** Computes Predicted Mean Vote (`PMV`), Predicted Percentage Dissatisfied (`PPD`), thermal sensation label, and compliance for every state point, hover preview, calculator result, and export report.
- **Dynamic Parameter- & Altitude-Adaptive Comfort Polygons:** Live-recomputed Summer & Winter comfort envelopes responding to clothing insulation (`clo`), metabolic rate (`met`), air velocity (`m/s`), Mean Radiant Temperature offset (`MRT − Ta`), and `±PMV` threshold.
- **Givoni Building Bioclimatic Chart:** 6 passive & low-energy climate strategy overlays — *Natural Ventilation*, *High Thermal Mass*, *Direct Evaporative Cooling*, *Indirect Evaporative Cooling*, *Passive Solar Heating*, and *Active Dehumidification*.
- **ASHRAE TC 9.9 Data Center Thermal Envelopes:** Altitude-corrected *Recommended*, *Class A1*, *Class A2*, and *Class A3* thermal operating boundaries with automatic per-point class qualification.
- **ASHRAE Standard 160 / ISO 13788 Mold & Condensation Risk:** Evaluates dew-point margin (`Tdb − Tdp`) and cold-surface RH (`Condensation ≤ Tdp`, `High ≥ 80%`, `Moderate 70–80%`, `Low`).

### 3. HVAC Systems, Processes & Equipment
- **11-Type Automatic Process Classifier & Load Engine:** Computes `ΔT`, `ΔW`, `Δh`, `SHR`, dry-air mass flow (`kg/s`), Sensible (`Qs`), Latent (`Ql`), Total (`Qt` in `kW`, `BTU/h`, and `Tons TR`), and moisture addition/condensate rate (`kg/h`, `lb/h`, `gph`) for each process and aggregate cycle totals.
- **Full AHU Cycle Builder (4 Modes):**
  - *Summer Cooling + Dehumidification & Reheat* (OA/RA mixing → curved ADP coil → reheat → fan heat → space load)
  - *DOAS + Enthalpy Recovery Wheel* (100% OA → ERV supply/exhaust with frost warning → deep dehum coil → reheat → fan)
  - *Winter Heating & Humidification* (OA/RA mix → heating coil → steam or adiabatic humidifier → fan → space)
  - *Airside Economizer* (enthalpy high-limit lockout, modulating free cooling, or 100% OA integrated economizer with baseline cooling savings)
- **Dedicated Equipment Simulators (Calculate & Plot directly to Chart):**
  - **ERV / Enthalpy Wheel:** Independent sensible (`ηs`) and latent (`ηl`) effectiveness, balanced/unbalanced mass flow, recovered sensible/latent/total loads, and exhaust frost-risk detection.
  - **Evaporative Coolers:** *Direct (`DEC`)* along exact constant thermodynamic wet-bulb, *Indirect (`IEC`)* sensible precooling, and *Two-Stage (`IDEC`)* with equivalent cooling tonnage and water consumption.
  - **Solid Desiccant Wheel:** Moisture removal effectiveness, thermal carryover from regeneration air temperature, moisture removal rate, and regeneration heat estimate.
  - **Humidifiers:** Isothermal *Steam* (`h_g = 2501 + 1.86·T_steam`) and *Adiabatic* spray/ultrasonic cooling-humidification with automatic saturation clamping.
- **Curved Cooling Coil ADP/BPF & Hydronics:** Exact saturation-line intersection solver for Apparatus Dew Point (`ADP`), Bypass Factor (`BPF`), Contact Factor (`CF`), physically realistic cubic-Bézier curved conditioning trajectory, and required chilled-water flow (`L/s` & `GPM`) from user `ΔT_w`.
- **Multi-Stream Adiabatic Mixing (2 or 3 Streams):** Mass- and enthalpy-balanced lever-rule mixing with automatic supersaturation **fog/condensation equilibrium solver** along constant enthalpy.
- **ASHRAE Standard 62.1-2022 Ventilation & CO₂ Balance:** 12 built-in space presets (*Office, Conference, Classroom, Retail, Restaurant, Gym, Hospital, Data Center, Auditorium, Hotel, Laboratory, Lobby*), editable `Rp`, `Ra`, `Ez`, breathing-zone `Vbz`, zone outdoor airflow `Voz`, OA sensible/latent/total loads, and steady-state indoor CO₂ (`ppm`).
- **6 One-Click Engineering Cycle Presets:** Summer AHU + Reheat, DOAS + ERV, Winter Heating & Steam Humidification, Two-Stage Arid Evaporative Cooling, Desiccant Wheel Cleanroom, and Data Center Airside Economizer (auto-enabling TC 9.9 envelopes).
- **Multi-Scenario Comparison:** Save named cycle snapshots, overlay ghost trajectories of any baseline scenario directly on the chart, and inspect side-by-side cooling/heating/moisture deltas.

### 4. Global Climate & 8,760-Hr Weather Analytics
- **47 Curated Global ASHRAE Design Cities** across 5 regions (*Middle East & Africa: 10*, *North America: 14*, *Europe: 10*, *Asia-Pacific: 11*, *South America: 2*) spanning ASHRAE Climate Zones `0A`–`8` with elevation-calibrated `0.4%` & `1.0%` cooling (`DB/MCWB`) and `99.6%` heating design points.
- **Deterministic 8,760-Hour Synthetic TMY Generator:** Seeded multi-scale AR(1) synoptic + asymmetric diurnal + hemisphere-aware seasonal synthesizer calibrated to each city's ASHRAE design extremes and annual mean RH.
- **Real EnergyPlus (`.epw`) & Smart CSV/TSV Weather Import:** Drag-and-drop `.epw` files (full `LOCATION` elevation & barometric parsing, missing-flag filtering) or arbitrary CSV/TSV datasets with automatic delimiter detection, header mapping, `°F → °C` auto-detection, and humidity unit scaling (`kg/kg`, `g/kg`, `gr/lb`).
- **Psychrometric Density Heatmap & Bin Analytics:** `1.0 °C × 0.5 g/kg` 2D occurrence grid rendered as thermal heatmap or scatter cloud with annual hours & percentages for *Comfort*, *Cooling*, *Dehumidification*, *Heating*, *Airside Economizer*, and *Evaporative Cooling*, plus *CDD / HDD* (base `18.3 °C` / `65 °F`).

### 5. Precision Interactive Drafting & Workspace
- **Dual-Canvas HiDPI Rendering:** Cached background chart canvas (`#cvBase`, redrawn only when view/pressure/layers/theme change) paired with a zero-lag foreground canvas (`#cvOverlay`) for smooth 60–120 fps hover crosshairs, live point dragging, animated airflow arrows, and scenario ghosts.
- **Thermodynamic Snap Modifiers:** Hold **`Shift`** while dragging any unlocked point to snap along exact **`ΔW = 0` (Sensible)**, **`ΔT = 0` (Isothermal)**, or **`Δh = 0` (Isenthalpic / Evaporative)** paths; add **`Ctrl`** for **`0.5 °C` / `0.5 °F`** grid snapping.
- **Caliper Measure Tool (`L`) & Interactive SHR Protractor:** Measure `ΔT`, `ΔW`, `Δh`, `SHR`, and process classification between any two states without adding points; overlay a draggable ASHRAE Sensible Heat Ratio reference protractor and perimeter enthalpy scale ruler.
- **`Ctrl+K` Command Palette:** Instant fuzzy search across all 6 HVAC presets, 47 global cities (plot design points or load 8,760-hr TMY), chart layers, visual themes, drafting tools, and export actions.
- **Visual Themes & Custom Theme Studio:** 4 engineered palettes (*Studio Dark*, *Drafting Light*, *ASHRAE Classic*, *Blueprint CAD*) plus a real-time **Custom Theme Studio** editing every line color, dash style, stroke width, point radius, halo, and font size.
- **Ergonomic CAD Workspace:** Resizable & collapsible sidebars (`#splitL`, `#splitR`), right-click context menu with 10-property clipboard copy, touch pinch-to-zoom & long-press support, inline CSV bulk point import, and 100-level labeled Undo/Redo.

### 6. Multi-Format Export, Sharing & Reporting
- **2× HiDPI Composite PNG & Clipboard PNG:** High-resolution raster export merging base chart, overlays, weather heatmap, and scenario ghosts.
- **Publication-Grade Vector SVG:** Self-contained resolution-independent SVG with exact ASHRAE curves, comfort polygons, processes, curved coil paths, annotations, and vector typography suitable for CAD, Illustrator, LaTeX, and technical submittals.
- **Structured Engineering CSV:** Complete multi-section spreadsheet covering project metadata, atmospheric conditions, state points (with PMV/PPD & mold risk), process loads & ADP/BPF metrics, and weather bin statistics.
- **Executive Print-Ready HTML Report:** Standalone formatted engineering submittal with embedded chart, state-point schedule, process load table, thermal comfort & ASHRAE 160 assessment, and climate analytics (including printer-friendly mode).
- **Microsoft Word (`.docx`) Report:** Native formatted Word document (uses optional `docx@9.1.0` UMD library when online; zero core dependency).
- **Project JSON & URL Hash Sharing:** Full-fidelity `schema: "psychro-ultra-3.0"` JSON export/import (backward-compatible with `v2.6.6`) plus one-click compact Base64URL `#p3=...` share links.

---

## Getting Started

### Option 1 — Open Directly (Zero Install, Zero Build)
Open either standalone compiled file directly in any modern browser (**Chrome 90+**, **Firefox 90+**, **Edge 90+**, **Safari 15+**):
- `index.html` *(default entry point for local use or static hosting / GitHub Pages)*
- `PsychroChart Ultra 3.0.html` *(named portable release bundle — identical build)*

> Need the legacy v2 release? `PsychroChart Pro 2.6.6.html` remains untouched in the root directory.

### Option 2 — Serve Locally
```bash
# Python 3
python3 -m http.server 8000

# Node.js
npx serve .
```
Open `http://localhost:8000/` in your browser.

### Option 3 — Develop, Rebuild & Verify from `src/`
Requires **Node.js 18+** (zero `npm install` needed — uses only Node built-in modules):

```bash
# Rebuild both standalone HTML deliverables (index.html & PsychroChart Ultra 3.0.html)
node scripts/build.mjs

# Run the complete verification test suite (79 tests across 12 suites)
node --test tests/*.test.mjs
```

---

## Architecture & Module Map

PsychroChart Ultra 3.0 is authored as **14 strictly ordered, zero-circular-dependency ES6 modules** under `src/`, compiled by [`scripts/build.mjs`](scripts/build.mjs) together with `src/styles/*.css` and `index.template.html` into a self-contained single-file HTML bundle.

| # | Module | Export(s) | Responsibility |
|---:|---|---|---|
| 1 | `src/core/contracts.js` | `APP_VERSION`, `THEME_PRESETS`, `DEFAULT_LAYERS`, `UNIT_LABELS`, `CoreDOM` | Canonical constants, theme palettes, unit display labels, SI/IP boundary converters & DOM helpers |
| 2 | `src/engine/psychro.js` | `Psy` | ASHRAE Fundamentals (2021) Ch. 1 thermodynamics, Hyland–Wexler ice/liquid, Eq. 35/37 wet-bulb, true 0 °F IP enthalpy, universal any-2-of-8 solver, airflow conversions |
| 3 | `src/engine/comfort.js` | `Comfort` | ISO 7730 / ASHRAE 55 Fanger PMV/PPD, dynamic comfort polygons, Givoni bioclimatic zones, ASHRAE TC 9.9 data center envelopes, ASHRAE 160 mold/condensation risk |
| 4 | `src/engine/hvac.js` | `HVAC` | 11-type process classifier, load engine, curved coil ADP/BPF, multi-stream mixing (+ fog solver), ERV, DEC/IEC/IDEC evap, desiccant, humidifiers, 4-mode AHU builder, ASHRAE 62.1 + CO₂ |
| 5 | `src/engine/weather.js` | `Weather` | 47 global ASHRAE cities, deterministic 8,760-hr synthetic TMY generator, EnergyPlus `.epw` & smart CSV/TSV parsers, 2D psychrometric bin & HVAC hours analytics |
| 6 | `src/state/store.js` | `createStore` | Reactive SI state store, 100-level labeled undo/redo, scenario snapshots, JSON v3.0 & legacy v2.6.6 migration, `#p3=` URL hash codec, `localStorage` autosave |
| 7 | `src/render/baseRenderer.js` | `BaseRenderer` | Fingerprinted cached HiDPI base canvas (`#cvBase`): grids, weather heatmap, comfort/Givoni/TC 9.9 zones, saturation/RH/Twb/h/v/Tdp curves, enthalpy ruler, axes |
| 8 | `src/render/overlayRenderer.js` | `OverlayRenderer` | High-FPS foreground canvas (`#cvOverlay`): scenario ghosts, processes, curved ADP coil trajectories, animated flow arrows, SHR protractor, points, measure caliper, annotations, crosshair |
| 9 | `src/export/exporter.js` | `Exporter` | 2× HiDPI PNG, clipboard PNG, publication Vector SVG, structured CSV, executive HTML report, Word `.docx` report, project JSON, shareable URL |
| 10 | `src/ui/interaction.js` | `initChartInteraction` | Cursor-anchored zoom, pan, `Shift`/`Ctrl`-snap point dragging, label dragging, `Alt+Drag` box zoom, tool state machine, HUD, context menu, splitters, keyboard shortcuts |
| 11 | `src/ui/leftPanel.js` | `initLeftPanel` | Atmosphere/elevation, 47-city selector, EPW/TMY weather studio, dynamic PMV controls, inline points table & CSV import, universal 2-of-8 calculator, psychrometric table |
| 12 | `src/ui/rightPanel.js` | `initRightPanel` | Process cards & cycle summary, per-process airflow/load metrics, AHU/ERV/Evap/Desiccant/Humidifier wizards, coil ADP + hydronic GPM, ASHRAE 62.1 ventilation, mixing & scenarios |
| 13 | `src/ui/modals.js` | `initModals`, `PRESETS` | 6 engineering HVAC cycle presets, `Ctrl+K` fuzzy Command Palette, Edit/Add Point, Mix Flow, Report Export, Custom Theme Studio, Glossary, Shortcuts & About modals |
| 14 | `src/app.js` | bootstrap | Application wiring, URL hash / autosave restore, top-bar controls & global lifecycle |

**Supporting Build & Verification Files:**
- `src/styles/theme.css`, `src/styles/layout.css` — CSS custom-property theme system and responsive CAD layout
- `index.template.html` — Canonical HTML shell and modal markup
- `scripts/build.mjs` — Token-aware ES6 module stripper and single-file IIFE bundler with `vm.Script` syntax verification
- `tests/psychro.test.mjs`, `tests/hvac_comfort_weather.test.mjs` — 79 automated assertions verifying ASHRAE 2021 tables, all 25 solver pairs, IP enthalpy datum, PMV/PPD benchmarks, HVAC conservation laws, EPW/CSV parsing, and bin analytics

---

## ASHRAE 2021 Psychrometric Reference Equations

All thermodynamic calculations follow **ASHRAE Handbook — Fundamentals (2021), Chapter 1**, **ISO 7730:2005 / ASHRAE Standard 55**, and **ASHRAE Standard 62.1-2022**:

### Barometric Pressure vs. Altitude *(Ch. 1, Eq. 3)*
```text
P = 101325 · (1 − 2.25577×10⁻⁵ · Z)^5.2559      [Pa, Z in m, −500 ≤ Z ≤ 11000]
```

### Saturation Vapor Pressure — Hyland–Wexler *(Ch. 1, Eqs. 5 & 6)*
With absolute temperature `T_K = T_db + 273.15` [K]:
```text
Over Ice (T_db < 0 °C, Eq. 5):
  ln(p_ws) = C₁/T_K + C₂ + C₃·T_K + C₄·T_K² + C₅·T_K³ + C₆·T_K⁴ + C₇·ln(T_K)
  C₁ = −5674.5359      C₂ = 6.3925247        C₃ = −9.677843×10⁻³
  C₄ = 6.2215701×10⁻⁷  C₅ = 2.0747825×10⁻⁹   C₆ = −9.484024×10⁻¹³  C₇ = 4.1635019

Over Liquid Water (T_db ≥ 0 °C, Eq. 6):
  ln(p_ws) = C₈/T_K + C₉ + C₁₀·T_K + C₁₁·T_K² + C₁₂·T_K³ + C₁₃·ln(T_K)
  C₈ = −5800.2206      C₉ = 1.3914993        C₁₀ = −4.8640239×10⁻²
  C₁₁ = 4.1764768×10⁻⁵ C₁₂ = −1.4452093×10⁻⁸ C₁₃ = 6.5459673
```

### Humidity Ratio, Enthalpy & Specific Volume *(Ch. 1, Eqs. 22, 28, 32)*
```text
Humidity Ratio:       W = 0.621945 · p_v / (P − p_v)                     [kg_w / kg_da],  p_v = φ · p_ws(T_db)
Enthalpy (SI, 0 °C):  h_SI = 1.006 · T_db + W · (2501 + 1.86 · T_db)     [kJ / kg_da]
Enthalpy (IP, 0 °F):  h_IP = 0.240 · T_F  + W · (1061 + 0.444 · T_F)     [Btu / lb_da],   T_F = 1.8·T_db + 32
Enthalpy Delta (IP):  Δh_IP = 0.429922614 · Δh_SI                        [Btu / lb_da] (datum-free)
Specific Volume:      v = 287.042 · (T_db + 273.15) · (1 + 1.607858·W) / P   [m³ / kg_da]
Moist Air Cp:         c_p,m = 1.006 + 1.86 · W                           [kJ / (kg_da·K)]
```

### Thermodynamic Wet-Bulb Temperature *(Ch. 1, Eqs. 35 & 37)*
Solved via phase-partitioned 64-iteration bisection across the `0 °C` ice/liquid boundary (`< 10⁻⁶ °C` tolerance; exact identity `T_wb = T_db = T_dp` at `RH = 100%`):
```text
Above Freezing (T_wb ≥ 0 °C, Eq. 35):
  W = [(2501 − 2.326·T_wb)·W_s*(T_wb) − 1.006·(T_db − T_wb)] / (2501 + 1.86·T_db − 4.186·T_wb)

Below Freezing (T_wb < 0 °C, Eq. 37):
  W = [(2830 − 0.24·T_wb)·W_s*(T_wb) − 1.006·(T_db − T_wb)] / (2830 + 1.86·T_db − 2.1·T_wb)
```

### Thermal Comfort — ISO 7730:2005 / ASHRAE Standard 55 Fanger Model
Iterative clothing surface temperature `t_cl` solved to `10⁻⁵ °C` with six physiological heat-loss terms (`HL₁` skin diffusion, `HL₂` sweat evaporation, `HL₃` latent respiration, `HL₄` dry respiration, `HL₅` radiation, `HL₆` convection):
```text
PMV = (0.303 · e^(−0.036·M) + 0.028) · [(M − W_ext) − HL₁ − HL₂ − HL₃ − HL₄ − HL₅ − HL₆]
PPD = 100 − 95 · exp(−0.03353 · PMV⁴ − 0.2179 · PMV²)
```

### Ventilation Rate Procedure & CO₂ Balance *(ASHRAE Standard 62.1-2022)*
```text
Breathing-Zone Outdoor Airflow:  V_bz = P_z · R_p + A_z · R_a            [L/s]
Zone Outdoor Airflow:            V_oz = V_bz / E_z                       [L/s]
Steady-State Indoor CO₂:         C_in = C_out + (G_CO₂ · P_z · 10⁶) / V_bz   [ppm]
```

---

## Keyboard Shortcuts & Precision Modifiers

### Global & History
| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Cmd+K` | Open **Command Palette** (presets, 47 cities, layers, themes, exports) |
| `Ctrl+Z` / `Cmd+Z` | Undo last action (100-level labeled history) |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo action |
| `Ctrl+S` / `Cmd+S` | Save project `.json` file |
| `U` | Toggle unit system (`SI ↔ IP`) with zero-drift coordinate invariance |
| `Delete` / `Backspace` | Delete selected unlocked point, process, or annotation |
| `Esc` | Cancel active tool, clear measure caliper, or close open modal/menu |
| `?` | Open Keyboard Shortcuts reference overlay |

### Drafting Tools
| Key | Tool Mode |
|---|---|
| `V` | **Select / Drag / Pan** (default) |
| `P` | **Process** tool — click two points to connect (`Shift+Click` to chain multi-step cycles) |
| `M` | **Air Mixing** tool — click two points to open mass/ratio mixing dialog |
| `L` | **Caliper Measure Ruler** — drag between any two states to inspect `ΔT, ΔW, Δh, SHR` |
| `N` | **Annotate** tool — click chart to place inline engineering callout note |
| `B` | **Box Zoom** tool — drag marquee rectangle to zoom into region |

### Precision Canvas & Mouse Modifiers
| Gesture | Action |
|---|---|
| `Shift + Drag` *(on point)* | Thermodynamic snap: **`ΔW = 0` Sensible**, **`ΔT = 0` Isothermal**, or **`Δh = 0` Isenthalpic / Evaporative** |
| `Ctrl + Drag` *(on point)* | Snap dry-bulb temperature to **`0.5 °C` / `0.5 °F`** grid (combinable with `Shift`) |
| `Alt + Drag` *(anywhere)* | Instant **marquee Box Zoom** without switching tools |
| `Space + Drag` | Temporary **Pan** in any active tool mode |
| `Scroll Wheel` | Cursor-anchored zoom in / out |
| `Double-Click` *(empty chart)* | Add new state point at cursor |
| `Double-Click` *(on point)* | Lock / unlock state point |
| `Double-Click` *(on annotation)* | Edit callout annotation inline |
| `Right-Click` | Context menu (edit/add/mix/lock point, copy all 10 properties, exports) |

### View & Chart Layer Toggles
| Key | Action |
|---|---|
| `F` | Fit all state points cleanly into view |
| `R` | Reset zoom to standard ASHRAE chart range |
| `1` – `7` | Toggle core layers: `1` Sat · `2` RH · `3` Wet-Bulb · `4` Enthalpy · `5` Spec. Vol · `6` Points · `7` Processes |
| `G` | Toggle major & minor background grid |
| `C` | Cycle ASHRAE 55 comfort zones (*None → Summer → Winter → Both*) |
| `D` | Toggle constant dew-point (`Tdp`) lines |
| `W` | Toggle 8,760-hr weather density heatmap overlay |
| `A` | Toggle animated process airflow arrows |

---

## Credits & License

- **Original Creator & Lead Author:** **Shadi Alashkar** ([alashkar.shadi@gmail.com](mailto:alashkar.shadi@gmail.com)) — creator of *PsychroChart Pro* and *PsychroChart Ultra 3.0*.
- **Engineering Disclaimer:** All calculations implement ASHRAE Fundamentals, ISO 7730, and ASHRAE 62.1 equations for engineering analysis and design convenience. Qualified HVAC and mechanical engineers should independently verify critical equipment selections and safety-related designs.
- **License:** Released under the **MIT License** — Copyright © 2026 Shadi Alashkar. See [`LICENSE`](LICENSE) for full terms.
