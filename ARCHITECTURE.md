# PsychroChart Ultra 3.0 — Architecture & Interface Contract

> Single source of truth for all modules, state shapes, DOM IDs, and event names.

## 1. Strict Internal SI Unit Rule
- All internal coordinates and state values are **SI**:
  - `T`: Dry-bulb temperature in `°C`
  - `w`: Humidity ratio in `kg/kg` (e.g. `0.010` = `10 g/kg`)
  - `pPa`: Barometric pressure in `Pa` (sea level = `101325`)
  - `view.tMin`, `view.tMax`: `°C`
  - `view.wMax`: `kg/kg` (default `0.030`)
- Display conversions to IP (`°F`, `gr/lb`, `Btu/lb` with true 0°F datum, `ft³/lb`, `BTU/h`, `Tons TR`) happen ONLY at the UI/rendering boundary.

## 2. Module Topological Order (Zero Circular Imports)
1. `src/core/contracts.js` — constants, DOM helpers, themes, unit formatting helpers
2. `src/engine/psychro.js` — `Psy` (ASHRAE 2021 physics & any-2-of-8 solver)
3. `src/engine/comfort.js` — `Comfort` (ISO 7730 / ASHRAE 55 PMV/PPD, Givoni, TC 9.9 Data Center, Mold/Condensation)
4. `src/engine/hvac.js` — `HVAC` (Process classifier, Loads, ADP/BPF, Mixing, ERV, Evap, Desiccant, Humidifier, AHU Cycle Builder, ASHRAE 62.1)
5. `src/engine/weather.js` — `Weather` (44+ global cities, Synthetic TMY 8760-hr, EPW/CSV parser, Psychrometric Bin Analytics)
6. `src/state/store.js` — `Store` (Reactive state, 100-level undo/redo, Scenarios, JSON v3/v2.6.6, URL hash, Autosave)
7. `src/render/baseRenderer.js` — `BaseRenderer` (Cached HiDPI base canvas: grid, heatmap, zones, sat/RH/WB/h/v/Tdp curves, enthalpy ruler, axes)
8. `src/render/overlayRenderer.js` — `OverlayRenderer` (Dynamic foreground canvas: scenario ghosts, processes, curved ADP paths, animated flow, SHR protractor, points, measure tool, annotations, crosshair)
9. `src/export/exporter.js` — `Exporter` (HiDPI PNG, Vector SVG, CSV, Print-ready HTML report, DOCX report, JSON, Share URL)
10. `src/ui/interaction.js` — `initChartInteraction` (Zoom, pan, shift-snap point drag, label drag, box zoom, process/mix/measure/annotate tools, context menu, HUD, shortcuts)
11. `src/ui/leftPanel.js` — `initLeftPanel` (Atmosphere, Cities, Weather/EPW, Comfort PMV controls, Points table, Universal Calc, Psychro Table)
12. `src/ui/rightPanel.js` — `initRightPanel` (Processes & per-process loads, AHU/ERV/Evap/Desiccant/Humidifier Wizards, Coil ADP & 62.1 Vent, Mixing & Scenarios)
13. `src/ui/modals.js` — `initModals`, `PRESETS` (6 HVAC Presets, Command Palette Ctrl+K, Edit/Add Point, Mix Flow, Report, Custom Theme Studio, Glossary, Shortcuts, About)
14. `src/app.js` — Application bootstrap & Top Bar wiring

## 3. Complete Canonical DOM ID Registry

### Root & Shell
- `#app` (attributes: `data-theme="studio-dark|drafting-light|ashrae-classic|blueprint-cad|custom"`)
- `#topBar`, `#logoClick`, `#projName`, `#projVer`, `#companyName`, `#engineerName`
- `#selTheme`, `#selUnits`, `#selPreset`, `#pUsed`
- `#btnUndo`, `#btnRedo`, `#btnCmdPalette`, `#btnSave`, `#btnLoad`, `#fileLoad`, `#btnShareUrl`, `#btnExportPng`, `#btnExportSvg`, `#btnExportCsv`, `#btnReport`, `#btnGlossary`, `#btnShortcuts`, `#btnAbout`
- `#btnToggleLeft`, `#btnToggleRight`, `#leftPanel`, `#rightPanel`, `#splitL`, `#splitR`

