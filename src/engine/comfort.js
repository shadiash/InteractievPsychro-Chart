/* ============================================================================
   PsychroChart Ultra 3.0 — Thermal Comfort, Bioclimatic & Building Science Engine
   - ISO 7730:2005/2025 Fanger PMV/PPD & ANSI/ASHRAE Standard 55-2020/2023
     (Relative Air Speed v_r, Dynamic Clothing I_cl,r, & Gagge 2-Node SET / CE)
   - Dynamic Altitude- & Parameter-Adaptive ASHRAE 55 / ISO 7730 Comfort Polygons
   - Givoni (1992) Building Bioclimatic Chart (Pressure-Invariant Vapor Pressure)
   - ASHRAE TC 9.9 (2021 5th Ed.) Data Center Envelopes (Rec, A1–A4 + >900 m Derating)
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

  const invAltM = (pPa) => {
    if (typeof Psy.invBaroAlt_m === 'function') return Psy.invBaroAlt_m(pPa);
    if (!Number.isFinite(pPa) || pPa <= 0) return 0;
    return 44330.769 * (1 - Math.pow(Math.min(1.2, pPa / 101325), 1 / 5.25588));
  };

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

  /**
   * Format clothing insulation cleanly preserving 0.05-clo steps (e.g. 0.5, 0.55, 1.0, 1.05).
   */
  const fmtClo = (clo) => {
    const rounded = Math.round(Number(clo) * 100) / 100;
    return Math.abs(rounded * 10 - Math.round(rounded * 10)) < 1e-6
      ? rounded.toFixed(1)
      : rounded.toFixed(2);
  };

  /**
   * Find exact root T in [tMin, tMax] where fnA(T) === fnB(T) via bisection if they cross.
   */
  const findCurveCrossT = (fnA, fnB, tMin, tMax) => {
    let lo = tMin;
    let hi = tMax;
    let fLo = fnA(lo) - fnB(lo);
    let fHi = fnA(hi) - fnB(hi);
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
    if (Math.abs(fLo) < 1e-9) return lo;
    if (Math.abs(fHi) < 1e-9) return hi;
    if (fLo * fHi > 0) return null;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      const fMid = fnA(mid) - fnB(mid);
      if (fLo * fMid <= 0) {
        hi = mid;
        fHi = fMid;
      } else {
        lo = mid;
        fLo = fMid;
      }
      if (hi - lo < 1e-5) break;
    }
    return 0.5 * (lo + hi);
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
   * Standard ray-casting point-in-polygon check on [T, w] vertex arrays.
   */
  function pointInPolygon(T, w, poly) {
    if (!Array.isArray(poly) || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0];
      const yi = poly[i][1];
      const xj = poly[j][0];
      const yj = poly[j][1];
      const intersect = ((yi > w) !== (yj > w)) &&
        (T < ((xj - xi) * (w - yi)) / ((yj - yi) || 1e-15) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

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

  /* ---- 1. ASHRAE 55-2020/2023 Normative Helpers & Gagge 2-Node SET ---- */

  /**
   * Relative air speed per ANSI/ASHRAE Standard 55-2020/2023 §5.3.2:
   * vr = va + 0.3 * (met - 1.0) for met > 1.0.
   */
  function calcRelativeAirSpeed(vAir, met = 1.1) {
    const v = Math.max(0, Number(vAir) || 0);
    const m = Math.max(0.1, Number(met) || 1.1);
    return m > 1.0 ? v + 0.3 * (m - 1.0) : v;
  }

  /**
   * Dynamic clothing insulation per ANSI/ASHRAE Standard 55-2020/2023 §5.2.2.2:
   * Icl,r = Icl * (0.6 + 0.4 / met) for met > 1.2.
   */
  function calcDynamicClo(clo, met = 1.1) {
    const c = Math.max(0, Number(clo) || 0);
    const m = Math.max(0.1, Number(met) || 1.1);
    return m > 1.2 ? c * (0.6 + 0.4 / m) : c;
  }

  /**
   * Gagge 2-Node Standard Effective Temperature (SET, °C) per ANSI/ASHRAE
   * Standard 55-2020/2023 Normative Appendix D (60-minute physiological integration).
   */
  function calcSET(Tdb, rhPct, opts = {}) {
    const ta = Number(Tdb);
    const rh = Math.max(0, Math.min(100, Number(rhPct)));
    const pPa = opts.pPa ?? 101325;
    const tr = opts.mrt ?? (opts.mrtOffset !== undefined ? ta + opts.mrtOffset : ta);
    const vel = Math.max(0.1, Number(opts.vAir ?? 0.1));
    const met = Math.max(0.5, Number(opts.met ?? 1.1));
    const clo = Math.max(0, Number(opts.clo ?? 0.5));
    const wme = Number(opts.wme ?? 0);

    const kClo = 0.25;
    const bodyWeight = 69.9;
    const bodySurfaceArea = 1.8258;
    const metFactor = 58.2;
    const sbc = 5.6697e-8;
    const csw = 170.0;
    const cdil = 120.0;
    const cstr = 0.5;
    const radFrac = 0.73; // Standing posture per ASHRAE 55 Appendix D Table D-1
    const ltime = 60;

    const pAtm = Math.max(0.3, pPa / 101325);
    const vaporPressure = (rh / 100) * (pwsPa(ta) / 133.3223684); // torr (mmHg)

    let tSkin = 33.7;
    let tCore = 36.8;
    let sbf = 6.3;
    let alfa = 0.1;
    let esk = 0.1 * met;

    const rCl = 0.155 * clo;
    const fAcl = 1.0 + 0.15 * clo;
    const lr = 2.2 / pAtm;
    const rm = met * metFactor;
    let m = rm;
    const w = wme * metFactor;
    const wCrit = clo <= 0
      ? 0.38 * Math.pow(vel, -0.29)
      : 0.59 * Math.pow(vel, -0.08);
    const iCl = clo <= 0 ? 1.0 : 0.45;

    let chc = 3.0 * Math.pow(pAtm, 0.53);
    const chcV = 8.600001 * Math.pow(vel * pAtm, 0.53);
    if (chcV > chc) chc = chcV;
    if (met > 0.85) {
      const chcM = 5.66 * Math.pow(met - 0.85, 0.39) * Math.pow(pAtm, 0.53);
      if (chcM > chc) chc = chcM;
    }

    let chr = 4.7;
    let ctc = chr + chc;
    let ra = 1.0 / (fAcl * ctc);
    let top = (chr * tr + chc * ta) / ctc;
    let tcl = top + (tSkin - top) / (ctc * (ra + rCl));
    let tclOld = tcl;
    let flag = true;
    let dry = 0;
    let pwet = 0.06;
    let emax = 0;

    for (let tim = 1; tim <= ltime; tim++) {
      let it = 0;
      do {
        if (flag) {
          tclOld = tcl;
          const tMeanK = (tcl + tr) * 0.5 + 273.15;
          chr = 4.0 * 0.95 * sbc * (tMeanK * tMeanK * tMeanK) * radFrac;
          ctc = chr + chc;
          ra = 1.0 / (fAcl * ctc);
          top = (chr * tr + chc * ta) / ctc;
        }
        tcl = (ra * tSkin + rCl * top) / (ra + rCl);
        flag = true;
      } while (Math.abs(tcl - tclOld) > 0.01 && ++it < 60);
      flag = false;

      dry = (tSkin - top) / (ra + rCl);
      const hfcs = (tCore - tSkin) * (5.28 + 1.163 * sbf);
      const eres = 0.0023 * m * (44.0 - vaporPressure);
      const cres = 0.0014 * m * (34.0 - ta);
      const scr = m - hfcs - eres - cres - w;
      const ssk = hfcs - dry - esk;

      tSkin += (ssk * bodySurfaceArea) / (0.97 * alfa * bodyWeight * 60.0);
      tCore += (scr * bodySurfaceArea) / (0.97 * (1.0 - alfa) * bodyWeight * 60.0);
      const tBody = alfa * tSkin + (1.0 - alfa) * tCore;

      const skSig = tSkin - 33.7;
      const warmS = skSig > 0 ? skSig : 0;
      const coldS = skSig < 0 ? -skSig : 0;
      const cSig = tCore - 36.8;
      const warmC = cSig > 0 ? cSig : 0;
      const coldC = cSig < 0 ? -cSig : 0;
      const bdSig = tBody - 36.49;
      const warmB = bdSig > 0 ? bdSig : 0;

      sbf = (6.3 + cdil * warmC) / (1.0 + cstr * coldS);
      if (sbf > 90.0) sbf = 90.0;
      if (sbf < 0.5) sbf = 0.5;

      const regSw = Math.min(500.0, csw * warmB * Math.exp(warmS / 10.7));
      const ersw = 0.68 * regSw;
      const rea = 1.0 / (lr * fAcl * chc);
      const recl = rCl / (lr * iCl);
      emax = (pwsPa(tSkin) / 133.3223684 - vaporPressure) / (rea + recl);

      const prsw = emax > 1e-9 ? ersw / emax : 0;
      pwet = 0.06 + 0.94 * prsw;
      const edif = pwet * emax - ersw;
      if (pwet > wCrit) {
        pwet = wCrit;
        esk = wCrit * emax;
      } else {
        esk = ersw + edif;
      }
      if (emax < 0) {
        pwet = wCrit;
        esk = emax;
      }

      m = rm + 19.4 * coldS * coldC;
      alfa = 0.0417737 + 0.7451833 / (sbf + 0.585417);
    }

    const hsk = dry + esk;
    const chcS = met > 0.85 ? Math.max(3.0, 5.66 * Math.pow(met - 0.85, 0.39)) : 3.0;
    const ctcS = chr + chcS;
    const rCloS = Math.max(0.01, 1.52 / ((met - wme) + 0.6944) - 0.1835);
    const rClS = 0.155 * rCloS;
    const fAclS = 1.0 + kClo * rCloS;
    const fClS = 1.0 / (1.0 + 0.155 * fAclS * ctcS * rCloS);
    const imS = 0.45;
    const iClS = (imS * (chcS / ctcS) * (1.0 - fClS)) / Math.max(1e-6, (chcS / ctcS) - fClS * imS);
    const hd = 1.0 / (1.0 / (fAclS * ctcS) + rClS);
    const he = 1.0 / (1.0 / (lr * fAclS * chcS) + rClS / (lr * iClS));

    const pTorr = (T) => pwsPa(T) / 133.3223684;
    const pSkinTorr = pTorr(tSkin);
    const errFn = (tSet) => hsk - hd * (tSkin - tSet) - pwet * he * (pSkinTorr - 0.5 * pTorr(tSet));

    let x = tSkin - hsk / hd;
    for (let i = 0; i < 40; i++) {
      const f0 = errFn(x);
      const f1 = errFn(x + 1e-4);
      const deriv = (f1 - f0) / 1e-4;
      if (!Number.isFinite(deriv) || Math.abs(deriv) < 1e-9) break;
      const dx = f0 / deriv;
      x -= dx;
      if (Math.abs(dx) < 1e-3) break;
    }
    return x;
  }

  /**
   * Elevated Air Speed Cooling Effect (CE, °C) per ASHRAE 55-2020/2023 §5.3.3 / Appendix D.
   * Finds CE >= 0 such that SET(ta - CE, tr - CE, 0.1, rh, met, cloEff) === SET(ta, tr, vr, rh, met, cloEff).
   * Uses bracket-safeguarded secant iteration (converges to <0.001°C in 2-3 evaluations).
   */
  function calcCoolingEffect(Tdb, rhPct, opts = {}) {
    const ta = Number(Tdb);
    const rh = Math.max(0, Math.min(100, Number(rhPct)));
    const pPa = opts.pPa ?? 101325;
    const tr = opts.mrt ?? (opts.mrtOffset !== undefined ? ta + opts.mrtOffset : ta);
    const vAir = Math.max(0, Number(opts.vAir ?? 0.1));
    const met = Math.max(0.5, Number(opts.met ?? 1.1));
    const clo = Math.max(0, Number(opts.clo ?? 0.5));
    const wme = Number(opts.wme ?? 0);

    const vr = opts.vr !== undefined ? opts.vr : calcRelativeAirSpeed(vAir, met);
    const cloEff = opts.cloEff !== undefined ? opts.cloEff : calcDynamicClo(clo, met);
    const stillV = 0.1;

    const setActual = calcSET(ta, rh, { mrt: tr, vAir: vr, met, clo: cloEff, wme, pPa });
    if (vAir <= stillV + 1e-9 || vr <= stillV + 1e-9) {
      return { ce: 0, set: setActual };
    }

    const setStill0 = calcSET(ta, rh, { mrt: tr, vAir: stillV, met, clo: cloEff, wme, pPa });
    const f0Init = setStill0 - setActual;
    if (f0Init <= 1e-4) {
      return { ce: 0, set: setActual };
    }

    const evalG = (ce) => calcSET(ta - ce, rh, { mrt: tr - ce, vAir: stillV, met, clo: cloEff, wme, pPa }) - setActual;

    let lo = 0;
    let hi = Infinity;
    let x0 = 0;
    let f0 = f0Init;
    let x1 = Math.max(0.05, Math.min(20, f0Init));
    let f1 = evalG(x1);
    if (f1 > 0) lo = x1;
    else hi = x1;

    for (let i = 0; i < 14; i++) {
      if (Math.abs(f1) <= 0.001) return { ce: x1, set: setActual };
      let xNext;
      const denom = f1 - f0;
      if (Math.abs(denom) > 1e-9) {
        xNext = x1 - (f1 * (x1 - x0)) / denom;
      } else {
        xNext = hi < Infinity ? 0.5 * (lo + hi) : Math.min(25, x1 + Math.max(0.5, f1));
      }
      if (!Number.isFinite(xNext) || xNext <= lo + 1e-6 || (hi < Infinity && xNext >= hi - 1e-6)) {
        xNext = hi < Infinity ? 0.5 * (lo + hi) : Math.min(25, Math.max(x1 + 0.5, x1 + f1 * 1.2));
      }
      xNext = Math.max(0, Math.min(25, xNext));
      if (Math.abs(xNext - x1) < 0.001) return { ce: xNext, set: setActual };

      const fNext = evalG(xNext);
      if (fNext > 0) {
        if (xNext > lo) lo = xNext;
      } else if (xNext < hi) {
        hi = xNext;
      }
      x0 = x1;
      f0 = f1;
      x1 = xNext;
      f1 = fNext;
      if (hi < Infinity && hi - lo < 0.0015) return { ce: 0.5 * (lo + hi), set: setActual };
    }
    return { ce: hi < Infinity ? 0.5 * (lo + hi) : x1, set: setActual };
  }

  /**
   * Core Fanger heat-balance equation (ISO 7730:2005/2025 Annex D & ASHRAE 55 Appendix B).
   */
  function rawFangerPMV(ta, tr, vel, rh, met, clo, wme, pPa) {
    const pa = Math.min(pPa * 0.999, (rh / 100) * pwsPa(ta));
    const icl = 0.155 * clo;
    const m = met * 58.15;
    const w = wme * 58.15;
    const mw = m - w;

    const fcl = icl <= 0.078 ? (1 + 1.29 * icl) : (1.05 + 0.645 * icl);
    const hcf = 12.1 * Math.sqrt(Math.max(0, vel));
    const taa = ta + 273.15;
    const tra = tr + 273.15;

    const tcla0 = taa + (35.5 - ta) / (3.5 * (6.45 * icl + 0.1));
    const p1 = icl * fcl;
    const p2 = p1 * 3.96;
    const p3 = p1 * 100;
    const p4 = p1 * taa;
    const p5 = (35.7 + 273.15) - 0.028 * mw + p2 * Math.pow(tra / 100, 4);

    let xn = tcla0 / 100;
    let xf = xn;
    let hc = hcf;
    const eps = 1e-7;

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

    const hl1 = 3.05 * 0.001 * (5733 - 6.99 * mw - pa);
    const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
    const hl3 = 1.7 * 0.00001 * m * (5867 - pa);
    const hl4 = 0.0014 * m * (34 - ta);
    const hl5 = 3.96 * fcl * (Math.pow(xn, 4) - Math.pow(tra / 100, 4));
    const hl6 = fcl * hc * (tcl - ta);

    const ts = 0.303 * Math.exp(-0.036 * m) + 0.028;
    const pmv = ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
    const pmv2 = pmv * pmv;
    const ppd = 100 - 95 * Math.exp(-0.03353 * pmv2 * pmv2 - 0.2179 * pmv2);
    return { pmv, ppd };
  }

  function pmvSensationLabel(pmv, pmvLimit = 0.5) {
    if (pmv < -2.5) return 'Cold';
    if (pmv < -1.5) return 'Cool';
    if (pmv < -0.5) return 'Slightly Cool';
    if (pmv <= 0.5) {
      return Math.abs(pmv) <= pmvLimit ? 'Neutral (Comfort)' : 'Neutral';
    }
    if (pmv <= 1.5) return 'Slightly Warm';
    if (pmv <= 2.5) return 'Warm';
    return 'Hot';
  }

  /* ---- 2. ISO 7730 / ASHRAE Standard 55-2023 Analytical PMV & PPD ---- */
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
    // Direct calcPMV defaults to ISO 7730:2005 (raw v_ar/clo); pass standard:'ashrae55' for ASHRAE 55-2023
    const standard = opts.standard === 'ashrae55' ? 'ashrae55' : 'iso7730';

    let vr = vAir;
    let cloEff = clo;
    let ce = 0;
    let set = null;
    let elevatedAirSpeed = false;
    let core;

    if (standard === 'ashrae55') {
      vr = calcRelativeAirSpeed(vAir, met);
      cloEff = calcDynamicClo(clo, met);
      if (vAir > 0.1 + 1e-9 && vr > 0.1 + 1e-9) {
        elevatedAirSpeed = true;
        const ceRes = calcCoolingEffect(ta, rh, { mrt, vAir, vr, met, clo, cloEff, wme, pPa });
        ce = ceRes.ce;
        set = ceRes.set;
        core = rawFangerPMV(ta - ce, mrt - ce, 0.1, rh, met, cloEff, wme, pPa);
      } else {
        core = rawFangerPMV(ta, mrt, vr, rh, met, cloEff, wme, pPa);
        if (opts.includeSET) {
          set = calcSET(ta, rh, { mrt, vAir: Math.max(0.1, vr), met, clo: cloEff, wme, pPa });
        }
      }
    } else {
      core = rawFangerPMV(ta, mrt, vAir, rh, met, clo, wme, pPa);
      if (opts.includeSET) {
        set = calcSET(ta, rh, { mrt, vAir: Math.max(0.1, vAir), met, clo, wme, pPa });
      }
    }

    const pmv = core.pmv;
    const ppd = core.ppd;
    const sensation = pmvSensationLabel(pmv, pmvLimit);

    return {
      pmv,
      ppd,
      sensation,
      compliant: Math.abs(pmv) <= pmvLimit,
      vr,
      cloEff,
      ce,
      set,
      standard,
      elevatedAirSpeed
    };
  }

  /* ---- 3. Dynamic ASHRAE Standard 55 / ISO 7730 Comfort Polygon ---- */
  function resolveComfortWMax(opts = {}) {
    if (opts.wMax !== undefined && opts.wMax !== null && Number.isFinite(Number(opts.wMax))) {
      return Math.max(0.002, Number(opts.wMax));
    }
    return opts.capHumidity === false ? 0.030 : 0.012;
  }

  function generateASHRAE55Polygon(pPa = 101325, opts = {}) {
    const clo = opts.clo ?? 0.5;
    const met = opts.met ?? 1.1;
    const vAir = opts.vAir ?? 0.1;
    const mrtOffset = opts.mrtOffset ?? 0;
    const pmvLimit = Math.max(0.05, opts.pmvLimit ?? 0.5);
    const wMax = resolveComfortWMax(opts);
    const wMin = Math.max(0, opts.wMin ?? 0);
    const wme = opts.wme ?? 0;
    const standard = opts.standard ?? 'ashrae55';
    const isElevated = standard === 'ashrae55' && vAir > 0.1 + 1e-9;
    const steps = isElevated ? 6 : 12;
    const vrEff = standard === 'ashrae55' ? calcRelativeAirSpeed(vAir, met) : vAir;
    const cloEff = standard === 'ashrae55' ? calcDynamicClo(clo, met) : clo;

    const pmvStillAtTW = (T, w) => {
      const wEff = Math.min(w, wsatAt(T, pPa));
      const rhPct = rhFromTw(T, wEff, pPa) * 100;
      return rawFangerPMV(T, T + mrtOffset, isElevated ? 0.1 : vrEff, rhPct, met, cloEff, wme, pPa).pmv;
    };

    const pmvAtTW = (T, w) => {
      if (!isElevated) return pmvStillAtTW(T, w);
      const wEff = Math.min(w, wsatAt(T, pPa));
      const rhPct = rhFromTw(T, wEff, pPa) * 100;
      const ce = calcCoolingEffect(T, rhPct, {
        mrt: T + mrtOffset,
        vAir,
        vr: vrEff,
        met,
        clo,
        cloEff,
        wme,
        pPa
      }).ce;
      return rawFangerPMV(T - ce, T + mrtOffset - ce, 0.1, rhPct, met, cloEff, wme, pPa).pmv;
    };

    const solveStillT = (w, targetPMV, guess = null) => {
      let lo = guess !== null ? Math.max(-60, guess - 4) : 5;
      let hi = guess !== null ? Math.min(80, guess + 4) : 40;
      while (pmvStillAtTW(lo, w) > targetPMV && lo > -60) {
        hi = lo;
        lo = Math.max(-60, lo - 15);
      }
      while (pmvStillAtTW(hi, w) < targetPMV && hi < 80) {
        lo = hi;
        hi = Math.min(80, hi + 15);
      }
      if (pmvStillAtTW(lo, w) >= targetPMV) return lo;
      if (pmvStillAtTW(hi, w) <= targetPMV) return hi;
      for (let iter = 0; iter < 36; iter++) {
        const mid = 0.5 * (lo + hi);
        if (pmvStillAtTW(mid, w) < targetPMV) lo = mid;
        else hi = mid;
        if (hi - lo <= 1e-4) break;
      }
      return 0.5 * (lo + hi);
    };

    const solveT = (w, targetPMV, guess = null) => {
      if (!isElevated) return solveStillT(w, targetPMV, guess);

      // Safeguarded secant solver for elevated air speed (converges in ~2 evaluations per vertex)
      let x0;
      if (guess !== null && Number.isFinite(guess)) {
        x0 = Math.max(-60, Math.min(80, guess));
      } else {
        const tStill = solveStillT(w, targetPMV, null);
        const rhGuess = rhFromTw(tStill, Math.min(w, wsatAt(tStill, pPa)), pPa) * 100;
        const ceGuess = calcCoolingEffect(tStill, rhGuess, {
          mrt: tStill + mrtOffset, vAir, vr: vrEff, met, clo, cloEff, wme, pPa
        }).ce;
        x0 = Math.max(-60, Math.min(80, tStill + ceGuess));
      }

      let f0 = pmvAtTW(x0, w) - targetPMV;
      if (Math.abs(f0) <= 0.002) return x0;

      let lo = f0 < 0 ? x0 : -60;
      let hi = f0 > 0 ? x0 : 80;
      let x1 = Math.max(-60, Math.min(80, x0 - f0 / 0.28));
      if (Math.abs(x1 - x0) < 0.05) x1 = Math.max(-60, Math.min(80, x0 + (f0 < 0 ? 0.5 : -0.5)));
      let f1 = pmvAtTW(x1, w) - targetPMV;
      if (f1 < 0 && x1 > lo) lo = x1;
      if (f1 > 0 && x1 < hi) hi = x1;

      for (let iter = 0; iter < 12; iter++) {
        if (Math.abs(f1) <= 0.002 || hi - lo <= 0.005) return x1;
        let xNext;
        const denom = f1 - f0;
        if (Math.abs(denom) > 1e-6) {
          xNext = x1 - (f1 * (x1 - x0)) / denom;
        } else {
          xNext = 0.5 * (lo + hi);
        }
        if (!Number.isFinite(xNext) || xNext <= lo + 1e-4 || xNext >= hi - 1e-4) {
          xNext = (lo > -59 && hi < 79) ? 0.5 * (lo + hi) : Math.max(-60, Math.min(80, x1 - f1 / 0.28));
        }
        xNext = Math.max(-60, Math.min(80, xNext));
        if (Math.abs(xNext - x1) <= 0.004) return xNext;

        const fNext = pmvAtTW(xNext, w) - targetPMV;
        if (fNext < 0 && xNext > lo) lo = xNext;
        if (fNext > 0 && xNext < hi) hi = xNext;
        x0 = x1;
        f0 = f1;
        x1 = xNext;
        f1 = fNext;
      }
      return x1;
    };

    const leftUp = [];
    const rightDown = [];
    let lastTL = null;
    let prevTL = null;
    let lastTR = null;
    let prevTR = null;

    for (let i = 0; i <= steps; i++) {
      const w = wMin + ((wMax - wMin) * i) / steps;
      const guessL = lastTL !== null
        ? (prevTL !== null ? lastTL + (lastTL - prevTL) : lastTL)
        : null;
      const tL = solveT(w, -pmvLimit, guessL);
      prevTL = lastTL;
      lastTL = tL;
      const wL = Math.max(0, Math.min(w, wsatAt(tL, pPa)));
      leftUp.push([tL, wL]);
    }

    for (let i = steps; i >= 0; i--) {
      const w = wMin + ((wMax - wMin) * i) / steps;
      const guessR = lastTR !== null
        ? (prevTR !== null ? lastTR + (lastTR - prevTR) : lastTR)
        : null;
      const tR = solveT(w, pmvLimit, guessR);
      prevTR = lastTR;
      lastTR = tR;
      const wR = Math.max(0, Math.min(w, wsatAt(tR, pPa)));
      rightDown.push([tR, wR]);
    }

    // If left upper corner hits saturation below wMax, trace saturation arc cleanly to wMax (<= 0.5°C chord)
    const topArc = [];
    const lastL = leftUp[leftUp.length - 1];
    const firstR = rightDown[0];
    if (lastL && firstR && lastL[1] < wMax - 1e-5 && firstR[0] > lastL[0] + 1e-3) {
      const tdpMax = dewpointFromPv(pvFromW(wMax, pPa));
      const tArcEnd = Math.min(firstR[0], tdpMax);
      if (tArcEnd > lastL[0] + 1e-3) {
        const arcSteps = Math.max(8, Math.ceil((tArcEnd - lastL[0]) / 0.5));
        for (let k = 1; k <= arcSteps; k++) {
          const T = lastL[0] + ((tArcEnd - lastL[0]) * k) / arcSteps;
          const w = Math.min(wMax, wsatAt(T, pPa));
          topArc.push([T, w]);
        }
      }
    }

    return dedupPoly([...leftUp, ...topArc, ...rightDown]);
  }

  /* ---- 4. Summer & Winter ASHRAE 55 / ISO 7730 Zones ---- */
  function getSummerWinterZones(pPa = 101325, comfortOpts = {}) {
    const cloSummer = comfortOpts.cloSummer ?? 0.5;
    const cloWinter = comfortOpts.cloWinter ?? 1.0;
    const wMax = resolveComfortWMax(comfortOpts);
    const shared = {
      met: comfortOpts.met ?? 1.1,
      vAir: comfortOpts.vAir ?? 0.1,
      mrtOffset: comfortOpts.mrtOffset ?? 0,
      pmvLimit: comfortOpts.pmvLimit ?? 0.5,
      wMax,
      capHumidity: comfortOpts.capHumidity !== false,
      wMin: comfortOpts.wMin ?? 0,
      wme: comfortOpts.wme ?? 0,
      standard: comfortOpts.standard ?? 'ashrae55'
    };

    const summerPoly = generateASHRAE55Polygon(pPa, { ...shared, clo: cloSummer });
    const winterPoly = generateASHRAE55Polygon(pPa, { ...shared, clo: cloWinter });

    return {
      summer: {
        id: 'summer',
        label: `Summer (${fmtClo(cloSummer)} clo)`,
        poly: summerPoly,
        fill: 'rgba(16, 185, 129, 0.14)',
        stroke: 'rgba(16, 185, 129, 0.72)'
      },
      winter: {
        id: 'winter',
        label: `Winter (${fmtClo(cloWinter)} clo)`,
        poly: winterPoly,
        fill: 'rgba(59, 130, 246, 0.12)',
        stroke: 'rgba(59, 130, 246, 0.70)'
      }
    };
  }

  /* ---- 5. Givoni (1992) Building Bioclimatic Chart Zones (Pressure-Invariant Pv) ---- */
  // Reference sea-level vapor partial pressures matching Givoni (1992) mmHg/kPa limits:
  // 12 g/kg SL = 1918 Pa (~14.4 mmHg), 16 g/kg SL = 2541 Pa (~19.1 mmHg),
  // 14 g/kg SL = 2231 Pa (~16.7 mmHg), 4 g/kg SL = 647 Pa, 2 g/kg SL = 325 Pa, 0.5 g/kg SL = 81 Pa.
  const GIVONI_PV_12 = pvFromW(0.012, 101325);
  const GIVONI_PV_14 = pvFromW(0.014, 101325);
  const GIVONI_PV_16 = pvFromW(0.016, 101325);
  const GIVONI_PV_04 = pvFromW(0.004, 101325);
  const GIVONI_PV_02 = pvFromW(0.002, 101325);
  const GIVONI_PV_005 = pvFromW(0.0005, 101325);

  function buildGivoniZoneSpecs(pPa = 101325) {
    const w12 = wFromPv(GIVONI_PV_12, pPa);
    const w14 = wFromPv(GIVONI_PV_14, pPa);
    const w16 = wFromPv(GIVONI_PV_16, pPa);
    const w04 = wFromPv(GIVONI_PV_04, pPa);
    const w02 = wFromPv(GIVONI_PV_02, pPa);
    const w005 = wFromPv(GIVONI_PV_005, pPa);
    const wDehumCap = 0.030;

    return [
      {
        id: 'indirect_evap',
        label: 'Indirect Evaporative Cooling',
        shortLabel: 'Indirect Evap',
        tMin: 26,
        tMax: 44,
        fill: 'rgba(99, 102, 241, 0.09)',
        stroke: 'rgba(99, 102, 241, 0.58)',
        // IEC cools sensibly at constant W: valid down to arid floor (no Twb >= 11°C floor)
        topFn: (T) => Math.min(w14, wFromTwb(T, 23.5, pPa)),
        botFn: () => w005,
        extraTs: [
          findCurveCrossT(() => w14, (T) => wFromTwb(T, 23.5, pPa), 26, 44)
        ]
      },
      {
        id: 'direct_evap',
        label: 'Direct Evaporative Cooling',
        shortLabel: 'Direct Evap',
        tMin: 24,
        tMax: 42,
        fill: 'rgba(14, 165, 233, 0.11)',
        stroke: 'rgba(14, 165, 233, 0.65)',
        // DEC follows wet-bulb corridor Twb 11..21.5°C up to pv12 cap
        topFn: (T) => Math.min(w12, wFromTwb(T, 21.5, pPa)),
        botFn: (T) => Math.max(w005, wFromTwb(T, 11.0, pPa)),
        extraTs: [
          findCurveCrossT(() => w12, (T) => wFromTwb(T, 21.5, pPa), 24, 42),
          findCurveCrossT(() => w005, (T) => wFromTwb(T, 11.0, pPa), 24, 42)
        ]
      },
      {
        id: 'thermal_mass',
        label: 'High Thermal Mass',
        shortLabel: 'Thermal Mass',
        tMin: 20,
        tMax: 36,
        fill: 'rgba(245, 158, 11, 0.10)',
        stroke: 'rgba(245, 158, 11, 0.65)',
        topFn: (T) => Math.min(wFromRH(T, 80, pPa), w12, wFromTwb(T, 21.5, pPa)),
        botFn: () => w02,
        extraTs: [
          findCurveCrossT((T) => wFromRH(T, 80, pPa), () => w12, 20, 36),
          findCurveCrossT(() => w12, (T) => wFromTwb(T, 21.5, pPa), 20, 36)
        ]
      },
      {
        id: 'nat_vent',
        label: 'Natural Ventilation',
        shortLabel: 'Nat. Vent',
        tMin: 20,
        tMax: 32,
        fill: 'rgba(6, 182, 212, 0.11)',
        stroke: 'rgba(6, 182, 212, 0.68)',
        topFn: (T) => Math.min(wFromRH(T, 80, pPa), w16, wFromTwb(T, 23.0, pPa)),
        botFn: () => w04,
        extraTs: [
          findCurveCrossT((T) => wFromRH(T, 80, pPa), () => w16, 20, 32),
          findCurveCrossT(() => w16, (T) => wFromTwb(T, 23.0, pPa), 20, 32),
          findCurveCrossT((T) => wFromRH(T, 80, pPa), (T) => wFromTwb(T, 23.0, pPa), 20, 32)
        ]
      },
      {
        id: 'passive_solar',
        label: 'Passive Solar Heating',
        shortLabel: 'Passive Solar',
        tMin: 11,
        tMax: 20,
        fill: 'rgba(249, 115, 22, 0.11)',
        stroke: 'rgba(249, 115, 22, 0.68)',
        topFn: (T) => Math.min(w12, wsatAt(T, pPa)),
        botFn: () => 0,
        extraTs: [
          dewpointFromPv(GIVONI_PV_12)
        ]
      },
      {
        id: 'active_dehum',
        label: 'Active Dehumidification',
        shortLabel: 'Dehumidify',
        tMin: 20,
        tMax: 28,
        fill: 'rgba(236, 72, 153, 0.11)',
        stroke: 'rgba(236, 72, 153, 0.65)',
        topFn: (T) => Math.min(wDehumCap, wsatAt(T, pPa)),
        botFn: (T) => Math.min(w12, wsatAt(T, pPa)),
        extraTs: [
          findCurveCrossT(() => wDehumCap, (T) => wsatAt(T, pPa), 20, 28)
        ]
      }
    ];
  }

  function getGivoniZones(pPa = 101325) {
    const specs = buildGivoniZoneSpecs(pPa);
    return specs.map((s) => ({
      id: s.id,
      label: s.label,
      shortLabel: s.shortLabel,
      poly: buildBandPolygon(s.tMin, s.tMax, 0.5, s.extraTs, s.topFn, s.botFn, pPa),
      fill: s.fill,
      stroke: s.stroke
    }));
  }

  function evaluateGivoniZones(T, w, pPa = 101325) {
    const tVal = Number(T);
    const wVal = Math.max(0, Number(w));
    const ws = wsatAt(tVal, pPa);
    if (wVal > ws + 1e-6) return [];

    const specs = buildGivoniZoneSpecs(pPa);
    const epsT = 1e-6;
    const epsW = 1e-6;
    const hits = [];
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      if (tVal < s.tMin - epsT || tVal > s.tMax + epsT) continue;
      const wTop = Math.max(0, Math.min(ws, s.topFn(tVal)));
      const wBot = Math.max(0, Math.min(wTop, s.botFn(tVal)));
      if (wTop > wBot + 1e-7 && wVal >= wBot - epsW && wVal <= wTop + epsW) {
        hits.push({ id: s.id, label: s.label, shortLabel: s.shortLabel });
      }
    }
    return hits;
  }

  /* ---- 6. ASHRAE TC 9.9 (2021 5th Ed.) Data Center Thermal Envelopes ---- */
  // Includes Recommended + Allowable Classes A1–A4 with mandatory >900 m altitude Tmax derating.
  const TC99_BASE_SPECS = [
    {
      id: 'tc99_a4',
      name: 'Class A4',
      label: 'ASHRAE TC 9.9 Class A4',
      tMin: 5, tMax: 45, dpMin: -12, dpMax: 24, rhMin: 8, rhMax: 90,
      derateMPerC: 125,
      fill: 'rgba(100, 116, 139, 0.05)',
      stroke: 'rgba(100, 116, 139, 0.42)'
    },
    {
      id: 'tc99_a3',
      name: 'Class A3',
      label: 'ASHRAE TC 9.9 Class A3',
      tMin: 5, tMax: 40, dpMin: -12, dpMax: 24, rhMin: 8, rhMax: 85,
      derateMPerC: 175,
      fill: 'rgba(148, 163, 184, 0.06)',
      stroke: 'rgba(148, 163, 184, 0.48)'
    },
    {
      id: 'tc99_a2',
      name: 'Class A2',
      label: 'ASHRAE TC 9.9 Class A2',
      tMin: 10, tMax: 35, dpMin: -12, dpMax: 21, rhMin: 8, rhMax: 80,
      derateMPerC: 300,
      fill: 'rgba(168, 85, 247, 0.07)',
      stroke: 'rgba(168, 85, 247, 0.54)'
    },
    {
      id: 'tc99_a1',
      name: 'Class A1',
      label: 'ASHRAE TC 9.9 Class A1',
      tMin: 15, tMax: 32, dpMin: -12, dpMax: 17, rhMin: 8, rhMax: 80,
      derateMPerC: 300,
      fill: 'rgba(56, 189, 248, 0.09)',
      stroke: 'rgba(56, 189, 248, 0.64)'
    },
    {
      id: 'tc99_rec',
      name: 'Recommended',
      label: 'ASHRAE TC 9.9 Recommended',
      tMin: 18, tMax: 27, dpMin: -9, dpMax: 15, rhMin: 0, rhMax: 60,
      derateMPerC: 0,
      fill: 'rgba(16, 185, 129, 0.16)',
      stroke: 'rgba(16, 185, 129, 0.85)'
    }
  ];

  function getEffectiveTC99Specs(pPa = 101325, opts = {}) {
    const altM = Math.max(0, Math.min(3050, invAltM(pPa)));
    const excessAlt = altM > 900 ? (altM - 900) : 0;
    const recRhMax = Number.isFinite(Number(opts.recRhMax)) ? Number(opts.recRhMax) : 60;

    return TC99_BASE_SPECS.map((spec) => {
      const derateC = (excessAlt > 0 && spec.derateMPerC > 0) ? (excessAlt / spec.derateMPerC) : 0;
      const tMaxEff = Math.max(spec.tMin + 1, spec.tMax - derateC);
      const rhMaxEff = spec.id === 'tc99_rec' ? recRhMax : spec.rhMax;
      return {
        ...spec,
        tMax: tMaxEff,
        rhMax: rhMaxEff,
        derateC,
        altM
      };
    });
  }

  function getDataCenterZones(pPa = 101325, opts = {}) {
    const specs = getEffectiveTC99Specs(pPa, opts);
    return specs.map((spec) => {
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
        0.5,
        extraTs,
        (T) => Math.min(wDpMax, wFromRH(T, spec.rhMax, pPa)),
        (T) => (spec.rhMin > 0 ? Math.max(wDpMin, wFromRH(T, spec.rhMin, pPa)) : wDpMin),
        pPa
      );

      return {
        id: spec.id,
        name: spec.name,
        label: spec.label,
        tMax: spec.tMax,
        derateC: spec.derateC,
        poly,
        fill: spec.fill,
        stroke: spec.stroke
      };
    });
  }

  /* ---- 7. ASHRAE 160 Mold & Surface Condensation Risk ---- */
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

  /* ---- 8. Combined Point Comfort, Data Center, Givoni & Mold Evaluation ---- */
  function evaluatePointZones(T, w, pPa = 101325, comfortOpts = {}) {
    const tVal = Number(T);
    const wVal = Math.max(0, Number(w));
    const rhPct = rhFromTw(tVal, wVal, pPa) * 100;

    const met = comfortOpts.met ?? 1.1;
    const vAir = comfortOpts.vAir ?? 0.1;
    const mrtOffset = comfortOpts.mrtOffset ?? 0;
    const pmvLimit = comfortOpts.pmvLimit ?? 0.5;
    const wMax = resolveComfortWMax(comfortOpts);
    const wMin = Math.max(0, comfortOpts.wMin ?? 0);
    const cloSummer = comfortOpts.cloSummer ?? 0.5;
    const cloWinter = comfortOpts.cloWinter ?? 1.0;
    const wme = comfortOpts.wme ?? 0;
    const standard = comfortOpts.standard ?? 'ashrae55';
    const includeSET = Boolean(comfortOpts.includeSET);
    const mrt = comfortOpts.mrt ?? (tVal + mrtOffset);

    const summer = calcPMV(tVal, rhPct, { mrt, vAir, met, clo: cloSummer, wme, pPa, pmvLimit, standard, includeSET });
    const winter = calcPMV(tVal, rhPct, { mrt, vAir, met, clo: cloWinter, wme, pPa, pmvLimit, standard, includeSET });

    const inHumidityBand = wVal >= wMin - 1e-6 && wVal <= wMax + 1e-6;
    const inSummerComfort = summer.compliant && inHumidityBand;
    const inWinterComfort = winter.compliant && inHumidityBand;

    const mold = calcMoldCondensationRisk(tVal, wVal, pPa, comfortOpts.surfaceT);
    const Tdp = mold.Tdp;

    // Match tightest ASHRAE TC 9.9 class (Recommended -> A1 -> A2 -> A3 -> A4) with altitude derating
    const tcSpecs = getEffectiveTC99Specs(pPa, comfortOpts);
    const eps = 1e-6;
    let dataCenterClass = null;
    for (let i = tcSpecs.length - 1; i >= 0; i--) {
      const s = tcSpecs[i];
      if (
        tVal >= s.tMin - eps && tVal <= s.tMax + eps &&
        Tdp >= s.dpMin - eps && Tdp <= s.dpMax + eps &&
        rhPct >= s.rhMin - eps && rhPct <= s.rhMax + eps
      ) {
        dataCenterClass = s.name;
        break;
      }
    }

    const givoniZones = evaluateGivoniZones(tVal, wVal, pPa);

    return {
      summer,
      winter,
      dataCenterClass,
      givoniZones,
      mold,
      inSummerComfort,
      inWinterComfort,
      inHumidityBand,
      wMax
    };
  }

  /**
   * Canonical active-season thermal comfort evaluator shared across Left Panel,
   * Points Table PMV dots, Modals, and HTML/CSV Reports — guarantees 100% consistent
   * PMV, PPD, compliance, and humidity-cap reporting everywhere.
   */
  function evaluateActiveComfort(T, w, pPa = 101325, comfortCfg = {}) {
    const mode = comfortCfg.mode || 'both';
    const cloSummer = comfortCfg.cloSummer ?? 0.5;
    const cloWinter = comfortCfg.cloWinter ?? 1.0;
    const ev = evaluatePointZones(T, w, pPa, comfortCfg);

    let season = 'summer';
    if (mode === 'winter') {
      season = 'winter';
    } else if (mode === 'summer') {
      season = 'summer';
    } else {
      // 'both' or 'none': evaluate against combined Summer + Winter comfort envelope;
      // pick compliant season first, otherwise closer |PMV| to neutral.
      if (ev.inWinterComfort && !ev.inSummerComfort) {
        season = 'winter';
      } else if (ev.inSummerComfort && !ev.inWinterComfort) {
        season = 'summer';
      } else {
        season = Math.abs(ev.winter.pmv) < Math.abs(ev.summer.pmv) ? 'winter' : 'summer';
      }
    }

    const active = season === 'winter' ? ev.winter : ev.summer;
    const inComfort = season === 'winter' ? ev.inWinterComfort : ev.inSummerComfort;
    const seasonTag = season === 'winter'
      ? `Win ${fmtClo(cloWinter)} clo`
      : `Sum ${fmtClo(cloSummer)} clo`;

    let reason = active.sensation;
    if (!inComfort && active.compliant && !ev.inHumidityBand) {
      reason = `Humid (W > ${(ev.wMax * 1000).toFixed(0)} g/kg)`;
    }

    return {
      pmv: active.pmv,
      ppd: active.ppd,
      sensation: active.sensation,
      compliant: inComfort,
      inComfort,
      pmvCompliant: active.compliant,
      inHumidityBand: ev.inHumidityBand,
      wMax: ev.wMax,
      season,
      seasonTag,
      reason,
      vr: active.vr,
      cloEff: active.cloEff,
      ce: active.ce,
      set: active.set,
      standard: active.standard,
      elevatedAirSpeed: active.elevatedAirSpeed,
      summer: ev.summer,
      winter: ev.winter,
      inSummerComfort: ev.inSummerComfort,
      inWinterComfort: ev.inWinterComfort,
      dataCenterClass: ev.dataCenterClass,
      givoniZones: ev.givoniZones,
      mold: ev.mold
    };
  }

  return {
    calcRelativeAirSpeed,
    calcDynamicClo,
    calcSET,
    calcCoolingEffect,
    calcPMV,
    generateASHRAE55Polygon,
    getSummerWinterZones,
    getGivoniZones,
    evaluateGivoniZones,
    getDataCenterZones,
    calcMoldCondensationRisk,
    evaluatePointZones,
    evaluateActiveComfort,
    pointInPolygon,
    fmtClo
  };
})();
