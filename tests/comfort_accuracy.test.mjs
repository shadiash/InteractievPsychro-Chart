#!/usr/bin/env node
/* ============================================================================
   PsychroChart Ultra 3.0 — Comprehensive Thermal Comfort Accuracy Test Suite
   Verifies ISO 7730:2005 Annex D, ANSI/ASHRAE Standard 55-2020/2023 (v_r,
   I_cl,r, Gagge 2-Node SET & Cooling Effect), ASHRAE TC 9.9 (2021 5th Ed.
   A1–A4 + >900 m Altitude Derating), Givoni (1992) Pressure-Invariant
   Bioclimatic Chart, Weather Dynamic Comfort-Hour Partitioning, and
   Canvas/SVG/HTML/CSV/Store Cross-Subsystem Consistency.
   ============================================================================ */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Psy } from '../src/engine/psychro.js';
import { Comfort } from '../src/engine/comfort.js';
import { Weather } from '../src/engine/weather.js';
import { createStore } from '../src/state/store.js';
import { Exporter } from '../src/export/exporter.js';

function approxEqual(actual, expected, tol, msg = '') {
  const err = Math.abs(actual - expected);
  assert.ok(
    Number.isFinite(actual) && err <= tol,
    `${msg ? msg + ': ' : ''}expected ${expected} ± ${tol}, got ${actual} (err=${err})`
  );
}

/* ============================================================================
   1. ISO 7730:2005 Annex D Table D.1 (All 13 Normative Reference Cases)
   ============================================================================ */
describe('1. ISO 7730:2005 Annex D Table D.1 Reference Cases', () => {
  const ISO_CASES = [
    // [Ta, Tr, v_ar, RH%, met, clo, expPMV, expPPD] — exact ISO 7730:2005 Annex D BASIC outputs
    [22.0, 22.0, 0.10, 60, 1.2, 0.5, -0.7537, 16.97],
    [27.0, 27.0, 0.10, 60, 1.2, 0.5,  0.7652, 17.34],
    [27.0, 27.0, 0.30, 60, 1.2, 0.5,  0.4346,  8.94],
    [23.5, 25.5, 0.15, 60, 1.2, 0.5, -0.1973,  5.81],
    [23.5, 25.5, 0.30, 60, 1.2, 0.5, -0.5543, 11.43],
    [19.0, 19.0, 0.10, 40, 1.2, 1.0, -0.6013, 12.58],
    [23.0, 23.0, 0.10, 40, 1.2, 1.0,  0.2516,  6.31],
    [23.0, 23.0, 0.30, 40, 1.2, 1.0, -0.0023,  5.00],
    [23.0, 18.0, 0.10, 40, 1.2, 1.0, -0.2414,  6.21],
    [23.0, 28.0, 0.10, 40, 1.2, 1.0,  0.7713, 17.53],
    [16.0, 16.0, 0.20, 50, 2.0, 1.0,  0.0175,  5.01],
    [20.0, 20.0, 0.20, 50, 2.0, 1.0,  0.5995, 12.54],
    [22.0, 22.0, 0.10, 50, 1.0, 1.0, -0.3491,  7.54]
  ];

  it('matches all 13 ISO 7730:2005 Annex D Table D.1 cases within ±0.005 PMV & ±0.2% PPD', () => {
    for (const [ta, tr, v, rh, met, clo, expPMV, expPPD] of ISO_CASES) {
      const r = Comfort.calcPMV(ta, rh, { mrt: tr, vAir: v, met, clo, standard: 'iso7730' });
      approxEqual(r.pmv, expPMV, 0.005, `ISO7730 PMV (${ta}/${tr}/v=${v}/m=${met}/c=${clo})`);
      approxEqual(r.ppd, expPPD, 0.2, `ISO7730 PPD (${ta}/${tr}/v=${v}/m=${met}/c=${clo})`);
    }
  });

  it('reports sensation "Neutral" (not "Neutral (Comfort)") when |PMV| <= 0.5 exceeds tighter pmvLimit', () => {
    const r = Comfort.calcPMV(26.8, 50, { met: 1.1, clo: 0.5, vAir: 0.1, pmvLimit: 0.2, standard: 'ashrae55' });
    assert.ok(Math.abs(r.pmv) > 0.2 && Math.abs(r.pmv) <= 0.5, `Expected |PMV| in (0.2, 0.5], got ${r.pmv}`);
    assert.equal(r.compliant, false);
    assert.equal(r.sensation, 'Neutral');
  });
});

