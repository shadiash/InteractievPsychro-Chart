/* ============================================================================
   PsychroChart Ultra 3.0 — Performance, Render Precision & UX Benchmark Suite
   Agent 19 — Performance, Render Precision & UX Benchmark Engineer
   Run with: `node tests/perf_benchmark.mjs`
   ============================================================================ */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { Psy } from '../src/engine/psychro.js';
import { Comfort } from '../src/engine/comfort.js';
import { HVAC } from '../src/engine/hvac.js';
import { Weather } from '../src/engine/weather.js';
import { createStore } from '../src/state/store.js';
import { BaseRenderer } from '../src/render/baseRenderer.js';
import { Exporter } from '../src/export/exporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

/* --------------------------------------------------------------------------
   Formatting & Timing Utilities
   -------------------------------------------------------------------------- */
const resultsSummary = [];
const auditFindings = [];

function recordBudget(name, measured, unit, budgetDesc, passed, details = '') {
  resultsSummary.push({ name, measured, unit, budgetDesc, passed, details });
  const icon = passed ? 'PASS' : 'FAIL';
  const det = details ? ` | ${details}` : '';
  console.log(`  [${icon}] ${name}: ${measured} ${unit} (budget: ${budgetDesc})${det}`);
}

function addFinding(severity, category, location, summary, impact) {
  auditFindings.push({ severity, category, location, summary, impact });
}

