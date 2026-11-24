/* ============================================================================
   PsychroChart Ultra 3.0 — ASHRAE 2021 Ch. 1 Physics Verification Test Suite
   Uses Node.js built-in test runner (`node:test`) and `node:assert/strict`.
   Run with: `node --test tests/psychro.test.mjs`
   ============================================================================ */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Psy } from '../src/engine/psychro.js';

function assertClose(actual, expected, absTol, msg = '') {
  assert.ok(
    Number.isFinite(actual),
    `${msg ? msg + ': ' : ''}expected finite number, got ${actual}`
  );
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= absTol,
    `${msg ? msg + ': ' : ''}expected ${actual} to be within ±${absTol} of ${expected} (diff=${diff})`
  );
}

function assertRelClose(actual, expected, relTol, msg = '') {
  assert.ok(
    Number.isFinite(actual),
    `${msg ? msg + ': ' : ''}expected finite number, got ${actual}`
  );
  const denom = Math.max(Math.abs(expected), 1e-12);
  const relErr = Math.abs(actual - expected) / denom;
  assert.ok(
    relErr <= relTol,
    `${msg ? msg + ': ' : ''}expected ${actual} within ${(relTol * 100).toFixed(4)}% of ${expected} (relErr=${(relErr * 100).toFixed(4)}%)`
  );
}

/* ============================================================================
   1. Saturation Vapor Pressure p_ws_Pa(Tc) vs ASHRAE 2021 Ch. 1 Table 2
   ============================================================================ */
describe('1. Saturation vapor pressure p_ws_Pa(Tc) — ASHRAE 2021 Table 2', () => {
  // ASHRAE Handbook of Fundamentals (2021) Ch. 1 Table 2 (kPa converted to Pa).
  // Note: Hyland-Wexler (Eqs. 5 & 6) matches IAPWS-95 Table 2 within <= 0.05%.
  const ASHRAE_PWS_TABLE2 = [
    { Tc: -40, pwsPa: 12.85, relTol: 0.001 },
    { Tc: -20, pwsPa: 103.26, relTol: 0.0005 },
    { Tc: 0, pwsPa: 611.2, relTol: 0.0005 },
    { Tc: 10, pwsPa: 1228.1, relTol: 0.0005 },
    { Tc: 20, pwsPa: 2339.2, relTol: 0.0005 },
    { Tc: 25, pwsPa: 3169.8, relTol: 0.0005 },
    { Tc: 30, pwsPa: 4246.9, relTol: 0.0005 },
    { Tc: 40, pwsPa: 7385.1, relTol: 0.0005 },
    { Tc: 50, pwsPa: 12352, relTol: 0.0005 },
    { Tc: 60, pwsPa: 19947, relTol: 0.0005 }
  ];

  for (const row of ASHRAE_PWS_TABLE2) {
    it(`matches ASHRAE 2021 Table 2 at ${row.Tc}°C (~${row.pwsPa} Pa)`, () => {
      const actual = Psy.p_ws_Pa(row.Tc);
      assertRelClose(actual, row.pwsPa, row.relTol, `p_ws_Pa(${row.Tc})`);
    });
  }

  it('is strictly monotonically increasing across [-100, 200] °C including 0°C ice/liquid boundary', () => {
    let prev = Psy.p_ws_Pa(-100);
    assert.ok(prev > 0, 'p_ws_Pa(-100) must be positive');
    const sampleSet = new Set();
    for (let t = -99; t <= 200; t++) sampleSet.add(t);
    for (const t of [-0.01, -0.001, -1e-6, 0, 1e-6, 0.001, 0.01]) sampleSet.add(t);
    const samples = Array.from(sampleSet).sort((a, b) => a - b);

    prev = Psy.p_ws_Pa(-100);
    for (const t of samples) {
      const cur = Psy.p_ws_Pa(t);
      assert.ok(cur > prev, `p_ws_Pa must increase monotonically: p(${t})=${cur} <= prev=${prev}`);
      prev = cur;
    }

    // Continuity at 0°C ice/liquid transition (< 0.1 Pa jump)
    const pIce = Psy.p_ws_Pa(-1e-9);
    const pLiq = Psy.p_ws_Pa(0);
    assertClose(pLiq, pIce, 0.1, '0°C ice/liquid continuity');
  });
});

/* ============================================================================
   2. Sea-Level Saturation Properties vs ASHRAE 2021 Ch. 1 Table 2 (101.325 kPa)
   ============================================================================ */