/* ============================================================================
   2. ANSI/ASHRAE Standard 55-2020/2023 (v_r, I_cl,r, Gagge 2-Node SET & CE)
   ============================================================================ */
describe('2. ANSI/ASHRAE Standard 55-2020/2023 Normative Appendix D', () => {
  it('computes exact relative air speed v_r and dynamic clothing insulation I_cl,r', () => {
    approxEqual(Comfort.calcRelativeAirSpeed(0.1, 1.0), 0.1, 1e-9);
    approxEqual(Comfort.calcRelativeAirSpeed(0.1, 1.1), 0.13, 1e-9);
    approxEqual(Comfort.calcRelativeAirSpeed(0.2, 1.6), 0.38, 1e-9);

    approxEqual(Comfort.calcDynamicClo(0.5, 1.1), 0.5, 1e-9);
    approxEqual(Comfort.calcDynamicClo(1.0, 1.2), 1.0, 1e-9);
    approxEqual(Comfort.calcDynamicClo(1.0, 2.0), 0.8, 1e-9);
  });

  it('matches official ASHRAE 55-2020 Table D-1 Gagge 2-Node SET reference points within ±0.15°C', () => {
    const setStill = Comfort.calcSET(25, 50, { mrt: 25, vAir: 0.1, met: 1.0, clo: 0.5, pPa: 101325 });
    const setElev = Comfort.calcSET(25, 50, { mrt: 25, vAir: 0.6, met: 1.0, clo: 0.5, pPa: 101325 });
    approxEqual(setStill, 24.0, 0.15, 'ASHRAE 55 Table D-1 SET @ 25°C, 0.1 m/s');
    approxEqual(setElev, 21.4, 0.15, 'ASHRAE 55 Table D-1 SET @ 25°C, 0.6 m/s');
    assert.ok(setStill - setElev > 2.2 && setStill - setElev < 3.2, `Expected ~2.6°C SET drop, got ${setStill - setElev}`);
  });

  it('applies SET Cooling Effect (CE) in ASHRAE 55 mode at elevated air speed (vAir > 0.1 m/s)', () => {
    const ceRes = Comfort.calcCoolingEffect(27, 50, { mrt: 27, vAir: 0.6, met: 1.1, clo: 0.5, pPa: 101325 });
    assert.ok(ceRes.ce > 1.8 && ceRes.ce < 3.2, `Expected CE ~2.4°C at 0.6 m/s, got ${ceRes.ce}`);

    const rAsh = Comfort.calcPMV(27, 50, { vAir: 0.6, met: 1.1, clo: 0.5, standard: 'ashrae55' });
    const rStill = Comfort.calcPMV(27, 50, { vAir: 0.1, met: 1.1, clo: 0.5, standard: 'ashrae55' });
    assert.equal(rAsh.elevatedAirSpeed, true);
    assert.ok(rAsh.ce > 1.8, 'ASHRAE 55 must record positive Cooling Effect');
    assert.ok(rAsh.pmv < rStill.pmv - 0.5, `Elevated air speed must lower PMV substantially (${rAsh.pmv} vs ${rStill.pmv})`);
    assert.equal(rAsh.compliant, true, '27°C @ 50% RH with 0.6 m/s fan air movement should be comfortable per ASHRAE 55');

    // Polygon must shift noticeably warmer when vAir increases from 0.1 to 0.6 m/s in ASHRAE 55 mode
    const polyStill = Comfort.generateASHRAE55Polygon(101325, { clo: 0.5, met: 1.1, vAir: 0.1, standard: 'ashrae55' });
    const polyFan = Comfort.generateASHRAE55Polygon(101325, { clo: 0.5, met: 1.1, vAir: 0.6, standard: 'ashrae55' });
    const maxTStill = Math.max(...polyStill.map(p => p[0]));
    const maxTFan = Math.max(...polyFan.map(p => p[0]));
    assert.ok(maxTFan > maxTStill + 1.5, `Fan polygon maxT (${maxTFan.toFixed(2)}) should extend >1.5°C warmer than still (${maxTStill.toFixed(2)})`);
  });
});

