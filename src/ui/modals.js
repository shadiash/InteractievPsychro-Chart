/* ============================================================================
   PsychroChart Ultra 3.0 — Presets Library, Command Palette (Ctrl+K) & Modals
   All internal psychrometric coordinates strictly SI (°C, kg/kg, Pa, kJ/kg).
   ============================================================================ */

import {
  APP_VERSION,
  CoreDOM,
  POINT_PALETTE,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_AXIS_STYLE,
  DEFAULT_TREND_STYLE,
  THEME_PRESETS
} from '../core/contracts.js';
import { Psy } from '../engine/psychro.js';
import { Comfort } from '../engine/comfort.js';
import { HVAC } from '../engine/hvac.js';
import { Weather } from '../engine/weather.js';

/* ============================================================================
   Internal Module-Prefixed Helpers (Safe for Single-File IIFE Bundling)
   ============================================================================ */

const _MOD_V_IP_PER_SI = Psy.FT3_PER_M3 / Psy.LB_PER_KG; // 16.01846337 ft³/lb per m³/kg

const _MOD_THEMES = [
  {
    id: 'ashrae-classic',
    name: 'ASHRAE Handbook',
    shortName: 'ASHRAE',
    desc: 'Official ASHRAE Chart No. 1 cream paper, open frame & Pv scale',
    icon: '▤',
    swatchAccent: '#1e40af',
    keywords: 'ashrae handbook classic chart 1 cream paper standard axis trend pv'
  },
  {
    id: 'carrier-classic',
    name: 'Carrier Classic',
    shortName: 'Carrier',
    desc: 'Iconic Willis Carrier green grid, red wet-bulb & dual enthalpy rail',
    icon: '✚',
    swatchAccent: '#15803d',
    keywords: 'carrier classic willis green red wall chart dual enthalpy axis trend'
  },
  {
    id: 'trane-hvac',
    name: 'Trane HVAC',
    shortName: 'Trane',
    desc: 'Classic Trane engineering blue & amber bold process trend chart',
    icon: '◈',
    swatchAccent: '#0f3b6e',
    keywords: 'trane hvac blue amber engineering standard bold axis trend'
  },
  {
    id: 'cibse-metric',
    name: 'CIBSE Metric',
    shortName: 'CIBSE',
    desc: 'UK CIBSE Guide C emerald/teal metric standard with inward ticks',
    icon: '❖',
    swatchAccent: '#047857',
    keywords: 'cibse uk metric guide c emerald inward ticks diamond axis trend'
  },
  {
    id: 'mollier-din',
    name: 'Mollier / DIN',
    shortName: 'Mollier',
    desc: 'European DIN high-precision chart with CAD ticks & ΔT/ΔW legs',
    icon: '⌖',
    swatchAccent: '#b91c1c',
    keywords: 'mollier din european german precision cad ticks crosshair axis trend'
  },
  {
    id: 'print-bw',
    name: 'Print B&W',
    shortName: 'Print B&W',
    desc: 'IEEE / ASME high-contrast monochrome print paper chart',
    icon: '⎙',
    swatchAccent: '#000000',
    keywords: 'print bw monochrome black white paper ieee asme grayscale publication axis trend'
  },
  {
    id: 'studio-dark',
    name: 'Studio Dark',
    shortName: 'Studio Dark',
    desc: 'Deep graphite modern dark CAD workstation',
    icon: '◐',
    swatchAccent: '#22d3ee',
    keywords: 'studio dark graphite night modern cad workstation axis trend'
  },
  {
    id: 'drafting-light',
    name: 'Drafting Light',
    shortName: 'Drafting',
    desc: 'Clean architectural paper light workspace',
    icon: '☀',
    swatchAccent: '#0284c7',
    keywords: 'drafting light architectural white paper clean workspace axis trend'
  },
  {
    id: 'blueprint-cad',
    name: 'Blueprint CAD',
    shortName: 'Blueprint',
    desc: 'High-contrast cyanotype drafting table with crosshair markers',
    icon: '❖',
    swatchAccent: '#7dd3fc',
    keywords: 'blueprint cad cyanotype drafting table cyan technical crosshair axis trend'
  }
];

const _MOD_MODAL_IDS = [
  'cmdPaletteOverlay',
  'editPtOverlay',
  'addPtParamOverlay',
  'mixFlowOverlay',
  'reportOverlay',
  'themeEditorOverlay',
  'glossaryOverlay',
  'shortcutsOverlay',
  'aboutOverlay'
];

function _modState(store) {
  return store?.state || store || {};
}

function _modPressure(store) {
  const p = Number(_modState(store).pPa);
  return Number.isFinite(p) && p > 10000 ? p : 101325;
}

function _modUnits(store) {
  return _modState(store).units === 'IP' ? 'IP' : 'SI';
}

function _modRedraw(store, baseRenderer, overlayRenderer, dirtyBase = false) {
  const st = _modState(store);
  if (dirtyBase) {
    baseRenderer?.invalidate?.();
    baseRenderer?.markDirty?.();
    baseRenderer?.render?.(st, true);
  }
  overlayRenderer?.render?.(st);
}

function _modNormHex(color, fallback = '#38bdf8') {
  if (typeof color !== 'string') return fallback;
  const s = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) {
    const hex = [m[1], m[2], m[3]]
      .map(n => CoreDOM.clamp(Math.round(Number(n) || 0), 0, 255).toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  }
  return fallback;
}

