/* ============================================================================
   PsychroChart Ultra 3.0 — Comprehensive Verification Suite
   Covers:
     1. Thermal Comfort (Comfort): ISO 7730 PMV/PPD, ASHRAE 55 polygons,
        Givoni bioclimatic zones, ASHRAE TC 9.9 data center envelopes,
        ASHRAE 160 mold & surface condensation risk.
     2. HVAC Systems (HVAC): 11 process classifications, exact SI/IP load
        conservation, ADP/BPF & 16-pt coil curve, 2-/3-stream & fog mixing,
        ERV conservation & frost risk, DEC/IEC/IDEC evap coolers, desiccant,
        steam & adiabatic humidifiers, 4 AHU cycle modes, ASHRAE 62.1 vent.
     3. Weather & Climate (Weather): 47-city DB, deterministic 8,760-hr TMY,
        EnergyPlus EPW parser with missing flags, smart °C/°F CSV parser,
        2D psychrometric bin & HVAC hours analytics.
     4. State Store (Store): 100-level undo/redo cap, 2-/3-stream derived mix
        recomputation, locked point guard, v2.6.6 legacy import, v3.0 JSON
        roundtrip, and Unicode-safe #p=... Share URL roundtrip.
   ============================================================================ */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CoreDOM } from '../src/core/contracts.js';
import { Psy } from '../src/engine/psychro.js';
import { Comfort } from '../src/engine/comfort.js';
import { HVAC } from '../src/engine/hvac.js';
import { Weather } from '../src/engine/weather.js';
import { createStore } from '../src/state/store.js';

/* ---- Geometry & Numeric Helpers ---- */
function approxEqual(actual, expected, tol, msg = '') {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    `${msg ? msg + ': ' : ''}expected ${actual} to be within ${tol} of ${expected} (diff=${Math.abs(actual - expected)})`
  );
}

function polygonArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) * 0.5;
}

function assertValidUnsaturatedPolygon(poly, pPa, label) {
  assert.ok(Array.isArray(poly), `${label}: polygon must be an array`);
  assert.ok(poly.length >= 4, `${label}: polygon must have >= 4 vertices (got ${poly.length})`);
  assert.ok(polygonArea(poly) > 1e-6, `${label}: polygon must have positive enclosed area`);
  for (let i = 0; i < poly.length; i++) {
    const [T, w] = poly[i];
    assert.ok(Number.isFinite(T) && Number.isFinite(w), `${label}: vertex ${i} must be finite`);
    assert.ok(w >= -1e-12, `${label}: vertex ${i} humidity ratio w=${w} must be >= 0`);
    const ws = Psy.wsat_at(T, pPa);
    assert.ok(
      w <= ws * 1.0001 + 1e-9,
      `${label}: vertex ${i} (${T.toFixed(2)}°C, w=${w.toFixed(6)}) exceeds wsat=${ws.toFixed(6)}`
    );
  }
}

/**
 * Checks whether every vertex of `innerPoly` falls inside the vertical x-monotone
 * envelope of `outerPoly` within tolerance `tolW` (kg/kg).
 */
function assertBandPolygonInside(innerPoly, outerPoly, tolW = 1e-5, label = '') {
  const outerXs = outerPoly.map((p) => p[0]);
  const minX = Math.min(...outerXs);
  const maxX = Math.max(...outerXs);
  const epsT = 1e-6;

  for (const [x, y] of innerPoly) {
    assert.ok(
      x >= minX - epsT && x <= maxX + epsT,
      `${label}: inner T=${x} outside outer T range [${minX}, ${maxX}]`
    );

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < outerPoly.length; i++) {
      const a = outerPoly[i];
      const b = outerPoly[(i + 1) % outerPoly.length];
      if ((a[0] <= x + epsT && b[0] >= x - epsT) || (b[0] <= x + epsT && a[0] >= x - epsT)) {
        if (Math.abs(b[0] - a[0]) < 1e-9) {
          minY = Math.min(minY, a[1], b[1]);
          maxY = Math.max(maxY, a[1], b[1]);
        } else {
          const frac = Math.max(0, Math.min(1, (x - a[0]) / (b[0] - a[0])));
          const yi = a[1] + frac * (b[1] - a[1]);
          minY = Math.min(minY, yi);
          maxY = Math.max(maxY, yi);
        }
      }
    }

    assert.ok(
      y >= minY - tolW && y <= maxY + tolW,
      `${label}: inner vertex (${x.toFixed(2)}°C, w=${y.toFixed(6)}) outside outer envelope [${minY.toFixed(6)}, ${maxY.toFixed(6)}]`
    );
  }
}

/* ============================================================================
   1. THERMAL COMFORT (Comfort)
   ============================================================================ */
