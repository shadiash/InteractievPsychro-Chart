A professional, engineering-grade **psychrometric chart** web application built as a single self-contained HTML file. Designed for HVAC engineers, mechanical designers, and building science professionals who need accurate air property analysis, process visualization, and reporting — right in the browser.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.6.6-green.svg)
![No Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)

---

## Features

### Interactive Psychrometric Chart
- Fully interactive **Canvas-based** chart with real-time hover readout (Tdb, W, RH%, h, v, Tdp, Twb)
- Smooth **zoom** (scroll wheel) and **pan** (click-drag) with fit-to-points and reset controls
- Configurable axis ranges for dry-bulb temperature and humidity ratio
- Toggleable chart layers: saturation curve, RH lines, enthalpy lines, specific volume lines, dew point lines, major/minor grids, comfort zones

### Dual Unit System
- **SI** — °C, g/kg, kJ/kg, m³/kg, kPa
- **IP (Imperial)** — °F, gr/lb, Btu/lb, ft³/lb, psi
- Instant unit switching with full recalculation

### ASHRAE-Compliant Calculations
All psychrometric computations follow **ASHRAE Fundamentals (2021)** using the Hyland-Wexler saturation model:
- Dry-bulb temperature (Tdb)
- Wet-bulb temperature (Twb)
- Relative humidity (RH%)
- Humidity ratio (W)
- Specific enthalpy (h)
- Specific volume (v)
- Dew point temperature (Tdp)
- Air density (ρ)
- Atmospheric pressure correction by altitude

### Flexible Point Management
- **Add points** by clicking the chart, entering parameters (Tdb + RH / Twb / W / Tdp / h), or via right-click context menu
- **Edit points** inline in the table — toggle between **Tdb + RH%** and **Tdb + Twb** edit modes
- **CSV bulk import** — paste comma-separated data (Tdb, RH%, Label per line)
- Drag-and-drop **label repositioning** on the chart
- Lock/unlock points, duplicate, delete
- Full property preview on hover and in the calculator tab

### Process Analysis
Processes are drawn between any two points, with **automatic classification** into 9 types:

| Process Type | Condition |
|---|---|
| Sensible Heating |
| Sensible Cooling |
| Cooling & Dehumidification |
| Heating & Humidification | 
| Humidification |
| Dehumidification | 
| Evaporative Cooling | 
| Cooling & Humidification |
| Heating & Dehumidification | 

Each process displays calculated metrics **with units**:
- ΔT, ΔW, Δh, SHR (Sensible Heat Ratio)
- Qs (sensible heat), Ql (latent heat), Qt (total heat) — based on user-entered airflow

### Air Mixing
- Select two source points and enter flow rates
- Flexible input: both absolute flows, or one flow + percentage
- Flow units: kg/s, L/s, lb/s, CFM
- Calculates the mixed-air state via **mass and energy balance** (lever rule)
- Automatically creates the mix point and connecting process lines

### ASHRAE 55 Comfort Zones
- **Summer zone** (0.5 clo) and **Winter zone** (1.0 clo) overlays
- Based on ASHRAE Standard 55 ET* boundaries
- Display options: None / Summer / Winter / Both
- Adjustable temperature offset for custom comfort analysis

### Coil / ADP Analysis
- Apparatus Dew Point (ADP) calculation for cooling processes
- Bypass Factor (BPF) and Contact Factor (CF)
- Ventilation load calculator with outdoor-air load estimation

### SHR Reference Line
- Toggleable Sensible Heat Ratio line from a reference point
- Adjustable SHR value (0–1)
- Visual guide for HVAC process design

### Themes & Customization
Four built-in visual styles plus a full custom editor:
- **Pro** — modern dark/light palette
- **Classic** — traditional HVAC chart colors
- **ASHRAE** — strict ASHRAE Handbook reproduction style
- **Custom** — full color/line editor for every chart element (background, grids, curves, points, labels, halos, arrow widths, font sizes)

