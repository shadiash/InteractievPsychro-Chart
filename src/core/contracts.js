/* ============================================================================
   PsychroChart Ultra 3.0 — Core Contracts, Constants & Shared Utilities
   ============================================================================ */

export const APP_VERSION = '3.0.0';
export const APP_NAME = 'PSYCHRO·ULTRA';

export const POINT_PALETTE = [
  '#f43f5e', '#38bdf8', '#10b981', '#f59e0b', '#fb923c',
  '#14b8a6', '#ec4899', '#eab308', '#60a5fa', '#84cc16'
];

export const PROCESS_COLORS = {
  heat: '#ef4444',
  cool: '#2563eb',
  humid: '#10b981',
  dehum: '#d97706',
  evap: '#06b6d4',
  mix: '#ca8a04',
  desiccant: '#ea580c',
  erv: '#0d9488',
  neutral: '#64748b'
};

export const DEFAULT_CUSTOM_THEME = {
  bg: '#0c1017',
  plotBg: '#0f1520',
  sat: '#22d3ee', sat_ls: 'solid', sat_lw: 2.5,
  rh: '#38bdf8', rh_ls: 'solid', rh_lw: 0.9,
  wb: '#f59e0b', wb_ls: 'dashed', wb_lw: 0.85,
  enth: '#fb923c', enth_ls: 'solid', enth_lw: 0.9,
  vline: '#84cc16', vline_ls: 'solid', vline_lw: 0.8,
  dp: '#94a3b8', dp_ls: 'dotted', dp_lw: 0.8,
  grid2: '#243044', grid2_ls: 'solid', grid2_lw: 1.0,
  grid: '#172030', grid_ls: 'solid', grid_lw: 0.7,
  border: '#475569', border_lw: 1.5,
  pt: '#f43f5e', ptSize: 4.5, arrowW: 2.5,
  axisText: '#94a3b8', axisPx: 10,
  lblText: '#94a3b8', lblPx: 11,
  halo: '#0c1017', haloW: 3
};

export const DEFAULT_AXIS_STYLE = {
  frame: 'full-box',
  tickDir: 'out',
  yAxisSide: 'both',
  showSubTicks: true,
  showDualPvScale: false,
  enthalpyRulerStyle: 'ashrae-rail',
  curveLabelStyle: 'tangent-inline',
  gridClipping: 'below-sat'
};

export const DEFAULT_TREND_STYLE = {
  arrowStyle: 'cad-chevron',
  lineWeight: 'standard',
  pointMarker: 'precision-ring',
  badgeStyle: 'detailed',
  showDecompLegs: false
};