describe('1. Thermal Comfort (Comfort)', () => {
  it('matches ISO 7730:2005 Annex D benchmark cases for calcPMV & PPD', () => {
    // Benchmark 1: T=22°C, mrt=22°C, vAir=0.1, RH=60%, met=1.2, clo=0.5 -> PMV ≈ -0.75, PPD ≈ 17%
    const c1 = Comfort.calcPMV(22, 60, { mrt: 22, vAir: 0.1, met: 1.2, clo: 0.5 });
    approxEqual(c1.pmv, -0.75, 0.02, 'ISO 7730 Case 1 PMV');
    approxEqual(c1.ppd, 17.0, 0.5, 'ISO 7730 Case 1 PPD');
    assert.equal(c1.sensation, 'Slightly Cool');
    assert.equal(c1.compliant, false);

    // Benchmark 2: T=27°C, mrt=27°C, vAir=0.1, RH=60%, met=1.2, clo=0.5 -> PMV ≈ +0.77, PPD ≈ 17.5%
    const c2 = Comfort.calcPMV(27, 60, { mrt: 27, vAir: 0.1, met: 1.2, clo: 0.5 });
    approxEqual(c2.pmv, 0.77, 0.02, 'ISO 7730 Case 2 PMV');
    approxEqual(c2.ppd, 17.5, 0.5, 'ISO 7730 Case 2 PPD');
    assert.equal(c2.sensation, 'Slightly Warm');
    assert.equal(c2.compliant, false);

    // Benchmark 3: T=24.5°C, mrt=24.5°C, vAir=0.1, RH=50%, met=1.1, clo=0.5 -> Neutral comfort
    // Exact ISO 7730:2005 value is PMV = -0.299, PPD = 6.86%, compliant = true.
    const c3 = Comfort.calcPMV(24.5, 50, { mrt: 24.5, vAir: 0.1, met: 1.1, clo: 0.5 });
    approxEqual(c3.pmv, -0.299, 0.01, 'ISO 7730 Case 3 PMV (met=1.1)');
    assert.ok(Math.abs(c3.pmv) <= 0.5, 'Case 3 must be within ±0.5 comfort band');
    assert.ok(c3.ppd < 7.0 && c3.ppd >= 5.0, `Case 3 PPD=${c3.ppd} must be in [5%, 7%)`);
    assert.equal(c3.sensation, 'Neutral (Comfort)');
    assert.equal(c3.compliant, true);

    // Neutral center checks: at 25.0°C (met=1.1) and 24.5°C (met=1.2), |PMV| < 0.25, PPD < 6%
    const c3b = Comfort.calcPMV(25.0, 50, { mrt: 25.0, vAir: 0.1, met: 1.1, clo: 0.5 });
    assert.ok(Math.abs(c3b.pmv) < 0.25, `25.0°C met=1.1 PMV=${c3b.pmv} should have |PMV| < 0.25`);
    assert.ok(c3b.ppd < 7.0, `PPD=${c3b.ppd} should be < 7%`);
    assert.equal(c3b.compliant, true);

    const c3c = Comfort.calcPMV(24.5, 50, { mrt: 24.5, vAir: 0.1, met: 1.2, clo: 0.5 });
    assert.ok(Math.abs(c3c.pmv) < 0.25, `24.5°C met=1.2 PMV=${c3c.pmv} should have |PMV| < 0.25`);
    assert.ok(c3c.ppd < 7.0);
    assert.equal(c3c.compliant, true);

    // Physical monotonicity checks
    const warmerClo = Comfort.calcPMV(22, 50, { clo: 1.0, met: 1.1 });
    const lighterClo = Comfort.calcPMV(22, 50, { clo: 0.5, met: 1.1 });
    assert.ok(warmerClo.pmv > lighterClo.pmv, 'Higher clo must raise PMV');

    const drafty = Comfort.calcPMV(24, 50, { vAir: 0.5, clo: 0.5, met: 1.1 });
    const still = Comfort.calcPMV(24, 50, { vAir: 0.1, clo: 0.5, met: 1.1 });
    assert.ok(drafty.pmv < still.pmv, 'Higher air velocity below skin temp must cool PMV');
  });

  it('generates valid unsaturated ASHRAE 55 polygons that shift with clo and adapt to altitude', () => {
    const pSea = 101325;
    const pDenver = Psy.baroPa(1609);

    const polySummer = Comfort.generateASHRAE55Polygon(pSea, { clo: 0.5, met: 1.1, vAir: 0.1 });
    const polyWinter = Comfort.generateASHRAE55Polygon(pSea, { clo: 1.0, met: 1.1, vAir: 0.1 });
    const polyDenver = Comfort.generateASHRAE55Polygon(pDenver, { clo: 0.5, met: 1.1, vAir: 0.1 });

    assertValidUnsaturatedPolygon(polySummer, pSea, 'ASHRAE55 Summer (0.5 clo)');
    assertValidUnsaturatedPolygon(polyWinter, pSea, 'ASHRAE55 Winter (1.0 clo)');
    assertValidUnsaturatedPolygon(polyDenver, pDenver, 'ASHRAE55 Denver (1609m)');

    // Mean temperature shifts significantly cooler when clo increases from 0.5 -> 1.0
    const meanT = (poly) => poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const tSummer = meanT(polySummer);
    const tWinter = meanT(polyWinter);
    assert.ok(
      tWinter < tSummer - 2.0,
      `Winter polygon mean T (${tWinter.toFixed(2)}°C) must be cooler than summer (${tSummer.toFixed(2)}°C)`
    );

    // Altitude adaptation: at 1609m, lower pPa reduces vapor partial pressure pa for a given w,
    // shifting the upper-humidity portion of the comfort polygon slightly warmer than at sea level
    const maxW = 0.012;
    const topTSea = polySummer.filter((p) => Math.abs(p[1] - maxW) < 1e-4).map((p) => p[0]);
    const topTDenver = polyDenver.filter((p) => Math.abs(p[1] - maxW) < 1e-4).map((p) => p[0]);
    assert.ok(topTSea.length >= 2 && topTDenver.length >= 2);
    const avgTopSea = topTSea.reduce((a, b) => a + b, 0) / topTSea.length;
    const avgTopDenver = topTDenver.reduce((a, b) => a + b, 0) / topTDenver.length;
    assert.ok(
      avgTopDenver > avgTopSea + 0.05,
      `Denver comfort band at w=12 g/kg (${avgTopDenver.toFixed(3)}°C) should shift warmer than sea level (${avgTopSea.toFixed(3)}°C)`
    );

    // getSummerWinterZones wrapper
    const sw = Comfort.getSummerWinterZones(pSea, { cloSummer: 0.5, cloWinter: 1.0 });
    assertValidUnsaturatedPolygon(sw.summer.poly, pSea, 'SummerWinter.summer');
    assertValidUnsaturatedPolygon(sw.winter.poly, pSea, 'SummerWinter.winter');
  });

  it('generates valid Givoni bioclimatic zones and strictly nested ASHRAE TC 9.9 data center zones', () => {
    const pPa = 101325;

    // Givoni zones
    const givoni = Comfort.getGivoniZones(pPa);
    assert.equal(givoni.length, 6, 'Expected 6 Givoni bioclimatic zones');
    for (const z of givoni) {
      assert.ok(z.id && z.label && z.fill && z.stroke);
      assertValidUnsaturatedPolygon(z.poly, pPa, `Givoni:${z.id}`);
    }

    // ASHRAE TC 9.9 (2021 5th Ed.) Data Center zones: Recommended + A1–A4
    const dc = Comfort.getDataCenterZones(pPa);
    assert.equal(dc.length, 5, 'Expected 5 ASHRAE TC 9.9 data center zones (Rec, A1–A4)');
    const byId = Object.fromEntries(dc.map((z) => [z.id, z]));
    for (const id of ['tc99_rec', 'tc99_a1', 'tc99_a2', 'tc99_a3', 'tc99_a4']) {
      assert.ok(byId[id], `Missing TC 9.9 zone ${id}`);
      assertValidUnsaturatedPolygon(byId[id].poly, pPa, `TC9.9:${id}`);
    }

    // Nesting: Recommended ⊂ Class A1 ⊂ Class A2 ⊂ Class A3 ⊂ Class A4
    // (1e-5 kg/kg tolerance accommodates TC 9.9's published -9°C DP vs 8% RH corner at 27°C = 0.0089 g/kg)
    assertBandPolygonInside(byId.tc99_rec.poly, byId.tc99_a1.poly, 1e-5, 'Recommended inside A1');
    assertBandPolygonInside(byId.tc99_a1.poly, byId.tc99_a2.poly, 1e-5, 'A1 inside A2');
    assertBandPolygonInside(byId.tc99_a2.poly, byId.tc99_a3.poly, 1e-5, 'A2 inside A3');
    assertBandPolygonInside(byId.tc99_a3.poly, byId.tc99_a4.poly, 1e-5, 'A3 inside A4');

    // Strictly increasing areas and temperature spans
    const areaRec = polygonArea(byId.tc99_rec.poly);
    const areaA1 = polygonArea(byId.tc99_a1.poly);
    const areaA2 = polygonArea(byId.tc99_a2.poly);
    const areaA3 = polygonArea(byId.tc99_a3.poly);
    const areaA4 = polygonArea(byId.tc99_a4.poly);
    assert.ok(
      areaRec < areaA1 && areaA1 < areaA2 && areaA2 < areaA3 && areaA3 < areaA4,
      'TC 9.9 areas must increase Rec < A1 < A2 < A3 < A4'
    );

    // Tightest class evaluation via evaluatePointZones
    const evRec = Comfort.evaluatePointZones(22, Psy.w_from_TRH(22, 0.45, pPa), pPa);
    const evA1 = Comfort.evaluatePointZones(30, Psy.w_from_TRH(30, 0.40, pPa), pPa);
    const evA2 = Comfort.evaluatePointZones(34, Psy.w_from_TRH(34, 0.30, pPa), pPa);
    const evA3 = Comfort.evaluatePointZones(38, Psy.w_from_TRH(38, 0.25, pPa), pPa);
    const evA4 = Comfort.evaluatePointZones(43, Psy.w_from_TRH(43, 0.20, pPa), pPa);
    const evOut = Comfort.evaluatePointZones(46, Psy.w_from_TRH(46, 0.50, pPa), pPa);
    assert.equal(evRec.dataCenterClass, 'Recommended');
    assert.equal(evA1.dataCenterClass, 'Class A1');
    assert.equal(evA2.dataCenterClass, 'Class A2');
    assert.equal(evA3.dataCenterClass, 'Class A3');
    assert.equal(evA4.dataCenterClass, 'Class A4');
    assert.equal(evOut.dataCenterClass, null);
  });

  it('classifies ASHRAE 160 mold & surface condensation risk accurately', () => {
    const pPa = 101325;
    const T = 22;
    const wHumid = Psy.w_from_TRH(T, 0.65, pPa); // Tdp ≈ 15.13°C
    const tdp = Psy.stateFromTw(T, wHumid, pPa).Tdp;

    // Condensation when surfaceT <= Tdp
    const rCondBelow = Comfort.calcMoldCondensationRisk(T, wHumid, pPa, tdp - 1.5);
    assert.equal(rCondBelow.riskLevel, 'condensation');
    assert.equal(rCondBelow.condensation, true);
    approxEqual(rCondBelow.Tdp, tdp, 1e-4);

    const rCondExact = Comfort.calcMoldCondensationRisk(T, wHumid, pPa, tdp);
    assert.equal(rCondExact.riskLevel, 'condensation');
    assert.equal(rCondExact.condensation, true);

    // High mold risk when surfaceT > Tdp and surfaceRH >= 80%
    const rHigh = Comfort.calcMoldCondensationRisk(T, wHumid, pPa, tdp + 2.0);
    assert.equal(rHigh.condensation, false);
    assert.ok(rHigh.surfaceRH >= 80 && rHigh.surfaceRH < 100);
    assert.equal(rHigh.riskLevel, 'high');

    // Moderate mold risk when 70% <= surfaceRH < 80%
    const rMod = Comfort.calcMoldCondensationRisk(T, wHumid, pPa, tdp + 4.8);
    assert.equal(rMod.condensation, false);
    assert.ok(rMod.surfaceRH >= 70 && rMod.surfaceRH < 80, `Expected surfaceRH in [70,80), got ${rMod.surfaceRH}`);
    assert.equal(rMod.riskLevel, 'moderate');

    // None when warm & dry
    const wDry = Psy.w_from_TRH(25, 0.30, pPa);
    const rNone = Comfort.calcMoldCondensationRisk(25, wDry, pPa, 22);
    assert.equal(rNone.riskLevel, 'none');
    assert.equal(rNone.condensation, false);
    assert.ok(rNone.surfaceRH < 70);
  });
});

/* ============================================================================
   2. HVAC SYSTEMS (HVAC)
   ============================================================================ */
