/* ============================================================================
   PsychroChart Ultra 3.0 — Multi-Format Export & Engineering Reporting Engine
   Supports: 2x HiDPI Composite PNG, Clipboard PNG, Publication-Grade Vector SVG,
             Structured Engineering CSV, Executive Print-Ready HTML Report,
             Microsoft Word (.docx via docx@9.1.0 UMD), Project JSON, Share URL.
   ============================================================================ */

import { APP_VERSION, CoreDOM, UNIT_LABELS } from '../core/contracts.js';
import { Psy } from '../engine/psychro.js';
import { Comfort } from '../engine/comfort.js';
import { HVAC } from '../engine/hvac.js';
import { Weather } from '../engine/weather.js';

export const Exporter = (() => {
  /* --------------------------------------------------------------------------
     Internal Constants & Unit Conversion Helpers (SI internal -> SI/IP display)
     -------------------------------------------------------------------------- */
  const KPA_PER_PSI = 6.894757293168361;
  const FT3LB_PER_M3KG = 16.018463373960138;   // 1 m³/kg = 16.018463 ft³/lb
  const LBFT3_PER_KGM3 = 0.06242796057614461;  // 1 kg/m³ = 0.062428 lb/ft³
  const BTULB_PER_KJKG = 0.4299226141418802;   // Δh factor: 1 kJ/kg = 0.429923 Btu/lb
  const BTUH_PER_KW = 3412.141633127942;       // 1 kW = 3412.14 BTU/h
  const KW_PER_TR = 3.516852842066667;         // 1 Ton Refrigeration = 3.51685 kW
  const LB_PER_KG = 2.2046226218487757;
  const FT_PER_M = 3.280839895013123;
  const FPM_PER_MPS = 196.8503937007874;       // 1 m/s = 196.85 fpm
  const GRAINS_PER_LB = 7000;
  const RDA = 287.042;                         // J/(kg·K) dry air (ASHRAE 2021)

  const PROC_COLOR_MAP = {
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

  /* --------------------------------------------------------------------------
     Safe State & Environment Helpers (Dual Node.js + Browser Safe)
     -------------------------------------------------------------------------- */
  function getState(store) {
    if (!store) return {};
    if (typeof store.getState === 'function') return store.getState() || {};
    if (store.state && typeof store.state === 'object') return store.state;
    return store;
  }

  function hasDOM() {
    return typeof document !== 'undefined' && typeof window !== 'undefined';
  }

  function notifyToast(msg, type = 'info', store = null) {
    if (typeof store?.toast === 'function') {
      store.toast(msg, type);
      return;
    }
    if (!hasDOM()) return;
    const container = CoreDOM.byId('toastContainer');
    if (!container) return;
    const d = document.createElement('div');
    d.className = `toast ${type}`;
    const icon = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' }[type] || 'ℹ';
    d.innerHTML = `<span>${icon}</span><span>${CoreDOM.esc(msg)}</span>`;
    container.appendChild(d);
    setTimeout(() => {
      d.style.opacity = '0';
      d.style.transition = 'opacity .2s ease';
      setTimeout(() => d.remove(), 220);
    }, 2600);
  }

  function sanitizeFilename(raw, fallback = 'psychro_chart') {
    const clean = String(raw || '').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
    return clean || fallback;
  }

  function triggerDownload(blobOrUrl, filename, revokeAfter = false) {
    if (!hasDOM()) return false;
    const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (revokeAfter || typeof blobOrUrl !== 'string') {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    return true;
  }

  function fmtNum(v, dec = 2, fallback = '—') {
    return Number.isFinite(v) ? v.toFixed(dec) : fallback;
  }

  function fmtSigned(v, dec = 2, fallback = '—') {
    if (!Number.isFinite(v)) return fallback;
    return (v > 0 ? '+' : '') + v.toFixed(dec);
  }

  /* --------------------------------------------------------------------------
     Resilient Physics, Comfort & HVAC Adapters
     (Calls canonical Psy/Comfort/HVAC APIs with exact ASHRAE 2021 fallbacks)
     -------------------------------------------------------------------------- */
  function pwsPa(Tc) {
    if (typeof Psy?.p_ws_Pa === 'function') return Psy.p_ws_Pa(Tc);
    if (typeof Psy?.pws_Pa === 'function') return Psy.pws_Pa(Tc);
    const T = Tc + 273.15;
    if (Tc >= 0) {
      return Math.exp(-5800.2206 / T + 1.3914993 - 4.8640239e-2 * T + 4.1764768e-5 * T * T - 1.4452093e-8 * T * T * T + 6.5459673 * Math.log(T));
    }
    return Math.exp(-5674.5359 / T + 6.3925247 - 9.677843e-3 * T + 0.62215701e-6 * T * T + 2.0747825e-9 * T * T * T - 9.484024e-13 * Math.pow(T, 4) + 4.1635019 * Math.log(T));
  }

  function wFromPv(pv, pPa) {
    if (typeof Psy?.w_from_pv === 'function') return Psy.w_from_pv(pv, pPa);
    return 0.621945 * pv / Math.max(1, pPa - pv);
  }

  function pvFromW(w, pPa) {
    if (typeof Psy?.pv_from_w === 'function') return Psy.pv_from_w(w, pPa);
    return (w * pPa) / (w + 0.621945);
  }

  function wsatAt(Tc, pPa) {
    if (typeof Psy?.wsat_at === 'function') return Psy.wsat_at(Tc, pPa);
    return wFromPv(Math.min(pwsPa(Tc), pPa * 0.999), pPa);
  }

  function hSI(Tc, w) {
    if (typeof Psy?.h_kJkg === 'function') return Psy.h_kJkg(Tc, w);
    return 1.006 * Tc + w * (2501 + 1.86 * Tc);
  }

  function hIP(Tc, w) {
    // True ASHRAE IP enthalpy with 0°F dry-air datum (Fundamentals 2021 Ch.1 Eq.30)
    if (typeof Psy?.h_BtuLb === 'function') return Psy.h_BtuLb(Tc, w);
    if (typeof Psy?.h_Btulb === 'function') return Psy.h_Btulb(Tc, w);
    if (typeof Psy?.h_IP === 'function') return Psy.h_IP(Tc, w);
    const tF = Tc * 1.8 + 32;
    return 0.240 * tF + w * (1061 + 0.444 * tF);
  }

  function hToDisp(Tc, w, units) {
    return units === 'SI' ? hSI(Tc, w) : hIP(Tc, w);
  }

  function dhToDisp(dhSI, units) {
    if (units === 'SI') return dhSI;
    if (typeof Psy?.dh_Btulb === 'function') return Psy.dh_Btulb(dhSI);
    return dhSI * BTULB_PER_KJKG;
  }

  function vSI(Tc, w, pPa) {
    if (typeof Psy?.v_m3kg === 'function') return Psy.v_m3kg(Tc, w, pPa);
    return RDA * (Tc + 273.15) * (1 + 1.607858 * w) / pPa;
  }

  function vToDisp(vM3Kg, units) {
    return units === 'SI' ? vM3Kg : vM3Kg * FT3LB_PER_M3KG;
  }

  function rhoMoistSI(Tc, w, pPa) {
    if (typeof Psy?.rho_moist === 'function') return Psy.rho_moist(Tc, w, pPa);
    if (typeof Psy?.rhoMoist === 'function') return Psy.rhoMoist(Tc, w, pPa);
    return (1 + w) / Math.max(1e-6, vSI(Tc, w, pPa));
  }

  function rhoToDisp(rhoKgM3, units) {
    return units === 'SI' ? rhoKgM3 : rhoKgM3 * LBFT3_PER_KGM3;
  }

  function rhFrac(Tc, w, pPa) {
    if (typeof Psy?.RH_from_Tw === 'function') return CoreDOM.clamp(Psy.RH_from_Tw(Tc, w, pPa), 0, 1);
    return CoreDOM.clamp(pvFromW(w, pPa) / Math.max(1e-6, pwsPa(Tc)), 0, 1);
  }

  function tdpFromTw(Tc, w, pPa) {
    if (typeof Psy?.tdp_from_Tw === 'function') return Psy.tdp_from_Tw(Tc, w, pPa);
    const pv = pvFromW(w, pPa);
    if (typeof Psy?.dewpoint_from_pv === 'function') return Psy.dewpoint_from_pv(pv);
    if (pv <= 0) return -80;
    let lo = -80, hi = 85;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (pwsPa(mid) > pv) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  function twbFromTw(Tc, w, pPa) {
    if (typeof Psy?.twb_from_Tw === 'function') return Psy.twb_from_Tw(Tc, w, pPa);
    if (typeof Psy?.Twb_from_Tw === 'function') return Psy.Twb_from_Tw(Tc, w, pPa);
    let lo = -50, hi = Math.min(Tc + 0.5, 85);
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      const wCalc = wFromTdbTwb(Tc, mid, pPa);
      if (wCalc > w) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  function wFromTdbTwb(Tc, Twb, pPa) {
    if (typeof Psy?.w_from_TTwb === 'function') return Psy.w_from_TTwb(Tc, Twb, pPa);
    if (typeof Psy?.w_from_TdbTwb === 'function') return Psy.w_from_TdbTwb(Tc, Twb, pPa);
    const ws = wsatAt(Twb, pPa);
    if (Twb >= 0) {
      return Math.max(0, ((2501 - 2.326 * Twb) * ws - 1.006 * (Tc - Twb)) / (2501 + 1.86 * Tc - 4.186 * Twb));
    }
    return Math.max(0, ((2830 - 0.24 * Twb) * ws - 1.006 * (Tc - Twb)) / (2830 + 1.86 * Tc - 2.1 * Twb));
  }

  function wFromTdp(Tdp, pPa) {
    if (typeof Psy?.w_from_Tdp === 'function') return Psy.w_from_Tdp(Tdp, pPa);
    return wFromPv(Math.min(pwsPa(Tdp), pPa * 0.999), pPa);
  }

  function invBaroAltM(pPa) {
    if (typeof Psy?.invBaroAlt_m === 'function') return Psy.invBaroAlt_m(pPa);
    return (1 - Math.pow(pPa / 101325, 1 / 5.25588)) / 2.25577e-5;
  }

  function baroPaFromAlt(altM) {
    if (typeof Psy?.baroPa === 'function') return Psy.baroPa(altM);
    return 101325 * Math.pow(1 - 2.25577e-5 * altM, 5.25588);
  }

  function pToDisp(pPa, units) {
    return units === 'SI' ? pPa / 1000 : (pPa / 1000) / KPA_PER_PSI;
  }

  function qToDisp(qKw, units) {
    return units === 'SI' ? qKw : qKw * BTUH_PER_KW;
  }

  function waterToDisp(kgH, units) {
    return units === 'SI' ? kgH : kgH * LB_PER_KG;
  }

  function altToDisp(altM, units) {
    return units === 'SI' ? altM : altM * FT_PER_M;
  }

  function tsatFromEnthalpySI(hTarget, pPa) {
    let lo = -60, hi = 85;
    for (let i = 0; i < 60; i++) {
      const m = 0.5 * (lo + hi);
      if (hSI(m, wsatAt(m, pPa)) > hTarget) hi = m; else lo = m;
    }
    return 0.5 * (lo + hi);
  }

  function tsatFromSpecVolSI(vTarget, pPa) {
    let lo = -60, hi = 85;
    for (let i = 0; i < 60; i++) {
      const m = 0.5 * (lo + hi);
      if (vSI(m, wsatAt(m, pPa), pPa) > vTarget) hi = m; else lo = m;
    }
    return 0.5 * (lo + hi);
  }

  /* --------------------------------------------------------------------------
     ISO 7730 / ASHRAE 55-2023 PMV/PPD & Mold Risk Adapter
     -------------------------------------------------------------------------- */
  function getComfortConfig(st) {
    const c = st.comfort || {};
    const mrtOff = Number.isFinite(c.mrtOffset) ? c.mrtOffset : (Number.isFinite(c.mrtOff) ? c.mrtOff : 0);
    return {
      mode: c.mode ?? st.comfortMode ?? st.comfortZone ?? 'both',
      standard: c.standard === 'iso7730' ? 'iso7730' : 'ashrae55',
      capHumidity: c.capHumidity !== false,
      cloSummer: Number.isFinite(c.cloSummer) ? c.cloSummer : 0.5,
      cloWinter: Number.isFinite(c.cloWinter) ? c.cloWinter : 1.0,
      met: Number.isFinite(c.met) ? c.met : 1.1,
      vAir: Number.isFinite(c.vAir) ? c.vAir : 0.1,
      mrtOff,
      mrtOffset: mrtOff,
      pmvLimit: Number.isFinite(c.pmvLimit) ? c.pmvLimit : 0.5,
      givoni: !!(st.layers?.givoni || c.givoni),
      datacenter: !!(st.layers?.datacenter || c.datacenter)
    };
  }

  function formatComfortMetaSummary(cfg, units) {
    const isIP = units === 'IP';
    const stdLbl = cfg.standard === 'iso7730' ? 'ISO 7730' : 'ASHRAE 55-2023';
    const vDisp = isIP
      ? `${Math.round(cfg.vAir * FPM_PER_MPS)} fpm`
      : `${cfg.vAir.toFixed(2)} m/s`;
    const mrtVal = isIP ? cfg.mrtOffset * 1.8 : cfg.mrtOffset;
    const mrtDisp = Math.abs(mrtVal) > 0.05
      ? ` · MRT ${mrtVal >= 0 ? '+' : ''}${mrtVal.toFixed(1)} ${isIP ? '°F' : '°C'}`
      : '';
    const capDisp = cfg.capHumidity === false
      ? ' · Uncapped W'
      : ` · W ≤ ${isIP ? '84 gr/lb' : '12 g/kg'}`;
    const cloSum = Comfort.fmtClo(cfg.cloSummer);
    const cloWin = Comfort.fmtClo(cfg.cloWinter);
    return `${stdLbl} · Summer ${cloSum} clo · Winter ${cloWin} clo · ${cfg.met.toFixed(1)} met · v = ${vDisp}${mrtDisp} · PMV ±${cfg.pmvLimit.toFixed(2)}${capDisp}`;
  }

  function mapMoldRisk(m) {
    const levelMap = {
      condensation: { level: 'Condensation', color: '#dc2626' },
      high: { level: 'High', color: '#dc2626' },
      moderate: { level: 'Moderate', color: '#d97706' },
      none: { level: 'Low', color: '#059669' }
    };
    const mapped = levelMap[m?.riskLevel] || { level: m?.riskLevel || 'Low', color: '#059669' };
    return {
      level: mapped.level,
      color: mapped.color,
      detail: m?.label || '',
      surfaceRH: m?.surfaceRH,
      marginC: m?.marginC
    };
  }

  function assessMoldRisk(Tdb, w, pPa) {
    return mapMoldRisk(Comfort.calcMoldCondensationRisk(Tdb, w, pPa));
  }

  function computePMVZonePolygon(pPa, cfg = {}) {
    const poly = Comfort.generateASHRAE55Polygon(pPa, {
      clo: cfg.clo ?? 0.5,
      met: cfg.met ?? 1.1,
      vAir: cfg.vAir ?? 0.1,
      mrtOffset: cfg.mrtOffset ?? cfg.mrtOff ?? 0,
      pmvLimit: cfg.pmvLimit ?? 0.5,
      standard: cfg.standard ?? 'ashrae55',
      capHumidity: cfg.capHumidity !== false
    });
    return Array.isArray(poly) ? poly.map(pt => Array.isArray(pt) ? pt : [pt.T, pt.w]) : [];
  }

  function getGivoniZones(pPa) {
    return Comfort.getGivoniZones(pPa) || [];
  }

  function getDataCenterZones(pPa) {
    return Comfort.getDataCenterZones(pPa) || [];
  }

  /* --------------------------------------------------------------------------
     Resilient Process Resolution, Classification, Loads & Coil ADP Adapter
     -------------------------------------------------------------------------- */
  function resolveProcess(proc, points, idx) {
    let a = null, b = null;
    let flow = 0, flowUnit = null, curved = false, id = `S${idx + 1}`, customLabel = '';

    if (Array.isArray(proc)) {
      a = points[proc[0]] || null;
      b = points[proc[1]] || null;
    } else if (proc && typeof proc === 'object') {
      const findPt = (val) => {
        if (val == null) return null;
        if (typeof val === 'object' && Number.isFinite(val.T)) return val;
        const byId = points.find(p => p.id === val);
        if (byId) return byId;
        if (typeof val === 'number' && points[val]) return points[val];
        return null;
      };
      if (proc.fromId != null || proc.toId != null) {
        a = findPt(proc.fromId);
        b = findPt(proc.toId);
      } else if (proc.aId != null || proc.bId != null) {
        a = findPt(proc.aId);
        b = findPt(proc.bId);
      } else if (proc.startId != null || proc.endId != null) {
        a = findPt(proc.startId);
        b = findPt(proc.endId);
      } else if (proc.aIdx != null || proc.bIdx != null) {
        a = points[proc.aIdx] || null;
        b = points[proc.bIdx] || null;
      } else if (proc.from != null || proc.to != null) {
        a = findPt(proc.from);
        b = findPt(proc.to);
      }
      flow = Number.isFinite(proc.flowVal) ? proc.flowVal : (Number.isFinite(proc.flow) ? proc.flow : 0);
      flowUnit = proc.flowUnit || proc.unit || null;
      curved = !!(proc.showCurve || proc.curved || proc.isCurved || proc.coilCurve);
      id = proc.code || proc.tag || `S${idx + 1}`;
      customLabel = proc.label || proc.name || '';
    }
    return { a, b, flow, flowUnit, curved, id, customLabel, raw: proc };
  }

  function classifyProcessAdapter(a, b, pPa) {
    try {
      const fn = HVAC?.classifyProcess || HVAC?.processType;
      if (typeof fn === 'function') {
        const res = fn(a, b, pPa);
        if (res && (res.name || res.type || res.label)) {
          const cls = res.cls || res.key || res.category || 'neutral';
          return {
            name: res.name || res.type || res.label,
            cls,
            color: res.color || PROC_COLOR_MAP[cls] || PROC_COLOR_MAP.neutral
          };
        }
      }
    } catch (_) { /* fallback below */ }

    const dT = b.T - a.T;
    const dW = b.w - a.w;
    const epsT = 0.05;
    const epsW = 0.0001;
    if (Math.abs(dW) <= epsW && dT > epsT) return { name: 'Sensible Heating', cls: 'heat', color: PROC_COLOR_MAP.heat };
    if (Math.abs(dW) <= epsW && dT < -epsT) return { name: 'Sensible Cooling', cls: 'cool', color: PROC_COLOR_MAP.cool };
    if (dT < -epsT && dW < -epsW) return { name: 'Cooling & Dehumidification', cls: 'cool', color: PROC_COLOR_MAP.cool };
    if (dT > epsT && dW > epsW) return { name: 'Heating & Humidification', cls: 'heat', color: PROC_COLOR_MAP.heat };
    if (Math.abs(dT) <= epsT && dW > epsW) return { name: 'Isothermal Humidification', cls: 'humid', color: PROC_COLOR_MAP.humid };
    if (Math.abs(dT) <= epsT && dW < -epsW) return { name: 'Chemical Dehumidification', cls: 'dehum', color: PROC_COLOR_MAP.dehum };
    if (dT < -epsT && dW > epsW) {
      const dh = Math.abs(hSI(b.T, b.w) - hSI(a.T, a.w));
      if (dh < 2.0) return { name: 'Evaporative Cooling', cls: 'evap', color: PROC_COLOR_MAP.evap };
      return { name: 'Cooling & Humidification', cls: 'cool', color: PROC_COLOR_MAP.cool };
    }
    if (dT > epsT && dW < -epsW) {
      const dh = Math.abs(hSI(b.T, b.w) - hSI(a.T, a.w));
      if (dh < 2.5) return { name: 'Desiccant Dehumidification', cls: 'desiccant', color: PROC_COLOR_MAP.desiccant };
      return { name: 'Heating & Dehumidification', cls: 'dehum', color: PROC_COLOR_MAP.dehum };
    }
    return { name: 'Iso-State Process', cls: 'neutral', color: PROC_COLOR_MAP.neutral };
  }

  function flowToMassKgS(flowVal, flowUnit, T, w, pPa) {
    const v = Number(flowVal) || 0;
    if (v <= 0) return 0;
    if (typeof Psy?.flowToMassKgps === 'function') {
      try {
        const m = Psy.flowToMassKgps(v, flowUnit, T, w, pPa);
        if (Number.isFinite(m) && m > 0) return m;
      } catch (_) { /* fallback below */ }
    }
    const spVol = vSI(T, w, pPa);
    const u = String(flowUnit || 'L/s').toLowerCase().replace(/\s+/g, '');
    if (u === 'kg/s' || u === 'kgps' || u === 'kgs') return v;
    if (u === 'l/s' || u === 'lps') return (v / 1000) / spVol;
    if (u === 'm3/s' || u === 'm³/s' || u === 'm3ps') return v / spVol;
    if (u === 'm3/h' || u === 'm³/h' || u === 'm3ph' || u === 'cmh') return (v / 3600) / spVol;
    if (u === 'cfm' || u === 'ft3/min' || u === 'ft³/min') return (v * 0.00047194745) / spVol;
    if (u === 'lb/s' || u === 'lbps' || u === 'lbs') return v * 0.45359237;
    if (u === 'lb/h' || u === 'lbph') return (v * 0.45359237) / 3600;
    return (v / 1000) / spVol;
  }

  function computeProcessLoads(a, b, flowVal, flowUnit, pPa, fallbackUnits = 'SI') {
    const effectiveUnit = flowUnit || (fallbackUnits === 'SI' ? 'Lps' : 'cfm');
    const dT = b.T - a.T;
    const dW = b.w - a.w;
    const hA = hSI(a.T, a.w);
    const hB = hSI(b.T, b.w);
    const dh = hB - hA;

    // Call canonical HVAC.calcProcessMetrics(a, b, pPa, flowVal, flowUnit) first
    try {
      if (typeof HVAC?.calcProcessMetrics === 'function') {
        const res = HVAC.calcProcessMetrics(a, b, pPa, flowVal, effectiveUnit);
        if (res && Number.isFinite(res.Qt_kW)) {
          return {
            dT: res.dT,
            dW: res.dW,
            dh: res.dh,
            SHR: res.SHR,
            flowVal,
            flowUnit: effectiveUnit,
            massFlowKgS: res.mDa,
            Qs_kW: res.Qs_kW,
            Ql_kW: res.Ql_kW,
            Qt_kW: res.Qt_kW,
            tonsTR: res.Qt_TR,
            waterKgH: res.waterRate_kgh
          };
        }
      }
    } catch (_) { /* fallback below */ }

    const massFlowKgS = flowToMassKgS(flowVal, effectiveUnit, a.T, a.w, pPa);
    // Exact ASHRAE split: dh_sens = h(Tb, Wa) - h(Ta, Wa), dh_lat = h(Tb, Wb) - h(Tb, Wa)
    const dhSens = hSI(b.T, a.w) - hA;
    const dhLat = hB - hSI(b.T, a.w);
    const Qt_kW = massFlowKgS * dh;
    const Qs_kW = massFlowKgS * dhSens;
    const Ql_kW = massFlowKgS * dhLat;
    const SHR = Math.abs(dh) > 1e-6 ? dhSens / dh : NaN;
    const tonsTR = Qt_kW / KW_PER_TR;
    const waterKgH = massFlowKgS * dW * 3600;

    return {
      dT, dW, dh, SHR,
      flowVal, flowUnit: effectiveUnit, massFlowKgS,
      Qs_kW, Ql_kW, Qt_kW, tonsTR, waterKgH
    };
  }

  function computeCoilADP(a, b, pPa) {
    if (!(b.T < a.T - 0.1)) return null;
    try {
      if (typeof HVAC?.calcADP === 'function') {
        const r = HVAC.calcADP(a, b, pPa);
        if (r && r.valid && Number.isFinite(r.T_adp)) {
          return {
            Tadp: r.T_adp,
            Wadp: Number.isFinite(r.w_adp) ? r.w_adp : wsatAt(r.T_adp, pPa),
            BPF: r.BPF,
            CF: r.CF,
            coilCurvePts: Array.isArray(r.coilCurvePts) ? r.coilCurvePts : []
          };
        }
        if (r && r.valid === false) return null;
      }
    } catch (_) { /* fallback below */ }

    const slope = (b.w - a.w) / (b.T - a.T);
    const f = (T) => (a.w + slope * (T - a.T)) - wsatAt(T, pPa);
    if (f(b.T) > 0) return null;
    let hi = b.T;
    let lo = b.T - 5;
    while (lo > -50 && f(lo) < 0) lo -= 5;
    if (f(lo) < 0) return null;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) > 0) lo = mid; else hi = mid;
    }
    const Tadp = 0.5 * (lo + hi);
    const Wadp = wsatAt(Tadp, pPa);
    const BPF = (b.T - Tadp) / (a.T - Tadp);
    if (!Number.isFinite(BPF) || BPF < 0 || BPF > 1) return null;
    return { Tadp, Wadp, BPF, CF: 1 - BPF, coilCurvePts: [] };
  }

  /* --------------------------------------------------------------------------
     Unified Engineering Dataset Extractor (used by CSV, HTML, DOCX, SVG)
     -------------------------------------------------------------------------- */
  function extractProjectData(store) {
    const st = getState(store);
    const units = st.units === 'IP' ? 'IP' : 'SI';
    const U = UNIT_LABELS[units];
    const pPa = Number.isFinite(st.pPa) ? st.pPa : 101325;
    const altM = Number.isFinite(st.altM) ? st.altM : (Number.isFinite(st.altitudeM) ? st.altitudeM : invBaroAltM(pPa));

    const domVal = (id) => (hasDOM() ? (CoreDOM.byId(id)?.value || '') : '');
    const meta = {
      name: st.meta?.name || st.projectName || domVal('projName') || 'Psychrometric Analysis',
      version: st.meta?.version || st.projectVer || domVal('projVer') || 'v1.0',
      company: st.meta?.company || st.company || domVal('companyName') || '',
      engineer: st.meta?.engineer || st.engineer || domVal('engineerName') || '',
      notes: st.meta?.notes || st.notes || ''
    };

    const view = {
      tMin: Number.isFinite(st.view?.tMin) ? st.view.tMin : (Number.isFinite(st.tMin) ? st.tMin : -10),
      tMax: Number.isFinite(st.view?.tMax) ? st.view.tMax : (Number.isFinite(st.tMax) ? st.tMax : 55),
      wMax: Number.isFinite(st.view?.wMax) ? st.view.wMax : (Number.isFinite(st.wMax) ? st.wMax : 0.030)
    };

    const comfortCfg = getComfortConfig(st);
    const pointsRaw = Array.isArray(st.points) ? st.points : [];
    const processesRaw = Array.isArray(st.processes) ? st.processes : [];
    const defaultFlow = Number.isFinite(st.defaultFlow)
      ? st.defaultFlow
      : (hasDOM() ? (parseFloat(CoreDOM.byId('flowVal')?.value) || 0) : 0);
    const defaultFlowUnit = st.defaultFlowUnit
      || (hasDOM() ? CoreDOM.byId('flowUnit')?.value : null)
      || (units === 'SI' ? 'L/s' : 'CFM');

    const points = pointsRaw.map((p, i) => {
      const T = Number(p.T) || 0;
      const w = Math.max(0, Number(p.w) || 0);
      const rhPct = rhFrac(T, w, pPa) * 100;
      const pvPa = pvFromW(w, pPa);
      const twbC = twbFromTw(T, w, pPa);
      const tdpC = tdpFromTw(T, w, pPa);
      const h_si = hSI(T, w);
      const h_disp = hToDisp(T, w, units);
      const v_si = vSI(T, w, pPa);
      const v_disp = vToDisp(v_si, units);
      const rho_si = rhoMoistSI(T, w, pPa);
      const rho_disp = rhoToDisp(rho_si, units);

      const ev = Comfort.evaluateActiveComfort(T, w, pPa, comfortCfg);
      const mold = mapMoldRisk(ev.mold);

      let mixNote = '';
      if (p.derived && p.derived.type === 'mix') {
        if (Array.isArray(p.derived.streams) && p.derived.streams.length >= 2) {
          const names = p.derived.streams
            .map(s => pointsRaw.find(q => q.id === (s?.id ?? s?.ptId ?? s?.pointId))?.label)
            .filter(Boolean);
          if (names.length >= 2) mixNote = `Mix: ${names.join(' + ')}`;
        } else {
          const pA = pointsRaw.find(q => q.id === p.derived.aId);
          const pB = pointsRaw.find(q => q.id === p.derived.bId);
          if (pA && pB) mixNote = `Mix: ${pA.label} + ${pB.label}`;
        }
      }

      return {
        idx: i + 1,
        id: p.id ?? (i + 1),
        label: p.label || `P${i + 1}`,
        color: p.color || '#f43f5e',
        locked: !!p.locked,
        note: p.note || mixNote || '',
        mixNote,
        T, w,
        TdbDisp: CoreDOM.tToDisp(T, units),
        WDisp: CoreDOM.wToDisp(w, units),
        rhPct,
        TwbC: twbC,
        TwbDisp: CoreDOM.tToDisp(twbC, units),
        TdpC: tdpC,
        TdpDisp: CoreDOM.tToDisp(tdpC, units),
        hSI: h_si,
        hDisp: h_disp,
        vSI: v_si,
        vDisp: v_disp,
        rhoSI: rho_si,
        rhoDisp: rho_disp,
        pvPa,
        pvDisp: pToDisp(pvPa, units),
        pmv: ev.pmv,
        ppd: ev.ppd,
        sensation: ev.sensation,
        comfortReason: ev.reason,
        comfortSeason: ev.season,
        comfortSeasonTag: ev.seasonTag,
        inHumidityBand: ev.inHumidityBand,
        ce: ev.ce,
        set: ev.set,
        pmvSummer: ev.summer.pmv,
        ppdSummer: ev.summer.ppd,
        pmvWinter: ev.winter.pmv,
        ppdWinter: ev.winter.ppd,
        compliant: ev.compliant,
        dataCenterClass: ev.dataCenterClass,
        givoniZones: ev.givoniZones,
        mold
      };
    });

    const processes = [];
    const coilAdpRows = [];
    let totCoolQt_kW = 0, totCoolQs_kW = 0, totCoolQl_kW = 0;
    let totHeatQt_kW = 0, totHeatQs_kW = 0, totHeatQl_kW = 0;
    let netMoistureKgH = 0, condensateKgH = 0, humidAddKgH = 0;

    processesRaw.forEach((rawProc, idx) => {
      const rp = resolveProcess(rawProc, pointsRaw, idx);
      if (!rp.a || !rp.b) return;
      const flowUsed = rp.flow > 0 ? rp.flow : defaultFlow;
      const flowUnitUsed = rp.flowUnit || defaultFlowUnit;
      const clsInfo = classifyProcessAdapter(rp.a, rp.b, pPa);
      const loads = computeProcessLoads(rp.a, rp.b, flowUsed, flowUnitUsed, pPa, units);
      const adp = (rp.b.T < rp.a.T - 0.1 && rp.b.w <= rp.a.w + 0.0002) ? computeCoilADP(rp.a, rp.b, pPa) : null;

      if (loads.Qt_kW < -1e-6) {
        totCoolQt_kW += Math.abs(loads.Qt_kW);
        totCoolQs_kW += Math.abs(Math.min(0, loads.Qs_kW));
        totCoolQl_kW += Math.abs(Math.min(0, loads.Ql_kW));
      } else if (loads.Qt_kW > 1e-6) {
        totHeatQt_kW += loads.Qt_kW;
        totHeatQs_kW += Math.max(0, loads.Qs_kW);
        totHeatQl_kW += Math.max(0, loads.Ql_kW);
      }
      netMoistureKgH += loads.waterKgH;
      if (loads.waterKgH < 0) condensateKgH += Math.abs(loads.waterKgH);
      if (loads.waterKgH > 0) humidAddKgH += loads.waterKgH;

      const row = {
        idx: idx + 1,
        id: rp.id,
        aPt: rp.a,
        bPt: rp.b,
        fromLabel: rp.a.label || 'A',
        toLabel: rp.b.label || 'B',
        path: `${rp.a.label || 'A'} → ${rp.b.label || 'B'}`,
        classification: clsInfo.name,
        cls: clsInfo.cls,
        color: clsInfo.color,
        curved: rp.curved,
        flowVal: flowUsed,
        flowUnit: flowUnitUsed,
        flowDisplay: flowUsed > 0 ? `${fmtNum(flowUsed, 1)} ${flowUnitUsed}` : '—',
        massFlowKgS: loads.massFlowKgS,
        dT_SI: loads.dT,
        dTDisp: units === 'SI' ? loads.dT : loads.dT * 1.8,
        dW_SI: loads.dW,
        dWDisp: CoreDOM.wToDisp(loads.dW, units),
        dh_SI: loads.dh,
        dhDisp: dhToDisp(loads.dh, units),
        SHR: loads.SHR,
        Qs_kW: loads.Qs_kW,
        Ql_kW: loads.Ql_kW,
        Qt_kW: loads.Qt_kW,
        QsDisp: qToDisp(loads.Qs_kW, units),
        QlDisp: qToDisp(loads.Ql_kW, units),
        QtDisp: qToDisp(loads.Qt_kW, units),
        tonsTR: loads.tonsTR,
        waterKgH: loads.waterKgH,
        waterDisp: waterToDisp(loads.waterKgH, units),
        adp,
        raw: rp.raw
      };
      processes.push(row);

      if (adp) {
        coilAdpRows.push({
          id: row.id,
          path: row.path,
          enteringT: CoreDOM.tToDisp(rp.a.T, units),
          enteringRH: rhFrac(rp.a.T, rp.a.w, pPa) * 100,
          leavingT: CoreDOM.tToDisp(rp.b.T, units),
          leavingRH: rhFrac(rp.b.T, rp.b.w, pPa) * 100,
          adpTDisp: CoreDOM.tToDisp(adp.Tadp, units),
          adpWDisp: CoreDOM.wToDisp(adp.Wadp, units),
          BPF: adp.BPF,
          CF: adp.CF,
          SHR: loads.SHR,
          condensateDisp: waterToDisp(Math.max(0, -loads.waterKgH), units)
        });
      }
    });

    const summary = {
      totCoolQt_kW,
      totCoolQs_kW,
      totCoolQl_kW,
      totCoolTR: totCoolQt_kW / KW_PER_TR,
      totCoolDisp: qToDisp(totCoolQt_kW, units),
      totCoolQsDisp: qToDisp(totCoolQs_kW, units),
      totCoolQlDisp: qToDisp(totCoolQl_kW, units),
      totHeatQt_kW,
      totHeatQs_kW,
      totHeatQl_kW,
      totHeatDisp: qToDisp(totHeatQt_kW, units),
      totHeatQsDisp: qToDisp(totHeatQs_kW, units),
      totHeatQlDisp: qToDisp(totHeatQl_kW, units),
      netQt_kW: totHeatQt_kW - totCoolQt_kW,
      netQtDisp: qToDisp(totHeatQt_kW - totCoolQt_kW, units),
      netMoistureKgH,
      netMoistureDisp: waterToDisp(netMoistureKgH, units),
      condensateKgH,
      condensateDisp: waterToDisp(condensateKgH, units),
      humidAddKgH,
      humidAddDisp: waterToDisp(humidAddKgH, units),
      compliantCount: points.filter(p => p.compliant).length,
      compliantPct: points.length ? (points.filter(p => p.compliant).length / points.length) * 100 : 0
    };

    const weatherSummary = extractWeatherSummary(st.weather, pPa, units, comfortCfg);

    return {
      state: st,
      meta,
      units,
      U,
      pPa,
      pressureDisp: pToDisp(pPa, units),
      pressureKPa: pPa / 1000,
      pressurePsia: (pPa / 1000) / KPA_PER_PSI,
      altM,
      altDisp: altToDisp(altM, units),
      view,
      comfortCfg,
      points,
      processes,
      coilAdpRows,
      summary,
      weather: weatherSummary,
      generatedAt: new Date()
    };
  }

  function extractWeatherSummary(weather, pPa, units, comfortCfg) {
    if (!weather) return null;
    const hours = Array.isArray(weather.records)
      ? weather.records
      : (Array.isArray(weather.hours) ? weather.hours
        : (Array.isArray(weather.data) ? weather.data : null));

    const preStats = weather.bins || weather.stats || weather.summary || weather.analytics || null;
    if (!hours?.length && !preStats) return null;

    const location = weather.sourceName || weather.city || weather.name || weather.location || weather.station || 'Loaded Weather Dataset';
    const totalHours = hours?.length || preStats?.totalHours || preStats?.hours || 0;

    if (hours && hours.length > 0) {
      let minT = Infinity, maxT = -Infinity, sumT = 0;
      let sumW = 0;
      const binSize = 5; // 5°C dry-bulb bins
      const binMap = new Map();
      const normalized = [];

      for (const rec of hours) {
        const T = Number(rec.T ?? rec.Tdb ?? rec.tdb ?? rec.temp);
        if (!Number.isFinite(T)) continue;
        let w = Number(rec.w ?? rec.W);
        if (!Number.isFinite(w)) {
          const rh = Number(rec.rh ?? rec.RH ?? 50);
          w = wFromPv(Math.min(pPa * 0.999, pwsPa(T) * CoreDOM.clamp(rh / 100, 0, 1)), pPa);
        }
        normalized.push({ T, w });
        const h = hSI(T, w);
        if (T < minT) minT = T;
        if (T > maxT) maxT = T;
        sumT += T;
        sumW += w;

        const bLo = Math.floor(T / binSize) * binSize;
        let bin = binMap.get(bLo);
        if (!bin) {
          bin = { tLoC: bLo, tHiC: bLo + binSize, hours: 0, sumW: 0, sumH: 0 };
          binMap.set(bLo, bin);
        }
        bin.hours++;
        bin.sumW += w;
        bin.sumH += h;
      }

      const n = normalized.length || hours.length;
      const bins = Array.from(binMap.values())
        .sort((a, b) => a.tLoC - b.tLoC)
        .map(b => {
          const avgW = b.sumW / b.hours;
          const avgT = b.tLoC + binSize * 0.5;
          return {
            label: units === 'SI'
              ? `${b.tLoC.toFixed(0)} to ${b.tHiC.toFixed(0)} °C`
              : `${CoreDOM.cToF(b.tLoC).toFixed(0)} to ${CoreDOM.cToF(b.tHiC).toFixed(0)} °F`,
            hours: b.hours,
            pct: (b.hours / n) * 100,
            meanWDisp: CoreDOM.wToDisp(avgW, units),
            meanHDisp: hToDisp(avgT, avgW, units)
          };
        });

      const canonicalStats = (preStats && Number.isFinite(preStats.comfortHours) && Number.isFinite(preStats.humidHours))
        ? preStats
        : Weather.computePsychroBins(normalized, pPa, comfortCfg);

      const resolvedComfort = canonicalStats.comfortHours ?? 0;
      const resolvedCool = canonicalStats.coolHours ?? canonicalStats.coolingHours ?? 0;
      const resolvedHeat = canonicalStats.heatHours ?? canonicalStats.heatingHours ?? 0;
      const resolvedDehum = canonicalStats.dehumHours ?? 0;
      const resolvedHumid = canonicalStats.humidHours ?? 0;

      return {
        location,
        totalHours: n,
        minTDisp: CoreDOM.tToDisp(Number.isFinite(canonicalStats?.tMinObs) ? canonicalStats.tMinObs : minT, units),
        meanTDisp: CoreDOM.tToDisp(Number.isFinite(canonicalStats?.tMeanObs) ? canonicalStats.tMeanObs : (sumT / n), units),
        maxTDisp: CoreDOM.tToDisp(Number.isFinite(canonicalStats?.tMaxObs) ? canonicalStats.tMaxObs : maxT, units),
        meanWDisp: CoreDOM.wToDisp(sumW / n, units),
        comfortHours: resolvedComfort,
        comfortPct: (resolvedComfort / n) * 100,
        coolingHours: resolvedCool,
        heatingHours: resolvedHeat,
        dehumHours: resolvedDehum,
        humidHours: resolvedHumid,
        economizerHours: canonicalStats?.economizerHours ?? 0,
        cdd: canonicalStats?.cdd ?? NaN,
        hdd: canonicalStats?.hdd ?? NaN,
        bins
      };
    }

    // Fallback when only precomputed Weather.computePsychroBins() summary exists
    const n = Math.max(1, totalHours);
    const minTC = preStats.tMinObs ?? preStats.minT;
    const meanTC = preStats.tMeanObs ?? preStats.meanT;
    const maxTC = preStats.tMaxObs ?? preStats.maxT;
    const comfortHours = preStats.comfortHours ?? 0;
    return {
      location,
      totalHours,
      minTDisp: Number.isFinite(minTC) ? CoreDOM.tToDisp(minTC, units) : NaN,
      meanTDisp: Number.isFinite(meanTC) ? CoreDOM.tToDisp(meanTC, units) : NaN,
      maxTDisp: Number.isFinite(maxTC) ? CoreDOM.tToDisp(maxTC, units) : NaN,
      meanWDisp: Number.isFinite(preStats.meanW) ? CoreDOM.wToDisp(preStats.meanW, units) : NaN,
      comfortHours,
      comfortPct: (comfortHours / n) * 100,
      coolingHours: preStats.coolHours ?? preStats.coolingHours ?? 0,
      heatingHours: preStats.heatHours ?? preStats.heatingHours ?? 0,
      dehumHours: preStats.dehumHours ?? 0,
      humidHours: preStats.humidHours ?? 0,
      economizerHours: preStats.economizerHours ?? 0,
      cdd: preStats.cdd ?? NaN,
      hdd: preStats.hdd ?? NaN,
      bins: Array.isArray(preStats.bins) ? preStats.bins : []
    };
  }

  /* --------------------------------------------------------------------------
     1. Composite HiDPI PNG Renderer
     -------------------------------------------------------------------------- */
  function computeBaseRendererExportPadding(W, H, scale, state, includeTitle, baseRenderer) {
    // Probe BaseRenderer._computePadding cleanly if available so overlay matches to 0.00px
    if (baseRenderer && typeof baseRenderer._computePadding === 'function') {
      const prev = {
        padL: baseRenderer.padL,
        padR: baseRenderer.padR,
        padT: baseRenderer.padT,
        padB: baseRenderer.padB
      };
      try {
        baseRenderer._computePadding(W, H, scale, state, includeTitle);
        return {
          padL: baseRenderer.padL,
          padR: baseRenderer.padR,
          padT: baseRenderer.padT,
          padB: baseRenderer.padB
        };
      } finally {
        baseRenderer.padL = prev.padL;
        baseRenderer.padR = prev.padR;
        baseRenderer.padT = prev.padT;
        baseRenderer.padB = prev.padB;
      }
    }
    // Exact mirror of BaseRenderer._computePadding formula
    const isIP = state?.units === 'IP';
    const rawL = Math.round((isIP ? 42 : 40) * scale);
    const rawR = Math.round((isIP ? 74 : 68) * scale);
    const rawT = Math.round((includeTitle ? 76 : 46) * scale);
    const rawB = Math.round(46 * scale);
    return {
      padL: Math.min(rawL, Math.floor(W * 0.16)),
      padR: Math.min(rawR, Math.floor(W * 0.22)),
      padT: Math.min(rawT, Math.floor(H * 0.22)),
      padB: Math.min(rawB, Math.floor(H * 0.20))
    };
  }

  function buildCoordAdapter(W, H, scale, state, layout = {}) {
    const view = {
      tMin: Number.isFinite(state.view?.tMin) ? state.view.tMin : (Number.isFinite(state.tMin) ? state.tMin : -10),
      tMax: Number.isFinite(state.view?.tMax) ? state.view.tMax : (Number.isFinite(state.tMax) ? state.tMax : 55),
      wMax: Number.isFinite(state.view?.wMax) ? state.view.wMax : (Number.isFinite(state.wMax) ? state.wMax : 0.030)
    };
    const tSpan = Math.max(0.5, view.tMax - view.tMin);
    const wMax = Math.max(0.001, view.wMax);

    const padL = Number.isFinite(layout.padL) ? layout.padL : Math.round(40 * scale);
    const padR = Number.isFinite(layout.padR) ? layout.padR : Math.round(68 * scale);
    const padT = Number.isFinite(layout.padT) ? layout.padT : Math.round(48 * scale);
    const padB = Number.isFinite(layout.padB) ? layout.padB : Math.round(46 * scale);
    const plotW = Math.max(10, W - padL - padR);
    const plotH = Math.max(10, H - padT - padB);

    const xc = typeof layout.xc === 'function' ? layout.xc : (T) => padL + ((T - view.tMin) / tSpan) * plotW;
    const yc = typeof layout.yc === 'function' ? layout.yc : (w) => (H - padB) - (w / wMax) * plotH;
    const invT = typeof layout.invT === 'function' ? layout.invT : (px) => view.tMin + ((px - padL) / plotW) * tSpan;
    const invW = typeof layout.invW === 'function' ? layout.invW : (py) => (((H - padB) - py) / plotH) * wMax;

    const adapter = {
      W, H,
      width: W, height: H,
      cssW: W / scale, cssH: H / scale,
      dpi: scale, scale,
      padL, padR, padT, padB,
      plotW, plotH,
      tMin: view.tMin, tMax: view.tMax, wMax,
      xc, yc, invT, invW,
      tToX: xc, wToY: yc, xToT: invT, yToW: invW,
      x: xc, y: yc,
      inPlot: (px, py) => px >= padL && px <= padL + plotW && py >= padT && py <= padT + plotH,
      getPadding: () => ({ padL, padR, padT, padB }),
      getPlotRect: () => ({ x: padL, y: padT, w: plotW, h: plotH, width: plotW, height: plotH }),
      getCoords: () => adapter,
      getLayout: () => adapter
    };
    return adapter;
  }

  function renderCompositePNG(store, baseRenderer, overlayRenderer, opts = {}) {
    if (!hasDOM()) {
      throw new Error('renderCompositePNG requires a browser DOM canvas environment');
    }
    const scale = Math.max(1, Number(opts.scale) || 2);
    const width = Math.max(400, Number(opts.width) || 1600);
    const height = Math.max(300, Number(opts.height) || 1000);
    const includeTitle = opts.includeTitle !== false;
    const W = Math.round(width * scale);
    const H = Math.round(height * scale);

    const state = getState(store);
    const data = extractProjectData(store);
    const palette = CoreDOM.resolveThemePalette(state.theme || 'studio-dark', state.customTheme);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Snapshot any mutable live layout fields on baseRenderer so export NEVER disturbs live canvas
    const savedBaseProps = {};
    const trackedKeys = ['W', 'H', 'width', 'height', 'dpi', 'scale', 'padL', 'padR', 'padT', 'padB', '_lastState'];
    if (baseRenderer && typeof baseRenderer === 'object') {
      for (const k of trackedKeys) {
        if (Object.prototype.hasOwnProperty.call(baseRenderer, k)) {
          savedBaseProps[k] = baseRenderer[k];
        }
      }
    }

    let usedBaseRenderer = false;
    let baseResult = null;
    try {
      // Determine exact export padding matching BaseRenderer._computePadding before rendering
      const exportPadding = computeBaseRendererExportPadding(W, H, scale, state, includeTitle, baseRenderer);

      if (baseRenderer && typeof baseRenderer.renderToContext === 'function') {
        baseResult = baseRenderer.renderToContext(ctx, W, H, scale, state, { isExport: true, includeTitle });
        usedBaseRenderer = true;
      } else {
        ctx.fillStyle = palette.bg;
        ctx.fillRect(0, 0, W, H);
      }

      const detectedLayout = (baseResult && typeof baseResult === 'object') ? baseResult : exportPadding;
      const tempCoordAdapter = buildCoordAdapter(W, H, scale, state, detectedLayout);

      if (overlayRenderer && typeof overlayRenderer.renderToContext === 'function') {
        overlayRenderer.renderToContext(ctx, tempCoordAdapter, state, { isExport: true });
      }

      const dateStr = data.generatedAt.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      });

      if (usedBaseRenderer) {
        // BaseRenderer.renderToContext({ isExport: true, includeTitle }) already renders the
        // right-side rotated Y-axis label and top-left title/barometric block. Add crisp
        // non-overlapping top-right Date & Version stamp when includeTitle is enabled.
        if (includeTitle) {
          const rightEdge = tempCoordAdapter.padL + tempCoordAdapter.plotW;
          ctx.save();
          ctx.textAlign = 'right';
          ctx.textBaseline = 'alphabetic';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.round(3 * scale);
          ctx.strokeStyle = palette.halo || palette.bg;

          const topRight = `${dateStr}  •  PsychroChart Ultra v${APP_VERSION}`;
          ctx.font = `600 ${Math.round(10 * scale)}px 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.strokeText(topRight, rightEdge, Math.round(18 * scale));
          ctx.fillStyle = palette.fg;
          ctx.fillText(topRight, rightEdge, Math.round(18 * scale));

          const subRight = data.units === 'SI'
            ? `${data.points.length} pts  •  ${data.processes.length} procs  •  SI`
            : `${data.points.length} pts  •  ${data.processes.length} procs  •  IP`;
          ctx.font = `500 ${Math.round(9 * scale)}px 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.strokeText(subRight, rightEdge, Math.round(33 * scale));
          ctx.fillStyle = palette.muted;
          ctx.fillText(subRight, rightEdge, Math.round(33 * scale));
          ctx.restore();
        }
      } else {
        // Fallback path when no baseRenderer was passed: draw full Y-axis label + title block
        const yAxisText = data.units === 'SI'
          ? 'Humidity Ratio — g Water Vapour / kg Dry Air'
          : 'Humidity Ratio — Grains of Moisture / lb Dry Air';
        ctx.save();
        ctx.font = `600 ${Math.round(11 * scale)}px system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(W - Math.round(13 * scale), Math.round(tempCoordAdapter.padT + tempCoordAdapter.plotH * 0.5));
        ctx.rotate(-Math.PI / 2);
        ctx.lineWidth = Math.max(2, Math.round(3.5 * scale));
        ctx.lineJoin = 'round';
        ctx.strokeStyle = palette.halo || palette.bg;
        ctx.strokeText(yAxisText, 0, 0);
        ctx.fillStyle = palette.fg;
        ctx.fillText(yAxisText, 0, 0);
        ctx.restore();

        if (includeTitle) {
          const padL = tempCoordAdapter.padL;
          const rightEdge = W - tempCoordAdapter.padR;
          const titleLeft = `${data.meta.name}${data.meta.version ? ' · ' + data.meta.version : ''}`;
          const stampRight = data.units === 'SI'
            ? `P = ${data.pressureKPa.toFixed(2)} kPa · Alt = ${Math.round(data.altM)} m · SI · ${dateStr}`
            : `P = ${data.pressurePsia.toFixed(2)} psia · Alt = ${Math.round(data.altDisp)} ft · IP · ${dateStr}`;
          ctx.save();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.font = `700 ${Math.round(14 * scale)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
          ctx.fillStyle = palette.fg;
          ctx.fillText(titleLeft, padL, Math.round(10 * scale));
          ctx.textAlign = 'right';
          ctx.font = `600 ${Math.round(10.5 * scale)}px 'JetBrains Mono', ui-monospace, monospace`;
          ctx.fillText(stampRight, rightEdge, Math.round(12 * scale));
          ctx.restore();
        }
      }
    } finally {
      if (baseRenderer && typeof baseRenderer === 'object') {
        for (const k of Object.keys(savedBaseProps)) {
          baseRenderer[k] = savedBaseProps[k];
        }
      }
    }

    const dataUrl = canvas.toDataURL('image/png');
    return { dataUrl, canvas };
  }

  /* --------------------------------------------------------------------------
     2. PNG Download & Clipboard Copy
     -------------------------------------------------------------------------- */
  function exportPNG(store, baseRenderer, overlayRenderer, scale = 2) {
    const data = extractProjectData(store);
    const { dataUrl, canvas } = renderCompositePNG(store, baseRenderer, overlayRenderer, {
      scale, width: 1600, height: 1000, includeTitle: true
    });
    const fname = `${sanitizeFilename(data.meta.name)}_${sanitizeFilename(data.meta.version, 'v1')}.png`;
    triggerDownload(dataUrl, fname, false);
    notifyToast(`PNG exported (${canvas.width}×${canvas.height}px)`, 'success');
    return { dataUrl, canvas, filename: fname };
  }

  async function copyPNG(store, baseRenderer, overlayRenderer) {
    if (!hasDOM() || !navigator?.clipboard || typeof ClipboardItem === 'undefined') {
      notifyToast('Clipboard image copy is not supported in this browser', 'error');
      return false;
    }
    try {
      const { canvas, dataUrl } = renderCompositePNG(store, baseRenderer, overlayRenderer, {
        scale: 2, width: 1600, height: 1000, includeTitle: true
      });
      const blob = await new Promise((resolve, reject) => {
        if (typeof canvas.toBlob === 'function') {
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')), 'image/png');
        } else {
          const bin = atob(dataUrl.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: 'image/png' }));
        }
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notifyToast('HiDPI chart PNG copied to clipboard', 'success');
      return true;
    } catch (err) {
      notifyToast(`Failed to copy PNG: ${err?.message || err}`, 'error');
      return false;
    }
  }

  /* --------------------------------------------------------------------------
     3. True Publication-Grade Vector SVG Generator (Pure XML, Node + Browser)
     -------------------------------------------------------------------------- */
  function svgDashAttr(style) {
    if (style === 'dashed') return ' stroke-dasharray="6,4"';
    if (style === 'dotted') return ' stroke-dasharray="2,3"';
    if (style === 'dashdot') return ' stroke-dasharray="7 3 1.5 3"';
    return '';
  }

  function niceGridSteps(tMin, tMax, wMaxKgKg, units) {
    const tMinDisp = CoreDOM.tToDisp(tMin, units);
    const tMaxDisp = CoreDOM.tToDisp(tMax, units);
    const tSpanDisp = Math.max(1, tMaxDisp - tMinDisp);
    let majT, minT;
    if (units === 'SI') {
      if (tSpanDisp <= 18) { majT = 2; minT = 0.5; }
      else if (tSpanDisp <= 40) { majT = 5; minT = 1; }
      else if (tSpanDisp <= 85) { majT = 5; minT = 1; }
      else { majT = 10; minT = 2; }
    } else {
      if (tSpanDisp <= 35) { majT = 5; minT = 1; }
      else if (tSpanDisp <= 140) { majT = 10; minT = 2; }
      else { majT = 20; minT = 5; }
    }

    const wMaxDisp = CoreDOM.wToDisp(wMaxKgKg, units);
    let majW, minW;
    if (units === 'SI') {
      if (wMaxDisp <= 12) { majW = 2; minW = 0.5; }
      else if (wMaxDisp <= 42) { majW = 5; minW = 1; }
      else { majW = 10; minW = 2; }
    } else {
      if (wMaxDisp <= 90) { majW = 10; minW = 2; }
      else if (wMaxDisp <= 260) { majW = 20; minW = 5; }
      else if (wMaxDisp <= 550) { majW = 50; minW = 10; }
      else { majW = 100; minW = 20; }
    }
    return { tMinDisp, tMaxDisp, wMaxDisp, majT, minT, majW, minW };
  }

  function svgPathFromPts(pts) {
    let d = '';
    let penDown = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        penDown = false;
        continue;
      }
      d += (penDown ? ' L' : 'M') + p[0].toFixed(2) + ',' + p[1].toFixed(2);
      penDown = true;
    }
    return d;
  }

  function buildSVGString(store, width = 1280, height = 800) {
    const data = extractProjectData(store);
    const st = data.state;
    const units = data.units;
    const pPa = data.pPa;
    const palette = CoreDOM.resolveThemePalette(st.theme || 'studio-dark', st.customTheme);
    const layers = st.layers || {};
    const layerOn = (k, def = true) => (layers[k] === undefined ? def : !!layers[k]);

    const mergeStyle = (defaults, palObj, stObj) => {
      const out = { ...defaults };
      const apply = (src) => {
        if (!src || typeof src !== 'object') return;
        for (const k of Object.keys(out)) {
          if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
        }
      };
      apply(palObj);
      apply(stObj);
      return out;
    };

    const ax = mergeStyle(
      {
        frame: 'full-box',
        tickDir: 'out',
        yAxisSide: 'both',
        showSubTicks: true,
        showDualPvScale: false
      },
      palette.axisStyle,
      st.axisStyle
    );

    const tr = mergeStyle(
      {
        arrowStyle: 'cad-chevron',
        lineWeight: 'standard',
        pointMarker: 'precision-ring',
        badgeStyle: 'detailed',
        showDecompLegs: false
      },
      palette.trendStyle,
      st.trendStyle
    );

    const arrowW = tr.lineWeight === 'fine'
      ? 1.75
      : (tr.lineWeight === 'bold' ? 3.4 : (Number.isFinite(palette.arrowW) ? palette.arrowW : 2.5));
    const ptR = Number.isFinite(palette.ptSize) ? palette.ptSize : 4.5;

    const padL = 86;
    const padR = ax.showDualPvScale ? (ax.yAxisSide === 'left' ? 92 : 134) : 76;
    const padT = 88;
    const padB = 68;
    const plotW = Math.max(40, width - padL - padR);
    const plotH = Math.max(40, height - padT - padB);
    const plotRight = padL + plotW;
    const plotBottom = padT + plotH;

    const tMin = data.view.tMin;
    const tMax = data.view.tMax;
    const tSpan = Math.max(0.5, tMax - tMin);
    const wMax = Math.max(0.001, data.view.wMax);

    const xc = (T) => padL + ((T - tMin) / tSpan) * plotW;
    const yc = (w) => plotBottom - (w / wMax) * plotH;

    const gridCfg = st.grid || st.display || {};
    const density = gridCfg.density || st.density || 'normal';
    const stepT = density === 'fine' ? 0.25 : (density === 'fast' ? 1.0 : 0.5);
    const rhStep = Math.max(5, Math.min(50, parseInt(gridCfg.rhStep ?? st.rhStep ?? 10, 10) || 10));
    const labelMode = gridCfg.labelMode || st.labelMode || 'mid';
    const labelPx = Math.max(8, Math.min(16, parseInt(gridCfg.labelPx ?? st.labelPx ?? palette.lblPx ?? 11, 10) || 11));
    const axisPx = Math.max(8, Math.min(16, parseInt(palette.axisPx ?? 10, 10) || 10));
    const showEnthRuler = (gridCfg.showEnthalpyRuler ?? gridCfg.enthRuler ?? st.enthRuler ?? st.showEnthalpyRuler) !== false;
    const haloColor = palette.halo || palette.bg;
    const haloW = Number.isFinite(palette.haloW) ? palette.haloW : 3;

    const esc = CoreDOM.esc;
    const f2 = (n) => Number.isFinite(n) ? n.toFixed(2) : '0';

    const resolveSvgProcColor = (pr) => {
      if (pr?.raw?.color) return pr.raw.color;
      if (pr?.cls && palette[pr.cls]) return palette[pr.cls];
      return pr?.color || '#2563eb';
    };

    // Collect distinct process arrow colors for SVG <marker> definitions matching tr.arrowStyle
    const arrowColors = new Map();
    const registerArrowColor = (hex) => {
      const clean = String(hex || '#2563eb').trim();
      const styleKey = String(tr.arrowStyle || 'cad-chevron').replace(/[^a-zA-Z0-9]/g, '');
      const id = `arrow-${styleKey}-${clean.replace(/[^a-zA-Z0-9]/g, '')}`;
      arrowColors.set(id, clean);
      return id;
    };
    data.processes.forEach(pr => registerArrowColor(resolveSvgProcColor(pr)));

    /* ---- <defs> ---- */
    const defsParts = [];
    defsParts.push(`<clipPath id="plot-clip"><rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}"/></clipPath>`);
    defsParts.push(`<style>
      .svg-mono { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .svg-sans { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
      .svg-halo { paint-order: stroke; stroke: ${esc(haloColor)}; stroke-width: ${f2(haloW)}px; stroke-linejoin: round; stroke-linecap: round; }
    </style>`);

    const weightHeadDelta = tr.lineWeight === 'bold' ? 1.5 : (tr.lineWeight === 'fine' ? -1.5 : 0);
    for (const [mId, col] of arrowColors.entries()) {
      if (tr.arrowStyle === 'solid-triangle') {
        const mW = 11 + weightHeadDelta;
        const mH = mW * 0.78;
        defsParts.push(
          `<marker id="${esc(mId)}" viewBox="0 0 12 10" refX="9.2" refY="5" markerUnits="userSpaceOnUse" ` +
          `markerWidth="${f2(mW)}" markerHeight="${f2(mH)}" orient="auto-start-reverse">` +
          `<path d="M0.8,1.0 L11.4,5 L0.8,9.0 Z" fill="${esc(col)}"/></marker>`
        );
      } else if (tr.arrowStyle === 'open-vector') {
        const mW = 11 + weightHeadDelta;
        const mH = mW * 0.95;
        const openSw = Math.max(1.5, arrowW * 0.85);
        defsParts.push(
          `<marker id="${esc(mId)}" viewBox="0 0 12 12" refX="10.2" refY="6" markerUnits="userSpaceOnUse" ` +
          `markerWidth="${f2(mW)}" markerHeight="${f2(mH)}" orient="auto-start-reverse">` +
          `<path d="M1.6,1.6 L10.2,6 L1.6,10.4" fill="none" stroke="${esc(col)}" stroke-width="${f2(openSw)}" ` +
          `stroke-linecap="round" stroke-linejoin="round"/></marker>`
        );
      } else {
        // Default: 'cad-chevron'
        const mW = 12.5 + weightHeadDelta;
        const mH = mW * 0.84;
        defsParts.push(
          `<marker id="${esc(mId)}" viewBox="0 0 12 10" refX="9.0" refY="5" markerUnits="userSpaceOnUse" ` +
          `markerWidth="${f2(mW)}" markerHeight="${f2(mH)}" orient="auto-start-reverse">` +
          `<path d="M0.6,0.8 L11.4,5 L0.6,9.2 L3.2,5 Z" fill="${esc(col)}"/></marker>`
        );
      }
    }

    /* ---- <g id="background"> ---- */
    const bgParts = [
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${esc(palette.bg)}"/>`,
      `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="${esc(palette.plotBg || palette.bg)}"/>`
    ];

    /* ---- <g id="grid"> ---- */
    const gridParts = [];
    const gs = niceGridSteps(tMin, tMax, wMax, units);

    if (layerOn('gridMinor', true)) {
      let dMin = '';
      const tStartMin = Math.ceil(gs.tMinDisp / gs.minT) * gs.minT;
      for (let tD = tStartMin; tD <= gs.tMaxDisp + 1e-6; tD += gs.minT) {
        const px = xc(CoreDOM.dispToT(tD, units));
        if (px >= padL - 0.5 && px <= plotRight + 0.5) {
          dMin += `M${f2(px)},${padT}V${plotBottom}`;
        }
      }
      for (let wD = 0; wD <= gs.wMaxDisp + 1e-6; wD += gs.minW) {
        const py = yc(CoreDOM.dispToW(wD, units));
        if (py >= padT - 0.5 && py <= plotBottom + 0.5) {
          dMin += `M${padL},${f2(py)}H${plotRight}`;
        }
      }
      if (dMin) {
        gridParts.push(
          `<path d="${dMin}" fill="none" stroke="${esc(palette.grid)}" stroke-width="${f2(palette.grid_lw || 0.7)}"${svgDashAttr(palette.ls?.grid)}/>`
        );
      }
    }

    if (layerOn('grid', true)) {
      let dMaj = '';
      const tStartMaj = Math.ceil(gs.tMinDisp / gs.majT) * gs.majT;
      for (let tD = tStartMaj; tD <= gs.tMaxDisp + 1e-6; tD += gs.majT) {
        const px = xc(CoreDOM.dispToT(tD, units));
        if (px >= padL - 0.5 && px <= plotRight + 0.5) {
          dMaj += `M${f2(px)},${padT}V${plotBottom}`;
        }
      }
      for (let wD = 0; wD <= gs.wMaxDisp + 1e-6; wD += gs.majW) {
        const py = yc(CoreDOM.dispToW(wD, units));
        if (py >= padT - 0.5 && py <= plotBottom + 0.5) {
          dMaj += `M${padL},${f2(py)}H${plotRight}`;
        }
      }
      if (dMaj) {
        gridParts.push(
          `<path d="${dMaj}" fill="none" stroke="${esc(palette.grid2)}" stroke-width="${f2(palette.grid2_lw || 1.0)}"${svgDashAttr(palette.ls?.grid2)}/>`
        );
      }
    }

    /* ---- <g id="weather-heatmap"> (8,760-hr Weather Density Bins & Scatter) ---- */
    const weatherParts = [];
    if (layerOn('weather', false) && st.weather) {
      const wObj = st.weather;
      const wMode = wObj.mode || 'heatmap';
      const wOp = CoreDOM.clamp(wObj.opacity ?? 0.65, 0.05, 1.0);
      const bins = wObj.bins || null;
      const b2d = bins ? (bins.bins2D || bins.grid || bins.cells || null) : null;
      const heatStops = [
        { t: 0.00, r: 6,   g: 182, b: 212 },
        { t: 0.35, r: 16,  g: 185, b: 129 },
        { t: 0.70, r: 245, g: 158, b: 11  },
        { t: 1.00, r: 225, g: 29,  b: 72  }
      ];
      const heatRgb = (normVal) => {
        const t = CoreDOM.clamp(normVal, 0, 1);
        let s0 = heatStops[0];
        let s1 = heatStops[heatStops.length - 1];
        for (let k = 0; k < heatStops.length - 1; k++) {
          if (t >= heatStops[k].t && t <= heatStops[k + 1].t) {
            s0 = heatStops[k];
            s1 = heatStops[k + 1];
            break;
          }
        }
        const frac = (s1.t - s0.t) > 1e-6 ? (t - s0.t) / (s1.t - s0.t) : 0;
        const r = Math.round(s0.r + (s1.r - s0.r) * frac);
        const g = Math.round(s0.g + (s1.g - s0.g) * frac);
        const b = Math.round(s0.b + (s1.b - s0.b) * frac);
        return `rgb(${r},${g},${b})`;
      };

      if (b2d && wMode !== 'scatter') {
        if (Array.isArray(b2d) && b2d.length > 0 && typeof b2d[0] === 'object' && !Array.isArray(b2d[0])) {
          const defDT = bins.dT ?? bins.tStep ?? 1.0;
          const defDW = bins.dW ?? bins.wStep ?? 0.0005;
          let maxC = bins.maxBinCount || bins.maxBin || bins.maxCount || bins.maxHours || 0;
          if (maxC <= 0) {
            for (const c of b2d) {
              const cnt = c.count ?? c.hours ?? c.value ?? 0;
              if (cnt > maxC) maxC = cnt;
            }
          }
          if (maxC > 0) {
            for (const cell of b2d) {
              const cnt = cell.count ?? cell.hours ?? cell.value ?? 0;
              if (cnt <= 0) continue;
              const dT = cell.dT ?? cell.tStep ?? defDT;
              const dW = cell.dW ?? cell.wStep ?? defDW;
              const t0 = cell.t0 !== undefined ? cell.t0 : ((cell.T ?? cell.Tdb ?? 0) - dT * 0.5);
              const t1 = cell.t1 !== undefined ? cell.t1 : (t0 + dT);
              const w0 = cell.w0 !== undefined ? cell.w0 : Math.max(0, (cell.w ?? 0) - dW * 0.5);
              const w1 = cell.w1 !== undefined ? cell.w1 : (w0 + dW);
              const x0 = xc(t0), x1 = xc(t1), yTop = yc(w1), yBot = yc(w0);
              if (x1 < padL || x0 > plotRight || yBot < padT || yTop > plotBottom) continue;
              const rawNorm = Number.isFinite(cell.norm) ? cell.norm : (cnt / maxC);
              const norm = Math.pow(CoreDOM.clamp(rawNorm, 0, 1), 0.52);
              const alpha = CoreDOM.clamp(wOp * (0.20 + 0.72 * norm), 0, 1);
              weatherParts.push(
                `<rect x="${f2(x0)}" y="${f2(yTop)}" width="${f2(Math.max(1, x1 - x0) + 0.5)}" height="${f2(Math.max(1, yBot - yTop) + 0.5)}" ` +
                `fill="${heatRgb(norm)}" fill-opacity="${alpha.toFixed(3)}"/>`
              );
            }
          }
        }
      }

      if (wMode === 'scatter' || wMode === 'both') {
        const hourly = (Array.isArray(wObj.records) && wObj.records.length > 0)
          ? wObj.records
          : (wObj.hourly || wObj.points || wObj.data || null);
        if (Array.isArray(hourly) && hourly.length > 0) {
          const stride = Math.max(1, Math.floor(hourly.length / 1800));
          const dotAlpha = CoreDOM.clamp(wOp * (wMode === 'both' ? 0.42 : 0.58), 0, 1).toFixed(3);
          for (let i = 0; i < hourly.length; i += stride) {
            const rec = hourly[i];
            if (!rec) continue;
            const T = Array.isArray(rec) ? rec[0] : (rec.T ?? rec.Tdb ?? rec.t);
            const w = Array.isArray(rec) ? rec[1] : (rec.w ?? rec.W);
            if (!Number.isFinite(T) || !Number.isFinite(w) || w < 0) continue;
            const px = xc(T), py = yc(w);
            if (px < padL || px > plotRight || py < padT || py > plotBottom) continue;
            weatherParts.push(
              `<circle cx="${f2(px)}" cy="${f2(py)}" r="1.4" fill="#0284c7" fill-opacity="${dotAlpha}"/>`
            );
          }
        }
      }
    }

    /* ---- <g id="comfort-zones"> (BaseRenderer parity: Givoni -> TC 9.9 -> ASHRAE 55) ---- */
    const zoneParts = [];
    const zoneLabelParts = [];
    const placedZoneBoxes = [];

    const isDarkTheme = (() => {
      const hex = String(palette.plotBg || palette.bg || '#ffffff').replace('#', '').trim();
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
      }
      return /dark|blueprint/i.test(st.theme || '');
    })();

    const polyBounds = (poly) => {
      let minT = Infinity, maxT = -Infinity, minW = Infinity, maxW = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const pt = poly[i];
        const T = Array.isArray(pt) ? pt[0] : pt.T;
        const w = Array.isArray(pt) ? pt[1] : pt.w;
        if (T < minT) minT = T;
        if (T > maxT) maxT = T;
        if (w < minW) minW = w;
        if (w > maxW) maxW = w;
      }
      return { minT, maxT, minW, maxW };
    };

    const polyCentroid = (poly) => {
      let area2 = 0, cx = 0, cy = 0;
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
      if (Math.abs(area2) > 1e-12) return [cx / (3 * area2), cy / (3 * area2)];
      const b = polyBounds(poly);
      return [0.5 * (b.minT + b.maxT), 0.5 * (b.minW + b.maxW)];
    };

    const polyHorizontalSpan = (poly, wVal) => {
      let minT = Infinity, maxT = -Infinity;
      const n = poly.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const p0 = poly[j], p1 = poly[i];
        const x0 = Array.isArray(p0) ? p0[0] : p0.T;
        const y0 = Array.isArray(p0) ? p0[1] : p0.w;
        const x1 = Array.isArray(p1) ? p1[0] : p1.T;
        const y1 = Array.isArray(p1) ? p1[1] : p1.w;
        if ((y0 <= wVal && y1 >= wVal) || (y1 <= wVal && y0 >= wVal)) {
          if (Math.abs(y1 - y0) < 1e-12) {
            if (x0 < minT) minT = x0;
            if (x0 > maxT) maxT = x0;
            if (x1 < minT) minT = x1;
            if (x1 > maxT) maxT = x1;
          } else {
            const t = x0 + ((wVal - y0) / (y1 - y0)) * (x1 - x0);
            if (t < minT) minT = t;
            if (t > maxT) maxT = t;
          }
        }
      }
      return minT <= maxT ? [minT, maxT] : null;
    };

    const polyToSvgPoints = (poly) => {
      const coords = [];
      for (const pt of poly) {
        const T = Array.isArray(pt) ? pt[0] : pt.T;
        const w = Array.isArray(pt) ? pt[1] : pt.w;
        const wc = Math.min(w, wsatAt(T, pPa));
        coords.push(`${f2(xc(T))},${f2(yc(wc))}`);
      }
      return coords.join(' ');
    };

    const boxesOverlap = (a, b, pad = 2) => (
      a.x - pad < b.x + b.w &&
      a.x + a.w + pad > b.x &&
      a.y - pad < b.y + b.h &&
      a.y + a.h + pad > b.y
    );

    const placeZoneLabel = (text, rawX, rawY, color, {
      anchor = 'middle',
      baseline = 'middle',
      fontSize = 8.5,
      weight = '600',
      cls = 'svg-sans'
    } = {}) => {
      if (!text) return;
      const estW = Math.max(16, String(text).length * fontSize * 0.60) + 6;
      const estH = fontSize + 5;
      const makeBox = (x, y) => {
        const bx = anchor === 'end' ? (x - estW) : (anchor === 'start' ? x : (x - estW * 0.5));
        const by = baseline === 'hanging' ? y : (y - estH * 0.5);
        return { x: bx, y: by, w: estW, h: estH };
      };

      const offsets = [0, -14, 14, -28, 28, -42, 42];
      let chosenX = rawX;
      let chosenY = rawY;
      let chosenBox = makeBox(rawX, rawY);
      let placed = false;

      for (const dy of offsets) {
        const candY = CoreDOM.clamp(rawY + dy, padT + estH * 0.6, plotBottom - estH * 0.6);
        const candX = CoreDOM.clamp(
          rawX,
          anchor === 'end' ? padL + estW : (anchor === 'middle' ? padL + estW * 0.5 : padL + 4),
          anchor === 'end' ? plotRight - 4 : (anchor === 'middle' ? plotRight - estW * 0.5 : plotRight - estW)
        );
        const box = makeBox(candX, candY);
        let hits = false;
        for (let i = 0; i < placedZoneBoxes.length; i++) {
          if (boxesOverlap(box, placedZoneBoxes[i], 2)) {
            hits = true;
            break;
          }
        }
        if (!hits) {
          chosenX = candX;
          chosenY = candY;
          chosenBox = box;
          placed = true;
          break;
        }
      }

      if (!placed) {
        chosenX = CoreDOM.clamp(rawX, padL + 8, plotRight - 8);
        chosenY = CoreDOM.clamp(rawY, padT + 10, plotBottom - 10);
        chosenBox = makeBox(chosenX, chosenY);
      }

      if (chosenX >= padL && chosenX <= plotRight && chosenY >= padT && chosenY <= plotBottom) {
        placedZoneBoxes.push(chosenBox);
        zoneLabelParts.push(
          `<text x="${f2(chosenX)}" y="${f2(chosenY)}" text-anchor="${anchor}" dominant-baseline="${baseline}" ` +
          `class="${cls} svg-halo" font-size="${fontSize}" font-weight="${weight}" fill="${esc(color)}">${esc(text)}</text>`
        );
      }
    };

    // 1. Givoni Bioclimatic Zones (bottom zone layer, with 45° diagonal hatch)
    if (data.comfortCfg.givoni) {
      const gZones = getGivoniZones(pPa);
      for (let i = 0; i < gZones.length; i++) {
        const gz = gZones[i];
        const poly = gz?.poly || gz?.points;
        if (!Array.isArray(poly) || poly.length < 3) continue;
        const ptsAttr = polyToSvgPoints(poly);
        const strokeCol = gz.stroke || '#0284c7';
        const patId = `givoni-hatch-${i}`;
        defsParts.push(
          `<pattern id="${patId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
          `<line x1="0" y1="0" x2="0" y2="10" stroke="${esc(strokeCol)}" stroke-width="1" stroke-opacity="0.22"/></pattern>`
        );
        zoneParts.push(
          `<polygon points="${ptsAttr}" fill="${esc(gz.fill || 'rgba(14,165,233,0.09)')}" stroke="none"/>`,
          `<polygon points="${ptsAttr}" fill="url(#${patId})" stroke="${esc(strokeCol)}" stroke-width="1.15" stroke-dasharray="4,3"/>`
        );
        const [cT, cW] = polyCentroid(poly);
        placeZoneLabel(gz.shortLabel || gz.label || gz.name, xc(cT), yc(cW), strokeCol, {
          anchor: 'middle',
          baseline: 'middle',
          fontSize: 8.5,
          weight: '600',
          cls: 'svg-sans'
        });
      }
    }

    // 2. ASHRAE TC 9.9 Data Center Envelopes (A4 -> A3 -> A2 -> A1 -> Recommended)
    if (data.comfortCfg.datacenter) {
      const dcZones = getDataCenterZones(pPa);
      for (let i = 0; i < dcZones.length; i++) {
        const dz = dcZones[i];
        const poly = dz?.poly || dz?.points;
        if (!Array.isArray(poly) || poly.length < 3) continue;
        const isRec = dz.id === 'tc99_rec' || /recommended/i.test(dz.label || dz.name || '');
        const ptsAttr = polyToSvgPoints(poly);
        const strokeCol = dz.stroke || (isRec ? '#10b981' : '#38bdf8');
        zoneParts.push(
          `<polygon points="${ptsAttr}" fill="${esc(dz.fill || (isRec ? 'rgba(16,185,129,0.16)' : 'rgba(56,189,248,0.08)'))}" ` +
          `stroke="${esc(strokeCol)}" stroke-width="${isRec ? '1.8' : '1.15'}" stroke-dasharray="${isRec ? '6,3' : '4,3.5'}"/>`
        );
        const b = polyBounds(poly);
        if (isRec) {
          const [cT, cW] = polyCentroid(poly);
          placeZoneLabel('TC 9.9 Rec', xc(cT), yc(cW), isDarkTheme ? '#34d399' : '#047857', {
            anchor: 'middle',
            baseline: 'middle',
            fontSize: 8.5,
            weight: '700',
            cls: 'svg-sans'
          });
        } else {
          let topRightW = -Infinity;
          for (let k = 0; k < poly.length; k++) {
            const p = poly[k];
            const pT = Array.isArray(p) ? p[0] : p.T;
            const pW = Array.isArray(p) ? p[1] : p.w;
            if (Math.abs(pT - b.maxT) < 0.25 && pW > topRightW) {
              topRightW = Math.min(b.maxW, pW);
            }
          }
          if (!Number.isFinite(topRightW)) topRightW = b.maxW;
          const tag = dz.id === 'tc99_a1' ? 'A1'
            : (dz.id === 'tc99_a2' ? 'A2'
              : (dz.id === 'tc99_a3' ? 'A3'
                : (dz.id === 'tc99_a4' ? 'A4' : (dz.name || dz.label || ''))));
          placeZoneLabel(tag, xc(b.maxT) - 4, yc(topRightW) + 12, strokeCol, {
            anchor: 'end',
            baseline: 'hanging',
            fontSize: 8.5,
            weight: '700',
            cls: 'svg-mono'
          });
        }
      }
    }

    // 3. ASHRAE 55 / ISO 7730 Dynamic PMV Comfort Zones (topmost zone layer)
    if (layerOn('comfort', true) && data.comfortCfg.mode !== 'none') {
      const cm = data.comfortCfg;
      const sw = Comfort.getSummerWinterZones(pPa, cm);
      const list = [];
      if ((cm.mode === 'winter' || cm.mode === 'both') && sw?.winter?.poly?.length >= 3) list.push(sw.winter);
      if ((cm.mode === 'summer' || cm.mode === 'both') && sw?.summer?.poly?.length >= 3) list.push(sw.summer);

      for (let i = 0; i < list.length; i++) {
        const z = list[i];
        const isSummer = z.id === 'summer';
        const fillCol = z.fill || (isSummer ? 'rgba(16,185,129,0.14)' : 'rgba(59,130,246,0.12)');
        const strokeCol = isDarkTheme
          ? (z.stroke || (isSummer ? 'rgba(52,211,153,0.78)' : 'rgba(96,165,250,0.76)'))
          : (isSummer ? 'rgba(4,120,87,0.78)' : 'rgba(29,78,216,0.76)');

        zoneParts.push(
          `<polygon points="${polyToSvgPoints(z.poly)}" fill="${esc(fillCol)}" ` +
          `stroke="${esc(strokeCol)}" stroke-width="1.5" stroke-dasharray="5,3.5"/>`
        );

        const [cT, cW] = polyCentroid(z.poly);
        const b = polyBounds(z.poly);
        const wSpan = Math.max(1e-4, b.maxW - b.minW);
        const wFrac = list.length > 1 ? (isSummer ? 0.72 : 0.34) : 0.54;
        const wPad = Math.min(0.0008, wSpan * 0.15);
        const lblW = CoreDOM.clamp(b.minW + wSpan * wFrac, b.minW + wPad, b.maxW - wPad);
        const span = polyHorizontalSpan(z.poly, lblW);
        const lblT = span ? 0.5 * (span[0] + span[1]) : cT;
        const finalW = span ? lblW : cW;

        placeZoneLabel(z.label || (isSummer ? 'Summer' : 'Winter'), xc(lblT), yc(finalW), strokeCol, {
          anchor: 'middle',
          baseline: 'middle',
          fontSize: 8.5,
          weight: '600',
          cls: 'svg-sans'
        });
      }
    }

    // Emit zone labels after all zone polygons so labels are crisp and never obscured by fills
    for (let i = 0; i < zoneLabelParts.length; i++) {
      zoneParts.push(zoneLabelParts[i]);
    }

    /* ---- <g id="curves"> ---- */
    const curveParts = [];
    const lwMap = palette.lw || { sat: 2.5, rh: 0.9, wb: 0.85, enth: 0.85, vline: 0.8, dp: 0.8 };
    const lsMap = palette.ls || { sat: 'solid', rh: 'solid', wb: 'dashed', enth: 'solid', vline: 'solid', dp: 'dotted' };

    // 1. Dew-Point horizontal reference lines
    if (layerOn('dp', false)) {
      const dpList = units === 'SI'
        ? [-10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40]
        : [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const dpD of dpList) {
        const tdpC = CoreDOM.dispToT(dpD, units);
        const w = wFromTdp(tdpC, pPa);
        if (w <= 0 || w > wMax) continue;
        const py = yc(w);
        const satX = Math.max(padL, xc(tdpC));
        if (satX >= plotRight) continue;
        curveParts.push(
          `<line x1="${f2(satX)}" y1="${f2(py)}" x2="${f2(plotRight)}" y2="${f2(py)}" ` +
          `stroke="${esc(palette.dp)}" stroke-width="${f2(lwMap.dp)}" stroke-opacity="0.55"${svgDashAttr(lsMap.dp)}/>`
        );
        if (labelMode !== 'none') {
          curveParts.push(
            `<text x="${f2(satX + 5)}" y="${f2(py - 3)}" class="svg-mono svg-halo" ` +
            `font-size="${Math.max(8, labelPx - 2)}" fill="${esc(palette.dp)}">Tdp ${dpD}°</text>`
          );
        }
      }
    }

    // 2. Specific Volume lines
    if (layerOn('vlines', true)) {
      const vList = units === 'SI'
        ? [0.74, 0.76, 0.78, 0.80, 0.82, 0.84, 0.86, 0.88, 0.90, 0.92, 0.94, 0.96, 0.98, 1.00, 1.04]
        : [11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5, 16.0, 16.5];
      for (const vDisp of vList) {
        const vTarget = units === 'SI' ? vDisp : (vDisp / FT3LB_PER_M3KG);
        const tSat = tsatFromSpecVolSI(vTarget, pPa);
        const tZero = (vTarget * pPa) / RDA - 273.15;
        if (tZero < tMin - 2 || tSat > tMax + 2) continue;
        const pts = [];
        const N = 16;
        for (let i = 0; i <= N; i++) {
          const T = tSat + (tZero - tSat) * (i / N);
          const w = Math.max(0, ((vTarget * pPa) / (RDA * (T + 273.15)) - 1) / 1.607858);
          pts.push([xc(T), yc(Math.min(w, wsatAt(T, pPa)))]);
        }
        const dPath = svgPathFromPts(pts);
        if (dPath) {
          curveParts.push(
            `<path d="${dPath}" fill="none" stroke="${esc(palette.vline)}" stroke-width="${f2(lwMap.vline)}" ` +
            `stroke-opacity="0.72"${svgDashAttr(lsMap.vline)}/>`
          );
          if (labelMode !== 'none') {
            // Place label near lower third where lines spread cleanly
            const lp = pts[Math.floor(pts.length * 0.78)];
            if (lp && lp[0] > padL + 10 && lp[0] < plotRight - 14 && lp[1] > padT + 12 && lp[1] < plotBottom - 10) {
              const pPrev = pts[Math.max(0, Math.floor(pts.length * 0.78) - 2)];
              let ang = Math.atan2(lp[1] - pPrev[1], lp[0] - pPrev[0]) * 180 / Math.PI;
              if (ang > 90) ang -= 180;
              if (ang < -90) ang += 180;
              curveParts.push(
                `<text x="${f2(lp[0])}" y="${f2(lp[1])}" transform="rotate(${f2(ang)} ${f2(lp[0])} ${f2(lp[1])})" ` +
                `text-anchor="middle" dy="-3" class="svg-mono svg-halo" font-size="${Math.max(8, labelPx - 2)}" ` +
                `fill="${esc(palette.vline)}">${vDisp.toFixed(units === 'SI' ? 2 : 1)}</text>`
              );
            }
          }
        }
      }
    }

    // 3. Constant-Enthalpy lines (and record intersections for Enthalpy Ruler)
    const enthalpyTicks = [];
    if (layerOn('enth', true)) {
      const hValuesDisp = [];
      if (units === 'SI') {
        for (let h = -10; h <= 180; h += 10) hValuesDisp.push(h);
      } else {
        for (let h = 0; h <= 80; h += 5) hValuesDisp.push(h);
      }

      for (const hD of hValuesDisp) {
        // Convert display enthalpy to exact SI kJ/kg (accounting for 0°F IP datum)
        // h_IP = 0.240*(1.8*T + 32) + w*(1061 + 0.444*(1.8*T + 32))
        // Solve saturation temperature directly in current unit basis
        let tSat, tZero;
        if (units === 'SI') {
          tSat = tsatFromEnthalpySI(hD, pPa);
          tZero = hD / 1.006;
        } else {
          let lo = -60, hi = 85;
          for (let i = 0; i < 60; i++) {
            const m = 0.5 * (lo + hi);
            if (hIP(m, wsatAt(m, pPa)) > hD) hi = m; else lo = m;
          }
          tSat = 0.5 * (lo + hi);
          const tFZero = hD / 0.240;
          tZero = CoreDOM.fToC(tFZero);
        }

        if (tZero < tMin - 2 || tSat > tMax + 2) continue;
        const wSat = wsatAt(tSat, pPa);
        const pts = [];
        const N = 22;
        for (let i = 0; i <= N; i++) {
          const T = tSat + (tZero - tSat) * (i / N);
          let w;
          if (units === 'SI') {
            w = (hD - 1.006 * T) / (2501 + 1.86 * T);
          } else {
            const tF = CoreDOM.cToF(T);
            w = (hD - 0.240 * tF) / (1061 + 0.444 * tF);
          }
          w = Math.max(0, Math.min(w, wsatAt(T, pPa)));
          pts.push([xc(T), yc(w)]);
        }
        const dPath = svgPathFromPts(pts);
        if (dPath) {
          curveParts.push(
            `<path d="${dPath}" fill="none" stroke="${esc(palette.enth)}" stroke-width="${f2(lwMap.enth)}" ` +
            `stroke-opacity="0.62"${svgDashAttr(lsMap.enth)}/>`
          );
        }

        // Store saturation anchor for the external ASHRAE enthalpy ruler
        const sx = xc(tSat);
        const sy = yc(wSat);
        const zx = xc(tZero);
        const zy = yc(0);
        if (sx >= padL - 2 && sx <= plotRight && sy >= padT - 2 && sy <= plotBottom) {
          const dx = sx - zx;
          const dy = sy - zy;
          const len = Math.hypot(dx, dy) || 1;
          enthalpyTicks.push({
            hDisp: hD,
            sx, sy,
            ux: dx / len,
            uy: dy / len
          });
        }
      }
    }

    // 4. Constant Wet-Bulb lines
    if (layerOn('wb', true)) {
      const wbStep = units === 'SI' ? (density === 'fine' ? 2 : 5) : (density === 'fine' ? 5 : 10);
      const wbStart = units === 'SI' ? -10 : 15;
      const wbEnd = units === 'SI' ? 45 : 115;
      for (let twbD = wbStart; twbD <= wbEnd; twbD += wbStep) {
        const twbC = CoreDOM.dispToT(twbD, units);
        const wSat = wsatAt(twbC, pPa);
        if (twbC > tMax + 1) continue;
        const pts = [[xc(twbC), yc(wSat)]];
        let prevT = twbC, prevW = wSat;
        for (let T = twbC + stepT; T <= tMax + 2; T += stepT) {
          const w = wFromTdbTwb(T, twbC, pPa);
          if (w <= 0) {
            if (prevW > 0) {
              const frac = prevW / Math.max(1e-9, prevW - w);
              const tCross = prevT + frac * (T - prevT);
              pts.push([xc(tCross), yc(0)]);
            }
            break;
          }
          pts.push([xc(T), yc(Math.min(w, wsatAt(T, pPa)))]);
          prevT = T;
          prevW = w;
        }
        if (pts.length >= 2) {
          curveParts.push(
            `<path d="${svgPathFromPts(pts)}" fill="none" stroke="${esc(palette.wb)}" ` +
            `stroke-width="${f2(lwMap.wb)}" stroke-opacity="0.72"${svgDashAttr(lsMap.wb)}/>`
          );
          if (labelMode !== 'none') {
            // Find visible point near upper-middle along wet-bulb line
            const vis = pts.filter(p => p[0] >= padL + 12 && p[0] <= plotRight - 18 && p[1] >= padT + 14 && p[1] <= plotBottom - 14);
            if (vis.length >= 2) {
              const idx = labelMode === 'end' ? vis.length - 1 : Math.floor(vis.length * 0.28);
              const lp = vis[idx];
              curveParts.push(
                `<text x="${f2(lp[0] + 4)}" y="${f2(lp[1] - 3)}" class="svg-mono svg-halo" ` +
                `font-size="${Math.max(8, labelPx - 2)}" fill="${esc(palette.wb)}">${twbD}°</text>`
              );
            }
          }
        }
      }
    }

    // 5. Relative Humidity curves
    if (layerOn('rh', true)) {
      for (let rh = rhStep; rh < 100; rh += rhStep) {
        const pts = [];
        for (let T = tMin - 1; T <= tMax + 1; T += stepT) {
          const pv = Math.min(pPa * 0.999, pwsPa(T) * (rh / 100));
          const w = wFromPv(pv, pPa);
          pts.push([xc(T), yc(w)]);
          if (w > wMax * 1.08) break;
        }
        const dPath = svgPathFromPts(pts);
        if (dPath) {
          curveParts.push(
            `<path d="${dPath}" fill="none" stroke="${esc(palette.rh)}" stroke-width="${f2(lwMap.rh)}" ` +
            `stroke-opacity="0.82"${svgDashAttr(lsMap.rh)}/>`
          );
          if (labelMode !== 'none') {
            const vis = pts.filter(p => p[0] >= padL + 16 && p[0] <= plotRight - 28 && p[1] >= padT + 14 && p[1] <= plotBottom - 12);
            if (vis.length >= 2) {
              const idx = labelMode === 'end' ? vis.length - 1 : Math.floor(vis.length * 0.58);
              const lp = vis[idx];
              const pA = vis[Math.max(0, idx - 2)];
              const pB = vis[Math.min(vis.length - 1, idx + 2)];
              let ang = Math.atan2(pB[1] - pA[1], pB[0] - pA[0]) * 180 / Math.PI;
              if (ang > 90) ang -= 180;
              if (ang < -90) ang += 180;
              curveParts.push(
                `<text x="${f2(lp[0])}" y="${f2(lp[1])}" transform="rotate(${f2(ang)} ${f2(lp[0])} ${f2(lp[1])})" ` +
                `text-anchor="middle" dy="-3.5" class="svg-mono svg-halo" font-size="${Math.max(8, labelPx - 1)}" ` +
                `fill="${esc(palette.rh)}">${rh}%</text>`
              );
            }
          }
        }
      }
    }

    // 6. Supersaturated Upper-Left Mask + Saturation Curve (100% RH)
    {
      const satPts = [];
      const satStep = Math.min(0.25, stepT);
      let tHitTop = null;
      if (wsatAt(tMin, pPa) < wMax && wsatAt(tMax, pPa) > wMax) {
        let lo = tMin, hi = tMax;
        for (let i = 0; i < 32; i++) {
          const mid = 0.5 * (lo + hi);
          if (wsatAt(mid, pPa) < wMax) lo = mid; else hi = mid;
        }
        tHitTop = 0.5 * (lo + hi);
      }
      const tEndSat = tHitTop !== null ? tHitTop : tMax;
      for (let T = tMin; T <= tEndSat + 1e-6; T += satStep) {
        const tc = Math.min(T, tEndSat);
        const w = wsatAt(tc, pPa);
        if (Number.isFinite(w)) satPts.push([xc(tc), yc(w)]);
        if (tc >= tEndSat) break;
      }
      if (tHitTop !== null) {
        satPts.push([xc(tHitTop), yc(wMax)]);
      }
      if (satPts.length >= 2) {
        const lastSat = satPts[satPts.length - 1];
        const maskPts = [[padL - 2, padT - 2], [satPts[0][0], Math.max(padT - 2, satPts[0][1])], ...satPts.slice(1), [lastSat[0], padT - 2]];
        curveParts.push(
          `<polygon points="${maskPts.map(pt => `${f2(pt[0])},${f2(pt[1])}`).join(' ')}" fill="${esc(palette.bg)}"/>`
        );
      }
      if (layerOn('sat', true)) {
        const dSat = svgPathFromPts(satPts);
        if (dSat) {
          curveParts.push(
            `<path d="${dSat}" fill="none" stroke="${esc(palette.sat)}" stroke-width="${f2(lwMap.sat)}" ` +
            `stroke-linecap="round" stroke-linejoin="round"${svgDashAttr(lsMap.sat)}/>`
          );
        }
      }
    }

    /* ---- <g id="enthalpy-ruler"> (Outside plot clip, ASHRAE-style angled scale) ---- */
    const rulerParts = [];
    if (layerOn('enth', true) && showEnthRuler && enthalpyTicks.length > 0) {
      const railPts = [];
      let lastLx = -999, lastLy = -999;
      const tickLen = 14;
      const lblOffset = 22;

      for (const tk of enthalpyTicks) {
        const ox = tk.sx + tk.ux * tickLen;
        const oy = tk.sy + tk.uy * tickLen;
        const lx = tk.sx + tk.ux * lblOffset;
        const ly = tk.sy + tk.uy * lblOffset;
        if (ox < 6 || oy < padT - 12 || ox > plotRight || oy > plotBottom) continue;

        railPts.push([ox, oy]);
        rulerParts.push(
          `<line x1="${f2(tk.sx)}" y1="${f2(tk.sy)}" x2="${f2(ox)}" y2="${f2(oy)}" ` +
          `stroke="${esc(palette.enth)}" stroke-width="0.95" stroke-opacity="0.72"/>`
        );

        if (Math.hypot(lx - lastLx, ly - lastLy) >= 18 && lx > 10 && ly > padT - 10) {
          lastLx = lx;
          lastLy = ly;
          let ang = Math.atan2(tk.uy, tk.ux) * 180 / Math.PI;
          if (ang > 90) ang -= 180;
          if (ang < -90) ang += 180;
          rulerParts.push(
            `<text x="${f2(lx)}" y="${f2(ly)}" transform="rotate(${f2(ang)} ${f2(lx)} ${f2(ly)})" ` +
            `text-anchor="end" dominant-baseline="middle" class="svg-mono svg-halo" font-size="${Math.max(8, labelPx - 2)}" ` +
            `fill="${esc(palette.enth)}">${tk.hDisp}</text>`
          );
        }
      }

      if (railPts.length >= 2) {
        rulerParts.unshift(
          `<path d="${svgPathFromPts(railPts)}" fill="none" stroke="${esc(palette.enth)}" stroke-width="1.0" stroke-opacity="0.55"/>`
        );
        const topRail = railPts[railPts.length - 1];
        const hTitle = units === 'SI' ? 'Enthalpy h (kJ/kg)' : 'Enthalpy h (Btu/lb)';
        rulerParts.push(
          `<text x="${f2(Math.max(padL, topRail[0] - 8))}" y="${f2(Math.max(padT - 8, topRail[1] - 10))}" ` +
          `text-anchor="start" class="svg-mono svg-halo" font-size="${Math.max(8, labelPx - 2)}" font-weight="600" ` +
          `fill="${esc(palette.enth)}">${esc(hTitle)}</text>`
        );
      }
    }

    /* ---- <g id="processes"> ---- */
    const procParts = [];
    const pointsRaw = Array.isArray(st.points) ? st.points : [];
    const plotBgCol = palette.plotBg || palette.bg;

    const isSvgNonCoil = (pr, bPt) => {
      const raw = pr?.raw;
      if (
        raw?.role === 'mix' ||
        raw?.role === 'room' ||
        raw?.role === 'erv' ||
        raw?.role === 'erv_exhaust' ||
        bPt?.derived?.type === 'mix'
      ) {
        return true;
      }
      if (!pr?.curved && raw?.label) {
        const lbl = String(raw.label);
        if (/\b(erv|hrv|mix|mixing|recirc|room|space)\b/i.test(lbl) && !/\b(coil|dehum)\b/i.test(lbl)) {
          return true;
        }
      }
      return false;
    };

    // Mix tie-lines (2-stream & multi-stream)
    if (layerOn('mixlinks', true)) {
      const seenMix = new Set();
      for (const p of pointsRaw) {
        if (!(p.derived && p.derived.type === 'mix')) continue;
        if (Array.isArray(p.derived.streams) && p.derived.streams.length >= 2) {
          const srcPts = p.derived.streams
            .map(s => pointsRaw.find(q => q.id === (s?.id ?? s?.ptId ?? s?.pointId)))
            .filter(Boolean);
          if (srcPts.length === 2) {
            const key = `${Math.min(srcPts[0].id, srcPts[1].id)}-${Math.max(srcPts[0].id, srcPts[1].id)}`;
            if (!seenMix.has(key)) {
              seenMix.add(key);
              procParts.push(
                `<line x1="${f2(xc(srcPts[0].T))}" y1="${f2(yc(srcPts[0].w))}" x2="${f2(xc(srcPts[1].T))}" y2="${f2(yc(srcPts[1].w))}" ` +
                `stroke="${esc(palette.mix || '#facc15')}" stroke-width="1.5" stroke-dasharray="6,4" stroke-opacity="0.72"/>`
              );
            }
          } else {
            for (const sp of srcPts) {
              procParts.push(
                `<line x1="${f2(xc(sp.T))}" y1="${f2(yc(sp.w))}" x2="${f2(xc(p.T))}" y2="${f2(yc(p.w))}" ` +
                `stroke="${esc(palette.mix || '#facc15')}" stroke-width="1.5" stroke-dasharray="6,4" stroke-opacity="0.72"/>`
              );
            }
          }
        } else {
          const pA = pointsRaw.find(q => q.id === p.derived.aId);
          const pB = pointsRaw.find(q => q.id === p.derived.bId);
          if (!pA || !pB) continue;
          const key = `${Math.min(pA.id, pB.id)}-${Math.max(pA.id, pB.id)}`;
          if (seenMix.has(key)) continue;
          seenMix.add(key);
          procParts.push(
            `<line x1="${f2(xc(pA.T))}" y1="${f2(yc(pA.w))}" x2="${f2(xc(pB.T))}" y2="${f2(yc(pB.w))}" ` +
            `stroke="${esc(palette.mix || '#facc15')}" stroke-width="1.5" stroke-dasharray="6,4" stroke-opacity="0.72"/>`
          );
        }
      }
    }

    // Optional Sensible / Latent Right-Angle Decomposition Legs (trendStyle.showDecompLegs)
    if (layerOn('processes', true) && tr.showDecompLegs === true && data.processes.length > 0) {
      let decompPr = null;
      if (st.ui?.selectedProcId != null) {
        const sel = data.processes.find(p => p.raw?.id === st.ui.selectedProcId || p.id === st.ui.selectedProcId);
        if (sel && sel.aPt && sel.bPt && Math.abs(sel.dT_SI) > 0.5 && Math.abs(sel.dW_SI) > 0.0003) {
          decompPr = sel;
        }
      } else {
        let bestScore = -1;
        for (const pr of data.processes) {
          if (!pr.aPt || !pr.bPt) continue;
          if (Math.abs(pr.dT_SI) <= 0.5 || Math.abs(pr.dW_SI) <= 0.0003) continue;
          if (isSvgNonCoil(pr, pr.bPt)) continue;
          const isCoil = (pr.dT_SI < -0.5 && pr.dW_SI < -0.0003) || pr.curved;
          const score = (isCoil ? 1000 : 0) + Math.abs(pr.dT_SI) * 10 + Math.abs(pr.dW_SI) * 10000;
          if (score > bestScore) {
            bestScore = score;
            decompPr = pr;
          }
        }
        if (!decompPr) {
          decompPr = data.processes.find(p => p.aPt && p.bPt && Math.abs(p.dT_SI) > 0.5 && Math.abs(p.dW_SI) > 0.0003) || null;
        }
      }

      if (decompPr) {
        const ax = xc(decompPr.aPt.T), ay = yc(decompPr.aPt.w);
        const bx = xc(decompPr.bPt.T), by = yc(decompPr.bPt.w);
        const cornerX = bx, cornerY = ay;
        const legX = Math.abs(cornerX - ax);
        const legY = Math.abs(by - cornerY);
        if (legX >= 6 && legY >= 6) {
          const sensCol = palette.heat || '#f87171';
          const latCol = decompPr.dW_SI >= 0 ? (palette.humid || '#34d399') : (palette.dehum || palette.humid || '#fbbf24');
          const sqCol = palette.muted || '#64748b';
          const dirX = ax < cornerX ? -1 : 1;
          const dirY = by < cornerY ? -1 : 1;

          let decompSvg =
            `<line x1="${f2(ax)}" y1="${f2(ay)}" x2="${f2(cornerX)}" y2="${f2(cornerY)}" ` +
            `stroke="${esc(sensCol)}" stroke-width="1.2" stroke-dasharray="4.5,3.2" stroke-opacity="0.78"/>` +
            `<line x1="${f2(cornerX)}" y1="${f2(cornerY)}" x2="${f2(bx)}" y2="${f2(by)}" ` +
            `stroke="${esc(latCol)}" stroke-width="1.2" stroke-dasharray="4.5,3.2" stroke-opacity="0.78"/>`;
          if (legX > 12 && legY > 12) {
            const sq = 6;
            decompSvg +=
              `<path d="M${f2(cornerX + dirX * sq)},${f2(cornerY)} L${f2(cornerX + dirX * sq)},${f2(cornerY + dirY * sq)} L${f2(cornerX)},${f2(cornerY + dirY * sq)}" ` +
              `fill="none" stroke="${esc(sqCol)}" stroke-width="1.0" stroke-opacity="0.75"/>`;
          }
          decompSvg += `<circle cx="${f2(cornerX)}" cy="${f2(cornerY)}" r="2" fill="${esc(sqCol)}" fill-opacity="0.85"/>`;

          const hasLoad = Number.isFinite(decompPr.Qs_kW) && Number.isFinite(decompPr.Ql_kW) &&
            (Math.abs(decompPr.Qs_kW) >= 0.05 || Math.abs(decompPr.Ql_kW) >= 0.05);
          let sensLbl, latLbl;
          if (hasLoad) {
            const fmtQ = (pfx, qKw) => {
              const s = qKw > 0 ? '+' : (qKw < 0 ? '-' : '');
              const absKw = Math.abs(qKw);
              if (units === 'IP') {
                const absTr = absKw / KW_PER_TR;
                if (absTr >= 0.15) return `${pfx} ${s}${absTr.toFixed(1)} TR`;
                return `${pfx} ${s}${(absKw * 3.412142).toFixed(1)} kBTU/h`;
              }
              return `${pfx} ${s}${absKw.toFixed(1)} kW`;
            };
            sensLbl = fmtQ('Qs', decompPr.Qs_kW);
            latLbl = fmtQ('Ql', decompPr.Ql_kW);
          } else {
            sensLbl = `ΔT ${fmtSigned(decompPr.dTDisp, 1)}${units === 'SI' ? '°C' : '°F'}`;
            latLbl = `ΔW ${fmtSigned(decompPr.dWDisp, 1)} ${data.U.W}`;
          }

          if (legX >= 28) {
            const sx = 0.5 * (ax + cornerX);
            const sy = cornerY + (by < cornerY ? 12 : -10);
            decompSvg +=
              `<text x="${f2(sx)}" y="${f2(sy)}" text-anchor="middle" dominant-baseline="middle" ` +
              `class="svg-mono svg-halo" font-size="8.2" font-weight="600" fill="${esc(sensCol)}">${esc(sensLbl)}</text>`;
          }
          if (legY >= 22) {
            const lx = cornerX + (ax < cornerX ? 6 : -6);
            const ly = 0.5 * (cornerY + by);
            decompSvg +=
              `<text x="${f2(lx)}" y="${f2(ly)}" text-anchor="${ax < cornerX ? 'start' : 'end'}" dominant-baseline="middle" ` +
              `class="svg-mono svg-halo" font-size="8.2" font-weight="600" fill="${esc(latCol)}">${esc(latLbl)}</text>`;
          }
          procParts.push(`<g>${decompSvg}</g>`);
        }
      }
    }

    // Process arrows + ADP extensions + midpoint badges
    if (layerOn('processes', true)) {
      data.processes.forEach((pr) => {
        const a = pr.aPt;
        const b = pr.bPt;
        if (!a || !b) return;
        const ax = xc(a.T), ay = yc(a.w);
        const bx = xc(b.T), by = yc(b.w);
        const dx = bx - ax, dy = by - ay;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return;

        const procColor = resolveSvgProcColor(pr);
        const nonCoil = isSvgNonCoil(pr, b);

        // Coil ADP extension dashed line + crisp diamond ADP marker (suppressed on non-coil roles)
        if (layerOn('adpLines', true) && pr.adp && !nonCoil) {
          const adpX = xc(pr.adp.Tadp);
          const adpY = yc(pr.adp.Wadp);
          const adpCol = palette.sat || procColor;
          const dr = 4.6;
          const adpDia = `${f2(adpX)},${f2(adpY - dr)} ${f2(adpX + dr)},${f2(adpY)} ${f2(adpX)},${f2(adpY + dr)} ${f2(adpX - dr)},${f2(adpY)}`;
          procParts.push(
            `<line x1="${f2(bx)}" y1="${f2(by)}" x2="${f2(adpX)}" y2="${f2(adpY)}" ` +
            `stroke="${esc(adpCol)}" stroke-width="1.2" stroke-dasharray="4.5,3.5" stroke-opacity="0.72"/>` +
            `<polygon points="${adpDia}" fill="${esc(plotBgCol)}" stroke="${esc(adpCol)}" stroke-width="1.5"/>` +
            `<circle cx="${f2(adpX)}" cy="${f2(adpY)}" r="1.3" fill="${esc(adpCol)}"/>`
          );
        }

        const markerExtra = tr.pointMarker === 'crosshair-circle' ? 4.5 : (tr.pointMarker === 'diamond' ? 3.5 : 3);
        const headAdv = tr.arrowStyle === 'open-vector' ? 0 : 2.3;
        const trim = dist > (ptR * 2 + 10) ? (ptR + markerExtra + headAdv) : 0;
        const ux = dx / dist, uy = dy / dist;
        const sx = ax + ux * (Math.min(ptR + 2, trim) * 0.6);
        const sy = ay + uy * (Math.min(ptR + 2, trim) * 0.6);
        const ex = bx - ux * trim;
        const ey = by - uy * trim;
        const markerId = registerArrowColor(procColor);

        let midX = 0.5 * (ax + bx);
        let midY = 0.5 * (ay + by);

        if (pr.curved && !nonCoil && b.T < a.T && b.w < a.w) {
          // Always use exact saturation-clamped ASHRAE cooling-coil trajectory (even when ADP misses saturation)
          let curveModel = null;
          if (HVAC && typeof HVAC.buildCoilCurvePts === 'function') {
            try { curveModel = HVAC.buildCoilCurvePts(a, b, pPa, 32); } catch (_) { curveModel = null; }
          }
          if ((!curveModel || curveModel.length < 3) && pr.adp?.coilCurvePts?.length >= 3) {
            curveModel = pr.adp.coilCurvePts;
          }
          let cPts;
          if (curveModel && curveModel.length >= 3) {
            cPts = curveModel.map(pt => [xc(pt.T), yc(pt.w)]);
          } else {
            // Defensive saturation-clamped fallback
            const steps = 28;
            const ctrlT = b.T + (a.T - b.T) * 0.35;
            const ctrlW = Math.min(a.w - (a.w - b.w) * 0.14, Psy.wsat_at(ctrlT, pPa) * 0.996);
            cPts = [];
            let prevW = a.w;
            for (let si = 0; si <= steps; si++) {
              const t = si / steps;
              const omt = 1 - t;
              const T = omt * omt * a.T + 2 * omt * t * ctrlT + t * t * b.T;
              let w = omt * omt * a.w + 2 * omt * t * ctrlW + t * t * b.w;
              if (si > 0 && si < steps) {
                const wSat = Psy.wsat_at(T, pPa);
                w = CoreDOM.clamp(w, Math.min(b.w, wSat), Math.min(prevW, wSat * 0.996));
              }
              prevW = w;
              cPts.push([xc(T), yc(w)]);
            }
          }
          const lastIdx = cPts.length - 1;
          const prevPt = cPts[lastIdx - 1];
          const endPt = cPts[lastIdx];
          const tdx = endPt[0] - prevPt[0], tdy = endPt[1] - prevPt[1];
          const tlen = Math.hypot(tdx, tdy) || 1;
          cPts[lastIdx] = [endPt[0] - (tdx / tlen) * trim, endPt[1] - (tdy / tlen) * trim];
          procParts.push(
            `<path d="${svgPathFromPts(cPts)}" fill="none" stroke="${esc(procColor)}" ` +
            `stroke-width="${f2(arrowW)}" stroke-linecap="round" stroke-linejoin="round" ` +
            `marker-end="url(#${esc(markerId)})"/>`
          );
          const midPt = cPts[Math.floor(cPts.length * 0.5)];
          midX = midPt[0];
          midY = midPt[1];
        } else {
          procParts.push(
            `<line x1="${f2(sx)}" y1="${f2(sy)}" x2="${f2(ex)}" y2="${f2(ey)}" ` +
            `stroke="${esc(procColor)}" stroke-width="${f2(arrowW)}" stroke-linecap="round" ` +
            `marker-end="url(#${esc(markerId)})"/>`
          );
        }

        // Midpoint process badge matching tr.badgeStyle ('detailed' | 'pill' | 'inline-minimal')
        if (tr.badgeStyle === 'inline-minimal') {
          procParts.push(
            `<text x="${f2(midX)}" y="${f2(midY - 10)}" text-anchor="middle" dominant-baseline="middle" ` +
            `class="svg-mono svg-halo" font-size="9.5" font-weight="600" fill="${esc(procColor)}">${esc(pr.id)}</text>`
          );
        } else {
          const hasLoad = pr.flowVal > 0 && Number.isFinite(pr.Qt_kW) && Math.abs(pr.Qt_kW) >= 0.05;
          const loadStr = hasLoad
            ? (units === 'IP'
              ? (Math.abs(pr.tonsTR) >= 0.15
                ? `${Math.abs(pr.tonsTR).toFixed(1)} TR`
                : `${(Math.abs(pr.Qt_kW) * 3.412142).toFixed(1)} kBTU/h`)
              : `${Math.abs(pr.Qt_kW).toFixed(1)} kW`)
            : '';
          const parts = [pr.id];
          if (loadStr && (dist >= (tr.badgeStyle === 'pill' ? 95 : 80))) {
            parts.push(loadStr);
          }
          if (
            tr.badgeStyle === 'detailed' &&
            Number.isFinite(pr.SHR) &&
            Math.abs(pr.SHR) <= 1.05 &&
            (st.ui?.selectedProcId === pr.raw?.id || (parts.length === 1 && dist >= 120))
          ) {
            parts.push(`SHR ${pr.SHR.toFixed(2)}`);
          }
          const badgeTxt = parts.join(' · ');
          const isCompactPill = tr.badgeStyle === 'pill';
          const fontPx = isCompactPill ? 8.8 : 9.5;
          const padX = isCompactPill ? 9 : 12;
          const badgeW = Math.max(22, badgeTxt.length * (fontPx * 0.66) + padX);
          const badgeH = isCompactPill ? 14 : 16;
          const badgeRx = isCompactPill ? 7 : 4;
          const bxPos = midX - badgeW * 0.5;
          const byPos = midY - badgeH - 5;
          procParts.push(
            `<g>` +
            `<rect x="${f2(bxPos)}" y="${f2(byPos)}" width="${f2(badgeW)}" height="${badgeH}" rx="${badgeRx}" ` +
            `fill="${esc(plotBgCol)}" fill-opacity="0.92" stroke="${esc(procColor)}" stroke-width="${isCompactPill ? '0.95' : '1.1'}"/>` +
            `<text x="${f2(midX)}" y="${f2(byPos + badgeH * 0.5 + 0.5)}" text-anchor="middle" dominant-baseline="middle" ` +
            `class="svg-mono" font-size="${fontPx}" font-weight="600" fill="${esc(procColor)}">${esc(badgeTxt)}</text>` +
            `</g>`
          );
        }
      });
    }

    /* ---- <g id="points"> ---- */
    const ptParts = [];
    if (layerOn('points', true)) {
      pointsRaw.forEach((p, idx) => {
        if (!CoreDOM.isPointVisible(p, st)) return;
        const px = xc(p.T);
        const py = yc(p.w);
        if (px < padL - 6 || px > plotRight + 6 || py < padT - 6 || py > plotBottom + 6) return;
        const isDesign = CoreDOM.isDesignCityPoint(p);
        const s = CoreDOM.computePointScale(st.view, isDesign);
        const effPtR = ptR * s;
        const col = p.color || palette.pt;
        const lx = Number.isFinite(p.lx) ? p.lx : 10;
        const ly = Number.isFinite(p.ly) ? p.ly : -8;
        const label = p.label || `P${idx + 1}`;
        const effLblPx = CoreDOM.clamp((labelPx - (isDesign ? 0.7 : 0)) * (s < 0.92 ? Math.max(0.78, 0.62 + 0.38 * s) : 1), 8.2, 16);

        if (Math.hypot(lx, ly) > 18) {
          ptParts.push(
            `<line x1="${f2(px)}" y1="${f2(py)}" x2="${f2(px + lx)}" y2="${f2(py + ly)}" ` +
            `stroke="${esc(col)}" stroke-width="0.85" stroke-dasharray="2,2" stroke-opacity="0.55"/>`
          );
        }

        let markerSvg;
        if (tr.pointMarker === 'crosshair-circle') {
          const r = effPtR * 1.05;
          const tLen = 4.2 * s;
          markerSvg =
            `<circle cx="${f2(px)}" cy="${f2(py)}" r="${f2(r)}" fill="${esc(plotBgCol)}" stroke="${esc(col)}" stroke-width="${f2(Math.max(1.0, 1.75 * s))}"/>` +
            `<circle cx="${f2(px)}" cy="${f2(py)}" r="${f2(Math.max(0.85, 1.3 * s))}" fill="${esc(col)}"/>` +
            `<path d="M${f2(px)},${f2(py - r)} V${f2(py - r - tLen)} M${f2(px)},${f2(py + r)} V${f2(py + r + tLen)} ` +
            `M${f2(px - r)},${f2(py)} H${f2(px - r - tLen)} M${f2(px + r)},${f2(py)} H${f2(px + r + tLen)}" ` +
            `fill="none" stroke="${esc(col)}" stroke-width="${f2(Math.max(0.85, 1.3 * s))}" stroke-linecap="round"/>`;
        } else if (tr.pointMarker === 'solid-dot') {
          markerSvg =
            `<circle cx="${f2(px)}" cy="${f2(py)}" r="${f2(effPtR * 1.05)}" fill="${esc(col)}" stroke="${esc(plotBgCol)}" stroke-width="${f2(Math.max(0.9, 1.55 * s))}"/>`;
        } else if (tr.pointMarker === 'diamond') {
          const dr = effPtR * 1.32;
          const dPts = `${f2(px)},${f2(py - dr)} ${f2(px + dr)},${f2(py)} ${f2(px)},${f2(py + dr)} ${f2(px - dr)},${f2(py)}`;
          markerSvg =
            `<polygon points="${dPts}" fill="${esc(col)}" stroke="${esc(plotBgCol)}" stroke-width="${f2(Math.max(0.9, 1.55 * s))}" stroke-linejoin="miter"/>`;
        } else {
          // Default: 'precision-ring'
          markerSvg =
            `<circle cx="${f2(px)}" cy="${f2(py)}" r="${f2(effPtR + 1.85 * s)}" fill="${esc(col)}" fill-opacity="0.18" stroke="${esc(col)}" stroke-width="${f2(Math.max(0.85, 1.35 * s))}"/>` +
            `<circle cx="${f2(px)}" cy="${f2(py)}" r="${f2(effPtR)}" fill="${esc(col)}" stroke="${esc(plotBgCol)}" stroke-width="${f2(Math.max(0.75, 1.15 * s))}"/>`;
        }

        ptParts.push(
          markerSvg +
          `<text x="${f2(px + lx)}" y="${f2(py + ly)}" class="svg-mono svg-halo" font-size="${f2(effLblPx)}" font-weight="600" fill="${esc(col)}">${esc(label)}</text>`
        );
      });
    }

    // User annotations
    if (layerOn('annotations', true) && Array.isArray(st.annotations)) {
      for (const ann of st.annotations) {
        if (!ann || !Number.isFinite(ann.T) || !Number.isFinite(ann.w)) continue;
        const ax = xc(ann.T);
        const ay = yc(ann.w);
        if (ax < padL || ax > plotRight || ay < padT || ay > plotBottom) continue;
        const col = ann.color || palette.fg;
        ptParts.push(
          `<text x="${f2(ax)}" y="${f2(ay)}" class="svg-sans svg-halo" font-size="11" font-weight="600" fill="${esc(col)}">${esc(ann.text || '')}</text>`
        );
      }
    }

    /* ---- <g id="axes"> ---- */
    const axisParts = [];
    const borderLw = f2(palette.border_lw || 1.5);
    const showRightY = ax.yAxisSide !== 'left';
    const showLeftY = ax.yAxisSide === 'left' || ax.yAxisSide === 'both';

    // Axis frame style: 'ashrae-open' | 'cad-ticks' | 'full-box'
    if (ax.frame === 'ashrae-open') {
      // Bottom X-axis + Right Y-axis lines only (plus left spine only when yAxisSide === 'left')
      axisParts.push(
        `<line x1="${padL}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" ` +
        `stroke="${esc(palette.border)}" stroke-width="${borderLw}" stroke-linecap="square"/>`
      );
      if (showRightY) {
        axisParts.push(
          `<line x1="${plotRight}" y1="${padT}" x2="${plotRight}" y2="${plotBottom}" ` +
          `stroke="${esc(palette.border)}" stroke-width="${borderLw}" stroke-linecap="square"/>`
        );
      } else {
        axisParts.push(
          `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${plotBottom}" ` +
          `stroke="${esc(palette.border)}" stroke-width="${borderLw}" stroke-linecap="square"/>`
        );
      }
    } else if (ax.frame === 'cad-ticks') {
      axisParts.push(
        `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="none" ` +
        `stroke="${esc(palette.border)}" stroke-width="${borderLw}"/>`
      );
      const cm = 8;
      const cadPath = [
        `M${f2(padL - cm)},${f2(padT)} H${f2(padL + cm)} M${f2(padL)},${f2(padT - cm)} V${f2(padT + cm)}`,
        `M${f2(plotRight - cm)},${f2(padT)} H${f2(plotRight + cm)} M${f2(plotRight)},${f2(padT - cm)} V${f2(padT + cm)}`,
        `M${f2(plotRight - cm)},${f2(plotBottom)} H${f2(plotRight + cm)} M${f2(plotRight)},${f2(plotBottom - cm)} V${f2(plotBottom + cm)}`,
        `M${f2(padL - cm)},${f2(plotBottom)} H${f2(padL + cm)} M${f2(padL)},${f2(plotBottom - cm)} V${f2(plotBottom + cm)}`
      ].join(' ');
      axisParts.push(
        `<path d="${cadPath}" fill="none" stroke="${esc(palette.border)}" ` +
        `stroke-width="${f2(Math.max(1.4, (palette.border_lw || 1.5) * 1.15))}" stroke-linecap="square"/>`
      );
    } else {
      // 'full-box'
      axisParts.push(
        `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="none" ` +
        `stroke="${esc(palette.border)}" stroke-width="${borderLw}"/>`
      );
    }

    // Tick direction helper: 'out'/'outward' | 'in'/'inward' | 'cross'
    const tickSpan = (pos, len, outwardSign) => {
      if (ax.tickDir === 'in' || ax.tickDir === 'inward') {
        const end = pos - outwardSign * len;
        return [Math.min(end, pos), Math.max(end, pos)];
      }
      if (ax.tickDir === 'cross') {
        const half = len * 0.65;
        return [pos - half, pos + half];
      }
      const end = pos + outwardSign * len;
      return [Math.min(pos, end), Math.max(pos, end)];
    };

    // Minor sub-ticks along bottom X, top X, and active Y axis sides
    if (ax.showSubTicks !== false) {
      let dSub = '';
      const [xMinY1, xMinY2] = tickSpan(plotBottom, 3, 1);
      const [xTopMinY1, xTopMinY2] = tickSpan(padT, 3, -1);
      const tStartMinTick = Math.ceil(gs.tMinDisp / gs.minT) * gs.minT;
      for (let tD = tStartMinTick; tD <= gs.tMaxDisp + 1e-6; tD += gs.minT) {
        if (Math.abs(tD / gs.majT - Math.round(tD / gs.majT)) < 1e-4) continue;
        const px = xc(CoreDOM.dispToT(tD, units));
        if (px < padL - 0.5 || px > plotRight + 0.5) continue;
        dSub += `M${f2(px)},${f2(xMinY1)}V${f2(xMinY2)}`;
        dSub += `M${f2(px)},${f2(xTopMinY1)}V${f2(xTopMinY2)}`;
      }
      const [rMinX1, rMinX2] = tickSpan(plotRight, 3, 1);
      const [lMinX1, lMinX2] = tickSpan(padL, 3, -1);
      for (let wD = gs.minW; wD <= gs.wMaxDisp + 1e-6; wD += gs.minW) {
        if (Math.abs(wD / gs.majW - Math.round(wD / gs.majW)) < 1e-4) continue;
        const py = yc(CoreDOM.dispToW(wD, units));
        if (py < padT - 0.5 || py > plotBottom + 0.5) continue;
        if (showRightY) dSub += `M${f2(rMinX1)},${f2(py)}H${f2(rMinX2)}`;
        if (showLeftY) dSub += `M${f2(lMinX1)},${f2(py)}H${f2(lMinX2)}`;
      }
      if (dSub) {
        axisParts.push(
          `<path d="${dSub}" fill="none" stroke="${esc(palette.border)}" stroke-width="0.8" stroke-opacity="0.6"/>`
        );
      }
    }

    // Top axis line in 'ashrae-open' mode so duplicated top Dry-Bulb ticks have a crisp rail
    if (ax.frame === 'ashrae-open') {
      axisParts.push(
        `<line x1="${padL}" y1="${padT}" x2="${plotRight}" y2="${padT}" stroke="${esc(palette.border)}" stroke-width="${f2(Math.max(0.9, borderLw * 0.85))}" stroke-opacity="0.88"/>`
      );
    }

    // X-axis major ticks & numeric labels (Bottom + Top duplicated scale)
    const [xMajY1, xMajY2] = tickSpan(plotBottom, 5.5, 1);
    const [xTopMajY1, xTopMajY2] = tickSpan(padT, 5.5, -1);
    const tStartTick = Math.ceil(gs.tMinDisp / gs.majT) * gs.majT;
    for (let tD = tStartTick; tD <= gs.tMaxDisp + 1e-6; tD += gs.majT) {
      const px = xc(CoreDOM.dispToT(tD, units));
      if (px < padL - 1 || px > plotRight + 1) continue;
      const lbl = Math.abs(tD) < 1e-6 ? '0' : String(Math.round(tD * 10) / 10);
      axisParts.push(
        `<line x1="${f2(px)}" y1="${f2(xMajY1)}" x2="${f2(px)}" y2="${f2(xMajY2)}" stroke="${esc(palette.border)}" stroke-width="1"/>` +
        `<text x="${f2(px)}" y="${f2(plotBottom + 18)}" text-anchor="middle" class="svg-mono" font-size="${axisPx}" fill="${esc(palette.muted)}">${esc(lbl)}</text>` +
        `<line x1="${f2(px)}" y1="${f2(xTopMajY1)}" x2="${f2(px)}" y2="${f2(xTopMajY2)}" stroke="${esc(palette.border)}" stroke-width="1"/>` +
        `<text x="${f2(px)}" y="${f2(padT - 10)}" text-anchor="middle" class="svg-mono" font-size="${axisPx}" fill="${esc(palette.muted)}">${esc(lbl)}</text>`
      );
    }

    // Y-axis major ticks & numeric labels (right-only | both | left)
    const [rMajX1, rMajX2] = tickSpan(plotRight, 5.5, 1);
    const [lMajX1, lMajX2] = tickSpan(padL, 5.5, -1);
    for (let wD = 0; wD <= gs.wMaxDisp + 1e-6; wD += gs.majW) {
      const py = yc(CoreDOM.dispToW(wD, units));
      if (py < padT - 1 || py > plotBottom + 1) continue;
      const lbl = String(Math.round(wD * 10) / 10);
      let yTickSvg = '';
      if (showLeftY) {
        yTickSvg +=
          `<line x1="${f2(lMajX1)}" y1="${f2(py)}" x2="${f2(lMajX2)}" y2="${f2(py)}" stroke="${esc(palette.border)}" stroke-width="1"/>` +
          `<text x="${f2(padL - 9)}" y="${f2(py)}" text-anchor="end" dominant-baseline="middle" class="svg-mono" font-size="${axisPx}" fill="${esc(palette.muted)}">${esc(lbl)}</text>`;
      }
      if (showRightY) {
        yTickSvg +=
          `<line x1="${f2(rMajX1)}" y1="${f2(py)}" x2="${f2(rMajX2)}" y2="${f2(py)}" stroke="${esc(palette.border)}" stroke-width="1"/>` +
          `<text x="${f2(plotRight + 9)}" y="${f2(py)}" text-anchor="start" dominant-baseline="middle" class="svg-mono" font-size="${axisPx}" fill="${esc(palette.muted)}">${esc(lbl)}</text>`;
      }
      if (yTickSvg) axisParts.push(yTickSvg);
    }

    // Y-axis unit tag above active humidity axis
    const wUnitTag = units === 'SI' ? 'g/kg' : 'gr/lb';
    if (showRightY) {
      axisParts.push(
        `<text x="${f2(plotRight + 7)}" y="${f2(padT - 7)}" text-anchor="start" class="svg-mono" font-size="${Math.max(8, axisPx - 1)}" font-weight="600" fill="${esc(palette.muted)}">${esc(wUnitTag)}</text>`
      );
    } else {
      axisParts.push(
        `<text x="${f2(padL - 7)}" y="${f2(padT - 7)}" text-anchor="end" class="svg-mono" font-size="${Math.max(8, axisPx - 1)}" font-weight="600" fill="${esc(palette.muted)}">${esc(wUnitTag)}</text>`
      );
    }

    // Optional Secondary Vapor Pressure (Pv) Scale on outer right margin (axisStyle.showDualPvScale)
    if (ax.showDualPvScale) {
      const pvRailX = showRightY ? (plotRight + 48) : (plotRight + 16);
      const pvMaxPa = pvFromW(wMax, pPa);
      const pvMaxDisp = pToDisp(pvMaxPa, units);
      if (Number.isFinite(pvMaxDisp) && pvMaxDisp > 1e-6) {
        const rawPvStep = pvMaxDisp / 7;
        const pvMag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, rawPvStep))));
        const pvNorm = rawPvStep / pvMag;
        const pvStep = (pvNorm <= 1.5 ? 1 : (pvNorm <= 3 ? 2 : (pvNorm <= 7 ? 5 : 10))) * pvMag;
        const pvDec = pvStep < 0.1 ? 2 : (pvStep < 1 ? 1 : 0);
        const pvUnitStr = units === 'SI' ? 'kPa' : 'psia';

        const [pvMajX1, pvMajX2] = tickSpan(pvRailX, 5, 1);
        const [pvMinX1, pvMinX2] = tickSpan(pvRailX, 2.8, 1);

        axisParts.push(
          `<line x1="${f2(pvRailX)}" y1="${padT}" x2="${f2(pvRailX)}" y2="${plotBottom}" ` +
          `stroke="${esc(palette.border)}" stroke-width="1" stroke-opacity="0.82"/>` +
          `<text x="${f2(pvRailX)}" y="${f2(padT - 7)}" text-anchor="start" class="svg-mono" ` +
          `font-size="${Math.max(8, axisPx - 1)}" font-weight="600" fill="${esc(palette.muted)}">${esc(`Pv (${pvUnitStr})`)}</text>`
        );

        let dPvSub = '';
        if (ax.showSubTicks !== false) {
          const pvSub = pvStep * 0.5;
          for (let pvD = pvSub; pvD <= pvMaxDisp + 1e-9; pvD += pvSub) {
            if (Math.abs(pvD / pvStep - Math.round(pvD / pvStep)) < 1e-4) continue;
            const pvPa = units === 'SI' ? (pvD * 1000) : (pvD * KPA_PER_PSI * 1000);
            if (pvPa >= pPa * 0.99) break;
            const py = yc(wFromPv(pvPa, pPa));
            if (py < padT - 0.5 || py > plotBottom + 0.5) continue;
            dPvSub += `M${f2(pvMinX1)},${f2(py)}H${f2(pvMinX2)}`;
          }
          if (dPvSub) {
            axisParts.push(
              `<path d="${dPvSub}" fill="none" stroke="${esc(palette.border)}" stroke-width="0.75" stroke-opacity="0.55"/>`
            );
          }
        }

        let lastPvY = Infinity;
        for (let pvD = 0; pvD <= pvMaxDisp + pvStep * 1e-4; pvD += pvStep) {
          const cleanPv = Math.round(pvD / pvStep) * pvStep;
          const pvPa = units === 'SI' ? (cleanPv * 1000) : (cleanPv * KPA_PER_PSI * 1000);
          if (pvPa >= pPa * 0.99) break;
          const py = yc(wFromPv(pvPa, pPa));
          if (py < padT - 1 || py > plotBottom + 1) continue;
          let pvTickSvg = `<line x1="${f2(pvMajX1)}" y1="${f2(py)}" x2="${f2(pvMajX2)}" y2="${f2(py)}" stroke="${esc(palette.border)}" stroke-width="0.95"/>`;
          if (Math.abs(py - lastPvY) >= 14) {
            const pvLbl = cleanPv.toFixed(pvDec);
            pvTickSvg +=
              `<text x="${f2(pvRailX + 8)}" y="${f2(py)}" text-anchor="start" dominant-baseline="middle" ` +
              `class="svg-mono" font-size="${Math.max(8, axisPx - 0.5)}" fill="${esc(palette.muted)}">${esc(pvLbl)}</text>`;
            lastPvY = py;
          }
          axisParts.push(pvTickSvg);
        }
      }
    }

    // X-axis titles (Bottom + Top duplicated scale)
    const xTitle = units === 'SI' ? 'Dry-Bulb Temperature (°C)' : 'Dry-Bulb Temperature (°F)';
    axisParts.push(
      `<text x="${f2(padL + plotW * 0.5)}" y="${f2(height - 16)}" text-anchor="middle" ` +
      `class="svg-sans" font-size="${axisPx + 1.5}" font-weight="600" fill="${esc(palette.fg)}">${esc(xTitle)}</text>` +
      `<text x="${f2(padL + plotW * 0.5)}" y="${f2(padT - 26)}" text-anchor="middle" ` +
      `class="svg-sans" font-size="${axisPx + 1.5}" font-weight="600" fill="${esc(palette.fg)}">${esc(xTitle)}</text>`
    );

    // Rotated Y-axis title (right margin or left margin when yAxisSide === 'left')
    const yTitle = units === 'SI'
      ? 'Humidity Ratio — g Water Vapour / kg Dry Air'
      : 'Humidity Ratio — Grains of Moisture / lb Dry Air';
    const yTitleX = showRightY ? (width - 16) : 18;
    const yTitleY = padT + plotH * 0.5;
    axisParts.push(
      `<text x="${f2(yTitleX)}" y="${f2(yTitleY)}" transform="rotate(-90 ${f2(yTitleX)} ${f2(yTitleY)})" ` +
      `text-anchor="middle" dominant-baseline="middle" class="svg-sans" font-size="${axisPx + 1.5}" font-weight="600" ` +
      `fill="${esc(palette.fg)}">${esc(yTitle)}</text>`
    );

    // Title block & Barometric stamp in top margin
    const dateStr = data.generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const titleStr = `${data.meta.name}${data.meta.version ? ' · ' + data.meta.version : ''}`;
    const subParts = [];
    if (data.meta.company) subParts.push(data.meta.company);
    if (data.meta.engineer) subParts.push(`Engineer: ${data.meta.engineer}`);
    const baroStamp = units === 'SI'
      ? `P = ${data.pressureKPa.toFixed(2)} kPa · Alt = ${Math.round(data.altM)} m · SI · ${dateStr}`
      : `P = ${data.pressurePsia.toFixed(2)} psia · Alt = ${Math.round(data.altDisp)} ft · IP · ${dateStr}`;

    axisParts.push(
      `<text x="${padL}" y="22" class="svg-sans" font-size="14" font-weight="700" fill="${esc(palette.fg)}">${esc(titleStr)}</text>`
    );
    if (subParts.length) {
      axisParts.push(
        `<text x="${padL}" y="38" class="svg-sans" font-size="10" fill="${esc(palette.muted)}">${esc(subParts.join('  |  '))}</text>`
      );
    }
    axisParts.push(
      `<text x="${plotRight}" y="21" text-anchor="end" class="svg-mono" font-size="10.5" font-weight="600" fill="${esc(palette.fg)}">${esc(baroStamp)}</text>` +
      `<text x="${plotRight}" y="36" text-anchor="end" class="svg-mono" font-size="9.5" fill="${esc(palette.muted)}">${esc('PsychroChart Ultra v' + APP_VERSION)}</text>`
    );

    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
      `  <defs>`,
      `    ${defsParts.join('\n    ')}`,
      `  </defs>`,
      `  <g id="background">`,
      `    ${bgParts.join('\n    ')}`,
      `  </g>`,
      `  <g id="grid" clip-path="url(#plot-clip)">`,
      `    ${gridParts.join('\n    ')}`,
      `  </g>`,
      `  <g id="weather-heatmap" clip-path="url(#plot-clip)">`,
      `    ${weatherParts.join('\n    ')}`,
      `  </g>`,
      `  <g id="comfort-zones" clip-path="url(#plot-clip)">`,
      `    ${zoneParts.join('\n    ')}`,
      `  </g>`,
      `  <g id="curves" clip-path="url(#plot-clip)">`,
      `    ${curveParts.join('\n    ')}`,
      `  </g>`,
      `  <g id="enthalpy-ruler">`,
      `    ${rulerParts.join('\n    ')}`,
      `  </g>`,
      `  <g id="processes" clip-path="url(#plot-clip)">`,
      `    ${procParts.join('\n    ')}`,
      `  </g>`,
      `  <g id="points">`,
      `    ${ptParts.join('\n    ')}`,
      `  </g>`,
      `  <g id="axes">`,
      `    ${axisParts.join('\n    ')}`,
      `  </g>`,
      `</svg>`
    ].join('\n');
  }

  function exportSVG(store, _baseRenderer, width = 1280, height = 800) {
    const data = extractProjectData(store);
    const svg = buildSVGString(store, width, height);
    const fname = `${sanitizeFilename(data.meta.name)}_${sanitizeFilename(data.meta.version, 'v1')}.svg`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, fname, true);
    notifyToast(`Vector SVG exported (${width}×${height})`, 'success');
    return { svg, filename: fname };
  }

  /* --------------------------------------------------------------------------
     4. Structured Engineering CSV Generator (Pure String, Node + Browser)
     -------------------------------------------------------------------------- */
  function csvCell(val) {
    const s = String(val ?? '');
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function csvRow(cells) {
    return cells.map(csvCell).join(',');
  }

  function buildCSVString(store) {
    const d = extractProjectData(store);
    const U = d.U;
    const wDec = d.units === 'SI' ? 2 : 1;
    const qDec = d.units === 'SI' ? 3 : 0;
    const lines = [];

    // Section 1: Project Metadata Header
    lines.push(csvRow(['PSYCHROCHART ULTRA ENGINEERING SCHEDULE']));
    lines.push(csvRow(['Software', `PsychroChart Ultra v${APP_VERSION}`]));
    lines.push(csvRow(['Project Name', d.meta.name]));
    lines.push(csvRow(['Version', d.meta.version]));
    lines.push(csvRow(['Company', d.meta.company]));
    lines.push(csvRow(['Engineer', d.meta.engineer]));
    lines.push(csvRow(['Exported At', d.generatedAt.toISOString()]));
    lines.push(csvRow(['Unit System', d.units === 'SI' ? 'SI (Metric)' : 'IP (Imperial)']));
    lines.push(csvRow(['Barometric Pressure', `${d.pressureDisp.toFixed(3)} ${U.P}`, `${d.pressureKPa.toFixed(3)} kPa`, `${d.pressurePsia.toFixed(3)} psia`]));
    lines.push(csvRow(['Altitude', `${d.altDisp.toFixed(1)} ${U.alt}`]));
    lines.push(csvRow([
      'Comfort Parameters',
      `Standard=${d.comfortCfg.standard === 'iso7730' ? 'ISO 7730' : 'ASHRAE 55-2023'}`,
      `Mode=${d.comfortCfg.mode}`,
      `Summer clo=${Comfort.fmtClo(d.comfortCfg.cloSummer)}`,
      `Winter clo=${Comfort.fmtClo(d.comfortCfg.cloWinter)}`,
      `Met=${d.comfortCfg.met}`,
      d.units === 'IP'
        ? `vAir=${Math.round(d.comfortCfg.vAir * FPM_PER_MPS)} fpm`
        : `vAir=${d.comfortCfg.vAir.toFixed(2)} m/s`,
      d.units === 'IP'
        ? `MRT Offset=${(d.comfortCfg.mrtOffset * 1.8).toFixed(1)} °F`
        : `MRT Offset=${d.comfortCfg.mrtOffset.toFixed(1)} °C`,
      `PMV Limit=±${d.comfortCfg.pmvLimit}`,
      `Humidity Cap=${d.comfortCfg.capHumidity ? (d.units === 'IP' ? '84 gr/lb' : '12 g/kg') : 'Uncapped'}`
    ]));
    lines.push('');

    // Section 2: Complete State Points Schedule
    lines.push(csvRow(['STATE POINTS SCHEDULE']));
    lines.push(csvRow([
      '#',
      'Label',
      `Tdb (${U.T})`,
      'RH (%)',
      `W (${U.W})`,
      `Twb (${U.T})`,
      `Tdp (${U.T})`,
      `h (${U.h})`,
      `v (${U.v})`,
      `rho_moist (${U.rho})`,
      `Pv (${U.P})`,
      'PMV',
      'PPD (%)',
      'Comfort Compliant',
      'Note'
    ]));
    for (const p of d.points) {
      lines.push(csvRow([
        p.idx,
        p.label,
        fmtNum(p.TdbDisp, 2, ''),
        fmtNum(p.rhPct, 1, ''),
        fmtNum(p.WDisp, wDec, ''),
        fmtNum(p.TwbDisp, 2, ''),
        fmtNum(p.TdpDisp, 2, ''),
        fmtNum(p.hDisp, 2, ''),
        fmtNum(p.vDisp, 4, ''),
        fmtNum(p.rhoDisp, 4, ''),
        fmtNum(p.pvDisp, 4, ''),
        fmtNum(p.pmv, 2, ''),
        fmtNum(p.ppd, 1, ''),
        p.compliant ? 'Yes' : 'No',
        p.note
      ]));
    }
    lines.push('');

    // Section 3: Complete Processes Schedule
    lines.push(csvRow(['PROCESSES & HVAC LOAD SCHEDULE']));
    lines.push(csvRow([
      'ID',
      'From',
      'To',
      'Classification',
      'Flow',
      `dT (${U.T})`,
      `dW (${U.W})`,
      `dh (${U.h})`,
      'SHR',
      `Qs (${U.Q})`,
      `Ql (${U.Q})`,
      `Qt (${U.Q})`,
      'Tons (TR)',
      `Water Rate (${U.water})`
    ]));
    for (const pr of d.processes) {
      lines.push(csvRow([
        pr.id,
        pr.fromLabel,
        pr.toLabel,
        pr.classification,
        pr.flowDisplay,
        fmtNum(pr.dTDisp, 2, ''),
        fmtNum(pr.dWDisp, wDec, ''),
        fmtNum(pr.dhDisp, 2, ''),
        fmtNum(pr.SHR, 3, ''),
        fmtNum(pr.QsDisp, qDec, ''),
        fmtNum(pr.QlDisp, qDec, ''),
        fmtNum(pr.QtDisp, qDec, ''),
        fmtNum(pr.tonsTR, 3, ''),
        fmtNum(pr.waterDisp, 2, '')
      ]));
    }
    lines.push('');
    lines.push(csvRow(['TOTAL COOLING / HEATING SUMMARY']));
    lines.push(csvRow(['Metric', `Sensible (${U.Q})`, `Latent (${U.Q})`, `Total (${U.Q})`, 'Tons (TR)', `Moisture (${U.water})`]));
    lines.push(csvRow([
      'Total Cooling Load',
      fmtNum(d.summary.totCoolQsDisp, qDec),
      fmtNum(d.summary.totCoolQlDisp, qDec),
      fmtNum(d.summary.totCoolDisp, qDec),
      fmtNum(d.summary.totCoolTR, 3),
      fmtNum(-d.summary.condensateDisp, 2)
    ]));
    lines.push(csvRow([
      'Total Heating Load',
      fmtNum(d.summary.totHeatQsDisp, qDec),
      fmtNum(d.summary.totHeatQlDisp, qDec),
      fmtNum(d.summary.totHeatDisp, qDec),
      '0.000',
      fmtNum(d.summary.humidAddDisp, 2)
    ]));
    lines.push(csvRow([
      'Net Cycle Transfer',
      '',
      '',
      fmtNum(d.summary.netQtDisp, qDec),
      fmtNum(d.summary.netQt_kW / KW_PER_TR, 3),
      fmtNum(d.summary.netMoistureDisp, 2)
    ]));

    // Section 4: Weather Bin Summary (if loaded)
    if (d.weather) {
      lines.push('');
      lines.push(csvRow(['ANNUAL WEATHER / CLIMATE BIN SUMMARY']));
      lines.push(csvRow(['Station / Location', d.weather.location]));
      lines.push(csvRow(['Total Hours', d.weather.totalHours]));
      lines.push(csvRow([`Min Tdb (${U.T})`, fmtNum(d.weather.minTDisp, 1, '')]));
      lines.push(csvRow([`Mean Tdb (${U.T})`, fmtNum(d.weather.meanTDisp, 1, '')]));
      lines.push(csvRow([`Max Tdb (${U.T})`, fmtNum(d.weather.maxTDisp, 1, '')]));
      lines.push(csvRow(['Comfort Hours', d.weather.comfortHours, `${d.weather.comfortPct.toFixed(1)}%`]));
      lines.push(csvRow(['Cooling Hours', d.weather.coolingHours]));
      lines.push(csvRow(['Heating Hours', d.weather.heatingHours]));
      lines.push(csvRow(['Dehumidification Hours', d.weather.dehumHours]));
      lines.push(csvRow(['Humidification Hours', d.weather.humidHours]));
      if (d.weather.bins.length) {
        lines.push(csvRow(['Dry-Bulb Bin', 'Hours', 'Share (%)', `Mean W (${U.W})`, `Mean h (${U.h})`]));
        for (const b of d.weather.bins) {
          lines.push(csvRow([
            b.label,
            b.hours,
            fmtNum(b.pct, 1, ''),
            fmtNum(b.meanWDisp, wDec, ''),
            fmtNum(b.meanHDisp, 2, '')
          ]));
        }
      }
    }

    return lines.join('\r\n') + '\r\n';
  }

  function exportCSV(store) {
    const d = extractProjectData(store);
    const csv = buildCSVString(store);
    const fname = `${sanitizeFilename(d.meta.name)}_${sanitizeFilename(d.meta.version, 'v1')}_schedule.csv`;
    // Prepend UTF-8 BOM for clean Excel rendering of °C, m³, ρ
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, fname, true);
    notifyToast('Engineering CSV exported', 'success');
    return { csv, filename: fname };
  }

  /* --------------------------------------------------------------------------
     5. Executive Print-Friendly HTML Engineering Report
     -------------------------------------------------------------------------- */
  function buildHTMLReportString(store, baseRenderer, overlayRenderer, opts = {}) {
    const includeChart = opts.includeChart !== false;
    const includeProc = opts.includeProc !== false;
    const includeComfort = opts.includeComfort !== false;
    const includeWeather = opts.includeWeather !== false;
    const printFriendly = !!opts.printFriendly;
    const chartFormat = opts.chartFormat || 'png';

    const d = extractProjectData(store);
    const U = d.U;
    const esc = CoreDOM.esc;
    const wDec = d.units === 'SI' ? 2 : 1;
    const qDec = d.units === 'SI' ? 2 : 0;

    let chartMarkup = '';
    if (includeChart) {
      if (chartFormat === 'svg' || !hasDOM() || !baseRenderer) {
        const svgStr = buildSVGString(store, 1280, 780);
        chartMarkup = `<div class="chart-svg-wrap">${svgStr}</div>`;
      } else {
        try {
          const { dataUrl } = renderCompositePNG(store, baseRenderer, overlayRenderer, {
            scale: 2, width: 1600, height: 1000, includeTitle: false
          });
          chartMarkup = `<img src="${dataUrl}" alt="Psychrometric Chart">`;
        } catch (_) {
          const svgStr = buildSVGString(store, 1280, 780);
          chartMarkup = `<div class="chart-svg-wrap">${svgStr}</div>`;
        }
      }
    }

    const dateStr = d.generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = d.generatedAt.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    // State Points 10-column table rows
    const stateRows = d.points.map((p, i) => `
      <tr class="${i % 2 ? 'alt' : ''}">
        <td class="num">${p.idx}</td>
        <td class="lbl-cell">
          <span class="swatch" style="background:${esc(p.color)}"></span>
          <span>${esc(p.label)}</span>
          ${p.locked ? '<span class="tag-lock" title="Locked">🔒</span>' : ''}
          ${p.note ? `<div class="sub-note">${esc(p.note)}</div>` : ''}
        </td>
        <td>${fmtNum(p.TdbDisp, 2)}</td>
        <td>${fmtNum(p.rhPct, 1)}</td>
        <td>${fmtNum(p.WDisp, wDec)}</td>
        <td>${fmtNum(p.TwbDisp, 2)}</td>
        <td>${fmtNum(p.TdpDisp, 2)}</td>
        <td>${fmtNum(p.hDisp, 2)}</td>
        <td>${fmtNum(p.vDisp, 3)}</td>
        <td>${fmtNum(p.rhoDisp, 3)}</td>
      </tr>`).join('');

    // Process & Load table rows
    const procRows = d.processes.map((pr, i) => `
      <tr class="${i % 2 ? 'alt' : ''}">
        <td class="num">${esc(pr.id)}</td>
        <td class="lbl-cell">${esc(pr.path)}</td>
        <td><span class="pill" style="--pc:${esc(pr.color)}">${esc(pr.classification)}</span></td>
        <td>${esc(pr.flowDisplay)}</td>
        <td>${fmtSigned(pr.dTDisp, 2)}</td>
        <td>${fmtSigned(pr.dWDisp, wDec)}</td>
        <td>${fmtSigned(pr.dhDisp, 2)}</td>
        <td>${fmtNum(pr.SHR, 3)}</td>
        <td>${pr.flowVal > 0 ? fmtSigned(pr.QsDisp, qDec) : '—'}</td>
        <td>${pr.flowVal > 0 ? fmtSigned(pr.QlDisp, qDec) : '—'}</td>
        <td class="bold">${pr.flowVal > 0 ? fmtSigned(pr.QtDisp, qDec) : '—'}</td>
        <td>${pr.flowVal > 0 ? fmtNum(Math.abs(pr.tonsTR), 2) : '—'}</td>
        <td>${pr.flowVal > 0 ? fmtSigned(pr.waterDisp, 2) : '—'}</td>
      </tr>`).join('');

    // Coil ADP / BPF rows
    const adpRowsHtml = d.coilAdpRows.map((c, i) => `
      <tr class="${i % 2 ? 'alt' : ''}">
        <td class="num">${esc(c.id)}</td>
        <td class="lbl-cell">${esc(c.path)}</td>
        <td>${fmtNum(c.enteringT, 1)} ${U.T} / ${fmtNum(c.enteringRH, 0)}%</td>
        <td>${fmtNum(c.leavingT, 1)} ${U.T} / ${fmtNum(c.leavingRH, 0)}%</td>
        <td class="bold">${fmtNum(c.adpTDisp, 2)} ${U.T}</td>
        <td>${fmtNum(c.adpWDisp, wDec)} ${U.W}</td>
        <td>${(c.BPF * 100).toFixed(1)}% (${c.BPF.toFixed(3)})</td>
        <td>${(c.CF * 100).toFixed(1)}%</td>
        <td>${fmtNum(c.SHR, 3)}</td>
        <td>${fmtNum(c.condensateDisp, 2)} ${U.water}</td>
      </tr>`).join('');

    // ASHRAE 55 / ISO 7730 Comfort & Mold Risk rows
    const showDcCol = !!d.comfortCfg.datacenter;
    const comfortRowsHtml = d.points.map((p, i) => `
      <tr class="${i % 2 ? 'alt' : ''}">
        <td class="num">${p.idx}</td>
        <td class="lbl-cell"><span class="swatch" style="background:${esc(p.color)}"></span>${esc(p.label)}</td>
        <td>${fmtNum(p.TdbDisp, 1)} ${U.T}</td>
        <td>${fmtNum(p.rhPct, 1)}%</td>
        <td>${fmtNum(p.TdpDisp, 1)} ${U.T}</td>
        <td>${fmtSigned(p.pmvSummer, 2)}</td>
        <td>${fmtSigned(p.pmvWinter, 2)}</td>
        <td>${fmtNum(p.ppd, 1)}%</td>
        <td><span class="pill" style="--pc:${p.compliant ? '#059669' : '#dc2626'}">${p.compliant ? 'Compliant' : 'Outside Zone'}</span></td>
        <td>${esc(p.comfortReason || p.sensation)}</td>
        ${showDcCol ? `<td>${esc(p.dataCenterClass || 'Outside A4')}</td>` : ''}
        <td><span class="pill" style="--pc:${esc(p.mold.color)}">${esc(p.mold.level)}</span></td>
      </tr>`).join('');

    // Weather Bin rows
    const maxBinPct = d.weather?.bins?.length ? Math.max(...d.weather.bins.map(b => b.pct), 1) : 1;
    const weatherBinsHtml = d.weather?.bins?.length ? d.weather.bins.map((b, i) => `
      <tr class="${i % 2 ? 'alt' : ''}">
        <td class="lbl-cell">${esc(b.label)}</td>
        <td>${b.hours.toLocaleString()}</td>
        <td>${b.pct.toFixed(1)}%</td>
        <td style="width:28%"><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (b.pct / maxBinPct) * 100).toFixed(1)}%"></div></div></td>
        <td>${fmtNum(b.meanWDisp, wDec)}</td>
        <td>${fmtNum(b.meanHDisp, 2)}</td>
      </tr>`).join('') : '';

    const pageOrientation = printFriendly ? 'A4 portrait' : 'A4 landscape';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.meta.name)} — Psychrometric Engineering Report</title>