export const THEME_PRESETS = {
  'studio-dark': {
    id: 'studio-dark',
    name: 'Studio Dark',
    shortName: 'Studio Dark',
    subtitle: 'Modern Dark CAD Workstation',
    isDark: true,
    bg: '#0c1017', plotBg: '#0f1520',
    sat: '#22d3ee', rh: '#38bdf8', wb: '#f59e0b', enth: '#fb923c', vline: '#84cc16', dp: '#94a3b8',
    grid: 'rgba(148,163,184,0.06)', grid2: 'rgba(148,163,184,0.16)', border: '#475569',
    fg: '#e6edf7', muted: '#8b9cb5', halo: 'rgba(12,16,23,0.92)',
    pt: '#f43f5e', heat: '#f87171', cool: '#38bdf8', humid: '#34d399', dehum: '#fbbf24', evap: '#22d3ee', mix: '#facc15', desiccant: '#fb923c', erv: '#2dd4bf',
    lw: { sat: 2.5, rh: 0.9, wb: 0.85, enth: 0.85, vline: 0.8, dp: 0.8 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'solid', vline: 'solid', dp: 'dotted', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'full-box',
      tickDir: 'out',
      yAxisSide: 'both',
      showSubTicks: true,
      showDualPvScale: false,
      enthalpyRulerStyle: 'ashrae-rail',
      curveLabelStyle: 'tangent-inline',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'cad-chevron',
      lineWeight: 'standard',
      pointMarker: 'precision-ring',
      badgeStyle: 'detailed',
      showDecompLegs: false
    },
    recommended: { rhStep: 10, dp: false }
  },
  'drafting-light': {
    id: 'drafting-light',
    name: 'Drafting Light',
    shortName: 'Drafting',
    subtitle: 'Modern Architectural White',
    isDark: false,
    bg: '#f8fafc', plotBg: '#ffffff',
    sat: '#0e7490', rh: '#0284c7', wb: '#b45309', enth: '#c2410c', vline: '#4d7c0f', dp: '#64748b',
    grid: 'rgba(51,65,85,0.07)', grid2: 'rgba(51,65,85,0.18)', border: '#334155',
    fg: '#0f172a', muted: '#475569', halo: 'rgba(255,255,255,0.95)',
    pt: '#be123c', heat: '#dc2626', cool: '#1d4ed8', humid: '#059669', dehum: '#b45309', evap: '#0891b2', mix: '#a16207', desiccant: '#c2410c', erv: '#0f766e',
    lw: { sat: 2.4, rh: 0.85, wb: 0.8, enth: 0.8, vline: 0.75, dp: 0.7 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'solid', vline: 'solid', dp: 'dotted', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'full-box',
      tickDir: 'out',
      yAxisSide: 'both',
      showSubTicks: true,
      showDualPvScale: false,
      enthalpyRulerStyle: 'ashrae-rail',
      curveLabelStyle: 'tangent-inline',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'cad-chevron',
      lineWeight: 'standard',
      pointMarker: 'precision-ring',
      badgeStyle: 'detailed',
      showDecompLegs: false
    },
    recommended: { rhStep: 10, dp: false }
  },
  'ashrae-classic': {
    id: 'ashrae-classic',
    name: 'ASHRAE Handbook',
    shortName: 'ASHRAE',
    subtitle: 'Official ASHRAE Chart No. 1 Style',
    isDark: false,
    bg: '#f7f5ee', plotBg: '#fdfcf8',
    sat: '#111827', rh: '#1e40af', wb: '#15803d', enth: '#9a3412', vline: '#b91c1c', dp: '#57534e',
    grid: 'rgba(28,25,23,0.06)', grid2: 'rgba(28,25,23,0.16)', border: '#1c1917',
    fg: '#1c1917', muted: '#44403c', halo: 'rgba(253,252,248,0.95)',
    pt: '#b91c1c', heat: '#b91c1c', cool: '#1e40af', humid: '#15803d', dehum: '#9a3412', evap: '#0e7490', mix: '#854d0e', desiccant: '#9a3412', erv: '#0f766e',
    lw: { sat: 2.6, rh: 0.75, wb: 0.7, enth: 0.7, vline: 0.65, dp: 0.6 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'solid', vline: 'solid', dp: 'dotted', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'ashrae-open',
      tickDir: 'out',
      yAxisSide: 'right',
      showSubTicks: true,
      showDualPvScale: true,
      enthalpyRulerStyle: 'ashrae-rail',
      curveLabelStyle: 'tangent-inline',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'solid-triangle',
      lineWeight: 'standard',
      pointMarker: 'solid-dot',
      badgeStyle: 'pill',
      showDecompLegs: false
    },
    recommended: { rhStep: 10, dp: false }
  },
  'carrier-classic': {
    id: 'carrier-classic',
    name: 'Carrier Classic',
    shortName: 'Carrier',
    subtitle: 'Iconic Willis Carrier Green/Red Wall Chart',
    isDark: false,
    bg: '#ffffff', plotBg: '#fcfdfb',
    sat: '#0f172a', rh: '#1d4ed8', wb: '#b91c1c', enth: '#dc2626', vline: '#15803d', dp: '#475569',
    grid: 'rgba(21,128,61,0.10)', grid2: 'rgba(21,128,61,0.24)', border: '#14532d',
    fg: '#0f172a', muted: '#334155', halo: 'rgba(252,253,251,0.95)',
    pt: '#dc2626', heat: '#dc2626', cool: '#1d4ed8', humid: '#15803d', dehum: '#b45309', evap: '#0e7490', mix: '#854d0e', desiccant: '#c2410c', erv: '#0f766e',
    lw: { sat: 2.6, rh: 0.85, wb: 0.8, enth: 0.85, vline: 0.75, dp: 0.7 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'solid', vline: 'dashdot', dp: 'dotted', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'ashrae-open',
      tickDir: 'cross',
      yAxisSide: 'right',
      showSubTicks: true,
      showDualPvScale: true,
      enthalpyRulerStyle: 'carrier-dual',
      curveLabelStyle: 'tangent-inline',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'solid-triangle',
      lineWeight: 'bold',
      pointMarker: 'crosshair-circle',
      badgeStyle: 'detailed',
      showDecompLegs: true
    },
    recommended: { rhStep: 10, dp: false }
  },
  'trane-hvac': {
    id: 'trane-hvac',
    name: 'Trane HVAC',
    shortName: 'Trane',
    subtitle: 'Classic Trane Engineering Blue/Amber Chart',
    isDark: false,
    bg: '#f8fafc', plotBg: '#ffffff',
    sat: '#0f3b6e', rh: '#0369a1', wb: '#b45309', enth: '#c2410c', vline: '#3f6212', dp: '#64748b',
    grid: 'rgba(15,59,110,0.07)', grid2: 'rgba(15,59,110,0.18)', border: '#0f3b6e',
    fg: '#0f172a', muted: '#475569', halo: 'rgba(255,255,255,0.95)',
    pt: '#c2410c', heat: '#c2410c', cool: '#0369a1', humid: '#15803d', dehum: '#b45309', evap: '#0e7490', mix: '#a16207', desiccant: '#ea580c', erv: '#0f766e',
    lw: { sat: 2.6, rh: 0.85, wb: 0.8, enth: 0.85, vline: 0.75, dp: 0.7 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'solid', vline: 'solid', dp: 'dotted', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'full-box',
      tickDir: 'out',
      yAxisSide: 'right',
      showSubTicks: true,
      showDualPvScale: true,
      enthalpyRulerStyle: 'ashrae-rail',
      curveLabelStyle: 'clean-pill',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'cad-chevron',
      lineWeight: 'bold',
      pointMarker: 'precision-ring',
      badgeStyle: 'detailed',
      showDecompLegs: false
    },
    recommended: { rhStep: 10, dp: false }
  },
  'cibse-metric': {
    id: 'cibse-metric',
    name: 'CIBSE Metric',
    shortName: 'CIBSE',
    subtitle: 'UK CIBSE Guide C Standard',
    isDark: false,
    bg: '#f6f8f7', plotBg: '#fbfdfc',
    sat: '#1e293b', rh: '#047857', wb: '#0e7490', enth: '#be185d', vline: '#854d0e', dp: '#475569',
    grid: 'rgba(4,120,87,0.07)', grid2: 'rgba(4,120,87,0.17)', border: '#1e293b',
    fg: '#0f172a', muted: '#475569', halo: 'rgba(251,253,252,0.95)',
    pt: '#be185d', heat: '#be185d', cool: '#0e7490', humid: '#047857', dehum: '#854d0e', evap: '#0f766e', mix: '#a16207', desiccant: '#9a3412', erv: '#047857',
    lw: { sat: 2.5, rh: 0.85, wb: 0.8, enth: 0.85, vline: 0.75, dp: 0.7 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'solid', vline: 'dashdot', dp: 'dotted', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'full-box',
      tickDir: 'in',
      yAxisSide: 'right',
      showSubTicks: true,
      showDualPvScale: true,
      enthalpyRulerStyle: 'ashrae-rail',
      curveLabelStyle: 'tangent-inline',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'open-vector',
      lineWeight: 'standard',
      pointMarker: 'diamond',
      badgeStyle: 'pill',
      showDecompLegs: false
    },
    recommended: { rhStep: 5, dp: false }
  },
  'mollier-din': {
    id: 'mollier-din',
    name: 'Mollier / DIN',
    shortName: 'Mollier',
    subtitle: 'European High-Precision Technical Chart',
    isDark: false,
    bg: '#f8fafc', plotBg: '#ffffff',
    sat: '#0f172a', rh: '#1d4ed8', wb: '#0f766e', enth: '#b91c1c', vline: '#3f6212', dp: '#475569',
    grid: 'rgba(15,23,42,0.06)', grid2: 'rgba(15,23,42,0.16)', border: '#0f172a',
    fg: '#0f172a', muted: '#475569', halo: 'rgba(255,255,255,0.95)',
    pt: '#b91c1c', heat: '#b91c1c', cool: '#1d4ed8', humid: '#0f766e', dehum: '#9a3412', evap: '#0e7490', mix: '#854d0e', desiccant: '#c2410c', erv: '#047857',
    lw: { sat: 2.4, rh: 0.8, wb: 0.75, enth: 0.8, vline: 0.7, dp: 0.65 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dotted', enth: 'solid', vline: 'dashdot', dp: 'dashed', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'cad-ticks',
      tickDir: 'in',
      yAxisSide: 'both',
      showSubTicks: true,
      showDualPvScale: true,
      enthalpyRulerStyle: 'ashrae-rail',
      curveLabelStyle: 'end-aligned',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'open-vector',
      lineWeight: 'fine',
      pointMarker: 'crosshair-circle',
      badgeStyle: 'inline-minimal',
      showDecompLegs: true
    },
    recommended: { rhStep: 5, dp: true }
  },
  'print-bw': {
    id: 'print-bw',
    name: 'Print B&W',
    shortName: 'Print B&W',
    subtitle: 'IEEE / ASME Monochrome Publication Ready',
    isDark: false,
    bg: '#ffffff', plotBg: '#ffffff',
    sat: '#000000', rh: '#262626', wb: '#404040', enth: '#171717', vline: '#525252', dp: '#737373',
    grid: 'rgba(0,0,0,0.06)', grid2: 'rgba(0,0,0,0.18)', border: '#000000',
    fg: '#000000', muted: '#404040', halo: 'rgba(255,255,255,0.98)',
    pt: '#000000', heat: '#111111', cool: '#262626', humid: '#404040', dehum: '#262626', evap: '#404040', mix: '#171717', desiccant: '#262626', erv: '#404040',
    lw: { sat: 2.7, rh: 0.85, wb: 0.85, enth: 0.9, vline: 0.85, dp: 0.65 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'dashdot', vline: 'dotted', dp: 'dotted', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'full-box',
      tickDir: 'in',
      yAxisSide: 'both',
      showSubTicks: true,
      showDualPvScale: false,
      enthalpyRulerStyle: 'ashrae-rail',
      curveLabelStyle: 'tangent-inline',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'solid-triangle',
      lineWeight: 'standard',
      pointMarker: 'solid-dot',
      badgeStyle: 'inline-minimal',
      showDecompLegs: true
    },
    recommended: { rhStep: 10, dp: false }
  },
  'blueprint-cad': {
    id: 'blueprint-cad',
    name: 'Blueprint CAD',
    shortName: 'Blueprint',
    subtitle: 'Classic Cyanotype Drafting Table',
    isDark: true,
    bg: '#081b33', plotBg: '#0b2444',
    sat: '#f8fafc', rh: '#7dd3fc', wb: '#fde047', enth: '#fdba74', vline: '#86efac', dp: '#cbd5e1',
    grid: 'rgba(186,230,253,0.08)', grid2: 'rgba(186,230,253,0.22)', border: '#7dd3fc',
    fg: '#f0f9ff', muted: '#93c5fd', halo: 'rgba(11,36,68,0.92)',
    pt: '#fde047', heat: '#fb7185', cool: '#38bdf8', humid: '#4ade80', dehum: '#fbbf24', evap: '#22d3ee', mix: '#fde047', desiccant: '#fdba74', erv: '#5eead4',
    lw: { sat: 2.4, rh: 0.85, wb: 0.8, enth: 0.8, vline: 0.75, dp: 0.7 },
    ls: { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'solid', vline: 'solid', dp: 'dotted', grid: 'solid', grid2: 'solid' },
    axisStyle: {
      frame: 'cad-ticks',
      tickDir: 'cross',
      yAxisSide: 'both',
      showSubTicks: true,
      showDualPvScale: true,
      enthalpyRulerStyle: 'carrier-dual',
      curveLabelStyle: 'tangent-inline',
      gridClipping: 'below-sat'
    },
    trendStyle: {
      arrowStyle: 'open-vector',
      lineWeight: 'standard',
      pointMarker: 'crosshair-circle',
      badgeStyle: 'detailed',
      showDecompLegs: true
    },
    recommended: { rhStep: 10, dp: false }
  }
};