describe('2. HVAC Systems (HVAC)', () => {
  it('classifies all 11 psychrometric process types accurately', () => {
    const pPa = 101325;
    const cases = [
      { name: 'No Change', cls: 'neutral', a: { T: 24, w: 0.010 }, b: { T: 24.02, w: 0.01001 } },
      { name: 'Sensible Heating', cls: 'heat', a: { T: 20, w: 0.008 }, b: { T: 32, w: 0.00802 } },
      { name: 'Sensible Cooling', cls: 'cool', a: { T: 32, w: 0.008 }, b: { T: 20, w: 0.008 } },
      {
        name: 'Evaporative Cooling',
        cls: 'evap',
        a: { T: 38, w: 0.006 },
        b: { T: 25, w: Psy.w_from_TTwb(25, Psy.twb_from_Tw(38, 0.006, pPa), pPa) }
      },
      {
        name: 'Desiccant Dehumidification',
        cls: 'desiccant',
        a: { T: 25, w: 0.014 },
        b: { T: Psy.Tdb_from_wh(0.006, Psy.h_kJkg(25, 0.014) + 1.5), w: 0.006 }
      },
      { name: 'Steam Humidification', cls: 'humid', a: { T: 22, w: 0.005 }, b: { T: 22.2, w: 0.009 } },
      { name: 'Dehumidification', cls: 'dehum', a: { T: 24, w: 0.014 }, b: { T: 23.9, w: 0.009 } },
      { name: 'Cooling & Dehumidification', cls: 'cool', a: { T: 30, w: 0.015 }, b: { T: 14, w: 0.009 } },
      { name: 'Heating & Humidification', cls: 'heat', a: { T: 10, w: 0.004 }, b: { T: 25, w: 0.010 } },
      { name: 'Cooling & Humidification', cls: 'evap', a: { T: 30, w: 0.008 }, b: { T: 20, w: 0.014 } },
      { name: 'Heating & Dehumidification', cls: 'dehum', a: { T: 20, w: 0.014 }, b: { T: 30, w: 0.008 } }
    ];

    const seenTypes = new Set();
    for (const tc of cases) {
      const info = HVAC.classifyProcess(tc.a, tc.b, pPa);
      assert.equal(info.type, tc.name, `Expected "${tc.name}", got "${info.type}"`);
      assert.equal(info.cls, tc.cls, `Expected cls "${tc.cls}", got "${info.cls}"`);
      assert.ok(info.color && info.shortType);
      seenTypes.add(info.type);
    }
    assert.equal(seenTypes.size, 11, 'Must cover all 11 distinct process classifications');
  });

  it('enforces exact energy conservation Qt = Qs + Ql and Qt_TR across all SI and IP flow units', () => {
    const a = { T: 32, w: 0.016 };
    const b = { T: 14, w: 0.009 };

    for (const pPa of [101325, Psy.baroPa(1609)]) {
      // Exact equivalent airflows across SI (Lps, kgps, m3h) and IP (cfm, lbps)
      const baseLps = 1500;
      const mRef = Psy.flowToMassKgps(baseLps, 'Lps', a.T, a.w, pPa);
      const flows = [
        { val: baseLps, unit: 'Lps' },
        { val: mRef, unit: 'kgps' },
        { val: baseLps * 3.6, unit: 'm3h' },
        { val: Psy.massKgpsToFlow(mRef, 'cfm', a.T, a.w, pPa), unit: 'cfm' },
        { val: mRef * Psy.LB_PER_KG, unit: 'lbps' }
      ];

      let refQt = null;
      for (const f of flows) {
        const m = HVAC.calcProcessMetrics(a, b, pPa, f.val, f.unit);
        approxEqual(m.Qs_kW + m.Ql_kW, m.Qt_kW, 1e-9, `SI kW conservation (${f.unit})`);
        approxEqual(m.Qs_BTUh + m.Ql_BTUh, m.Qt_BTUh, 1e-6, `IP BTU/h conservation (${f.unit})`);
        approxEqual(m.Qt_TR, m.Qt_kW / Psy.KW_PER_TON, 1e-9, `Tonnage conversion (${f.unit})`);
        approxEqual(m.mDa, mRef, 1e-9, `Mass flow equivalence (${f.unit})`);
        approxEqual(m.waterRate_kgh, m.mDa * (b.w - a.w) * 3600, 1e-9, `Water rate (${f.unit})`);
        assert.ok(m.Qt_kW < 0 && m.Qs_kW < 0 && m.Ql_kW < 0, 'Cooling+dehum loads should be negative');

        if (refQt === null) refQt = m.Qt_kW;
        else approxEqual(m.Qt_kW, refQt, 1e-9, `Qt consistency across ${f.unit}`);
      }
    }
  });

  it('computes valid ADP, BPF/CF, and strictly unsaturated monotonic 16-pt curved coil path', () => {
    const pPa = 101325;
    // Construct an exact physical cooling+dehum coil process with known ADP=10.5°C and BPF=0.15
    const expectedAdpT = 10.5;
    const expectedBpf = 0.15;
    const expectedAdpW = Psy.wsat_at(expectedAdpT, pPa);
    const a = { T: 28.0, w: 0.0145 };
    const b = {
      T: expectedAdpT + expectedBpf * (a.T - expectedAdpT),
      w: expectedAdpW + expectedBpf * (a.w - expectedAdpW)
    };
    const res = HVAC.calcADP(a, b, pPa, 5.5);

    assert.equal(res.valid, true, `Expected valid ADP, got reason: ${res.reason}`);
    assert.ok(res.T_adp < b.T && b.T < a.T, `Expected T_adp (${res.T_adp}) < b.T (${b.T}) < a.T (${a.T})`);
    approxEqual(res.T_adp, expectedAdpT, 1e-4, 'Exact T_adp recovery');
    approxEqual(res.w_adp, Psy.wsat_at(res.T_adp, pPa), 1e-9, 'w_adp on saturation curve');
    assert.ok(res.BPF > 0 && res.BPF < 1, `BPF=${res.BPF} must be strictly in (0, 1)`);
    approxEqual(res.BPF, expectedBpf, 1e-4, 'Exact BPF recovery');
    approxEqual(res.BPF + res.CF, 1.0, 1e-12, 'BPF + CF === 1');

    // Verify ADP collinearity with (a -> b)
    const slopeAB = (b.w - a.w) / (b.T - a.T);
    const slopeAdp = (res.w_adp - b.w) / (res.T_adp - b.T);
    approxEqual(slopeAdp, slopeAB, 1e-5, 'ADP lies on condition line extension');

    // 16-point curved coil path: endpoints match, strictly unsaturated, monotonic T & w
    assert.equal(res.coilCurvePts.length, 16, 'Coil curve must have 16 points');
    approxEqual(res.coilCurvePts[0].T, a.T, 1e-12);
    approxEqual(res.coilCurvePts[0].w, a.w, 1e-12);
    approxEqual(res.coilCurvePts[15].T, b.T, 1e-12);
    approxEqual(res.coilCurvePts[15].w, b.w, 1e-12);

    for (let i = 0; i < res.coilCurvePts.length; i++) {
      const pt = res.coilCurvePts[i];
      const ws = Psy.wsat_at(pt.T, pPa);
      assert.ok(pt.w <= ws + 1e-12, `Curve pt ${i} supersaturated: w=${pt.w} > wsat=${ws}`);
      if (i > 0) {
        const prev = res.coilCurvePts[i - 1];
        assert.ok(pt.T < prev.T, `Curve T must decrease monotonically at idx ${i}`);
        assert.ok(pt.w <= prev.w + 1e-12, `Curve w must be non-increasing at idx ${i}`);
      }
    }

    // Invalid process checks
    assert.equal(HVAC.calcADP(b, a, pPa).valid, false, 'Heating process should have no ADP');
    assert.equal(HVAC.calcADP({ T: 30, w: 0.006 }, { T: 20, w: 0.010 }, pPa).valid, false, 'Evap cooling has no ADP');
    assert.equal(HVAC.calcADP({ T: 25, w: 0.015 }, { T: 24, w: 0.005 }, pPa).valid, false, 'Steep low-SHR line misses sat');
  });

  it('conserves mass & enthalpy in 2-stream and 3-stream mixing and detects supersaturated fog mixing', () => {
    const pPa = 101325;

    // 2-stream normal mixing
    const sA = { T: 35, w: 0.018, flowVal: 500, flowUnit: 'Lps' };
    const sB = { T: 24, w: 0.009, flowVal: 1500, flowUnit: 'Lps' };
    const mix2 = HVAC.calcMixing([sA, sB], pPa);

    const mA = Psy.flowToMassKgps(sA.flowVal, sA.flowUnit, sA.T, sA.w, pPa);
    const mB = Psy.flowToMassKgps(sB.flowVal, sB.flowUnit, sB.T, sB.w, pPa);
    const hA = Psy.h_kJkg(sA.T, sA.w);
    const hB = Psy.h_kJkg(sB.T, sB.w);

    approxEqual(mix2.mTotal, mA + mB, 1e-9, '2-stream mass conservation');
    approxEqual(mA * sA.w + mB * sB.w, mix2.mTotal * mix2.w, 1e-9, '2-stream moisture conservation');
    approxEqual(mA * hA + mB * hB, mix2.mTotal * mix2.h, 1e-9, '2-stream enthalpy conservation');
    approxEqual(Psy.h_kJkg(mix2.T, mix2.w), mix2.h, 1e-9, '2-stream T/w reproduces hMix');
    assert.equal(mix2.condensationWarning, false);
    assert.equal(mix2.fogWater_kgkg, 0);

    // 3-stream mixing
    const sC = { T: 15, w: 0.006, flowVal: 0.8, flowUnit: 'kgps' };
    const mix3 = HVAC.calcMixing([sA, sB, sC], pPa);
    const mC = 0.8;
    const hC = Psy.h_kJkg(sC.T, sC.w);
    approxEqual(mix3.mTotal, mA + mB + mC, 1e-9, '3-stream mass conservation');
    approxEqual(mA * sA.w + mB * sB.w + mC * sC.w, mix3.mTotal * mix3.w, 1e-9, '3-stream moisture conservation');
    approxEqual(mA * hA + mB * hB + mC * hC, mix3.mTotal * mix3.h, 1e-9, '3-stream enthalpy conservation');
    approxEqual(mix3.fractions.reduce((x, y) => x + y, 0), 1.0, 1e-12);
    assert.equal(mix3.condensationWarning, false);

    // Fog / condensation mixing: freezing saturated air (-10°C, 100% RH) + hot humid air (35°C, 95% RH)
    const coldSat = { T: -10, w: Psy.wsat_at(-10, pPa), flowVal: 1.0, flowUnit: 'kgps' };
    const hotHumid = { T: 35, w: Psy.w_from_TRH(35, 0.95, pPa), flowVal: 1.0, flowUnit: 'kgps' };
    const fogMix = HVAC.calcMixing([coldSat, hotHumid], pPa);

    assert.equal(fogMix.condensationWarning, true, 'Extreme cold+hot humid mix must trigger fog warning');
    assert.ok(fogMix.fogWater_kgkg > 0.001, `Expected significant fog condensate, got ${fogMix.fogWater_kgkg}`);
    approxEqual(fogMix.w, Psy.wsat_at(fogMix.T, pPa), 1e-6, 'Fog equilibrium lies on saturation curve');
    approxEqual(Psy.h_kJkg(fogMix.T, fogMix.w), fogMix.h, 1e-4, 'Fog equilibrium conserves total enthalpy');
  });

  it('conserves energy in ERV supply/exhaust and flags frost risk in cold winter', () => {
    const pPa = 101325;

    // Summer recovery (balanced & unbalanced flows)
    const oaSum = { T: 35, w: Psy.w_from_TRH(35, 0.55, pPa) };
    const raSum = { T: 24, w: Psy.w_from_TRH(24, 0.50, pPa) };
    for (const [flowOA, flowRA] of [[1000, 1000], [800, 1200]]) {
      const erv = HVAC.calcERV(oaSum, raSum, pPa, {
        sensEff: 0.72,
        latEff: 0.65,
        flowOA,
        flowRA,
        flowUnit: 'Lps'
      });

      const hOA = Psy.h_kJkg(oaSum.T, oaSum.w);
      const hSup = Psy.h_kJkg(erv.supplyOut.T, erv.supplyOut.w);
      const hRA = Psy.h_kJkg(raSum.T, raSum.w);
      const hExh = Psy.h_kJkg(erv.exhaustOut.T, erv.exhaustOut.w);
      const imbalance_kW = erv.mOA * (hSup - hOA) + erv.mRA * (hExh - hRA);

      // Sensible & moisture conservation are exact; total enthalpy balance within < 0.5% (vapor cp cross-term)
      approxEqual(
        erv.mOA * (erv.supplyOut.T - oaSum.T) + erv.mRA * (erv.exhaustOut.T - raSum.T),
        0,
        1e-9,
        'ERV sensible conservation'
      );
      approxEqual(
        erv.mOA * (erv.supplyOut.w - oaSum.w) + erv.mRA * (erv.exhaustOut.w - raSum.w),
        0,
        1e-12,
        'ERV moisture conservation'
      );
      assert.ok(
        Math.abs(imbalance_kW) / erv.QtSaved_kW < 0.01,
        `ERV enthalpy imbalance ${imbalance_kW.toFixed(4)} kW exceeds 1% of QtSaved=${erv.QtSaved_kW.toFixed(2)} kW`
      );
      approxEqual(erv.QsSaved_kW + erv.QlSaved_kW, erv.QtSaved_kW, 1e-9);
      assert.equal(erv.frostRisk, false);
    }

    // Cold winter frost risk: oa = -15°C, ra = 22°C 50% RH
    const oaWin = { T: -15, w: Psy.w_from_TRH(-15, 0.70, pPa) };
    const raWin = { T: 22, w: Psy.w_from_TRH(22, 0.50, pPa) };
    const ervWin = HVAC.calcERV(oaWin, raWin, pPa, {
      sensEff: 0.75,
      latEff: 0.65,
      flowOA: 1000,
      flowRA: 1000,
      flowUnit: 'Lps'
    });
    assert.equal(ervWin.frostRisk, true, 'Cold winter ERV (-15°C OA, 22°C/50% RA) must trigger frostRisk');
    assert.ok(ervWin.exhaustOut.T < 0, `Exhaust temp (${ervWin.exhaustOut.T}°C) should be sub-freezing`);
    assert.ok(ervWin.supplyOut.T > oaWin.T, 'Winter ERV must preheat outdoor air');
    assert.ok(ervWin.QtSaved_kW > 0, 'Winter ERV saved load must be positive');
  });

  it('models DEC, IEC, and 2-stage IDEC evaporative cooling accurately', () => {
    const pPa = 101325;
    const inlet = { T: 40, w: Psy.w_from_TRH(40, 0.15, pPa) };

    const dec = HVAC.calcEvapCooler(inlet, pPa, { mode: 'direct', effDirect: 0.85, flowVal: 1000 });
    const iec = HVAC.calcEvapCooler(inlet, pPa, { mode: 'indirect', effIndirect: 0.75, flowVal: 1000 });
    const idec = HVAC.calcEvapCooler(inlet, pPa, {
      mode: 'twostage',
      effDirect: 0.85,
      effIndirect: 0.75,
      flowVal: 1000
    });

    // DEC moves along constant thermodynamic wet-bulb
    assert.ok(Math.abs(dec.outletTwb - dec.inletTwb) < 0.1, `DEC Twb drift=${Math.abs(dec.outletTwb - dec.inletTwb)}`);
    assert.ok(dec.outlet.T < inlet.T && dec.outlet.w > inlet.w);
    assert.ok(dec.waterUse_Lh > 0);

    // IEC keeps w constant while cooling sensibly
    approxEqual(iec.outlet.w, inlet.w, 1e-12, 'IEC must keep humidity ratio constant');
    assert.ok(iec.outlet.T < inlet.T && iec.outletTwb < iec.inletTwb);

    // 2-stage IDEC beats single-stage DEC on outlet dry-bulb temperature AND adds less moisture
    assert.equal(idec.stages.length, 2);
    assert.ok(
      idec.outlet.T < dec.outlet.T,
      `IDEC outlet T (${idec.outlet.T.toFixed(2)}°C) must be lower than DEC (${dec.outlet.T.toFixed(2)}°C)`
    );
    assert.ok(idec.outlet.w < dec.outlet.w, 'IDEC outlet should be drier than single-stage DEC');
  });

  it('models solid desiccant dehumidification and steam/adiabatic humidification', () => {
    const pPa = 101325;

    // Desiccant wheel
    const desIn = { T: 26, w: 0.015 };
    const des = HVAC.calcDesiccant(desIn, pPa, {
      moistureRemovalEff: 0.65,
      thermalCarryover: 0.15,
      regenTempC: 110,
      flowVal: 1000
    });
    assert.ok(des.outlet.w < desIn.w, 'Desiccant must lower humidity ratio w');
    assert.ok(des.outlet.T > desIn.T + 10, 'Desiccant exothermic adsorption must raise Tdb significantly');
    assert.ok(des.regenHeat_kW > 0, 'Desiccant must require positive regenHeat_kW');
    assert.ok(des.moistureRate_kgh > 0);

    // Steam humidifier: raises w with slight +ΔT (~0.1..1.2°C)
    const humIn = { T: 21, w: 0.004 };
    const steam = HVAC.calcHumidifier(humIn, 0.009, pPa, { mode: 'steam', steamTempC: 100, flowVal: 1000 });
    approxEqual(steam.outlet.w, 0.009, 1e-9, 'Steam humidifier reaches target w');
    const dTSteam = steam.outlet.T - humIn.T;
    assert.ok(dTSteam >= 0.1 && dTSteam <= 1.2, `Steam humidifier ΔT=${dTSteam.toFixed(3)}°C should be ~0.1..1°C`);
    assert.ok(steam.steamEnergy_kW > 0 && steam.waterRate_kgh > 0);
    assert.equal(steam.saturatedClamped, false);

    // Adiabatic humidifier: raises w with evaporative cooling (-ΔT)
    const adiab = HVAC.calcHumidifier(humIn, 0.007, pPa, { mode: 'adiabatic', flowVal: 1000 });
    approxEqual(adiab.outlet.w, 0.007, 1e-6);
    assert.ok(adiab.outlet.T < humIn.T - 4.0, `Adiabatic humidifier must cool air (ΔT=${(adiab.outlet.T - humIn.T).toFixed(2)}°C)`);
    assert.equal(adiab.steamEnergy_kW, 0);
    assert.equal(adiab.saturatedClamped, false);

    // Adiabatic humidifier clamping at saturation when targetW exceeds saturation line
    const adiabSat = HVAC.calcHumidifier(humIn, 0.025, pPa, { mode: 'adiabatic', flowVal: 1000 });
    assert.equal(adiabSat.saturatedClamped, true, 'Excessive adiabatic targetW must clamp at saturation');
    assert.ok(adiabSat.outlet.T < humIn.T);
    assert.ok(adiabSat.outlet.w <= Psy.wsat_at(adiabSat.outlet.T, pPa) + 1e-9);
    assert.ok(adiabSat.outlet.w < 0.025);
  });

  it('builds all 4 AHU cycle modes with valid points, processes, and finite summary KPIs', () => {
    const pPa = 101325;
    const modeConfigs = [
      {
        mode: 'summer_reheat',
        params: { mode: 'summer_reheat', oaT: 35, oaRH: 55, raT: 24, raRH: 50, oaPct: 25, supplyFlow: 2000, coilAdp: 10.5, coilBpf: 0.12, reheatT: 16 },
        check: (res) => {
          assert.ok(res.summary.cooling_kW > 0);
          assert.ok(res.summary.reheat_kW > 0);
          assert.ok(res.summary.condensate_kgh > 0);
          assert.ok(res.summary.fan_kW > 0);
        }
      },
      {
        mode: 'doas_erv',
        params: { mode: 'doas_erv', oaT: 35, oaRH: 60, raT: 24, raRH: 50, supplyFlow: 1500, coilAdp: 10, coilBpf: 0.1, reheatT: 18, ervSensEff: 0.72, ervLatEff: 0.65 },
        check: (res) => {
          assert.equal(res.summary.oaPctUsed, 100);
          assert.ok(res.summary.ervSaved_kW > 0);
          assert.ok(res.summary.cooling_kW > 0);
        }
      },
      {
        mode: 'winter_humid',
        params: { mode: 'winter_humid', oaT: -5, oaRH: 70, raT: 21, raRH: 40, oaPct: 30, supplyFlow: 2000, reheatT: 30, humidTargetW: 0.0075, humidMode: 'steam' },
        check: (res) => {
          assert.ok(res.summary.preheat_kW > 0);
          assert.ok(res.summary.humidWater_kgh > 0);
          assert.equal(res.summary.cooling_kW, 0);
        }
      },
      {
        mode: 'economizer',
        params: { mode: 'economizer', oaT: 14, oaRH: 50, raT: 24, raRH: 50, oaPct: 20, supplyFlow: 2000, coilAdp: 10.5, coilBpf: 0.12, reheatT: 15 },
        check: (res) => {
          assert.ok(res.summary.economizerSaved_kW > 0);
          assert.ok(res.summary.oaPctUsed > 20);
          assert.equal(res.summary.economizerState, 'modulating_free_cooling');
        }
      }
    ];

    const finiteKPIs = [
      'cooling_kW', 'cooling_TR', 'reheat_kW', 'preheat_kW', 'fan_kW',
      'ervSaved_kW', 'condensate_kgh', 'humidWater_kgh', 'roomQs_kW',
      'roomQl_kW', 'supplyT_C', 'supplyRH', 'oaPctUsed',
      'economizerSaved_kW', 'baselineCooling_kW'
    ];

    for (const cfg of modeConfigs) {
      const res = HVAC.buildAHUCycle(cfg.params, pPa);
      assert.equal(res.mode, cfg.mode);
      assert.ok(res.points.length >= 4, `${cfg.mode}: expected >= 4 points`);
      assert.ok(res.processes.length >= 2, `${cfg.mode}: expected >= 2 processes`);

      for (const pt of res.points) {
        assert.ok(Number.isFinite(pt.T) && Number.isFinite(pt.w) && pt.w >= 0);
        assert.ok(pt.w <= Psy.wsat_at(pt.T, pPa) * 1.001, `${cfg.mode} pt ${pt.key} supersaturated`);
      }
      for (const pr of res.processes) {
        assert.ok(pr.fromIdx >= 0 && pr.fromIdx < res.points.length);
        assert.ok(pr.toIdx >= 0 && pr.toIdx < res.points.length);
        assert.ok(Number.isFinite(pr.metrics.Qt_kW));
      }
      for (const k of finiteKPIs) {
        assert.ok(Number.isFinite(res.summary[k]), `${cfg.mode}: summary.${k} must be finite (got ${res.summary[k]})`);
      }
      cfg.check(res);
    }
  });

  it('computes exact ASHRAE 62.1 ventilation rates, steady-state CO2, and validates all 12 space presets', () => {
    assert.equal(HVAC.ASHRAE_62_1_SPACES.length, 12, 'Must provide 12 ASHRAE 62.1 space presets');

    const oa = { T: 35, w: 0.018 };
    const rm = { T: 24, w: 0.009 };
    const ids = new Set();

    for (const sp of HVAC.ASHRAE_62_1_SPACES) {
      assert.ok(sp.id && !ids.has(sp.id), `Duplicate or missing space id: ${sp.id}`);
      ids.add(sp.id);
      assert.ok(sp.Rp_Lps > 0 && sp.Ra_Lps_m2 > 0 && sp.co2Gen_Lps > 0 && sp.defaultOccPer100m2 > 0);

      const people = 25;
      const area_m2 = 150;
      const outdoorCO2 = 420;
      const res = HVAC.calcVentilation62_1(oa, rm, 101325, {
        spaceType: sp.id,
        people,
        area_m2,
        Ez: 0.8,
        outdoorCO2
      });

      const expectedVbz = people * sp.Rp_Lps + area_m2 * sp.Ra_Lps_m2;
      approxEqual(res.Vbz_Lps, expectedVbz, 1e-12, `${sp.id} Vbz exact`);
      approxEqual(res.Voz_Lps, expectedVbz / 0.8, 1e-12, `${sp.id} Voz exact`);
      assert.ok(res.steadyCO2_ppm > outdoorCO2, `${sp.id} CO2 must exceed outdoorCO2`);
      assert.ok(Number.isFinite(res.Qt_kW) && Number.isFinite(res.Qt_TR));
      approxEqual(res.Qs_kW + res.Ql_kW, res.Qt_kW, 1e-9, `${sp.id} vent load conservation`);
    }
  });
});

