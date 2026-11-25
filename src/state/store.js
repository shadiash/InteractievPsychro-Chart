/* ============================================================================
   PsychroChart Ultra 3.0 — Reactive State Store, History, Scenarios & Persistence
   Strict internal SI units: T (°C), w (kg/kg), pPa (Pa), altM (m).
   ============================================================================ */

import {
  APP_VERSION,
  DEFAULT_AXIS_STYLE,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_LAYERS,
  DEFAULT_TREND_STYLE,
  POINT_PALETTE,
  THEME_PRESETS,
  CoreDOM
} from '../core/contracts.js';
import { Psy } from '../engine/psychro.js';
import { Weather } from '../engine/weather.js';

export function createStore() {
  const MAX_HISTORY = 100;
  const AUTOSAVE_KEY = 'psychro_ultra_v3_autosave';
  const AUTOSAVE_DELAY_MS = 400;
  const MAX_EMBEDDED_WEATHER_RECORDS = 500;
  const VALID_THEMES = new Set([
    'studio-dark',
    'drafting-light',
    'ashrae-classic',
    'carrier-classic',
    'trane-hvac',
    'cibse-metric',
    'mollier-din',
    'print-bw',
    'blueprint-cad',
    'custom'
  ]);
  const VALID_PROCESS_ROLES = new Set(['coil', 'mix', 'room', 'erv', 'erv_exhaust', 'fan', 'humid', 'custom']);
  const OVERLAY_LAYERS = new Set(['points', 'processes', 'mixlinks', 'adpLines', 'annotations', 'flowAnim']);
  const VIEW_BOUNDS = { tMin: -50, tMax: 85, minSpanT: 2, wMin: 0.002, wMax: 0.065 };

  const DEFAULT_VIEW = {
    tMin: -10,
    tMax: 55,
    wMax: 0.030,
    defaultSI: { tMin: -10, tMax: 55, wMax: 0.030 },
    defaultIP: { tMin: -6.6667, tMax: 48.8889, wMax: 0.030 }
  };

  const DEFAULT_GRID = {
    density: 'normal',
    rhStep: 10,
    labelMode: 'mid',
    labelPx: 11,
    showEnthalpyRuler: true
  };

  const DEFAULT_COMFORT = {
    mode: 'both',
    standard: 'ashrae55',
    capHumidity: true,
    cloSummer: 0.5,
    cloWinter: 1.0,
    met: 1.1,
    vAir: 0.1,
    mrtOffset: 0,
    pmvLimit: 0.5
  };

  const DEFAULT_SHR = {
    show: false,
    value: 0.75,
    refPointId: null,
    anchorTw: null,
    protractorPos: null
  };

  const state = {
    meta: {
      name: 'AHU-01 Summer Design',
      version: 'v3.0',
      company: '',
      engineer: '',
      notes: ''
    },
    theme: 'studio-dark',
    units: 'SI',
    pPa: 101325,
    altM: 0,
    pOverride: null,
    view: {
      tMin: DEFAULT_VIEW.tMin,
      tMax: DEFAULT_VIEW.tMax,
      wMax: DEFAULT_VIEW.wMax,
      defaultSI: { ...DEFAULT_VIEW.defaultSI },
      defaultIP: { ...DEFAULT_VIEW.defaultIP }
    },
    grid: { ...DEFAULT_GRID },
    axisStyle: { ...DEFAULT_AXIS_STYLE },
    trendStyle: { ...DEFAULT_TREND_STYLE },
    layers: { ...DEFAULT_LAYERS },
    comfort: { ...DEFAULT_COMFORT },
    shr: { ...DEFAULT_SHR },
    points: [],
    processes: [],
    annotations: [],
    scenarios: [],
    compareScenarioId: null,
    weather: {
      cityId: null,
      sourceName: null,
      records: [],
      bins: null,
      mode: 'heatmap',
      opacity: 0.72
    },
    customTheme: { ...DEFAULT_CUSTOM_THEME },
    ui: {
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
      dragPtId: null,
      dragSnapLabel: null,
      hovShrPart: null,
      dragShrPart: null,
      leftCollapsed: false,
      rightCollapsed: false
    }
  };

  let nextPtId = 1;
  let nextProcId = 1;
  let nextAnnId = 1;
  let nextScenId = 1;

  const listeners = new Map();
  const undoStack = [];
  const redoStack = [];
  let autosaveTimer = null;

  /* --------------------------------------------------------------------------
     Internal Physics & Utility Helpers
     -------------------------------------------------------------------------- */

  function h_kJkg(T, w) {
    return typeof Psy?.h_kJkg === 'function'
      ? Psy.h_kJkg(T, w)
      : 1.006 * T + w * (2501 + 1.86 * T);
  }

  function Tdb_from_wh(w, h) {
    return typeof Psy?.Tdb_from_wh === 'function'
      ? Psy.Tdb_from_wh(w, h)
      : (h - 2501 * w) / (1.006 + 1.86 * w);
  }

  function wsat_at(T, pPa) {
    if (typeof Psy?.wsat_at === 'function') return Psy.wsat_at(T, pPa);
    if (typeof Psy?.wsat === 'function') return Psy.wsat(T, pPa);
    const Tk = T + 273.15;
    const pws = T >= 0
      ? Math.exp(-5800.2206 / Tk + 1.3914993 - 4.8640239e-2 * Tk + 4.1764768e-5 * Tk * Tk - 1.4452093e-8 * Tk * Tk * Tk + 6.5459673 * Math.log(Tk))
      : Math.exp(-5674.5359 / Tk + 6.3925247 - 9.677843e-3 * Tk + 0.62215701e-6 * Tk * Tk + 2.0747825e-9 * Tk * Tk * Tk - 9.484024e-13 * Tk ** 4 + 4.1635019 * Math.log(Tk));
    const pv = Math.min(pws, pPa * 0.999);
    return 0.621945 * pv / Math.max(1, pPa - pv);
  }

  function baroPa(altM) {
    return typeof Psy?.baroPa === 'function'
      ? Psy.baroPa(altM)
      : 101325 * Math.pow(1 - 2.25577e-5 * altM, 5.25588);
  }

  function invBaroAlt_m(pPa) {
    return typeof Psy?.invBaroAlt_m === 'function'
      ? Psy.invBaroAlt_m(pPa)
      : (1 - Math.pow(pPa / 101325, 1 / 5.25588)) / 2.25577e-5;
  }

  function deepClone(val) {
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(deepClone);
    const out = {};
    for (const key of Object.keys(val)) {
      out[key] = deepClone(val[key]);
    }
    return out;
  }

  function numOr(val, fallback) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }

  function findIndexById(list, id) {
    if (id == null || id === '') return -1;
    let idx = list.findIndex(item => item.id === id);
    if (idx >= 0) return idx;
    const sId = String(id);
    idx = list.findIndex(item => String(item.id) === sId);
    return idx;
  }

  function findById(list, id) {
    const idx = findIndexById(list, id);
    return idx >= 0 ? list[idx] : null;
  }

  function maxNumericId(list) {
    let maxId = 0;
    for (const item of list) {
      const n = Number(item?.id);
      if (Number.isInteger(n) && n > maxId) maxId = n;
    }
    return maxId;
  }

  function syncIdCounters() {
    let maxPt = maxNumericId(state.points);
    let maxProc = maxNumericId(state.processes);
    for (const sc of state.scenarios) {
      maxPt = Math.max(maxPt, maxNumericId(sc.points || []));
      maxProc = Math.max(maxProc, maxNumericId(sc.processes || []));
    }
    nextPtId = Math.max(nextPtId, maxPt + 1);
    nextProcId = Math.max(nextProcId, maxProc + 1);
    nextAnnId = Math.max(nextAnnId, maxNumericId(state.annotations) + 1);
    nextScenId = Math.max(nextScenId, maxNumericId(state.scenarios) + 1);
  }

  function clampViewValues(tMinIn, tMaxIn, wMaxIn) {
    let tMin = numOr(tMinIn, state.view.tMin);
    let tMax = numOr(tMaxIn, state.view.tMax);
    let wMax = numOr(wMaxIn, state.view.wMax);

    if (tMin > tMax) {
      const tmp = tMin;
      tMin = tMax;
      tMax = tmp;
    }

    tMin = CoreDOM.clamp(tMin, VIEW_BOUNDS.tMin, VIEW_BOUNDS.tMax - VIEW_BOUNDS.minSpanT);
    tMax = CoreDOM.clamp(tMax, VIEW_BOUNDS.tMin + VIEW_BOUNDS.minSpanT, VIEW_BOUNDS.tMax);

    if (tMax - tMin < VIEW_BOUNDS.minSpanT) {
      const mid = CoreDOM.clamp((tMin + tMax) / 2, VIEW_BOUNDS.tMin + VIEW_BOUNDS.minSpanT / 2, VIEW_BOUNDS.tMax - VIEW_BOUNDS.minSpanT / 2);
      tMin = mid - VIEW_BOUNDS.minSpanT / 2;
      tMax = mid + VIEW_BOUNDS.minSpanT / 2;
    }

    wMax = CoreDOM.clamp(wMax, VIEW_BOUNDS.wMin, VIEW_BOUNDS.wMax);
    return { tMin, tMax, wMax };
  }

  function normalizeThemeName(themeName, legacyStyle) {
    if (legacyStyle === 'custom') return 'custom';
    if (legacyStyle === 'ashrae' || legacyStyle === 'classic') return 'ashrae-classic';
    if (VALID_THEMES.has(themeName)) return themeName;
    const low = typeof themeName === 'string' ? themeName.trim().toLowerCase() : '';
    if (VALID_THEMES.has(low)) return low;
    if (low === 'dark' || low === 'pro') return 'studio-dark';
    if (low === 'light') return 'drafting-light';
    if (low === 'ashrae' || low === 'classic') return 'ashrae-classic';
    if (low === 'carrier') return 'carrier-classic';
    if (low === 'trane') return 'trane-hvac';
    if (low === 'cibse') return 'cibse-metric';
    if (low === 'mollier' || low === 'din') return 'mollier-din';
    if (low === 'print' || low === 'bw' || low === 'monochrome') return 'print-bw';
    if (low === 'blueprint') return 'blueprint-cad';
    return 'studio-dark';
  }

  function sanitizeAxisStyle(raw, base = DEFAULT_AXIS_STYLE) {
    const out = { ...DEFAULT_AXIS_STYLE, ...(base && typeof base === 'object' ? base : {}) };
    if (!raw || typeof raw !== 'object') return out;
    for (const key of ['frame', 'tickDir', 'yAxisSide', 'enthalpyRulerStyle', 'curveLabelStyle', 'gridClipping']) {
      if (key in raw && typeof raw[key] === 'string' && raw[key].trim()) {
        out[key] = raw[key].trim();
      }
    }
    for (const key of ['showSubTicks', 'showDualPvScale']) {
      if (key in raw && raw[key] !== undefined) {
        out[key] = Boolean(raw[key]);
      }
    }
    return out;
  }

  function sanitizeTrendStyle(raw, base = DEFAULT_TREND_STYLE) {
    const out = { ...DEFAULT_TREND_STYLE, ...(base && typeof base === 'object' ? base : {}) };
    if (!raw || typeof raw !== 'object') return out;
    for (const key of ['arrowStyle', 'lineWeight', 'pointMarker', 'badgeStyle']) {
      if (key in raw && typeof raw[key] === 'string' && raw[key].trim()) {
        out[key] = raw[key].trim();
      }
    }
    for (const key of ['showDecompLegs']) {
      if (key in raw && raw[key] !== undefined) {
        out[key] = Boolean(raw[key]);
      }
    }
    return out;
  }

  function applyDomTheme(themeName) {
    try {
      const root = CoreDOM.byId('app');
      if (root) root.setAttribute('data-theme', themeName);
    } catch {
      // Safe no-op in headless/Node environments
    }
  }

  function cleanSelectionRefs() {
    if (state.ui.selectedPtId != null && !findById(state.points, state.ui.selectedPtId)) {
      state.ui.selectedPtId = null;
    }
    if (state.ui.selectedProcId != null && !findById(state.processes, state.ui.selectedProcId)) {
      state.ui.selectedProcId = null;
    }
    if (state.shr.refPointId != null && !findById(state.points, state.shr.refPointId)) {
      state.shr.refPointId = null;
    }
    if (state.compareScenarioId != null && !findById(state.scenarios, state.compareScenarioId)) {
      state.compareScenarioId = null;
    }
  }

  function defaultFlowForUnits(units) {
    return units === 'IP'
      ? { flowVal: 2000, flowUnit: 'cfm' }
      : { flowVal: 1000, flowUnit: 'Lps' };
  }

  function normalizeProcessRole(role) {
    if (role == null || role === '') return null;
    const r = String(role).trim().toLowerCase();
    return VALID_PROCESS_ROLES.has(r) ? r : null;
  }

  function normalizeFlowUnitName(unit, units = state.units) {
    const low = String(unit || '').trim().toLowerCase();
    if (low === 'lps' || low === 'l/s') return 'Lps';
    if (low === 'kgps' || low === 'kgs' || low === 'kg/s') return 'kgps';
    if (low === 'm3h' || low === 'm3/h' || low === 'm³/h') return 'm3h';
    if (low === 'cfm' || low === 'ft3/min' || low === 'ft³/min') return 'cfm';
    if (low === 'lbps' || low === 'lbs' || low === 'lb/s') return 'lbps';
    return units === 'IP' ? 'cfm' : 'Lps';
  }

  function convertProcessFlowToUnits(proc, targetUnits, refPt) {
    const def = defaultFlowForUnits(targetUnits);
    const val = Number(proc?.flowVal);
    if (!Number.isFinite(val) || val < 0) return def;
    const rawU = normalizeFlowUnitName(proc?.flowUnit, targetUnits);
    const isSIUnit = rawU === 'Lps' || rawU === 'm3h' || rawU === 'kgps';
    const isIPUnit = rawU === 'cfm' || rawU === 'lbps';

    if (targetUnits === 'SI' && isSIUnit) return { flowVal: val, flowUnit: rawU };
    if (targetUnits === 'IP' && isIPUnit) return { flowVal: val, flowUnit: rawU };

    const targetUnit = targetUnits === 'IP'
      ? (rawU === 'kgps' ? 'lbps' : 'cfm')
      : (rawU === 'lbps' ? 'kgps' : 'Lps');

    const refT = Number.isFinite(refPt?.T) ? refPt.T : 20;
    const refW = Number.isFinite(refPt?.w) ? refPt.w : 0.008;
    let converted = val;
    if (typeof Psy?.flowToMassKgps === 'function' && typeof Psy?.massKgpsToFlow === 'function') {
      const mKgps = Psy.flowToMassKgps(val, rawU, refT, refW, state.pPa);
      converted = Psy.massKgpsToFlow(mKgps, targetUnit, refT, refW, state.pPa);
    } else if (rawU === 'cfm' && targetUnit === 'Lps') {
      converted = val / 2.118880003;
    } else if (rawU === 'Lps' && targetUnit === 'cfm') {
      converted = val * 2.118880003;
    } else if (rawU === 'm3h' && targetUnit === 'cfm') {
      converted = val * 0.588577779;
    } else if (rawU === 'lbps' && targetUnit === 'kgps') {
      converted = val / 2.20462262185;
    } else if (rawU === 'kgps' && targetUnit === 'lbps') {
      converted = val * 2.20462262185;
    }

    const dec = (targetUnit === 'kgps' || targetUnit === 'lbps') ? 3 : 1;
    return {
      flowVal: Number.isFinite(converted) ? CoreDOM.round(converted, dec) : def.flowVal,
      flowUnit: targetUnit
    };
  }

  function normalizePoint(raw, fallbackIdx, assignedId) {
    const T = CoreDOM.clamp(numOr(raw?.T, 24), -60, 120);
    const w = Math.max(0, numOr(raw?.w, 0.009));
    const lblRaw = raw?.label != null ? String(raw.label).trim() : '';
    const label = lblRaw || `P${fallbackIdx + 1}`;
    const color = (typeof raw?.color === 'string' && raw.color.trim())
      ? raw.color.trim()
      : POINT_PALETTE[fallbackIdx % POINT_PALETTE.length];
    return {
      id: assignedId,
      T,
      w,
      label,
      color,
      locked: Boolean(raw?.locked),
      lx: numOr(raw?.lx, 10),
      ly: numOr(raw?.ly, -6),
      note: raw?.note != null ? String(raw.note) : '',
      derived: raw?.derived ? deepClone(raw.derived) : null
    };
  }

  function normalizeProcess(raw, aId, bId, assignedId, units = state.units) {
    const def = defaultFlowForUnits(units);
    const flowVal = raw?.flowVal != null && Number.isFinite(Number(raw.flowVal))
      ? Math.max(0, Number(raw.flowVal))
      : def.flowVal;
    const flowUnit = (typeof raw?.flowUnit === 'string' && raw.flowUnit.trim())
      ? raw.flowUnit.trim()
      : def.flowUnit;
    const adpT = (raw?.adpT != null && Number.isFinite(Number(raw.adpT))) ? Number(raw.adpT) : null;
    const adpW = (raw?.adpW != null && Number.isFinite(Number(raw.adpW))) ? Number(raw.adpW) : null;
    return {
      id: assignedId,
      aId,
      bId,
      flowVal,
      flowUnit,
      showCurve: Boolean(raw?.showCurve ?? raw?.curved),
      adpT,
      adpW,
      label: raw?.label != null ? String(raw.label) : '',
      role: normalizeProcessRole(raw?.role)
    };
  }

  function normalizeAnnotation(raw, assignedId) {
    return {
      id: assignedId,
      T: CoreDOM.clamp(numOr(raw?.T, 24), -60, 120),
      w: Math.max(0, numOr(raw?.w, 0.010)),
      text: raw?.text != null && String(raw.text).trim() ? String(raw.text).trim() : 'Note',
      color: (typeof raw?.color === 'string' && raw.color.trim()) ? raw.color.trim() : '#f59e0b'
    };
  }

  /* --------------------------------------------------------------------------
     Event Bus
     -------------------------------------------------------------------------- */

  function on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(fn);
    return () => off(event, fn);
  }

  function off(event, fn) {
    const set = listeners.get(event);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) listeners.delete(event);
  }

  function once(event, fn) {
    if (typeof fn !== 'function') return () => {};
    const unsub = on(event, payload => {
      unsub();
      fn(payload);
    });
    return unsub;
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;
    const snapshotListeners = Array.from(set);
    for (const fn of snapshotListeners) {
      try {
        fn(payload);
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error(`[Store] Error in "${event}" listener:`, err);
        }
      }
    }
  }

  function toast(message, type = 'info', anchor = null) {
    emit('toast', { message, msg: message, type, anchor });
  }

  /* --------------------------------------------------------------------------
     History (100 levels with descriptive action labels)
     -------------------------------------------------------------------------- */

  function takeSnapshot() {
    return deepClone({
      points: state.points,
      processes: state.processes,
      annotations: state.annotations,
      view: {
        tMin: state.view.tMin,
        tMax: state.view.tMax,
        wMax: state.view.wMax
      },
      pPa: state.pPa,
      altM: state.altM,
      pOverride: state.pOverride,
      shr: state.shr
    });
  }

  function restoreSnapshot(snap) {
    state.points = deepClone(snap.points || []);
    state.processes = deepClone(snap.processes || []);
    state.annotations = deepClone(snap.annotations || []);
    if (snap.view) {
      const clamped = clampViewValues(snap.view.tMin, snap.view.tMax, snap.view.wMax);
      state.view.tMin = clamped.tMin;
      state.view.tMax = clamped.tMax;
      state.view.wMax = clamped.wMax;
    }
    state.pPa = numOr(snap.pPa, 101325);
    state.altM = numOr(snap.altM, 0);
    state.pOverride = snap.pOverride != null && Number.isFinite(Number(snap.pOverride)) ? Number(snap.pOverride) : null;
    state.shr = { ...DEFAULT_SHR, ...deepClone(snap.shr || {}) };
    syncIdCounters();
    cleanSelectionRefs();
  }

  function emitHistoryEvent() {
    emit('history', {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoLabel: getUndoLabel(),
      redoLabel: getRedoLabel(),
      undoCount: undoStack.length,
      redoCount: redoStack.length
    });
  }

  function pushHistory(label = 'Edit') {
    undoStack.push({
      label: String(label || 'Edit'),
      snap: takeSnapshot()
    });
    if (undoStack.length > MAX_HISTORY) {
      undoStack.shift();
    }
    redoStack.length = 0;
    emitHistoryEvent();
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  function getUndoLabel() {
    return undoStack.length > 0 ? undoStack[undoStack.length - 1].label : '';
  }

  function getRedoLabel() {
    return redoStack.length > 0 ? redoStack[redoStack.length - 1].label : '';
  }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) return false;
    redoStack.push({
      label: entry.label,
      snap: takeSnapshot()
    });
    restoreSnapshot(entry.snap);
    emitHistoryEvent();
    emit('base-dirty', { reason: 'undo' });
    emit('overlay-dirty', { reason: 'undo' });
    emit('change', { reason: 'undo', label: entry.label });
    autosave();
    return true;
  }

  function redo() {
    const entry = redoStack.pop();
    if (!entry) return false;
    undoStack.push({
      label: entry.label,
      snap: takeSnapshot()
    });
    restoreSnapshot(entry.snap);
    emitHistoryEvent();
    emit('base-dirty', { reason: 'redo' });
    emit('overlay-dirty', { reason: 'redo' });
    emit('change', { reason: 'redo', label: entry.label });
    autosave();
    return true;
  }

  /* --------------------------------------------------------------------------
     Derived Mix Recomputation (2-stream & Multi-stream)
     -------------------------------------------------------------------------- */

  function recomputeDerived() {
    let anyChanged = false;
    const maxPasses = Math.max(1, state.points.length + 1);

    for (let pass = 0; pass < maxPasses; pass++) {
      let passChanged = false;
      const toRemoveIds = [];

      for (const pt of state.points) {
        const d = pt.derived;
        if (!d || d.type !== 'mix') continue;

        let resolvedStreams = [];
        let valid = true;

        if (Array.isArray(d.streams)) {
          const surviving = [];
          for (const s of d.streams) {
            const refId = s?.id ?? s?.ptId ?? s?.pointId;
            const m = Number(s?.m ?? s?.massFlow);
            const src = findById(state.points, refId);
            if (src && src.id !== pt.id && Number.isFinite(m) && m > 0) {
              surviving.push({ id: src.id, m });
              resolvedStreams.push({ pt: src, m });
            }
          }
          if (surviving.length < 2) {
            valid = false;
          } else if (surviving.length !== d.streams.length) {
            d.streams = surviving;
            passChanged = true;
          }
        } else {
          const ptA = findById(state.points, d.aId);
          const ptB = findById(state.points, d.bId);
          const mA = Number(d.mA);
          const mB = Number(d.mB);
          if (!ptA || !ptB || ptA.id === pt.id || ptB.id === pt.id || !(mA > 0) || !(mB > 0)) {
            valid = false;
          } else {
            d.aId = ptA.id;
            d.bId = ptB.id;
            resolvedStreams = [
              { pt: ptA, m: mA },
              { pt: ptB, m: mB }
            ];
          }
        }

        if (!valid) {
          toRemoveIds.push(pt.id);
          passChanged = true;
          continue;
        }

        let mTot = 0;
        let wSum = 0;
        let hSum = 0;
        for (const s of resolvedStreams) {
          mTot += s.m;
          wSum += s.m * s.pt.w;
          hSum += s.m * h_kJkg(s.pt.T, s.pt.w);
        }

        if (!(mTot > 0)) {
          toRemoveIds.push(pt.id);
          passChanged = true;
          continue;
        }

        const wMix = Math.max(0, wSum / mTot);
        const hMix = hSum / mTot;
        const Tmix = Tdb_from_wh(wMix, hMix);
        const ws = wsat_at(Tmix, state.pPa);
        let tFinal = Tmix;
        let wFinal = wMix;

        if (wMix > ws + 1e-7) {
          // Supersaturated fog-zone mixing: solve constant-enthalpy saturated equilibrium
          // h(T_eq, wsat(T_eq)) = hMix via bisection on [Tmix - 15, Tmix + 35]
          let lo = Math.max(-60, Tmix - 15);
          let hi = Math.min(90, Tmix + 35);
          while (lo > -60 && h_kJkg(lo, wsat_at(lo, state.pPa)) > hMix) lo = Math.max(-60, lo - 15);
          while (hi < 90 && h_kJkg(hi, wsat_at(hi, state.pPa)) < hMix) hi = Math.min(90, hi + 15);
          for (let i = 0; i < 60; i++) {
            const mid = 0.5 * (lo + hi);
            if (h_kJkg(mid, wsat_at(mid, state.pPa)) > hMix) hi = mid;
            else lo = mid;
            if (hi - lo < 1e-8) break;
          }
          tFinal = 0.5 * (lo + hi);
          wFinal = wsat_at(tFinal, state.pPa);
        }

        if (Math.abs(pt.T - tFinal) > 1e-9 || Math.abs(pt.w - wFinal) > 1e-12) {
          pt.T = tFinal;
          pt.w = wFinal;
          passChanged = true;
        }
      }

      if (toRemoveIds.length > 0) {
        const removeSet = new Set(toRemoveIds);
        state.points = state.points.filter(p => !removeSet.has(p.id));
        state.processes = state.processes.filter(pr => !removeSet.has(pr.aId) && !removeSet.has(pr.bId));
        cleanSelectionRefs();
      }

      if (passChanged) {
        anyChanged = true;
      } else {
        break;
      }
    }

    return anyChanged;
  }

  /* --------------------------------------------------------------------------
     Points CRUD
     -------------------------------------------------------------------------- */

  function getPoint(id) {
    return findById(state.points, id);
  }

  function addPoint(pt = {}, recordHistory = true) {
    const idx = state.points.length;
    const id = nextPtId++;
    const created = normalizePoint(pt, idx, id);

    if (recordHistory) {
      pushHistory(`Add Point "${created.label}"`);
    }

    state.points.push(created);
    if (created.derived) {
      recomputeDerived();
    }

    emit('overlay-dirty', { reason: 'add-point', pointId: created.id });
    emit('change', { reason: 'add-point', pointId: created.id });
    autosave();
    return created;
  }

  function updatePoint(id, patch = {}, recordHistory = true) {
    const pt = getPoint(id);
    if (!pt || !patch || typeof patch !== 'object') return null;

    const willBeLocked = 'locked' in patch ? Boolean(patch.locked) : pt.locked;
    const isCoordEdit = ('T' in patch) || ('w' in patch);
    if (pt.locked && willBeLocked && isCoordEdit && !patch.force) {
      const hasNonCoordFields = ['label', 'color', 'lx', 'ly', 'note', 'locked', 'derived'].some(k => k in patch);
      if (!hasNonCoordFields) return null;
    }

    if (recordHistory) {
      pushHistory(`Edit Point "${pt.label}"`);
    }

    let coordsOrDerivedChanged = false;

    if ('locked' in patch) {
      pt.locked = Boolean(patch.locked);
    }

    if (!pt.locked || patch.force) {
      if ('T' in patch && Number.isFinite(Number(patch.T))) {
        pt.T = CoreDOM.clamp(Number(patch.T), -60, 120);
        coordsOrDerivedChanged = true;
      }
      if ('w' in patch && Number.isFinite(Number(patch.w))) {
        pt.w = Math.max(0, Number(patch.w));
        coordsOrDerivedChanged = true;
      }
      if ('label' in patch && patch.label != null) {
        const trimmed = String(patch.label).trim();
        if (trimmed) pt.label = trimmed;
      }
    }

    if ('color' in patch && typeof patch.color === 'string' && patch.color.trim()) {
      pt.color = patch.color.trim();
    }
    if ('lx' in patch && Number.isFinite(Number(patch.lx))) {
      pt.lx = Number(patch.lx);
    }
    if ('ly' in patch && Number.isFinite(Number(patch.ly))) {
      pt.ly = Number(patch.ly);
    }
    if ('note' in patch && patch.note !== undefined) {
      pt.note = patch.note == null ? '' : String(patch.note);
    }
    if ('derived' in patch) {
      pt.derived = patch.derived ? deepClone(patch.derived) : null;
      coordsOrDerivedChanged = true;
    }

    if (coordsOrDerivedChanged) {
      recomputeDerived();
    }

    emit('overlay-dirty', { reason: 'update-point', pointId: pt.id });
    emit('change', { reason: 'update-point', pointId: pt.id });
    autosave();
    return pt;
  }

  function deletePoint(id) {
    const idx = findIndexById(state.points, id);
    if (idx < 0) {
      return { ok: false, reason: 'Point not found' };
    }
    const pt = state.points[idx];
    if (pt.locked) {
      return { ok: false, reason: `"${pt.label}" is locked — unlock it first` };
    }

    pushHistory(`Delete Point "${pt.label}"`);

    state.points.splice(idx, 1);
    state.processes = state.processes.filter(pr => pr.aId !== pt.id && pr.bId !== pt.id);
    cleanSelectionRefs();
    recomputeDerived();

    emit('overlay-dirty', { reason: 'delete-point', pointId: pt.id });
    emit('change', { reason: 'delete-point', pointId: pt.id });
    autosave();
    return { ok: true, deletedId: pt.id };
  }

  function duplicatePoint(id) {
    const src = getPoint(id);
    if (!src) return null;

    pushHistory(`Duplicate Point "${src.label}"`);
    const copy = normalizePoint(
      {
        T: src.T,
        w: src.w,
        label: `${src.label} copy`,
        color: POINT_PALETTE[state.points.length % POINT_PALETTE.length],
        locked: false,
        lx: (src.lx ?? 10) + 6,
        ly: (src.ly ?? -6) - 6,
        note: src.note || '',
        derived: null
      },
      state.points.length,
      nextPtId++
    );

    state.points.push(copy);
    emit('overlay-dirty', { reason: 'duplicate-point', pointId: copy.id });
    emit('change', { reason: 'duplicate-point', pointId: copy.id });
    autosave();
    return copy;
  }

  /* --------------------------------------------------------------------------
     Processes CRUD
     -------------------------------------------------------------------------- */

  function getProcess(id) {
    return findById(state.processes, id);
  }

  function addProcess(aId, bId, opts = {}, recordHistory = true) {
    const ptA = getPoint(aId);
    const ptB = getPoint(bId);
    if (!ptA || !ptB || ptA.id === ptB.id) return null;

    if (recordHistory) {
      pushHistory(`Add Process ${ptA.label} → ${ptB.label}`);
    }

    const proc = normalizeProcess(opts, ptA.id, ptB.id, nextProcId++, state.units);
    state.processes.push(proc);
    if (state.ui.selectedProcId == null) {
      state.ui.selectedProcId = proc.id;
    }

    emit('overlay-dirty', { reason: 'add-process', processId: proc.id });
    emit('change', { reason: 'add-process', processId: proc.id });
    autosave();
    return proc;
  }

  function updateProcess(id, patch = {}, recordHistory = true) {
    const proc = getProcess(id);
    if (!proc || !patch || typeof patch !== 'object') return null;

    if (recordHistory) {
      pushHistory('Edit Process');
    }

    if ('aId' in patch) {
      const ptA = getPoint(patch.aId);
      const targetBId = 'bId' in patch ? (getPoint(patch.bId)?.id ?? proc.bId) : proc.bId;
      if (ptA && ptA.id !== targetBId) proc.aId = ptA.id;
    }
    if ('bId' in patch) {
      const ptB = getPoint(patch.bId);
      if (ptB && ptB.id !== proc.aId) proc.bId = ptB.id;
    }
    if ('flowVal' in patch && Number.isFinite(Number(patch.flowVal))) {
      proc.flowVal = Math.max(0, Number(patch.flowVal));
    }
    if ('flowUnit' in patch && typeof patch.flowUnit === 'string' && patch.flowUnit.trim()) {
      proc.flowUnit = patch.flowUnit.trim();
    }
    if ('showCurve' in patch) {
      proc.showCurve = Boolean(patch.showCurve);
    }
    if ('adpT' in patch) {
      proc.adpT = (patch.adpT != null && Number.isFinite(Number(patch.adpT))) ? Number(patch.adpT) : null;
    }
    if ('adpW' in patch) {
      proc.adpW = (patch.adpW != null && Number.isFinite(Number(patch.adpW))) ? Number(patch.adpW) : null;
    }
    if ('label' in patch && patch.label !== undefined) {
      proc.label = patch.label == null ? '' : String(patch.label);
    }
    if ('role' in patch) {
      proc.role = normalizeProcessRole(patch.role);
    }

    emit('overlay-dirty', { reason: 'update-process', processId: proc.id });
    emit('change', { reason: 'update-process', processId: proc.id });
    autosave();
    return proc;
  }

  function deleteProcess(id) {
    const idx = findIndexById(state.processes, id);
    if (idx < 0) return false;

    pushHistory('Delete Process');
    const [removed] = state.processes.splice(idx, 1);
    if (state.ui.selectedProcId === removed.id) {
      state.ui.selectedProcId = state.processes[0]?.id ?? null;
    }

    emit('overlay-dirty', { reason: 'delete-process', processId: removed.id });
    emit('change', { reason: 'delete-process', processId: removed.id });
    autosave();
    return true;
  }

  function reverseProcess(id) {
    const proc = getProcess(id);
    if (!proc) return null;

    pushHistory('Reverse Process');
    const tmp = proc.aId;
    proc.aId = proc.bId;
    proc.bId = tmp;

    const a = getPoint(proc.aId);
    const b = getPoint(proc.bId);
    const isCoolDehum = Boolean(a && b && b.T < a.T - 0.5 && b.w < a.w - 0.0001);
    if (!isCoolDehum) {
      proc.showCurve = false;
    }
    proc.adpT = null;
    proc.adpW = null;

    emit('overlay-dirty', { reason: 'reverse-process', processId: proc.id });
    emit('change', { reason: 'reverse-process', processId: proc.id });
    autosave();
    return proc;
  }

  /* --------------------------------------------------------------------------
     Annotations CRUD
     -------------------------------------------------------------------------- */

  function addAnnotation(ann = {}, recordHistory = true) {
    if (recordHistory) {
      pushHistory('Add Annotation');
    }
    const created = normalizeAnnotation(ann, nextAnnId++);
    state.annotations.push(created);

    emit('overlay-dirty', { reason: 'add-annotation', annotationId: created.id });
    emit('change', { reason: 'add-annotation', annotationId: created.id });
    autosave();
    return created;
  }

  function updateAnnotation(id, patch = {}, recordHistory = true) {
    const ann = findById(state.annotations, id);
    if (!ann || !patch || typeof patch !== 'object') return null;

    if (recordHistory) {
      pushHistory('Edit Annotation');
    }

    if ('T' in patch && Number.isFinite(Number(patch.T))) {
      ann.T = CoreDOM.clamp(Number(patch.T), -60, 120);
    }
    if ('w' in patch && Number.isFinite(Number(patch.w))) {
      ann.w = Math.max(0, Number(patch.w));
    }
    if ('text' in patch && patch.text != null) {
      const trimmed = String(patch.text).trim();
      if (trimmed) ann.text = trimmed;
    }
    if ('color' in patch && typeof patch.color === 'string' && patch.color.trim()) {
      ann.color = patch.color.trim();
    }

    emit('overlay-dirty', { reason: 'update-annotation', annotationId: ann.id });
    emit('change', { reason: 'update-annotation', annotationId: ann.id });
    autosave();
    return ann;
  }

  function deleteAnnotation(id, recordHistory = true) {
    const idx = findIndexById(state.annotations, id);
    if (idx < 0) return false;

    if (recordHistory) {
      pushHistory('Delete Annotation');
    }
    const [removed] = state.annotations.splice(idx, 1);

    emit('overlay-dirty', { reason: 'delete-annotation', annotationId: removed.id });
    emit('change', { reason: 'delete-annotation', annotationId: removed.id });
    autosave();
    return true;
  }

  /* --------------------------------------------------------------------------
     Atomic Cycle Loader & Clear All
     -------------------------------------------------------------------------- */

  function loadCycle(pointsList = [], processesList = [], metaPatch = {}, historyLabel = 'Load Preset') {
    pushHistory(historyLabel);

    const idMap = new Map();
    const indexToId = [];
    const newPoints = [];

    for (let i = 0; i < pointsList.length; i++) {
      const rawPt = pointsList[i] || {};
      const newId = nextPtId++;
      indexToId[i] = newId;
      if (rawPt.id != null) {
        idMap.set(rawPt.id, newId);
        idMap.set(String(rawPt.id), newId);
      }
      if (rawPt.key != null) {
        idMap.set(rawPt.key, newId);
        idMap.set(String(rawPt.key), newId);
      }
      newPoints.push(normalizePoint(rawPt, i, newId));
    }

    function resolveRef(ref, forceIndex = false) {
      if (ref == null) return null;
      if (!forceIndex) {
        if (idMap.has(ref)) return idMap.get(ref);
        if (idMap.has(String(ref))) return idMap.get(String(ref));
      }
      const n = Number(ref);
      if (Number.isInteger(n) && n >= 0 && n < indexToId.length) {
        return indexToId[n];
      }
      return null;
    }

    for (const pt of newPoints) {
      if (pt.derived && pt.derived.type === 'mix') {
        if (Array.isArray(pt.derived.streams)) {
          pt.derived.streams = pt.derived.streams
            .map(s => ({
              id: resolveRef(s?.id ?? s?.ptId ?? s?.pointId ?? s?.idx),
              m: Number(s?.m ?? s?.massFlow)
            }))
            .filter(s => s.id != null && Number.isFinite(s.m) && s.m > 0);
        } else {
          const aRef = pt.derived.aId ?? pt.derived.aIdx;
          const bRef = pt.derived.bId ?? pt.derived.bIdx;
          const forceIdx = pt.derived.aId == null && pt.derived.aIdx != null;
          pt.derived.aId = resolveRef(aRef, forceIdx);
          pt.derived.bId = resolveRef(bRef, forceIdx);
        }
      }
    }

    const newProcesses = [];
    for (const rawProc of processesList || []) {
      if (!rawProc) continue;
      let aId = null;
      let bId = null;
      let opts = {};

      if (Array.isArray(rawProc)) {
        aId = resolveRef(rawProc[0], true);
        bId = resolveRef(rawProc[1], true);
        opts = (rawProc[2] && typeof rawProc[2] === 'object') ? rawProc[2] : {};
      } else if (typeof rawProc === 'object') {
        const hasExplicitIdx = (rawProc.aIdx != null || rawProc.fromIdx != null) && rawProc.aId == null && rawProc.fromKey == null;
        const aRef = rawProc.aId ?? rawProc.fromKey ?? rawProc.a ?? rawProc.from ?? rawProc.aIdx ?? rawProc.fromIdx;
        const bRef = rawProc.bId ?? rawProc.toKey ?? rawProc.b ?? rawProc.to ?? rawProc.bIdx ?? rawProc.toIdx;
        aId = resolveRef(aRef, hasExplicitIdx);
        bId = resolveRef(bRef, hasExplicitIdx);
        opts = rawProc;
      }

      if (aId != null && bId != null && aId !== bId) {
        newProcesses.push(normalizeProcess(opts, aId, bId, nextProcId++, state.units));
      }
    }

    state.points = newPoints;
    state.processes = newProcesses;

    if (metaPatch && typeof metaPatch === 'object') {
      if ('name' in metaPatch && metaPatch.name != null) state.meta.name = String(metaPatch.name);
      if ('version' in metaPatch && metaPatch.version != null) state.meta.version = String(metaPatch.version);
      if ('company' in metaPatch && metaPatch.company != null) state.meta.company = String(metaPatch.company);
      if ('engineer' in metaPatch && metaPatch.engineer != null) state.meta.engineer = String(metaPatch.engineer);
      if ('notes' in metaPatch && metaPatch.notes != null) state.meta.notes = String(metaPatch.notes);
      if (metaPatch.clearAnnotations) state.annotations = [];
    }

    recomputeDerived();
    state.ui.selectedPtId = state.points[0]?.id ?? null;
    state.ui.selectedProcId = state.processes[0]?.id ?? null;
    state.shr.refPointId = null;
    state.shr.anchorTw = null;

    emit('overlay-dirty', { reason: 'load-cycle' });
    emit('change', { reason: 'load-cycle', label: historyLabel });
    autosave();
    return { points: state.points, processes: state.processes };
  }

  function clearAll() {
    pushHistory('Clear All');
    state.points = [];
    state.processes = [];
    state.annotations = [];
    state.ui.selectedPtId = null;
    state.ui.selectedProcId = null;
    state.shr.refPointId = null;
    state.shr.anchorTw = null;

    emit('overlay-dirty', { reason: 'clear-all' });
    emit('change', { reason: 'clear-all' });
    autosave();
  }

  /* --------------------------------------------------------------------------
     Units, Theme, Atmosphere, Meta, UI
     -------------------------------------------------------------------------- */

  function setMeta(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    for (const key of ['name', 'version', 'company', 'engineer', 'notes']) {
      if (key in patch && patch[key] !== undefined) {
        state.meta[key] = patch[key] == null ? '' : String(patch[key]);
      }
    }
    emit('change', { reason: 'meta' });
    autosave();
  }

  function setUI(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    let nonHoverChanged = false;
    const hoverKeys = new Set(['hoverPx', 'hoverPy', 'hovPickId', 'hovLabelId', 'dragPtId', 'dragSnapLabel']);

    for (const key of Object.keys(patch)) {
      if (!(key in state.ui)) continue;
      let val = patch[key];
      if (key === 'selectedPtId' && val != null) {
        val = getPoint(val)?.id ?? null;
      } else if (key === 'selectedProcId' && val != null) {
        val = getProcess(val)?.id ?? null;
      }
      if (state.ui[key] !== val) {
        state.ui[key] = val;
        if (!hoverKeys.has(key)) nonHoverChanged = true;
      }
    }

    emit('overlay-dirty', { reason: 'ui' });
    if (nonHoverChanged) {
      emit('change', { reason: 'ui' });
    }
  }

  function setUnits(units) {
    if (units !== 'SI' && units !== 'IP') return false;
    if (state.units === units) return false;

    const oldDef = state.units === 'IP' ? state.view.defaultIP : state.view.defaultSI;
    const atDefaultView =
      Math.abs(state.view.tMin - oldDef.tMin) < 0.25 &&
      Math.abs(state.view.tMax - oldDef.tMax) < 0.25 &&
      Math.abs(state.view.wMax - oldDef.wMax) < 0.001;

    state.units = units;

    if (atDefaultView) {
      const newDef = units === 'IP' ? state.view.defaultIP : state.view.defaultSI;
      state.view.tMin = newDef.tMin;
      state.view.tMax = newDef.tMax;
      state.view.wMax = newDef.wMax;
    }

    emit('units-changed', { units });
    emit('base-dirty', { reason: 'units' });
    emit('overlay-dirty', { reason: 'units' });
    emit('change', { reason: 'units', units });
    autosave();
    return true;
  }

  function applyVisualPreset(presetId, { applyRecommendedCurves = false } = {}) {
    const resolved = normalizeThemeName(presetId);
    state.theme = resolved;
    applyDomTheme(resolved);

    const preset = resolved !== 'custom' ? THEME_PRESETS[resolved] : null;
    if (preset) {
      state.axisStyle = sanitizeAxisStyle(preset.axisStyle, DEFAULT_AXIS_STYLE);
      state.trendStyle = sanitizeTrendStyle(preset.trendStyle, DEFAULT_TREND_STYLE);
      if (applyRecommendedCurves && preset.recommended) {
        if (Number.isFinite(Number(preset.recommended.rhStep))) {
          state.grid.rhStep = CoreDOM.clamp(Math.round(Number(preset.recommended.rhStep)), 5, 25);
        }
        if ('dp' in preset.recommended) {
          state.layers.dp = Boolean(preset.recommended.dp);
        }
      }
    }

    emit('theme-changed', {
      theme: resolved,
      axisStyle: state.axisStyle,
      trendStyle: state.trendStyle,
      appliedRecommendedCurves: Boolean(applyRecommendedCurves && preset?.recommended)
    });
    emit('base-dirty', { reason: 'theme', theme: resolved });
    emit('overlay-dirty', { reason: 'theme', theme: resolved });
    emit('change', { reason: 'theme', theme: resolved });
    autosave();
    return resolved;
  }

  function setTheme(theme) {
    return applyVisualPreset(theme, { applyRecommendedCurves: false });
  }

  function setAxisStyle(patch = {}) {
    if (!patch || typeof patch !== 'object') return state.axisStyle;
    state.axisStyle = sanitizeAxisStyle(patch, state.axisStyle);

    emit('base-dirty', { reason: 'axis-style', axisStyle: state.axisStyle });
    emit('change', { reason: 'axis-style', axisStyle: state.axisStyle });
    autosave();
    return state.axisStyle;
  }

  function setTrendStyle(patch = {}) {
    if (!patch || typeof patch !== 'object') return state.trendStyle;
    state.trendStyle = sanitizeTrendStyle(patch, state.trendStyle);

    emit('overlay-dirty', { reason: 'trend-style', trendStyle: state.trendStyle });
    emit('change', { reason: 'trend-style', trendStyle: state.trendStyle });
    autosave();
    return state.trendStyle;
  }

  function updateCustomTheme(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    Object.assign(state.customTheme, patch);

    emit('theme-changed', { theme: state.theme, customTheme: state.customTheme });
    emit('base-dirty', { reason: 'custom-theme' });
    emit('overlay-dirty', { reason: 'custom-theme' });
    emit('change', { reason: 'custom-theme' });
    autosave();
  }

  function resetCustomTheme() {
    state.customTheme = { ...DEFAULT_CUSTOM_THEME };
    emit('theme-changed', { theme: state.theme, customTheme: state.customTheme });
    emit('base-dirty', { reason: 'reset-custom-theme' });
    emit('overlay-dirty', { reason: 'reset-custom-theme' });
    emit('change', { reason: 'reset-custom-theme' });
    autosave();
  }

  function recomputeWeatherBins() {
    if (
      Array.isArray(state.weather.records) &&
      state.weather.records.length > 0 &&
      Weather &&
      typeof Weather.computePsychroBins === 'function'
    ) {
      state.weather.bins = Weather.computePsychroBins(state.weather.records, state.pPa, state.comfort);
      return true;
    }
    return false;
  }

  function setAtmosphere(pPa, altM, pOverride = null, recordHistory = true) {
    const hasOverride = pOverride != null && pOverride !== '' && Number.isFinite(Number(pOverride));
    let resolvedP;
    let resolvedAlt;

    if (hasOverride) {
      resolvedP = CoreDOM.clamp(Number(pOverride), 30000, 115000);
      resolvedAlt = (altM != null && Number.isFinite(Number(altM)))
        ? CoreDOM.clamp(Number(altM), -500, 9000)
        : CoreDOM.clamp(invBaroAlt_m(resolvedP), -500, 9000);
    } else if (pPa != null && Number.isFinite(Number(pPa))) {
      resolvedP = CoreDOM.clamp(Number(pPa), 30000, 115000);
      resolvedAlt = (altM != null && Number.isFinite(Number(altM)))
        ? CoreDOM.clamp(Number(altM), -500, 9000)
        : CoreDOM.clamp(invBaroAlt_m(resolvedP), -500, 9000);
    } else if (altM != null && Number.isFinite(Number(altM))) {
      resolvedAlt = CoreDOM.clamp(Number(altM), -500, 9000);
      resolvedP = CoreDOM.clamp(baroPa(resolvedAlt), 30000, 115000);
    } else {
      return;
    }

    if (recordHistory) {
      pushHistory('Change Atmosphere');
    }

    state.pPa = resolvedP;
    state.altM = resolvedAlt;
    state.pOverride = hasOverride ? resolvedP : null;

    recomputeDerived();
    const rebinned = recomputeWeatherBins();

    if (rebinned) emit('weather-changed', { weather: state.weather });
    emit('base-dirty', { reason: 'atmosphere' });
    emit('overlay-dirty', { reason: 'atmosphere' });
    emit('change', { reason: 'atmosphere', pPa: state.pPa, altM: state.altM });
    autosave();
  }

  /* --------------------------------------------------------------------------
     View / Zoom / Fit
     -------------------------------------------------------------------------- */

  function setView(patch = {}, recordHistory = false) {
    if (!patch || typeof patch !== 'object') return;
    const clamped = clampViewValues(
      'tMin' in patch ? patch.tMin : state.view.tMin,
      'tMax' in patch ? patch.tMax : state.view.tMax,
      'wMax' in patch ? patch.wMax : state.view.wMax
    );

    if (recordHistory) {
      pushHistory('Change View');
    }

    state.view.tMin = clamped.tMin;
    state.view.tMax = clamped.tMax;
    state.view.wMax = clamped.wMax;

    emit('base-dirty', { reason: 'view' });
    emit('overlay-dirty', { reason: 'view' });
    emit('change', { reason: 'view' });
    autosave();
  }

  function resetView(recordHistory = true) {
    const def = state.units === 'IP' ? state.view.defaultIP : state.view.defaultSI;
    setView({ tMin: def.tMin, tMax: def.tMax, wMax: def.wMax }, recordHistory);
  }

  function fitPoints(recordHistory = true) {
    if (state.points.length === 0) {
      resetView(recordHistory);
      return;
    }

    let tLo = Infinity;
    let tHi = -Infinity;
    let maxPtW = 0;

    for (const pt of state.points) {
      if (pt.T < tLo) tLo = pt.T;
      if (pt.T > tHi) tHi = pt.T;
      if (pt.w > maxPtW) maxPtW = pt.w;
    }

    const spanT = Math.max(tHi - tLo, 8);
    const padT = Math.max(spanT * 0.18, 3);
    tLo = CoreDOM.clamp(tLo - padT, VIEW_BOUNDS.tMin, VIEW_BOUNDS.tMax - VIEW_BOUNDS.minSpanT);
    tHi = CoreDOM.clamp(tHi + padT, tLo + VIEW_BOUNDS.minSpanT, VIEW_BOUNDS.tMax);

    const satRefW = wsat_at(tHi, state.pPa);
    const wTarget = CoreDOM.clamp(
      Math.max(maxPtW * 1.35, Math.min(satRefW * 1.15, 0.015)),
      0.004,
      VIEW_BOUNDS.wMax
    );

    setView({ tMin: tLo, tMax: tHi, wMax: wTarget }, recordHistory);
  }

  function zoomAt(tAnchor, wAnchor, scale) {
    const s = Number(scale);
    if (!Number.isFinite(s) || s <= 0) return;

    const oldSpanT = state.view.tMax - state.view.tMin;
    const anchorT = Number.isFinite(Number(tAnchor))
      ? Number(tAnchor)
      : (state.view.tMin + state.view.tMax) / 2;
    const fracT = oldSpanT > 0 ? (anchorT - state.view.tMin) / oldSpanT : 0.5;

    const newSpanT = CoreDOM.clamp(oldSpanT / s, VIEW_BOUNDS.minSpanT, VIEW_BOUNDS.tMax - VIEW_BOUNDS.tMin);
    let newTMin = anchorT - fracT * newSpanT;
    let newTMax = newTMin + newSpanT;

    if (newTMin < VIEW_BOUNDS.tMin) {
      newTMin = VIEW_BOUNDS.tMin;
      newTMax = Math.min(VIEW_BOUNDS.tMax, newTMin + newSpanT);
    } else if (newTMax > VIEW_BOUNDS.tMax) {
      newTMax = VIEW_BOUNDS.tMax;
      newTMin = Math.max(VIEW_BOUNDS.tMin, newTMax - newSpanT);
    }

    // Bottom axis is fixed at w = 0 on a psychrometric chart; scale vertical span around w = 0
    // (if wAnchor is provided and positive, still preserve clean w = 0 baseline)
    const newWMax = CoreDOM.clamp(state.view.wMax / s, VIEW_BOUNDS.wMin, VIEW_BOUNDS.wMax);
    void wAnchor;

    setView({ tMin: newTMin, tMax: newTMax, wMax: newWMax }, false);
  }

  /* --------------------------------------------------------------------------
     Layers, Comfort, SHR, Grid, Weather, Tool
     -------------------------------------------------------------------------- */

  function setLayer(key, val) {
    if (!key) return;
    state.layers[key] = Boolean(val);
    if (OVERLAY_LAYERS.has(key)) {
      emit('overlay-dirty', { reason: 'layer', key, value: state.layers[key] });
    } else {
      emit('base-dirty', { reason: 'layer', key, value: state.layers[key] });
    }
    emit('change', { reason: 'layer', key, value: state.layers[key] });
    autosave();
  }

  function toggleLayer(key) {
    setLayer(key, !state.layers[key]);
    return state.layers[key];
  }

  function setComfort(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    if ('mode' in patch && patch.mode != null) state.comfort.mode = String(patch.mode);
    if ('standard' in patch && (patch.standard === 'ashrae55' || patch.standard === 'iso7730')) {
      state.comfort.standard = patch.standard;
    }
    if ('capHumidity' in patch) {
      state.comfort.capHumidity = Boolean(patch.capHumidity);
    }
    if ('cloSummer' in patch && Number.isFinite(Number(patch.cloSummer))) {
      state.comfort.cloSummer = CoreDOM.clamp(Number(patch.cloSummer), 0.1, 2.5);
    }
    if ('cloWinter' in patch && Number.isFinite(Number(patch.cloWinter))) {
      state.comfort.cloWinter = CoreDOM.clamp(Number(patch.cloWinter), 0.1, 2.5);
    }
    if ('met' in patch && Number.isFinite(Number(patch.met))) {
      state.comfort.met = CoreDOM.clamp(Number(patch.met), 0.7, 4.0);
    }
    if ('vAir' in patch && Number.isFinite(Number(patch.vAir))) {
      state.comfort.vAir = CoreDOM.clamp(Number(patch.vAir), 0.01, 2.0);
    }
    if ('mrtOffset' in patch && Number.isFinite(Number(patch.mrtOffset))) {
      state.comfort.mrtOffset = CoreDOM.clamp(Number(patch.mrtOffset), -15, 15);
    }
    if ('pmvLimit' in patch && Number.isFinite(Number(patch.pmvLimit))) {
      state.comfort.pmvLimit = CoreDOM.clamp(Number(patch.pmvLimit), 0.1, 1.5);
    }

    const rebinned = recomputeWeatherBins();
    if (rebinned) emit('weather-changed', { weather: state.weather });
    emit('base-dirty', { reason: 'comfort' });
    emit('change', { reason: 'comfort' });
    autosave();
  }

  function setSHR(patch = {}, recordHistory = false, opts = {}) {
    if (!patch || typeof patch !== 'object') return;
    if (recordHistory) {
      pushHistory('Update SHR');
    }

    if ('show' in patch) state.shr.show = Boolean(patch.show);
    if ('value' in patch && Number.isFinite(Number(patch.value))) {
      state.shr.value = CoreDOM.clamp(Number(patch.value), -5, 5);
    }
    if ('refPointId' in patch) {
      state.shr.refPointId = patch.refPointId != null ? (getPoint(patch.refPointId)?.id ?? null) : null;
      if (state.shr.refPointId != null && !('anchorTw' in patch)) {
        state.shr.anchorTw = null;
      }
    }
    if ('anchorTw' in patch) {
      const a = patch.anchorTw;
      if (a && Number.isFinite(Number(a.T)) && Number.isFinite(Number(a.w))) {
        state.shr.anchorTw = { T: Number(a.T), w: Number(a.w) };
        if (!('refPointId' in patch)) {
          state.shr.refPointId = null;
        }
      } else {
        state.shr.anchorTw = null;
      }
    }
    if ('protractorPos' in patch) {
      state.shr.protractorPos = patch.protractorPos ? deepClone(patch.protractorPos) : null;
    }

    emit('overlay-dirty', { reason: 'shr' });
    if (opts?.silentChange) {
      emit('shr-live', { shr: state.shr });
    } else {
      emit('change', { reason: 'shr' });
    }
    if (!opts?.skipAutosave) {
      autosave();
    }
  }

  function setGrid(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    if ('density' in patch && (patch.density === 'fast' || patch.density === 'normal' || patch.density === 'fine')) {
      state.grid.density = patch.density;
    }
    if ('rhStep' in patch && Number.isFinite(Number(patch.rhStep))) {
      state.grid.rhStep = CoreDOM.clamp(Math.round(Number(patch.rhStep)), 5, 25);
    }
    if ('labelMode' in patch && patch.labelMode != null) {
      state.grid.labelMode = String(patch.labelMode);
    }
    if ('labelPx' in patch && Number.isFinite(Number(patch.labelPx))) {
      state.grid.labelPx = CoreDOM.clamp(Math.round(Number(patch.labelPx)), 8, 18);
    }
    if ('showEnthalpyRuler' in patch) {
      state.grid.showEnthalpyRuler = Boolean(patch.showEnthalpyRuler);
    }

    emit('base-dirty', { reason: 'grid' });
    emit('change', { reason: 'grid' });
    autosave();
  }

  function setWeather(weatherData = {}) {
    if (!weatherData || typeof weatherData !== 'object') return;

    const hasDataset = ('records' in weatherData && Array.isArray(weatherData.records) && weatherData.records.length > 0) ||
      ('bins' in weatherData && weatherData.bins != null);

    if ('cityId' in weatherData) state.weather.cityId = weatherData.cityId ?? null;
    if ('sourceName' in weatherData) state.weather.sourceName = weatherData.sourceName ?? null;
    if ('records' in weatherData) {
      state.weather.records = Array.isArray(weatherData.records) ? weatherData.records : [];
    }
    if ('bins' in weatherData) state.weather.bins = weatherData.bins ?? null;
    else if ('records' in weatherData && state.weather.records.length > 0) {
      recomputeWeatherBins();
    }
    if ('mode' in weatherData && weatherData.mode != null) state.weather.mode = String(weatherData.mode);
    if ('opacity' in weatherData && Number.isFinite(Number(weatherData.opacity))) {
      state.weather.opacity = CoreDOM.clamp(Number(weatherData.opacity), 0.05, 1);
    }

    if (hasDataset && weatherData.autoShow !== false) {
      state.layers.weather = true;
    }

    emit('weather-changed', { weather: state.weather });
    emit('base-dirty', { reason: 'weather' });
    emit('change', { reason: 'weather' });
    autosave();
  }

  function clearWeather() {
    state.weather.cityId = null;
    state.weather.sourceName = null;
    state.weather.records = [];
    state.weather.bins = null;
    state.layers.weather = false;

    emit('weather-changed', { weather: state.weather });
    emit('base-dirty', { reason: 'clear-weather' });
    emit('change', { reason: 'clear-weather' });
    autosave();
  }

  function setTool(toolName) {
    state.ui.activeTool = toolName ? String(toolName) : 'select';
    state.ui.toolStep = null;
    state.ui.measureStart = null;
    state.ui.measureEnd = null;
    state.ui.boxZoom = null;

    emit('overlay-dirty', { reason: 'tool', activeTool: state.ui.activeTool });
    emit('change', { reason: 'tool', activeTool: state.ui.activeTool });
  }

  /* --------------------------------------------------------------------------
     Multi-Scenario Manager
     -------------------------------------------------------------------------- */

  function saveScenario(name) {
    const cleanName = (name != null && String(name).trim())
      ? String(name).trim()
      : `Scenario ${state.scenarios.length + 1}`;
    const color = POINT_PALETTE[(state.scenarios.length + 3) % POINT_PALETTE.length];

    const scen = {
      id: nextScenId++,
      name: cleanName,
      savedAt: new Date().toISOString(),
      color,
      points: deepClone(state.points),
      processes: deepClone(state.processes)
    };

    state.scenarios.push(scen);
    emit('overlay-dirty', { reason: 'save-scenario', scenarioId: scen.id });
    emit('change', { reason: 'save-scenario', scenarioId: scen.id });
    autosave();
    return scen;
  }

  function deleteScenario(id) {
    const idx = findIndexById(state.scenarios, id);
    if (idx < 0) return false;

    const [removed] = state.scenarios.splice(idx, 1);
    if (state.compareScenarioId === removed.id) {
      state.compareScenarioId = null;
    }

    emit('overlay-dirty', { reason: 'delete-scenario', scenarioId: removed.id });
    emit('change', { reason: 'delete-scenario', scenarioId: removed.id });
    autosave();
    return true;
  }

  function setCompareScenario(id) {
    if (id == null || id === '') {
      state.compareScenarioId = null;
    } else {
      const scen = findById(state.scenarios, id);
      state.compareScenarioId = scen ? scen.id : null;
    }

    emit('overlay-dirty', { reason: 'compare-scenario', compareScenarioId: state.compareScenarioId });
    emit('change', { reason: 'compare-scenario', compareScenarioId: state.compareScenarioId });
    autosave();
    return state.compareScenarioId;
  }

  function restoreScenario(id) {
    const scen = findById(state.scenarios, id);
    if (!scen) return false;

    pushHistory(`Restore Scenario "${scen.name}"`);
    state.points = deepClone(scen.points || []);
    const rawProcs = deepClone(scen.processes || []);
    recomputeDerived();
    state.processes = rawProcs
      .filter(pr => pr && findById(state.points, pr.aId) && findById(state.points, pr.bId) && pr.aId !== pr.bId)
      .map(pr => {
        const ptA = findById(state.points, pr.aId);
        const ptB = findById(state.points, pr.bId);
        const normFlow = convertProcessFlowToUnits(pr, state.units, ptA);
        const assignedId = pr.id != null ? pr.id : nextProcId++;
        return normalizeProcess(
          { ...pr, flowVal: normFlow.flowVal, flowUnit: normFlow.flowUnit },
          ptA.id,
          ptB.id,
          assignedId,
          state.units
        );
      });
    syncIdCounters();
    state.ui.selectedPtId = state.points[0]?.id ?? null;
    state.ui.selectedProcId = state.processes[0]?.id ?? null;
    cleanSelectionRefs();

    emit('overlay-dirty', { reason: 'restore-scenario', scenarioId: scen.id });
    emit('change', { reason: 'restore-scenario', scenarioId: scen.id });
    autosave();
    return true;
  }

  /* --------------------------------------------------------------------------
     Persistence (v3.0 & Legacy v2.6.6 JSON)
     -------------------------------------------------------------------------- */

  function exportJSON() {
    const keepRecords = Array.isArray(state.weather.records) &&
      state.weather.records.length > 0 &&
      state.weather.records.length <= MAX_EMBEDDED_WEATHER_RECORDS;

    return {
      schema: 'psychro-ultra-3.0',
      appVersion: APP_VERSION,
      savedAt: new Date().toISOString(),
      meta: deepClone(state.meta),
      theme: state.theme,
      units: state.units,
      pPa: state.pPa,
      altM: state.altM,
      pOverride: state.pOverride,
      view: {
        tMin: state.view.tMin,
        tMax: state.view.tMax,
        wMax: state.view.wMax
      },
      grid: deepClone(state.grid),
      axisStyle: deepClone(state.axisStyle),
      trendStyle: deepClone(state.trendStyle),
      layers: deepClone(state.layers),
      comfort: deepClone(state.comfort),
      shr: deepClone(state.shr),
      points: deepClone(state.points),
      processes: deepClone(state.processes),
      annotations: deepClone(state.annotations),
      scenarios: deepClone(state.scenarios),
      compareScenarioId: state.compareScenarioId,
      weather: {
        cityId: state.weather.cityId,
        sourceName: state.weather.sourceName,
        mode: state.weather.mode,
        opacity: state.weather.opacity,
        records: keepRecords ? deepClone(state.weather.records) : []
      },
      customTheme: deepClone(state.customTheme)
    };
  }

  function importJSON(input, opts = {}) {
    let obj = input;
    if (typeof input === 'string') {
      try {
        obj = JSON.parse(input);
      } catch (err) {
        return { ok: false, error: `Invalid JSON: ${err.message}` };
      }
    }

    if (!obj || typeof obj !== 'object') {
      return { ok: false, error: 'Invalid project object' };
    }

    const isLegacyV2 = Boolean(
      obj.state &&
      typeof obj.state === 'object' &&
      obj.schema !== 'psychro-ultra-3.0'
    );

    const isV3 = Boolean(
      obj.schema === 'psychro-ultra-3.0' ||
      (!isLegacyV2 && (Array.isArray(obj.points) || obj.view || obj.units || obj.meta))
    );

    if (!isLegacyV2 && !isV3) {
      return { ok: false, error: 'Unrecognized project format' };
    }

    if (opts.recordHistory !== false) {
      pushHistory('Import Project');
    }

    if (isLegacyV2) {
      const s = obj.state;
      const units = s.units === 'IP' ? 'IP' : 'SI';
      const theme = normalizeThemeName(s.theme, s.style);
      const pPa = CoreDOM.clamp(numOr(s.pPa, 101325), 30000, 115000);
      const altM = CoreDOM.clamp(invBaroAlt_m(pPa), -500, 9000);

      // Legacy v2.6.6 stored wMaxDisp in display units (g/kg in SI, gr/lb in IP)
      let wMax = 0.030;
      if (s.wMaxDisp != null && Number.isFinite(Number(s.wMaxDisp))) {
        wMax = CoreDOM.dispToW(Number(s.wMaxDisp), units);
      } else if (s.wMax != null && Number.isFinite(Number(s.wMax))) {
        wMax = Number(s.wMax);
      }

      // Legacy v2.6.6 IP mode stored axis inputs tMin/tMax in °F (e.g. 20..120)
      let tMin = numOr(s.tMin, units === 'IP' ? DEFAULT_VIEW.defaultIP.tMin : DEFAULT_VIEW.defaultSI.tMin);
      let tMax = numOr(s.tMax, units === 'IP' ? DEFAULT_VIEW.defaultIP.tMax : DEFAULT_VIEW.defaultSI.tMax);
      if (units === 'IP' && (tMax > 65 || tMin < -50 || (tMin >= 15 && tMax >= 80))) {
        tMin = CoreDOM.fToC(tMin);
        tMax = CoreDOM.fToC(tMax);
      }
      const clampedView = clampViewValues(tMin, tMax, wMax);

      state.meta = {
        name: String(obj.meta?.name || 'Imported v2.6.6 Project'),
        version: String(obj.meta?.version || 'v3.0'),
        company: String(obj.meta?.company || ''),
        engineer: String(obj.meta?.engineer || ''),
        notes: String(obj.meta?.notes || '')
      };
      state.theme = theme;
      state.units = units;
      state.pPa = pPa;
      state.altM = altM;
      state.pOverride = null;
      state.view.tMin = clampedView.tMin;
      state.view.tMax = clampedView.tMax;
      state.view.wMax = clampedView.wMax;

      state.grid = {
        ...DEFAULT_GRID,
        density: (s.density === 'fast' || s.density === 'fine') ? s.density : 'normal',
        rhStep: CoreDOM.clamp(Math.round(numOr(s.rhStep, 10)), 5, 25),
        labelMode: s.labelMode ? String(s.labelMode) : 'mid',
        labelPx: CoreDOM.clamp(Math.round(numOr(s.labelPx, 11)), 8, 18)
      };

      state.layers = { ...DEFAULT_LAYERS };
      const cz = s.comfortZone || 'both';
      state.comfort = {
        ...DEFAULT_COMFORT,
        mode: cz === 'off' ? 'none' : String(cz)
      };
      if (cz === 'off' || cz === 'none') {
        state.layers.comfort = false;
      }

      const legacyPreset = theme !== 'custom' ? THEME_PRESETS[theme] : null;
      state.axisStyle = sanitizeAxisStyle(legacyPreset?.axisStyle, DEFAULT_AXIS_STYLE);
      state.trendStyle = sanitizeTrendStyle(legacyPreset?.trendStyle, DEFAULT_TREND_STYLE);
      state.shr = { ...DEFAULT_SHR };
      state.customTheme = {
        ...DEFAULT_CUSTOM_THEME,
        ...(obj.customTheme && typeof obj.customTheme === 'object' ? deepClone(obj.customTheme) : {})
      };

      // Map legacy points preserving IDs (for derived.aId / derived.bId integrity)
      const usedPtIds = new Set();
      let tempPid = 1;
      const indexToId = [];
      const importedPoints = [];
      for (let i = 0; i < (obj.points || []).length; i++) {
        const rawPt = obj.points[i];
        if (!rawPt || typeof rawPt !== 'object') continue;
        let pid = rawPt.id != null ? rawPt.id : tempPid++;
        while (usedPtIds.has(String(pid))) {
          pid = tempPid++;
        }
        usedPtIds.add(String(pid));
        if (Number.isInteger(Number(pid)) && Number(pid) >= tempPid) {
          tempPid = Number(pid) + 1;
        }
        indexToId[i] = pid;
        importedPoints.push(normalizePoint(rawPt, i, pid));
      }

      // Map legacy index-based processes [[0, 1], ...] or v3 objects
      const importedProcesses = [];
      let tempProcId = 1;
      for (const rawProc of obj.processes || []) {
        let aId = null;
        let bId = null;
        let procOpts = {};
        if (Array.isArray(rawProc)) {
          aId = indexToId[rawProc[0]] ?? null;
          bId = indexToId[rawProc[1]] ?? null;
        } else if (rawProc && typeof rawProc === 'object') {
          aId = rawProc.aId ?? indexToId[rawProc.a] ?? null;
          bId = rawProc.bId ?? indexToId[rawProc.b] ?? null;
          procOpts = rawProc;
        }
        if (aId != null && bId != null && aId !== bId) {
          importedProcesses.push(normalizeProcess(procOpts, aId, bId, tempProcId++, units));
        }
      }

      state.points = importedPoints;
      state.processes = importedProcesses;
      state.annotations = [];
      state.scenarios = [];
      state.compareScenarioId = null;
      state.weather = {
        cityId: null,
        sourceName: null,
        records: [],
        bins: null,
        mode: 'heatmap',
        opacity: 0.72
      };
    } else {
      // Native v3.0 JSON
      const units = obj.units === 'IP' ? 'IP' : 'SI';
      const theme = normalizeThemeName(obj.theme);
      const pPa = CoreDOM.clamp(numOr(obj.pPa, 101325), 30000, 115000);
      const altM = obj.altM != null && Number.isFinite(Number(obj.altM))
        ? CoreDOM.clamp(Number(obj.altM), -500, 9000)
        : CoreDOM.clamp(invBaroAlt_m(pPa), -500, 9000);
      const pOverride = (obj.pOverride != null && Number.isFinite(Number(obj.pOverride)))
        ? CoreDOM.clamp(Number(obj.pOverride), 30000, 115000)
        : null;

      const vIn = obj.view || {};
      const defV = units === 'IP' ? DEFAULT_VIEW.defaultIP : DEFAULT_VIEW.defaultSI;
      const clampedView = clampViewValues(
        vIn.tMin ?? defV.tMin,
        vIn.tMax ?? defV.tMax,
        vIn.wMax ?? defV.wMax
      );

      state.meta = {
        name: String(obj.meta?.name || 'AHU-01 Summer Design'),
        version: String(obj.meta?.version || 'v3.0'),
        company: String(obj.meta?.company || ''),
        engineer: String(obj.meta?.engineer || ''),
        notes: String(obj.meta?.notes || '')
      };
      state.theme = theme;
      state.units = units;
      state.pPa = pPa;
      state.altM = altM;
      state.pOverride = pOverride;
      state.view.tMin = clampedView.tMin;
      state.view.tMax = clampedView.tMax;
      state.view.wMax = clampedView.wMax;

      state.grid = { ...DEFAULT_GRID, ...(obj.grid && typeof obj.grid === 'object' ? deepClone(obj.grid) : {}) };
      const importedPreset = theme !== 'custom' ? THEME_PRESETS[theme] : null;
      state.axisStyle = obj.axisStyle && typeof obj.axisStyle === 'object'
        ? sanitizeAxisStyle(obj.axisStyle, DEFAULT_AXIS_STYLE)
        : sanitizeAxisStyle(importedPreset?.axisStyle, DEFAULT_AXIS_STYLE);
      state.trendStyle = obj.trendStyle && typeof obj.trendStyle === 'object'
        ? sanitizeTrendStyle(obj.trendStyle, DEFAULT_TREND_STYLE)
        : sanitizeTrendStyle(importedPreset?.trendStyle, DEFAULT_TREND_STYLE);
      state.layers = { ...DEFAULT_LAYERS, ...(obj.layers && typeof obj.layers === 'object' ? deepClone(obj.layers) : {}) };
      state.comfort = { ...DEFAULT_COMFORT, ...(obj.comfort && typeof obj.comfort === 'object' ? deepClone(obj.comfort) : {}) };
      state.shr = { ...DEFAULT_SHR, ...(obj.shr && typeof obj.shr === 'object' ? deepClone(obj.shr) : {}) };
      state.customTheme = {
        ...DEFAULT_CUSTOM_THEME,
        ...(obj.customTheme && typeof obj.customTheme === 'object' ? deepClone(obj.customTheme) : {})
      };

      const usedPtIds = new Set();
      let tempPid = 1;
      const importedPoints = [];
      for (let i = 0; i < (obj.points || []).length; i++) {
        const rawPt = obj.points[i];
        if (!rawPt || typeof rawPt !== 'object') continue;
        let pid = rawPt.id != null ? rawPt.id : tempPid++;
        while (usedPtIds.has(String(pid))) pid = tempPid++;
        usedPtIds.add(String(pid));
        if (Number.isInteger(Number(pid)) && Number(pid) >= tempPid) tempPid = Number(pid) + 1;
        importedPoints.push(normalizePoint(rawPt, i, pid));
      }
      state.points = importedPoints;

      const importedProcesses = [];
      let tempProcId = 1;
      for (const rawProc of obj.processes || []) {
        if (!rawProc || typeof rawProc !== 'object') continue;
        const ptA = findById(state.points, rawProc.aId);
        const ptB = findById(state.points, rawProc.bId);
        if (!ptA || !ptB || ptA.id === ptB.id) continue;
        const prId = rawProc.id != null ? rawProc.id : tempProcId++;
        if (Number.isInteger(Number(prId)) && Number(prId) >= tempProcId) tempProcId = Number(prId) + 1;
        importedProcesses.push(normalizeProcess(rawProc, ptA.id, ptB.id, prId, units));
      }
      state.processes = importedProcesses;

      const importedAnnotations = [];
      let tempAnnId = 1;
      for (const rawAnn of obj.annotations || []) {
        if (!rawAnn || typeof rawAnn !== 'object') continue;
        const anId = rawAnn.id != null ? rawAnn.id : tempAnnId++;
        if (Number.isInteger(Number(anId)) && Number(anId) >= tempAnnId) tempAnnId = Number(anId) + 1;
        importedAnnotations.push(normalizeAnnotation(rawAnn, anId));
      }
      state.annotations = importedAnnotations;

      const importedScenarios = [];
      let tempScenId = 1;
      for (let i = 0; i < (obj.scenarios || []).length; i++) {
        const sc = obj.scenarios[i];
        if (!sc || typeof sc !== 'object') continue;
        const scId = sc.id != null ? sc.id : tempScenId++;
        if (Number.isInteger(Number(scId)) && Number(scId) >= tempScenId) tempScenId = Number(scId) + 1;
        importedScenarios.push({
          id: scId,
          name: String(sc.name || `Scenario ${i + 1}`),
          savedAt: sc.savedAt || new Date().toISOString(),
          color: sc.color || POINT_PALETTE[(i + 3) % POINT_PALETTE.length],
          points: Array.isArray(sc.points) ? deepClone(sc.points) : [],
          processes: Array.isArray(sc.processes) ? deepClone(sc.processes) : []
        });
      }
      state.scenarios = importedScenarios;
      state.compareScenarioId = obj.compareScenarioId != null
        ? (findById(state.scenarios, obj.compareScenarioId)?.id ?? null)
        : null;

      const wObj = obj.weather || {};
      state.weather = {
        cityId: wObj.cityId ?? null,
        sourceName: wObj.sourceName ?? null,
        records: Array.isArray(wObj.records) ? deepClone(wObj.records) : [],
        bins: null,
        mode: wObj.mode ? String(wObj.mode) : 'heatmap',
        opacity: CoreDOM.clamp(numOr(wObj.opacity, 0.72), 0.05, 1)
      };
    }

    syncIdCounters();
    recomputeDerived();
    state.ui.selectedPtId = state.points[0]?.id ?? null;
    state.ui.selectedProcId = state.processes[0]?.id ?? null;
    cleanSelectionRefs();
    applyDomTheme(state.theme);

    emit('theme-changed', { theme: state.theme });
    emit('units-changed', { units: state.units });
    emit('weather-changed', { weather: state.weather });
    emit('base-dirty', { reason: 'import' });
    emit('overlay-dirty', { reason: 'import' });
    emit('change', { reason: 'import', format: isLegacyV2 ? 'v2.6.6' : 'v3.0' });

    if (!opts.skipAutosave) {
      autosave();
    }

    return {
      ok: true,
      format: isLegacyV2 ? 'v2.6.6' : 'v3.0',
      pointCount: state.points.length,
      processCount: state.processes.length
    };
  }

  /* --------------------------------------------------------------------------
     Shareable URL Hash (#p=...) with Unicode-Safe Base64URL
     -------------------------------------------------------------------------- */

  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let b64;
    if (typeof btoa === 'function') {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
      }
      b64 = btoa(bin);
    } else if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes).toString('base64');
    } else {
      throw new Error('No Base64 encoder available');
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(b64url) {
    let b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
    } else if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    } else {
      throw new Error('No Base64 decoder available');
    }
    return new TextDecoder().decode(bytes);
  }

  function encodeShareURL() {
    const compact = {
      v: 3,
      m: [state.meta.name, state.meta.version, state.meta.company, state.meta.engineer, state.meta.notes],
      t: state.theme,
      u: state.units,
      p: CoreDOM.round(state.pPa, 1),
      a: CoreDOM.round(state.altM, 1),
      vw: [
        CoreDOM.round(state.view.tMin, 4),
        CoreDOM.round(state.view.tMax, 4),
        CoreDOM.round(state.view.wMax, 6)
      ],
      pts: state.points.map(pt => {
        const row = [
          pt.id,
          CoreDOM.round(pt.T, 4),
          CoreDOM.round(pt.w, 6),
          pt.label,
          pt.color,
          pt.locked ? 1 : 0,
          CoreDOM.round(pt.lx ?? 10, 1),
          CoreDOM.round(pt.ly ?? -6, 1)
        ];
        if (pt.note || pt.derived) row.push(pt.note || '');
        if (pt.derived) row.push(pt.derived);
        return row;
      }),
      prs: state.processes.map(pr => {
        const row = [pr.id, pr.aId, pr.bId, pr.flowVal, pr.flowUnit, pr.showCurve ? 1 : 0];
        if (pr.label || pr.adpT != null || pr.adpW != null || pr.role) {
          row.push(pr.label || '', pr.adpT, pr.adpW);
          if (pr.role) row.push(pr.role);
        }
        return row;
      })
    };

    if (state.pOverride != null) compact.po = CoreDOM.round(state.pOverride, 1);
    if (state.annotations.length > 0) {
      compact.ann = state.annotations.map(an => [
        an.id,
        CoreDOM.round(an.T, 4),
        CoreDOM.round(an.w, 6),
        an.text,
        an.color
      ]);
    }
    if (state.shr.show) {
      compact.shr = state.shr.anchorTw
        ? [1, CoreDOM.round(state.shr.value, 4), state.shr.refPointId, [CoreDOM.round(state.shr.anchorTw.T, 3), CoreDOM.round(state.shr.anchorTw.w, 6)]]
        : [1, CoreDOM.round(state.shr.value, 4), state.shr.refPointId];
    }
    if (state.theme === 'custom') {
      compact.ct = state.customTheme;
    }
    const sharePreset = state.theme !== 'custom' ? THEME_PRESETS[state.theme] : null;
    const baseAx = sanitizeAxisStyle(sharePreset?.axisStyle, DEFAULT_AXIS_STYLE);
    const baseTr = sanitizeTrendStyle(sharePreset?.trendStyle, DEFAULT_TREND_STYLE);
    if (JSON.stringify(state.axisStyle) !== JSON.stringify(baseAx)) {
      compact.ax = deepClone(state.axisStyle);
    }
    if (JSON.stringify(state.trendStyle) !== JSON.stringify(baseTr)) {
      compact.tr = deepClone(state.trendStyle);
    }
    if (state.weather.cityId) {
      compact.wc = state.weather.cityId;
    }

    const encoded = toBase64Url(JSON.stringify(compact));
    const hash = `#p=${encoded}`;

    if (typeof window !== 'undefined' && window.location && window.location.href) {
      return `${window.location.href.split('#')[0]}${hash}`;
    }
    return hash;
  }

  function decodeShareURL(hashInput) {
    try {
      const raw = hashInput != null
        ? String(hashInput)
        : (typeof window !== 'undefined' && window.location ? String(window.location.hash || '') : '');

      const match = raw.match(/(?:^|#|&)p=([A-Za-z0-9\-_]+)/);
      if (!match || !match[1]) {
        return { ok: false, error: 'No share payload found in hash' };
      }

      const jsonStr = fromBase64Url(match[1]);
      const data = JSON.parse(jsonStr);
      if (!data || typeof data !== 'object') {
        return { ok: false, error: 'Invalid share payload' };
      }

      // Support full v3 / v2 JSON encoded directly as well as compact v3 format
      if (data.v !== 3) {
        return importJSON(data);
      }

      const expanded = {
        schema: 'psychro-ultra-3.0',
        meta: {
          name: data.m?.[0] ?? 'Shared Project',
          version: data.m?.[1] ?? 'v3.0',
          company: data.m?.[2] ?? '',
          engineer: data.m?.[3] ?? '',
          notes: data.m?.[4] ?? ''
        },
        theme: data.t || 'studio-dark',
        units: data.u === 'IP' ? 'IP' : 'SI',
        pPa: data.p ?? 101325,
        altM: data.a ?? 0,
        pOverride: data.po ?? null,
        view: Array.isArray(data.vw)
          ? { tMin: data.vw[0], tMax: data.vw[1], wMax: data.vw[2] }
          : undefined,
        points: Array.isArray(data.pts)
          ? data.pts.map(r => ({
              id: r[0],
              T: r[1],
              w: r[2],
              label: r[3],
              color: r[4],
              locked: Boolean(r[5]),
              lx: r[6] ?? 10,
              ly: r[7] ?? -6,
              note: r[8] ?? '',
              derived: r[9] ?? null
            }))
          : [],
        processes: Array.isArray(data.prs)
          ? data.prs.map(r => ({
              id: r[0],
              aId: r[1],
              bId: r[2],
              flowVal: r[3],
              flowUnit: r[4],
              showCurve: Boolean(r[5]),
              label: r[6] ?? '',
              adpT: r[7] ?? null,
              adpW: r[8] ?? null,
              role: r[9] ?? null
            }))
          : [],
        annotations: Array.isArray(data.ann)
          ? data.ann.map(r => ({
              id: r[0],
              T: r[1],
              w: r[2],
              text: r[3],
              color: r[4]
            }))
          : [],
        shr: Array.isArray(data.shr)
          ? {
              show: Boolean(data.shr[0]),
              value: data.shr[1] ?? 0.75,
              refPointId: data.shr[2] ?? null,
              anchorTw: Array.isArray(data.shr[3]) && data.shr[3].length >= 2
                ? { T: Number(data.shr[3][0]), w: Number(data.shr[3][1]) }
                : null,
              protractorPos: null
            }
          : { ...DEFAULT_SHR },
        ...(data.ax && typeof data.ax === 'object' ? { axisStyle: data.ax } : {}),
        ...(data.tr && typeof data.tr === 'object' ? { trendStyle: data.tr } : {}),
        customTheme: data.ct || { ...DEFAULT_CUSTOM_THEME },
        weather: {
          cityId: data.wc ?? null,
          sourceName: null,
          mode: 'heatmap',
          opacity: 0.72,
          records: []
        }
      };

      return importJSON(expanded);
    } catch (err) {
      return { ok: false, error: `Failed to decode share URL: ${err.message}` };
    }
  }

  /* --------------------------------------------------------------------------
     Autosave (Debounced, Safe in Node & Private Browsing)
     -------------------------------------------------------------------------- */

  function writeAutosaveNow() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return false;
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(exportJSON()));
      return true;
    } catch {
      return false;
    }
  }

  function autosave(immediate = false) {
    if (autosaveTimer !== null) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (immediate) {
      return writeAutosaveNow();
    }
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      writeAutosaveNow();
    }, AUTOSAVE_DELAY_MS);
    if (autosaveTimer && typeof autosaveTimer.unref === 'function') {
      autosaveTimer.unref();
    }
    return true;
  }

  function restoreAutosave() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return false;
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const obj = JSON.parse(raw);
      const res = importJSON(obj, { recordHistory: false, skipAutosave: true });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  }

  function clearAutosave() {
    if (autosaveTimer !== null) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.removeItem(AUTOSAVE_KEY);
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    state,

    // Event bus
    on,
    off,
    once,
    emit,
    toast,

    // History
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    getUndoLabel,
    getRedoLabel,

    // Points
    addPoint,
    updatePoint,
    deletePoint,
    duplicatePoint,
    getPoint,

    // Processes
    addProcess,
    updateProcess,
    deleteProcess,
    reverseProcess,
    getProcess,

    // Annotations
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,

    // Derived & Cycle operations
    recomputeDerived,
    loadCycle,
    clearAll,

    // Settings, Atmosphere & View
    setMeta,
    setUI,
    setUnits,
    setTheme,
    applyVisualPreset,
    setAxisStyle,
    setTrendStyle,
    updateCustomTheme,
    resetCustomTheme,
    setAtmosphere,
    setView,
    resetView,
    fitPoints,
    zoomAt,

    // Layers, Comfort, SHR, Grid, Weather, Tool
    setLayer,
    toggleLayer,
    setComfort,
    setSHR,
    setGrid,
    setWeather,
    clearWeather,
    setTool,

    // Scenarios
    saveScenario,
    deleteScenario,
    setCompareScenario,
    restoreScenario,

    // Persistence & Sharing
    exportJSON,
    importJSON,
    encodeShareURL,
    decodeShareURL,
    autosave,
    restoreAutosave,
    clearAutosave
  };
}

export const store = createStore();