### Project Save / Load
- Save full project state as **JSON** (points, processes, settings, metadata)
- Load saved projects to restore the exact chart state
- Project metadata: name, version, company, engineer, timestamp

### Export & Reporting
- **PNG** — export chart image or copy to clipboard
- **HTML Report** — standalone professional report with embedded chart, point data table, process summary, and metadata
- **DOCX Report** — Microsoft Word document with embedded chart, formatted tables, and professional styling

### Undo / Redo
- Full state-snapshot history (up to 80 levels)
- Tracks all point, process, and setting changes

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` / `Cmd+Y` | Redo |
| `P` | Toggle Process mode |
| `M` | Toggle Mix mode |
| `F` | Fit all points |
| `R` | Reset zoom |
| `G` | Toggle grid |
| `C` | Cycle comfort zones |
| `D` | Toggle dew point lines |
| `Delete` | Delete selected point |
| `1`–`7` | Toggle layers (Sat / RH / h / V / Tdp / Pts / Proc) |
| `?` | Show shortcuts panel |
| `Esc` | Cancel mode / close dialogs |
| `Scroll` | Zoom in/out |
| `Click + Drag` | Pan chart |

---

## Getting Started

### Option 1 — Open Directly
Simply open `PsychroChart Pro 2.6.6.html` in any modern browser (Chrome, Firefox, Edge, Safari). No server, no build step, no installation.

### Option 2 — Serve Locally
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .
```
Then navigate to `http://localhost:8000/PsychroChart Pro 2.6.6.html`

---

## Quick Start Guide

1. **Add points** — Click anywhere on the chart, or use the Points tab to enter exact values
2. **Create a process** — Press `P` (or click the Process button), then click two points
3. **View metrics** — Click a process card in the right panel to see ΔT, ΔW, Δh, SHR, and heat loads
4. **Mix air streams** — Press `M`, select two points, enter flow rates in the modal
5. **Export** — Click the Export button (PNG) or Generate Report (HTML/DOCX)

---

## Technology

| Component | Technology |
|---|---|
| Rendering | HTML5 Canvas 2D API |
| Logic | Vanilla JavaScript (ES6+) |
| Styling | CSS3 Custom Properties |
| Fonts | Google Fonts (DM Sans, JetBrains Mono) |
| Word Export | [docx.js](https://github.com/dolanmiu/docx) v9.1.0 (CDN) |
| Architecture | Single self-contained HTML file (~2300 lines) |
| Dependencies | **Zero** build-time dependencies |

---

## Psychrometric Reference

The calculations implement the following ASHRAE formulations:

- **Saturation pressure** — Magnus-type approximation per Hyland-Wexler (ASHRAE Fundamentals)
- **Humidity ratio** — `W = 0.621945 × Pv / (P - Pv)`
- **Enthalpy** — `h = 1.006 × T + W × (2501 + 1.86 × T)` kJ/kg
- **Specific volume** — `v = Rda × T_abs × (1 + W/0.621945) / P`
- **Wet-bulb** — iterative enthalpy balance: `h(Twb, Wsat(Twb)) = h(T, W)`
- **Dew point** — inverse saturation pressure from partial vapor pressure
- **Altitude correction** — barometric pressure per ASHRAE altitude correlation

Comfort zones follow **ASHRAE Standard 55** (ET* boundaries, PMV ±0.5, 0.5 clo summer / 1.0 clo winter).

---

## Browser Support

| Browser | Supported |
|---|---|
| Chrome 90+ | Yes |
| Firefox 90+ | Yes |
| Edge 90+ | Yes |
| Safari 15+ | Yes |
| Mobile browsers | Partial (desktop recommended) |

---

## Screenshots


---

## License

MIT License — free for personal and commercial use.

---

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests for:
- Bug fixes
- New psychrometric features
- UI/UX improvements
- Additional export formats
- Localization / i18n

---

## Author

Built for HVAC professionals who need a fast, accurate, and portable psychrometric analysis tool — no installation required.