export const CHART_VISUAL_PRESETS = THEME_PRESETS;

export const DEFAULT_LAYERS = {
  grid: true,
  gridMinor: true,
  sat: true,
  rh: true,
  wb: true,
  enth: true,
  vlines: true,
  dp: false,
  comfort: true,
  givoni: false,
  datacenter: false,
  weather: false,
  points: true,
  designPts: true,
  processes: true,
  mixlinks: true,
  adpLines: true,
  annotations: true,
  flowAnim: false
};

export const UNIT_LABELS = {
  SI: {
    T: '°C',
    W: 'g/kg',
    h: 'kJ/kg',
    v: 'm³/kg',
    rho: 'kg/m³',
    P: 'kPa',
    flow: 'L/s',
    massFlow: 'kg/s',
    Q: 'kW',
    water: 'kg/h',
    alt: 'm',
    area: 'm²'
  },
  IP: {
    T: '°F',
    W: 'gr/lb',
    h: 'Btu/lb',
    v: 'ft³/lb',
    rho: 'lb/ft³',
    P: 'psia',
    flow: 'CFM',
    massFlow: 'lb/s',
    Q: 'BTU/h',
    water: 'lb/h',
    alt: 'ft',
    area: 'ft²'
  }
};

export const CoreDOM = {
  byId(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  },
  on(node, evt, fn, opts) {
    if (node) node.addEventListener(evt, fn, opts);
  },
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  },
  clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  },
  round(v, dec = 2) {
    if (!Number.isFinite(v)) return NaN;
    const f = Math.pow(10, dec);
    return Math.round(v * f) / f;
  },
  cToF(c) { return c * 1.8 + 32; },
  fToC(f) { return (f - 32) / 1.8; },
  dCtoF(dc) { return dc * 1.8; },
  wToDisp(wKgKg, units) {
    return units === 'SI' ? wKgKg * 1000 : wKgKg * 7000;
  },
  dispToW(val, units) {
    return units === 'SI' ? val / 1000 : val / 7000;
  },
  tToDisp(tC, units) {
    return units === 'SI' ? tC : tC * 1.8 + 32;
  },
  dispToT(val, units) {
    return units === 'SI' ? val : (val - 32) / 1.8;
  },
  isDarkColor(colorStr) {
    if (typeof colorStr !== 'string') return true;
    const s = colorStr.trim();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const h = hex[1];
      const r = h.length === 3 ? parseInt(h[0] + h[0], 16) : parseInt(h.slice(0, 2), 16);
      const g = h.length === 3 ? parseInt(h[1] + h[1], 16) : parseInt(h.slice(2, 4), 16);
      const b = h.length === 3 ? parseInt(h[2] + h[2], 16) : parseInt(h.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
    }
    const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (rgb) {
      return (0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])) < 128;
    }
    return true;
  },
  resolveThemePalette(themeName, customTheme) {
    const defaultLs = {
      sat: 'solid',
      rh: 'solid',
      wb: 'dashed',
      enth: 'solid',
      vline: 'solid',
      dp: 'dotted',
      grid: 'solid',
      grid2: 'solid'
    };
    if (themeName === 'custom' && customTheme) {
      const plotBg = customTheme.plotBg || customTheme.bg || DEFAULT_CUSTOM_THEME.plotBg;
      return {
        id: 'custom',
        name: 'Custom',
        shortName: 'Custom',
        subtitle: 'Custom User Theme',
        isDark: CoreDOM.isDarkColor(plotBg),
        bg: customTheme.bg,
        plotBg,
        sat: customTheme.sat,
        rh: customTheme.rh,
        wb: customTheme.wb || customTheme.enth,
        enth: customTheme.enth,
        vline: customTheme.vline,
        dp: customTheme.dp,
        grid: customTheme.grid,
        grid2: customTheme.grid2,
        border: customTheme.border,
        fg: customTheme.axisText,
        muted: customTheme.lblText,
        halo: customTheme.halo,
        pt: customTheme.pt,
        heat: '#f87171', cool: '#38bdf8', humid: '#34d399', dehum: '#fbbf24',
        evap: '#22d3ee', mix: '#facc15', desiccant: '#fb923c', erv: '#2dd4bf',
        lw: {
          sat: customTheme.sat_lw || 2.5,
          rh: customTheme.rh_lw || 0.9,
          wb: customTheme.wb_lw || 0.85,
          enth: customTheme.enth_lw || 0.9,
          vline: customTheme.vline_lw || 0.8,
          dp: customTheme.dp_lw || 0.8
        },
        ls: {
          sat: customTheme.sat_ls || defaultLs.sat,
          rh: customTheme.rh_ls || defaultLs.rh,
          wb: customTheme.wb_ls || defaultLs.wb,
          enth: customTheme.enth_ls || defaultLs.enth,
          vline: customTheme.vline_ls || defaultLs.vline,
          dp: customTheme.dp_ls || defaultLs.dp,
          grid: customTheme.grid_ls || defaultLs.grid,
          grid2: customTheme.grid2_ls || defaultLs.grid2
        },
        axisStyle: { ...DEFAULT_AXIS_STYLE, ...(customTheme.axisStyle || {}) },
        trendStyle: { ...DEFAULT_TREND_STYLE, ...(customTheme.trendStyle || {}) },
        recommended: { rhStep: 10, dp: false },
        ptSize: customTheme.ptSize || 4.5,
        arrowW: customTheme.arrowW || 2.5,
        axisPx: customTheme.axisPx || 10,
        lblPx: customTheme.lblPx || 11,
        haloW: customTheme.haloW ?? 3,
        border_lw: customTheme.border_lw || 1.5,
        grid_lw: customTheme.grid_lw || 0.7,
        grid2_lw: customTheme.grid2_lw || 1.0
      };
    }
    const base = THEME_PRESETS[themeName] || THEME_PRESETS['studio-dark'];
    return {
      ...base,
      shortName: base.shortName || base.name,
      isDark: typeof base.isDark === 'boolean' ? base.isDark : CoreDOM.isDarkColor(base.plotBg || base.bg),
      lw: { ...(base.lw || { sat: 2.5, rh: 0.9, wb: 0.85, enth: 0.85, vline: 0.8, dp: 0.8 }) },
      ls: { ...defaultLs, ...(base.ls || {}) },
      axisStyle: { ...DEFAULT_AXIS_STYLE, ...(base.axisStyle || {}) },
      trendStyle: { ...DEFAULT_TREND_STYLE, ...(base.trendStyle || {}) },
      recommended: base.recommended ? { ...base.recommended } : { rhStep: 10, dp: false },
      ptSize: base.ptSize ?? 4.5,
      arrowW: base.arrowW ?? 2.5,
      axisPx: base.axisPx ?? 10,
      lblPx: base.lblPx ?? 11,
      haloW: base.haloW ?? 3,
      border_lw: base.border_lw ?? 1.5,
      grid_lw: base.grid_lw ?? 0.7,
      grid2_lw: base.grid2_lw ?? 1.0
    };
  },
  isDesignCityPoint(p) {
    if (!p || typeof p !== 'object') return false;
    if (p.designTag || p.cityId) return true;
    const note = typeof p.note === 'string' ? p.note : '';
    if (/^ASHRAE\s+(Cooling|Heating)\s+(0\.4%|1%|99\.6%)/i.test(note)) return true;
    const lbl = typeof p.label === 'string' ? p.label : '';
    return /\b(Sum\s*0\.4%|Sum\s*1%|Win\s*99\.6%|0\.4%\s*Cool|1%\s*Cool|99\.6%\s*Heat)\b/i.test(lbl);
  },
  isPointVisible(p, state) {
    if (!p || !Number.isFinite(p.T) || !Number.isFinite(p.w)) return false;
    const layers = state?.layers || {};
    if (layers.points === false) return false;
    if (p.hidden) return false;
    if (layers.designPts === false && CoreDOM.isDesignCityPoint(p)) return false;
    return true;
  },
  computePointScale(view, isDesignPt = false) {
    const tSpan = Math.max(4, (view?.tMax ?? 55) - (view?.tMin ?? -10));
    const wSpan = Math.max(0.003, view?.wMax ?? 0.030);
    const zT = 65 / tSpan;
    const zW = 0.030 / wSpan;
    const zGeom = Math.sqrt(zT * zW);
    const zEff = Math.min(zGeom, Math.min(zT, zW) * 1.08);
    const base = zEff < 1
      ? CoreDOM.clamp(Math.pow(zEff, 0.85), 0.44, 1.0)
      : CoreDOM.clamp(Math.pow(zEff, 0.28), 1.0, 1.24);
    return isDesignPt ? CoreDOM.clamp(base * 0.82, 0.38, 1.05) : base;
  }
};