### Chart Workspace (`#chartWrap`)
- `#chartWrap`, `#cvBase`, `#cvOverlay`, `#yAxisLabel`
- `#chartToolbar`, `#layerToggles`, `#chartActions`
- Tool buttons: `#btnToolSelect`, `#btnToolProcess`, `#btnToolMix`, `#btnToolMeasure`, `#btnToolAnnotate`, `#btnToolBoxZoom`
- View buttons: `#btnFitScreen`, `#btnFitPoints`, `#btnZoomIn`, `#btnZoomOut`
- Mode banner: `#modeBanner`
- Floating HUD: `#hud`
- Scenario comparison banner: `#scenarioBanner`

### Left Panel Tabs (`tabAtmo`, `tabPoints`, `tabCalc`)
- **tabAtmo**:
  - `#citySelect`, `#btnPlotCity`, `#btnLoadCityTMY`
  - `#alt`, `#altUnit`, `#pOverride`, `#pUnit`, `#applyAtm`
  - `#epwDropZone`, `#epwFileInput`, `#weatherStats`, `#weatherMode`, `#weatherOpacity`, `#btnClearWeather`
  - `#tMin`, `#tMax`, `#wMax`, `#btnRedraw`, `#btnFit`, `#btnResetZoom`
  - `#density`, `#rhStep`, `#labelMode`, `#labelPx`, `#chkEnthRuler`, `#chkFlowAnim`
  - `#comfortMode`, `#pmvCloSummer`, `#pmvCloWinter`, `#pmvMet`, `#pmvVair`, `#pmvMrtOff`, `#pmvLimit`
  - `#chkGivoni`, `#chkDataCenter`
  - `#shrShow`, `#shrVal`, `#shrRefPt`
- **tabPoints**:
  - `#inMode1`, `#inVal1`, `#inMode2`, `#inVal2`, `#inLbl`, `#inColor`, `#connect`, `#addPt`
  - `#ptTblEditMode`, `#ptsTbl`, `#ptTblSecondHdr`
  - `#bulkCSV`, `#bulkImport`, `#btnClearPts`
- **tabCalc**:
  - `#calcIn1`, `#calcV1`, `#calcIn2`, `#calcV2`, `#calcBtn`, `#calcResults`, `#calcComfortSummary`, `#calcAddPt`
  - `#tblFrom`, `#tblTo`, `#tblStep`, `#tblGen`, `#tblCopyCsv`, `#psyTableWrap`

### Right Panel Tabs (`tabProc`, `tabSystems`, `tabCoil`, `tabMix`)
- **tabProc**:
  - `#procA`, `#procB`, `#procAdd`
  - `#processCards`, `#cycleSummary`
  - `#procSel`, `#flowVal`, `#flowUnit`, `#procDel`, `#procRev`, `#procCurveToggle`
  - Metrics: `#mDT`, `#mDW`, `#mDh`, `#mSHR`, `#mQs`, `#mQl`, `#mQt`, `#mWater`, `#mTons`