/* ============================================================================
   3. Polygon vs evaluatePointZones Parity Across Altitudes & Extreme Inputs
   ============================================================================ */
describe('3. ASHRAE 55 / ISO 7730 Polygon vs Point Evaluator Parity', () => {
  const cases = [
    { name: 'Sea Level Default', pPa: 101325, opts: { cloSummer: 0.5, cloWinter: 1.0, met: 1.1, vAir: 0.1, pmvLimit: 0.5, standard: 'ashrae55', capHumidity: true } },
    { name: 'Denver 1609m Default', pPa: Psy.baroPa(1609), opts: { cloSummer: 0.5, cloWinter: 1.0, met: 1.1, vAir: 0.1, pmvLimit: 0.5, standard: 'ashrae55', capHumidity: true } },
    { name: 'La Paz 3640m Default', pPa: Psy.baroPa(3640), opts: { cloSummer: 0.5, cloWinter: 1.0, met: 1.1, vAir: 0.1, pmvLimit: 0.5, standard: 'ashrae55', capHumidity: true } },
    { name: 'Uncapped Analytical (capHumidity: false)', pPa: 101325, opts: { cloSummer: 0.5, cloWinter: 1.0, met: 1.1, vAir: 0.1, pmvLimit: 0.5, standard: 'ashrae55', capHumidity: false } },
    { name: 'Elevated Air Speed 0.6 m/s', pPa: 101325, opts: { cloSummer: 0.5, cloWinter: 1.0, met: 1.1, vAir: 0.6, pmvLimit: 0.5, standard: 'ashrae55', capHumidity: true } },
    { name: 'Extreme Heavy Clothing & High Met (clo=2.5, met=3.5)', pPa: 101325, opts: { cloSummer: 2.5, cloWinter: 2.5, met: 3.5, vAir: 0.1, pmvLimit: 0.5, standard: 'ashrae55', capHumidity: true } },
    { name: 'Extreme Light Clothing & Low Met (clo=0.1, met=0.7)', pPa: 101325, opts: { cloSummer: 0.1, cloWinter: 0.1, met: 0.7, vAir: 0.1, pmvLimit: 0.5, standard: 'ashrae55', capHumidity: true } }
  ];

  it('maintains >99.5% agreement between generated polygons and evaluatePointZones (incl. extreme clo/met)', () => {
    for (const tc of cases) {
      const sw = Comfort.getSummerWinterZones(tc.pPa, tc.opts);
      const poly = sw.summer.poly;
      assert.ok(poly.length >= 10, `${tc.name}: polygon has too few vertices (${poly.length})`);

      const minT = Math.min(...poly.map(p => p[0]));
      const maxT = Math.max(...poly.map(p => p[0]));
      const maxW = Math.max(...poly.map(p => p[1]));

      // Ensure extreme clo=2.5, met=3.5 is NOT clamped at +5°C anymore!
      if (tc.opts.cloSummer === 2.5 && tc.opts.met === 3.5) {
        assert.ok(minT < 0, `Extreme clo=2.5/met=3.5 polygon must extend below 0°C (got minT=${minT.toFixed(2)}°C)`);
      }
      // Ensure uncapped mode extends above 12 g/kg
      if (tc.opts.capHumidity === false) {
        assert.ok(maxW > 0.018, `Uncapped polygon must extend well above 12 g/kg (got maxW=${(maxW * 1000).toFixed(1)} g/kg)`);
      }

      // Sample interior & exterior grid (skipping points within 0.06°C / 0.1 g/kg of boundary)
      let tested = 0;
      let mismatches = 0;
      const tStart = minT - 4;
      const tEnd = maxT + 4;
      const wEnd = Math.min(0.032, maxW + 0.004);
      for (let i = 0; i <= 32; i++) {
        const T = tStart + ((tEnd - tStart) * i) / 32;
        const ws = Psy.wsat_at(T, tc.pPa);
        for (let j = 1; j <= 20; j++) {
          const w = (wEnd * j) / 20;
          if (w > ws * 0.995) continue;
          const ev = Comfort.evaluatePointZones(T, w, tc.pPa, tc.opts);
          // Skip ultra-thin numerical boundary strip |pmv - pmvLimit| < 0.025 or |w - wMax| < 0.00015
          if (Math.abs(Math.abs(ev.summer.pmv) - tc.opts.pmvLimit) < 0.025) continue;
          if (Math.abs(w - ev.wMax) < 0.00015) continue;

          tested++;
          const inPoly = Comfort.pointInPolygon(T, w, poly);
          if (inPoly !== ev.inSummerComfort) mismatches++;
        }
      }
      const acc = tested > 0 ? ((tested - mismatches) / tested) * 100 : 100;
      assert.ok(acc >= 99.5, `${tc.name}: expected >=99.5% polygon/evaluator parity, got ${acc.toFixed(2)}% (${mismatches}/${tested} mismatches)`);
    }
  });
});

