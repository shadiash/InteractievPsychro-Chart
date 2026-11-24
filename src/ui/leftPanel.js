/* ============================================================================
   PsychroChart Ultra 3.0 — Left Inspector Panel Controller
   Tabs: Atmosphere & Climate (tabAtmo), State Points (tabPoints),
         Universal Any-2-of-8 Calculator & Psychro Tables (tabCalc)
   Strict internal SI state (°C, kg/kg, Pa, kJ/kg, m³/kg); SI/IP at UI boundary.
   ============================================================================ */

import { CoreDOM, POINT_PALETTE, UNIT_LABELS, DEFAULT_AXIS_STYLE, DEFAULT_TREND_STYLE } from '../core/contracts.js';
import { Psy } from '../engine/psychro.js';
import { Comfort } from '../engine/comfort.js';
import { Weather } from '../engine/weather.js';

export function initLeftPanel(store, callbacks = {}) {
  const { byId, on, esc, clamp, tToDisp, dispToT, wToDisp, dispToW } = CoreDOM;
  const toast = typeof callbacks.toast === 'function' ? callbacks.toast : () => {};
  const openEditPoint = typeof callbacks.openEditPoint === 'function' ? callbacks.openEditPoint : () => {};

  const FT_PER_M = 3.280839895013123;
  const FPM_PER_MPS = 196.8503937007874;
  const KPA_PER_PSI = Psy.KPA_PER_PSI || 6.894757293168361;
  const PA_PER_PSI = KPA_PER_PSI * 1000;
  const V_IP_PER_SI = (Psy.FT3_PER_M3 || 35.3146667215) / (Psy.LB_PER_KG || 2.20462262185);
  const RHO_IP_PER_SI = (Psy.LB_PER_KG || 2.20462262185) / (Psy.FT3_PER_M3 || 35.3146667215);

  /* ---- DOM Element Cache ---- */
  const el = {
    leftPanel: byId('leftPanel'),
    // Tab 1: Atmosphere, Cities, Weather, Range, Visuals, Comfort, SHR
    citySelect: byId('citySelect'),
    btnPlotCity: byId('btnPlotCity'),
    btnLoadCityTMY: byId('btnLoadCityTMY'),
    alt: byId('alt'),
    altUnit: byId('altUnit'),
    pOverride: byId('pOverride'),
    pUnit: byId('pUnit'),
    applyAtm: byId('applyAtm'),
    epwDropZone: byId('epwDropZone'),
    epwFileInput: byId('epwFileInput'),
    weatherStats: byId('weatherStats'),
    weatherMode: byId('weatherMode'),
    weatherOpacity: byId('weatherOpacity'),
    btnClearWeather: byId('btnClearWeather'),
    tMin: byId('tMin'),
    tMax: byId('tMax'),
    wMax: byId('wMax'),
    btnRedraw: byId('btnRedraw'),
    btnFit: byId('btnFit'),
    btnResetZoom: byId('btnResetZoom'),
    density: byId('density'),
    rhStep: byId('rhStep'),
    labelMode: byId('labelMode'),
    labelPx: byId('labelPx'),
    chkEnthRuler: byId('chkEnthRuler'),
    chkFlowAnim: byId('chkFlowAnim'),
    axisFrame: byId('axisFrame'),
    axisTickDir: byId('axisTickDir'),
    axisYSide: byId('axisYSide'),
    axisRulerStyle: byId('axisRulerStyle'),
    chkAxisSubTicks: byId('chkAxisSubTicks'),
    chkDualPvScale: byId('chkDualPvScale'),
    trendArrowStyle: byId('trendArrowStyle'),
    trendLineWeight: byId('trendLineWeight'),
    trendPointMarker: byId('trendPointMarker'),
    trendBadgeStyle: byId('trendBadgeStyle'),
    chkTrendDecomp: byId('chkTrendDecomp'),
    comfortMode: byId('comfortMode'),
    pmvCloSummer: byId('pmvCloSummer'),
    pmvCloWinter: byId('pmvCloWinter'),
    pmvMet: byId('pmvMet'),
    pmvVair: byId('pmvVair'),
    pmvMrtOff: byId('pmvMrtOff'),
    pmvLimit: byId('pmvLimit'),
    chkGivoni: byId('chkGivoni'),
    chkDataCenter: byId('chkDataCenter'),
    shrShow: byId('shrShow'),
    shrVal: byId('shrVal'),
    shrRefPt: byId('shrRefPt'),
    // Tab 2: State Points
    inMode1: byId('inMode1'),
    inVal1: byId('inVal1'),
    inMode2: byId('inMode2'),
    inVal2: byId('inVal2'),
    inLbl: byId('inLbl'),
    inColor: byId('inColor'),
    connect: byId('connect'),
    addPt: byId('addPt'),
    ptTblEditMode: byId('ptTblEditMode'),
    ptsTbl: byId('ptsTbl'),
    ptTblSecondHdr: byId('ptTblSecondHdr'),
    bulkCSV: byId('bulkCSV'),
    bulkImport: byId('bulkImport'),
    btnClearPts: byId('btnClearPts'),
    // Tab 3: Universal Calculator & Psychrometric Table
    calcIn1: byId('calcIn1'),
    calcV1: byId('calcV1'),
    calcIn2: byId('calcIn2'),
    calcV2: byId('calcV2'),
    calcBtn: byId('calcBtn'),
    calcResults: byId('calcResults'),
    calcComfortSummary: byId('calcComfortSummary'),
    calcAddPt: byId('calcAddPt'),
    tblFrom: byId('tblFrom'),
    tblTo: byId('tblTo'),
    tblStep: byId('tblStep'),
    tblGen: byId('tblGen'),
    tblCopyCsv: byId('tblCopyCsv'),
    psyTableWrap: byId('psyTableWrap')
  };

  /* ---- Local UI Controller State ---- */
  let lastUnits = (store?.state?.units === 'IP') ? 'IP' : 'SI';
  let atmEditSource = 'alt'; // 'alt' | 'p'
  let lastCalcState = null;  // { T, w, ... }
  let lastTableCsv = '';
  let lastTableSignature = '';
  let lastWeatherSig = '';
  let colorCycleIdx = 0;
  let lastActiveComfortMode = (store?.state?.comfort?.mode && store.state.comfort.mode !== 'none')
    ? store.state.comfort.mode
    : 'both';
  let clearPtsConfirmTimer = null;
  let clearPtsPending = false;

  /* ---- Store Safe Accessors & Mutators ---- */
  function getState() {
    return store?.state || {};
  }

  function getUnits() {
    return getState().units === 'IP' ? 'IP' : 'SI';
  }

  function getPressurePa() {
    const p = Number(getState().pPa);
    return Number.isFinite(p) && p > 1000 ? p : 101325;
  }

  function getPoints() {
    const pts = getState().points;
    return Array.isArray(pts) ? pts : [];
  }

  function getComfortCfg() {
    const c = getState().comfort || {};
    return {
      mode: c.mode || 'both',
      cloSummer: Number.isFinite(c.cloSummer) ? c.cloSummer : 0.5,
      cloWinter: Number.isFinite(c.cloWinter) ? c.cloWinter : 1.0,
      met: Number.isFinite(c.met) ? c.met : 1.1,
      vAir: Number.isFinite(c.vAir) ? c.vAir : 0.1,
      mrtOffset: Number.isFinite(c.mrtOffset) ? c.mrtOffset : (Number.isFinite(c.mrtOff) ? c.mrtOff : 0),
      pmvLimit: Number.isFinite(c.pmvLimit) ? c.pmvLimit : 0.5
    };
  }

  function emitStore(evt = 'change', payload) {
    if (typeof store?.emit === 'function') store.emit(evt, payload);
    else if (typeof store?.notify === 'function') store.notify(evt, payload);
  }

  function pushStoreHistory(label = 'Edit') {
    if (typeof store?.pushHistory === 'function') store.pushHistory(label);
    else if (typeof store?.snapshot === 'function') store.snapshot();
  }

  function setStorePressure(pPa, altM = undefined, pOverride = null, recordHistory = true) {
    const clamped = clamp(pPa, 30000, 115000);
    const resolvedAlt = Number.isFinite(altM) ? clamp(altM, -500, 9000) : clamp(Psy.invBaroAlt_m(clamped), -500, 9000);
    if (typeof store?.setAtmosphere === 'function') {
      store.setAtmosphere(clamped, resolvedAlt, pOverride, recordHistory);
    } else if (typeof store?.setPressure === 'function') {
      store.setPressure(clamped);
    } else {
      if (recordHistory) pushStoreHistory('Change Atmosphere');
      store.state.pPa = clamped;
      store.state.altM = resolvedAlt;
      store.state.pOverride = pOverride;
      if (typeof store?.recomputeDerived === 'function') store.recomputeDerived();
      emitStore('change', { reason: 'atmosphere' });
    }
  }

  function setStoreView(viewPatch, recordHistory = false) {
    const cur = getState().view || { tMin: -10, tMax: 55, wMax: 0.030 };
    const next = {
      tMin: Number.isFinite(viewPatch.tMin) ? viewPatch.tMin : cur.tMin,
      tMax: Number.isFinite(viewPatch.tMax) ? viewPatch.tMax : cur.tMax,
      wMax: Number.isFinite(viewPatch.wMax) ? viewPatch.wMax : cur.wMax
    };
    if (typeof store?.setView === 'function') {
      store.setView(next, recordHistory);
    } else {
      store.state.view = { ...cur, ...next };
      emitStore('change', { reason: 'view' });
    }
  }

  function setStoreLayer(name, enabled) {
    if (typeof store?.setLayer === 'function') {
      store.setLayer(name, !!enabled);
    } else {
      if (!store.state.layers) store.state.layers = {};
      store.state.layers[name] = !!enabled;
      emitStore('change', { reason: 'layer' });
    }
  }

  function setStoreGrid(patch) {
    if (typeof store?.setGrid === 'function') {
      store.setGrid(patch);
    } else {
      store.state.grid = { ...(store.state.grid || {}), ...patch };
      emitStore('change', { reason: 'grid' });
    }
  }

  function setStoreAxisStyle(patch) {
    if (typeof store?.setAxisStyle === 'function') {
      store.setAxisStyle(patch);
    } else {
      store.state.axisStyle = { ...(DEFAULT_AXIS_STYLE || {}), ...(store.state.axisStyle || {}), ...patch };
      emitStore('base-dirty', { reason: 'axis-style', axisStyle: store.state.axisStyle });
      emitStore('change', { reason: 'axis-style', axisStyle: store.state.axisStyle });
    }
  }

  function setStoreTrendStyle(patch) {
    if (typeof store?.setTrendStyle === 'function') {
      store.setTrendStyle(patch);
    } else {
      store.state.trendStyle = { ...(DEFAULT_TREND_STYLE || {}), ...(store.state.trendStyle || {}), ...patch };
      emitStore('overlay-dirty', { reason: 'trend-style', trendStyle: store.state.trendStyle });
      emitStore('change', { reason: 'trend-style', trendStyle: store.state.trendStyle });
    }
  }

  function setStoreComfort(patch) {
    const normalized = { ...patch };
    if ('mrtOffset' in normalized && !('mrtOff' in normalized)) {
      normalized.mrtOff = normalized.mrtOffset;
    } else if ('mrtOff' in normalized && !('mrtOffset' in normalized)) {
      normalized.mrtOffset = normalized.mrtOff;
    }
    if (typeof store?.setComfort === 'function') {
      store.setComfort(normalized);
    } else {
      store.state.comfort = { ...(store.state.comfort || {}), ...normalized };
      emitStore('change', { reason: 'comfort' });
    }
  }

  function setStoreSHR(patch) {
    if (typeof store?.setSHR === 'function') {
      store.setSHR(patch);
    } else {
      store.state.shr = { ...(store.state.shr || {}), ...patch };
      emitStore('change', { reason: 'shr' });
    }
  }

  function setStoreWeather(weatherObj) {
    if (typeof store?.setWeather === 'function') {
      store.setWeather(weatherObj);
    } else {
      store.state.weather = weatherObj;
      emitStore('weather-changed', weatherObj);
      emitStore('change', { reason: 'weather' });
    }
  }

  function clearStoreWeather() {
    if (typeof store?.clearWeather === 'function') {
      store.clearWeather();
    } else {
      store.state.weather = null;
      if (store.state.layers) store.state.layers.weather = false;
      emitStore('weather-changed', null);
      emitStore('change', { reason: 'weather-clear' });
    }
  }

  function fitPointsView(recordHistory = true) {
    if (typeof callbacks.fitPoints === 'function') {
      callbacks.fitPoints();
      return;
    }
    if (typeof store?.fitPoints === 'function') {
      store.fitPoints(recordHistory);
      return;
    }
    if (typeof store?.fitAll === 'function') {
      store.fitAll();
      return;
    }
    const pts = getPoints();
    if (!pts.length) {
      resetZoomView();
      return;
    }
    const pPa = getPressurePa();
    let tLo = Infinity;
    let tHi = -Infinity;
    let wHi = 0;
    for (const p of pts) {
      if (p.T < tLo) tLo = p.T;
      if (p.T > tHi) tHi = p.T;
      if (p.w > wHi) wHi = p.w;
    }
    const span = Math.max(8, tHi - tLo);
    const pad = span * 0.22;
    const tMin = clamp(Math.floor((tLo - pad) / 2) * 2, -50, 70);
    const tMax = clamp(Math.ceil((tHi + pad) / 2) * 2, tMin + 8, 85);
    let wEnv = wHi;
    for (let T = tMin; T <= tMax; T += 1) {
      const ws = Psy.wsat_at(T, pPa);
      if (ws > wEnv && ws < 0.065) wEnv = Math.max(wEnv, Math.min(ws, wHi * 1.45));
    }
    const wMax = clamp(Math.ceil(Math.max(wHi * 1.35, wEnv * 1.12, 0.014) * 1000) / 1000, 0.008, 0.060);
    setStoreView({ tMin, tMax, wMax });
  }

  function resetZoomView() {
    if (typeof callbacks.resetZoom === 'function') {
      callbacks.resetZoom();
      return;
    }
    if (typeof store?.resetView === 'function') {
      store.resetView();
      return;
    }
    if (typeof store?.resetZoom === 'function') {
      store.resetZoom();
      return;
    }
    setStoreView({ tMin: -10, tMax: 55, wMax: 0.030 });
  }

  function nextAutoLabel() {
    const used = new Set(getPoints().map((p) => String(p.label || '').trim().toLowerCase()));
    let n = getPoints().length + 1;
    while (used.has(`p${n}`)) n++;
    return `P${n}`;
  }

  function nextPaletteColor() {
    const pts = getPoints();
    const idx = (Math.max(pts.length, colorCycleIdx)) % POINT_PALETTE.length;
    return POINT_PALETTE[idx];
  }

  function syncNewPointDefaults(advanceColor = false) {
    if (advanceColor) {
      colorCycleIdx = (colorCycleIdx + 1) % POINT_PALETTE.length;
    }
    if (el.inLbl && document.activeElement !== el.inLbl) {
      el.inLbl.placeholder = `Auto (${nextAutoLabel()})`;
    }
    if (el.inColor && document.activeElement !== el.inColor) {
      el.inColor.value = POINT_PALETTE[colorCycleIdx % POINT_PALETTE.length];
    }
  }

  function addSinglePoint(ptData, connectPrev = false) {
    const ptsBefore = getPoints();
    const prevPt = ptsBefore.length ? ptsBefore[ptsBefore.length - 1] : null;
    const willConnect = Boolean(connectPrev && prevPt);
    let added = null;

    if (typeof store?.addPoint === 'function') {
      if (willConnect) {
        // Single undoable step covering both the new point and connecting process
        pushStoreHistory(`Add Point "${ptData.label || nextAutoLabel()}"`);
        added = store.addPoint(ptData, false);
        if (added && typeof store?.addProcess === 'function') {
          store.addProcess(prevPt.id, added.id, {}, false);
        }
      } else {
        added = store.addPoint(ptData, true);
      }
      return added;
    }

    pushStoreHistory(`Add Point "${ptData.label || nextAutoLabel()}"`);
    const maxId = ptsBefore.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0);
    added = {
      id: maxId + 1,
      T: ptData.T,
      w: ptData.w,
      label: ptData.label || nextAutoLabel(),
      color: ptData.color || nextPaletteColor(),
      locked: !!ptData.locked,
      note: ptData.note || '',
      lx: 10,
      ly: -6,
      derived: ptData.derived || null
    };
    store.state.points.push(added);
    if (willConnect && Array.isArray(store.state.processes)) {
      store.state.processes.push({ id: Date.now(), aId: prevPt.id, bId: added.id });
    }
    emitStore('change', { reason: 'add-point' });
    return added;
  }

  function addPointsBatch(list, historyLabel = 'Import Points', recordHistory = true) {
    if (!list.length) return 0;
    if (recordHistory) pushStoreHistory(historyLabel);
    if (typeof store?.addPoint === 'function') {
      for (const item of list) {
        store.addPoint(item, false);
      }
      return list.length;
    }
    const pts = getPoints();
    let maxId = pts.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0);
    for (const item of list) {
      maxId += 1;
      pts.push({
        id: maxId,
        T: item.T,
        w: item.w,
        label: item.label || `P${pts.length + 1}`,
        color: item.color || POINT_PALETTE[pts.length % POINT_PALETTE.length],
        locked: !!item.locked,
        note: item.note || '',
        lx: 10,
        ly: -6,
        derived: null
      });
    }
    if (typeof store?.recomputeDerived === 'function') store.recomputeDerived();
    emitStore('change', { reason: 'bulk-add-points' });
    return list.length;
  }

  function updateSinglePoint(pt, idx, patch, skipHistory = false) {
    if (typeof store?.updatePoint === 'function') {
      const key = pt?.id != null ? pt.id : idx;
      store.updatePoint(key, patch, !skipHistory);
    } else {
      if (!skipHistory) pushStoreHistory(`Edit Point "${pt.label || `P${idx + 1}`}"`);
      Object.assign(pt, patch);
      if (typeof store?.recomputeDerived === 'function') store.recomputeDerived();
      emitStore('change', { reason: 'update-point' });
    }
  }

  function togglePointLock(pt, idx) {
    updateSinglePoint(pt, idx, { locked: !pt.locked }, false);
  }

  function duplicateSinglePoint(pt, idx) {
    if (typeof store?.duplicatePoint === 'function') {
      store.duplicatePoint(pt?.id != null ? pt.id : idx);
      return;
    }
    addSinglePoint({
      T: pt.T,
      w: pt.w,
      label: `${pt.label || `P${idx + 1}`} copy`,
      color: POINT_PALETTE[getPoints().length % POINT_PALETTE.length],
      locked: false,
      note: pt.note || ''
    }, false);
  }

  function deleteSinglePoint(pt, idx) {
    if (pt.locked) {
      toast(`"${pt.label || `P${idx + 1}`}" is locked — unlock it first`, 'error');
      return false;
    }
    if (typeof store?.deletePoint === 'function') {
      const res = store.deletePoint(pt?.id != null ? pt.id : idx);
      if (res && typeof res === 'object' && res.ok === false) {
        toast(res.reason || 'Could not delete point', 'error');
        return false;
      }
      return true;
    }
    pushStoreHistory(`Delete Point "${pt.label || `P${idx + 1}`}"`);
    store.state.points.splice(idx, 1);
    if (Array.isArray(store.state.processes)) {
      store.state.processes = store.state.processes.filter((pr) => pr.aId !== pt.id && pr.bId !== pt.id);
    }
    if (typeof store?.recomputeDerived === 'function') store.recomputeDerived();
    emitStore('change', { reason: 'delete-point' });
    return true;
  }

  function selectChartPoint(pt, idx) {
    if (typeof store?.setUI === 'function') {
      store.setUI({ selectedPtId: pt?.id ?? null });
    } else if (typeof store?.selectPoint === 'function') {
      store.selectPoint(pt?.id != null ? pt.id : idx);
    } else {
      if (!store.state.ui) store.state.ui = {};
      store.state.ui.selectedPtId = pt?.id ?? null;
      emitStore('change', { reason: 'select-point' });
    }
  }

  function isPointSelected(pt, idx) {
    const st = getState();
    const selId = st.ui?.selectedPtId ?? st.selectedPointId ?? st.selection?.pointId;
    if (selId != null && pt?.id != null) {
      return String(selId) === String(pt.id);
    }
    if (Number.isInteger(st.selectedPointIdx)) {
      return st.selectedPointIdx === idx;
    }
    return false;
  }

  /* ---- Unit Conversion & Any-2-of-8 Solver Helpers ---- */
  function propUnitLabel(prop, units) {
    const u = UNIT_LABELS[units] || UNIT_LABELS.SI;
    switch (prop) {
      case 'Tdb':
      case 'Twb':
      case 'Tdp': return u.T;
      case 'RH': return '%';
      case 'W': return u.W;
      case 'h': return u.h;
      case 'v': return u.v;
      case 'Pv': return u.P;
      default: return '';
    }
  }

  function convertDisplayValue(prop, val, fromUnits, toUnits) {
    if (!Number.isFinite(val) || fromUnits === toUnits) return val;
    if (prop === 'Tdb' || prop === 'Twb' || prop === 'Tdp') {
      const si = dispToT(val, fromUnits);
      return tToDisp(si, toUnits);
    }
    if (prop === 'W') {
      const si = dispToW(val, fromUnits);
      return wToDisp(si, toUnits);
    }
    if (prop === 'h') {
      if (fromUnits === 'SI' && toUnits === 'IP') {
        return val * (Psy.BTU_LB_PER_KJ_KG || 0.429922614) + 7.68;
      }
      return Psy.h_kJkg_from_Btulb(val, 0);
    }
    if (prop === 'v') {
      return fromUnits === 'SI' ? val * V_IP_PER_SI : val / V_IP_PER_SI;
    }
    if (prop === 'Pv') {
      return fromUnits === 'SI' ? val / KPA_PER_PSI : val * KPA_PER_PSI;
    }
    return val; // RH% is unit-invariant
  }

  function displayInputToSI(prop, rawVal, units, wHint = 0) {
    if (!Number.isFinite(rawVal)) return NaN;
    switch (prop) {
      case 'Tdb':
      case 'Twb':
      case 'Tdp':
        return dispToT(rawVal, units);
      case 'RH':
        return rawVal; // Psy.solveState takes RH in 0..100 %
      case 'W':
        return dispToW(rawVal, units); // kg/kg
      case 'h':
        return units === 'SI' ? rawVal : Psy.h_kJkg_from_Btulb(rawVal, wHint);
      case 'v':
        return units === 'SI' ? rawVal : rawVal / V_IP_PER_SI;
      case 'Pv':
        return units === 'SI' ? rawVal * 1000 : rawVal * PA_PER_PSI; // Pa
      default:
        return rawVal;
    }
  }

  /**
   * Solves ANY 2 of 8 psychrometric properties from display units (SI or IP).
   * In IP mode when enthalpy h (0°F datum) is one of the inputs, performs
   * fixed-point refinement with Psy.h_kJkg_from_Btulb(hIP, w) so state.hIP matches
   * the entered Btu/lb to < 1e-4 Btu/lb.
   */
  function solveFromDisplayInputs(mode1, raw1, mode2, raw2, units, pPa) {
    if (!Number.isFinite(raw1) || !Number.isFinite(raw2)) {
      return { ok: false, error: 'Enter valid numeric values for both properties.' };
    }
    if (mode1 === mode2) {
      return { ok: false, error: 'Select two different psychrometric properties.' };
    }

    const hasIpEnthalpy = units === 'IP' && (mode1 === 'h' || mode2 === 'h');
    let wHint = 0;

    // If the companion property directly fixes w, compute exact wHint up front
    if (hasIpEnthalpy) {
      const otherMode = mode1 === 'h' ? mode2 : mode1;
      const otherRaw = mode1 === 'h' ? raw2 : raw1;
      if (otherMode === 'W') wHint = dispToW(otherRaw, units);
      else if (otherMode === 'Tdp') wHint = Psy.w_from_Tdp(dispToT(otherRaw, units), pPa);
      else if (otherMode === 'Pv') wHint = Psy.w_from_pv(otherRaw * PA_PER_PSI, pPa);
    }

    let v1SI = displayInputToSI(mode1, raw1, units, wHint);
    let v2SI = displayInputToSI(mode2, raw2, units, wHint);
    let res = Psy.solveState(mode1, v1SI, mode2, v2SI, pPa);

    // Fixed-point refinement for IP 0°F-datum enthalpy when w was coupled
    if (res?.ok && hasIpEnthalpy && res.state) {
      for (let iter = 0; iter < 4; iter++) {
        const wNow = res.state.w;
        const next1 = displayInputToSI(mode1, raw1, units, wNow);
        const next2 = displayInputToSI(mode2, raw2, units, wNow);
        const refined = Psy.solveState(mode1, next1, mode2, next2, pPa);
        if (!refined?.ok) break;
        const delta = Math.abs(refined.state.w - wNow);
        res = refined;
        if (delta < 1e-9) break;
      }
    }

    return res || { ok: false, error: 'Solver returned no result.' };
  }

  function setLabelWithUnit(inputId, baseText, unitStr) {
    const lbl = document.querySelector(`label[for="${inputId}"]`);
    if (lbl) lbl.textContent = unitStr ? `${baseText} (${unitStr})` : baseText;
  }

  function updateUnitAwareLabels() {
    const units = getUnits();
    const u = UNIT_LABELS[units] || UNIT_LABELS.SI;

    setLabelWithUnit('tMin', 'Tdb Min', u.T);
    setLabelWithUnit('tMax', 'Tdb Max', u.T);
    setLabelWithUnit('wMax', 'W Max', u.W);
    setLabelWithUnit('pmvVair', 'Air Vel', units === 'IP' ? 'fpm' : 'm/s');
    setLabelWithUnit('pmvMrtOff', 'MRT Offset', u.T);
    setLabelWithUnit('tblFrom', 'From T', u.T);
    setLabelWithUnit('tblTo', 'To T', u.T);

    if (el.inMode1) setLabelWithUnit('inVal1', 'Value 1', propUnitLabel(el.inMode1.value, units));
    if (el.inMode2) setLabelWithUnit('inVal2', 'Value 2', propUnitLabel(el.inMode2.value, units));
    if (el.calcIn1) setLabelWithUnit('calcV1', 'Value 1', propUnitLabel(el.calcIn1.value, units));
    if (el.calcIn2) setLabelWithUnit('calcV2', 'Value 2', propUnitLabel(el.calcIn2.value, units));

    if (el.wMax) {
      el.wMax.min = units === 'SI' ? '2' : '15';
      el.wMax.max = units === 'SI' ? '80' : '560';
      el.wMax.step = units === 'SI' ? '1' : '10';
    }

    if (el.rhStep) {
      el.rhStep.min = '5';
      el.rhStep.max = '25';
      el.rhStep.step = '5';
    }

    if (el.pmvVair) {
      el.pmvVair.min = units === 'IP' ? '10' : '0.05';
      el.pmvVair.max = units === 'IP' ? '400' : '2.0';
      el.pmvVair.step = units === 'IP' ? '5' : '0.05';
    }

    if (el.bulkCSV) {
      const bulkLbl = document.querySelector('label[for="bulkCSV"]');
      if (bulkLbl) bulkLbl.textContent = `CSV Rows (Tdb ${u.T}, RH%, Label [, #color])`;
      el.bulkCSV.placeholder = units === 'IP'
        ? '95, 55, OA\n75, 50, RA\n55, 92, SA'
        : '35, 55, OA\n24, 50, RA\n13, 92, SA';
    }
  }

  /* ==========================================================================
     TAB CHANGE SUBSCRIPTION (Centralized via app.js 'psychro:tab-changed')
     ========================================================================== */
  if (typeof window !== 'undefined') {
    on(window, 'psychro:tab-changed', (e) => {
      const detail = e?.detail || {};
      if (detail.panelId !== 'leftPanel') return;
      if (detail.tabId === 'tabPoints') {
        refreshPointsTable();
      } else if (detail.tabId === 'tabCalc') {
        if (!lastTableSignature) generatePsyTable();
      }
    });
  }

  /* ==========================================================================
     TAB 1 — 1. GLOBAL CITY DESIGN DATABASE
     ========================================================================== */
  function getCityList() {
    return Array.isArray(Weather?.CITIES) ? Weather.CITIES : [];
  }

  function populateCitySelect() {
    if (!el.citySelect) return;
    const cities = getCityList();
    const prevVal = el.citySelect.value;
    const units = getUnits();

    el.citySelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `Select ASHRAE city (${cities.length})…`;
    el.citySelect.appendChild(placeholder);

    const groups = new Map();
    cities.forEach((city, idx) => {
      const region = city.region || 'Global';
      if (!groups.has(region)) groups.set(region, []);
      groups.get(region).push({ city, idx });
    });

    groups.forEach((entries, region) => {
      const og = document.createElement('optgroup');
      og.label = region;
      entries.forEach(({ city, idx }) => {
        const opt = document.createElement('option');
        opt.value = city.id != null ? String(city.id) : String(idx);
        const zone = city.zone || city.climateZone || city.cz || '—';
        const elevM = Number(city.elev_m ?? city.elev ?? city.elevation ?? 0);
        const elevTxt = units === 'IP'
          ? `${Math.round(elevM * FT_PER_M).toLocaleString()} ft`
          : `${Math.round(elevM).toLocaleString()} m`;
        const country = city.country ? `, ${city.country}` : '';
        opt.textContent = `${city.name}${country} · CZ ${zone} · ${elevTxt}`;
        og.appendChild(opt);
      });
      el.citySelect.appendChild(og);
    });

    if (prevVal) el.citySelect.value = prevVal;
  }

  function getSelectedCity() {
    if (!el.citySelect) return null;
    const val = el.citySelect.value;
    if (!val) return null;
    const cities = getCityList();
    const byIdMatch = cities.find((c) => c.id != null && String(c.id) === val);
    if (byIdMatch) return byIdMatch;
    const idx = parseInt(val, 10);
    return Number.isInteger(idx) && cities[idx] ? cities[idx] : null;
  }

  function shortCityTag(name) {
    return String(name || 'City').split(',')[0].trim().slice(0, 14);
  }

  function resolveCityDesignPoint(spec, pPa, fallbackRH = 55) {
    if (!spec) return null;
    let Tdb = NaN;
    let Twb = NaN;
    let RH = NaN;
    let Tdp = NaN;
    let w = NaN;

    if (Array.isArray(spec)) {
      Tdb = Number(spec[0]);
      Twb = Number(spec[1]);
    } else if (typeof spec === 'object') {
      Tdb = Number(spec.Tdb ?? spec.T ?? spec.db ?? spec.dryBulb);
      Twb = Number(spec.Twb ?? spec.mcwb ?? spec.wb ?? spec.wetBulb);
      RH = Number(spec.RH ?? spec.rh);
      Tdp = Number(spec.Tdp ?? spec.dp ?? spec.dewPoint);
      w = Number(spec.w ?? spec.W);
    } else if (typeof spec === 'number') {
      Tdb = spec;
    }

    if (!Number.isFinite(Tdb)) return null;
    if (Number.isFinite(w) && w >= 0) {
      return { T: Tdb, w: clamp(w, 0, Psy.wsat_at(Tdb, pPa)) };
    }
    if (Number.isFinite(Twb)) {
      const twbEff = Math.min(Twb, Tdb);
      return { T: Tdb, w: Psy.w_from_TTwb(Tdb, twbEff, pPa) };
    }
    if (Number.isFinite(Tdp)) {
      return { T: Tdb, w: Math.min(Psy.w_from_Tdp(Math.min(Tdp, Tdb), pPa), Psy.wsat_at(Tdb, pPa)) };
    }
    if (Number.isFinite(RH)) {
      const rh01 = RH > 1 ? RH / 100 : RH;
      return { T: Tdb, w: Psy.w_from_TRH(Tdb, clamp(rh01, 0, 1), pPa) };
    }
    return { T: Tdb, w: Psy.w_from_TRH(Tdb, fallbackRH / 100, pPa) };
  }

  function extractCityDesignPoints(city, pPa) {
    if (typeof Weather?.getCityDesignPoints === 'function') {
      const pts = Weather.getCityDesignPoints(city, pPa);
      if (Array.isArray(pts) && pts.length) return pts;
    }

    const tag = shortCityTag(city.name);
    const zone = city.zone || city.climateZone || city.cz || '';
    const elevM = Number(city.elev_m ?? city.elev ?? city.elevation ?? 0);
    const noteSuffix = `${city.name}${zone ? ` (CZ ${zone})` : ''}, Elev ${Math.round(elevM)} m`;

    // Summer 0.4% cooling design
    const sum04Spec = city.summer04 || city.design?.summer04 || city.cool04 || {
      Tdb: city.sum04_Tdb ?? city.sum04_db ?? city.cool04_Tdb ?? city.db04 ?? city.summer04Tdb ?? city.s04_Tdb ?? city.tSum04 ?? city.summerTdb,
      Twb: city.sum04_Twb ?? city.sum04_mcwb ?? city.cool04_Twb ?? city.mcwb04 ?? city.summer04Twb ?? city.s04_Twb ?? city.twbSum04 ?? city.summerTwb
    };

    // Summer 1% cooling design
    let sum1Spec = city.summer1 || city.summer10 || city.design?.summer1 || city.cool1 || {
      Tdb: city.sum1_Tdb ?? city.sum10_Tdb ?? city.sum1_db ?? city.cool1_Tdb ?? city.db1 ?? city.summer1Tdb ?? city.s1_Tdb ?? city.tSum1,
      Twb: city.sum1_Twb ?? city.sum10_Twb ?? city.sum1_mcwb ?? city.cool1_Twb ?? city.mcwb1 ?? city.summer1Twb ?? city.s1_Twb ?? city.twbSum1
    };

    // Winter 99.6% heating design
    const win996Spec = city.winter996 || city.design?.winter996 || city.heat996 || {
      Tdb: city.win996_Tdb ?? city.win996_db ?? city.heat996_Tdb ?? city.db996 ?? city.winter996Tdb ?? city.w996_Tdb ?? city.tWin996 ?? city.winterTdb,
      Twb: city.win996_Twb ?? city.winter996Twb,
      Tdp: city.win996_Tdp ?? city.winter996Tdp,
      RH: city.win996_RH ?? city.win996_rh ?? city.winter996RH ?? city.winterRH
    };

    const s04 = resolveCityDesignPoint(sum04Spec, pPa, 45);
    let s1 = resolveCityDesignPoint(sum1Spec, pPa, 48);
    // Graceful ASHRAE delta if city dataset only provides 0.4% summer peak
    if (!s1 && s04) {
      const t1 = s04.T - 1.5;
      const twb04 = Psy.twb_from_Tw(s04.T, s04.w, pPa);
      s1 = { T: t1, w: Psy.w_from_TTwb(t1, Math.min(t1, twb04 - 0.6), pPa) };
    }
    const w996 = resolveCityDesignPoint(win996Spec, pPa, 60);

    const out = [];
    if (s04) {
      out.push({
        T: s04.T,
        w: s04.w,
        label: `${tag} Sum 0.4%`,
        color: '#f43f5e',
        note: `ASHRAE Cooling 0.4% DB/MCWB — ${noteSuffix}`
      });
    }
    if (s1) {
      out.push({
        T: s1.T,
        w: s1.w,
        label: `${tag} Sum 1%`,
        color: '#f59e0b',
        note: `ASHRAE Cooling 1% DB/MCWB — ${noteSuffix}`
      });
    }
    if (w996) {
      out.push({
        T: w996.T,
        w: w996.w,
        label: `${tag} Win 99.6%`,
        color: '#38bdf8',
        note: `ASHRAE Heating 99.6% DB — ${noteSuffix}`
      });
    }
    return out;
  }

  on(el.btnPlotCity, 'click', () => {
    const city = getSelectedCity();
    if (!city) {
      toast('Select an ASHRAE design city first', 'error');
      return;
    }
    const elevM = Number(city.elev_m ?? city.elev ?? city.elevation ?? 0);
    const pPa = Psy.baroPa(elevM);

    const designPts = extractCityDesignPoints(city, pPa);
    if (!designPts.length) {
      toast(`No design conditions found for ${city.name}`, 'error');
      return;
    }

    pushStoreHistory(`Plot ${city.name} Design Points`);
    setStorePressure(pPa, elevM, null, false);
    addPointsBatch(designPts, `Plot ${city.name} Design Points`, false);
    fitPointsView(false);
    syncAtmosphereInputs(true);
    toast(`Plotted ${city.name} (${designPts.length} design pts @ ${(pPa / 1000).toFixed(2)} kPa)`, 'success');
  });

  /* ---- Weather Bin / Analytics Normalization & Stats Renderer ---- */
  function readWeatherOpacity() {
    if (!el.weatherOpacity) return 0.65;
    const raw = parseFloat(el.weatherOpacity.value);
    if (!Number.isFinite(raw)) return 0.65;
    const maxAttr = parseFloat(el.weatherOpacity.max);
    return maxAttr > 1.5 ? clamp(raw / 100, 0.05, 1) : clamp(raw, 0.05, 1);
  }

  function computeFallbackWeatherAnalytics(hours, pPa) {
    const totalHours = hours.length;
    if (!totalHours) return null;
    const cfg = getComfortCfg();
    const zones = Comfort.getSummerWinterZones(pPa, cfg);
    const polySum = zones.summer.poly;
    const polyWin = zones.winter.poly;

    const pointInPoly = (x, y, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    let comfortHrs = 0;
    let coolingHrs = 0;
    let dehumHrs = 0;
    let heatingHrs = 0;
    let econHrs = 0;
    let evapHrs = 0;
    let cdhC = 0;
    let hdhC = 0;

    for (let i = 0; i < totalHours; i++) {
      const rec = hours[i];
      const T = Number(rec.T ?? rec.Tdb ?? rec.tdb ?? rec.temp);
      if (!Number.isFinite(T)) continue;
      let w = Number(rec.w ?? rec.W);
      if (!Number.isFinite(w)) {
        const rh = Number(rec.rh ?? rec.RH);
        w = Number.isFinite(rh) ? Psy.w_from_TRH(T, (rh > 1 ? rh / 100 : rh), pPa) : 0;
      }
      const h = Psy.h_kJkg(T, w);
      const Twb = Psy.twb_from_Tw(T, w, pPa);

      if (T > 18.3) cdhC += (T - 18.3);
      if (T < 18.3) hdhC += (18.3 - T);

      // Economizer free-cooling band: 4°C <= Tdb <= 21°C and h <= 58 kJ/kg (ASHRAE 90.1 high-limit)
      if (T >= 4 && T <= 21 && h <= 58) econHrs++;
      // Evaporative cooling potential: hot & dry (T > 24°C, Twb <= 21.5°C, W <= 0.012)
      if (T > 24 && Twb <= 21.5 && w <= 0.012) evapHrs++;

      const inComfort = pointInPoly(T, w, polySum) || pointInPoly(T, w, polyWin);
      if (inComfort) {
        comfortHrs++;
      } else if (T < 20) {
        heatingHrs++;
      } else if (w > 0.012) {
        dehumHrs++;
      } else if (T > 25.5) {
        coolingHrs++;
      } else {
        comfortHrs++;
      }
    }

    return {
      totalHours,
      comfortHrs,
      comfortPct: (comfortHrs / totalHours) * 100,
      coolingHrs,
      dehumHrs,
      heatingHrs,
      econHrs,
      evapHrs,
      cdh: cdhC,
      hdh: hdhC
    };
  }

  function extractWeatherMetrics(weather) {
    if (!weather) return null;
    const records = Array.isArray(weather.records) ? weather.records
      : (Array.isArray(weather.hours) ? weather.hours
        : (Array.isArray(weather.data) ? weather.data : []));
    const b = weather.bins || null;
    const s = b || weather.stats || {};
    const pPa = weather.pPa || getPressurePa();

    const totalHours = Number(s.totalHours ?? records.length) || 0;
    if (!totalHours) return null;

    const hasBinsMetrics = (
      Number.isFinite(Number(s.comfortHours)) &&
      Number.isFinite(Number(s.coolHours)) &&
      Number.isFinite(Number(s.heatHours))
    );
    const fb = hasBinsMetrics ? null : computeFallbackWeatherAnalytics(records, pPa);

    const comfortHrs = Number(s.comfortHours ?? s.comfortHrs ?? fb?.comfortHrs ?? 0);
    const coolingHrs = Number(s.coolHours ?? s.coolingHours ?? s.coolingHrs ?? fb?.coolingHrs ?? 0);
    const dehumHrs = Number(s.dehumHours ?? s.dehumHrs ?? fb?.dehumHrs ?? 0);
    const heatingHrs = Number(s.heatHours ?? s.heatingHours ?? s.heatingHrs ?? fb?.heatingHrs ?? 0);
    const econHrs = Number(s.economizerHours ?? s.econHrs ?? fb?.econHrs ?? 0);
    const evapHrs = Number(s.evapHours ?? s.evapHrs ?? fb?.evapHrs ?? 0);
    const cdh = Number(s.cdh ?? fb?.cdh ?? 0);
    const hdh = Number(s.hdh ?? fb?.hdh ?? 0);
    const comfortPct = Number.isFinite(Number(s.comfortPct))
      ? Number(s.comfortPct)
      : (comfortHrs / totalHours) * 100;

    return {
      source: weather.sourceName || weather.source || weather.name || weather.city || 'Weather Dataset',
      totalHours,
      comfortHrs,
      comfortPct,
      coolingHrs,
      dehumHrs,
      heatingHrs,
      econHrs,
      evapHrs,
      cdh,
      hdh
    };
  }

  function renderWeatherStats(weather) {
    if (!el.weatherStats) return;
    const m = extractWeatherMetrics(weather);
    if (!m) {
      if (lastWeatherSig !== '') {
        lastWeatherSig = '';
        el.weatherStats.innerHTML = '';
        el.weatherStats.style.display = 'none';
      }
      return;
    }

    const units = getUnits();
    const sig = `${units}|${m.source}|${m.totalHours}|${m.comfortHrs}|${m.coolingHrs}|${m.dehumHrs}|${m.heatingHrs}|${m.cdh}|${m.hdh}`;
    if (sig === lastWeatherSig) return;
    lastWeatherSig = sig;

    el.weatherStats.style.display = '';
    const isIP = units === 'IP';
    const dhScale = isIP ? 1.8 : 1;
    const dhUnit = isIP ? '°F·h' : '°C·h';

    const pct = (hrs) => Math.max(0, Math.min(100, (hrs / m.totalHours) * 100));
    const pComf = pct(m.comfortHrs);
    const pCool = pct(m.coolingHrs);
    const pDehum = pct(m.dehumHrs);
    const pHeat = pct(m.heatingHrs);

    // Normalize stacked bar widths when cooling & dehumidification hours overlap
    const rawSum = pComf + pCool + pDehum + pHeat;
    const barScale = rawSum > 100 ? (100 / rawSum) : 1;
    const wComf = pComf * barScale;
    const wCool = pCool * barScale;
    const wDehum = pDehum * barScale;
    const wHeat = pHeat * barScale;
    const wOther = Math.max(0, 100 - (wComf + wCool + wDehum + wHeat));

    const fmtInt = (v) => Math.round(v).toLocaleString();
    const fmtK = (v) => {
      const scaled = v * dhScale;
      return scaled >= 10000 ? `${(scaled / 1000).toFixed(1)}k` : Math.round(scaled).toLocaleString();
    };

    el.weatherStats.innerHTML = `
      <div style="padding:8px;border-radius:var(--r-sm,6px);background:var(--panel2);border:1px solid var(--glassBorder);margin:6px 0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px">
          <span style="font-size:11px;font-weight:700;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.source)}">${esc(m.source)}</span>
          <span style="font-family:var(--mono);font-size:10px;font-weight:600;color:var(--accent);white-space:nowrap">${fmtInt(m.totalHours)} hrs</span>
        </div>

        <div class="weather-bar" style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--inputBg);border:1px solid var(--border);margin-bottom:5px" role="img" aria-label="Annual psychrometric hours distribution">
          ${wComf > 0.2 ? `<div class="weather-bar-seg" style="width:${wComf.toFixed(2)}%;background:#10b981" title="Comfort: ${fmtInt(m.comfortHrs)} hrs (${pComf.toFixed(1)}%)"></div>` : ''}
          ${wCool > 0.2 ? `<div class="weather-bar-seg" style="width:${wCool.toFixed(2)}%;background:#38bdf8" title="Cooling: ${fmtInt(m.coolingHrs)} hrs (${pCool.toFixed(1)}%)"></div>` : ''}
          ${wDehum > 0.2 ? `<div class="weather-bar-seg" style="width:${wDehum.toFixed(2)}%;background:#f59e0b" title="Dehumidification: ${fmtInt(m.dehumHrs)} hrs (${pDehum.toFixed(1)}%)"></div>` : ''}
          ${wHeat > 0.2 ? `<div class="weather-bar-seg" style="width:${wHeat.toFixed(2)}%;background:#ef4444" title="Heating: ${fmtInt(m.heatingHrs)} hrs (${pHeat.toFixed(1)}%)"></div>` : ''}
          ${wOther > 0.2 ? `<div class="weather-bar-seg" style="width:${wOther.toFixed(2)}%;background:#64748b" title="Other / Transitional: ${wOther.toFixed(1)}%"></div>` : ''}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:9px;color:var(--muted);margin-bottom:7px">
          <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#10b981"></span>Comf ${pComf.toFixed(0)}%</span>
          <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#38bdf8"></span>Cool ${pCool.toFixed(0)}%</span>
          <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#f59e0b"></span>Dehum ${pDehum.toFixed(0)}%</span>
          <span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444"></span>Heat ${pHeat.toFixed(0)}%</span>
        </div>

        <div class="calcResult" style="margin:0;gap:4px">
          <div class="metric"><span class="lbl">Comfort</span><span class="val" style="color:var(--success,#10b981)">${m.comfortPct.toFixed(1)}% <span style="font-weight:400;color:var(--muted)">(${fmtInt(m.comfortHrs)}h)</span></span></div>
          <div class="metric"><span class="lbl">Cooling</span><span class="val" style="color:var(--cool,#38bdf8)">${fmtInt(m.coolingHrs)} hrs</span></div>
          <div class="metric"><span class="lbl">Dehum</span><span class="val" style="color:var(--dehum,#f59e0b)">${fmtInt(m.dehumHrs)} hrs</span></div>
          <div class="metric"><span class="lbl">Heating</span><span class="val" style="color:var(--heat,#ef4444)">${fmtInt(m.heatingHrs)} hrs</span></div>
          <div class="metric"><span class="lbl">Economizer</span><span class="val">${fmtInt(m.econHrs)} hrs <span style="font-weight:400;color:var(--muted)">(${pct(m.econHrs).toFixed(0)}%)</span></span></div>
          <div class="metric"><span class="lbl">Evap Cool</span><span class="val">${fmtInt(m.evapHrs)} hrs <span style="font-weight:400;color:var(--muted)">(${pct(m.evapHrs).toFixed(0)}%)</span></span></div>
          <div class="metric"><span class="lbl">CDH (${dhUnit})</span><span class="val">${fmtK(m.cdh)}</span></div>
          <div class="metric"><span class="lbl">HDH (${dhUnit})</span><span class="val">${fmtK(m.hdh)}</span></div>
        </div>
      </div>
    `;
  }

  function applyLoadedWeather(records, meta = {}) {
    if (!Array.isArray(records) || !records.length) {
      toast('Weather file contained no valid hourly records', 'error');
      return;
    }
    const pPa = Number.isFinite(meta.pPa) ? meta.pPa
      : (Number.isFinite(meta.elev_m) ? Psy.baroPa(meta.elev_m) : getPressurePa());
    if (Number.isFinite(meta.elev_m) || Number.isFinite(meta.pPa)) {
      setStorePressure(pPa, Number.isFinite(meta.elev_m) ? meta.elev_m : undefined, null, false);
    }

    const bins = typeof Weather?.computePsychroBins === 'function'
      ? Weather.computePsychroBins(records, pPa)
      : null;

    const weatherObj = {
      cityId: meta.cityId ?? null,
      sourceName: meta.sourceName || meta.source || meta.city || 'Weather Data',
      records,
      bins,
      mode: el.weatherMode?.value || getState().weather?.mode || 'heatmap',
      opacity: readWeatherOpacity()
    };

    setStoreWeather(weatherObj);
    setStoreLayer('weather', true);
    renderWeatherStats(weatherObj);
    syncAtmosphereInputs(true);
  }

  on(el.btnLoadCityTMY, 'click', () => {
    const city = getSelectedCity();
    if (!city) {
      toast('Select an ASHRAE design city first', 'error');
      return;
    }
    if (typeof Weather?.generateSyntheticTMY !== 'function') {
      toast('Synthetic TMY generator unavailable', 'error');
      return;
    }
    const elevM = Number(city.elev_m ?? city.elev ?? city.elevation ?? 0);
    try {
      const tmy = Weather.generateSyntheticTMY(city);
      const records = Array.isArray(tmy) ? tmy : (tmy?.records || tmy?.hours || tmy?.data || []);
      const pPa = Number.isFinite(tmy?.pPa) ? tmy.pPa : Psy.baroPa(elevM);
      applyLoadedWeather(records, {
        cityId: tmy?.cityId ?? city.id ?? null,
        sourceName: tmy?.sourceName || `${city.name}, ${city.country || ''} (Synthetic TMY)`.replace(/,\s+\(/, ' ('),
        elev_m: Number.isFinite(tmy?.elev_m) ? tmy.elev_m : elevM,
        pPa
      });
      toast(`Loaded ${records.length.toLocaleString()}h TMY for ${city.name}`, 'success');
    } catch (err) {
      toast(`TMY generation failed: ${err?.message || err}`, 'error');
    }
  });

  /* ==========================================================================
     TAB 1 — 2. ALTITUDE & BAROMETRIC PRESSURE (BIDIRECTIONAL)
     ========================================================================== */
  function isPsiUnit(val) {
    return val === 'psi' || val === 'psia';
  }

  function syncAtmosphereInputs(force = false) {
    const pPa = getPressurePa();
    const altM = clamp(Psy.invBaroAlt_m(pPa), -500, 9000);
    const altU = el.altUnit?.value || 'm';
    const pU = el.pUnit?.value || 'kPa';

    if (el.alt && (force || document.activeElement !== el.alt)) {
      const altDisp = altU === 'ft' ? altM * FT_PER_M : altM;
      el.alt.value = String(Math.round(altDisp));
    }
    if (el.pOverride && (force || document.activeElement !== el.pOverride)) {
      const pDisp = isPsiUnit(pU) ? (pPa / PA_PER_PSI) : (pPa / 1000);
      el.pOverride.value = pDisp.toFixed(3);
      el.pOverride.min = isPsiUnit(pU) ? '4.0' : '30';
      el.pOverride.max = isPsiUnit(pU) ? '16.7' : '115';
    }
  }

  const handleAltEdit = () => {
    const v = parseFloat(el.alt.value);
    if (!Number.isFinite(v)) return;
    atmEditSource = 'alt';
    const altM = clamp(el.altUnit?.value === 'ft' ? v / FT_PER_M : v, -500, 9000);
    const pPa = Psy.baroPa(altM);
    if (el.pOverride) {
      const pU = el.pUnit?.value || 'kPa';
      el.pOverride.value = (isPsiUnit(pU) ? pPa / PA_PER_PSI : pPa / 1000).toFixed(3);
    }
  };
  on(el.alt, 'input', handleAltEdit);
  on(el.alt, 'change', handleAltEdit);

  const handlePOverrideEdit = () => {
    const txt = el.pOverride.value.trim();
    if (!txt) {
      atmEditSource = 'alt';
      return;
    }
    const v = parseFloat(txt);
    if (!Number.isFinite(v)) return;
    atmEditSource = 'p';
    const pU = el.pUnit?.value || 'kPa';
    const pPa = clamp(isPsiUnit(pU) ? v * PA_PER_PSI : v * 1000, 30000, 115000);
    const altM = clamp(Psy.invBaroAlt_m(pPa), -500, 9000);
    if (el.alt) {
      const altU = el.altUnit?.value || 'm';
      el.alt.value = String(Math.round(altU === 'ft' ? altM * FT_PER_M : altM));
    }
  };
  on(el.pOverride, 'input', handlePOverrideEdit);
  on(el.pOverride, 'change', handlePOverrideEdit);

  on(el.altUnit, 'change', () => {
    const v = parseFloat(el.alt?.value);
    if (el.alt && Number.isFinite(v)) {
      const converted = el.altUnit.value === 'ft' ? v * FT_PER_M : v / FT_PER_M;
      el.alt.value = String(Math.round(converted));
      el.alt.min = el.altUnit.value === 'ft' ? '-1640' : '-500';
      el.alt.max = el.altUnit.value === 'ft' ? '29500' : '9000';
    }
  });

  on(el.pUnit, 'change', () => {
    const v = parseFloat(el.pOverride?.value);
    const psi = isPsiUnit(el.pUnit.value);
    if (el.pOverride) {
      el.pOverride.min = psi ? '4.0' : '30';
      el.pOverride.max = psi ? '16.7' : '115';
      if (Number.isFinite(v)) {
        const converted = psi ? v / KPA_PER_PSI : v * KPA_PER_PSI;
        el.pOverride.value = converted.toFixed(3);
      }
    }
  });

  function applyAtmosphereFromUI() {
    let pPa;
    let altM;
    let pOverrideArg = null;
    const povRaw = el.pOverride ? parseFloat(el.pOverride.value) : NaN;
    const altRaw = el.alt ? parseFloat(el.alt.value) : 0;

    if (atmEditSource === 'p' && Number.isFinite(povRaw)) {
      const pU = el.pUnit?.value || 'kPa';
      pPa = clamp(isPsiUnit(pU) ? povRaw * PA_PER_PSI : povRaw * 1000, 30000, 115000);
      altM = clamp(Psy.invBaroAlt_m(pPa), -500, 9000);
      pOverrideArg = pPa;
    } else if (Number.isFinite(altRaw)) {
      altM = clamp(el.altUnit?.value === 'ft' ? altRaw / FT_PER_M : altRaw, -500, 9000);
      pPa = Psy.baroPa(altM);
      pOverrideArg = null;
    } else {
      toast('Enter a valid altitude or barometric pressure', 'error');
      return;
    }

    setStorePressure(pPa, altM, pOverrideArg, true);
    syncAtmosphereInputs(true);
    const units = getUnits();
    const pTxt = units === 'IP'
      ? `${(pPa / PA_PER_PSI).toFixed(3)} psia (${Math.round(altM * FT_PER_M)} ft)`
      : `${(pPa / 1000).toFixed(2)} kPa (${Math.round(altM)} m)`;
    toast(`Atmosphere updated: ${pTxt}`, 'success');
  }

  on(el.applyAtm, 'click', applyAtmosphereFromUI);
  on(el.alt, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyAtmosphereFromUI(); } });
  on(el.pOverride, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyAtmosphereFromUI(); } });

  /* ==========================================================================
     TAB 1 — 3. EPW / CSV WEATHER FILE LOADER & CONTROLS
     ========================================================================== */
  async function handleWeatherFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const nameLower = (file.name || '').toLowerCase();
      const isEpw = nameLower.endsWith('.epw') || /^location\s*,/i.test(text.trimStart());
      let parsed;
      if (isEpw && typeof Weather?.parseEPW === 'function') {
        parsed = Weather.parseEPW(text);
      } else if (!isEpw && typeof Weather?.parseWeatherCSV === 'function') {
        parsed = Weather.parseWeatherCSV(text, getPressurePa());
      } else if (typeof Weather?.parseEPW === 'function') {
        parsed = Weather.parseEPW(text);
      } else {
        toast('Weather parser unavailable', 'error');
        return;
      }

      if (parsed?.ok === false) {
        toast(parsed.error || 'Failed to parse weather file', 'error');
        return;
      }

      const records = Array.isArray(parsed)
        ? parsed
        : (parsed?.records || parsed?.hours || parsed?.data || []);
      if (!records.length) {
        toast(`No valid hourly weather rows found in ${file.name}`, 'error');
        return;
      }

      const elevM = Number(parsed?.elev_m ?? parsed?.elevation);
      const fileStem = file.name.replace(/\.(epw|csv|txt)$/i, '');
      const sourceName = (parsed?.sourceName && parsed.sourceName !== 'Weather CSV')
        ? parsed.sourceName
        : fileStem;

      applyLoadedWeather(records, {
        cityId: null,
        sourceName,
        elev_m: Number.isFinite(elevM) ? elevM : undefined,
        pPa: Number.isFinite(parsed?.pPa) ? parsed.pPa : undefined
      });
      toast(`Loaded ${sourceName} (${records.length.toLocaleString()} hrs)`, 'success');
    } catch (err) {
      toast(`Failed to load weather file: ${err?.message || err}`, 'error');
    }
  }

  if (el.epwDropZone && el.epwFileInput) {
    on(el.epwDropZone, 'click', (e) => {
      if (e.target !== el.epwFileInput) el.epwFileInput.click();
    });
    on(el.epwDropZone, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.epwFileInput.click();
      }
    });
    const setDragState = (active) => {
      el.epwDropZone.classList.toggle('dragover', active);
      el.epwDropZone.classList.toggle('drag-over', active);
    };
    on(el.epwDropZone, 'dragenter', (e) => { e.preventDefault(); e.stopPropagation(); setDragState(true); });
    on(el.epwDropZone, 'dragover', (e) => { e.preventDefault(); e.stopPropagation(); setDragState(true); });
    on(el.epwDropZone, 'dragleave', (e) => { e.preventDefault(); e.stopPropagation(); setDragState(false); });
    on(el.epwDropZone, 'dragend', () => setDragState(false));
    on(el.epwDropZone, 'drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragState(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleWeatherFile(file);
    });
    on(el.epwFileInput, 'change', () => {
      const file = el.epwFileInput.files?.[0];
      if (file) handleWeatherFile(file);
      el.epwFileInput.value = '';
    });
  }

  function updateWeatherDisplayOptions() {
    const mode = el.weatherMode?.value || 'heatmap';
    const opacity = readWeatherOpacity();
    setStoreWeather({ mode, opacity, autoShow: false });
  }

  on(el.weatherMode, 'change', updateWeatherDisplayOptions);
  on(el.weatherOpacity, 'input', updateWeatherDisplayOptions);
  on(el.weatherOpacity, 'change', updateWeatherDisplayOptions);

  on(el.btnClearWeather, 'click', () => {
    clearStoreWeather();
    renderWeatherStats(null);
    toast('Weather overlay cleared', 'info');
  });

  function syncWeatherControls() {
    const w = getState().weather;
    if (el.weatherMode && document.activeElement !== el.weatherMode && w?.mode) {
      el.weatherMode.value = w.mode;
    }
    if (el.weatherOpacity && document.activeElement !== el.weatherOpacity && Number.isFinite(w?.opacity)) {
      const maxAttr = parseFloat(el.weatherOpacity.max);
      el.weatherOpacity.value = String(maxAttr > 1.5 ? Math.round(w.opacity * 100) : w.opacity);
    }
    renderWeatherStats(w);
  }

  /* ==========================================================================
     TAB 1 — 4. CHART RANGE & CURVES
     ========================================================================== */
  function syncViewInputs(force = false) {
    const view = getState().view || { tMin: -10, tMax: 55, wMax: 0.030 };
    const units = getUnits();
    if (el.tMin && (force || document.activeElement !== el.tMin)) {
      el.tMin.value = tToDisp(view.tMin, units).toFixed(1);
    }
    if (el.tMax && (force || document.activeElement !== el.tMax)) {
      el.tMax.value = tToDisp(view.tMax, units).toFixed(1);
    }
    if (el.wMax && (force || document.activeElement !== el.wMax)) {
      const wd = wToDisp(view.wMax, units);
      el.wMax.value = units === 'SI' ? wd.toFixed(1) : String(Math.round(wd));
    }
  }

  function applyViewFromInputs() {
    const units = getUnits();
    const rawTMin = parseFloat(el.tMin?.value);
    const rawTMax = parseFloat(el.tMax?.value);
    const rawWMax = parseFloat(el.wMax?.value);
    if (!Number.isFinite(rawTMin) || !Number.isFinite(rawTMax) || !Number.isFinite(rawWMax)) {
      toast('Enter valid numeric chart range values', 'error');
      return;
    }
    let tMinSI = clamp(dispToT(rawTMin, units), -50, 80);
    let tMaxSI = clamp(dispToT(rawTMax, units), -45, 90);
    if (tMaxSI - tMinSI < 2) {
      const mid = 0.5 * (tMinSI + tMaxSI);
      tMinSI = mid - 1;
      tMaxSI = mid + 1;
    }
    const wMaxSI = clamp(dispToW(rawWMax, units), 0.002, 0.080);
    setStoreView({ tMin: tMinSI, tMax: tMaxSI, wMax: wMaxSI });
    syncViewInputs(true);
  }

  on(el.btnRedraw, 'click', applyViewFromInputs);
  on(el.tMin, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyViewFromInputs(); } });
  on(el.tMax, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyViewFromInputs(); } });
  on(el.wMax, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyViewFromInputs(); } });

  on(el.btnFit, 'click', () => {
    fitPointsView();
    syncViewInputs(true);
  });

  on(el.btnResetZoom, 'click', () => {
    resetZoomView();
    syncViewInputs(true);
  });

  on(el.density, 'change', () => setStoreGrid({ density: el.density.value }));
  on(el.rhStep, 'change', () => {
    const v = clamp(parseInt(el.rhStep.value, 10) || 10, 5, 25);
    el.rhStep.value = String(v);
    setStoreGrid({ rhStep: v });
  });
  on(el.labelMode, 'change', () => setStoreGrid({ labelMode: el.labelMode.value }));
  on(el.labelPx, 'change', () => {
    const v = clamp(parseInt(el.labelPx.value, 10) || 11, 8, 18);
    el.labelPx.value = String(v);
    setStoreGrid({ labelPx: v });
  });
  on(el.chkEnthRuler, 'change', () => {
    setStoreGrid({ showEnthalpyRuler: !!el.chkEnthRuler.checked });
  });
  on(el.chkFlowAnim, 'change', () => setStoreLayer('flowAnim', !!el.chkFlowAnim.checked));

  // Exact Axis Style controls
  on(el.axisFrame, 'change', () => setStoreAxisStyle({ frame: el.axisFrame.value }));
  on(el.axisTickDir, 'change', () => setStoreAxisStyle({ tickDir: el.axisTickDir.value }));
  on(el.axisYSide, 'change', () => setStoreAxisStyle({ yAxisSide: el.axisYSide.value }));
  on(el.axisRulerStyle, 'change', () => setStoreAxisStyle({ enthalpyRulerStyle: el.axisRulerStyle.value }));
  on(el.chkAxisSubTicks, 'change', () => setStoreAxisStyle({ showSubTicks: !!el.chkAxisSubTicks.checked }));
  on(el.chkDualPvScale, 'change', () => setStoreAxisStyle({ showDualPvScale: !!el.chkDualPvScale.checked }));

  // Process Trend Style controls
  on(el.trendArrowStyle, 'change', () => setStoreTrendStyle({ arrowStyle: el.trendArrowStyle.value }));
  on(el.trendLineWeight, 'change', () => setStoreTrendStyle({ lineWeight: el.trendLineWeight.value }));
  on(el.trendPointMarker, 'change', () => setStoreTrendStyle({ pointMarker: el.trendPointMarker.value }));
  on(el.trendBadgeStyle, 'change', () => setStoreTrendStyle({ badgeStyle: el.trendBadgeStyle.value }));
  on(el.chkTrendDecomp, 'change', () => setStoreTrendStyle({ showDecompLegs: !!el.chkTrendDecomp.checked }));

  function syncAxisAndTrendControls(force = false) {
    const st = getState();
    const ax = { ...(DEFAULT_AXIS_STYLE || {}), ...(st.axisStyle || {}) };
    const tr = { ...(DEFAULT_TREND_STYLE || {}), ...(st.trendStyle || {}) };
    const active = typeof document !== 'undefined' ? document.activeElement : null;

    if (el.axisFrame && (force || active !== el.axisFrame) && ax.frame) {
      el.axisFrame.value = ax.frame;
    }
    if (el.axisTickDir && (force || active !== el.axisTickDir) && ax.tickDir) {
      el.axisTickDir.value = ax.tickDir;
    }
    if (el.axisYSide && (force || active !== el.axisYSide) && ax.yAxisSide) {
      el.axisYSide.value = ax.yAxisSide;
    }
    if (el.axisRulerStyle && (force || active !== el.axisRulerStyle) && ax.enthalpyRulerStyle) {
      el.axisRulerStyle.value = ax.enthalpyRulerStyle;
    }
    if (el.chkAxisSubTicks && typeof ax.showSubTicks === 'boolean') {
      el.chkAxisSubTicks.checked = ax.showSubTicks;
    }
    if (el.chkDualPvScale && typeof ax.showDualPvScale === 'boolean') {
      el.chkDualPvScale.checked = ax.showDualPvScale;
    }

    if (el.trendArrowStyle && (force || active !== el.trendArrowStyle) && tr.arrowStyle) {
      el.trendArrowStyle.value = tr.arrowStyle;
    }
    if (el.trendLineWeight && (force || active !== el.trendLineWeight) && tr.lineWeight) {
      el.trendLineWeight.value = tr.lineWeight;
    }
    if (el.trendPointMarker && (force || active !== el.trendPointMarker) && tr.pointMarker) {
      el.trendPointMarker.value = tr.pointMarker;
    }
    if (el.trendBadgeStyle && (force || active !== el.trendBadgeStyle) && tr.badgeStyle) {
      el.trendBadgeStyle.value = tr.badgeStyle;
    }
    if (el.chkTrendDecomp && typeof tr.showDecompLegs === 'boolean') {
      el.chkTrendDecomp.checked = tr.showDecompLegs;
    }
  }

  function syncChartCurveControls() {
    const st = getState();
    const grid = st.grid || {};
    const layers = st.layers || {};

    if (el.density && document.activeElement !== el.density && grid.density) {
      el.density.value = grid.density;
    }
    if (el.rhStep && document.activeElement !== el.rhStep && Number.isFinite(grid.rhStep)) {
      el.rhStep.value = String(grid.rhStep);
    }
    if (el.labelMode && document.activeElement !== el.labelMode && grid.labelMode) {
      el.labelMode.value = grid.labelMode;
    }
    if (el.labelPx && document.activeElement !== el.labelPx && Number.isFinite(grid.labelPx)) {
      el.labelPx.value = String(grid.labelPx);
    }
    if (el.chkEnthRuler && typeof grid.showEnthalpyRuler === 'boolean') {
      el.chkEnthRuler.checked = grid.showEnthalpyRuler;
    }
    if (el.chkFlowAnim && typeof layers.flowAnim === 'boolean') {
      el.chkFlowAnim.checked = layers.flowAnim;
    }
    syncAxisAndTrendControls(false);
  }

  /* ==========================================================================
     TAB 1 — 5. DYNAMIC ASHRAE 55 PMV COMFORT, GIVONI & DATA CENTER ENVELOPES
     ========================================================================== */
  function pushComfortFromUI() {
    const units = getUnits();
    const mode = el.comfortMode?.value || 'both';
    if (mode !== 'none') lastActiveComfortMode = mode;
    const cloSummer = clamp(parseFloat(el.pmvCloSummer?.value) || 0.5, 0.1, 2.5);
    const cloWinter = clamp(parseFloat(el.pmvCloWinter?.value) || 1.0, 0.1, 2.5);
    const met = clamp(parseFloat(el.pmvMet?.value) || 1.1, 0.6, 4.5);
    const vAirRaw = parseFloat(el.pmvVair?.value);
    const vAirSI = Number.isFinite(vAirRaw)
      ? (units === 'IP' ? vAirRaw / FPM_PER_MPS : vAirRaw)
      : 0.1;
    const vAir = clamp(vAirSI, 0.01, 2.0);
    const mrtRaw = parseFloat(el.pmvMrtOff?.value);
    const mrtOffsetC = Number.isFinite(mrtRaw)
      ? clamp(units === 'IP' ? mrtRaw / 1.8 : mrtRaw, -15, 15)
      : 0;
    const pmvLimit = clamp(parseFloat(el.pmvLimit?.value) || 0.5, 0.1, 1.5);

    setStoreComfort({
      mode,
      cloSummer,
      cloWinter,
      met,
      vAir,
      mrtOffset: mrtOffsetC,
      mrtOff: mrtOffsetC,
      pmvLimit
    });

    if (mode === 'none' && getState().layers?.comfort !== false) {
      setStoreLayer('comfort', false);
    } else if (mode !== 'none' && getState().layers?.comfort === false) {
      setStoreLayer('comfort', true);
    }
  }

  on(el.comfortMode, 'change', pushComfortFromUI);
  [el.pmvCloSummer, el.pmvCloWinter, el.pmvMet, el.pmvVair, el.pmvMrtOff, el.pmvLimit].forEach((inp) => {
    on(inp, 'input', pushComfortFromUI);
    on(inp, 'change', pushComfortFromUI);
  });

  on(el.chkGivoni, 'change', () => setStoreLayer('givoni', !!el.chkGivoni.checked));
  on(el.chkDataCenter, 'change', () => setStoreLayer('datacenter', !!el.chkDataCenter.checked));

  function syncComfortControls(force = false) {
    const cfg = getComfortCfg();
    const layers = getState().layers || {};
    const units = getUnits();

    if (cfg.mode && cfg.mode !== 'none') {
      lastActiveComfortMode = cfg.mode;
    }

    if (el.comfortMode && (force || document.activeElement !== el.comfortMode)) {
      el.comfortMode.value = layers.comfort === false ? 'none' : cfg.mode;
    }
    if (el.pmvCloSummer && (force || document.activeElement !== el.pmvCloSummer)) {
      el.pmvCloSummer.value = cfg.cloSummer.toFixed(2);
    }
    if (el.pmvCloWinter && (force || document.activeElement !== el.pmvCloWinter)) {
      el.pmvCloWinter.value = cfg.cloWinter.toFixed(2);
    }
    if (el.pmvMet && (force || document.activeElement !== el.pmvMet)) {
      el.pmvMet.value = cfg.met.toFixed(1);
    }
    if (el.pmvVair && (force || document.activeElement !== el.pmvVair)) {
      el.pmvVair.value = units === 'IP'
        ? String(Math.round(cfg.vAir * FPM_PER_MPS))
        : cfg.vAir.toFixed(2);
    }
    if (el.pmvMrtOff && (force || document.activeElement !== el.pmvMrtOff)) {
      const dispOff = units === 'IP' ? cfg.mrtOffset * 1.8 : cfg.mrtOffset;
      el.pmvMrtOff.value = Number(dispOff.toFixed(1)).toString();
    }
    if (el.pmvLimit && (force || document.activeElement !== el.pmvLimit)) {
      el.pmvLimit.value = cfg.pmvLimit.toFixed(2);
    }
    if (el.chkGivoni && typeof layers.givoni === 'boolean') {
      el.chkGivoni.checked = layers.givoni;
    }
    if (el.chkDataCenter && typeof layers.datacenter === 'boolean') {
      el.chkDataCenter.checked = layers.datacenter;
    }
  }

  /* ==========================================================================
     TAB 1 — 6. SHR PROTRACTOR
     ========================================================================== */
  function readShrShowValue() {
    if (!el.shrShow) return false;
    if (el.shrShow.type === 'checkbox') return !!el.shrShow.checked;
    return el.shrShow.value === 'on' || el.shrShow.value === 'true';
  }

  function pushShrFromUI() {
    const show = readShrShowValue();
    const raw = parseFloat(el.shrVal?.value);
    const value = Number.isFinite(raw) ? clamp(raw, -2, 2) : 0.75;
    const refVal = el.shrRefPt?.value || '';
    const pts = getPoints();
    let refPointId = null;
    if (refVal !== '') {
      const matched = pts.find((p, i) => String(p.id ?? i) === refVal);
      if (matched) refPointId = matched.id ?? null;
    }
    setStoreSHR({ show, value, refPointId });
  }

  on(el.shrShow, 'change', pushShrFromUI);
  on(el.shrVal, 'input', pushShrFromUI);
  on(el.shrVal, 'change', pushShrFromUI);
  on(el.shrRefPt, 'change', pushShrFromUI);

  function syncShrControls() {
    const shr = getState().shr || {};
    const pts = getPoints();

    if (el.shrShow && document.activeElement !== el.shrShow) {
      const isOn = !!shr.show;
      if (el.shrShow.type === 'checkbox') el.shrShow.checked = isOn;
      else el.shrShow.value = isOn ? 'on' : 'off';
    }
    if (el.shrVal && document.activeElement !== el.shrVal) {
      const v = shr.value;
      if (Number.isFinite(v)) el.shrVal.value = String(v);
    }
    if (el.shrRefPt) {
      const desired = shr.refPointId != null ? String(shr.refPointId) : '';
      const sig = pts.map((p, i) => `${p.id ?? i}:${p.label || ''}`).join('|');
      if (el.shrRefPt.dataset.sig !== sig) {
        el.shrRefPt.dataset.sig = sig;
        el.shrRefPt.innerHTML = '<option value="">Center</option>';
        pts.forEach((p, i) => {
          const opt = document.createElement('option');
          opt.value = String(p.id ?? i);
          opt.textContent = `${i + 1}: ${p.label || `P${i + 1}`}`;
          el.shrRefPt.appendChild(opt);
        });
      }
      if (document.activeElement !== el.shrRefPt) {
        const hasMatch = Array.from(el.shrRefPt.options).some((o) => o.value === desired);
        el.shrRefPt.value = hasMatch ? desired : '';
      }
    }
  }

  /* ==========================================================================
     TAB 2 — 1. QUICK ADD POINT WITH ANY 2 OF 8 PROPERTIES
     ========================================================================== */
  on(el.inMode1, 'change', () => {
    setLabelWithUnit('inVal1', 'Value 1', propUnitLabel(el.inMode1.value, getUnits()));
  });
  on(el.inMode2, 'change', () => {
    setLabelWithUnit('inVal2', 'Value 2', propUnitLabel(el.inMode2.value, getUnits()));
  });

  function handleQuickAddPoint() {
    const mode1 = el.inMode1?.value || 'Tdb';
    const mode2 = el.inMode2?.value || 'RH';
    const v1 = parseFloat(el.inVal1?.value);
    const v2 = parseFloat(el.inVal2?.value);
    const units = getUnits();
    const pPa = getPressurePa();

    const solved = solveFromDisplayInputs(mode1, v1, mode2, v2, units, pPa);
    if (!solved.ok) {
      toast(solved.error || 'Could not solve psychrometric state', 'error');
      return;
    }

    const st = solved.state;
    const rawLabel = (el.inLbl?.value || '').trim();
    const label = rawLabel || nextAutoLabel();
    const color = el.inColor?.value || nextPaletteColor();
    const connectPrev = el.connect?.type === 'checkbox'
      ? !!el.connect.checked
      : (el.connect?.value === 'yes');

    addSinglePoint({ T: st.T, w: st.w, label, color, locked: false }, connectPrev);

    // Auto-increment label for rapid point entry & cycle palette color
    if (el.inLbl) {
      el.inLbl.value = '';
      el.inLbl.placeholder = `Auto (${nextAutoLabel()})`;
    }
    syncNewPointDefaults(true);

    const u = UNIT_LABELS[units];
    toast(`Added "${label}" (${tToDisp(st.T, units).toFixed(1)} ${u.T}, ${st.rh.toFixed(1)}% RH)`, 'success');
  }

  on(el.addPt, 'click', handleQuickAddPoint);
  [el.inVal1, el.inVal2, el.inLbl].forEach((inp) => {
    on(inp, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleQuickAddPoint();
      }
    });
  });

  /* ==========================================================================
     TAB 2 — 2. INTERACTIVE EDITABLE POINTS TABLE
     ========================================================================== */
  function getPointsTBody() {
    if (!el.ptsTbl) return null;
    if (el.ptsTbl.tagName === 'TBODY') return el.ptsTbl;
    return el.ptsTbl.tBodies?.[0] || el.ptsTbl.appendChild(document.createElement('tbody'));
  }

  function getPointPMVBadge(pt, pPa) {
    const cfg = getComfortCfg();
    const ev = Comfort.evaluatePointZones(pt.T, pt.w, pPa, cfg);
    const useWinter = cfg.mode === 'winter';
    const useBoth = cfg.mode === 'both' || cfg.mode === 'none';
    const primary = useWinter
      ? ev.winter
      : (useBoth && Math.abs(ev.winter.pmv) < Math.abs(ev.summer.pmv) ? ev.winter : ev.summer);

    let dotColor = '#10b981'; // comfortable
    if (primary.pmv < -cfg.pmvLimit) {
      dotColor = primary.pmv < -1.5 ? '#2563eb' : '#38bdf8';
    } else if (primary.pmv > cfg.pmvLimit) {
      dotColor = primary.pmv > 1.5 ? '#ef4444' : '#f59e0b';
    }
    const sign = primary.pmv >= 0 ? '+' : '';
    const title = `PMV ${sign}${primary.pmv.toFixed(2)} · PPD ${primary.ppd.toFixed(0)}% · ${primary.sensation}`;
    return { dotColor, title, pmv: primary.pmv, ppd: primary.ppd };
  }

  function computePointRowDisplay(pt, editMode, units, pPa) {
    const st = Psy.stateFromTw(pt.T, pt.w, pPa);
    const tDisp = tToDisp(st.T, units).toFixed(1);
    let secDisp;
    if (editMode === 'Twb') secDisp = tToDisp(st.Twb, units).toFixed(1);
    else if (editMode === 'Tdp') secDisp = tToDisp(st.Tdp, units).toFixed(1);
    else if (editMode === 'W') secDisp = units === 'SI' ? wToDisp(st.w, 'SI').toFixed(2) : wToDisp(st.w, 'IP').toFixed(1);
    else secDisp = st.rh.toFixed(1);

    // Show computed h when editing W, otherwise computed W
    let compDisp;
    if (editMode === 'W') {
      compDisp = (units === 'SI' ? st.h : st.hIP).toFixed(1);
    } else {
      compDisp = units === 'SI' ? wToDisp(st.w, 'SI').toFixed(2) : Math.round(wToDisp(st.w, 'IP')).toString();
    }

    const pmv = getPointPMVBadge(pt, pPa);
    return { tDisp, secDisp, compDisp, pmv, st };
  }

  function updatePointsTableHeaders(editMode, units) {
    const u = UNIT_LABELS[units] || UNIT_LABELS.SI;
    if (el.ptsTbl) {
      el.ptsTbl.style.tableLayout = 'fixed';
      el.ptsTbl.style.width = '100%';
    }
    if (el.ptTblSecondHdr) {
      if (editMode === 'Twb') el.ptTblSecondHdr.textContent = `Twb`;
      else if (editMode === 'Tdp') el.ptTblSecondHdr.textContent = `Tdp`;
      else if (editMode === 'W') el.ptTblSecondHdr.textContent = `W`;
      else el.ptTblSecondHdr.textContent = 'RH%';
      el.ptTblSecondHdr.title = editMode === 'RH' ? 'Relative Humidity (%)' : `${editMode} (${editMode === 'W' ? u.W : u.T})`;
    }
    // Compact column widths so #ptsTbl fits 100% inside 360px panel with zero horizontal scroll
    const ths = el.ptsTbl?.querySelectorAll('thead th');
    if (ths && ths.length >= 6) {
      const widths = ['22px', '68px', '46px', '46px', '42px', '78px'];
      ths.forEach((th, idx) => {
        th.style.width = widths[idx] || '';
        th.style.padding = '4px 2px';
      });
      ths[2].textContent = `Tdb`;
      ths[2].title = `Dry Bulb (${u.T})`;
      ths[4].textContent = editMode === 'W' ? `h` : `W`;
      ths[4].title = editMode === 'W' ? `Enthalpy (${u.h})` : `Humidity Ratio (${u.W})`;
    }
  }

  function refreshPointsTable() {
    const tb = getPointsTBody();
    if (!tb) return;

    const pts = getPoints();
    const units = getUnits();
    const pPa = getPressurePa();
    const editMode = el.ptTblEditMode?.value || 'RH';
    updatePointsTableHeaders(editMode, units);

    // Empty state
    if (!pts.length) {
      tb.dataset.sig = '';
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:10px 6px;font-size:11px">No state points yet — add above or click chart</td></tr>';
      return;
    }

    // Check if we can update existing rows in-place to preserve typing focus
    const nextSig = `${units}|${editMode}|${pts.map((p, i) => `${p.id ?? i}:${p.locked ? 1 : 0}`).join(',')}`;
    const existingRows = tb.querySelectorAll('tr[data-pt-idx]');
    if (tb.dataset.sig === nextSig && existingRows.length === pts.length) {
      pts.forEach((p, i) => {
        const tr = existingRows[i];
        const disp = computePointRowDisplay(p, editMode, units, pPa);
        const sel = isPointSelected(p, i);
        tr.classList.toggle('selected', sel);
        tr.style.background = sel ? 'var(--accentSoft, rgba(14,165,233,0.12))' : '';

        const cDot = tr.querySelector('.pt-color-dot');
        if (cDot) cDot.style.background = p.color || POINT_PALETTE[i % POINT_PALETTE.length];
        const pDot = tr.querySelector('.pt-pmv-dot');
        if (pDot) {
          pDot.style.background = disp.pmv.dotColor;
          pDot.title = disp.pmv.title;
        }
        const lblInp = tr.querySelector('.pt-lbl');
        if (lblInp && document.activeElement !== lblInp) lblInp.value = p.label || `P${i + 1}`;
        const tdbInp = tr.querySelector('.pt-tdb');
        if (tdbInp && document.activeElement !== tdbInp) tdbInp.value = disp.tDisp;
        const secInp = tr.querySelector('.pt-sec');
        if (secInp && document.activeElement !== secInp) secInp.value = disp.secDisp;
        const compTd = tr.querySelector('.pt-comp');
        if (compTd) compTd.textContent = disp.compDisp;
      });
      return;
    }

    // Preserve active input focus across rebuild if possible
    const activeEl = document.activeElement;
    let restoreFocus = null;
    if (activeEl && tb.contains(activeEl)) {
      const tr = activeEl.closest('tr[data-pt-id]');
      if (tr) {
        const cls = activeEl.classList.contains('pt-lbl') ? '.pt-lbl'
          : (activeEl.classList.contains('pt-tdb') ? '.pt-tdb'
            : (activeEl.classList.contains('pt-sec') ? '.pt-sec' : null));
        if (cls) {
          restoreFocus = {
            ptId: tr.dataset.ptId,
            cls,
            start: activeEl.selectionStart,
            end: activeEl.selectionEnd
          };
        }
      }
    }

    tb.dataset.sig = nextSig;
    tb.innerHTML = '';

    pts.forEach((p, i) => {
      const disp = computePointRowDisplay(p, editMode, units, pPa);
      const color = p.color || POINT_PALETTE[i % POINT_PALETTE.length];
      const ptName = p.label || `P${i + 1}`;
      const sel = isPointSelected(p, i);
      const tr = document.createElement('tr');
      tr.dataset.ptIdx = String(i);
      tr.dataset.ptId = String(p.id ?? i);
      if (sel) {
        tr.classList.add('selected');
        tr.style.background = 'var(--accentSoft, rgba(14,165,233,0.12))';
      }
      tr.style.cursor = 'pointer';

      const disAttr = p.locked ? 'disabled' : '';
      tr.innerHTML = `
        <td style="padding:3px 2px;white-space:nowrap;font-family:var(--mono);font-size:10px;color:var(--muted)">
          <span style="display:inline-flex;align-items:center;gap:2px">
            <span class="pt-color-dot" style="width:6px;height:6px;border-radius:50%;background:${esc(color)};flex-shrink:0" title="Point color"></span>
            <span class="pt-pmv-dot" style="width:5px;height:5px;border-radius:50%;background:${disp.pmv.dotColor};flex-shrink:0;opacity:0.95" title="${esc(disp.pmv.title)}"></span>
            <span>${i + 1}</span>
          </span>
        </td>
        <td style="padding:3px 2px"><input type="text" class="pt-lbl" value="${esc(ptName)}" ${disAttr} style="width:100%;max-width:66px;padding:0 3px;font-size:10.5px;font-family:var(--sans)" aria-label="Label for ${esc(ptName)}" /></td>
        <td style="padding:3px 2px"><input type="number" step="0.1" class="pt-tdb" value="${disp.tDisp}" ${disAttr} style="width:44px;padding:0 2px;font-size:10.5px" aria-label="Dry bulb for ${esc(ptName)}" /></td>
        <td style="padding:3px 2px"><input type="number" step="0.1" class="pt-sec" value="${disp.secDisp}" ${disAttr} style="width:44px;padding:0 2px;font-size:10.5px" aria-label="Second property for ${esc(ptName)}" /></td>
        <td class="pt-comp" style="padding:3px 2px;font-family:var(--mono);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${disp.compDisp}</td>
        <td style="padding:3px 2px;white-space:nowrap">
          <div style="display:inline-flex;align-items:center;gap:2px">
            <button type="button" class="pt-act pt-lck" aria-label="${p.locked ? 'Unlock' : 'Lock'} ${esc(ptName)}" title="${p.locked ? 'Unlock point' : 'Lock point'}" style="width:18px;height:18px;padding:0;font-size:9.5px;border-radius:4px;border:1px solid var(--inputBorder);background:transparent;color:var(--fg);cursor:pointer;opacity:${p.locked ? 1 : 0.8}">${p.locked ? '🔒' : '🔓'}</button>
            <button type="button" class="pt-act pt-edit" aria-label="Edit ${esc(ptName)}" title="${p.locked ? 'Edit point label, color & note' : 'Edit point details'}" style="width:18px;height:18px;padding:0;font-size:9.5px;border-radius:4px;border:1px solid var(--inputBorder);background:transparent;color:var(--accent);cursor:pointer">✎</button>
            <button type="button" class="pt-act dup pt-dup" aria-label="Duplicate ${esc(ptName)}" title="Duplicate point" style="width:18px;height:18px;padding:0;font-size:9.5px;border-radius:4px;border:1px solid var(--inputBorder);background:transparent;color:var(--muted);cursor:pointer">⧉</button>
            <button type="button" class="pt-act del pt-del" aria-label="Delete ${esc(ptName)}" title="Delete point" style="width:18px;height:18px;padding:0;font-size:9.5px;border-radius:4px;border:1px solid rgba(239,68,68,0.28);background:transparent;color:var(--danger);cursor:pointer">✕</button>
          </div>
        </td>
      `;

      // Clicking row selects point on chart
      on(tr, 'click', (e) => {
        if (e.target.closest('button')) return;
        selectChartPoint(p, i);
      });

      const lblInp = tr.querySelector('.pt-lbl');
      const tdbInp = tr.querySelector('.pt-tdb');
      const secInp = tr.querySelector('.pt-sec');

      if (!p.locked) {
        on(lblInp, 'input', () => {
          updateSinglePoint(p, i, { label: lblInp.value }, true);
        });
        on(lblInp, 'change', () => {
          const clean = lblInp.value.trim() || `P${i + 1}`;
          lblInp.value = clean;
          updateSinglePoint(p, i, { label: clean }, false);
        });

        on(tdbInp, 'change', () => {
          const curUnits = getUnits();
          const curP = getPressurePa();
          const curMode = el.ptTblEditMode?.value || 'RH';
          const rawT = parseFloat(tdbInp.value);
          const rawSec = parseFloat(secInp.value);
          if (!Number.isFinite(rawT)) {
            const validDisp = computePointRowDisplay(p, curMode, curUnits, curP);
            tdbInp.value = validDisp.tDisp;
            return;
          }
          const tCheckC = dispToT(rawT, curUnits);
          if (tCheckC < -60 || tCheckC > 120) {
            const validDisp = computePointRowDisplay(p, curMode, curUnits, curP);
            tdbInp.value = validDisp.tDisp;
            toast('Dry-bulb temperature out of valid range', 'error');
            return;
          }
          const solved = solveFromDisplayInputs('Tdb', rawT, curMode, rawSec, curUnits, curP);
          if (!solved.ok) {
            // Fallback: keep Tdb and clamp w within saturation at current RH
            const tNew = clamp(tCheckC, -60, 120);
            const rhKeep = Psy.RH_from_Tw(p.T, p.w, curP);
            const wNew = Psy.w_from_TRH(tNew, rhKeep, curP);
            updateSinglePoint(p, i, { T: tNew, w: wNew }, false);
            const updatedDisp = computePointRowDisplay(p, curMode, curUnits, curP);
            tdbInp.value = updatedDisp.tDisp;
            secInp.value = updatedDisp.secDisp;
            toast(solved.error || 'Adjusted moisture to stay within saturation', 'info');
          } else {
            updateSinglePoint(p, i, { T: solved.state.T, w: solved.state.w }, false);
          }
        });

        on(secInp, 'change', () => {
          const curUnits = getUnits();
          const curP = getPressurePa();
          const curMode = el.ptTblEditMode?.value || 'RH';
          const rawSec = parseFloat(secInp.value);
          if (!Number.isFinite(rawSec)) {
            secInp.value = computePointRowDisplay(p, curMode, curUnits, curP).secDisp;
            return;
          }
          const tDispNow = tToDisp(p.T, curUnits);
          const solved = solveFromDisplayInputs('Tdb', tDispNow, curMode, rawSec, curUnits, curP);
          if (!solved.ok) {
            toast(solved.error || 'Value out of psychrometric bounds', 'error');
            // Reset input immediately even while focused so invalid value never lingers
            secInp.value = computePointRowDisplay(p, curMode, curUnits, curP).secDisp;
            return;
          }
          updateSinglePoint(p, i, { T: solved.state.T, w: solved.state.w }, false);
        });
      }

      on(tr.querySelector('.pt-lck'), 'click', (e) => {
        e.stopPropagation();
        togglePointLock(p, i);
        toast(`"${p.label || `P${i + 1}`}" ${!p.locked ? 'unlocked' : 'locked'}`, 'info');
      });

      // Allow clicking Edit on locked / derived points so users can edit label, color & note
      on(tr.querySelector('.pt-edit'), 'click', (e) => {
        e.stopPropagation();
        openEditPoint(p.id);
      });

      on(tr.querySelector('.pt-dup'), 'click', (e) => {
        e.stopPropagation();
        duplicateSinglePoint(p, i);
        toast(`Duplicated "${p.label || `P${i + 1}`}"`, 'success');
      });

      on(tr.querySelector('.pt-del'), 'click', (e) => {
        e.stopPropagation();
        const name = p.label || `P${i + 1}`;
        if (deleteSinglePoint(p, i)) {
          toast(`Deleted "${name}"`, 'info');
        }
      });

      tb.appendChild(tr);
    });

    if (restoreFocus) {
      const targetRow = tb.querySelector(`tr[data-pt-id="${CSS.escape(restoreFocus.ptId)}"]`);
      const targetInp = targetRow?.querySelector(restoreFocus.cls);
      if (targetInp && !targetInp.disabled) {
        targetInp.focus();
        if (typeof restoreFocus.start === 'number' && targetInp.type === 'text') {
          try { targetInp.setSelectionRange(restoreFocus.start, restoreFocus.end); } catch (_) {}
        }
      }
    }
  }

  on(el.ptTblEditMode, 'change', refreshPointsTable);

  /* ==========================================================================
     TAB 2 — 3. SMART BULK CSV / TSV IMPORT & CLEAR ALL
     ========================================================================== */
  on(el.bulkImport, 'click', () => {
    const raw = (el.bulkCSV?.value || '').trim();
    if (!raw) {
      toast('Paste CSV/TSV rows (Tdb, RH%, Label) to import', 'error');
      return;
    }
    const units = getUnits();
    const pPa = getPressurePa();
    const lines = raw.split(/\r?\n/);
    const existingCount = getPoints().length;
    const toImport = [];
    let skipped = 0;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      const cols = line.split(/\t|;|,/).map((s) => s.trim());
      if (cols.length < 2) {
        skipped++;
        continue;
      }

      const tRaw = parseFloat(cols[0].replace(/°[CF]$/i, ''));
      const rhRaw = parseFloat(cols[1].replace(/%$/, ''));

      // Auto-skip header row like "Tdb, RH, Label"
      if (!Number.isFinite(tRaw) || !Number.isFinite(rhRaw)) {
        if (li === 0 && /[a-zA-Z]/.test(cols[0])) continue;
        skipped++;
        continue;
      }

      const tC = dispToT(tRaw, units);
      if (tC < -60 || tC > 120 || rhRaw < 0 || rhRaw > 100) {
        skipped++;
        continue;
      }

      let label = '';
      let color = '';
      const hexRe = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

      if (cols[2]) {
        if (hexRe.test(cols[2])) color = cols[2];
        else label = cols[2];
      }
      if (cols[3] && hexRe.test(cols[3])) {
        color = cols[3];
      }

      const idxNow = existingCount + toImport.length;
      const w = Psy.w_from_TRH(tC, rhRaw / 100, pPa);
      toImport.push({
        T: tC,
        w,
        label: label || `P${idxNow + 1}`,
        color: color || POINT_PALETTE[idxNow % POINT_PALETTE.length],
        locked: false
      });
    }

    if (!toImport.length) {
      toast('No valid rows found — check Tdb range and RH% (0–100)', 'error');
      return;
    }

    addPointsBatch(toImport, `Import ${toImport.length} CSV Points`, true);
    fitPointsView(false);
    const skipNote = skipped ? ` (${skipped} invalid skipped)` : '';
    toast(`Imported ${toImport.length} state point${toImport.length > 1 ? 's' : ''}${skipNote}`, 'success');
  });

  function resetClearPtsConfirm() {
    if (clearPtsConfirmTimer !== null) {
      clearTimeout(clearPtsConfirmTimer);
      clearPtsConfirmTimer = null;
    }
    clearPtsPending = false;
    if (el.btnClearPts) {
      el.btnClearPts.textContent = 'Clear All';
    }
  }

  on(el.btnClearPts, 'click', () => {
    const pts = getPoints();
    if (!pts.length) {
      resetClearPtsConfirm();
      toast('No state points to clear', 'info');
      return;
    }
    if (!clearPtsPending) {
      clearPtsPending = true;
      if (el.btnClearPts) el.btnClearPts.textContent = 'Confirm Clear?';
      clearPtsConfirmTimer = setTimeout(resetClearPtsConfirm, 3500);
      return;
    }
    resetClearPtsConfirm();
    const count = pts.length;
    if (typeof store?.clearAll === 'function') {
      store.clearAll();
    } else {
      pushStoreHistory('Clear All');
      store.state.points = [];
      if (Array.isArray(store.state.processes)) store.state.processes = [];
      emitStore('change', { reason: 'clear-all' });
    }
    toast(`Cleared ${count} point${count > 1 ? 's' : ''} (Ctrl+Z to undo)`, 'info');
  });

  /* ==========================================================================
     TAB 3 — 1. UNIVERSAL ANY-2-OF-8 PROPERTY CALCULATOR & COMFORT CARD
     ========================================================================== */
  function renderCalcComfortSummary(st) {
    if (!el.calcComfortSummary) return;
    if (!st) {
      el.calcComfortSummary.innerHTML = '';
      return;
    }
    const cfg = getComfortCfg();
    const units = getUnits();
    const ev = Comfort.evaluatePointZones(st.T, st.w, st.pPa, cfg);

    // Choose seasonal PMV matching comfortMode (or better match when 'both')
    const showWinter = cfg.mode === 'winter';
    const pmvObj = showWinter
      ? ev.winter
      : (cfg.mode === 'both' && Math.abs(ev.winter.pmv) < Math.abs(ev.summer.pmv) ? ev.winter : ev.summer);
    const seasonTag = showWinter
      ? `Win ${cfg.cloWinter.toFixed(1)} clo`
      : (cfg.mode === 'both' && pmvObj === ev.winter ? `Win ${cfg.cloWinter.toFixed(1)} clo` : `Sum ${cfg.cloSummer.toFixed(1)} clo`);

    const inComfort = cfg.mode === 'winter'
      ? ev.inWinterComfort
      : (cfg.mode === 'summer' ? ev.inSummerComfort : (ev.inSummerComfort || ev.inWinterComfort));
    const pmvColor = inComfort ? 'var(--success,#10b981)' : (pmvObj.pmv > 0 ? 'var(--warn,#f59e0b)' : 'var(--cool,#38bdf8)');
    const pmvSign = pmvObj.pmv >= 0 ? '+' : '';

    // ASHRAE TC 9.9 Data Center classification
    const dcLabel = ev.dataCenterClass || 'Outside A3';
    const dcColor = ev.dataCenterClass === 'Recommended'
      ? 'var(--success,#10b981)'
      : (ev.dataCenterClass ? 'var(--accent,#0ea5e9)' : 'var(--muted)');

    // Mold & Surface Condensation Risk (ASHRAE 160)
    const mold = ev.mold;
    const moldColor = mold.riskLevel === 'condensation' || mold.riskLevel === 'high'
      ? 'var(--danger,#ef4444)'
      : (mold.riskLevel === 'moderate' ? 'var(--warn,#f59e0b)' : 'var(--success,#10b981)');
    const moldBadge = mold.riskLevel === 'condensation' ? 'Condensation'
      : (mold.riskLevel === 'high' ? 'High Mold'
        : (mold.riskLevel === 'moderate' ? 'Moderate' : 'Low Risk'));
    const marginDisp = units === 'IP' ? `${(mold.marginC * 1.8).toFixed(1)} °F` : `${mold.marginC.toFixed(1)} °C`;

    el.calcComfortSummary.innerHTML = `
      <div style="padding:8px;border-radius:var(--r-sm,6px);background:var(--panel2);border:1px solid var(--glassBorder);margin:6px 0;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <span style="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">ASHRAE 55 PMV / PPD (${esc(seasonTag)})</span>
          <span class="badge" style="background:${inComfort ? 'var(--successSoft,rgba(16,185,129,0.14))' : 'var(--warnSoft,rgba(245,158,11,0.14))'};color:${pmvColor};font-size:9px;font-weight:700">${inComfort ? '✓ Compliant' : esc(pmvObj.sensation)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">
          <div class="metric" style="padding:4px 6px"><span class="lbl">PMV</span><span class="val" style="color:${pmvColor}">${pmvSign}${pmvObj.pmv.toFixed(2)}</span></div>
          <div class="metric" style="padding:4px 6px"><span class="lbl">PPD</span><span class="val">${pmvObj.ppd.toFixed(1)}%</span></div>
          <div class="metric" style="padding:4px 6px"><span class="lbl">ΔTdp Margin</span><span class="val">${marginDisp}</span></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px">
          <div style="padding:4px 6px;border-radius:4px;background:var(--inputBg);border:1px solid var(--border);display:flex;flex-direction:column;gap:1px">
            <span style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">TC 9.9 Data Center</span>
            <span style="font-family:var(--mono);font-weight:700;color:${dcColor}">${esc(dcLabel)}</span>
          </div>
          <div style="padding:4px 6px;border-radius:4px;background:var(--inputBg);border:1px solid var(--border);display:flex;flex-direction:column;gap:1px" title="${esc(mold.label)} (Surface RH @ T-3°C: ${mold.surfaceRH.toFixed(0)}%)">
            <span style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:600">ASHRAE 160 Mold</span>
            <span style="font-family:var(--mono);font-weight:700;color:${moldColor}">${moldBadge} <span style="font-weight:400;color:var(--muted)">(${mold.surfaceRH.toFixed(0)}%)</span></span>
          </div>
        </div>
      </div>
    `;
  }

  function runCalculator(silent = false) {
    if (!el.calcResults) return null;
    const mode1 = el.calcIn1?.value || 'Tdb';
    const mode2 = el.calcIn2?.value || 'RH';
    const v1 = parseFloat(el.calcV1?.value);
    const v2 = parseFloat(el.calcV2?.value);
    const units = getUnits();
    const pPa = getPressurePa();

    const solved = solveFromDisplayInputs(mode1, v1, mode2, v2, units, pPa);
    if (!solved.ok) {
      lastCalcState = null;
      el.calcResults.innerHTML = `<div style="grid-column:1/-1;padding:6px 8px;border-radius:6px;background:var(--dangerSoft,rgba(239,68,68,0.12));border:1px solid var(--dangerBorder,rgba(239,68,68,0.34));color:var(--danger);font-size:11px">${esc(solved.error || 'Invalid state')}</div>`;
      renderCalcComfortSummary(null);
      if (!silent) toast(solved.error || 'Could not calculate state', 'error');
      return null;
    }

    const st = solved.state;
    lastCalcState = st;

    const isIP = units === 'IP';
    const u = UNIT_LABELS[units] || UNIT_LABELS.SI;
    const cards = [
      { lbl: 'Tdb', val: `${tToDisp(st.T, units).toFixed(2)} ${u.T}` },
      { lbl: 'RH', val: `${st.rh.toFixed(2)} %` },
      { lbl: 'W', val: `${isIP ? wToDisp(st.w, 'IP').toFixed(2) : wToDisp(st.w, 'SI').toFixed(3)} ${u.W}` },
      { lbl: 'Twb', val: `${tToDisp(st.Twb, units).toFixed(2)} ${u.T}` },
      { lbl: 'Tdp', val: `${tToDisp(st.Tdp, units).toFixed(2)} ${u.T}` },
      { lbl: 'h', val: `${(isIP ? st.hIP : st.h).toFixed(2)} ${u.h}` },
      { lbl: 'v', val: `${(isIP ? st.vIP : st.v).toFixed(4)} ${u.v}` },
      { lbl: 'ρ_moist', val: `${(isIP ? st.rhoMoistIP : st.rhoMoist).toFixed(4)} ${u.rho}` },
      { lbl: 'ρ_dry', val: `${(isIP ? st.rhoDryIP : st.rhoDry).toFixed(4)} ${u.rho}` },
      { lbl: 'Pv', val: `${isIP ? (st.pv / PA_PER_PSI).toFixed(4) : (st.pv / 1000).toFixed(4)} ${u.P}` },
      { lbl: 'Pws', val: `${isIP ? (st.pws / PA_PER_PSI).toFixed(4) : (st.pws / 1000).toFixed(4)} ${u.P}` },
      { lbl: 'μ (Deg. Sat)', val: `${st.mu.toFixed(4)} (${(st.mu * 100).toFixed(1)}%)` }
    ];

    el.calcResults.innerHTML = cards
      .map((c) => `<div class="metric"><span class="lbl">${esc(c.lbl)}</span><span class="val">${esc(c.val)}</span></div>`)
      .join('');

    renderCalcComfortSummary(st);
    return st;
  }

  function seedCalcValueForProp(prop, units) {
    const isIP = units === 'IP';
    const st = lastCalcState;
    if (st) {
      switch (prop) {
        case 'Tdb': return tToDisp(st.T, units).toFixed(1);
        case 'Twb': return tToDisp(st.Twb, units).toFixed(1);
        case 'Tdp': return tToDisp(st.Tdp, units).toFixed(1);
        case 'RH':  return st.rh.toFixed(1);
        case 'W':   return isIP ? wToDisp(st.w, 'IP').toFixed(1) : wToDisp(st.w, 'SI').toFixed(2);
        case 'h':   return (isIP ? st.hIP : st.h).toFixed(2);
        case 'v':   return (isIP ? st.vIP : st.v).toFixed(isIP ? 3 : 4);
        case 'Pv':  return (isIP ? st.pv / PA_PER_PSI : st.pv / 1000).toFixed(isIP ? 4 : 3);
        default: break;
      }
    }
    switch (prop) {
      case 'Tdb': return isIP ? '75.0' : '24.0';
      case 'Twb': return isIP ? '64.0' : '18.0';
      case 'Tdp': return isIP ? '57.0' : '14.0';
      case 'RH':  return '50';
      case 'W':   return isIP ? '70.0' : '10.0';
      case 'h':   return isIP ? '29.0' : '50.0';
      case 'v':   return isIP ? '13.6' : '0.85';
      case 'Pv':  return isIP ? '0.22' : '1.5';
      default:    return '50';
    }
  }

  on(el.calcIn1, 'change', () => {
    const u = getUnits();
    const prop = el.calcIn1.value;
    setLabelWithUnit('calcV1', 'Value 1', propUnitLabel(prop, u));
    if (el.calcV1) el.calcV1.value = seedCalcValueForProp(prop, u);
    runCalculator(true);
  });
  on(el.calcIn2, 'change', () => {
    const u = getUnits();
    const prop = el.calcIn2.value;
    setLabelWithUnit('calcV2', 'Value 2', propUnitLabel(prop, u));
    if (el.calcV2) el.calcV2.value = seedCalcValueForProp(prop, u);
    runCalculator(true);
  });
  on(el.calcBtn, 'click', () => runCalculator(false));
  [el.calcV1, el.calcV2].forEach((inp) => {
    on(inp, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runCalculator(false);
      }
    });
  });

  on(el.calcAddPt, 'click', () => {
    const st = lastCalcState || runCalculator(false);
    if (!st) return;
    const label = nextAutoLabel();
    const color = nextPaletteColor();
    addSinglePoint({ T: st.T, w: st.w, label, color, locked: false }, false);
    syncNewPointDefaults(true);
    const units = getUnits();
    const u = UNIT_LABELS[units];
    toast(`Plotted "${label}" (${tToDisp(st.T, units).toFixed(1)} ${u.T}, ${st.rh.toFixed(1)}% RH)`, 'success');
  });

  /* ==========================================================================
     TAB 3 — 2. PSYCHROMETRIC SATURATION REFERENCE TABLE & 1-CLICK CSV COPY
     ========================================================================== */
  function generatePsyTable() {
    if (!el.psyTableWrap) return;
    const units = getUnits();
    const isIP = units === 'IP';
    const u = UNIT_LABELS[units] || UNIT_LABELS.SI;
    const pPa = getPressurePa();

    const from = parseFloat(el.tblFrom?.value);
    const to = parseFloat(el.tblTo?.value);
    let step = parseFloat(el.tblStep?.value);

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      toast('Enter valid From and To temperatures', 'error');
      return;
    }
    if (!Number.isFinite(step) || step <= 0) step = isIP ? 5 : 2;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const maxRows = 400;
    if ((hi - lo) / step > maxRows) {
      step = (hi - lo) / maxRows;
    }

    const csvHeader = [
      `Tdb (${u.T})`,
      `Wsat (${u.W})`,
      `hsat (${u.h})`,
      `vsat (${u.v})`,
      `Pws (${u.P})`,
      `rho_dry (${u.rho})`
    ];
    const csvLines = [csvHeader.join(',')];
    const rowsHtml = [];

    for (let td = lo; td <= hi + 1e-6; td += step) {
      const tC = clamp(dispToT(td, units), -60, 95);
      const ws = Psy.wsat_at(tC, pPa);
      const hs = isIP ? Psy.h_Btulb(tC, ws) : Psy.h_kJkg(tC, ws);
      const vsSI = Psy.v_m3kg(tC, ws, pPa);
      const vs = isIP ? vsSI * V_IP_PER_SI : vsSI;
      const pwsPa = Psy.p_ws_Pa(tC);
      const pws = isIP ? pwsPa / PA_PER_PSI : pwsPa / 1000;
      const rhoDrySI = 1 / vsSI;
      const rhoDry = isIP ? rhoDrySI * RHO_IP_PER_SI : rhoDrySI;

      const cT = td.toFixed(1);
      const cW = isIP ? wToDisp(ws, 'IP').toFixed(1) : wToDisp(ws, 'SI').toFixed(2);
      const cH = hs.toFixed(2);
      const cV = vs.toFixed(3);
      const cP = isIP ? pws.toFixed(4) : pws.toFixed(3);
      const cR = rhoDry.toFixed(4);

      csvLines.push([cT, cW, cH, cV, cP, cR].join(','));
      rowsHtml.push(
        `<tr>` +
        `<td style="font-family:var(--mono);padding:3px 2px;font-size:10px">${cT}</td>` +
        `<td style="font-family:var(--mono);padding:3px 2px;font-size:10px">${cW}</td>` +
        `<td style="font-family:var(--mono);padding:3px 2px;font-size:10px">${cH}</td>` +
        `<td style="font-family:var(--mono);padding:3px 2px;font-size:10px">${cV}</td>` +
        `<td style="font-family:var(--mono);padding:3px 2px;font-size:10px">${cP}</td>` +
        `<td style="font-family:var(--mono);padding:3px 2px;font-size:10px">${cR}</td>` +
        `</tr>`
      );
    }

    lastTableCsv = csvLines.join('\n');
    lastTableSignature = `${units}|${pPa.toFixed(1)}|${lo}|${hi}|${step}`;

    el.psyTableWrap.innerHTML = `
      <table class="ptable" style="table-layout:fixed;width:100%">
        <thead>
          <tr>
            <th style="padding:4px 2px;line-height:1.15">Tdb<br><small style="font-weight:500;opacity:0.75">${esc(u.T)}</small></th>
            <th style="padding:4px 2px;line-height:1.15">Wsat<br><small style="font-weight:500;opacity:0.75">${esc(u.W)}</small></th>
            <th style="padding:4px 2px;line-height:1.15">hsat<br><small style="font-weight:500;opacity:0.75">${esc(u.h)}</small></th>
            <th style="padding:4px 2px;line-height:1.15">vsat<br><small style="font-weight:500;opacity:0.75">${esc(u.v)}</small></th>
            <th style="padding:4px 2px;line-height:1.15">Pws<br><small style="font-weight:500;opacity:0.75">${esc(u.P)}</small></th>
            <th style="padding:4px 2px;line-height:1.15">ρ_dry<br><small style="font-weight:500;opacity:0.75">${esc(u.rho)}</small></th>
          </tr>
        </thead>
        <tbody>${rowsHtml.join('')}</tbody>
      </table>
    `;
  }

  on(el.tblGen, 'click', generatePsyTable);
  [el.tblFrom, el.tblTo, el.tblStep].forEach((inp) => {
    on(inp, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        generatePsyTable();
      }
    });
  });

  on(el.tblCopyCsv, 'click', async () => {
    if (!lastTableCsv) generatePsyTable();
    if (!lastTableCsv) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(lastTableCsv);
      } else {
        const ta = document.createElement('textarea');
        ta.value = lastTableCsv;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast('Saturation table copied as CSV', 'success');
    } catch (_) {
      toast('Clipboard copy failed', 'error');
    }
  });

  /* ==========================================================================
     UNIT SYSTEM SWITCHING & STORE SUBSCRIPTIONS
     ========================================================================== */
  function handleUnitsChanged() {
    const newUnits = getUnits();
    const prevUnits = lastUnits;
    lastUnits = newUnits;

    // Convert quick-add & calculator values cleanly to the new unit system
    if (prevUnits !== newUnits) {
      const convertInputPair = (modeEl, valEl) => {
        if (!modeEl || !valEl || document.activeElement === valEl) return;
        const v = parseFloat(valEl.value);
        if (!Number.isFinite(v)) return;
        const c = convertDisplayValue(modeEl.value, v, prevUnits, newUnits);
        valEl.value = Number(c.toFixed(modeEl.value === 'v' || modeEl.value === 'Pv' ? 3 : 1)).toString();
      };
      convertInputPair(el.inMode1, el.inVal1);
      convertInputPair(el.inMode2, el.inVal2);
      convertInputPair(el.calcIn1, el.calcV1);
      convertInputPair(el.calcIn2, el.calcV2);

      // Convert saturation table From / To / Step
      if (el.tblFrom && document.activeElement !== el.tblFrom) {
        const v = parseFloat(el.tblFrom.value);
        if (Number.isFinite(v)) el.tblFrom.value = String(Math.round(convertDisplayValue('Tdb', v, prevUnits, newUnits)));
      }
      if (el.tblTo && document.activeElement !== el.tblTo) {
        const v = parseFloat(el.tblTo.value);
        if (Number.isFinite(v)) el.tblTo.value = String(Math.round(convertDisplayValue('Tdb', v, prevUnits, newUnits)));
      }
      if (el.tblStep && document.activeElement !== el.tblStep) {
        const s = parseFloat(el.tblStep.value);
        if (Number.isFinite(s)) {
          const ns = newUnits === 'IP' ? Math.max(1, Math.round(s * 1.8)) : Math.max(0.5, Math.round((s / 1.8) * 2) / 2);
          el.tblStep.value = String(ns);
        }
      }

      // Sync altitude/pressure dropdowns to match SI/IP system
      if (el.altUnit) el.altUnit.value = newUnits === 'IP' ? 'ft' : 'm';
      if (el.pUnit) {
        const psiOpt = Array.from(el.pUnit.options).find((o) => isPsiUnit(o.value));
        el.pUnit.value = (newUnits === 'IP' && psiOpt) ? psiOpt.value : 'kPa';
      }
    }

    updateUnitAwareLabels();
    populateCitySelect();
    syncAtmosphereInputs(true);
    syncViewInputs(true);
    syncComfortControls(true);
    refreshPointsTable();
    runCalculator(true);
    if (lastTableSignature) generatePsyTable();
    renderWeatherStats(getState().weather);
  }

  function syncAllFromStore(evt) {
    // Keep layers.comfort <-> comfort.mode synchronized bidirectionally
    if (evt?.reason === 'layer' && evt?.key === 'comfort') {
      const curMode = getComfortCfg().mode;
      if (evt.value === false && curMode !== 'none') {
        lastActiveComfortMode = curMode;
        setStoreComfort({ mode: 'none' });
        return;
      }
      if (evt.value === true && curMode === 'none') {
        setStoreComfort({ mode: lastActiveComfortMode || 'both' });
        return;
      }
    }

    if (getUnits() !== lastUnits) {
      handleUnitsChanged();
      return;
    }
    updateUnitAwareLabels();
    syncAtmosphereInputs(false);
    syncViewInputs(false);
    syncChartCurveControls();
    syncComfortControls(false);
    syncShrControls();
    syncWeatherControls();
    syncNewPointDefaults(false);
    refreshPointsTable();
    if (lastCalcState) {
      // Keep calculator comfort summary & pressure synchronized live
      runCalculator(true);
    }
  }

  // Subscribe cleanly to store events
  const subscribe = (evt, fn) => {
    if (typeof store?.on === 'function') store.on(evt, fn);
    else if (typeof store?.subscribe === 'function') store.subscribe(evt, fn);
  };

  subscribe('change', syncAllFromStore);
  subscribe('theme-changed', () => {
    syncChartCurveControls();
    syncAxisAndTrendControls(true);
  });
  subscribe('units-changed', handleUnitsChanged);
  subscribe('weather-changed', syncWeatherControls);

  /* ---- Initial Population & Render ---- */
  updateUnitAwareLabels();
  populateCitySelect();
  syncAtmosphereInputs(true);
  syncViewInputs(true);
  syncChartCurveControls();
  syncAxisAndTrendControls(true);
  syncComfortControls(true);
  syncShrControls();
  syncWeatherControls();
  syncNewPointDefaults(false);
  refreshPointsTable();
  runCalculator(true);
  generatePsyTable();

  return {
    syncAll: syncAllFromStore,
    refreshPointsTable,
    runCalculator,
    generatePsyTable,
    renderWeatherStats
  };
}
