/* ============================================================================
   PsychroChart Ultra 3.0 — Thermal Comfort, Bioclimatic & Building Science Engine
   - ISO 7730:2005 / ASHRAE Standard 55 Analytical Fanger PMV/PPD Model
   - Dynamic Altitude- & Parameter-Adaptive ASHRAE 55 Comfort Polygons
   - Givoni Building Bioclimatic Chart (Passive & Low-Energy Strategies)
   - ASHRAE TC 9.9 Data Center Thermal Envelopes (Recommended, A1, A2, A3)
   - ASHRAE Standard 160 / ISO 13788 Mold & Surface Condensation Risk
   All internal coordinates strictly SI: T (°C), w (kg/kg), pPa (Pa).
   ============================================================================ */

import { Psy } from './psychro.js';

export const Comfort = (() => {
  /* ---- Internal psychrometric wrappers (delegating to Psy) ---- */
  const pwsPa = (Tc) => Psy.p_ws_Pa(Tc);
  const wsatAt = (Tc, pPa) => Psy.wsat_at(Tc, pPa);

  const pvFromW = (w, pPa) => (
    typeof Psy.pv_from_w === 'function'
      ? Psy.pv_from_w(w, pPa)
      : (w * pPa) / (w + 0.621945)
  );

  const wFromPv = (pv, pPa) => (
    typeof Psy.w_from_pv === 'function'
      ? Psy.w_from_pv(pv, pPa)
      : (0.621945 * pv) / Math.max(1, pPa - pv)
  );

  const rhFromTw = (Tc, w, pPa) => (
    typeof Psy.RH_from_Tw === 'function'
      ? Psy.RH_from_Tw(Tc, w, pPa)
      : Math.max(0, Math.min(1, pvFromW(w, pPa) / Math.max(1e-9, pwsPa(Tc))))
  );

  const wFromTdp = (Tdp, pPa) => (
    typeof Psy.w_from_Tdp === 'function'
      ? Psy.w_from_Tdp(Tdp, pPa)
      : wFromPv(Math.min(pwsPa(Tdp), pPa * 0.999), pPa)
  );

  const dewpointFromPv = (pv) => {
    if (typeof Psy.dewpoint_from_pv === 'function') return Psy.dewpoint_from_pv(pv);
    if (pv <= 0) return -80;
    let lo = -80;
    let hi = 80;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (pwsPa(mid) > pv) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  };

  const wFromRH = (Tc, rhPct, pPa) => {
    const rh = Math.max(0, Math.min(100, rhPct)) / 100;
    const pv = Math.min(pPa * 0.999, rh * pwsPa(Tc));
    return Math.max(0, wFromPv(pv, pPa));
  };

  /**
   * Exact ASHRAE 2021 Eq. (35)/(37) humidity ratio at given dry-bulb & wet-bulb.
   */
  const wFromTwb = (Tdb, Twb, pPa) => {
    const ws = wsatAt(Twb, pPa);
    let w;
    if (Twb >= 0) {
      w = ((2501 - 2.326 * Twb) * ws - 1.006 * (Tdb - Twb)) / (2501 + 1.86 * Tdb - 4.186 * Twb);
    } else {
      w = ((2830 - 0.24 * Twb) * ws - 1.006 * (Tdb - Twb)) / (2830 + 1.86 * Tdb - 2.1 * Twb);
    }
    return Math.max(0, Math.min(w, wsatAt(Tdb, pPa)));
  };

  const dedupPoly = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const prev = out[out.length - 1];
      if (!prev || Math.abs(p[0] - prev[0]) > 1e-4 || Math.abs(p[1] - prev[1]) > 1e-6) {
        out.push([p[0], p[1]]);
      }
    }
    if (out.length > 1) {
      const first = out[0];
      const last = out[out.length - 1];
      if (Math.abs(first[0] - last[0]) <= 1e-4 && Math.abs(first[1] - last[1]) <= 1e-6) {
        out.pop();
      }
    }
    return out;
  };

  /**
   * Build a clean closed polygon from matched top and bottom functions over [tMin, tMax].
   * Includes optional critical temperatures (exact curve-intersection corners).
   */
  const buildBandPolygon = (tMin, tMax, step, extraTs, topFn, botFn, pPa) => {
    const tSet = [tMin, tMax];
    for (let T = Math.ceil(tMin / step) * step; T < tMax; T += step) {
      if (T > tMin + 1e-6 && T < tMax - 1e-6) tSet.push(T);
    }
    if (extraTs) {
      for (let i = 0; i < extraTs.length; i++) {
        const te = extraTs[i];
        if (Number.isFinite(te) && te > tMin + 1e-4 && te < tMax - 1e-4) {
          tSet.push(te);
        }
      }
    }
    tSet.sort((a, b) => a - b);

    const grid = [];
    for (let i = 0; i < tSet.length; i++) {
      if (!grid.length || tSet[i] - grid[grid.length - 1] > 1e-4) {
        grid.push(tSet[i]);
      }
    }

    const topPts = [];
    const botPts = [];
    for (let i = 0; i < grid.length; i++) {
      const T = grid[i];
      const ws = wsatAt(T, pPa);
      const wTop = Math.max(0, Math.min(ws, topFn(T)));
      const wBot = Math.max(0, Math.min(wTop, botFn(T)));
      topPts.push([T, wTop]);
      botPts.push([T, wBot]);
    }
    botPts.reverse();
    return dedupPoly([...topPts, ...botPts]);
  };

  /* ---- 1. ISO 7730 / ASHRAE Standard 55 Fanger PMV & PPD ---- */
  function calcPMV(Tdb, rhPct, opts = {}) {
    const ta = Number(Tdb);
    const rh = Math.max(0, Math.min(100, Number(rhPct)));
    const pPa = opts.pPa ?? 101325;
    const mrt = opts.mrt ?? (opts.mrtOffset !== undefined ? ta + opts.mrtOffset : ta);
    const vAir = Math.max(0, opts.vAir ?? 0.1);
    const met = Math.max(0.1, opts.met ?? 1.1);
    const clo = Math.max(0, opts.clo ?? 0.5);
    const wme = opts.wme ?? 0;
    const pmvLimit = opts.pmvLimit ?? 0.5;

    // Partial water vapor pressure in Pa
    const pa = Math.min(pPa * 0.999, (rh / 100) * pwsPa(ta));

    // Clothing thermal insulation (m²·K/W), metabolic rate & external work (W/m²)
    const icl = 0.155 * clo;
    const m = met * 58.15;
    const w = wme * 58.15;
    const mw = m - w;

    // Clothing surface area factor fcl
    const fcl = icl <= 0.078 ? (1 + 1.29 * icl) : (1.05 + 0.645 * icl);

    // Forced convective heat transfer coefficient
    const hcf = 12.1 * Math.sqrt(vAir);

    // Absolute air & mean radiant temperatures (K)
    const taa = ta + 273.15;
    const tra = mrt + 273.15;

    // Iterative solution for clothing surface temperature tcl (ISO 7730 Annex D / ASHRAE 55 App. B)
    const tcla0 = taa + (35.5 - ta) / (3.5 * (6.45 * icl + 0.1));
    const p1 = icl * fcl;
    const p2 = p1 * 3.96;
    const p3 = p1 * 100;
    const p4 = p1 * taa;
    const p5 = (35.7 + 273.15) - 0.028 * mw + p2 * Math.pow(tra / 100, 4);

    let xn = tcla0 / 100;
    let xf = xn;
    let hc = hcf;
    const eps = 1e-7; // 1e-5 °C convergence in (K / 100) units

    for (let iter = 0; iter < 150; iter++) {
      xf = 0.5 * (xf + xn);
      const hcn = 2.38 * Math.pow(Math.abs(100 * xf - taa), 0.25);
      hc = hcf > hcn ? hcf : hcn;
      xn = (p5 + p4 * hc - p2 * Math.pow(xf, 4)) / (100 + p3 * hc);
      if (Math.abs(xn - xf) <= eps) break;
    }

    const tcl = 100 * xn - 273.15;
    const hcnFinal = 2.38 * Math.pow(Math.abs(tcl - ta), 0.25);
    hc = hcf > hcnFinal ? hcf : hcnFinal;

    // Six heat-loss terms per ISO 7730 Annex D / ASHRAE 55 Appendix B (W/m²)
    const hl1 = 3.05 * 0.001 * (5733 - 6.99 * mw - pa);
    const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
    const hl3 = 1.7 * 0.00001 * m * (5867 - pa);
    const hl4 = 0.0014 * m * (34 - ta);
    const hl5 = 3.96 * fcl * (Math.pow(xn, 4) - Math.pow(tra / 100, 4));
    const hl6 = fcl * hc * (tcl - ta);

    // Thermal sensation transfer coefficient & PMV / PPD
    const ts = 0.303 * Math.exp(-0.036 * m) + 0.028;
    const pmv = ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
    const pmv2 = pmv * pmv;
    const ppd = 100 - 95 * Math.exp(-0.03353 * pmv2 * pmv2 - 0.2179 * pmv2);

    let sensation;
    if (pmv < -2.5) sensation = 'Cold';
    else if (pmv < -1.5) sensation = 'Cool';
    else if (pmv < -0.5) sensation = 'Slightly Cool';
    else if (pmv <= 0.5) sensation = 'Neutral (Comfort)';
    else if (pmv <= 1.5) sensation = 'Slightly Warm';
    else if (pmv <= 2.5) sensation = 'Warm';
    else sensation = 'Hot';

    return {
      pmv,
      ppd,
      sensation,
      compliant: Math.abs(pmv) <= pmvLimit
    };
  }

  /* ---- 2. Dynamic ASHRAE Standard 55 Comfort Polygon ---- */
  function generateASHRAE55Polygon(pPa = 101325, opts = {}) {
    const clo = opts.clo ?? 0.5;
    const met = opts.met ?? 1.1;
    const vAir = opts.vAir ?? 0.1;
    const mrtOffset = opts.mrtOffset ?? 0;
    const pmvLimit = Math.max(0.05, opts.pmvLimit ?? 0.5);
    const wMax = opts.wMax ?? 0.012;
    const wMin = Math.max(0, opts.wMin ?? 0);
    const wme = opts.wme ?? 0;
    const steps = 12;

    const pmvAtTW = (T, w) => {
      const wEff = Math.min(w, wsatAt(T, pPa));
      const rhPct = rhFromTw(T, wEff, pPa) * 100;
      return calcPMV(T, rhPct, {
        mrt: T + mrtOffset,
        vAir,
        met,
        clo,
        wme,
        pPa,
        pmvLimit
      }).pmv;
    };

    const solveT = (w, targetPMV) => {
      let lo = 5;
      let hi = 40;
      if (pmvAtTW(lo, w) > targetPMV) lo = -15;
      if (pmvAtTW(hi, w) < targetPMV) hi = 55;
      if (pmvAtTW(lo, w) >= targetPMV) return lo;
      if (pmvAtTW(hi, w) <= targetPMV) return hi;

      for (let iter = 0; iter < 40; iter++) {
        const mid = 0.5 * (lo + hi);
        if (pmvAtTW(mid, w) < targetPMV) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    };

    const leftUp = [];
    const rightDown = [];

    for (let i = 0; i <= steps; i++) {
      const w = wMin + ((wMax - wMin) * i) / steps;
      const tL = solveT(w, -pmvLimit);
      const wL = Math.max(0, Math.min(w, wsatAt(tL, pPa)));
      leftUp.push([tL, wL]);
    }

    for (let i = steps; i >= 0; i--) {
      const w = wMin + ((wMax - wMin) * i) / steps;
      const tR = solveT(w, pmvLimit);
      const wR = Math.max(0, Math.min(w, wsatAt(tR, pPa)));
      rightDown.push([tR, wR]);
    }

    // If left upper corner hits saturation below wMax, trace the saturation arc to wMax
    const topArc = [];
    const lastL = leftUp[leftUp.length - 1];
    const firstR = rightDown[0];
    if (lastL && firstR && lastL[1] < wMax - 1e-5 && firstR[0] > lastL[0] + 1e-3) {
      const tdpMax = dewpointFromPv(pvFromW(wMax, pPa));
      const tArcEnd = Math.min(firstR[0], tdpMax);
      if (tArcEnd > lastL[0] + 1e-3) {
        const arcSteps = 6;
        for (let k = 1; k <= arcSteps; k++) {
          const T = lastL[0] + ((tArcEnd - lastL[0]) * k) / arcSteps;
          const w = Math.min(wMax, wsatAt(T, pPa));
          topArc.push([T, w]);
        }
      }
    }

    return dedupPoly([...leftUp, ...topArc, ...rightDown]);
  }

  /* ---- 3. Summer & Winter ASHRAE 55 Zones ---- */
  function getSummerWinterZones(pPa = 101325, comfortOpts = {}) {
    const cloSummer = comfortOpts.cloSummer ?? 0.5;
    const cloWinter = comfortOpts.cloWinter ?? 1.0;
    const shared = {
      met: comfortOpts.met ?? 1.1,
      vAir: comfortOpts.vAir ?? 0.1,
      mrtOffset: comfortOpts.mrtOffset ?? 0,
      pmvLimit: comfortOpts.pmvLimit ?? 0.5,
      wMax: comfortOpts.wMax ?? 0.012,
      wMin: comfortOpts.wMin ?? 0,
      wme: comfortOpts.wme ?? 0
    };

    const summerPoly = generateASHRAE55Polygon(pPa, { ...shared, clo: cloSummer });
    const winterPoly = generateASHRAE55Polygon(pPa, { ...shared, clo: cloWinter });

    return {
      summer: {
        id: 'summer',
        label: `Summer (${cloSummer.toFixed(1)} clo)`,
        poly: summerPoly,
        fill: 'rgba(16, 185, 129, 0.14)',
        stroke: 'rgba(16, 185, 129, 0.72)'
      },
      winter: {
        id: 'winter',
        label: `Winter (${cloWinter.toFixed(1)} clo)`,
        poly: winterPoly,
        fill: 'rgba(59, 130, 246, 0.12)',
        stroke: 'rgba(59, 130, 246, 0.70)'
      }
    };
  }

  /* ---- 4. Givoni Building Bioclimatic Chart Zones ---- */
  function getGivoniZones(pPa = 101325) {
    const tdp12 = dewpointFromPv(pvFromW(0.012, pPa));

    // Natural Ventilation: high airspeed cooling up to ~32°C, moderate RH (<=80% RH, <=16 g/kg, Twb<=23°C)
    const natVentPoly = buildBandPolygon(
      20, 32, 1.5, [25],
      (T) => Math.min(wFromRH(T, 80, pPa), 0.016, wFromTwb(T, 23.0, pPa)),
      () => 0.004,
      pPa
    );

    // High Thermal Mass: diurnal thermal flywheel 20..36°C, low-moderate humidity ratio
    const thermalMassPoly = buildBandPolygon(
      20, 36, 2.0, [31.5],
      (T) => Math.min(wFromRH(T, 80, pPa), 0.012, wFromTwb(T, 21.5, pPa)),
      () => 0.002,
      pPa
    );

    // Direct Evaporative Cooling: hot-arid corridor along Twb 11..21.5°C, T up to 42°C
    const directEvapPoly = buildBandPolygon(
      24, 42, 2.0, [30.5, 31.5],
      (T) => Math.min(0.012, wFromTwb(T, 21.5, pPa)),
      (T) => Math.max(0.0005, wFromTwb(T, 11.0, pPa)),
      pPa
    );

    // Indirect Evaporative Cooling: sensible evap extending to 44°C & higher Twb (23.5°C)
    const indirectEvapPoly = buildBandPolygon(
      26, 44, 2.0, [30.5, 33.8],
      (T) => Math.min(0.014, wFromTwb(T, 23.5, pPa)),
      (T) => Math.max(0.0005, wFromTwb(T, 11.0, pPa)),
      pPa
    );

    // Passive Solar Heating: cool/cold sunny 11..20°C
    const passiveSolarPoly = buildBandPolygon(
      11, 20, 1.0, [tdp12],
      (T) => Math.min(0.012, wsatAt(T, pPa)),
      () => 0,
      pPa
    );

    // Active Dehumidification: warm humid above W = 0.012, T 20..28°C
    const activeDehumPoly = buildBandPolygon(
      20, 28, 1.0, [],
      (T) => Math.min(0.024, wsatAt(T, pPa)),
      (T) => Math.min(0.012, wsatAt(T, pPa)),
      pPa
    );

    return [
      {
        id: 'indirect_evap',
        label: 'Indirect Evaporative Cooling',
        shortLabel: 'Indirect Evap',
        poly: indirectEvapPoly,
        fill: 'rgba(99, 102, 241, 0.09)',
        stroke: 'rgba(99, 102, 241, 0.58)'
      },
      {
        id: 'direct_evap',
        label: 'Direct Evaporative Cooling',
        shortLabel: 'Direct Evap',
        poly: directEvapPoly,
        fill: 'rgba(14, 165, 233, 0.11)',
        stroke: 'rgba(14, 165, 233, 0.65)'
      },
      {
        id: 'thermal_mass',
        label: 'High Thermal Mass',
        shortLabel: 'Thermal Mass',
        poly: thermalMassPoly,
        fill: 'rgba(245, 158, 11, 0.10)',
        stroke: 'rgba(245, 158, 11, 0.65)'
      },
      {
        id: 'nat_vent',
        label: 'Natural Ventilation',
        shortLabel: 'Nat. Vent',
        poly: natVentPoly,
        fill: 'rgba(6, 182, 212, 0.11)',
        stroke: 'rgba(6, 182, 212, 0.68)'
      },
      {
        id: 'passive_solar',
        label: 'Passive Solar Heating',
        shortLabel: 'Passive Solar',
        poly: passiveSolarPoly,
        fill: 'rgba(249, 115, 22, 0.11)',
        stroke: 'rgba(249, 115, 22, 0.68)'
      },
      {
        id: 'active_dehum',
        label: 'Active Dehumidification',
        shortLabel: 'Dehumidify',
        poly: activeDehumPoly,
        fill: 'rgba(236, 72, 153, 0.11)',
        stroke: 'rgba(236, 72, 153, 0.65)'
      }
    ];
  }

  /* ---- 5. ASHRAE TC 9.9 Data Center Thermal Guidelines ---- */
  const TC99_SPECS = [
    {
      id: 'tc99_a3',
      name: 'Class A3',
      label: 'ASHRAE TC 9.9 Class A3',
      tMin: 5, tMax: 40, dpMin: -12, dpMax: 24, rhMin: 8, rhMax: 85,
      fill: 'rgba(148, 163, 184, 0.06)',
      stroke: 'rgba(148, 163, 184, 0.48)'
    },
    {
      id: 'tc99_a2',
      name: 'Class A2',
      label: 'ASHRAE TC 9.9 Class A2',
      tMin: 10, tMax: 35, dpMin: -12, dpMax: 21, rhMin: 8, rhMax: 80,
      fill: 'rgba(168, 85, 247, 0.07)',
      stroke: 'rgba(168, 85, 247, 0.54)'
    },
    {
      id: 'tc99_a1',
      name: 'Class A1',
      label: 'ASHRAE TC 9.9 Class A1',
      tMin: 15, tMax: 32, dpMin: -12, dpMax: 17, rhMin: 8, rhMax: 80,
      fill: 'rgba(56, 189, 248, 0.09)',
      stroke: 'rgba(56, 189, 248, 0.64)'
    },
    {
      id: 'tc99_rec',
      name: 'Recommended',
      label: 'ASHRAE TC 9.9 Recommended',
      tMin: 18, tMax: 27, dpMin: -9, dpMax: 15, rhMin: 0, rhMax: 60,
      fill: 'rgba(16, 185, 129, 0.16)',
      stroke: 'rgba(16, 185, 129, 0.85)'
    }
  ];

  function getDataCenterZones(pPa = 101325) {
    return TC99_SPECS.map((spec) => {
      const wDpMax = wFromTdp(spec.dpMax, pPa);
      const wDpMin = wFromTdp(spec.dpMin, pPa);

      // Exact corner temperatures where constant-RH curves intersect constant-Tdp caps
      const extraTs = [];
      if (spec.rhMax > 0 && spec.rhMax < 100) {
        extraTs.push(dewpointFromPv(pwsPa(spec.dpMax) / (spec.rhMax / 100)));
      }
      if (spec.rhMin > 0) {
        extraTs.push(dewpointFromPv(pwsPa(spec.dpMin) / (spec.rhMin / 100)));
      }

      const poly = buildBandPolygon(
        spec.tMin,
        spec.tMax,
        1.0,
        extraTs,
        (T) => Math.min(wDpMax, wFromRH(T, spec.rhMax, pPa)),
        (T) => (spec.rhMin > 0 ? Math.max(wDpMin, wFromRH(T, spec.rhMin, pPa)) : wDpMin),
        pPa
      );

      return {
        id: spec.id,
        label: spec.label,
        poly,
        fill: spec.fill,
        stroke: spec.stroke
      };
    });
  }

  /* ---- 6. ASHRAE 160 Mold & Surface Condensation Risk ---- */
  function calcMoldCondensationRisk(Tdb, w, pPa = 101325, surfaceT = Tdb - 3) {
    const tAir = Number(Tdb);
    const wVal = Math.max(0, Number(w));
    const tSurf = (surfaceT === undefined || surfaceT === null || !Number.isFinite(Number(surfaceT)))
      ? (tAir - 3)
      : Number(surfaceT);

    const pv = pvFromW(wVal, pPa);
    const Tdp = dewpointFromPv(pv);
    const marginC = tAir - Tdp;

    const pwsSurf = pwsPa(tSurf);
    const rawSurfRH = pwsSurf > 0 ? (pv / pwsSurf) * 100 : 100;
    const surfaceRH = Math.max(0, Math.min(100, rawSurfRH));
    const condensation = tSurf <= Tdp;

    let riskLevel;
    let label;
    if (condensation) {
      riskLevel = 'condensation';
      label = 'Condensation Risk (Surface ≤ Tdp)';
    } else if (surfaceRH >= 80) {
      riskLevel = 'high';
      label = 'High Mold Risk (ASHRAE 160: Surface RH ≥ 80%)';
    } else if (surfaceRH >= 70) {
      riskLevel = 'moderate';
      label = 'Moderate Risk (Surface RH 70–80%)';
    } else {
      riskLevel = 'none';
      label = 'Low / No Risk';
    }

    return {
      Tdp,
      marginC,
      surfaceRH,
      condensation,
      riskLevel,
      label
    };
  }

  /* ---- 7. Combined Point Comfort, Data Center & Building Science Evaluation ---- */
  function evaluatePointZones(T, w, pPa = 101325, comfortOpts = {}) {
    const tVal = Number(T);
    const wVal = Math.max(0, Number(w));
    const rhPct = rhFromTw(tVal, wVal, pPa) * 100;

    const met = comfortOpts.met ?? 1.1;
    const vAir = comfortOpts.vAir ?? 0.1;
    const mrtOffset = comfortOpts.mrtOffset ?? 0;
    const pmvLimit = comfortOpts.pmvLimit ?? 0.5;
    const wMax = comfortOpts.wMax ?? 0.012;
    const wMin = Math.max(0, comfortOpts.wMin ?? 0);
    const cloSummer = comfortOpts.cloSummer ?? 0.5;
    const cloWinter = comfortOpts.cloWinter ?? 1.0;
    const wme = comfortOpts.wme ?? 0;
    const mrt = comfortOpts.mrt ?? (tVal + mrtOffset);

    const summer = calcPMV(tVal, rhPct, { mrt, vAir, met, clo: cloSummer, wme, pPa, pmvLimit });
    const winter = calcPMV(tVal, rhPct, { mrt, vAir, met, clo: cloWinter, wme, pPa, pmvLimit });

    const inHumidityBand = wVal >= wMin - 1e-6 && wVal <= wMax + 1e-6;
    const inSummerComfort = summer.compliant && inHumidityBand;
    const inWinterComfort = winter.compliant && inHumidityBand;

    const mold = calcMoldCondensationRisk(tVal, wVal, pPa, comfortOpts.surfaceT);
    const Tdp = mold.Tdp;

    // Match tightest ASHRAE TC 9.9 class (Recommended -> A1 -> A2 -> A3)
    const eps = 1e-6;
    let dataCenterClass = null;
    for (let i = TC99_SPECS.length - 1; i >= 0; i--) {
      const s = TC99_SPECS[i];
      if (
        tVal >= s.tMin - eps && tVal <= s.tMax + eps &&
        Tdp >= s.dpMin - eps && Tdp <= s.dpMax + eps &&
        rhPct >= s.rhMin - eps && rhPct <= s.rhMax + eps
      ) {
        dataCenterClass = s.name;
        break;
      }
    }

    return {
      summer,
      winter,
      dataCenterClass,
      mold,
      inSummerComfort,
      inWinterComfort
    };
  }

  return {
    calcPMV,
    generateASHRAE55Polygon,
    getSummerWinterZones,
    getGivoniZones,
    getDataCenterZones,
    calcMoldCondensationRisk,
    evaluatePointZones
  };
})();
