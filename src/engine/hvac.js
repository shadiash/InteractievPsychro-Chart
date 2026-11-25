/* ============================================================================
   PsychroChart Ultra 3.0 — HVAC Systems, Processes & Equipment Simulation Engine
   Exact SI internal thermodynamics (°C, kg/kg, Pa, kJ/kg, m³/kg, kW)
   ============================================================================ */

import { Psy } from './psychro.js';
import { PROCESS_COLORS } from '../core/contracts.js';

export const HVAC = (() => {
  const GALLON_WATER_KG = 3.785411784;
  const WATER_CP_KJ_KGK = 4.186;
  const DRY_AIR_CP_J_KGK = 1006;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const btuhPerKw = () => (Number.isFinite(Psy.BTUH_PER_KW) ? Psy.BTUH_PER_KW : 3412.141633);
  const kwPerTon = () => (Number.isFinite(Psy.KW_PER_TON) ? Psy.KW_PER_TON : 3.516852842);
  const lbPerKg = () => (Number.isFinite(Psy.LB_PER_KG) ? Psy.LB_PER_KG : 2.20462262185);
  const cfmPerLps = () => (Number.isFinite(Psy.CFM_PER_LPS) ? Psy.CFM_PER_LPS : 2.118880003);

  function cpMoist(w) {
    if (typeof Psy.cp_moist === 'function') return Psy.cp_moist(w);
    return 1.006 + 1.86 * w;
  }

  function dhToBtulb(dh_kJkg) {
    if (typeof Psy.dh_Btulb === 'function') return Psy.dh_Btulb(dh_kJkg);
    return dh_kJkg * 0.429922614;
  }

  function getTwb(T, w, pPa) {
    if (typeof Psy.twb_from_Tw === 'function') return Psy.twb_from_Tw(T, w, pPa);
    if (typeof Psy.Twb_from_Tw === 'function') return Psy.Twb_from_Tw(T, w, pPa);
    const h = Psy.h_kJkg(T, w);
    let lo = -50;
    let hi = Math.min(T + 1, 90);
    for (let i = 0; i < 60; i++) {
      const m = 0.5 * (lo + hi);
      const ws = Psy.wsat_at(m, pPa);
      if (Psy.h_kJkg(m, ws) > h) hi = m;
      else lo = m;
    }
    return 0.5 * (lo + hi);
  }

  function getTdp(w, pPa) {
    if (w <= 0) return -80;
    if (typeof Psy.Tdp_from_w === 'function') return Psy.Tdp_from_w(w, pPa);
    if (typeof Psy.tdp_from_w === 'function') return Psy.tdp_from_w(w, pPa);
    if (typeof Psy.dewpoint_from_w === 'function') return Psy.dewpoint_from_w(w, pPa);
    if (typeof Psy.dewpoint_from_pv === 'function' && typeof Psy.pv_from_w === 'function') {
      return Psy.dewpoint_from_pv(Psy.pv_from_w(w, pPa));
    }
    let lo = -80;
    let hi = 90;
    for (let i = 0; i < 60; i++) {
      const m = 0.5 * (lo + hi);
      if (Psy.wsat_at(m, pPa) > w) hi = m;
      else lo = m;
    }
    return 0.5 * (lo + hi);
  }

  function wFromTRHpct(T, rhPct, pPa) {
    const rh = clamp(Number(rhPct) || 0, 0, 100) / 100;
    if (typeof Psy.p_ws_Pa === 'function' && typeof Psy.w_from_pv === 'function') {
      const pv = Math.min(rh * Psy.p_ws_Pa(T), pPa * 0.999);
      return Math.max(0, Psy.w_from_pv(pv, pPa));
    }
    if (typeof Psy.w_from_TRH === 'function') {
      return Math.max(0, Math.min(Psy.wsat_at(T, pPa), Psy.w_from_TRH(T, rh, pPa)));
    }
    const ws = Psy.wsat_at(T, pPa);
    return (rh * ws) / Math.max(1e-9, 1 + (1 - rh) * (ws / 0.621945));
  }

  function rhPctFromTw(T, w, pPa) {
    if (typeof Psy.pv_from_w === 'function' && typeof Psy.p_ws_Pa === 'function') {
      const pws = Psy.p_ws_Pa(T);
      if (pws <= 0) return 0;
      return clamp((Psy.pv_from_w(w, pPa) / pws) * 100, 0, 100);
    }
    if (typeof Psy.RH_from_Tw === 'function') {
      const r = Psy.RH_from_Tw(T, w, pPa);
      return clamp(r <= 1.0001 ? r * 100 : r, 0, 100);
    }
    const ws = Psy.wsat_at(T, pPa);
    return ws > 0 ? clamp((w / ws) * 100, 0, 100) : 0;
  }

  function flowToMass(flowVal, flowUnit, T, w, pPa) {
    const val = Math.max(0, Number(flowVal) || 0);
    if (val <= 0) return 0;
    if (flowUnit === 'pct' || flowUnit === 'percent' || flowUnit === 'ratio' || flowUnit === 'weight') {
      return val;
    }
    return Psy.flowToMassKgps(val, flowUnit || 'Lps', T, w, pPa);
  }

  function normalizeFraction(val, fallback) {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return n > 1 ? clamp(n / 100, 0, 1) : clamp(n, 0, 1);
  }

  /* --------------------------------------------------------------------------
     1. Psychrometric Process Classifier (11 Engineering Processes)
     -------------------------------------------------------------------------- */
  function classifyProcess(a, b, pPa = 101325) {
    void pPa; // Pressure-invariant enthalpy/T/w classification; kept for uniform signature
    const dT = b.T - a.T;
    const dW = b.w - a.w;
    const dh = Psy.h_kJkg(b.T, b.w) - Psy.h_kJkg(a.T, a.w);
    const absDT = Math.abs(dT);
    const absDW = Math.abs(dW);
    const absDh = Math.abs(dh);

    let type = 'No Change';
    let shortType = 'No Change';
    let cls = 'neutral';

    if (absDT < 0.05 && absDW < 0.00005) {
      type = 'No Change';
      shortType = 'No Change';
      cls = 'neutral';
    } else if (absDW <= 0.0001) {
      if (dT >= 0) {
        type = 'Sensible Heating';
        shortType = 'Sens. Heat';
        cls = 'heat';
      } else {
        type = 'Sensible Cooling';
        shortType = 'Sens. Cool';
        cls = 'cool';
      }
    } else if (dT < -0.15 && dW > 0.0001 && absDh < 1.8) {
      type = 'Evaporative Cooling';
      shortType = 'Evap. Cool';
      cls = 'evap';
    } else if (dT > 0.5 && dW < -0.0002 && absDh < 4) {
      type = 'Desiccant Dehumidification';
      shortType = 'Desiccant';
      cls = 'desiccant';
    } else if (absDT < 0.35 && dW > 0) {
      type = 'Steam Humidification';
      shortType = 'Steam Humid.';
      cls = 'humid';
    } else if (absDT < 0.35 && dW < 0) {
      type = 'Dehumidification';
      shortType = 'Dehumid.';
      cls = 'dehum';
    } else if (dT < 0 && dW < 0) {
      type = 'Cooling & Dehumidification';
      shortType = 'Cool & Dehum.';
      cls = 'cool';
    } else if (dT > 0 && dW > 0) {
      type = 'Heating & Humidification';
      shortType = 'Heat & Humid.';
      cls = 'heat';
    } else if (dT < 0 && dW > 0) {
      type = 'Cooling & Humidification';
      shortType = 'Cool & Humid.';
      cls = 'evap';
    } else if (dT > 0 && dW < 0) {
      type = 'Heating & Dehumidification';
      shortType = 'Heat & Dehum.';
      cls = 'dehum';
    }

    return {
      type,
      shortType,
      cls,
      color: PROCESS_COLORS[cls] || PROCESS_COLORS.neutral
    };
  }

  /* --------------------------------------------------------------------------
     2. Psychrometric Process Load & Moisture Conservation Metrics
     -------------------------------------------------------------------------- */
  function calcProcessMetrics(a, b, pPa = 101325, flowVal = 1000, flowUnit = 'Lps') {
    const dT = b.T - a.T;
    const dW = b.w - a.w;
    const hA = Psy.h_kJkg(a.T, a.w);
    const hB = Psy.h_kJkg(b.T, b.w);
    const dh = hB - hA;
    const dhIP = dhToBtulb(dh);

    const cpm = cpMoist(0.5 * (a.w + b.w));
    const dh_s = cpm * dT;
    const dh_l = dh - dh_s;
    const SHR = Math.abs(dh) > 1e-6 ? dh_s / dh : NaN;

    const vIn = Psy.v_m3kg(a.T, a.w, pPa);
    const mDa = Psy.flowToMassKgps(flowVal, flowUnit, a.T, a.w, pPa);

    const Qt_kW = mDa * dh;
    const Qs_kW = mDa * dh_s;
    const Ql_kW = Qt_kW - Qs_kW;

    const bkw = btuhPerKw();
    const Qt_BTUh = Qt_kW * bkw;
    const Qs_BTUh = Qs_kW * bkw;
    const Ql_BTUh = Ql_kW * bkw;
    const Qt_TR = Qt_kW / kwPerTon();

    const waterRate_kgs = mDa * dW;
    const waterRate_kgh = waterRate_kgs * 3600;
    const waterRate_lbh = waterRate_kgh * lbPerKg();
    const waterRate_gph = waterRate_kgh / GALLON_WATER_KG;

    const typeInfo = classifyProcess(a, b, pPa);

    return {
      dT,
      dW,
      dh,
      dhIP,
      dh_s,
      dh_l,
      SHR,
      cpm,
      mDa,
      vIn,
      Qs_kW,
      Ql_kW,
      Qt_kW,
      Qs_BTUh,
      Ql_BTUh,
      Qt_BTUh,
      Qt_TR,
      waterRate_kgs,
      waterRate_kgh,
      waterRate_lbh,
      waterRate_gph,
      typeInfo
    };
  }

  /* --------------------------------------------------------------------------
     3. Apparatus Dew Point (ADP), Bypass Factor (BPF) & Curved Coil Trajectory
     -------------------------------------------------------------------------- */
  function buildCoilCurvePts(a, b, pPa) {
    const N = 16;
    const pts = [];
    const dT = a.T - b.T;
    const dW = a.w - b.w;

    // Pure sensible cooling (no moisture removal): straight horizontal trajectory
    if (dW <= 1e-6 || dT <= 1e-6) {
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const T = a.T - u * dT;
        const w = Math.min(a.w - u * dW, Psy.wsat_at(T, pPa));
        pts.push({ T, w });
      }
      pts[0] = { T: a.T, w: a.w };
      pts[N - 1] = { T: b.T, w: b.w };
      return pts;
    }

    // ASHRAE cooling & dehumidification coil conditioning curve:
    // Begins nearly sensibly toward inlet dew point, then curves smoothly near
    // saturation approaching leaving state b toward ADP.
    const tdpA = getTdp(a.w, pPa);
    const tKnee = clamp(tdpA, b.T + 0.15 * dT, a.T - 0.25 * dT);

    const p0T = a.T;
    const p0W = a.w;
    const p3T = b.T;
    const p3W = b.w;

    const p1T = a.T + 0.65 * (tKnee - a.T);
    const p1W = Math.min(a.w - 0.08 * dW, Psy.wsat_at(p1T, pPa));

    const p2T = b.T + 0.35 * (tKnee - b.T);
    const p2W = Math.min(a.w, b.w + 0.65 * dW, Psy.wsat_at(p2T, pPa));

    for (let i = 0; i < N; i++) {
      if (i === 0) {
        pts.push({ T: a.T, w: a.w });
        continue;
      }
      if (i === N - 1) {
        pts.push({ T: b.T, w: b.w });
        continue;
      }
      const u = i / (N - 1);
      const om = 1 - u;
      const om2 = om * om;
      const om3 = om2 * om;
      const u2 = u * u;
      const u3 = u2 * u;

      const T = om3 * p0T + 3 * om2 * u * p1T + 3 * om * u2 * p2T + u3 * p3T;
      let w = om3 * p0W + 3 * om2 * u * p1W + 3 * om * u2 * p2W + u3 * p3W;

      // Enforce physical bounds: never supersaturated and monotonically within [b.w, a.w]
      const wSat = Psy.wsat_at(T, pPa);
      w = clamp(w, b.w, Math.min(a.w, wSat));
      pts.push({ T, w });
    }

    // Ensure monotone non-increasing w along cooling curve
    for (let i = 1; i < N - 1; i++) {
      if (pts[i].w > pts[i - 1].w) pts[i].w = pts[i - 1].w;
    }

    return pts;
  }

  function calcADP(a, b, pPa = 101325, waterDtC = 5.5) {
    const waterFlowFactor_Lps_per_kW = 1 / (WATER_CP_KJ_KGK * Math.max(0.5, waterDtC));

    const invalid = (reason) => ({
      valid: false,
      T_adp: NaN,
      w_adp: NaN,
      h_adp: NaN,
      BPF: NaN,
      CF: NaN,
      coilCurvePts: [],
      waterFlowFactor_Lps_per_kW,
      reason
    });

    if (b.T >= a.T - 1e-4) {
      return invalid('Process must cool air (T_out < T_in) to determine Apparatus Dew Point.');
    }
    if (b.w > a.w + 1e-4) {
      return invalid('Cooling coil cannot add moisture (w_out > w_in); use Evaporative Cooler analysis.');
    }

    const slope = (b.w - a.w) / (b.T - a.T);
    const wLine = (T) => b.w + slope * (T - b.T);
    // f(T) = wsat(T) - wLine(T): positive in unsaturated region, <= 0 on/above saturation curve
    const diffAt = (T) => Psy.wsat_at(T, pPa) - wLine(T);

    let T_adp = NaN;
    const fStart = diffAt(b.T);

    if (fStart <= 1e-7) {
      // Leaving state is already at saturation (BPF = 0)
      T_adp = b.T;
    } else {
      const tFloor = -30;
      const step = 0.05;
      let tHi = b.T;
      let tLo = NaN;

      for (let T = b.T - step; T >= tFloor - 1e-9; T -= step) {
        const Tc = Math.max(tFloor, T);
        const wL = wLine(Tc);
        if (wL < 0) {
          // Straight line went below w = 0 before intersecting saturation curve
          break;
        }
        const f = Psy.wsat_at(Tc, pPa) - wL;
        if (f <= 0) {
          tLo = Tc;
          break;
        }
        tHi = Tc;
      }

      if (!Number.isFinite(tLo)) {
        return invalid('Condition line does not intersect the saturation curve down to -30°C (SHR too low for cooling coil alone).');
      }

      // 50-step bisection on [tLo, tHi] where diffAt(tLo) <= 0 and diffAt(tHi) > 0
      let lo = tLo;
      let hi = tHi;
      for (let i = 0; i < 50; i++) {
        const mid = 0.5 * (lo + hi);
        if (diffAt(mid) <= 0) lo = mid;
        else hi = mid;
      }
      T_adp = 0.5 * (lo + hi);
    }

    const w_adp = Psy.wsat_at(T_adp, pPa);
    const h_adp = Psy.h_kJkg(T_adp, w_adp);
    const denom = a.T - T_adp;
    const BPF = denom > 1e-6 ? clamp((b.T - T_adp) / denom, 0, 1) : 0;
    const CF = 1 - BPF;
    const coilCurvePts = buildCoilCurvePts(a, b, pPa);

    return {
      valid: true,
      T_adp,
      w_adp,
      h_adp,
      BPF,
      CF,
      coilCurvePts,
      waterFlowFactor_Lps_per_kW,
      reason: ''
    };
  }

  /* --------------------------------------------------------------------------
     4. Adiabatic Multi-Stream Air Mixing (with Fog / Supersaturation Solver)
     -------------------------------------------------------------------------- */
  function calcMixing(streams, pPa = 101325) {
    if (!Array.isArray(streams) || streams.length === 0) {
      return {
        T: NaN,
        w: NaN,
        h: NaN,
        mTotal: 0,
        fractions: [],
        condensationWarning: false,
        fogWater_kgkg: 0
      };
    }

    const masses = streams.map((s) => flowToMass(s.flowVal, s.flowUnit || 'Lps', s.T, s.w, pPa));
    const mTotal = masses.reduce((acc, m) => acc + m, 0);

    if (mTotal <= 1e-12) {
      const s0 = streams[0];
      return {
        T: s0.T,
        w: s0.w,
        h: Psy.h_kJkg(s0.T, s0.w),
        mTotal: 0,
        fractions: streams.map((_, idx) => (idx === 0 ? 1 : 0)),
        condensationWarning: false,
        fogWater_kgkg: 0
      };
    }

    let wSum = 0;
    let hSum = 0;
    const fractions = masses.map((m) => m / mTotal);

    for (let i = 0; i < streams.length; i++) {
      const s = streams[i];
      const f = fractions[i];
      wSum += f * s.w;
      hSum += f * Psy.h_kJkg(s.T, s.w);
    }

    const wMix = wSum;
    const hMix = hSum;
    const Tmix = Psy.Tdb_from_wh(wMix, hMix);
    const wSatAtMix = Psy.wsat_at(Tmix, pPa);

    if (wMix > wSatAtMix + 1e-7) {
      // Supersaturated fog/condensation mixing: solve equilibrium saturated state
      // along constant enthalpy h(T_eq, wsat(T_eq)) = hMix
      let lo = -60;
      let hi = 90;
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        const hSat = Psy.h_kJkg(mid, Psy.wsat_at(mid, pPa));
        if (hSat > hMix) hi = mid;
        else lo = mid;
      }
      const T_eq = 0.5 * (lo + hi);
      const w_eq = Psy.wsat_at(T_eq, pPa);
      const fogWater_kgkg = Math.max(0, wMix - w_eq);

      return {
        T: T_eq,
        w: w_eq,
        h: hMix,
        mTotal,
        fractions,
        condensationWarning: true,
        fogWater_kgkg,
        unclampedT: Tmix,
        unclampedW: wMix
      };
    }

    return {
      T: Tmix,
      w: wMix,
      h: hMix,
      mTotal,
      fractions,
      condensationWarning: false,
      fogWater_kgkg: 0
    };
  }

  /* --------------------------------------------------------------------------
     5. Energy Recovery Ventilator (ERV / Enthalpy Wheel)
     -------------------------------------------------------------------------- */
  function calcERV(oa, ra, pPa = 101325, opts = {}) {
    const sensEff = normalizeFraction(opts.sensEff ?? 0.72, 0.72);
    const latEff = normalizeFraction(opts.latEff ?? 0.65, 0.65);
    const flowOA = opts.flowOA ?? 1000;
    const flowRA = opts.flowRA ?? 1000;
    const flowUnit = opts.flowUnit || 'Lps';

    const mOA = Psy.flowToMassKgps(flowOA, flowUnit, oa.T, oa.w, pPa);
    const mRA = Psy.flowToMassKgps(flowRA, flowUnit, ra.T, ra.w, pPa);
    const mMin = Math.min(mOA, mRA);

    const ratioOA = mOA > 1e-12 ? mMin / mOA : 0;
    const ratioRA = mRA > 1e-12 ? mOA / mRA : 0;

    const T_sup = oa.T + sensEff * ratioOA * (ra.T - oa.T);
    const w_sup_raw = oa.w + latEff * ratioOA * (ra.w - oa.w);
    const w_sup = clamp(w_sup_raw, 0, Psy.wsat_at(T_sup, pPa));

    const T_exh = ra.T - ratioRA * (T_sup - oa.T);
    const w_exh_raw = ra.w - ratioRA * (w_sup - oa.w);
    const w_exh = clamp(w_exh_raw, 0, Psy.wsat_at(T_exh, pPa));

    const raTdp = getTdp(ra.w, pPa);
    const exhaustTdp = getTdp(w_exh, pPa);
    const frostRisk = T_exh < 0 || (raTdp > T_exh && T_exh < 0);

    const hOA = Psy.h_kJkg(oa.T, oa.w);
    const hSup = Psy.h_kJkg(T_sup, w_sup);
    const dh_oa = hSup - hOA;
    const cpm = cpMoist(0.5 * (oa.w + w_sup));
    const dh_s = cpm * (T_sup - oa.T);

    // Positive saved load in both summer cooling recovery and winter heating recovery,
    // preserving QsSaved_kW + QlSaved_kW === QtSaved_kW identically
    const sign = dh_oa >= 0 ? 1 : -1;
    const QtSaved_kW = sign * mOA * dh_oa;
    const QsSaved_kW = sign * mOA * dh_s;
    const QlSaved_kW = QtSaved_kW - QsSaved_kW;
    const QtSaved_BTUh = QtSaved_kW * btuhPerKw();
    const QtSaved_TR = QtSaved_kW / kwPerTon();

    return {
      supplyOut: { T: T_sup, w: w_sup },
      exhaustOut: { T: T_exh, w: w_exh },
      QsSaved_kW,
      QlSaved_kW,
      QtSaved_kW,
      QtSaved_BTUh,
      QtSaved_TR,
      frostRisk,
      exhaustTdp,
      mOA,
      mRA
    };
  }

  /* --------------------------------------------------------------------------
     6. Evaporative Cooling (Direct DEC, Indirect IEC, Two-Stage IDEC)
     -------------------------------------------------------------------------- */
  function calcEvapCooler(inlet, pPa = 101325, opts = {}) {
    const mode = opts.mode || 'direct';
    const effDirect = normalizeFraction(opts.effDirect ?? 0.85, 0.85);
    const effIndirect = normalizeFraction(opts.effIndirect ?? 0.75, 0.75);
    const flowVal = opts.flowVal ?? 1000;
    const flowUnit = opts.flowUnit || 'Lps';

    const mDa = Psy.flowToMassKgps(flowVal, flowUnit, inlet.T, inlet.w, pPa);
    const twbIn = getTwb(inlet.T, inlet.w, pPa);
    const stages = [];
    let outlet = { T: inlet.T, w: inlet.w };
    let waterUse_Lh = 0;

    if (mode === 'indirect') {
      const T_out = inlet.T - effIndirect * (inlet.T - twbIn);
      const w_out = Math.min(inlet.w, Psy.wsat_at(T_out, pPa));
      outlet = { T: T_out, w: w_out };
      stages.push({
        name: 'Indirect Evap (IEC)',
        from: { T: inlet.T, w: inlet.w },
        to: { T: T_out, w: w_out },
        eff: effIndirect
      });
      // Evaporated water on secondary scavenging airstream
      const qIec_kW = Math.max(0, mDa * cpMoist(inlet.w) * (inlet.T - T_out));
      waterUse_Lh = (qIec_kW / 2450) * 3600;
    } else if (mode === 'twostage') {
      // Stage 1: Indirect sensible precooling toward inlet wet-bulb
      const T_mid = inlet.T - effIndirect * (inlet.T - twbIn);
      const w_mid = Math.min(inlet.w, Psy.wsat_at(T_mid, pPa));
      stages.push({
        name: 'Stage 1: Indirect (IEC)',
        from: { T: inlet.T, w: inlet.w },
        to: { T: T_mid, w: w_mid },
        eff: effIndirect
      });

      // Stage 2: Direct evaporative cooling along stage-1 leaving wet-bulb
      const twbMid = getTwb(T_mid, w_mid, pPa);
      const T_out = T_mid - effDirect * (T_mid - twbMid);
      const w_raw = Psy.w_from_TTwb(T_out, twbMid, pPa);
      const w_out = clamp(w_raw, w_mid, Psy.wsat_at(T_out, pPa));
      outlet = { T: T_out, w: w_out };
      stages.push({
        name: 'Stage 2: Direct (DEC)',
        from: { T: T_mid, w: w_mid },
        to: { T: T_out, w: w_out },
        eff: effDirect
      });

      const qIec_kW = Math.max(0, mDa * cpMoist(inlet.w) * (inlet.T - T_mid));
      const iecWater_Lh = (qIec_kW / 2450) * 3600;
      const decWater_Lh = mDa * Math.max(0, w_out - w_mid) * 3600;
      waterUse_Lh = iecWater_Lh + decWater_Lh;
    } else {
      // Default: Direct evaporative cooling (DEC) along constant thermodynamic wet-bulb
      const T_out = inlet.T - effDirect * (inlet.T - twbIn);
      const w_raw = Psy.w_from_TTwb(T_out, twbIn, pPa);
      const w_out = clamp(w_raw, inlet.w, Psy.wsat_at(T_out, pPa));
      outlet = { T: T_out, w: w_out };
      stages.push({
        name: 'Direct Evap (DEC)',
        from: { T: inlet.T, w: inlet.w },
        to: { T: T_out, w: w_out },
        eff: effDirect
      });
      waterUse_Lh = mDa * Math.max(0, w_out - inlet.w) * 3600;
    }

    const T_drop = inlet.T - outlet.T;
    const cpm = cpMoist(0.5 * (inlet.w + outlet.w));
    const Q_equiv_kW = mDa * cpm * T_drop;
    const Q_equiv_TR = Q_equiv_kW / kwPerTon();
    const Q_equiv_BTUh = Q_equiv_kW * btuhPerKw();
    const waterUse_gph = waterUse_Lh / GALLON_WATER_KG;

    return {
      mode,
      stages,
      outlet,
      T_drop,
      waterUse_Lh,
      waterUse_gph,
      Q_equiv_kW,
      Q_equiv_TR,
      Q_equiv_BTUh,
      inletTwb: twbIn,
      outletTwb: getTwb(outlet.T, outlet.w, pPa)
    };
  }

  /* --------------------------------------------------------------------------
     7. Solid Desiccant Wheel Dehumidifier
     -------------------------------------------------------------------------- */
  function calcDesiccant(inlet, pPa = 101325, opts = {}) {
    const moistureRemovalEff = normalizeFraction(opts.moistureRemovalEff ?? 0.65, 0.65);
    const thermalCarryover = normalizeFraction(opts.thermalCarryover ?? 0.15, 0.15);
    const regenTempC = opts.regenTempC ?? 110;
    const flowVal = opts.flowVal ?? 1000;
    const flowUnit = opts.flowUnit || 'Lps';

    const w_out = inlet.w <= 0.0005
      ? inlet.w
      : Math.max(0.0005, inlet.w * (1 - moistureRemovalEff));

    const dh_carry = thermalCarryover * 1.006 * Math.max(0, regenTempC - inlet.T) * 0.25;
    const h_in = Psy.h_kJkg(inlet.T, inlet.w);
    const h_out = h_in + dh_carry;
    const T_out = Psy.Tdb_from_wh(w_out, h_out);

    const mDa = Psy.flowToMassKgps(flowVal, flowUnit, inlet.T, inlet.w, pPa);
    const dW_removed = Math.max(0, inlet.w - w_out);
    const moistureRate_kgh = mDa * dW_removed * 3600;
    const moistureRate_lbh = moistureRate_kgh * lbPerKg();
    const regenHeat_kW = 1.35 * mDa * dW_removed * 2501;

    return {
      outlet: { T: T_out, w: w_out },
      dW_removed,
      moistureRate_kgh,
      moistureRate_lbh,
      regenHeat_kW,
      dh_carry
    };
  }

  /* --------------------------------------------------------------------------
     8. Steam (Isothermal) & Adiabatic (Spray / Ultrasonic) Humidifier
     -------------------------------------------------------------------------- */
  function calcHumidifier(inlet, targetW_kgkg, pPa = 101325, opts = {}) {
    const mode = opts.mode || 'steam';
    const steamTempC = opts.steamTempC ?? 100;
    const flowVal = opts.flowVal ?? 1000;
    const flowUnit = opts.flowUnit || 'Lps';

    const h_in = Psy.h_kJkg(inlet.T, inlet.w);
    const mDa = Psy.flowToMassKgps(flowVal, flowUnit, inlet.T, inlet.w, pPa);

    if (!Number.isFinite(targetW_kgkg) || targetW_kgkg <= inlet.w + 1e-9) {
      return {
        mode,
        outlet: { T: inlet.T, w: inlet.w },
        dW: 0,
        waterRate_kgh: 0,
        waterRate_lbh: 0,
        waterRate_gph: 0,
        steamEnergy_kW: 0,
        saturatedClamped: false
      };
    }

    // Specific enthalpy of added moisture (kJ/kg water):
    // Steam: h_g ≈ 2501 + 1.86 * T_steam; Adiabatic liquid water at 15°C: h_w = 4.186 * 15
    const h_add = mode === 'adiabatic'
      ? WATER_CP_KJ_KGK * 15
      : 2501 + 1.86 * steamTempC;

    const evalState = (wVal) => {
      const hVal = h_in + (wVal - inlet.w) * h_add;
      const TVal = Psy.Tdb_from_wh(wVal, hVal);
      return { T: TVal, w: wVal, h: hVal };
    };

    let state = evalState(targetW_kgkg);
    let saturatedClamped = false;

    if (state.w > Psy.wsat_at(state.T, pPa)) {
      saturatedClamped = true;
      let lo = inlet.w;
      let hi = targetW_kgkg;
      for (let i = 0; i < 50; i++) {
        const mid = 0.5 * (lo + hi);
        const st = evalState(mid);
        if (st.w > Psy.wsat_at(st.T, pPa)) hi = mid;
        else lo = mid;
      }
      state = evalState(lo);
      state.w = Math.min(state.w, Psy.wsat_at(state.T, pPa));
    }

    const dW = Math.max(0, state.w - inlet.w);
    const waterRate_kgh = mDa * dW * 3600;
    const waterRate_lbh = waterRate_kgh * lbPerKg();
    const waterRate_gph = waterRate_kgh / GALLON_WATER_KG;
    const steamEnergy_kW = mode === 'adiabatic' ? 0 : mDa * dW * h_add;

    return {
      mode,
      outlet: { T: state.T, w: state.w },
      dW,
      waterRate_kgh,
      waterRate_lbh,
      waterRate_gph,
      steamEnergy_kW,
      saturatedClamped
    };
  }

  /* --------------------------------------------------------------------------
     9. Full Interactive AHU Cycle Builder
     Modes: 'summer_reheat' | 'doas_erv' | 'winter_humid' | 'economizer'
     -------------------------------------------------------------------------- */
  function applyCoolingCoil(entering, coilAdp, coilBpf, pPa) {
    if (entering.T <= coilAdp + 1e-4) {
      return { active: false, state: { T: entering.T, w: entering.w } };
    }
    const wAdp = Psy.wsat_at(coilAdp, pPa);
    const T_cc = coilAdp + coilBpf * (entering.T - coilAdp);
    let w_cc;
    if (entering.w > wAdp) {
      // Wet coil: cools and dehumidifies along straight line toward ADP
      w_cc = wAdp + coilBpf * (entering.w - wAdp);
    } else {
      // Dry coil: entering dew point is below ADP, sensible cooling only
      w_cc = entering.w;
    }
    w_cc = Math.min(w_cc, Psy.wsat_at(T_cc, pPa));
    return { active: true, state: { T: T_cc, w: w_cc } };
  }

  function applySupplyFan(entering, fanDpPa, fanEff, pPa) {
    const dp = Math.max(0, Number(fanDpPa) || 0);
    const eff = clamp(fanEff, 0.1, 1.0);
    if (dp <= 0) {
      return { state: { T: entering.T, w: entering.w }, dT_fan: 0 };
    }
    const v = Psy.v_m3kg(entering.T, entering.w, pPa);
    const rho = 1 / Math.max(1e-6, v);
    const dT_fan = dp / (rho * DRY_AIR_CP_J_KGK * eff);
    return {
      state: { T: entering.T + dT_fan, w: entering.w },
      dT_fan
    };
  }

  function buildAHUCycle(params = {}, pPa = 101325) {
    const mode = params.mode || 'summer_reheat';
    const oaT = params.oaT ?? 35;
    const oaRH = params.oaRH ?? 55;
    const raT = params.raT ?? 24;
    const raRH = params.raRH ?? 50;
    const oaPct = clamp(params.oaPct ?? 25, 0, 100);
    const supplyFlow = Math.max(1, Number(params.supplyFlow ?? 2000));
    const flowUnit = params.flowUnit || 'Lps';
    const coilAdp = params.coilAdp ?? 10.5;
    const coilBpf = clamp(normalizeFraction(params.coilBpf ?? 0.12, 0.12), 0, 0.95);
    const hasExplicitReheatT = params.reheatT !== undefined && params.reheatT !== null && Number.isFinite(Number(params.reheatT));
    const reheatT = hasExplicitReheatT ? Number(params.reheatT) : 16;
    const fanDpPa = Math.max(0, Number(params.fanDpPa ?? 650));
    const fanEff = clamp(normalizeFraction(params.fanEff ?? 0.65, 0.65), 0.1, 1.0);
    const ervSensEff = normalizeFraction(params.ervSensEff ?? 0.72, 0.72);
    const ervLatEff = normalizeFraction(params.ervLatEff ?? 0.65, 0.65);
    const humidTargetW = Math.max(0.0005, Number(params.humidTargetW ?? 0.0085));
    const humidMode = params.humidMode || 'steam';

    const oa = { T: oaT, w: wFromTRHpct(oaT, oaRH, pPa) };
    const ra = { T: raT, w: wFromTRHpct(raT, raRH, pPa) };

    const points = [];
    const processes = [];
    const mixLinks = [];
    const ptIndex = new Map();

    const addPt = (key, label, state, color, note = '') => {
      const idx = points.length;
      ptIndex.set(key, idx);
      points.push({ key, label, T: state.T, w: state.w, color, note });
      return idx;
    };

    const addProc = (fromKey, toKey, label, kind, opts = {}) => {
      const fromIdx = ptIndex.get(fromKey);
      const toIdx = ptIndex.get(toKey);
      const a = points[fromIdx];
      const b = points[toIdx];
      const fVal = opts.flowVal ?? supplyFlow;
      const metrics = calcProcessMetrics(a, b, pPa, fVal, flowUnit);
      const proc = {
        fromKey,
        toKey,
        fromIdx,
        toIdx,
        label,
        kind,
        curved: Boolean(opts.curved),
        flowVal: fVal,
        flowUnit,
        color: opts.color || metrics.typeInfo.color,
        metrics
      };
      processes.push(proc);
      return proc;
    };

    const addMixLink = (fromKey, toKey) => {
      mixLinks.push({
        fromKey,
        toKey,
        fromIdx: ptIndex.get(fromKey),
        toIdx: ptIndex.get(toKey)
      });
    };

    let cooling_kW = 0;
    let reheat_kW = 0;
    let preheat_kW = 0;
    let fan_kW = 0;
    let ervSaved_kW = 0;
    let condensate_kgh = 0;
    let humidWater_kgh = 0;
    let frostRisk = false;
    let oaPctUsed = oaPct;
    let economizerSaved_kW = 0;
    let economizerState = '';
    let baselineCooling_kW = 0;
    let effectiveAdp = coilAdp;
    let effectiveBpf = coilBpf;

    // Always start with OA and RA reference points
    addPt('OA', 'OA (Outdoor)', oa, '#f97316', `Outdoor Air (${oaT.toFixed(1)}°C, ${oaRH.toFixed(0)}% RH)`);
    addPt('RA', 'RA (Room)', ra, '#10b981', `Return / Room Air (${raT.toFixed(1)}°C, ${raRH.toFixed(0)}% RH)`);

    if (mode === 'doas_erv') {
      oaPctUsed = 100;
      const ervRes = calcERV(oa, ra, pPa, {
        sensEff: ervSensEff,
        latEff: ervLatEff,
        flowOA: supplyFlow,
        flowRA: supplyFlow,
        flowUnit
      });
      ervSaved_kW = ervRes.QtSaved_kW;
      frostRisk = ervRes.frostRisk;

      addPt('ERV', 'ERV Out', ervRes.supplyOut, PROCESS_COLORS.erv, `ERV Supply (ηs=${(ervSensEff * 100).toFixed(0)}%, ηl=${(ervLatEff * 100).toFixed(0)}%)`);
      addProc('OA', 'ERV', 'ERV Recovery', 'erv', { color: PROCESS_COLORS.erv });

      let lastKey = 'ERV';
      let lastState = ervRes.supplyOut;

      const cc = applyCoolingCoil(lastState, coilAdp, coilBpf, pPa);
      if (cc.active && lastState.T - cc.state.T > 0.05) {
        addPt('CC', 'CC (Coil Out)', cc.state, PROCESS_COLORS.cool, `Cooling Coil (ADP ${coilAdp.toFixed(1)}°C, BPF ${(coilBpf * 100).toFixed(0)}%)`);
        const pCC = addProc(lastKey, 'CC', 'Cooling & Dehum. Coil', 'cooling', { curved: true });
        cooling_kW = Math.max(0, -pCC.metrics.Qt_kW);
        condensate_kgh = Math.max(0, -pCC.metrics.waterRate_kgh);
        lastKey = 'CC';
        lastState = cc.state;
      }

      if (reheatT > lastState.T + 0.05) {
        const rhState = { T: reheatT, w: lastState.w };
        addPt('RH', 'RH (Reheat)', rhState, PROCESS_COLORS.heat, `Reheat to ${reheatT.toFixed(1)}°C`);
        const pRH = addProc(lastKey, 'RH', 'Reheat Coil', 'reheat');
        reheat_kW = Math.max(0, pRH.metrics.Qt_kW);
        lastKey = 'RH';
        lastState = rhState;
      }

      const fan = applySupplyFan(lastState, fanDpPa, fanEff, pPa);
      addPt('SA', 'SA (Supply)', fan.state, '#06b6d4', `Supply Fan ΔT=+${fan.dT_fan.toFixed(2)}°C`);
      const pFan = addProc(lastKey, 'SA', 'Supply Fan Gain', 'fan');
      fan_kW = Math.max(0, pFan.metrics.Qt_kW);

      addProc('SA', 'RA', 'Room Space Load', 'room');

      addPt('EA', 'EA (Exhaust)', ervRes.exhaustOut, '#94a3b8', frostRisk ? 'ERV Exhaust (Frost Risk!)' : 'ERV Exhaust');
      addProc('RA', 'EA', 'ERV Exhaust', 'erv_exhaust', { color: PROCESS_COLORS.erv });
    } else if (mode === 'winter_humid') {
      const oaFrac = oaPct / 100;
      let ma = oaFrac <= 1e-6 ? ra : (oaFrac >= 1 - 1e-6 ? oa : null);
      let maKey = oaFrac <= 1e-6 ? 'RA' : (oaFrac >= 1 - 1e-6 ? 'OA' : 'MA');

      if (!ma) {
        const mix = calcMixing([
          { T: oa.T, w: oa.w, flowVal: supplyFlow * oaFrac, flowUnit, label: 'OA' },
          { T: ra.T, w: ra.w, flowVal: supplyFlow * (1 - oaFrac), flowUnit, label: 'RA' }
        ], pPa);
        ma = { T: mix.T, w: mix.w };
        addPt('MA', 'MA (Mixed)', ma, PROCESS_COLORS.mix, `Mixed Air (${oaPct.toFixed(0)}% OA)`);
        addMixLink('OA', 'MA');
        addMixLink('RA', 'MA');
      }

      // Determine heating coil target temperature
      let hcT;
      if (hasExplicitReheatT && reheatT > ma.T + 0.05) {
        hcT = reheatT;
      } else {
        const baseHeatT = Math.max(ma.T + 6, raT + 5, reheatT);
        if (humidMode === 'adiabatic') {
          const dWNeed = Math.max(0, humidTargetW - ma.w);
          hcT = baseHeatT + (2501 * dWNeed) / 1.006;
        } else {
          hcT = baseHeatT;
        }
      }
      const hcState = { T: Math.max(ma.T, hcT), w: ma.w };
      addPt('HC', 'HC (Heat Coil)', hcState, PROCESS_COLORS.heat, `Heating Coil to ${hcState.T.toFixed(1)}°C`);
      const pHC = addProc(maKey, 'HC', 'Heating Coil', 'preheat');
      preheat_kW = Math.max(0, pHC.metrics.Qt_kW);

      const humRes = calcHumidifier(hcState, humidTargetW, pPa, {
        mode: humidMode,
        flowVal: supplyFlow,
        flowUnit
      });
      humidWater_kgh = humRes.waterRate_kgh;
      addPt('HUM', 'HUM (Humid.)', humRes.outlet, PROCESS_COLORS.humid, `${humidMode === 'adiabatic' ? 'Adiabatic' : 'Steam'} Humidifier`);
      addProc('HC', 'HUM', humidMode === 'adiabatic' ? 'Adiabatic Humidifier' : 'Steam Humidifier', 'humidify');

      const fan = applySupplyFan(humRes.outlet, fanDpPa, fanEff, pPa);
      addPt('SA', 'SA (Supply)', fan.state, '#06b6d4', `Supply Fan ΔT=+${fan.dT_fan.toFixed(2)}°C`);
      const pFan = addProc('HUM', 'SA', 'Supply Fan Gain', 'fan');
      fan_kW = Math.max(0, pFan.metrics.Qt_kW);

      addProc('SA', 'RA', 'Room Space Load', 'room');
      effectiveAdp = NaN;
      effectiveBpf = NaN;
    } else if (mode === 'economizer') {
      const hOA = Psy.h_kJkg(oa.T, oa.w);
      const hRA = Psy.h_kJkg(ra.T, ra.w);
      const oaMinFrac = oaPct / 100;

      // Baseline (minimum OA without economizer) cooling load
      const baseMix = oaMinFrac <= 1e-6
        ? ra
        : (oaMinFrac >= 1 - 1e-6
          ? oa
          : calcMixing([
            { T: oa.T, w: oa.w, flowVal: supplyFlow * oaMinFrac, flowUnit, label: 'OA' },
            { T: ra.T, w: ra.w, flowVal: supplyFlow * (1 - oaMinFrac), flowUnit, label: 'RA' }
          ], pPa));
      const baseCC = applyCoolingCoil(baseMix, coilAdp, coilBpf, pPa);
      if (baseCC.active) {
        const baseMetrics = calcProcessMetrics(baseMix, baseCC.state, pPa, supplyFlow, flowUnit);
        baselineCooling_kW = Math.max(0, -baseMetrics.Qt_kW);
      }

      // Target cooling discharge temperature before fan
      const targetDischargeT = Math.min(
        ra.T - 1.0,
        Math.max(coilAdp + coilBpf * Math.max(0, ra.T - coilAdp), reheatT - 0.8)
      );

      let oaEconFrac = oaMinFrac;
      if (hOA >= hRA) {
        economizerState = 'locked_out';
        oaEconFrac = oaMinFrac;
      } else if (oa.T <= targetDischargeT && ra.T > oa.T + 0.1) {
        economizerState = 'modulating_free_cooling';
        const needed = (ra.T - targetDischargeT) / (ra.T - oa.T);
        oaEconFrac = clamp(needed, oaMinFrac, 1.0);
      } else {
        economizerState = 'integrated_100pct_oa';
        oaEconFrac = 1.0;
      }
      oaPctUsed = oaEconFrac * 100;

      let coilInKey;
      let coilInState;
      if (oaEconFrac >= 1 - 1e-6) {
        coilInKey = 'OA';
        coilInState = oa;
      } else if (oaEconFrac <= 1e-6) {
        coilInKey = 'RA';
        coilInState = ra;
      } else {
        const econMix = calcMixing([
          { T: oa.T, w: oa.w, flowVal: supplyFlow * oaEconFrac, flowUnit, label: 'OA' },
          { T: ra.T, w: ra.w, flowVal: supplyFlow * (1 - oaEconFrac), flowUnit, label: 'RA' }
        ], pPa);
        coilInKey = 'MA';
        coilInState = { T: econMix.T, w: econMix.w };
        addPt('MA', `MA (${oaPctUsed.toFixed(0)}% OA)`, coilInState, PROCESS_COLORS.mix, `Economizer Mix (${economizerState})`);
        addMixLink('OA', 'MA');
        addMixLink('RA', 'MA');
      }

      let lastKey = coilInKey;
      let lastState = coilInState;

      // Mechanical cooling coil trims only if economizer mixed air is still above target
      if (coilInState.T > targetDischargeT + 0.15 && coilInState.T > coilAdp + 0.05) {
        const cc = applyCoolingCoil(coilInState, coilAdp, coilBpf, pPa);
        if (cc.active && coilInState.T - cc.state.T > 0.05) {
          addPt('CC', 'CC (Coil Out)', cc.state, PROCESS_COLORS.cool, `Trim Cooling Coil (ADP ${coilAdp.toFixed(1)}°C)`);
          const pCC = addProc(lastKey, 'CC', 'Cooling & Dehum. Coil', 'cooling', { curved: true });
          cooling_kW = Math.max(0, -pCC.metrics.Qt_kW);
          condensate_kgh = Math.max(0, -pCC.metrics.waterRate_kgh);
          lastKey = 'CC';
          lastState = cc.state;

          if (reheatT > lastState.T + 0.05) {
            const rhState = { T: reheatT, w: lastState.w };
            addPt('RH', 'RH (Reheat)', rhState, PROCESS_COLORS.heat, `Reheat to ${reheatT.toFixed(1)}°C`);
            const pRH = addProc(lastKey, 'RH', 'Reheat Coil', 'reheat');
            reheat_kW = Math.max(0, pRH.metrics.Qt_kW);
            lastKey = 'RH';
            lastState = rhState;
          }
        }
      }

      economizerSaved_kW = Math.max(0, baselineCooling_kW - cooling_kW);
      ervSaved_kW = economizerSaved_kW;

      const fan = applySupplyFan(lastState, fanDpPa, fanEff, pPa);
      addPt('SA', 'SA (Supply)', fan.state, '#06b6d4', `Supply Fan ΔT=+${fan.dT_fan.toFixed(2)}°C`);
      const pFan = addProc(lastKey, 'SA', 'Supply Fan Gain', 'fan');
      fan_kW = Math.max(0, pFan.metrics.Qt_kW);

      addProc('SA', 'RA', 'Room Space Load', 'room');
    } else {
      // Default mode: 'summer_reheat'
      const oaFrac = oaPct / 100;
      let coilInKey;
      let coilInState;

      if (oaFrac >= 1 - 1e-6) {
        coilInKey = 'OA';
        coilInState = oa;
      } else if (oaFrac <= 1e-6) {
        coilInKey = 'RA';
        coilInState = ra;
      } else {
        const mix = calcMixing([
          { T: oa.T, w: oa.w, flowVal: supplyFlow * oaFrac, flowUnit, label: 'OA' },
          { T: ra.T, w: ra.w, flowVal: supplyFlow * (1 - oaFrac), flowUnit, label: 'RA' }
        ], pPa);
        coilInKey = 'MA';
        coilInState = { T: mix.T, w: mix.w };
        addPt('MA', 'MA (Mixed)', coilInState, PROCESS_COLORS.mix, `Mixed Air (${oaPct.toFixed(0)}% OA)`);
        addMixLink('OA', 'MA');
        addMixLink('RA', 'MA');
      }

      let lastKey = coilInKey;
      let lastState = coilInState;

      const cc = applyCoolingCoil(coilInState, coilAdp, coilBpf, pPa);
      if (cc.active && coilInState.T - cc.state.T > 0.05) {
        addPt('CC', 'CC (Coil Out)', cc.state, PROCESS_COLORS.cool, `Cooling Coil (ADP ${coilAdp.toFixed(1)}°C, BPF ${(coilBpf * 100).toFixed(0)}%)`);
        const pCC = addProc(lastKey, 'CC', 'Cooling & Dehum. Coil', 'cooling', { curved: true });
        cooling_kW = Math.max(0, -pCC.metrics.Qt_kW);
        condensate_kgh = Math.max(0, -pCC.metrics.waterRate_kgh);
        lastKey = 'CC';
        lastState = cc.state;
      }

      if (reheatT > lastState.T + 0.05) {
        const rhState = { T: reheatT, w: lastState.w };
        addPt('RH', 'RH (Reheat)', rhState, PROCESS_COLORS.heat, `Reheat to ${reheatT.toFixed(1)}°C`);
        const pRH = addProc(lastKey, 'RH', 'Reheat Coil', 'reheat');
        reheat_kW = Math.max(0, pRH.metrics.Qt_kW);
        lastKey = 'RH';
        lastState = rhState;
      }

      const fan = applySupplyFan(lastState, fanDpPa, fanEff, pPa);
      addPt('SA', 'SA (Supply)', fan.state, '#06b6d4', `Supply Fan ΔT=+${fan.dT_fan.toFixed(2)}°C`);
      const pFan = addProc(lastKey, 'SA', 'Supply Fan Gain', 'fan');
      fan_kW = Math.max(0, pFan.metrics.Qt_kW);

      addProc('SA', 'RA', 'Room Space Load', 'room');
    }

    const saPt = points[ptIndex.get('SA')];
    const roomProc = processes.find((p) => p.kind === 'room');
    const roomMetrics = roomProc ? roomProc.metrics : calcProcessMetrics(saPt, ra, pPa, supplyFlow, flowUnit);

    return {
      mode,
      points,
      processes,
      mixLinks,
      summary: {
        cooling_kW,
        cooling_TR: cooling_kW / kwPerTon(),
        reheat_kW,
        preheat_kW,
        fan_kW,
        ervSaved_kW,
        condensate_kgh,
        humidWater_kgh,
        roomQs_kW: roomMetrics.Qs_kW,
        roomQl_kW: roomMetrics.Ql_kW,
        roomSHR: roomMetrics.SHR,
        supplyT_C: saPt.T,
        supplyRH: rhPctFromTw(saPt.T, saPt.w, pPa),
        coilAdp: effectiveAdp,
        coilBpf: effectiveBpf,
        oaPctUsed,
        frostRisk,
        economizerSaved_kW,
        economizerState,
        baselineCooling_kW
      }
    };
  }

  /* --------------------------------------------------------------------------
     10. ASHRAE Standard 62.1-2022 Ventilation Rate Procedure & CO₂ Estimator
     -------------------------------------------------------------------------- */
  const ASHRAE_62_1_SPACES = Object.freeze([
    { id: 'office', name: 'Office', Rp_Lps: 2.5, Ra_Lps_m2: 0.3, defaultOccPer100m2: 5, co2Gen_Lps: 0.0052 },
    { id: 'conference', name: 'Conference / Meeting', Rp_Lps: 2.5, Ra_Lps_m2: 0.3, defaultOccPer100m2: 50, co2Gen_Lps: 0.0052 },
    { id: 'classroom', name: 'Classroom (9+)', Rp_Lps: 5.0, Ra_Lps_m2: 0.6, defaultOccPer100m2: 35, co2Gen_Lps: 0.0052 },
    { id: 'retail', name: 'Retail Sales', Rp_Lps: 3.8, Ra_Lps_m2: 0.6, defaultOccPer100m2: 15, co2Gen_Lps: 0.0060 },
    { id: 'restaurant', name: 'Restaurant Dining', Rp_Lps: 3.8, Ra_Lps_m2: 0.9, defaultOccPer100m2: 70, co2Gen_Lps: 0.0055 },
    { id: 'gym', name: 'Gym / Health Club', Rp_Lps: 10.0, Ra_Lps_m2: 0.3, defaultOccPer100m2: 40, co2Gen_Lps: 0.0120 },
    { id: 'hospital', name: 'Hospital Patient Room', Rp_Lps: 12.5, Ra_Lps_m2: 0.9, defaultOccPer100m2: 10, co2Gen_Lps: 0.0048 },
    { id: 'datacenter', name: 'Data Center', Rp_Lps: 2.5, Ra_Lps_m2: 0.3, defaultOccPer100m2: 4, co2Gen_Lps: 0.0052 },
    { id: 'auditorium', name: 'Auditorium', Rp_Lps: 2.5, Ra_Lps_m2: 0.3, defaultOccPer100m2: 150, co2Gen_Lps: 0.0050 },
    { id: 'hotel', name: 'Hotel Bedroom', Rp_Lps: 2.5, Ra_Lps_m2: 0.3, defaultOccPer100m2: 10, co2Gen_Lps: 0.0046 },
    { id: 'laboratory', name: 'Laboratory', Rp_Lps: 5.0, Ra_Lps_m2: 0.9, defaultOccPer100m2: 25, co2Gen_Lps: 0.0058 },
    { id: 'lobby', name: 'Lobby', Rp_Lps: 3.8, Ra_Lps_m2: 0.3, defaultOccPer100m2: 30, co2Gen_Lps: 0.0055 }
  ]);

  function findSpacePreset(spaceType) {
    if (!spaceType) return ASHRAE_62_1_SPACES[0];
    const key = String(spaceType).trim().toLowerCase();
    return (
      ASHRAE_62_1_SPACES.find(
        (s) => s.id.toLowerCase() === key || s.name.toLowerCase() === key
      ) || ASHRAE_62_1_SPACES[0]
    );
  }

  function calcVentilation62_1(oa, rm, pPa = 101325, opts = {}) {
    const preset = findSpacePreset(opts.spaceType);
    const people = Math.max(0, Number(opts.people ?? 20));
    const area_m2 = Math.max(0, Number(opts.area_m2 ?? 200));
    const Rp = Number.isFinite(Number(opts.Rp_Lps)) ? Number(opts.Rp_Lps) : preset.Rp_Lps;
    const Ra = Number.isFinite(Number(opts.Ra_Lps_m2)) ? Number(opts.Ra_Lps_m2) : preset.Ra_Lps_m2;
    const Ez = Math.max(0.2, Number(opts.Ez ?? 1.0));
    const outdoorCO2 = Number.isFinite(Number(opts.outdoorCO2)) ? Number(opts.outdoorCO2) : 420;
    const co2Gen_Lps_per_person = Number.isFinite(Number(opts.co2Gen_Lps_per_person))
      ? Number(opts.co2Gen_Lps_per_person)
      : preset.co2Gen_Lps;

    const Vbz_Lps = people * Rp + area_m2 * Ra;
    const Voz_Lps = Vbz_Lps / Ez;
    const Vbz_cfm = Vbz_Lps * cfmPerLps();
    const Voz_cfm = Voz_Lps * cfmPerLps();

    const metrics = calcProcessMetrics(oa, rm, pPa, Voz_Lps, 'Lps');
    const steadyCO2_ppm = Vbz_Lps > 1e-6
      ? outdoorCO2 + (co2Gen_Lps_per_person * people * 1e6) / Vbz_Lps
      : Infinity;

    return {
      space: preset,
      people,
      area_m2,
      Rp_Lps: Rp,
      Ra_Lps_m2: Ra,
      Ez,
      Vbz_Lps,
      Vbz_cfm,
      Voz_Lps,
      Voz_cfm,
      Lps_per_person: people > 0 ? Voz_Lps / people : NaN,
      cfm_per_person: people > 0 ? Voz_cfm / people : NaN,
      mDa: metrics.mDa,
      Qs_kW: metrics.Qs_kW,
      Ql_kW: metrics.Ql_kW,
      Qt_kW: metrics.Qt_kW,
      Qt_TR: metrics.Qt_TR,
      Qt_BTUh: metrics.Qt_BTUh,
      Qs_BTUh: metrics.Qs_BTUh,
      Ql_BTUh: metrics.Ql_BTUh,
      waterRate_kgh: metrics.waterRate_kgh,
      loadMode: metrics.Qt_kW < -1e-6 ? 'cooling' : (metrics.Qt_kW > 1e-6 ? 'heating' : 'neutral'),
      outdoorCO2_ppm: outdoorCO2,
      co2Gen_Lps_per_person,
      steadyCO2_ppm
    };
  }

  /**
   * Solve the exact intersection of an ASHRAE SHR reference slope line through
   * `refPt = { T, w }` with the 100% RH saturation curve (Apparatus Dew Point /
   * Coil Saturation Point), plus exact Δh/ΔW (kJ/kg_w) ratio.
   */
  function solveSHRSaturation(refPt, shrVal = 0.75, pPa = 101325) {
    const shr = Number.isFinite(Number(shrVal)) ? clamp(Number(shrVal), -2, 2) : 0.75;
    const validPt = refPt && Number.isFinite(refPt.T) && Number.isFinite(refPt.w);
    const wRef = validPt ? Math.max(0, refPt.w) : 0.010;
    const cpm = 1.006 + 1.86 * wRef;
    const slope = Math.abs(shr) <= 1e-4
      ? Infinity
      : (Math.abs(shr - 1) <= 1e-6 ? 0 : ((1 - shr) / shr) * cpm / 2501);
    const dhdw_kJkg = Math.abs(1 - shr) < 1e-4 ? Infinity : 2501 / (1 - shr);
    const tZero = (validPt && Number.isFinite(slope) && slope > 1e-9)
      ? (refPt.T - wRef / slope)
      : null;

    let satHit = null;
    let satStatus = 'none';

    if (validPt) {
      const wsRef = Psy.wsat_at(refPt.T, pPa);
      if (wRef >= wsRef - 1e-5) {
        satHit = { T: refPt.T, w: wsRef };
        satStatus = 'saturated';
      } else if (!Number.isFinite(slope)) {
        satHit = { T: refPt.T, w: wsRef };
        satStatus = 'hit';
      } else if (Math.abs(slope) <= 1e-9) {
        const pv = Psy.pv_from_w(Math.max(1e-7, wRef), pPa);
        const tDp = Psy.dewpoint_from_pv(pv);
        if (Number.isFinite(tDp) && tDp >= -40 && tDp <= refPt.T + 1e-4) {
          satHit = { T: tDp, w: wRef };
          satStatus = 'hit';
        }
      } else if (slope > 0) {
        // Cooling / Room SHR line (0 < SHR < 1): march downward in T from refPt.T toward w = 0
        const tStop = Math.max(-35, tZero);
        let prevT = refPt.T;
        let bracket = null;
        const stepT = 0.4;
        for (let T = refPt.T - stepT; T >= tStop - 1e-6; T -= stepT) {
          const Tc = Math.max(tStop, T);
          const wL = wRef + slope * (Tc - refPt.T);
          const ws = Psy.wsat_at(Tc, pPa);
          if (wL >= ws) {
            bracket = [Tc, prevT];
            break;
          }
          prevT = Tc;
          if (Tc <= tStop) break;
        }
        if (bracket) {
          let lo = bracket[0];
          let hi = bracket[1];
          for (let it = 0; it < 28; it++) {
            const mid = 0.5 * (lo + hi);
            const wL = wRef + slope * (mid - refPt.T);
            const ws = Psy.wsat_at(mid, pPa);
            if (wL >= ws) lo = mid;
            else hi = mid;
          }
          const Tsat = 0.5 * (lo + hi);
          satHit = { T: Tsat, w: Psy.wsat_at(Tsat, pPa) };
          satStatus = 'hit';
        } else {
          // Latent load too steep to intersect saturation curve without reheat or desiccant
          satStatus = 'no-hit';
        }
      } else {
        // Negative slope (evaporative cooling / desiccant / SHR < 0 or SHR > 1): guaranteed left intersection
        let prevT = refPt.T;
        let bracket = null;
        const stepT = 0.5;
        for (let T = refPt.T - stepT; T >= -35; T -= stepT) {
          const wL = wRef + slope * (T - refPt.T);
          const ws = Psy.wsat_at(T, pPa);
          if (wL >= ws) {
            bracket = [T, prevT];
            break;
          }
          prevT = T;
        }
        if (bracket) {
          let lo = bracket[0];
          let hi = bracket[1];
          for (let it = 0; it < 28; it++) {
            const mid = 0.5 * (lo + hi);
            const wL = wRef + slope * (mid - refPt.T);
            const ws = Psy.wsat_at(mid, pPa);
            if (wL >= ws) lo = mid;
            else hi = mid;
          }
          const Tsat = 0.5 * (lo + hi);
          satHit = { T: Tsat, w: Psy.wsat_at(Tsat, pPa) };
          satStatus = 'hit';
        }
      }
    }

    return { shr, cpm, slope, dhdw_kJkg, satHit, satStatus, tZero };
  }

  return {
    classifyProcess,
    calcProcessMetrics,
    calcADP,
    solveSHRSaturation,
    calcMixing,
    calcERV,
    calcEvapCooler,
    calcDesiccant,
    calcHumidifier,
    buildAHUCycle,
    ASHRAE_62_1_SPACES,
    calcVentilation62_1
  };
})();