function _modBlendHex(color, bgHex = '#0f1520', fallback = '#38bdf8') {
  if (typeof color !== 'string') return fallback;
  const s = color.trim();
  if (/^#[0-9a-fA-F]{3,6}$/.test(s)) return _modNormHex(s, fallback);
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return fallback;
  const r = Number(m[1]) || 0;
  const g = Number(m[2]) || 0;
  const b = Number(m[3]) || 0;
  const a = m[4] !== undefined ? CoreDOM.clamp(Number(m[4]), 0, 1) : 1;
  const bg = _modNormHex(bgHex, '#0f1520');
  const br = parseInt(bg.slice(1, 3), 16);
  const bgG = parseInt(bg.slice(3, 5), 16);
  const bb = parseInt(bg.slice(5, 7), 16);
  const mix = (fgC, bgC) => CoreDOM.clamp(Math.round(fgC * a + bgC * (1 - a)), 0, 255).toString(16).padStart(2, '0');
  return `#${mix(r, br)}${mix(g, bgG)}${mix(b, bb)}`;
}

function _modPresetToCustomTheme(preset) {
  if (!preset) return { ...DEFAULT_CUSTOM_THEME };
  const plotBg = _modNormHex(preset.plotBg || preset.bg, DEFAULT_CUSTOM_THEME.plotBg);
  const bg = _modNormHex(preset.bg || plotBg, DEFAULT_CUSTOM_THEME.bg);
  const lw = preset.lw || {};
  const ls = preset.ls || {};
  const lineWeight = preset.trendStyle?.lineWeight || 'standard';
  const arrowW = preset.arrowW ?? (lineWeight === 'bold' ? 3.2 : (lineWeight === 'fine' ? 1.8 : 2.5));
  return {
    ...DEFAULT_CUSTOM_THEME,
    bg,
    plotBg,
    sat: _modNormHex(preset.sat, DEFAULT_CUSTOM_THEME.sat),
    sat_ls: ls.sat || DEFAULT_CUSTOM_THEME.sat_ls,
    sat_lw: lw.sat ?? DEFAULT_CUSTOM_THEME.sat_lw,
    rh: _modNormHex(preset.rh, DEFAULT_CUSTOM_THEME.rh),
    rh_ls: ls.rh || DEFAULT_CUSTOM_THEME.rh_ls,
    rh_lw: lw.rh ?? DEFAULT_CUSTOM_THEME.rh_lw,
    wb: _modNormHex(preset.wb, DEFAULT_CUSTOM_THEME.wb),
    wb_ls: ls.wb || DEFAULT_CUSTOM_THEME.wb_ls,
    wb_lw: lw.wb ?? DEFAULT_CUSTOM_THEME.wb_lw,
    enth: _modNormHex(preset.enth, DEFAULT_CUSTOM_THEME.enth),
    enth_ls: ls.enth || DEFAULT_CUSTOM_THEME.enth_ls,
    enth_lw: lw.enth ?? DEFAULT_CUSTOM_THEME.enth_lw,
    vline: _modNormHex(preset.vline, DEFAULT_CUSTOM_THEME.vline),
    vline_ls: ls.vline || DEFAULT_CUSTOM_THEME.vline_ls,
    vline_lw: lw.vline ?? DEFAULT_CUSTOM_THEME.vline_lw,
    dp: _modNormHex(preset.dp, DEFAULT_CUSTOM_THEME.dp),
    dp_ls: ls.dp || DEFAULT_CUSTOM_THEME.dp_ls,
    dp_lw: lw.dp ?? DEFAULT_CUSTOM_THEME.dp_lw,
    grid2: _modBlendHex(preset.grid2, plotBg, DEFAULT_CUSTOM_THEME.grid2),
    grid2_ls: ls.grid2 || DEFAULT_CUSTOM_THEME.grid2_ls,
    grid2_lw: preset.grid2_lw ?? DEFAULT_CUSTOM_THEME.grid2_lw,
    grid: _modBlendHex(preset.grid, plotBg, DEFAULT_CUSTOM_THEME.grid),
    grid_ls: ls.grid || DEFAULT_CUSTOM_THEME.grid_ls,
    grid_lw: preset.grid_lw ?? DEFAULT_CUSTOM_THEME.grid_lw,
    border: _modNormHex(preset.border, DEFAULT_CUSTOM_THEME.border),
    border_lw: preset.border_lw ?? DEFAULT_CUSTOM_THEME.border_lw,
    pt: _modNormHex(preset.pt, DEFAULT_CUSTOM_THEME.pt),
    ptSize: preset.ptSize ?? DEFAULT_CUSTOM_THEME.ptSize,
    arrowW,
    axisText: _modNormHex(preset.fg, DEFAULT_CUSTOM_THEME.axisText),
    axisPx: preset.axisPx ?? DEFAULT_CUSTOM_THEME.axisPx,
    lblText: _modNormHex(preset.muted, DEFAULT_CUSTOM_THEME.lblText),
    lblPx: preset.lblPx ?? DEFAULT_CUSTOM_THEME.lblPx,
    halo: _modBlendHex(preset.halo, plotBg, plotBg),
    haloW: preset.haloW ?? DEFAULT_CUSTOM_THEME.haloW
  };
}

function _modReadBool(id, fallback = true) {
  const el = CoreDOM.byId(id);
  if (!el) return fallback;
  if (el.type === 'checkbox') return Boolean(el.checked);
  const v = String(el.value || '').toLowerCase();
  return v === 'yes' || v === 'true' || v === '1' || v === 'on';
}

function _modCalcActivePMV(T, w, pPa, st) {
  const rhPct = Psy.RH_from_Tw(T, w, pPa) * 100;
  const cmf = st?.comfort || {};
  const clo = cmf.mode === 'winter' ? (cmf.cloWinter ?? 1.0) : (cmf.cloSummer ?? 0.5);
  return Comfort.calcPMV(T, rhPct, {
    pPa,
    clo,
    met: cmf.met ?? 1.1,
    vAir: cmf.vAir ?? 0.1,
    mrtOffset: cmf.mrtOffset ?? 0,
    pmvLimit: cmf.pmvLimit ?? 0.5
  });
}

function _modDispPropToSI(prop, rawVal, units, wHint = 0) {
  const isIP = units === 'IP';
  const key = String(prop || '').trim().toLowerCase();
  if (!Number.isFinite(rawVal)) return { key: null, val: NaN };

  switch (key) {
    case 'tdb':
    case 't':
      return { key: 'Tdb', val: isIP ? CoreDOM.fToC(rawVal) : rawVal };
    case 'twb':
      return { key: 'Twb', val: isIP ? CoreDOM.fToC(rawVal) : rawVal };
    case 'tdp':
      return { key: 'Tdp', val: isIP ? CoreDOM.fToC(rawVal) : rawVal };
    case 'rh':
      return { key: 'RH', val: rawVal };
    case 'w':
      return { key: 'W', val: CoreDOM.dispToW(rawVal, units) };
    case 'h':
      return { key: 'h', val: isIP ? Psy.h_kJkg_from_Btulb(rawVal, wHint) : rawVal };
    case 'v':
      return { key: 'v', val: isIP ? rawVal / _MOD_V_IP_PER_SI : rawVal };
    case 'pv':
    case 'p_v':
      // UI enters vapor pressure in kPa (SI) or psia (IP); Psy.solveState expects Pa
      return { key: 'Pv', val: isIP ? rawVal * Psy.KPA_PER_PSI * 1000 : rawVal * 1000 };
    default:
      return { key: null, val: NaN };
  }
}

function _modPropShortUnitText(prop, units) {
  const isIP = units === 'IP';
  switch (String(prop || '').trim().toLowerCase()) {
    case 'tdb':
    case 't':
      return isIP ? 'Tdb (°F)' : 'Tdb (°C)';
    case 'twb':
      return isIP ? 'Twb (°F)' : 'Twb (°C)';
    case 'tdp':
      return isIP ? 'Tdp (°F)' : 'Tdp (°C)';
    case 'rh':
      return 'RH (%)';
    case 'w':
      return isIP ? 'W (gr/lb)' : 'W (g/kg)';
    case 'h':
      return isIP ? 'h (Btu/lb)' : 'h (kJ/kg)';
    case 'v':
      return isIP ? 'v (ft³/lb)' : 'v (m³/kg)';
    case 'pv':
    case 'p_v':
      return isIP ? 'Pv (psia)' : 'Pv (kPa)';
    default:
      return prop || 'Value';
  }
}

function _modPropUnitText(prop, units) {
  const isIP = units === 'IP';
  switch (String(prop || '').trim().toLowerCase()) {
    case 'tdb':
    case 't':
      return isIP ? 'Dry Bulb (°F)' : 'Dry Bulb (°C)';
    case 'twb':
      return isIP ? 'Wet Bulb (°F)' : 'Wet Bulb (°C)';
    case 'tdp':
      return isIP ? 'Dew Point (°F)' : 'Dew Point (°C)';
    case 'rh':
      return 'Relative Humidity (%)';
    case 'w':
      return isIP ? 'Humidity Ratio (gr/lb)' : 'Humidity Ratio (g/kg)';
    case 'h':
      return isIP ? 'Enthalpy (Btu/lb)' : 'Enthalpy (kJ/kg)';
    case 'v':
      return isIP ? 'Specific Volume (ft³/lb)' : 'Specific Volume (m³/kg)';
    case 'pv':
    case 'p_v':
      return isIP ? 'Vapor Pressure (psia)' : 'Vapor Pressure (kPa)';
    default:
      return prop || 'Value';
  }
}

function _modDefaultValForProp(prop, refState, units) {
  const isIP = units === 'IP';
  const st = refState || Psy.stateFromTw(24, Psy.w_from_TRH(24, 0.5, 101325), 101325);
  switch (String(prop || '').trim().toLowerCase()) {
    case 'tdb':
    case 't':
      return CoreDOM.tToDisp(st.T, units).toFixed(2);
    case 'twb':
      return CoreDOM.tToDisp(st.Twb, units).toFixed(2);
    case 'tdp':
      return CoreDOM.tToDisp(st.Tdp, units).toFixed(2);
    case 'rh':
      return st.rh.toFixed(1);
    case 'w':
      return CoreDOM.wToDisp(st.w, units).toFixed(isIP ? 1 : 2);
    case 'h':
      return (isIP ? st.hIP : st.h).toFixed(2);
    case 'v':
      return (isIP ? st.vIP : st.v).toFixed(isIP ? 3 : 4);
    case 'pv':
    case 'p_v':
      return (isIP ? st.pv / (Psy.KPA_PER_PSI * 1000) : st.pv / 1000).toFixed(isIP ? 4 : 3);
    default:
      return '';
  }
}

function _modSyncLayerDom(store) {
  const layers = _modState(store).layers || {};
  const chkDC = CoreDOM.byId('chkDataCenter');
  if (chkDC && chkDC.type === 'checkbox') chkDC.checked = Boolean(layers.datacenter);
  const chkGiv = CoreDOM.byId('chkGivoni');
  if (chkGiv && chkGiv.type === 'checkbox') chkGiv.checked = Boolean(layers.givoni);
  const chkAnim = CoreDOM.byId('chkFlowAnim');
  if (chkAnim && chkAnim.type === 'checkbox') chkAnim.checked = Boolean(layers.flowAnim);
  const chkShr = CoreDOM.byId('shrShow');
  if (chkShr) {
    const shrOn = Boolean(_modState(store).shr?.show);
    if (chkShr.type === 'checkbox') chkShr.checked = shrOn;
    else chkShr.value = shrOn ? 'on' : 'off';
  }
}

function _modSyncViewDom(store) {
  const st = _modState(store);
  const u = _modUnits(store);
  const tMinEl = CoreDOM.byId('tMin');
  const tMaxEl = CoreDOM.byId('tMax');
  const wMaxEl = CoreDOM.byId('wMax');
  if (tMinEl && st.view) tMinEl.value = CoreDOM.tToDisp(st.view.tMin, u).toFixed(1);
  if (tMaxEl && st.view) tMaxEl.value = CoreDOM.tToDisp(st.view.tMax, u).toFixed(1);
  if (wMaxEl && st.view) wMaxEl.value = CoreDOM.wToDisp(st.view.wMax, u).toFixed(u === 'SI' ? 1 : 0);
}

function _modApplyPresetCycle(store, config) {
  const { name, points, processes, layers, view, historyLabel } = config;
  const st = _modState(store);

  if (typeof store?.loadCycle === 'function') {
    store.loadCycle(points, processes, { name, clearAnnotations: true }, historyLabel || `Load Preset: ${name}`);
  } else if (st) {
    store?.pushHistory?.(historyLabel || `Load Preset: ${name}`);
    st.points = points.map((p, idx) => ({
      id: idx + 1,
      T: p.T,
      w: p.w,
      label: p.label,
      color: p.color || POINT_PALETTE[idx % POINT_PALETTE.length],
      locked: Boolean(p.locked),
      lx: p.lx ?? 10,
      ly: p.ly ?? -8,
      note: p.note || '',
      derived: p.derived || null
    }));
    st.processes = processes;
    store?.recomputeDerived?.();
  }

  if (layers && typeof store?.setLayer === 'function') {
    for (const [k, v] of Object.entries(layers)) {
      store.setLayer(k, Boolean(v));
    }
  } else if (layers && st.layers) {
    Object.assign(st.layers, layers);
  }

  if (view && typeof store?.setView === 'function') {
    store.setView(view, false);
  } else if (typeof store?.fitPoints === 'function') {
    store.fitPoints(false);
  }

  _modSyncLayerDom(store);
  _modSyncViewDom(store);
  const projName = CoreDOM.byId('projName');
  if (projName && name) projName.value = name;
}

function _modFuzzyScore(query, title, subtitle = '', keywords = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 1;

  const tLow = String(title || '').toLowerCase();
  const sLow = String(subtitle || '').toLowerCase();
  const kLow = String(keywords || '').toLowerCase();
  const haystack = `${tLow} ${sLow} ${kLow}`;
  const tokens = q.split(/\s+/).filter(Boolean);

  let totalScore = 0;

  for (const tok of tokens) {
    let tokScore = 0;

    const idxTitle = tLow.indexOf(tok);
    if (idxTitle === 0) {
      tokScore = 140;
    } else if (idxTitle > 0) {
      const prev = tLow[idxTitle - 1];
      const wordBoundary = prev === ' ' || prev === ':' || prev === '-' || prev === '/' || prev === '(';
      tokScore = wordBoundary ? 115 : 85;
    } else {
      const idxHay = haystack.indexOf(tok);
      if (idxHay >= 0) {
        const prev = idxHay > 0 ? haystack[idxHay - 1] : ' ';
        const wordBoundary = prev === ' ' || prev === ':' || prev === '-' || prev === '/' || prev === ',';
        tokScore = wordBoundary ? 70 : 50;
      } else {
        // Word-initials acronym match only (e.g., "ahu", "erv", "svg", "tdp") to avoid noisy scattered hits
        const words = haystack.split(/[\s:,\-\/()]+/).filter(Boolean);
        const initials = words.map(w => w[0]).join('');
        if (tok.length >= 2 && tok.length <= 5 && initials.includes(tok)) {
          tokScore = 45;
        } else {
          return 0;
        }
      }
    }

    totalScore += tokScore;
  }

  return totalScore;
}

/* ============================================================================
   1. Engineering HVAC Cycle Presets Library (6 ASHRAE-Accurate SI Cycles)
   ============================================================================ */

export const PRESETS = [
  {
    id: 'summer-ahu',
    shortName: 'Summer AHU',
    name: 'Summer AHU Cooling & Dehumidification (OA Mixing + Reheat)',
    category: 'Commercial HVAC',
    description: 'Outdoor 35°C/55% RH + Room 24°C/50% RH (25% OA exact lever mix) → Curved ADP Cooling Coil (12.5°C/94% RH) → Fan/Reheat Supply (15.5°C) → Room Load.',
    apply(store) {
      const pPa = _modPressure(store);
      const oa = { T: 35.0, w: Psy.w_from_TRH(35.0, 0.55, pPa) };
      const ra = { T: 24.0, w: Psy.w_from_TRH(24.0, 0.50, pPa) };
      const mOA = 1.2; // 25% OA mass flow (kg/s)
      const mRA = 3.6; // 75% RA mass flow (kg/s)
      const mix = HVAC.calcMixing([
        { T: oa.T, w: oa.w, flowVal: mOA, flowUnit: 'kgps' },
        { T: ra.T, w: ra.w, flowVal: mRA, flowUnit: 'kgps' }
      ], pPa);
      const cc = { T: 12.5, w: Psy.w_from_TRH(12.5, 0.94, pPa) };
      const sa = { T: 15.5, w: cc.w };
      const adp = HVAC.calcADP(mix, cc, pPa);

      _modApplyPresetCycle(store, {
        name: 'Summer AHU Cooling & Dehum',
        historyLabel: 'Load Preset: Summer AHU Cooling & Dehumidification',
        points: [
          {
            key: 'oa', T: oa.T, w: oa.w, label: 'OA', color: '#f43f5e',
            lx: 10, ly: -10, note: 'Outdoor Design Air: 35.0°C, 55% RH'
          },
          {
            key: 'ra', T: ra.T, w: ra.w, label: 'RA', color: '#10b981',
            lx: 12, ly: 8, note: 'Room / Return Air: 24.0°C, 50% RH'
          },
          {
            key: 'ma', T: mix.T, w: mix.w, label: 'MA (25% OA)', color: '#facc15',
            locked: true, lx: 12, ly: -14,
            note: 'Mixed Air: exact 25% OA / 75% RA mass-weighted adiabatic lever mix',
            derived: { type: 'mix', aId: 'oa', bId: 'ra', mA: mOA, mB: mRA }
          },
          {
            key: 'cc', T: cc.T, w: cc.w, label: 'CC Out', color: '#38bdf8',
            lx: -58, ly: -18, note: 'Cooling Coil Leaving: 12.5°C, 94% RH (curved ADP path)'
          },
          {
            key: 'sa', T: sa.T, w: sa.w, label: 'SA', color: '#fb923c',
            lx: 10, ly: 18, note: 'Supply Air after Fan Heat & Trim Reheat: 15.5°C (constant W)'
          }
        ],
        processes: [
          { aId: 'oa', bId: 'ma', flowVal: 1000, flowUnit: 'Lps', role: 'mix', label: 'OA Intake (25%)' },
          { aId: 'ra', bId: 'ma', flowVal: 3000, flowUnit: 'Lps', role: 'mix', label: 'RA Mixing (75%)' },
          {
            aId: 'ma', bId: 'cc', flowVal: 4000, flowUnit: 'Lps', showCurve: true, role: 'coil',
            adpT: adp.valid ? adp.T_adp : null,
            adpW: adp.valid ? adp.w_adp : null,
            label: 'Cooling & Dehum Coil'
          },
          { aId: 'cc', bId: 'sa', flowVal: 4000, flowUnit: 'Lps', role: 'coil', label: 'Fan Heat & Reheat' },
          { aId: 'sa', bId: 'ra', flowVal: 4000, flowUnit: 'Lps', role: 'room', label: 'Room Sensible + Latent' }
        ],
        layers: { comfort: true, datacenter: false },
        view: { tMin: 4, tMax: 44, wMax: 0.026 }
      });
    }
  },

  {
    id: 'doas-erv',
    shortName: 'DOAS + ERV',
    name: 'DOAS + Enthalpy Recovery Wheel (Hot & Humid)',
    category: 'Dedicated Outdoor Air',
    description: '100% Outdoor Air (36°C/65% RH) → ERV Out (72% sens / 65% lat) → Deep Cooling/Dehum Coil (11.5°C/95% RH) → Supply (15°C) → Space (24°C/50% RH) → ERV Exhaust.',
    apply(store) {
      const pPa = _modPressure(store);
      const oa = { T: 36.0, w: Psy.w_from_TRH(36.0, 0.65, pPa) };
      const ra = { T: 24.0, w: Psy.w_from_TRH(24.0, 0.50, pPa) };
      const erv = HVAC.calcERV(oa, ra, pPa, {
        sensEff: 0.72,
        latEff: 0.65,
        flowOA: 2.2,
        flowRA: 2.2,
        flowUnit: 'kgps'
      });
      const cc = { T: 11.5, w: Psy.w_from_TRH(11.5, 0.95, pPa) };
      const sa = { T: 15.0, w: cc.w };
      const adp = HVAC.calcADP(erv.supplyOut, cc, pPa);

      _modApplyPresetCycle(store, {
        name: 'DOAS + Enthalpy Recovery Wheel',
        historyLabel: 'Load Preset: DOAS + Enthalpy Recovery Wheel',
        points: [
          {
            key: 'oa', T: oa.T, w: oa.w, label: 'OA', color: '#f43f5e',
            lx: 10, ly: -10, note: 'Hot & Humid Outdoor Air: 36.0°C, 65% RH'
          },
          {
            key: 'erv', T: erv.supplyOut.T, w: erv.supplyOut.w, label: 'ERV Out', color: '#14b8a6',
            lx: 12, ly: -14, note: 'ERV Pre-Conditioned OA (72% sensible / 65% latent recovery)'
          },
          {
            key: 'cc', T: cc.T, w: cc.w, label: 'CC Out', color: '#38bdf8',
            lx: -58, ly: -18, note: 'DOAS Deep Dehumidification Coil: 11.5°C, 95% RH'
          },
          {
            key: 'sa', T: sa.T, w: sa.w, label: 'SA', color: '#fb923c',
            lx: 10, ly: 18, note: 'Neutralized DOAS Supply Air: 15.0°C (constant W)'
          },
          {
            key: 'ra', T: ra.T, w: ra.w, label: 'Space (RA)', color: '#10b981',
            lx: 12, ly: 14, note: 'Conditioned Space / Exhaust Entering ERV: 24.0°C, 50% RH'
          },
          {
            key: 'ea', T: erv.exhaustOut.T, w: erv.exhaustOut.w, label: 'ERV Exhaust', color: '#f59e0b',
            lx: 12, ly: -10, note: 'Exhaust Leaving ERV after absorbing recovered heat & moisture'
          }
        ],
        processes: [
          { aId: 'oa', bId: 'erv', flowVal: 2000, flowUnit: 'Lps', role: 'erv', label: 'ERV Supply Recovery' },
          {
            aId: 'erv', bId: 'cc', flowVal: 2000, flowUnit: 'Lps', showCurve: true, role: 'coil',
            adpT: adp.valid ? adp.T_adp : null,
            adpW: adp.valid ? adp.w_adp : null,
            label: 'DOAS Dehum Coil'
          },
          { aId: 'cc', bId: 'sa', flowVal: 2000, flowUnit: 'Lps', role: 'coil', label: 'Reheat / Fan Gain' },
          { aId: 'sa', bId: 'ra', flowVal: 2000, flowUnit: 'Lps', role: 'room', label: 'Space Load' },
          { aId: 'ra', bId: 'ea', flowVal: 2000, flowUnit: 'Lps', role: 'erv_exhaust', label: 'ERV Exhaust Rejection' }
        ],
        layers: { comfort: true, datacenter: false },
        view: { tMin: 4, tMax: 44, wMax: 0.030 }
      });
    }
  },

  {
    id: 'winter-humid',
    shortName: 'Winter Humid.',
    name: 'Winter Heating & Steam Humidification',
    category: 'Winter Conditioning',
    description: 'Cold Outdoor (-5°C/70% RH) + Room (21.5°C/40% RH) at 30% OA Mix → Heating Coil (32°C constant W) → Steam Humidifier (32.4°C to target W) → Supply to Room.',
    apply(store) {
      const pPa = _modPressure(store);
      const oa = { T: -5.0, w: Psy.w_from_TRH(-5.0, 0.70, pPa) };
      const ra = { T: 21.5, w: Psy.w_from_TRH(21.5, 0.40, pPa) };
      const mOA = 1.2; // 30% OA mass flow (kg/s)
      const mRA = 2.8; // 70% RA mass flow (kg/s)
      const mix = HVAC.calcMixing([
        { T: oa.T, w: oa.w, flowVal: mOA, flowUnit: 'kgps' },
        { T: ra.T, w: ra.w, flowVal: mRA, flowUnit: 'kgps' }
      ], pPa);
      const hc = { T: 32.0, w: mix.w };
      // Target W slightly above RA to offset dry winter infiltration, using pressurized steam (~150°C) -> ~32.4°C
      const targetW = ra.w + 0.00045;
      const hum = HVAC.calcHumidifier(hc, targetW, pPa, {
        mode: 'steam',
        steamTempC: 150,
        flowVal: 3500,
        flowUnit: 'Lps'
      });

      _modApplyPresetCycle(store, {
        name: 'Winter Heating & Steam Humidification',
        historyLabel: 'Load Preset: Winter Heating & Steam Humidification',
        points: [
          {
            key: 'oa', T: oa.T, w: oa.w, label: 'OA', color: '#38bdf8',
            lx: 10, ly: -12, note: 'Winter Outdoor Design Air: -5.0°C, 70% RH'
          },
          {
            key: 'ra', T: ra.T, w: ra.w, label: 'Room (RA)', color: '#10b981',
            lx: -32, ly: -16, note: 'Winter Room Target: 21.5°C, 40% RH'
          },
          {
            key: 'ma', T: mix.T, w: mix.w, label: 'MA (30% OA)', color: '#facc15',
            locked: true, lx: -46, ly: -16,
            note: 'Mixed Air: exact 30% OA / 70% RA mass-weighted adiabatic mix',
            derived: { type: 'mix', aId: 'oa', bId: 'ra', mA: mOA, mB: mRA }
          },
          {
            key: 'hc', T: hc.T, w: hc.w, label: 'HC Out', color: '#f43f5e',
            lx: 12, ly: 12, note: 'Heating Coil Leaving: 32.0°C (constant humidity ratio)'
          },
          {
            key: 'sa', T: hum.outlet.T, w: hum.outlet.w, label: 'Steam SA', color: '#14b8a6',
            lx: 12, ly: -12, note: `Steam Humidifier Supply: ${hum.outlet.T.toFixed(1)}°C, ${(hum.outlet.w * 1000).toFixed(2)} g/kg`
          }
        ],
        processes: [
          { aId: 'oa', bId: 'ma', flowVal: 1050, flowUnit: 'Lps', role: 'mix', label: 'OA Intake (30%)' },
          { aId: 'ra', bId: 'ma', flowVal: 2450, flowUnit: 'Lps', role: 'mix', label: 'RA Mixing (70%)' },
          { aId: 'ma', bId: 'hc', flowVal: 3500, flowUnit: 'Lps', role: 'coil', label: 'Heating Coil' },
          { aId: 'hc', bId: 'sa', flowVal: 3500, flowUnit: 'Lps', role: 'humid', label: 'Steam Humidifier' },
          { aId: 'sa', bId: 'ra', flowVal: 3500, flowUnit: 'Lps', role: 'room', label: 'Room Heating Supply' }
        ],
        layers: { comfort: true, datacenter: false },
        view: { tMin: -10, tMax: 42, wMax: 0.016 }
      });
    }
  },

  {
    id: 'evap-2stage',
    shortName: '2-Stage Evap',
    name: 'Two-Stage Indirect/Direct Evaporative Cooling (Arid)',
    category: 'Evaporative Cooling',
    description: 'Phoenix-style Arid Outdoor (41°C/15% RH) → Stage 1 Indirect Evap (75% eff, constant W) → Stage 2 Direct Evap (85% eff along lower Twb) → Space (25.5°C).',
    apply(store) {
      const pPa = _modPressure(store);
      const oa = { T: 41.0, w: Psy.w_from_TRH(41.0, 0.15, pPa) };
      const evap = HVAC.calcEvapCooler(oa, pPa, {
        mode: 'twostage',
        effIndirect: 0.75,
        effDirect: 0.85,
        flowVal: 2500,
        flowUnit: 'Lps'
      });
      const stg1 = evap.stages[0].to;
      const stg2 = evap.stages[1].to;
      const space = {
        T: 25.5,
        w: Math.min(stg2.w + 0.0005, Psy.wsat_at(25.5, pPa) * 0.95)
      };

      _modApplyPresetCycle(store, {
        name: 'Two-Stage Indirect/Direct Evap',
        historyLabel: 'Load Preset: Two-Stage Indirect/Direct Evaporative Cooling',
        points: [
          {
            key: 'oa', T: oa.T, w: oa.w, label: 'OA (Arid)', color: '#f43f5e',
            lx: -14, ly: -16, note: 'Hot-Arid Phoenix Design Air: 41.0°C, 15% RH'
          },
          {
            key: 'iec', T: stg1.T, w: stg1.w, label: 'Stage 1 (IEC)', color: '#f59e0b',
            lx: 10, ly: 16, note: 'Indirect Evaporative Heat Exchanger (75% eff, constant W)'
          },
          {
            key: 'dec', T: stg2.T, w: stg2.w, label: 'Stage 2 (DEC/SA)', color: '#38bdf8',
            lx: -32, ly: 20, note: 'Direct Evaporative Media (85% eff, adiabatic along lower Twb)'
          },
          {
            key: 'sp', T: space.T, w: space.w, label: 'Space', color: '#10b981',
            lx: 12, ly: -12, note: 'Conditioned Space: 25.5°C (within ASHRAE 55 summer comfort)'
          }
        ],
        processes: [
          { aId: 'oa', bId: 'iec', flowVal: 2500, flowUnit: 'Lps', role: 'coil', label: 'Stage 1 Indirect Evap' },
          { aId: 'iec', bId: 'dec', flowVal: 2500, flowUnit: 'Lps', role: 'coil', label: 'Stage 2 Direct Evap' },
          { aId: 'dec', bId: 'sp', flowVal: 2500, flowUnit: 'Lps', role: 'room', label: 'Space Sensible + Latent' }
        ],
        layers: { comfort: true, datacenter: false },
        view: { tMin: 8, tMax: 48, wMax: 0.020 }
      });
    }
  },

  {
    id: 'desiccant-cleanroom',
    shortName: 'Desiccant',
    name: 'Desiccant Wheel + Post-Cooling (Low Dew-Point)',
    category: 'Industrial / Cleanroom',
    description: 'Process Air (28°C/60% RH) → Active Desiccant Wheel Out (hot & ultra-dry ~4.5 g/kg) → Sensible Post-Cooling Coil (18°C) → Cleanroom Space (22°C/30% RH).',
    apply(store) {
      const pPa = _modPressure(store);
      const pa = { T: 28.0, w: Psy.w_from_TRH(28.0, 0.60, pPa) };
      // Target ~4.5 g/kg leaving wheel using exact desiccant enthalpy carryover model
      const targetEff = CoreDOM.clamp(1 - 0.0045 / Math.max(pa.w, 0.005), 0.1, 0.92);
      const des = HVAC.calcDesiccant(pa, pPa, {
        moistureRemovalEff: targetEff,
        thermalCarryover: 0.10,
        regenTempC: 110,
        flowVal: 1800,
        flowUnit: 'Lps'
      });
      const pc = { T: 18.0, w: des.outlet.w };
      const sp = { T: 22.0, w: Psy.w_from_TRH(22.0, 0.30, pPa) };

      _modApplyPresetCycle(store, {
        name: 'Desiccant Wheel + Cleanroom',
        historyLabel: 'Load Preset: Desiccant Wheel + Post-Cooling',
        points: [
          {
            key: 'pa', T: pa.T, w: pa.w, label: 'Process Air', color: '#f43f5e',
            lx: 10, ly: -12, note: 'Entering Process Air: 28.0°C, 60% RH'
          },
          {
            key: 'dw', T: des.outlet.T, w: des.outlet.w, label: 'Desiccant Out', color: '#fb923c',
            lx: 12, ly: -14,
            note: `Active Desiccant Wheel Out: ${des.outlet.T.toFixed(1)}°C, ${(des.outlet.w * 1000).toFixed(2)} g/kg (adsorption heat + carryover)`
          },
          {
            key: 'pc', T: pc.T, w: pc.w, label: 'Post-Cool SA', color: '#38bdf8',
            lx: -72, ly: -14, note: 'Sensible Post-Cooling Coil Leaving: 18.0°C (constant low dew-point W)'
          },
          {
            key: 'sp', T: sp.T, w: sp.w, label: 'Cleanroom', color: '#10b981',
            lx: 12, ly: -12, note: 'Low-Humidity Cleanroom Space: 22.0°C, 30% RH'
          }
        ],
        processes: [
          { aId: 'pa', bId: 'dw', flowVal: 1800, flowUnit: 'Lps', role: 'coil', label: 'Desiccant Dehumidification' },
          { aId: 'dw', bId: 'pc', flowVal: 1800, flowUnit: 'Lps', role: 'coil', label: 'Sensible Post-Cooling' },
          { aId: 'pc', bId: 'sp', flowVal: 1800, flowUnit: 'Lps', role: 'room', label: 'Cleanroom Space Load' }
        ],
        layers: { comfort: true, datacenter: false },
        view: { tMin: 8, tMax: 60, wMax: 0.020 }
      });
    }
  },

  {
    id: 'datacenter-econ',
    shortName: 'Data Center TC 9.9',
    name: 'Data Center Airside Economizer (ASHRAE TC 9.9)',
    category: 'Mission Critical',
    description: 'Enables ASHRAE TC 9.9 envelopes! Mild Outdoor (18°C/50% RH) + Hot Aisle Return (34°C) → Economizer Mix / Cold Aisle Supply (23°C/42% RH) → IT Server Rack Sensible Rise (23°C → 34°C).',
    apply(store) {
      const pPa = _modPressure(store);
      const oa = { T: 18.0, w: Psy.w_from_TRH(18.0, 0.50, pPa) };
      const ca = { T: 23.0, w: Psy.w_from_TRH(23.0, 0.42, pPa) };
      // IT server rack rise is strictly sensible (SHR = 1.000, constant humidity ratio) from 23°C -> 34°C
      const ha = { T: 34.0, w: ca.w };
      // Economizer blend of OA (68.75%) + Hot Aisle Return (31.25%) to reach 23.0°C
      const mOA = 5.5;
      const mHA = 2.5;
      const mix = HVAC.calcMixing([
        { T: oa.T, w: oa.w, flowVal: mOA, flowUnit: 'kgps' },
        { T: ha.T, w: ha.w, flowVal: mHA, flowUnit: 'kgps' }
      ], pPa);

      _modApplyPresetCycle(store, {
        name: 'Data Center Airside Economizer',
        historyLabel: 'Load Preset: Data Center Airside Economizer (ASHRAE TC 9.9)',
        points: [
          {
            key: 'oa', T: oa.T, w: oa.w, label: 'OA (Mild)', color: '#38bdf8',
            lx: -58, ly: 16, note: 'Mild Outdoor Economizer Intake: 18.0°C, 50% RH'
          },
          {
            key: 'em', T: mix.T, w: mix.w, label: 'Econ Mix', color: '#facc15',
            locked: true, lx: 10, ly: 18,
            note: 'Airside Economizer Mix: 68.8% OA + 31.2% Hot Aisle recirculation',
            derived: { type: 'mix', aId: 'oa', bId: 'ha', mA: mOA, mB: mHA }
          },
          {
            key: 'ca', T: ca.T, w: ca.w, label: 'Cold Aisle', color: '#10b981',
            lx: -26, ly: -18, note: 'Cold Aisle Supply: 23.0°C, 42% RH (ASHRAE TC 9.9 Recommended)'
          },
          {
            key: 'ha', T: ha.T, w: ha.w, label: 'Hot Aisle', color: '#f43f5e',
            lx: 10, ly: -12, note: `Hot Aisle Return: 34.0°C, ${(Psy.RH_from_Tw(ha.T, ha.w, pPa) * 100).toFixed(1)}% RH (ΔT = +11°C pure sensible IT rack rise)`
          }
        ],
        processes: [
          { aId: 'oa', bId: 'em', flowVal: 4600, flowUnit: 'Lps', role: 'mix', label: 'Economizer OA Intake' },
          { aId: 'ha', bId: 'em', flowVal: 2200, flowUnit: 'Lps', role: 'mix', label: 'Hot Aisle Recirculation' },
          { aId: 'em', bId: 'ca', flowVal: 6800, flowUnit: 'Lps', role: 'humid', label: 'Trim Humidification' },
          { aId: 'ca', bId: 'ha', flowVal: 6800, flowUnit: 'Lps', role: 'room', label: 'Server Rack Sensible Rise' }
        ],
        layers: { datacenter: true, comfort: false },
        view: { tMin: 10, tMax: 39, wMax: 0.016 }
      });
    }
  }
];

/* ============================================================================
   2. Master Modals & Command Palette Controller
   ============================================================================ */

export function initModals(store, exporter, baseRenderer, overlayRenderer, toast) {
  const { byId, on, esc } = CoreDOM;
  const notifyToast = typeof toast === 'function'
    ? toast
    : (msg, type = 'info') => store?.toast?.(msg, type);

  /* ---- Centralized Focus Management, Focus Trap & Open/Close Helpers ---- */
  const READONLY_MODALS = new Set(['glossaryOverlay', 'shortcutsOverlay', 'aboutOverlay']);
  const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let prevFocusEl = null;
  let activeModalId = null;
  let themeSnapshot = null;

  function getModalFocusables(overlayEl) {
    if (!overlayEl) return [];
    return Array.from(overlayEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => {
      if (el.disabled || el.hidden) return false;
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      return el.offsetParent !== null || el.getClientRects().length > 0;
    });
  }

  function showOverlay(id, preferredFocus = null) {
    const el = byId(id);
    if (!el) return null;
    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    el.classList.add('visible');
    activeModalId = id;

    requestAnimationFrame(() => {
      if (!el.classList.contains('visible')) return;
      if (READONLY_MODALS.has(id)) {
        const panel = el.querySelector('.modal-panel');
        if (panel) {
          if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
          panel.focus();
          return;
        }
      }
      if (preferredFocus && !preferredFocus.disabled && el.contains(preferredFocus)) {
        preferredFocus.focus();
        return;
      }
      const focusables = getModalFocusables(el);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        const panel = el.querySelector('.modal-panel');
        if (panel) {
          if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
          panel.focus();
        }
      }
    });
    return el;
  }

  function hideOverlay(id, restoreFocus = true) {
    const el = byId(id);
    if (el) el.classList.remove('visible');
    if (activeModalId === id) activeModalId = null;
    if (restoreFocus && !isAnyModalOpen() && prevFocusEl) {
      const target = prevFocusEl;
      prevFocusEl = null;
      try { target.focus?.(); } catch {}
    }
  }

  function revertThemeSnapshotIfOpen() {
    if (!themeSnapshot) return;
    const snap = themeSnapshot;
    themeSnapshot = null;
    store?.updateCustomTheme?.(snap.customTheme);
    store?.setTheme?.(snap.theme);
    if (snap.axisStyle) {
      if (typeof store?.setAxisStyle === 'function') {
        store.setAxisStyle(snap.axisStyle);
      } else if (store?.state) {
        store.state.axisStyle = { ...DEFAULT_AXIS_STYLE, ...snap.axisStyle };
      }
    }
    if (snap.trendStyle) {
      if (typeof store?.setTrendStyle === 'function') {
        store.setTrendStyle(snap.trendStyle);
      } else if (store?.state) {
        store.state.trendStyle = { ...DEFAULT_TREND_STYLE, ...snap.trendStyle };
      }
    }
    if (Number.isFinite(snap.labelPx)) {
      store?.setGrid?.({ labelPx: snap.labelPx });
    }
    const selT = byId('selTheme');
    if (selT) selT.value = snap.theme;
    _modRedraw(store, baseRenderer, overlayRenderer, true);
  }

  function closeAllModals(restoreFocus = true) {
    revertThemeSnapshotIfOpen();
    for (const id of _MOD_MODAL_IDS) {
      hideOverlay(id, false);
    }
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.modal-overlay.visible').forEach(el => {
        el.classList.remove('visible');
      });
    }
    activeModalId = null;
    epPtId = null;
    mixPtAId = null;
    mixPtBId = null;
    if (restoreFocus && prevFocusEl) {
      const target = prevFocusEl;
      prevFocusEl = null;
      try { target.focus?.(); } catch {}
    }
  }

  function isAnyModalOpen() {
    for (const id of _MOD_MODAL_IDS) {
      if (byId(id)?.classList.contains('visible')) return true;
    }
    return false;
  }

  /* ---- Preset Loader ---- */
  function loadPresetById(presetId) {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return false;
    preset.apply(store);
    const selPreset = byId('selPreset');
    if (selPreset && selPreset.value !== preset.id) {
      const hasOpt = Array.from(selPreset.options || []).some(o => o.value === preset.id);
      if (hasOpt) selPreset.value = preset.id;
    }
    _modRedraw(store, baseRenderer, overlayRenderer, true);
    notifyToast(`Loaded preset: ${preset.shortName || preset.name}`, 'success');
    return true;
  }

  /* ---- Populate Top-Bar Preset Selector (if empty/needs items) ---- */
  const selPresetInit = byId('selPreset');
  if (selPresetInit && selPresetInit.options.length <= 1) {
    for (const preset of PRESETS) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.shortName || preset.name;
      opt.title = preset.name;
      selPresetInit.appendChild(opt);
    }
  }

  /* ---- Exporter Dispatch Helpers ---- */
  function invokeExport(kind, opts = {}) {
    if (!exporter) {
      notifyToast('Exporter not available', 'error');
      return;
    }
    try {
      if (kind === 'png') {
        if (typeof exporter.exportPNG === 'function') exporter.exportPNG(store, baseRenderer, overlayRenderer, 2);
        else byId('btnExportPng')?.click();
      } else if (kind === 'svg') {
        if (typeof exporter.exportSVG === 'function') exporter.exportSVG(store, baseRenderer);
        else byId('btnExportSvg')?.click();
      } else if (kind === 'csv') {
        if (typeof exporter.exportCSV === 'function') exporter.exportCSV(store);
        else byId('btnExportCsv')?.click();
      } else if (kind === 'json') {
        if (typeof exporter.downloadJSON === 'function') exporter.downloadJSON(store);
        else if (typeof exporter.exportJSON === 'function') exporter.exportJSON(store);
        else byId('btnSave')?.click();
      } else if (kind === 'share') {
        if (typeof exporter.copyShareURL === 'function') {
          Promise.resolve(exporter.copyShareURL(store)).catch(err => {
            notifyToast(`Share URL failed: ${err?.message || err}`, 'error');
          });
        } else if (typeof store?.encodeShareURL === 'function' && typeof navigator !== 'undefined' && navigator.clipboard) {
          const url = store.encodeShareURL();
          navigator.clipboard.writeText(url);
          notifyToast('Shareable project URL copied', 'success');
        } else {
          byId('btnShareUrl')?.click();
        }
      } else if (kind === 'html') {
        if (typeof exporter.generateHTMLReport === 'function') {
          exporter.generateHTMLReport(store, baseRenderer, overlayRenderer, opts);
        } else if (typeof exporter.exportHTMLReport === 'function') {
          exporter.exportHTMLReport(store, baseRenderer, overlayRenderer, opts);
        } else {
          notifyToast('HTML report generator unavailable', 'error');
        }
      } else if (kind === 'docx') {
        if (typeof exporter.generateDOCXReport === 'function') {
          Promise.resolve(exporter.generateDOCXReport(store, baseRenderer, overlayRenderer, opts)).catch(err => {
            notifyToast(`Word (.docx) export failed: ${err?.message || err}`, 'error');
          });
        } else if (typeof exporter.exportDOCXReport === 'function') {
          Promise.resolve(exporter.exportDOCXReport(store, baseRenderer, overlayRenderer, opts)).catch(err => {
            notifyToast(`Word (.docx) export failed: ${err?.message || err}`, 'error');
          });
        } else {
          notifyToast('Word (.docx) report generator unavailable', 'error');
        }
      }
    } catch (err) {
      notifyToast(`Export failed: ${err?.message || err}`, 'error');
    }
  }

  /* ---- City Plot + 8,760-hr Synthetic TMY Loader (used by Command Palette) ---- */
  function plotCityAndLoadTMY(city) {
    if (!city) return;
    const elevM = Number.isFinite(city.elev_m) ? city.elev_m : 0;
    const pPa = Psy.baroPa(elevM);

    // Sync atmosphere to city elevation
    if (typeof store?.setAtmosphere === 'function') {
      store.setAtmosphere(pPa, elevM, null, true);
    }

    // Plot ASHRAE 0.4% Summer Cooling & 99.6% Winter Heating design points
    const designPts = typeof Weather?.getCityDesignPoints === 'function'
      ? Weather.getCityDesignPoints(city, pPa)
      : [];

    if (designPts.length > 0 && typeof store?.addPoint === 'function') {
      const toPlot = designPts.filter(p => p.kind === 'summer04' || p.kind === 'winter996');
      const list = toPlot.length ? toPlot : [designPts[0]];
      for (const dp of list) {
        store.addPoint({
          T: dp.T,
          w: dp.w,
          label: dp.label,
          color: dp.color,
          note: dp.note
        }, false);
      }
    }

    // Generate deterministic 8,760-hr TMY + 2D psychrometric heatmap bins
    if (typeof Weather?.generateSyntheticTMY === 'function') {
      const tmy = Weather.generateSyntheticTMY(city);
      const bins = typeof Weather?.computePsychroBins === 'function'
        ? Weather.computePsychroBins(tmy.records, tmy.pPa, _modState(store).comfort || {})
        : null;

      if (typeof store?.setWeather === 'function') {
        store.setWeather({
          cityId: tmy.cityId,
          sourceName: tmy.sourceName,
          records: tmy.records,
          bins,
          autoShow: true
        });
      }
    }

    // Sync left-panel city selector if present
    const citySel = byId('citySelect');
    if (citySel && city.id) {
      const hasOpt = Array.from(citySel.options || []).some(o => o.value === city.id);
      if (hasOpt) citySel.value = city.id;
    }

    if (typeof store?.fitPoints === 'function' && (_modState(store).points?.length || 0) > 0) {
      store.fitPoints(false);
    }
    _modSyncViewDom(store);
    _modRedraw(store, baseRenderer, overlayRenderer, true);
    const u = _modUnits(store);
    const elevTxt = u === 'IP'
      ? `${Math.round(elevM * 3.280839895).toLocaleString()} ft`
      : `${Math.round(elevM).toLocaleString()} m`;
    notifyToast(`Plotted ${city.name} design points + 8,760-hr TMY (${elevTxt})`, 'success');
  }

  /* ==========================================================================
     2A. COMMAND PALETTE (`#cmdPaletteOverlay`, `#cmdInput`, `#cmdList`)
     ========================================================================== */
  let cmdFiltered = [];
  let cmdActiveIdx = 0;

  function buildCommandCatalog() {
    const st = _modState(store);
    const units = _modUnits(store);
    const isIP = units === 'IP';
    const layers = st.layers || {};
    const items = [];

    // 1. All 6 Engineering HVAC Presets
    for (const preset of PRESETS) {
      items.push({
        id: `preset:${preset.id}`,
        group: 'Engineering Presets',
        icon: '⚡',
        title: `Load Preset: ${preset.name}`,
        desc: preset.category,
        key: 'Preset',
        keywords: `preset cycle hvac ${preset.id} ${preset.shortName || ''} ${preset.category} ${preset.description}`,
        run: () => loadPresetById(preset.id)
      });
    }

    // 2. Quick Actions
    const nextUnit = units === 'SI' ? 'IP' : 'SI';
    const quickActions = [
      {
        id: 'act:units',
        icon: '⇄',
        title: `Switch Units to ${nextUnit} (${nextUnit === 'SI' ? '°C, g/kg, kW' : '°F, gr/lb, BTU/h'})`,
        desc: `Current: ${units}`,
        key: 'U',
        keywords: 'si ip units metric imperial fahrenheit celsius grains btu tons switch toggle',
        run: () => {
          store?.setUnits?.(nextUnit);
          const selU = byId('selUnits');
          if (selU) selU.value = nextUnit;
          _modSyncViewDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(`Switched units to ${nextUnit}`, 'info');
        }
      },
      {
        id: 'act:undo',
        icon: '↶',
        title: `Undo${store?.getUndoLabel?.() ? `: ${store.getUndoLabel()}` : ''}`,
        desc: 'Revert last action',
        key: 'Ctrl+Z',
        keywords: 'undo history revert back',
        run: () => {
          const ok = store?.undo?.();
          _modSyncViewDom(store);
          _modSyncLayerDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(ok ? 'Undo' : 'Nothing to undo', ok ? 'info' : 'warn');
        }
      },
      {
        id: 'act:redo',
        icon: '↷',
        title: `Redo${store?.getRedoLabel?.() ? `: ${store.getRedoLabel()}` : ''}`,
        desc: 'Reapply undone action',
        key: 'Ctrl+Y',
        keywords: 'redo history forward',
        run: () => {
          const ok = store?.redo?.();
          _modSyncViewDom(store);
          _modSyncLayerDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(ok ? 'Redo' : 'Nothing to redo', ok ? 'info' : 'warn');
        }
      },
      {
        id: 'act:fit-points',
        icon: '⊡',
        title: 'Fit All Points',
        desc: 'Auto-zoom chart to active state points',
        key: 'F',
        keywords: 'fit all points zoom frame autoscale',
        run: () => {
          store?.fitPoints?.(true);
          _modSyncViewDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast('Fitted view to all points', 'info');
        }
      },
      {
        id: 'act:reset-range',
        icon: '↺',
        title: 'Reset Range',
        desc: 'Restore default temperature & humidity axis limits',
        key: 'R',
        keywords: 'reset zoom range default axes view',
        run: () => {
          store?.resetView?.(true);
          _modSyncViewDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast('View range reset', 'info');
        }
      },
      {
        id: 'act:add-pt-param',
        icon: '＋',
        title: 'Add Point via Any-2-of-8 Parameters',
        desc: 'Enter any two independent psychrometric properties',
        key: '',
        keywords: 'add point parameters create state tdb rh twb tdp enthalpy volume',
        run: () => openAddPointParam()
      },
      {
        id: 'act:toggle-weather',
        icon: '☁',
        title: `${layers.weather ? 'Hide' : 'Show'} Weather Heatmap Overlay`,
        desc: layers.weather ? 'Currently ON' : 'Currently OFF',
        key: 'W',
        keywords: 'toggle weather heatmap tmy epw climate overlay',
        run: () => {
          const onNow = store?.toggleLayer?.('weather');
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(`Weather heatmap ${onNow ? 'enabled' : 'hidden'}`, 'info');
        }
      },
      {
        id: 'act:toggle-givoni',
        icon: '🌿',
        title: `${layers.givoni ? 'Hide' : 'Show'} Givoni Bioclimatic Zones`,
        desc: layers.givoni ? 'Currently ON' : 'Currently OFF',
        key: 'Layer',
        keywords: 'toggle givoni passive bioclimatic zones solar ventilation thermal mass',
        run: () => {
          const onNow = store?.toggleLayer?.('givoni');
          _modSyncLayerDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(`Givoni bioclimatic zones ${onNow ? 'enabled' : 'hidden'}`, 'info');
        }
      },
      {
        id: 'act:toggle-dc',
        icon: '🖥',
        title: `${layers.datacenter ? 'Hide' : 'Show'} Data Center TC 9.9 Envelopes`,
        desc: layers.datacenter ? 'Currently ON' : 'Currently OFF',
        key: 'TC 9.9',
        keywords: 'toggle data center datacenter ashrae tc 9.9 recommended a1 a2 a3 server',
        run: () => {
          const onNow = store?.toggleLayer?.('datacenter');
          _modSyncLayerDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(`ASHRAE TC 9.9 Data Center envelopes ${onNow ? 'enabled' : 'hidden'}`, 'info');
        }
      },
      {
        id: 'act:toggle-comfort',
        icon: '☺',
        title: `${layers.comfort ? 'Hide' : 'Show'} ASHRAE 55 Thermal Comfort Zone`,
        desc: layers.comfort ? 'Currently ON' : 'Currently OFF',
        key: 'C',
        keywords: 'toggle comfort ashrae 55 pmv ppd summer winter zone',
        run: () => {
          const onNow = store?.toggleLayer?.('comfort');
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(`ASHRAE 55 comfort zone ${onNow ? 'enabled' : 'hidden'}`, 'info');
        }
      },
      {
        id: 'act:toggle-flow',
        icon: '➤',
        title: `${layers.flowAnim ? 'Stop' : 'Start'} Animated Process Flow`,
        desc: layers.flowAnim ? 'Currently ON' : 'Currently OFF',
        key: 'A',
        keywords: 'toggle flow animation particles arrows animated processes',
        run: () => {
          const onNow = store?.toggleLayer?.('flowAnim');
          _modSyncLayerDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, false);
          notifyToast(`Flow animation ${onNow ? 'enabled' : 'paused'}`, 'info');
        }
      },
      {
        id: 'act:toggle-shr',
        icon: '∠',
        title: `${st.shr?.show ? 'Hide' : 'Show'} SHR Protractor & Reference Line`,
        desc: `SHR = ${(st.shr?.value ?? 0.75).toFixed(2)}`,
        key: 'SHR',
        keywords: 'toggle shr sensible heat ratio protractor slope line',
        run: () => {
          const next = !Boolean(_modState(store).shr?.show);
          store?.setSHR?.({ show: next }, false);
          _modSyncLayerDom(store);
          _modRedraw(store, baseRenderer, overlayRenderer, false);
          notifyToast(`SHR protractor ${next ? 'enabled' : 'hidden'}`, 'info');
        }
      },
      {
        id: 'act:export-png',
        icon: '🖼',
        title: 'Export HiDPI PNG Chart',
        desc: 'Download publication-grade raster image',
        key: 'PNG',
        keywords: 'export png image screenshot download raster',
        run: () => invokeExport('png')
      },
      {
        id: 'act:export-svg',
        icon: '✦',
        title: 'Export Vector SVG Chart',
        desc: 'Scalable CAD/print vector graphic',
        key: 'SVG',
        keywords: 'export vector svg cad illustrator scalable',
        run: () => invokeExport('svg')
      },
      {
        id: 'act:export-csv',
        icon: '▦',
        title: 'Export Points & Processes CSV',
        desc: 'Spreadsheet-ready engineering data table',
        key: 'CSV',
        keywords: 'export csv excel table spreadsheet data',
        run: () => invokeExport('csv')
      },
      {
        id: 'act:report',
        icon: '📄',
        title: 'Generate Engineering Report (HTML / Word .docx)',
        desc: 'Open report export configuration modal',
        key: 'Report',
        keywords: 'generate report html word docx pdf print export',
        run: () => openReport()
      },
      {
        id: 'act:save-json',
        icon: '💾',
        title: 'Save Project JSON',
        desc: 'Download full project snapshot (.json)',
        key: 'Ctrl+S',
        keywords: 'save json project file export backup',
        run: () => invokeExport('json')
      },
      {
        id: 'act:load-json',
        icon: '📂',
        title: 'Load Project JSON',
        desc: 'Open PsychroChart v3.0 or v2.6.6 JSON file',
        key: 'Open',
        keywords: 'load open import json project file',
        run: () => {
          const inp = byId('fileLoad');
          if (inp) inp.click();
          else notifyToast('File input not available', 'error');
        }
      },
      {
        id: 'act:share-link',
        icon: '🔗',
        title: 'Copy Shareable URL Link',
        desc: 'Encode state points & processes into a URL hash',
        key: 'Share',
        keywords: 'copy share link url hash collaborate',
        run: () => invokeExport('share')
      },
      {
        id: 'act:toggle-dual-pv',
        icon: '📏',
        title: 'Toggle Secondary Pv Scale',
        desc: `${st.axisStyle?.showDualPvScale ? 'Hide' : 'Show'} secondary water vapor partial pressure (Pv) axis scale`,
        key: st.axisStyle?.showDualPvScale ? 'On' : 'Off',
        keywords: 'toggle secondary pv vapor pressure scale dual axis style ruler',
        run: () => {
          const next = !Boolean(_modState(store).axisStyle?.showDualPvScale);
          if (typeof store?.setAxisStyle === 'function') {
            store.setAxisStyle({ showDualPvScale: next });
          } else if (store?.state) {
            store.state.axisStyle = { ...DEFAULT_AXIS_STYLE, ...(store.state.axisStyle || {}), showDualPvScale: next };
            store.emit?.('base-dirty', { reason: 'axis-style' });
            store.emit?.('change', { reason: 'axis-style' });
          }
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(`Secondary Pv Scale: ${next ? 'On' : 'Off'}`, 'info');
        }
      },
      {
        id: 'act:toggle-decomp-legs',
        icon: '◿',
        title: 'Toggle Sensible/Latent ΔT/ΔW Legs',
        desc: `${st.trendStyle?.showDecompLegs ? 'Hide' : 'Show'} dashed ΔT (sensible) & ΔW (latent) process component legs`,
        key: st.trendStyle?.showDecompLegs ? 'On' : 'Off',
        keywords: 'toggle sensible latent delta dt dw decomposition legs triangle trend process vector',
        run: () => {
          const next = !Boolean(_modState(store).trendStyle?.showDecompLegs);
          if (typeof store?.setTrendStyle === 'function') {
            store.setTrendStyle({ showDecompLegs: next });
          } else if (store?.state) {
            store.state.trendStyle = { ...DEFAULT_TREND_STYLE, ...(store.state.trendStyle || {}), showDecompLegs: next };
            store.emit?.('overlay-dirty', { reason: 'trend-style' });
            store.emit?.('change', { reason: 'trend-style' });
          }
          _modRedraw(store, baseRenderer, overlayRenderer, false);
          notifyToast(`Sensible/Latent (ΔT/ΔW) Legs: ${next ? 'On' : 'Off'}`, 'info');
        }
      },
      {
        id: 'act:cycle-axis-frame',
        icon: '⊞',
        title: 'Cycle Axis Frame Style',
        desc: `Switch plot border between Full Box, ASHRAE Open & CAD Ticks (Current: ${st.axisStyle?.frame || 'full-box'})`,
        key: st.axisStyle?.frame === 'ashrae-open' ? 'ASHRAE' : (st.axisStyle?.frame === 'cad-ticks' ? 'CAD' : 'Box'),
        keywords: 'cycle axis frame border style full box ashrae open cad ticks',
        run: () => {
          const order = ['full-box', 'ashrae-open', 'cad-ticks'];
          const labels = { 'full-box': 'Full Box', 'ashrae-open': 'ASHRAE Open', 'cad-ticks': 'CAD Ticks' };
          const cur = _modState(store).axisStyle?.frame || 'full-box';
          const next = order[(order.indexOf(cur) + 1) % order.length];
          if (typeof store?.setAxisStyle === 'function') {
            store.setAxisStyle({ frame: next });
          } else if (store?.state) {
            store.state.axisStyle = { ...DEFAULT_AXIS_STYLE, ...(store.state.axisStyle || {}), frame: next };
            store.emit?.('base-dirty', { reason: 'axis-style' });
            store.emit?.('change', { reason: 'axis-style' });
          }
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(`Axis Frame: ${labels[next] || next}`, 'info');
        }
      },
      {
        id: 'act:theme-studio',
        icon: '🎨',
        title: 'Open Custom Theme Studio',
        desc: 'Customize curve colors, dash patterns, line weights, halos & labels',
        key: 'Theme',
        keywords: 'open theme studio custom colors editor palette style dashdot axis trend',
        run: () => openThemeEditor()
      },
      {
        id: 'act:glossary',
        icon: '📖',
        title: 'Open Psychrometric Glossary',
        desc: 'Definitions & equations for psychrometric properties',
        key: 'Docs',
        keywords: 'open glossary reference definitions terms help',
        run: () => openGlossary()
      },
      {
        id: 'act:shortcuts',
        icon: '⌨',
        title: 'Open Keyboard Shortcuts',
        desc: 'View all productivity keybindings',
        key: '?',
        keywords: 'keyboard shortcuts hotkeys keys help',
        run: () => openShortcuts()
      },
      {
        id: 'act:about',
        icon: 'ⓘ',
        title: `About PsychroChart Ultra ${APP_VERSION}`,
        desc: 'Version, ASHRAE 2021 physics & credits',
        key: 'Info',
        keywords: 'about version info ashrae credits',
        run: () => openAbout()
      }
    ];

    for (const act of quickActions) {
      items.push({ ...act, group: 'Quick Actions' });
    }

    // 3. All 9 Famous Chart Visualization Presets
    for (const th of _MOD_THEMES) {
      items.push({
        id: `theme:${th.id}`,
        group: 'Chart Presets & Themes',
        icon: th.icon,
        title: `Chart Preset: ${th.name}`,
        desc: st.theme === th.id ? `${th.desc} (Active)` : th.desc,
        key: st.theme === th.id ? 'Active' : 'Preset',
        keywords: `theme preset chart visual color style appearance ${th.id} ${th.name} ${th.desc} ${th.keywords || ''}`,
        run: () => {
          if (typeof store?.applyVisualPreset === 'function') {
            store.applyVisualPreset(th.id);
          } else {
            store?.setTheme?.(th.id);
          }
          const selT = byId('selTheme');
          if (selT) selT.value = th.id;
          _modRedraw(store, baseRenderer, overlayRenderer, true);
          notifyToast(`Chart Preset: ${th.name}`, 'info');
        }
      });
    }

    // 4. All 44+ Global Cities from Weather Database (formatted in active SI / IP units)
    const cities = Array.isArray(Weather?.CITIES) ? Weather.CITIES : [];
    const uT = isIP ? '°F' : '°C';
    for (const city of cities) {
      const elevStr = isIP
        ? `${Math.round((city.elev_m || 0) * 3.280839895).toLocaleString()} ft`
        : `${Math.round(city.elev_m || 0).toLocaleString()} m`;
      const sumT = city.summer04?.Tdb != null
        ? `${CoreDOM.tToDisp(city.summer04.Tdb, units).toFixed(1)}${uT}`
        : '';
      const winT = city.winter996?.Tdb != null
        ? `${CoreDOM.tToDisp(city.winter996.Tdb, units).toFixed(1)}${uT}`
        : '';
      items.push({
        id: `city:${city.id}`,
        group: `Global Cities (${cities.length})`,
        icon: '🌍',
        title: `Plot City + Load 8,760hr TMY: ${city.name}`,
        desc: `${city.country} · Zone ${city.climateZone || '—'} · ${elevStr}`,
        key: sumT && winT ? `${winT}..${sumT}` : elevStr,
        keywords: `city weather tmy climate plot 8760 ${city.name} ${city.country} ${city.region || ''} ${city.climateZone || ''} ${city.id}`,
        run: () => plotCityAndLoadTMY(city)
      });
    }

    return items;
  }

  function renderCmdList(query) {
    const listEl = byId('cmdList');
    if (!listEl) return;

    const catalog = buildCommandCatalog();
    const q = String(query || '').trim();

    if (!q) {
      cmdFiltered = catalog;
    } else {
      const scored = [];
      for (const item of catalog) {
        const s = _modFuzzyScore(q, item.title, item.desc, item.keywords);
        if (s > 0) scored.push({ item, score: s });
      }
      scored.sort((a, b) => b.score - a.score);
      cmdFiltered = scored.map(x => x.item);
    }

    cmdActiveIdx = cmdFiltered.length > 0 ? CoreDOM.clamp(cmdActiveIdx, 0, cmdFiltered.length - 1) : 0;

    if (cmdFiltered.length === 0) {
      listEl.innerHTML = `<div class="cmd-empty">No matching commands, presets, themes, or cities for "${esc(q)}"</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    let lastGroup = null;

    cmdFiltered.forEach((item, idx) => {
      // Show category headers when browsing unfiltered (or when items naturally group)
      if (!q && item.group !== lastGroup) {
        const grp = document.createElement('div');
        grp.className = 'cmd-group';
        grp.textContent = item.group;
        frag.appendChild(grp);
        lastGroup = item.group;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cmd-item' + (idx === cmdActiveIdx ? ' selected' : '');
      btn.dataset.cmdIdx = String(idx);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', idx === cmdActiveIdx ? 'true' : 'false');
      btn.innerHTML =
        `<span class="cmd-icon">${esc(item.icon || '›')}</span>` +
        `<span class="cmd-label">${esc(item.title)}` +
        (item.desc ? ` <span class="cmd-desc">— ${esc(item.desc)}</span>` : '') +
        `</span>` +
        (item.key ? `<span class="cmd-key">${esc(item.key)}</span>` : '');

      btn.addEventListener('mouseenter', () => {
        if (cmdActiveIdx !== idx) setCmdActive(idx, false);
      });
      btn.addEventListener('click', () => {
        executeCmdIndex(idx);
      });

      frag.appendChild(btn);
    });

    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  function setCmdActive(nextIdx, scroll = true) {
    const listEl = byId('cmdList');
    if (!listEl || cmdFiltered.length === 0) return;

    const len = cmdFiltered.length;
    cmdActiveIdx = ((nextIdx % len) + len) % len;

    const btns = listEl.querySelectorAll('.cmd-item');
    btns.forEach((b, i) => {
      const sel = i === cmdActiveIdx;
      b.classList.toggle('selected', sel);
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
      if (sel && scroll) {
        b.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function executeCmdIndex(idx) {
    const item = cmdFiltered[idx];
    if (!item) return;
    hideOverlay('cmdPaletteOverlay', false);
    try {
      item.run();
    } catch (err) {
      notifyToast(`Command error: ${err?.message || err}`, 'error');
    }
    if (!isAnyModalOpen() && prevFocusEl) {
      const target = prevFocusEl;
      prevFocusEl = null;
      try { target.focus?.(); } catch {}
    }
  }

  function openCmdPalette() {
    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    const inp = byId('cmdInput');
    cmdActiveIdx = 0;
    if (inp) {
      inp.value = '';
    }
    renderCmdList('');
    showOverlay('cmdPaletteOverlay', inp);
  }

  const cmdInput = byId('cmdInput');
  on(cmdInput, 'input', () => {
    cmdActiveIdx = 0;
    renderCmdList(cmdInput.value);
  });

  on(byId('cmdPaletteOverlay'), 'keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCmdActive(cmdActiveIdx + 1, true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCmdActive(cmdActiveIdx - 1, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeCmdIndex(cmdActiveIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideOverlay('cmdPaletteOverlay');
    }
  });

  on(byId('cmdPaletteOverlay'), 'click', e => {
    if (e.target === byId('cmdPaletteOverlay')) hideOverlay('cmdPaletteOverlay');
  });

  on(byId('btnCmdPalette'), 'click', () => openCmdPalette());

  /* ==========================================================================
     2B. EDIT POINT MODAL (`#editPtOverlay`)
     ========================================================================== */
  let epPtId = null;
  let epCurrentState = null;
  let epCoordsDirty = false;

  function epClearPreview() {
    ['epRH', 'epW', 'epH', 'epTwb', 'epTdp', 'epV', 'epPmv'].forEach(id => {
      const node = byId(id);
      if (node) {
        node.textContent = '—';
        node.style.color = '';
      }
    });
  }

  function epSolveInputs() {
    const units = _modUnits(store);
    const pPa = _modPressure(store);
    const tdRaw = parseFloat(byId('epTdb')?.value);
    const valRaw = parseFloat(byId('epVal')?.value);
    const mode = byId('epMode')?.value || 'RH';

    if (!Number.isFinite(tdRaw) || !Number.isFinite(valRaw)) return null;
    const T = CoreDOM.dispToT(tdRaw, units);
    const ws = Psy.wsat_at(T, pPa);
    let w = NaN;

    if (mode === 'RH') {
      w = Psy.w_from_TRH(T, CoreDOM.clamp(valRaw, 0, 100) / 100, pPa);
    } else if (mode === 'W') {
      w = CoreDOM.clamp(CoreDOM.dispToW(valRaw, units), 0, ws);
    } else if (mode === 'Twb') {
      const twbC = CoreDOM.dispToT(valRaw, units);
      w = Psy.w_from_TTwb(T, Math.min(twbC, T), pPa);
    } else if (mode === 'Tdp') {
      const tdpC = CoreDOM.dispToT(valRaw, units);
      w = CoreDOM.clamp(Psy.w_from_Tdp(Math.min(tdpC, T), pPa), 0, ws);
    } else if (mode === 'h') {
      if (units === 'IP') {
        const tF = CoreDOM.cToF(T);
        w = (valRaw - 0.240 * tF) / (1061 + 0.444 * tF);
      } else {
        w = (valRaw - 1.006 * T) / (2501 + 1.86 * T);
      }
      if (!Number.isFinite(w) || w < -1e-6 || w > ws * 1.001 + 1e-7) return null;
      w = CoreDOM.clamp(w, 0, ws);
    }

    if (!Number.isFinite(T) || !Number.isFinite(w)) return null;
    return Psy.stateFromTw(T, CoreDOM.clamp(w, 0, ws), pPa);
  }

  function epRenderReadouts(solved) {
    const units = _modUnits(store);
    const isSI = units === 'SI';
    const uT = isSI ? '°C' : '°F';

    const wLbl = byId('epWLbl');
    const hLbl = byId('epHLbl');
    const twbLbl = byId('epTwbLbl');
    const tdpLbl = byId('epTdpLbl');
    const vLbl = byId('epVLbl');
    if (wLbl) wLbl.textContent = isSI ? 'W (g/kg)' : 'W (gr/lb)';
    if (hLbl) hLbl.textContent = isSI ? 'h (kJ/kg)' : 'h (Btu/lb)';
    if (twbLbl) twbLbl.textContent = `Twb (${uT})`;
    if (tdpLbl) tdpLbl.textContent = `Tdp (${uT})`;
    if (vLbl) vLbl.textContent = isSI ? 'v (m³/kg)' : 'v (ft³/lb)';

    if (!solved) {
      epClearPreview();
      return;
    }

    const pmvRes = _modCalcActivePMV(solved.T, solved.w, solved.pPa, _modState(store));
    const pmvSign = pmvRes.pmv >= 0 ? '+' : '';

    if (byId('epRH')) byId('epRH').textContent = `${solved.rh.toFixed(1)}%`;
    if (byId('epW')) byId('epW').textContent = isSI ? (solved.w * 1000).toFixed(2) : (solved.w * Psy.GRAINS_PER_LB).toFixed(1);
    if (byId('epH')) byId('epH').textContent = (isSI ? solved.h : solved.hIP).toFixed(2);
    if (byId('epTwb')) byId('epTwb').textContent = `${CoreDOM.tToDisp(solved.Twb, units).toFixed(2)}°`;
    if (byId('epTdp')) byId('epTdp').textContent = `${CoreDOM.tToDisp(solved.Tdp, units).toFixed(2)}°`;
    if (byId('epV')) byId('epV').textContent = isSI ? solved.v.toFixed(4) : solved.vIP.toFixed(3);

    const pmvEl = byId('epPmv');
    if (pmvEl) {
      pmvEl.textContent = `${pmvSign}${pmvRes.pmv.toFixed(2)} (${pmvRes.ppd.toFixed(0)}% PPD)`;
      if (pmvRes.compliant) pmvEl.style.color = 'var(--success)';
      else if (Math.abs(pmvRes.pmv) <= 1.2) pmvEl.style.color = 'var(--warn)';
      else pmvEl.style.color = 'var(--danger)';
    }
  }

  function epUpdatePreviewFromInputs() {
    epCoordsDirty = true;
    const solved = epSolveInputs();
    if (!solved) {
      epRenderReadouts(null);
      return;
    }
    epCurrentState = solved;
    epRenderReadouts(solved);
  }

  function epUpdateModeField() {
    const mode = byId('epMode')?.value || 'RH';
    const units = _modUnits(store);
    const valLbl = byId('epValLabel');
    if (valLbl) valLbl.textContent = _modPropUnitText(mode, units);

    // Keep epCurrentState pristine across mode switches (zero rounding drift!)
    const pt = epPtId != null ? store?.getPoint?.(epPtId) : null;
    const ref = epCurrentState || (pt ? Psy.stateFromTw(pt.T, pt.w, _modPressure(store)) : null);
    const valInp = byId('epVal');
    if (valInp && ref) {
      valInp.value = _modDefaultValForProp(mode, ref, units);
    }
    epRenderReadouts(ref);
  }

  function openEditPoint(ptId) {
    const id = typeof ptId === 'object' && ptId !== null ? ptId.id : ptId;
    const pt = store?.getPoint?.(id);
    if (!pt) return;

    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    epPtId = pt.id;
    epCoordsDirty = false;

    const units = _modUnits(store);
    const pPa = _modPressure(store);
    const isSI = units === 'SI';
    const stPt = Psy.stateFromTw(pt.T, pt.w, pPa);
    epCurrentState = stPt;

    const titleEl = byId('epTitle');
    if (titleEl) {
      titleEl.textContent = pt.locked ? `${pt.label} (Locked)` : pt.label;
    }
    if (byId('epLabel')) byId('epLabel').value = pt.label || '';
    if (byId('epColor')) byId('epColor').value = _modNormHex(pt.color, POINT_PALETTE[0]);
    if (byId('epNote')) byId('epNote').value = pt.note || '';
    if (byId('epTdbLabel')) byId('epTdbLabel').textContent = `Dry Bulb (${isSI ? '°C' : '°F'})`;

    const tdbInp = byId('epTdb');
    const modeSel = byId('epMode');
    const valInp = byId('epVal');
    const lockedCoords = Boolean(pt.locked);

    if (tdbInp) {
      tdbInp.value = CoreDOM.tToDisp(pt.T, units).toFixed(2);
      tdbInp.disabled = lockedCoords;
    }
    if (modeSel) {
      modeSel.value = 'RH';
      modeSel.disabled = lockedCoords;
    }
    if (byId('epValLabel')) byId('epValLabel').textContent = 'Relative Humidity (%)';
    if (valInp) {
      valInp.value = stPt.rh.toFixed(1);
      valInp.disabled = lockedCoords;
    }

    epRenderReadouts(stPt);
    showOverlay('editPtOverlay', lockedCoords ? byId('epLabel') : byId('epTdb'));
  }

  function applyEditPoint() {
    if (epPtId == null) return;
    const pt = store?.getPoint?.(epPtId);
    if (!pt) {
      hideOverlay('editPtOverlay');
      return;
    }

    const label = (byId('epLabel')?.value || '').trim() || pt.label;
    const color = byId('epColor')?.value || pt.color;
    const note = byId('epNote')?.value ?? pt.note ?? '';
    const lockedCoords = Boolean(pt.locked);

    if (lockedCoords || !epCoordsDirty) {
      store?.updatePoint?.(pt.id, { label, color, note, force: true }, true);
      _modRedraw(store, baseRenderer, overlayRenderer, false);
      notifyToast(lockedCoords ? `"${label}" metadata updated` : `"${label}" updated`, 'success');
      hideOverlay('editPtOverlay');
      epPtId = null;
      return;
    }

    const solved = epSolveInputs();
    if (!solved) {
      notifyToast('Enter valid numeric dry-bulb and humidity values', 'error');
      return;
    }

    store?.updatePoint?.(pt.id, {
      label,
      color,
      note,
      T: solved.T,
      w: solved.w
    }, true);
    _modRedraw(store, baseRenderer, overlayRenderer, false);
    notifyToast(`"${label}" updated`, 'success');
    hideOverlay('editPtOverlay');
    epPtId = null;
  }

  on(byId('epMode'), 'change', epUpdateModeField);
  on(byId('epTdb'), 'input', epUpdatePreviewFromInputs);
  on(byId('epVal'), 'input', epUpdatePreviewFromInputs);
  on(byId('epApply'), 'click', applyEditPoint);
  on(byId('epCancel'), 'click', () => {
    hideOverlay('editPtOverlay');
    epPtId = null;
  });
  on(byId('editPtOverlay'), 'click', e => {
    if (e.target === byId('editPtOverlay')) {
      hideOverlay('editPtOverlay');
      epPtId = null;
    }
  });
  on(byId('editPtOverlay'), 'keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideOverlay('editPtOverlay');
      epPtId = null;
    } else if (e.key === 'Enter' && !e.target?.closest?.('button, a, select, textarea')) {
      e.preventDefault();
      applyEditPoint();
    }
  });

  /* ==========================================================================
     2C. ADD POINT VIA ANY-2-OF-8 PARAMETERS MODAL (`#addPtParamOverlay`)
     ========================================================================== */
  let apSolvedState = null;
  let apLastValidState = null;

  function apSyncPlaceholders() {
    const units = _modUnits(store);
    const m1 = byId('apMode1')?.value || 'Tdb';
    const m2 = byId('apMode2')?.value || 'RH';
    const v1 = byId('apVal1');
    const v2 = byId('apVal2');
    if (v1) v1.placeholder = _modPropUnitText(m1, units);
    if (v2) v2.placeholder = _modPropUnitText(m2, units);
    if (typeof document !== 'undefined') {
      const lbl1 = document.querySelector('label[for="apVal1"]');
      const lbl2 = document.querySelector('label[for="apVal2"]');
      if (lbl1) lbl1.textContent = _modPropShortUnitText(m1, units);
      if (lbl2) lbl2.textContent = _modPropShortUnitText(m2, units);
    }
  }

  function apUpdatePreview() {
    const previewEl = byId('apPreview');
    const addBtn = byId('apAdd');
    const units = _modUnits(store);
    const isSI = units === 'SI';
    const pPa = _modPressure(store);

    const m1 = byId('apMode1')?.value || 'Tdb';
    const m2 = byId('apMode2')?.value || 'RH';
    const raw1 = parseFloat(byId('apVal1')?.value);
    const raw2 = parseFloat(byId('apVal2')?.value);

    apSyncPlaceholders();

    if (!Number.isFinite(raw1) || !Number.isFinite(raw2)) {
      apSolvedState = null;
      if (previewEl) {
        previewEl.innerHTML = `<div style="color:var(--muted);font-size:11px">Enter two numeric psychrometric values to solve full state.</div>`;
      }
      if (addBtn) addBtn.disabled = true;
      return;
    }

    const hasIpH = units === 'IP' && (m1.toLowerCase() === 'h' || m2.toLowerCase() === 'h');
    let si1 = _modDispPropToSI(m1, raw1, units, 0);
    let si2 = _modDispPropToSI(m2, raw2, units, 0);
    let res = Psy.solveState(si1.key, si1.val, si2.key, si2.val, pPa);

    if (res.ok && hasIpH && res.state) {
      for (let iter = 0; iter < 4; iter++) {
        const wNow = res.state.w;
        si1 = _modDispPropToSI(m1, raw1, units, wNow);
        si2 = _modDispPropToSI(m2, raw2, units, wNow);
        const refined = Psy.solveState(si1.key, si1.val, si2.key, si2.val, pPa);
        if (!refined.ok) break;
        const dw = Math.abs(refined.state.w - wNow);
        res = refined;
        if (dw < 1e-9) break;
      }
    }

    if (!res.ok) {
      apSolvedState = null;
      if (previewEl) {
        previewEl.innerHTML = `<div style="color:var(--danger);font-size:11px;font-weight:500">⚠ ${esc(res.error || 'Invalid property combination')}</div>`;
      }
      if (addBtn) addBtn.disabled = true;
      return;
    }

    const s = res.state;
    apSolvedState = s;
    apLastValidState = s;
    if (addBtn) addBtn.disabled = false;

    if (previewEl) {
      const uT = isSI ? '°C' : '°F';
      const uW = isSI ? 'g/kg' : 'gr/lb';
      const uH = isSI ? 'kJ/kg' : 'Btu/lb';
      const uV = isSI ? 'm³/kg' : 'ft³/lb';
      const uP = isSI ? 'kPa' : 'psia';
      const pmvRes = _modCalcActivePMV(s.T, s.w, pPa, _modState(store));
      const pmvSign = pmvRes.pmv >= 0 ? '+' : '';
      const pmvCol = pmvRes.compliant ? 'var(--success)' : (Math.abs(pmvRes.pmv) <= 1.2 ? 'var(--warn)' : 'var(--danger)');

      const cells = [
        ['Tdb', `${CoreDOM.tToDisp(s.T, units).toFixed(2)} ${uT}`],
        ['RH', `${s.rh.toFixed(1)} %`],
        ['W', `${CoreDOM.wToDisp(s.w, units).toFixed(isSI ? 2 : 1)} ${uW}`],
        ['Twb', `${CoreDOM.tToDisp(s.Twb, units).toFixed(2)} ${uT}`],
        ['Tdp', `${CoreDOM.tToDisp(s.Tdp, units).toFixed(2)} ${uT}`],
        ['h', `${(isSI ? s.h : s.hIP).toFixed(2)} ${uH}`],
        ['v', `${isSI ? s.v.toFixed(4) : s.vIP.toFixed(3)} ${uV}`],
        ['Pv', `${(isSI ? s.pv / 1000 : s.pv / (Psy.KPA_PER_PSI * 1000)).toFixed(isSI ? 3 : 4)} ${uP}`],
        ['PMV/PPD', `<span style="color:${pmvCol}">${pmvSign}${pmvRes.pmv.toFixed(2)} · ${pmvRes.ppd.toFixed(0)}%</span>`]
      ];

      previewEl.innerHTML =
        `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;font-family:var(--mono);font-size:11px">` +
        cells.map(([k, v]) =>
          `<div style="display:flex;flex-direction:column;gap:1px">` +
          `<span style="font-size:9px;color:var(--muted);font-family:var(--sans);font-weight:700;text-transform:uppercase">${k}</span>` +
          `<span style="color:var(--fgStrong);font-weight:600">${v}</span>` +
          `</div>`
        ).join('') +
        `</div>`;
    }
  }

  function openAddPointParam(defaultT, defaultW) {
    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    const units = _modUnits(store);
    const pPa = _modPressure(store);
    const pts = _modState(store).points || [];

    const T0 = Number.isFinite(Number(defaultT)) ? Number(defaultT) : 24.0;
    const w0 = Number.isFinite(Number(defaultW))
      ? CoreDOM.clamp(Number(defaultW), 0, Psy.wsat_at(T0, pPa))
      : Psy.w_from_TRH(T0, 0.50, pPa);
    const ref = Psy.stateFromTw(T0, w0, pPa);
    apLastValidState = ref;

    const m1Sel = byId('apMode1');
    const m2Sel = byId('apMode2');
    if (m1Sel) m1Sel.value = 'Tdb';
    if (m2Sel) m2Sel.value = 'RH';
    if (byId('apVal1')) byId('apVal1').value = _modDefaultValForProp('Tdb', ref, units);
    if (byId('apVal2')) byId('apVal2').value = _modDefaultValForProp('RH', ref, units);
    if (byId('apLabel')) byId('apLabel').value = `P${pts.length + 1}`;
    if (byId('apColor')) byId('apColor').value = POINT_PALETTE[pts.length % POINT_PALETTE.length];

    apUpdatePreview();
    showOverlay('addPtParamOverlay', byId('apVal1'));
  }

  function confirmAddPointParam() {
    apUpdatePreview();
    if (!apSolvedState) {
      notifyToast('Fix invalid psychrometric inputs before adding point', 'error');
      return;
    }

    const pts = _modState(store).points || [];
    const label = (byId('apLabel')?.value || '').trim() || `P${pts.length + 1}`;
    const color = byId('apColor')?.value || POINT_PALETTE[pts.length % POINT_PALETTE.length];

    store?.addPoint?.({
      T: apSolvedState.T,
      w: apSolvedState.w,
      label,
      color,
      locked: false
    }, true);

    _modRedraw(store, baseRenderer, overlayRenderer, false);
    notifyToast(`Point "${label}" added`, 'success');
    hideOverlay('addPtParamOverlay');
  }

  on(byId('apMode1'), 'change', () => {
    const units = _modUnits(store);
    const refState = apSolvedState || apLastValidState;
    if (refState && byId('apVal1')) {
      byId('apVal1').value = _modDefaultValForProp(byId('apMode1').value, refState, units);
    }
    apUpdatePreview();
  });
  on(byId('apMode2'), 'change', () => {
    const units = _modUnits(store);
    const refState = apSolvedState || apLastValidState;
    if (refState && byId('apVal2')) {
      byId('apVal2').value = _modDefaultValForProp(byId('apMode2').value, refState, units);
    }
    apUpdatePreview();
  });
  on(byId('apVal1'), 'input', apUpdatePreview);
  on(byId('apVal2'), 'input', apUpdatePreview);
  on(byId('apAdd'), 'click', confirmAddPointParam);
  on(byId('apCancel'), 'click', () => hideOverlay('addPtParamOverlay'));
  on(byId('addPtParamOverlay'), 'click', e => {
    if (e.target === byId('addPtParamOverlay')) hideOverlay('addPtParamOverlay');
  });
  on(byId('addPtParamOverlay'), 'keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideOverlay('addPtParamOverlay');
    } else if (e.key === 'Enter' && !e.target?.closest?.('button, a, select, textarea')) {
      e.preventDefault();
      confirmAddPointParam();
    }
  });

  /* ==========================================================================
     2D. MIX FLOW MODAL (`#mixFlowOverlay`) — Intuitive Two-Point Mix Dialog
     ========================================================================== */
  let mixPtAId = null;
  let mixPtBId = null;
  let mixSavedFlowA = 1000;
  let mixSavedFlowB = 1000;
  let mixLastMethod = 'both';

  function mixResolveFlows() {
    const A = mixPtAId != null ? store?.getPoint?.(mixPtAId) : null;
    const B = mixPtBId != null ? store?.getPoint?.(mixPtBId) : null;
    if (!A || !B) return null;

    const method = byId('mixFlowMethod')?.value || 'both';
    const unit = byId('mixFlowUnit')?.value || (_modUnits(store) === 'IP' ? 'cfm' : 'Lps');
    const rawA = parseFloat(byId('mixFlowValA')?.value);
    const rawB = parseFloat(byId('mixFlowValB')?.value);
    let fA = NaN;
    let fB = NaN;

    if (method === 'both') {
      if (!(rawA > 0) || !(rawB > 0)) {
        return { A, B, unit, method, valid: false, error: 'Enter positive airflow values (> 0) for both streams.' };
      }
      fA = rawA;
      fB = rawB;
      mixSavedFlowA = fA;
      mixSavedFlowB = fB;
    } else if (method === 'flowA_pctB') {
      if (!(rawA > 0)) {
        return { A, B, unit, method, valid: false, error: `Enter a positive airflow (> 0) for "${A.label}".` };
      }
      if (!Number.isFinite(rawB) || rawB < 1 || rawB > 99) {
        return { A, B, unit, method, valid: false, error: `"${B.label}" percentage must be between 1% and 99% of total mixed flow.` };
      }
      const pctB = CoreDOM.clamp(rawB, 1, 99);
      fA = rawA;
      fB = fA * pctB / (100 - pctB);
      mixSavedFlowA = fA;
      mixSavedFlowB = CoreDOM.round(fB, 2);
    } else if (method === 'flowB_pctA') {
      if (!(rawB > 0)) {
        return { A, B, unit, method, valid: false, error: `Enter a positive airflow (> 0) for "${B.label}".` };
      }
      if (!Number.isFinite(rawA) || rawA < 1 || rawA > 99) {
        return { A, B, unit, method, valid: false, error: `"${A.label}" percentage must be between 1% and 99% of total mixed flow.` };
      }
      const pctA = CoreDOM.clamp(rawA, 1, 99);
      fB = rawB;
      fA = fB * pctA / (100 - pctA);
      mixSavedFlowA = CoreDOM.round(fA, 2);
      mixSavedFlowB = fB;
    }

    if (!(fA > 0) || !(fB > 0)) {
      return { A, B, unit, method, valid: false, error: 'Enter valid positive airflow values.' };
    }

    const pPa = _modPressure(store);
    const mA = Psy.flowToMassKgps(fA, unit, A.T, A.w, pPa);
    const mB = Psy.flowToMassKgps(fB, unit, B.T, B.w, pPa);
    if (!(mA > 0) || !(mB > 0)) {
      return { A, B, unit, method, valid: false, error: 'Unable to resolve valid stream mass flows.' };
    }

    const mixRes = HVAC.calcMixing([
      { T: A.T, w: A.w, flowVal: mA, flowUnit: 'kgps' },
      { T: B.T, w: B.w, flowVal: mB, flowUnit: 'kgps' }
    ], pPa);

    return { A, B, unit, method, fA, fB, mA, mB, mixRes, valid: true };
  }

  function mixUpdateUI(methodChanged = false) {
    const A = mixPtAId != null ? store?.getPoint?.(mixPtAId) : null;
    const B = mixPtBId != null ? store?.getPoint?.(mixPtBId) : null;
    if (!A || !B) return;

    const units = _modUnits(store);
    const isSI = units === 'SI';
    const unitSel = byId('mixFlowUnit');
    const uTxt = unitSel?.options?.[unitSel.selectedIndex]?.textContent || (isSI ? 'L/s' : 'CFM');
    const method = byId('mixFlowMethod')?.value || 'both';
    const lblA = byId('mixFlowLblA');
    const lblB = byId('mixFlowLblB');
    const valA = byId('mixFlowValA');
    const valB = byId('mixFlowValB');
    const hintA = byId('mixFlowHintA');
    const hintB = byId('mixFlowHintB');
    const okBtn = byId('mixFlowOk');

    // Save/restore absolute flow values cleanly whenever method toggles
    if (methodChanged && method !== mixLastMethod) {
      const curA = parseFloat(valA?.value);
      const curB = parseFloat(valB?.value);
      if (mixLastMethod === 'both') {
        if (curA > 0) mixSavedFlowA = curA;
        if (curB > 0) mixSavedFlowB = curB;
      } else if (mixLastMethod === 'flowA_pctB') {
        if (curA > 0) mixSavedFlowA = curA;
        if (curA > 0 && Number.isFinite(curB) && curB >= 1 && curB <= 99) {
          mixSavedFlowB = CoreDOM.round(curA * curB / (100 - curB), 2);
        }
      } else if (mixLastMethod === 'flowB_pctA') {
        if (curB > 0) mixSavedFlowB = curB;
        if (curB > 0 && Number.isFinite(curA) && curA >= 1 && curA <= 99) {
          mixSavedFlowA = CoreDOM.round(curB * curA / (100 - curA), 2);
        }
      }

      const totSaved = Math.max(1e-6, mixSavedFlowA + mixSavedFlowB);
      if (method === 'both') {
        if (valA) valA.value = String(CoreDOM.round(mixSavedFlowA, 2));
        if (valB) valB.value = String(CoreDOM.round(mixSavedFlowB, 2));
      } else if (method === 'flowA_pctB') {
        const pctB = CoreDOM.clamp(CoreDOM.round((mixSavedFlowB / totSaved) * 100, 1), 1, 99);
        if (valA) valA.value = String(CoreDOM.round(mixSavedFlowA, 2));
        if (valB) valB.value = String(pctB);
      } else if (method === 'flowB_pctA') {
        const pctA = CoreDOM.clamp(CoreDOM.round((mixSavedFlowA / totSaved) * 100, 1), 1, 99);
        if (valA) valA.value = String(pctA);
        if (valB) valB.value = String(CoreDOM.round(mixSavedFlowB, 2));
      }
      mixLastMethod = method;
    }

    if (method === 'both') {
      if (lblA) lblA.textContent = `${A.label} — Flow (${uTxt})`;
      if (lblB) lblB.textContent = `${B.label} — Flow (${uTxt})`;
      if (valA) { valA.step = 'any'; valA.min = '0'; valA.removeAttribute('max'); }
      if (valB) { valB.step = 'any'; valB.min = '0'; valB.removeAttribute('max'); }
      if (hintA) { hintA.classList.remove('visible'); hintA.innerHTML = ''; }
      if (hintB) { hintB.classList.remove('visible'); hintB.innerHTML = ''; }
    } else if (method === 'flowA_pctB') {
      if (lblA) lblA.textContent = `${A.label} — Flow (${uTxt})`;
      if (lblB) lblB.textContent = `${B.label} — % of Total Mixed Flow (1–99%)`;
      if (valA) { valA.step = 'any'; valA.min = '0'; valA.removeAttribute('max'); }
      if (valB) { valB.step = '1'; valB.min = '1'; valB.max = '99'; }
      if (hintA) { hintA.classList.remove('visible'); hintA.innerHTML = ''; }
      if (hintB) {
        hintB.classList.add('visible');
        hintB.innerHTML =
          `Enter percentage of total mixed airflow (1–99%). ` +
          `Example: <code>25</code> = 25% ${esc(B.label)} / 75% ${esc(A.label)}.`;
      }
    } else if (method === 'flowB_pctA') {
      if (lblB) lblB.textContent = `${B.label} — Flow (${uTxt})`;
      if (lblA) lblA.textContent = `${A.label} — % of Total Mixed Flow (1–99%)`;
      if (valB) { valB.step = 'any'; valB.min = '0'; valB.removeAttribute('max'); }
      if (valA) { valA.step = '1'; valA.min = '1'; valA.max = '99'; }
      if (hintB) { hintB.classList.remove('visible'); hintB.innerHTML = ''; }
      if (hintA) {
        hintA.classList.add('visible');
        hintA.innerHTML =
          `Enter percentage of total mixed airflow (1–99%). ` +
          `Example: <code>25</code> = 25% ${esc(A.label)} / 75% ${esc(B.label)}.`;
      }
    }

    const calc = mixResolveFlows();
    if (okBtn) okBtn.disabled = !Boolean(calc?.valid);
    const targetHint = method === 'flowB_pctA' ? hintA : hintB;

    if (calc?.valid && calc.mixRes) {
      const m = calc.mixRes;
      const pPa = _modPressure(store);
      const uT = isSI ? '°C' : '°F';
      const uW = isSI ? 'g/kg' : 'gr/lb';
      const tDisp = CoreDOM.tToDisp(m.T, units).toFixed(2);
      const wDisp = CoreDOM.wToDisp(m.w, units).toFixed(isSI ? 2 : 1);
      const rhDisp = (Psy.RH_from_Tw(m.T, m.w, pPa) * 100).toFixed(1);
      const pctA = ((calc.mA / (calc.mA + calc.mB)) * 100).toFixed(1);
      const pctB = ((calc.mB / (calc.mA + calc.mB)) * 100).toFixed(1);
      const fogNote = m.condensationWarning
        ? ` · <strong style="color:var(--danger)">Fog/Condensation!</strong>`
        : '';
      const previewHtml =
        `<div style="margin-top:4px;color:var(--accent);font-family:var(--mono);font-size:10.5px">` +
        `Mix preview (${pctA}% / ${pctB}%): ${tDisp}${uT} · ${rhDisp}% RH · ${wDisp} ${uW}${fogNote}</div>`;

      if (targetHint) {
        targetHint.classList.add('visible');
        targetHint.innerHTML = (method === 'both' ? '' : targetHint.innerHTML) + previewHtml;
      }
    } else if (targetHint) {
      const errMsg = calc?.error || 'Enter valid positive airflow values for both streams.';
      targetHint.classList.add('visible');
      const warnHtml = `<div style="margin-top:4px;color:var(--danger);font-size:10.5px;font-weight:600">⚠ ${esc(errMsg)}</div>`;
      targetHint.innerHTML = (method === 'both' ? '' : targetHint.innerHTML) + warnHtml;
    }
  }

  function closeMixFlowModal() {
    hideOverlay('mixFlowOverlay');
    mixPtAId = null;
    mixPtBId = null;
    if (_modState(store).ui?.activeTool === 'mix') {
      store?.setTool?.('select');
    }
    _modRedraw(store, baseRenderer, overlayRenderer, false);
  }

  function openMixFlow(aId, bId) {
    const idA = typeof aId === 'object' && aId !== null ? aId.id : aId;
    const idB = typeof bId === 'object' && bId !== null ? bId.id : bId;
    const A = store?.getPoint?.(idA);
    const B = store?.getPoint?.(idB);
    if (!A || !B || A.id === B.id) return;

    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    mixPtAId = A.id;
    mixPtBId = B.id;

    const units = _modUnits(store);
    const isSI = units === 'SI';
    const pPa = _modPressure(store);
    const uT = isSI ? '°C' : '°F';
    const uW = isSI ? 'g/kg' : 'gr/lb';

    const fmtProps = pt => {
      const t = CoreDOM.tToDisp(pt.T, units).toFixed(1);
      const w = CoreDOM.wToDisp(pt.w, units).toFixed(isSI ? 2 : 0);
      const rh = (Psy.RH_from_Tw(pt.T, pt.w, pPa) * 100).toFixed(0);
      return `${t}${uT}  ${rh}% RH  ${w} ${uW}`;
    };

    const nameAEl = byId('mixFlowNameA');
    const nameBEl = byId('mixFlowNameB');
    if (nameAEl) {
      nameAEl.textContent = A.label;
      const dotA = nameAEl.closest('.mix-flow-card')?.querySelector('.mix-flow-dot');
      if (dotA) dotA.style.background = A.color || 'var(--accent, #38bdf8)';
    }
    if (nameBEl) {
      nameBEl.textContent = B.label;
      const dotB = nameBEl.closest('.mix-flow-card')?.querySelector('.mix-flow-dot');
      if (dotB) dotB.style.background = B.color || 'var(--chip, #10b981)';
    }
    if (byId('mixFlowPropsA')) byId('mixFlowPropsA').textContent = fmtProps(A);
    if (byId('mixFlowPropsB')) byId('mixFlowPropsB').textContent = fmtProps(B);

    const unitSel = byId('mixFlowUnit');
    if (unitSel) {
      unitSel.innerHTML = isSI
        ? '<option value="Lps">L/s</option><option value="m3h">m³/h</option><option value="kgps">kg/s</option>'
        : '<option value="cfm">CFM</option><option value="lbps">lb/s</option>';
    }

    const methodSel = byId('mixFlowMethod');
    if (methodSel) {
      methodSel.innerHTML =
        `<option value="both">Enter both flows</option>` +
        `<option value="flowA_pctB">Enter "${esc(A.label)}" flow + "${esc(B.label)}" % of total</option>` +
        `<option value="flowB_pctA">Enter "${esc(B.label)}" flow + "${esc(A.label)}" % of total</option>`;
      methodSel.value = 'both';
    }

    const defFlow = isSI ? 1000 : 2000;
    mixSavedFlowA = defFlow;
    mixSavedFlowB = defFlow;
    mixLastMethod = 'both';

    if (byId('mixFlowValA')) byId('mixFlowValA').value = String(defFlow);
    if (byId('mixFlowValB')) byId('mixFlowValB').value = String(defFlow);
    if (byId('mixFlowLabel')) byId('mixFlowLabel').value = 'Mix';

    mixUpdateUI(false);
    showOverlay('mixFlowOverlay', byId('mixFlowValA'));
  }

  function confirmMixFlow() {
    const calc = mixResolveFlows();
    if (!calc) {
      closeMixFlowModal();
      return;
    }
    if (!calc.valid) {
      notifyToast(calc.error || 'Enter positive airflow values for both streams', 'error');
      return;
    }

    const { A, B, fA, fB, mA, mB, unit, mixRes } = calc;
    const label = (byId('mixFlowLabel')?.value || 'Mix').trim() || 'Mix';

    store?.pushHistory?.(`Mix "${A.label}" + "${B.label}" → "${label}"`);

    const mixPt = store?.addPoint?.({
      T: mixRes.T,
      w: mixRes.w,
      label,
      color: '#facc15',
      locked: true,
      lx: 12,
      ly: -10,
      note: `Adiabatic Mix (${((mA / (mA + mB)) * 100).toFixed(1)}% ${A.label} + ${((mB / (mA + mB)) * 100).toFixed(1)}% ${B.label})`,
      derived: {
        type: 'mix',
        streams: [
          { id: A.id, m: mA },
          { id: B.id, m: mB }
        ]
      }
    }, false);

    if (mixPt) {
      store?.addProcess?.(A.id, mixPt.id, { flowVal: CoreDOM.round(fA, 2), flowUnit: unit, role: 'mix', label: `Mix from ${A.label}` }, false);
      store?.addProcess?.(B.id, mixPt.id, { flowVal: CoreDOM.round(fB, 2), flowUnit: unit, role: 'mix', label: `Mix from ${B.label}` }, false);
    }

    if (mixRes.condensationWarning) {
      notifyToast(`Mix "${label}" created (⚠ supersaturated fog equilibrium)`, 'warn');
    } else {
      notifyToast(`Mix "${label}" created: "${A.label}" + "${B.label}"`, 'success');
    }

    closeMixFlowModal();
  }

  on(byId('mixFlowMethod'), 'change', () => mixUpdateUI(true));
  on(byId('mixFlowUnit'), 'change', () => mixUpdateUI(false));
  on(byId('mixFlowValA'), 'input', () => mixUpdateUI(false));
  on(byId('mixFlowValB'), 'input', () => mixUpdateUI(false));
  on(byId('mixFlowOk'), 'click', confirmMixFlow);
  on(byId('mixFlowCancel'), 'click', closeMixFlowModal);
  on(byId('mixFlowOverlay'), 'click', e => {
    if (e.target === byId('mixFlowOverlay')) closeMixFlowModal();
  });
  on(byId('mixFlowOverlay'), 'keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMixFlowModal();
    } else if (e.key === 'Enter' && !e.target?.closest?.('button, a, select, textarea')) {
      e.preventDefault();
      confirmMixFlow();
    }
  });

  /* ==========================================================================
     2E. REPORT EXPORT MODAL (`#reportOverlay`)
     ========================================================================== */
  function syncReportMetaToInputs() {
    const meta = _modState(store).meta || {};
    const compEl = byId('companyName');
    const engEl = byId('engineerName');
    const notesEl = byId('projNotes');
    if (compEl) compEl.value = meta.company || '';
    if (engEl) engEl.value = meta.engineer || '';
    if (notesEl) notesEl.value = meta.notes || '';
  }

  function syncReportInputsToMeta() {
    const patch = {};
    const compEl = byId('companyName');
    const engEl = byId('engineerName');
    const notesEl = byId('projNotes');
    if (compEl) patch.company = compEl.value.trim();
    if (engEl) patch.engineer = engEl.value.trim();
    if (notesEl) patch.notes = notesEl.value;
    if (Object.keys(patch).length > 0 && typeof store?.setMeta === 'function') {
      store.setMeta(patch);
    }
  }

  function openReport() {
    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    syncReportMetaToInputs();
    showOverlay('reportOverlay');
  }

  function handleReportGenerate() {
    syncReportInputsToMeta();
    const rptOverlay = byId('reportOverlay');
    const checkedRadio = rptOverlay?.querySelector('input[name="rptFmt"]:checked');
    const rawFmt = (checkedRadio?.value || 'html').toLowerCase();
    const fmt = (rawFmt === 'docx' || rawFmt === 'svg' || rawFmt === 'csv') ? rawFmt : 'html';

    const opts = {
      includeChart: _modReadBool('rptChart', true),
      includeProcesses: _modReadBool('rptProc', true),
      includeProc: _modReadBool('rptProc', true),
      includeComfort: _modReadBool('rptComfort', true),
      includeWeather: _modReadBool('rptWeather', true),
      printerFriendly: _modReadBool('rptPrint', false),
      printFriendly: _modReadBool('rptPrint', false)
    };

    hideOverlay('reportOverlay');
    invokeExport(fmt, opts);
  }

  on(byId('projNotes'), 'input', () => {
    const el = byId('projNotes');
    if (el && typeof store?.setMeta === 'function') store.setMeta({ notes: el.value });
  });
  on(byId('rptGenerate'), 'click', handleReportGenerate);
  on(byId('rptCancel'), 'click', () => hideOverlay('reportOverlay'));
  on(byId('reportOverlay'), 'click', e => {
    if (e.target === byId('reportOverlay')) hideOverlay('reportOverlay');
  });
  on(byId('reportOverlay'), 'keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideOverlay('reportOverlay');
    } else if (e.key === 'Enter' && !e.target?.closest?.('button, a, select, textarea')) {
      e.preventDefault();
      handleReportGenerate();
    }
  });

  // Ensure clicking anywhere inside a radio format card selects its radio button
  const rptOverlayEl = byId('reportOverlay');
  if (rptOverlayEl) {
    rptOverlayEl.querySelectorAll('label').forEach(lbl => {
      const radio = lbl.querySelector('input[type="radio"]');
      if (radio) {
        on(lbl, 'click', (e) => {
          if (e.target !== radio) radio.checked = true;
        });
      }
    });
  }

  /* ==========================================================================
     2F. CUSTOM THEME STUDIO MODAL (`#themeEditorOverlay`)
     ========================================================================== */
  let activeThemeSeedId = null;

  function updatePresetBarActiveState(selectedId) {
    activeThemeSeedId = selectedId || null;
    const bar = byId('tePresetBar');
    if (!bar) return;
    bar.querySelectorAll('.te-preset-btn').forEach(btn => {
      const isAct = btn.dataset.presetId === activeThemeSeedId;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-pressed', isAct ? 'true' : 'false');
    });
  }

  function seedCustomThemeFromPreset(presetId) {
    const preset = THEME_PRESETS?.[presetId];
    if (!preset) return;
    const ctPatch = _modPresetToCustomTheme(preset);
    if (_modState(store).theme !== 'custom') {
      store?.setTheme?.('custom');
      const selT = byId('selTheme');
      if (selT) selT.value = 'custom';
    }
    store?.updateCustomTheme?.(ctPatch);

    const axPatch = { ...DEFAULT_AXIS_STYLE, ...(preset.axisStyle || {}) };
    const trPatch = { ...DEFAULT_TREND_STYLE, ...(preset.trendStyle || {}) };
    if (typeof store?.setAxisStyle === 'function') {
      store.setAxisStyle(axPatch);
    } else if (store?.state) {
      store.state.axisStyle = axPatch;
    }
    if (typeof store?.setTrendStyle === 'function') {
      store.setTrendStyle(trPatch);
    } else if (store?.state) {
      store.state.trendStyle = trPatch;
    }
    if (Number.isFinite(ctPatch.lblPx) && typeof store?.setGrid === 'function') {
      store.setGrid({ labelPx: ctPatch.lblPx });
    }

    populateThemeEditor();
    updatePresetBarActiveState(presetId);
    _modRedraw(store, baseRenderer, overlayRenderer, true);
    notifyToast(`Loaded ${preset.name} base into Custom Studio`, 'info');
  }

  function populateThemePresetBar() {
    const bar = byId('tePresetBar');
    if (!bar) return;
    bar.innerHTML = '';
    for (const th of _MOD_THEMES) {
      const preset = THEME_PRESETS?.[th.id];
      if (!preset) continue;
      const bgSwatch = _modNormHex(preset.plotBg || preset.bg, '#0f1520');
      const fgSwatch = _modNormHex(th.swatchAccent || preset.sat, '#22d3ee');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'te-preset-btn';
      btn.dataset.presetId = th.id;
      btn.setAttribute('aria-pressed', 'false');
      btn.title = `Seed colors, dash patterns, axis & trend styles from ${preset.name}`;
      btn.innerHTML =
        `<span class="te-preset-swatch" aria-hidden="true">` +
        `<span style="background:${esc(bgSwatch)}"></span>` +
        `<span style="background:${esc(fgSwatch)}"></span>` +
        `</span>` +
        `<span>${esc(th.shortName || preset.shortName || preset.name)}</span>`;
      on(btn, 'click', () => seedCustomThemeFromPreset(th.id));
      bar.appendChild(btn);
    }
  }

  function populateThemeEditor() {
    const st = _modState(store);
    const ct = { ...DEFAULT_CUSTOM_THEME, ...(st.customTheme || {}) };
    if (Number.isFinite(st.grid?.labelPx)) {
      ct.lblPx = st.grid.labelPx;
    }
    for (const key of Object.keys(DEFAULT_CUSTOM_THEME)) {
      const inp = byId(`ct_${key}`);
      if (!inp) continue;
      if (inp.type === 'color') {
        inp.value = _modNormHex(ct[key], DEFAULT_CUSTOM_THEME[key]);
      } else {
        inp.value = String(ct[key] ?? DEFAULT_CUSTOM_THEME[key]);
      }
    }
  }

  function readThemeEditor() {
    const patch = {};
    for (const [key, defVal] of Object.entries(DEFAULT_CUSTOM_THEME)) {
      const inp = byId(`ct_${key}`);
      if (!inp) continue;
      if (typeof defVal === 'number') {
        const n = parseFloat(inp.value);
        patch[key] = Number.isFinite(n) ? n : defVal;
      } else {
        patch[key] = inp.value;
      }
    }
    return patch;
  }

  function livePreviewCustomTheme() {
    const patch = readThemeEditor();
    if (_modState(store).theme !== 'custom') {
      store?.setTheme?.('custom');
      const selT = byId('selTheme');
      if (selT) selT.value = 'custom';
    }
    store?.updateCustomTheme?.(patch);
    if (Number.isFinite(patch.lblPx) && typeof store?.setGrid === 'function') {
      store.setGrid({ labelPx: patch.lblPx });
    }
    _modRedraw(store, baseRenderer, overlayRenderer, true);
  }

  function openThemeEditor() {
    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    const st = _modState(store);
    themeSnapshot = {
      theme: st.theme || 'studio-dark',
      customTheme: { ...DEFAULT_CUSTOM_THEME, ...(st.customTheme || {}) },
      axisStyle: { ...DEFAULT_AXIS_STYLE, ...(st.axisStyle || {}) },
      trendStyle: { ...DEFAULT_TREND_STYLE, ...(st.trendStyle || {}) },
      labelPx: Number.isFinite(st.grid?.labelPx) ? st.grid.labelPx : 11
    };
    populateThemeEditor();
    updatePresetBarActiveState(st.theme !== 'custom' ? st.theme : activeThemeSeedId);
    showOverlay('themeEditorOverlay');
  }

  function applyCustomTheme() {
    themeSnapshot = null; // Commit — do not revert on close
    livePreviewCustomTheme();
    notifyToast('Custom theme applied', 'success');
    hideOverlay('themeEditorOverlay');
  }

  function cancelThemeEditor() {
    revertThemeSnapshotIfOpen();
    hideOverlay('themeEditorOverlay');
  }

  function resetCustomThemeDefaults() {
    store?.resetCustomTheme?.();
    if (_modState(store).theme !== 'custom') {
      store?.setTheme?.('custom');
      const selT = byId('selTheme');
      if (selT) selT.value = 'custom';
    }
    if (typeof store?.setAxisStyle === 'function') {
      store.setAxisStyle({ ...DEFAULT_AXIS_STYLE });
    }
    if (typeof store?.setTrendStyle === 'function') {
      store.setTrendStyle({ ...DEFAULT_TREND_STYLE });
    }
    if (typeof store?.setGrid === 'function') {
      store.setGrid({ labelPx: DEFAULT_CUSTOM_THEME.lblPx });
    }
    populateThemeEditor();
    updatePresetBarActiveState('studio-dark');
    _modRedraw(store, baseRenderer, overlayRenderer, true);
    notifyToast('Custom theme reset to defaults', 'info');
  }

  populateThemePresetBar();
  const themeOverlayEl = byId('themeEditorOverlay');
  if (themeOverlayEl) {
    themeOverlayEl.querySelectorAll('input, select').forEach(ctrl => {
      on(ctrl, 'input', livePreviewCustomTheme);
      on(ctrl, 'change', livePreviewCustomTheme);
    });
  }
  on(byId('ctApply'), 'click', applyCustomTheme);
  on(byId('ctResetDefault'), 'click', resetCustomThemeDefaults);
  on(byId('closeThemeEditor'), 'click', cancelThemeEditor);
  on(themeOverlayEl, 'click', e => {
    if (e.target === themeOverlayEl) cancelThemeEditor();
  });
  on(themeOverlayEl, 'keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelThemeEditor();
    }
  });

  /* ==========================================================================
     2G. GLOSSARY, SHORTCUTS & ABOUT MODALS
     ========================================================================== */
  function openGlossary() {
    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    showOverlay('glossaryOverlay');
  }

  function openShortcuts() {
    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    showOverlay('shortcutsOverlay');
  }

  function openAbout() {
    if (!activeModalId && typeof document !== 'undefined') {
      prevFocusEl = document.activeElement;
    }
    closeAllModals(false);
    const aboutEl = byId('aboutOverlay');
    if (aboutEl) {
      aboutEl.querySelectorAll('[data-app-version], .about-version').forEach(node => {
        node.textContent = `v${APP_VERSION}`;
      });
    }
    showOverlay('aboutOverlay');
  }

  [
    ['glossaryOverlay', 'closeGlossary'],
    ['shortcutsOverlay', 'closeShortcuts'],
    ['aboutOverlay', 'closeAbout']
  ].forEach(([overlayId, closeBtnId]) => {
    const ov = byId(overlayId);
    on(byId(closeBtnId), 'click', () => hideOverlay(overlayId));
    on(ov, 'click', e => {
      if (e.target === ov) hideOverlay(overlayId);
    });
    on(ov, 'keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hideOverlay(overlayId);
      }
    });
  });

  /* ==========================================================================
     2H. Global Keyboard Shortcuts (Ctrl+K Toggle, Tab Focus Trap & Escape)
     ========================================================================== */
  if (typeof window !== 'undefined') {
    on(window, 'keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      const key = (e.key || '').toLowerCase();

      if (mod && key === 'k') {
        e.preventDefault();
        if (byId('cmdPaletteOverlay')?.classList.contains('visible')) {
          hideOverlay('cmdPaletteOverlay');
        } else {
          openCmdPalette();
        }
        return;
      }

      if (e.key === 'Escape' && isAnyModalOpen()) {
        e.preventDefault();
        closeAllModals(true);
        return;
      }

      if (e.key === 'Tab' && isAnyModalOpen()) {
        const ov = (activeModalId && byId(activeModalId)?.classList.contains('visible'))
          ? byId(activeModalId)
          : document.querySelector('.modal-overlay.visible');
        if (!ov) return;
        const focusables = getModalFocusables(ov);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !ov.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !ov.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  return {
    openCmdPalette,
    openEditPoint,
    openAddPointParam,
    openMixFlow,
    openReport,
    openThemeEditor,
    openGlossary,
    openShortcuts,
    openAbout,
    closeAllModals,
    loadPresetById
  };
}
