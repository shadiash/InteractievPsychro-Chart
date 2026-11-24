/* ============================================================================
   PsychroChart Ultra 3.0 — Right Inspector Panel Controller
   Tab 1: Processes & Energy Balance (per-process loads, curve toggle, rollup)
   Tab 2: HVAC System Wizards (AHU, ERV, Evap, Desiccant, Humidifier)
   Tab 3: Coil ADP / Hydronic Estimator & ASHRAE 62.1 Ventilation / CO₂
   Tab 4: 2/3-Stream Adiabatic Mixing (with Fog Warning) & Scenario A/B Manager
   ============================================================================ */

import { CoreDOM, UNIT_LABELS } from '../core/contracts.js';
import { Psy } from '../engine/psychro.js';
import { HVAC } from '../engine/hvac.js';

export function initRightPanel(store, callbacks = {}) {
  const byId = CoreDOM.byId;
  const on = CoreDOM.on;
  const esc = CoreDOM.esc;
  const clamp = CoreDOM.clamp;
  const toast = typeof callbacks?.toast === 'function'
    ? callbacks.toast
    : (msg, type, anchor) => { if (typeof store?.toast === 'function') store.toast(msg, type, anchor); };

  const BTUH_PER_KW = Psy.BTUH_PER_KW || 3412.141633;
  const KW_PER_TON = Psy.KW_PER_TON || 3.516852842;
  const KW_PER_HP = 0.745699872;
  const LB_PER_KG = Psy.LB_PER_KG || 2.20462262185;
  const GPM_PER_LPS = Psy.GPM_WATER_PER_KGS || 15.8503231;
  const CFM_PER_LPS = 2.118880003;
  const CFM_PER_M3H = 0.588577779;
  const FT2_PER_M2 = 10.763910417;
  const CFM_FT2_PER_LPS_M2 = CFM_PER_LPS / FT2_PER_M2; // 0.196850394
  const GAL_WATER_KG = 3.785411784;
  const PA_PER_INWG = 248.84;

  const CURVE_ARC_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 9.5 Q 4 2.5 10 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const MECH_ROLES = new Set(['coil', 'fan', 'humid', 'custom']);

  const AHU_MODE_PRESETS = {
    summer_reheat: {
      label: 'Summer Cooling + Reheat',
      oaT: 35, oaRH: 55, raT: 24, raRH: 50,
      oaPct: 25, flowLps: 2000, coilAdp: 11, coilBpf: 0.15,
      reheatT: 16, fanDp: 750, fanEff: 0.65, ervSens: 0.72, ervLat: 0.65
    },
    doas_erv: {
      label: 'DOAS + ERV Enthalpy Wheel',
      oaT: 35, oaRH: 60, raT: 24, raRH: 50,
      oaPct: 100, flowLps: 1200, coilAdp: 10.5, coilBpf: 0.12,
      reheatT: 18, fanDp: 850, fanEff: 0.65, ervSens: 0.76, ervLat: 0.68
    },
    winter_humid: {
      label: 'Winter Heating + Humidification',
      oaT: -5, oaRH: 70, raT: 21, raRH: 40,
      oaPct: 25, flowLps: 2000, coilAdp: 10, coilBpf: 0.15,
      reheatT: 30, fanDp: 750, fanEff: 0.65, ervSens: 0.72, ervLat: 0.65
    },
    economizer: {
      label: 'Airside Economizer',
      oaT: 13, oaRH: 65, raT: 24, raRH: 50,
      oaPct: 20, flowLps: 2000, coilAdp: 11, coilBpf: 0.15,
      reheatT: 15.5, fanDp: 700, fanEff: 0.65, ervSens: 0.72, ervLat: 0.65
    }
  };

  let lastUnits = store.state.units || 'SI';
  const ahuEditedFields = new Set();
  let lastAdpProcId = null;
  let lastAhuCycle = null;
  let lastErvData = null;
  let lastEvapData = null;
  let lastDesData = null;
  let lastHumData = null;
  let flowEditSessionPushed = false;

  /* --------------------------------------------------------------------------
     Shared Unit, Normalization & Formatting Helpers
     -------------------------------------------------------------------------- */

  function getUnits() {
    return store.state.units === 'IP' ? 'IP' : 'SI';
  }

  function getPPa() {
    return Number.isFinite(store.state.pPa) ? store.state.pPa : 101325;
  }

  function getUnitLabels(units = getUnits()) {
    return UNIT_LABELS[units] || UNIT_LABELS.SI;
  }

  function normFlowUnit(unit, units = getUnits()) {
    const raw = String(unit || '').trim();
    const low = raw.toLowerCase();
    if (low === 'lps' || low === 'l/s') return 'Lps';
    if (low === 'kgps' || low === 'kgs' || low === 'kg/s') return 'kgps';
    if (low === 'm3h' || low === 'm3/h' || low === 'm³/h') return 'm3h';
    if (low === 'cfm' || low === 'ft3/min' || low === 'ft³/min') return 'cfm';
    if (low === 'lbps' || low === 'lbs' || low === 'lb/s') return 'lbps';
    if (low === 'pct' || low === 'percent' || low === '%') return 'pct';
    return units === 'IP' ? 'cfm' : 'Lps';
  }

  function flowUnitLabel(unit) {
    const u = normFlowUnit(unit);
    if (u === 'Lps') return 'L/s';
    if (u === 'kgps') return 'kg/s';
    if (u === 'm3h') return 'm³/h';
    if (u === 'cfm') return 'CFM';
    if (u === 'lbps') return 'lb/s';
    if (u === 'pct') return '%';
    return u;
  }

  function convertFlowBetweenSystems(val, unit, targetUnits) {
    const num = Number(val);
    if (!Number.isFinite(num)) {
      return targetUnits === 'IP'
        ? { flowVal: 2000, flowUnit: 'cfm' }
        : { flowVal: 1000, flowUnit: 'Lps' };
    }
    const u = normFlowUnit(unit);
    if (targetUnits === 'IP') {
      if (u === 'cfm' || u === 'lbps') return { flowVal: num, flowUnit: u };
      if (u === 'Lps') return { flowVal: CoreDOM.round(num * CFM_PER_LPS, 1), flowUnit: 'cfm' };
      if (u === 'm3h') return { flowVal: CoreDOM.round(num * CFM_PER_M3H, 1), flowUnit: 'cfm' };
      if (u === 'kgps') return { flowVal: CoreDOM.round(num * LB_PER_KG, 3), flowUnit: 'lbps' };
      return { flowVal: num, flowUnit: 'cfm' };
    }
    if (u === 'Lps' || u === 'kgps' || u === 'm3h') return { flowVal: num, flowUnit: u };
    if (u === 'cfm') return { flowVal: CoreDOM.round(num / CFM_PER_LPS, 1), flowUnit: 'Lps' };
    if (u === 'lbps') return { flowVal: CoreDOM.round(num / LB_PER_KG, 3), flowUnit: 'kgps' };
    return { flowVal: num, flowUnit: 'Lps' };
  }

  function dispFlowToLps(val, units = getUnits()) {
    const n = Math.max(0, Number(val) || 0);
    return units === 'IP' ? n / CFM_PER_LPS : n;
  }

  function lpsToDispFlow(lps, units = getUnits()) {
    return units === 'IP' ? lps * CFM_PER_LPS : lps;
  }

  function numInput(id, fallback = 0) {
    const el = byId(id);
    if (!el) return fallback;
    const n = parseFloat(el.value);
    return Number.isFinite(n) ? n : fallback;
  }

  function setInputVal(id, val, dec = 2) {
    const el = byId(id);
    if (!el || !Number.isFinite(val)) return;
    el.value = dec === 0 ? String(Math.round(val)) : String(CoreDOM.round(val, dec));
  }

  function setFieldLabel(forId, text) {
    const lbl = document.querySelector(`label[for="${forId}"]`);
    if (lbl) lbl.textContent = text;
  }

  function normalizeFrac(val, fallback) {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return n > 1 ? clamp(n / 100, 0, 1) : clamp(n, 0, 1);
  }

  function fmtSign(v, dec = 2) {
    if (!Number.isFinite(v)) return '—';
    const r = CoreDOM.round(v, dec);
    const s = Math.abs(r) < Math.pow(10, -dec - 1) ? 0 : r;
    return (s > 0 ? '+' : '') + s.toFixed(dec);
  }

  function fmtTemp(tC, units = getUnits(), dec = 1) {
    if (!Number.isFinite(tC)) return '—';
    const v = CoreDOM.tToDisp(tC, units);
    return `${v.toFixed(dec)} ${getUnitLabels(units).T}`;
  }

  function fmtDeltaT(dTC, units = getUnits(), dec = 2) {
    if (!Number.isFinite(dTC)) return '—';
    const v = units === 'IP' ? CoreDOM.dCtoF(dTC) : dTC;
    return `${fmtSign(v, dec)} ${getUnitLabels(units).T}`;
  }

  function fmtW(wKgKg, units = getUnits()) {
    if (!Number.isFinite(wKgKg)) return '—';
    const v = CoreDOM.wToDisp(wKgKg, units);
    return units === 'IP' ? `${v.toFixed(1)} gr/lb` : `${v.toFixed(2)} g/kg`;
  }

  function fmtDeltaW(dWKgKg, units = getUnits()) {
    if (!Number.isFinite(dWKgKg)) return '—';
    const v = CoreDOM.wToDisp(dWKgKg, units);
    return units === 'IP' ? `${fmtSign(v, 1)} gr/lb` : `${fmtSign(v, 2)} g/kg`;
  }

  function fmtH(tC, wKgKg, units = getUnits()) {
    const v = units === 'IP' ? Psy.h_Btulb(tC, wKgKg) : Psy.h_kJkg(tC, wKgKg);
    if (!Number.isFinite(v)) return '—';
    return `${v.toFixed(2)} ${getUnitLabels(units).h}`;
  }

  function fmtDeltaH(dhKJkg, units = getUnits()) {
    if (!Number.isFinite(dhKJkg)) return '—';
    const v = units === 'IP' ? Psy.dh_Btulb(dhKJkg) : dhKJkg;
    return `${fmtSign(v, 2)} ${getUnitLabels(units).h}`;
  }

  function fmtBTUh(btuh, signed = true) {
    if (!Number.isFinite(btuh)) return '—';
    const rounded = Math.round(btuh);
    const abs = Math.abs(rounded);
    const sign = signed && rounded > 0 ? '+' : (rounded < 0 ? '-' : '');
    if (abs >= 100000) {
      return `${sign}${(abs / 1000).toFixed(1)} MBH`;
    }
    return `${sign}${abs.toLocaleString('en-US')} BTU/h`;
  }

  function fmtEnergy(kW, units = getUnits(), signed = true) {
    if (!Number.isFinite(kW)) return '—';
    if (units === 'IP') {
      return fmtBTUh(kW * BTUH_PER_KW, signed);
    }
    return `${signed ? fmtSign(kW, 2) : Math.abs(kW).toFixed(2)} kW`;
  }

  function fmtWater(kgh, units = getUnits(), signed = true) {
    if (!Number.isFinite(kgh)) return '—';
    const gph = Math.abs(kgh) / GAL_WATER_KG;
    if (units === 'IP') {
      const lbh = kgh * LB_PER_KG;
      const main = signed ? fmtSign(lbh, 2) : Math.abs(lbh).toFixed(2);
      return `${main} lb/h (${gph.toFixed(2)} gph)`;
    }
    const main = signed ? fmtSign(kgh, 2) : Math.abs(kgh).toFixed(2);
    return `${main} kg/h`;
  }

  function metricCard(lbl, val, sub = '', tone = '', full = false) {
    const cls = `metric${tone ? ' ' + tone : ''}${full ? ' full' : ''}`;
    return `<div class="${cls}"><span class="lbl">${esc(lbl)}</span><span class="val">${val}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  }

  function populatePointSelect(sel, opts = {}) {
    if (!sel) return;
    const pts = store.state.points || [];
    const prevVal = sel.value;
    const hasEmpty = Boolean(opts.emptyLabel);
    sel.innerHTML = '';

    if (hasEmpty) {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = opts.emptyLabel;
      sel.appendChild(emptyOpt);
    }

    pts.forEach((p, idx) => {
      const o = document.createElement('option');
      o.value = String(p.id);
      o.textContent = `${idx + 1}: ${p.label || `P${idx + 1}`}`;
      sel.appendChild(o);
    });

    const validValues = new Set(Array.from(sel.options).map(o => o.value));
    if (prevVal && validValues.has(prevVal)) {
      sel.value = prevVal;
      return;
    }

    if (hasEmpty && opts.defaultEmpty) {
      sel.value = '';
      return;
    }

    if (pts.length === 0) return;

    if (opts.matchRegex) {
      const hit = pts.find(p => opts.matchRegex.test(p.label || ''));
      if (hit) {
        sel.value = String(hit.id);
        return;
      }
    }

    const defIdx = clamp(opts.defaultIndex ?? 0, 0, pts.length - 1);
    sel.value = String(pts[defIdx].id);
  }

  function populateProcessSelect(sel, preferId = null) {
    if (!sel) return;
    const procs = store.state.processes || [];
    const pts = store.state.points || [];
    const prevVal = preferId != null ? String(preferId) : sel.value;
    sel.innerHTML = '';

    procs.forEach((pr, idx) => {
      const a = pts.find(p => p.id === pr.aId);
      const b = pts.find(p => p.id === pr.bId);
      const o = document.createElement('option');
      o.value = String(pr.id);
      o.textContent = `S${idx + 1}: ${a?.label || '?'} → ${b?.label || '?'}`;
      sel.appendChild(o);
    });

    if (procs.length === 0) return;
    const validIds = new Set(procs.map(p => String(p.id)));
    if (prevVal && validIds.has(prevVal)) {
      sel.value = prevVal;
    } else {
      sel.value = String(procs[0].id);
    }
  }

  function populateFlowUnitSelect(sel, includePct = false, preferUnit = null) {
    if (!sel) return;
    const units = getUnits();
    const prev = preferUnit ? normFlowUnit(preferUnit, units) : normFlowUnit(sel.value, units);
    const options = units === 'IP'
      ? [
          ['cfm', 'CFM'],
          ['lbps', 'lb/s']
        ]
      : [
          ['Lps', 'L/s'],
          ['kgps', 'kg/s'],
          ['m3h', 'm³/h']
        ];
    if (includePct) {
      options.push(['pct', 'Percent (%)']);
    }
    const sig = `${units}|${includePct ? 1 : 0}`;
    if (sel.dataset.sig !== sig || sel.options.length !== options.length) {
      sel.dataset.sig = sig;
      sel.innerHTML = '';
      for (const [val, txt] of options) {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = txt;
        sel.appendChild(o);
      }
    }
    const valid = new Set(options.map(o => o[0]));
    if (valid.has(prev)) {
      if (sel.value !== prev) sel.value = prev;
    } else if (sel.value !== options[0][0]) {
      sel.value = options[0][0];
    }
  }

  function ensureDistinctPair(selA, selB) {
    if (!selA || !selB) return;
    const pts = store.state.points || [];
    if (pts.length < 2) return;
    if (selA.value && selA.value === selB.value) {
      const alt = pts.find(p => String(p.id) !== selA.value);
      if (alt) selB.value = String(alt.id);
    }
  }

  function inferProcessRole(pr, a, b) {
    if (pr?.role) return pr.role;
    if (b?.derived?.type === 'mix') return 'mix';
    const aLbl = a?.label || '';
    const bLbl = b?.label || '';
    const pLbl = pr?.label || '';
    const bpLbl = `${bLbl} ${pLbl}`;
    if (/exhaust|\bEA\b/i.test(bpLbl)) return 'erv_exhaust';
    if (/\berv\b/i.test(bpLbl) && !/coil|\bCC\b/i.test(bLbl) && !/coil|\bCC\b/i.test(pLbl)) return 'erv';
    if (/room|space|aisle|zone|\bRA\b/i.test(bLbl) && /supply|\bSA\b|cold aisle|post-cool/i.test(aLbl)) return 'room';
    return 'coil';
  }

  function computeCycleRollup(points, processes, pPa) {
    let mechCooling_kW = 0;
    let mechHeating_kW = 0;
    let condensate_kgh = 0;
    let humidAdded_kgh = 0;
    let netWater_kgh = 0;
    let spaceLoad_kW = 0;
    let ervSaved_kW = 0;
    let validCount = 0;
    let mechCount = 0;

    for (const pr of processes || []) {
      const a = (points || []).find(p => p.id === pr.aId);
      const b = (points || []).find(p => p.id === pr.bId);
      if (!a || !b) continue;
      const fVal = Number.isFinite(Number(pr.flowVal)) ? Number(pr.flowVal) : 1000;
      const fUnit = normFlowUnit(pr.flowUnit || 'Lps');
      const m = HVAC.calcProcessMetrics(a, b, pPa, fVal, fUnit);
      const role = inferProcessRole(pr, a, b);
      validCount++;

      if (role === 'mix' || role === 'erv_exhaust') {
        continue;
      }
      if (role === 'room') {
        spaceLoad_kW += Math.abs(m.Qt_kW);
        continue;
      }
      if (role === 'erv') {
        ervSaved_kW += Math.abs(m.Qt_kW);
        continue;
      }

      if (MECH_ROLES.has(role)) {
        mechCount++;
        if (m.Qt_kW < -1e-6) mechCooling_kW += Math.abs(m.Qt_kW);
        else if (m.Qt_kW > 1e-6) mechHeating_kW += m.Qt_kW;
        netWater_kgh += m.waterRate_kgh;
        if (m.waterRate_kgh > 1e-6) humidAdded_kgh += m.waterRate_kgh;
        else if (m.waterRate_kgh < -1e-6) condensate_kgh += Math.abs(m.waterRate_kgh);
      }
    }

    const total_kW = mechCooling_kW + mechHeating_kW;
    return {
      validCount,
      mechCount,
      mechCooling_kW,
      mechHeating_kW,
      cooling_kW: mechCooling_kW,
      cooling_TR: mechCooling_kW / KW_PER_TON,
      cooling_MBH: (mechCooling_kW * BTUH_PER_KW) / 1000,
      heating_kW: mechHeating_kW,
      heating_MBH: (mechHeating_kW * BTUH_PER_KW) / 1000,
      total_kW,
      total_TR: total_kW / KW_PER_TON,
      total_MBH: (total_kW * BTUH_PER_KW) / 1000,
      netWater_kgh,
      netWater_lbh: netWater_kgh * LB_PER_KG,
      condensate_kgh,
      condensate_lbh: condensate_kgh * LB_PER_KG,
      condRemoved_kgh: condensate_kgh,
      humidAdded_kgh,
      humidAdded_lbh: humidAdded_kgh * LB_PER_KG,
      spaceLoad_kW,
      spaceLoad_TR: spaceLoad_kW / KW_PER_TON,
      spaceLoad_MBH: (spaceLoad_kW * BTUH_PER_KW) / 1000,
      ervSaved_kW,
      ervSaved_TR: ervSaved_kW / KW_PER_TON,
      ervSaved_MBH: (ervSaved_kW * BTUH_PER_KW) / 1000
    };
  }

  /* --------------------------------------------------------------------------
     Dynamic Unit Label & Numeric Input Conversion on SI ↔ IP Switch
     -------------------------------------------------------------------------- */

  function updateDynamicUnitLabels() {
    const u = getUnits();
    const ul = getUnitLabels(u);
    const areaUnit = ul.area;
    const flowUnit = ul.flow;
    const rpUnit = u === 'IP' ? 'CFM/p' : 'L/s·p';
    const raUnit = u === 'IP' ? 'CFM/ft²' : 'L/s·m²';

    setFieldLabel('ahuOaT', `OA Tdb (${ul.T})`);
    setFieldLabel('ahuRaT', `RA Tdb (${ul.T})`);
    setFieldLabel('ahuFlow', `Supply Flow (${flowUnit})`);
    setFieldLabel('ahuCoilAdp', `Coil ADP (${ul.T})`);
    setFieldLabel('ahuFanDp', u === 'IP' ? 'Fan ΔP (in. wg)' : 'Fan ΔP (Pa)');

    const fanDpEl = byId('ahuFanDp');
    if (fanDpEl) {
      fanDpEl.step = u === 'IP' ? '0.1' : '50';
      fanDpEl.min = '0';
    }

    setFieldLabel('ervFlow', `Airflow (${flowUnit})`);
    setFieldLabel('evapFlow', `Airflow (${flowUnit})`);
    setFieldLabel('desFlow', `Airflow (${flowUnit})`);
    setFieldLabel('humFlow', `Airflow (${flowUnit})`);
    setFieldLabel('humTargetW', `Target W (${ul.W})`);

    const humWEl = byId('humTargetW');
    if (humWEl) {
      humWEl.min = u === 'IP' ? '3' : '0.5';
      humWEl.max = u === 'IP' ? '280' : '40';
      humWEl.step = u === 'IP' ? '1' : '0.2';
    }

    setFieldLabel('adpWaterDt', `CHW ΔT (${ul.T})`);
    const adpDtEl = byId('adpWaterDt');
    if (adpDtEl) {
      adpDtEl.min = u === 'IP' ? '2' : '1';
      adpDtEl.max = u === 'IP' ? '36' : '20';
      adpDtEl.step = '0.5';
    }

    setFieldLabel('ventArea', `Floor Area (${areaUnit})`);
    setFieldLabel('ventRp', `Rp (${rpUnit})`);
    setFieldLabel('ventRa', `Ra (${raUnit})`);

    // Keep contextual AHU labels (Min OA %, Heating Coil T vs Reheat T) synced with current mode & units
    syncAhuModeVisibility(byId('ahuMode')?.value || 'summer_reheat');
  }

  function convertRightPanelInputsOnUnitChange(prevUnits, nextUnits) {
    if (prevUnits === nextUnits) return;

    const convertT = (id, dec = 1) => {
      const el = byId(id);
      if (!el) return;
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      const tC = CoreDOM.dispToT(v, prevUnits);
      setInputVal(id, CoreDOM.tToDisp(tC, nextUnits), dec);
    };

    const convertFlow = (id) => {
      const el = byId(id);
      if (!el) return;
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      const lps = dispFlowToLps(v, prevUnits);
      setInputVal(id, lpsToDispFlow(lps, nextUnits), 0);
    };

    // Tab 2: AHU, ERV, Evap, Desiccant, Humidifier
    convertT('ahuOaT', 1);
    convertT('ahuRaT', 1);
    convertT('ahuCoilAdp', 1);
    convertT('ahuReheatT', 1);
    convertFlow('ahuFlow');
    convertFlow('ervFlow');
    convertFlow('evapFlow');
    convertFlow('desFlow');
    convertFlow('humFlow');

    const fanDpEl = byId('ahuFanDp');
    if (fanDpEl) {
      const v = parseFloat(fanDpEl.value);
      if (Number.isFinite(v)) {
        const dpPa = prevUnits === 'IP' ? v * PA_PER_INWG : v;
        setInputVal('ahuFanDp', nextUnits === 'IP' ? dpPa / PA_PER_INWG : dpPa, nextUnits === 'IP' ? 2 : 0);
      }
    }

    const humWEl = byId('humTargetW');
    if (humWEl) {
      const v = parseFloat(humWEl.value);
      if (Number.isFinite(v)) {
        const wKg = CoreDOM.dispToW(v, prevUnits);
        setInputVal('humTargetW', CoreDOM.wToDisp(wKg, nextUnits), nextUnits === 'IP' ? 1 : 2);
      }
    }

    // Tab 3: CHW ΔT & ASHRAE 62.1 Area / Rp / Ra
    const dtEl = byId('adpWaterDt');
    if (dtEl) {
      const v = parseFloat(dtEl.value);
      if (Number.isFinite(v)) {
        const dtC = prevUnits === 'IP' ? v / 1.8 : v;
        setInputVal('adpWaterDt', nextUnits === 'IP' ? dtC * 1.8 : dtC, 1);
      }
    }

    const areaEl = byId('ventArea');
    if (areaEl) {
      const v = parseFloat(areaEl.value);
      if (Number.isFinite(v)) {
        const m2 = prevUnits === 'IP' ? v / FT2_PER_M2 : v;
        setInputVal('ventArea', nextUnits === 'IP' ? m2 * FT2_PER_M2 : m2, 0);
      }
    }

    const rpEl = byId('ventRp');
    if (rpEl) {
      const v = parseFloat(rpEl.value);
      if (Number.isFinite(v)) {
        const rpSI = prevUnits === 'IP' ? v / CFM_PER_LPS : v;
        setInputVal('ventRp', nextUnits === 'IP' ? rpSI * CFM_PER_LPS : rpSI, 2);
      }
    }

    const raEl = byId('ventRa');
    if (raEl) {
      const v = parseFloat(raEl.value);
      if (Number.isFinite(v)) {
        const raSI = prevUnits === 'IP' ? v / CFM_FT2_PER_LPS_M2 : v;
        setInputVal('ventRa', nextUnits === 'IP' ? raSI * CFM_FT2_PER_LPS_M2 : raSI, 3);
      }
    }

    populateVentSpaces();

    // Tab 1: Convert each process's stored flowVal/flowUnit cleanly preserving physical mass flow
    for (const pr of store.state.processes || []) {
      const conv = convertFlowBetweenSystems(pr.flowVal, pr.flowUnit, nextUnits);
      pr.flowVal = conv.flowVal;
      pr.flowUnit = conv.flowUnit;
    }

    // Tab 4: Mix flow unit dropdown & stream values if volumetric/mass (not %)
    const mixUnitEl = byId('mixUnit');
    if (mixUnitEl) {
      const prevMixU = normFlowUnit(mixUnitEl.value, prevUnits);
      if (prevMixU !== 'pct') {
        ['mixWA', 'mixWB', 'mixWC'].forEach(fid => {
          const inp = byId(fid);
          if (!inp) return;
          const v = parseFloat(inp.value);
          if (Number.isFinite(v) && v > 0) {
            const conv = convertFlowBetweenSystems(v, prevMixU, nextUnits);
            inp.value = String(conv.flowVal);
          }
        });
        const newU = convertFlowBetweenSystems(1, prevMixU, nextUnits).flowUnit;
        populateFlowUnitSelect(mixUnitEl, true, newU);
      } else {
        populateFlowUnitSelect(mixUnitEl, true, 'pct');
      }
    }

    populateFlowUnitSelect(byId('flowUnit'), false);
    updateDynamicUnitLabels();
  }

  /* ==========================================================================
     TAB 1 — PROCESSES & ENERGY BALANCE (`#tabProc`)
     ========================================================================== */

  function getSelectedProcess() {
    const procs = store.state.processes || [];
    if (procs.length === 0) return null;
    const selId = store.state.ui?.selectedProcId;
    if (selId != null) {
      const hit = procs.find(p => p.id === selId);
      if (hit) return hit;
    }
    const selEl = byId('procSel');
    if (selEl && selEl.value) {
      const hit = procs.find(p => String(p.id) === String(selEl.value));
      if (hit) return hit;
    }
    return procs[0];
  }

  function clearProcessMetrics() {
    ['mDT', 'mDW', 'mDh', 'mSHR', 'mQs', 'mQl', 'mQt', 'mWater', 'mTons'].forEach(id => {
      const el = byId(id);
      if (el) el.textContent = '—';
    });
    const curveBtn = byId('procCurveToggle');
    if (curveBtn) {
      curveBtn.classList.remove('active');
      curveBtn.setAttribute('aria-pressed', 'false');
    }
  }

  function renderSelectedProcessMetrics() {
    const proc = getSelectedProcess();
    const flowValEl = byId('flowVal');
    const flowUnitEl = byId('flowUnit');
    const curveBtn = byId('procCurveToggle');
    const delBtn = byId('procDel');
    const revBtn = byId('procRev');
    const procSelEl = byId('procSel');

    const hasProc = Boolean(proc);
    if (delBtn) delBtn.disabled = !hasProc;
    if (revBtn) revBtn.disabled = !hasProc;
    if (curveBtn) curveBtn.disabled = !hasProc;
    if (flowValEl) flowValEl.disabled = !hasProc;
    if (flowUnitEl) flowUnitEl.disabled = !hasProc;

    if (!proc) {
      clearProcessMetrics();
      return;
    }

    if (procSelEl && String(procSelEl.value) !== String(proc.id)) {
      procSelEl.value = String(proc.id);
    }

    const units = getUnits();
    const pPa = getPPa();

    // Sync flow controls from the selected process's own stored flowVal / flowUnit
    const storedUnit = normFlowUnit(proc.flowUnit, units);
    const conv = convertFlowBetweenSystems(proc.flowVal, storedUnit, units);
    const effectiveUnit = conv.flowUnit;
    const effectiveVal = conv.flowVal;

    // Ensure process stores normalized canonical unit matching current unit system
    if (proc.flowUnit !== effectiveUnit) {
      proc.flowVal = effectiveVal;
      proc.flowUnit = effectiveUnit;
    }

    populateFlowUnitSelect(flowUnitEl, false, effectiveUnit);
    if (flowValEl && document.activeElement !== flowValEl) {
      flowValEl.value = String(effectiveVal);
    }

    // Sync Curve Toggle button (or checkbox)
    if (curveBtn) {
      if (curveBtn.tagName === 'INPUT' && curveBtn.type === 'checkbox') {
        curveBtn.checked = Boolean(proc.showCurve);
      } else {
        curveBtn.classList.toggle('active', Boolean(proc.showCurve));
        curveBtn.setAttribute('aria-pressed', proc.showCurve ? 'true' : 'false');
        curveBtn.innerHTML = proc.showCurve
          ? `${CURVE_ARC_SVG}<span>Curved ✓</span>`
          : `${CURVE_ARC_SVG}<span>Curve</span>`;
      }
    }

    const a = store.getPoint(proc.aId);
    const b = store.getPoint(proc.bId);
    if (!a || !b) {
      clearProcessMetrics();
      return;
    }

    const m = HVAC.calcProcessMetrics(a, b, pPa, proc.flowVal, normFlowUnit(proc.flowUnit, units));
    const setTxt = (id, txt, title) => {
      const el = byId(id);
      if (!el) return;
      el.textContent = txt;
      if (title !== undefined) el.title = title;
    };

    const gph = Math.abs(m.waterRate_kgh) / GAL_WATER_KG;
    const waterCompact = units === 'IP'
      ? `${fmtSign(m.waterRate_lbh, 1)} lb/h`
      : `${fmtSign(m.waterRate_kgh, 2)} kg/h`;
    const waterTip = units === 'IP'
      ? `${gph.toFixed(2)} gph (${fmtSign(m.waterRate_kgh, 2)} kg/h)`
      : `${gph.toFixed(2)} gph (${fmtSign(m.waterRate_lbh, 1)} lb/h)`;

    setTxt('mDT', fmtDeltaT(m.dT, units, 2));
    setTxt('mDW', fmtDeltaW(m.dW, units));
    setTxt('mDh', fmtDeltaH(m.dh, units));
    setTxt('mSHR', Number.isFinite(m.SHR) ? m.SHR.toFixed(3) : '—');
    setTxt('mQs', fmtEnergy(m.Qs_kW, units, true));
    setTxt('mQl', fmtEnergy(m.Ql_kW, units, true));
    setTxt('mQt', fmtEnergy(m.Qt_kW, units, true));
    setTxt('mWater', waterCompact, waterTip);
    setTxt('mTons', `${fmtSign(m.Qt_TR, 2)} TR`);
  }

  function isCoolingDehumPair(a, b) {
    return Boolean(a && b && (b.T < a.T - 0.5) && (b.w < a.w - 0.0001));
  }

  function renderProcessCards() {
    const container = byId('processCards');
    if (!container) return;
    const procs = store.state.processes || [];
    const pts = store.state.points || [];
    const units = getUnits();
    const pPa = getPPa();
    const selProc = getSelectedProcess();
    const selId = selProc ? selProc.id : null;

    if (procs.length === 0) {
      container.dataset.sig = '';
      container.innerHTML = '<div class="hint" style="padding:6px 2px">No processes defined yet. Choose Start &amp; End points above or press <b>P</b> on the chart.</div>';
      return;
    }

    const validProcs = [];
    for (let idx = 0; idx < procs.length; idx++) {
      const pr = procs[idx];
      const a = pts.find(p => p.id === pr.aId);
      const b = pts.find(p => p.id === pr.bId);
      if (a && b) validProcs.push({ pr, idx, a, b });
    }

    const sig = `${units}|${selId ?? ''}|${validProcs.map(({ pr }) => `${pr.id}:${pr.aId}:${pr.bId}:${pr.showCurve ? 1 : 0}`).join(',')}`;
    const existingCards = container.querySelectorAll('.procCard[data-proc-id]');
    const canPatchInPlace = container.dataset.sig === sig && existingCards.length === validProcs.length;

    if (!canPatchInPlace) {
      container.dataset.sig = sig;
      container.innerHTML = '';
    }

    validProcs.forEach(({ pr, idx, a, b }, cardIdx) => {
      const fUnit = normFlowUnit(pr.flowUnit, units);
      const m = HVAC.calcProcessMetrics(a, b, pPa, pr.flowVal, fUnit);
      const ti = m.typeInfo;
      const role = inferProcessRole(pr, a, b);
      const isSel = pr.id === selId;
      const isCoolDehum = isCoolingDehumPair(a, b);

      let badgeText = ti.shortType || ti.type;
      let badgeCls = ti.cls;
      let borderCol = ti.color || 'var(--borderStrong)';

      if (role === 'mix') {
        badgeText = 'MIXING';
        badgeCls = 'mix';
        borderCol = 'var(--mix, #ca8a04)';
      } else if (role === 'room') {
        badgeText = 'SPACE LOAD';
        badgeCls = 'neutral';
        borderCol = 'var(--neutral, #64748b)';
      } else if (role === 'erv' || role === 'erv_exhaust') {
        badgeText = 'ERV RECOVERY';
        badgeCls = 'erv';
        borderCol = 'var(--erv, #0d9488)';
      }

      const qtTxt = units === 'IP'
        ? `${fmtSign(m.Qt_TR, 2)} TR`
        : `${fmtSign(m.Qt_kW, 2)} kW`;
      const shrTxt = Number.isFinite(m.SHR) ? `SHR ${m.SHR.toFixed(2)}` : 'SHR —';
      const flowTxt = `${CoreDOM.round(Number(pr.flowVal) || 0, 1)} ${flowUnitLabel(fUnit)}`;

      const curveStyle = pr.showCurve
        ? 'background:var(--accentSoft);border-color:var(--accentBorder);color:var(--accent);font-weight:700;'
        : `background:var(--panel2);border-color:var(--borderStrong);color:var(--fg);opacity:${isCoolDehum ? '0.9' : '0.45'};`;
      const curveTitle = isCoolDehum
        ? 'Toggle curved cooling-coil path & ADP extension'
        : 'Curved coil path applies only to cooling & dehumidification processes';

      if (canPatchInPlace) {
        const card = existingCards[cardIdx];
        card.style.borderLeftColor = isSel ? 'var(--accent)' : borderCol;
        const titleEl = card.querySelector('.procTitle');
        if (titleEl) {
          const ttl = `S${idx + 1}: ${a.label} → ${b.label}`;
          titleEl.textContent = ttl;
          titleEl.title = ttl;
        }
        const badgeEl = card.querySelector('.badge');
        if (badgeEl) {
          badgeEl.className = `badge ${badgeCls}`;
          badgeEl.textContent = badgeText;
        }
        const qtEl = card.querySelector('.procQtVal');
        if (qtEl) qtEl.textContent = qtTxt;
        const shrEl = card.querySelector('.procShrVal');
        if (shrEl) shrEl.textContent = shrTxt;
        const flowEl = card.querySelector('.procFlowVal');
        if (flowEl) flowEl.textContent = flowTxt;
        const curveBtn = card.querySelector('.procCurveBtn');
        if (curveBtn) {
          curveBtn.title = curveTitle;
          curveBtn.setAttribute('aria-label', curveTitle);
          if (!pr.showCurve) curveBtn.style.opacity = isCoolDehum ? '0.9' : '0.45';
        }
        return;
      }

      const card = document.createElement('div');
      card.className = `procCard${isSel ? ' selected' : ''}`;
      card.dataset.procId = String(pr.id);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      card.setAttribute('aria-label', `Select process S${idx + 1}: ${a.label} to ${b.label}`);
      card.style.borderLeftColor = isSel ? 'var(--accent)' : borderCol;

      card.innerHTML = `
        <div class="procHead">
          <span class="procTitle" title="S${idx + 1}: ${esc(a.label)} → ${esc(b.label)}">S${idx + 1}: ${esc(a.label)} → ${esc(b.label)}</span>
          <span class="badge ${esc(badgeCls)}">${esc(badgeText)}</span>
          <button type="button" class="procCurveBtn" aria-label="${esc(curveTitle)}" title="${esc(curveTitle)}" style="width:22px;height:22px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid;cursor:pointer;flex-shrink:0;${curveStyle}">${CURVE_ARC_SVG}</button>
          <button type="button" class="procDel" aria-label="Delete process S${idx + 1}" title="Delete process">✕</button>
        </div>
        <div class="procLoads">
          <span><b>Qt</b> <span class="procQtVal">${esc(qtTxt)}</span></span>
          <span class="procShrVal">${esc(shrTxt)}</span>
          <span class="procFlowVal" style="margin-left:auto;opacity:0.85">${esc(flowTxt)}</span>
        </div>
      `;

      // Bind card selection on pointerdown so typing in #flowVal followed by clicking another card never loses selection mid-click
      on(card, 'pointerdown', (e) => {
        if (e.target.closest('.procDel') || e.target.closest('.procCurveBtn')) return;
        if (store.state.ui?.selectedProcId !== pr.id) {
          store.setUI({ selectedProcId: pr.id });
        }
      });

      on(card, 'keydown', (e) => {
        if (e.target.closest('button')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          store.setUI({ selectedProcId: pr.id });
        }
      });

      const curveToggleBtn = card.querySelector('.procCurveBtn');
      on(curveToggleBtn, 'click', (e) => {
        e.stopPropagation();
        const nextCurve = !pr.showCurve;
        if (nextCurve && !isCoolDehum) {
          toast('Curved coil path only applies to cooling & dehumidification processes (T_out < T_in and W_out < W_in)', 'warn', curveToggleBtn);
          return;
        }
        let adpPatch = { showCurve: nextCurve };
        if (nextCurve) {
          const adp = HVAC.calcADP(a, b, pPa);
          if (adp.valid) {
            adpPatch.adpT = adp.T_adp;
            adpPatch.adpW = adp.w_adp;
          }
          if (store.state.layers && store.state.layers.adpLines === false) {
            store.setLayer('adpLines', true);
          }
        }
        store.updateProcess(pr.id, adpPatch, true);
        toast(nextCurve ? `S${idx + 1}: curved coil trajectory ON` : `S${idx + 1}: straight vector`, 'info');
      });

      const delBtn = card.querySelector('.procDel');
      on(delBtn, 'click', (e) => {
        e.stopPropagation();
        store.deleteProcess(pr.id);
        toast(`Process S${idx + 1} deleted`, 'success');
      });

      container.appendChild(card);
    });
  }

  function renderCycleSummary() {
    const el = byId('cycleSummary');
    if (!el) return;
    const procs = store.state.processes || [];
    if (procs.length === 0) {
      el.innerHTML = '';
      return;
    }

    const units = getUnits();
    const r = computeCycleRollup(store.state.points, procs, getPPa());
    const coolMain = units === 'IP'
      ? `${r.cooling_TR.toFixed(2)} TR`
      : `${r.mechCooling_kW.toFixed(2)} kW`;
    const coolSub = units === 'IP'
      ? `${r.mechCooling_kW.toFixed(2)} kW · ${r.cooling_MBH.toFixed(1)} MBH`
      : `${r.cooling_TR.toFixed(2)} TR · ${r.cooling_MBH.toFixed(1)} MBH`;

    const heatMain = units === 'IP'
      ? `${r.heating_MBH.toFixed(1)} MBH`
      : `${r.mechHeating_kW.toFixed(2)} kW`;
    const heatSub = units === 'IP'
      ? `${r.mechHeating_kW.toFixed(2)} kW`
      : `${r.heating_MBH.toFixed(1)} MBH`;

    let waterLbl = 'Coil Condensate / Humidifier';
    let waterTone = '';
    let waterMain = units === 'IP' ? '0.0 lb/h' : '0.00 kg/h';
    let waterSub = 'Sensible / Dry Operation';

    if (r.condensate_kgh > 1e-4 && r.humidAdded_kgh > 1e-4) {
      waterTone = 'accent';
      waterMain = units === 'IP'
        ? `−${r.condensate_lbh.toFixed(1)} / +${r.humidAdded_lbh.toFixed(1)} lb/h`
        : `−${r.condensate_kgh.toFixed(2)} / +${r.humidAdded_kgh.toFixed(2)} kg/h`;
      waterSub = `Cond. ${(r.condensate_kgh / GAL_WATER_KG).toFixed(2)} gph · Humid. ${(r.humidAdded_kgh / GAL_WATER_KG).toFixed(2)} gph`;
    } else if (r.condensate_kgh > 1e-4) {
      waterLbl = 'Coil Condensate Removed';
      waterTone = 'accent';
      waterMain = units === 'IP'
        ? `${r.condensate_lbh.toFixed(1)} lb/h`
        : `${r.condensate_kgh.toFixed(2)} kg/h`;
      waterSub = `${(r.condensate_kgh / GAL_WATER_KG).toFixed(2)} gph · ${units === 'IP' ? r.condensate_kgh.toFixed(2) + ' kg/h' : r.condensate_lbh.toFixed(1) + ' lb/h'}`;
    } else if (r.humidAdded_kgh > 1e-4) {
      waterLbl = 'Humidifier Water Added';
      waterTone = 'success';
      waterMain = units === 'IP'
        ? `+${r.humidAdded_lbh.toFixed(1)} lb/h`
        : `+${r.humidAdded_kgh.toFixed(2)} kg/h`;
      waterSub = `${(r.humidAdded_kgh / GAL_WATER_KG).toFixed(2)} gph · ${units === 'IP' ? r.humidAdded_kgh.toFixed(2) + ' kg/h' : r.humidAdded_lbh.toFixed(1) + ' lb/h'}`;
    }

    const footnotes = [];
    if (r.spaceLoad_kW > 1e-3) {
      const spTxt = units === 'IP'
        ? `${r.spaceLoad_TR.toFixed(2)} TR (${r.spaceLoad_MBH.toFixed(1)} MBH)`
        : `${r.spaceLoad_kW.toFixed(1)} kW (${r.spaceLoad_TR.toFixed(2)} TR)`;
      footnotes.push(`<span>Space Load: <b>${esc(spTxt)}</b></span>`);
    }
    if (r.ervSaved_kW > 1e-3) {
      const ervTxt = units === 'IP'
        ? `${r.ervSaved_TR.toFixed(2)} TR (${r.ervSaved_MBH.toFixed(1)} MBH)`
        : `${r.ervSaved_kW.toFixed(1)} kW (${r.ervSaved_TR.toFixed(2)} TR)`;
      footnotes.push(`<span style="color:var(--erv,var(--success))">ERV Recovered: <b>${esc(ervTxt)}</b></span>`);
    }
    const footnoteHtml = footnotes.length
      ? `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin-top:5px;padding:4px 6px;border-radius:var(--r-xs,4px);background:var(--panel2);font-family:var(--mono);font-size:9.5px;color:var(--muted)">${footnotes.join('')}</div>`
      : '';

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:9.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)">Mechanical Equipment Loads (${r.mechCount} Equip. · ${r.validCount} Proc.)</span>
      </div>
      <div class="calcResult" style="margin:0">
        ${metricCard('Mechanical Cooling Coil', esc(coolMain), esc(coolSub), r.mechCooling_kW > 0 ? 'accent' : '')}
        ${metricCard('Mechanical Heating / Reheat', esc(heatMain), esc(heatSub), r.mechHeating_kW > 0 ? 'danger' : '')}
        ${metricCard(waterLbl, esc(waterMain), esc(waterSub), waterTone, true)}
      </div>
      ${footnoteHtml}
    `;
  }

  function renderProcessesTab() {
    const selA = byId('procA');
    const selB = byId('procB');
    populatePointSelect(selA, { defaultIndex: 0 });
    populatePointSelect(selB, { defaultIndex: 1 });
    ensureDistinctPair(selA, selB);
    const selProc = getSelectedProcess();
    populateProcessSelect(byId('procSel'), selProc ? selProc.id : null);
    renderProcessCards();
    renderCycleSummary();
    renderSelectedProcessMetrics();
  }

  function wireProcessesTab() {
    const clearProcPairInvalid = () => {
      byId('procA')?.classList.remove('field-invalid');
      byId('procB')?.classList.remove('field-invalid');
    };
    on(byId('procA'), 'change', clearProcPairInvalid);
    on(byId('procB'), 'change', clearProcPairInvalid);

    on(byId('procAdd'), 'click', () => {
      const selA = byId('procA');
      const selB = byId('procB');
      const aId = selA?.value;
      const bId = selB?.value;
      if (!aId || !bId || aId === bId) {
        const pts = store.state.points || [];
        const samePt = aId ? store.getPoint(aId) : null;
        const msg = pts.length < 2
          ? 'Add a second state point first — a process needs 2 different points'
          : (aId && aId === bId
            ? `Cannot link "${samePt?.label || 'point'}" to itself — choose a different End point`
            : 'Select two different state points');
        selA?.classList.add('field-invalid');
        selB?.classList.add('field-invalid');
        setTimeout(clearProcPairInvalid, 2200);
        toast(msg, 'error', byId('procAdd'));
        return;
      }
      clearProcPairInvalid();
      const units = getUnits();
      const rawFlow = parseFloat(byId('flowVal')?.value);
      const flowVal = Number.isFinite(rawFlow) && rawFlow > 0
        ? rawFlow
        : (units === 'IP' ? 2000 : 1000);
      const flowUnit = normFlowUnit(byId('flowUnit')?.value, units);
      const created = store.addProcess(aId, bId, { flowVal, flowUnit });
      if (created) {
        store.setUI({ selectedProcId: created.id });
        const ptA = store.getPoint(created.aId);
        const ptB = store.getPoint(created.bId);
        toast(`Process added: ${ptA?.label || ''} → ${ptB?.label || ''}`, 'success');
      }
    });

    on(byId('procSel'), 'change', (e) => {
      const id = e.target.value;
      if (id) store.setUI({ selectedProcId: Number(id) || id });
    });

    const applyFlowChange = (recordHistory, skipIfUnchanged = false) => {
      const proc = getSelectedProcess();
      if (!proc) return;
      const val = parseFloat(byId('flowVal')?.value);
      const unit = normFlowUnit(byId('flowUnit')?.value, getUnits());
      if (!Number.isFinite(val) || val < 0) return;
      const curUnit = normFlowUnit(proc.flowUnit, getUnits());
      if (skipIfUnchanged && Math.abs(val - Number(proc.flowVal)) < 1e-9 && unit === curUnit) {
        return;
      }
      store.updateProcess(proc.id, { flowVal: val, flowUnit: unit }, recordHistory);
    };

    on(byId('flowVal'), 'focus', () => {
      flowEditSessionPushed = false;
    });
    on(byId('flowVal'), 'input', () => {
      const proc = getSelectedProcess();
      if (!proc) return;
      const val = parseFloat(byId('flowVal')?.value);
      const unit = normFlowUnit(byId('flowUnit')?.value, getUnits());
      if (!Number.isFinite(val) || val < 0) return;
      const curUnit = normFlowUnit(proc.flowUnit, getUnits());
      if (Math.abs(val - Number(proc.flowVal)) < 1e-9 && unit === curUnit) return;
      applyFlowChange(!flowEditSessionPushed, false);
      flowEditSessionPushed = true;
    });
    on(byId('flowVal'), 'change', () => {
      applyFlowChange(!flowEditSessionPushed, true);
      flowEditSessionPushed = false;
    });
    on(byId('flowUnit'), 'change', () => applyFlowChange(true, true));

    on(byId('procRev'), 'click', () => {
      const proc = getSelectedProcess();
      if (!proc) return;
      store.reverseProcess(proc.id);
      toast('Process direction reversed', 'info');
    });

    on(byId('procDel'), 'click', () => {
      const proc = getSelectedProcess();
      if (!proc) return;
      store.deleteProcess(proc.id);
      toast('Process deleted', 'success');
    });

    const curveEl = byId('procCurveToggle');
    if (curveEl) {
      const evt = (curveEl.tagName === 'INPUT' && curveEl.type === 'checkbox') ? 'change' : 'click';
      on(curveEl, evt, () => {
        const proc = getSelectedProcess();
        if (!proc) return;
        const a = store.getPoint(proc.aId);
        const b = store.getPoint(proc.bId);
        const nextCurve = evt === 'change' ? Boolean(curveEl.checked) : !proc.showCurve;
        if (nextCurve && !isCoolingDehumPair(a, b)) {
          if (evt === 'change') curveEl.checked = false;
          toast('Curved coil path only applies to cooling & dehumidification processes (T_out < T_in and W_out < W_in)', 'warn', curveEl);
          return;
        }
        const patch = { showCurve: nextCurve };
        if (nextCurve) {
          if (a && b) {
            const adp = HVAC.calcADP(a, b, getPPa());
            if (adp.valid) {
              patch.adpT = adp.T_adp;
              patch.adpW = adp.w_adp;
            }
          }
          if (store.state.layers && store.state.layers.adpLines === false) {
            store.setLayer('adpLines', true);
          }
        }
        store.updateProcess(proc.id, patch, true);
        toast(nextCurve ? 'Curved coil trajectory + ADP extension ON' : 'Straight vector path', 'info');
      });
    }
  }

  /* ==========================================================================
     TAB 2 — HVAC SYSTEMS DESIGNER (`#tabSystems`)
     ========================================================================== */

  const SYS_PANELS = {
    ahu: 'sysPanelAhu',
    erv: 'sysPanelErv',
    evap: 'sysPanelEvap',
    desiccant: 'sysPanelDesiccant',
    humidifier: 'sysPanelHumidifier'
  };

  function setSystemTool(toolKey) {
    const key = SYS_PANELS[toolKey] ? toolKey : 'ahu';
    const sel = byId('sysToolSel');
    if (sel && sel.value !== key) sel.value = key;
    for (const [k, panelId] of Object.entries(SYS_PANELS)) {
      const panel = byId(panelId);
      if (panel) {
        panel.style.display = k === key ? '' : 'none';
        panel.classList.toggle('active', k === key);
      }
    }
  }

  function normalizeAhuMode(raw) {
    const v = String(raw || 'summer_reheat').trim().toLowerCase();
    if (v === 'summer_reheat' || v === 'summer') return 'summer_reheat';
    if (v === 'doas_erv' || v === 'erv-summer' || v === 'erv-winter' || v === 'erv') return 'doas_erv';
    if (v === 'winter_humid' || v === 'winter') return 'winter_humid';
    if (v === 'economizer' || v === 'econ') return 'economizer';
    return 'summer_reheat';
  }

  function initAhuModeDropdown() {
    const sel = byId('ahuMode');
    if (!sel) return;
    sel.innerHTML = `
      <option value="summer_reheat" selected>Summer Cooling + Reheat</option>
      <option value="doas_erv">DOAS + ERV Enthalpy Wheel</option>
      <option value="winter_humid">Winter Heating + Humidification</option>
      <option value="economizer">Airside Economizer (Free Cool)</option>
    `;
  }

  function syncAhuModeVisibility(modeKey) {
    const mode = normalizeAhuMode(modeKey);
    const u = getUnits();
    const ul = getUnitLabels(u);
    const showOaPct = mode !== 'doas_erv';
    const showCoil = mode !== 'winter_humid';
    const showErv = mode === 'doas_erv';

    const setFieldVis = (inputId, visible) => {
      const field = byId(inputId)?.closest('.field');
      if (field) field.hidden = !visible;
    };

    setFieldVis('ahuOaPct', showOaPct);
    setFieldVis('ahuCoilAdp', showCoil);
    setFieldVis('ahuCoilBpf', showCoil);
    setFieldVis('ahuErvSens', showErv);
    setFieldVis('ahuErvLat', showErv);

    // Hide any parent row where every .field child is hidden
    const ahuPanel = byId('sysPanelAhu');
    if (ahuPanel) {
      ahuPanel.querySelectorAll('.row, .row3').forEach(row => {
        const fields = Array.from(row.querySelectorAll(':scope > .field'));
        if (fields.length > 0) {
          row.hidden = fields.every(f => f.hidden);
        }
      });
    }

    // Contextual labels per mode
    setFieldLabel('ahuOaPct', mode === 'economizer' ? 'Min OA (%)' : 'OA Fraction (%)');
    setFieldLabel('ahuReheatT', mode === 'winter_humid' ? `Heating Coil T (${ul.T})` : `Reheat T (${ul.T})`);
  }

  function applyAhuModeDefaults(modeKey) {
    const mode = normalizeAhuMode(modeKey);
    const preset = AHU_MODE_PRESETS[mode];
    if (!preset) return;
    const u = getUnits();
    const setIfUnedited = (id, val, dec) => {
      if (!ahuEditedFields.has(id)) setInputVal(id, val, dec);
    };
    setIfUnedited('ahuOaT', CoreDOM.tToDisp(preset.oaT, u), 1);
    setIfUnedited('ahuOaRH', preset.oaRH, 0);
    setIfUnedited('ahuRaT', CoreDOM.tToDisp(preset.raT, u), 1);
    setIfUnedited('ahuRaRH', preset.raRH, 0);
    setIfUnedited('ahuOaPct', preset.oaPct, 0);
    setIfUnedited('ahuFlow', lpsToDispFlow(preset.flowLps, u), 0);
    setIfUnedited('ahuCoilAdp', CoreDOM.tToDisp(preset.coilAdp, u), 1);
    setIfUnedited('ahuCoilBpf', preset.coilBpf, 2);
    setIfUnedited('ahuReheatT', CoreDOM.tToDisp(preset.reheatT, u), 1);
    setIfUnedited('ahuFanDp', u === 'IP' ? preset.fanDp / PA_PER_INWG : preset.fanDp, u === 'IP' ? 2 : 0);
    setIfUnedited('ahuFanEff', preset.fanEff, 2);
    setIfUnedited('ahuErvSens', preset.ervSens, 2);
    setIfUnedited('ahuErvLat', preset.ervLat, 2);
    syncAhuModeVisibility(mode);
  }

  function mapAhuProcRole(kind) {
    if (kind === 'room') return 'room';
    if (kind === 'erv') return 'erv';
    if (kind === 'erv_exhaust') return 'erv_exhaust';
    if (kind === 'fan') return 'fan';
    if (kind === 'humidify') return 'humid';
    return 'coil';
  }

  function buildAndPlotAHU() {
    const units = getUnits();
    const pPa = getPPa();
    const mode = normalizeAhuMode(byId('ahuMode')?.value);

    const oaT = CoreDOM.dispToT(numInput('ahuOaT', units === 'IP' ? 95 : 35), units);
    const oaRH = clamp(numInput('ahuOaRH', 55), 0, 100);
    const raT = CoreDOM.dispToT(numInput('ahuRaT', units === 'IP' ? 75 : 24), units);
    const raRH = clamp(numInput('ahuRaRH', 50), 0, 100);
    const oaPct = clamp(numInput('ahuOaPct', 25), 0, 100);
    const supplyFlowLps = Math.max(1, dispFlowToLps(numInput('ahuFlow', units === 'IP' ? 4238 : 2000), units));
    const coilAdp = CoreDOM.dispToT(numInput('ahuCoilAdp', units === 'IP' ? 52 : 11), units);
    const coilBpf = clamp(normalizeFrac(numInput('ahuCoilBpf', 0.15), 0.15), 0, 0.95);
    const reheatT = CoreDOM.dispToT(numInput('ahuReheatT', units === 'IP' ? 61 : 16), units);
    const rawFanDp = Math.max(0, numInput('ahuFanDp', units === 'IP' ? 750 / PA_PER_INWG : 750));
    const fanDpPa = units === 'IP' ? rawFanDp * PA_PER_INWG : rawFanDp;
    const fanEff = clamp(normalizeFrac(numInput('ahuFanEff', 0.65), 0.65), 0.1, 0.99);
    const ervSensEff = clamp(normalizeFrac(numInput('ahuErvSens', 0.72), 0.72), 0, 0.98);
    const ervLatEff = clamp(normalizeFrac(numInput('ahuErvLat', 0.65), 0.65), 0, 0.98);

    // Match room humidity target directly without forcing an artificial floor
    const raW = Psy.w_from_TRH(raT, raRH / 100, pPa);
    const humidTargetW = raW;

    const cycle = HVAC.buildAHUCycle({
      mode,
      oaT,
      oaRH,
      raT,
      raRH,
      oaPct,
      supplyFlow: supplyFlowLps,
      flowUnit: 'Lps',
      coilAdp,
      coilBpf,
      reheatT,
      fanDpPa,
      fanEff,
      ervSensEff,
      ervLatEff,
      humidTargetW
    }, pPa);

    // Prepare points with live-linked derived mixing metadata for MA so lever-rule lines render
    const oaPt = cycle.points.find(p => p.key === 'OA');
    const raPt = cycle.points.find(p => p.key === 'RA');
    const oaFracUsed = clamp((cycle.summary?.oaPctUsed ?? oaPct) / 100, 0, 1);

    const storePts = cycle.points.map(pt => {
      const out = {
        key: pt.key,
        T: pt.T,
        w: pt.w,
        label: pt.label,
        color: pt.color,
        note: pt.note || ''
      };
      if (pt.key === 'MA' && oaPt && raPt && oaFracUsed > 1e-4 && oaFracUsed < 1 - 1e-4) {
        const mOA = Psy.flowToMassKgps(supplyFlowLps * oaFracUsed, 'Lps', oaPt.T, oaPt.w, pPa);
        const mRA = Psy.flowToMassKgps(supplyFlowLps * (1 - oaFracUsed), 'Lps', raPt.T, raPt.w, pPa);
        out.locked = true;
        out.derived = {
          type: 'mix',
          streams: [
            { id: 'OA', m: mOA },
            { id: 'RA', m: mRA }
          ]
        };
      }
      return out;
    });

    const storeProcs = cycle.processes.map(pr => {
      const dispFlow = units === 'IP'
        ? { flowVal: CoreDOM.round(pr.flowVal * CFM_PER_LPS, 1), flowUnit: 'cfm' }
        : { flowVal: CoreDOM.round(pr.flowVal, 1), flowUnit: 'Lps' };
      const isCooling = pr.kind === 'cooling' && Number.isFinite(cycle.summary?.coilAdp);
      return {
        aId: pr.fromKey,
        bId: pr.toKey,
        flowVal: dispFlow.flowVal,
        flowUnit: dispFlow.flowUnit,
        showCurve: Boolean(pr.curved),
        adpT: isCooling ? cycle.summary.coilAdp : null,
        adpW: isCooling ? Psy.wsat_at(cycle.summary.coilAdp, pPa) : null,
        label: pr.label || '',
        role: mapAhuProcRole(pr.kind)
      };
    });

    const modeLabel = AHU_MODE_PRESETS[mode]?.label || mode;
    store.loadCycle(storePts, storeProcs, {}, `AHU Wizard: ${modeLabel}`);
    if (typeof store.fitPoints === 'function') {
      store.fitPoints(false);
    }

    lastAhuCycle = cycle;
    renderAhuResults(cycle);
    toast(`AHU cycle built: ${modeLabel}`, 'success');
  }

  function renderAhuResults(cycle) {
    const c = byId('ahuResults');
    if (!c || !cycle?.summary) return;
    lastAhuCycle = cycle;
    const s = cycle.summary;
    const u = getUnits();

    const coolMain = u === 'IP'
      ? `${s.cooling_TR.toFixed(2)} TR`
      : `${s.cooling_kW.toFixed(2)} kW`;
    const coolSub = u === 'IP'
      ? `${s.cooling_kW.toFixed(2)} kW · ${fmtBTUh(s.cooling_kW * BTUH_PER_KW, false)}`
      : `${s.cooling_TR.toFixed(2)} TR · ${fmtBTUh(s.cooling_kW * BTUH_PER_KW, false)}`;

    const heatKw = s.reheat_kW > 0 ? s.reheat_kW : s.preheat_kW;
    const heatLbl = s.preheat_kW > 0 && s.reheat_kW <= 0 ? 'Heating Coil' : 'Reheat Coil';
    const heatMain = fmtEnergy(heatKw, u, false);
    const heatSub = u === 'IP'
      ? `${heatKw.toFixed(2)} kW`
      : `${((heatKw * BTUH_PER_KW) / 1000).toFixed(1)} MBH`;

    const fanHp = s.fan_kW / KW_PER_HP;
    const fanMain = u === 'IP'
      ? `${fanHp.toFixed(2)} HP`
      : `${s.fan_kW.toFixed(2)} kW`;
    const fanSub = u === 'IP'
      ? `${fmtBTUh(s.fan_kW * BTUH_PER_KW, false)} · ${s.fan_kW.toFixed(2)} kW`
      : `${fmtBTUh(s.fan_kW * BTUH_PER_KW, false)} · ${fanHp.toFixed(2)} HP`;

    const savedLbl = cycle.mode === 'economizer' ? 'Economizer Saved' : 'ERV Energy Saved';
    const savedKw = cycle.mode === 'economizer' ? (s.economizerSaved_kW || 0) : (s.ervSaved_kW || 0);
    const savedMain = fmtEnergy(savedKw, u, false);
    const savedSub = savedKw > 0
      ? `${(savedKw / KW_PER_TON).toFixed(2)} TR · ${u === 'IP' ? savedKw.toFixed(2) + ' kW' : ((savedKw * BTUH_PER_KW) / 1000).toFixed(1) + ' MBH'}`
      : 'Inactive in mode';

    const isHumid = s.humidWater_kgh > 1e-4 && s.condensate_kgh <= 1e-4;
    const waterKgh = isHumid ? s.humidWater_kgh : s.condensate_kgh;
    const waterLbl = isHumid ? 'Humidifier Water' : 'Coil Condensate';
    const waterGph = waterKgh / GAL_WATER_KG;
    const waterMain = u === 'IP'
      ? `${(waterKgh * LB_PER_KG).toFixed(2)} lb/h`
      : `${waterKgh.toFixed(2)} kg/h`;
    const waterSub = `${waterGph.toFixed(2)} gph · ${u === 'IP' ? waterKgh.toFixed(2) + ' kg/h' : (waterKgh * LB_PER_KG).toFixed(2) + ' lb/h'}`;

    const shrTxt = Number.isFinite(s.roomSHR) ? s.roomSHR.toFixed(3) : '—';
    const supTxt = `${fmtTemp(s.supplyT_C, u, 1)} · ${s.supplyRH.toFixed(1)}% RH`;

    let html = '';
    if (s.frostRisk) {
      html += `<div class="full" style="padding:6px 8px;border-radius:var(--r-sm);background:var(--dangerSoft);border:1px solid var(--dangerBorder);color:var(--danger);font-size:10.5px;font-weight:600">⚠ ERV Frost Risk Detected — Exhaust leaves below ${esc(fmtTemp(0, u, 0))} (preheat or defrost cycle required)</div>`;
    }
    if (cycle.mode === 'economizer' && s.economizerState) {
      const econLabels = {
        modulating_free_cooling: '✓ Modulating Free Cooling Active',
        integrated_100pct_oa: '✓ Integrated 100% OA Economizer',
        locked_out: 'Economizer Locked Out (OA h ≥ RA h)'
      };
      const econTone = s.economizerState === 'locked_out' ? 'var(--warn)' : 'var(--success)';
      const econBg = s.economizerState === 'locked_out' ? 'var(--warnSoft)' : 'var(--successSoft)';
      const econBdr = s.economizerState === 'locked_out' ? 'var(--warnBorder)' : 'var(--successBorder)';
      html += `<div class="full" style="padding:5px 8px;border-radius:var(--r-sm);background:${econBg};border:1px solid ${econBdr};color:${econTone};font-size:10.5px;font-weight:600">${esc(econLabels[s.economizerState] || s.economizerState)} · OA ${s.oaPctUsed.toFixed(0)}%</div>`;
    }

    html += metricCard('Cooling Coil', esc(coolMain), esc(coolSub), s.cooling_kW > 0 ? 'accent' : '');
    html += metricCard(heatLbl, esc(heatMain), esc(heatSub), heatKw > 0 ? 'danger' : '');
    html += metricCard('Supply Fan Power', esc(fanMain), esc(fanSub));
    html += metricCard(savedLbl, esc(savedMain), esc(savedSub), savedKw > 0 ? 'success' : '');
    html += metricCard(waterLbl, esc(waterMain), esc(waterSub));
    html += metricCard('Room SHR', esc(shrTxt), `Qs ${fmtEnergy(s.roomQs_kW, u, false)}`);
    html += metricCard('Supply Air (SA)', esc(supTxt), `OA Fraction: ${(s.oaPctUsed ?? 0).toFixed(0)}%`, 'accent', true);

    c.innerHTML = html;
  }

  /* ---- ERV / Enthalpy Wheel ---- */

  function computeErvFromUI() {
    const oa = store.getPoint(byId('ervOaPt')?.value);
    const ra = store.getPoint(byId('ervRaPt')?.value);
    if (!oa || !ra) {
      toast('Select both Outdoor Air and Return/Exhaust points', 'error');
      return null;
    }
    if (oa.id === ra.id) {
      toast('OA and RA points must be different', 'error');
      return null;
    }
    const units = getUnits();
    const pPa = getPPa();
    const sensEff = normalizeFrac(numInput('ervSensEff', 0.75), 0.75);
    const latEff = normalizeFrac(numInput('ervLatEff', 0.65), 0.65);
    const flowDisp = Math.max(1, numInput('ervFlow', units === 'IP' ? 2119 : 1000));
    const flowUnit = units === 'IP' ? 'cfm' : 'Lps';

    const res = HVAC.calcERV(oa, ra, pPa, {
      sensEff,
      latEff,
      flowOA: flowDisp,
      flowRA: flowDisp,
      flowUnit
    });
    return { oa, ra, flowDisp, flowUnit, sensEff, latEff, res };
  }

  function renderErvResults(data) {
    const c = byId('ervResults');
    if (!c || !data) return;
    lastErvData = data;
    const { res } = data;
    const u = getUnits();
    const pPa = getPPa();
    const supRH = Psy.RH_from_Tw(res.supplyOut.T, res.supplyOut.w, pPa) * 100;
    const exhRH = Psy.RH_from_Tw(res.exhaustOut.T, res.exhaustOut.w, pPa) * 100;

    let html = '';
    if (res.frostRisk) {
      html += `<div class="full" style="padding:6px 8px;border-radius:var(--r-sm);background:var(--dangerSoft);border:1px solid var(--dangerBorder);color:var(--danger);font-size:10.5px;font-weight:600">⚠ Frost Risk: Exhaust out ${esc(fmtTemp(res.exhaustOut.T, u, 1))} (&lt; ${esc(fmtTemp(0, u, 0))}) — Frost control / preheat needed</div>`;
    } else {
      html += `<div class="full" style="padding:5px 8px;border-radius:var(--r-sm);background:var(--successSoft);border:1px solid var(--successBorder);color:var(--success);font-size:10.5px;font-weight:600">✓ No Frost Risk · Exhaust Tdp ${esc(fmtTemp(res.exhaustTdp, u, 1))}</div>`;
    }

    const totalSavedSub = u === 'IP'
      ? `${res.QtSaved_TR.toFixed(2)} TR · ${res.QtSaved_kW.toFixed(2)} kW`
      : `${res.QtSaved_TR.toFixed(2)} TR · ${fmtBTUh(res.QtSaved_kW * BTUH_PER_KW, false)}`;

    html += metricCard('Supply Out', esc(fmtTemp(res.supplyOut.T, u, 1)), `${supRH.toFixed(1)}% RH · ${esc(fmtW(res.supplyOut.w, u))}`, 'accent');
    html += metricCard('Exhaust Out', esc(fmtTemp(res.exhaustOut.T, u, 1)), `${exhRH.toFixed(1)}% RH · ${esc(fmtW(res.exhaustOut.w, u))}`);
    html += metricCard('Sensible Recovered', esc(fmtEnergy(res.QsSaved_kW, u, false)), u === 'IP' ? `${res.QsSaved_kW.toFixed(2)} kW` : fmtBTUh(res.QsSaved_kW * BTUH_PER_KW, false));
    html += metricCard('Latent Recovered', esc(fmtEnergy(res.QlSaved_kW, u, false)), u === 'IP' ? `${res.QlSaved_kW.toFixed(2)} kW` : fmtBTUh(res.QlSaved_kW * BTUH_PER_KW, false));
    html += metricCard('Total Energy Saved', esc(fmtEnergy(res.QtSaved_kW, u, false)), totalSavedSub, 'success', true);
    c.innerHTML = html;
  }

  /* ---- Evaporative Cooler ---- */

  function computeEvapFromUI() {
    const inlet = store.getPoint(byId('evapInPt')?.value);
    if (!inlet) {
      toast('Select an Entering Air point', 'error');
      return null;
    }
    const units = getUnits();
    const pPa = getPPa();
    const rawMode = String(byId('evapMode')?.value || 'direct').toLowerCase();
    const mode = (rawMode === 'two-stage' || rawMode === 'twostage') ? 'twostage' : rawMode;
    const effDirect = normalizeFrac(numInput('evapEffDir', 0.85), 0.85);
    const effIndirect = normalizeFrac(numInput('evapEffInd', 0.75), 0.75);
    const flowDisp = Math.max(1, numInput('evapFlow', units === 'IP' ? 2119 : 1000));
    const flowUnit = units === 'IP' ? 'cfm' : 'Lps';

    const res = HVAC.calcEvapCooler(inlet, pPa, {
      mode,
      effDirect,
      effIndirect,
      flowVal: flowDisp,
      flowUnit
    });
    return { inlet, mode, flowDisp, flowUnit, res };
  }

  function renderEvapResults(data) {
    const c = byId('evapResults');
    if (!c || !data) return;
    lastEvapData = data;
    const { res } = data;
    const u = getUnits();
    const pPa = getPPa();
    const outRH = Psy.RH_from_Tw(res.outlet.T, res.outlet.w, pPa) * 100;
    const dTDisp = u === 'IP' ? CoreDOM.dCtoF(res.T_drop) : res.T_drop;
    const waterMain = u === 'IP' ? `${res.waterUse_gph.toFixed(2)} gph` : `${res.waterUse_Lh.toFixed(2)} L/h`;
    const waterSub = u === 'IP' ? `${res.waterUse_Lh.toFixed(2)} L/h` : `${res.waterUse_gph.toFixed(2)} gph`;
    const capMain = u === 'IP' ? `${res.Q_equiv_TR.toFixed(2)} TR` : `${res.Q_equiv_kW.toFixed(2)} kW`;
    const capSub = u === 'IP'
      ? `${fmtBTUh(res.Q_equiv_BTUh, false)} · ${res.Q_equiv_kW.toFixed(2)} kW`
      : `${res.Q_equiv_TR.toFixed(2)} TR · ${fmtBTUh(res.Q_equiv_BTUh, false)}`;

    let html = '';
    html += metricCard('Outlet Air', esc(fmtTemp(res.outlet.T, u, 1)), `${outRH.toFixed(1)}% RH · ${esc(fmtW(res.outlet.w, u))}`, 'accent');
    html += metricCard('Dry-Bulb Drop (ΔT)', `−${Math.abs(dTDisp).toFixed(2)} ${getUnitLabels(u).T}`, `Twb out ${esc(fmtTemp(res.outletTwb, u, 1))}`, 'success');
    html += metricCard('Water Consumption', esc(waterMain), esc(waterSub));
    html += metricCard('Equiv. Cooling Cap.', esc(capMain), esc(capSub), 'accent');
    if (res.stages.length === 2) {
      const mid = res.stages[0].to;
      const midRH = Psy.RH_from_Tw(mid.T, mid.w, pPa) * 100;
      html += metricCard('Stage 1 (IEC) Intermediate', esc(fmtTemp(mid.T, u, 1)), `${midRH.toFixed(1)}% RH · ${esc(fmtW(mid.w, u))}`, '', true);
    }
    c.innerHTML = html;
  }

  /* ---- Desiccant Wheel ---- */

  function computeDesiccantFromUI() {
    const inlet = store.getPoint(byId('desInPt')?.value);
    if (!inlet) {
      toast('Select an Entering Air point', 'error');
      return null;
    }
    const units = getUnits();
    const pPa = getPPa();
    const moistureRemovalEff = normalizeFrac(numInput('desEff', 0.65), 0.65);
    const thermalCarryover = normalizeFrac(numInput('desCarry', 0.15), 0.15);
    const flowDisp = Math.max(1, numInput('desFlow', units === 'IP' ? 2119 : 1000));
    const flowUnit = units === 'IP' ? 'cfm' : 'Lps';

    const res = HVAC.calcDesiccant(inlet, pPa, {
      moistureRemovalEff,
      thermalCarryover,
      flowVal: flowDisp,
      flowUnit
    });
    return { inlet, flowDisp, flowUnit, res };
  }

  function renderDesiccantResults(data) {
    const c = byId('desResults');
    if (!c || !data) return;
    lastDesData = data;
    const { res } = data;
    const u = getUnits();
    const pPa = getPPa();
    const outRH = Psy.RH_from_Tw(res.outlet.T, res.outlet.w, pPa) * 100;
    const outTdp = Psy.dewpoint_from_pv(Psy.pv_from_w(res.outlet.w, pPa));
    const rateMain = u === 'IP' ? `${res.moistureRate_lbh.toFixed(2)} lb/h` : `${res.moistureRate_kgh.toFixed(2)} kg/h`;
    const rateSub = u === 'IP' ? `${res.moistureRate_kgh.toFixed(2)} kg/h` : `${res.moistureRate_lbh.toFixed(2)} lb/h`;
    const regenMain = fmtEnergy(res.regenHeat_kW, u, false);
    const regenSub = u === 'IP'
      ? `${res.regenHeat_kW.toFixed(2)} kW`
      : `${((res.regenHeat_kW * BTUH_PER_KW) / 1000).toFixed(1)} MBH`;

    c.innerHTML = [
      metricCard('Outlet State', esc(fmtTemp(res.outlet.T, u, 1)), `${outRH.toFixed(1)}% RH · ${esc(fmtW(res.outlet.w, u))}`, 'warn'),
      metricCard('Outlet Dew Point', esc(fmtTemp(outTdp, u, 1)), `ΔW −${esc(fmtW(res.dW_removed, u))}`),
      metricCard('Moisture Removed', esc(rateMain), esc(rateSub), 'accent'),
      metricCard('Est. Regen. Heat', esc(regenMain), esc(regenSub), 'danger')
    ].join('');
  }

  /* ---- Humidifier Sizer ---- */

  function computeHumidifierFromUI() {
    const inlet = store.getPoint(byId('humInPt')?.value);
    if (!inlet) {
      toast('Select an Entering Air point', 'error');
      return null;
    }
    const units = getUnits();
    const pPa = getPPa();
    const rawMode = String(byId('humMode')?.value || 'steam').toLowerCase();
    const mode = (rawMode === 'adiabatic' || rawMode === 'ultrasonic') ? 'adiabatic' : 'steam';
    const targetWDisp = numInput('humTargetW', units === 'IP' ? 63 : 9.0);
    const targetWKgKg = CoreDOM.dispToW(targetWDisp, units);
    const flowDisp = Math.max(1, numInput('humFlow', units === 'IP' ? 2119 : 1000));
    const flowUnit = units === 'IP' ? 'cfm' : 'Lps';

    const res = HVAC.calcHumidifier(inlet, targetWKgKg, pPa, {
      mode,
      flowVal: flowDisp,
      flowUnit
    });
    return { inlet, rawMode, mode, targetWKgKg, flowDisp, flowUnit, res };
  }

  function renderHumidifierResults(data) {
    const c = byId('humResults');
    if (!c || !data) return;
    lastHumData = data;
    const { inlet, rawMode, mode, res } = data;
    const u = getUnits();
    const pPa = getPPa();

    if (res.dW <= 1e-9) {
      c.innerHTML = `<div class="full" style="padding:6px 8px;border-radius:var(--r-sm);background:var(--warnSoft);border:1px solid var(--warnBorder);color:var(--warn);font-size:10.5px;font-weight:600">Target W (${esc(fmtW(data.targetWKgKg, u))}) is at or below inlet W (${esc(fmtW(inlet.w, u))}) — no humidification needed.</div>`;
      return;
    }

    const outRH = Psy.RH_from_Tw(res.outlet.T, res.outlet.w, pPa) * 100;
    const massMain = u === 'IP' ? `${res.waterRate_lbh.toFixed(2)} lb/h` : `${res.waterRate_kgh.toFixed(2)} kg/h`;
    const massSub = `${res.waterRate_gph.toFixed(2)} gph · ${u === 'IP' ? res.waterRate_kgh.toFixed(2) + ' kg/h' : res.waterRate_lbh.toFixed(2) + ' lb/h'}`;
    const massLbl = mode === 'steam' ? 'Steam Mass Flow' : 'Water Spray Rate';
    const energyLbl = mode === 'steam' ? 'Boiler Steam Energy' : 'Humidifier Thermal Input';
    const steamMain = mode === 'steam'
      ? fmtEnergy(res.steamEnergy_kW, u, false)
      : (u === 'IP' ? '0 BTU/h (Adiabatic)' : '0.00 kW (Adiabatic)');
    const steamSub = mode === 'steam'
      ? (u === 'IP' ? `${res.steamEnergy_kW.toFixed(2)} kW` : fmtBTUh(res.steamEnergy_kW * BTUH_PER_KW, false))
      : `Air ΔT ${fmtDeltaT(res.outlet.T - inlet.T, u, 2)}`;

    let html = '';
    if (res.saturatedClamped) {
      html += `<div class="full" style="padding:6px 8px;border-radius:var(--r-sm);background:var(--warnSoft);border:1px solid var(--warnBorder);color:var(--warn);font-size:10.5px;font-weight:600">⚠ Target W exceeded 100% RH saturation limit — clamped to saturation (${esc(fmtW(res.outlet.w, u))})</div>`;
    }
    html += metricCard('Outlet Air', esc(fmtTemp(res.outlet.T, u, 1)), `${outRH.toFixed(1)}% RH · ${esc(fmtW(res.outlet.w, u))}`, 'success');
    html += metricCard('Mode', esc(rawMode === 'ultrasonic' ? 'Ultrasonic (Adiab.)' : (mode === 'steam' ? 'Isothermal Steam' : 'Adiabatic Spray')), `ΔW +${esc(fmtW(res.dW, u))}`);
    html += metricCard(massLbl, esc(massMain), esc(massSub), 'accent');
    html += metricCard(energyLbl, esc(steamMain), esc(steamSub), mode === 'steam' ? 'danger' : '');
    c.innerHTML = html;
  }

  function syncEvapEffVisibility() {
    const mode = String(byId('evapMode')?.value || 'direct').toLowerCase();
    const dirInp = byId('evapEffDir');
    const indInp = byId('evapEffInd');
    const dirDisabled = mode === 'indirect';
    const indDisabled = mode === 'direct';
    if (dirInp) dirInp.disabled = dirDisabled;
    if (indInp) indInp.disabled = indDisabled;
    const dirField = dirInp?.closest('.field');
    const indField = indInp?.closest('.field');
    if (dirField) dirField.style.opacity = dirDisabled ? '0.45' : '1';
    if (indField) indField.style.opacity = indDisabled ? '0.45' : '1';
  }

  function upsertWizardPoint(label, ptData) {
    const existing = (store.state.points || []).find(p => p.label === label);
    if (existing) {
      return store.updatePoint(existing.id, {
        T: ptData.T,
        w: ptData.w,
        color: ptData.color,
        note: ptData.note,
        force: true
      }, false);
    }
    return store.addPoint({ ...ptData, label }, false);
  }

  function upsertWizardProcess(aId, bId, opts = {}) {
    const procs = store.state.processes || [];
    const existing = procs.find(pr => pr.aId === aId && pr.bId === bId)
      || (opts.label ? procs.find(pr => pr.bId === bId && pr.label === opts.label) : null);
    if (existing) {
      return store.updateProcess(existing.id, {
        aId,
        bId,
        flowVal: opts.flowVal,
        flowUnit: opts.flowUnit,
        label: opts.label,
        role: opts.role
      }, false);
    }
    return store.addProcess(aId, bId, opts, false);
  }

  function renderSystemsDropdowns() {
    const ervOa = byId('ervOaPt');
    const ervRa = byId('ervRaPt');
    populatePointSelect(ervOa, { matchRegex: /\b(oa|out|outdoor|ambient|fresh)\b/i, defaultIndex: 0 });
    populatePointSelect(ervRa, { matchRegex: /\b(ra|room|return|space|exhaust)\b/i, defaultIndex: 1 });
    ensureDistinctPair(ervOa, ervRa);
    populatePointSelect(byId('evapInPt'), { matchRegex: /\b(oa|out|outdoor|ambient)\b/i, defaultIndex: 0 });
    populatePointSelect(byId('desInPt'), { matchRegex: /\b(oa|out|ma|mix)\b/i, defaultIndex: 0 });
    populatePointSelect(byId('humInPt'), { matchRegex: /\b(hc|ph|heat|ma|oa)\b/i, defaultIndex: 0 });
  }

  function wireSystemsTab() {
    initAhuModeDropdown();
    setSystemTool(byId('sysToolSel')?.value || 'ahu');
    syncAhuModeVisibility(byId('ahuMode')?.value || 'summer_reheat');
    syncEvapEffVisibility();

    on(byId('sysToolSel'), 'change', (e) => {
      setSystemTool(e.target.value);
    });

    // Track manual edits per AHU field within the current mode
    const ahuFieldIds = [
      'ahuOaT', 'ahuOaRH', 'ahuRaT', 'ahuRaRH', 'ahuOaPct', 'ahuFlow',
      'ahuCoilAdp', 'ahuCoilBpf', 'ahuReheatT', 'ahuFanDp', 'ahuFanEff', 'ahuErvSens', 'ahuErvLat'
    ];
    ahuFieldIds.forEach(id => {
      on(byId(id), 'input', () => { ahuEditedFields.add(id); });
    });

    on(byId('ahuMode'), 'change', (e) => {
      ahuEditedFields.clear();
      applyAhuModeDefaults(e.target.value);
    });

    on(byId('ahuBuildBtn'), 'click', buildAndPlotAHU);

    // ERV
    on(byId('ervCalcBtn'), 'click', () => {
      const data = computeErvFromUI();
      if (data) renderErvResults(data);
    });

    on(byId('ervPlotBtn'), 'click', () => {
      const data = computeErvFromUI();
      if (!data) return;
      renderErvResults(data);
      const { oa, ra, flowDisp, flowUnit, res } = data;
      store.pushHistory('Plot ERV Wheel');
      const supPt = upsertWizardPoint('ERV Sup', {
        T: res.supplyOut.T,
        w: res.supplyOut.w,
        color: '#0d9488',
        note: `ERV Supply Out (Saved ${res.QtSaved_kW.toFixed(2)} kW)`
      });
      const exhPt = upsertWizardPoint('ERV Exh', {
        T: res.exhaustOut.T,
        w: res.exhaustOut.w,
        color: '#94a3b8',
        note: res.frostRisk ? 'ERV Exhaust Out (Frost Risk!)' : 'ERV Exhaust Out'
      });
      const pSup = upsertWizardProcess(oa.id, supPt.id, { flowVal: flowDisp, flowUnit, label: 'ERV Supply', role: 'erv' });
      upsertWizardProcess(ra.id, exhPt.id, { flowVal: flowDisp, flowUnit, label: 'ERV Exhaust', role: 'erv_exhaust' });
      if (pSup) store.setUI({ selectedProcId: pSup.id });
      toast('ERV Supply & Exhaust plotted on chart', 'success');
    });

    // Evaporative Cooler
    on(byId('evapMode'), 'change', syncEvapEffVisibility);

    on(byId('evapCalcBtn'), 'click', () => {
      const data = computeEvapFromUI();
      if (data) renderEvapResults(data);
    });

    on(byId('evapPlotBtn'), 'click', () => {
      const data = computeEvapFromUI();
      if (!data) return;
      renderEvapResults(data);
      const { inlet, mode, flowDisp, flowUnit, res } = data;
      store.pushHistory('Plot Evaporative Cooler');
      let lastProc = null;
      if (mode === 'twostage' && res.stages.length === 2) {
        const stg1 = upsertWizardPoint('IEC Out', {
          T: res.stages[0].to.T,
          w: res.stages[0].to.w,
          color: '#38bdf8',
          note: 'Evap Stage 1 (Indirect)'
        });
        const stg2 = upsertWizardPoint('IDEC Out', {
          T: res.stages[1].to.T,
          w: res.stages[1].to.w,
          color: '#06b6d4',
          note: `Evap Stage 2 (Direct, ${res.waterUse_Lh.toFixed(1)} L/h)`
        });
        upsertWizardProcess(inlet.id, stg1.id, { flowVal: flowDisp, flowUnit, label: 'Indirect Evap', role: 'coil' });
        lastProc = upsertWizardProcess(stg1.id, stg2.id, { flowVal: flowDisp, flowUnit, label: 'Direct Evap', role: 'coil' });
      } else {
        const lbl = mode === 'indirect' ? 'IEC Out' : 'DEC Out';
        const outPt = upsertWizardPoint(lbl, {
          T: res.outlet.T,
          w: res.outlet.w,
          color: '#06b6d4',
          note: `Evaporative Cooler (${res.waterUse_Lh.toFixed(1)} L/h)`
        });
        lastProc = upsertWizardProcess(inlet.id, outPt.id, { flowVal: flowDisp, flowUnit, label: lbl, role: 'coil' });
      }
      if (lastProc) store.setUI({ selectedProcId: lastProc.id });
      toast('Evaporative cooler stage(s) plotted on chart', 'success');
    });

    // Desiccant Wheel
    on(byId('desCalcBtn'), 'click', () => {
      const data = computeDesiccantFromUI();
      if (data) renderDesiccantResults(data);
    });

    on(byId('desPlotBtn'), 'click', () => {
      const data = computeDesiccantFromUI();
      if (!data) return;
      renderDesiccantResults(data);
      const { inlet, flowDisp, flowUnit, res } = data;
      store.pushHistory('Plot Desiccant Wheel');
      const outPt = upsertWizardPoint('Desiccant Out', {
        T: res.outlet.T,
        w: res.outlet.w,
        color: '#ea580c',
        note: `Desiccant Wheel (Regen ${res.regenHeat_kW.toFixed(1)} kW)`
      });
      const pr = upsertWizardProcess(inlet.id, outPt.id, { flowVal: flowDisp, flowUnit, label: 'Desiccant Dehum.', role: 'coil' });
      if (pr) store.setUI({ selectedProcId: pr.id });
      toast('Desiccant dehumidification plotted on chart', 'success');
    });

    // Humidifier Sizer
    on(byId('humCalcBtn'), 'click', () => {
      const data = computeHumidifierFromUI();
      if (data) renderHumidifierResults(data);
    });

    on(byId('humPlotBtn'), 'click', () => {
      const data = computeHumidifierFromUI();
      if (!data) return;
      renderHumidifierResults(data);
      const { inlet, mode, flowDisp, flowUnit, res } = data;
      if (res.dW <= 1e-9) {
        toast('Target W must be higher than entering air W', 'error');
        return;
      }
      store.pushHistory('Plot Humidifier');
      const lbl = mode === 'steam' ? 'Steam Hum' : 'Adiab Hum';
      const outPt = upsertWizardPoint(lbl, {
        T: res.outlet.T,
        w: res.outlet.w,
        color: '#10b981',
        note: `Humidifier (${res.waterRate_kgh.toFixed(2)} kg/h)`
      });
      const pr = upsertWizardProcess(inlet.id, outPt.id, { flowVal: flowDisp, flowUnit, label: 'Humidifier', role: 'humid' });
      if (pr) store.setUI({ selectedProcId: pr.id });
      toast('Humidifier process plotted on chart', 'success');
    });
  }

  /* ==========================================================================
     TAB 3 — COIL ADP / HYDRONIC ESTIMATOR & ASHRAE 62.1 VENTILATION (`#tabCoil`)
     ========================================================================== */

  function computeAdpFromUI() {
    const procId = byId('adpProc')?.value;
    const proc = store.getProcess(procId);
    if (!proc) {
      return { ok: false, error: 'Select a cooling process to analyze ADP & chilled water flow.' };
    }
    const a = store.getPoint(proc.aId);
    const b = store.getPoint(proc.bId);
    if (!a || !b) {
      return { ok: false, error: 'Selected process endpoints are invalid.' };
    }

    const u = getUnits();
    const pPa = getPPa();
    const rawWaterDt = Math.max(0.5, numInput('adpWaterDt', u === 'IP' ? 10 : 5.5));
    const waterDtC = u === 'IP' ? rawWaterDt / 1.8 : rawWaterDt;

    const adp = HVAC.calcADP(a, b, pPa, waterDtC);
    if (!adp.valid) {
      return { ok: false, error: adp.reason || 'No valid ADP intersection found.' };
    }

    const fUnit = normFlowUnit(proc.flowUnit, u);
    const metrics = HVAC.calcProcessMetrics(a, b, pPa, proc.flowVal, fUnit);
    const coolingKw = Math.abs(metrics.Qt_kW);
    const chwLps = coolingKw * adp.waterFlowFactor_Lps_per_kW;
    const chwGpm = chwLps * GPM_PER_LPS;
    const condensateKgh = Math.max(0, -metrics.waterRate_kgh);

    return {
      ok: true,
      proc,
      a,
      b,
      adp,
      metrics,
      coolingKw,
      chwLps,
      chwGpm,
      condensateKgh,
      waterDtC
    };
  }

  function renderAdpResults() {
    const c = byId('adpResults');
    if (!c) return;
    const res = computeAdpFromUI();
    if (!res.ok) {
      c.innerHTML = `<div class="full" style="padding:6px 8px;border-radius:var(--r-sm);background:var(--warnSoft);border:1px solid var(--warnBorder);color:var(--warn);font-size:10.5px">${esc(res.error)}</div>`;
      return res;
    }

    const u = getUnits();
    const { adp, coolingKw, chwLps, chwGpm, condensateKgh, metrics } = res;
    lastAdpProcId = res.proc.id;

    const chwMain = u === 'IP' ? `${chwGpm.toFixed(2)} GPM` : `${chwLps.toFixed(3)} L/s`;
    const chwSub = u === 'IP' ? `${chwLps.toFixed(3)} L/s` : `${chwGpm.toFixed(2)} GPM`;

    const condGph = condensateKgh / GAL_WATER_KG;
    const condMain = u === 'IP'
      ? `${(condensateKgh * LB_PER_KG).toFixed(2)} lb/h`
      : `${condensateKgh.toFixed(2)} kg/h`;
    const condSub = `${condGph.toFixed(2)} gph · ${u === 'IP' ? condensateKgh.toFixed(2) + ' kg/h' : (condensateKgh * LB_PER_KG).toFixed(2) + ' lb/h'}`;

    const loadMain = u === 'IP'
      ? `${(coolingKw / KW_PER_TON).toFixed(2)} TR`
      : `${coolingKw.toFixed(2)} kW`;
    const loadSub = u === 'IP'
      ? `${fmtBTUh(coolingKw * BTUH_PER_KW, false)} · SHR ${Number.isFinite(metrics.SHR) ? metrics.SHR.toFixed(2) : '—'}`
      : `${(coolingKw / KW_PER_TON).toFixed(2)} TR · SHR ${Number.isFinite(metrics.SHR) ? metrics.SHR.toFixed(2) : '—'}`;

    c.innerHTML = [
      metricCard('ADP Temp (Tadp)', esc(fmtTemp(adp.T_adp, u, 2)), '100% RH Saturation', 'accent'),
      metricCard('ADP Humidity (Wadp)', esc(fmtW(adp.w_adp, u)), `h ${esc(fmtH(adp.T_adp, adp.w_adp, u))}`),
      metricCard('Bypass Factor (BPF)', adp.BPF.toFixed(4), `${(adp.BPF * 100).toFixed(1)}% bypass`),
      metricCard('Contact Factor (CF)', adp.CF.toFixed(4), `${(adp.CF * 100).toFixed(1)}% contact`),
      metricCard('Condensate Rate', esc(condMain), esc(condSub)),
      metricCard('CHW Flow Rate', esc(chwMain), esc(chwSub), 'success'),
      metricCard('Coil Total Cooling', esc(loadMain), esc(loadSub), 'accent', true)
    ].join('');

    return res;
  }

  /* ---- ASHRAE 62.1 Ventilation & CO₂ ---- */

  function populateVentSpaces() {
    const sel = byId('ventSpaceType');
    if (!sel) return;
    const prev = sel.value;
    const u = getUnits();
    const spaces = Array.isArray(HVAC.ASHRAE_62_1_SPACES) ? HVAC.ASHRAE_62_1_SPACES : [];
    sel.innerHTML = '';

    for (const sp of spaces) {
      const o = document.createElement('option');
      o.value = sp.id;
      if (u === 'IP') {
        const rpIp = (sp.Rp_Lps * CFM_PER_LPS).toFixed(1);
        const raIp = (sp.Ra_Lps_m2 * CFM_FT2_PER_LPS_M2).toFixed(2);
        o.textContent = `${sp.name} (Rp ${rpIp} CFM/p, Ra ${raIp} CFM/ft²)`;
      } else {
        o.textContent = `${sp.name} (Rp ${sp.Rp_Lps} L/s·p, Ra ${sp.Ra_Lps_m2} L/s·m²)`;
      }
      sel.appendChild(o);
    }

    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom Ventilation Rates';
    sel.appendChild(customOpt);

    if (prev && Array.from(sel.options).some(o => o.value === prev)) {
      sel.value = prev;
    } else if (spaces.length > 0) {
      sel.value = spaces[0].id;
    }
  }

  function applyVentSpacePreset(spaceId) {
    const spaces = Array.isArray(HVAC.ASHRAE_62_1_SPACES) ? HVAC.ASHRAE_62_1_SPACES : [];
    const sp = spaces.find(s => s.id === spaceId);
    if (!sp) return;
    const u = getUnits();
    setInputVal('ventRp', u === 'IP' ? sp.Rp_Lps * CFM_PER_LPS : sp.Rp_Lps, 2);
    setInputVal('ventRa', u === 'IP' ? sp.Ra_Lps_m2 * CFM_FT2_PER_LPS_M2 : sp.Ra_Lps_m2, 3);
  }

  function renderVentResults() {
    const c = byId('ventResults');
    if (!c) return;
    const oa = store.getPoint(byId('ventOaPt')?.value);
    const ra = store.getPoint(byId('ventRaPt')?.value);
    if (!oa || !ra) {
      c.innerHTML = '<div class="full hint">Add at least two state points (OA &amp; Indoor/RA) to compute ventilation loads.</div>';
      return;
    }

    const u = getUnits();
    const pPa = getPPa();
    const spaceType = byId('ventSpaceType')?.value || 'office';
    const people = Math.max(0, numInput('ventPeople', 25));
    const areaDisp = Math.max(0, numInput('ventArea', u === 'IP' ? 2690 : 250));
    const rpDisp = Math.max(0, numInput('ventRp', u === 'IP' ? 5.3 : 2.5));
    const raDisp = Math.max(0, numInput('ventRa', u === 'IP' ? 0.06 : 0.3));

    const area_m2 = u === 'IP' ? areaDisp / FT2_PER_M2 : areaDisp;
    const Rp_Lps = u === 'IP' ? rpDisp / CFM_PER_LPS : rpDisp;
    const Ra_Lps_m2 = u === 'IP' ? raDisp / CFM_FT2_PER_LPS_M2 : raDisp;

    const v = HVAC.calcVentilation62_1(oa, ra, pPa, {
      spaceType: spaceType === 'custom' ? 'office' : spaceType,
      people,
      area_m2,
      Rp_Lps,
      Ra_Lps_m2
    });

    const vbzMain = u === 'IP' ? `${v.Vbz_cfm.toFixed(0)} CFM` : `${v.Vbz_Lps.toFixed(1)} L/s`;
    const vbzSub = u === 'IP'
      ? `${v.Vbz_Lps.toFixed(1)} L/s${Number.isFinite(v.cfm_per_person) ? ` · ${v.cfm_per_person.toFixed(1)} CFM/p` : ''}`
      : `${v.Vbz_cfm.toFixed(0)} CFM${Number.isFinite(v.Lps_per_person) ? ` · ${v.Lps_per_person.toFixed(1)} L/s·p` : ''}`;

    // Ventilation load magnitudes (positive OA-to-Room cooling load shown clearly)
    const loadTag = v.loadMode === 'cooling'
      ? 'Cooling OA Load'
      : (v.loadMode === 'heating' ? 'Heating OA Load' : 'Neutral OA');
    const loadTone = v.loadMode === 'cooling' ? 'accent' : (v.loadMode === 'heating' ? 'danger' : '');

    const qsMain = fmtEnergy(v.Qs_kW, u, true);
    const qlMain = fmtEnergy(v.Ql_kW, u, true);
    const qtMain = u === 'IP'
      ? fmtBTUh(v.Qt_BTUh, true)
      : `${fmtSign(v.Qt_kW, 2)} kW`;
    const qtSub = u === 'IP'
      ? `${fmtSign(v.Qt_TR, 2)} TR · ${fmtSign(v.Qt_kW, 2)} kW`
      : `${fmtSign(v.Qt_TR, 2)} TR · ${fmtBTUh(v.Qt_BTUh, true)}`;

    const co2Finite = Number.isFinite(v.steadyCO2_ppm);
    const co2Val = co2Finite ? Math.round(v.steadyCO2_ppm) : null;
    const isGoodIaq = co2Finite && co2Val < 1000;
    const iaqBadge = !co2Finite
      ? '<span class="badge warn">No OA Flow</span>'
      : (isGoodIaq
        ? '<span class="badge success">✓ Good IAQ (&lt; 1000 ppm)</span>'
        : '<span class="badge danger">⚠ Elevated (&gt; 1000 ppm)</span>');

    const co2Card = `
      <div class="metric ${!co2Finite ? 'warn' : (isGoodIaq ? 'success' : 'danger')} full">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <span class="lbl">Steady-State Indoor CO₂</span>
          ${iaqBadge}
        </div>
        <span class="val">${co2Finite ? `${co2Val.toLocaleString('en-US')} ppm` : '∞ ppm'}</span>
        <span class="sub">Outdoor ref: ${v.outdoorCO2_ppm} ppm · Gen: ${(v.co2Gen_Lps_per_person * 1000).toFixed(1)} mL/s·person</span>
      </div>
    `;

    c.innerHTML = [
      metricCard('Required OA (Vbz)', esc(vbzMain), esc(vbzSub), 'accent', true),
      metricCard('Sensible Load (Qs)', esc(qsMain), u === 'IP' ? `${fmtSign(v.Qs_kW, 2)} kW` : fmtBTUh(v.Qs_BTUh, true)),
      metricCard('Latent Load (Ql)', esc(qlMain), u === 'IP' ? `${fmtSign(v.Ql_kW, 2)} kW` : fmtBTUh(v.Ql_BTUh, true)),
      metricCard(`Total OA Load · ${loadTag}`, esc(qtMain), esc(qtSub), loadTone, true),
      co2Card
    ].join('');
  }

  function findPreferredCoolingProcId() {
    const procs = store.state.processes || [];
    const pts = store.state.points || [];
    const pPa = getPPa();
    const NON_COIL_ROLES = new Set(['mix', 'room', 'erv', 'erv_exhaust']);

    const candidates = procs.map(pr => {
      const a = pts.find(p => p.id === pr.aId);
      const b = pts.find(p => p.id === pr.bId);
      if (!a || !b) return null;
      const role = inferProcessRole(pr, a, b);
      const adpValid = Boolean(HVAC.calcADP(a, b, pPa).valid);
      return {
        pr,
        a,
        b,
        role,
        isCoilLike: !NON_COIL_ROLES.has(role),
        isCoolDehum: isCoolingDehumPair(a, b),
        adpValid
      };
    }).filter(Boolean);

    const curvedValid = candidates.find(c => c.isCoilLike && c.pr.showCurve && c.adpValid);
    if (curvedValid) return curvedValid.pr.id;

    const coolDehumValid = candidates.find(c => c.isCoilLike && c.isCoolDehum && c.adpValid);
    if (coolDehumValid) return coolDehumValid.pr.id;

    const coilValid = candidates.find(c => c.isCoilLike && c.adpValid);
    if (coilValid) return coilValid.pr.id;

    const anyValid = candidates.find(c => c.adpValid);
    if (anyValid) return anyValid.pr.id;

    return procs[0]?.id ?? null;
  }

  function renderCoilTabDropdowns() {
    const adpSel = byId('adpProc');
    const procs = store.state.processes || [];
    const validIds = new Set(procs.map(p => String(p.id)));
    let preferId = null;
    if (adpSel?.value && validIds.has(adpSel.value)) {
      preferId = adpSel.value;
    } else if (lastAdpProcId != null && validIds.has(String(lastAdpProcId))) {
      preferId = lastAdpProcId;
    } else {
      preferId = findPreferredCoolingProcId();
    }
    populateProcessSelect(adpSel, preferId);
    const ventOa = byId('ventOaPt');
    const ventRa = byId('ventRaPt');
    populatePointSelect(ventOa, { matchRegex: /\b(oa|out|outdoor|ambient|fresh)\b/i, defaultIndex: 0 });
    populatePointSelect(ventRa, { matchRegex: /\b(ra|room|return|space|indoor)\b/i, defaultIndex: 1 });
    ensureDistinctPair(ventOa, ventRa);
  }

  function wireCoilTab() {
    populateVentSpaces();
    applyVentSpacePreset(byId('ventSpaceType')?.value || 'office');

    on(byId('adpCalc'), 'click', () => {
      renderAdpResults();
    });

    on(byId('adpProc'), 'change', () => {
      if (byId('adpResults')?.innerHTML.trim()) renderAdpResults();
    });

    on(byId('adpWaterDt'), 'change', () => {
      if (byId('adpResults')?.innerHTML.trim()) renderAdpResults();
    });

    on(byId('adpPlotBtn'), 'click', () => {
      const res = renderAdpResults();
      if (!res || !res.ok) {
        toast(res?.error || 'Cannot plot ADP for selected process', 'error');
        return;
      }
      const { proc, a, b, adp } = res;
      const u = getUnits();
      const adpLabel = `ADP (${a.label}→${b.label})`;
      const existing = (store.state.points || []).find(p => p.label === adpLabel || p.label === 'ADP');

      store.pushHistory('Plot Coil ADP & Enable Curve');
      if (existing) {
        store.updatePoint(existing.id, {
          T: adp.T_adp,
          w: adp.w_adp,
          note: `Apparatus Dew Point · BPF ${(adp.BPF * 100).toFixed(1)}%`,
          force: true
        }, false);
      } else {
        store.addPoint({
          T: adp.T_adp,
          w: adp.w_adp,
          label: 'ADP',
          color: '#06b6d4',
          note: `Apparatus Dew Point · BPF ${(adp.BPF * 100).toFixed(1)}%`
        }, false);
      }

      store.updateProcess(proc.id, {
        showCurve: true,
        adpT: adp.T_adp,
        adpW: adp.w_adp
      }, false);

      if (store.state.layers && store.state.layers.adpLines === false) {
        store.setLayer('adpLines', true);
      }
      store.setUI({ selectedProcId: proc.id });
      toast(`ADP plotted at ${fmtTemp(adp.T_adp, u, 1)} & curved coil view enabled`, 'success');
    });

    const refreshVentIfOpen = () => {
      if (byId('ventResults')?.innerHTML.trim()) renderVentResults();
    };

    on(byId('ventSpaceType'), 'change', (e) => {
      if (e.target.value !== 'custom') {
        applyVentSpacePreset(e.target.value);
      }
      refreshVentIfOpen();
    });

    on(byId('ventRp'), 'input', () => {
      const sel = byId('ventSpaceType');
      if (sel) sel.value = 'custom';
      refreshVentIfOpen();
    });

    on(byId('ventRa'), 'input', () => {
      const sel = byId('ventSpaceType');
      if (sel) sel.value = 'custom';
      refreshVentIfOpen();
    });

    ['ventPeople', 'ventArea'].forEach(id => {
      on(byId(id), 'input', refreshVentIfOpen);
      on(byId(id), 'change', refreshVentIfOpen);
    });
    ['ventRp', 'ventRa', 'ventOaPt', 'ventRaPt'].forEach(id => {
      on(byId(id), 'change', refreshVentIfOpen);
    });

    on(byId('ventCalc'), 'click', renderVentResults);
  }

  /* ==========================================================================
     TAB 4 — MULTI-STREAM MIXING & SCENARIO A/B MANAGER (`#tabMix`)
     ========================================================================== */

  function gatherMixStreams() {
    const u = getUnits();
    const unit = normFlowUnit(byId('mixUnit')?.value, u);
    const idA = byId('mixA')?.value;
    const idB = byId('mixB')?.value;
    const idC = byId('mixC')?.value;

    const ptA = store.getPoint(idA);
    const ptB = store.getPoint(idB);
    const ptC = idC ? store.getPoint(idC) : null;

    const fA = parseFloat(byId('mixWA')?.value);
    const fB = parseFloat(byId('mixWB')?.value);
    const fC = parseFloat(byId('mixWC')?.value);

    const wcEl = byId('mixWC');
    if (wcEl) wcEl.disabled = !ptC;

    if (!ptA || !ptB) {
      return { ok: false, error: 'Select at least Stream A and Stream B.' };
    }
    if (ptA.id === ptB.id) {
      return { ok: false, error: 'Stream A and Stream B must be different points.' };
    }
    if (ptC && (ptC.id === ptA.id || ptC.id === ptB.id)) {
      return { ok: false, error: 'Stream C must be different from Streams A and B.' };
    }
    if (!(fA > 0) || !(fB > 0)) {
      return { ok: false, error: 'Flows for Stream A and Stream B must be positive.' };
    }
    if (ptC && !(fC > 0)) {
      return { ok: false, error: 'Enter a positive flow for Stream C, or select "(None — 2 streams)".' };
    }

    const active = [
      { pt: ptA, flowVal: fA },
      { pt: ptB, flowVal: fB }
    ];
    if (ptC) active.push({ pt: ptC, flowVal: fC });

    const pPa = getPPa();
    const hvacStreams = active.map(s => ({
      T: s.pt.T,
      w: s.pt.w,
      flowVal: s.flowVal,
      flowUnit: unit,
      label: s.pt.label
    }));
    const mix = HVAC.calcMixing(hvacStreams, pPa);

    const resolvedStreams = active.map((s, idx) => {
      const m = unit === 'pct'
        ? s.flowVal
        : Psy.flowToMassKgps(s.flowVal, unit, s.pt.T, s.pt.w, pPa);
      return {
        pt: s.pt,
        flowVal: s.flowVal,
        m,
        frac: mix.fractions[idx] ?? 0
      };
    });

    return { ok: true, unit, streams: resolvedStreams, mix };
  }

  function updateMixPreview() {
    const c = byId('mixPreview');
    if (!c) return;
    if ((store.state.points || []).length < 2) {
      c.innerHTML = '<div class="full hint">Add at least 2 state points to preview adiabatic air mixing.</div>';
      return;
    }

    const res = gatherMixStreams();
    if (!res.ok) {
      c.innerHTML = `<div class="full" style="color:var(--warn);font-size:10.5px">${esc(res.error)}</div>`;
      return;
    }

    const { streams, mix } = res;
    const u = getUnits();
    const pPa = getPPa();
    const rh = Psy.RH_from_Tw(mix.T, mix.w, pPa) * 100;
    const splitStr = streams.map(s => `${s.pt.label}: ${(s.frac * 100).toFixed(1)}%`).join(' · ');

    let html = '';
    if (mix.condensationWarning) {
      html += `<div class="full" style="padding:6px 8px;border-radius:var(--r-sm);background:var(--warnSoft);border:1px solid var(--warnBorder);color:var(--warn);font-size:10.5px;font-weight:600">⚠ Fog / Condensation Zone! Mixing line crosses saturation curve — excess liquid fog: ${esc(fmtW(mix.fogWater_kgkg, u))}</div>`;
    }

    html += metricCard('Mixed Tdb', esc(fmtTemp(mix.T, u, 2)), '', 'accent');
    html += metricCard('Mixed RH', `${rh.toFixed(1)} %`, mix.condensationWarning ? 'Saturated (Fog)' : 'Unsaturated');
    html += metricCard('Mixed W', esc(fmtW(mix.w, u)));
    html += metricCard('Mixed Enthalpy', esc(fmtH(mix.T, mix.w, u)));
    html += `<div class="full" style="font-family:var(--mono);font-size:10px;color:var(--muted);padding-top:2px">Mass Split: ${esc(splitStr)}</div>`;
    c.innerHTML = html;
  }

  function createMixPointFromUI() {
    const res = gatherMixStreams();
    if (!res.ok) {
      toast(res.error, 'error');
      return;
    }

    const { unit, streams, mix } = res;
    const u = getUnits();
    const label = (byId('mixLbl')?.value || '').trim() || 'Mix';
    const defTotalFlow = u === 'IP' ? 2000 : 1000;
    const defUnit = u === 'IP' ? 'cfm' : 'Lps';

    store.pushHistory(`Create Mix "${label}"`);
    const mixPt = store.addPoint({
      T: mix.T,
      w: mix.w,
      label,
      color: '#facc15',
      locked: true,
      note: mix.condensationWarning
        ? `Fog Mix (${streams.map(s => s.pt.label).join(' + ')})`
        : `Adiabatic Mix (${streams.map(s => s.pt.label).join(' + ')})`,
      derived: {
        type: 'mix',
        streams: streams.map(s => ({ id: s.pt.id, m: s.m }))
      }
    }, false);

    let lastProc = null;
    for (const s of streams) {
      const pFlowVal = unit === 'pct'
        ? CoreDOM.round(defTotalFlow * s.frac, 1)
        : s.flowVal;
      const pFlowUnit = unit === 'pct' ? defUnit : unit;
      lastProc = store.addProcess(s.pt.id, mixPt.id, {
        flowVal: pFlowVal,
        flowUnit: pFlowUnit,
        label: `Mix (${s.pt.label})`,
        role: 'mix'
      }, false);
    }

    if (lastProc) store.setUI({ selectedProcId: lastProc.id });
    toast(
      mix.condensationWarning
        ? `Mix "${label}" created (⚠ Fog/Condensation warning)`
        : `Mix "${label}" created (${streams.length} streams)`,
      mix.condensationWarning ? 'info' : 'success'
    );
  }

  /* ---- Scenario Comparison Manager ---- */

  function renderScenarios() {
    const listEl = byId('scenList');
    const sumEl = byId('scenCompareSummary');
    if (!listEl) return;

    const scenarios = store.state.scenarios || [];
    const compareId = store.state.compareScenarioId;
    const u = getUnits();
    const pPa = getPPa();

    listEl.innerHTML = '';

    if (scenarios.length === 0) {
      listEl.innerHTML = '<div class="hint" style="padding:4px 0">Save snapshots (e.g. "Baseline AHU" vs "With ERV Wheel") to ghost-overlay and compare % energy savings.</div>';
      if (sumEl) sumEl.innerHTML = '';
      return;
    }

    for (const sc of scenarios) {
      const isComparing = compareId != null && sc.id === compareId;
      const roll = computeCycleRollup(sc.points, sc.processes, pPa);
      const card = document.createElement('div');
      card.className = `scenCard${isComparing ? ' comparing' : ''}`;
      card.style.borderLeftColor = isComparing ? 'var(--accent)' : (sc.color || 'var(--borderStrong)');

      const coolTxt = u === 'IP' ? `${roll.cooling_TR.toFixed(1)} TR` : `${roll.mechCooling_kW.toFixed(1)} kW`;
      const heatTxt = u === 'IP' ? `${roll.heating_MBH.toFixed(1)} MBH` : `${roll.mechHeating_kW.toFixed(1)} kW`;
      const ptCnt = (sc.points || []).length;
      const prCnt = (sc.processes || []).length;

      card.innerHTML = `
        <div class="scenHead">
          <span class="scenName" title="${esc(sc.name)}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(sc.color || '#38bdf8')};margin-right:6px"></span>${esc(sc.name)}</span>
          ${isComparing ? '<span class="badge info">Overlay ON</span>' : ''}
        </div>
        <div class="scenMeta">
          <span>${ptCnt} pts · ${prCnt} proc</span>
          <span>Cool ${esc(coolTxt)}</span>
          <span>Heat ${esc(heatTxt)}</span>
        </div>
        <div class="scenActions">
          <button type="button" class="btn xs ${isComparing ? 'accent' : ''}" data-scen-act="compare">${isComparing ? 'Hide Overlay' : 'Compare'}</button>
          <button type="button" class="btn xs" data-scen-act="load">Load</button>
          <button type="button" class="btn xs danger" data-scen-act="delete" style="flex:0 0 28px" aria-label="Delete scenario ${esc(sc.name)}" title="Delete scenario">✕</button>
        </div>
      `;

      on(card.querySelector('[data-scen-act="compare"]'), 'click', () => {
        store.setCompareScenario(isComparing ? null : sc.id);
        toast(isComparing ? 'Scenario overlay hidden' : `Comparing against "${sc.name}"`, 'info');
      });

      on(card.querySelector('[data-scen-act="load"]'), 'click', () => {
        store.restoreScenario(sc.id);
        if (typeof store.fitPoints === 'function') store.fitPoints(false);
        toast(`Loaded scenario "${sc.name}"`, 'success');
      });

      on(card.querySelector('[data-scen-act="delete"]'), 'click', () => {
        store.deleteScenario(sc.id);
        toast(`Deleted scenario "${sc.name}"`, 'info');
      });

      listEl.appendChild(card);
    }

    // Render Side-by-Side Mechanical Equipment Load Comparison Summary if a scenario overlay is active
    if (!sumEl) return;
    const activeScen = compareId != null ? scenarios.find(s => s.id === compareId) : null;
    if (!activeScen) {
      sumEl.innerHTML = '';
      return;
    }

    const cur = computeCycleRollup(store.state.points, store.state.processes, pPa);
    const base = computeCycleRollup(activeScen.points, activeScen.processes, pPa);

    const dCool_kW = cur.mechCooling_kW - base.mechCooling_kW;
    const dCool_TR = cur.cooling_TR - base.cooling_TR;
    const dCool_MBH = cur.cooling_MBH - base.cooling_MBH;
    const dHeat_kW = cur.mechHeating_kW - base.mechHeating_kW;
    const dHeat_MBH = cur.heating_MBH - base.heating_MBH;
    const dTotal_kW = cur.total_kW - base.total_kW;
    const dTotal_TR = cur.total_TR - base.total_TR;
    const dTotal_MBH = cur.total_MBH - base.total_MBH;
    const savingsPct = base.total_kW > 1e-6 ? ((base.total_kW - cur.total_kW) / base.total_kW) * 100 : 0;

    const savingsBadge = savingsPct > 0.05
      ? `<span class="badge success">↓ ${savingsPct.toFixed(1)}% ENERGY SAVED</span>`
      : (savingsPct < -0.05
        ? `<span class="badge danger">↑ ${Math.abs(savingsPct).toFixed(1)}% HIGHER LOAD</span>`
        : '<span class="badge neutral">0.0% DELTA</span>');

    const deltaCls = (d) => d < -1e-4 ? 'delta-neg' : (d > 1e-4 ? 'delta-pos' : '');
    const subSpan = (txt) => `<span style="opacity:0.7;font-size:9.5px">${txt}</span>`;

    const fmtCoolCell = (r) => u === 'IP'
      ? `${r.cooling_TR.toFixed(2)} TR<br>${subSpan(`${r.cooling_MBH.toFixed(1)} MBH`)}`
      : `${r.mechCooling_kW.toFixed(1)} kW<br>${subSpan(`${r.cooling_TR.toFixed(2)} TR`)}`;
    const fmtCoolDelta = u === 'IP'
      ? `${fmtSign(dCool_TR, 2)} TR<br>${subSpan(`${fmtSign(dCool_MBH, 1)} MBH`)}`
      : `${fmtSign(dCool_kW, 1)} kW<br>${subSpan(`${fmtSign(dCool_TR, 2)} TR`)}`;

    const fmtHeatCell = (r) => u === 'IP'
      ? `${r.heating_MBH.toFixed(1)} MBH<br>${subSpan(`${r.mechHeating_kW.toFixed(1)} kW`)}`
      : `${r.mechHeating_kW.toFixed(1)} kW<br>${subSpan(`${r.heating_MBH.toFixed(1)} MBH`)}`;
    const fmtHeatDelta = u === 'IP'
      ? `${fmtSign(dHeat_MBH, 1)} MBH<br>${subSpan(`${fmtSign(dHeat_kW, 1)} kW`)}`
      : `${fmtSign(dHeat_kW, 1)} kW<br>${subSpan(`${fmtSign(dHeat_MBH, 1)} MBH`)}`;

    const fmtTotCell = (r) => u === 'IP'
      ? `<b>${r.total_MBH.toFixed(1)} MBH</b><br>${subSpan(`${r.total_TR.toFixed(2)} TR`)}`
      : `<b>${r.total_kW.toFixed(1)} kW</b><br>${subSpan(`${r.total_TR.toFixed(2)} TR`)}`;
    const fmtTotDelta = u === 'IP'
      ? `<b>${fmtSign(dTotal_MBH, 1)} MBH</b><br>${subSpan(`${fmtSign(dTotal_TR, 2)} TR`)}`
      : `<b>${fmtSign(dTotal_kW, 1)} kW</b><br>${subSpan(`${fmtSign(dTotal_TR, 2)} TR`)}`;

    sumEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px">
        <span style="font-size:9.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)">Mech. Load vs ${esc(activeScen.name)}</span>
        ${savingsBadge}
      </div>
      <table class="ptable" style="margin:0;font-size:10.5px;line-height:1.25">
        <thead>
          <tr>
            <th>Metric</th>
            <th style="text-align:right">Baseline</th>
            <th style="text-align:right">Current</th>
            <th style="text-align:right">Δ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cooling</td>
            <td style="text-align:right">${fmtCoolCell(base)}</td>
            <td style="text-align:right">${fmtCoolCell(cur)}</td>
            <td style="text-align:right" class="${deltaCls(dCool_kW)}">${fmtCoolDelta}</td>
          </tr>
          <tr>
            <td>Heating</td>
            <td style="text-align:right">${fmtHeatCell(base)}</td>
            <td style="text-align:right">${fmtHeatCell(cur)}</td>
            <td style="text-align:right" class="${deltaCls(dHeat_kW)}">${fmtHeatDelta}</td>
          </tr>
          <tr>
            <td><b>Total</b></td>
            <td style="text-align:right">${fmtTotCell(base)}</td>
            <td style="text-align:right">${fmtTotCell(cur)}</td>
            <td style="text-align:right" class="${deltaCls(dTotal_kW)}">${fmtTotDelta}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  function renderMixTabDropdowns() {
    const selA = byId('mixA');
    const selB = byId('mixB');
    populatePointSelect(selA, { defaultIndex: 0 });
    populatePointSelect(selB, { defaultIndex: 1 });
    ensureDistinctPair(selA, selB);
    populatePointSelect(byId('mixC'), {
      emptyLabel: '(None — 2 streams)',
      defaultEmpty: true
    });
    populateFlowUnitSelect(byId('mixUnit'), true);
    updateMixPreview();
    renderScenarios();
  }

  function wireMixAndScenariosTab() {
    populateFlowUnitSelect(byId('mixUnit'), true);

    ['mixA', 'mixB', 'mixC', 'mixUnit'].forEach(id => {
      on(byId(id), 'change', updateMixPreview);
    });
    ['mixWA', 'mixWB', 'mixWC'].forEach(id => {
      on(byId(id), 'input', updateMixPreview);
      on(byId(id), 'change', updateMixPreview);
    });

    on(byId('mixAdd'), 'click', createMixPointFromUI);

    const doSaveScenario = () => {
      const inp = byId('scenName');
      const name = (inp?.value || '').trim() || `Scenario ${(store.state.scenarios || []).length + 1}`;
      const saved = store.saveScenario(name);
      if (inp) inp.value = '';
      if (saved) toast(`Scenario "${saved.name}" saved`, 'success');
    };

    on(byId('btnSaveScen'), 'click', doSaveScenario);
    on(byId('scenName'), 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSaveScenario();
      }
    });
  }

  /* ==========================================================================
     Master Reactive Sync
     ========================================================================== */

  function rerenderCachedWizardResults() {
    if (lastAhuCycle && byId('ahuResults')?.innerHTML.trim()) renderAhuResults(lastAhuCycle);
    if (lastErvData && byId('ervResults')?.innerHTML.trim()) renderErvResults(lastErvData);
    if (lastEvapData && byId('evapResults')?.innerHTML.trim()) renderEvapResults(lastEvapData);
    if (lastDesData && byId('desResults')?.innerHTML.trim()) renderDesiccantResults(lastDesData);
    if (lastHumData && byId('humResults')?.innerHTML.trim()) renderHumidifierResults(lastHumData);
  }

  function refreshAll() {
    renderProcessesTab();
    renderSystemsDropdowns();
    renderCoilTabDropdowns();
    renderMixTabDropdowns();

    // Refresh any open results boxes on state/unit/pressure change
    if (byId('adpResults')?.innerHTML.trim()) renderAdpResults();
    if (byId('ventResults')?.innerHTML.trim()) renderVentResults();
  }

  function refreshLiveDrag() {
    renderProcessCards();
    renderCycleSummary();
    renderSelectedProcessMetrics();
    if (byId('adpResults')?.innerHTML.trim()) renderAdpResults();
    if (byId('mixPreview')) updateMixPreview();
    if (byId('ventResults')?.innerHTML.trim()) renderVentResults();
  }

  let _dragSyncRaf = 0;
  function schedulePointDragSync() {
    if (_dragSyncRaf) return;
    _dragSyncRaf = requestAnimationFrame(() => {
      _dragSyncRaf = 0;
      refreshLiveDrag();
    });
  }

  store.on('units-changed', ({ units }) => {
    convertRightPanelInputsOnUnitChange(lastUnits, units);
    lastUnits = units;
    refreshAll();
    rerenderCachedWizardResults();
  });

  store.on('point-drag', schedulePointDragSync);

  store.on('change', (evt) => {
    if (evt?.reason === 'units') return; // handled by units-changed
    const curUnits = getUnits();
    if (curUnits !== lastUnits) {
      convertRightPanelInputsOnUnitChange(lastUnits, curUnits);
      lastUnits = curUnits;
      rerenderCachedWizardResults();
    }
    refreshAll();
  });

  // Subscribe to centralized tab-change event dispatched by app.js
  if (typeof window !== 'undefined') {
    on(window, 'psychro:tab-changed', (e) => {
      const detail = e?.detail || {};
      if (detail.panelId !== 'rightPanel') return;
      if (detail.tabId === 'tabMix') {
        updateMixPreview();
        renderScenarios();
      } else if (detail.tabId === 'tabProc') {
        renderProcessesTab();
      }
    });
  }

  /* ---- Initial Bootstrap ---- */
  populateFlowUnitSelect(byId('flowUnit'), false);
  wireProcessesTab();
  wireSystemsTab();
  wireCoilTab();
  wireMixAndScenariosTab();
  updateDynamicUnitLabels();
  refreshAll();

  return {
    refresh: refreshAll,
    setSystemTool,
    selectProcess(procId) {
      if (procId != null) store.setUI({ selectedProcId: procId });
    }
  };
}