/* ============================================================================
   3. WEATHER & CLIMATE (Weather)
   ============================================================================ */
describe('3. Weather & Climate (Weather)', () => {
  it('provides >= 44 curated global cities with unique IDs and valid climatic design data', () => {
    assert.ok(Weather.CITIES.length >= 44, `Expected >= 44 cities, got ${Weather.CITIES.length}`);
    const ids = new Set();

    for (const c of Weather.CITIES) {
      assert.ok(typeof c.id === 'string' && c.id.length > 0);
      assert.ok(!ids.has(c.id), `Duplicate city id: ${c.id}`);
      ids.add(c.id);

      assert.ok(c.elev_m >= -500 && c.elev_m <= 9000, `${c.id}: invalid elevation ${c.elev_m}`);
      assert.ok(c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180);
      assert.ok(
        c.summer04.Tdb > c.winter996.Tdb,
        `${c.id}: summer04.Tdb (${c.summer04.Tdb}) must exceed winter996.Tdb (${c.winter996.Tdb})`
      );
      assert.ok(c.summer04.Tdb >= c.summer04.Twb, `${c.id}: summer04 Tdb >= Twb`);
      assert.ok(c.summer1.Tdb >= c.summer1.Twb, `${c.id}: summer1 Tdb >= Twb`);

      // Lookup and design points sanity
      assert.equal(Weather.getCityById(c.id), c);
      const pts = Weather.getCityDesignPoints(c);
      assert.equal(pts.length, 3);
      const pCity = Psy.baroPa(c.elev_m);
      for (const pt of pts) {
        assert.ok(pt.w >= 0 && pt.w <= Psy.wsat_at(pt.T, pCity) * 1.001, `${c.id} ${pt.kind} unsaturated`);
      }
    }
  });

  it('generates deterministic 8,760-hour unsaturated synthetic TMY across diverse & arctic climates', () => {
    const tmy1 = Weather.generateSyntheticTMY('denver');
    const tmy2 = Weather.generateSyntheticTMY('denver');
    assert.equal(tmy1.records.length, 8760, 'TMY must contain exactly 8,760 hourly records');
    assert.deepEqual(tmy1, tmy2, 'Synthetic TMY must be 100% deterministic across repeated calls');

    // Verify saturation bound w <= wsat(T) * 1.001 across all extreme climate types (incl. arctic Fairbanks!)
    for (const cityId of ['dubai', 'denver', 'singapore', 'fairbanks', 'sydney', 'bogota']) {
      const city = Weather.getCityById(cityId);
      const tmy = Weather.generateSyntheticTMY(city);
      const pCity = Psy.baroPa(city.elev_m);
      assert.equal(tmy.records.length, 8760, `${cityId}: expected 8,760 records`);

      for (let i = 0; i < tmy.records.length; i++) {
        const r = tmy.records[i];
        assert.ok(Number.isFinite(r.T) && Number.isFinite(r.w) && r.w >= 0);
        assert.ok(r.month >= 1 && r.month <= 12 && r.hour >= 1 && r.hour <= 24);
        const ws = Psy.wsat_at(r.T, pCity);
        assert.ok(
          r.w <= ws * 1.001,
          `${cityId} hr ${i} (T=${r.T}°C): w=${r.w} exceeds wsat*1.001=${ws * 1.001}`
        );
      }
    }
  });

  it('parses realistic EnergyPlus EPW files and handles missing flags (99.9, 999, 999999)', () => {
    const sampleEPW = [
      'LOCATION,Denver,CO,USA,TMY3,725650,39.86,-104.67,-7.0,1609.0',
      'DESIGN CONDITIONS,1,Climate Design Data 2009 ASHRAE Handbook,,Heating,1,-17.3',
      'TYPICAL/EXTREME PERIODS,6,Summer - Week Nearest Max Temperature For Period',
      'GROUND TEMPERATURES,3,.5,,,,2.5,2.0,4.2,8.5',
      'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0',
      'COMMENTS 1,Synthetic verification EPW',
      'COMMENTS 2,Test missing value handling',
      'DATA PERIODS,1,1,Data,Sunday, 1/ 1,12/31',
      // Row 1: Complete valid record (Tdb=25.0, Tdp=12.0, RH=45, Patm=83500)
      '2021,7,15,14,0,?9,25.0,12.0,45,83500,0,0,0,0',
      // Row 2: Missing Tdb = 99.9 -> must be skipped
      '2021,7,15,15,0,?9,99.9,12.0,45,83500,0,0,0,0',
      // Row 3: Missing RH = 999, valid Tdp = 10.0, missing Patm = 999999 -> fallback to Tdp & elev pPa
      '2021,7,15,16,0,?9,22.0,10.0,999,999999,0,0,0,0',
      // Row 4: Missing both RH = 999 and Tdp = 99.9 -> must be skipped
      '2021,7,15,17,0,?9,24.0,99.9,999,83500,0,0,0,0',
      // Row 5: Missing Patm = 999999, valid Tdb=30.0 & RH=30
      '2021,7,15,18,0,?9,30.0,99.9,30,999999,0,0,0,0'
    ].join('\n');

    const res = Weather.parseEPW(sampleEPW);
    assert.equal(res.ok, true, `EPW parse failed: ${res.error}`);
    assert.equal(res.sourceName, 'Denver, CO, USA');
    approxEqual(res.elev_m, 1609, 0.1);
    assert.equal(res.records.length, 3, 'Should retain 3 valid rows and skip 2 invalid rows');

    // Row 1 check
    assert.equal(res.records[0].T, 25);
    assert.equal(res.records[0].month, 7);
    assert.equal(res.records[0].hour, 14);
    approxEqual(res.records[0].w, Psy.w_from_TRH(25, 0.45, 83500), 1e-5);

    // Row 3 check (RH=999 -> solved via Tdp=10°C at elevation pressure)
    const pElev = Psy.baroPa(1609);
    assert.equal(res.records[1].T, 22);
    approxEqual(res.records[1].w, Psy.w_from_Tdp(10.0, pElev), 1e-5);

    // Row 5 check (Patm=999999 -> solved at elevation pressure)
    assert.equal(res.records[2].T, 30);
    approxEqual(res.records[2].w, Psy.w_from_TRH(30, 0.30, pElev), 1e-5);
  });

  it('auto-detects both °C/RH% and °F/RH% in parseWeatherCSV', () => {
    // 1. Celsius / RH% with headers & ISO timestamps
    const csvSI = [
      'Timestamp,Tdb (°C),RH (%)',
      '2024-07-01 08:00,20.0,50',
      '2024-07-01 14:00,30.0,40',
      '2024-07-01 20:00,25.0,60'
    ].join('\n');
    const resSI = Weather.parseWeatherCSV(csvSI, 101325);
    assert.equal(resSI.ok, true, resSI.error || '');
    assert.equal(resSI.detectedUnits, 'SI');
    assert.equal(resSI.records.length, 3);
    assert.equal(resSI.records[0].T, 20);
    assert.equal(resSI.records[0].month, 7);
    assert.equal(resSI.records[0].hour, 8);
    approxEqual(resSI.records[1].w, Psy.w_from_TRH(30, 0.40, 101325), 1e-5);

    // 2. Fahrenheit / RH% detected via header (including cool temperatures <= 65°F)
    const csvIPHeader = [
      'T (°F),RH (%)',
      '50,50',
      '59,60'
    ].join('\n');
    const resIPHeader = Weather.parseWeatherCSV(csvIPHeader, 101325);
    assert.equal(resIPHeader.ok, true, resIPHeader.error || '');
    assert.equal(resIPHeader.detectedUnits, 'IP');
    approxEqual(resIPHeader.records[0].T, 10.0, 0.02, '50°F -> 10.0°C');
    approxEqual(resIPHeader.records[1].T, 15.0, 0.02, '59°F -> 15.0°C');

    // 3. Fahrenheit / RH% detected via values > 65 even without header
    const csvIPValues = [
      '68,50',
      '86,40',
      '95,30'
    ].join('\n');
    const resIPValues = Weather.parseWeatherCSV(csvIPValues, 101325);
    assert.equal(resIPValues.ok, true, resIPValues.error || '');
    assert.equal(resIPValues.detectedUnits, 'IP');
    approxEqual(resIPValues.records[0].T, 20.0, 0.02, '68°F -> 20.0°C');
    approxEqual(resIPValues.records[1].T, 30.0, 0.02, '86°F -> 30.0°C');
    approxEqual(resIPValues.records[2].T, 35.0, 0.02, '95°F -> 35.0°C');
    approxEqual(resIPValues.records[1].w, Psy.w_from_TRH(30, 0.40, 101325), 1e-5);
  });

  it('computes accurate 2D psychrometric bins and HVAC hours totals', () => {
    const tmy = Weather.generateSyntheticTMY('new_york');
    const bins = Weather.computePsychroBins(tmy.records, tmy.pPa);

    assert.equal(bins.totalHours, 8760);
    assert.ok(bins.comfortHours >= 0 && bins.comfortHours <= bins.totalHours);
    assert.ok(bins.coolHours >= 0 && bins.coolHours <= bins.totalHours);
    assert.ok(bins.heatHours >= 0 && bins.heatHours <= bins.totalHours);
    assert.ok(bins.dehumHours >= 0 && bins.dehumHours <= bins.totalHours);
    assert.ok(bins.economizerHours >= 0 && bins.economizerHours <= bins.totalHours);
    assert.ok(bins.evapHours >= 0 && bins.evapHours <= bins.totalHours);

    const [tMinR, tMaxR] = bins.tRange;
    const [wMinR, wMaxR] = bins.wRange;
    const inRangeCount = tmy.records.filter(
      (r) => r.T >= tMinR && r.T <= tMaxR && r.w >= wMinR && r.w <= wMaxR
    ).length;
    const sumBins = bins.bins2D.reduce((s, b) => s + b.count, 0);
    assert.equal(sumBins, inRangeCount, 'Sum of bins2D counts must match in-range hours exactly');
    assert.equal(sumBins, 8760, 'New York TMY should have all 8,760 hours within bin range');
    assert.equal(
      bins.maxBinCount,
      Math.max(...bins.bins2D.map((b) => b.count)),
      'maxBinCount must match maximum cell count'
    );
  });
});