/* ============================================================================
   4. ASHRAE TC 9.9 (2021 5th Ed.) A1–A4 Envelopes & >900 m Altitude Derating
   ============================================================================ */
describe('4. ASHRAE TC 9.9 (2021 5th Ed.) Class A1–A4 & Altitude Derating', () => {
  it('applies exact >900 m altitude Tmax derating (A1/A2: 300 m/°C, A3: 175 m/°C, A4: 125 m/°C)', () => {
    const pSL = 101325;
    const pDen = Psy.baroPa(1609); // excess = 709 m
    const pHigh = Psy.baroPa(3500); // capped at 3050 m => excess = 2150 m

    const zSL = Object.fromEntries(Comfort.getDataCenterZones(pSL).map(z => [z.id, z]));
    const zDen = Object.fromEntries(Comfort.getDataCenterZones(pDen).map(z => [z.id, z]));
    const zHigh = Object.fromEntries(Comfort.getDataCenterZones(pHigh).map(z => [z.id, z]));

    assert.equal(Object.keys(zSL).length, 5);
    approxEqual(zSL.tc99_rec.tMax, 27, 0.01);
    approxEqual(zSL.tc99_a1.tMax, 32, 0.01);
    approxEqual(zSL.tc99_a2.tMax, 35, 0.01);
    approxEqual(zSL.tc99_a3.tMax, 40, 0.01);
    approxEqual(zSL.tc99_a4.tMax, 45, 0.01);

    // Denver (1609 m => excess 709 m)
    approxEqual(zDen.tc99_rec.tMax, 27, 0.01, 'Recommended is not derated');
    approxEqual(zDen.tc99_a1.tMax, 32 - 709 / 300, 0.05, 'Denver A1 derating');
    approxEqual(zDen.tc99_a2.tMax, 35 - 709 / 300, 0.05, 'Denver A2 derating');
    approxEqual(zDen.tc99_a3.tMax, 40 - 709 / 175, 0.05, 'Denver A3 derating');
    approxEqual(zDen.tc99_a4.tMax, 45 - 709 / 125, 0.05, 'Denver A4 derating');

    // 3500 m capped at 3050 m (excess 2150 m)
    approxEqual(zHigh.tc99_a4.tMax, 45 - 2150 / 125, 0.05, '3050 m cap on A4 derating');

    // Point at 31°C, 30% RH is Class A1 at Sea Level, but demotes to Class A2 in Denver (A1 max = 29.64°C)!
    const evSL = Comfort.evaluatePointZones(31, Psy.w_from_TRH(31, 0.30, pSL), pSL);
    const evDen = Comfort.evaluatePointZones(31, Psy.w_from_TRH(31, 0.30, pDen), pDen);
    assert.equal(evSL.dataCenterClass, 'Class A1');
    assert.equal(evDen.dataCenterClass, 'Class A2');
  });
});