function buildMockCanvas(cssW = 1280, cssH = 800) {
  const counts = {
    total: 0,
    fillRect: 0,
    strokeRect: 0,
    beginPath: 0,
    moveTo: 0,
    lineTo: 0,
    arc: 0,
    stroke: 0,
    fill: 0,
    fillText: 0,
    strokeText: 0,
    save: 0,
    restore: 0,
    clip: 0,
    setLineDash: 0,
    translate: 0,
    rotate: 0,
    rect: 0,
    closePath: 0,
    setTransform: 0
  };

  const track = (name) => (..._args) => {
    counts[name] = (counts[name] || 0) + 1;
    counts.total++;
  };

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: track('fillRect'),
    strokeRect: track('strokeRect'),
    clearRect: track('clearRect'),
    beginPath: track('beginPath'),
    closePath: track('closePath'),
    moveTo: track('moveTo'),
    lineTo: track('lineTo'),
    quadraticCurveTo: track('quadraticCurveTo'),
    bezierCurveTo: track('bezierCurveTo'),
    arc: track('arc'),
    rect: track('rect'),
    stroke: track('stroke'),
    fill: track('fill'),
    clip: track('clip'),
    save: track('save'),
    restore: track('restore'),
    translate: track('translate'),
    rotate: track('rotate'),
    scale: track('scale'),
    setTransform: track('setTransform'),
    setLineDash: track('setLineDash'),
    fillText: track('fillText'),
    strokeText: track('strokeText'),
    measureText: (txt) => ({ width: String(txt || '').length * 6.5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  };

  const canvas = {
    width: 0,
    height: 0,
    clientWidth: cssW,
    clientHeight: cssH,
    style: { width: `${cssW}px`, height: `${cssH}px` },
    parentElement: {
      getBoundingClientRect: () => ({ width: cssW, height: cssH, left: 0, top: 0, right: cssW, bottom: cssH })
    },
    getBoundingClientRect: () => ({ width: cssW, height: cssH, left: 0, top: 0, right: cssW, bottom: cssH }),
    getContext: (kind) => (kind === '2d' ? ctx : null)
  };

  const resetCounts = () => {
    for (const k of Object.keys(counts)) counts[k] = 0;
  };

  return { canvas, ctx, counts, resetCounts };
}

function buildRealisticStore(units = 'SI', withWeather = false) {
  const store = createStore();
  store.setMeta({
    name: 'Bench AHU-01 Full Cycle',
    version: 'v3.0',
    company: 'PsychroChart Engineering',
    engineer: 'Benchmark Suite'
  });
  store.setUnits(units);

  const pPa = 101325;
  const cycle = HVAC.buildAHUCycle({
    mode: 'summer_reheat',
    oaT: 38,
    oaRH: 48,
    raT: 24,
    raRH: 50,
    oaPct: 30,
    supplyFlow: 2500,
    flowUnit: 'Lps',
    coilAdp: 10.5,
    coilBpf: 0.14,
    reheatT: 16.5,
    fanDpPa: 750,
    fanEff: 0.68
  }, pPa);

  const pts = cycle.points.map(pt => ({
    key: pt.key,
    T: pt.T,
    w: pt.w,
    label: pt.label,
    color: pt.color,
    note: pt.note || ''
  }));
  const procs = cycle.processes.map(pr => ({
    aId: pr.fromKey,
    bId: pr.toKey,
    flowVal: pr.flowVal,
    flowUnit: 'Lps',
    showCurve: Boolean(pr.curved),
    adpT: pr.kind === 'cooling' ? cycle.summary.coilAdp : null,
    adpW: pr.kind === 'cooling' ? Psy.wsat_at(cycle.summary.coilAdp, pPa) : null,
    label: pr.label || ''
  }));
  store.loadCycle(pts, procs, {}, 'Benchmark AHU');
  store.addAnnotation({ T: 30, w: 0.018, text: 'Summer Peak Design', color: '#f59e0b' }, false);

  if (withWeather) {
    const tmy = Weather.generateSyntheticTMY('dubai');
    const bins = Weather.computePsychroBins(tmy.records, tmy.pPa);
    store.setWeather({
      cityId: tmy.cityId,
      sourceName: tmy.sourceName,
      records: tmy.records,
      bins,
      mode: 'heatmap',
      opacity: 0.72
    });
    store.setLayer('weather', true);
  }
  return store;
}

/* ==========================================================================
   BENCHMARK 1: Physics Throughput (Psy)
   ========================================================================== */
function runPhysicsBenchmark() {
  console.log('\n=== 1. Physics Throughput (Psy) ===');

  // 1a. 10,000 stateFromTw calls spanning sub-zero, 0°C transition, comfort, hot-humid, high-altitude
  const N_STATE = 10000;
  const inputs = new Array(N_STATE);
  const pressures = [101325, 95461, 83430, 101325, 89875];
  for (let i = 0; i < N_STATE; i++) {
    const T = -20 + ((i * 73) % 7000) / 100; // -20..+50 °C
    const rh = 0.05 + (((i * 37) % 95) / 100); // 5%..99%
    const pPa = pressures[i % pressures.length];
    const w = Psy.w_from_TRH(T, rh, pPa);
    inputs[i] = { T, w, pPa };
  }

  // Warmup JIT
  for (let i = 0; i < 500; i++) {
    const inp = inputs[i];
    Psy.stateFromTw(inp.T, inp.w, inp.pPa);
  }

  let checkSum = 0;
  const t0 = performance.now();
  for (let i = 0; i < N_STATE; i++) {
    const inp = inputs[i];
    const st = Psy.stateFromTw(inp.T, inp.w, inp.pPa);
    if (!Number.isFinite(st.Twb) || !Number.isFinite(st.Tdp) || !Number.isFinite(st.hIP)) {
      throw new Error(`Non-finite stateFromTw output at index ${i}`);
    }
    checkSum += st.Twb + st.Tdp;
  }
  const dtStateMs = performance.now() - t0;
  const msPerState = dtStateMs / N_STATE;
  const statesPerSec = Math.round((N_STATE / dtStateMs) * 1000);
  // Prevent dead-code elimination
  assert.ok(Number.isFinite(checkSum));

  const stateBudgetPass = dtStateMs < 500; // clean high-throughput budget (< 0.05 ms/op)
  recordBudget(
    'Psy.stateFromTw (10,000 calls)',
    dtStateMs.toFixed(2),
    'ms total',
    '< 500 ms (< 0.05 ms/op)',
    stateBudgetPass,
    `${msPerState.toFixed(5)} ms/op (${statesPerSec.toLocaleString()} ops/s)`
  );

  // 1b. 1,000 solveState calls across coupled non-Tdb pairs (Twb+RH, h+RH, h+v, Twb+v)
  const N_PER_PAIR = 250;
  const pairs = ['Twb+RH', 'h+RH', 'h+v', 'Twb+v'];
  const cases = { 'Twb+RH': [], 'h+RH': [], 'h+v': [], 'Twb+v': [] };

  for (let i = 0; i < N_PER_PAIR; i++) {
    const T = 5 + ((i * 29) % 380) / 10; // 5..43 °C
    const rh = 0.20 + (((i * 19) % 70) / 100); // 20%..89%
    const pPa = i % 3 === 0 ? 83430 : 101325;
    const w = Psy.w_from_TRH(T, rh, pPa);
    const ref = Psy.stateFromTw(T, w, pPa);
    cases['Twb+RH'].push({ p1: 'Twb', v1: ref.Twb, p2: 'RH', v2: ref.rh, pPa, ref });
    cases['h+RH'].push({ p1: 'h', v1: ref.h, p2: 'RH', v2: ref.rh, pPa, ref });
    cases['h+v'].push({ p1: 'h', v1: ref.h, p2: 'v', v2: ref.v, pPa, ref });
    cases['Twb+v'].push({ p1: 'Twb', v1: ref.Twb, p2: 'v', v2: ref.v, pPa, ref });
  }

  // Warmup
  for (const key of pairs) {
    for (let i = 0; i < 20; i++) {
      const c = cases[key][i];
      Psy.solveState(c.p1, c.v1, c.p2, c.v2, c.pPa);
    }
  }

  let totalSolveMs = 0;
  let totalSolved = 0;
  let maxErrT = 0;
  let maxErrW = 0;
  const pairStats = [];

  for (const key of pairs) {
    const list = cases[key];
    const s0 = performance.now();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const res = Psy.solveState(c.p1, c.v1, c.p2, c.v2, c.pPa);
      assert.ok(res.ok, `solveState(${key}) failed at i=${i}: ${res.error}`);
      const errT = Math.abs(res.state.T - c.ref.T);
      const errW = Math.abs(res.state.w - c.ref.w);
      if (errT > maxErrT) maxErrT = errT;
      if (errW > maxErrW) maxErrW = errW;
      assert.ok(errT < 1e-3, `solveState(${key}) T residual too high: ${errT}`);
      assert.ok(errW < 1e-5, `solveState(${key}) w residual too high: ${errW}`);
      totalSolved++;
    }
    const dt = performance.now() - s0;
    totalSolveMs += dt;
    pairStats.push(`${key}: ${(dt / list.length).toFixed(4)} ms`);
  }

  const avgSolveMs = totalSolveMs / totalSolved;
  const solvePass = avgSolveMs < 1.0;
  recordBudget(
    `Psy.solveState (${totalSolved} coupled non-Tdb solves)`,
    avgSolveMs.toFixed(4),
    'ms/solve',
    '< 1.0 ms/solve',
    solvePass,
    `total ${totalSolveMs.toFixed(2)} ms | max |ΔT|=${maxErrT.toExponential(1)}°C, |Δw|=${maxErrW.toExponential(1)} | ${pairStats.join(', ')}`
  );
  assert.ok(solvePass, `Expected solveState avg < 1 ms/solve, got ${avgSolveMs.toFixed(4)} ms`);
}

/* ==========================================================================
   BENCHMARK 2: Dynamic PMV Comfort Polygon (Comfort)
   ========================================================================== */