/* ============================================================================
   4. STATE STORE & LEGACY COMPATIBILITY (Store)
   ============================================================================ */
describe('4. State Store & Legacy Compatibility (Store)', () => {
  it('supports undo/redo across point and process edits and enforces the 100-level stack cap', () => {
    const store = createStore();

    const p1 = store.addPoint({ T: 35, w: 0.018, label: 'OA' });
    const p2 = store.addPoint({ T: 24, w: 0.009, label: 'RA' });
    const proc = store.addProcess(p1.id, p2.id, { flowVal: 1200, flowUnit: 'Lps' });

    store.updatePoint(p1.id, { T: 38 });
    store.updateProcess(proc.id, { flowVal: 1800, showCurve: true });
    store.reverseProcess(proc.id);

    assert.equal(store.getProcess(proc.id).aId, p2.id);
    assert.equal(store.getProcess(proc.id).bId, p1.id);

    // Undo reverseProcess -> updateProcess -> updatePoint
    assert.equal(store.undo(), true);
    assert.equal(store.getProcess(proc.id).aId, p1.id);
    assert.equal(store.undo(), true);
    assert.equal(store.getProcess(proc.id).flowVal, 1200);
    assert.equal(store.undo(), true);
    assert.equal(store.getPoint(p1.id).T, 35);

    // Redo restores all three edits cleanly
    assert.equal(store.redo(), true);
    assert.equal(store.getPoint(p1.id).T, 38);
    assert.equal(store.redo(), true);
    assert.equal(store.getProcess(proc.id).flowVal, 1800);
    assert.equal(store.redo(), true);
    assert.equal(store.getProcess(proc.id).aId, p2.id);
    assert.equal(store.canRedo(), false);

    // New edit after undo clears redo stack
    assert.equal(store.undo(), true);
    assert.equal(store.canRedo(), true);
    store.updatePoint(p2.id, { T: 23 });
    assert.equal(store.canRedo(), false);

    // 100-level stack cap test: push 125 distinct temperature edits
    const storeCap = createStore();
    const pt = storeCap.addPoint({ T: 0, w: 0.005, label: 'Track' }, false);
    for (let step = 1; step <= 125; step++) {
      storeCap.updatePoint(pt.id, { T: step * 0.5 });
    }
    assert.equal(storeCap.getPoint(pt.id).T, 62.5);

    let undoCount = 0;
    while (storeCap.undo()) undoCount++;
    assert.equal(undoCount, 100, 'Undo stack must cap at exactly 100 levels');
    assert.equal(storeCap.canUndo(), false);
    assert.equal(storeCap.getPoint(pt.id).T, 12.5, 'After 100 undos from step 125, T should be step 25 (12.5°C)');

    let redoCount = 0;
    while (storeCap.redo()) redoCount++;
    assert.equal(redoCount, 100, 'Redo stack must restore all 100 undone steps');
    assert.equal(storeCap.getPoint(pt.id).T, 62.5);
  });

  it('automatically recomputes derived 2-stream and 3-stream mix points when parents move or are deleted', () => {
    const store = createStore();

    const pA = store.addPoint({ T: 35, w: 0.018, label: 'OA' });
    const pB = store.addPoint({ T: 24, w: 0.009, label: 'RA' });
    const pC = store.addPoint({ T: 15, w: 0.006, label: 'Bypass' });

    // 2-stream mix (mA = 1.5, mB = 3.5)
    const mix2 = store.addPoint({
      T: 20,
      w: 0.005,
      label: 'Mix2',
      derived: { type: 'mix', aId: pA.id, bId: pB.id, mA: 1.5, mB: 3.5 }
    });

    // 3-stream mix (mA = 1, mB = 2, mC = 3)
    const mix3 = store.addPoint({
      T: 20,
      w: 0.005,
      label: 'Mix3',
      derived: {
        type: 'mix',
        streams: [
          { id: pA.id, m: 1 },
          { id: pB.id, m: 2 },
          { id: pC.id, m: 3 }
        ]
      }
    });

    const expectedMix = (items) => {
      const mTot = items.reduce((s, it) => s + it.m, 0);
      const wMix = items.reduce((s, it) => s + it.m * it.pt.w, 0) / mTot;
      const hMix = items.reduce((s, it) => s + it.m * Psy.h_kJkg(it.pt.T, it.pt.w), 0) / mTot;
      return { T: Psy.Tdb_from_wh(wMix, hMix), w: wMix };
    };

    // Verify initial derived calculation
    let exp2 = expectedMix([{ pt: pA, m: 1.5 }, { pt: pB, m: 3.5 }]);
    let exp3 = expectedMix([{ pt: pA, m: 1 }, { pt: pB, m: 2 }, { pt: pC, m: 3 }]);
    approxEqual(store.getPoint(mix2.id).T, exp2.T, 1e-6, 'Initial 2-stream mix T');
    approxEqual(store.getPoint(mix2.id).w, exp2.w, 1e-9, 'Initial 2-stream mix w');
    approxEqual(store.getPoint(mix3.id).T, exp3.T, 1e-6, 'Initial 3-stream mix T');
    approxEqual(store.getPoint(mix3.id).w, exp3.w, 1e-9, 'Initial 3-stream mix w');

    // Move parent pA -> both mix2 and mix3 must update immediately
    store.updatePoint(pA.id, { T: 42, w: 0.022 });
    exp2 = expectedMix([{ pt: store.getPoint(pA.id), m: 1.5 }, { pt: store.getPoint(pB.id), m: 3.5 }]);
    exp3 = expectedMix([
      { pt: store.getPoint(pA.id), m: 1 },
      { pt: store.getPoint(pB.id), m: 2 },
      { pt: store.getPoint(pC.id), m: 3 }
    ]);
    approxEqual(store.getPoint(mix2.id).T, exp2.T, 1e-6, 'Updated 2-stream mix T after moving pA');
    approxEqual(store.getPoint(mix2.id).w, exp2.w, 1e-9, 'Updated 2-stream mix w after moving pA');
    approxEqual(store.getPoint(mix3.id).T, exp3.T, 1e-6, 'Updated 3-stream mix T after moving pA');
    approxEqual(store.getPoint(mix3.id).w, exp3.w, 1e-9, 'Updated 3-stream mix w after moving pA');

    // Delete parent pC -> mix3 survives with 2 remaining streams (pA, pB); mix2 unaffected
    assert.equal(store.deletePoint(pC.id).ok, true);
    const survivedMix3 = store.getPoint(mix3.id);
    assert.ok(survivedMix3, '3-stream mix should survive with 2 remaining parent streams');
    assert.equal(survivedMix3.derived.streams.length, 2);
    const exp3Reduced = expectedMix([
      { pt: store.getPoint(pA.id), m: 1 },
      { pt: store.getPoint(pB.id), m: 2 }
    ]);
    approxEqual(survivedMix3.T, exp3Reduced.T, 1e-6);
    approxEqual(survivedMix3.w, exp3Reduced.w, 1e-9);

    // Deleting pB leaves mix2 with only 1 parent -> mix2 is removed cleanly
    assert.equal(store.deletePoint(pB.id).ok, true);
    assert.equal(store.getPoint(mix2.id), null, 'Orphaned 2-stream mix must be removed');
    assert.equal(store.getPoint(mix3.id), null, 'Orphaned reduced mix must be removed');
  });

  it('guards locked points against deletion and coordinate edits until unlocked', () => {
    const store = createStore();
    const pt = store.addPoint({ T: 24, w: 0.0095, label: 'LockedRef', locked: true });

    // Deletion refused
    const delRes = store.deletePoint(pt.id);
    assert.equal(delRes.ok, false);
    assert.match(delRes.reason, /locked/i);
    assert.ok(store.getPoint(pt.id), 'Locked point must remain in state.points');

    // Coordinate edit refused
    const editRes = store.updatePoint(pt.id, { T: 30, w: 0.015 });
    assert.equal(editRes, null);
    assert.equal(store.getPoint(pt.id).T, 24);
    assert.equal(store.getPoint(pt.id).w, 0.0095);

    // Unlock allows coordinate edit and deletion
    store.updatePoint(pt.id, { locked: false, T: 26 });
    assert.equal(store.getPoint(pt.id).locked, false);
    assert.equal(store.getPoint(pt.id).T, 26);
    assert.equal(store.deletePoint(pt.id).ok, true);
    assert.equal(store.getPoint(pt.id), null);
  });

  it('imports legacy v2.6.6 JSON (wMaxDisp, index-based processes, dark+ashrae theme mapping)', () => {
    const store = createStore();

    // Legacy v2.6.6 SI payload
    const legacySI = {
      meta: { name: 'Legacy Hospital AHU', version: '2.6.6', company: 'MEP Corp', engineer: 'Dr. Ali' },
      state: {
        units: 'SI',
        theme: 'dark',
        style: 'ashrae',
        pPa: 95000,
        tMin: -10,
        tMax: 50,
        wMaxDisp: 30,
        comfortZone: 'both',
        density: 'fine',
        rhStep: 5
      },
      points: [
        { id: 10, T: 35, w: 0.018, label: 'OA', color: '#f43f5e' },
        { id: 20, T: 24, w: 0.009, label: 'RA', color: '#10b981' },
        { id: 30, T: 20, w: 0.008, label: 'MA', derived: { type: 'mix', aId: 10, bId: 20, mA: 1, mB: 3 } }
      ],
      processes: [[0, 1], [2, 1]]
    };

    const resSI = store.importJSON(legacySI);
    assert.equal(resSI.ok, true);
    assert.equal(resSI.format, 'v2.6.6');
    assert.equal(store.state.theme, 'ashrae-classic', 'Legacy style:"ashrae" must map to ashrae-classic');
    assert.equal(store.state.units, 'SI');
    approxEqual(store.state.view.wMax, 0.030, 1e-9, 'Legacy wMaxDisp:30 g/kg must map to 0.030 kg/kg');
    assert.equal(store.state.view.tMin, -10);
    assert.equal(store.state.view.tMax, 50);
    assert.equal(store.state.pPa, 95000);
    assert.equal(store.state.points.length, 3);
    assert.equal(store.state.processes.length, 2);
    assert.equal(store.state.processes[0].aId, 10);
    assert.equal(store.state.processes[0].bId, 20);
    assert.equal(store.state.processes[1].aId, 30);
    assert.equal(store.state.processes[1].bId, 20);

    // Derived mix point from legacy file is recomputed accurately
    const maPt = store.getPoint(30);
    const wExp = (1 * 0.018 + 3 * 0.009) / 4;
    const hExp = (1 * Psy.h_kJkg(35, 0.018) + 3 * Psy.h_kJkg(24, 0.009)) / 4;
    approxEqual(maPt.w, wExp, 1e-9);
    approxEqual(maPt.T, Psy.Tdb_from_wh(wExp, hExp), 1e-6);

    // Legacy v2.6.6 IP payload (tMin/tMax in °F, wMaxDisp in gr/lb, theme: 'dark')
    const legacyIP = {
      meta: { name: 'Legacy IP Project' },
      state: { units: 'IP', theme: 'dark', style: 'pro', pPa: 101325, tMin: 20, tMax: 120, wMaxDisp: 210 },
      points: [
        { T: 32, w: 0.015, label: 'OA' },
        { T: 13, w: 0.0085, label: 'SA' }
      ],
      processes: [[0, 1]]
    };
    const resIP = store.importJSON(legacyIP);
    assert.equal(resIP.ok, true);
    assert.equal(resIP.format, 'v2.6.6');
    assert.equal(store.state.theme, 'studio-dark');
    assert.equal(store.state.units, 'IP');
    approxEqual(store.state.view.tMin, (20 - 32) / 1.8, 1e-4, 'Legacy IP tMin 20°F -> -6.67°C');
    approxEqual(store.state.view.tMax, (120 - 32) / 1.8, 1e-4, 'Legacy IP tMax 120°F -> 48.89°C');
    approxEqual(store.state.view.wMax, 210 / 7000, 1e-9, 'Legacy IP wMaxDisp 210 gr/lb -> 0.030 kg/kg');
    assert.equal(store.state.processes.length, 1);
  });

  it('roundtrips v3.0 JSON export/import and Share URL (#p=...) faithfully including Unicode', () => {
    const storeA = createStore();
    storeA.setMeta({
      name: 'DOAS-02 — Café 24°C → CO₂',
      version: 'v3.0',
      company: 'ThermoLab GmbH',
      engineer: 'S. Engineer',
      notes: 'Altitude 1609 m · ASHRAE 55'
    });
    storeA.setTheme('custom');
    storeA.updateCustomTheme({ sat: '#00ffaa', pt: '#ff3366' });
    storeA.setUnits('IP');
    storeA.setAtmosphere(null, 1609, null, false);
    storeA.setView({ tMin: -5, tMax: 45, wMax: 0.025 }, false);
    storeA.setGrid({ density: 'fine', rhStep: 5, labelMode: 'right', labelPx: 12, showEnthalpyRuler: false });
    storeA.setComfort({ mode: 'summer', cloSummer: 0.6, met: 1.2, vAir: 0.15, pmvLimit: 0.4 });
    storeA.setWeather({
      cityId: 'denver',
      sourceName: 'Denver Sample',
      records: [{ T: 25, w: 0.008, rh: 35, month: 7, hour: 12 }],
      mode: 'scatter',
      opacity: 0.65
    });

    const p1 = storeA.addPoint({ T: 34, w: 0.011, label: 'OA °C', locked: true, note: 'Outdoor design' });
    const p2 = storeA.addPoint({ T: 23, w: 0.008, label: 'RA', note: 'Return air' });
    const p3 = storeA.addPoint({
      T: 25,
      w: 0.009,
      label: 'MA',
      derived: { type: 'mix', aId: p1.id, bId: p2.id, mA: 1, mB: 3 }
    });
    storeA.addProcess(p3.id, p2.id, {
      flowVal: 2400,
      flowUnit: 'cfm',
      showCurve: true,
      adpT: 10.2,
      adpW: 0.0095,
      label: 'Cooling Coil →'
    });
    storeA.addAnnotation({ T: 30, w: 0.014, text: 'Coil ADP = 10.2°C', color: '#38bdf8' });
    storeA.setSHR({ show: true, value: 0.78, refPointId: p2.id });
    const scen = storeA.saveScenario('Baseline Summer');
    storeA.setCompareScenario(scen.id);

    // 1. Full v3.0 JSON export -> stringify -> import roundtrip
    const exported = storeA.exportJSON();
    assert.equal(exported.schema, 'psychro-ultra-3.0');
    const jsonStr = JSON.stringify(exported);

    const storeB = createStore();
    const impV3 = storeB.importJSON(jsonStr);
    assert.equal(impV3.ok, true);
    assert.equal(impV3.format, 'v3.0');
    assert.deepEqual(storeB.state.meta, storeA.state.meta);
    assert.equal(storeB.state.theme, 'custom');
    assert.equal(storeB.state.customTheme.sat, '#00ffaa');
    assert.equal(storeB.state.units, 'IP');
    approxEqual(storeB.state.pPa, storeA.state.pPa, 1e-6);
    approxEqual(storeB.state.altM, 1609, 1e-6);
    assert.deepEqual(
      { tMin: storeB.state.view.tMin, tMax: storeB.state.view.tMax, wMax: storeB.state.view.wMax },
      { tMin: -5, tMax: 45, wMax: 0.025 }
    );
    assert.deepEqual(storeB.state.grid, storeA.state.grid);
    assert.deepEqual(storeB.state.comfort, storeA.state.comfort);
    assert.equal(storeB.state.shr.show, true);
    assert.equal(storeB.state.shr.value, 0.78);
    assert.equal(storeB.state.shr.refPointId, p2.id);
    assert.equal(storeB.state.points.length, 3);
    assert.equal(storeB.getPoint(p1.id).locked, true);
    assert.equal(storeB.state.processes.length, 1);
    assert.equal(storeB.state.processes[0].showCurve, true);
    assert.equal(storeB.state.processes[0].adpT, 10.2);
    assert.equal(storeB.state.annotations.length, 1);
    assert.equal(storeB.state.scenarios.length, 1);
    assert.equal(storeB.state.compareScenarioId, scen.id);
    assert.equal(storeB.state.weather.cityId, 'denver');
    assert.equal(storeB.state.weather.records.length, 1);

    // New point added after v3 import must not collide with existing IDs
    const extraPt = storeB.addPoint({ T: 20, w: 0.007, label: 'New' });
    assert.ok(extraPt.id > Math.max(p1.id, p2.id, p3.id));

    // 2. Share URL (#p=...) encode -> decode roundtrip (both bare hash and full URL)
    const shareHash = storeA.encodeShareURL();
    assert.match(shareHash, /^#p=[A-Za-z0-9\-_]+$/, 'Share URL hash must be valid Base64URL #p=...');

    const storeC = createStore();
    const decRes = storeC.decodeShareURL(`https://psychro.ultra/app.html${shareHash}`);
    assert.equal(decRes.ok, true, decRes.error || '');
    assert.deepEqual(storeC.state.meta, storeA.state.meta, 'Unicode metadata must roundtrip via Share URL');
    assert.equal(storeC.state.theme, 'custom');
    assert.equal(storeC.state.customTheme.pt, '#ff3366');
    assert.equal(storeC.state.units, 'IP');
    approxEqual(storeC.state.pPa, storeA.state.pPa, 0.2);
    approxEqual(storeC.state.altM, 1609, 0.2);
    assert.equal(storeC.state.points.length, 3);
    assert.equal(storeC.getPoint(p1.id).locked, true);
    assert.equal(storeC.getPoint(p1.id).label, 'OA °C');
    approxEqual(storeC.getPoint(p3.id).T, storeA.getPoint(p3.id).T, 1e-3, 'Derived mix survives Share URL');
    approxEqual(storeC.getPoint(p3.id).w, storeA.getPoint(p3.id).w, 1e-6);
    assert.equal(storeC.state.processes.length, 1);
    assert.equal(storeC.state.processes[0].label, 'Cooling Coil →');
    assert.equal(storeC.state.processes[0].showCurve, true);
    assert.equal(storeC.state.processes[0].adpT, 10.2);
    assert.equal(storeC.state.annotations.length, 1);
    assert.equal(storeC.state.annotations[0].text, 'Coil ADP = 10.2°C');
    assert.equal(storeC.state.shr.show, true);
    assert.equal(storeC.state.shr.refPointId, p2.id);
    assert.equal(storeC.state.weather.cityId, 'denver');
  });

  it('solves exact ASHRAE SHR saturation/ADP intersections and detects no-hit reheat regimes', () => {
    const pPa = 101325;
    const ra = { T: 24, w: Psy.w_from_TRH(24, 0.50, pPa) }; // 24°C, 50% RH (Tdp ≈ 12.9°C)

    // 1. Typical Room SHR = 0.75 from RA -> exact saturation intersection (ADP ≈ 9.25°C)
    const r75 = HVAC.solveSHRSaturation(ra, 0.75, pPa);
    assert.equal(r75.satStatus, 'hit');
    assert.ok(r75.satHit && r75.satHit.T > 7 && r75.satHit.T < 11.5, `Expected ADP ~9.3°C, got ${r75.satHit?.T}`);
    const wLineAtHit = ra.w + r75.slope * (r75.satHit.T - ra.T);
    approxEqual(wLineAtHit, Psy.wsat_at(r75.satHit.T, pPa), 1e-5, 'Line must meet 100% RH curve exactly');

    // 2. Pure sensible SHR = 1.0 -> exact dew point of RA
    const r100 = HVAC.solveSHRSaturation(ra, 1.0, pPa);
    assert.equal(r100.satStatus, 'hit');
    const tDp = Psy.dewpoint_from_pv(Psy.pv_from_w(ra.w, pPa));
    approxEqual(r100.satHit.T, tDp, 0.05, 'SHR=1.0 must intersect saturation at exact Dew Point');
    assert.equal(r100.dhdw_kJkg, Infinity);

    // 3. Steep latent SHR = 0.45 from RA -> misses saturation curve before w=0 (reheat required)
    const r45 = HVAC.solveSHRSaturation(ra, 0.45, pPa);
    assert.equal(r45.satStatus, 'no-hit');
    assert.equal(r45.satHit, null);

    // 4. Negative evaporative/desiccant SHR = -0.5 from hot dry OA -> unique saturation intersection
    const oa = { T: 38, w: 0.008 };
    const rNeg = HVAC.solveSHRSaturation(oa, -0.5, pPa);
    assert.equal(rNeg.satStatus, 'hit');
    assert.ok(rNeg.satHit && rNeg.satHit.T < oa.T && rNeg.satHit.w > oa.w);

    // 5. Store anchorTw roundtrip via JSON and Share URL
    const st = createStore();
    st.setSHR({ show: true, value: 0.82, anchorTw: { T: 26.5, w: 0.0112 } });
    assert.equal(st.state.shr.refPointId, null);
    approxEqual(st.state.shr.anchorTw.T, 26.5, 1e-6);
    const hash = st.encodeShareURL();
    const st2 = createStore();
    const dec = st2.decodeShareURL(hash);
    assert.equal(dec.ok, true);
    assert.equal(st2.state.shr.show, true);
    approxEqual(st2.state.shr.value, 0.82, 1e-4);
    approxEqual(st2.state.shr.anchorTw.T, 26.5, 1e-3);
    approxEqual(st2.state.shr.anchorTw.w, 0.0112, 1e-5);
  });

  it('deduplicates ASHRAE city design points, supports show/hide toggling, and scales point markers dynamically with zoom', () => {
    const st = createStore();
    const dubaiSpecs = [
      { T: 44.1, w: 0.0115, label: 'Dubai Sum 0.4%', color: '#f43f5e', note: 'ASHRAE Cooling 0.4% DB/MCWB — Dubai, UAE', designTag: 'dubai:summer04', cityId: 'dubai' },
      { T: 42.6, w: 0.0119, label: 'Dubai Sum 1%', color: '#f59e0b', note: 'ASHRAE Cooling 1% DB/MCWB — Dubai, UAE', designTag: 'dubai:summer1', cityId: 'dubai' },
      { T: 13.0, w: 0.0062, label: 'Dubai Win 99.6%', color: '#38bdf8', note: 'ASHRAE Heating 99.6% DB — Dubai, UAE', designTag: 'dubai:winter996', cityId: 'dubai' }
    ];

    // Simulate legacy pre-existing duplicate stacked copies before upsert
    st.addPoint({ T: 44.1, w: 0.0115, label: 'Dubai Sum 0.4%', note: 'ASHRAE Cooling 0.4% DB/MCWB — Dubai, UAE' }, false);
    st.addPoint({ T: 44.1, w: 0.0115, label: 'Dubai Sum 0.4%', note: 'ASHRAE Cooling 0.4% DB/MCWB — Dubai, UAE' }, false);
    st.addPoint({ T: 44.1, w: 0.0115, label: 'Dubai Sum 0.4%', note: 'ASHRAE Cooling 0.4% DB/MCWB — Dubai, UAE' }, false);

    // Clicking Plot Design Pts multiple times must merge legacy duplicates and never create new ones
    const r1 = st.upsertDesignPoints(dubaiSpecs, { cityId: 'dubai', cityName: 'Dubai', recordHistory: false });
    assert.ok(r1.removedDuplicates >= 2, `Expected >= 2 legacy duplicates removed, got ${r1.removedDuplicates}`);
    const r2 = st.upsertDesignPoints(dubaiSpecs, { cityId: 'dubai', cityName: 'Dubai', recordHistory: false });
    const r3 = st.upsertDesignPoints(dubaiSpecs, { cityId: 'dubai', cityName: 'Dubai', recordHistory: false });
    assert.equal(r2.added, 0);
    assert.equal(r3.added, 0);
    assert.equal(st.state.points.length, 3, 'Strictly 3 unique Dubai design points after 3x upsert');

    // Group show/hide via layers.designPts
    assert.equal(st.state.points.every(p => CoreDOM.isPointVisible(p, st.state)), true);
    st.setLayer('designPts', false);
    assert.equal(st.state.points.some(p => CoreDOM.isPointVisible(p, st.state)), false, 'All design pts hidden when layers.designPts=false');
    st.setLayer('designPts', true);
    assert.equal(st.state.points.every(p => CoreDOM.isPointVisible(p, st.state)), true);

    // Individual point hide/show
    st.updatePoint(st.state.points[1].id, { hidden: true }, false);
    assert.equal(CoreDOM.isPointVisible(st.state.points[0], st.state), true);
    assert.equal(CoreDOM.isPointVisible(st.state.points[1], st.state), false);

    // Clear design points cleanly
    const clr = st.clearDesignPoints(null, false);
    assert.equal(clr.removed, 3);
    assert.equal(st.state.points.length, 0);

    // Zoom-dynamic marker scale monotonically shrinks when zoomed out and caps cleanly when zoomed in
    const sDef = CoreDOM.computePointScale({ tMin: -10, tMax: 55, wMax: 0.030 }, false);
    const sWide = CoreDOM.computePointScale({ tMin: -16.6, tMax: 82.6, wMax: 0.0265 }, false);
    const sMaxOut = CoreDOM.computePointScale({ tMin: -45, tMax: 85, wMax: 0.055 }, false);
    const sZoomIn = CoreDOM.computePointScale({ tMin: 12, tMax: 32, wMax: 0.015 }, false);
    const sDesignWide = CoreDOM.computePointScale({ tMin: -16.6, tMax: 82.6, wMax: 0.0265 }, true);
    approxEqual(sDef, 1.0, 1e-6);
    assert.ok(sMaxOut < sWide && sWide < sDef && sDef < sZoomIn, `Expected monotonic zoom scale: ${sMaxOut} < ${sWide} < ${sDef} < ${sZoomIn}`);
    assert.ok(sWide < 0.80, `Wide zoomed-out scale (${sWide}) must noticeably shrink dot size`);
    assert.ok(sDesignWide < sWide, 'Design city markers must stay subtler than primary process markers');
    assert.ok(sZoomIn <= 1.25 && sMaxOut >= 0.44);
  });

  it('keeps curved cooling coil trajectory strictly inside 100% RH saturation even when ADP misses saturation', () => {
    const pPa = 101325;
    const cases = [
      // Exact extreme no-ADP coil case: MA (41°C, 22.5 g/kg) -> CC Out (8.2°C, 5.8 g/kg)
      { name: 'Hot-humid no-ADP coil', a: { T: 41.0, w: 0.0225 }, b: { T: 8.2, w: 0.0058 } },
      // Extreme near-saturated coil where straight chord crosses into fog zone
      { name: 'Near-saturated coil', a: { T: 35.0, w: Psy.wsat_at(35, pPa) * 0.96 }, b: { T: 6.0, w: Psy.wsat_at(6, pPa) * 0.98 } },
      // High altitude Denver coil
      { name: 'High-altitude coil', a: { T: 34.0, w: 0.018 }, b: { T: 7.0, w: 0.0055 }, p: Psy.baroPa(1609) }
    ];

    for (const tc of cases) {
      const p = tc.p || pPa;
      const curve = HVAC.buildCoilCurvePts(tc.a, tc.b, p, 32);
      assert.equal(curve.length, 32, `${tc.name}: expected 32 curve samples`);
      approxEqual(curve[0].T, tc.a.T, 1e-12);
      approxEqual(curve[0].w, tc.a.w, 1e-12);
      approxEqual(curve[31].T, tc.b.T, 1e-12);
      approxEqual(curve[31].w, tc.b.w, 1e-12);
      for (let i = 0; i < curve.length; i++) {
        const ws = Psy.wsat_at(curve[i].T, p);
        assert.ok(curve[i].w <= ws + 1e-9, `${tc.name} pt[${i}] supersaturated: w=${curve[i].w} > wsat=${ws} at T=${curve[i].T}`);
        if (i > 0) {
          assert.ok(curve[i].T <= curve[i - 1].T + 1e-9, `${tc.name} T must be monotonically non-increasing`);
          assert.ok(curve[i].w <= curve[i - 1].w + 1e-9, `${tc.name} w must be monotonically non-increasing`);
          // Also verify chord midpoint between consecutive samples stays inside saturation!
          const mT = 0.5 * (curve[i - 1].T + curve[i].T);
          const mW = 0.5 * (curve[i - 1].w + curve[i].w);
          const mWs = Psy.wsat_at(mT, p);
          assert.ok(mW <= mWs + 1e-6, `${tc.name} seg[${i}] midpoint crossed saturation: w=${mW} > wsat=${mWs} at T=${mT}`);
        }
      }
    }
  });
});
