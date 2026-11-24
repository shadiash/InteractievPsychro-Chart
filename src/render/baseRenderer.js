/* ============================================================================
   PsychroChart Ultra 3.0 — High-Performance Cached Base Chart Canvas Renderer
   Strict internal SI coordinates: T (°C), w (kg/kg), pPa (Pa).
   Display conversions to IP (°F, gr/lb, Btu/lb 0°F datum, ft³/lb) occur ONLY
   at the rendering/tick-labeling boundary.
   ============================================================================ */

import { CoreDOM } from '../core/contracts.js';
import { Psy } from '../engine/psychro.js';
import { Comfort } from '../engine/comfort.js';

const _BR_V_IP_PER_SI = (Psy.FT3_PER_M3 || 35.3146667215) / (Psy.LB_PER_KG || 2.20462262185);
const _BR_INHG_PER_KPA = 0.29529983071445; // 1 kPa = 0.2952998 in.Hg
const _BR_FONT_MONO = '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const _BR_FONT_SANS = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const _BR_DEFAULT_AXIS_STYLE = Object.freeze({
  frame: 'full-box',
  tickDir: 'out',
  yAxisSide: 'both',
  showSubTicks: true,
  showDualPvScale: false,
  enthalpyRulerStyle: 'ashrae-rail',
  curveLabelStyle: 'tangent-inline',
  gridClipping: 'below-sat'
});

// Thermal density color stops: cool cyan -> emerald -> amber -> crimson
const _BR_HEAT_STOPS = [
  { t: 0.00, r: 6,   g: 182, b: 212 }, // #06b6d4 cool cyan
  { t: 0.35, r: 16,  g: 185, b: 129 }, // #10b981 emerald
  { t: 0.70, r: 245, g: 158, b: 11  }, // #f59e0b amber
  { t: 1.00, r: 225, g: 29,  b: 72  }  // #e11d48 crimson
];

function _BR_heatColor(norm, alpha) {
  const t = CoreDOM.clamp(norm, 0, 1);
  let s0 = _BR_HEAT_STOPS[0];
  let s1 = _BR_HEAT_STOPS[_BR_HEAT_STOPS.length - 1];
  for (let i = 0; i < _BR_HEAT_STOPS.length - 1; i++) {
    if (t >= _BR_HEAT_STOPS[i].t && t <= _BR_HEAT_STOPS[i + 1].t) {
      s0 = _BR_HEAT_STOPS[i];
      s1 = _BR_HEAT_STOPS[i + 1];
      break;
    }
  }
  const frac = (s1.t - s0.t) > 1e-6 ? (t - s0.t) / (s1.t - s0.t) : 0;
  const r = Math.round(s0.r + (s1.r - s0.r) * frac);
  const g = Math.round(s0.g + (s1.g - s0.g) * frac);
  const b = Math.round(s0.b + (s1.b - s0.b) * frac);
  return `rgba(${r},${g},${b},${CoreDOM.clamp(alpha, 0, 1).toFixed(3)})`;
}

function _BR_crisp(v) {
  return Math.round(v) + 0.5;
}

function _BR_isDarkColor(colorStr) {
  if (!colorStr || typeof colorStr !== 'string') return true;
  const s = colorStr.trim();
  let r = 15, g = 21, b = 32;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else {
    const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) {
      r = parseFloat(m[1]);
      g = parseFloat(m[2]);
      b = parseFloat(m[3]);
    }
  }
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.45;
}

function _BR_setDash(ctx, style, dpi) {
  if (style === 'dashed') ctx.setLineDash([5.5 * dpi, 3.8 * dpi]);
  else if (style === 'dotted') ctx.setLineDash([2 * dpi, 3 * dpi]);
  else if (style === 'dashdot') ctx.setLineDash([7 * dpi, 3 * dpi, 1.5 * dpi, 3 * dpi]);
  else ctx.setLineDash([]);
}

function _BR_niceStep(span, targetTicks = 8) {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, targetTicks);
  const exp = Math.floor(Math.log10(raw));
  const mag = Math.pow(10, exp);
  const norm = raw / mag;

  if (norm <= 1.4) return 1 * mag;
  if (norm <= 2.3) return 2 * mag;
  if (exp >= 1 && norm <= 3.5) return 2.5 * mag; // clean 25, 250, 2500 intervals
  if (norm <= 7.0) return 5 * mag;
  return 10 * mag;
}

function _BR_minorStep(major) {
  if (!Number.isFinite(major) || major <= 0) return 1;
  const exp = Math.floor(Math.log10(major));
  const mag = Math.pow(10, exp);
  const norm = Math.round((major / mag) * 10) / 10;
  if (norm === 2) return major / 4; // 2 -> 0.5, 20 -> 5, 200 -> 50
  return major / 5;                 // 1 -> 0.2, 2.5 -> 0.5, 5 -> 1, 25 -> 5, 10 -> 2
}

function _BR_fmtTick(val, step) {
  if (!Number.isFinite(val)) return '';
  const clean = Math.abs(val) < 1e-9 ? 0 : val;
  if (step >= 1 && Math.abs(clean - Math.round(clean)) < 1e-6) {
    return String(Math.round(clean));
  }
  const dec = step >= 1 ? 0 : Math.min(3, Math.max(1, Math.ceil(-Math.log10(step) - 1e-9)));
  return Number(clean.toFixed(dec)).toString();
}

function _BR_polyCentroid(poly) {
  if (!poly || !poly.length) return [0, 0];
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % n];
    const x0 = Array.isArray(p0) ? p0[0] : p0.T;
    const y0 = Array.isArray(p0) ? p0[1] : p0.w;
    const x1 = Array.isArray(p1) ? p1[0] : p1.T;
    const y1 = Array.isArray(p1) ? p1[1] : p1.w;
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area2) > 1e-12) {
    return [cx / (3 * area2), cy / (3 * area2)];
  }
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    sx += Array.isArray(p) ? p[0] : p.T;
    sy += Array.isArray(p) ? p[1] : p.w;
  }
  return [sx / n, sy / n];
}

function _BR_polyBounds(poly) {
  let minT = Infinity, maxT = -Infinity, minW = Infinity, maxW = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const T = Array.isArray(p) ? p[0] : p.T;
    const w = Array.isArray(p) ? p[1] : p.w;
    if (T < minT) minT = T;
    if (T > maxT) maxT = T;
    if (w < minW) minW = w;
    if (w > maxW) maxW = w;
  }
  return { minT, maxT, minW, maxW };
}

/**
 * Liang-Barsky exact line segment clipper against [left, right] x [top, bottom].
 * Returns { x1, y1, x2, y2 } or null if completely outside.
 */
function _BR_clipSegmentToRect(x1, y1, x2, y2, left, top, right, bottom) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - left, right - x1, y1 - top, bottom - y1];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t0 > t1) return null;
  return {
    x1: x1 + t0 * dx,
    y1: y1 + t0 * dy,
    x2: x1 + t1 * dx,
    y2: y1 + t1 * dy
  };
}