describe('2. Sea-level saturation wsat_at, h_kJkg, v_m3kg — ASHRAE 2021 Table 2', () => {
  // ASHRAE 2021 Ch. 1 Table 2 real-gas virial values at 101.325 kPa.
  // Ideal-gas ASHRAE Eqs. (22), (28), (32) match Table 2 within < 0.7% up to 50°C
  // (per ASHRAE Fundamentals Ch. 1 "Perfect Gas Relationships for Dry and Moist Air").
  const ASHRAE_SAT_TABLE2 = [
    { Tc: 0,  ws: 0.003789, hs: 9.473,   vs: 0.7781 },
    { Tc: 20, ws: 0.014758, hs: 57.555,  vs: 0.8498 },
    { Tc: 25, ws: 0.020170, hs: 76.504,  vs: 0.8717 },
    { Tc: 35, ws: 0.036756, hs: 129.463, vs: 0.9242 },
    { Tc: 50, ws: 0.086858, hs: 275.353, vs: 1.0428 }
  ];

  for (const row of ASHRAE_SAT_TABLE2) {
    it(`matches ASHRAE 2021 Table 2 saturated air at ${row.Tc}°C (101.325 kPa)`, () => {
      const ws = Psy.wsat_at(row.Tc, Psy.P_STD);
      const hs = Psy.h_kJkg(row.Tc, ws);
      const vs = Psy.v_m3kg(row.Tc, ws, Psy.P_STD);

      // Virial enhancement factor f_s ~ 1.004-1.006 causes ~0.4-0.65% ideal-gas offset on W_s and h_s
      assertRelClose(ws, row.ws, 0.007, `wsat_at(${row.Tc})`);
      assertRelClose(hs, row.hs, 0.006, `h_kJkg(${row.Tc}, ws)`);
      assertRelClose(vs, row.vs, 0.002, `v_m3kg(${row.Tc}, ws)`);

      // Verify stateFromTw consistency at saturation
      const st = Psy.stateFromTw(row.Tc, ws, Psy.P_STD);
      assertClose(st.rh, 100, 1e-9, `RH at saturation (${row.Tc}°C)`);
      assertClose(st.mu, 1, 1e-9, `mu at saturation (${row.Tc}°C)`);
      assertClose(st.rhoDry, 1 / st.v, 1e-12, `rhoDry = 1/v (${row.Tc}°C)`);
      assertClose(st.rhoMoist, (1 + st.w) / st.v, 1e-12, `rhoMoist = (1+w)/v (${row.Tc}°C)`);
    });
  }

  it('satisfies ASHRAE Ch. 1 Eq. (25) degree of saturation identity mu = RH*(1 - pws/P)/(1 - RH*pws/P)', () => {
    const cases = [
      [10, 0.40, Psy.P_STD],
      [25, 0.50, Psy.P_STD],
      [40, 0.70, Psy.P_STD],
      [30, 0.60, Psy.baroPa(1609)]
    ];
    for (const [T, rh01, pPa] of cases) {
      const w = Psy.w_from_TRH(T, rh01, pPa);
      const mu = Psy.mu_from_Tw(T, w, pPa);
      const pws = Psy.p_ws_Pa(T);
      const muExpected = rh01 * (1 - pws / pPa) / (1 - rh01 * pws / pPa);
      assertClose(mu, muExpected, 1e-9, `Eq. 25 mu identity at T=${T}, RH=${rh01}`);
      assert.ok(mu <= rh01 + 1e-12, 'Degree of saturation mu must be <= RH');
    }
  });

  it('matches ASHRAE cp_moist = dh/dT and Tdb_from_wh exact algebraic inverse', () => {
    for (const [T, w] of [[-20, 0.0004], [0, 0.002], [25, 0.010], [50, 0.040]]) {
      const eps = 1e-4;
      const dh_dT = (Psy.h_kJkg(T + eps, w) - Psy.h_kJkg(T - eps, w)) / (2 * eps);
      assertClose(Psy.cp_moist(w), dh_dT, 1e-9, `cp_moist(${w}) === dh/dT`);
      assertClose(Psy.Tdb_from_wh(w, Psy.h_kJkg(T, w)), T, 1e-12, `Tdb_from_wh inverse at T=${T}`);
    }
  });
});

/* ============================================================================
   3. Exact ASHRAE 2021 IP Enthalpy Datum Verification (0°F Reference)
   ============================================================================ */