function runComfortBenchmark() {
  console.log('\n=== 2. Dynamic PMV Comfort Polygon (Comfort) ===');

  const N_BUILDS = 20;
  const configs = [];
  for (let i = 0; i < N_BUILDS; i++) {
    configs.push({
      pPa: i % 4 === 0 ? 83430 : 101325,
      opts: {
        cloSummer: 0.4 + (i % 5) * 0.08,
        cloWinter: 0.85 + (i % 5) * 0.1,
        met: 1.0 + (i % 4) * 0.15,
        vAir: 0.1 + (i % 5) * 0.08,
        mrtOffset: -2 + (i % 5) * 1.0,
        pmvLimit: 0.5
      }
    });
  }

  // Warmup
  Comfort.getSummerWinterZones(101325, configs[0].opts);
  Comfort.getSummerWinterZones(83430, configs[1].opts);

  const timings = [];
  let minVerts = Infinity;
  let maxVerts = 0;
  const t0 = performance.now();
  for (let i = 0; i < N_BUILDS; i++) {
    const cfg = configs[i];
    const b0 = performance.now();
    const zones = Comfort.getSummerWinterZones(cfg.pPa, cfg.opts);
    const dt = performance.now() - b0;
    timings.push(dt);

    assert.ok(zones?.summer?.poly?.length >= 10, 'Summer comfort polygon must have >= 10 vertices');
    assert.ok(zones?.winter?.poly?.length >= 10, 'Winter comfort polygon must have >= 10 vertices');
    const vCount = zones.summer.poly.length + zones.winter.poly.length;
    if (vCount < minVerts) minVerts = vCount;
    if (vCount > maxVerts) maxVerts = vCount;
  }
  const totalMs = performance.now() - t0;
  const avgMs = totalMs / N_BUILDS;
  const maxMs = Math.max(...timings);
  const p95Ms = [...timings].sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];

  const pass = avgMs < 15.0;
  recordBudget(
    `Comfort.getSummerWinterZones (${N_BUILDS} builds)`,
    avgMs.toFixed(2),
    'ms/build',
    '< 15.0 ms/build',
    pass,
    `total ${totalMs.toFixed(2)} ms | p95 ${p95Ms.toFixed(2)} ms | max ${maxMs.toFixed(2)} ms | verts ${minVerts}..${maxVerts}`
  );
  assert.ok(pass, `Expected Comfort.getSummerWinterZones < 15 ms/build, got ${avgMs.toFixed(2)} ms`);
}

/* ==========================================================================
   BENCHMARK 3: 8,760-Hour Climate Synthesis + Psychrometric Binning (Weather)
   ========================================================================== */
function runWeatherBenchmark() {
  console.log('\n=== 3. 8,760-Hour Climate Synthesis + Psychrometric Binning (Weather) ===');

  const cityIds = ['dubai', 'denver', 'tokyo', 'london', 'fairbanks'];

  // Warmup
  const warmTmy = Weather.generateSyntheticTMY('cairo');
  Weather.computePsychroBins(warmTmy.records, warmTmy.pPa);

  let maxCityMs = 0;
  let sumCityMs = 0;

  for (const cid of cityIds) {
    const t0 = performance.now();
    const tmy = Weather.generateSyntheticTMY(cid);
    const t1 = performance.now();
    const bins = Weather.computePsychroBins(tmy.records, tmy.pPa);
    const t2 = performance.now();

    const synthMs = t1 - t0;
    const binMs = t2 - t1;
    const totMs = t2 - t0;
    if (totMs > maxCityMs) maxCityMs = totMs;
    sumCityMs += totMs;

    assert.equal(tmy.records.length, 8760, `${cid}: expected 8760 hourly records`);
    assert.equal(bins.totalHours, 8760, `${cid}: expected bins.totalHours === 8760`);
    assert.ok(bins.bins2D.length > 50, `${cid}: expected > 50 populated 2D bins`);

    const pass = totMs < 100.0;
    recordBudget(
      `Weather TMY+Bins (${cid})`,
      totMs.toFixed(2),
      'ms',
      '< 100 ms/city',
      pass,
      `synth=${synthMs.toFixed(2)}ms, bin=${binMs.toFixed(2)}ms | bins2D=${bins.bins2D.length} | comf=${bins.comfortPct}% cool=${bins.coolPct}% heat=${bins.heatPct}%`
    );
    assert.ok(pass, `${cid}: TMY + binning took ${totMs.toFixed(2)} ms (>= 100 ms budget)`);
  }

  console.log(`  Summary: avg ${(sumCityMs / cityIds.length).toFixed(2)} ms/city, worst ${maxCityMs.toFixed(2)} ms/city`);
}

/* ==========================================================================
   BENCHMARK 4: Vector SVG & CSV Export Speed & Payload Size (Exporter)
   ========================================================================== */
function inspectSVGQuality(svg, label) {
  // 1. Structural well-formedness
  const startsXml = svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>');
  const hasSvgOpen = /<svg\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>/.test(svg);
  const endsSvgClose = svg.trim().endsWith('</svg>');
  const hasNaN = /\bNaN\b|\bInfinity\b|\bundefined\b/.test(svg);

  // Check balanced group/svg tags
  const gOpen = (svg.match(/<g[\s>]/g) || []).length;
  const gClose = (svg.match(/<\/g>/g) || []).length;

  // 2. Excessive decimal precision check (5+ decimal digits in numeric attributes/paths)
  const excessDecMatches = svg.match(/\d+\.\d{5,}/g) || [];

  // 3. Consecutive duplicate coordinate pairs inside <path d="..."> and <polygon points="...">
  let duplicatePathPts = 0;
  let totalPathPts = 0;
  const pathRegex = /\bd="([^"]+)"/g;
  let m;
  while ((m = pathRegex.exec(svg)) !== null) {
    const tokens = m[1].match(/[ML][-+]?\d+(?:\.\d+)?,[-+]?\d+(?:\.\d+)?/g) || [];
    let prevCoord = null;
    for (const tok of tokens) {
      totalPathPts++;
      const coord = tok.slice(1);
      if (tok[0] === 'L' && coord === prevCoord) {
        duplicatePathPts++;
      }
      prevCoord = coord;
    }
  }

  let duplicatePolyPts = 0;
  let totalPolyPts = 0;
  const polyRegex = /\bpoints="([^"]+)"/g;
  while ((m = polyRegex.exec(svg)) !== null) {
    const pts = m[1].trim().split(/\s+/);
    let prev = null;
    for (const pt of pts) {
      totalPolyPts++;
      if (pt === prev) duplicatePolyPts++;
      prev = pt;
    }
  }

  // Check unescaped ampersands (not part of &amp; &lt; &gt; &quot; &#...;)
  const badAmp = (svg.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g) || []).length;

  const wellFormed = startsXml && hasSvgOpen && endsSvgClose && !hasNaN && gOpen === gClose && badAmp === 0;
  return {
    label,
    bytes: Buffer.byteLength(svg, 'utf8'),
    wellFormed,
    startsXml,
    hasSvgOpen,
    endsSvgClose,
    hasNaN,
    gOpen,
    gClose,
    badAmp,
    excessDecCount: excessDecMatches.length,
    excessDecSample: excessDecMatches.slice(0, 3),
    duplicatePathPts,
    totalPathPts,
    duplicatePolyPts,
    totalPolyPts
  };
}