- **tabSystems**:
  - Sub-selector `#sysToolSel` (`ahu`, `erv`, `evap`, `desiccant`, `humidifier`)
  - Container panels: `#sysPanelAhu`, `#sysPanelErv`, `#sysPanelEvap`, `#sysPanelDesiccant`, `#sysPanelHumidifier`
  - AHU controls: `#ahuMode`, `#ahuOaT`, `#ahuOaRH`, `#ahuRaT`, `#ahuRaRH`, `#ahuOaPct`, `#ahuFlow`, `#ahuCoilAdp`, `#ahuCoilBpf`, `#ahuReheatT`, `#ahuFanDp`, `#ahuFanEff`, `#ahuErvSens`, `#ahuErvLat`, `#ahuBuildBtn`, `#ahuResults`
  - ERV controls: `#ervOaPt`, `#ervRaPt`, `#ervSensEff`, `#ervLatEff`, `#ervFlow`, `#ervCalcBtn`, `#ervPlotBtn`, `#ervResults`
  - Evap controls: `#evapInPt`, `#evapMode`, `#evapEffDir`, `#evapEffInd`, `#evapFlow`, `#evapCalcBtn`, `#evapPlotBtn`, `#evapResults`
  - Desiccant controls: `#desInPt`, `#desEff`, `#desCarry`, `#desFlow`, `#desCalcBtn`, `#desPlotBtn`, `#desResults`
  - Humidifier controls: `#humInPt`, `#humTargetW`, `#humMode`, `#humFlow`, `#humCalcBtn`, `#humPlotBtn`, `#humResults`
- **tabCoil**:
  - `#adpProc`, `#adpWaterDt`, `#adpCalc`, `#adpPlotBtn`, `#adpResults`
  - `#ventSpaceType`, `#ventPeople`, `#ventArea`, `#ventRp`, `#ventRa`, `#ventOaPt`, `#ventRaPt`, `#ventCalc`, `#ventResults`
- **tabMix**:
  - `#mixA`, `#mixB`, `#mixC`, `#mixWA`, `#mixWB`, `#mixWC`, `#mixUnit`, `#mixLbl`, `#mixAdd`, `#mixPreview`
  - `#scenName`, `#btnSaveScen`, `#scenList`, `#scenCompareSummary`

### Context Menu & Modals
- `#ctxMenu` (items with `data-action`)
- `#toastContainer`
- `#cmdPaletteOverlay`, `#cmdInput`, `#cmdList`
- `#editPtOverlay`, `#epTitle`, `#epLabel`, `#epColor`, `#epNote`, `#epTdbLabel`, `#epTdb`, `#epMode`, `#epValLabel`, `#epVal`, `#epRH`, `#epW`, `#epWLbl`, `#epH`, `#epHLbl`, `#epTwb`, `#epTwbLbl`, `#epTdp`, `#epTdpLbl`, `#epV`, `#epVLbl`, `#epPmv`, `#epApply`, `#epCancel`
- `#addPtParamOverlay`, `#apMode1`, `#apVal1`, `#apMode2`, `#apVal2`, `#apLabel`, `#apColor`, `#apPreview`, `#apAdd`, `#apCancel`
- `#mixFlowOverlay`, `#mixFlowMethod`, `#mixFlowUnit`, `#mixFlowNameA`, `#mixFlowPropsA`, `#mixFlowLblA`, `#mixFlowValA`, `#mixFlowHintA`, `#mixFlowNameB`, `#mixFlowPropsB`, `#mixFlowLblB`, `#mixFlowValB`, `#mixFlowHintB`, `#mixFlowLabel`, `#mixFlowOk`, `#mixFlowCancel`
- `#reportOverlay`, `#rptChart`, `#rptProc`, `#rptComfort`, `#rptWeather`, `#rptPrint`, `#rptGenerate`, `#rptCancel`
- `#themeEditorOverlay`, `#ctApply`, `#ctResetDefault`, `#closeThemeEditor` (plus `ct_*` controls)
- `#glossaryOverlay`, `#closeGlossary`
- `#shortcutsOverlay`, `#closeShortcuts`
- `#aboutOverlay`, `#closeAbout`

## 4. Bundler Rules (`scripts/build.mjs`)
- Every file under `src/` uses standard ES6 `import` / `export` syntax.
- **Avoid duplicate top-level identifier names across different files** (prefix internal helpers with module prefix or wrap internals cleanly inside exported objects/classes/IIFEs!) so both native ES modules AND single-file IIFE bundling work with ZERO name collisions!