describe('3. ASHRAE 2021 IP enthalpy datum (0°F reference)', () => {
  it('at 0°C (32°F) dry air (w=0): h_kJkg === 0.0 and h_Btulb === 7.68 Btu/lb', () => {
    const hSI = Psy.h_kJkg(0, 0);
    const hIP = Psy.h_Btulb(0, 0);
    assertClose(hSI, 0.0, 1e-12, 'h_kJkg(0, 0)');
    assertClose(hIP, 7.68, 1e-12, 'h_Btulb(0, 0) must equal 0.240 * 32 = 7.68 Btu/lb');
  });

  it('at 25°C (77°F, 50% RH): h_Btulb ≈ 29.3 Btu/lb, NOT naive h_SI * 0.42992 (21.63 Btu/lb)', () => {
    const w = Psy.w_from_TRH(25, 0.5, Psy.P_STD);
    const hSI = Psy.h_kJkg(25, w);
    const hIP = Psy.h_Btulb(25, w);
    const naiveWrongIP = hSI * Psy.BTU_LB_PER_KJ_KG;

    assertClose(hSI, 50.32, 0.05, 'h_kJkg(25°C, 50% RH)');
    assertClose(hIP, 29.30, 0.05, 'h_Btulb(25°C, 50% RH) with true 0°F datum');
    assert.ok(
      Math.abs(hIP - naiveWrongIP) > 7.5,
      `h_Btulb (${hIP.toFixed(2)}) must differ from naive SI*0.4299 (${naiveWrongIP.toFixed(2)}) by ~7.68 Btu/lb datum offset`
    );
  });

  it('roundtrips h_kJkg_from_Btulb(h_Btulb(T, w), w) === h_kJkg(T, w) to < 1e-6 across all regimes', () => {
    const testStates = [
      [-30, 0],
      [-15, 0.0005],
      [0, 0],
      [0, 0.003],
      [20, 0.008],
      [25, 0.00988],
      [35, 0.025],
      [55, 0.060]
    ];
    for (const [T, w] of testStates) {
      const hSI = Psy.h_kJkg(T, w);
      const hIP = Psy.h_Btulb(T, w);
      const hSIBack = Psy.h_kJkg_from_Btulb(hIP, w);
      assertClose(hSIBack, hSI, 1e-6, `h_kJkg_from_Btulb roundtrip at T=${T}, w=${w}`);
    }
  });

  it('dh_Btulb(h_kJkg(T2,w2) - h_kJkg(T1,w1)) matches h_Btulb(T2,w2) - h_Btulb(T1,w1) within 0.3%', () => {
    const processes = [
      { name: 'Sensible heating',     T1: 15, w1: 0.008, T2: 35, w2: 0.008 },
      { name: 'Cooling & dehum',      T1: 32, w1: 0.018, T2: 13, w2: 0.009 },
      { name: 'Steam humidification', T1: 22, w1: 0.004, T2: 22.5, w2: 0.011 },
      { name: 'Sub-zero preheat',     T1: -20, w1: 0.0004, T2: 18, w2: 0.0004 },
      { name: 'Tropical coil',        T1: 38, w1: 0.026, T2: 12, w2: 0.0085 }
    ];
    for (const p of processes) {
      const dhSI = Psy.h_kJkg(p.T2, p.w2) - Psy.h_kJkg(p.T1, p.w1);
      const dhFromSI = Psy.dh_Btulb(dhSI);
      const dhDirectIP = Psy.h_Btulb(p.T2, p.w2) - Psy.h_Btulb(p.T1, p.w1);
      assertRelClose(dhFromSI, dhDirectIP, 0.003, `dh_Btulb consistency for ${p.name}`);
    }
  });
});

/* ============================================================================
   4. High-Altitude & Negative-Altitude Barometric Pressure
   ============================================================================ */
