/* ============================================================================
   PsychroChart Ultra 3.0 — Weather, Global Climate Database,
   EPW / CSV Parser & Annual Psychrometric Bin Analytics Engine

   All internal thermodynamics and state coordinates are STRICTLY SI:
     - T   : Dry-bulb temperature (°C)
     - w   : Humidity ratio (kg_w / kg_da)
     - pPa : Barometric pressure (Pa)
     - rh  : Relative humidity in weather records (0..100 %)
     - month: 1..12, hour: 1..24 (EnergyPlus EPW convention)

   Zero external dependencies. Deterministic seeded TMY synthesizer.
   All internal helpers are encapsulated inside the Weather IIFE so single-file
   bundling cannot produce top-level identifier collisions.
   ============================================================================ */

import { Psy } from './psychro.js';
import { Comfort } from './comfort.js';

export const Weather = (() => {
  'use strict';

  /* --------------------------------------------------------------------------
     Internal Constants & Defensive Psy Adapters
     -------------------------------------------------------------------------- */
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const REGIONS = [
    'Middle East & Africa',
    'North America',
    'Europe',
    'Asia-Pacific',
    'South America'
  ];

  let wFromTRHScale = null; // lazily probed: 'frac' (0..1) | 'pct' (0..100) | 'fallback'

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function roundTo(v, dec) {
    if (!Number.isFinite(v)) return NaN;
    const f = Math.pow(10, dec);
    return Math.round(v * f) / f;
  }

  function baroPaFromElev(elev_m) {
    const e = Number.isFinite(elev_m) ? clamp(elev_m, -500, 9000) : 0;
    return Psy.baroPa(e);
  }

  function wsatAt(T, pPa) {
    if (typeof Psy.wsat_at === 'function') {
      const ws = Psy.wsat_at(T, pPa);
      if (Number.isFinite(ws) && ws >= 0) return ws;
    }
    const pws = Psy.p_ws_Pa(T);
    return Psy.w_from_pv(Math.min(pws, pPa * 0.999), pPa);
  }

  function wFromTRH(T, rhFrac, pPa) {
    const r = clamp(rhFrac, 0, 1);
    if (wFromTRHScale === null) {
      if (typeof Psy.w_from_TRH === 'function') {
        try {
          const probeFrac = Psy.w_from_TRH(20, 0.5, 101325);
          if (Number.isFinite(probeFrac) && probeFrac > 0.004 && probeFrac < 0.012) {
            wFromTRHScale = 'frac';
          } else {
            const probePct = Psy.w_from_TRH(20, 50, 101325);
            wFromTRHScale = (Number.isFinite(probePct) && probePct > 0.004 && probePct < 0.012)
              ? 'pct'
              : 'fallback';
          }
        } catch (_) {
          wFromTRHScale = 'fallback';
        }
      } else {
        wFromTRHScale = 'fallback';
      }
    }
    let w;
    if (wFromTRHScale === 'frac') {
      w = Psy.w_from_TRH(T, r, pPa);
    } else if (wFromTRHScale === 'pct') {
      w = Psy.w_from_TRH(T, r * 100, pPa);
    } else {
      const pv = Math.min(pPa * 0.999, Psy.p_ws_Pa(T) * r);
      w = Psy.w_from_pv(pv, pPa);
    }
    if (!Number.isFinite(w) || w < 0) w = 0;
    return Math.min(w, wsatAt(T, pPa));
  }

  function wFromTdp(Tdp, pPa) {
    let w;
    if (typeof Psy.w_from_Tdp === 'function') {
      w = Psy.w_from_Tdp(Tdp, pPa);
    } else {
      w = Psy.w_from_pv(Math.min(Psy.p_ws_Pa(Tdp), pPa * 0.999), pPa);
    }
    return (Number.isFinite(w) && w > 0) ? w : 0;
  }

  /**
   * Exact ASHRAE Fundamentals (2021, Ch. 1, Eqs. 35 & 37) humidity ratio from (Tdb, Twb, pPa).
   */
  function wFromTTwb(Tdb, Twb, pPa) {
    const twb = Math.min(Twb, Tdb);
    if (typeof Psy.w_from_TTwb === 'function') {
      const wPsy = Psy.w_from_TTwb(Tdb, twb, pPa);
      if (Number.isFinite(wPsy) && wPsy >= 0) {
        return Math.min(wPsy, wsatAt(Tdb, pPa));
      }
    }
    const wsStar = wsatAt(twb, pPa);
    let w;
    if (twb >= 0) {
      w = ((2501 - 2.326 * twb) * wsStar - 1.006 * (Tdb - twb)) /
          (2501 + 1.86 * Tdb - 4.186 * twb);
    } else {
      w = ((2830 - 0.24 * twb) * wsStar - 1.006 * (Tdb - twb)) /
          (2830 + 1.86 * Tdb - 2.1 * twb);
    }
    const wsTdb = wsatAt(Tdb, pPa);
    return clamp(Number.isFinite(w) ? w : 0, Math.min(0.00005, wsTdb), wsTdb);
  }

  function rhFracFromTw(T, w, pPa) {
    const val = Psy.RH_from_Tw(T, w, pPa);
    if (!Number.isFinite(val)) return 0;
    return clamp(val > 1.01 ? val / 100 : val, 0, 1);
  }

  function twbFromTw(T, w, pPa) {
    if (typeof Psy.twb_from_Tw === 'function') {
      return Psy.twb_from_Tw(T, w, pPa);
    }
    // Fallback bisection along constant enthalpy line
    const h = Psy.h_kJkg(T, w);
    let lo = -50;
    let hi = Math.min(T + 0.5, 80);
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      const ws = wsatAt(mid, pPa);
      if (Psy.h_kJkg(mid, ws) > h) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  /* --------------------------------------------------------------------------
     Deterministic Seeded PRNG (FNV-1a hash + Mulberry32 + Box-Muller Normal)
     -------------------------------------------------------------------------- */
  function hashString32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function createMulberry32(seed) {
    let a = seed >>> 0;
    return function nextUniform() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createNormalGenerator(rng) {
    let spare = null;
    return function nextNormal() {
      if (spare !== null) {
        const out = spare;
        spare = null;
        return out;
      }
      let u1 = 0;
      while (u1 <= 1e-12) u1 = rng();
      const u2 = rng();
      const mag = Math.sqrt(-2.0 * Math.log(u1));
      const ang = 2.0 * Math.PI * u2;
      spare = mag * Math.sin(ang);
      return mag * Math.cos(ang);
    };
  }

  function hourIndexToMonthHour(idx) {
    const dayOfYear = Math.floor(idx / 24) % 365;
    const hour = (idx % 24) + 1;
    let rem = dayOfYear;
    for (let m = 0; m < 12; m++) {
      if (rem < MONTH_DAYS[m]) return { month: m + 1, hour };
      rem -= MONTH_DAYS[m];
    }
    return { month: 12, hour };
  }

  /* --------------------------------------------------------------------------
     1. Curated Global Climate Database (47 Major Cities, ASHRAE Zones 0A–8)
     Data aligned with ASHRAE Handbook — Fundamentals Climatic Design Tables.
     meanRH is stored as annual average relative humidity (%).
     dailyAmpT is mean diurnal half-amplitude (°C; daily swing ≈ 2 * dailyAmpT).
     -------------------------------------------------------------------------- */
  const CITIES = [
    // --- Middle East & Africa (10) ---
    {
      id: 'dubai', name: 'Dubai', country: 'UAE', region: 'Middle East & Africa',
      climateZone: '0B', elev_m: 5, lat: 25.25, lon: 55.36,
      summer04: { Tdb: 44.1, Twb: 24.4 }, summer1: { Tdb: 42.8, Twb: 24.9 }, winter996: { Tdb: 12.1 },
      annualMeanT: 28.0, annualAmpT: 8.6, dailyAmpT: 5.4, meanRH: 56
    },
    {
      id: 'riyadh', name: 'Riyadh', country: 'Saudi Arabia', region: 'Middle East & Africa',
      climateZone: '0B', elev_m: 612, lat: 24.96, lon: 46.70,
      summer04: { Tdb: 45.6, Twb: 19.3 }, summer1: { Tdb: 44.5, Twb: 19.1 }, winter996: { Tdb: 4.7 },
      annualMeanT: 26.5, annualAmpT: 11.4, dailyAmpT: 7.4, meanRH: 26
    },
    {
      id: 'abu_dhabi', name: 'Abu Dhabi', country: 'UAE', region: 'Middle East & Africa',
      climateZone: '0B', elev_m: 27, lat: 24.43, lon: 54.65,
      summer04: { Tdb: 45.2, Twb: 24.2 }, summer1: { Tdb: 43.9, Twb: 24.8 }, winter996: { Tdb: 11.2 },
      annualMeanT: 27.9, annualAmpT: 8.7, dailyAmpT: 5.8, meanRH: 55
    },
    {
      id: 'doha', name: 'Doha', country: 'Qatar', region: 'Middle East & Africa',
      climateZone: '0B', elev_m: 11, lat: 25.26, lon: 51.57,
      summer04: { Tdb: 45.1, Twb: 24.1 }, summer1: { Tdb: 43.9, Twb: 24.5 }, winter996: { Tdb: 10.9 },
      annualMeanT: 27.9, annualAmpT: 9.6, dailyAmpT: 5.5, meanRH: 54
    },
    {
      id: 'cairo', name: 'Cairo', country: 'Egypt', region: 'Middle East & Africa',
      climateZone: '2B', elev_m: 116, lat: 30.12, lon: 31.41,
      summer04: { Tdb: 38.6, Twb: 20.9 }, summer1: { Tdb: 36.8, Twb: 20.8 }, winter996: { Tdb: 7.2 },
      annualMeanT: 22.1, annualAmpT: 7.4, dailyAmpT: 6.2, meanRH: 55
    },
    {
      id: 'amman', name: 'Amman', country: 'Jordan', region: 'Middle East & Africa',
      climateZone: '3B', elev_m: 779, lat: 31.97, lon: 35.99,
      summer04: { Tdb: 36.1, Twb: 18.8 }, summer1: { Tdb: 34.4, Twb: 18.5 }, winter996: { Tdb: 1.0 },
      annualMeanT: 17.8, annualAmpT: 9.2, dailyAmpT: 6.5, meanRH: 48
    },
    {
      id: 'jeddah', name: 'Jeddah', country: 'Saudi Arabia', region: 'Middle East & Africa',
      climateZone: '0B', elev_m: 15, lat: 21.68, lon: 39.16,
      summer04: { Tdb: 42.1, Twb: 24.4 }, summer1: { Tdb: 40.3, Twb: 25.1 }, winter996: { Tdb: 16.0 },
      annualMeanT: 28.9, annualAmpT: 4.5, dailyAmpT: 5.4, meanRH: 61
    },
    {
      id: 'nairobi', name: 'Nairobi', country: 'Kenya', region: 'Middle East & Africa',
      climateZone: '3A', elev_m: 1624, lat: -1.32, lon: 36.93,
      summer04: { Tdb: 29.8, Twb: 17.6 }, summer1: { Tdb: 28.9, Twb: 17.5 }, winter996: { Tdb: 9.8 },
      annualMeanT: 19.3, annualAmpT: 1.8, dailyAmpT: 5.6, meanRH: 68
    },
    {
      id: 'johannesburg', name: 'Johannesburg', country: 'South Africa', region: 'Middle East & Africa',
      climateZone: '3B', elev_m: 1694, lat: -26.14, lon: 28.25,
      summer04: { Tdb: 30.1, Twb: 17.1 }, summer1: { Tdb: 28.9, Twb: 16.9 }, winter996: { Tdb: 1.2 },
      annualMeanT: 16.2, annualAmpT: 5.2, dailyAmpT: 6.4, meanRH: 58
    },
    {
      id: 'casablanca', name: 'Casablanca', country: 'Morocco', region: 'Middle East & Africa',
      climateZone: '3A', elev_m: 57, lat: 33.56, lon: -7.66,
      summer04: { Tdb: 31.1, Twb: 21.6 }, summer1: { Tdb: 29.1, Twb: 21.5 }, winter996: { Tdb: 6.2 },
      annualMeanT: 18.2, annualAmpT: 4.9, dailyAmpT: 4.4, meanRH: 77
    },

    // --- North America (14) ---
    {
      id: 'new_york', name: 'New York', country: 'USA', region: 'North America',
      climateZone: '4A', elev_m: 7, lat: 40.64, lon: -73.78,
      summer04: { Tdb: 33.4, Twb: 23.6 }, summer1: { Tdb: 31.5, Twb: 22.9 }, winter996: { Tdb: -10.8 },
      annualMeanT: 12.6, annualAmpT: 11.8, dailyAmpT: 4.5, meanRH: 65
    },
    {
      id: 'miami', name: 'Miami', country: 'USA', region: 'North America',
      climateZone: '1A', elev_m: 9, lat: 25.80, lon: -80.29,
      summer04: { Tdb: 33.6, Twb: 25.4 }, summer1: { Tdb: 32.8, Twb: 25.2 }, winter996: { Tdb: 8.9 },
      annualMeanT: 24.9, annualAmpT: 4.3, dailyAmpT: 3.8, meanRH: 73
    },
    {
      id: 'phoenix', name: 'Phoenix', country: 'USA', region: 'North America',
      climateZone: '2B', elev_m: 337, lat: 33.43, lon: -112.01,
      summer04: { Tdb: 43.4, Twb: 21.1 }, summer1: { Tdb: 42.1, Twb: 20.9 }, winter996: { Tdb: 3.7 },
      annualMeanT: 23.9, annualAmpT: 11.4, dailyAmpT: 6.9, meanRH: 35
    },
    {
      id: 'denver', name: 'Denver', country: 'USA', region: 'North America',
      climateZone: '5B', elev_m: 1609, lat: 39.86, lon: -104.67,
      summer04: { Tdb: 34.4, Twb: 15.7 }, summer1: { Tdb: 32.8, Twb: 15.5 }, winter996: { Tdb: -17.3 },
      annualMeanT: 10.2, annualAmpT: 11.8, dailyAmpT: 7.6, meanRH: 51
    },
    {
      id: 'chicago', name: 'Chicago', country: 'USA', region: 'North America',
      climateZone: '5A', elev_m: 205, lat: 41.98, lon: -87.90,
      summer04: { Tdb: 33.2, Twb: 23.7 }, summer1: { Tdb: 31.3, Twb: 22.8 }, winter996: { Tdb: -18.7 },
      annualMeanT: 10.0, annualAmpT: 13.7, dailyAmpT: 5.0, meanRH: 69
    },
    {
      id: 'houston', name: 'Houston', country: 'USA', region: 'North America',
      climateZone: '2A', elev_m: 29, lat: 29.98, lon: -95.34,
      summer04: { Tdb: 36.1, Twb: 25.0 }, summer1: { Tdb: 34.9, Twb: 24.9 }, winter996: { Tdb: -1.1 },
      annualMeanT: 20.7, annualAmpT: 8.6, dailyAmpT: 5.4, meanRH: 74
    },
    {
      id: 'seattle', name: 'Seattle', country: 'USA', region: 'North America',
      climateZone: '4C', elev_m: 137, lat: 47.45, lon: -122.31,
      summer04: { Tdb: 29.9, Twb: 18.6 }, summer1: { Tdb: 27.7, Twb: 17.8 }, winter996: { Tdb: -4.2 },
      annualMeanT: 11.2, annualAmpT: 7.0, dailyAmpT: 4.5, meanRH: 75
    },
    {
      id: 'los_angeles', name: 'Los Angeles', country: 'USA', region: 'North America',
      climateZone: '3B', elev_m: 38, lat: 33.94, lon: -118.41,
      summer04: { Tdb: 29.5, Twb: 19.6 }, summer1: { Tdb: 27.2, Twb: 19.4 }, winter996: { Tdb: 6.7 },
      annualMeanT: 17.2, annualAmpT: 3.6, dailyAmpT: 4.0, meanRH: 71
    },
    {
      id: 'toronto', name: 'Toronto', country: 'Canada', region: 'North America',
      climateZone: '5A', elev_m: 173, lat: 43.68, lon: -79.63,
      summer04: { Tdb: 31.7, Twb: 22.8 }, summer1: { Tdb: 29.9, Twb: 21.9 }, winter996: { Tdb: -18.2 },
      annualMeanT: 8.5, annualAmpT: 13.4, dailyAmpT: 5.1, meanRH: 71
    },
    {
      id: 'mexico_city', name: 'Mexico City', country: 'Mexico', region: 'North America',
      climateZone: '3B', elev_m: 2240, lat: 19.43, lon: -99.07,
      summer04: { Tdb: 28.9, Twb: 14.3 }, summer1: { Tdb: 27.8, Twb: 14.2 }, winter996: { Tdb: 4.1 },
      annualMeanT: 16.6, annualAmpT: 2.8, dailyAmpT: 6.7, meanRH: 58
    },
    {
      id: 'anchorage', name: 'Anchorage', country: 'USA', region: 'North America',
      climateZone: '7', elev_m: 40, lat: 61.17, lon: -150.02,
      summer04: { Tdb: 22.3, Twb: 14.9 }, summer1: { Tdb: 20.4, Twb: 14.0 }, winter996: { Tdb: -23.7 },
      annualMeanT: 2.7, annualAmpT: 11.8, dailyAmpT: 3.9, meanRH: 71
    },
    {
      id: 'fairbanks', name: 'Fairbanks', country: 'USA', region: 'North America',
      climateZone: '8', elev_m: 133, lat: 64.82, lon: -147.86,
      summer04: { Tdb: 27.9, Twb: 16.5 }, summer1: { Tdb: 25.9, Twb: 15.7 }, winter996: { Tdb: -41.9 },
      annualMeanT: -2.4, annualAmpT: 19.8, dailyAmpT: 5.6, meanRH: 67
    },
    {
      id: 'las_vegas', name: 'Las Vegas', country: 'USA', region: 'North America',
      climateZone: '3B', elev_m: 664, lat: 36.08, lon: -115.15,
      summer04: { Tdb: 42.9, Twb: 18.8 }, summer1: { Tdb: 41.5, Twb: 18.6 }, winter996: { Tdb: -0.7 },
      annualMeanT: 20.4, annualAmpT: 13.0, dailyAmpT: 6.8, meanRH: 29
    },
    {
      id: 'atlanta', name: 'Atlanta', country: 'USA', region: 'North America',
      climateZone: '3A', elev_m: 313, lat: 33.64, lon: -84.43,
      summer04: { Tdb: 34.4, Twb: 23.6 }, summer1: { Tdb: 33.0, Twb: 23.3 }, winter996: { Tdb: -6.2 },
      annualMeanT: 16.9, annualAmpT: 10.1, dailyAmpT: 5.4, meanRH: 68
    },

    // --- Europe (10) ---
    {
      id: 'london', name: 'London', country: 'UK', region: 'Europe',
      climateZone: '4A', elev_m: 25, lat: 51.48, lon: -0.45,
      summer04: { Tdb: 28.5, Twb: 19.4 }, summer1: { Tdb: 26.4, Twb: 18.5 }, winter996: { Tdb: -3.2 },
      annualMeanT: 11.4, annualAmpT: 6.8, dailyAmpT: 4.1, meanRH: 77
    },
    {
      id: 'paris', name: 'Paris', country: 'France', region: 'Europe',
      climateZone: '4A', elev_m: 89, lat: 48.72, lon: 2.38,
      summer04: { Tdb: 31.3, Twb: 20.5 }, summer1: { Tdb: 29.0, Twb: 19.6 }, winter996: { Tdb: -5.2 },
      annualMeanT: 11.7, annualAmpT: 8.1, dailyAmpT: 4.4, meanRH: 76
    },
    {
      id: 'berlin', name: 'Berlin', country: 'Germany', region: 'Europe',
      climateZone: '5A', elev_m: 37, lat: 52.56, lon: 13.29,
      summer04: { Tdb: 30.8, Twb: 19.7 }, summer1: { Tdb: 28.6, Twb: 18.9 }, winter996: { Tdb: -10.5 },
      annualMeanT: 9.9, annualAmpT: 9.7, dailyAmpT: 4.6, meanRH: 75
    },
    {
      id: 'madrid', name: 'Madrid', country: 'Spain', region: 'Europe',
      climateZone: '4B', elev_m: 609, lat: 40.47, lon: -3.56,
      summer04: { Tdb: 37.3, Twb: 20.1 }, summer1: { Tdb: 35.6, Twb: 19.7 }, winter996: { Tdb: -3.0 },
      annualMeanT: 15.0, annualAmpT: 10.0, dailyAmpT: 6.8, meanRH: 57
    },
    {
      id: 'rome', name: 'Rome', country: 'Italy', region: 'Europe',
      climateZone: '3A', elev_m: 3, lat: 41.80, lon: 12.24,
      summer04: { Tdb: 32.3, Twb: 22.8 }, summer1: { Tdb: 30.7, Twb: 22.4 }, winter996: { Tdb: 0.4 },
      annualMeanT: 16.0, annualAmpT: 8.3, dailyAmpT: 5.0, meanRH: 73
    },
    {
      id: 'stockholm', name: 'Stockholm', country: 'Sweden', region: 'Europe',
      climateZone: '6A', elev_m: 61, lat: 59.65, lon: 17.95,
      summer04: { Tdb: 26.8, Twb: 17.9 }, summer1: { Tdb: 24.8, Twb: 17.1 }, winter996: { Tdb: -16.9 },
      annualMeanT: 6.4, annualAmpT: 10.7, dailyAmpT: 4.3, meanRH: 79
    },
    {
      id: 'zurich', name: 'Zurich', country: 'Switzerland', region: 'Europe',
      climateZone: '5A', elev_m: 432, lat: 47.46, lon: 8.55,
      summer04: { Tdb: 29.8, Twb: 19.6 }, summer1: { Tdb: 27.8, Twb: 18.8 }, winter996: { Tdb: -9.8 },
      annualMeanT: 9.4, annualAmpT: 9.5, dailyAmpT: 4.9, meanRH: 77
    },
    {
      id: 'athens', name: 'Athens', country: 'Greece', region: 'Europe',
      climateZone: '3A', elev_m: 94, lat: 37.94, lon: 23.95,
      summer04: { Tdb: 36.1, Twb: 21.1 }, summer1: { Tdb: 34.4, Twb: 20.9 }, winter996: { Tdb: 2.3 },
      annualMeanT: 18.4, annualAmpT: 9.4, dailyAmpT: 5.1, meanRH: 61
    },
    {
      id: 'istanbul', name: 'Istanbul', country: 'Turkey', region: 'Europe',
      climateZone: '4A', elev_m: 49, lat: 40.98, lon: 28.82,
      summer04: { Tdb: 31.6, Twb: 22.4 }, summer1: { Tdb: 30.2, Twb: 22.1 }, winter996: { Tdb: -1.6 },
      annualMeanT: 14.8, annualAmpT: 9.6, dailyAmpT: 4.0, meanRH: 74
    },
    {
      id: 'moscow', name: 'Moscow', country: 'Russia', region: 'Europe',
      climateZone: '6A', elev_m: 192, lat: 55.97, lon: 37.41,
      summer04: { Tdb: 29.6, Twb: 19.4 }, summer1: { Tdb: 27.4, Twb: 18.5 }, winter996: { Tdb: -23.4 },
      annualMeanT: 5.4, annualAmpT: 14.5, dailyAmpT: 4.5, meanRH: 77
    },

    // --- Asia-Pacific (11) ---
    {
      id: 'singapore', name: 'Singapore', country: 'Singapore', region: 'Asia-Pacific',
      climateZone: '0A', elev_m: 16, lat: 1.37, lon: 103.98,
      summer04: { Tdb: 33.4, Twb: 26.2 }, summer1: { Tdb: 32.8, Twb: 26.1 }, winter996: { Tdb: 23.2 },
      annualMeanT: 27.7, annualAmpT: 0.9, dailyAmpT: 3.1, meanRH: 82
    },
    {
      id: 'tokyo', name: 'Tokyo', country: 'Japan', region: 'Asia-Pacific',
      climateZone: '4A', elev_m: 11, lat: 35.55, lon: 139.78,
      summer04: { Tdb: 33.5, Twb: 25.9 }, summer1: { Tdb: 32.1, Twb: 25.6 }, winter996: { Tdb: 0.9 },
      annualMeanT: 16.4, annualAmpT: 10.6, dailyAmpT: 3.8, meanRH: 67
    },
    {
      id: 'hong_kong', name: 'Hong Kong', country: 'China', region: 'Asia-Pacific',
      climateZone: '1A', elev_m: 9, lat: 22.31, lon: 113.92,
      summer04: { Tdb: 33.7, Twb: 26.5 }, summer1: { Tdb: 32.9, Twb: 26.4 }, winter996: { Tdb: 9.8 },
      annualMeanT: 23.5, annualAmpT: 6.4, dailyAmpT: 2.9, meanRH: 78
    },
    {
      id: 'mumbai', name: 'Mumbai', country: 'India', region: 'Asia-Pacific',
      climateZone: '0A', elev_m: 14, lat: 19.09, lon: 72.87,
      summer04: { Tdb: 36.2, Twb: 24.4 }, summer1: { Tdb: 35.1, Twb: 25.3 }, winter996: { Tdb: 16.5 },
      annualMeanT: 27.6, annualAmpT: 3.2, dailyAmpT: 4.4, meanRH: 74
    },
    {
      id: 'new_delhi', name: 'New Delhi', country: 'India', region: 'Asia-Pacific',
      climateZone: '1B', elev_m: 216, lat: 28.57, lon: 77.11,
      summer04: { Tdb: 42.9, Twb: 24.1 }, summer1: { Tdb: 41.5, Twb: 24.4 }, winter996: { Tdb: 5.5 },
      annualMeanT: 25.2, annualAmpT: 10.3, dailyAmpT: 6.4, meanRH: 58
    },
    {
      id: 'bangkok', name: 'Bangkok', country: 'Thailand', region: 'Asia-Pacific',
      climateZone: '0A', elev_m: 2, lat: 13.91, lon: 100.61,
      summer04: { Tdb: 36.8, Twb: 26.4 }, summer1: { Tdb: 35.9, Twb: 26.4 }, winter996: { Tdb: 19.0 },
      annualMeanT: 28.9, annualAmpT: 2.4, dailyAmpT: 4.3, meanRH: 73
    },
    {
      id: 'beijing', name: 'Beijing', country: 'China', region: 'Asia-Pacific',
      climateZone: '4A', elev_m: 35, lat: 40.08, lon: 116.59,
      summer04: { Tdb: 35.1, Twb: 23.6 }, summer1: { Tdb: 33.4, Twb: 23.1 }, winter996: { Tdb: -12.8 },
      annualMeanT: 12.8, annualAmpT: 15.6, dailyAmpT: 5.8, meanRH: 54
    },
    {
      id: 'sydney', name: 'Sydney', country: 'Australia', region: 'Asia-Pacific',
      climateZone: '3A', elev_m: 6, lat: -33.95, lon: 151.18,
      summer04: { Tdb: 33.3, Twb: 21.4 }, summer1: { Tdb: 30.8, Twb: 21.1 }, winter996: { Tdb: 5.7 },
      annualMeanT: 18.1, annualAmpT: 5.4, dailyAmpT: 4.4, meanRH: 68
    },
    {
      id: 'melbourne', name: 'Melbourne', country: 'Australia', region: 'Asia-Pacific',
      climateZone: '3C', elev_m: 132, lat: -37.67, lon: 144.84,
      summer04: { Tdb: 35.8, Twb: 19.2 }, summer1: { Tdb: 32.8, Twb: 18.6 }, winter996: { Tdb: 2.9 },
      annualMeanT: 14.9, annualAmpT: 5.5, dailyAmpT: 5.1, meanRH: 66
    },
    {
      id: 'seoul', name: 'Seoul', country: 'South Korea', region: 'Asia-Pacific',
      climateZone: '4A', elev_m: 86, lat: 37.57, lon: 126.97,
      summer04: { Tdb: 32.8, Twb: 25.0 }, summer1: { Tdb: 31.3, Twb: 24.4 }, winter996: { Tdb: -12.0 },
      annualMeanT: 12.6, annualAmpT: 14.0, dailyAmpT: 4.4, meanRH: 65
    },
    {
      id: 'auckland', name: 'Auckland', country: 'New Zealand', region: 'Asia-Pacific',
      climateZone: '3C', elev_m: 7, lat: -37.01, lon: 174.79,
      summer04: { Tdb: 25.4, Twb: 20.1 }, summer1: { Tdb: 24.4, Twb: 19.7 }, winter996: { Tdb: 3.1 },
      annualMeanT: 15.5, annualAmpT: 4.5, dailyAmpT: 3.8, meanRH: 79
    },

    // --- South America (2) ---
    {
      id: 'sao_paulo', name: 'Sao Paulo', country: 'Brazil', region: 'South America',
      climateZone: '2A', elev_m: 792, lat: -23.63, lon: -46.66,
      summer04: { Tdb: 32.1, Twb: 21.1 }, summer1: { Tdb: 30.8, Twb: 20.9 }, winter996: { Tdb: 8.6 },
      annualMeanT: 19.8, annualAmpT: 3.5, dailyAmpT: 4.9, meanRH: 74
    },
    {
      id: 'bogota', name: 'Bogota', country: 'Colombia', region: 'South America',
      climateZone: '4C', elev_m: 2556, lat: 4.70, lon: -74.15,
      summer04: { Tdb: 22.1, Twb: 13.7 }, summer1: { Tdb: 21.2, Twb: 13.5 }, winter996: { Tdb: 3.1 },
      annualMeanT: 13.5, annualAmpT: 0.6, dailyAmpT: 5.5, meanRH: 77
    }
  ];

  const CITY_BY_ID = new Map();
  const CITY_BY_NAME = new Map();
  for (let i = 0; i < CITIES.length; i++) {
    const c = CITIES[i];
    CITY_BY_ID.set(c.id, c);
    CITY_BY_NAME.set(c.name.toLowerCase(), c);
  }

  /* --------------------------------------------------------------------------
     2. City Lookup & Ready-to-Plot ASHRAE Design State Points
     -------------------------------------------------------------------------- */
  function getCityById(id) {
    if (!id) return null;
    if (typeof id === 'object' && id.id) return CITY_BY_ID.get(id.id) || id;
    const key = String(id).trim().toLowerCase();
    return CITY_BY_ID.get(key) || CITY_BY_NAME.get(key) || null;
  }

  function getCityDesignPoints(city, pPa) {
    const c = typeof city === 'string' ? getCityById(city) : city;
    if (!c) return [];
    const p = (pPa != null && Number.isFinite(pPa) && pPa > 20000)
      ? pPa
      : baroPaFromElev(c.elev_m || 0);

    const wSum04 = wFromTTwb(c.summer04.Tdb, c.summer04.Twb, p);
    const wSum1 = wFromTTwb(c.summer1.Tdb, c.summer1.Twb, p);
    const wWin996 = wFromTRH(c.winter996.Tdb, 0.60, p);

    const elevStr = `${Math.round(c.elev_m || 0)} m`;
    return [
      {
        kind: 'summer04',
        label: `${c.name} Sum 0.4%`,
        shortLabel: 'Sum 0.4%',
        T: roundTo(c.summer04.Tdb, 2),
        w: roundTo(wSum04, 6),
        Twb: roundTo(c.summer04.Twb, 2),
        rh: roundTo(rhFracFromTw(c.summer04.Tdb, wSum04, p) * 100, 1),
        color: '#ef4444',
        note: `ASHRAE 0.4% Cooling: DB ${c.summer04.Tdb.toFixed(1)}°C / MCWB ${c.summer04.Twb.toFixed(1)}°C · Zone ${c.climateZone} · Elev ${elevStr}`
      },
      {
        kind: 'summer1',
        label: `${c.name} Sum 1%`,
        shortLabel: 'Sum 1%',
        T: roundTo(c.summer1.Tdb, 2),
        w: roundTo(wSum1, 6),
        Twb: roundTo(c.summer1.Twb, 2),
        rh: roundTo(rhFracFromTw(c.summer1.Tdb, wSum1, p) * 100, 1),
        color: '#f59e0b',
        note: `ASHRAE 1.0% Cooling: DB ${c.summer1.Tdb.toFixed(1)}°C / MCWB ${c.summer1.Twb.toFixed(1)}°C · Zone ${c.climateZone} · Elev ${elevStr}`
      },
      {
        kind: 'winter996',
        label: `${c.name} Win 99.6%`,
        shortLabel: 'Win 99.6%',
        T: roundTo(c.winter996.Tdb, 2),
        w: roundTo(wWin996, 6),
        Twb: roundTo(twbFromTw(c.winter996.Tdb, wWin996, p), 2),
        rh: 60.0,
        color: '#38bdf8',
        note: `ASHRAE 99.6% Heating: DB ${c.winter996.Tdb.toFixed(1)}°C @ 60% RH ref · Zone ${c.climateZone} · Elev ${elevStr}`
      }
    ];
  }

  /* --------------------------------------------------------------------------
     3. Deterministic 8,760-Hour Synthetic TMY Weather Synthesizer
     -------------------------------------------------------------------------- */
  function generateSyntheticTMY(city) {
    const c = typeof city === 'string' ? getCityById(city) : city;
    if (!c) {
      throw new Error('Weather.generateSyntheticTMY: invalid city');
    }

    const HOURS = 8760;
    const elev_m = Number.isFinite(c.elev_m) ? c.elev_m : 0;
    const pPa = baroPaFromElev(elev_m);
    const lat = Number.isFinite(c.lat) ? c.lat : 30;
    const absLat = Math.abs(lat);
    const hemiSign = lat < 0 ? -1 : 1; // +1 Northern (warm Jul), -1 Southern (warm Jan)
    const eqBlend = clamp(1 - absLat / 12, 0, 1);

    // Deterministic PRNG seeded purely from city identity & coordinates
    const seedStr = `PsyTMY3|${c.id || c.name}|${c.lat}|${c.lon}|${elev_m}`;
    const rng = createMulberry32(hashString32(seedStr));
    const randn = createNormalGenerator(rng);

    // Synoptic AR(1) parameters (multi-day weather fronts + planetary waves + cloud cover)
    const phiFast = Math.exp(-1 / 66);     // ~2.75 day synoptic front persistence
    const phiSlow = Math.exp(-1 / 216);    // ~9 day planetary wave persistence
    const phiCloud = Math.exp(-1 / 28);    // ~1.2 day cloud/clearness persistence
    const phiMoist = Math.exp(-1 / 54);    // ~2.25 day airmass moisture persistence
    const sigFastScale = Math.sqrt(1 - phiFast * phiFast);
    const sigSlowScale = Math.sqrt(1 - phiSlow * phiSlow);
    const sigCloudScale = Math.sqrt(1 - phiCloud * phiCloud);
    const sigMoistScale = Math.sqrt(1 - phiMoist * phiMoist);

    // Synoptic temperature variability scales with seasonality & continental range
    const synAmpT = Math.max(1.1, 0.24 * c.annualAmpT + 0.16 * c.dailyAmpT);
    const slowAmpT = 0.42 * synAmpT;

    // Warm up AR(1) processes for 240 steps to reach stationary equilibrium
    let synFast = 0;
    let synSlow = 0;
    let cloud = 0;
    let synMoist = 0;
    for (let k = 0; k < 240; k++) {
      synFast = phiFast * synFast + sigFastScale * randn();
      synSlow = phiSlow * synSlow + sigSlowScale * randn();
      cloud = phiCloud * cloud + sigCloudScale * randn();
      synMoist = phiMoist * synMoist + sigMoistScale * randn();
    }

    // Pass 1: Synthesize raw hourly dry-bulb temperature and synoptic moisture series
    const rawT = new Float64Array(HOURS);
    const moistWave = new Float64Array(HOURS);
    const synTNorm = new Float64Array(HOURS);
    const diurnalNorm = new Float64Array(HOURS);
    const seasonArr = new Float64Array(HOURS);

    const isArid = (c.climateZone && c.climateZone.endsWith('B')) || (c.meanRH < 52);
    // In coastal/arid hot zones, the very hottest days tend to be drier offshore/desert winds
    const moistTCorr = isArid ? -0.35 : (absLat < 26 ? -0.15 : 0.18);

    let sumRawT = 0;
    for (let i = 0; i < HOURS; i++) {
      const dayFrac = i / 24;
      const hr = i % 24;

      // Update multi-day synoptic processes
      const zT = randn();
      const zS = randn();
      const zC = randn();
      const zM = randn();
      synFast = phiFast * synFast + sigFastScale * zT;
      synSlow = phiSlow * synSlow + sigSlowScale * zS;
      cloud = phiCloud * cloud + sigCloudScale * zC;
      const moistInnov = moistTCorr * zT + Math.sqrt(1 - moistTCorr * moistTCorr) * zM;
      synMoist = phiMoist * synMoist + sigMoistScale * moistInnov;

      // Hemisphere-aware seasonal cycle (coldest mid-Jan N / mid-Jul S; warmest mid-Jul N / mid-Jan S)
      const annualPhase = 2 * Math.PI * (dayFrac - 18) / 365;
      let season = -hemiSign * Math.cos(annualPhase);
      if (eqBlend > 0) {
        // Subtle equatorial semi-annual bimodal shift (peaks near Apr & Oct)
        const semiAnnual = Math.cos(4 * Math.PI * (dayFrac - 105) / 365);
        season = (1 - 0.35 * eqBlend) * season + 0.35 * eqBlend * semiAnnual;
      }
      seasonArr[i] = season;

      // Realistic asymmetric diurnal wave (min ~05:00, max ~15:00)
      const dPhase = 2 * Math.PI * (hr - 4.8) / 24;
      const dWave = (-0.88 * Math.cos(dPhase) - 0.14 * Math.sin(2 * dPhase)) / 0.94;
      diurnalNorm[i] = dWave;

      // Clear-sky modulation + slight summer amplification of diurnal range
      const clearFactor = clamp(1 + 0.24 * cloud, 0.52, 1.45);
      const seasonDiurnal = 1 + 0.14 * clamp(absLat / 45, 0, 1) * season;
      const diurnalT = c.dailyAmpT * clearFactor * seasonDiurnal * dWave;

      // Synoptic frontal anomaly (slightly stronger in winter for mid/high latitudes)
      const winterFrontBoost = 1 + 0.18 * clamp((absLat - 20) / 40, 0, 1) * (-season);
      const synopticT = (synFast * synAmpT + synSlow * slowAmpT) * winterFrontBoost;

      const tVal = c.annualMeanT + c.annualAmpT * season + synopticT + diurnalT;
      rawT[i] = tVal;
      sumRawT += tVal;
      synTNorm[i] = clamp(synFast, -3, 3);
      moistWave[i] = clamp(synMoist, -2.8, 2.8);
    }

    // Pass 2: Calibrate temperature distribution cleanly to ASHRAE annualMeanT, summer04.Tdb, winter996.Tdb
    const meanRawT = sumRawT / HOURS;
    const sortedT = Float64Array.from(rawT).sort();
    const idx004 = Math.floor(HOURS * 0.004); // 35th lowest hour (99.6% heating design)
    const idx996 = Math.floor(HOURS * 0.996); // 35th highest hour (0.4% cooling design)
    const p004Raw = sortedT[idx004];
    const p996Raw = sortedT[idx996];

    const targetHiSpan = Math.max(1.0, c.summer04.Tdb - c.annualMeanT);
    const targetLoSpan = Math.max(1.0, c.annualMeanT - c.winter996.Tdb);
    const rawHiSpan = Math.max(1.0, p996Raw - meanRawT);
    const rawLoSpan = Math.max(1.0, meanRawT - p004Raw);
    const kHi = clamp(targetHiSpan / rawHiSpan, 0.55, 1.85);
    const kLo = clamp(targetLoSpan / rawLoSpan, 0.55, 1.85);

    const calT = new Float64Array(HOURS);
    for (let i = 0; i < HOURS; i++) {
      const dt = rawT[i] - meanRawT;
      const blend = 0.5 * (1 + Math.tanh(dt / 2.5));
      const k = kLo + (kHi - kLo) * blend;
      calT[i] = c.annualMeanT + dt * k;
    }

    // Rolling 24-hour centered air-mass temperature (circular across year boundary)
    // Physically, atmospheric humidity ratio (w) tracks daily air-mass temperature,
    // NOT instantaneous afternoon dry-bulb spikes, giving horizontal diurnal paths.
    const dayMeanT = new Float64Array(HOURS);
    let winSum = 0;
    for (let j = -12; j < 12; j++) {
      winSum += calT[(j + HOURS) % HOURS];
    }
    let minDayT = Infinity;
    let maxDayT = -Infinity;
    for (let i = 0; i < HOURS; i++) {
      const mT = winSum / 24;
      dayMeanT[i] = mT;
      if (mT < minDayT) minDayT = mT;
      if (mT > maxDayT) maxDayT = mT;
      winSum += calT[(i + 12) % HOURS] - calT[(i - 12 + HOURS) % HOURS];
    }

    // Pass 3: Calibrated physical moisture model anchored to summer04 (DB/MCWB) & meanRH
    const targetMeanRH = clamp(c.meanRH > 1 ? c.meanRH / 100 : c.meanRH, 0.16, 0.92);
    const wSum04 = wFromTTwb(c.summer04.Tdb, c.summer04.Twb, pPa);
    const tSumDayRef = c.summer04.Tdb - 0.85 * c.dailyAmpT;
    const rhSumDayRef = clamp(rhFracFromTw(tSumDayRef, wSum04, pPa), 0.10, 0.90);

    // Precompute normalized seasonal temperature position & saturation vapor pressures ONCE
    const tDaySpan = Math.max(2.0, maxDayT - minDayT);
    const sPos = new Float64Array(HOURS);
    const pwsDay = new Float64Array(HOURS);
    const pwsHourly = new Float64Array(HOURS);
    const wsatHourly = new Float64Array(HOURS);
    const synFactorArr = new Float64Array(HOURS);
    const hotPullArr = new Float64Array(HOURS);
    const wPeakTargetArr = new Float64Array(HOURS);
    const moistSpread = isArid ? 0.24 : 0.16;
    const hotStartT = c.summer1.Tdb - 2.0;
    const hotSpanT = Math.max(2.5, c.summer04.Tdb - c.summer1.Tdb + 3.0);
    const pLim = pPa * 0.999;

    for (let i = 0; i < HOURS; i++) {
      sPos[i] = Math.pow(clamp((dayMeanT[i] - minDayT) / tDaySpan, 0, 1), 1.15);
      pwsDay[i] = Psy.p_ws_Pa(dayMeanT[i]);
      const pwsH = Psy.p_ws_Pa(calT[i]);
      pwsHourly[i] = pwsH;
      const pvSat = pwsH < pLim ? pwsH : pLim;
      wsatHourly[i] = (0.621945 * pvSat / Math.max(1, pPa - pvSat)) * 0.992;
      synFactorArr[i] = Math.exp(moistSpread * moistWave[i]) * (1 + 0.035 * diurnalNorm[i]);
      if (calT[i] > hotStartT) {
        hotPullArr[i] = clamp((calT[i] - hotStartT) / hotSpanT, 0, 0.65);
        wPeakTargetArr[i] = wSum04 * Math.exp(0.14 * moistWave[i]);
      } else {
        hotPullArr[i] = 0;
        wPeakTargetArr[i] = 0;
      }
    }

    // Seasonal daily-mean RH baseline: typical summer RH blends toward summer04 while
    // a single solved shift calibrates exact annual average RH to city.meanRH.
    const rhSumBase = clamp(0.55 * targetMeanRH + 0.45 * rhSumDayRef, 0.12, 0.90);
    const rhWinBase = clamp(targetMeanRH + Math.max(0.04, targetMeanRH - rhSumBase), 0.18, 0.94);

    function evalHumidityForShift(rhShift, outW, outRH) {
      let rhSum = 0;
      for (let i = 0; i < HOURS; i++) {
        const rhDayBase = clamp(rhWinBase + (rhSumBase - rhWinBase) * sPos[i] + rhShift, 0.06, 0.96);

        // Air-mass humidity ratio from daily-mean T & daily-mean RH (constant-w diurnal physics)
        const pvDay = pwsDay[i] * rhDayBase;
        const pvDayClamped = pvDay < pLim ? pvDay : pLim;
        const wAirmass = 0.621945 * pvDayClamped / Math.max(1, pPa - pvDayClamped);

        let w = wAirmass * synFactorArr[i];

        // Near extreme peak heat (T close to summer04.Tdb), softly pull toward calibrated summer04 w
        const hp = hotPullArr[i];
        if (hp > 0) {
          w = w * (1 - hp) + wPeakTargetArr[i] * hp;
        }

        // Physical saturation bound (prevents supersaturation; creates natural overnight dew/fog curve)
        const wMaxPhys = wsatHourly[i];
        const wMinPhys = Math.min(0.0001, wMaxPhys * 0.25);
        if (w < wMinPhys) w = wMinPhys;
        if (w > wMaxPhys) w = wMaxPhys;

        const pv = (w * pPa) / (w + 0.621945);
        const rhFrac = clamp(pv / pwsHourly[i], 0, 1);
        rhSum += rhFrac;
        if (outW) {
          outW[i] = w;
          outRH[i] = rhFrac * 100;
        }
      }
      return rhSum / HOURS;
    }

    let loShift = -0.55;
    let hiShift = 0.55;
    for (let iter = 0; iter < 11; iter++) {
      const mid = 0.5 * (loShift + hiShift);
      const meanRH = evalHumidityForShift(mid, null, null);
      if (meanRH < targetMeanRH) loShift = mid;
      else hiShift = mid;
    }
    const solvedShift = 0.5 * (loShift + hiShift);

    const finalW = new Float64Array(HOURS);
    const finalRH = new Float64Array(HOURS);
    evalHumidityForShift(solvedShift, finalW, finalRH);

    // Build 8,760 compact hourly records
    const records = new Array(HOURS);
    for (let i = 0; i < HOURS; i++) {
      const mh = hourIndexToMonthHour(i);
      const tRec = roundTo(calT[i], 2);
      const wsRec = wsatAt(tRec, pPa);
      const wRec = Math.min(roundTo(finalW[i], 6), wsRec);
      records[i] = {
        T: tRec,
        w: wRec,
        rh: roundTo(finalRH[i], 1),
        month: mh.month,
        hour: mh.hour
      };
    }

    return {
      sourceName: `${c.name}, ${c.country} (Synthetic TMY · Zone ${c.climateZone})`,
      cityId: c.id,
      elev_m,
      pPa: roundTo(pPa, 1),
      records
    };
  }

  /* --------------------------------------------------------------------------
     CSV / Delimited Line Helper
     -------------------------------------------------------------------------- */
  function splitDelimLine(line, delim) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  /* --------------------------------------------------------------------------
     4. Real EnergyPlus (.epw) Weather File Parser
     Header line 1: LOCATION,City,State,Country,Source,WMO,Lat,Lon,TZ,Elevation
     Skips 8 header lines; parses col 1 (month), col 3 (hour), col 6 (Tdb °C),
     col 7 (Tdp °C), col 8 (RH %), col 9 (Patm Pa).
     -------------------------------------------------------------------------- */
  function parseEPW(text) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return {
        ok: false,
        sourceName: '',
        elev_m: 0,
        pPa: 101325,
        records: [],
        error: 'Empty EPW file content.'
      };
    }

    const cleaned = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const rawLines = cleaned.split(/\r\n|\n|\r/);
    if (rawLines.length < 10) {
      return {
        ok: false,
        sourceName: '',
        elev_m: 0,
        pPa: 101325,
        records: [],
        error: 'File too short to be a valid EnergyPlus (.epw) weather file.'
      };
    }

    // Parse line 1 LOCATION header
    const locCols = splitDelimLine(rawLines[0], ',');
    const isLocationHdr = locCols.length >= 2 && locCols[0].toUpperCase().startsWith('LOCATION');
    let sourceName = 'EPW Weather File';
    let elev_m = 0;
    let lat = NaN;
    let lon = NaN;

    if (isLocationHdr) {
      const city = (locCols[1] || '').trim();
      const state = (locCols[2] || '').trim();
      const country = (locCols[3] || '').trim();
      const parts = [];
      if (city && city !== '-') parts.push(city);
      if (state && state !== '-' && state !== city) parts.push(state);
      if (country && country !== '-' && country !== state) parts.push(country);
      if (parts.length > 0) sourceName = parts.join(', ');

      const latVal = parseFloat(locCols[6]);
      const lonVal = parseFloat(locCols[7]);
      const elevVal = parseFloat(locCols[9]);
      if (Number.isFinite(latVal) && Math.abs(latVal) <= 90) lat = latVal;
      if (Number.isFinite(lonVal) && Math.abs(lonVal) <= 180) lon = lonVal;
      if (Number.isFinite(elevVal) && elevVal >= -500 && elevVal <= 9000) elev_m = elevVal;
    }

    const elevPPa = baroPaFromElev(elev_m);

    // Standard EPW has 8 header lines (indices 0..7); verify DATA PERIODS line if present
    let dataStartIdx = 8;
    for (let i = 0; i < Math.min(12, rawLines.length); i++) {
      if (rawLines[i].trim().toUpperCase().startsWith('DATA PERIODS')) {
        dataStartIdx = i + 1;
        break;
      }
    }

    const records = [];
    let pSum = 0;
    let pValidCount = 0;

    for (let i = dataStartIdx; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue;
      const cols = line.split(',');
      if (cols.length < 9) continue;

      const month = clamp(parseInt(cols[1], 10) || 1, 1, 12);
      const hour = clamp(parseInt(cols[3], 10) || 1, 1, 24);
      const tdb = parseFloat(cols[6]);
      const tdp = parseFloat(cols[7]);
      const rhRaw = parseFloat(cols[8]);
      const patmRaw = cols.length > 9 ? parseFloat(cols[9]) : NaN;

      // Validate EPW missing flags: Tdb/Tdp = 99.9, RH = 999, Patm = 999999
      if (!Number.isFinite(tdb) || Math.abs(tdb - 99.9) < 0.05 || tdb < -90 || tdb > 75) {
        continue;
      }

      const hasTdp = Number.isFinite(tdp) && Math.abs(tdp - 99.9) >= 0.05 && tdp >= -90 && tdp <= 70;
      const hasRH = Number.isFinite(rhRaw) && Math.abs(rhRaw - 999) >= 0.5 && rhRaw >= 0 && rhRaw <= 110;
      if (!hasRH && !hasTdp) continue;

      const hasPatm = Number.isFinite(patmRaw) && patmRaw < 999000 && patmRaw >= 31000 && patmRaw <= 120000;
      const pRow = hasPatm ? patmRaw : elevPPa;
      if (hasPatm) {
        pSum += patmRaw;
        pValidCount++;
      }

      let w;
      if (hasRH) {
        const rhClamped = clamp(rhRaw, 0, 100);
        w = wFromTRH(tdb, rhClamped / 100, pRow);
      } else {
        w = wFromTdp(Math.min(tdp, tdb), pRow);
      }

      const ws = wsatAt(tdb, pRow);
      w = clamp(w, 0, ws);
      const rhFinal = clamp(rhFracFromTw(tdb, w, pRow) * 100, 0, 100);

      records.push({
        T: roundTo(tdb, 2),
        w: roundTo(w, 6),
        rh: roundTo(rhFinal, 1),
        month,
        hour
      });
    }

    if (records.length === 0) {
      return {
        ok: false,
        sourceName,
        elev_m,
        pPa: roundTo(elevPPa, 1),
        records: [],
        error: 'No valid hourly psychrometric records found in EPW file.'
      };
    }

    const pPa = pValidCount >= Math.max(1, records.length * 0.1)
      ? pSum / pValidCount
      : elevPPa;

    return {
      ok: true,
      sourceName,
      elev_m: roundTo(elev_m, 1),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      pPa: roundTo(pPa, 1),
      records,
      error: null
    };
  }

  /* --------------------------------------------------------------------------
     5. Smart CSV / TSV Weather Parser
     Auto-detects delimiter (comma / tab / semicolon), headers (Tdb/Temp, RH,
     W, Tdp, Twb, Month, Hour, Date, Patm) or falls back to (Tdb, RH), and
     automatically converts °F -> °C if header contains F or values exceed 65.
     -------------------------------------------------------------------------- */
  function detectDelimiter(sampleLines) {
    const candidates = ['\t', ',', ';'];
    const scores = [0, 0, 0];
    const n = Math.min(sampleLines.length, 5);
    for (let i = 0; i < n; i++) {
      const line = sampleLines[i];
      let inQuotes = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') inQuotes = !inQuotes;
        else if (!inQuotes) {
          if (ch === '\t') scores[0]++;
          else if (ch === ',') scores[1]++;
          else if (ch === ';') scores[2]++;
        }
      }
    }
    let bestIdx = 1; // default comma
    let bestScore = scores[1];
    if (scores[0] > bestScore) { bestIdx = 0; bestScore = scores[0]; }
    if (scores[2] > bestScore) { bestIdx = 2; bestScore = scores[2]; }
    return candidates[bestIdx];
  }

  function isPlainNumberToken(s) {
    if (!s) return false;
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim());
  }

  function isDateTimeToken(s) {
    if (!s) return false;
    const t = s.trim();
    return /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(t) || /^\d{1,2}:\d{2}/.test(t);
  }

  function extractMonthHourFromTimestamp(str) {
    if (!str) return null;
    const s = str.trim();
    let month = null;
    let hour = null;
    // ISO YYYY-MM-DD or YYYY/MM/DD
    const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (iso) {
      const m = parseInt(iso[2], 10);
      if (m >= 1 && m <= 12) month = m;
    } else {
      // MM/DD/YYYY or MM-DD-YYYY
      const us = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
      if (us) {
        const m = parseInt(us[1], 10);
        if (m >= 1 && m <= 12) month = m;
      }
    }
    const tm = s.match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);
    if (tm) {
      const h = parseInt(tm[1], 10);
      if (h >= 0 && h <= 24) hour = h === 0 ? 1 : clamp(h, 1, 24);
    }
    return (month !== null || hour !== null) ? { month, hour } : null;
  }

  function headerSuggestsFahrenheit(hdr) {
    if (!hdr) return false;
    return /(°\s*f|\bfahrenheit\b|\bdeg\s*f\b|\(\s*f\s*\)|\[\s*f\s*\]|_f\b|\bf\s*$|tempf|tdbf|tdpf|twbf)/i.test(hdr.trim());
  }

  function parseWeatherCSV(text, pPa = 101325) {
    const basePPa = (Number.isFinite(pPa) && pPa > 20000) ? pPa : 101325;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return {
        ok: false,
        sourceName: 'Weather CSV',
        pPa: basePPa,
        records: [],
        error: 'Empty CSV/TSV content.'
      };
    }

    const cleaned = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const nonEmptyLines = [];
    const splitAll = cleaned.split(/\r\n|\n|\r/);
    for (let i = 0; i < splitAll.length; i++) {
      const line = splitAll[i].trim();
      if (!line || line.startsWith('#')) continue;
      nonEmptyLines.push(line);
    }

    if (nonEmptyLines.length === 0) {
      return {
        ok: false,
        sourceName: 'Weather CSV',
        pPa: basePPa,
        records: [],
        error: 'No data rows found in CSV/TSV.'
      };
    }

    // If someone passes an EPW file directly into parseWeatherCSV, delegate cleanly!
    if (nonEmptyLines[0].toUpperCase().startsWith('LOCATION,')) {
      const epwRes = parseEPW(text);
      return {
        ok: epwRes.ok,
        sourceName: epwRes.sourceName,
        pPa: epwRes.pPa,
        records: epwRes.records,
        error: epwRes.error
      };
    }

    const delim = detectDelimiter(nonEmptyLines);
    const firstCols = splitDelimLine(nonEmptyLines[0], delim);

    // Determine whether line 0 is a header row or immediate data
    let hasHeader = false;
    for (let c = 0; c < firstCols.length; c++) {
      const cell = firstCols[c];
      if (!cell) continue;
      if (!isPlainNumberToken(cell) && !isDateTimeToken(cell)) {
        hasHeader = true;
        break;
      }
    }

    const colIdx = {
      tdb: -1,
      rh: -1,
      w: -1,
      tdp: -1,
      twb: -1,
      month: -1,
      hour: -1,
      date: -1,
      patm: -1
    };

    let hdrFahrenheit = false;
    let wUnitHint = null; // 'kg/kg' | 'g/kg' | 'gr/lb'

    if (hasHeader) {
      for (let c = 0; c < firstCols.length; c++) {
        const rawH = firstCols[c].trim();
        const h = rawH.toLowerCase();

        // Check specific moisture & temperature fields carefully
        if (colIdx.tdp === -1 && /(tdp|t_?dp|dew\s*_?\s*point|dewpoint|\bdp\b)/i.test(h)) {
          colIdx.tdp = c;
          if (headerSuggestsFahrenheit(rawH)) hdrFahrenheit = true;
        } else if (colIdx.twb === -1 && /(twb|t_?wb|wet\s*_?\s*bulb|wetbulb|\bwb\b)/i.test(h)) {
          colIdx.twb = c;
          if (headerSuggestsFahrenheit(rawH)) hdrFahrenheit = true;
        } else if (colIdx.tdb === -1 &&
          (/(\btdb\b|t_?db|dry\s*_?\s*bulb|drybulb|\btemp\b|temperature|\boat\b|t_?air|ambient|\bdb\b|^t$|^t[\s_(\[°]*(?:deg\s*)?[cf][\s_)\]]*$|^temp[\s_(\[°]*(?:deg\s*)?[cf][\s_)\]]*$)/i.test(h))) {
          colIdx.tdb = c;
          if (headerSuggestsFahrenheit(rawH)) hdrFahrenheit = true;
        } else if (colIdx.w === -1 &&
          (/(hum(idity)?\s*_?\s*ratio|abs(olute)?\s*_?\s*hum|mix(ing)?\s*_?\s*ratio|spec(ific)?\s*_?\s*hum|g\/kg|gr\/lb|grains|kg\/kg|^w$|^w[\s_(\[])/i.test(h))) {
          colIdx.w = c;
          if (/gr\/lb|grain/i.test(h)) wUnitHint = 'gr/lb';
          else if (/g\/kg/i.test(h)) wUnitHint = 'g/kg';
          else if (/kg\/kg/i.test(h)) wUnitHint = 'kg/kg';
        } else if (colIdx.rh === -1 &&
          (/(\brh\b|rh%|rh_%|rel(ative)?\s*_?\s*hum|humidity|\bhum\b)/i.test(h))) {
          colIdx.rh = c;
        } else if (colIdx.month === -1 && /^(\bmonth\b|\bmon\b|\bmo\b)$/i.test(h)) {
          colIdx.month = c;
        } else if (colIdx.hour === -1 && /(\bhour\b|\bhr\b|hour_?of_?day|\bhod\b)/i.test(h)) {
          colIdx.hour = c;
        } else if (colIdx.date === -1 && /(date|time|timestamp|datetime)/i.test(h)) {
          colIdx.date = c;
        } else if (colIdx.patm === -1 && /(patm|p_?atm|press|baro|p_?pa|p_?kpa)/i.test(h)) {
          colIdx.patm = c;
        }
      }

      // Fallback if header existed but names were unrecognized (e.g. "Col1,Col2")
      if (colIdx.tdb === -1 && firstCols.length >= 2) {
        colIdx.tdb = 0;
        if (headerSuggestsFahrenheit(firstCols[0])) hdrFahrenheit = true;
        if (colIdx.rh === -1 && colIdx.w === -1 && colIdx.tdp === -1 && colIdx.twb === -1) {
          colIdx.rh = 1;
        }
      }
    } else {
      // Headerless fallback: either (Date, Tdb, RH) or (Tdb, RH)
      if (firstCols.length >= 3 && isDateTimeToken(firstCols[0])) {
        colIdx.date = 0;
        colIdx.tdb = 1;
        colIdx.rh = 2;
      } else if (firstCols.length >= 2) {
        colIdx.tdb = 0;
        colIdx.rh = 1;
      } else {
        return {
          ok: false,
          sourceName: 'Weather CSV',
          pPa: basePPa,
          records: [],
          error: 'CSV must contain at least two columns (e.g., Tdb and RH).'
        };
      }
    }

    if (colIdx.tdb === -1 || (colIdx.rh === -1 && colIdx.w === -1 && colIdx.tdp === -1 && colIdx.twb === -1)) {
      return {
        ok: false,
        sourceName: 'Weather CSV',
        pPa: basePPa,
        records: [],
        error: 'Could not detect Tdb and a moisture column (RH, W, Tdp, or Twb).'
      };
    }

    // First pass: extract raw parsed values so we can auto-detect °F, RH fraction vs %, and W scale
    const startRow = hasHeader ? 1 : 0;
    const rawRows = [];
    let maxTdbRaw = -Infinity;
    let maxRHRaw = -Infinity;
    let maxWRaw = -Infinity;

    for (let i = startRow; i < nonEmptyLines.length; i++) {
      const cols = splitDelimLine(nonEmptyLines[i], delim);
      if (cols.length <= colIdx.tdb) continue;

      const tdbVal = parseFloat(cols[colIdx.tdb]);
      if (!Number.isFinite(tdbVal)) continue;

      const rhVal = colIdx.rh >= 0 && cols.length > colIdx.rh ? parseFloat(cols[colIdx.rh]) : NaN;
      const wVal = colIdx.w >= 0 && cols.length > colIdx.w ? parseFloat(cols[colIdx.w]) : NaN;
      const tdpVal = colIdx.tdp >= 0 && cols.length > colIdx.tdp ? parseFloat(cols[colIdx.tdp]) : NaN;
      const twbVal = colIdx.twb >= 0 && cols.length > colIdx.twb ? parseFloat(cols[colIdx.twb]) : NaN;
      const patmVal = colIdx.patm >= 0 && cols.length > colIdx.patm ? parseFloat(cols[colIdx.patm]) : NaN;

      if (!Number.isFinite(rhVal) && !Number.isFinite(wVal) && !Number.isFinite(tdpVal) && !Number.isFinite(twbVal)) {
        continue;
      }

      let month = colIdx.month >= 0 && cols.length > colIdx.month ? parseInt(cols[colIdx.month], 10) : NaN;
      let hour = colIdx.hour >= 0 && cols.length > colIdx.hour ? parseInt(cols[colIdx.hour], 10) : NaN;
      if ((!Number.isFinite(month) || !Number.isFinite(hour)) && colIdx.date >= 0 && cols.length > colIdx.date) {
        const dt = extractMonthHourFromTimestamp(cols[colIdx.date]);
        if (dt) {
          if (!Number.isFinite(month) && dt.month !== null) month = dt.month;
          if (!Number.isFinite(hour) && dt.hour !== null) hour = dt.hour;
        }
      }

      if (tdbVal < 200 && tdbVal > maxTdbRaw) maxTdbRaw = tdbVal;
      if (Number.isFinite(rhVal) && rhVal < 200 && rhVal > maxRHRaw) maxRHRaw = rhVal;
      if (Number.isFinite(wVal) && wVal > maxWRaw) maxWRaw = wVal;

      rawRows.push({ tdbVal, rhVal, wVal, tdpVal, twbVal, patmVal, month, hour });
    }

    if (rawRows.length === 0) {
      return {
        ok: false,
        sourceName: 'Weather CSV',
        pPa: basePPa,
        records: [],
        error: 'No valid numeric weather rows could be parsed from CSV/TSV.'
      };
    }

    // Auto-detect °F if header indicated F OR dry-bulb values exceed 65°C
    const isFahrenheit = hdrFahrenheit || maxTdbRaw > 65;
    const rhIsFraction = Number.isFinite(maxRHRaw) && maxRHRaw <= 1.01 && maxRHRaw >= 0;

    // Auto-detect W unit scale if not explicitly labeled in header
    let wDivisor = 1;
    if (wUnitHint === 'gr/lb') wDivisor = 7000;
    else if (wUnitHint === 'g/kg') wDivisor = 1000;
    else if (wUnitHint === 'kg/kg') wDivisor = 1;
    else if (Number.isFinite(maxWRaw)) {
      if (maxWRaw > 50) wDivisor = 7000;       // grains/lb
      else if (maxWRaw > 0.1) wDivisor = 1000; // g/kg
      else wDivisor = 1;                       // kg/kg
    }

    const toC = v => (isFahrenheit ? (v - 32) / 1.8 : v);
    const records = [];
    let pSum = 0;
    let pCnt = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const T = toC(r.tdbVal);
      if (!Number.isFinite(T) || T < -90 || T > 75) continue;

      let pRow = basePPa;
      if (Number.isFinite(r.patmVal) && r.patmVal > 0 && r.patmVal < 999000) {
        if (r.patmVal >= 31000 && r.patmVal <= 120000) pRow = r.patmVal;          // Pa
        else if (r.patmVal >= 31 && r.patmVal <= 120) pRow = r.patmVal * 1000;    // kPa
        else if (r.patmVal >= 310 && r.patmVal <= 1200) pRow = r.patmVal * 100;   // hPa / mbar
        else if (r.patmVal >= 8 && r.patmVal <= 18) pRow = r.patmVal * 6894.757;  // psia
        pSum += pRow;
        pCnt++;
      }

      let w = NaN;
      if (Number.isFinite(r.rhVal) && r.rhVal >= 0 && r.rhVal <= 110) {
        const rhFrac = rhIsFraction ? clamp(r.rhVal, 0, 1) : clamp(r.rhVal, 0, 100) / 100;
        w = wFromTRH(T, rhFrac, pRow);
      } else if (Number.isFinite(r.wVal) && r.wVal >= 0) {
        w = r.wVal / wDivisor;
      } else if (Number.isFinite(r.tdpVal)) {
        const tdpC = toC(r.tdpVal);
        if (tdpC >= -90 && tdpC <= 70) w = wFromTdp(Math.min(tdpC, T), pRow);
      } else if (Number.isFinite(r.twbVal)) {
        const twbC = toC(r.twbVal);
        if (twbC >= -90 && twbC <= 70) w = wFromTTwb(T, Math.min(twbC, T), pRow);
      }

      if (!Number.isFinite(w) || w < 0) continue;
      const ws = wsatAt(T, pRow);
      w = clamp(w, 0, ws);
      const rhPct = clamp(rhFracFromTw(T, w, pRow) * 100, 0, 100);

      let month = r.month;
      let hour = r.hour;
      if (!Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(hour) || hour < 1 || hour > 24) {
        const fallback = hourIndexToMonthHour(records.length);
        if (!Number.isFinite(month) || month < 1 || month > 12) month = fallback.month;
        if (!Number.isFinite(hour) || hour < 1 || hour > 24) hour = fallback.hour;
      }

      records.push({
        T: roundTo(T, 2),
        w: roundTo(w, 6),
        rh: roundTo(rhPct, 1),
        month,
        hour
      });
    }

    if (records.length === 0) {
      return {
        ok: false,
        sourceName: 'Weather CSV',
        pPa: basePPa,
        records: [],
        error: 'No valid psychrometric points remained after filtering CSV/TSV rows.'
      };
    }

    const usedPPa = pCnt > 0 ? pSum / pCnt : basePPa;
    return {
      ok: true,
      sourceName: `Weather CSV (${records.length} hrs${isFahrenheit ? ', °F→°C' : ''})`,
      pPa: roundTo(usedPPa, 1),
      detectedUnits: isFahrenheit ? 'IP' : 'SI',
      records,
      error: null
    };
  }

  /* --------------------------------------------------------------------------
     6. Annual Psychrometric Bin Grid & HVAC Hours-in-Zone Analytics Engine
     Grid: dT = 1.0 °C over T ∈ [-30, 60] (90 bins),
           dW = 0.0005 kg/kg (0.5 g/kg) over w ∈ [0, 0.035] (70 bins).
     -------------------------------------------------------------------------- */
  function computePsychroBins(records, pPa = 101325, comfortOpts = {}) {
    const p = (Number.isFinite(pPa) && pPa > 20000) ? pPa : 101325;
    const opts = comfortOpts || {};

    const dT = 1.0;
    const dW = 0.0005;
    const T_MIN = -30.0;
    const T_MAX = 60.0;
    const W_MIN = 0.0;
    const W_MAX = 0.035;
    const nT = Math.round((T_MAX - T_MIN) / dT); // 90
    const nW = Math.round((W_MAX - W_MIN) / dW); // 70

    if (!Array.isArray(records) || records.length === 0) {
      return {
        totalHours: 0,
        comfortHours: 0,
        comfortPct: 0,
        coolHours: 0,
        coolPct: 0,
        dehumHours: 0,
        dehumPct: 0,
        humidHours: 0,
        humidPct: 0,
        heatHours: 0,
        heatPct: 0,
        economizerHours: 0,
        economizerPct: 0,
        evapHours: 0,
        evapPct: 0,
        cdh: 0,
        hdh: 0,
        cdd: 0,
        hdd: 0,
        tMinObs: null,
        tMaxObs: null,
        wMaxObs: null,
        wMinObs: null,
        tMeanObs: null,
        rhMeanObs: null,
        hMaxObs: null,
        dT,
        dW,
        tRange: [T_MIN, T_MAX],
        wRange: [W_MIN, W_MAX],
        bins2D: [],
        maxBinCount: 0
      };
    }

    // Dynamic ASHRAE 55 / ISO 7730 comfort polygon partition (or explicit custom box override)
    const useExplicitBox = Number.isFinite(opts.tMin) || Number.isFinite(opts.tMax);
    const wComfMax = Number.isFinite(opts.wMax)
      ? Math.max(0.002, opts.wMax)
      : (opts.capHumidity === false ? 0.030 : 0.012);
    const wComfMin = Number.isFinite(opts.wMin) ? Math.max(0, opts.wMin) : 0.0;
    const baseDegreeT = Number.isFinite(opts.baseT) ? opts.baseT : 18.3;

    // Explicit box fallback bounds (when caller supplies custom tMin/tMax overrides)
    const tBoxMin = Number.isFinite(opts.tMin) ? opts.tMin : 20.0;
    const tBoxMax = Number.isFinite(opts.tMax) ? opts.tMax : 26.5;
    const coolThresholdT = Number.isFinite(opts.coolT) ? opts.coolT : tBoxMax;
    const heatThresholdT = Number.isFinite(opts.heatT) ? opts.heatT : tBoxMin;

    // Build active comfort polygon(s) and fast horizontal-slice boundary LUT for heating/cooling partition
    const activePolys = [];
    const polyBBoxes = [];
    const LUT_N = 128;
    const tLoLUT = new Float64Array(LUT_N + 1);
    const tHiLUT = new Float64Array(LUT_N + 1);

    if (!useExplicitBox && Comfort && typeof Comfort.getSummerWinterZones === 'function') {
      const sw = Comfort.getSummerWinterZones(p, opts);
      const cMode = opts.mode || 'both';
      if (cMode === 'summer') {
        if (sw?.summer?.poly?.length >= 3) activePolys.push(sw.summer.poly);
      } else if (cMode === 'winter') {
        if (sw?.winter?.poly?.length >= 3) activePolys.push(sw.winter.poly);
      } else {
        if (sw?.winter?.poly?.length >= 3) activePolys.push(sw.winter.poly);
        if (sw?.summer?.poly?.length >= 3) activePolys.push(sw.summer.poly);
      }
    }

    const usePolys = activePolys.length > 0;
    if (usePolys) {
      let globalMinT = Infinity;
      let globalMaxT = -Infinity;
      for (let k = 0; k < activePolys.length; k++) {
        const poly = activePolys[k];
        let minT = Infinity, maxT = -Infinity, minW = Infinity, maxW = -Infinity;
        for (let j = 0; j < poly.length; j++) {
          const ptT = poly[j][0];
          const ptW = poly[j][1];
          if (ptT < minT) minT = ptT;
          if (ptT > maxT) maxT = ptT;
          if (ptW < minW) minW = ptW;
          if (ptW > maxW) maxW = ptW;
        }
        polyBBoxes.push({ minT, maxT, minW, maxW });
        if (minT < globalMinT) globalMinT = minT;
        if (maxT > globalMaxT) globalMaxT = maxT;
      }

      const spanAtW = (poly, wVal) => {
        let minX = Infinity;
        let maxX = -Infinity;
        const n = poly.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const x0 = poly[j][0], y0 = poly[j][1];
          const x1 = poly[i][0], y1 = poly[i][1];
          if ((y0 <= wVal && y1 >= wVal) || (y1 <= wVal && y0 >= wVal)) {
            if (Math.abs(y1 - y0) < 1e-12) {
              if (x0 < minX) minX = x0;
              if (x0 > maxX) maxX = x0;
              if (x1 < minX) minX = x1;
              if (x1 > maxX) maxX = x1;
            } else {
              const x = x0 + ((wVal - y0) / (y1 - y0)) * (x1 - x0);
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
            }
          }
        }
        return minX <= maxX ? [minX, maxX] : null;
      };

      const wSpan = Math.max(1e-6, wComfMax - wComfMin);
      let prevLo = globalMinT;
      let prevHi = globalMaxT;
      for (let idx = 0; idx <= LUT_N; idx++) {
        const wSample = wComfMin + (wSpan * idx) / LUT_N;
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = 0; k < activePolys.length; k++) {
          const sp = spanAtW(activePolys[k], wSample);
          if (sp) {
            if (sp[0] < lo) lo = sp[0];
            if (sp[1] > hi) hi = sp[1];
          }
        }
        if (lo <= hi) {
          tLoLUT[idx] = lo;
          tHiLUT[idx] = hi;
          prevLo = lo;
          prevHi = hi;
        } else {
          tLoLUT[idx] = prevLo;
          tHiLUT[idx] = prevHi;
        }
      }
    }

    const invWComfSpan = 1 / Math.max(1e-6, wComfMax - wComfMin);

    // Precompute exact ASHRAE Eq. 35 numerator term for Twb = 20.0°C evaporative boundary:
    // Because Twb(T, w, p) is strictly increasing with w, Twb < 20°C iff w < w_from_TTwb(T, 20°C, p).
    const EVAP_TWB_MAX = 20.0;
    const wsEvap20 = wsatAt(EVAP_TWB_MAX, p);
    const evapNumBase = (2501 - 2.326 * EVAP_TWB_MAX) * wsEvap20;
    const evapDenBase = 2501 - 4.186 * EVAP_TWB_MAX;

    const grid = new Int32Array(nT * nW);

    let totalHours = 0;
    let comfortHours = 0;
    let coolHours = 0;
    let dehumHours = 0;
    let humidHours = 0;
    let heatHours = 0;
    let economizerHours = 0;
    let evapHours = 0;
    let cdh = 0;
    let hdh = 0;

    let tMinObs = Infinity;
    let tMaxObs = -Infinity;
    let wMaxObs = -Infinity;
    let wMinObs = Infinity;
    let hMaxObs = -Infinity;
    let tSum = 0;
    let rhSum = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec) continue;
      const T = rec.T;
      const w = rec.w;
      if (!Number.isFinite(T) || !Number.isFinite(w) || w < 0) continue;

      totalHours++;
      tSum += T;
      if (T < tMinObs) tMinObs = T;
      if (T > tMaxObs) tMaxObs = T;
      if (w > wMaxObs) wMaxObs = w;
      if (w < wMinObs) wMinObs = w;

      const h = Psy.h_kJkg(T, w);
      if (h > hMaxObs) hMaxObs = h;

      const rhFrac = rhFracFromTw(T, w, p);
      rhSum += rhFrac * 100;

      // Exact non-overlapping thermal comfort / heating / cooling partition
      if (usePolys) {
        let inComfort = false;
        if (w >= wComfMin - 1e-7 && w <= wComfMax + 1e-7) {
          let wQuery = w;
          if (wQuery <= wComfMin + 1e-8) wQuery = Math.min(wComfMax - 1e-8, wComfMin + 1e-8);
          else if (wQuery >= wComfMax - 1e-8) wQuery = Math.max(wComfMin + 1e-8, wComfMax - 1e-8);
          for (let k = 0; k < activePolys.length; k++) {
            const bb = polyBBoxes[k];
            if (T >= bb.minT - 1e-6 && T <= bb.maxT + 1e-6 && w <= bb.maxW + 1e-6) {
              if (Comfort.pointInPolygon(T, wQuery, activePolys[k])) {
                inComfort = true;
                break;
              }
            }
          }
        }

        if (inComfort) {
          comfortHours++;
        } else {
          const f = clamp((w - wComfMin) * invWComfSpan, 0, 1) * LUT_N;
          const i0 = Math.min(LUT_N - 1, Math.floor(f));
          const frac = f - i0;
          const tLoRef = tLoLUT[i0] + (tLoLUT[i0 + 1] - tLoLUT[i0]) * frac;
          const tHiRef = tHiLUT[i0] + (tHiLUT[i0 + 1] - tHiLUT[i0]) * frac;
          if (T < tLoRef) {
            heatHours++;
          } else if (T > tHiRef || w > wComfMax) {
            coolHours++;
          }
        }
      } else {
        const inComfort = T >= tBoxMin && T <= tBoxMax && w <= wComfMax && w >= wComfMin;
        if (inComfort) {
          comfortHours++;
        } else if (T < heatThresholdT) {
          heatHours++;
        } else if (T > coolThresholdT || w > wComfMax) {
          coolHours++;
        }
      }

      if (w > wComfMax) {
        dehumHours++;
      }
      if (w < 0.004) {
        humidHours++;
      }
      if (T >= 10.0 && T <= 21.0 && w <= 0.0115) {
        economizerHours++;
      }
      if (T > 25.0 && rhFrac < 0.50) {
        // Exact O(1) closed-form check equivalent to Twb(T, w, p) < 20.0°C (ASHRAE Eq. 35)
        const wAtTwb20 = (evapNumBase - 1.006 * (T - EVAP_TWB_MAX)) / (evapDenBase + 1.86 * T);
        if (w < wAtTwb20) {
          evapHours++;
        }
      }

      // Cooling & Heating Degree-Hours (base 18.3°C ≈ 65°F)
      if (T > baseDegreeT) cdh += (T - baseDegreeT);
      else if (T < baseDegreeT) hdh += (baseDegreeT - T);

      // 2D psychrometric bin accumulation over T ∈ [-30, 60], w ∈ [0, 0.035]
      if (T >= T_MIN && T <= T_MAX && w >= W_MIN && w <= W_MAX) {
        const it = Math.min(nT - 1, Math.max(0, Math.floor((T - T_MIN) / dT)));
        const iw = Math.min(nW - 1, Math.max(0, Math.floor((w - W_MIN) / dW)));
        grid[it * nW + iw]++;
      }
    }

    if (totalHours === 0) {
      return computePsychroBins([], p, opts);
    }

    let maxBinCount = 0;
    for (let k = 0; k < grid.length; k++) {
      if (grid[k] > maxBinCount) maxBinCount = grid[k];
    }

    const bins2D = [];
    if (maxBinCount > 0) {
      const invMax = 1 / maxBinCount;
      for (let it = 0; it < nT; it++) {
        const rowOff = it * nW;
        const binT = roundTo(T_MIN + (it + 0.5) * dT, 2);
        for (let iw = 0; iw < nW; iw++) {
          const cnt = grid[rowOff + iw];
          if (cnt > 0) {
            bins2D.push({
              T: binT,
              w: roundTo(W_MIN + (iw + 0.5) * dW, 6),
              count: cnt,
              norm: cnt * invMax
            });
          }
        }
      }
    }

    const pct = n => roundTo((n / totalHours) * 100, 1);

    return {
      totalHours,
      comfortHours,
      comfortPct: pct(comfortHours),
      coolHours,
      coolPct: pct(coolHours),
      dehumHours,
      dehumPct: pct(dehumHours),
      humidHours,
      humidPct: pct(humidHours),
      heatHours,
      heatPct: pct(heatHours),
      economizerHours,
      economizerPct: pct(economizerHours),
      evapHours,
      evapPct: pct(evapHours),
      cdh: roundTo(cdh, 0),
      hdh: roundTo(hdh, 0),
      cdd: roundTo(cdh / 24, 0),
      hdd: roundTo(hdh / 24, 0),
      tMinObs: roundTo(tMinObs, 2),
      tMaxObs: roundTo(tMaxObs, 2),
      wMaxObs: roundTo(wMaxObs, 6),
      wMinObs: roundTo(wMinObs, 6),
      tMeanObs: roundTo(tSum / totalHours, 2),
      rhMeanObs: roundTo(rhSum / totalHours, 1),
      hMaxObs: roundTo(hMaxObs, 2),
      dT,
      dW,
      tRange: [T_MIN, T_MAX],
      wRange: [W_MIN, W_MAX],
      bins2D,
      maxBinCount
    };
  }

  return {
    CITIES,
    REGIONS,
    getCityById,
    getCityDesignPoints,
    generateSyntheticTMY,
    parseEPW,
    parseWeatherCSV,
    computePsychroBins
  };
})();