/* ============================================================================
   5. Givoni (1992) Bioclimatic Chart — Altitude Invariance & Evaluator Parity
   ============================================================================ */
describe('5. Givoni (1992) Pressure-Invariant Bioclimatic Zones', () => {
  it('maintains pressure-invariant vapor partial pressure limits across Sea Level & Denver', () => {
    const pSL = 101325;
    const pDen = Psy.baroPa(1609);
    const gSL = Object.fromEntries(Comfort.getGivoniZones(pSL).map(z => [z.id, z]));
    const gDen = Object.fromEntries(Comfort.getGivoniZones(pDen).map(z => [z.id, z]));

    // Passive solar top cap corresponds to constant Pv (12 g/kg SL => ~14.7 g/kg at Denver)
    const maxWSL = Math.max(...gSL.passive_solar.poly.map(p => p[1]));
    const maxWDen = Math.max(...gDen.passive_solar.poly.map(p => p[1]));
    const pvSL = Psy.pv_from_w(maxWSL, pSL);
    const pvDen = Psy.pv_from_w(maxWDen, pDen);
    approxEqual(pvDen, pvSL, 15, 'Givoni passive_solar top cap should be constant vapor partial pressure');
    assert.ok(maxWDen > maxWSL * 1.18, `Denver humidity ratio cap (${maxWDen.toFixed(4)}) should scale up with 1/P vs SL (${maxWSL.toFixed(4)})`);

    // Indirect evap must cover hot arid conditions (e.g. 38°C, W = 0.002 kg/kg, Twb < 11°C)
    const aridHits = Comfort.evaluateGivoniZones(38, 0.002, pSL).map(z => z.id);
    assert.ok(aridHits.includes('indirect_evap'), `38°C / 2 g/kg arid air must include indirect_evap, got [${aridHits}]`);

    // Active dehumidification must extend above 20 g/kg (e.g. 27°C, W = 0.022 kg/kg)
    const humidHits = Comfort.evaluateGivoniZones(27, 0.022, pSL).map(z => z.id);
    assert.ok(humidHits.includes('active_dehum'), `27°C / 22 g/kg humid air must include active_dehum, got [${humidHits}]`);

    // 100% interior parity between evaluateGivoniZones and pointInPolygon on getGivoniZones
    const testPts = [
      [15, 0.005], [24, 0.015], [28, 0.010], [34, 0.006], [40, 0.003], [26, 0.018]
    ];
    for (const [T, w] of testPts) {
      const evalIds = new Set(Comfort.evaluateGivoniZones(T, w, pDen).map(z => z.id));
      for (const z of Object.values(gDen)) {
        assert.equal(
          Comfort.pointInPolygon(T, w, z.poly),
          evalIds.has(z.id),
          `Denver Givoni parity mismatch at (${T}°C, ${w}) for ${z.id}`
        );
      }
    }
  });
});

/* ============================================================================
   6. Weather Dynamic Comfort-Hour Partitioning & Store Auto Re-Binning
   ============================================================================ */