describe('4. Barometric pressure baroPa / invBaroAlt_m — ASHRAE 2021 Eq. (3)', () => {
  const ALT_BENCHMARKS = [
    { name: 'Dead Sea',     alt_m: -200, expected_kPa: 103.751, tol_kPa: 0.02 },
    { name: 'Sea Level',    alt_m: 0,    expected_kPa: 101.325, tol_kPa: 1e-6 },
    { name: 'Denver',       alt_m: 1609, expected_kPa: 83.431,  tol_kPa: 0.05 },
    { name: 'Mexico City',  alt_m: 2240, expected_kPa: 77.155,  tol_kPa: 0.05 },
    { name: 'La Paz',       alt_m: 3640, expected_kPa: 64.587,  tol_kPa: 0.05 }
  ];

  for (const loc of ALT_BENCHMARKS) {
    it(`computes barometric pressure & exact roundtrip at ${loc.name} (${loc.alt_m} m)`, () => {
      const pPa = Psy.baroPa(loc.alt_m);
      assertClose(pPa / 1000, loc.expected_kPa, loc.tol_kPa, `${loc.name} baroPa`);

      const altBack = Psy.invBaroAlt_m(pPa);
      assertClose(altBack, loc.alt_m, 1e-6, `${loc.name} invBaroAlt_m roundtrip`);
    });
  }

  it('produces physically consistent altitude effects on wsat, specific volume, and density', () => {
    const pSea = Psy.baroPa(0);
    const pDenver = Psy.baroPa(1609);
    const pDeadSea = Psy.baroPa(-200);

    assert.ok(pDeadSea > pSea && pSea > pDenver, 'Pressure must decrease monotonically with altitude');
    assert.ok(Psy.wsat_at(25, pDenver) > Psy.wsat_at(25, pSea), 'Higher altitude increases saturation humidity ratio');
    assert.ok(Psy.v_m3kg(25, 0.01, pDenver) > Psy.v_m3kg(25, 0.01, pSea), 'Higher altitude increases specific volume');
    assert.ok(Psy.rho_dry(25, 0.01, pDenver) < Psy.rho_dry(25, 0.01, pSea), 'Higher altitude reduces dry air density');
  });
});

/* ============================================================================
   5. Exact ASHRAE Eqs. (35) & (37) Wet-Bulb Roundtrip & Saturation Identity
   ============================================================================ */
describe('5. Wet-bulb temperature (ASHRAE Eqs. 35 & 37) roundtrip & saturation identity', () => {
  const WB_CASES = [
    { name: 'Sub-zero ice (-15°C, Twb=-17°C)',            Tdb: -15, Twb: -17,   pPa: Psy.P_STD },
    { name: 'Deep sub-zero ice (-30°C, Twb=-30.4°C)',     Tdb: -30, Twb: -30.4, pPa: Psy.P_STD },
    { name: 'Cross-zero (Tdb=5°C, Twb=-1°C)',           Tdb: 5,   Twb: -1,    pPa: Psy.P_STD },
    { name: 'Cross-zero (Tdb=5°C, Twb=-0.5°C)',         Tdb: 5,   Twb: -0.5,  pPa: Psy.P_STD },
    { name: 'Exact 0°C liquid wet-bulb (Tdb=5°C, Twb=0)', Tdb: 5, Twb: 0,     pPa: Psy.P_STD },
    { name: 'Temperate (Tdb=25°C, Twb=18°C)',           Tdb: 25,  Twb: 18,    pPa: Psy.P_STD },
    { name: 'Arid (Tdb=40°C, Twb=20°C)',                Tdb: 40,  Twb: 20,    pPa: Psy.P_STD },
    { name: 'Hot-humid (Tdb=45°C, Twb=35°C)',           Tdb: 45,  Twb: 35,    pPa: Psy.P_STD },
    { name: 'High-altitude Denver (Tdb=25°C, Twb=15°C)', Tdb: 25, Twb: 15,    pPa: Psy.baroPa(1609) }
  ];

  for (const c of WB_CASES) {
    it(`roundtrips w_from_TTwb <-> twb_from_Tw for ${c.name}`, () => {
      const w = Psy.w_from_TTwb(c.Tdb, c.Twb, c.pPa);
      assert.ok(w >= 0 && w <= Psy.wsat_at(c.Tdb, c.pPa), 'w must lie within [0, wsat]');
      const twbBack = Psy.twb_from_Tw(c.Tdb, w, c.pPa);
      assertClose(twbBack, c.Twb, 1e-6, `twb_from_Tw roundtrip (${c.name})`);
      const wBack = Psy.w_from_TTwb(c.Tdb, twbBack, c.pPa);
      assertClose(wBack, w, 1e-8, `w_from_TTwb secondary roundtrip (${c.name})`);
    });
  }

  it('enforces exact Twb === Tdb === Tdp at 100% RH across -30°C..60°C (including 0°C)', () => {
    const temps = [-30, -15, -5, 0, 10, 20, 25, 35, 50, 60];
    for (const T of temps) {
      const wSat = Psy.w_from_TRH(T, 1.0, Psy.P_STD);
      const st = Psy.stateFromTw(T, wSat, Psy.P_STD);
      assert.equal(st.Twb, T, `At 100% RH (${T}°C), Twb must equal Tdb exactly`);
      assert.equal(st.Tdp, T, `At 100% RH (${T}°C), Tdp must equal Tdb exactly`);
      assert.equal(Psy.twb_from_Tw(T, wSat, Psy.P_STD), T, `Direct twb_from_Tw at saturation (${T}°C)`);
    }
  });

  it('preserves strict thermodynamic ordering Tdp <= Twb <= Tdb across unsaturated states', () => {
    for (const T of [-20, 0, 15, 25, 40, 55]) {
      for (const rh01 of [0.1, 0.3, 0.5, 0.75, 0.95]) {
        const st = Psy.stateFromTw(T, Psy.w_from_TRH(T, rh01, Psy.P_STD), Psy.P_STD);
        assert.ok(
          st.Tdp <= st.Twb + 1e-9 && st.Twb <= st.T + 1e-9,
          `Ordering violated at T=${T}, RH=${rh01 * 100}%: Tdp=${st.Tdp}, Twb=${st.Twb}, Tdb=${st.T}`
        );
      }
    }
  });
});