<style>
  :root {
    --navy: #0f2942;
    --navy-2: #1b3f63;
    --accent: #0284c7;
    --emerald: #059669;
    --amber: #d97706;
    --crimson: #dc2626;
    --ink: #0f172a;
    --muted: #475569;
    --border: #cbd5e1;
    --surface: #f8fafc;
    --alt: #f1f5f9;
    --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --sans: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--sans);
    background: #eef2f7;
    color: var(--ink);
    font-size: 12px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  .toolbar {
    position: sticky; top: 0; z-index: 50;
    background: var(--navy); color: #fff;
    padding: 8px 20px; display: flex; align-items: center; justify-content: space-between;
    box-shadow: 0 2px 8px rgba(15,41,66,0.2);
  }
  .toolbar .tb-brand { font-weight: 700; font-size: 12px; letter-spacing: 0.04em; opacity: 0.92; }
  .toolbar button {
    background: var(--accent); color: #fff; border: 0; border-radius: 5px;
    padding: 6px 14px; font-weight: 600; font-size: 12px; cursor: pointer;
  }
  .toolbar button:hover { filter: brightness(1.1); }
  .sheet {
    max-width: 1120px; margin: 18px auto 32px; background: #fff;
    border: 1px solid var(--border); border-radius: 8px;
    padding: 26px 30px; box-shadow: 0 6px 24px rgba(15,23,42,0.06);
  }
  .banner {
    background: linear-gradient(135deg, var(--navy) 0%, var(--navy-2) 100%);
    color: #fff; border-radius: 8px; padding: 20px 24px; margin-bottom: 18px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .banner-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .banner-kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #7dd3fc; margin-bottom: 4px; }
  .banner h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; }
  .banner-sub { font-size: 13px; color: #cbd5e1; margin-top: 3px; }
  .banner-stamp {
    text-align: right; font-family: var(--mono); font-size: 11px; color: #e2e8f0;
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16);
    padding: 8px 12px; border-radius: 6px;
  }
  .meta-strip {
    display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 14px; padding-top: 12px;
    border-top: 1px solid rgba(255,255,255,0.16); font-size: 11px; color: #e2e8f0;
  }
  .meta-strip strong { color: #93c5fd; font-weight: 600; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.06em; margin-right: 4px; }
  .kpi-grid {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 18px;
  }
  .kpi-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 7px;
    padding: 11px 13px; border-top: 3px solid var(--kc, var(--accent));
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .kpi-lbl { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .kpi-val { font-family: var(--mono); font-size: 17px; font-weight: 700; color: var(--ink); margin-top: 3px; }
  .kpi-sub { font-family: var(--mono); font-size: 10px; color: var(--muted); margin-top: 2px; }
  .section { margin-top: 20px; page-break-inside: avoid; break-inside: avoid; }
  .sec-head {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 2px solid var(--navy); padding-bottom: 5px; margin-bottom: 10px;
  }
  .sec-head h2 { font-size: 14px; font-weight: 800; color: var(--navy); letter-spacing: 0.01em; text-transform: uppercase; }
  .sec-head .sec-meta { font-family: var(--mono); font-size: 10.5px; color: var(--muted); }
  .chart-box {
    border: 1px solid var(--border); border-radius: 6px; padding: 8px; background: #fff;
  }
  .chart-box img, .chart-box svg { width: 100%; height: auto; display: block; border-radius: 4px; }
  .caption { text-align: center; font-size: 10.5px; color: var(--muted); margin-top: 6px; font-style: italic; }
  table.eng {
    width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid var(--border);
  }
  table.eng thead th {
    background: var(--navy); color: #fff; font-weight: 600; font-size: 9.5px;
    text-transform: uppercase; letter-spacing: 0.04em; padding: 7px 6px;
    text-align: center; border: 1px solid var(--navy-2);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  table.eng thead th.left { text-align: left; }
  table.eng tbody td, table.eng tfoot td {
    padding: 5.5px 6px; text-align: center; border: 1px solid var(--border);
    font-family: var(--mono); font-variant-numeric: tabular-nums;
  }
  table.eng tbody td.num { color: var(--muted); font-weight: 700; width: 34px; }
  table.eng tbody td.lbl-cell { font-family: var(--sans); text-align: left; font-weight: 600; color: var(--ink); }
  table.eng tbody td.bold { font-weight: 700; }
  table.eng tbody tr.alt { background: var(--alt); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table.eng tfoot td {
    background: #e2e8f0; font-weight: 700; color: var(--navy);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .swatch {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    margin-right: 6px; vertical-align: middle;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .tag-lock { font-size: 10px; margin-left: 4px; }
  .sub-note { font-size: 9.5px; color: var(--muted); font-weight: 400; margin-top: 2px; }
  .pill {
    display: inline-block; padding: 2px 7px; border-radius: 10px; font-family: var(--sans);
    font-size: 9.5px; font-weight: 700; color: var(--pc, var(--navy));
    background: color-mix(in srgb, var(--pc, var(--navy)) 13%, white);
    border: 1px solid color-mix(in srgb, var(--pc, var(--navy)) 35%, transparent);
    white-space: nowrap;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .rollup-strip {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px;
  }
  .rollup-box {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 9px 12px;
    font-size: 11px;
  }
  .rollup-box h4 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 4px; }
  .rollup-box .rv { font-family: var(--mono); font-weight: 700; color: var(--navy); font-size: 12.5px; }
  .weather-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 10px; }
  .wk { background: var(--surface); border: 1px solid var(--border); border-radius: 5px; padding: 7px 9px; text-align: center; }
  .wk .wkl { font-size: 9px; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  .wk .wkv { font-family: var(--mono); font-size: 13px; font-weight: 700; color: var(--navy); margin-top: 2px; }
  .bar-track { width: 100%; height: 9px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--navy-2)); border-radius: 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .notes-grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 14px; }
  .notes-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px;
  }
  .notes-card h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--navy); margin-bottom: 6px; }
  .notes-card p, .notes-card li { font-size: 10.5px; color: var(--muted); margin-bottom: 4px; }
  .notes-card ul { padding-left: 16px; }
  .signoff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-top: 8px; }
  .sig-line { border-bottom: 1px solid #94a3b8; padding-top: 18px; font-size: 9.5px; color: var(--muted); }
  .sig-line span { display: block; margin-top: 3px; font-weight: 600; color: var(--ink); }
  .report-footer {
    margin-top: 22px; padding-top: 10px; border-top: 1px solid var(--border);
    display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); font-family: var(--mono);
  }
  @page { size: ${pageOrientation}; margin: 10mm; }
  @media print {
    body { background: #fff; font-size: ${printFriendly ? '10px' : '11px'}; }
    .no-print { display: none !important; }
    .sheet { max-width: 100%; margin: 0; border: 0; border-radius: 0; box-shadow: none; padding: 0; }
    .kpi-grid { gap: 6px; }
    .kpi-val { font-size: 14px; }
    table.eng { font-size: ${printFriendly ? '9px' : '9.8px'}; }
    table.eng thead th, table.eng tbody td { padding: 3.5px 4px; }
  }
</style>
</head>
<body>
<div class="toolbar no-print">
  <span class="tb-brand">PSYCHRO·ULTRA v${esc(APP_VERSION)} — ENGINEERING REPORT PREVIEW</span>
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="sheet">
  <header class="banner">
    <div class="banner-top">
      <div>
        <div class="banner-kicker">Psychrometric Engineering Analysis Report</div>
        <h1>${esc(d.meta.name)}</h1>
        <div class="banner-sub">${d.meta.version ? 'Revision ' + esc(d.meta.version) : 'Engineering Calculation Submittal'}${d.meta.company ? ' · ' + esc(d.meta.company) : ''}</div>
      </div>
      <div class="banner-stamp">
        <div>${d.pressureKPa.toFixed(2)} kPa (${d.pressurePsia.toFixed(2)} psia)</div>
        <div>Alt: ${Math.round(d.altM)} m (${Math.round(d.altM * FT_PER_M)} ft)</div>
        <div>Units: ${d.units === 'SI' ? 'SI Metric' : 'IP Imperial'}</div>
      </div>
    </div>
    <div class="meta-strip">
      ${d.meta.company ? `<div><strong>Company</strong>${esc(d.meta.company)}</div>` : ''}
      ${d.meta.engineer ? `<div><strong>Engineer</strong>${esc(d.meta.engineer)}</div>` : ''}
      <div><strong>Date</strong>${esc(dateStr)}</div>
      <div><strong>State Points</strong>${d.points.length}</div>
      <div><strong>Processes</strong>${d.processes.length}</div>
      <div><strong>Software</strong>PsychroChart Ultra v${esc(APP_VERSION)}</div>
    </div>
  </header>

  <section class="kpi-grid">
    <div class="kpi-card" style="--kc:#0284c7">
      <div class="kpi-lbl">Total Cooling Load</div>
      <div class="kpi-val">${fmtNum(d.summary.totCoolDisp, qDec)} ${U.Q}</div>
      <div class="kpi-sub">${fmtNum(d.summary.totCoolTR, 2)} TR (${fmtNum(d.summary.totCoolQt_kW, 2)} kW)</div>
    </div>
    <div class="kpi-card" style="--kc:#dc2626">
      <div class="kpi-lbl">Total Heating Load</div>
      <div class="kpi-val">${fmtNum(d.summary.totHeatDisp, qDec)} ${U.Q}</div>
      <div class="kpi-sub">Sens: ${fmtNum(d.summary.totHeatQsDisp, qDec)} ${U.Q}</div>
    </div>
    <div class="kpi-card" style="--kc:#0891b2">
      <div class="kpi-lbl">Net Moisture Transfer</div>
      <div class="kpi-val">${fmtSigned(d.summary.netMoistureDisp, 2)} ${U.water}</div>
      <div class="kpi-sub">Cond: ${fmtNum(d.summary.condensateDisp, 2)} · Hum: +${fmtNum(d.summary.humidAddDisp, 2)}</div>
    </div>
    <div class="kpi-card" style="--kc:#4f46e5">
      <div class="kpi-lbl">State Points / Processes</div>
      <div class="kpi-val">${d.points.length} / ${d.processes.length}</div>
      <div class="kpi-sub">${d.coilAdpRows.length} cooling coil process(es)</div>
    </div>
    <div class="kpi-card" style="--kc:#059669">
      <div class="kpi-lbl">ASHRAE 55 Compliance</div>
      <div class="kpi-val">${d.summary.compliantCount} / ${d.points.length}</div>
      <div class="kpi-sub">${d.points.length ? d.summary.compliantPct.toFixed(0) + '% within PMV ±' + d.comfortCfg.pmvLimit : 'No points plotted'}</div>
    </div>
  </section>

  ${includeChart && chartMarkup ? `
  <section class="section">
    <div class="sec-head">
      <h2>1. Psychrometric Chart</h2>
      <span class="sec-meta">Range: ${fmtNum(CoreDOM.tToDisp(d.view.tMin, d.units), 0)} to ${fmtNum(CoreDOM.tToDisp(d.view.tMax, d.units), 0)} ${U.T} · Wmax ${fmtNum(CoreDOM.wToDisp(d.view.wMax, d.units), 0)} ${U.W}</span>
    </div>
    <div class="chart-box">${chartMarkup}</div>
    <div class="caption">Figure 1: ${esc(d.meta.name)} — Barometric Pressure ${d.pressureKPa.toFixed(2)} kPa (${Math.round(d.altM)} m elevation), ASHRAE 2021 Hyland-Wexler Model.</div>
  </section>` : ''}

  <section class="section">
    <div class="sec-head">
      <h2>${includeChart ? '2' : '1'}. State Points Schedule</h2>
      <span class="sec-meta">${d.points.length} state point(s) · P = ${d.pressureDisp.toFixed(2)} ${U.P}</span>
    </div>
    ${d.points.length ? `
    <table class="eng">
      <thead>
        <tr>
          <th>#</th>
          <th class="left">State Point Label</th>
          <th>Tdb (${U.T})</th>
          <th>RH (%)</th>
          <th>W (${U.W})</th>
          <th>Twb (${U.T})</th>
          <th>Tdp (${U.T})</th>
          <th>h (${U.h})</th>
          <th>v (${U.v})</th>
          <th>ρ_moist (${U.rho})</th>
        </tr>
      </thead>
      <tbody>${stateRows}</tbody>
    </table>` : '<p style="color:var(--muted);font-style:italic">No state points defined in this project.</p>'}
  </section>

  ${includeProc && d.processes.length ? `
  <section class="section">
    <div class="sec-head">
      <h2>Process &amp; Psychrometric Load Schedule</h2>
      <span class="sec-meta">${d.processes.length} process(es)</span>
    </div>
    <table class="eng">
      <thead>
        <tr>
          <th>ID</th>
          <th class="left">Process Path</th>
          <th>Classification</th>
          <th>Flow</th>
          <th>ΔT (${U.T})</th>
          <th>ΔW (${U.W})</th>
          <th>Δh (${U.h})</th>
          <th>SHR</th>
          <th>Qs (${U.Q})</th>
          <th>Ql (${U.Q})</th>
          <th>Qt (${U.Q})</th>
          <th>Tons (TR)</th>
          <th>Water (${U.water})</th>
        </tr>
      </thead>
      <tbody>${procRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="8" style="text-align:right;font-family:var(--sans)">Total Cycle Net Rollup (Heating − Cooling)</td>
          <td>${fmtSigned(d.summary.totHeatQsDisp - d.summary.totCoolQsDisp, qDec)}</td>
          <td>${fmtSigned(d.summary.totHeatQlDisp - d.summary.totCoolQlDisp, qDec)}</td>
          <td>${fmtSigned(d.summary.netQtDisp, qDec)}</td>
          <td>${fmtNum(d.summary.totCoolTR, 2)} TR</td>
          <td>${fmtSigned(d.summary.netMoistureDisp, 2)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="rollup-strip">
      <div class="rollup-box">
        <h4>Total Cooling Rollup</h4>
        <div class="rv">${fmtNum(d.summary.totCoolDisp, qDec)} ${U.Q} (${fmtNum(d.summary.totCoolTR, 2)} TR)</div>
        <div>Sensible: ${fmtNum(d.summary.totCoolQsDisp, qDec)} ${U.Q} · Latent: ${fmtNum(d.summary.totCoolQlDisp, qDec)} ${U.Q}</div>
      </div>
      <div class="rollup-box">
        <h4>Total Heating Rollup</h4>
        <div class="rv">${fmtNum(d.summary.totHeatDisp, qDec)} ${U.Q}</div>
        <div>Sensible: ${fmtNum(d.summary.totHeatQsDisp, qDec)} ${U.Q} · Latent: ${fmtNum(d.summary.totHeatQlDisp, qDec)} ${U.Q}</div>
      </div>
      <div class="rollup-box">
        <h4>Moisture Balance</h4>
        <div class="rv">${fmtSigned(d.summary.netMoistureDisp, 2)} ${U.water}</div>
        <div>Condensate Removed: ${fmtNum(d.summary.condensateDisp, 2)} ${U.water} · Humidification: +${fmtNum(d.summary.humidAddDisp, 2)} ${U.water}</div>
      </div>
    </div>
  </section>` : ''}

  ${includeProc && d.coilAdpRows.length ? `
  <section class="section">
    <div class="sec-head">
      <h2>Cooling Coil Apparatus Dew Point (ADP) &amp; Bypass Factor</h2>
      <span class="sec-meta">${d.coilAdpRows.length} cooling coil process(es)</span>
    </div>
    <table class="eng">
      <thead>
        <tr>
          <th>ID</th>
          <th class="left">Coil Process</th>
          <th>Entering Air</th>
          <th>Leaving Air</th>
          <th>ADP Temp</th>
          <th>ADP W</th>
          <th>Bypass Factor (BPF)</th>
          <th>Contact Factor</th>
          <th>SHR</th>
          <th>Condensate</th>
        </tr>
      </thead>
      <tbody>${adpRowsHtml}</tbody>
    </table>
  </section>` : ''}

  ${includeComfort && d.points.length ? `
  <section class="section">
    <div class="sec-head">
      <h2>${d.comfortCfg.standard === 'iso7730' ? 'ISO 7730' : 'ASHRAE 55'} Thermal Comfort &amp; Mold Risk Evaluation</h2>
      <span class="sec-meta">${esc(formatComfortMetaSummary(d.comfortCfg, d.units))}</span>
    </div>
    <table class="eng">
      <thead>
        <tr>
          <th>#</th>
          <th class="left">State Point</th>
          <th>Tdb</th>
          <th>RH%</th>
          <th>Tdp (Cond. Limit)</th>
          <th>PMV (Sum)</th>
          <th>PMV (Win)</th>
          <th>Active PPD%</th>
          <th>${d.comfortCfg.standard === 'iso7730' ? 'ISO 7730' : 'ASHRAE 55'}</th>
          <th>Sensation / Status</th>
          ${showDcCol ? '<th>TC 9.9 Class</th>' : ''}
          <th>Mold / Cond. Risk</th>
        </tr>
      </thead>
      <tbody>${comfortRowsHtml}</tbody>
    </table>
  </section>` : ''}

  ${includeWeather && d.weather ? `
  <section class="section">
    <div class="sec-head">
      <h2>Annual Climate &amp; Psychrometric Weather Bin Summary</h2>
      <span class="sec-meta">${esc(d.weather.location)} · ${d.weather.totalHours.toLocaleString()} hrs</span>
    </div>
    <div class="weather-kpis">
      <div class="wk"><div class="wkl">Min / Max Tdb</div><div class="wkv">${fmtNum(d.weather.minTDisp, 1)} / ${fmtNum(d.weather.maxTDisp, 1)} ${U.T}</div></div>
      <div class="wk"><div class="wkl">Mean Tdb</div><div class="wkv">${fmtNum(d.weather.meanTDisp, 1)} ${U.T}</div></div>
      <div class="wk"><div class="wkl">Comfort Hours</div><div class="wkv">${d.weather.comfortHours.toLocaleString()} (${d.weather.comfortPct.toFixed(1)}%)</div></div>
      <div class="wk"><div class="wkl">Cooling Hours</div><div class="wkv">${d.weather.coolingHours.toLocaleString()}</div></div>
      <div class="wk"><div class="wkl">Heating Hours</div><div class="wkv">${d.weather.heatingHours.toLocaleString()}</div></div>
      <div class="wk"><div class="wkl">Dehum / Humid</div><div class="wkv">${d.weather.dehumHours.toLocaleString()} / ${d.weather.humidHours.toLocaleString()}</div></div>
    </div>
    ${weatherBinsHtml ? `
    <table class="eng">
      <thead>
        <tr>
          <th class="left">Dry-Bulb Bin</th>
          <th>Hours</th>
          <th>Annual Share</th>
          <th>Distribution</th>
          <th>Mean W (${U.W})</th>
          <th>Mean h (${U.h})</th>
        </tr>
      </thead>
      <tbody>${weatherBinsHtml}</tbody>
    </table>` : ''}
  </section>` : ''}

  <section class="section">
    <div class="sec-head">
      <h2>Engineering Methodology, Notes &amp; Sign-Off</h2>
      <span class="sec-meta">ASHRAE Fundamentals (2021)</span>
    </div>
    <div class="notes-grid">
      <div class="notes-card">
        <h3>Standards &amp; Calculation Basis</h3>
        <ul>
          <li><strong>Psychrometric Properties:</strong> ASHRAE Handbook — Fundamentals (2021), Chapter 1. Hyland-Wexler saturation vapor pressure over liquid water (≥ 0°C) and ice (&lt; 0°C), exact adiabatic wet-bulb formulation, and true 0°F IP enthalpy datum.</li>
          <li><strong>Thermal Comfort:</strong> ANSI/ASHRAE Standard 55-2020 &amp; ISO 7730 Fanger PMV/PPD model with humidity ratio upper limit W ≤ 0.012 kg/kg.</li>
          <li><strong>Moisture &amp; Mold Risk:</strong> ASHRAE Standard 160 / IEA Annex 14 surface dew-point and RH risk bands.</li>
          ${d.meta.notes ? `<li><strong>Project Notes:</strong> ${esc(d.meta.notes)}</li>` : ''}
        </ul>
      </div>
      <div class="notes-card">
        <h3>Engineering Review &amp; Sign-Off</h3>
        <div class="signoff-grid">
          <div class="sig-line">Prepared By<span>${esc(d.meta.engineer || '—')}</span></div>
          <div class="sig-line">Date<span>${esc(dateStr)}</span></div>
          <div class="sig-line">Checked By<span>&nbsp;</span></div>
          <div class="sig-line">Approved By<span>&nbsp;</span></div>
        </div>
      </div>
    </div>
  </section>

  <footer class="report-footer">
    <span>PsychroChart Ultra v${esc(APP_VERSION)} · ${esc(d.meta.name)}</span>
    <span>Generated ${esc(timeStr)}</span>
  </footer>
</div>
</body>
</html>`;
  }

  function generateHTMLReport(store, baseRenderer, overlayRenderer, opts = {}) {
    const d = extractProjectData(store);
    const html = buildHTMLReportString(store, baseRenderer, overlayRenderer, opts);
    const fname = `${sanitizeFilename(d.meta.name)}_${sanitizeFilename(d.meta.version, 'v1')}_report.html`;
    if (hasDOM()) {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      triggerDownload(blob, fname, true);
      notifyToast('HTML engineering report downloaded', 'success');
    }
    return { html, filename: fname };
  }

  /* --------------------------------------------------------------------------
     6. Microsoft Word (.docx) Report Generator (Dynamic docx@9.1.0 UMD Loader)
     -------------------------------------------------------------------------- */
  function loadDocxUMD() {
    return new Promise((resolve, reject) => {
      if (!hasDOM()) {
        reject(new Error('DOCX generation requires a browser environment'));
        return;
      }
      if (window.docx) {
        resolve(window.docx);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/docx@9.1.0/build/index.umd.js';
      script.async = true;
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error('Timed out loading docx@9.1.0 from jsDelivr CDN (offline?). Use HTML Report + Print to PDF instead.'));
      }, 15000);
      script.onload = () => {
        clearTimeout(timer);
        if (window.docx) {
          resolve(window.docx);
        } else {
          reject(new Error('docx global not exposed after CDN script load'));
        }
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Network unavailable for docx@9.1.0 CDN. Use HTML Report + Print to PDF for offline reporting.'));
      };
      document.head.appendChild(script);
    });
  }

  function base64ToUint8Array(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function generateDOCXReport(store, baseRenderer, overlayRenderer, opts = {}) {
    const includeChart = opts.includeChart !== false;
    const includeProc = opts.includeProc !== false;
    const includeComfort = opts.includeComfort !== false;
    const includeWeather = opts.includeWeather !== false;

    notifyToast('Loading Word (.docx) export engine...', 'info');
    let lib;
    try {
      lib = await loadDocxUMD();
    } catch (err) {
      notifyToast(err.message || 'Unable to load docx library (offline?)', 'error');
      return { ok: false, error: err.message };
    }

    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
      Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
      PageNumber, TabStopType, TabStopPosition
    } = lib;

    const d = extractProjectData(store);
    const U = d.U;
    const wDec = d.units === 'SI' ? 2 : 1;
    const qDec = d.units === 'SI' ? 2 : 0;
    const dateStr = d.generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const PAGE_W = 12240; // 8.5 in Letter width in twips
    const MARGIN = { top: 960, right: 960, bottom: 960, left: 960 };
    const CW = PAGE_W - MARGIN.left - MARGIN.right; // 10320 twips
    const bdr = (color = 'CBD5E1', size = 4) => ({ style: BorderStyle.SINGLE, size, color });
    const cellBorders = { top: bdr(), bottom: bdr(), left: bdr(), right: bdr() };
    const cellMargins = { top: 55, bottom: 55, left: 75, right: 75 };

    const makeHeading = (text) => new Paragraph({
      spacing: { before: 240, after: 90 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '0F2942', space: 3 } },
      children: [new TextRun({ text, font: 'Arial', size: 24, bold: true, color: '0F2942' })]
    });

    const makeTable = (headers, rows, colWidths, leftCols = new Set([1]), footerRow = null) => {
      const hRow = new TableRow({
        tableHeader: true,
        children: headers.map((h, ci) => new TableCell({
          width: { size: colWidths[ci], type: WidthType.DXA },
          borders: cellBorders,
          shading: { fill: '0F2942', type: ShadingType.CLEAR },
          margins: cellMargins,
          children: [new Paragraph({
            alignment: leftCols.has(ci) ? AlignmentType.LEFT : AlignmentType.CENTER,
            children: [new TextRun({ text: String(h), font: 'Arial', size: 15, bold: true, color: 'FFFFFF' })]
          })]
        }))
      });

      const dRows = rows.map((row, ri) => new TableRow({
        children: row.map((val, ci) => new TableCell({
          width: { size: colWidths[ci], type: WidthType.DXA },
          borders: cellBorders,
          shading: ri % 2 ? { fill: 'F1F5F9', type: ShadingType.CLEAR } : undefined,
          margins: cellMargins,
          children: [new Paragraph({
            alignment: leftCols.has(ci) ? AlignmentType.LEFT : AlignmentType.CENTER,
            children: [new TextRun({ text: String(val), font: 'Arial', size: 15, color: '0F172A' })]
          })]
        }))
      }));

      const allRows = [hRow, ...dRows];
      if (footerRow) {
        allRows.push(new TableRow({
          children: footerRow.map((val, ci) => new TableCell({
            width: { size: colWidths[ci], type: WidthType.DXA },
            borders: cellBorders,
            shading: { fill: 'E2E8F0', type: ShadingType.CLEAR },
            margins: cellMargins,
            children: [new Paragraph({
              alignment: leftCols.has(ci) ? AlignmentType.LEFT : AlignmentType.CENTER,
              children: [new TextRun({ text: String(val), font: 'Arial', size: 15, bold: true, color: '0F2942' })]
            })]
          }))
        }));
      }

      return new Table({
        width: { size: CW, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: allRows
      });
    };

    const children = [];

    // Title Banner
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: 'PSYCHROMETRIC ENGINEERING ANALYSIS REPORT', font: 'Arial', size: 30, bold: true, color: '0F2942' })]
    }));
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({
        text: `${d.meta.name}${d.meta.version ? ' — ' + d.meta.version : ''}`,
        font: 'Arial', size: 22, bold: true, color: '0284C7'
      })]
    }));

    const metaParts = [];
    if (d.meta.company) metaParts.push(`Company: ${d.meta.company}`);
    if (d.meta.engineer) metaParts.push(`Engineer: ${d.meta.engineer}`);
    metaParts.push(`Date: ${dateStr}`);
    metaParts.push(`Pressure: ${d.pressureKPa.toFixed(2)} kPa (${Math.round(d.altM)} m)`);
    metaParts.push(`Units: ${d.units === 'SI' ? 'SI (Metric)' : 'IP (Imperial)'}`);

    children.push(new Paragraph({
      spacing: { after: 180 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 6 } },
      children: [new TextRun({ text: metaParts.join('   |   '), font: 'Arial', size: 17, color: '475569' })]
    }));

    // Executive KPI Summary Table
    children.push(makeTable(
      ['Total Cooling', 'Total Heating', 'Net Moisture Transfer', 'State Points / Procs', 'ASHRAE 55 Compliance'],
      [[
        `${fmtNum(d.summary.totCoolDisp, qDec)} ${U.Q} (${fmtNum(d.summary.totCoolTR, 2)} TR)`,
        `${fmtNum(d.summary.totHeatDisp, qDec)} ${U.Q}`,
        `${fmtSigned(d.summary.netMoistureDisp, 2)} ${U.water}`,
        `${d.points.length} pts / ${d.processes.length} procs`,
        `${d.summary.compliantCount}/${d.points.length} (${d.summary.compliantPct.toFixed(0)}%)`
      ]],
      [2320, 1900, 2200, 1900, 2000],
      new Set()
    ));

    // Embedded Chart PNG
    if (includeChart && baseRenderer) {
      try {
        const { dataUrl } = renderCompositePNG(store, baseRenderer, overlayRenderer, {
          scale: 2, width: 1600, height: 1000, includeTitle: false
        });
        const imgData = base64ToUint8Array(dataUrl.replace(/^data:image\/png;base64,/, ''));
        children.push(makeHeading('1. Psychrometric Chart'));
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 60 },
          children: [new ImageRun({
            type: 'png',
            data: imgData,
            transformation: { width: 624, height: 390 },
            altText: { title: 'Psychrometric Chart', description: d.meta.name, name: 'psychro_chart' }
          })]
        }));
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({
            text: `Figure 1: ${d.meta.name} — ${d.pressureKPa.toFixed(2)} kPa (${Math.round(d.altM)} m elevation)`,
            font: 'Arial', size: 16, italics: true, color: '64748B'
          })]
        }));
      } catch (_) { /* continue without image if canvas fails */ }
    }

    // State Points Schedule
    children.push(makeHeading('State Points Schedule'));
    if (d.points.length) {
      children.push(makeTable(
        ['#', 'Label', `Tdb (${U.T})`, 'RH%', `W (${U.W})`, `Twb (${U.T})`, `Tdp (${U.T})`, `h (${U.h})`, `v (${U.v})`, `ρ (${U.rho})`],
        d.points.map(p => [
          p.idx,
          p.label + (p.locked ? ' [L]' : ''),
          fmtNum(p.TdbDisp, 2),
          fmtNum(p.rhPct, 1),
          fmtNum(p.WDisp, wDec),
          fmtNum(p.TwbDisp, 2),
          fmtNum(p.TdpDisp, 2),
          fmtNum(p.hDisp, 2),
          fmtNum(p.vDisp, 3),
          fmtNum(p.rhoDisp, 3)
        ]),
        [450, 1690, 960, 760, 980, 960, 960, 960, 1300, 1300],
        new Set([1])
      ));
    } else {
      children.push(new Paragraph({ children: [new TextRun({ text: 'No state points defined.', font: 'Arial', size: 18, italics: true, color: '64748B' })] }));
    }

    // Processes & Loads Table (with Qs, Ql, Qt, SHR)
    if (includeProc && d.processes.length) {
      children.push(makeHeading('Processes & HVAC Load Schedule'));
      children.push(makeTable(
        ['ID', 'Path', 'Classification', 'Flow', `ΔT (${U.T})`, `Δh (${U.h})`, 'SHR', `Qs (${U.Q})`, `Ql (${U.Q})`, `Qt (${U.Q})`],
        d.processes.map(pr => [
          pr.id,
          pr.path,
          pr.classification,
          pr.flowDisplay,
          fmtSigned(pr.dTDisp, 1),
          fmtSigned(pr.dhDisp, 2),
          fmtNum(pr.SHR, 3),
          pr.flowVal > 0 ? fmtSigned(pr.QsDisp, qDec) : '—',
          pr.flowVal > 0 ? fmtSigned(pr.QlDisp, qDec) : '—',
          pr.flowVal > 0 ? fmtSigned(pr.QtDisp, qDec) : '—'
        ]),
        [520, 1780, 1660, 1060, 820, 880, 720, 960, 960, 960],
        new Set([1, 2]),
        [
          'NET',
          'Cycle Rollup (Heat − Cool)',
          `Cool: ${fmtNum(d.summary.totCoolTR, 2)} TR`,
          '',
          '',
          '',
          '',
          fmtSigned(d.summary.totHeatQsDisp - d.summary.totCoolQsDisp, qDec),
          fmtSigned(d.summary.totHeatQlDisp - d.summary.totCoolQlDisp, qDec),
          fmtSigned(d.summary.netQtDisp, qDec)
        ]
      ));

      if (d.coilAdpRows.length) {
        children.push(makeHeading('Cooling Coil ADP & Bypass Factor'));
        children.push(makeTable(
          ['ID', 'Coil Path', `ADP (${U.T})`, `ADP W (${U.W})`, 'BPF', 'Contact Factor', 'SHR', `Condensate (${U.water})`],
          d.coilAdpRows.map(c => [
            c.id,
            c.path,
            fmtNum(c.adpTDisp, 2),
            fmtNum(c.adpWDisp, wDec),
            `${(c.BPF * 100).toFixed(1)}%`,
            `${(c.CF * 100).toFixed(1)}%`,
            fmtNum(c.SHR, 3),
            fmtNum(c.condensateDisp, 2)
          ]),
          [600, 2400, 1180, 1220, 1080, 1260, 980, 1600],
          new Set([1])
        ));
      }
    }

    // Thermal Comfort & Mold Risk
    if (includeComfort && d.points.length) {
      children.push(makeHeading(`${d.comfortCfg.standard === 'iso7730' ? 'ISO 7730' : 'ASHRAE 55'} Thermal Comfort & Mold Risk`));
      children.push(makeTable(
        ['#', 'State Point', 'PMV (Sum)', 'PMV (Win)', 'Active PPD%', d.comfortCfg.standard === 'iso7730' ? 'ISO 7730' : 'ASHRAE 55', 'Status / Sensation', 'Mold Risk'],
        d.points.map(p => [
          p.idx,
          p.label,
          fmtSigned(p.pmvSummer, 2),
          fmtSigned(p.pmvWinter, 2),
          `${fmtNum(p.ppd, 1)}%`,
          p.compliant ? 'Compliant' : 'Outside',
          p.comfortReason || p.sensation,
          p.mold.level
        ]),
        [520, 2200, 1100, 1100, 1100, 1340, 1500, 1400],
        new Set([1])
      ));
    }

    // Weather Summary
    if (includeWeather && d.weather) {
      children.push(makeHeading(`Annual Weather Summary — ${d.weather.location}`));
      children.push(new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({
          text: `Total Hours: ${d.weather.totalHours.toLocaleString()}   |   Tdb Range: ${fmtNum(d.weather.minTDisp, 1)} to ${fmtNum(d.weather.maxTDisp, 1)} ${U.T} (Mean ${fmtNum(d.weather.meanTDisp, 1)} ${U.T})   |   Comfort: ${d.weather.comfortHours.toLocaleString()} hrs (${d.weather.comfortPct.toFixed(1)}%)   |   Cooling: ${d.weather.coolingHours.toLocaleString()} hrs   |   Heating: ${d.weather.heatingHours.toLocaleString()} hrs`,
          font: 'Arial', size: 17, color: '334155'
        })]
      }));
    }

    // Engineering Notes & Methodology
    children.push(makeHeading('Engineering Notes & Standards'));
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: `Psychrometric calculations conform to ASHRAE Handbook — Fundamentals (2021), Chapter 1 (Hyland-Wexler saturation formulation, adiabatic wet-bulb equation, and true 0°F IP enthalpy datum) at ${d.pressureKPa.toFixed(2)} kPa.`,
        font: 'Arial', size: 17, color: '475569'
      })]
    }));
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: `Thermal comfort evaluation conforms to ANSI/ASHRAE Standard 55-2023 & ISO 7730 (${formatComfortMetaSummary(d.comfortCfg, d.units)}).`,
        font: 'Arial', size: 17, color: '475569'
      })]
    }));
    if (d.meta.notes) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: `Project Notes: ${d.meta.notes}`, font: 'Arial', size: 17, color: '0F172A' })]
      }));
    }
    children.push(new Paragraph({
      spacing: { before: 80 },
      children: [new TextRun({ text: `Generated by PsychroChart Ultra v${APP_VERSION} on ${dateStr}.`, font: 'Arial', size: 16, italics: true, color: '64748B' })]
    }));

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 18 } } } },
      sections: [{
        properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: MARGIN } },
        headers: {
          default: new Header({
            children: [new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              children: [
                new TextRun({ text: `${d.meta.name} (${d.meta.version})`, font: 'Arial', size: 14, color: '64748B' }),
                new TextRun({ text: `\t${d.meta.company || 'PsychroChart Ultra v' + APP_VERSION}`, font: 'Arial', size: 14, color: '64748B' })
              ]
            })]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              children: [
                new TextRun({ text: dateStr, font: 'Arial', size: 13, color: '64748B' }),
                new TextRun({ text: '\tPage ', font: 'Arial', size: 13, color: '64748B' }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 13, color: '64748B' })
              ]
            })]
          })
        },
        children
      }]
    });

    try {
      const blob = await Packer.toBlob(doc);
      const fname = `${sanitizeFilename(d.meta.name)}_${sanitizeFilename(d.meta.version, 'v1')}_report.docx`;
      triggerDownload(blob, fname, true);
      notifyToast('Word (.docx) report downloaded', 'success');
      return { ok: true, filename: fname };
    } catch (err) {
      notifyToast(`Error building DOCX: ${err?.message || err}`, 'error');
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /* --------------------------------------------------------------------------
     7. Project Save/Load JSON & Shareable URL Hash
     -------------------------------------------------------------------------- */
  function buildProjectJSONObject(store) {
    if (typeof store?.exportJSON === 'function') {
      const out = store.exportJSON();
      return typeof out === 'string' ? JSON.parse(out) : out;
    }
    if (typeof store?.toJSON === 'function') {
      const out = store.toJSON();
      return typeof out === 'string' ? JSON.parse(out) : out;
    }
    const d = extractProjectData(store);
    const st = d.state;
    return {
      schemaVersion: APP_VERSION,
      meta: { ...d.meta, savedAt: new Date().toISOString() },
      units: d.units,
      theme: st.theme || 'studio-dark',
      customTheme: st.customTheme ? JSON.parse(JSON.stringify(st.customTheme)) : undefined,
      pPa: d.pPa,
      view: { ...d.view },
      layers: st.layers ? { ...st.layers } : undefined,
      display: st.display ? { ...st.display } : undefined,
      comfort: { ...d.comfortCfg },
      points: (st.points || []).map(p => ({ ...p })),
      processes: (st.processes || []).map(pr => Array.isArray(pr) ? [...pr] : { ...pr }),
      annotations: Array.isArray(st.annotations) ? st.annotations.map(a => ({ ...a })) : [],
      scenarios: Array.isArray(st.scenarios) ? JSON.parse(JSON.stringify(st.scenarios)) : []
    };
  }

  function downloadJSON(store) {
    const obj = buildProjectJSONObject(store);
    const json = JSON.stringify(obj, null, 2);
    const name = sanitizeFilename(obj.meta?.name || 'project', 'project');
    const ver = sanitizeFilename(obj.meta?.version || 'v1', 'v1');
    const fname = `${name}_${ver}.json`;
    if (hasDOM()) {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      triggerDownload(blob, fname, true);
      notifyToast(`Project saved (${fname})`, 'success');
    }
    return { json, filename: fname };
  }

  function normalizeLegacyV266Payload(obj) {
    // Converts PsychroChart Pro v2.6.6 JSON into Ultra 3.0 SI internal schema
    const legacyState = obj.state || {};
    const units = legacyState.units === 'IP' ? 'IP' : 'SI';
    const wMaxDisp = Number(legacyState.wMaxDisp);
    const wMaxSI = Number.isFinite(wMaxDisp)
      ? (units === 'SI' ? wMaxDisp / 1000 : wMaxDisp / GRAINS_PER_LB)
      : 0.030;
    const themeMap = { dark: 'studio-dark', light: 'drafting-light', ashrae: 'ashrae-classic', blueprint: 'blueprint-cad' };
    const theme = legacyState.style === 'custom'
      ? 'custom'
      : (themeMap[legacyState.theme] || legacyState.theme || 'studio-dark');

    return {
      schemaVersion: APP_VERSION,
      meta: {
        name: obj.meta?.name || 'Imported Project',
        version: obj.meta?.version || 'v1.0',
        company: obj.meta?.company || '',
        engineer: obj.meta?.engineer || '',
        notes: obj.meta?.notes || ''
      },
      units,
      theme,
      customTheme: obj.customTheme || undefined,
      pPa: Number.isFinite(legacyState.pPa) ? legacyState.pPa : 101325,
      view: {
        tMin: Number.isFinite(legacyState.tMin) ? legacyState.tMin : -10,
        tMax: Number.isFinite(legacyState.tMax) ? legacyState.tMax : 55,
        wMax: CoreDOM.clamp(wMaxSI, 0.002, 0.080)
      },
      display: {
        density: legacyState.density || 'normal',
        rhStep: legacyState.rhStep || 10,
        labelMode: legacyState.labelMode || 'mid',
        labelPx: legacyState.labelPx || 11
      },
      comfort: { mode: legacyState.comfortZone || 'both' },
      points: Array.isArray(obj.points) ? obj.points : [],
      processes: Array.isArray(obj.processes) ? obj.processes : []
    };
  }

  async function loadJSONFile(store, file) {
    if (!file) return { ok: false, error: 'No file provided' };
    let text;
    try {
      text = typeof file === 'string' ? file : await file.text();
    } catch (err) {
      notifyToast(`Failed to read file: ${err?.message || err}`, 'error');
      return { ok: false, error: err?.message || String(err) };
    }

    let obj;
    try {
      obj = JSON.parse(text);
    } catch (_) {
      notifyToast('Invalid JSON project file', 'error');
      return { ok: false, error: 'Invalid JSON syntax' };
    }

    if (!obj || typeof obj !== 'object') {
      notifyToast('Unrecognized project format', 'error');
      return { ok: false, error: 'Payload is not an object' };
    }

    try {
      if (typeof store?.importJSON === 'function') {
        store.importJSON(obj);
      } else if (typeof store?.loadJSON === 'function') {
        store.loadJSON(obj);
      } else if (typeof store?.fromJSON === 'function') {
        store.fromJSON(obj);
      } else {
        const normalized = obj.state && !obj.schemaVersion ? normalizeLegacyV266Payload(obj) : obj;
        if (typeof store?.setState === 'function') {
          store.setState(normalized);
        } else if (store?.state && typeof store.state === 'object') {
          Object.assign(store.state, normalized);
        }
      }
      notifyToast(`Loaded "${obj.meta?.name || 'project'}"`, 'success');
      return { ok: true, data: obj };
    } catch (err) {
      notifyToast(`Failed to apply project: ${err?.message || err}`, 'error');
      return { ok: false, error: err?.message || String(err) };
    }
  }

  function encodeBase64Url(str) {
    if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return encodeURIComponent(str);
  }

  async function copyShareURL(store) {
    let url = '';
    if (typeof store?.encodeShareURL === 'function') {
      url = store.encodeShareURL();
    } else if (typeof store?.getShareURL === 'function') {
      url = store.getShareURL();
    } else if (typeof store?.encodeURLHash === 'function') {
      const hash = store.encodeURLHash();
      const base = hasDOM() ? `${window.location.origin}${window.location.pathname}` : '';
      url = hash.startsWith('#') ? `${base}${hash}` : `${base}#${hash}`;
    } else {
      const full = buildProjectJSONObject(store);
      // Keep URL compact by omitting bulky scenarios & weather arrays
      const compact = {
        v: APP_VERSION,
        meta: full.meta,
        units: full.units,
        theme: full.theme,
        pPa: Math.round(full.pPa),
        view: full.view,
        comfort: full.comfort,
        points: full.points,
        processes: full.processes,
        annotations: full.annotations
      };
      const encoded = encodeBase64Url(JSON.stringify(compact));
      const base = hasDOM() ? `${window.location.origin}${window.location.pathname}` : '';
      url = `${base}#p3=${encoded}`;
    }

    if (hasDOM()) {
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        if (url.length > 8000) {
          notifyToast(`Share URL copied (${url.length} chars — large projects may work better as JSON)`, 'warn');
        } else {
          notifyToast('Shareable project URL copied to clipboard', 'success');
        }
      } catch (err) {
        notifyToast(`Could not copy share URL: ${err?.message || err}`, 'error');
        return { ok: false, url, error: err?.message || String(err) };
      }
    }
    return { ok: true, url };
  }

  /* --------------------------------------------------------------------------
     Public Exported API
     -------------------------------------------------------------------------- */
  return {
    renderCompositePNG,
    exportPNG,
    copyPNG,
    buildSVGString,
    exportSVG,
    buildCSVString,
    exportCSV,
    buildHTMLReportString,
    generateHTMLReport,
    generateDOCXReport,
    downloadJSON,
    loadJSONFile,
    copyShareURL
  };
})();
