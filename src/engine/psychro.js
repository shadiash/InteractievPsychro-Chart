/* ============================================================================
   PsychroChart Ultra 3.0 — ASHRAE Fundamentals (2021) Ch. 1 Physics Engine
   Strict internal SI units (°C, kg/kg, Pa, kJ/kg, m³/kg).
   ============================================================================ */

export const Psy = (() => {
  /* ---- ASHRAE 2021 & Engineering Constants ---- */
  const Rda = 287.042;              // Dry air gas constant, J/(kg·K)
  const Rv = 461.52;                // Water vapor gas constant, J/(kg·K)
  const P_STD = 101325;             // Standard sea-level barometric pressure, Pa
  const MW_RATIO = 0.621945;        // Molecular mass ratio Mw / Mda
  const GRAINS_PER_LB = 7000;       // gr/lb per lb/lb
  const KPA_PER_PSI = 6.894757293168361;
  const FT3_PER_M3 = 35.3146667215;
  const LB_PER_KG = 2.20462262185;
  const BTU_PER_KJ = 0.94781712;
  const BTU_LB_PER_KJ_KG = 0.429922614;
  const BTUH_PER_KW = 3412.141633;
  const KW_PER_TON = 3.51685284;
  const BTUH_PER_TON = 12000;
  const GPM_WATER_PER_KGS = 15.8503231;

  const V_IP_PER_SI = FT3_PER_M3 / LB_PER_KG;           // ft³/lb per m³/kg
  const RHO_IP_PER_SI = LB_PER_KG / FT3_PER_M3;         // lb/ft³ per kg/m³
  const CFM_PER_M3S = FT3_PER_M3 * 60;                  // ft³/min per m³/s
  const CP_IP_PER_SI = BTU_LB_PER_KJ_KG / 1.8;          // Btu/(lb·°F) per kJ/(kg·K)

  /* ---- Internal Helpers ---- */
  function _clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /**
   * Saturation vapor pressure p_ws in Pa (ASHRAE Fundamentals 2021 Ch. 1 Eqs. 5 & 6,
   * Hyland-Wexler formulation). Valid for Tc in [-100, 200] °C.
   */
  function p_ws_Pa(Tc) {
    const tC = _clamp(Tc, -100, 200);
    const T = tC + 273.15;
    if (tC < 0) {
      const c1 = -5674.5359;
      const c2 = 6.3925247;
      const c3 = -9.677843e-3;
      const c4 = 6.2215701e-7;
      const c5 = 2.0747825e-9;
      const c6 = -9.484024e-13;
      const c7 = 4.1635019;
      return Math.exp(
        c1 / T + c2 + T * (c3 + T * (c4 + T * (c5 + T * c6))) + c7 * Math.log(T)
      );
    }
    const c8 = -5800.2206;
    const c9 = 1.3914993;
    const c10 = -4.8640239e-2;
    const c11 = 4.1764768e-5;
    const c12 = -1.4452093e-8;
    const c13 = 6.5459673;
    return Math.exp(
      c8 / T + c9 + T * (c10 + T * (c11 + T * c12)) + c13 * Math.log(T)
    );
  }

  /**
   * High-precision bisection inverse of p_ws_Pa on [tLo, tHi] °C.
   */
  function _inv_pws_Pa(pv, tLo = -80, tHi = 95) {
    if (!Number.isFinite(pv) || pv <= 0) return tLo;
    const pLo = p_ws_Pa(tLo);
    if (pv <= pLo) return tLo;
    const pHi = p_ws_Pa(tHi);
    if (pv >= pHi) return tHi;
    let lo = tLo;
    let hi = tHi;
    for (let i = 0; i < 64; i++) {
      const mid = 0.5 * (lo + hi);
      if (p_ws_Pa(mid) < pv) lo = mid;
      else hi = mid;
      if (hi - lo < 1e-8) break;
    }
    return 0.5 * (lo + hi);
  }

  /**
   * Standard atmosphere barometric pressure in Pa from altitude in meters (-500..11000 m).
   * ASHRAE Fundamentals 2021 Ch. 1 Eq. (3).
   */
  function baroPa(alt_m) {
    const z = _clamp(alt_m, -500, 11000);
    return P_STD * Math.pow(1 - 2.25577e-5 * z, 5.2559);
  }

  /**
   * Exact inverse of baroPa: altitude in meters from barometric pressure in Pa.
   */
  function invBaroAlt_m(pPa) {
    const p = Math.max(1, pPa);
    return (1 - Math.pow(p / P_STD, 1 / 5.2559)) / 2.25577e-5;
  }

  /**
   * Humidity ratio w (kg_w / kg_da) from vapor partial pressure pv (Pa) and barometric pPa (Pa).
   */
  function w_from_pv(pv, pPa = P_STD) {
    const pvSafe = Math.max(0, pv);
    return MW_RATIO * pvSafe / Math.max(1, pPa - pvSafe);
  }

  /**
   * Water vapor partial pressure pv (Pa) from humidity ratio w (kg/kg) and barometric pPa (Pa).
   */
  function pv_from_w(w, pPa = P_STD) {
    const wSafe = Math.max(0, w);
    return (wSafe * pPa) / (wSafe + MW_RATIO);
  }

  /**
   * Saturation humidity ratio w_s (kg/kg) at temperature Tc (°C) and barometric pressure pPa (Pa).
   */
  function wsat_at(Tc, pPa = P_STD) {
    return w_from_pv(Math.min(p_ws_Pa(Tc), pPa * 0.9995), pPa);
  }

  /**
   * Moist air specific enthalpy in kJ/kg_da (0°C dry-air datum, ASHRAE 2021 Ch. 1 Eq. 32 SI).
   */
  function h_kJkg(Tc, w) {
    return 1.006 * Tc + w * (2501 + 1.86 * Tc);
  }

  /**
   * Moist air specific enthalpy in Btu/lb_da (TRUE ASHRAE IP 0°F dry-air datum, Eq. 32 IP).
   */
  function h_Btulb(Tc, w) {
    const Tf = Tc * 1.8 + 32;
    return 0.240 * Tf + w * (1061 + 0.444 * Tf);
  }

  /**
   * Exact inverse of h_Btulb: converts IP enthalpy (Btu/lb_da) at humidity ratio w to SI kJ/kg_da.
   */
  function h_kJkg_from_Btulb(hIP, w = 0) {
    const Tf = (hIP - 1061 * w) / (0.240 + 0.444 * w);
    const Tc = (Tf - 32) / 1.8;
    return h_kJkg(Tc, w);
  }

  /**
   * Enthalpy DIFFERENCE conversion from kJ/kg_da to Btu/lb_da (no datum offset).
   */
  function dh_Btulb(dh_kJkg) {
    return dh_kJkg * BTU_LB_PER_KJ_KG;
  }

  /**
   * Specific volume v in m³/kg_da (ASHRAE 2021 Ch. 1 Eq. 28).
   */
  function v_m3kg(Tc, w, pPa = P_STD) {
    return Rda * (Tc + 273.15) * (1 + 1.607858 * w) / pPa;
  }

  /**
   * Dry air mass density in kg_da / m³.
   */
  function rho_dry(Tc, w, pPa = P_STD) {
    return 1 / v_m3kg(Tc, w, pPa);
  }

  /**
   * Moist air mass density in kg_moist / m³.
   */
  function rho_moist(Tc, w, pPa = P_STD) {
    return (1 + w) / v_m3kg(Tc, w, pPa);
  }

  /**
   * Moist air specific heat at constant pressure in kJ/(kg_da·K).
   */
  function cp_moist(w) {
    return 1.006 + 1.86 * w;
  }

  /**
   * Relative humidity fraction (0..1) from dry-bulb Tc (°C) and humidity ratio w (kg/kg).
   */
  function RH_from_Tw(Tc, w, pPa = P_STD) {
    const pws = p_ws_Pa(Tc);
    if (pws <= 0) return 0;
    return _clamp(pv_from_w(w, pPa) / pws, 0, 1);
  }

  /**
   * Degree of saturation mu = w / w_s (0..1).
   */
  function mu_from_Tw(Tc, w, pPa = P_STD) {
    const ws = wsat_at(Tc, pPa);
    if (ws <= 0) return 0;
    return _clamp(w / ws, 0, 1);
  }

  /**
   * Dew-point temperature (°C) from water vapor partial pressure pv (Pa).
   * High-precision bisection inverse of p_ws_Pa on [-80, 95] °C (tolerance < 1e-6 °C).
   */
  function dewpoint_from_pv(pv) {
    return _inv_pws_Pa(pv, -80, 95);
  }

  /**
   * Humidity ratio w (kg/kg) from dew-point temperature TdpC (°C).
   */
  function w_from_Tdp(TdpC, pPa = P_STD) {
    return wsat_at(TdpC, pPa);
  }

  /**
   * Humidity ratio w (kg/kg) from dry-bulb Tc (°C) and relative humidity fraction rh01 (0..1).
   */
  function w_from_TRH(Tc, rh01, pPa = P_STD) {
    const rh = _clamp(rh01, 0, 1);
    const pv = Math.min(rh * p_ws_Pa(Tc), pPa * 0.9995);
    return w_from_pv(pv, pPa);
  }

  /**
   * Unclamped ASHRAE 2021 Ch. 1 Eqs. (35) & (37) humidity ratio from Tdb and Twb.
   * Used internally by root-finders so w = 0 dry-air roots are resolved accurately.
   */
  function _w_from_TTwb_raw(Tc, TwbC, pPa = P_STD) {
    const wsStar = wsat_at(TwbC, pPa);
    if (TwbC >= 0) {
      return (
        ((2501 - 2.326 * TwbC) * wsStar - 1.006 * (Tc - TwbC)) /
        (2501 + 1.86 * Tc - 4.186 * TwbC)
      );
    }
    return (
      ((2830 - 0.24 * TwbC) * wsStar - 1.006 * (Tc - TwbC)) /
      (2830 + 1.86 * Tc - 2.1 * TwbC)
    );
  }

  /**
   * Exact ASHRAE 2021 Ch. 1 Eqs. (35) & (37) humidity ratio w (kg/kg) from Tdb and Twb,
   * clamped to [0, wsat_at(Tc, pPa)].
   */
  function w_from_TTwb(Tc, TwbC, pPa = P_STD) {
    return _clamp(_w_from_TTwb_raw(Tc, TwbC, pPa), 0, wsat_at(Tc, pPa));
  }

  /**
   * Exact closed-form Tdb (°C) from humidity ratio w (kg/kg) and wet-bulb TwbC (°C),
   * algebraic inverse of ASHRAE Eqs. (35) & (37).
   */
  function _Tdb_from_wTwb(w, TwbC, pPa = P_STD) {
    const wsStar = wsat_at(TwbC, pPa);
    if (TwbC >= 0) {
      return (
        ((2501 - 2.326 * TwbC) * wsStar + 1.006 * TwbC - w * (2501 - 4.186 * TwbC)) /
        (1.006 + 1.86 * w)
      );
    }
    return (
      ((2830 - 0.24 * TwbC) * wsStar + 1.006 * TwbC - w * (2830 - 2.1 * TwbC)) /
      (1.006 + 1.86 * w)
    );
  }

  /**
   * Wet-bulb temperature (°C) from dry-bulb Tc (°C) and humidity ratio w (kg/kg).
   * High-precision 64-iteration bisection solving ASHRAE Eqs. (35)/(37) (< 1e-6 °C error).
   * Handles the 0°C ice/liquid phase transition cleanly so Twb = Tdb = Tdp at RH = 100%.
   */
  function twb_from_Tw(Tc, w, pPa = P_STD) {
    const ws = wsat_at(Tc, pPa);
    const wTarget = _clamp(w, 0, ws);

    // Exact saturation identity: Twb === Tdb
    if (wTarget >= ws * (1 - 1e-13)) return Tc;

    const pv = pv_from_w(wTarget, pPa);
    const tdp = wTarget <= 0 ? -80 : Math.min(Tc, dewpoint_from_pv(pv));

    let lo = Math.min(Tc, Math.max(-65, tdp - 2));
    let hi = Tc;

    // Partition cleanly around the 0°C liquid/ice transition where latent heat jumps
    if (Tc >= 0) {
      const wAtZeroLiquid = _w_from_TTwb_raw(Tc, 0, pPa);
      if (wTarget >= wAtZeroLiquid) {
        lo = Math.max(0, lo);
      } else {
        hi = -1e-9;
        if (lo >= hi) lo = Math.max(-95, hi - 10);
      }
    }

    // Ensure lower bracket actually lies below wTarget (e.g. very cold Tdb < -65°C)
    while (_w_from_TTwb_raw(Tc, lo, pPa) > wTarget && lo > -100) {
      lo = Math.max(-100, lo - 15);
    }

    for (let i = 0; i < 64; i++) {
      const mid = 0.5 * (lo + hi);
      if (_w_from_TTwb_raw(Tc, mid, pPa) < wTarget) lo = mid;
      else hi = mid;
      if (hi - lo < 1e-9) break;
    }
    return 0.5 * (lo + hi);
  }

  /**
   * Dry-bulb temperature (°C) from humidity ratio w (kg/kg) and enthalpy h_kJkg (kJ/kg_da).
   */
  function Tdb_from_wh(w, h) {
    return (h - 2501 * w) / (1.006 + 1.86 * w);
  }

  /**
   * Complete psychrometric state object from dry-bulb Tc (°C), humidity ratio w (kg/kg),
   * and barometric pressure pPa (Pa).
   */
  function stateFromTw(Tc, w, pPa = P_STD) {
    const ws = wsat_at(Tc, pPa);
    const wC = _clamp(w, 0, ws);
    const pws = p_ws_Pa(Tc);
    const pv = pv_from_w(wC, pPa);
    const rh01 = pws > 0 ? _clamp(pv / pws, 0, 1) : 0;
    const rh = rh01 * 100;
    const h = h_kJkg(Tc, wC);
    const hIP = h_Btulb(Tc, wC);
    const v = v_m3kg(Tc, wC, pPa);
    const vIP = v * V_IP_PER_SI;
    const rhoDry = 1 / v;
    const rhoMoist = (1 + wC) / v;
    const rhoDryIP = rhoDry * RHO_IP_PER_SI;
    const rhoMoistIP = rhoMoist * RHO_IP_PER_SI;
    const atSat = wC >= ws * (1 - 1e-13) && pws <= pPa * 0.9995;
    const Tdp = wC <= 0 ? -80 : (atSat ? Tc : Math.min(Tc, dewpoint_from_pv(pv)));
    const Twb = atSat ? Tc : twb_from_Tw(Tc, wC, pPa);
    const mu = ws > 0 ? _clamp(wC / ws, 0, 1) : 0;
    const cpm = cp_moist(wC);

    return {
      T: Tc,
      w: wC,
      rh,
      rh01,
      pv,
      pws,
      h,
      hIP,
      v,
      vIP,
      rhoDry,
      rhoMoist,
      rhoDryIP,
      rhoMoistIP,
      Tdp,
      Twb,
      mu,
      cpm,
      pPa
    };
  }

  /* ---- Universal Any-2-of-8 State Solver ---- */
  const _PROP_ALIASES = {
    tdb: 'Tdb',
    t: 'Tdb',
    twb: 'Twb',
    tdp: 'Tdp',
    rh: 'RH',
    w: 'W',
    h: 'h',
    v: 'v',
    pv: 'Pv'
  };

  const _MOISTURE_GROUP = { W: true, Tdp: true, Pv: true };

  function _normalizeProp(p) {
    if (typeof p !== 'string') return null;
    return _PROP_ALIASES[p.trim().toLowerCase()] || null;
  }

  /**
   * Solves full psychrometric state from ANY independent pair among:
   * 'Tdb' (°C), 'Twb' (°C), 'Tdp' (°C), 'RH' (0..100 %), 'W' (kg/kg),
   * 'h' (kJ/kg), 'v' (m³/kg), 'Pv' (Pa).
   * Returns { ok: true, state } or { ok: false, error }.
   */
  function solveState(prop1, val1SI, prop2, val2SI, pPa = P_STD) {
    const k1 = _normalizeProp(prop1);
    const k2 = _normalizeProp(prop2);

    if (!k1 || !k2) {
      return { ok: false, error: `Unsupported psychrometric property (${prop1}, ${prop2})` };
    }
    if (!Number.isFinite(val1SI) || !Number.isFinite(val2SI)) {
      return { ok: false, error: 'Input property values must be finite numbers' };
    }
    if (!Number.isFinite(pPa) || pPa <= 1000) {
      return { ok: false, error: 'Barometric pressure must be a valid positive pressure (> 1000 Pa)' };
    }
    if (k1 === k2) {
      return { ok: false, error: 'Independent property pair required (selected the same property twice)' };
    }
    if (_MOISTURE_GROUP[k1] && _MOISTURE_GROUP[k2]) {
      return {
        ok: false,
        error: 'Independent property pair required (W, Tdp, and Pv are mutually dependent)'
      };
    }

    const vals = { [k1]: val1SI, [k2]: val2SI };
    const has = (k) => Object.prototype.hasOwnProperty.call(vals, k);

    // Basic individual domain guards
    if (has('RH') && (vals.RH < -1e-6 || vals.RH > 100 + 1e-6)) {
      return { ok: false, error: 'Relative humidity must be between 0% and 100%' };
    }
    if (has('W') && vals.W < -1e-9) {
      return { ok: false, error: 'Humidity ratio W cannot be negative' };
    }
    if (has('Pv') && (vals.Pv < -1e-6 || vals.Pv >= pPa * 0.9995)) {
      return { ok: false, error: 'Vapor pressure Pv must be between 0 and barometric pressure' };
    }
    if (has('Tdb') && (vals.Tdb < -100 || vals.Tdb > 200)) {
      return { ok: false, error: 'Dry-bulb temperature must be within [-100, 200] °C' };
    }
    if (has('Twb')) {
      if (vals.Twb < -100 || vals.Twb > 120) {
        return { ok: false, error: 'Wet-bulb temperature must be within [-100, 120] °C' };
      }
      if (p_ws_Pa(vals.Twb) >= pPa * 0.9995) {
        return { ok: false, error: 'Wet-bulb temperature exceeds boiling point at this barometric pressure' };
      }
    }
    if (has('Tdp')) {
      if (vals.Tdp < -100 || vals.Tdp > 120) {
        return { ok: false, error: 'Dew-point temperature must be within [-100, 120] °C' };
      }
      if (p_ws_Pa(vals.Tdp) >= pPa * 0.9995) {
        return { ok: false, error: 'Dew-point temperature exceeds boiling point at this barometric pressure' };
      }
    }
    if (has('v') && (vals.v <= 0.05 || vals.v > 25)) {
      return { ok: false, error: 'Specific volume v is outside valid physical bounds' };
    }

    // Extract moisture-content group (W / Tdp / Pv) into unified w if present
    let hasM = false;
    let wKnown = 0;
    let pvKnown = 0;
    let tdpKnown = -80;

    if (has('W')) {
      hasM = true;
      wKnown = Math.max(0, vals.W);
      pvKnown = pv_from_w(wKnown, pPa);
      tdpKnown = wKnown <= 0 ? -80 : dewpoint_from_pv(pvKnown);
    } else if (has('Tdp')) {
      hasM = true;
      tdpKnown = vals.Tdp;
      pvKnown = Math.min(p_ws_Pa(tdpKnown), pPa * 0.9995);
      wKnown = w_from_pv(pvKnown, pPa);
    } else if (has('Pv')) {
      hasM = true;
      pvKnown = Math.max(0, vals.Pv);
      wKnown = w_from_pv(pvKnown, pPa);
      tdpKnown = pvKnown <= 0 ? -80 : dewpoint_from_pv(pvKnown);
    }

    let T = NaN;
    let w = NaN;

    /* ---- Group A: Tdb + X (7 exact closed-form pairs) ---- */
    if (has('Tdb')) {
      T = vals.Tdb;
      const wsT = wsat_at(T, pPa);

      if (hasM) {
        if (has('Tdp') && vals.Tdp > T + 0.01) {
          return { ok: false, error: 'Dew-point temperature cannot exceed dry-bulb temperature' };
        }
        if (has('Pv') && vals.Pv > p_ws_Pa(T) * 1.001 + 1e-3) {
          return { ok: false, error: 'Vapor pressure Pv exceeds saturation pressure at dry-bulb temperature' };
        }
        if (wKnown > wsT * 1.001 + 1e-7) {
          return { ok: false, error: 'Humidity ratio exceeds saturation at dry-bulb temperature (RH > 100%)' };
        }
        w = _clamp(wKnown, 0, wsT);
      } else if (has('RH')) {
        const rh01 = _clamp(vals.RH / 100, 0, 1);
        w = w_from_TRH(T, rh01, pPa);
      } else if (has('Twb')) {
        const Twb = vals.Twb;
        if (Twb > T + 0.01) {
          return { ok: false, error: 'Wet-bulb temperature cannot exceed dry-bulb temperature' };
        }
        const TwbEff = Math.min(Twb, T);
        const wRaw = _w_from_TTwb_raw(T, TwbEff, pPa);
        if (wRaw < -1e-5) {
          return {
            ok: false,
            error: 'Wet-bulb temperature is below minimum physically possible for this dry-bulb temperature'
          };
        }
        w = _clamp(wRaw, 0, wsT);
      } else if (has('h')) {
        const wRaw = (vals.h - 1.006 * T) / (2501 + 1.86 * T);
        if (wRaw < -1e-5) {
          return { ok: false, error: 'Enthalpy is below dry-air minimum (RH < 0%) at this dry-bulb temperature' };
        }
        if (wRaw > wsT * 1.001 + 1e-7) {
          return { ok: false, error: 'Enthalpy exceeds saturation maximum (RH > 100%) at this dry-bulb temperature' };
        }
        w = _clamp(wRaw, 0, wsT);
      } else if (has('v')) {
        const wRaw = (vals.v * pPa / (Rda * (T + 273.15)) - 1) / 1.607858;
        if (wRaw < -1e-5) {
          return { ok: false, error: 'Specific volume is below dry-air minimum at this dry-bulb temperature' };
        }
        if (wRaw > wsT * 1.001 + 1e-7) {
          return { ok: false, error: 'Specific volume exceeds saturation maximum at this dry-bulb temperature' };
        }
        w = _clamp(wRaw, 0, wsT);
      }
    }

    /* ---- Group B: {W, Tdp, Pv} + {RH, Twb, h, v} (12 exact closed-form pairs) ---- */
    else if (hasM) {
      w = wKnown;

      if (has('RH')) {
        const rh01 = _clamp(vals.RH / 100, 0, 1);
        if (rh01 <= 0) {
          if (w > 1e-9) {
            return { ok: false, error: 'RH = 0% is incompatible with non-zero moisture content' };
          }
          return {
            ok: false,
            error: 'Cannot determine dry-bulb temperature when RH = 0% and humidity ratio = 0'
          };
        }
        if (w <= 0 || pvKnown <= 0) {
          return { ok: false, error: 'RH > 0% requires non-zero moisture content (W, Pv > 0)' };
        }
        const pwsTarget = pvKnown / rh01;
        if (pwsTarget < p_ws_Pa(-100) || pwsTarget > p_ws_Pa(200)) {
          return {
            ok: false,
            error: 'Resulting dry-bulb temperature is outside the valid psychrometric range [-100, 200] °C'
          };
        }
        T = _inv_pws_Pa(pwsTarget, -100, 200);
      } else if (has('Twb')) {
        const Twb = vals.Twb;
        const wsTwb = wsat_at(Twb, pPa);
        if (has('Tdp') && vals.Tdp > Twb + 0.01) {
          return { ok: false, error: 'Dew-point temperature cannot exceed wet-bulb temperature' };
        }
        if (w > wsTwb * 1.001 + 1e-7) {
          return { ok: false, error: 'Moisture content exceeds saturation at the specified wet-bulb temperature' };
        }
        w = _clamp(w, 0, wsTwb);
        T = _Tdb_from_wTwb(w, Twb, pPa);
        if (T < Twb - 0.01) {
          return { ok: false, error: 'Specified wet-bulb and moisture content yield an unphysical state (Tdb < Twb)' };
        }
        T = Math.max(T, Twb);
      } else if (has('h')) {
        T = Tdb_from_wh(w, vals.h);
        const wsT = wsat_at(T, pPa);
        if (w > wsT * 1.001 + 1e-7) {
          return { ok: false, error: 'State is supersaturated (enthalpy is below dew-point saturation enthalpy)' };
        }
        w = _clamp(w, 0, wsT);
      } else if (has('v')) {
        T = (vals.v * pPa) / (Rda * (1 + 1.607858 * w)) - 273.15;
        const wsT = wsat_at(T, pPa);
        if (w > wsT * 1.001 + 1e-7) {
          return { ok: false, error: 'State is supersaturated (specific volume is below saturation minimum for this W)' };
        }
        w = _clamp(w, 0, wsT);
      }
    }

    /* ---- Group C: Coupled pairs among {RH, Twb, h, v} (6 pairs) ---- */
    else if (has('Twb') && has('RH')) {
      const Twb = vals.Twb;
      const rh01 = _clamp(vals.RH / 100, 0, 1);
      const wsStar = wsat_at(Twb, pPa);
      const tDry = _Tdb_from_wTwb(0, Twb, pPa);

      if (rh01 >= 1 - 1e-12) {
        T = Twb;
        w = wsStar;
      } else if (rh01 <= 0) {
        if (tDry > 200) {
          return { ok: false, error: 'Resulting dry-bulb temperature exceeds 200 °C at RH = 0%' };
        }
        T = tDry;
        w = 0;
      } else {
        const tHi = Math.min(tDry, 200);
        const wAtHi = Math.max(0, _w_from_TTwb_raw(tHi, Twb, pPa));
        const rhAtHi = RH_from_Tw(tHi, wAtHi, pPa);
        if (rh01 < rhAtHi - 1e-9) {
          return { ok: false, error: 'Resulting dry-bulb temperature exceeds valid range (200 °C)' };
        }
        let lo = Twb;
        let hi = tHi;
        for (let i = 0; i < 64; i++) {
          const mid = 0.5 * (lo + hi);
          const wMid = Math.max(0, _w_from_TTwb_raw(mid, Twb, pPa));
          const rhMid = RH_from_Tw(mid, wMid, pPa);
          // RH strictly decreases with T along constant Twb
          if (rhMid > rh01) lo = mid;
          else hi = mid;
          if (hi - lo < 1e-9) break;
        }
        T = 0.5 * (lo + hi);
        w = _clamp(_w_from_TTwb_raw(T, Twb, pPa), 0, wsat_at(T, pPa));
      }
    } else if (has('h') && has('RH')) {
      const hTarget = vals.h;
      const rh01 = _clamp(vals.RH / 100, 0, 1);

      if (rh01 <= 0) {
        T = hTarget / 1.006;
        w = 0;
      } else {
        const tLo = -100;
        const pwsMax = pPa * 0.999 / rh01;
        const tHi = Math.min(200, _inv_pws_Pa(pwsMax, -100, 200));
        const hLo = h_kJkg(tLo, w_from_TRH(tLo, rh01, pPa));
        const hHi = h_kJkg(tHi, w_from_TRH(tHi, rh01, pPa));
        if (hTarget < hLo - 1e-4 || hTarget > hHi + 1e-4) {
          return { ok: false, error: 'Enthalpy is outside valid psychrometric range for this RH' };
        }
        let lo = tLo;
        let hi = tHi;
        for (let i = 0; i < 64; i++) {
          const mid = 0.5 * (lo + hi);
          const hMid = h_kJkg(mid, w_from_TRH(mid, rh01, pPa));
          // h strictly increases with T along constant RH
          if (hMid < hTarget) lo = mid;
          else hi = mid;
          if (hi - lo < 1e-9) break;
        }
        T = 0.5 * (lo + hi);
        w = w_from_TRH(T, rh01, pPa);
      }
    } else if (has('v') && has('RH')) {
      const vTarget = vals.v;
      const rh01 = _clamp(vals.RH / 100, 0, 1);

      if (rh01 <= 0) {
        T = (vTarget * pPa) / Rda - 273.15;
        w = 0;
      } else {
        const tLo = -100;
        const pwsMax = pPa * 0.999 / rh01;
        const tHi = Math.min(200, _inv_pws_Pa(pwsMax, -100, 200));
        const vLo = v_m3kg(tLo, w_from_TRH(tLo, rh01, pPa), pPa);
        const vHi = v_m3kg(tHi, w_from_TRH(tHi, rh01, pPa), pPa);
        if (vTarget < vLo - 1e-6 || vTarget > vHi + 1e-6) {
          return { ok: false, error: 'Specific volume is outside valid psychrometric range for this RH' };
        }
        let lo = tLo;
        let hi = tHi;
        for (let i = 0; i < 64; i++) {
          const mid = 0.5 * (lo + hi);
          const vMid = v_m3kg(mid, w_from_TRH(mid, rh01, pPa), pPa);
          // v strictly increases with T along constant RH
          if (vMid < vTarget) lo = mid;
          else hi = mid;
          if (hi - lo < 1e-9) break;
        }
        T = 0.5 * (lo + hi);
        w = w_from_TRH(T, rh01, pPa);
      }
    } else if (has('Twb') && has('h')) {
      const Twb = vals.Twb;
      const hTarget = vals.h;
      const wsStar = wsat_at(Twb, pPa);
      const hSat = h_kJkg(Twb, wsStar);

      if (Twb >= 0 && Twb < 1e-4) {
        return {
          ok: false,
          error: 'Twb and h are collinear at Twb = 0 °C; specify another independent property pair'
        };
      }

      let wRaw;
      if (Twb >= 0) {
        // Exact identity from ASHRAE Eq. (35): h - hSat = (w - wsStar) * 4.186 * Twb
        wRaw = wsStar + (hTarget - hSat) / (4.186 * Twb);
      } else {
        // Exact identity from ASHRAE Eq. (37): h - hSat = (wsStar - w) * (329 - 2.1 * Twb)
        wRaw = wsStar - (hTarget - hSat) / (329 - 2.1 * Twb);
      }

      if (wRaw < -1e-5 || wRaw > wsStar * 1.001 + 1e-7) {
        const hDry = Twb >= 0
          ? hSat - 4.186 * Twb * wsStar
          : hSat + (329 - 2.1 * Twb) * wsStar;
        const hMin = Math.min(hSat, hDry);
        const hMax = Math.max(hSat, hDry);
        return {
          ok: false,
          error: `Enthalpy must be within [${hMin.toFixed(2)}, ${hMax.toFixed(2)}] kJ/kg for Twb = ${Twb.toFixed(2)} °C`
        };
      }

      w = _clamp(wRaw, 0, wsStar);
      T = Tdb_from_wh(w, hTarget);
    } else if (has('Twb') && has('v')) {
      const Twb = vals.Twb;
      const vTarget = vals.v;
      const wsStar = wsat_at(Twb, pPa);
      const tDry = _Tdb_from_wTwb(0, Twb, pPa);
      const vMin = v_m3kg(Twb, wsStar, pPa);
      const vMax = v_m3kg(tDry, 0, pPa);

      if (vTarget < vMin - 1e-6) {
        return {
          ok: false,
          error: 'Specific volume is below saturation minimum at this wet-bulb temperature'
        };
      }
      if (vTarget > vMax + 1e-6) {
        return {
          ok: false,
          error: 'Specific volume exceeds dry-air maximum at this wet-bulb temperature'
        };
      }

      if (vTarget <= vMin) {
        T = Twb;
        w = wsStar;
      } else if (vTarget >= vMax) {
        T = tDry;
        w = 0;
      } else {
        let lo = Twb;
        let hi = tDry;
        for (let i = 0; i < 64; i++) {
          const mid = 0.5 * (lo + hi);
          const wMid = Math.max(0, _w_from_TTwb_raw(mid, Twb, pPa));
          const vMid = v_m3kg(mid, wMid, pPa);
          // v strictly increases with T along constant Twb
          if (vMid < vTarget) lo = mid;
          else hi = mid;
          if (hi - lo < 1e-9) break;
        }
        T = 0.5 * (lo + hi);
        w = _clamp(_w_from_TTwb_raw(T, Twb, pPa), 0, wsat_at(T, pPa));
      }
    } else if (has('h') && has('v')) {
      const hTarget = vals.h;
      const vTarget = vals.v;

      // 1. Find saturation point (T_sat, w_sat) on the constant-h line
      const tLo = -100;
      const tBoil = Math.min(200, _inv_pws_Pa(pPa * 0.999, -100, 200));
      const hSatLo = h_kJkg(tLo, wsat_at(tLo, pPa));
      const hSatHi = h_kJkg(tBoil, wsat_at(tBoil, pPa));
      if (hTarget < hSatLo - 1e-4 || hTarget > hSatHi + 1e-4) {
        return { ok: false, error: 'Enthalpy is outside valid psychrometric range' };
      }

      let loT = tLo;
      let hiT = tBoil;
      for (let i = 0; i < 64; i++) {
        const mid = 0.5 * (loT + hiT);
        if (h_kJkg(mid, wsat_at(mid, pPa)) < hTarget) loT = mid;
        else hiT = mid;
        if (hiT - loT < 1e-9) break;
      }
      const tSat = 0.5 * (loT + hiT);
      const wSat = wsat_at(tSat, pPa);
      const tDry = hTarget / 1.006;

      const vMin = v_m3kg(tSat, wSat, pPa);
      const vMax = v_m3kg(tDry, 0, pPa);

      if (vTarget < vMin - 1e-6) {
        return { ok: false, error: 'Specific volume is below saturation minimum for this enthalpy' };
      }
      if (vTarget > vMax + 1e-6) {
        return { ok: false, error: 'Specific volume exceeds dry-air maximum for this enthalpy' };
      }

      if (vTarget <= vMin) {
        w = wSat;
        T = tSat;
      } else if (vTarget >= vMax) {
        w = 0;
        T = tDry;
      } else {
        // v(w) strictly decreases as w increases from 0 to wSat along constant h
        let loW = 0;
        let hiW = wSat;
        for (let i = 0; i < 64; i++) {
          const midW = 0.5 * (loW + hiW);
          const vMid = v_m3kg(Tdb_from_wh(midW, hTarget), midW, pPa);
          if (vMid > vTarget) loW = midW;
          else hiW = midW;
          if (hiW - loW < 1e-12) break;
        }
        w = 0.5 * (loW + hiW);
        T = Tdb_from_wh(w, hTarget);
      }
    } else {
      return { ok: false, error: `Unsupported property pair (${k1}, ${k2})` };
    }

    /* ---- Final Physical Realizability Validation ---- */
    if (!Number.isFinite(T) || !Number.isFinite(w)) {
      return { ok: false, error: 'Solver failed to produce a finite psychrometric state' };
    }
    if (T < -100 || T > 200) {
      return { ok: false, error: `Resulting dry-bulb temperature (${T.toFixed(2)} °C) is outside [-100, 200] °C` };
    }
    const wsFinal = wsat_at(T, pPa);
    if (w < -1e-6 || w > wsFinal * 1.001 + 1e-7) {
      return { ok: false, error: 'Solved state is not physically realizable (outside 0..100% RH)' };
    }

    const st = stateFromTw(T, _clamp(w, 0, wsFinal), pPa);
    if (st.Twb > st.T + 0.01 || st.Tdp > st.T + 0.01) {
      return { ok: false, error: 'Solved state violates Twb <= Tdb and Tdp <= Tdb' };
    }

    return { ok: true, state: st };
  }

  /* ---- Airflow Mass / Volumetric Conversions ---- */
  function _normalizeFlowUnit(unit) {
    const u = String(unit || 'kgps').trim();
    const ul = u.toLowerCase();
    if (ul === 'kgps' || ul === 'kgs' || ul === 'kg/s') return 'kgps';
    if (ul === 'lps' || ul === 'l/s') return 'Lps';
    if (ul === 'm3h' || ul === 'm3/h' || ul === 'm³/h') return 'm3h';
    if (ul === 'cfm' || ul === 'ft3/min' || ul === 'ft³/min') return 'cfm';
    if (ul === 'lbps' || ul === 'lbs' || ul === 'lb/s') return 'lbps';
    if (ul === 'm3s' || ul === 'm3/s' || ul === 'm³/s') return 'm3s';
    return 'kgps';
  }

  /**
   * Converts airflow rate in 'kgps', 'Lps', 'm3h', 'cfm', or 'lbps' to dry-air mass flow (kg_da/s).
   */
  function flowToMassKgps(val, unit, Tc, w, pPa = P_STD) {
    if (!Number.isFinite(val)) return NaN;
    const u = _normalizeFlowUnit(unit);
    if (u === 'kgps') return val;
    if (u === 'lbps') return val / LB_PER_KG;
    const v = v_m3kg(Tc, w, pPa);
    if (u === 'Lps') return (val * 0.001) / v;
    if (u === 'm3h') return (val / 3600) / v;
    if (u === 'cfm') return (val / CFM_PER_M3S) / v;
    if (u === 'm3s') return val / v;
    return val;
  }

  /**
   * Exact inverse of flowToMassKgps: converts dry-air mass flow (kg_da/s) to target flow unit.
   */
  function massKgpsToFlow(mKgps, unit, Tc, w, pPa = P_STD) {
    if (!Number.isFinite(mKgps)) return NaN;
    const u = _normalizeFlowUnit(unit);
    if (u === 'kgps') return mKgps;
    if (u === 'lbps') return mKgps * LB_PER_KG;
    const v = v_m3kg(Tc, w, pPa);
    if (u === 'Lps') return mKgps * v * 1000;
    if (u === 'm3h') return mKgps * v * 3600;
    if (u === 'cfm') return mKgps * v * CFM_PER_M3S;
    if (u === 'm3s') return mKgps * v;
    return mKgps;
  }

  /* ---- Formatted Property Output ---- */
  function fmtVal(prop, state, units = 'SI') {
    if (!state || typeof prop !== 'string') return '—';
    const isIP = units === 'IP';
    const p = prop.trim();
    const pl = p.toLowerCase();

    if (pl === 'tdb' || pl === 't') {
      if (!Number.isFinite(state.T)) return '—';
      return isIP ? `${(state.T * 1.8 + 32).toFixed(2)} °F` : `${state.T.toFixed(2)} °C`;
    }
    if (pl === 'twb') {
      if (!Number.isFinite(state.Twb)) return '—';
      return isIP ? `${(state.Twb * 1.8 + 32).toFixed(2)} °F` : `${state.Twb.toFixed(2)} °C`;
    }
    if (pl === 'tdp') {
      if (!Number.isFinite(state.Tdp)) return '—';
      return isIP ? `${(state.Tdp * 1.8 + 32).toFixed(2)} °F` : `${state.Tdp.toFixed(2)} °C`;
    }
    if (pl === 'rh') {
      if (!Number.isFinite(state.rh)) return '—';
      return `${state.rh.toFixed(1)} %`;
    }
    if (pl === 'rh01') {
      if (!Number.isFinite(state.rh01)) return '—';
      return `${(state.rh01 * 100).toFixed(1)} %`;
    }
    if (pl === 'w') {
      if (!Number.isFinite(state.w)) return '—';
      return isIP
        ? `${(state.w * GRAINS_PER_LB).toFixed(1)} gr/lb`
        : `${(state.w * 1000).toFixed(2)} g/kg`;
    }
    if (pl === 'h') {
      const val = isIP ? state.hIP : state.h;
      if (!Number.isFinite(val)) return '—';
      return isIP ? `${val.toFixed(2)} Btu/lb` : `${val.toFixed(2)} kJ/kg`;
    }
    if (pl === 'v') {
      const val = isIP ? state.vIP : state.v;
      if (!Number.isFinite(val)) return '—';
      return isIP ? `${val.toFixed(3)} ft³/lb` : `${val.toFixed(4)} m³/kg`;
    }
    if (pl === 'pv') {
      if (!Number.isFinite(state.pv)) return '—';
      return isIP
        ? `${(state.pv / 1000 / KPA_PER_PSI).toFixed(4)} psia`
        : `${(state.pv / 1000).toFixed(3)} kPa`;
    }
    if (pl === 'pws') {
      if (!Number.isFinite(state.pws)) return '—';
      return isIP
        ? `${(state.pws / 1000 / KPA_PER_PSI).toFixed(4)} psia`
        : `${(state.pws / 1000).toFixed(3)} kPa`;
    }
    if (pl === 'ppa' || pl === 'p') {
      if (!Number.isFinite(state.pPa)) return '—';
      return isIP
        ? `${(state.pPa / 1000 / KPA_PER_PSI).toFixed(3)} psia`
        : `${(state.pPa / 1000).toFixed(2)} kPa`;
    }
    if (pl === 'rhodry' || pl === 'rho') {
      const val = isIP ? state.rhoDryIP : state.rhoDry;
      if (!Number.isFinite(val)) return '—';
      return isIP ? `${val.toFixed(4)} lb/ft³` : `${val.toFixed(4)} kg/m³`;
    }
    if (pl === 'rhomoist') {
      const val = isIP ? state.rhoMoistIP : state.rhoMoist;
      if (!Number.isFinite(val)) return '—';
      return isIP ? `${val.toFixed(4)} lb/ft³` : `${val.toFixed(4)} kg/m³`;
    }
    if (pl === 'mu') {
      if (!Number.isFinite(state.mu)) return '—';
      return `${(state.mu * 100).toFixed(1)} %`;
    }
    if (pl === 'cpm') {
      if (!Number.isFinite(state.cpm)) return '—';
      return isIP
        ? `${(state.cpm * CP_IP_PER_SI).toFixed(4)} Btu/(lb·°F)`
        : `${state.cpm.toFixed(3)} kJ/(kg·K)`;
    }
    return '—';
  }

  return {
    // Constants
    Rda,
    Rv,
    P_STD,
    MW_RATIO,
    GRAINS_PER_LB,
    KPA_PER_PSI,
    FT3_PER_M3,
    LB_PER_KG,
    BTU_PER_KJ,
    BTU_LB_PER_KJ_KG,
    BTUH_PER_KW,
    KW_PER_TON,
    BTUH_PER_TON,
    GPM_WATER_PER_KGS,

    // Core Psychrometric Physics
    p_ws_Pa,
    baroPa,
    invBaroAlt_m,
    w_from_pv,
    pv_from_w,
    wsat_at,
    h_kJkg,
    h_Btulb,
    h_kJkg_from_Btulb,
    dh_Btulb,
    v_m3kg,
    rho_dry,
    rho_moist,
    cp_moist,
    RH_from_Tw,
    mu_from_Tw,
    dewpoint_from_pv,
    w_from_Tdp,
    w_from_TRH,
    w_from_TTwb,
    twb_from_Tw,
    Tdb_from_wh,
    stateFromTw,

    // Universal Any-2-of-8 Solver
    solveState,

    // Airflow & Formatting
    flowToMassKgps,
    massKgpsToFlow,
    fmtVal
  };
})();