/* ============================================================================
   6. Dew Point & Partial Pressure Roundtrip across -50..70°C
   ============================================================================ */
describe('6. Dew-point & vapor pressure roundtrip (-50..70°C)', () => {
  it('roundtrips dewpoint_from_pv(p_ws_Pa(T)) === T to < 1e-6 °C across -50..70°C', () => {
    const temps = [];
    for (let t = -50; t <= 70; t += 5) temps.push(t);
    // Include fine samples around the 0°C ice/liquid phase boundary
    temps.push(-0.5, -0.05, -0.001, 0, 0.001, 0.05, 0.5);

    for (const T of temps) {
      const pv = Psy.p_ws_Pa(T);
      const tdp = Psy.dewpoint_from_pv(pv);
      assertClose(tdp, T, 1e-6, `dewpoint_from_pv(p_ws_Pa(${T}))`);
    }
  });

  it('roundtrips w_from_pv <-> pv_from_w and w_from_Tdp <-> dewpoint_from_pv', () => {
    for (const pPa of [Psy.P_STD, Psy.baroPa(1609), Psy.baroPa(3640)]) {
      for (const Tdp of [-40, -15, 0, 12.5, 25, 45, 65]) {
        const w = Psy.w_from_Tdp(Tdp, pPa);
        const pv = Psy.pv_from_w(w, pPa);
        const wBack = Psy.w_from_pv(pv, pPa);
        const tdpBack = Psy.dewpoint_from_pv(pv);

        assertClose(wBack, w, 1e-12, `w_from_pv(pv_from_w) at Tdp=${Tdp}, pPa=${pPa}`);
        assertClose(tdpBack, Tdp, 1e-6, `Tdp roundtrip at Tdp=${Tdp}, pPa=${pPa}`);
      }
    }
  });
});

/* ============================================================================
   7. Universal Any-2-of-8 Solver (solveState) — All 25 Valid Pairs & Rejections
   ============================================================================ */