function runExporterBenchmark() {
  console.log('\n=== 4. Vector SVG & CSV Export Speed & Payload Size (Exporter) ===');

  const storeSI = buildRealisticStore('SI', true);
  const storeIP = buildRealisticStore('IP', true);

  // Warmup
  Exporter.buildSVGString(storeSI, 1280, 800);
  Exporter.buildCSVString(storeSI);

  // 4a. Vector SVG (SI & IP)
  const N_SVG = 10;
  let lastSvgSI = '';
  const t0 = performance.now();
  for (let i = 0; i < N_SVG; i++) {
    lastSvgSI = Exporter.buildSVGString(storeSI, 1280, 800);
  }
  const svgSIMs = (performance.now() - t0) / N_SVG;

  let lastSvgIP = '';
  const t1 = performance.now();
  for (let i = 0; i < N_SVG; i++) {
    lastSvgIP = Exporter.buildSVGString(storeIP, 1280, 800);
  }
  const svgIPMs = (performance.now() - t1) / N_SVG;

  const qSI = inspectSVGQuality(lastSvgSI, 'SI');
  const qIP = inspectSVGQuality(lastSvgIP, 'IP');

  const svgPassSI = svgSIMs < 80 && qSI.wellFormed && qSI.excessDecCount === 0;
  const svgPassIP = svgIPMs < 80 && qIP.wellFormed && qIP.excessDecCount === 0;

  recordBudget(
    'Exporter.buildSVGString SI (1280x800)',
    svgSIMs.toFixed(2),
    'ms',
    '< 80 ms, well-formed, no precision bloat',
    svgPassSI,
    `${(qSI.bytes / 1024).toFixed(1)} KB | wellFormed=${qSI.wellFormed} | excessDec=${qSI.excessDecCount} | dupPathPts=${qSI.duplicatePathPts}/${qSI.totalPathPts} | dupPolyPts=${qSI.duplicatePolyPts}/${qSI.totalPolyPts}`
  );
  recordBudget(
    'Exporter.buildSVGString IP (1280x800)',
    svgIPMs.toFixed(2),
    'ms',
    '< 80 ms, well-formed, no precision bloat',
    svgPassIP,
    `${(qIP.bytes / 1024).toFixed(1)} KB | wellFormed=${qIP.wellFormed} | excessDec=${qIP.excessDecCount} | dupPathPts=${qIP.duplicatePathPts}/${qIP.totalPathPts} | dupPolyPts=${qIP.duplicatePolyPts}/${qIP.totalPolyPts}`
  );

  assert.ok(svgSIMs < 80, `SVG SI build exceeded 80 ms budget: ${svgSIMs.toFixed(2)} ms`);
  assert.ok(svgIPMs < 80, `SVG IP build exceeded 80 ms budget: ${svgIPMs.toFixed(2)} ms`);
  assert.ok(qSI.wellFormed, 'SI SVG failed well-formedness check');
  assert.ok(qIP.wellFormed, 'IP SVG failed well-formedness check');
  assert.equal(qSI.excessDecCount, 0, `SI SVG has excessive decimal precision: ${qSI.excessDecSample.join(', ')}`);
  assert.equal(qIP.excessDecCount, 0, `IP SVG has excessive decimal precision: ${qIP.excessDecSample.join(', ')}`);

  if (qSI.duplicatePathPts > 0 || qIP.duplicatePathPts > 0 || qSI.duplicatePolyPts > 0 || qIP.duplicatePolyPts > 0) {
    addFinding(
      'LOW',
      'SVG Precision',
      'src/export/exporter.js:1398-1411',
      `svgPathFromPts() emits ${qSI.duplicatePathPts} (SI) / ${qIP.duplicatePathPts} (IP) consecutive duplicate L coordinates`,
      'Minor SVG payload bloat (~1-2%); skipping points whose formatted (x,y) equals the previous point eliminates redundant L segments cleanly.'
    );
  }

  // 4b. CSV Export (SI & IP)
  const N_CSV = 20;
  let lastCsvSI = '';
  const c0 = performance.now();
  for (let i = 0; i < N_CSV; i++) {
    lastCsvSI = Exporter.buildCSVString(storeSI);
  }
  const csvSIMs = (performance.now() - c0) / N_CSV;

  let lastCsvIP = '';
  const c1 = performance.now();
  for (let i = 0; i < N_CSV; i++) {
    lastCsvIP = Exporter.buildCSVString(storeIP);
  }
  const csvIPMs = (performance.now() - c1) / N_CSV;

  const csvBadSI = /\bNaN\b|\bInfinity\b|\bundefined\b/.test(lastCsvSI);
  const csvBadIP = /\bNaN\b|\bInfinity\b|\bundefined\b/.test(lastCsvIP);
  assert.ok(!csvBadSI, 'SI CSV contains NaN/Infinity/undefined');
  assert.ok(!csvBadIP, 'IP CSV contains NaN/Infinity/undefined');

  const csvPass = csvSIMs < 30 && csvIPMs < 30 && !csvBadSI && !csvBadIP;
  recordBudget(
    'Exporter.buildCSVString (SI / IP w/ 8760h weather)',
    `${csvSIMs.toFixed(2)} / ${csvIPMs.toFixed(2)}`,
    'ms',
    '< 30 ms, zero NaN/Infinity',
    csvPass,
    `${(Buffer.byteLength(lastCsvSI, 'utf8') / 1024).toFixed(1)} KB SI, ${(Buffer.byteLength(lastCsvIP, 'utf8') / 1024).toFixed(1)} KB IP`
  );
  assert.ok(csvPass, `CSV export exceeded budget or failed validation`);
}

