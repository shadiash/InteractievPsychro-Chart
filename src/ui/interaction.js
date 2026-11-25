/* ============================================================================
   PsychroChart Ultra 3.0 — Chart Interaction, Gestures, Precision Tools,
   Viewport-Clamped Context Menu, HUD, Splitters, Layer Pills & Shortcuts
   ============================================================================ */

import { CoreDOM, DEFAULT_LAYERS, POINT_PALETTE } from '../core/contracts.js';
import { Psy } from '../engine/psychro.js';
import { HVAC } from '../engine/hvac.js';

const _IX_T_HARD_MIN = -50;     // °C (matches store VIEW_BOUNDS)
const _IX_T_HARD_MAX = 85;      // °C
const _IX_MIN_T_SPAN = 2;       // °C
const _IX_MAX_T_SPAN = 135;     // °C
const _IX_W_HARD_MIN = 0.002;   // kg/kg (2 g/kg)
const _IX_W_HARD_MAX = 0.065;   // kg/kg (65 g/kg)

const _IX_DEFAULT_LEFT_W = 360;
const _IX_DEFAULT_RIGHT_W = 396;

const _IX_LAYER_PILLS = [
  { key: 'grid',        label: 'Grid',    dot: '--grid2',  fallback: '#475569', title: 'Major & Minor Grid (G)' },
  { key: 'sat',         label: 'Sat',     dot: '--sat',    fallback: '#22d3ee', title: 'Saturation Curve (1)' },
  { key: 'rh',          label: 'RH',      dot: '--rh',     fallback: '#38bdf8', title: 'Relative Humidity Curves (2)' },
  { key: 'wb',          label: 'WB',      dot: '--wb',     fallback: '#f59e0b', title: 'Wet-Bulb Lines (3)' },
  { key: 'enth',        label: 'h',       dot: '--enth',   fallback: '#fb923c', title: 'Enthalpy Lines (4)' },
  { key: 'vlines',      label: 'Vol',     dot: '--vline',  fallback: '#84cc16', title: 'Specific Volume Lines (5)' },
  { key: 'dp',          label: 'Tdp',     dot: '--dpline', fallback: '#94a3b8', title: 'Dew-Point Lines (D)' },
  { key: 'comfort',     label: 'Comfort', dot: '--humid',  fallback: '#10b981', title: 'ASHRAE 55 Comfort Zone (C)' },
  { key: 'weather',     label: 'Weather', dot: '--warn',   fallback: '#f59e0b', title: 'Weather Heatmap Overlay (W)' },
  { key: 'points',      label: 'Pts',     dot: '--pt',     fallback: '#f43f5e', title: 'State Points (6)' },
  { key: 'processes',   label: 'Proc',    dot: '--heat',   fallback: '#ef4444', title: 'HVAC Processes (7)' },
  { key: 'annotations', label: 'Notes',   dot: '--accent', fallback: '#0ea5e9', title: 'Engineering Annotations' },
  { key: 'flowAnim',    label: 'Flow',    dot: '--sat',    fallback: '#06b6d4', title: 'Animated Airflow Arrows (A)' }
];

const _IX_COMFORT_CYCLE = ['none', 'summer', 'winter', 'both'];
const _IX_HOTKEY_LAYERS = ['sat', 'rh', 'wb', 'enth', 'vlines', 'points', 'processes'];