describe('7. Universal solveState(p1, v1, p2, v2, pPa) — all 25 pairs & rejections', () => {
  const ALL_PROPS = ['Tdb', 'Twb', 'Tdp', 'RH', 'W', 'h', 'v', 'Pv'];
  const DEPENDENT_PAIRS = [
    ['W', 'Tdp'],
    ['W', 'Pv'],
    ['Tdp', 'Pv']
  ];
  const DEP_KEY_SET = new Set(
    DEPENDENT_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`])
  );

  // Enumerate all 25 valid unordered independent pairs from C(8, 2) - 3
  const VALID_25_PAIRS = [];
  for (let i = 0; i < ALL_PROPS.length; i++) {
    for (let j = i + 1; j < ALL_PROPS.length; j++) {
      const p1 = ALL_PROPS[i];
      const p2 = ALL_PROPS[j];
      if (!DEP_KEY_SET.has(`${p1}|${p2}`)) {
        VALID_25_PAIRS.push([p1, p2]);
      }
    }
  }

  function extractPropSI(st, prop) {
    switch (prop) {
      case 'Tdb': return st.T;
      case 'Twb': return st.Twb;
      case 'Tdp': return st.Tdp;
      case 'RH':  return st.rh;
      case 'W':   return st.w;
      case 'h':   return st.h;
      case 'v':   return st.v;
      case 'Pv':  return st.pv;
      default: throw new Error(`Unknown prop ${prop}`);
    }
  }

  it('enumerates exactly 25 independent pairs out of C(8,2) = 28', () => {
    assert.equal(VALID_25_PAIRS.length, 25);
  });

  const CLIMATE_REGIMES = [
    { name: 'Normal temperate (25°C, 50% RH, sea level)',     T: 25,  rh01: 0.50, pPa: Psy.P_STD },
    { name: 'Hot arid (42°C, 12% RH, sea level)',             T: 42,  rh01: 0.12, pPa: Psy.P_STD },
    { name: 'Hot humid (35°C, 80% RH, sea level)',            T: 35,  rh01: 0.80, pPa: Psy.P_STD },
    { name: 'High-altitude Denver (22°C, 35% RH, 1609 m)',    T: 22,  rh01: 0.35, pPa: Psy.baroPa(1609) },
    { name: 'Sub-zero winter (-15°C, 65% RH, sea level)',     T: -15, rh01: 0.65, pPa: Psy.P_STD },
    { name: 'Cross-zero (5°C, 25% RH, sea level)',            T: 5,   rh01: 0.25, pPa: Psy.P_STD },
    { name: 'Saturated air (20°C, 100% RH, sea level)',       T: 20,  rh01: 1.00, pPa: Psy.P_STD }
  ];

  for (const regime of CLIMATE_REGIMES) {
    it(`solves ALL 25 independent pairs accurately for ${regime.name}`, () => {
      const ref = Psy.stateFromTw(
        regime.T,
        Psy.w_from_TRH(regime.T, regime.rh01, regime.pPa),
        regime.pPa
      );

      for (const [p1, p2] of VALID_25_PAIRS) {
        const v1 = extractPropSI(ref, p1);
        const v2 = extractPropSI(ref, p2);

        // Test both forward (p1, p2) and reversed (p2, p1) argument orders
        for (const [a, va, b, vb] of [[p1, v1, p2, v2], [p2, v2, p1, v1]]) {
          const res = Psy.solveState(a, va, b, vb, regime.pPa);
          assert.equal(
            res.ok,
            true,
            `Expected solveState(${a}, ${va}, ${b}, ${vb}) to succeed in ${regime.name}, got error: ${res.error}`
          );
          const s = res.state;
          assertClose(s.T, ref.T, 1e-4, `${regime.name} [${a}+${b}] Tdb`);
          assertClose(s.w, ref.w, 1e-6, `${regime.name} [${a}+${b}] W`);
          assertClose(s.rh, ref.rh, 1e-3, `${regime.name} [${a}+${b}] RH`);
          assertClose(s.h, ref.h, 1e-3, `${regime.name} [${a}+${b}] h`);
          assertClose(s.v, ref.v, 1e-5, `${regime.name} [${a}+${b}] v`);
          assertClose(s.Twb, ref.Twb, 1e-4, `${regime.name} [${a}+${b}] Twb`);
          assertClose(s.Tdp, ref.Tdp, 1e-4, `${regime.name} [${a}+${b}] Tdp`);
          assertClose(s.pv, ref.pv, 0.05, `${regime.name} [${a}+${b}] Pv`);
        }
      }
    });
  }

  it('supports case-insensitive property names and T alias', () => {
    const res = Psy.solveState('t', 25, 'rh', 50, Psy.P_STD);
    assert.equal(res.ok, true);
    assertClose(res.state.T, 25, 1e-9);
    assertClose(res.state.rh, 50, 1e-9);
  });

  it('rejects all 3 mutually dependent moisture pairs (W+Tdp, W+Pv, Tdp+Pv) in both orders', () => {
    const ref = Psy.stateFromTw(25, Psy.w_from_TRH(25, 0.5, Psy.P_STD), Psy.P_STD);
    for (const [p1, p2] of DEPENDENT_PAIRS) {
      const r1 = Psy.solveState(p1, extractPropSI(ref, p1), p2, extractPropSI(ref, p2), Psy.P_STD);
      const r2 = Psy.solveState(p2, extractPropSI(ref, p2), p1, extractPropSI(ref, p1), Psy.P_STD);
      assert.equal(r1.ok, false, `Dependent pair ${p1}+${p2} must be rejected`);
      assert.ok(typeof r1.error === 'string' && r1.error.length > 0);
      assert.equal(r2.ok, false, `Dependent pair ${p2}+${p1} must be rejected`);
      assert.ok(typeof r2.error === 'string' && r2.error.length > 0);
    }
  });

  it('rejects all 8 identical property pairs (including alias T + Tdb)', () => {
    const ref = Psy.stateFromTw(25, Psy.w_from_TRH(25, 0.5, Psy.P_STD), Psy.P_STD);
    for (const p of ALL_PROPS) {
      const v = extractPropSI(ref, p);
      const res = Psy.solveState(p, v, p, v, Psy.P_STD);
      assert.equal(res.ok, false, `Identical pair ${p}+${p} must be rejected`);
      assert.ok(res.error && res.error.length > 0);
    }
    const aliasRes = Psy.solveState('T', 25, 'Tdb', 25, Psy.P_STD);
    assert.equal(aliasRes.ok, false, 'Alias identical pair T+Tdb must be rejected');
  });

  it('rejects physically impossible, out-of-domain, singular, and invalid inputs', () => {
    const impossibleCases = [
      { desc: 'Twb > Tdb',                     args: ['Tdb', 25, 'Twb', 27] },
      { desc: 'Twb slightly > Tdb',            args: ['Tdb', 25, 'Twb', 25.05] },
      { desc: 'Twb below dry-air minimum',     args: ['Tdb', 25, 'Twb', 2] },
      { desc: 'Sub-zero Twb below dry-air min', args: ['Tdb', -30, 'Twb', -31] },
      { desc: 'RH > 100%',                     args: ['Tdb', 25, 'RH', 105] },
      { desc: 'RH < 0%',                       args: ['Tdb', 25, 'RH', -1] },
      { desc: 'Tdp > Tdb',                     args: ['Tdb', 25, 'Tdp', 26] },
      { desc: 'Tdp > Twb',                     args: ['Twb', 18, 'Tdp', 20] },
      { desc: 'W < 0',                         args: ['Tdb', 25, 'W', -0.001] },
      { desc: 'W > wsat(Tdb)',                 args: ['Tdb', 25, 'W', 0.030] },
      { desc: 'W > wsat(Twb)',                 args: ['Twb', 15, 'W', 0.020] },
      { desc: 'Pv < 0',                        args: ['Tdb', 25, 'Pv', -10] },
      { desc: 'Pv > pws(Tdb)',                 args: ['Tdb', 25, 'Pv', 4000] },
      { desc: 'h below dry-air minimum',       args: ['Tdb', 25, 'h', 10] },
      { desc: 'h above saturation maximum',    args: ['Tdb', 25, 'h', 90] },
      { desc: 'v below dry-air minimum',       args: ['Tdb', 25, 'v', 0.80] },
      { desc: 'v above saturation maximum',    args: ['Tdb', 25, 'v', 0.92] },
      { desc: 'Supersaturated W + h',          args: ['W', 0.015, 'h', 30] },
      { desc: 'Supersaturated W + v',          args: ['W', 0.015, 'v', 0.82] },
      { desc: 'W=0 with RH > 0',               args: ['W', 0, 'RH', 50] },
      { desc: 'W>0 with RH = 0',               args: ['W', 0.01, 'RH', 0] },
      { desc: 'Indeterminate W=0 & RH=0',      args: ['W', 0, 'RH', 0] },
      { desc: 'Collinear Twb=0°C + h',         args: ['Twb', 0, 'h', 9.44] },
      { desc: 'Twb + h out of range (low)',    args: ['Twb', 20, 'h', 50] },
      { desc: 'Twb + h out of range (high)',   args: ['Twb', 20, 'h', 62] },
      { desc: 'Twb + v below vMin',            args: ['Twb', 20, 'v', 0.80] },
      { desc: 'h + v below vMin',              args: ['h', 50, 'v', 0.80] },
      { desc: 'h + v above vMax',              args: ['h', 50, 'v', 1.05] },
      { desc: 'NaN value',                     args: ['Tdb', NaN, 'RH', 50] },
      { desc: 'Infinity value',                args: ['Tdb', 25, 'RH', Infinity] },
      { desc: 'Unsupported property',          args: ['Tdb', 25, 'Entropy', 50] },
      { desc: 'Invalid barometric pressure',   args: ['Tdb', 25, 'RH', 50, 500] }
    ];

    for (const c of impossibleCases) {
      const res = Psy.solveState(...c.args);
      assert.equal(res.ok, false, `Case "${c.desc}" must fail (returned ok=true)`);
      assert.ok(typeof res.error === 'string' && res.error.length > 0, `Case "${c.desc}" must provide error message`);
    }
  });
});

/* ============================================================================
   8. Airflow Mass / Volumetric Conversions & Property Formatting
   ============================================================================ */
describe('8. Airflow conversions flowToMassKgps <-> massKgpsToFlow & fmtVal', () => {
  const FLOW_UNITS = ['kgps', 'Lps', 'm3h', 'cfm', 'lbps'];
  const ALIAS_PAIRS = [
    ['kgps', 'kg/s'],
    ['Lps', 'L/s'],
    ['m3h', 'm³/h'],
    ['cfm', 'CFM'],
    ['lbps', 'lb/s']
  ];

  it('roundtrips flowToMassKgps <-> massKgpsToFlow to < 1e-12 across all 5 units & altitudes', () => {
    const states = [
      { Tc: 20, w: 0.008, pPa: Psy.P_STD },
      { Tc: 35, w: 0.022, pPa: Psy.P_STD },
      { Tc: 22, w: 0.006, pPa: Psy.baroPa(1609) },
      { Tc: -10, w: 0.001, pPa: Psy.P_STD }
    ];
    const testValues = { kgps: 2.5, Lps: 1500, m3h: 5400, cfm: 3200, lbps: 4.2 };

    for (const st of states) {
      for (const unit of FLOW_UNITS) {
        const val = testValues[unit];
        const mKgps = Psy.flowToMassKgps(val, unit, st.Tc, st.w, st.pPa);
        assert.ok(Number.isFinite(mKgps) && mKgps > 0, `flowToMassKgps(${val}, ${unit}) > 0`);
        const valBack = Psy.massKgpsToFlow(mKgps, unit, st.Tc, st.w, st.pPa);
        assertRelClose(valBack, val, 1e-12, `roundtrip ${unit} at T=${st.Tc}, pPa=${st.pPa}`);
      }
    }
  });

  it('preserves exact cross-unit physical equivalences and altitude density scaling', () => {
    const Tc = 20;
    const w = 0;
    const pSea = Psy.P_STD;
    const pDenver = Psy.baroPa(1609);

    // 1000 CFM === 471.947443 L/s === 1699.010795 m³/h
    const mFromCfm = Psy.flowToMassKgps(1000, 'cfm', Tc, w, pSea);
    const mFromLps = Psy.flowToMassKgps(471.947443, 'Lps', Tc, w, pSea);
    const mFromM3h = Psy.flowToMassKgps(1699.010795, 'm3h', Tc, w, pSea);

    assertRelClose(mFromCfm, mFromLps, 1e-7, '1000 CFM === 471.9474 L/s');
    assertRelClose(mFromCfm, mFromM3h, 1e-7, '1000 CFM === 1699.011 m³/h');

    // Standard air (20°C dry, 101.325 kPa): 1000 CFM ≈ 0.5683 kg/s ≈ 1.2529 lb/s
    assertClose(mFromCfm, 0.56831, 1e-4, '1000 CFM standard air dry mass flow (kg/s)');
    assertClose(Psy.massKgpsToFlow(mFromCfm, 'lbps', Tc, w, pSea), 1.25291, 1e-4, '1000 CFM in lb/s');

    // Altitude scaling: same volumetric CFM at Denver moves proportionally less mass (pDenver / pSea)
    const mDenver = Psy.flowToMassKgps(1000, 'cfm', Tc, w, pDenver);
    assertRelClose(mDenver / mFromCfm, pDenver / pSea, 1e-12, 'Denver/sea-level volumetric mass ratio');

    // Alias consistency
    for (const [canon, alias] of ALIAS_PAIRS) {
      assert.equal(
        Psy.flowToMassKgps(100, canon, Tc, w, pSea),
        Psy.flowToMassKgps(100, alias, Tc, w, pSea),
        `Unit alias ${alias} must match ${canon}`
      );
    }
  });

  it('formats SI and IP state properties consistently via fmtVal', () => {
    const st = Psy.stateFromTw(25, Psy.w_from_TRH(25, 0.5, Psy.P_STD), Psy.P_STD);
    assert.equal(Psy.fmtVal('Tdb', st, 'SI'), '25.00 °C');
    assert.equal(Psy.fmtVal('Tdb', st, 'IP'), '77.00 °F');
    assert.equal(Psy.fmtVal('RH', st, 'SI'), '50.0 %');
    assert.match(Psy.fmtVal('h', st, 'SI'), /^50\.32 kJ\/kg$/);
    assert.match(Psy.fmtVal('h', st, 'IP'), /^29\.30 Btu\/lb$/);
    assert.match(Psy.fmtVal('W', st, 'SI'), /^9\.88 g\/kg$/);
    assert.match(Psy.fmtVal('W', st, 'IP'), /^69\.2 gr\/lb$/);
  });
});