/* ==========================================================================
   BENCHMARK 5: BaseRenderer Caching Efficiency
   ========================================================================== */
function runBaseRendererBenchmark() {
  console.log('\n=== 5. BaseRenderer Caching Efficiency ===');

  const store = buildRealisticStore('SI', true);
  store.setLayer('givoni', true);
  store.setLayer('datacenter', true);
  store.setLayer('dp', true);

  const { canvas, counts, resetCounts } = buildMockCanvas(1280, 800);
  const br = new BaseRenderer(canvas);

  // Cold render (first draw with all layers + weather heatmap + comfort + givoni + datacenter)
  resetCounts();
  const c0 = performance.now();
  const didColdRender = br.render(store.state);
  const coldMs = performance.now() - c0;
  const coldCounts = { ...counts };
  const coldDrawCalls = coldCounts.total;

  assert.equal(didColdRender, true, 'Cold BaseRenderer.render must return true');
  assert.ok(coldDrawCalls > 200, `Expected substantial canvas draw calls on cold render, got ${coldDrawCalls}`);

  // Warm cache-hit renders (100 consecutive identical calls)
  resetCounts();
  const N_WARM = 100;
  const w0 = performance.now();
  let warmRenderedCount = 0;
  for (let i = 0; i < N_WARM; i++) {
    if (br.render(store.state)) warmRenderedCount++;
  }
  const warmTotalMs = performance.now() - w0;
  const warmAvgMs = warmTotalMs / N_WARM;
  const warmDrawCalls = counts.total;

  assert.equal(warmRenderedCount, 0, 'Warm cache-hit BaseRenderer.render must return false');
  assert.equal(warmDrawCalls, 0, `Expected 0 draw calls on warm cache hit, got ${warmDrawCalls}`);

  // Verify cache properly invalidates on view/theme/unit/comfort mutation
  resetCounts();
  store.setUnits('IP');
  const didInvalidateRender = br.render(store.state);
  const invDrawCalls = counts.total;
  assert.equal(didInvalidateRender, true, 'BaseRenderer must re-render when units change');
  assert.ok(invDrawCalls > 200, 'Expected draw calls after cache invalidation');

  // Verify weatherMode === 'both' behavior (detects whether scatter dots are also drawn)
  store.setWeather({ ...store.state.weather, mode: 'heatmap' });
  resetCounts();
  br.render(store.state, true);
  const heatArcCount = counts.arc;

  store.setWeather({ ...store.state.weather, mode: 'both' });
  resetCounts();
  br.render(store.state, true);
  const bothArcCount = counts.arc;
  if (bothArcCount === heatArcCount) {
    addFinding(
      'MEDIUM',
      'Render Precision',
      'src/render/baseRenderer.js:668-809',
      'weatherMode === "both" ("Map + Scatter" in index.template.html:167) renders heatmap only and skips scatter pass',
      `Observed arc calls: heatmap=${heatArcCount}, both=${bothArcCount}. Selecting "Map + Scatter" produces identical output to "Density Map".`
    );
  }

  const coldPass = coldMs < 100;
  const warmPass = warmAvgMs < 0.1 && warmDrawCalls === 0;

  recordBudget(
    'BaseRenderer.render (cold, all layers + 8760h weather)',
    coldMs.toFixed(2),
    'ms',
    '< 100 ms',
    coldPass,
    `${coldDrawCalls} draw calls (stroke=${coldCounts.stroke}, fill=${coldCounts.fill}, fillRect=${coldCounts.fillRect}, text=${coldCounts.fillText})`
  );
  recordBudget(
    `BaseRenderer.render (warm cache-hit, avg of ${N_WARM})`,
    warmAvgMs.toFixed(5),
    'ms',
    '< 0.100 ms & 0 draw calls',
    warmPass,
    `drawCalls=${warmDrawCalls} | total=${warmTotalMs.toFixed(3)} ms`
  );

  assert.ok(coldPass, `Cold BaseRenderer render took ${coldMs.toFixed(2)} ms (>= 100 ms)`);
  assert.ok(warmPass, `Warm BaseRenderer cache-hit avg ${warmAvgMs.toFixed(5)} ms (>= 0.1 ms) or drawCalls=${warmDrawCalls}`);
}

/* ==========================================================================
   BENCHMARK 6: Code Quality, Unit Conversion & UX Static Audit
   ========================================================================== */
function walkFiles(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some(ext => entry.name.endsWith(ext))) out.push(full);
  }
  return out.sort();
}