function _BR_rectsOverlap(a, b, pad = 0) {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function _BR_roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function _BR_intersectLines(x1, y1, dx1, dy1, x2, y2, dx2, dy2) {
  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / det;
  const ix = x1 + t * dx1;
  const iy = y1 + t * dy1;
  if (!Number.isFinite(ix) || !Number.isFinite(iy)) return null;
  return [ix, iy];
}

function _BR_tickSpan(axisPos, outSign, len, dir) {
  if (dir === 'in') return [axisPos - outSign * len, axisPos];
  if (dir === 'cross') {
    const half = len * 0.55;
    return [axisPos - outSign * half, axisPos + outSign * half];
  }
  return [axisPos, axisPos + outSign * len];
}

export class BaseRenderer {
  constructor(canvas = null) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.width = 0;
    this.height = 0;
    this.dpi = 1;
    this.padL = 44;
    this.padR = 66;
    this.padT = 34;
    this.padB = 46;
    this._lastFingerprint = '';
    this._lastState = null;
    this._zoneLabelRects = [];
  }

  static niceStep(span, targetTicks = 8) {
    return _BR_niceStep(span, targetTicks);
  }

  niceStep(span, targetTicks = 8) {
    return _BR_niceStep(span, targetTicks);
  }

  /* ---- Coordinate Mapping (STRICTLY SI internally) ---- */
  xc(T_C) {
    const view = this._lastState?.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const span = (view.tMax - view.tMin) || 1;
    const plotW = Math.max(1, this.width - this.padL - this.padR);
    return this.padL + ((T_C - view.tMin) / span) * plotW;
  }

  yc(w_kgkg) {
    const view = this._lastState?.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const wMax = view.wMax || 0.030;
    const plotH = Math.max(1, this.height - this.padT - this.padB);
    return (this.height - this.padB) - (w_kgkg / wMax) * plotH;
  }

  invT(px) {
    const view = this._lastState?.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const plotW = Math.max(1, this.width - this.padL - this.padR);
    return view.tMin + ((px - this.padL) / plotW) * (view.tMax - view.tMin);
  }

  invW(py) {
    const view = this._lastState?.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const wMax = view.wMax || 0.030;
    const plotH = Math.max(1, this.height - this.padT - this.padB);
    return (((this.height - this.padB) - py) / plotH) * wMax;
  }

  getPlotRect() {
    return {
      x: this.padL,
      y: this.padT,
      w: Math.max(1, this.width - this.padL - this.padR),
      h: Math.max(1, this.height - this.padT - this.padB)
    };
  }

  invalidate() {
    this._lastFingerprint = '';
  }

  /* ---- Layout, Axis Style Resolution & Caching ---- */
  _resolveAxisStyle(state, pal = null) {
    const resolvedPal = pal || CoreDOM.resolveThemePalette(state?.theme || 'studio-dark', state?.customTheme);
    const merged = { ..._BR_DEFAULT_AXIS_STYLE };
    const palAx = resolvedPal?.axisStyle;
    if (palAx && typeof palAx === 'object') {
      for (const k of Object.keys(_BR_DEFAULT_AXIS_STYLE)) {
        if (palAx[k] !== undefined && palAx[k] !== null && palAx[k] !== 'auto' && palAx[k] !== 'theme') {
          merged[k] = palAx[k];
        }
      }
    }
    const stAx = state?.axisStyle;
    if (stAx && typeof stAx === 'object') {
      for (const k of Object.keys(_BR_DEFAULT_AXIS_STYLE)) {
        if (stAx[k] !== undefined && stAx[k] !== null && stAx[k] !== 'auto' && stAx[k] !== 'theme') {
          merged[k] = stAx[k];
        }
      }
    }
    return merged;
  }

  _computePadding(W, H, dpi, state, includeTitle = false) {
    const isIP = state?.units === 'IP';
    const ax = this._resolveAxisStyle(state);
    const rawL = Math.round((isIP ? 42 : 40) * dpi);
    const pvExtra = ax.showDualPvScale ? 28 : 0;
    const rawR = Math.round(((isIP ? 74 : 68) + pvExtra) * dpi);
    const rawT = Math.round((includeTitle ? 76 : 46) * dpi);
    const rawB = Math.round(46 * dpi);

    this.padL = Math.min(rawL, Math.floor(W * 0.16));
    this.padR = Math.min(rawR, Math.floor(W * (ax.showDualPvScale ? 0.28 : 0.22)));
    this.padT = Math.min(rawT, Math.floor(H * 0.22));
    this.padB = Math.min(rawB, Math.floor(H * 0.20));
  }

  _computeFingerprint(W, H, dpi, state) {
    const l = state.layers || {};
    const w = state.weather || {};
    const ax = this._resolveAxisStyle(state);
    const bins = w.bins || null;
    const weatherToken = bins
      ? (bins.totalHours || bins.maxBinCount || bins.maxCount || bins.maxBin || (Array.isArray(bins.bins2D) ? bins.bins2D.length : 1))
      : 0;
    const recordsLen = Array.isArray(w.records)
      ? w.records.length
      : (Array.isArray(w.hourly)
          ? w.hourly.length
          : (Array.isArray(w.points) ? w.points.length : (Array.isArray(w.data) ? w.data.length : 0)));

    return JSON.stringify([
      W, H, dpi,
      state.theme,
      state.units,
      state.pPa,
      state.view,
      state.grid,
      {
        frame: ax.frame,
        tickDir: ax.tickDir,
        yAxisSide: ax.yAxisSide,
        showSubTicks: !!ax.showSubTicks,
        showDualPvScale: !!ax.showDualPvScale,
        enthalpyRulerStyle: ax.enthalpyRulerStyle,
        curveLabelStyle: ax.curveLabelStyle,
        gridClipping: ax.gridClipping
      },
      {
        grid: !!l.grid,
        gridMinor: !!l.gridMinor,
        sat: !!l.sat,
        rh: !!l.rh,
        wb: !!l.wb,
        enth: !!l.enth,
        vlines: !!l.vlines,
        dp: !!l.dp,
        comfort: !!l.comfort,
        givoni: !!l.givoni,
        datacenter: !!l.datacenter,
        weather: !!l.weather
      },
      state.comfort,
      w.sourceName || '',
      w.mode || 'heatmap',
      w.opacity ?? 0.65,
      weatherToken,
      recordsLen,
      state.theme === 'custom' ? state.customTheme : null
    ]);
  }

  resize() {
    if (!this.canvas) return false;
    const container = this.canvas.parentElement || this.canvas;
    const rect = typeof container.getBoundingClientRect === 'function'
      ? container.getBoundingClientRect()
      : { width: this.canvas.clientWidth || 800, height: this.canvas.clientHeight || 500 };

    const cssW = Math.max(120, Math.round(rect.width || this.canvas.clientWidth || 800));
    const cssH = Math.max(100, Math.round(rect.height || this.canvas.clientHeight || 500));
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const dpi = Math.min(dpr, 2);
    const W = Math.round(cssW * dpi);
    const H = Math.round(cssH * dpi);

    const resized = (this.canvas.width !== W || this.canvas.height !== H);
    if (resized) {
      this.canvas.width = W;
      this.canvas.height = H;
      if (this.canvas.style) {
        this.canvas.style.width = `${cssW}px`;
        this.canvas.style.height = `${cssH}px`;
      }
      this._lastFingerprint = '';
    }
    this.width = W;
    this.height = H;
    this.dpi = dpi;
    if (this._lastState) {
      this._computePadding(W, H, dpi, this._lastState, false);
    }
    return resized;
  }

  render(state, force = false) {
    const st = state || this._lastState;
    if (!this.canvas || !this.ctx || !st) return false;

    const resized = this.resize();
    const W = this.width;
    const H = this.height;
    const dpi = this.dpi;

    const fp = this._computeFingerprint(W, H, dpi, st);
    this._lastState = st;
    this._computePadding(W, H, dpi, st, false);

    if (!force && !resized && fp === this._lastFingerprint) {
      return false;
    }

    this._lastFingerprint = fp;
    this.renderToContext(this.ctx, W, H, dpi, st, { includeTitle: false, isExport: false });
    return true;
  }

  renderToContext(ctx, W, H, dpi, state, opts = {}) {
    if (!ctx || !state) return;

    const saved = opts.isExport ? {
      width: this.width,
      height: this.height,
      dpi: this.dpi,
      padL: this.padL,
      padR: this.padR,
      padT: this.padT,
      padB: this.padB,
      _lastState: this._lastState,
      _zoneLabelRects: this._zoneLabelRects
    } : null;

    try {
      this._zoneLabelRects = [];
      this.width = W;
      this.height = H;
      this.dpi = dpi || 1;
      this._lastState = state;
      this._computePadding(W, H, this.dpi, state, !!opts.includeTitle);
      this._renderAllLayers(ctx, W, H, this.dpi, state, opts);
    } finally {
      if (saved) {
        this.width = saved.width;
        this.height = saved.height;
        this.dpi = saved.dpi;
        this.padL = saved.padL;
        this.padR = saved.padR;
        this.padT = saved.padT;
        this.padB = saved.padB;
        this._lastState = saved._lastState;
        this._zoneLabelRects = saved._zoneLabelRects;
      }
    }
  }

  /* ---- Master Render Pipeline ---- */
  _renderAllLayers(ctx, W, H, dpi, state, opts) {
    const pal = CoreDOM.resolveThemePalette(state.theme || 'studio-dark', state.customTheme);
    const ax = this._resolveAxisStyle(state, pal);
    const layers = state.layers || {};
    const grid = state.grid || {};
    const isDark = _BR_isDarkColor(pal.plotBg || pal.bg);
    const rect = this.getPlotRect();
    const ticks = this._computeTicks(state, rect.w, rect.h, dpi);
    const satData = this._buildSaturationData(state);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 1. Outer background + subtle plot area surface
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = pal.plotBg || pal.bg;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    // 2. Clipped plot area layers
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();

    // 2a. Adaptive Minor & Major Grid
    this._drawGrid(ctx, ticks, pal, layers, dpi, 1.0);

    // 2b. 8,760-hr Weather Overlay (heatmap / scatter)
    if (layers.weather && state.weather && (state.weather.bins || state.weather.records?.length || state.weather.hourly?.length || state.weather.points?.length || state.weather.data?.length)) {
      this._drawWeather(ctx, state, dpi, isDark);
    }

    // 2c. Givoni Bioclimatic Zones
    if (layers.givoni) {
      this._drawGivoni(ctx, state, pal, dpi, isDark);
    }

    // 2d. ASHRAE TC 9.9 Data Center Envelopes
    if (layers.datacenter) {
      this._drawDataCenter(ctx, state, pal, dpi, isDark);
    }

    // 2e. ASHRAE 55 Dynamic PMV Comfort Zones
    if (layers.comfort && state.comfort && state.comfort.mode !== 'none') {
      this._drawComfortZones(ctx, state, pal, dpi, isDark);
    }

    // 2f. Dew-Point Horizontal Lines
    if (layers.dp) {
      this._drawDewPointLines(ctx, state, pal, dpi);
    }

    // 2g. Specific Volume Lines
    if (layers.vlines) {
      this._drawVolumeLines(ctx, state, pal, dpi, ax);
    }

    // 2h. Constant-Enthalpy Lines
    let enthMeta = null;
    if (layers.enth) {
      enthMeta = this._drawEnthalpyLines(ctx, state, pal, dpi);
    }

    // 2i. True Thermodynamic Wet-Bulb Lines
    if (layers.wb) {
      this._drawWetBulbLines(ctx, state, pal, dpi, ax);
    }

    // 2j. Relative Humidity Contours
    if (layers.rh) {
      this._drawRHLines(ctx, state, pal, dpi, ax);
    }

    // 2k. Supersaturated upper-left mask (or full-plot subtle CAD grid) + Bold 100% RH Saturation Curve
    this._drawSaturationMaskAndCurve(ctx, satData, pal, layers, dpi, ax, ticks);

    // 3. ASHRAE / Carrier / Minimal Enthalpy Scale Ruler
    if (layers.enth && grid.showEnthalpyRuler !== false && enthMeta) {
      this._drawEnthalpyRuler(ctx, satData, enthMeta, state, pal, dpi, ax);
    }

    ctx.restore(); // end plot clip

    // 4. Crisp Axes, Tick Marks, Sub-Ticks, Dual Pv Scale, Labels & Optional Export Header
    this._drawAxesAndTicks(ctx, ticks, state, pal, dpi, opts, ax);

    // 5. Crisp Plot Frame Border (ashrae-open | full-box | cad-ticks)
    this._drawPlotFrame(ctx, state, pal, dpi, ax);

    ctx.restore();
  }

  /* ---- Adaptive Clean Ticks (SI & IP) ---- */
  _computeTicks(state, plotW, plotH, dpi) {
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const isSI = state.units !== 'IP';

    const targetX = CoreDOM.clamp(Math.round(plotW / (72 * dpi)), 4, 14);
    const targetY = CoreDOM.clamp(Math.round(plotH / (54 * dpi)), 4, 10);

    // X-axis (Dry-Bulb Temperature)
    const tDispMin = isSI ? view.tMin : CoreDOM.cToF(view.tMin);
    const tDispMax = isSI ? view.tMax : CoreDOM.cToF(view.tMax);
    const tSpan = Math.max(0.1, tDispMax - tDispMin);
    const tMajorStep = _BR_niceStep(tSpan, targetX);
    const tMinorStep = _BR_minorStep(tMajorStep);

    const tMajor = [];
    const tMinor = [];
    const tStartMaj = Math.ceil((tDispMin - 1e-9) / tMajorStep) * tMajorStep;
    for (let v = tStartMaj; v <= tDispMax + tMajorStep * 1e-4; v += tMajorStep) {
      const cleanV = Math.round(v / tMajorStep) * tMajorStep;
      const tC = isSI ? cleanV : CoreDOM.fToC(cleanV);
      tMajor.push({ disp: cleanV, si: tC, px: this.xc(tC), label: _BR_fmtTick(cleanV, tMajorStep) });
    }
    const tStartMin = Math.ceil((tDispMin - 1e-9) / tMinorStep) * tMinorStep;
    for (let v = tStartMin; v <= tDispMax + tMinorStep * 1e-4; v += tMinorStep) {
      const rem = Math.abs(v / tMajorStep - Math.round(v / tMajorStep));
      if (rem < 1e-4) continue;
      const tC = isSI ? v : CoreDOM.fToC(v);
      tMinor.push({ disp: v, si: tC, px: this.xc(tC) });
    }

    // Y-axis (Humidity Ratio)
    const wMult = isSI ? 1000 : (Psy.GRAINS_PER_LB || 7000);
    const wDispMax = Math.max(1e-4, view.wMax * wMult);
    const wMajorStep = _BR_niceStep(wDispMax, targetY);
    const wMinorStep = _BR_minorStep(wMajorStep);

    const wMajor = [];
    const wMinor = [];
    for (let v = 0; v <= wDispMax + wMajorStep * 1e-4; v += wMajorStep) {
      const cleanV = Math.round(v / wMajorStep) * wMajorStep;
      const wSI = cleanV / wMult;
      wMajor.push({ disp: cleanV, si: wSI, py: this.yc(wSI), label: _BR_fmtTick(cleanV, wMajorStep) });
    }
    for (let v = wMinorStep; v <= wDispMax + wMinorStep * 1e-4; v += wMinorStep) {
      const rem = Math.abs(v / wMajorStep - Math.round(v / wMajorStep));
      if (rem < 1e-4) continue;
      const wSI = v / wMult;
      wMinor.push({ disp: v, si: wSI, py: this.yc(wSI) });
    }

    return { tMajor, tMinor, wMajor, wMinor, tMajorStep, wMajorStep };
  }

  _stepT(state) {
    const view = state.view || { tMin: -5, tMax: 50 };
    const span = Math.max(1, view.tMax - view.tMin);
    const density = state.grid?.density || 'normal';
    const divs = density === 'fine' ? 240 : (density === 'fast' ? 95 : 160);
    return CoreDOM.clamp(span / divs, 0.05, 0.75);
  }

  /* ---- Typography & Curve Primitives ---- */
  _textHalo(ctx, text, x, y, color, align = 'left', baseline = 'alphabetic', sizePx = 10, dpi = 1, pal = null, weight = '500', family = _BR_FONT_MONO) {
    if (!text) return;
    ctx.save();
    ctx.font = `${weight} ${(sizePx * dpi).toFixed(2)}px ${family}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    const haloW = (pal?.haloW ?? 3) * dpi;
    if (haloW > 0 && pal?.halo) {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = haloW;
      ctx.strokeStyle = pal.halo;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  _drawPillBadge(ctx, text, x, y, color, align = 'center', baseline = 'middle', sizePx = 10, dpi = 1, pal = null, weight = '600', family = _BR_FONT_MONO, borderAlpha = 0.58) {
    if (!text) return;
    ctx.save();
    const fontPx = sizePx * dpi;
    ctx.font = `${weight} ${fontPx.toFixed(2)}px ${family}`;
    const tw = ctx.measureText(text).width;
    const padX = 4.2 * dpi;
    const padY = 2.0 * dpi;
    const pw = tw + padX * 2;
    const ph = fontPx * 1.12 + padY * 2;

    let bx = x;
    if (align === 'center') bx = x - pw * 0.5;
    else if (align === 'right') bx = x - pw;

    let by = y;
    if (baseline === 'middle') by = y - ph * 0.5;
    else if (baseline === 'alphabetic' || baseline === 'bottom') by = y - ph + padY * 0.5;

    const r = Math.min(ph * 0.45, 4.0 * dpi);
    _BR_roundRectPath(ctx, bx, by, pw, ph, r);
    ctx.fillStyle = pal?.plotBg || pal?.bg || '#ffffff';
    ctx.globalAlpha = 0.92;
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.65, 0.8 * dpi);
    ctx.globalAlpha = borderAlpha;
    ctx.setLineDash([]);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + pw * 0.5, by + ph * 0.52);
    ctx.restore();
  }

  _pushZoneLabelRect(ctx, text, x, y, align = 'center', baseline = 'middle', sizePx = 8.5, dpi = 1, weight = '600', family = _BR_FONT_SANS) {
    if (!text) return;
    if (!Array.isArray(this._zoneLabelRects)) this._zoneLabelRects = [];
    ctx.save();
    ctx.font = `${weight} ${(sizePx * dpi).toFixed(2)}px ${family}`;
    const w = ctx.measureText(text).width + 6 * dpi;
    ctx.restore();
    const h = sizePx * 1.45 * dpi;
    let rx = x;
    if (align === 'center') rx = x - w * 0.5;
    else if (align === 'right') rx = x - w;
    let ry = y;
    if (baseline === 'middle') ry = y - h * 0.5;
    else if (baseline === 'bottom' || baseline === 'alphabetic') ry = y - h;
    this._zoneLabelRects.push({ x: rx, y: ry, w, h });
  }

  _plotCurve(ctx, pts, color, lw, alpha, dashStyle, dpi) {
    if (!pts || pts.length < 2) return;
    ctx.save();
    _BR_setDash(ctx, dashStyle || 'solid', dpi);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.4, lw * dpi);
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        if (!drawing) {
          ctx.moveTo(p[0], p[1]);
          drawing = true;
        } else {
          ctx.lineTo(p[0], p[1]);
        }
      } else if (drawing) {
        ctx.stroke();
        ctx.beginPath();
        drawing = false;
      }
    }
    if (drawing) ctx.stroke();
    ctx.restore();
  }

  /* ---- Layer 2a: Adaptive Minor & Major Grid ---- */
  _drawGrid(ctx, ticks, pal, layers, dpi, alphaScale = 1.0) {
    const rect = this.getPlotRect();
    const x0 = rect.x;
    const x1 = rect.x + rect.w;
    const y0 = rect.y;
    const y1 = rect.y + rect.h;

    if (layers.gridMinor !== false && layers.grid !== false) {
      ctx.save();
      _BR_setDash(ctx, pal.ls?.grid || 'solid', dpi);
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = Math.max(0.5, (pal.grid_lw ?? 0.7) * dpi);
      ctx.globalAlpha = 0.85 * alphaScale;
      ctx.beginPath();
      for (let i = 0; i < ticks.tMinor.length; i++) {
        const px = _BR_crisp(ticks.tMinor[i].px);
        if (px <= x0 || px >= x1) continue;
        ctx.moveTo(px, y0);
        ctx.lineTo(px, y1);
      }
      for (let i = 0; i < ticks.wMinor.length; i++) {
        const py = _BR_crisp(ticks.wMinor[i].py);
        if (py <= y0 || py >= y1) continue;
        ctx.moveTo(x0, py);
        ctx.lineTo(x1, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (layers.grid !== false) {
      ctx.save();
      _BR_setDash(ctx, pal.ls?.grid2 || 'solid', dpi);
      ctx.strokeStyle = pal.grid2;
      ctx.lineWidth = Math.max(0.6, (pal.grid2_lw ?? 1.0) * dpi);
      ctx.globalAlpha = 0.95 * alphaScale;
      ctx.beginPath();
      for (let i = 0; i < ticks.tMajor.length; i++) {
        const px = _BR_crisp(ticks.tMajor[i].px);
        if (px <= x0 || px >= x1) continue;
        ctx.moveTo(px, y0);
        ctx.lineTo(px, y1);
      }
      for (let i = 0; i < ticks.wMajor.length; i++) {
        const py = _BR_crisp(ticks.wMajor[i].py);
        if (py <= y0 || py >= y1) continue;
        ctx.moveTo(x0, py);
        ctx.lineTo(x1, py);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---- Layer 2b: 8,760-hr Weather Overlay (Heatmap, Scatter & Both) ---- */
  _drawWeather(ctx, state, dpi, isDark) {
    const weather = state.weather;
    if (!weather) return;
    const mode = weather.mode || 'heatmap';
    const opacity = CoreDOM.clamp(weather.opacity ?? 0.65, 0.05, 1.0);
    const bins = weather.bins || null;
    const rect = this.getPlotRect();
    const wantHeatmap = mode !== 'scatter';
    const wantScatter = mode === 'scatter' || mode === 'both';

    const drawHourlyScatter = (alphaScale = 1) => {
      const hourly = (Array.isArray(weather.records) && weather.records.length > 0)
        ? weather.records
        : (weather.hourly || weather.points || weather.data || bins?.samples || bins?.points || null);
      if (!Array.isArray(hourly) || hourly.length === 0) return false;
      const maxDraw = 2920; // crisp subsampling (~every 3 hrs for 8760)
      const stride = Math.max(1, Math.floor(hourly.length / maxDraw));
      const r = Math.max(1.0, (mode === 'both' ? 1.25 : 1.55) * dpi);
      const baseAlpha = isDark ? 0.62 : 0.56;
      const dotColor = isDark
        ? `rgba(224, 242, 254, ${(opacity * baseAlpha * alphaScale).toFixed(3)})`
        : `rgba(2, 132, 199, ${(opacity * baseAlpha * alphaScale).toFixed(3)})`;
      ctx.save();
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      for (let i = 0; i < hourly.length; i += stride) {
        const rec = hourly[i];
        if (!rec) continue;
        const T = Array.isArray(rec) ? rec[0] : (rec.T ?? rec.Tdb ?? rec.t);
        const w = Array.isArray(rec) ? rec[1] : (rec.w ?? rec.W);
        if (!Number.isFinite(T) || !Number.isFinite(w) || w < 0) continue;
        const px = this.xc(T);
        const py = this.yc(w);
        if (px < rect.x - 4 || px > rect.x + rect.w + 4 || py < rect.y - 4 || py > rect.y + rect.h + 4) continue;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
      return true;
    };

    if (mode === 'scatter' && drawHourlyScatter(1)) {
      return;
    }

    const b2d = bins ? (bins.bins2D || bins.grid || bins.cells || null) : null;
    if (b2d && (wantHeatmap || mode === 'scatter')) {
      ctx.save();

      // Case A: 2D matrix bins2D[iT][iW]
      if (Array.isArray(b2d) && b2d.length > 0 && (Array.isArray(b2d[0]) || ArrayBuffer.isView(b2d[0]))) {
        const nT = b2d.length;
        const nW = b2d[0].length || 0;
        const tMinB = bins.tRange ? bins.tRange[0] : (bins.tMin ?? -30);
        const tStep = bins.dT ?? bins.tStep ?? ((bins.tMax !== undefined ? (bins.tMax - tMinB) / Math.max(1, nT) : 1));
        const wMinB = bins.wRange ? bins.wRange[0] : (bins.wMin ?? 0);
        const wStep = bins.dW ?? bins.wStep ?? ((bins.wMax !== undefined ? (bins.wMax - wMinB) / Math.max(1, nW) : 0.0005));

        let maxC = bins.maxBinCount || bins.maxBin || bins.maxCount || bins.maxHours || 0;
        if (maxC <= 0) {
          for (let i = 0; i < nT; i++) {
            const row = b2d[i];
            for (let j = 0; j < row.length; j++) {
              if (row[j] > maxC) maxC = row[j];
            }
          }
        }
        if (maxC > 0) {
          for (let i = 0; i < nT; i++) {
            const row = b2d[i];
            const t0 = tMinB + i * tStep;
            const t1 = t0 + tStep;
            const x0 = this.xc(t0);
            const x1 = this.xc(t1);
            if (x1 < rect.x || x0 > rect.x + rect.w) continue;
            const cw = Math.max(1, x1 - x0) + 0.6;

            for (let j = 0; j < row.length; j++) {
              const cnt = row[j];
              if (!cnt || cnt <= 0) continue;
              const w0 = wMinB + j * wStep;
              const w1 = w0 + wStep;
              const yTop = this.yc(w1);
              const yBot = this.yc(w0);
              if (yBot < rect.y || yTop > rect.y + rect.h) continue;
              const ch = Math.max(1, yBot - yTop) + 0.6;
              const norm = Math.pow(cnt / maxC, 0.52);
              const cellAlpha = opacity * (0.20 + 0.72 * norm);
              ctx.fillStyle = _BR_heatColor(norm, cellAlpha);
              if (mode === 'scatter') {
                const rad = Math.max(1.5 * dpi, Math.min(cw, ch) * (0.28 + 0.35 * norm));
                ctx.beginPath();
                ctx.arc((x0 + x1) * 0.5, (yTop + yBot) * 0.5, rad, 0, Math.PI * 2);
                ctx.fill();
              } else {
                ctx.fillRect(x0 - 0.3, yTop - 0.3, cw, ch);
              }
            }
          }
        }
      }
      // Case B: Flat array of bin objects { T, w, count, norm } (Weather.computePsychroBins format)
      else if (Array.isArray(b2d) && b2d.length > 0 && typeof b2d[0] === 'object') {
        const defDT = bins.dT ?? bins.tStep ?? 1.0;
        const defDW = bins.dW ?? bins.wStep ?? 0.0005;
        let maxC = bins.maxBinCount || bins.maxBin || bins.maxCount || bins.maxHours || 0;
        if (maxC <= 0) {
          for (let i = 0; i < b2d.length; i++) {
            const c = b2d[i].count ?? b2d[i].hours ?? b2d[i].value ?? 0;
            if (c > maxC) maxC = c;
          }
        }
        if (maxC > 0) {
          for (let i = 0; i < b2d.length; i++) {
            const cell = b2d[i];
            const cnt = cell.count ?? cell.hours ?? cell.value ?? 0;
            if (cnt <= 0) continue;
            const dT = cell.dT ?? cell.tStep ?? defDT;
            const dW = cell.dW ?? cell.wStep ?? defDW;
            const t0 = cell.t0 !== undefined ? cell.t0 : ((cell.T ?? cell.Tdb ?? 0) - dT * 0.5);
            const t1 = cell.t1 !== undefined ? cell.t1 : (t0 + dT);
            const w0 = cell.w0 !== undefined ? cell.w0 : Math.max(0, (cell.w ?? 0) - dW * 0.5);
            const w1 = cell.w1 !== undefined ? cell.w1 : (w0 + dW);

            const x0 = this.xc(t0);
            const x1 = this.xc(t1);
            const yTop = this.yc(w1);
            const yBot = this.yc(w0);
            if (x1 < rect.x || x0 > rect.x + rect.w || yBot < rect.y || yTop > rect.y + rect.h) continue;

            const rawNorm = Number.isFinite(cell.norm) ? cell.norm : (cnt / maxC);
            const norm = Math.pow(CoreDOM.clamp(rawNorm, 0, 1), 0.52);
            const cellAlpha = opacity * (0.20 + 0.72 * norm);
            ctx.fillStyle = _BR_heatColor(norm, cellAlpha);
            if (mode === 'scatter') {
              const rad = Math.max(1.5 * dpi, Math.min(Math.abs(x1 - x0), Math.abs(yBot - yTop)) * (0.28 + 0.35 * norm));
              ctx.beginPath();
              ctx.arc((x0 + x1) * 0.5, (yTop + yBot) * 0.5, rad, 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.fillRect(x0 - 0.3, yTop - 0.3, Math.max(1, x1 - x0) + 0.6, Math.max(1, yBot - yTop) + 0.6);
            }
          }
        }
      }

      ctx.restore();
    }

    if (wantScatter && mode === 'both') {
      drawHourlyScatter(0.75);
    }
  }

  /* ---- Polygon Helper with Optional Subtle Hatch ---- */
  _tracePolyPath(ctx, poly, pPa) {
    if (!poly || poly.length < 3) return false;
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const pt = poly[i];
      const T = Array.isArray(pt) ? pt[0] : pt.T;
      const wRaw = Array.isArray(pt) ? pt[1] : pt.w;
      const ws = Psy.wsat_at(T, pPa);
      const w = CoreDOM.clamp(wRaw, 0, ws);
      const px = this.xc(T);
      const py = this.yc(w);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    return true;
  }

  _drawHatchInsideCurrentPath(ctx, poly, strokeColor, dpi, spacingPx = 9) {
    const b = _BR_polyBounds(poly);
    const xMin = this.xc(b.minT) - 4 * dpi;
    const xMax = this.xc(b.maxT) + 4 * dpi;
    const yMin = this.yc(b.maxW) - 4 * dpi;
    const yMax = this.yc(b.minW) + 4 * dpi;
    const step = Math.max(4, spacingPx * dpi);
    const spanY = yMax - yMin;

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(0.6, 0.7 * dpi);
    ctx.globalAlpha = 0.24;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let x = xMin - spanY; x <= xMax + spanY; x += step) {
      ctx.moveTo(x, yMax);
      ctx.lineTo(x + spanY, yMin);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ---- Layer 2c: Givoni Bioclimatic Zones ---- */
  _drawGivoni(ctx, state, pal, dpi, isDark) {
    if (!Comfort || typeof Comfort.getGivoniZones !== 'function') return;
    const pPa = state.pPa || Psy.P_STD || 101325;
    const zones = Comfort.getGivoniZones(pPa);
    if (!Array.isArray(zones) || !zones.length) return;

    const placedLabels = [];
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!z || !z.poly || z.poly.length < 3) continue;

      ctx.save();
      this._tracePolyPath(ctx, z.poly, pPa);
      ctx.fillStyle = z.fill || 'rgba(14, 165, 233, 0.09)';
      ctx.fill();

      // Subtle architectural 45-degree hatch inside polygon
      this._drawHatchInsideCurrentPath(ctx, z.poly, z.stroke || '#38bdf8', dpi, 10);

      // Crisp dashed perimeter
      this._tracePolyPath(ctx, z.poly, pPa);
      ctx.strokeStyle = z.stroke || 'rgba(14, 165, 233, 0.65)';
      ctx.lineWidth = 1.15 * dpi;
      ctx.setLineDash([4 * dpi, 3 * dpi]);
      ctx.stroke();
      ctx.restore();

      // Clean concise label at area centroid (collision-checked)
      const [cT, cW] = _BR_polyCentroid(z.poly);
      const lx = this.xc(cT);
      const ly = this.yc(cW);
      let collide = false;
      for (let k = 0; k < placedLabels.length; k++) {
        const dx = lx - placedLabels[k][0];
        const dy = ly - placedLabels[k][1];
        if (Math.hypot(dx, dy) < 26 * dpi) { collide = true; break; }
      }
      const lblY = collide ? ly - 13 * dpi : ly;
      placedLabels.push([lx, lblY]);

      const lblText = z.shortLabel || z.label;
      const lblColor = z.stroke || (isDark ? '#cbd5e1' : '#334155');
      this._textHalo(
        ctx,
        lblText,
        lx, lblY,
        lblColor,
        'center', 'middle',
        8.5, dpi, pal, '600', _BR_FONT_SANS
      );
      this._pushZoneLabelRect(ctx, lblText, lx, lblY, 'center', 'middle', 8.5, dpi, '600', _BR_FONT_SANS);
    }
  }

  /* ---- Layer 2d: ASHRAE TC 9.9 Data Center Envelopes ---- */
  _drawDataCenter(ctx, state, pal, dpi, isDark) {
    if (!Comfort || typeof Comfort.getDataCenterZones !== 'function') return;
    const pPa = state.pPa || Psy.P_STD || 101325;
    const zones = Comfort.getDataCenterZones(pPa);
    if (!Array.isArray(zones) || !zones.length) return;
    const rect = this.getPlotRect();

    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!z || !z.poly || z.poly.length < 3) continue;
      const isRec = z.id === 'tc99_rec' || /recommended/i.test(z.label || '');

      ctx.save();
      this._tracePolyPath(ctx, z.poly, pPa);
      ctx.fillStyle = z.fill || (isRec ? 'rgba(16, 185, 129, 0.16)' : 'rgba(56, 189, 248, 0.08)');
      ctx.fill();
      ctx.strokeStyle = z.stroke || (isRec ? '#10b981' : '#38bdf8');
      ctx.lineWidth = (isRec ? 1.8 : 1.15) * dpi;
      ctx.setLineDash(isRec ? [6 * dpi, 3 * dpi] : [4 * dpi, 3.5 * dpi]);
      ctx.stroke();
      ctx.restore();

      // Non-overlapping labels: Recommended centered, A1/A2/A3 tucked cleanly below top border
      const bounds = _BR_polyBounds(z.poly);
      if (isRec) {
        const [cT, cW] = _BR_polyCentroid(z.poly);
        const recColor = isDark ? '#34d399' : '#047857';
        const rx = this.xc(cT);
        const ry = this.yc(cW);
        this._textHalo(
          ctx,
          'TC 9.9 Rec',
          rx, ry,
          recColor, 'center', 'middle', 8.5, dpi, pal, '700', _BR_FONT_SANS
        );
        this._pushZoneLabelRect(ctx, 'TC 9.9 Rec', rx, ry, 'center', 'middle', 8.5, dpi, '700', _BR_FONT_SANS);
      } else {
        // Find max w at right edge (maxT) to tuck tag cleanly in outer ring shoulder
        let topRightW = -Infinity;
        for (let k = 0; k < z.poly.length; k++) {
          const p = z.poly[k];
          const pT = Array.isArray(p) ? p[0] : p.T;
          const pW = Array.isArray(p) ? p[1] : p.w;
          if (Math.abs(pT - bounds.maxT) < 0.25 && pW > topRightW) {
            topRightW = Math.min(bounds.maxW, pW);
          }
        }
        if (!Number.isFinite(topRightW)) topRightW = bounds.maxW;
        const tag = z.id === 'tc99_a1' ? 'A1'
          : (z.id === 'tc99_a2' ? 'A2'
            : (z.id === 'tc99_a3' ? 'A3' : (z.label || '')));
        const tx = this.xc(bounds.maxT) - 4 * dpi;
        const ty = Math.max(rect.y + 14 * dpi, this.yc(topRightW) + 14 * dpi);
        this._textHalo(
          ctx,
          tag,
          tx, ty,
          z.stroke || (isDark ? '#cbd5e1' : '#334155'),
          'right', 'top', 8.5, dpi, pal, '700', _BR_FONT_MONO
        );
        this._pushZoneLabelRect(ctx, tag, tx, ty, 'right', 'top', 8.5, dpi, '700', _BR_FONT_MONO);
      }
    }
  }

  /* ---- Layer 2e: ASHRAE 55 Dynamic PMV Comfort Zones ---- */
  _drawComfortZones(ctx, state, pal, dpi, isDark) {
    if (!Comfort || typeof Comfort.getSummerWinterZones !== 'function') return;
    const comfort = state.comfort || {};
    const mode = comfort.mode || 'both';
    if (mode === 'none') return;

    const pPa = state.pPa || Psy.P_STD || 101325;
    const res = Comfort.getSummerWinterZones(pPa, comfort);
    if (!res) return;

    // Support both { summer, winter } object and Array return shapes
    const list = [];
    if (Array.isArray(res)) {
      for (let i = 0; i < res.length; i++) {
        const z = res[i];
        if (!z) continue;
        if (mode === 'summer' && z.id === 'winter') continue;
        if (mode === 'winter' && z.id === 'summer') continue;
        list.push(z);
      }
    } else {
      if ((mode === 'winter' || mode === 'both') && res.winter) list.push(res.winter);
      if ((mode === 'summer' || mode === 'both') && res.summer) list.push(res.summer);
    }

    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      if (!z || !z.poly || z.poly.length < 3) continue;
      const isSummer = z.id === 'summer' || /summer/i.test(z.label || '');

      const fillCol = z.fill || (isSummer ? 'rgba(16, 185, 129, 0.14)' : 'rgba(59, 130, 246, 0.12)');
      const strokeCol = isDark
        ? (z.stroke || (isSummer ? 'rgba(52, 211, 153, 0.78)' : 'rgba(96, 165, 250, 0.76)'))
        : (isSummer ? 'rgba(4, 120, 87, 0.78)' : 'rgba(29, 78, 216, 0.76)');

      ctx.save();
      this._tracePolyPath(ctx, z.poly, pPa);
      ctx.fillStyle = fillCol;
      ctx.fill();
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 1.5 * dpi;
      ctx.setLineDash([5 * dpi, 3.5 * dpi]);
      ctx.stroke();
      ctx.restore();

      const [cT] = _BR_polyCentroid(z.poly);
      const bounds = _BR_polyBounds(z.poly);
      const tSpan = Math.max(0.5, bounds.maxT - bounds.minT);
      const tPad = Math.min(0.4, tSpan * 0.18);
      const lblT = isSummer
        ? CoreDOM.clamp(cT + 0.8, bounds.minT + tPad, bounds.maxT - tPad)
        : CoreDOM.clamp(cT - 0.8, bounds.minT + tPad, bounds.maxT - tPad);
      const wCap = Math.min(bounds.maxW - 0.0008, Psy.wsat_at(lblT, pPa) * 0.92);
      const wFloor = bounds.minW + 0.0008;
      const targetW = isSummer ? 0.0088 : 0.0042;
      const lblW = wCap > wFloor ? CoreDOM.clamp(targetW, wFloor, wCap) : (bounds.minW + bounds.maxW) * 0.5;
      const lblText = z.label || (isSummer ? 'Summer' : 'Winter');
      const lx = this.xc(lblT);
      const ly = this.yc(lblW);

      this._textHalo(
        ctx,
        lblText,
        lx,
        ly,
        strokeCol,
        'center', 'middle',
        8.5, dpi, pal, '600', _BR_FONT_SANS
      );
      this._pushZoneLabelRect(ctx, lblText, lx, ly, 'center', 'middle', 8.5, dpi, '600', _BR_FONT_SANS);
    }
  }

  /* ---- Layer 2f: Dew-Point Horizontal Lines ---- */
  _drawDewPointLines(ctx, state, pal, dpi) {
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const pPa = state.pPa || Psy.P_STD || 101325;
    const isSI = state.units !== 'IP';
    const rect = this.getPlotRect();
    const labelMode = state.grid?.labelMode || 'mid';
    const lblPx = Math.max(8, (state.grid?.labelPx || pal.lblPx || 11) - 2);

    const maxTdpC = Math.min(view.tMax, Psy.dewpoint_from_pv(Psy.pv_from_w(view.wMax, pPa)));
    const minTdpC = Math.max(-40, view.tMin - 5);
    const minDisp = isSI ? minTdpC : CoreDOM.cToF(minTdpC);
    const maxDisp = isSI ? maxTdpC : CoreDOM.cToF(maxTdpC);
    const dpStep = _BR_niceStep(Math.max(1, maxDisp - minDisp), 8);
    const startDisp = Math.ceil(minDisp / dpStep) * dpStep;

    const lineCol = pal.dp;
    const lw = (pal.lw?.dp ?? 0.8) * dpi;
    const dashStyle = pal.ls?.dp || 'dotted';
    let lastLblY = Infinity;

    for (let tdpDisp = startDisp; tdpDisp <= maxDisp + dpStep * 1e-4; tdpDisp += dpStep) {
      const tdpC = isSI ? tdpDisp : CoreDOM.fToC(tdpDisp);
      const w = Psy.w_from_Tdp(tdpC, pPa);
      if (!Number.isFinite(w) || w <= 1e-6 || w > view.wMax) continue;
      const py = _BR_crisp(this.yc(w));
      if (py < rect.y || py > rect.y + rect.h) continue;
      const satX = Math.max(rect.x, this.xc(tdpC));
      if (satX >= rect.x + rect.w) continue;

      ctx.save();
      _BR_setDash(ctx, dashStyle, dpi);
      ctx.strokeStyle = lineCol;
      ctx.lineWidth = lw;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(satX, py);
      ctx.lineTo(rect.x + rect.w, py);
      ctx.stroke();
      ctx.restore();

      if (labelMode !== 'none' && Math.abs(py - lastLblY) >= 16 * dpi) {
        const lx = satX + 6 * dpi;
        if (lx < rect.x + rect.w - 30 * dpi) {
          this._textHalo(
            ctx,
            `${_BR_fmtTick(tdpDisp, dpStep)}° dp`,
            lx, py - 3 * dpi,
            lineCol, 'left', 'alphabetic', lblPx, dpi, pal, '500', _BR_FONT_MONO
          );
          lastLblY = py;
        }
      }
    }
  }

  /* ---- Layer 2g: Specific Volume Lines ---- */
  _drawVolumeLines(ctx, state, pal, dpi, ax = _BR_DEFAULT_AXIS_STYLE) {
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const pPa = state.pPa || Psy.P_STD || 101325;
    const isSI = state.units !== 'IP';
    const rect = this.getPlotRect();
    const labelMode = state.grid?.labelMode || 'mid';
    const lblPx = Math.max(8, (state.grid?.labelPx || pal.lblPx || 11) - 1);
    const curveLabelStyle = ax?.curveLabelStyle || 'tangent-inline';

    const vMinSI = Psy.v_m3kg(view.tMin, 0, pPa);
    const vMaxSI = Psy.v_m3kg(view.tMax, view.wMax, pPa);

    let stepDisp, startDisp, endDisp, decFmt;
    if (isSI) {
      const span = Math.max(0.02, vMaxSI - vMinSI);
      stepDisp = span < 0.08 ? 0.01 : (span > 0.50 ? 0.05 : 0.02);
      startDisp = Math.floor(vMinSI / stepDisp) * stepDisp;
      endDisp = Math.ceil(vMaxSI / stepDisp) * stepDisp;
      decFmt = 2;
    } else {
      const vMinIP = vMinSI * _BR_V_IP_PER_SI;
      const vMaxIP = vMaxSI * _BR_V_IP_PER_SI;
      const span = Math.max(0.5, vMaxIP - vMinIP);
      stepDisp = span < 1.5 ? 0.2 : (span > 8.0 ? 1.0 : 0.5);
      startDisp = Math.floor(vMinIP / stepDisp) * stepDisp;
      endDisp = Math.ceil(vMaxIP / stepDisp) * stepDisp;
      decFmt = 1;
    }

    const nSamples = 24;
    const col = pal.vline;
    const lw = pal.lw?.vline ?? 0.8;
    const ls = pal.ls?.vline || 'solid';
    const placedLabels = [];
    const vAtZeroZero = Psy.v_m3kg(0, 0, pPa);
    const vAtMax0 = Psy.v_m3kg(view.tMax, 0, pPa);
    const dvDwAtMax = Psy.v_m3kg(view.tMax, 1, pPa) - vAtMax0;

    for (let vDisp = startDisp; vDisp <= endDisp + stepDisp * 1e-4; vDisp += stepDisp) {
      const vSI = isSI ? vDisp : (vDisp / _BR_V_IP_PER_SI);
      const pts = [];
      for (let i = 0; i <= nSamples; i++) {
        const w = (view.wMax * 1.02 * i) / nSamples;
        // Exact analytical inversion: v(T, w) = (T + 273.15) / 273.15 * v(0, w)
        const vAt0 = Psy.v_m3kg(0, w, pPa);
        if (!Number.isFinite(vAt0) || vAt0 <= 0) continue;
        const T = (vSI / vAt0) * 273.15 - 273.15;
        pts.push([this.xc(T), this.yc(w)]);
      }

      this._plotCurve(ctx, pts, col, lw, 0.72, ls, dpi);

      if (labelMode !== 'none') {
        const vText = vDisp.toFixed(decFmt);
        if (curveLabelStyle === 'end-aligned') {
          // Mollier / DIN clean horizontal labels neatly aligned along lower/right edge
          const tDryIntercept = (Number.isFinite(vAtZeroZero) && vAtZeroZero > 0)
            ? (vSI / vAtZeroZero) * 273.15 - 273.15
            : NaN;
          if (Number.isFinite(tDryIntercept) && tDryIntercept >= view.tMin && tDryIntercept <= view.tMax) {
            const px = this.xc(tDryIntercept);
            const py = rect.y + rect.h - (ax?.enthalpyRulerStyle === 'carrier-dual' ? 18 : 5) * dpi;
            if (px > rect.x + 18 * dpi && px < rect.x + rect.w - 18 * dpi) {
              let skip = false;
              for (let k = 0; k < placedLabels.length; k++) {
                if (Math.hypot(px - placedLabels[k][0], py - placedLabels[k][1]) < 28 * dpi) {
                  skip = true;
                  break;
                }
              }
              if (!skip) {
                this._textHalo(
                  ctx, vText, px, py,
                  col, 'center', 'alphabetic', lblPx, dpi, pal, '600', _BR_FONT_MONO
                );
                placedLabels.push([px, py]);
              }
            }
          } else if (Number.isFinite(tDryIntercept) && tDryIntercept > view.tMax && Math.abs(dvDwAtMax) > 1e-9) {
            const wRight = (vSI - vAtMax0) / dvDwAtMax;
            if (Number.isFinite(wRight) && wRight > 0 && wRight <= view.wMax * 0.96 && wRight <= Psy.wsat_at(view.tMax, pPa)) {
              const px = rect.x + rect.w - (ax?.enthalpyRulerStyle === 'carrier-dual' ? 28 : 6) * dpi;
              const py = this.yc(wRight);
              if (py > rect.y + 14 * dpi && py < rect.y + rect.h - 14 * dpi) {
                let skip = false;
                for (let k = 0; k < placedLabels.length; k++) {
                  if (Math.hypot(px - placedLabels[k][0], py - placedLabels[k][1]) < 16 * dpi) {
                    skip = true;
                    break;
                  }
                }
                if (!skip) {
                  this._textHalo(
                    ctx, vText, px, py,
                    col, 'right', 'middle', lblPx, dpi, pal, '600', _BR_FONT_MONO
                  );
                  placedLabels.push([px, py]);
                }
              }
            }
          }
        } else {
          // Rotated inline label along lower-middle section of the volume line
          const anchorFrac = labelMode === 'end' ? 0.08 : 0.20;
          const wTarget = view.wMax * anchorFrac;
          const vAt0 = Psy.v_m3kg(0, wTarget, pPa);
          const T = (vSI / vAt0) * 273.15 - 273.15;
          if (T >= view.tMin && T <= view.tMax && wTarget <= Psy.wsat_at(T, pPa) * 0.92) {
            const px = this.xc(T);
            const py = this.yc(wTarget);
            if (px > rect.x + 18 * dpi && px < rect.x + rect.w - 18 * dpi &&
                py > rect.y + 18 * dpi && py < rect.y + rect.h - 14 * dpi) {
              let skip = false;
              for (let k = 0; k < placedLabels.length; k++) {
                if (Math.hypot(px - placedLabels[k][0], py - placedLabels[k][1]) < 24 * dpi) {
                  skip = true;
                  break;
                }
              }
              if (!skip) {
                // Compute local line angle
                const w2 = wTarget + view.wMax * 0.05;
                const T2 = (vSI / Psy.v_m3kg(0, w2, pPa)) * 273.15 - 273.15;
                let ang = Math.atan2(this.yc(w2) - py, this.xc(T2) - px);
                if (ang > Math.PI / 2) ang -= Math.PI;
                if (ang < -Math.PI / 2) ang += Math.PI;

                ctx.save();
                ctx.translate(px, py);
                ctx.rotate(ang);
                this._textHalo(
                  ctx,
                  vText,
                  0, -3 * dpi,
                  col, 'center', 'alphabetic', lblPx, dpi, pal, '500', _BR_FONT_MONO
                );
                ctx.restore();
                placedLabels.push([px, py]);
              }
            }
          }
        }
      }
    }
  }

  /* ---- Layer 2h: Constant-Enthalpy Lines (Exact SI & IP 0°F Datum) ---- */
  _drawEnthalpyLines(ctx, state, pal, dpi) {
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const pPa = state.pPa || Psy.P_STD || 101325;
    const isSI = state.units !== 'IP';

    const evalH = isSI
      ? (T, w) => Psy.h_kJkg(T, w)
      : (T, w) => (typeof Psy.h_Btulb === 'function'
          ? Psy.h_Btulb(T, w)
          : (0.240 * CoreDOM.cToF(T) + w * (1061 + 0.444 * CoreDOM.cToF(T))));

    // Exact machine-precision affine inverse w(T, hTarget)
    const wAtH = (T, hTarget) => {
      const h0 = evalH(T, 0);
      const h1 = evalH(T, 1) - h0;
      if (!Number.isFinite(h1) || Math.abs(h1) < 1e-9) return NaN;
      return (hTarget - h0) / h1;
    };

    // Exact saturation temperature T_sat where h(T_sat, w_sat(T_sat)) === hTarget
    const tBoil = Math.min(95, Psy.dewpoint_from_pv(pPa * 0.995));
    const solveSatT = (hTarget) => {
      let lo = -60;
      let hi = tBoil;
      if (evalH(lo, Psy.wsat_at(lo, pPa)) > hTarget) return null;
      if (evalH(hi, Psy.wsat_at(hi, pPa)) < hTarget) return null;
      for (let i = 0; i < 28; i++) {
        const mid = 0.5 * (lo + hi);
        if (evalH(mid, Psy.wsat_at(mid, pPa)) < hTarget) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    };

    const hMin = evalH(view.tMin, 0);
    const hMax = evalH(view.tMax, view.wMax);
    const hSpan = Math.max(1, hMax - hMin);

    let hStep;
    if (isSI) {
      hStep = hSpan < 45 ? 5 : (hSpan > 220 ? 20 : 10);
    } else {
      hStep = hSpan < 20 ? 2 : (hSpan > 95 ? 10 : 5);
    }

    const startH = Math.floor(hMin / hStep) * hStep;
    const endH = Math.ceil(hMax / hStep) * hStep;

    const col = pal.enth;
    const lw = pal.lw?.enth ?? 0.85;
    const ls = pal.ls?.enth || 'solid';
    const majorEntries = [];

    for (let hVal = startH; hVal <= endH + hStep * 1e-4; hVal += hStep) {
      const cleanH = Math.round(hVal / hStep) * hStep;
      const tSat = solveSatT(cleanH);
      const wSat = tSat !== null ? Psy.wsat_at(tSat, pPa) : NaN;

      // Exact dry-air x-intercept where w = 0
      const tDry = isSI
        ? (cleanH / 1.006)
        : CoreDOM.fToC(cleanH / 0.240);

      const tStart = Math.max(view.tMin - 2, (tSat !== null ? tSat - 0.5 : view.tMin - 2));
      const tEnd = Math.min(view.tMax + 2, tDry + 0.5);

      if (tEnd > tStart) {
        const pts = [];
        const segs = 22;
        for (let i = 0; i <= segs; i++) {
          const T = tStart + ((tEnd - tStart) * i) / segs;
          const w = wAtH(T, cleanH);
          if (!Number.isFinite(w) || w < -0.002 || w > view.wMax * 1.15) continue;
          pts.push([this.xc(T), this.yc(Math.max(0, w))]);
        }
        // Ensure exact termination flush on bottom axis w = 0 if inside plot
        if (tDry >= view.tMin - 1 && tDry <= view.tMax + 1) {
          pts.push([this.xc(tDry), this.yc(0)]);
        }
        this._plotCurve(ctx, pts, col, lw, 0.68, ls, dpi);
      }

      if (tSat !== null && Number.isFinite(wSat)) {
        majorEntries.push({
          hVal: cleanH,
          tSat,
          wSat,
          pxSat: this.xc(tSat),
          pySat: this.yc(wSat)
        });
      }
    }

    return {
      evalH,
      wAtH,
      hStep,
      hMinorStep: hStep >= 10 ? hStep / 5 : (hStep === 5 ? 1 : hStep / 2),
      startH,
      endH,
      majorEntries,
      isSI
    };
  }

  /* ---- Layer 2i: True Thermodynamic Wet-Bulb Lines (Exact ASHRAE Eqs. 35/37) ---- */
  _drawWetBulbLines(ctx, state, pal, dpi, ax = _BR_DEFAULT_AXIS_STYLE) {
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const pPa = state.pPa || Psy.P_STD || 101325;
    const isSI = state.units !== 'IP';
    const rect = this.getPlotRect();
    const s = this._stepT(state);
    const labelMode = state.grid?.labelMode || 'mid';
    const lblPx = Math.max(8, (state.grid?.labelPx || pal.lblPx || 11) - 1.5);
    const curveLabelStyle = ax?.curveLabelStyle || 'tangent-inline';

    const twbMinC = typeof Psy.twb_from_Tw === 'function'
      ? Psy.twb_from_Tw(view.tMin, 0, pPa)
      : (view.tMin - 10);
    const twbMaxC = typeof Psy.twb_from_Tw === 'function'
      ? Psy.twb_from_Tw(view.tMax, Math.min(view.wMax, Psy.wsat_at(view.tMax, pPa)), pPa)
      : view.tMax;

    const minDisp = isSI ? twbMinC : CoreDOM.cToF(twbMinC);
    const maxDisp = isSI ? twbMaxC : CoreDOM.cToF(twbMaxC);
    const wbStep = _BR_niceStep(Math.max(1, maxDisp - minDisp), isSI ? 10 : 10);
    const startDisp = Math.floor(minDisp / wbStep) * wbStep;

    const col = pal.wb;
    const lw = pal.lw?.wb ?? 0.85;
    const ls = pal.ls?.wb || 'dashed';
    const placedLabels = [];

    for (let twbDisp = startDisp; twbDisp <= maxDisp + wbStep * 1e-4; twbDisp += wbStep) {
      const cleanDisp = Math.round(twbDisp / wbStep) * wbStep;
      const TwbC = isSI ? cleanDisp : CoreDOM.fToC(cleanDisp);
      const wsStar = Psy.wsat_at(TwbC, pPa);
      if (!Number.isFinite(wsStar)) continue;

      // Exact algebraic dry-air intercept (w = 0) from ASHRAE Eqs. (35)/(37)
      const tZero = TwbC >= 0
        ? TwbC + ((2501 - 2.326 * TwbC) * wsStar) / 1.006
        : TwbC + ((2830 - 0.24 * TwbC) * wsStar) / 1.006;

      const tStart = Math.max(TwbC, view.tMin - s);
      const tEnd = Math.min(tZero, view.tMax + s);
      if (tEnd <= tStart) continue;

      const pts = [];
      if (TwbC >= view.tMin - s) {
        pts.push([this.xc(TwbC), this.yc(wsStar)]);
      }
      for (let T = tStart + s; T < tEnd; T += s) {
        const w = Psy.w_from_TTwb(T, TwbC, pPa);
        if (!Number.isFinite(w) || w <= 0) break;
        if (w <= view.wMax * 1.1) {
          pts.push([this.xc(T), this.yc(w)]);
        }
      }
      if (tEnd >= tZero - 1e-6) {
        pts.push([this.xc(tZero), this.yc(0)]);
      } else {
        const wEnd = Psy.w_from_TTwb(tEnd, TwbC, pPa);
        if (Number.isFinite(wEnd) && wEnd >= 0) {
          pts.push([this.xc(tEnd), this.yc(wEnd)]);
        }
      }

      if (pts.length < 2) continue;
      this._plotCurve(ctx, pts, col, lw, 0.72, ls, dpi);

      if (labelMode !== 'none') {
        const wbText = `${_BR_fmtTick(cleanDisp, wbStep)}°`;
        if (curveLabelStyle === 'end-aligned') {
          // Mollier / DIN clean horizontal labels neatly aligned near lower/right edge
          if (tZero >= view.tMin && tZero <= view.tMax && wsStar > 1e-6) {
            const wBand = Math.min(wsStar * 0.45, view.wMax * 0.085);
            const frac = CoreDOM.clamp(1 - wBand / wsStar, 0.15, 0.94);
            const tAnchor = TwbC + (tZero - TwbC) * frac;
            const wAnchor = Psy.w_from_TTwb(tAnchor, TwbC, pPa);
            if (Number.isFinite(wAnchor) && wAnchor > 0 && wAnchor <= view.wMax * 0.94 &&
                tAnchor >= view.tMin && tAnchor <= view.tMax) {
              const lx = this.xc(tAnchor);
              const ly = this.yc(wAnchor);
              if (lx > rect.x + 16 * dpi && lx < rect.x + rect.w - 16 * dpi &&
                  ly > rect.y + 14 * dpi && ly < rect.y + rect.h - 14 * dpi) {
                let skip = false;
                for (let k = 0; k < placedLabels.length; k++) {
                  if (Math.hypot(lx - placedLabels[k][0], ly - placedLabels[k][1]) < 24 * dpi) {
                    skip = true;
                    break;
                  }
                }
                if (!skip) {
                  this._textHalo(
                    ctx, wbText, lx, ly,
                    col, 'center', 'middle', lblPx, dpi, pal, '600', _BR_FONT_MONO
                  );
                  placedLabels.push([lx, ly]);
                }
              }
            }
          } else if (tZero > view.tMax) {
            const wRight = Psy.w_from_TTwb(view.tMax, TwbC, pPa);
            if (Number.isFinite(wRight) && wRight > view.wMax * 0.03 && wRight <= view.wMax * 0.96 &&
                wRight <= Psy.wsat_at(view.tMax, pPa)) {
              const lx = rect.x + rect.w - (ax?.enthalpyRulerStyle === 'carrier-dual' ? 52 : 34) * dpi;
              const ly = this.yc(wRight);
              if (ly > rect.y + 14 * dpi && ly < rect.y + rect.h - 14 * dpi) {
                let skip = false;
                for (let k = 0; k < placedLabels.length; k++) {
                  if (Math.hypot(lx - placedLabels[k][0], ly - placedLabels[k][1]) < 16 * dpi) {
                    skip = true;
                    break;
                  }
                }
                if (!skip) {
                  this._textHalo(
                    ctx, wbText, lx, ly,
                    col, 'right', 'middle', lblPx, dpi, pal, '600', _BR_FONT_MONO
                  );
                  placedLabels.push([lx, ly]);
                }
              }
            }
          }
        } else {
          // Clean wet-bulb label tucked just inside saturation curve (ASHRAE convention)
          const sx = this.xc(TwbC);
          const sy = this.yc(wsStar);
          if (sx >= rect.x + 4 * dpi && sx <= rect.x + rect.w - 22 * dpi &&
              sy >= rect.y + 8 * dpi && sy <= rect.y + rect.h - 14 * dpi) {
            // Step slightly inward along the wet-bulb line away from saturation stroke
            const tIn = Math.min(tZero, TwbC + Math.max(0.6, (view.tMax - view.tMin) * 0.022));
            const wIn = Psy.w_from_TTwb(tIn, TwbC, pPa);
            const lx = this.xc(tIn);
            const ly = this.yc(wIn);
            let skip = false;
            for (let k = 0; k < placedLabels.length; k++) {
              if (Math.hypot(lx - placedLabels[k][0], ly - placedLabels[k][1]) < 20 * dpi) {
                skip = true;
                break;
              }
            }
            if (!skip && lx < rect.x + rect.w - 16 * dpi && ly < rect.y + rect.h - 10 * dpi) {
              this._textHalo(
                ctx,
                wbText,
                lx + 2 * dpi, ly + 2 * dpi,
                col, 'left', 'top', lblPx, dpi, pal, '600', _BR_FONT_MONO
              );
              placedLabels.push([lx, ly]);
            }
          }
        }
      }
    }
  }

  /* ---- Layer 2j: Relative Humidity Contours ---- */
  _drawRHLines(ctx, state, pal, dpi, ax = _BR_DEFAULT_AXIS_STYLE) {
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const pPa = state.pPa || Psy.P_STD || 101325;
    const rect = this.getPlotRect();
    const s = this._stepT(state);
    const step = CoreDOM.clamp(parseInt(state.grid?.rhStep ?? 10, 10) || 10, 5, 25);
    const labelMode = state.grid?.labelMode || 'mid';
    const lblPx = Math.max(8, (state.grid?.labelPx || pal.lblPx || 11) - 0.5);
    const curveLabelStyle = ax?.curveLabelStyle || 'tangent-inline';

    const col = pal.rh;
    const baseLw = pal.lw?.rh ?? 0.9;
    const ls = pal.ls?.rh || 'solid';
    const placedLabels = [];
    const zoneRects = Array.isArray(this._zoneLabelRects) ? this._zoneLabelRects : [];
    const pvAtWMax = Psy.pv_from_w(view.wMax, pPa);

    for (let rh = step; rh < 100; rh += step) {
      const pts = [];
      const visPts = [];
      const rh01 = rh / 100;

      for (let T = view.tMin - s; T <= view.tMax + s; T += s) {
        const pv = Math.min(pPa * 0.999, Psy.p_ws_Pa(T) * rh01);
        const w = Psy.w_from_pv(pv, pPa);
        if (!Number.isFinite(w) || w < 0) continue;
        const px = this.xc(T);
        const py = this.yc(w);
        pts.push([px, py]);

        if (px >= rect.x + 22 * dpi && px <= rect.x + rect.w - 26 * dpi &&
            py >= rect.y + 16 * dpi && py <= rect.y + rect.h - 14 * dpi) {
          visPts.push([px, py]);
        }
        if (w > view.wMax * 1.12) break;
      }

      // Subtle emphasis on 50% RH reference curve
      const isFifty = rh === 50;
      const lw = isFifty ? baseLw * 1.25 : baseLw;
      const alpha = isFifty ? 0.94 : 0.78;
      this._plotCurve(ctx, pts, col, lw, alpha, ls, dpi);

      if (labelMode !== 'none') {
        const rhText = `${rh}%`;
        const fontWt = isFifty ? '700' : '600';

        if (curveLabelStyle === 'end-aligned') {
          // Mollier / DIN clean horizontal labels neatly aligned near right/top edge
          const wRight = Psy.w_from_pv(Math.min(pPa * 0.999, Psy.p_ws_Pa(view.tMax) * rh01), pPa);
          const rightInset = (ax?.enthalpyRulerStyle === 'carrier-dual' ? 28 : 5) * dpi;
          if (Number.isFinite(wRight) && wRight <= view.wMax * 0.99 && wRight >= view.wMax * 0.015) {
            const lx = rect.x + rect.w - rightInset;
            const ly = this.yc(wRight);
            if (ly >= rect.y + 12 * dpi && ly <= rect.y + rect.h - 12 * dpi) {
              let skip = false;
              for (let k = 0; k < placedLabels.length; k++) {
                if (Math.abs(ly - placedLabels[k][1]) < 13 * dpi && Math.abs(lx - placedLabels[k][0]) < 30 * dpi) {
                  skip = true;
                  break;
                }
              }
              if (!skip) {
                this._textHalo(
                  ctx, rhText, lx, ly,
                  col, 'right', 'middle', lblPx, dpi, pal, fontWt, _BR_FONT_MONO
                );
                placedLabels.push([lx, ly]);
              }
            }
          } else if (rh01 > 1e-4) {
            const tTop = Psy.dewpoint_from_pv(Math.min(pPa * 0.995, pvAtWMax / rh01));
            if (Number.isFinite(tTop) && tTop >= view.tMin && tTop <= view.tMax) {
              const lx = CoreDOM.clamp(this.xc(tTop), rect.x + 18 * dpi, rect.x + rect.w - 18 * dpi);
              const ly = rect.y + 8 * dpi;
              let skip = false;
              for (let k = 0; k < placedLabels.length; k++) {
                if (Math.hypot(lx - placedLabels[k][0], ly - placedLabels[k][1]) < 24 * dpi) {
                  skip = true;
                  break;
                }
              }
              if (!skip) {
                this._textHalo(
                  ctx, rhText, lx, ly,
                  col, 'center', 'top', lblPx, dpi, pal, fontWt, _BR_FONT_MONO
                );
                placedLabels.push([lx, ly]);
              }
            }
          }
        } else if (visPts.length >= 6) {
          // Tangent-aligned labels ('tangent-inline' halo cutout OR 'clean-pill' Trane badge)
          const usePill = (curveLabelStyle === 'clean-pill') && (step >= 10 || rh % 10 === 0 || isFifty);
          const baseFrac = labelMode === 'end'
            ? 0.90
            : CoreDOM.clamp(0.46 + rh01 * 0.24, 0.42, 0.74);
          const candFracs = labelMode === 'end'
            ? [0.90, 0.80, 0.70, 0.58, 0.46]
            : [baseFrac, baseFrac + 0.14, baseFrac - 0.14, baseFrac + 0.26, baseFrac - 0.26, 0.86, 0.24];

          ctx.save();
          ctx.font = `${fontWt} ${(lblPx * dpi).toFixed(2)}px ${_BR_FONT_MONO}`;
          const textW = ctx.measureText(rhText).width + (usePill ? 10 : 4) * dpi;
          ctx.restore();
          const textH = (lblPx * 1.35 + (usePill ? 4.5 : 0)) * dpi;

          let chosen = null;
          for (let ci = 0; ci < candFracs.length; ci++) {
            const f = CoreDOM.clamp(candFracs[ci], 0.08, 0.94);
            const idx = CoreDOM.clamp(Math.floor(visPts.length * f), 2, visPts.length - 3);
            const pt = visPts[idx];
            const pPrev = visPts[Math.max(0, idx - 3)];
            const pNext = visPts[Math.min(visPts.length - 1, idx + 3)];

            let ang = Math.atan2(pNext[1] - pPrev[1], pNext[0] - pPrev[0]);
            if (ang > Math.PI / 2) ang -= Math.PI;
            if (ang < -Math.PI / 2) ang += Math.PI;

            const offN = usePill ? 0 : -(3.5 * dpi + textH * 0.5);
            const cx = pt[0] - Math.sin(ang) * offN;
            const cy = pt[1] + Math.cos(ang) * offN;
            const cosA = Math.abs(Math.cos(ang));
            const sinA = Math.abs(Math.sin(ang));
            const bw = textW * cosA + textH * sinA;
            const bh = textW * sinA + textH * cosA;
            const candRect = { x: cx - bw * 0.5, y: cy - bh * 0.5, w: bw, h: bh };

            if (candRect.x < rect.x + 4 * dpi || candRect.x + candRect.w > rect.x + rect.w - 4 * dpi ||
                candRect.y < rect.y + 4 * dpi || candRect.y + candRect.h > rect.y + rect.h - 4 * dpi) {
              continue;
            }

            let collides = false;
            const minSep = (usePill ? 26 : 22) * dpi;
            for (let k = 0; k < placedLabels.length; k++) {
              if (Math.hypot(pt[0] - placedLabels[k][0], pt[1] - placedLabels[k][1]) < minSep) {
                collides = true;
                break;
              }
            }
            if (collides) continue;

            for (let k = 0; k < zoneRects.length; k++) {
              if (_BR_rectsOverlap(candRect, zoneRects[k], 4 * dpi)) {
                collides = true;
                break;
              }
            }
            if (!collides) {
              chosen = { pt, ang };
              break;
            }
          }

          if (chosen) {
            ctx.save();
            ctx.translate(chosen.pt[0], chosen.pt[1]);
            ctx.rotate(chosen.ang);
            if (usePill) {
              this._drawPillBadge(
                ctx, rhText, 0, 0,
                col, 'center', 'middle', lblPx, dpi, pal, fontWt, _BR_FONT_MONO, isFifty ? 0.85 : 0.58
              );
            } else {
              this._textHalo(
                ctx,
                rhText,
                0, -3.5 * dpi,
                col, 'center', 'alphabetic', lblPx, dpi, pal, fontWt, _BR_FONT_MONO
              );
            }
            ctx.restore();
            placedLabels.push(chosen.pt);
          }
        }
      }
    }
  }

  /* ---- Saturation Curve Data + Exact Top Intersection ---- */
  _buildSaturationData(state) {
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const pPa = state.pPa || Psy.P_STD || 101325;
    const s = Math.min(this._stepT(state), 0.35);

    // Exact temperature where wsat(T) hits view.wMax (if within range)
    let tHitTop = null;
    const wAtMin = Psy.wsat_at(view.tMin, pPa);
    const wAtMax = Psy.wsat_at(view.tMax, pPa);
    if (wAtMin < view.wMax && wAtMax > view.wMax) {
      let lo = view.tMin;
      let hi = view.tMax;
      for (let i = 0; i < 32; i++) {
        const mid = 0.5 * (lo + hi);
        if (Psy.wsat_at(mid, pPa) < view.wMax) lo = mid;
        else hi = mid;
      }
      tHitTop = 0.5 * (lo + hi);
    }

    const pts = [];
    const visPts = [];
    const rect = this.getPlotRect();
    const tEnd = tHitTop !== null ? tHitTop : view.tMax;

    for (let T = view.tMin; T <= tEnd + 1e-6; T += s) {
      const tc = Math.min(T, tEnd);
      const w = Psy.wsat_at(tc, pPa);
      if (!Number.isFinite(w)) continue;
      const px = this.xc(tc);
      const py = this.yc(w);
      pts.push([px, py]);
      if (px >= rect.x - 1 && px <= rect.x + rect.w + 1 &&
          py >= rect.y - 1 && py <= rect.y + rect.h + 1) {
        visPts.push([px, py, tc, w]);
      }
      if (tc >= tEnd) break;
    }

    // Ensure exact top endpoint is included
    if (tHitTop !== null) {
      const pxTop = this.xc(tHitTop);
      const pyTop = this.yc(view.wMax);
      pts.push([pxTop, pyTop]);
      visPts.push([pxTop, pyTop, tHitTop, view.wMax]);
    }

    return { pts, visPts, tHitTop, wAtMin, wAtMax };
  }

  /* ---- Layer 2k: Supersaturated Mask (or Full-Plot Faint CAD Grid) + Bold Saturation Boundary ---- */
  _drawSaturationMaskAndCurve(ctx, satData, pal, layers, dpi, ax = _BR_DEFAULT_AXIS_STYLE, ticks = null) {
    const rect = this.getPlotRect();
    const pts = satData.pts;
    const fullPlotGrid = ax?.gridClipping === 'full-plot';

    // Mask unphysical supersaturated region ABOVE 100% RH cleanly
    if (pts.length >= 2) {
      const traceMask = () => {
        ctx.beginPath();
        ctx.moveTo(rect.x - 2, rect.y - 2);
        ctx.lineTo(pts[0][0], Math.max(rect.y - 2, pts[0][1]));
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i][0], pts[i][1]);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], rect.y - 2);
        ctx.closePath();
      };

      ctx.save();
      ctx.fillStyle = fullPlotGrid ? (pal.plotBg || pal.bg) : pal.bg;
      traceMask();
      ctx.fill();
      ctx.restore();

      // In 'full-plot' CAD drafting mode, extend a faint grid lightly across the upper-left frame
      if (fullPlotGrid && ticks) {
        ctx.save();
        traceMask();
        ctx.clip();
        this._drawGrid(ctx, ticks, pal, layers, dpi, 0.45);
        ctx.restore();
      }
    } else if (satData.wAtMin >= (this._lastState?.view?.wMax || 0.030)) {
      // Entire visible domain is below saturation (dry high-temp zoom): nothing to mask
    }

    // Bold 100% RH Saturation Boundary Stroke
    if (layers.sat !== false && pts.length >= 2) {
      this._plotCurve(ctx, pts, pal.sat, pal.lw?.sat ?? 2.5, 1.0, pal.ls?.sat || 'solid', dpi);
    }
  }

  /* ---- Layer 3: Authentic ASHRAE / Carrier / Minimal Enthalpy Scale Ruler ---- */
  _drawEnthalpyRuler(ctx, satData, enthMeta, state, pal, dpi, ax = _BR_DEFAULT_AXIS_STYLE) {
    const rect = this.getPlotRect();
    const visPts = satData.visPts;
    const { evalH, wAtH, hStep, hMinorStep, startH, endH, majorEntries, isSI } = enthMeta;
    const col = pal.enth;
    const lblPx = Math.max(8, Math.min(10.5, (state.grid?.labelPx || pal.lblPx || 11) - 1));
    const rulerStyle = ax?.enthalpyRulerStyle || 'ashrae-rail';
    const usePill = ax?.curveLabelStyle === 'clean-pill';
    const pPa = state.pPa || Psy.P_STD || 101325;
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };

    const drawEnthLabel = (text, x, y, fontPx = lblPx, align = 'center', baseline = 'middle', wt = '600') => {
      if (usePill) {
        this._drawPillBadge(ctx, text, x, y, col, align, baseline, fontPx, dpi, pal, wt, _BR_FONT_MONO, 0.62);
      } else {
        this._textHalo(ctx, text, x, y, col, align, baseline, fontPx, dpi, pal, wt, _BR_FONT_MONO);
      }
    };

    // ---- Mode 1: Minimal — clean unobtrusive labels tucked right along saturation boundary ----
    if (rulerStyle === 'minimal') {
      if (!majorEntries || !majorEntries.length) return;
      ctx.save();
      const placed = [];
      let topMost = null;
      for (let i = 0; i < majorEntries.length; i++) {
        const entry = majorEntries[i];
        const sx = entry.pxSat;
        const sy = entry.pySat;
        if (sx < rect.x + 12 * dpi || sx > rect.x + rect.w - 16 * dpi ||
            sy < rect.y + 12 * dpi || sy > rect.y + rect.h - 12 * dpi) {
          continue;
        }
        const dt = 0.4;
        const pAx = this.xc(entry.tSat - dt);
        const pAy = this.yc(Psy.wsat_at(entry.tSat - dt, pPa));
        const pBx = this.xc(entry.tSat + dt);
        const pBy = this.yc(Psy.wsat_at(entry.tSat + dt, pPa));
        const dx = pBx - pAx;
        const dy = pBy - pAy;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dy / len;  // outward up-left normal
        const ny = -dx / len;

        // Delicate pip tick on saturation boundary
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(0.75, 0.9 * dpi);
        ctx.globalAlpha = 0.65;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + nx * 3.8 * dpi, sy + ny * 3.8 * dpi);
        ctx.stroke();

        const lx = sx + nx * (usePill ? 15 : 11.5) * dpi;
        const ly = sy + ny * (usePill ? 15 : 11.5) * dpi;
        if (lx < rect.x + 12 * dpi || ly < rect.y + 10 * dpi || lx > rect.x + rect.w - 12 * dpi) continue;

        let skip = false;
        const minSep = (usePill ? 25 : 21) * dpi;
        for (let k = 0; k < placed.length; k++) {
          if (Math.hypot(lx - placed[k][0], ly - placed[k][1]) < minSep) {
            skip = true;
            break;
          }
        }
        if (!skip) {
          ctx.globalAlpha = 1;
          drawEnthLabel(_BR_fmtTick(entry.hVal, hStep), lx, ly, Math.max(7.5, lblPx - 0.5), 'center', 'middle', '600');
          placed.push([lx, ly]);
          if (!topMost || ly < topMost[1]) topMost = [lx, ly];
        }
      }
      // Compact unit indicator tucked neatly above the topmost minimal label
      if (topMost && topMost[1] > rect.y + 22 * dpi) {
        this._textHalo(
          ctx, isSI ? 'h (kJ/kg)' : 'h (Btu/lb)',
          topMost[0], topMost[1] - 13 * dpi,
          col, 'center', 'middle', Math.max(7.5, lblPx - 1.5), dpi, pal, '700', _BR_FONT_SANS
        );
      }
      ctx.restore();
      return;
    }

    // ---- Shared rail geometry for 'ashrae-rail' and 'carrier-dual' ----
    const isCarrier = rulerStyle === 'carrier-dual';
    const satMap = new Map();
    for (let i = 0; i < majorEntries.length; i++) {
      satMap.set(majorEntries[i].hVal, majorEntries[i]);
    }

    const buildRailSegments = () => {
      if (!visPts || visPts.length < 4) return [];
      const pStart = visPts[0];
      const pEnd = visPts[visPts.length - 1];
      const chordDx = pEnd[0] - pStart[0];
      const chordDy = pEnd[1] - pStart[1];
      const chordLen = Math.hypot(chordDx, chordDy);
      if (chordLen < 65 * dpi) return [];

      const safeL = rect.x + 28 * dpi;
      const safeR = rect.x + rect.w - 14 * dpi;
      const safeT = rect.y + 22 * dpi;
      const safeB = rect.y + rect.h - 14 * dpi;
      const ext = 240 * dpi;

      // Iconic Carrier Classic stepped 2-segment bent rail closely hugging the saturation curve
      if (isCarrier && visPts.length >= 12) {
        const midIdx = Math.floor(visPts.length * 0.48);
        const pMid = visPts[midIdx];
        const d1x = pMid[0] - pStart[0];
        const d1y = pMid[1] - pStart[1];
        const len1 = Math.hypot(d1x, d1y);
        const d2x = pEnd[0] - pMid[0];
        const d2y = pEnd[1] - pMid[1];
        const len2 = Math.hypot(d2x, d2y);

        if (len1 >= 45 * dpi && len2 >= 45 * dpi) {
          const t1x = d1x / len1;
          const t1y = d1y / len1;
          const t2x = d2x / len2;
          const t2y = d2y / len2;
          const cross = t1x * t2y - t1y * t2x;
          const dot = t1x * t2x + t1y * t2y;

          if (Math.abs(cross) > 0.04 && dot > 0.35) {
            const offset = 15 * dpi;
            const n1x = t1y;
            const n1y = -t1x;
            const n2x = t2y;
            const n2y = -t2x;

            const a1x = pStart[0] + n1x * offset;
            const a1y = pStart[1] + n1y * offset;
            const b1x = pMid[0] + n2x * offset;
            const b1y = pMid[1] + n2y * offset;
            const b2x = pEnd[0] + n2x * offset;
            const b2y = pEnd[1] + n2y * offset;

            const knee = _BR_intersectLines(a1x, a1y, t1x, t1y, b1x, b1y, t2x, t2y);
            if (knee && Math.hypot(knee[0] - pMid[0], knee[1] - pMid[1]) < 65 * dpi) {
              const s1 = _BR_clipSegmentToRect(
                a1x - t1x * ext, a1y - t1y * ext,
                knee[0], knee[1],
                safeL, safeT, safeR, safeB
              );
              const s2 = _BR_clipSegmentToRect(
                knee[0], knee[1],
                b2x + t2x * ext, b2y + t2y * ext,
                safeL, safeT, safeR, safeB
              );
              const out = [];
              if (s1 && Math.hypot(s1.x2 - s1.x1, s1.y2 - s1.y1) >= 28 * dpi) {
                out.push({ ...s1, nx: n1x, ny: n1y });
              }
              if (s2 && Math.hypot(s2.x2 - s2.x1, s2.y2 - s2.y1) >= 28 * dpi) {
                out.push({ ...s2, nx: n2x, ny: n2y });
              }
              if (out.length > 0) return out;
            }
          }
        }
      }

      // Single straight saturation-parallel chord rail (ASHRAE classic or Carrier fallback)
      const tx = chordDx / chordLen;
      const ty = chordDy / chordLen;
      const nx = ty;
      const ny = -tx;
      const offset = (isCarrier ? 15 : 14) * dpi;
      const rawX1 = pStart[0] + nx * offset;
      const rawY1 = pStart[1] + ny * offset;
      const rawX2 = pEnd[0] + nx * offset;
      const rawY2 = pEnd[1] + ny * offset;

      const rail = _BR_clipSegmentToRect(
        rawX1 - tx * ext, rawY1 - ty * ext,
        rawX2 + tx * ext, rawY2 + ty * ext,
        safeL, safeT, safeR, safeB
      );
      if (!rail || Math.hypot(rail.x2 - rail.x1, rail.y2 - rail.y1) < 55 * dpi) return [];
      return [{ ...rail, nx, ny }];
    };

    const segments = buildRailSegments();
    const placed = [];
    const drawnMajorH = new Set();
    let bestHeaderSeg = null;

    ctx.save();
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      const railDx = seg.x2 - seg.x1;
      const railDy = seg.y2 - seg.y1;
      const railLen = Math.hypot(railDx, railDy);
      if (railLen < 24 * dpi) continue;

      const hRail0 = evalH(this.invT(seg.x1), this.invW(seg.y1));
      const hRail1 = evalH(this.invT(seg.x2), this.invW(seg.y2));
      const hLo = Math.min(hRail0, hRail1);
      const hHi = Math.max(hRail0, hRail1);
      if (!Number.isFinite(hLo) || !Number.isFinite(hHi) || hHi - hLo < 1e-3) continue;

      let railAngle = Math.atan2(railDy, railDx);
      if (railAngle > Math.PI / 2) railAngle -= Math.PI;
      if (railAngle < -Math.PI / 2) railAngle += Math.PI;

      if (!bestHeaderSeg || railLen > bestHeaderSeg.len) {
        bestHeaderSeg = { seg, len: railLen, angle: railAngle };
      }

      const solveSegU = (hTarget) => {
        let lo = 0;
        let hi = 1;
        const asc = hRail1 >= hRail0;
        for (let i = 0; i < 20; i++) {
          const mid = 0.5 * (lo + hi);
          const px = seg.x1 + mid * railDx;
          const py = seg.y1 + mid * railDy;
          const hMid = evalH(this.invT(px), this.invW(py));
          if ((asc && hMid < hTarget) || (!asc && hMid > hTarget)) lo = mid;
          else hi = mid;
        }
        return 0.5 * (lo + hi);
      };

      // 1. Diagonal rail spine (bold dual-accented for Carrier, crisp single spine for ASHRAE)
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = (isCarrier ? 1.85 : 1.25) * dpi;
      ctx.globalAlpha = isCarrier ? 0.92 : 0.85;
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();

      if (isCarrier) {
        // Subtle parallel inner scale rail rule (authentic Carrier ruler heft)
        const offIn = -2.6 * dpi;
        ctx.lineWidth = Math.max(0.6, 0.75 * dpi);
        ctx.globalAlpha = 0.38;
        ctx.beginPath();
        ctx.moveTo(seg.x1 + seg.nx * offIn, seg.y1 + seg.ny * offIn);
        ctx.lineTo(seg.x2 + seg.nx * offIn, seg.y2 + seg.ny * offIn);
        ctx.stroke();
      }
      ctx.restore();

      // 2. Graduated minor ticks along rail (cross-notched for Carrier, outward for ASHRAE)
      if (hMinorStep > 0) {
        const mStart = Math.ceil(hLo / hMinorStep) * hMinorStep;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = (isCarrier ? 0.85 : 0.75) * dpi;
        ctx.globalAlpha = isCarrier ? 0.55 : 0.45;
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let hv = mStart; hv <= hHi + hMinorStep * 1e-4; hv += hMinorStep) {
          const rem = Math.abs(hv / hStep - Math.round(hv / hStep));
          if (rem < 1e-3) continue;
          const u = solveSegU(hv);
          const ix = seg.x1 + u * railDx;
          const iy = seg.y1 + u * railDy;
          if (isCarrier) {
            ctx.moveTo(ix - seg.nx * 2.5 * dpi, iy - seg.ny * 2.5 * dpi);
            ctx.lineTo(ix + seg.nx * 3.8 * dpi, iy + seg.ny * 3.8 * dpi);
          } else {
            ctx.moveTo(ix, iy);
            ctx.lineTo(ix + seg.nx * 4 * dpi, iy + seg.ny * 4 * dpi);
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // 3. Major ticks + saturation-to-rail dashed leaders + rotated labels
      const majStart = Math.ceil(hLo / hStep) * hStep;
      for (let hv = majStart; hv <= hHi + hStep * 1e-4; hv += hStep) {
        const cleanH = Math.round(hv / hStep) * hStep;
        if (drawnMajorH.has(cleanH)) continue;
        drawnMajorH.add(cleanH);

        const u = solveSegU(cleanH);
        const ix = seg.x1 + u * railDx;
        const iy = seg.y1 + u * railDy;

        // Dashed guide leader from saturation curve straight onto the enthalpy rail
        const satEntry = satMap.get(cleanH);
        if (satEntry && satEntry.pxSat >= rect.x - 4 && satEntry.pySat >= rect.y - 4 &&
            satEntry.pxSat <= rect.x + rect.w + 4 && satEntry.pySat <= rect.y + rect.h + 4) {
          ctx.save();
          ctx.strokeStyle = col;
          ctx.lineWidth = (isCarrier ? 0.85 : 0.75) * dpi;
          ctx.globalAlpha = isCarrier ? 0.52 : 0.34;
          ctx.setLineDash(isCarrier ? [2.5 * dpi, 2.5 * dpi] : [3 * dpi, 3 * dpi]);
          ctx.beginPath();
          ctx.moveTo(satEntry.pxSat, satEntry.pySat);
          ctx.lineTo(ix, iy);
          ctx.stroke();
          ctx.restore();
        }

        // Major tick (bold cross-notched for Carrier, crisp outward for ASHRAE)
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = (isCarrier ? 1.45 : 1.2) * dpi;
        ctx.globalAlpha = isCarrier ? 0.96 : 0.92;
        ctx.setLineDash([]);
        ctx.beginPath();
        if (isCarrier) {
          ctx.moveTo(ix - seg.nx * 5.0 * dpi, iy - seg.ny * 5.0 * dpi);
          ctx.lineTo(ix + seg.nx * 7.8 * dpi, iy + seg.ny * 7.8 * dpi);
        } else {
          ctx.moveTo(ix - seg.nx * 2.0 * dpi, iy - seg.ny * 2.0 * dpi);
          ctx.lineTo(ix + seg.nx * 7.5 * dpi, iy + seg.ny * 7.5 * dpi);
        }
        ctx.stroke();
        ctx.restore();

        // Rotated enthalpy value label with collision avoidance
        const lblDist = (usePill ? 15.5 : (isCarrier ? 13.8 : 13.0)) * dpi;
        const lx = ix + seg.nx * lblDist;
        const ly = iy + seg.ny * lblDist;
        if (lx < rect.x + 8 * dpi || ly < rect.y + 8 * dpi) continue;

        let skip = false;
        const minSep = (usePill ? 24 : 20) * dpi;
        for (let k = 0; k < placed.length; k++) {
          if (Math.hypot(lx - placed[k][0], ly - placed[k][1]) < minSep) {
            skip = true;
            break;
          }
        }
        if (!skip) {
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(railAngle);
          drawEnthLabel(_BR_fmtTick(cleanH, hStep), 0, 0, lblPx, 'center', 'middle', isCarrier ? '700' : '600');
          ctx.restore();
          placed.push([lx, ly]);
        }
      }
    }

    // 4. Rotated Enthalpy Unit Header parallel to the primary rail segment
    if (bestHeaderSeg && bestHeaderSeg.len > 105 * dpi) {
      const s = bestHeaderSeg.seg;
      const midX = (s.x1 + s.x2) * 0.5 + s.nx * (usePill ? 32 : 29) * dpi;
      const midY = (s.y1 + s.y2) * 0.5 + s.ny * (usePill ? 32 : 29) * dpi;
      if (midX > rect.x + 28 * dpi && midY > rect.y + 18 * dpi) {
        const header = isSI ? 'ENTHALPY (kJ/kg)' : 'ENTHALPY (Btu/lb)';
        ctx.save();
        ctx.translate(midX, midY);
        ctx.rotate(bestHeaderSeg.angle);
        this._textHalo(
          ctx, header, 0, 0,
          col, 'center', 'middle', Math.max(8, lblPx - 0.5), dpi, pal, '700', _BR_FONT_SANS
        );
        ctx.restore();
      }
    }

    // 5. Carrier Dual Matching Perimeter Enthalpy Tick Callouts (bottom & right exit edges)
    if (isCarrier && typeof wAtH === 'function' && Number.isFinite(startH) && Number.isFinite(endH)) {
      const yBot = rect.y + rect.h;
      const xRight = rect.x + rect.w;
      const calloutPx = Math.max(7.5, lblPx - 1.5);
      const wSatMax = Psy.wsat_at(view.tMax, pPa);
      let lastBotX = -Infinity;
      let lastRightY = Infinity;

      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.9, 1.15 * dpi);
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([]);

      for (let hVal = startH; hVal <= endH + hStep * 1e-4; hVal += hStep) {
        const cleanH = Math.round(hVal / hStep) * hStep;
        const hText = _BR_fmtTick(cleanH, hStep);

        // Bottom perimeter exit (w = 0)
        const tDry = isSI ? (cleanH / 1.006) : CoreDOM.fToC(cleanH / 0.240);
        if (Number.isFinite(tDry) && tDry >= view.tMin && tDry <= view.tMax) {
          const px = _BR_crisp(this.xc(tDry));
          if (px >= rect.x + 18 * dpi && px <= xRight - 18 * dpi) {
            ctx.beginPath();
            ctx.moveTo(px, yBot);
            ctx.lineTo(px, yBot - 5.2 * dpi);
            ctx.stroke();

            if (px - lastBotX >= 24 * dpi) {
              this._textHalo(
                ctx, hText, px, yBot - 6.8 * dpi,
                col, 'center', 'alphabetic', calloutPx, dpi, pal, '600', _BR_FONT_MONO
              );
              lastBotX = px;
            }
          }
        }

        // Right perimeter exit (T = view.tMax, high-enthalpy lines)
        const wExit = wAtH(view.tMax, cleanH);
        if (Number.isFinite(wExit) && wExit > view.wMax * 0.02 && wExit < view.wMax * 0.985 && wExit <= wSatMax) {
          const py = _BR_crisp(this.yc(wExit));
          if (py >= rect.y + 14 * dpi && py <= yBot - 16 * dpi) {
            ctx.beginPath();
            ctx.moveTo(xRight, py);
            ctx.lineTo(xRight - 5.2 * dpi, py);
            ctx.stroke();

            if (Math.abs(py - lastRightY) >= 18 * dpi) {
              this._textHalo(
                ctx, hText, xRight - 7 * dpi, py,
                col, 'right', 'middle', calloutPx, dpi, pal, '600', _BR_FONT_MONO
              );
              lastRightY = py;
            }
          }
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /* ---- Layer 4: Crisp Axes, Tick Marks, Sub-Ticks, Dual Pv Scale, Labels & Export Header ---- */
  _drawAxesAndTicks(ctx, ticks, state, pal, dpi, opts, ax = _BR_DEFAULT_AXIS_STYLE) {
    const rect = this.getPlotRect();
    const isSI = state.units !== 'IP';
    const axisPx = pal.axisPx || 10;
    const tickCol = pal.border || pal.fg;
    const lblCol = pal.muted || pal.fg;
    const titleCol = pal.fg;
    const tickDir = ax?.tickDir || 'out';
    const showSubTicks = ax?.showSubTicks !== false;
    const yAxisSide = ax?.yAxisSide || 'both';
    const showDualPv = !!ax?.showDualPvScale;

    const majLen = 5.5 * dpi;
    const minLen = 3.0 * dpi;
    const lblGap = (tickDir === 'in' ? 5.5 : (tickDir === 'cross' ? 6.8 : 8.0)) * dpi;

    ctx.save();

    // -- Bottom X-Axis: Dry-Bulb Temperature --
    const yBot = _BR_crisp(rect.y + rect.h);
    ctx.strokeStyle = tickCol;
    ctx.setLineDash([]);

    // Minor X sub-ticks (optional)
    if (showSubTicks) {
      const [yMin0, yMin1] = _BR_tickSpan(yBot, 1, minLen, tickDir);
      ctx.lineWidth = Math.max(0.6, 0.8 * dpi);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let i = 0; i < ticks.tMinor.length; i++) {
        const px = _BR_crisp(ticks.tMinor[i].px);
        if (px < rect.x - 1 || px > rect.x + rect.w + 1) continue;
        ctx.moveTo(px, yMin0);
        ctx.lineTo(px, yMin1);
      }
      ctx.stroke();
    }

    // Major X ticks & numeric labels
    const [yMaj0, yMaj1] = _BR_tickSpan(yBot, 1, majLen, tickDir);
    ctx.lineWidth = Math.max(0.8, 1.0 * dpi);
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    let lastXLabel = -Infinity;
    for (let i = 0; i < ticks.tMajor.length; i++) {
      const tk = ticks.tMajor[i];
      const px = _BR_crisp(tk.px);
      if (px < rect.x - 1 || px > rect.x + rect.w + 1) continue;
      ctx.moveTo(px, yMaj0);
      ctx.lineTo(px, yMaj1);

      if (px - lastXLabel >= 22 * dpi) {
        this._textHalo(
          ctx, tk.label, px, yBot + lblGap,
          lblCol, 'center', 'top', axisPx, dpi, pal, '500', _BR_FONT_MONO
        );
        lastXLabel = px;
      }
    }
    ctx.stroke();

    // Centered Bottom X-axis title
    const xTitle = isSI ? 'Dry-Bulb Temperature (°C)' : 'Dry-Bulb Temperature (°F)';
    this._textHalo(
      ctx, xTitle,
      rect.x + rect.w * 0.5, this.height - 8 * dpi,
      titleCol, 'center', 'alphabetic', axisPx + 0.5, dpi, pal, '600', _BR_FONT_SANS
    );

    // -- Top X-Axis: Duplicated Dry-Bulb Temperature Scale --
    const yTop = _BR_crisp(rect.y);
    ctx.strokeStyle = tickCol;
    ctx.setLineDash([]);

    // In 'ashrae-open' frame (which omits top/left box lines), draw a clean top axis line for the top scale
    if (ax?.frame === 'ashrae-open') {
      ctx.save();
      ctx.strokeStyle = pal.border || tickCol;
      ctx.lineWidth = Math.max(0.9, (pal.border_lw ?? 1.5) * 0.85 * dpi);
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.moveTo(_BR_crisp(rect.x), yTop);
      ctx.lineTo(_BR_crisp(rect.x + rect.w), yTop);
      ctx.stroke();
      ctx.restore();
    }

    // Minor Top X sub-ticks
    if (showSubTicks) {
      const [yTopMin0, yTopMin1] = _BR_tickSpan(yTop, -1, minLen, tickDir);
      ctx.strokeStyle = tickCol;
      ctx.lineWidth = Math.max(0.6, 0.8 * dpi);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let i = 0; i < ticks.tMinor.length; i++) {
        const px = _BR_crisp(ticks.tMinor[i].px);
        if (px < rect.x - 1 || px > rect.x + rect.w + 1) continue;
        ctx.moveTo(px, yTopMin0);
        ctx.lineTo(px, yTopMin1);
      }
      ctx.stroke();
    }

    // Major Top X ticks & numeric labels
    const [yTopMaj0, yTopMaj1] = _BR_tickSpan(yTop, -1, majLen, tickDir);
    ctx.strokeStyle = tickCol;
    ctx.lineWidth = Math.max(0.8, 1.0 * dpi);
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    let lastTopXLabel = -Infinity;
    for (let i = 0; i < ticks.tMajor.length; i++) {
      const tk = ticks.tMajor[i];
      const px = _BR_crisp(tk.px);
      if (px < rect.x - 1 || px > rect.x + rect.w + 1) continue;
      ctx.moveTo(px, yTopMaj0);
      ctx.lineTo(px, yTopMaj1);

      if (px - lastTopXLabel >= 22 * dpi) {
        this._textHalo(
          ctx, tk.label, px, yTop - lblGap,
          lblCol, 'center', 'bottom', axisPx, dpi, pal, '500', _BR_FONT_MONO
        );
        lastTopXLabel = px;
      }
    }
    ctx.stroke();

    // Centered Top X-axis title (sits cleanly above top ticks and below export title block if shown)
    const topTitleY = Math.max(12 * dpi, yTop - lblGap - (axisPx + 6) * dpi);
    if (!opts.includeTitle || topTitleY > 40 * dpi) {
      this._textHalo(
        ctx, xTitle,
        rect.x + rect.w * 0.5, topTitleY,
        titleCol, 'center', 'bottom', axisPx + 0.5, dpi, pal, '600', _BR_FONT_SANS
      );
    }

    // -- Y-Axis: Humidity Ratio (configurable: 'right' | 'both' | 'left') --
    const xRight = _BR_crisp(rect.x + rect.w);
    const xLeft = _BR_crisp(rect.x);
    const wUnit = isSI ? 'g/kg' : 'gr/lb';
    const rightPrimary = (yAxisSide === 'right' || yAxisSide === 'both');
    const leftPrimary = (yAxisSide === 'left' || yAxisSide === 'both');

    // Primary Right Y-axis ticks & labels
    if (rightPrimary) {
      if (showSubTicks) {
        const [rxMin0, rxMin1] = _BR_tickSpan(xRight, 1, minLen, tickDir);
        ctx.strokeStyle = tickCol;
        ctx.lineWidth = Math.max(0.6, 0.8 * dpi);
        ctx.globalAlpha = 0.48;
        ctx.beginPath();
        for (let i = 0; i < ticks.wMinor.length; i++) {
          const py = _BR_crisp(ticks.wMinor[i].py);
          if (py < rect.y - 1 || py > rect.y + rect.h + 1) continue;
          ctx.moveTo(rxMin0, py);
          ctx.lineTo(rxMin1, py);
        }
        ctx.stroke();
      }

      const [rxMaj0, rxMaj1] = _BR_tickSpan(xRight, 1, majLen, tickDir);
      ctx.strokeStyle = tickCol;
      ctx.lineWidth = Math.max(0.8, 1.0 * dpi);
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      let lastYLabel = Infinity;
      const rLblOff = showDualPv ? Math.min(lblGap, 7.2 * dpi) : lblGap;
      for (let i = 0; i < ticks.wMajor.length; i++) {
        const tk = ticks.wMajor[i];
        const py = _BR_crisp(tk.py);
        if (py < rect.y - 1 || py > rect.y + rect.h + 1) continue;

        ctx.moveTo(rxMaj0, py);
        ctx.lineTo(rxMaj1, py);

        if (Math.abs(py - lastYLabel) >= 16 * dpi) {
          this._textHalo(
            ctx, tk.label, xRight + rLblOff, py,
            lblCol, 'left', 'middle', axisPx, dpi, pal, '500', _BR_FONT_MONO
          );
          lastYLabel = py;
        }
      }
      ctx.stroke();

      // Unit tag above Right Y-axis (positioned cleanly clear of Pv header when dual Pv is active)
      this._textHalo(
        ctx, wUnit, xRight + (showDualPv ? 2 : 7) * dpi, rect.y - 6 * dpi,
        lblCol, 'left', 'alphabetic', Math.max(8, axisPx - (showDualPv ? 1.5 : 1)), dpi, pal, '600', _BR_FONT_MONO
      );
    } else if (yAxisSide === 'left') {
      // Subtle right reference ticks when Y-axis is set to left-only
      const [rxSub0, rxSub1] = _BR_tickSpan(xRight, 1, 4.5 * dpi, tickDir);
      ctx.strokeStyle = tickCol;
      ctx.lineWidth = Math.max(0.6, 0.9 * dpi);
      ctx.globalAlpha = 0.42;
      ctx.beginPath();
      for (let i = 0; i < ticks.wMajor.length; i++) {
        const py = _BR_crisp(ticks.wMajor[i].py);
        if (py < rect.y - 1 || py > rect.y + rect.h + 1) continue;
        ctx.moveTo(rxSub0, py);
        ctx.lineTo(rxSub1, py);
      }
      ctx.stroke();
    }

    // Primary Left Y-axis ticks & labels (only for 'both' or 'left' — 'right' keeps upper-left completely clean!)
    if (leftPrimary) {
      if (showSubTicks) {
        const [lxMin0, lxMin1] = _BR_tickSpan(xLeft, -1, minLen, tickDir);
        ctx.strokeStyle = tickCol;
        ctx.lineWidth = Math.max(0.6, 0.8 * dpi);
        ctx.globalAlpha = 0.48;
        ctx.beginPath();
        for (let i = 0; i < ticks.wMinor.length; i++) {
          const py = _BR_crisp(ticks.wMinor[i].py);
          if (py < rect.y - 1 || py > rect.y + rect.h + 1) continue;
          ctx.moveTo(lxMin0, py);
          ctx.lineTo(lxMin1, py);
        }
        ctx.stroke();
      }

      const [lxMaj0, lxMaj1] = _BR_tickSpan(xLeft, -1, majLen, tickDir);
      ctx.strokeStyle = tickCol;
      ctx.lineWidth = Math.max(0.8, 1.0 * dpi);
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      let lastLeftY = Infinity;
      for (let i = 0; i < ticks.wMajor.length; i++) {
        const tk = ticks.wMajor[i];
        const py = _BR_crisp(tk.py);
        if (py < rect.y - 1 || py > rect.y + rect.h + 1) continue;

        ctx.moveTo(lxMaj0, py);
        ctx.lineTo(lxMaj1, py);

        if (Math.abs(py - lastLeftY) >= 16 * dpi) {
          this._textHalo(
            ctx, tk.label, xLeft - lblGap, py,
            lblCol, 'right', 'middle', axisPx, dpi, pal, '500', _BR_FONT_MONO
          );
          lastLeftY = py;
        }
      }
      ctx.stroke();

      // Unit tag above Left Y-axis
      this._textHalo(
        ctx, wUnit, xLeft - 4 * dpi, rect.y - 6 * dpi,
        lblCol, 'right', 'alphabetic', Math.max(8, axisPx - 1), dpi, pal, '600', _BR_FONT_MONO
      );
    }

    // -- Optional Secondary Outer Right Scale: Water Vapor Pressure (Pv) --
    if (showDualPv) {
      this._drawDualPvScale(ctx, state, pal, dpi, ax);
    }

    // Draw vertical Right Y-axis title directly on canvas for exports (where HTML #yAxisLabel is absent)
    if (opts.includeTitle || opts.isExport) {
      const yTitle = isSI
        ? 'Humidity Ratio — g Water Vapour / kg Dry Air'
        : 'Humidity Ratio — Grains of Moisture / lb Dry Air';
      ctx.save();
      ctx.translate(this.width - 13 * dpi, rect.y + rect.h * 0.5);
      ctx.rotate(-Math.PI / 2);
      this._textHalo(
        ctx, yTitle, 0, 0,
        titleCol, 'center', 'middle', axisPx, dpi, pal, '600', _BR_FONT_SANS
      );
      ctx.restore();
    }

    // Optional top-left Title & Barometric Stamp (for PNG / Report exports)
    if (opts.includeTitle) {
      const meta = state.meta || {};
      const titleStr = [meta.name || 'PsychroChart Ultra 3.0', meta.version].filter(Boolean).join('  ');
      const pPa = state.pPa || Psy.P_STD || 101325;
      const altM = typeof Psy.invBaroAlt_m === 'function' ? Psy.invBaroAlt_m(pPa) : 0;

      const baroStr = isSI
        ? `Barometric: ${(pPa / 1000).toFixed(3)} kPa  •  Alt: ${Math.round(altM)} m  •  SI`
        : `Barometric: ${(pPa / 1000 / (Psy.KPA_PER_PSI || 6.894757)).toFixed(3)} psia  •  Alt: ${Math.round(altM * 3.28084)} ft  •  IP`;

      const extraParts = [baroStr];
      if (meta.company) extraParts.push(meta.company);
      if (meta.engineer) extraParts.push(meta.engineer);
      if (state.layers?.weather && state.weather?.sourceName) {
        extraParts.push(`Weather: ${state.weather.sourceName}`);
      }

      this._textHalo(
        ctx, titleStr,
        rect.x, 18 * dpi,
        titleCol, 'left', 'alphabetic', axisPx + 3.5, dpi, pal, '700', _BR_FONT_SANS
      );
      this._textHalo(
        ctx, extraParts.join('  •  '),
        rect.x, 34 * dpi,
        lblCol, 'left', 'alphabetic', Math.max(8.5, axisPx - 0.5), dpi, pal, '500', _BR_FONT_MONO
      );
    }

    ctx.restore();
  }

  /* ---- Layer 4b: Secondary Parallel Outer Right Vapor Pressure (Pv) Scale ---- */
  _drawDualPvScale(ctx, state, pal, dpi, ax = _BR_DEFAULT_AXIS_STYLE) {
    const rect = this.getPlotRect();
    const view = state.view || { tMin: -5, tMax: 50, wMax: 0.030 };
    const pPa = state.pPa || Psy.P_STD || 101325;
    const isSI = state.units !== 'IP';
    const axisPx = pal.axisPx || 10;
    const pvPx = Math.max(7.5, axisPx - 1.5);
    const tickCol = pal.border || pal.fg;
    const lblCol = pal.muted || pal.fg;
    const showSubTicks = ax?.showSubTicks !== false;
    const tickDir = ax?.tickDir || 'out';

    const pvRailX = _BR_crisp(rect.x + rect.w + 32 * dpi);
    if (pvRailX >= this.width - 14 * dpi) return;

    const pvMaxPa = Psy.pv_from_w(view.wMax, pPa);
    if (!Number.isFinite(pvMaxPa) || pvMaxPa <= 0) return;

    const pvMaxDisp = isSI
      ? (pvMaxPa / 1000)
      : ((pvMaxPa / 1000) * _BR_INHG_PER_KPA);
    const targetPv = CoreDOM.clamp(Math.round(rect.h / (48 * dpi)), 4, 10);
    const pvMajorStep = _BR_niceStep(Math.max(1e-4, pvMaxDisp), targetPv);
    const pvMinorStep = _BR_minorStep(pvMajorStep);
    const dec = pvMajorStep >= 1 ? 0 : Math.min(2, Math.max(1, Math.ceil(-Math.log10(pvMajorStep) - 1e-9)));

    const pvDispToPa = (vDisp) => isSI
      ? (vDisp * 1000)
      : ((vDisp / _BR_INHG_PER_KPA) * 1000);

    const yTop = _BR_crisp(rect.y);
    const yBot = _BR_crisp(rect.y + rect.h);

    ctx.save();
    ctx.setLineDash([]);

    // Parallel vertical rail spine + crisp top/bottom end caps
    ctx.strokeStyle = tickCol;
    ctx.lineWidth = Math.max(0.75, 0.95 * dpi);
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.moveTo(pvRailX, yTop);
    ctx.lineTo(pvRailX, yBot);
    ctx.moveTo(pvRailX - 2 * dpi, yTop);
    ctx.lineTo(pvRailX + 2 * dpi, yTop);
    ctx.moveTo(pvRailX - 2 * dpi, yBot);
    ctx.lineTo(pvRailX + 2 * dpi, yBot);
    ctx.stroke();

    // Minor Pv mini-ticks (thermodynamically exact via Psy.w_from_pv)
    if (showSubTicks && pvMinorStep > 0) {
      const [mx0, mx1] = _BR_tickSpan(pvRailX, 1, 2.4 * dpi, tickDir === 'in' ? 'in' : (tickDir === 'cross' ? 'cross' : 'out'));
      ctx.lineWidth = Math.max(0.5, 0.7 * dpi);
      ctx.globalAlpha = 0.44;
      ctx.beginPath();
      for (let v = pvMinorStep; v <= pvMaxDisp + pvMinorStep * 1e-4; v += pvMinorStep) {
        const rem = Math.abs(v / pvMajorStep - Math.round(v / pvMajorStep));
        if (rem < 1e-3) continue;
        const pvPa = pvDispToPa(v);
        if (pvPa >= pPa * 0.99) break;
        const w = Psy.w_from_pv(pvPa, pPa);
        if (!Number.isFinite(w) || w < 0 || w > view.wMax * 1.0005) continue;
        const py = _BR_crisp(this.yc(w));
        if (py < rect.y - 1 || py > rect.y + rect.h + 1) continue;
        ctx.moveTo(mx0, py);
        ctx.lineTo(mx1, py);
      }
      ctx.stroke();
    }

    // Major Pv ticks & numeric labels
    const [tx0, tx1] = _BR_tickSpan(pvRailX, 1, 4.4 * dpi, tickDir === 'in' ? 'in' : (tickDir === 'cross' ? 'cross' : 'out'));
    const pvLblOff = (tickDir === 'in' ? 4.2 : 6.0) * dpi;
    ctx.lineWidth = Math.max(0.75, 0.95 * dpi);
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    let lastPvY = Infinity;
    for (let v = 0; v <= pvMaxDisp + pvMajorStep * 1e-4; v += pvMajorStep) {
      const cleanV = Math.round(v / pvMajorStep) * pvMajorStep;
      const pvPa = pvDispToPa(cleanV);
      if (pvPa >= pPa * 0.99) break;
      const w = Psy.w_from_pv(pvPa, pPa);
      if (!Number.isFinite(w) || w < -1e-9 || w > view.wMax * 1.0005) continue;
      const py = _BR_crisp(this.yc(Math.max(0, w)));
      if (py < rect.y - 1 || py > rect.y + rect.h + 1) continue;

      ctx.moveTo(tx0, py);
      ctx.lineTo(tx1, py);

      if (Math.abs(py - lastPvY) >= 14 * dpi) {
        const txt = Math.abs(cleanV) < 1e-9 ? '0' : cleanV.toFixed(dec);
        this._textHalo(
          ctx, txt, pvRailX + pvLblOff, py,
          lblCol, 'left', 'middle', pvPx, dpi, pal, '500', _BR_FONT_MONO
        );
        lastPvY = py;
      }
    }
    ctx.stroke();

    // Secondary Pv header cleanly positioned above the Pv rail
    const pvHdr = isSI ? 'Pv (kPa)' : 'Pv (in.Hg)';
    this._textHalo(
      ctx, pvHdr, pvRailX, rect.y - 6 * dpi,
      lblCol, 'left', 'alphabetic', Math.max(7.5, axisPx - 1.5), dpi, pal, '600', _BR_FONT_MONO
    );

    ctx.restore();
  }

  /* ---- Layer 5: Authentic Plot Frame Border ('ashrae-open' | 'full-box' | 'cad-ticks') ---- */
  _drawPlotFrame(ctx, state, pal, dpi, ax = null) {
    const resolvedAx = ax || this._resolveAxisStyle(state || this._lastState || {}, pal);
    const frameStyle = resolvedAx?.frame || 'full-box';
    const rect = this.getPlotRect();
    const x = _BR_crisp(rect.x);
    const y = _BR_crisp(rect.y);
    const w = Math.round(rect.w);
    const h = Math.round(rect.h);

    ctx.save();
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = Math.max(1, (pal.border_lw ?? 1.5) * dpi);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'square';

    if (frameStyle === 'ashrae-open') {
      // Authentic ASHRAE Handbook & Carrier open-frame: ONLY bottom Dry-Bulb + right Humidity Ratio axes
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w, y);
      ctx.stroke();
    } else if (frameStyle === 'cad-ticks') {
      // Crisp 4-sided engineering CAD frame
      ctx.strokeRect(x, y, w, h);

      // Subtle outer border hairline
      const off = Math.round(3 * dpi);
      const ox = x - off;
      const oy = y - off;
      const ow = w + off * 2;
      const oh = h + off * 2;
      ctx.lineWidth = Math.max(0.5, 0.65 * dpi);
      ctx.globalAlpha = 0.36;
      ctx.strokeRect(ox, oy, ow, oh);

      // Corner precision registration marks (6 * dpi CAD L-ticks at all 4 corners)
      const arm = 6 * dpi;
      ctx.lineWidth = Math.max(1.1, 1.35 * dpi);
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      // Top-Left L-tick
      ctx.moveTo(ox, oy + arm);
      ctx.lineTo(ox, oy);
      ctx.lineTo(ox + arm, oy);
      // Top-Right L-tick
      ctx.moveTo(ox + ow - arm, oy);
      ctx.lineTo(ox + ow, oy);
      ctx.lineTo(ox + ow, oy + arm);
      // Bottom-Left L-tick
      ctx.moveTo(ox, oy + oh - arm);
      ctx.lineTo(ox, oy + oh);
      ctx.lineTo(ox + arm, oy + oh);
      // Bottom-Right L-tick
      ctx.moveTo(ox + ow - arm, oy + oh);
      ctx.lineTo(ox + ow, oy + oh);
      ctx.lineTo(ox + ow, oy + oh - arm);
      ctx.stroke();
    } else {
      // 'full-box': crisp 4-sided engineering frame
      ctx.strokeRect(x, y, w, h);
    }

    ctx.restore();
  }

  // Backwards-compatible alias for _drawPlotFrame
  _drawPlotBorder(ctx, pal, dpi) {
    this._drawPlotFrame(ctx, this._lastState || {}, pal, dpi);
  }
}