export function initChartInteraction(store, baseRenderer, overlayRenderer, callbacks = {}) {
  const { byId, esc, clamp, cToF, fToC, tToDisp } = CoreDOM;

  const cvOverlay = byId('cvOverlay') || byId('cv');
  const chartWrap = byId('chartWrap');
  const chartStage = byId('chartStage') || chartWrap;
  const chartToolbarEl = byId('chartToolbar');
  const hudEl = byId('hud');
  const modeBannerEl = byId('modeBanner');
  const ctxMenuEl = byId('ctxMenu');
  const layerTogglesEl = byId('layerToggles');
  if (ctxMenuEl && !ctxMenuEl.hasAttribute('role')) {
    ctxMenuEl.setAttribute('role', 'menu');
  }

  function getToolbarBottomCss() {
    // When #chartStage is separate from docked #chartToolbar, toolbar never overlaps canvas
    if (byId('chartStage')) return 10;
    if (!chartToolbarEl) return 56;
    const h = chartToolbarEl.offsetHeight;
    if (!h) return 56;
    return chartToolbarEl.offsetTop + h + 8;
  }

  const toolButtons = {
    select:   byId('btnToolSelect'),
    process:  byId('btnToolProcess'),
    mix:      byId('btnToolMix'),
    measure:  byId('btnToolMeasure'),
    annotate: byId('btnToolAnnotate'),
    boxzoom:  byId('btnToolBoxZoom')
  };

  // Teardown listener registry
  const cleanups = [];
  function bind(node, evt, fn, opts) {
    if (!node) return;
    node.addEventListener(evt, fn, opts);
    cleanups.push(() => node.removeEventListener(evt, fn, opts));
  }

  function toast(msg, type = 'info', anchor = null) {
    if (typeof callbacks.toast === 'function') {
      callbacks.toast(msg, type, anchor);
    } else if (typeof store?.toast === 'function') {
      store.toast(msg, type, anchor);
    }
  }

  // --------------------------------------------------------------------------
  // State & Store Accessors (Strict SI internally)
  // --------------------------------------------------------------------------
  function getState() {
    return store?.state || store || {};
  }

  function getUI() {
    const st = getState();
    if (!st.ui) {
      st.ui = {
        selectedPtId: null,
        selectedProcId: null,
        activeTool: 'select',
        toolStep: null,
        measureStart: null,
        measureEnd: null,
        boxZoom: null,
        hoverPx: null,
        hoverPy: null,
        hovPickId: null,
        hovLabelId: null,
        leftCollapsed: false,
        rightCollapsed: false
      };
    }
    return st.ui;
  }

  function getUnits() {
    return getState().units === 'IP' ? 'IP' : 'SI';
  }

  function getPressurePa() {
    const p = getState().pPa;
    return Number.isFinite(p) && p > 10000 ? p : 101325;
  }

  function getView() {
    const st = getState();
    if (!st.view) {
      st.view = { tMin: -10, tMax: 55, wMax: 0.030 };
    }
    return st.view;
  }

  function getPoints() {
    const st = getState();
    if (!Array.isArray(st.points)) st.points = [];
    return st.points;
  }

  function getProcesses() {
    const st = getState();
    if (!Array.isArray(st.processes)) st.processes = [];
    return st.processes;
  }

  function getAnnotations() {
    const st = getState();
    if (!Array.isArray(st.annotations)) st.annotations = [];
    return st.annotations;
  }

  function getLayers() {
    const st = getState();
    if (!st.layers) st.layers = { ...DEFAULT_LAYERS };
    return st.layers;
  }

  function getPoint(id) {
    if (id == null) return null;
    if (typeof store?.getPoint === 'function') return store.getPoint(id);
    return getPoints().find(p => p.id === id) || null;
  }

  function getProcess(id) {
    if (id == null) return null;
    if (typeof store?.getProcess === 'function') return store.getProcess(id);
    return getProcesses().find(p => p.id === id) || null;
  }

  function getAnnotation(id) {
    if (id == null) return null;
    return getAnnotations().find(a => a.id === id) || null;
  }

  function getProcEndpoints(proc) {
    if (!proc) return { a: null, b: null };
    const aId = proc.aId ?? proc.fromId ?? proc.startId;
    const bId = proc.bId ?? proc.toId ?? proc.endId;
    return { a: getPoint(aId), b: getPoint(bId) };
  }

  function nextPointLabel() {
    const pts = getPoints();
    const used = new Set(pts.map(p => String(p.label || '').trim()));
    let n = pts.length + 1;
    while (used.has(`P${n}`)) n++;
    return `P${n}`;
  }

  function nextPointColor() {
    return POINT_PALETTE[getPoints().length % POINT_PALETTE.length];
  }

  // rAF-coalesced rendering (uses BaseRenderer fingerprint cache + OverlayRenderer)
  let _rafFull = 0;
  let _rafOverlay = 0;

  function renderOverlayNow() {
    _rafOverlay = 0;
    const st = getState();
    if (typeof overlayRenderer?.render === 'function') {
      overlayRenderer.render(st);
    }
  }

  function renderFullNow() {
    _rafFull = 0;
    const st = getState();
    if (typeof baseRenderer?.render === 'function') {
      baseRenderer.render(st, false);
    }
    if (typeof overlayRenderer?.render === 'function') {
      overlayRenderer.render(st);
    }
  }

  function scheduleOverlayRender() {
    if (_rafOverlay) return;
    _rafOverlay = requestAnimationFrame(renderOverlayNow);
  }

  function scheduleFullRender(forceBase = false) {
    if (forceBase && typeof baseRenderer?.invalidate === 'function') {
      baseRenderer.invalidate();
    }
    if (_rafFull) return;
    _rafFull = requestAnimationFrame(renderFullNow);
  }

  function emitOverlayDirty(reason = 'interaction') {
    if (typeof store?.emit === 'function') {
      store.emit('overlay-dirty', { reason });
    } else {
      scheduleOverlayRender();
    }
  }

  // --------------------------------------------------------------------------
  // Runtime Drag & Tool State
  // --------------------------------------------------------------------------
  let dragKind = null; // null | 'pan' | 'point' | 'locked-mix' | 'label' | 'annotation' | 'measure' | 'boxzoom'
  let dragMoved = false;
  let dragHistoryPushed = false;
  let dragStartPx = { x: 0, y: 0 };
  let dragLastPx = { x: 0, y: 0 };
  let dragOriginTw = { T: 0, w: 0 };
  let dragLabelOffsetPx = { dx: 0, dy: 0 };
  let dragAnnOffsetTw = { dT: 0, dw: 0 };
  let dragTargetId = null;
  let boxZoomViaAlt = false;
  let spacePan = false;
  let suppressNextClick = false;
  let activeSnapLabel = null;
  let measureLocked = false;
  let lastActiveComfortMode = 'both';

  const ctxTarget = {
    T: 24,
    w: 0.010,
    cssX: 0,
    cssY: 0,
    pointId: null,
    procId: null,
    annotationId: null
  };

  // --------------------------------------------------------------------------
  // DPI-Exact Coordinate Transforms (matches BaseRenderer & OverlayRenderer)
  // --------------------------------------------------------------------------
  function getDpi() {
    if (baseRenderer && Number.isFinite(baseRenderer.dpi) && baseRenderer.dpi > 0) {
      return baseRenderer.dpi;
    }
    if (cvOverlay) {
      const rect = cvOverlay.getBoundingClientRect();
      if (rect.width > 0 && cvOverlay.width > 0) {
        return cvOverlay.width / rect.width;
      }
    }
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  function clientToCanvasPx(clientX, clientY) {
    if (!cvOverlay) return { px: 0, py: 0, cssX: 0, cssY: 0, dpi: 1, inside: false };
    const rect = cvOverlay.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const dpi = getDpi();
    return {
      px: cssX * dpi,
      py: cssY * dpi,
      cssX,
      cssY,
      dpi,
      inside: cssX >= 0 && cssY >= 0 && cssX <= rect.width && cssY <= rect.height
    };
  }

  function getPlotRectPx() {
    if (typeof baseRenderer?.getPlotRect === 'function') {
      const r = baseRenderer.getPlotRect();
      if (r && r.w > 10 && r.h > 10) {
        return { x: r.x, y: r.y, w: r.w, h: r.h, right: r.x + r.w, bottom: r.y + r.h };
      }
    }
    const dpi = getDpi();
    const W = (cvOverlay?.width || 800);
    const H = (cvOverlay?.height || 500);
    const padL = 44 * dpi;
    const padR = 68 * dpi;
    const padT = 34 * dpi;
    const padB = 46 * dpi;
    const w = Math.max(20, W - padL - padR);
    const h = Math.max(20, H - padT - padB);
    return { x: padL, y: padT, w, h, right: padL + w, bottom: padT + h };
  }

  function pxToTw(px, py) {
    if (typeof baseRenderer?.invT === 'function' && typeof baseRenderer?.invW === 'function') {
      const T = baseRenderer.invT(px);
      const w = baseRenderer.invW(py);
      if (Number.isFinite(T) && Number.isFinite(w)) return { T, w };
    }
    const plot = getPlotRectPx();
    const v = getView();
    return {
      T: v.tMin + ((px - plot.x) / Math.max(1, plot.w)) * (v.tMax - v.tMin),
      w: ((plot.bottom - py) / Math.max(1, plot.h)) * v.wMax
    };
  }

  function twToPx(T, w) {
    if (typeof baseRenderer?.xc === 'function' && typeof baseRenderer?.yc === 'function') {
      const x = baseRenderer.xc(T);
      const y = baseRenderer.yc(w);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    const plot = getPlotRectPx();
    const v = getView();
    return {
      x: plot.x + ((T - v.tMin) / Math.max(1e-6, v.tMax - v.tMin)) * plot.w,
      y: plot.bottom - (w / Math.max(1e-6, v.wMax)) * plot.h
    };
  }

  function clampTwToSaturation(T, w, clampToView = false) {
    const v = getView();
    const pPa = getPressurePa();
    const tLo = clampToView ? v.tMin : _IX_T_HARD_MIN;
    const tHi = clampToView ? v.tMax : _IX_T_HARD_MAX;
    const Tc = clamp(T, tLo, tHi);
    const ws = Psy.wsat_at(Tc, pPa);
    const wc = clamp(w, 0, Math.min(ws, _IX_W_HARD_MAX));
    return { T: Tc, w: wc };
  }

  // --------------------------------------------------------------------------
  // Hit Testing (Delegates directly to OverlayRenderer's exact DPI geometry)
  // --------------------------------------------------------------------------
  function pickPointAtPx(px, py) {
    const st = getState();
    if (typeof overlayRenderer?.pickPoint === 'function') {
      return overlayRenderer.pickPoint(px, py, st);
    }
    if (getLayers().points === false) return null;
    const threshSq = (16 * getDpi()) ** 2;
    let bestId = null;
    let bestD = threshSq;
    for (const p of getPoints()) {
      const pos = twToPx(p.T, p.w);
      const d = (px - pos.x) ** 2 + (py - pos.y) ** 2;
      if (d <= bestD) {
        bestD = d;
        bestId = p.id;
      }
    }
    return bestId;
  }

  function pickLabelAtPx(px, py) {
    const st = getState();
    if (typeof overlayRenderer?.pickLabel === 'function') {
      return overlayRenderer.pickLabel(px, py, st);
    }
    return null;
  }

  function pickProcessAtPx(px, py) {
    const st = getState();
    if (typeof overlayRenderer?.pickProcess === 'function') {
      return overlayRenderer.pickProcess(px, py, st);
    }
    return null;
  }

  function pickAnnotationAtPx(px, py) {
    const st = getState();
    if (typeof overlayRenderer?.pickAnnotation === 'function') {
      return overlayRenderer.pickAnnotation(px, py, st);
    }
    return null;
  }

  function pickSHRAtPx(px, py) {
    const st = getState();
    if (!st?.shr?.show) return null;
    const geom = overlayRenderer?.getSHRGeometry?.();
    if (!geom) return null;
    const dpi = getDpi();

    // 1. Circular Protractor Dial (center, ring & outer scale)
    if (Math.hypot(px - geom.cx, py - geom.cy) <= geom.R + 18 * dpi) {
      return 'dial';
    }

    // 2. Free / center-anchored Reference Line grab handle
    if (!geom.isPointAnchored && Number.isFinite(geom.anchorPx) && Number.isFinite(geom.anchorPy)) {
      if (Math.hypot(px - geom.anchorPx, py - geom.anchorPy) <= 13 * dpi) {
        return 'anchor';
      }
    }

    // 3. Dashed SHR Reference Slope Line segment (slideable parallel ruler)
    if (geom.lineSeg) {
      const { x1, y1, x2, y2 } = geom.lineSeg;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq > 4) {
        const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
        const nx = x1 + t * dx;
        const ny = y1 + t * dy;
        if (Math.hypot(px - nx, py - ny) <= 9 * dpi) {
          return 'line';
        }
      }
    }
    return null;
  }

  function computeShrFromDialPx(px, py, geom, shiftKey = false) {
    if (!geom) return getState().shr?.value ?? 0.75;
    const dx = px - geom.cx;
    const dy = py - geom.cy;
    if (Math.hypot(dx, dy) < 4) {
      return geom.shr ?? (getState().shr?.value ?? 0.75);
    }
    // Map pulls on either semicircle (SHR right or Δh/ΔW left) to canonical right-going slope ray
    const runPx = dx >= 0 ? dx : -dx;
    const risePx = dx >= 0 ? -dy : dy;
    let rawShr;
    if (runPx < 1e-3) {
      rawShr = 0.0;
    } else {
      const slope = (risePx / Math.max(1e-6, geom.pxPerKgKg)) / (runPx / Math.max(1e-6, geom.pxPerDegC));
      const cpm = geom.cpm || 1.02;
      const denom = cpm + 2501 * slope;
      if (Math.abs(denom) < 1e-4) {
        rawShr = denom >= 0 ? 2.0 : -2.0;
      } else {
        rawShr = cpm / denom;
      }
    }
    const clamped = clamp(rawShr, -2.0, 2.0);
    const step = shiftKey ? 0.05 : 0.01;
    const snapped = Math.round(clamped / step) * step;
    return Math.abs(snapped) < 1e-9 ? 0 : Number(snapped.toFixed(2));
  }

  // --------------------------------------------------------------------------
  // Psychrometric State, HUD & 10-Property Clipboard Formatter (SI & True IP)
  // --------------------------------------------------------------------------
  function getPsychroState(T, w) {
    const pPa = getPressurePa();
    if (typeof Psy.stateFromTw === 'function') {
      return Psy.stateFromTw(T, w, pPa);
    }
    const ws = Psy.wsat_at(T, pPa);
    const wc = clamp(w, 0, ws);
    const pv = Psy.pv_from_w(wc, pPa);
    const rh01 = Psy.RH_from_Tw(T, wc, pPa);
    const h = Psy.h_kJkg(T, wc);
    const hIP = typeof Psy.h_Btulb === 'function'
      ? Psy.h_Btulb(T, wc)
      : (0.240 * cToF(T) + wc * (1061 + 0.444 * cToF(T)));
    const v = Psy.v_m3kg(T, wc, pPa);
    const vIP = v * 16.01846337;
    const rhoMoist = (1 + wc) / Math.max(1e-6, v);
    const rhoMoistIP = rhoMoist * 0.0624279606;
    const Tdp = Psy.dewpoint_from_pv(pv);
    const Twb = Psy.twb_from_Tw(T, wc, pPa);
    const mu = ws > 0 ? clamp(wc / ws, 0, 1) : 0;
    return { T, w: wc, rh: rh01 * 100, pv, h, hIP, v, vIP, rhoMoist, rhoMoistIP, Tdp, Twb, mu, pPa };
  }

  function hudItem(lbl, val) {
    return `<span class="hud-item"><span class="hud-lbl">${esc(lbl)}</span><span class="hud-val">${esc(val)}</span></span>`;
  }

  function hideHud() {
    if (hudEl) hudEl.classList.add('hidden');
  }

  function updateHudAtTw(T, w, badgeText = null) {
    if (!hudEl) return;
    const v = getView();
    const pPa = getPressurePa();
    const ws = Psy.wsat_at(T, pPa);

    if (!badgeText && (T < v.tMin - 1.5 || T > v.tMax + 1.5 || w < -0.001 || w > Math.max(ws * 1.15, v.wMax * 1.05))) {
      hideHud();
      return;
    }

    const s = getPsychroState(T, clamp(w, 0, ws));
    const isSI = getUnits() === 'SI';

    const items = [];
    if (badgeText) {
      items.push(`<span class="hud-item"><span class="hud-val" style="color:var(--warn)">${esc(badgeText)}</span></span>`);
    }

    items.push(
      hudItem('Tdb', isSI ? `${s.T.toFixed(1)}°C` : `${cToF(s.T).toFixed(1)}°F`),
      hudItem('W',   isSI ? `${(s.w * 1000).toFixed(2)} g/kg` : `${(s.w * 7000).toFixed(1)} gr/lb`),
      hudItem('RH',  `${s.rh.toFixed(1)}%`),
      hudItem('Twb', isSI ? `${s.Twb.toFixed(1)}°C` : `${cToF(s.Twb).toFixed(1)}°F`),
      hudItem('Tdp', isSI ? `${s.Tdp.toFixed(1)}°C` : `${cToF(s.Tdp).toFixed(1)}°F`),
      hudItem('h',   isSI ? `${s.h.toFixed(1)} kJ/kg` : `${s.hIP.toFixed(1)} Btu/lb`),
      hudItem('v',   isSI ? `${s.v.toFixed(3)} m³/kg` : `${s.vIP.toFixed(2)} ft³/lb`),
      hudItem('ρ',   isSI ? `${s.rhoMoist.toFixed(3)} kg/m³` : `${s.rhoMoistIP.toFixed(4)} lb/ft³`)
    );

    hudEl.innerHTML = items.join('<span class="hud-sep"></span>');
    hudEl.classList.remove('hidden');
  }

  function updateHudMeasure(start, end) {
    if (!hudEl || !start || !end) return;
    const pPa = getPressurePa();
    const isSI = getUnits() === 'SI';
    const metrics = typeof HVAC?.calcProcessMetrics === 'function'
      ? HVAC.calcProcessMetrics(start, end, pPa, 1000, 'Lps')
      : null;

    const dT = metrics ? metrics.dT : (end.T - start.T);
    const dW = metrics ? metrics.dW : (end.w - start.w);
    const dhSI = metrics ? metrics.dh : (Psy.h_kJkg(end.T, end.w) - Psy.h_kJkg(start.T, start.w));
    const dhIP = metrics ? metrics.dhIP : (Psy.h_Btulb(end.T, end.w) - Psy.h_Btulb(start.T, start.w));
    const shr = metrics ? metrics.SHR : (Math.abs(dhSI) > 1e-6 ? (1.006 * dT) / dhSI : NaN);
    const procName = metrics?.typeInfo?.shortType || (typeof HVAC?.classifyProcess === 'function' ? HVAC.classifyProcess(start, end, pPa)?.shortType : '');

    const sign = n => (n >= 0 ? '+' : '');
    const dTStr = isSI ? `${sign(dT)}${dT.toFixed(2)}°C` : `${sign(dT)}${(dT * 1.8).toFixed(2)}°F`;
    const dWVal = isSI ? dW * 1000 : dW * 7000;
    const dWStr = isSI ? `${sign(dWVal)}${dWVal.toFixed(2)} g/kg` : `${sign(dWVal)}${dWVal.toFixed(1)} gr/lb`;
    const dhVal = isSI ? dhSI : dhIP;
    const dhStr = isSI ? `${sign(dhVal)}${dhVal.toFixed(2)} kJ/kg` : `${sign(dhVal)}${dhVal.toFixed(2)} Btu/lb`;
    const shrStr = Number.isFinite(shr) ? clamp(shr, -9.99, 9.99).toFixed(2) : '—';

    const items = [
      `<span class="hud-item"><span class="hud-val" style="color:var(--sat)">RULER</span></span>`,
      hudItem('ΔT', dTStr),
      hudItem('ΔW', dWStr),
      hudItem('Δh', dhStr),
      hudItem('SHR', shrStr)
    ];
    if (procName) {
      items.push(`<span class="hud-item"><span class="hud-val" style="color:var(--accent)">${esc(procName)}</span></span>`);
    }

    hudEl.innerHTML = items.join('<span class="hud-sep"></span>');
    hudEl.classList.remove('hidden');
  }

  function resolveCurrentShrRefPt() {
    const st = getState();
    const shr = st?.shr || {};
    const explicitId = shr.refPtId ?? shr.refPointId;
    if (explicitId != null && explicitId !== '') {
      const pt = getPoint(explicitId);
      if (pt) return { T: pt.T, w: pt.w, label: pt.label || 'Point' };
    }
    if (shr.anchorTw && Number.isFinite(shr.anchorTw.T) && Number.isFinite(shr.anchorTw.w)) {
      return { T: shr.anchorTw.T, w: shr.anchorTw.w, label: 'Custom' };
    }
    const v = getView();
    const pPa = getPressurePa();
    const centerT = 0.5 * (v.tMin + v.tMax);
    const centerW = Math.max(0.0005, Math.min(0.45 * v.wMax, Psy.wsat_at(centerT, pPa) * 0.72));
    return { T: centerT, w: centerW, label: 'Center' };
  }

  function updateHudShr(shrVal, snapPtLabel = null) {
    if (!hudEl) return;
    const isSI = getUnits() === 'SI';
    const refPt = resolveCurrentShrRefPt();
    const solved = typeof HVAC?.solveSHRSaturation === 'function'
      ? HVAC.solveSHRSaturation(refPt, shrVal, getPressurePa())
      : null;

    let dhdwStr;
    if (Math.abs(1 - shrVal) < 1e-4) {
      dhdwStr = '∞ (Sensible)';
    } else {
      const si = 2501 / (1 - shrVal);
      const disp = isSI ? si : si / 2.326;
      const fmt = Math.abs(disp) >= 1000 ? `${(disp / 1000).toFixed(1)}k` : disp.toFixed(0);
      dhdwStr = `${fmt} ${isSI ? 'kJ/kg' : 'Btu/lb'}`;
    }

    let satStr = '—';
    if (solved?.satHit && Number.isFinite(solved.satHit.T)) {
      satStr = isSI ? `${solved.satHit.T.toFixed(1)}°C` : `${cToF(solved.satHit.T).toFixed(1)}°F`;
    } else if (solved?.satStatus === 'no-hit') {
      satStr = 'No Hit (Reheat Req.)';
    }

    const items = [
      `<span class="hud-item"><span class="hud-val" style="color:var(--warn)">SHR DIAL</span></span>`,
      hudItem('SHR', Number(shrVal).toFixed(2)),
      hudItem('Δh/ΔW', dhdwStr),
      hudItem(shrVal > 0 && shrVal <= 1 ? 'Sat / ADP' : 'Sat Hit', satStr)
    ];
    if (snapPtLabel) {
      items.push(`<span class="hud-item"><span class="hud-val" style="color:var(--accent)">Anchor → ${esc(snapPtLabel)}</span></span>`);
    } else if (refPt?.label) {
      items.push(hudItem('Anchor', refPt.label));
    }

    hudEl.innerHTML = items.join('<span class="hud-sep"></span>');
    hudEl.classList.remove('hidden');
  }

  function format10PropertiesText(T, w, title = '') {
    const s = getPsychroState(T, w);
    const isSI = getUnits() === 'SI';
    const lines = [];
    if (title) lines.push(`[${title}]`);
    if (isSI) {
      lines.push(`Tdb = ${s.T.toFixed(2)} °C`);
      lines.push(`Twb = ${s.Twb.toFixed(2)} °C`);
      lines.push(`Tdp = ${s.Tdp.toFixed(2)} °C`);
      lines.push(`RH  = ${s.rh.toFixed(1)} %`);
      lines.push(`W   = ${(s.w * 1000).toFixed(2)} g/kg`);
      lines.push(`h   = ${s.h.toFixed(2)} kJ/kg`);
      lines.push(`v   = ${s.v.toFixed(4)} m³/kg`);
      lines.push(`ρ   = ${s.rhoMoist.toFixed(4)} kg/m³`);
      lines.push(`pv  = ${(s.pv / 1000).toFixed(3)} kPa`);
      lines.push(`μ   = ${(s.mu * 100).toFixed(1)} % (P = ${(s.pPa / 1000).toFixed(2)} kPa)`);
    } else {
      lines.push(`Tdb = ${cToF(s.T).toFixed(2)} °F`);
      lines.push(`Twb = ${cToF(s.Twb).toFixed(2)} °F`);
      lines.push(`Tdp = ${cToF(s.Tdp).toFixed(2)} °F`);
      lines.push(`RH  = ${s.rh.toFixed(1)} %`);
      lines.push(`W   = ${(s.w * 7000).toFixed(1)} gr/lb`);
      lines.push(`h   = ${s.hIP.toFixed(2)} Btu/lb`);
      lines.push(`v   = ${s.vIP.toFixed(3)} ft³/lb`);
      lines.push(`ρ   = ${s.rhoMoistIP.toFixed(4)} lb/ft³`);
      lines.push(`pv  = ${(s.pv / 6894.757293).toFixed(4)} psia`);
      lines.push(`μ   = ${(s.mu * 100).toFixed(1)} % (P = ${(s.pPa / 6894.757293).toFixed(3)} psia)`);
    }
    return lines.join('\n');
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
    }
    fallbackCopyText(text);
    return Promise.resolve();
  }

  function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (_) {
      // Ignore copy errors in restricted sandboxes
    }
    document.body.removeChild(ta);
  }

  // --------------------------------------------------------------------------
  // View Bounds, Cursor-Anchored Zoom, Pan, Fit Points, Reset Zoom
  // --------------------------------------------------------------------------
  function syncViewInputs() {
    const v = getView();
    const units = getUnits();
    const active = document.activeElement;
    const elMin = byId('tMin');
    const elMax = byId('tMax');
    const elWMax = byId('wMax');
    if (elMin && active !== elMin) elMin.value = tToDisp(v.tMin, units).toFixed(1);
    if (elMax && active !== elMax) elMax.value = tToDisp(v.tMax, units).toFixed(1);
    if (elWMax && active !== elWMax) {
      elWMax.value = units === 'SI' ? (v.wMax * 1000).toFixed(1) : (v.wMax * 7000).toFixed(0);
    }
  }

  function applyView(next, { recordHistory = false, preserveSpan = false } = {}) {
    let tMin = next.tMin;
    let tMax = next.tMax;
    const span = clamp(tMax - tMin, _IX_MIN_T_SPAN, _IX_MAX_T_SPAN);

    if (preserveSpan) {
      if (tMin < _IX_T_HARD_MIN) {
        tMin = _IX_T_HARD_MIN;
        tMax = tMin + span;
      }
      if (tMax > _IX_T_HARD_MAX) {
        tMax = _IX_T_HARD_MAX;
        tMin = tMax - span;
      }
    }

    const wMax = clamp(next.wMax, _IX_W_HARD_MIN, _IX_W_HARD_MAX);
    if (typeof store?.setView === 'function') {
      store.setView({ tMin, tMax, wMax }, recordHistory);
    } else {
      const v = getView();
      v.tMin = clamp(tMin, _IX_T_HARD_MIN, _IX_T_HARD_MAX - _IX_MIN_T_SPAN);
      v.tMax = clamp(tMax, v.tMin + _IX_MIN_T_SPAN, _IX_T_HARD_MAX);
      v.wMax = wMax;
    }
    syncViewInputs();
    scheduleFullRender();
  }

  function zoomAnchoredAtPx(zoomFactor, px, py) {
    const plot = getPlotRectPx();
    const v = getView();
    const oldSpanT = Math.max(1e-6, v.tMax - v.tMin);
    const fx = clamp((px - plot.x) / Math.max(1, plot.w), 0, 1);
    const T0 = v.tMin + fx * oldSpanT;

    const newSpanT = clamp(oldSpanT / zoomFactor, _IX_MIN_T_SPAN, _IX_MAX_T_SPAN);
    const actualScale = oldSpanT / newSpanT;

    let newTMin = T0 - fx * newSpanT;
    let newTMax = newTMin + newSpanT;
    if (newTMin < _IX_T_HARD_MIN) {
      newTMin = _IX_T_HARD_MIN;
      newTMax = Math.min(_IX_T_HARD_MAX, newTMin + newSpanT);
    } else if (newTMax > _IX_T_HARD_MAX) {
      newTMax = _IX_T_HARD_MAX;
      newTMin = Math.max(_IX_T_HARD_MIN, newTMax - newSpanT);
    }

    // Preserve vertical saturation ratio when zoomed to cursor (wMin is fixed at 0)
    void py;
    const newWMax = clamp(v.wMax / actualScale, _IX_W_HARD_MIN, _IX_W_HARD_MAX);
    applyView({ tMin: newTMin, tMax: newTMax, wMax: newWMax }, { recordHistory: false });
  }

  function zoomBy(factor) {
    const plot = getPlotRectPx();
    zoomAnchoredAtPx(factor, plot.x + plot.w * 0.5, plot.y + plot.h * 0.5);
  }

  function resetZoom() {
    if (typeof store?.resetView === 'function') {
      store.resetView(true);
      syncViewInputs();
      scheduleFullRender();
    } else {
      const isIP = getUnits() === 'IP';
      applyView(
        isIP ? { tMin: fToC(20), tMax: fToC(120), wMax: 0.030 } : { tMin: -10, tMax: 55, wMax: 0.030 },
        { recordHistory: true }
      );
    }
    toast('ASHRAE standard range restored', 'info');
  }

  function fitPoints() {
    const pts = getPoints();
    if (!pts.length) {
      resetZoom();
      return;
    }
    if (typeof store?.fitPoints === 'function') {
      store.fitPoints(true);
      syncViewInputs();
      scheduleFullRender();
    } else {
      const pPa = getPressurePa();
      let tLo = Infinity, tHi = -Infinity, maxW = 0;
      for (const p of pts) {
        if (p.T < tLo) tLo = p.T;
        if (p.T > tHi) tHi = p.T;
        if (p.w > maxW) maxW = p.w;
      }
      const pad = Math.max(3, (tHi - tLo) * 0.18);
      const tMin = clamp(tLo - pad, _IX_T_HARD_MIN, _IX_T_HARD_MAX - _IX_MIN_T_SPAN);
      const tMax = clamp(tHi + pad, tMin + _IX_MIN_T_SPAN, _IX_T_HARD_MAX);
      const wMax = clamp(Math.max(maxW * 1.35, Math.min(Psy.wsat_at(tMax, pPa) * 1.12, 0.015)), 0.005, _IX_W_HARD_MAX);
      applyView({ tMin, tMax, wMax }, { recordHistory: true });
    }
    toast(`Fitted ${pts.length} state point${pts.length > 1 ? 's' : ''}`, 'info');
  }

  // --------------------------------------------------------------------------
  // Shift-Key Precision Constraints (ΔW=0, ΔT=0, Δh=0) & Ctrl 0.5° Grid Snap
  // --------------------------------------------------------------------------
  function snapTempHalfDegree(Tc, isSI) {
    if (isSI) return Math.round(Tc * 2) / 2;
    return fToC(Math.round(cToF(Tc) * 2) / 2);
  }

  function solveConstrainedDrag(px, py, originT, originW, shiftKey, ctrlKey) {
    const raw = pxToTw(px, py);
    const v = getView();
    const pPa = getPressurePa();
    const isSI = getUnits() === 'SI';

    let T = clamp(raw.T, v.tMin, v.tMax);
    let w = clamp(raw.w, 0, Psy.wsat_at(T, pPa));
    let snapLabel = null;

    if (shiftKey) {
      // 1. Horizontal constraint: ΔW = 0 (Sensible Heating / Cooling)
      const tdpOrigin = originW > 0 ? Psy.dewpoint_from_pv(Psy.pv_from_w(originW, pPa)) : _IX_T_HARD_MIN;
      let tSens = clamp(raw.T, Math.max(v.tMin, tdpOrigin), v.tMax);
      if (ctrlKey) {
        tSens = clamp(snapTempHalfDegree(tSens, isSI), Math.max(v.tMin, tdpOrigin), v.tMax);
      }
      const wSens = clamp(originW, 0, Psy.wsat_at(tSens, pPa));
      const pSens = twToPx(tSens, wSens);
      const dSens = Math.hypot(px - pSens.x, py - pSens.y);

      // 2. Vertical constraint: ΔT = 0 (Isothermal Humidification / Dehumidification)
      const tIso = clamp(originT, v.tMin, v.tMax);
      const wIso = clamp(raw.w, 0, Psy.wsat_at(tIso, pPa));
      const pIso = twToPx(tIso, wIso);
      const dIso = Math.hypot(px - pIso.x, py - pIso.y);

      // 3. Constant-enthalpy constraint: Δh = 0 (Adiabatic / Evaporative)
      const h0 = Psy.h_kJkg(originT, originW);
      const twbOrigin = Psy.twb_from_Tw(originT, originW, pPa);
      const tDryMax = h0 / 1.006;

      // Project pointer onto exact constant-h screen tangent vector at drag origin
      const dStep = 1.0;
      const wStep = (h0 - 1.006 * (originT + dStep)) / (2501 + 1.86 * (originT + dStep));
      const p0 = twToPx(originT, originW);
      const p1 = twToPx(originT + dStep, wStep);
      const vx = p1.x - p0.x;
      const vy = p1.y - p0.y;
      const vLen2 = vx * vx + vy * vy;

      let tEvap = originT;
      if (vLen2 > 1e-6) {
        const proj = ((px - p0.x) * vx + (py - p0.y) * vy) / vLen2;
        tEvap = originT + proj * dStep;
      }
      tEvap = clamp(tEvap, Math.max(v.tMin, twbOrigin), Math.min(v.tMax, tDryMax));
      if (ctrlKey) {
        tEvap = clamp(snapTempHalfDegree(tEvap, isSI), Math.max(v.tMin, twbOrigin), Math.min(v.tMax, tDryMax));
      }
      const wEvap = clamp((h0 - 1.006 * tEvap) / (2501 + 1.86 * tEvap), 0, Psy.wsat_at(tEvap, pPa));
      const pEvap = twToPx(tEvap, wEvap);
      const dEvap = Math.hypot(px - pEvap.x, py - pEvap.y);

      if (dSens <= dIso && dSens <= dEvap) {
        T = tSens;
        w = wSens;
        snapLabel = ctrlKey ? 'SNAP ΔW=0 Sensible + 0.5°' : 'SNAP ΔW=0 Sensible';
      } else if (dIso <= dSens && dIso <= dEvap) {
        T = tIso;
        w = wIso;
        snapLabel = 'SNAP ΔT=0 Isothermal';
      } else {
        T = tEvap;
        w = wEvap;
        snapLabel = ctrlKey ? 'SNAP Δh=0 Evaporative + 0.5°' : 'SNAP Δh=0 Evaporative';
      }
    } else if (ctrlKey) {
      T = clamp(snapTempHalfDegree(T, isSI), v.tMin, v.tMax);
      w = clamp(raw.w, 0, Psy.wsat_at(T, pPa));
      snapLabel = isSI ? 'SNAP 0.5°C Grid' : 'SNAP 0.5°F Grid';
    }

    return { T, w, snapLabel };
  }

  // --------------------------------------------------------------------------
  // Store Mutations (Points, Processes, Annotations, Selection)
  // --------------------------------------------------------------------------
  function selectPoint(ptId) {
    const ui = getUI();
    ui.selectedAnnId = null;
    if (typeof store?.setUI === 'function') {
      store.setUI({ selectedPtId: ptId });
    } else {
      ui.selectedPtId = ptId;
    }
    emitOverlayDirty('select-point');
  }

  function selectProcess(procId) {
    const ui = getUI();
    if (typeof store?.setUI === 'function') {
      store.setUI({ selectedProcId: procId });
    } else {
      ui.selectedProcId = procId;
    }
    const procSel = byId('procSel');
    if (procSel && procId != null) procSel.value = String(procId);
    emitOverlayDirty('select-process');
  }

  function addPointAtTw(T, w, opts = {}) {
    const safe = clampTwToSaturation(T, w, false);
    const payload = {
      T: safe.T,
      w: safe.w,
      label: opts.label || nextPointLabel(),
      color: opts.color || nextPointColor(),
      locked: Boolean(opts.locked),
      lx: Number.isFinite(opts.lx) ? opts.lx : 10,
      ly: Number.isFinite(opts.ly) ? opts.ly : -6,
      note: opts.note || ''
    };
    const created = typeof store?.addPoint === 'function'
      ? store.addPoint(payload, true)
      : (() => {
          const p = { id: Date.now(), ...payload };
          getPoints().push(p);
          return p;
        })();
    if (created) selectPoint(created.id);
    scheduleOverlayRender();
    return created;
  }

  function isDerivedMixPoint(pt) {
    return Boolean(pt && pt.derived && pt.derived.type === 'mix');
  }

  function pointToClientXY(pt) {
    if (!pt || !cvOverlay) return null;
    const rect = cvOverlay.getBoundingClientRect();
    const dpi = getDpi();
    const p = twToPx(pt.T, pt.w);
    return { x: rect.left + p.x / dpi, y: rect.top + p.y / dpi };
  }

  function notifyDerivedMixLocked(pt) {
    if (pt && !pt.locked) {
      if (typeof store?.updatePoint === 'function') {
        store.updatePoint(pt.id, { locked: true }, false);
      } else {
        pt.locked = true;
      }
      scheduleOverlayRender();
    }
    toast('Mix point is auto-computed from parent streams — drag a parent point to move it', 'warn', pointToClientXY(pt));
  }

  function toggleLockPoint(ptId) {
    const pt = getPoint(ptId);
    if (!pt) return;
    if (isDerivedMixPoint(pt)) {
      notifyDerivedMixLocked(pt);
      return;
    }
    if (typeof store?.updatePoint === 'function') {
      store.updatePoint(pt.id, { locked: !pt.locked }, true);
    } else {
      pt.locked = !pt.locked;
    }
    scheduleOverlayRender();
    toast(pt.locked ? `"${pt.label}" locked` : `"${pt.label}" unlocked`, 'info');
  }

  function resetPointLabel(ptId) {
    const pt = getPoint(ptId);
    if (!pt) return;
    if (typeof store?.updatePoint === 'function') {
      store.updatePoint(pt.id, { lx: 10, ly: -6 }, true);
    } else {
      pt.lx = 10;
      pt.ly = -6;
    }
    scheduleOverlayRender();
    toast(`"${pt.label}" label reset`, 'info');
  }

  function duplicatePoint(ptId) {
    const orig = getPoint(ptId);
    if (!orig) return;
    let copy = null;
    if (typeof store?.duplicatePoint === 'function') {
      copy = store.duplicatePoint(ptId);
      // Offset duplicate slightly in T so it is immediately distinct & selectable
      if (copy) {
        const v = getView();
        const nextT = clamp(copy.T + 1.0, v.tMin + 0.5, v.tMax - 0.5);
        const safe = clampTwToSaturation(nextT, copy.w, false);
        store.updatePoint(copy.id, { T: safe.T, w: safe.w }, false);
        selectPoint(copy.id);
      }
    } else {
      copy = addPointAtTw(orig.T + 1.0, orig.w, { label: `${orig.label} copy`, color: orig.color });
    }
    scheduleOverlayRender();
    if (copy) toast(`Duplicated "${orig.label}" → "${copy.label}"`, 'success');
  }

  function deletePoint(ptId) {
    const pt = getPoint(ptId);
    if (!pt) return false;
    if (pt.locked) {
      toast(`"${pt.label}" is locked — unlock it first`, 'error', pointToClientXY(pt));
      return false;
    }
    const label = pt.label;
    if (typeof store?.deletePoint === 'function') {
      const res = store.deletePoint(ptId);
      if (res && res.ok === false) {
        toast(res.reason || 'Cannot delete point', 'error', pointToClientXY(pt));
        return false;
      }
    } else {
      const st = getState();
      st.points = getPoints().filter(p => p.id !== ptId);
    }
    const ui = getUI();
    if (ui.procStartId === ptId) ui.procStartId = null;
    if (ui.mixStartId === ptId) ui.mixStartId = null;
    updateModeBanner();
    scheduleOverlayRender();
    toast(`Deleted "${label}"`, 'success');
    return true;
  }

  function createProcess(aId, bId) {
    if (aId == null || bId == null || aId === bId) return null;
    const pA = getPoint(aId);
    const pB = getPoint(bId);
    if (!pA || !pB) return null;

    const proc = typeof store?.addProcess === 'function'
      ? store.addProcess(aId, bId, {}, true)
      : null;
    if (proc) selectProcess(proc.id);
    scheduleOverlayRender();
    toast(`Process created: "${pA.label}" → "${pB.label}"`, 'success');
    return proc;
  }

  function deleteProcess(procId) {
    if (procId == null) return false;
    const ok = typeof store?.deleteProcess === 'function' ? store.deleteProcess(procId) : false;
    if (ok) {
      scheduleOverlayRender();
      toast('Process deleted', 'success');
    }
    return ok;
  }

  function reverseProcess(procId) {
    if (procId == null) return;
    if (typeof store?.reverseProcess === 'function') {
      store.reverseProcess(procId);
      scheduleOverlayRender();
      toast('Process reversed', 'info');
    }
  }

  function isCoolingDehumCoilCandidate(proc) {
    if (!proc) return false;
    const { a, b } = getProcEndpoints(proc);
    if (!a || !b) return false;
    const isCoolDehum = (b.T - a.T) < -0.5 && (b.w - a.w) < -0.0002;
    const isNonCoilRole =
      proc.role === 'mix' ||
      proc.role === 'room' ||
      proc.role === 'erv' ||
      proc.role === 'erv_exhaust' ||
      b?.derived?.type === 'mix';
    return isCoolDehum && !isNonCoilRole;
  }

  function toggleProcessCurve(procId) {
    const proc = getProcess(procId);
    if (!proc) return;
    const nextCurve = !proc.showCurve;
    if (nextCurve && !isCoolingDehumCoilCandidate(proc)) {
      toast('Curved coil path applies only to cooling & dehumidification coils', 'warn');
      return;
    }
    const patch = { showCurve: nextCurve };
    if (nextCurve) {
      const { a, b } = getProcEndpoints(proc);
      if (a && b && HVAC && typeof HVAC.calcADP === 'function') {
        const adp = HVAC.calcADP(a, b, getPressurePa());
        if (adp && adp.valid) {
          patch.adpT = adp.T_adp;
          patch.adpW = adp.w_adp;
        }
      }
      if (getLayers().adpLines === false) {
        setLayerValue('adpLines', true);
      }
    }
    if (typeof store?.updateProcess === 'function') {
      store.updateProcess(proc.id, patch, true);
      scheduleOverlayRender();
      toast(nextCurve ? 'Curved coil path + ADP extension ON' : 'Straight process line ON', 'info');
    }
  }

  function addAnnotationAtTw(T, w, text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    const safe = clampTwToSaturation(T, w, false);
    const ann = typeof store?.addAnnotation === 'function'
      ? store.addAnnotation({ T: safe.T, w: safe.w, text: trimmed }, true)
      : null;
    if (getLayers().annotations === false) {
      setLayerValue('annotations', true);
    }
    scheduleOverlayRender();
    toast('Annotation added', 'success');
    return ann;
  }

  function deleteAnnotation(annId) {
    if (annId == null) return false;
    const ui = getUI();
    if (ui.selectedAnnId === annId) ui.selectedAnnId = null;
    if (ui.hovAnnId === annId) ui.hovAnnId = null;
    const ok = typeof store?.deleteAnnotation === 'function' ? store.deleteAnnotation(annId, true) : false;
    if (ok) {
      scheduleOverlayRender();
      toast('Annotation deleted', 'info');
    }
    return ok;
  }

  // --------------------------------------------------------------------------
  // Compact Floating Inline Annotation Input
  // --------------------------------------------------------------------------
  let activeAnnEditor = null;

  function closeInlineAnnotationInput() {
    if (activeAnnEditor) {
      activeAnnEditor.remove();
      activeAnnEditor = null;
    }
  }

  function openInlineAnnotationInput(T, w, cssX, cssY, existingAnn = null) {
    closeInlineAnnotationInput();
    if (!chartWrap) {
      const txt = window.prompt(existingAnn ? 'Edit annotation:' : 'Engineering note:', existingAnn?.text || '');
      if (txt === null) return;
      if (existingAnn) {
        if (!txt.trim()) deleteAnnotation(existingAnn.id);
        else {
          store?.updateAnnotation?.(existingAnn.id, { text: txt.trim() }, true);
          scheduleOverlayRender();
          toast('Annotation updated', 'success');
        }
      } else {
        addAnnotationAtTw(T, w, txt);
      }
      return;
    }

    const hostEl = chartStage || chartWrap;
    const wrap = document.createElement('div');
    wrap.className = 'inline-ann-editor';
    const wrapW = hostEl.clientWidth || 640;
    const wrapH = hostEl.clientHeight || 420;
    const minTop = getToolbarBottomCss();
    const left = clamp(cssX + 10, 12, Math.max(12, wrapW - 268));
    const top = clamp(cssY - 22, minTop, Math.max(minTop, wrapH - 56));

    Object.assign(wrap.style, {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      zIndex: '45',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 6px',
      borderRadius: '8px',
      background: 'var(--panel, #111722)',
      border: '1px solid var(--accent, #0ea5e9)',
      boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.45))'
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.value = existingAnn ? String(existingAnn.text || '') : '';
    input.placeholder = 'Engineering note…';
    Object.assign(input.style, {
      width: '188px',
      padding: '4px 8px',
      fontSize: '12px',
      fontFamily: 'var(--sans, sans-serif)',
      color: 'var(--fg, #e6edf7)',
      background: 'var(--inputBg, #0b0f16)',
      border: '1px solid var(--inputBorder, rgba(148,163,184,0.22))',
      borderRadius: '5px',
      outline: 'none'
    });

    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.textContent = '✓';
    btnOk.title = 'Save (Enter)';
    Object.assign(btnOk.style, {
      height: '26px',
      padding: '0 8px',
      fontSize: '12px',
      fontWeight: '700',
      borderRadius: '5px',
      border: 'none',
      cursor: 'pointer',
      background: 'var(--accent, #0ea5e9)',
      color: 'var(--accentFg, #ffffff)'
    });

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.textContent = '✕';
    btnCancel.title = 'Cancel (Esc)';
    Object.assign(btnCancel.style, {
      height: '26px',
      padding: '0 7px',
      fontSize: '11px',
      borderRadius: '5px',
      border: '1px solid var(--borderStrong, rgba(148,163,184,0.22))',
      cursor: 'pointer',
      background: 'transparent',
      color: 'var(--muted, #8b9cb5)'
    });

    let done = false;
    function commit() {
      if (done) return;
      done = true;
      const val = input.value.trim();
      closeInlineAnnotationInput();
      if (existingAnn) {
        if (!val) {
          deleteAnnotation(existingAnn.id);
        } else if (val !== existingAnn.text) {
          store?.updateAnnotation?.(existingAnn.id, { text: val }, true);
          scheduleOverlayRender();
          toast('Annotation updated', 'success');
        }
      } else if (val) {
        addAnnotationAtTw(T, w, val);
      }
    }

    function cancel() {
      if (done) return;
      done = true;
      closeInlineAnnotationInput();
    }

    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    btnOk.addEventListener('click', e => { e.stopPropagation(); commit(); });
    btnCancel.addEventListener('click', e => { e.stopPropagation(); cancel(); });
    wrap.addEventListener('mousedown', e => e.stopPropagation());

    wrap.appendChild(input);
    wrap.appendChild(btnOk);
    wrap.appendChild(btnCancel);
    hostEl.appendChild(wrap);
    activeAnnEditor = wrap;

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  // --------------------------------------------------------------------------
  // 1. Tool Modes & Mode Banner (#modeBanner)
  // --------------------------------------------------------------------------
  function getActiveTool() {
    return getUI().activeTool || 'select';
  }

  function updateModeBanner() {
    if (!modeBannerEl) return;
    const ui = getUI();
    const m = ui.activeTool || 'select';

    if (m === 'select') {
      modeBannerEl.classList.remove('visible');
      modeBannerEl.dataset.mode = 'select';
      return;
    }

    let text = '';
    if (m === 'process') {
      const startPt = getPoint(ui.procStartId);
      text = startPt
        ? `Process Mode — Start: "${startPt.label}" → click end point (Shift to chain) · Esc to exit`
        : 'Process Mode — Click two points (or empty chart) to chain processes · Esc to exit';
    } else if (m === 'mix') {
      const startPt = getPoint(ui.mixStartId);
      text = startPt
        ? `Mix Mode — Stream A: "${startPt.label}" → click Stream B to calculate mix · Esc to exit`
        : 'Mix Mode — Click Point A and Point B (or empty chart) to mix streams · Esc to exit';
    } else if (m === 'measure') {
      text = measureLocked
        ? 'Measure Ruler — Locked · Click & drag to re-measure · Esc to clear & exit'
        : 'Measure Ruler — Click & drag anywhere to inspect ΔT, ΔW, Δh, SHR · Esc to exit';
    } else if (m === 'annotate') {
      text = 'Annotate — Click chart to place an engineering note · Esc to exit';
    } else if (m === 'boxzoom') {
      text = 'Box Zoom — Drag a rectangle to zoom in (or Alt+Drag anytime) · Esc to exit';
    }

    modeBannerEl.textContent = text;
    modeBannerEl.dataset.mode = m;
    modeBannerEl.style.top = `${getToolbarBottomCss()}px`;
    modeBannerEl.classList.add('visible');
  }

  function setWrapCursorClass(cls) {
    if (!chartWrap) return;
    chartWrap.classList.remove(
      'cursor-grab', 'cursor-grabbing', 'cursor-pointer',
      'cursor-move', 'cursor-zoom', 'cursor-text'
    );
    if (cls) chartWrap.classList.add(cls);
  }

  function updateCursor() {
    const ui = getUI();
    const m = ui.activeTool || 'select';

    if (dragKind === 'pan' || dragKind === 'point' || dragKind === 'shr-dial') {
      setWrapCursorClass('cursor-grabbing');
      return;
    }
    if (dragKind === 'label' || dragKind === 'annotation' || dragKind === 'shr-anchor') {
      setWrapCursorClass('cursor-move');
      return;
    }
    if (dragKind === 'boxzoom') {
      setWrapCursorClass('cursor-zoom');
      return;
    }
    if (dragKind === 'measure') {
      setWrapCursorClass('');
      return;
    }
    if (spacePan) {
      setWrapCursorClass('cursor-grab');
      return;
    }
    if (m === 'boxzoom') {
      setWrapCursorClass('cursor-zoom');
      return;
    }
    if (m === 'annotate') {
      setWrapCursorClass('cursor-text');
      return;
    }
    if (m === 'process' || m === 'mix') {
      setWrapCursorClass(ui.hovPickId != null ? 'cursor-pointer' : '');
      return;
    }
    if (m === 'measure') {
      setWrapCursorClass('');
      return;
    }

    // Select mode hover cursors (Dial -> Point -> Label/Annotation -> Process -> SHR Line)
    if (ui.hovShrPart === 'dial') {
      setWrapCursorClass('cursor-grab');
    } else if (ui.hovPickId != null) {
      const pt = getPoint(ui.hovPickId);
      setWrapCursorClass(pt?.locked || isDerivedMixPoint(pt) ? 'cursor-pointer' : 'cursor-grab');
    } else if (ui.hovLabelId != null || ui.hovAnnId != null || ui.hovShrPart === 'anchor' || ui.hovShrPart === 'line') {
      setWrapCursorClass('cursor-move');
    } else if (ui.hovProcId != null) {
      setWrapCursorClass('cursor-pointer');
    } else {
      setWrapCursorClass('');
    }
  }

  function syncToolButtons() {
    const active = getActiveTool();
    for (const [key, btn] of Object.entries(toolButtons)) {
      if (!btn) continue;
      const isAct = key === active;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-pressed', isAct ? 'true' : 'false');
    }
  }

  function setToolMode(nextMode, { toggle = false } = {}) {
    let target = nextMode || 'select';
    if (toggle && target !== 'select' && getActiveTool() === target) {
      target = 'select';
    }
    if (!Object.prototype.hasOwnProperty.call(toolButtons, target)) {
      target = 'select';
    }

    closeInlineAnnotationInput();
    const ui = getUI();
    const hadMeasure = Boolean(measureLocked || ui.measureStart || ui.measureEnd);
    measureLocked = false;
    ui.procStartId = null;
    ui.mixStartId = null;

    if (typeof store?.setTool === 'function') {
      store.setTool(target);
    } else {
      ui.activeTool = target;
      ui.toolStep = null;
      ui.measureStart = null;
      ui.measureEnd = null;
      ui.boxZoom = null;
    }

    if (hadMeasure && target !== 'measure' && hudEl) {
      hudEl.innerHTML = '';
      hudEl.classList.add('hidden');
    }

    syncToolButtons();
    updateModeBanner();
    updateCursor();
    scheduleOverlayRender();
  }

  function clearMeasure() {
    measureLocked = false;
    const ui = getUI();
    ui.measureStart = null;
    ui.measureEnd = null;
    if (typeof store?.setUI === 'function') {
      store.setUI({ measureStart: null, measureEnd: null });
    }
    if (hudEl) {
      hudEl.innerHTML = '';
      hudEl.classList.add('hidden');
    }
    updateModeBanner();
    scheduleOverlayRender();
  }

  function cancelActiveTool() {
    closeInlineAnnotationInput();
    hideContextMenu();
    activeSnapLabel = null;
    clearMeasure();
    setToolMode('select');
  }

  // Wire toolbar mode & view buttons
  bind(toolButtons.select,   'click', () => setToolMode('select'));
  bind(toolButtons.process,  'click', () => setToolMode('process',  { toggle: true }));
  bind(toolButtons.mix,      'click', () => setToolMode('mix',      { toggle: true }));
  bind(toolButtons.measure,  'click', () => setToolMode('measure',  { toggle: true }));
  bind(toolButtons.annotate, 'click', () => setToolMode('annotate', { toggle: true }));
  bind(toolButtons.boxzoom,  'click', () => setToolMode('boxzoom',  { toggle: true }));

  bind(byId('btnFitScreen'), 'click', resetZoom);
  bind(byId('btnFitPoints'), 'click', fitPoints);
  bind(byId('btnZoomIn'),    'click', () => zoomBy(1.22));
  bind(byId('btnZoomOut'),   'click', () => zoomBy(1 / 1.22));

  // --------------------------------------------------------------------------
  // 2. Mouse, Wheel & Touch Interactions on #cvOverlay
  // --------------------------------------------------------------------------
  function handlePointerDown(px, py, opts = {}) {
    const { button = 0, altKey = false, shiftKey = false } = opts;
    if (button === 2) return;

    hideContextMenu();
    closeInlineAnnotationInput();

    const ui = getUI();
    const tool = getActiveTool();
    dragMoved = false;
    dragHistoryPushed = false;
    suppressNextClick = false;
    dragStartPx = { x: px, y: py };
    dragLastPx = { x: px, y: py };
    boxZoomViaAlt = false;
    activeSnapLabel = null;

    const tw = pxToTw(px, py);
    const clampedTw = clampTwToSaturation(tw.T, tw.w, false);

    // Spacebar pan in any mode
    if (spacePan) {
      dragKind = 'pan';
      document.body.style.userSelect = 'none';
      updateCursor();
      return;
    }

    // Alt+Drag anywhere -> instant marquee Box Zoom
    if (altKey || tool === 'boxzoom') {
      dragKind = 'boxzoom';
      boxZoomViaAlt = altKey && tool !== 'boxzoom';
      const bz = { x1: px, y1: py, x2: px, y2: py };
      ui.boxZoom = bz;
      if (typeof store?.setUI === 'function') store.setUI({ boxZoom: bz });
      document.body.style.userSelect = 'none';
      updateCursor();
      emitOverlayDirty('boxzoom');
      return;
    }

    // Measure Ruler Mode
    if (tool === 'measure') {
      dragKind = 'measure';
      measureLocked = false;
      const startPt = { T: clampedTw.T, w: clampedTw.w };
      const endPt = { T: clampedTw.T, w: clampedTw.w };
      ui.measureStart = startPt;
      ui.measureEnd = endPt;
      if (typeof store?.setUI === 'function') {
        store.setUI({ measureStart: startPt, measureEnd: endPt });
      }
      document.body.style.userSelect = 'none';
      updateHudMeasure(startPt, endPt);
      updateModeBanner();
      emitOverlayDirty('measure');
      return;
    }

    // Process / Mix / Annotate handle placement on click/tap
    if (tool === 'process' || tool === 'mix' || tool === 'annotate') {
      return;
    }

    // Select Mode: priority SHR Dial -> Point -> Label -> Annotation -> Process -> SHR Parallel Line -> Pan
    const shrHit = pickSHRAtPx(px, py);
    if (shrHit === 'dial') {
      const geom = overlayRenderer?.getSHRGeometry?.();
      dragKind = 'shr-dial';
      ui.dragShrPart = 'dial';
      ui.hovShrPart = 'dial';
      store?.pushHistory?.('Adjust SHR Protractor');
      dragHistoryPushed = true;
      const nextShr = computeShrFromDialPx(px, py, geom, shiftKey);
      store?.setSHR?.({ value: nextShr }, false, { silentChange: true, skipAutosave: true });
      const shrInput = byId('shrVal');
      if (shrInput) shrInput.value = nextShr.toFixed(2);
      hudEl?.classList.add('hud-dragging');
      updateHudShr(nextShr);
      document.body.style.userSelect = 'none';
      updateCursor();
      return;
    }

    const hitPtId = pickPointAtPx(px, py);
    if (hitPtId != null) {
      const pt = getPoint(hitPtId);
      if (pt) {
        selectPoint(pt.id);
        if (isDerivedMixPoint(pt)) {
          dragKind = 'locked-mix';
          dragTargetId = pt.id;
          return;
        }
        if (!pt.locked) {
          dragKind = 'point';
          dragTargetId = pt.id;
          dragOriginTw = { T: pt.T, w: pt.w };
          if (document.activeElement && document.activeElement !== document.body &&
              !document.activeElement.closest?.('.inline-ann-editor') &&
              typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }
          document.body.style.userSelect = 'none';
          updateCursor();
        }
        return;
      }
    }

    const hitLblId = pickLabelAtPx(px, py);
    if (hitLblId != null) {
      const pt = getPoint(hitLblId);
      if (pt) {
        dragKind = 'label';
        dragTargetId = pt.id;
        const dpi = getDpi();
        const ptPx = twToPx(pt.T, pt.w);
        const resolved = overlayRenderer?.getResolvedLabelPos?.(pt.id);
        const curTx = resolved ? resolved.tx : (ptPx.x + (pt.lx ?? 10) * dpi);
        const curTy = resolved ? resolved.ty : (ptPx.y + (pt.ly ?? -6) * dpi);
        dragLabelOffsetPx = { dx: px - curTx, dy: py - curTy };
        selectPoint(pt.id);
        document.body.style.userSelect = 'none';
        updateCursor();
        return;
      }
    }

    const hitAnnId = pickAnnotationAtPx(px, py);
    if (hitAnnId != null) {
      const ann = getAnnotation(hitAnnId);
      if (ann) {
        dragKind = 'annotation';
        dragTargetId = ann.id;
        ui.selectedAnnId = ann.id;
        dragOriginTw = { T: ann.T, w: ann.w };
        dragAnnOffsetTw = { dT: ann.T - tw.T, dw: ann.w - tw.w };
        document.body.style.userSelect = 'none';
        updateCursor();
        emitOverlayDirty('select-annotation');
        return;
      }
    }

    const hitProcId = pickProcessAtPx(px, py);
    if (hitProcId != null) {
      selectProcess(hitProcId);
      return;
    }

    if (shrHit === 'anchor' || shrHit === 'line') {
      dragKind = 'shr-anchor';
      ui.dragShrPart = 'anchor';
      ui.hovShrPart = 'anchor';
      store?.pushHistory?.('Slide SHR Reference Line');
      dragHistoryPushed = true;
      hudEl?.classList.add('hud-dragging');
      document.body.style.userSelect = 'none';
      updateHudShr(getState().shr?.value ?? 0.75);
      updateCursor();
      return;
    }

    // Empty chart space -> smooth pan
    ui.selectedAnnId = null;
    dragKind = 'pan';
    document.body.style.userSelect = 'none';
    updateCursor();
  }

  function handlePointerMove(px, py, inside, opts = {}) {
    const { shiftKey = false, ctrlKey = false } = opts;
    const ui = getUI();
    const tw = pxToTw(px, py);

    if (inside || dragKind) {
      ui.hoverPx = px;
      ui.hoverPy = py;
    } else {
      ui.hoverPx = null;
      ui.hoverPy = null;
      if (!dragKind) hideHud();
    }

    if (dragKind) {
      const dpi = getDpi();
      if (!dragMoved && Math.hypot(px - dragStartPx.x, py - dragStartPx.y) > 3 * dpi) {
        dragMoved = true;
      }

      if (dragKind === 'shr-dial') {
        const geom = overlayRenderer?.getSHRGeometry?.();
        const nextShr = computeShrFromDialPx(px, py, geom, shiftKey);
        store?.setSHR?.({ value: nextShr }, false, { silentChange: true, skipAutosave: true });
        const shrInput = byId('shrVal');
        if (shrInput) shrInput.value = nextShr.toFixed(2);
        updateHudShr(nextShr);
        return;
      }

      if (dragKind === 'shr-anchor') {
        const curShr = getState().shr?.value ?? 0.75;
        const snapId = pickPointAtPx(px, py);
        if (snapId != null) {
          const snapPt = getPoint(snapId);
          if (snapPt) {
            store?.setSHR?.({ refPointId: snapPt.id, anchorTw: null }, false, { silentChange: true, skipAutosave: true });
            const selRef = byId('shrRefPt');
            if (selRef) selRef.value = String(snapPt.id);
            updateHudShr(curShr, snapPt.label || 'Point');
            return;
          }
        }
        const safe = clampTwToSaturation(tw.T, tw.w, true);
        store?.setSHR?.({ refPointId: null, anchorTw: { T: safe.T, w: safe.w } }, false, { silentChange: true, skipAutosave: true });
        const selRef = byId('shrRefPt');
        if (selRef) selRef.value = '';
        updateHudShr(curShr, 'Custom');
        return;
      }

      if (dragKind === 'locked-mix') {
        if (dragMoved) {
          const pt = getPoint(dragTargetId);
          dragKind = null;
          dragTargetId = null;
          notifyDerivedMixLocked(pt);
        }
        return;
      }

      if (dragKind === 'label') {
        const pt = getPoint(dragTargetId);
        if (pt) {
          if (dragMoved && !dragHistoryPushed) {
            store?.pushHistory?.(`Move Label "${pt.label}"`);
            dragHistoryPushed = true;
          }
          const ptPx = twToPx(pt.T, pt.w);
          pt.lx = Math.round((px - ptPx.x - dragLabelOffsetPx.dx) / dpi);
          pt.ly = Math.round((py - ptPx.y - dragLabelOffsetPx.dy) / dpi);
          emitOverlayDirty('drag-label');
        }
        return;
      }

      if (dragKind === 'point') {
        const pt = getPoint(dragTargetId);
        if (pt && isDerivedMixPoint(pt)) {
          dragKind = null;
          dragTargetId = null;
          ui.dragPtId = null;
          ui.dragSnapLabel = null;
          hudEl?.classList.remove('hud-dragging');
          document.body.style.userSelect = '';
          notifyDerivedMixLocked(pt);
          updateCursor();
          return;
        }
        if (pt && !pt.locked) {
          if (!dragMoved) return;
          if (!dragHistoryPushed) {
            store?.pushHistory?.(`Move Point "${pt.label}"`);
            dragHistoryPushed = true;
          }
          const solved = solveConstrainedDrag(px, py, dragOriginTw.T, dragOriginTw.w, shiftKey, ctrlKey);
          pt.T = solved.T;
          pt.w = solved.w;
          activeSnapLabel = solved.snapLabel;
          ui.dragPtId = pt.id;
          ui.dragSnapLabel = activeSnapLabel || null;
          store?.recomputeDerived?.();
          const ptPx = twToPx(pt.T, pt.w);
          ui.hoverPx = ptPx.x;
          ui.hoverPy = ptPx.y;
          const ptBadge = activeSnapLabel
            ? `${pt.label || 'Point'} · ${activeSnapLabel}`
            : (pt.label || 'Point');
          hudEl?.classList.add('hud-dragging');
          updateHudAtTw(pt.T, pt.w, ptBadge);
          if (typeof store?.emit === 'function') {
            store.emit('point-drag', {
              pointId: pt.id,
              T: pt.T,
              w: pt.w,
              snapLabel: activeSnapLabel || null
            });
          }
          emitOverlayDirty('drag-point');
        }
        return;
      }

      if (dragKind === 'annotation') {
        const ann = getAnnotation(dragTargetId);
        if (ann) {
          if (dragMoved && !dragHistoryPushed) {
            store?.pushHistory?.('Move Annotation');
            dragHistoryPushed = true;
          }
          const safe = clampTwToSaturation(tw.T + dragAnnOffsetTw.dT, tw.w + dragAnnOffsetTw.dw, true);
          ann.T = safe.T;
          ann.w = safe.w;
          updateHudAtTw(ann.T, ann.w);
          emitOverlayDirty('drag-annotation');
        }
        return;
      }

      if (dragKind === 'pan') {
        const dx = px - dragLastPx.x;
        const dy = py - dragLastPx.y;
        dragLastPx = { x: px, y: py };
        const plot = getPlotRectPx();
        const v = getView();
        const dT = (dx / Math.max(1, plot.w)) * (v.tMax - v.tMin);
        const dW = (dy / Math.max(1, plot.h)) * v.wMax;
        applyView(
          { tMin: v.tMin - dT, tMax: v.tMax - dT, wMax: v.wMax + dW },
          { recordHistory: false, preserveSpan: true }
        );
        return;
      }

      if (dragKind === 'measure' && ui.measureStart) {
        const safe = clampTwToSaturation(tw.T, tw.w, false);
        ui.measureEnd = { T: safe.T, w: safe.w };
        updateHudMeasure(ui.measureStart, ui.measureEnd);
        emitOverlayDirty('measure');
        return;
      }

      if (dragKind === 'boxzoom' && ui.boxZoom) {
        ui.boxZoom = { x1: ui.boxZoom.x1, y1: ui.boxZoom.y1, x2: px, y2: py };
        emitOverlayDirty('boxzoom');
        return;
      }
    }

    // Idle Hover Hit-Testing & Live HUD (Dial -> Point -> Label -> Annotation -> Process -> SHR Line)
    if (inside) {
      const tool = getActiveTool();
      const prevPick = ui.hovPickId;
      const prevLbl = ui.hovLabelId;
      const prevAnn = ui.hovAnnId;
      const prevProc = ui.hovProcId;
      const prevShrPart = ui.hovShrPart;

      const rawShrHit = tool === 'select' ? pickSHRAtPx(px, py) : null;
      if (rawShrHit === 'dial') {
        ui.hovShrPart = 'dial';
        ui.hovPickId = null;
        ui.hovLabelId = null;
        ui.hovAnnId = null;
        ui.hovProcId = null;
      } else {
        ui.hovPickId = (tool === 'select' || tool === 'process' || tool === 'mix') ? pickPointAtPx(px, py) : null;
        ui.hovLabelId = (tool === 'select' && ui.hovPickId == null) ? pickLabelAtPx(px, py) : null;
        ui.hovAnnId = tool === 'select' && ui.hovPickId == null && ui.hovLabelId == null ? pickAnnotationAtPx(px, py) : null;
        ui.hovProcId = tool === 'select' && ui.hovPickId == null && ui.hovLabelId == null && ui.hovAnnId == null
          ? pickProcessAtPx(px, py)
          : null;
        ui.hovShrPart = (tool === 'select' && ui.hovPickId == null && ui.hovLabelId == null && ui.hovAnnId == null && ui.hovProcId == null)
          ? rawShrHit
          : null;
      }

      if (ui.hovShrPart === 'dial') {
        updateHudShr(getState().shr?.value ?? 0.75);
      } else if (ui.hovPickId != null && tool === 'select') {
        const hp = getPoint(ui.hovPickId);
        if (hp) updateHudAtTw(hp.T, hp.w, hp.label || null);
      } else if (measureLocked && ui.measureStart && ui.measureEnd && tool === 'measure') {
        updateHudMeasure(ui.measureStart, ui.measureEnd);
      } else {
        updateHudAtTw(tw.T, tw.w);
      }

      updateCursor();
      if (
        prevPick !== ui.hovPickId ||
        prevLbl !== ui.hovLabelId ||
        prevAnn !== ui.hovAnnId ||
        prevProc !== ui.hovProcId ||
        prevShrPart !== ui.hovShrPart ||
        ui.hoverPx != null
      ) {
        emitOverlayDirty('hover');
      }
    }
  }

  function handlePointerUp() {
    if (!dragKind) return;
    const finished = dragKind;
    const wasMoved = dragMoved;
    const targetId = dragTargetId;
    const ui = getUI();

    dragKind = null;
    dragTargetId = null;
    activeSnapLabel = null;
    ui.dragPtId = null;
    ui.dragSnapLabel = null;
    ui.dragShrPart = null;
    hudEl?.classList.remove('hud-dragging');
    document.body.style.userSelect = '';

    if (finished === 'shr-dial' || finished === 'shr-anchor') {
      const s = getState().shr || {};
      store?.setSHR?.({ value: s.value, refPointId: s.refPointId, anchorTw: s.anchorTw }, false);
      suppressNextClick = true;
      updateCursor();
      emitOverlayDirty('shr-drag-end');
      return;
    }

    if (finished === 'boxzoom' && ui.boxZoom) {
      const b = ui.boxZoom;
      const dpi = getDpi();
      const dx = Math.abs(b.x2 - b.x1);
      const dy = Math.abs(b.y2 - b.y1);
      ui.boxZoom = null;
      if (typeof store?.setUI === 'function') store.setUI({ boxZoom: null });

      if (dx >= 12 * dpi && dy >= 12 * dpi) {
        const tw0 = pxToTw(Math.min(b.x1, b.x2), Math.min(b.y1, b.y2));
        const tw1 = pxToTw(Math.max(b.x1, b.x2), Math.max(b.y1, b.y2));
        const tMin = Math.min(tw0.T, tw1.T);
        const tMax = Math.max(tw0.T, tw1.T);
        const wMax = Math.max(tw0.w, tw1.w, 0.004);
        applyView({ tMin, tMax, wMax }, { recordHistory: true });
        if (!boxZoomViaAlt) setToolMode('select');
        toast('Zoomed to marquee region', 'info');
      }
      suppressNextClick = wasMoved;
      updateCursor();
      emitOverlayDirty('boxzoom-end');
      return;
    }

    if (finished === 'measure' && ui.measureStart && ui.measureEnd) {
      const movedEnough = Math.hypot(
        ui.measureEnd.T - ui.measureStart.T,
        (ui.measureEnd.w - ui.measureStart.w) * 1000
      ) > 0.05;
      if (movedEnough) {
        measureLocked = true;
        updateHudMeasure(ui.measureStart, ui.measureEnd);
      } else {
        clearMeasure();
      }
      updateModeBanner();
      updateCursor();
      emitOverlayDirty('measure-end');
      return;
    }

    if (finished === 'point' && wasMoved && targetId != null) {
      const pt = getPoint(targetId);
      if (pt) {
        // Keep stored ADP coordinates fresh on any curved cooling coil processes
        if (HVAC && typeof HVAC.calcADP === 'function') {
          const pPa = getPressurePa();
          for (const pr of getProcesses()) {
            if (!pr || !pr.showCurve) continue;
            const { a, b } = getProcEndpoints(pr);
            if (!a || !b) continue;
            const adp = HVAC.calcADP(a, b, pPa);
            if (adp && adp.valid) {
              pr.adpT = adp.T_adp;
              pr.adpW = adp.w_adp;
            } else {
              pr.adpT = null;
              pr.adpW = null;
            }
          }
        }
        // Commit final position (history already pushed once at drag start)
        store?.updatePoint?.(pt.id, { T: pt.T, w: pt.w }, false);
        updateHudAtTw(pt.T, pt.w, pt.label || null);
      }
      suppressNextClick = true;
    } else if (finished === 'label' && wasMoved && targetId != null) {
      const pt = getPoint(targetId);
      if (pt) {
        store?.updatePoint?.(pt.id, { lx: pt.lx, ly: pt.ly }, false);
      }
      suppressNextClick = true;
    } else if (finished === 'annotation' && wasMoved && targetId != null) {
      const ann = getAnnotation(targetId);
      if (ann) {
        store?.updateAnnotation?.(ann.id, { T: ann.T, w: ann.w }, false);
      }
      suppressNextClick = true;
    } else if (finished === 'pan' && wasMoved) {
      suppressNextClick = true;
    }

    updateCursor();
    emitOverlayDirty('drag-end');
  }

  function handleCanvasClick(px, py, cssX, cssY, opts = {}) {
    const { shiftKey = false } = opts;
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

    const tool = getActiveTool();
    const ui = getUI();
    const tw = pxToTw(px, py);
    const clamped = clampTwToSaturation(tw.T, tw.w, false);

    // --- Process Mode ---
    if (tool === 'process') {
      let ptId = pickPointAtPx(px, py);
      let pt = ptId != null ? getPoint(ptId) : null;
      if (!pt) {
        pt = addPointAtTw(clamped.T, clamped.w);
      }
      if (!pt) return;

      if (ui.procStartId == null) {
        ui.procStartId = pt.id;
        toast(`Process start: "${pt.label}" — click end point (Shift to chain)`, 'info', pointToClientXY(pt));
        updateModeBanner();
        emitOverlayDirty('process-start');
        return;
      }

      if (ui.procStartId === pt.id) {
        toast(`Cannot connect "${pt.label}" to itself — click a different end point (Esc to cancel)`, 'error', pointToClientXY(pt));
        updateModeBanner();
        emitOverlayDirty('process-self-error');
        return;
      }

      createProcess(ui.procStartId, pt.id);
      ui.procStartId = shiftKey ? pt.id : null;
      updateModeBanner();
      emitOverlayDirty('process-chain');
      return;
    }

    // --- Mix Mode ---
    if (tool === 'mix') {
      let ptId = pickPointAtPx(px, py);
      let pt = ptId != null ? getPoint(ptId) : null;
      if (!pt) {
        pt = addPointAtTw(clamped.T, clamped.w);
      }
      if (!pt) return;

      if (ui.mixStartId == null) {
        ui.mixStartId = pt.id;
        toast(`Mix Stream A: "${pt.label}" — click Stream B`, 'info', pointToClientXY(pt));
        updateModeBanner();
        emitOverlayDirty('mix-start');
        return;
      }

      if (ui.mixStartId === pt.id) {
        toast(`Cannot mix "${pt.label}" with itself — click a different Stream B (Esc to cancel)`, 'error', pointToClientXY(pt));
        updateModeBanner();
        emitOverlayDirty('mix-self-error');
        return;
      }

      const aId = ui.mixStartId;
      const bId = pt.id;
      ui.mixStartId = null;
      setToolMode('select');
      if (typeof callbacks.openMixFlow === 'function') {
        callbacks.openMixFlow(aId, bId);
      }
      return;
    }

    // --- Annotate Mode ---
    if (tool === 'annotate') {
      openInlineAnnotationInput(clamped.T, clamped.w, cssX, cssY, null);
    }
  }

  function handleCanvasDblClick(e) {
    if (getActiveTool() !== 'select') return;
    const pos = clientToCanvasPx(e.clientX, e.clientY);

    // Double-click SHR protractor dial -> snap Target SHR to active process / measure SHR
    if (pickSHRAtPx(pos.px, pos.py) === 'dial') {
      const geom = overlayRenderer?.getSHRGeometry?.();
      const lv = geom?.liveVector;
      if (lv && Number.isFinite(lv.shr)) {
        const matched = Number(clamp(lv.shr, -2, 2).toFixed(2));
        const stShr = getState().shr || {};
        const patch = { value: matched };
        if (stShr.refPointId == null && !stShr.anchorTw && lv.anchorPtId != null) {
          patch.refPointId = lv.anchorPtId;
        }
        store?.setSHR?.(patch, true);
        toast(`Matched SHR Protractor to ${lv.label} (SHR ${matched.toFixed(2)})`, 'success');
      } else {
        toast('Select or hover a process to match its SHR slope', 'info');
      }
      return;
    }

    // Double-click point -> toggle lock/unlock
    const hitPtId = pickPointAtPx(pos.px, pos.py);
    if (hitPtId != null) {
      toggleLockPoint(hitPtId);
      return;
    }

    // Double-click annotation -> edit text inline
    const hitAnnId = pickAnnotationAtPx(pos.px, pos.py);
    if (hitAnnId != null) {
      const ann = getAnnotation(hitAnnId);
      if (ann) openInlineAnnotationInput(ann.T, ann.w, pos.cssX, pos.cssY, ann);
      return;
    }

    // Double-click empty chart inside plot rect -> add point right there
    const plot = getPlotRectPx();
    if (pos.px >= plot.x && pos.px <= plot.right && pos.py >= plot.y && pos.py <= plot.bottom) {
      const tw = pxToTw(pos.px, pos.py);
      const safe = clampTwToSaturation(tw.T, tw.w, false);
      const pt = addPointAtTw(safe.T, safe.w);
      if (pt) {
        const isSI = getUnits() === 'SI';
        const rh = Psy.RH_from_Tw(pt.T, pt.w, getPressurePa()) * 100;
        const tDisp = isSI ? `${pt.T.toFixed(1)}°C` : `${cToF(pt.T).toFixed(1)}°F`;
        toast(`Added "${pt.label}" (${tDisp}, ${rh.toFixed(0)}% RH)`, 'success');
      }
    }
  }

  // Mouse listeners
  bind(cvOverlay, 'mousedown', e => {
    if (e.button === 2) return;
    const pos = clientToCanvasPx(e.clientX, e.clientY);
    handlePointerDown(pos.px, pos.py, { button: e.button, altKey: e.altKey, shiftKey: e.shiftKey });
  });

  bind(window, 'mousemove', e => {
    if (!cvOverlay) return;
    const pos = clientToCanvasPx(e.clientX, e.clientY);
    const ui = getUI();
    if (!pos.inside && !dragKind) {
      if (ui.hoverPx != null) {
        ui.hoverPx = null;
        ui.hoverPy = null;
        ui.hovPickId = null;
        ui.hovLabelId = null;
        ui.hovAnnId = null;
        ui.hovProcId = null;
        ui.hovShrPart = null;
        hideHud();
        emitOverlayDirty('hover-exit');
      }
      return;
    }
    handlePointerMove(pos.px, pos.py, pos.inside, { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey });
  });

  bind(window, 'mouseup', handlePointerUp);

  bind(window, 'blur', () => {
    spacePan = false;
    handlePointerUp();
  });

  bind(cvOverlay, 'mouseleave', () => {
    if (dragKind) return;
    const ui = getUI();
    ui.hoverPx = null;
    ui.hoverPy = null;
    ui.hovPickId = null;
    ui.hovLabelId = null;
    ui.hovAnnId = null;
    ui.hovProcId = null;
    ui.hovShrPart = null;
    hideHud();
    emitOverlayDirty('hover-leave');
  });

  bind(cvOverlay, 'click', e => {
    const pos = clientToCanvasPx(e.clientX, e.clientY);
    handleCanvasClick(pos.px, pos.py, pos.cssX, pos.cssY, { shiftKey: e.shiftKey });
  });

  bind(cvOverlay, 'dblclick', handleCanvasDblClick);

  // Wheel Zoom anchored strictly to cursor (T, w)
  bind(cvOverlay, 'wheel', e => {
    e.preventDefault();
    const pos = clientToCanvasPx(e.clientX, e.clientY);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 24;
    else if (e.deltaMode === 2) dy *= 300;
    dy = clamp(dy, -240, 240);
    const zoomFactor = Math.exp(-dy * 0.0018);
    zoomAnchoredAtPx(zoomFactor, pos.px, pos.py);
    const tw = pxToTw(pos.px, pos.py);
    updateHudAtTw(tw.T, tw.w);
  }, { passive: false });

  // Pinch-to-Zoom, 2-Finger Pan, Single-Finger Pan/Drag & Long-Press Context Menu
  let touchPinchActive = false;
  let touchPrevDist = 0;
  let touchPrevMid = { px: 0, py: 0 };
  let touchTapStart = null;
  let touchLongPressTimer = 0;

  function clearTouchLongPress() {
    if (touchLongPressTimer) {
      clearTimeout(touchLongPressTimer);
      touchLongPressTimer = 0;
    }
  }

  bind(cvOverlay, 'touchstart', e => {
    if (!e.touches.length) return;
    e.preventDefault();
    clearTouchLongPress();

    if (e.touches.length === 2) {
      if (dragKind) handlePointerUp();
      touchPinchActive = true;
      const p0 = clientToCanvasPx(e.touches[0].clientX, e.touches[0].clientY);
      const p1 = clientToCanvasPx(e.touches[1].clientX, e.touches[1].clientY);
      touchPrevDist = Math.max(10, Math.hypot(p1.px - p0.px, p1.py - p0.py));
      touchPrevMid = { px: (p0.px + p1.px) * 0.5, py: (p0.py + p1.py) * 0.5 };
      return;
    }

    if (e.touches.length === 1) {
      touchPinchActive = false;
      const t = e.touches[0];
      const pos = clientToCanvasPx(t.clientX, t.clientY);
      touchTapStart = { ...pos, clientX: t.clientX, clientY: t.clientY, time: Date.now() };
      handlePointerDown(pos.px, pos.py, { button: 0, altKey: false });

      touchLongPressTimer = setTimeout(() => {
        if (!dragMoved && touchTapStart) {
          handlePointerUp();
          openContextMenuAt(touchTapStart.clientX, touchTapStart.clientY);
          touchTapStart = null;
        }
      }, 550);
    }
  }, { passive: false });

  bind(cvOverlay, 'touchmove', e => {
    if (!e.touches.length) return;
    e.preventDefault();

    if (e.touches.length === 2) {
      clearTouchLongPress();
      const p0 = clientToCanvasPx(e.touches[0].clientX, e.touches[0].clientY);
      const p1 = clientToCanvasPx(e.touches[1].clientX, e.touches[1].clientY);
      const dist = Math.max(10, Math.hypot(p1.px - p0.px, p1.py - p0.py));
      const mid = { px: (p0.px + p1.px) * 0.5, py: (p0.py + p1.py) * 0.5 };

      if (touchPinchActive && touchPrevDist > 0) {
        const factor = clamp(dist / touchPrevDist, 0.5, 2.0);
        zoomAnchoredAtPx(factor, mid.px, mid.py);

        const dx = mid.px - touchPrevMid.px;
        const dy = mid.py - touchPrevMid.py;
        const plot = getPlotRectPx();
        const v = getView();
        const dT = (dx / Math.max(1, plot.w)) * (v.tMax - v.tMin);
        const dW = (dy / Math.max(1, plot.h)) * v.wMax;
        applyView(
          { tMin: v.tMin - dT, tMax: v.tMax - dT, wMax: v.wMax + dW },
          { recordHistory: false, preserveSpan: true }
        );
      }

      touchPinchActive = true;
      touchPrevDist = dist;
      touchPrevMid = mid;
      return;
    }

    if (e.touches.length === 1 && !touchPinchActive) {
      const t = e.touches[0];
      const pos = clientToCanvasPx(t.clientX, t.clientY);
      if (touchTapStart && Math.hypot(pos.cssX - touchTapStart.cssX, pos.cssY - touchTapStart.cssY) > 8) {
        clearTouchLongPress();
      }
      handlePointerMove(pos.px, pos.py, pos.inside, { shiftKey: false, ctrlKey: false });
    }
  }, { passive: false });

  bind(cvOverlay, 'touchend', e => {
    clearTouchLongPress();
    if (e.touches.length < 2) touchPinchActive = false;
    if (e.touches.length === 0) {
      const tap = touchTapStart;
      const quickTap = tap && !dragMoved && (Date.now() - tap.time) < 400;
      touchTapStart = null;
      handlePointerUp();
      const tool = getActiveTool();
      if (quickTap && (tool === 'process' || tool === 'mix' || tool === 'annotate')) {
        handleCanvasClick(tap.px, tap.py, tap.cssX, tap.cssY, { shiftKey: false });
      }
    }
  });

  bind(cvOverlay, 'touchcancel', () => {
    clearTouchLongPress();
    touchPinchActive = false;
    touchTapStart = null;
    handlePointerUp();
  });

  // --------------------------------------------------------------------------
  // 3. Viewport-Clamped Contextual Menu (#ctxMenu)
  // --------------------------------------------------------------------------
  function hideContextMenu() {
    if (ctxMenuEl) ctxMenuEl.classList.remove('visible');
  }

  function ctxItemHtml(action, icon, label, key = '', extraClass = '') {
    const keyHtml = key ? `<span class="ctx-key">${esc(key)}</span>` : '';
    const cls = extraClass ? `ctx-item ${extraClass}` : 'ctx-item';
    return `<div class="${cls}" role="menuitem" tabindex="-1" data-action="${esc(action)}"><span class="ctx-icon">${icon}</span><span>${esc(label)}</span>${keyHtml}</div>`;
  }

  function openContextMenuAt(clientX, clientY) {
    if (!ctxMenuEl) return;
    const pos = clientToCanvasPx(clientX, clientY);
    const tw = pxToTw(pos.px, pos.py);
    const clamped = clampTwToSaturation(tw.T, tw.w, false);

    // Check point first, then label fallback so right-clicking a label opens that point's menu
    const hitPtId = pickPointAtPx(pos.px, pos.py) ?? pickLabelAtPx(pos.px, pos.py);
    const hitPt = hitPtId != null ? getPoint(hitPtId) : null;
    const hitAnnId = !hitPt ? pickAnnotationAtPx(pos.px, pos.py) : null;
    const hitAnn = hitAnnId != null ? getAnnotation(hitAnnId) : null;
    const hitProcId = !hitPt && !hitAnn ? pickProcessAtPx(pos.px, pos.py) : null;
    const hitProc = hitProcId != null ? getProcess(hitProcId) : null;

    ctxTarget.T = hitPt ? hitPt.T : clamped.T;
    ctxTarget.w = hitPt ? hitPt.w : clamped.w;
    ctxTarget.cssX = pos.cssX;
    ctxTarget.cssY = pos.cssY;
    ctxTarget.pointId = hitPt ? hitPt.id : null;
    ctxTarget.annotationId = hitAnn ? hitAnn.id : null;
    ctxTarget.procId = hitProc ? hitProc.id : null;

    const ui = getUI();
    const parts = [];

    // End active process chain when right-clicking target point
    if (getActiveTool() === 'process' && ui.procStartId != null && hitPt && hitPt.id !== ui.procStartId) {
      parts.push(ctxItemHtml('endProcess', '🏁', `End Process Here ("${hitPt.label}")`));
      parts.push('<div class="ctx-sep"></div>');
    }

    if (hitPt) {
      const derivedMix = isDerivedMixPoint(hitPt);
      if (!hitPt.locked && !derivedMix) {
        parts.push(ctxItemHtml('editPoint', '✏️', `Edit "${hitPt.label}"…`));
      }
      parts.push(ctxItemHtml('duplicatePoint', '⧉', `Duplicate "${hitPt.label}"`));
      parts.push(ctxItemHtml('hidePoint', '🙈', `Hide "${hitPt.label}"`));
      parts.push(ctxItemHtml('lockPoint', hitPt.locked || derivedMix ? '🔓' : '🔒', hitPt.locked || derivedMix ? `Unlock "${hitPt.label}"` : `Lock "${hitPt.label}"`));
      parts.push(ctxItemHtml('resetLabel', '↩️', 'Reset Label Position'));
      if (!hitPt.locked && !derivedMix) {
        parts.push(ctxItemHtml('deletePoint', '🗑️', `Delete "${hitPt.label}"`, 'Del', 'danger'));
      }
      parts.push('<div class="ctx-sep"></div>');
      parts.push(ctxItemHtml('startProcess', '➡️', `Start Process from "${hitPt.label}"`, 'P'));
      parts.push(ctxItemHtml('startMix', '⑂', `Mix Stream from "${hitPt.label}"`, 'M'));
      parts.push(ctxItemHtml('copyProperties', '📋', `Copy All 10 Properties ("${hitPt.label}")`));
    } else if (hitAnn) {
      parts.push(ctxItemHtml('editAnnotation', '✏️', 'Edit Annotation…'));
      parts.push(ctxItemHtml('deleteAnnotation', '🗑️', 'Delete Annotation', 'Del', 'danger'));
      parts.push('<div class="ctx-sep"></div>');
      parts.push(ctxItemHtml('addPointHere', '📍', 'Add Point Here'));
      parts.push(ctxItemHtml('addAnnotationHere', '📝', 'Add Annotation Here', 'N'));
      parts.push(ctxItemHtml('copyProperties', '📋', 'Copy All 10 Properties Here'));
    } else if (hitProc) {
      const { a, b } = getProcEndpoints(hitProc);
      const lbl = a && b ? `${a.label} → ${b.label}` : 'Process';
      parts.push(ctxItemHtml('selectProcess', '⚡', `Inspect ${lbl}`));
      parts.push(ctxItemHtml('reverseProcess', '⇄', 'Reverse Process Direction'));
      if (isCoolingDehumCoilCandidate(hitProc) || hitProc.showCurve) {
        parts.push(ctxItemHtml('toggleCurve', '∿', hitProc.showCurve ? 'Use Straight Line' : 'Show Curved Coil Path'));
      }
      parts.push(ctxItemHtml('deleteProcess', '🗑️', `Delete ${lbl}`, 'Del', 'danger'));
      parts.push('<div class="ctx-sep"></div>');
      parts.push(ctxItemHtml('addPointHere', '📍', 'Add Point Here'));
      parts.push(ctxItemHtml('copyProperties', '📋', 'Copy All 10 Properties Here'));
    } else {
      parts.push(ctxItemHtml('addPointHere', '📍', 'Add Point Here'));
      parts.push(ctxItemHtml('addPointParams', '🧮', 'Add Point via Parameters…'));
      parts.push(ctxItemHtml('addAnnotationHere', '📝', 'Add Annotation Here', 'N'));
      parts.push('<div class="ctx-sep"></div>');
      parts.push(ctxItemHtml('startProcess', '➡️', 'Start Process Here', 'P'));
      parts.push(ctxItemHtml('copyProperties', '📋', 'Copy All 10 Properties Here'));
      parts.push('<div class="ctx-sep"></div>');
      parts.push(ctxItemHtml('fitAll', '⊞', 'Fit All Points', 'F'));
      parts.push(ctxItemHtml('resetZoom', '↺', 'Reset Zoom', 'R'));
      parts.push(ctxItemHtml('copyPng', '📋', 'Copy Chart PNG'));
    }

    ctxMenuEl.innerHTML = parts.join('');
    ctxMenuEl.classList.add('visible');

    // Measure and strictly clamp within window viewport bounds
    ctxMenuEl.style.left = '0px';
    ctxMenuEl.style.top = '0px';
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    ctxMenuEl.style.maxHeight = `${Math.max(180, vh - pad * 2)}px`;
    ctxMenuEl.style.overflowY = 'auto';

    const mw = ctxMenuEl.offsetWidth || 240;
    const mh = ctxMenuEl.offsetHeight || 260;

    let left = clientX;
    let top = clientY;
    if (left + mw + pad > vw) left = Math.max(pad, vw - mw - pad);
    if (top + mh + pad > vh) top = Math.max(pad, vh - mh - pad);

    ctxMenuEl.style.left = `${left}px`;
    ctxMenuEl.style.top = `${top}px`;
  }

  function handleContextAction(action) {
    hideContextMenu();
    switch (action) {
      case 'addPointHere': {
        const pt = addPointAtTw(ctxTarget.T, ctxTarget.w);
        if (pt) toast(`Added "${pt.label}" at cursor`, 'success');
        break;
      }
      case 'addPointParams': {
        if (typeof callbacks.openAddPointParam === 'function') {
          callbacks.openAddPointParam(ctxTarget.T, ctxTarget.w);
        } else {
          byId('addPtParamOverlay')?.classList.add('visible');
        }
        break;
      }
      case 'addAnnotationHere': {
        openInlineAnnotationInput(ctxTarget.T, ctxTarget.w, ctxTarget.cssX, ctxTarget.cssY, null);
        break;
      }
      case 'editAnnotation': {
        const ann = getAnnotation(ctxTarget.annotationId);
        if (ann) openInlineAnnotationInput(ann.T, ann.w, ctxTarget.cssX, ctxTarget.cssY, ann);
        break;
      }
      case 'deleteAnnotation': {
        if (ctxTarget.annotationId != null) deleteAnnotation(ctxTarget.annotationId);
        break;
      }
      case 'editPoint': {
        const pt = getPoint(ctxTarget.pointId);
        if (!pt) break;
        if (isDerivedMixPoint(pt)) {
          notifyDerivedMixLocked(pt);
          break;
        }
        if (pt.locked) {
          toast(`"${pt.label}" is locked — unlock it first`, 'error');
          break;
        }
        if (typeof callbacks.openEditPoint === 'function') {
          callbacks.openEditPoint(pt.id);
        } else {
          byId('editPtOverlay')?.classList.add('visible');
        }
        break;
      }
      case 'duplicatePoint': {
        if (ctxTarget.pointId != null) duplicatePoint(ctxTarget.pointId);
        break;
      }
      case 'hidePoint': {
        const pt = getPoint(ctxTarget.pointId);
        if (pt && typeof store?.updatePoint === 'function') {
          store.updatePoint(pt.id, { hidden: true }, true);
          toast(`Hid "${pt.label}" (restore in Points tab or Show Design Pts)`, 'info');
        }
        break;
      }
      case 'lockPoint': {
        if (ctxTarget.pointId != null) toggleLockPoint(ctxTarget.pointId);
        break;
      }
      case 'resetLabel': {
        if (ctxTarget.pointId != null) resetPointLabel(ctxTarget.pointId);
        break;
      }
      case 'deletePoint': {
        if (ctxTarget.pointId != null) deletePoint(ctxTarget.pointId);
        break;
      }
      case 'startProcess': {
        let startPt = getPoint(ctxTarget.pointId);
        if (!startPt) {
          startPt = addPointAtTw(ctxTarget.T, ctxTarget.w);
        }
        setToolMode('process');
        getUI().procStartId = startPt ? startPt.id : null;
        updateModeBanner();
        emitOverlayDirty('process-start');
        if (startPt) toast(`Process start: "${startPt.label}" — click end point`, 'info');
        break;
      }
      case 'startMix': {
        let startPt = getPoint(ctxTarget.pointId);
        if (!startPt) {
          startPt = addPointAtTw(ctxTarget.T, ctxTarget.w);
        }
        setToolMode('mix');
        getUI().mixStartId = startPt ? startPt.id : null;
        updateModeBanner();
        emitOverlayDirty('mix-start');
        if (startPt) toast(`Mix Stream A: "${startPt.label}" — click Stream B`, 'info');
        break;
      }
      case 'endProcess': {
        const startId = getUI().procStartId;
        if (startId != null && ctxTarget.pointId != null && ctxTarget.pointId !== startId) {
          createProcess(startId, ctxTarget.pointId);
          setToolMode('select');
        }
        break;
      }
      case 'selectProcess': {
        if (ctxTarget.procId != null) selectProcess(ctxTarget.procId);
        break;
      }
      case 'reverseProcess': {
        if (ctxTarget.procId != null) reverseProcess(ctxTarget.procId);
        break;
      }
      case 'toggleCurve': {
        if (ctxTarget.procId != null) toggleProcessCurve(ctxTarget.procId);
        break;
      }
      case 'deleteProcess': {
        if (ctxTarget.procId != null) deleteProcess(ctxTarget.procId);
        break;
      }
      case 'copyProperties': {
        const pt = getPoint(ctxTarget.pointId);
        const text = format10PropertiesText(ctxTarget.T, ctxTarget.w, pt ? pt.label : 'Psychrometric State');
        copyTextToClipboard(text).then(() => {
          toast(`Copied 10 properties (${getUnits()})`, 'success');
        });
        break;
      }
      case 'fitAll':
        fitPoints();
        break;
      case 'resetZoom':
        resetZoom();
        break;
      case 'copyPng':
        callbacks.copyPng?.();
        break;
    }
  }

  bind(cvOverlay, 'contextmenu', e => {
    e.preventDefault();
    openContextMenuAt(e.clientX, e.clientY);
  });

  bind(ctxMenuEl, 'click', e => {
    const item = e.target?.closest?.('.ctx-item');
    if (item && item.dataset.action) {
      e.stopPropagation();
      handleContextAction(item.dataset.action);
    }
  });

  bind(document, 'mousedown', e => {
    if (ctxMenuEl && ctxMenuEl.classList.contains('visible') && !ctxMenuEl.contains(e.target)) {
      hideContextMenu();
    }
  });

  // --------------------------------------------------------------------------
  // 4. Collapsible Panels & Splitters (#splitL, #splitR, #btnToggleLeft/Right)
  // --------------------------------------------------------------------------
  const appEl = byId('app');
  const leftPanelEl = byId('leftPanel');
  const rightPanelEl = byId('rightPanel');
  const splitL = byId('splitL');
  const splitR = byId('splitR');
  const btnToggleLeft = byId('btnToggleLeft');
  const btnToggleRight = byId('btnToggleRight');
  const rootStyle = document.documentElement.style;

  if (splitL && !splitL.hasAttribute('tabindex')) splitL.setAttribute('tabindex', '0');
  if (splitR && !splitR.hasAttribute('tabindex')) splitR.setAttribute('tabindex', '0');

  function clampPanelWidth(side, desiredW) {
    const ar = (appEl || document.body).getBoundingClientRect();
    const splittersW = (splitL?.offsetWidth || 6) + (splitR?.offsetWidth || 6);
    if (side === 'L') {
      const rightW = appEl?.classList.contains('right-collapsed')
        ? 0
        : (rightPanelEl?.getBoundingClientRect?.().width || _IX_DEFAULT_RIGHT_W);
      const maxL = Math.max(240, Math.min(560, Math.floor(ar.width - rightW - splittersW - 360)));
      return clamp(Math.round(desiredW), 240, maxL);
    }
    const leftW = appEl?.classList.contains('left-collapsed')
      ? 0
      : (leftPanelEl?.getBoundingClientRect?.().width || _IX_DEFAULT_LEFT_W);
    const maxR = Math.max(260, Math.min(600, Math.floor(ar.width - leftW - splittersW - 360)));
    return clamp(Math.round(desiredW), 260, maxR);
  }

  function applyCollapsedState(side, collapsed) {
    const boolVal = Boolean(collapsed);
    if (side === 'L') {
      appEl?.classList.toggle('left-collapsed', boolVal);
      if (leftPanelEl) leftPanelEl.inert = boolVal;
      if (btnToggleLeft) {
        btnToggleLeft.classList.toggle('active', boolVal);
        btnToggleLeft.setAttribute('aria-expanded', boolVal ? 'false' : 'true');
        btnToggleLeft.title = boolVal ? 'Expand Left Panel' : 'Collapse Left Panel';
      }
      store?.setUI?.({ leftCollapsed: boolVal });
    } else {
      appEl?.classList.toggle('right-collapsed', boolVal);
      if (rightPanelEl) rightPanelEl.inert = boolVal;
      if (btnToggleRight) {
        btnToggleRight.classList.toggle('active', boolVal);
        btnToggleRight.setAttribute('aria-expanded', boolVal ? 'false' : 'true');
        btnToggleRight.title = boolVal ? 'Expand Right Panel' : 'Collapse Right Panel';
      }
      store?.setUI?.({ rightCollapsed: boolVal });
    }
    requestAnimationFrame(() => scheduleFullRender(true));
  }

  function toggleLeftPanel() {
    const cur = Boolean(appEl?.classList.contains('left-collapsed'));
    applyCollapsedState('L', !cur);
  }

  function toggleRightPanel() {
    const cur = Boolean(appEl?.classList.contains('right-collapsed'));
    applyCollapsedState('R', !cur);
  }

  bind(btnToggleLeft, 'click', toggleLeftPanel);
  bind(btnToggleRight, 'click', toggleRightPanel);

  let activeSplit = null; // null | 'L' | 'R'

  function startSplitDrag(which, e) {
    e.preventDefault();
    activeSplit = which;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    (which === 'L' ? splitL : splitR)?.classList.add('dragging');
  }

  bind(splitL, 'mousedown', e => startSplitDrag('L', e));
  bind(splitR, 'mousedown', e => startSplitDrag('R', e));
  bind(splitL, 'dblclick', () => {
    rootStyle.removeProperty('--leftW');
    applyCollapsedState('L', false);
  });
  bind(splitR, 'dblclick', () => {
    rootStyle.removeProperty('--rightW');
    applyCollapsedState('R', false);
  });

  bind(splitL, 'keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 16 : -16;
    if (appEl?.classList.contains('left-collapsed')) {
      if (step > 0) applyCollapsedState('L', false);
      return;
    }
    const curW = leftPanelEl?.getBoundingClientRect?.().width || _IX_DEFAULT_LEFT_W;
    rootStyle.setProperty('--leftW', `${clampPanelWidth('L', curW + step)}px`);
    scheduleFullRender(true);
  });

  bind(splitR, 'keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? 16 : -16;
    if (appEl?.classList.contains('right-collapsed')) {
      if (step > 0) applyCollapsedState('R', false);
      return;
    }
    const curW = rightPanelEl?.getBoundingClientRect?.().width || _IX_DEFAULT_RIGHT_W;
    rootStyle.setProperty('--rightW', `${clampPanelWidth('R', curW + step)}px`);
    scheduleFullRender(true);
  });

  bind(window, 'mousemove', e => {
    if (!activeSplit) return;
    const ar = (appEl || document.body).getBoundingClientRect();
    if (activeSplit === 'L') {
      const rawW = e.clientX - ar.left;
      if (rawW < 120) {
        if (!appEl?.classList.contains('left-collapsed')) applyCollapsedState('L', true);
      } else {
        if (appEl?.classList.contains('left-collapsed')) applyCollapsedState('L', false);
        rootStyle.setProperty('--leftW', `${clampPanelWidth('L', rawW)}px`);
        scheduleFullRender(true);
      }
    } else if (activeSplit === 'R') {
      const rawW = ar.right - e.clientX;
      if (rawW < 120) {
        if (!appEl?.classList.contains('right-collapsed')) applyCollapsedState('R', true);
      } else {
        if (appEl?.classList.contains('right-collapsed')) applyCollapsedState('R', false);
        rootStyle.setProperty('--rightW', `${clampPanelWidth('R', rawW)}px`);
        scheduleFullRender(true);
      }
    }
  });

  bind(window, 'mouseup', () => {
    if (!activeSplit) return;
    splitL?.classList.remove('dragging');
    splitR?.classList.remove('dragging');
    activeSplit = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    scheduleFullRender(true);
  });

  bind(window, 'resize', () => {
    if (modeBannerEl && modeBannerEl.classList.contains('visible')) {
      modeBannerEl.style.top = `${getToolbarBottomCss()}px`;
    }
  });

  // ResizeObserver is owned centrally by app.js to prevent duplicate redraws on resize

  // --------------------------------------------------------------------------
  // 5. Layer Toggle Pill Bar (#layerToggles) & Comfort / Weather / Units
  // --------------------------------------------------------------------------
  const layerPillMap = new Map();

  function getComfortMode() {
    const st = getState();
    return st.comfort?.mode || 'both';
  }

  function applyComfortModeValue(mode) {
    if (mode !== 'none') lastActiveComfortMode = mode;
    if (typeof store?.setComfort === 'function') {
      store.setComfort({ mode });
    } else {
      const st = getState();
      if (!st.comfort) st.comfort = { mode };
      else st.comfort.mode = mode;
    }
    const sel = byId('comfortMode');
    if (sel) sel.value = mode;
  }

  function setLayerValue(key, val, { syncComfort = true } = {}) {
    const boolVal = Boolean(val);
    if (key === 'comfort' && syncComfort) {
      const curMode = getComfortMode();
      if (boolVal) {
        const restoreMode = curMode === 'none' ? (lastActiveComfortMode || 'both') : curMode;
        if (curMode === 'none') {
          applyComfortModeValue(restoreMode);
        } else {
          const sel = byId('comfortMode');
          if (sel) sel.value = curMode;
        }
      } else {
        if (curMode !== 'none') lastActiveComfortMode = curMode;
        applyComfortModeValue('none');
      }
    }
    if (typeof store?.setLayer === 'function') {
      store.setLayer(key, boolVal);
    } else {
      getLayers()[key] = boolVal;
    }
    if (key === 'flowAnim') {
      const chk = byId('chkFlowAnim');
      if (chk) chk.checked = boolVal;
    }
    syncLayerPills();
    scheduleFullRender(key === 'comfort');
  }

  function toggleLayerKey(key, label = null) {
    const curOn = key === 'comfort'
      ? (getLayers().comfort !== false && getComfortMode() !== 'none')
      : (getLayers()[key] !== false);
    const next = !curOn;
    setLayerValue(key, next);
    if (label) toast(`${label}: ${next ? 'ON' : 'OFF'}`, 'info');
    return next;
  }

  function cycleComfortZone() {
    const cur = getLayers().comfort === false ? 'none' : getComfortMode();
    const next = _IX_COMFORT_CYCLE[(_IX_COMFORT_CYCLE.indexOf(cur) + 1) % _IX_COMFORT_CYCLE.length];
    applyComfortModeValue(next);
    setLayerValue('comfort', next !== 'none', { syncComfort: false });
    scheduleFullRender(true);
    toast(`Comfort zone: ${next}`, 'info');
  }

  function toggleWeatherLayer() {
    const next = toggleLayerKey('weather');
    const w = getState().weather;
    const hasData = Boolean(
      (Array.isArray(w?.records) && w.records.length > 0) ||
      (w?.bins && (w.bins.totalHours > 0 || w.bins.maxCount > 0))
    );
    if (next && !hasData) {
      toast('Weather overlay ON — load a city TMY or drop an EPW file in Atmosphere tab', 'info');
    } else {
      toast(`Weather heatmap: ${next ? 'ON' : 'OFF'}`, 'info');
    }
  }

  function toggleUnits() {
    const next = getUnits() === 'SI' ? 'IP' : 'SI';
    if (typeof store?.setUnits === 'function') {
      store.setUnits(next);
    } else {
      getState().units = next;
    }
    const sel = byId('selUnits');
    if (sel) sel.value = next;
    syncViewInputs();
    scheduleFullRender(true);
    const ui = getUI();
    if (ui.hoverPx != null && ui.hoverPy != null) {
      const tw = pxToTw(ui.hoverPx, ui.hoverPy);
      updateHudAtTw(tw.T, tw.w);
    }
    toast(`Units switched to ${next === 'SI' ? 'SI (°C, g/kg, kJ/kg)' : 'IP (°F, gr/lb, Btu/lb)'}`, 'info');
  }

  function buildLayerToggles() {
    if (!layerTogglesEl) return;
    layerTogglesEl.innerHTML = '';
    layerPillMap.clear();
    const layers = getLayers();

    for (const def of _IX_LAYER_PILLS) {
      const lbl = document.createElement('label');
      lbl.className = 'layer-chip';
      lbl.title = def.title;
      lbl.dataset.layer = def.key;

      const inp = document.createElement('input');
      inp.type = 'checkbox';
      const checked = def.key === 'comfort'
        ? (layers.comfort !== false && getComfortMode() !== 'none')
        : (layers[def.key] !== false);
      inp.checked = checked;

      const dot = document.createElement('span');
      dot.className = 'ltDot';
      dot.style.background = `var(${def.dot}, ${def.fallback})`;

      lbl.appendChild(inp);
      lbl.appendChild(dot);
      lbl.appendChild(document.createTextNode(def.label));
      lbl.classList.toggle('on', checked);

      inp.addEventListener('change', () => {
        if (def.key === 'grid') {
          setLayerValue('grid', inp.checked);
          setLayerValue('gridMinor', inp.checked);
        } else {
          setLayerValue(def.key, inp.checked);
        }
      });

      layerTogglesEl.appendChild(lbl);
      layerPillMap.set(def.key, { lbl, inp });
    }
  }

  function syncLayerPills() {
    const layers = getLayers();
    const comfortMode = getComfortMode();
    if (comfortMode !== 'none') lastActiveComfortMode = comfortMode;

    for (const [key, refs] of layerPillMap.entries()) {
      const checked = key === 'comfort'
        ? (layers.comfort !== false && comfortMode !== 'none')
        : (layers[key] !== false);
      if (refs.inp.checked !== checked) refs.inp.checked = checked;
      refs.lbl.classList.toggle('on', checked);
    }

    const comfortSel = byId('comfortMode');
    if (comfortSel && document.activeElement !== comfortSel) {
      const visualMode = layers.comfort === false ? 'none' : comfortMode;
      if (comfortSel.value !== visualMode) comfortSel.value = visualMode;
    }
  }

  // --------------------------------------------------------------------------
  // 6. Complete Keyboard Shortcuts Controller
  // --------------------------------------------------------------------------
  function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || Boolean(target.isContentEditable);
  }

  function triggerUndo() {
    if (typeof store?.undo === 'function') {
      const lbl = store.getUndoLabel?.() || '';
      if (store.undo()) {
        syncViewInputs();
        syncLayerPills();
        scheduleFullRender(true);
        toast(lbl ? `Undo: ${lbl}` : 'Undo', 'info');
      }
    }
  }

  function triggerRedo() {
    if (typeof store?.redo === 'function') {
      const lbl = store.getRedoLabel?.() || '';
      if (store.redo()) {
        syncViewInputs();
        syncLayerPills();
        scheduleFullRender(true);
        toast(lbl ? `Redo: ${lbl}` : 'Redo', 'info');
      }
    }
  }

  bind(window, 'keydown', e => {
    const keyLower = (e.key || '').toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    // Escape priority chain: modal (owned by modals.js) -> inline ann editor -> ctxMenu -> active canvas tool
    if (e.key === 'Escape') {
      if (document.querySelector('.modal-overlay.visible')) {
        return;
      }
      if (activeAnnEditor) {
        e.preventDefault();
        closeInlineAnnotationInput();
        return;
      }
      if (ctxMenuEl && ctxMenuEl.classList.contains('visible')) {
        e.preventDefault();
        hideContextMenu();
        return;
      }
      cancelActiveTool();
      return;
    }

    if (isEditableTarget(e.target)) return;

    // Undo / Redo
    if (mod && keyLower === 'z' && !e.shiftKey) {
      e.preventDefault();
      triggerUndo();
      return;
    }
    if (mod && (keyLower === 'y' || (keyLower === 'z' && e.shiftKey))) {
      e.preventDefault();
      triggerRedo();
      return;
    }

    // Never hijack modified browser shortcuts (Ctrl+R, Ctrl+P, Ctrl+F, Ctrl+C, etc.)
    if (mod || e.altKey) return;

    // + / = and - / _ keyboard zoom shortcuts matching toolbar tooltips
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomBy(1.22);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomBy(1 / 1.22);
      return;
    }

    // Spacebar temporary pan
    if (e.code === 'Space') {
      e.preventDefault();
      if (!spacePan) {
        spacePan = true;
        updateCursor();
      }
      return;
    }

    // ? -> Shortcuts modal
    if (e.key === '?') {
      e.preventDefault();
      if (typeof callbacks.openShortcuts === 'function') {
        callbacks.openShortcuts();
      } else {
        byId('shortcutsOverlay')?.classList.toggle('visible');
      }
      return;
    }

    // Delete / Backspace -> Delete selected annotation, unlocked point, or process
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const ui = getUI();
      if (ui.selectedAnnId != null && getAnnotation(ui.selectedAnnId)) {
        deleteAnnotation(ui.selectedAnnId);
        return;
      }
      if (ui.selectedPtId != null && getPoint(ui.selectedPtId)) {
        deletePoint(ui.selectedPtId);
        return;
      }
      if (ui.selectedProcId != null && getProcess(ui.selectedProcId)) {
        deleteProcess(ui.selectedProcId);
        return;
      }
      return;
    }

    // 1-7 -> Toggle core layers (sat, rh, wb, enth, vlines, points, processes)
    if (e.key >= '1' && e.key <= '7') {
      const layerKey = _IX_HOTKEY_LAYERS[parseInt(e.key, 10) - 1];
      if (layerKey) {
        toggleLayerKey(layerKey, layerKey.toUpperCase());
      }
      return;
    }

    // Single-key tool modes & chart toggles
    switch (keyLower) {
      case 'v':
        setToolMode('select');
        break;
      case 'p':
        setToolMode('process', { toggle: true });
        break;
      case 'm':
        setToolMode('mix', { toggle: true });
        break;
      case 'l':
        setToolMode('measure', { toggle: true });
        break;
      case 'n':
        setToolMode('annotate', { toggle: true });
        break;
      case 'b':
        setToolMode('boxzoom', { toggle: true });
        break;
      case 'f':
        fitPoints();
        break;
      case 'r':
        resetZoom();
        break;
      case 'g': {
        const next = getLayers().grid === false;
        setLayerValue('grid', next);
        setLayerValue('gridMinor', next);
        toast(`Grid: ${next ? 'ON' : 'OFF'}`, 'info');
        break;
      }
      case 'c':
        cycleComfortZone();
        break;
      case 'd':
        toggleLayerKey('dp', 'Dew-Point Lines');
        break;
      case 'w':
        toggleWeatherLayer();
        break;
      case 'a':
        toggleLayerKey('flowAnim', 'Flow Animation');
        break;
      case 'u':
        toggleUnits();
        break;
    }
  });

  bind(window, 'keyup', e => {
    if (e.code === 'Space' && spacePan) {
      spacePan = false;
      updateCursor();
    }
  });

  // --------------------------------------------------------------------------
  // Store Event Sync (bidirectional pill bar, view inputs & tool states)
  // --------------------------------------------------------------------------
  if (typeof store?.on === 'function') {
    const unsubChange = store.on('change', () => {
      syncLayerPills();
      syncViewInputs();
      syncToolButtons();
      updateModeBanner();
    });
    if (typeof unsubChange === 'function') cleanups.push(unsubChange);
  }

  // Initial sync
  if (leftPanelEl) leftPanelEl.inert = Boolean(appEl?.classList.contains('left-collapsed'));
  if (rightPanelEl) rightPanelEl.inert = Boolean(appEl?.classList.contains('right-collapsed'));
  buildLayerToggles();
  syncToolButtons();
  syncViewInputs();
  updateModeBanner();
  updateCursor();

  function destroy() {
    if (_rafFull) cancelAnimationFrame(_rafFull);
    if (_rafOverlay) cancelAnimationFrame(_rafOverlay);
    clearTouchLongPress();
    closeInlineAnnotationInput();
    for (const fn of cleanups) {
      try {
        fn();
      } catch (_) {
        // Ignore listener teardown errors
      }
    }
    cleanups.length = 0;
  }

  return {
    setToolMode,
    getToolMode: getActiveTool,
    fitPoints,
    resetZoom,
    zoomBy,
    cycleComfortZone,
    toggleWeatherLayer,
    toggleUnits,
    toggleLeftPanel,
    toggleRightPanel,
    buildLayerToggles,
    syncLayerPills,
    hideContextMenu,
    clearMeasure,
    cancelActiveTool,
    destroy
  };
}