function runStaticAndUnitAudit() {
  console.log('\n=== 6. Code Quality, Unit Accuracy & UX Static Audit ===');

  const srcFiles = walkFiles(path.join(ROOT_DIR, 'src'), ['.js']);
  const templatePath = path.join(ROOT_DIR, 'index.template.html');
  const templateHtml = fs.readFileSync(templatePath, 'utf8');
  const templateLines = templateHtml.split(/\r?\n/);

  /* ---- 6A. Live Unit Conversion & Flow Unit Probes ---- */
  // Probe 1: Specific volume & density conversion accuracy in Psy
  const refSt = Psy.stateFromTw(24, Psy.w_from_TRH(24, 0.5, 101325), 101325);
  const expectedV_IP = refSt.v * (35.3146667215 / 2.20462262185); // * 16.01846337
  const expectedRho_IP = refSt.rhoMoist * (2.20462262185 / 35.3146667215); // * 0.06242796
  assert.ok(Math.abs(refSt.vIP - expectedV_IP) < 1e-6, 'Psy vIP factor mismatch');
  assert.ok(Math.abs(refSt.rhoMoistIP - expectedRho_IP) < 1e-6, 'Psy rhoMoistIP factor mismatch');

  // Probe 2: True 0°F enthalpy datum in Psy
  const hIP_ref = Psy.h_Btulb(24, refSt.w);
  const expectedH_IP = 0.240 * (24 * 1.8 + 32) + refSt.w * (1061 + 0.444 * (24 * 1.8 + 32));
  assert.ok(Math.abs(hIP_ref - expectedH_IP) < 1e-9, 'Psy h_Btulb 0°F datum mismatch');
  assert.ok(Math.abs(Psy.h_Btulb(0, 0) - 7.680) < 1e-9, 'Psy h_Btulb(0°C, 0) should be 7.680 Btu/lb');

  // Probe 3: Flow unit 'lbs' / 'kgs' option values in index.template.html vs Psy.flowToMassKgps!
  const mLbps = Psy.flowToMassKgps(10, 'lbps', 24, 0.01, 101325);
  const mLbs = Psy.flowToMassKgps(10, 'lbs', 24, 0.01, 101325);
  if (Math.abs(mLbs - mLbps) > 1e-6) {
    addFinding(
      'CRITICAL',
      'IP Unit Conversion',
      'src/engine/psychro.js:842-852 & index.template.html:579,582,833,835,1095,1097',
      `Psy.flowToMassKgps(10, "lbs") returns ${mLbs.toFixed(4)} kg/s instead of ${mLbps.toFixed(4)} kg/s (falls through to "kgps" — 2.2046x error!)`,
      'index.template.html uses value="lbs" and value="kgs" on #flowUnit, #mixUnit, #mixFlowUnit; Psy._normalizeFlowUnit and exporter.js:640,645 only recognize "lbps"/"lb/s" and "kgps"/"kg/s". Adding "lbs" and "kgs" aliases fixes both HTML defaults and imported JSON.'
    );
  }

  // Probe 4: IP enthalpy conversion with w=0 in modals.js (_modDispPropToSI) vs exact w
  const testSt = Psy.stateFromTw(30, 0.018, 101325);
  const hSI_approx = Psy.h_kJkg_from_Btulb(testSt.hIP, 0);
  const hSI_exact = Psy.h_kJkg_from_Btulb(testSt.hIP, testSt.w);
  const hErrKJ = Math.abs(hSI_approx - hSI_exact);
  const solvedModalStyle = Psy.solveState('Tdb', testSt.T, 'h', hSI_approx, 101325);
  const solvedRHDrift = solvedModalStyle.ok ? Math.abs(solvedModalStyle.state.rh - testSt.rh) : NaN;
  const modalsSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/ui/modals.js'), 'utf8');
  if (/Psy\.h_kJkg_from_Btulb\(rawVal,\s*0\)/.test(modalsSrc)) {
    addFinding(
      'HIGH',
      'IP Unit Conversion',
      'src/ui/modals.js:116-117 & 1591-1593',
      `Add Point via Parameters modal converts IP enthalpy using w=0 (Psy.h_kJkg_from_Btulb(rawVal, 0)) without fixed-point w refinement`,
      `At 30°C / 18 g/kg (32.78 Btu/lb), w=0 yields Δh=${hErrKJ.toFixed(3)} kJ/kg (RH error ~${solvedRHDrift.toFixed(2)}%). Mirror leftPanel.js:546-584 fixed-point refinement.`
    );
  }

  // Probe 5: Edit Point modal missing 'h' mode handler in modals.js
  if (templateHtml.includes('<option value="h">Specific Enthalpy</option>') && !/else\s+if\s*\(\s*mode\s*===\s*'h'\s*\)/.test(modalsSrc)) {
    addFinding(
      'CRITICAL',
      'UX / Calculation Bug',
      'src/ui/modals.js:1355-1381 & index.template.html:988',
      'Edit Point modal (#epMode) offers "Specific Enthalpy" (value="h"), but epSolveInputs() has no branch for mode === "h"',
      'Selecting Specific Enthalpy in Edit Point sets w=NaN, clears all live properties to "—", and blocks Apply with a validation error.'
    );
  }

  // Probe 6: leftPanel.js IP enthalpy offset constant (+ 7.686 vs exact 0.240 * 32 = 7.680)
  const leftPanelSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/ui/leftPanel.js'), 'utf8');
  if (/\+\s*7\.686\b/.test(leftPanelSrc)) {
    addFinding(
      'LOW',
      'IP Unit Conversion',
      'src/ui/leftPanel.js:505',
      'convertDisplayValue("h") uses +7.686 offset instead of exact ASHRAE dry-air datum 0.240 * 32 = 7.680 (and ignores w)',
      'Slight ~0.006–0.05 Btu/lb drift when toggling SI↔IP in the Calculator/Points inputs (solver itself still refines accurately).'
    );
  }

  // Probe 7: Scan all src/ files for mistaken 35.314667 used directly for specific volume (ft³/lb) instead of 16.018463
  let wrongVolFactorHits = 0;
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((ln, idx) => {
      // Flag raw multiplication of v by 35.314 without dividing by 2.2046 / LB_PER_KG
      if (/\bv\b.*35\.314/.test(ln) && !/2\.2046|LB_PER_KG/.test(ln)) {
        wrongVolFactorHits++;
        addFinding(
          'CRITICAL',
          'IP Unit Conversion',
          `${path.relative(ROOT_DIR, file)}:${idx + 1}`,
          'Suspected specific volume multiplied by 35.314667 (ft³/m³) without dividing by 2.204623 (lb/kg)',
          ln.trim()
        );
      }
    });
  }

  /* ---- 6B. Accessibility Audit: Icon-only buttons in index.template.html & src/ui/ ---- */
  const iconOnlyHtmlBtns = [];
  const btnRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let bm;
  while ((bm = btnRegex.exec(templateHtml)) !== null) {
    const attrs = bm[1];
    const innerText = bm[2].replace(/<[^>]+>/g, '').trim();
    const isIconOrSymbolOnly = innerText.length > 0 && !/[A-Za-z0-9]{2,}/.test(innerText);
    if (isIconOrSymbolOnly) {
      const hasAria = /\baria-label\s*=/.test(attrs);
      const hasTitle = /\btitle\s*=/.test(attrs);
      if (!hasAria || !hasTitle) {
        const lineNum = templateHtml.slice(0, bm.index).split(/\r?\n/).length;
        const idMatch = attrs.match(/\bid="([^"]+)"/);
        iconOnlyHtmlBtns.push({
          line: lineNum,
          id: idMatch ? `#${idMatch[1]}` : '(no id)',
          text: innerText,
          missing: [!hasAria ? 'aria-label' : null, !hasTitle ? 'title' : null].filter(Boolean).join(', ')
        });
      }
    }
  }
  for (const b of iconOnlyHtmlBtns) {
    addFinding(
      'MEDIUM',
      'Accessibility (a11y)',
      `index.template.html:${b.line}`,
      `Icon/symbol-only button ${b.id} ("${b.text}") is missing ${b.missing}`,
      'Screen readers announce only the raw symbol ("+" / "−") instead of an accessible action label.'
    );
  }

  // Dynamic icon-only buttons created via template literals in src/ui/*.js
  const uiFiles = walkFiles(path.join(ROOT_DIR, 'src/ui'), ['.js']);
  for (const file of uiFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((ln, idx) => {
      if (!ln.includes('<button')) return;
      const mBtn = ln.match(/<button\b([^>]*)>(.*?)<\/button>/);
      if (!mBtn) return;
      const attrs = mBtn[1];
      const innerRaw = mBtn[2].replace(/<[^>]+>/g, '').trim();
      // Check both static text and quoted text literals inside ${...} expressions
      const quotedInExpr = (innerRaw.match(/['"][^'"]*['"]/g) || []).join(' ');
      const staticText = innerRaw.replace(/\$\{[^}]+\}/g, '').trim();
      const combinedVisible = `${staticText} ${quotedInExpr}`;
      const hasWordText = /[A-Za-z]{2,}/.test(combinedVisible);
      if (!hasWordText && !/\baria-label\s*=/.test(attrs)) {
        const clsMatch = attrs.match(/\bclass="([^"]+)"/);
        addFinding(
          'MEDIUM',
          'Accessibility (a11y)',
          `${path.relative(ROOT_DIR, file)}:${idx + 1}`,
          `Dynamic icon-only button (${clsMatch ? `.${clsMatch[1]}` : 'button'}) missing aria-label`,
          'Has title tooltip, but assistive technologies rely on aria-label for icon-only controls.'
        );
      }
    });
  }

  /* ---- 6C. Unhandled NaN / Infinity Audit in Formatters ---- */
  // Live edge-case test on Psy.fmtVal
  const nanState = { T: NaN, w: NaN, rh: NaN, h: Infinity, hIP: NaN, v: NaN, vIP: Infinity, Tdp: NaN, Twb: NaN, pv: NaN, pws: NaN, pPa: NaN, rhoDry: NaN, rhoMoist: NaN, mu: NaN, cpm: NaN };
  for (const prop of ['Tdb', 'Twb', 'Tdp', 'RH', 'W', 'h', 'v', 'Pv', 'rho', 'mu', 'cpm']) {
    const outSI = Psy.fmtVal(prop, nanState, 'SI');
    const outIP = Psy.fmtVal(prop, nanState, 'IP');
    assert.ok(!/NaN|Infinity/.test(outSI) && !/NaN|Infinity/.test(outIP), `Psy.fmtVal leaked NaN/Infinity for ${prop}`);
  }

  // Live edge-case test on Exporter with degenerate identical-state process (dT=0, dW=0 -> SHR=NaN, flow=0)
  const edgeStore = createStore();
  const p1 = edgeStore.addPoint({ T: 24, w: 0.009, label: 'SameA' }, false);
  const p2 = edgeStore.addPoint({ T: 24, w: 0.009, label: 'SameB' }, false);
  edgeStore.addProcess(p1.id, p2.id, { flowVal: 0, flowUnit: 'Lps' }, false);
  const edgeCsv = Exporter.buildCSVString(edgeStore);
  const edgeSvg = Exporter.buildSVGString(edgeStore, 1280, 800);
  assert.ok(!/\bNaN\b|\bInfinity\b|\bundefined\b/.test(edgeCsv), 'Degenerate CSV leaked NaN/Infinity');
  assert.ok(!/\bNaN\b|\bInfinity\b|\bundefined\b/.test(edgeSvg), 'Degenerate SVG leaked NaN/Infinity');

  // Static scan of direct `.toFixed(` calls on potentially unguarded computed values in UI/render/export/app
  const uiExportFiles = srcFiles.filter(f =>
    f.includes(`${path.sep}ui${path.sep}`) ||
    f.includes(`${path.sep}render${path.sep}`) ||
    f.includes(`${path.sep}export${path.sep}`) ||
    f.endsWith(`${path.sep}app.js`)
  );
  const riskyToFixed = [];
  for (const file of uiExportFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((ln, idx) => {
      if (!ln.includes('.toFixed(')) return;
      const windowTxt = lines.slice(Math.max(0, idx - 3), idx + 1).join('\n');
      const hasGuard = /Number\.isFinite|fmtNum|fmtSign|fmtSigned|isFinite/.test(windowTxt);
      if (!hasGuard && /(\/\s*[a-zA-Z_(]|\.(pmv|ppd|BPF|CF|SHR|cooling_kW|heating_kW|waterRate_|moistureRate_|steamEnergy_kW|Q_equiv_|QtSaved_|QsSaved_|QlSaved_|comfortPct)\b)/.test(ln)) {
        riskyToFixed.push({
          loc: `${path.relative(ROOT_DIR, file)}:${idx + 1}`,
          code: ln.trim().slice(0, 110)
        });
      }
    });
  }
  if (riskyToFixed.length > 0) {
    addFinding(
      'MEDIUM',
      'NaN/Infinity Guard',
      riskyToFixed.slice(0, 6).map(r => r.loc).join(', ') + (riskyToFixed.length > 6 ? ` (+${riskyToFixed.length - 6} more)` : ''),
      `${riskyToFixed.length} UI/render/export .toFixed() calls lack explicit Number.isFinite() guards on computed HVAC/PMV/ratio values`,
      'If an upstream calculation produces NaN/Infinity (e.g. invalid input or zero denominator), raw "NaN" text can appear in metric cards or HTML/DOCX reports.'
    );
  }

  /* ---- 6D. Memory Leaks, rAF Loops & Blob URL Lifecycle Audit ---- */
  const appSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/app.js'), 'utf8');
  const interSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/ui/interaction.js'), 'utf8');
  const ovlSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/render/overlayRenderer.js'), 'utf8');

  // Check 1: Duplicate ResizeObserver on #chartWrap in BOTH app.js and interaction.js
  const appHasRO = /new\s+ResizeObserver\s*\(/.test(appSrc);
  const interHasRO = /new\s+ResizeObserver\s*\(/.test(interSrc);
  if (appHasRO && interHasRO) {
    addFinding(
      'HIGH',
      'Performance / Lifecycle',
      'src/app.js:639-647 & src/ui/interaction.js:2312-2316',
      'Duplicate ResizeObserver + dual rAF schedulers on #chartWrap (and app.js ResizeObserver is never disconnected)',
      'Every window/splitter resize triggers TWO full BaseRenderer + OverlayRenderer redraws per frame! Consolidate rendering ownership to app.js scheduleRender() or pass scheduleRender into interaction.js.'
    );
  }

  // Check 2: Double overlay render on every pointer move via emitOverlayDirty()
  if (/store\.emit\('overlay-dirty'/.test(interSrc) && /scheduleOverlayRender\(\)/.test(interSrc)) {
    const emitBlock = interSrc.match(/function\s+emitOverlayDirty[\s\S]{0,260}\}/);
    if (emitBlock && emitBlock[0].includes("store.emit('overlay-dirty'") && emitBlock[0].includes('scheduleOverlayRender()')) {
      addFinding(
        'HIGH',
        'Performance',
        'src/ui/interaction.js:228-233 & src/app.js:606',
        'emitOverlayDirty() emits "overlay-dirty" (handled by app.js rAF) AND directly calls scheduleOverlayRender() (second rAF)',
        'Causes OverlayRenderer.render() to execute TWICE per frame on every mousemove, hover crosshair update, point drag, and zoom/pan step.'
      );
    }
  }

  // Check 3: Synchronous URL.revokeObjectURL immediately after a.click() in app.js fallback
  if (/a\.click\(\);\s*\n\s*URL\.revokeObjectURL\(a\.href\);/.test(appSrc)) {
    addFinding(
      'LOW',
      'Resource Lifecycle',
      'src/app.js:381-384',
      'Fallback JSON save revokes ObjectURL synchronously right after a.click() (exporter.js:90 properly defers revoke by 5000ms)',
      'In Safari/Firefox fallback path, immediate revocation can cancel the download before the blob stream opens.'
    );
  }

  // Check 4: Verify OverlayRenderer rAF loop is properly bounded & cancellable
  const ovlCancelsRaf = /cancelAnimationFrame\(this\._rafId\)/.test(ovlSrc);
  const ovlPausesHidden = /visibilitychange|document\.hidden/.test(ovlSrc);
  assert.ok(ovlCancelsRaf, 'OverlayRenderer must cancel its rAF loop on stop/destroy');
  if (!ovlPausesHidden) {
    addFinding(
      'LOW',
      'Power / Animation',
      'src/render/overlayRenderer.js:511-542',
      'Flow-animation rAF loop does not pause on document.visibilitychange (hidden tab)',
      'Cleanly cancels when flowAnim is toggled off or destroy() is called (no leak), but pausing on document.hidden saves background CPU/battery.'
    );
  }

  // Check 5: Verify every URL.createObjectURL has a matching URL.revokeObjectURL in the same file
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const creates = (content.match(/URL\.createObjectURL\(/g) || []).length;
    const revokes = (content.match(/URL\.revokeObjectURL\(/g) || []).length;
    if (creates > revokes) {
      addFinding(
        'HIGH',
        'Memory Leak',
        path.relative(ROOT_DIR, file),
        `Found ${creates} URL.createObjectURL() call(s) but only ${revokes} URL.revokeObjectURL() call(s)`,
        'Unrevoked Blob URLs retain backing binary memory until document unload.'
      );
    }
  }

  console.log(`  Checked ${srcFiles.length} JS modules + index.template.html (${templateLines.length} lines).`);
  console.log(`  Wrong specific-volume 35.314 factor hits: ${wrongVolFactorHits}`);
  console.log(`  Total static/UX/precision findings identified: ${auditFindings.length}`);

  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  auditFindings.sort((a, b) => order[a.severity] - order[b.severity]);
  for (const f of auditFindings) {
    console.log(`  [${f.severity}] (${f.category}) ${f.location}`);
    console.log(`      Issue : ${f.summary}`);
    console.log(`      Impact: ${f.impact}`);
  }
}

/* ==========================================================================
   Main Runner
   ========================================================================== */
function main() {
  const suiteStart = performance.now();
  console.log('============================================================================');
  console.log('PsychroChart Ultra 3.0 — Performance, Render Precision & UX Benchmark Suite');
  console.log(`Node ${process.version} | Platform ${process.platform}/${process.arch}`);
  console.log('============================================================================');

  runPhysicsBenchmark();
  runComfortBenchmark();
  runWeatherBenchmark();
  runExporterBenchmark();
  runBaseRendererBenchmark();
  runStaticAndUnitAudit();

  const totalSuiteMs = performance.now() - suiteStart;
  const failedBudgets = resultsSummary.filter(r => !r.passed);

  console.log('\n============================================================================');
  console.log(`BENCHMARK SUMMARY: ${resultsSummary.length - failedBudgets.length}/${resultsSummary.length} performance budgets PASSED in ${totalSuiteMs.toFixed(1)} ms`);
  console.log(`STATIC AUDIT FINDINGS: ${auditFindings.length} (${auditFindings.filter(f => f.severity === 'CRITICAL').length} CRITICAL, ${auditFindings.filter(f => f.severity === 'HIGH').length} HIGH, ${auditFindings.filter(f => f.severity === 'MEDIUM').length} MEDIUM, ${auditFindings.filter(f => f.severity === 'LOW').length} LOW)`);
  console.log('============================================================================');

  if (failedBudgets.length > 0) {
    process.exitCode = 1;
  }
}

main();