describe('6. Weather Dynamic Comfort-Hour Partitioning & Auto Re-Binning', () => {
  it('partitions 8,760 hours with ZERO comfort/cooling overlap and ZERO heating/comfort dead zone', () => {
    const tmy = Weather.generateSyntheticTMY('new_york');
    const cfg = { mode: 'both', cloSummer: 0.5, cloWinter: 1.0, met: 1.1, vAir: 0.1, mrtOffset: 0, pmvLimit: 0.5, standard: 'ashrae55', capHumidity: true };
    const bins = Weather.computePsychroBins(tmy.records, tmy.pPa, cfg);

    // Since Summer (0.5 clo) and Winter (1.0 clo) overlap, Winter ∪ Summer is connected:
    // EVERY single hour is partitioned into exactly ONE of comfortHours, heatHours, or coolHours!
    assert.equal(
      bins.comfortHours + bins.heatHours + bins.coolHours,
      bins.totalHours,
      `Expected exact 8760 partition (comf=${bins.comfortHours} + heat=${bins.heatHours} + cool=${bins.coolHours} = ${bins.comfortHours + bins.heatHours + bins.coolHours})`
    );

    // Increasing fan air speed (vAir: 0.1 -> 0.8 m/s) or uncapping humidity MUST change comfort hours
    const binsFan = Weather.computePsychroBins(tmy.records, tmy.pPa, { ...cfg, vAir: 0.8 });
    const binsUncapped = Weather.computePsychroBins(tmy.records, tmy.pPa, { ...cfg, capHumidity: false });
    assert.notEqual(binsFan.comfortHours, bins.comfortHours, 'Elevated air speed must change weather comfort hours');
    assert.ok(binsUncapped.comfortHours >= bins.comfortHours, 'Uncapping humidity should maintain or increase comfort hours');

    // Store auto re-binning on setComfort & setAtmosphere
    const store = createStore();
    store.setAtmosphere(tmy.pPa, undefined, null, false);
    store.setWeather({ cityId: 'new_york', sourceName: 'New York TMY', records: tmy.records });
    const hDefault = store.state.weather.bins.comfortHours;
    assert.equal(hDefault, bins.comfortHours);

    store.setComfort({ mode: 'summer' });
    const hSummer = store.state.weather.bins.comfortHours;
    assert.ok(hSummer < hDefault, `Summer-only mode (${hSummer}h) should have fewer comfort hours than Summer+Winter (${hDefault}h)`);
  });
});

/* ============================================================================
   7. Cross-Subsystem Consistency (evaluateActiveComfort, SVG, HTML, CSV)
   ============================================================================ */
describe('7. Cross-Subsystem Consistency (Active Comfort, SVG Parity, HTML/CSV Reports)', () => {
  it('resolves Winter PPD, humidity-cap non-compliance, and mode="none" cleanly across UI & Reports', () => {
    const store = createStore();
    store.setLayer('givoni', true);
    store.setLayer('datacenter', true);
    store.setComfort({ mode: 'both', standard: 'ashrae55', capHumidity: true, cloSummer: 0.5, cloWinter: 1.0, met: 1.1, vAir: 0.1, pmvLimit: 0.5 });

    // Point 1: 21°C, 45% RH -> Winter-compliant (PPD < 10%), Summer-cool (PPD > 50%)
    const wWinter = Psy.w_from_TRH(21, 0.45, 101325);
    const evWin = Comfort.evaluateActiveComfort(21, wWinter, 101325, store.state.comfort);
    assert.equal(evWin.compliant, true);
    assert.equal(evWin.season, 'winter');
    assert.ok(evWin.ppd < 10.0, `Winter-compliant point active PPD must be < 10%, got ${evWin.ppd.toFixed(1)}%`);
    assert.ok(evWin.summer.ppd > 50.0, `Summer PPD at 21°C should be > 50%, got ${evWin.summer.ppd.toFixed(1)}%`);

    // Point 2: 24°C, W = 0.015 kg/kg -> PMV_sum within ±0.5 BUT exceeds W <= 12 g/kg cap!
    const evHumid = Comfort.evaluateActiveComfort(24, 0.015, 101325, store.state.comfort);
    assert.equal(evHumid.pmvCompliant, true);
    assert.equal(evHumid.inHumidityBand, false);
    assert.equal(evHumid.compliant, false);
    assert.match(evHumid.reason, /Humid/i);

    // Point 3: mode = 'none' must NEVER return Summer PMV alongside compliant = true!
    const evNone = Comfort.evaluateActiveComfort(21, wWinter, 101325, { ...store.state.comfort, mode: 'none' });
    assert.equal(evNone.compliant, true);
    assert.ok(Math.abs(evNone.pmv) <= 0.5, `mode="none" must pick matching compliant season PMV, got ${evNone.pmv}`);

    store.addPoint({ T: 21, w: wWinter, label: 'WinterRoom' });
    store.addPoint({ T: 24, w: 0.015, label: 'HumidRoom' });

    // HTML Report verification (must show Winter PPD < 10% for WinterRoom, NOT Summer PPD > 50%, + TC 9.9 column + Humid reason)
    const html = Exporter.buildHTMLReportString(store, { includeChart: false, includeComfort: true });
    assert.match(html, /Active PPD%/);
    assert.match(html, /TC 9\.9 Class/);
    assert.match(html, /Humid \(W &gt; 12 g\/kg\)|Humid \(W > 12 g\/kg\)/);
    assert.ok(html.includes(`${evWin.ppd.toFixed(1)}%`), `HTML report must display Winter PPD ${evWin.ppd.toFixed(1)}%`);
    assert.ok(!html.includes(`${evWin.summer.ppd.toFixed(1)}%`), 'HTML report must NOT display Summer PPD for Winter-compliant point');

    // IP HTML Report must format air velocity in fpm, not m/s
    store.setUnits('IP');
    const htmlIP = Exporter.buildHTMLReportString(store, { includeChart: false, includeComfort: true });
    assert.match(htmlIP, /v = \d+ fpm/, 'IP HTML report must display air velocity in fpm');
    assert.match(htmlIP, /84 gr\/lb/, 'IP HTML report must display humidity cap in gr/lb');
    store.setUnits('SI');
  });

  it('renders SVG comfort zones in Canvas z-order with Givoni hatch, TC 9.9 A1–A4, and ZERO overlapping zone labels', () => {
    const store = createStore();
    store.setLayer('comfort', true);
    store.setLayer('givoni', true);
    store.setLayer('datacenter', true);
    store.setComfort({ mode: 'both', standard: 'ashrae55', capHumidity: true });

    const svg = Exporter.buildSVGString(store, 1280, 800);
    // Givoni 45° hatch patterns present
    assert.match(svg, /id="givoni-hatch-0"/, 'SVG must define Givoni diagonal hatch <pattern>');
    // TC 9.9 Rec + A1..A4 tags present
    for (const tag of ['TC 9.9 Rec', '>A1<', '>A2<', '>A3<', '>A4<']) {
      assert.ok(svg.includes(tag), `SVG comfort-zones missing TC 9.9 tag ${tag}`);
    }
    // Extract <g id="comfort-zones"> block and verify zero 2D text bbox collisions
    const mGroup = svg.match(/<g id="comfort-zones"[^>]*>([\s\S]*?)<\/g>/);
    assert.ok(mGroup, 'SVG must contain <g id="comfort-zones">');
    const textRegex = /<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="([^"]+)" dominant-baseline="([^"]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]+)<\/text>/g;
    const boxes = [];
    let m;
    while ((m = textRegex.exec(mGroup[1])) !== null) {
      const x = parseFloat(m[1]);
      const y = parseFloat(m[2]);
      const anchor = m[3];
      const baseline = m[4];
      const fs = parseFloat(m[5]);
      const txt = m[6];
      const w = Math.max(16, txt.length * fs * 0.60) + 4;
      const h = fs + 4;
      const bx = anchor === 'end' ? (x - w) : (anchor === 'start' ? x : (x - w * 0.5));
      const by = baseline === 'hanging' ? y : (y - h * 0.5);
      boxes.push({ txt, x: bx, y: by, w, h });
    }
    assert.ok(boxes.length >= 12, `Expected >= 12 SVG zone labels (6 Givoni + 5 TC 9.9 + 2 ASHRAE 55), got ${boxes.length}`);

    let collisions = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ov = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        if (ov) collisions++;
      }
    }
    assert.equal(collisions, 0, `Expected 0 SVG comfort-zone label collisions, got ${collisions}`);
  });
});
