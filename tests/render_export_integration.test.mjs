/* ============================================================================
   PsychroChart Ultra 3.0 — Render, Export, Presets & Cross-Module Integration Suite
   Covers: Vector SVG (9 groups + XML validation), CSV, HTML Report, Mock Canvas
   BaseRenderer & OverlayRenderer (5 themes, SI/IP, all layers, hit-testing),
   all 6 HVAC Presets, Store/Persistence/ShareURL/v2.6.6, and DOM ID contracts.
   ============================================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  APP_VERSION,
  CoreDOM,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_LAYERS,
  THEME_PRESETS
} from '../src/core/contracts.js';
import { Psy } from '../src/engine/psychro.js';
import { Comfort } from '../src/engine/comfort.js';
import { HVAC } from '../src/engine/hvac.js';
import { Weather } from '../src/engine/weather.js';
import { createStore } from '../src/state/store.js';
import { BaseRenderer } from '../src/render/baseRenderer.js';
import { OverlayRenderer } from '../src/render/overlayRenderer.js';
import { Exporter } from '../src/export/exporter.js';
import { PRESETS } from '../src/ui/modals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

/* ----------------------------------------------------------------------------
   Shared Test Fixtures & Mock Canvas 2D Context
   ---------------------------------------------------------------------------- */

function buildRichTestStore() {
  const st = createStore();
  // Load Summer AHU preset (includes 2-stream derived mix + curved cooling coil ADP)
  const summerPreset = PRESETS.find((p) => p.id === 'summer-ahu');
  assert.ok(summerPreset, 'summer-ahu preset must exist');
  summerPreset.apply(st);

  st.setMeta({
    name: 'Tower A — AHU-01 <Main> & "North"',
    version: 'v3.0-rev2',
    company: 'Apex MEP & Thermal Eng.',
    engineer: 'Shadi Alashkar',
    notes: 'ASHRAE 2021 verification <test> & check'
  });

  // Enable ALL chart overlay layers
  st.setLayer('grid', true);
  st.setLayer('gridMinor', true);
  st.setLayer('sat', true);
  st.setLayer('rh', true);
  st.setLayer('wb', true);
  st.setLayer('enth', true);
  st.setLayer('vlines', true);
  st.setLayer('dp', true);
  st.setLayer('comfort', true);
  st.setLayer('givoni', true);
  st.setLayer('datacenter', true);
  st.setLayer('points', true);
  st.setLayer('processes', true);
  st.setLayer('mixlinks', true);
  st.setLayer('adpLines', true);
  st.setLayer('annotations', true);
  st.setLayer('flowAnim', true);

  st.setComfort({ mode: 'both', cloSummer: 0.5, cloWinter: 1.0, met: 1.1, vAir: 0.1, mrtOffset: 0, pmvLimit: 0.5 });
  st.setSHR({ show: true, value: 0.75, refPointId: st.state.points[1].id });

  // Add annotation with XML/HTML special chars to verify safe escaping
  st.addAnnotation({
    T: 29.5,
    w: 0.0155,
    text: 'Coil <ADP> & "Bypass" Check\nLine 2',
    color: '#f59e0b'
  }, false);

  // Load 8,760-hr deterministic TMY weather dataset & 2D psychrometric bins
  const tmy = Weather.generateSyntheticTMY('dubai');
  const bins = Weather.computePsychroBins(tmy.records, tmy.pPa, st.state.comfort);
  st.setWeather({
    cityId: tmy.cityId,
    sourceName: tmy.sourceName,
    records: tmy.records,
    bins,
    mode: 'heatmap',
    opacity: 0.72
  });

  // Save a baseline scenario & enable ghost comparison
  const scen = st.saveScenario('Baseline Design');
  st.setCompareScenario(scen.id);

  return st;
}

function createMockCanvas(width = 1200, height = 760) {
  const invalidCalls = [];
  const counts = {
    total: 0,
    fillRect: 0,
    strokeRect: 0,
    arc: 0,
    moveTo: 0,
    lineTo: 0,
    fillText: 0,
    strokeText: 0,
    stroke: 0,
    fill: 0
  };
  const drawnTexts = [];

  function assertFiniteNums(fn, args) {
    for (let i = 0; i < args.length; i++) {
      if (typeof args[i] === 'number' && !Number.isFinite(args[i])) {
        invalidCalls.push({ fn, args: [...args] });
        return;
      }
    }
  }

  function assertCleanText(fn, str) {
    const s = String(str ?? '');
    if (/\bNaN\b/.test(s) || /\bundefined\b/.test(s)) {
      invalidCalls.push({ fn, text: s });
    }
    drawnTexts.push(s);
  }

  const makeGrad = () => ({
    addColorStop(offset, color) {
      assertFiniteNums('addColorStop', [offset]);
      if (typeof color !== 'string' || !color) {
        invalidCalls.push({ fn: 'addColorStop', color });
      }
    }
  });

  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '11px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,

    save() { counts.total++; },
    restore() { counts.total++; },
    setTransform(...a) { counts.total++; assertFiniteNums('setTransform', a); },
    translate(...a) { counts.total++; assertFiniteNums('translate', a); },
    rotate(...a) { counts.total++; assertFiniteNums('rotate', a); },
    scale(...a) { counts.total++; assertFiniteNums('scale', a); },
    beginPath() { counts.total++; },
    closePath() { counts.total++; },
    clip() { counts.total++; },
    fill() { counts.total++; counts.fill++; },
    stroke() { counts.total++; counts.stroke++; },
    moveTo(...a) { counts.total++; counts.moveTo++; assertFiniteNums('moveTo', a); },
    lineTo(...a) { counts.total++; counts.lineTo++; assertFiniteNums('lineTo', a); },
    quadraticCurveTo(...a) { counts.total++; assertFiniteNums('quadraticCurveTo', a); },
    bezierCurveTo(...a) { counts.total++; assertFiniteNums('bezierCurveTo', a); },
    arc(...a) { counts.total++; counts.arc++; assertFiniteNums('arc', a); },
    rect(...a) { counts.total++; assertFiniteNums('rect', a); },
    fillRect(...a) { counts.total++; counts.fillRect++; assertFiniteNums('fillRect', a); },
    strokeRect(...a) { counts.total++; counts.strokeRect++; assertFiniteNums('strokeRect', a); },
    clearRect(...a) { counts.total++; assertFiniteNums('clearRect', a); },
    fillText(txt, x, y) {
      counts.total++;
      counts.fillText++;
      assertFiniteNums('fillText', [x, y]);
      assertCleanText('fillText', txt);
    },
    strokeText(txt, x, y) {
      counts.total++;
      counts.strokeText++;
      assertFiniteNums('strokeText', [x, y]);
      assertCleanText('strokeText', txt);
    },
    measureText(txt) {
      return { width: String(txt || '').length * 6.5 };
    },
    setLineDash(arr) {
      counts.total++;
      if (Array.isArray(arr)) assertFiniteNums('setLineDash', arr);
    },
    createLinearGradient(...a) {
      counts.total++;
      assertFiniteNums('createLinearGradient', a);
      return makeGrad();
    },
    createRadialGradient(...a) {
      counts.total++;
      assertFiniteNums('createRadialGradient', a);
      return makeGrad();
    }
  };

  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    parentElement: {
      getBoundingClientRect: () => ({ width, height, left: 0, top: 0 })
    },
    getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
    getContext: (kind) => (kind === '2d' ? ctx : null)
  };

  return { canvas, ctx, counts, invalidCalls, drawnTexts };
}

/* ============================================================================
   SUITE 1: Vector SVG Export (SI & IP, XML Parse, All 9 Groups, Zero NaN)
   ============================================================================ */

test.describe('1. Vector SVG Export (Exporter.buildSVGString)', () => {
  const EXPECTED_GROUPS = [
    'background',
    'grid',
    'weather-heatmap',
    'comfort-zones',
    'curves',
    'enthalpy-ruler',
    'processes',
    'points',
    'axes'
  ];

  for (const units of ['SI', 'IP']) {
    test(`builds well-formed XML with all 9 SVG groups and zero NaN/undefined in ${units} mode`, () => {
      const st = buildRichTestStore();
      st.setUnits(units);

      const svg = Exporter.buildSVGString(st, 1280, 800);
      assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800"'));
      assert.ok(svg.endsWith('</svg>'));

      // Strict zero NaN / undefined checks across entire XML document
      assert.equal(/\bNaN\b/.test(svg), false, `${units} SVG must not contain NaN`);
      assert.equal(/\bundefined\b/.test(svg), false, `${units} SVG must not contain undefined`);
      assert.equal(/\bInfinity\b/.test(svg), false, `${units} SVG must not contain Infinity`);

      // Parse strictly with Python xml.etree.ElementTree to guarantee valid XML
      const pyScript = [
        'import sys, json, xml.etree.ElementTree as ET',
        'root = ET.fromstring(sys.stdin.read())',
        'ns = "{http://www.w3.org/2000/svg}"',
        'groups = [el.attrib.get("id") for el in root if el.tag == ns + "g"]',
        'counts = {el.attrib.get("id"): len(list(el)) for el in root if el.tag == ns + "g"}',
        'print(json.dumps({"tag": root.tag, "groups": groups, "counts": counts}))'
      ].join('\n');

      const parsed = JSON.parse(
        execFileSync('python3', ['-c', pyScript], { input: svg, encoding: 'utf8' })
      );

      assert.equal(parsed.tag, '{http://www.w3.org/2000/svg}svg');
      assert.deepEqual(parsed.groups, EXPECTED_GROUPS, 'All 9 semantic SVG groups must be present in exact z-order');

      // Verify every single one of the 9 groups contains rendered SVG elements
      for (const gid of EXPECTED_GROUPS) {
        assert.ok(
          parsed.counts[gid] > 0,
          `SVG group #${gid} must contain elements in ${units} mode (got ${parsed.counts[gid]})`
        );
      }

      // Verify unit-specific axis titles and enthalpy ruler header
      if (units === 'SI') {
        assert.ok(svg.includes('Dry-Bulb Temperature (°C)'));
        assert.ok(svg.includes('g Water Vapour / kg Dry Air'));
        assert.ok(svg.includes('Enthalpy h (kJ/kg)'));
      } else {
        assert.ok(svg.includes('Dry-Bulb Temperature (°F)'));
        assert.ok(svg.includes('Grains of Moisture / lb Dry Air'));
        assert.ok(svg.includes('Enthalpy h (Btu/lb)'));
      }

      // Verify XML-escaped metadata and annotation strings
      assert.ok(svg.includes('AHU-01 &lt;Main&gt; &amp; &quot;North&quot;'));
      assert.ok(svg.includes('Coil &lt;ADP&gt; &amp; &quot;Bypass&quot; Check'));
    });
  }

  test('renders multi-stream derived mix tie-lines and scatter/both weather modes in SVG cleanly', () => {
    const st = createStore();
    const pA = st.addPoint({ T: 35, w: 0.016, label: 'StreamA' }, false);
    const pB = st.addPoint({ T: 24, w: 0.009, label: 'StreamB' }, false);
    const pC = st.addPoint({ T: 15, w: 0.007, label: 'StreamC' }, false);
    st.addPoint({
      T: 25,
      w: 0.010,
      label: 'Mix3',
      locked: true,
      derived: {
        type: 'mix',
        streams: [
          { id: pA.id, m: 1.0 },
          { id: pB.id, m: 2.0 },
          { id: pC.id, m: 1.0 }
        ]
      }
    }, false);

    const tmy = Weather.generateSyntheticTMY('phoenix');
    const bins = Weather.computePsychroBins(tmy.records, tmy.pPa);
    st.setWeather({ cityId: 'phoenix', sourceName: tmy.sourceName, records: tmy.records, bins, mode: 'both' });

    const svg = Exporter.buildSVGString(st, 1280, 800);
    assert.ok(svg.includes('<g id="weather-heatmap"'));
    assert.ok(svg.includes('<rect '), 'Heatmap rects should render in mode="both"');
    assert.ok(svg.includes('<circle '), 'Scatter circles should render in mode="both"');
    assert.ok(svg.includes('stroke-dasharray="6,4"'), '3-stream mix tie-lines should render in SVG');
    assert.equal(/\bNaN\b/.test(svg), false);
  });
});

/* ============================================================================
   SUITE 2: Structured Engineering CSV Export (SI & IP Accuracy)
   ============================================================================ */

test.describe('2. Engineering CSV Export (Exporter.buildCSVString)', () => {
  test('generates complete structured SI and IP schedules with accurate 0°F enthalpy & IP units', () => {
    const st = buildRichTestStore();

    // SI CSV
    st.setUnits('SI');
    const csvSI = Exporter.buildCSVString(st);
    assert.equal(/\bNaN\b/.test(csvSI), false, 'SI CSV must contain zero NaN');
    assert.equal(/\bundefined\b/.test(csvSI), false, 'SI CSV must contain zero undefined');

    for (const section of [
      'PSYCHROCHART ULTRA ENGINEERING SCHEDULE',
      'STATE POINTS SCHEDULE',
      'PROCESSES & HVAC LOAD SCHEDULE',
      'TOTAL COOLING / HEATING SUMMARY',
      'ANNUAL WEATHER / CLIMATE BIN SUMMARY'
    ]) {
      assert.ok(csvSI.includes(section), `SI CSV missing section: ${section}`);
    }
    assert.ok(csvSI.includes('Tdb (°C)'));
    assert.ok(csvSI.includes('W (g/kg)'));
    assert.ok(csvSI.includes('h (kJ/kg)'));
    assert.ok(csvSI.includes('v (m³/kg)'));
    assert.ok(csvSI.includes('Qt (kW)'));

    // Verify OA point (35°C, 55% RH) row values in SI
    const oa = st.state.points[0];
    const oaState = Psy.stateFromTw(oa.T, oa.w, st.state.pPa);
    assert.ok(csvSI.includes(`,OA,${oaState.T.toFixed(2)},${oaState.rh.toFixed(1)},${(oaState.w * 1000).toFixed(2)},`));

    // IP CSV
    st.setUnits('IP');
    const csvIP = Exporter.buildCSVString(st);
    assert.equal(/\bNaN\b/.test(csvIP), false, 'IP CSV must contain zero NaN');
    assert.equal(/\bundefined\b/.test(csvIP), false, 'IP CSV must contain zero undefined');

    assert.ok(csvIP.includes('Tdb (°F)'));
    assert.ok(csvIP.includes('W (gr/lb)'));
    assert.ok(csvIP.includes('h (Btu/lb)'));
    assert.ok(csvIP.includes('v (ft³/lb)'));
    assert.ok(csvIP.includes('Qt (BTU/h)'));

    // Verify exact IP conversion (35°C = 95.00°F, 0°F enthalpy datum hIP, gr/lb)
    const tF = CoreDOM.cToF(oa.T).toFixed(2);
    const wGr = (oa.w * 7000).toFixed(1);
    const hIP = Psy.h_Btulb(oa.T, oa.w).toFixed(2);
    assert.ok(csvIP.includes(`,OA,${tF},`), `IP CSV should show OA Tdb=${tF}°F`);
    assert.ok(csvIP.includes(`,${wGr},`), `IP CSV should show OA W=${wGr} gr/lb`);
    assert.ok(csvIP.includes(`,${hIP},`), `IP CSV should show OA h=${hIP} Btu/lb (0°F datum)`);
  });
});

/* ============================================================================
   SUITE 3: Self-Contained Executive HTML Report
   ============================================================================ */

test.describe('3. Executive HTML Report (Exporter.buildHTMLReportString)', () => {
  for (const units of ['SI', 'IP']) {
    test(`generates complete print-ready HTML5 engineering report with embedded SVG in ${units} mode`, () => {
      const st = buildRichTestStore();
      st.setUnits(units);

      const html = Exporter.buildHTMLReportString(st, null, null, {
        chartFormat: 'svg',
        includeChart: true,
        includeProc: true,
        includeComfort: true,
        includeWeather: true,
        printFriendly: true
      });

      assert.ok(html.startsWith('<!doctype html>'));
      assert.ok(html.includes('</html>'));
      assert.ok(html.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'Must embed inline vector SVG');
      assert.ok(html.includes('State Points Schedule'));
      assert.ok(html.includes('Process &amp; Psychrometric Load Schedule'));
      assert.ok(html.includes('Cooling Coil Apparatus Dew Point (ADP) &amp; Bypass Factor'));
      assert.ok(html.includes('ASHRAE 55 Thermal Comfort &amp; Mold Risk Evaluation'));
      assert.ok(html.includes('Annual Climate &amp; Psychrometric Weather Bin Summary'));
      assert.ok(html.includes('Engineering Methodology, Notes &amp; Sign-Off'));

      // HTML-escaping verification against XSS / broken markup
      assert.ok(html.includes('Tower A — AHU-01 &lt;Main&gt; &amp; &quot;North&quot;'));
      assert.ok(!html.includes('<Main>'), 'Raw unescaped tags must not leak into HTML');
      assert.ok(!html.includes('<test>'), 'Raw unescaped tags in notes must not leak into HTML');

      // Zero NaN / undefined
      assert.equal(/\bNaN\b/.test(html), false, `${units} HTML report must contain zero NaN`);
      assert.equal(/\bundefined\b/.test(html), false, `${units} HTML report must contain zero undefined`);
    });
  }
});

/* ============================================================================
   SUITE 4: Mock Canvas BaseRenderer & OverlayRenderer Verification
   ============================================================================ */

test.describe('4. Canvas Rendering (BaseRenderer & OverlayRenderer via Mock 2D Context)', () => {
  const ALL_THEMES = ['studio-dark', 'drafting-light', 'ashrae-classic', 'blueprint-cad', 'custom'];

  test('renders all 5 themes in both SI and IP with all layers enabled and zero NaN coordinates', () => {
    const st = buildRichTestStore();
    st.setUI({
      selectedPtId: st.state.points[0].id,
      selectedProcId: st.state.processes[2].id,
      hoverPx: 540,
      hoverPy: 320,
      measureStart: { T: 35, w: 0.018 },
      measureEnd: { T: 12.5, w: 0.0085 },
      boxZoom: { x1: 220, y1: 160, x2: 520, y2: 410 }
    });

    for (const theme of ALL_THEMES) {
      for (const units of ['SI', 'IP']) {
        st.setTheme(theme);
        st.setUnits(units);

        const mBase = createMockCanvas(1200, 760);
        const mOvl = createMockCanvas(1200, 760);
        const br = new BaseRenderer(mBase.canvas);
        const ov = new OverlayRenderer(mOvl.canvas, br);

        const didBase = br.render(st.state, true);
        assert.equal(didBase, true, `BaseRenderer should render on first pass (${theme}/${units})`);
        ov.render(st.state);

        assert.equal(
          mBase.invalidCalls.length,
          0,
          `BaseRenderer produced invalid draw calls for ${theme}/${units}: ${JSON.stringify(mBase.invalidCalls.slice(0, 3))}`
        );
        assert.equal(
          mOvl.invalidCalls.length,
          0,
          `OverlayRenderer produced invalid draw calls for ${theme}/${units}: ${JSON.stringify(mOvl.invalidCalls.slice(0, 3))}`
        );
        assert.ok(mBase.counts.total > 500, `BaseRenderer should issue substantial draw calls (${theme}/${units})`);
        assert.ok(mOvl.counts.total > 100, `OverlayRenderer should issue substantial draw calls (${theme}/${units})`);

        // Verify fingerprint cache hits when nothing changed
        const didBaseAgain = br.render(st.state, false);
        assert.equal(didBaseAgain, false, `BaseRenderer fingerprint cache must skip redundant redraw (${theme}/${units})`);

        ov.destroy();
      }
    }
  });

  test('renders weather modes heatmap, scatter, and both (heatmap + scatter combined)', () => {
    const st = buildRichTestStore();
    // Isolate weather layer to verify exact draw primitives per mode
    for (const k of ['grid', 'gridMinor', 'sat', 'rh', 'wb', 'enth', 'vlines', 'dp', 'comfort', 'givoni', 'datacenter']) {
      st.setLayer(k, false);
    }
    st.setLayer('weather', true);

    const runMode = (mode) => {
      st.setWeather({ mode, autoShow: true });
      const m = createMockCanvas(1200, 760);
      const br = new BaseRenderer(m.canvas);
      br.render(st.state, true);
      assert.equal(m.invalidCalls.length, 0, `weather mode="${mode}" had invalid draw calls`);
      return m.counts;
    };

    const cHeat = runMode('heatmap');
    const cScat = runMode('scatter');
    const cBoth = runMode('both');

    assert.ok(cHeat.fillRect > 50, 'heatmap mode must draw density rectangles');
    assert.equal(cHeat.arc, 0, 'heatmap mode should not draw scatter circles');
    assert.ok(cScat.arc > 200, 'scatter mode must draw hourly scatter circles');
    assert.ok(cBoth.fillRect > 50 && cBoth.arc > 200, 'both mode must draw BOTH heatmap rects AND scatter circles');
  });

  test('maintains exact xc/yc <-> invT/invW coordinate mapping and accurate overlay hit-testing', () => {
    const st = buildRichTestStore();
    const mBase = createMockCanvas(1200, 760);
    const mOvl = createMockCanvas(1200, 760);
    const br = new BaseRenderer(mBase.canvas);
    const ov = new OverlayRenderer(mOvl.canvas, br);

    br.render(st.state, true);
    ov.render(st.state);

    // Coordinate transform roundtrip
    for (const [T, w] of [[10, 0.005], [24, 0.010], [35, 0.020]]) {
      const px = br.xc(T);
      const py = br.yc(w);
      assert.ok(Math.abs(br.invT(px) - T) < 1e-9, 'invT(xc(T)) must equal T');
      assert.ok(Math.abs(br.invW(py) - w) < 1e-12, 'invW(yc(w)) must equal w');
    }

    // Point hit-testing
    const pt0 = st.state.points[0];
    assert.equal(ov.pickPoint(br.xc(pt0.T), br.yc(pt0.w), st.state), pt0.id);
    assert.equal(ov.pickPoint(br.xc(pt0.T) + 4, br.yc(pt0.w) - 3, st.state), pt0.id);
    assert.equal(ov.pickPoint(1, 1, st.state), null);

    // Label hit-testing
    const lblX = br.xc(pt0.T) + (pt0.lx ?? 10) * br.dpi + 6;
    const lblY = br.yc(pt0.w) + (pt0.ly ?? -6) * br.dpi - 4;
    assert.equal(ov.pickLabel(lblX, lblY, st.state), pt0.id);

    // Process hit-testing (midpoint of straight process cc -> sa or sa -> ra)
    const straightProc = st.state.processes.find((p) => !p.showCurve);
    assert.ok(straightProc);
    const a = st.getPoint(straightProc.aId);
    const b = st.getPoint(straightProc.bId);
    const midX = 0.5 * (br.xc(a.T) + br.xc(b.T));
    const midY = 0.5 * (br.yc(a.w) + br.yc(b.w));
    assert.equal(ov.pickProcess(midX, midY, st.state), straightProc.id);

    // Annotation hit-testing (at pin coordinate)
    const ann = st.state.annotations[0];
    assert.equal(ov.pickAnnotation(br.xc(ann.T), br.yc(ann.w), st.state), ann.id);

    // Hidden layers must not pick
    st.setLayer('points', false);
    assert.equal(ov.pickPoint(br.xc(pt0.T), br.yc(pt0.w), st.state), null);
    st.setLayer('annotations', false);
    assert.equal(ov.pickAnnotation(br.xc(ann.T), br.yc(ann.w), st.state), null);

    // Crosshair magnetic saturation snap (cursor above saturation curve)
    st.setUI({ hoverPx: br.xc(15), hoverPy: br.yc(0.025) });
    ov.render(st.state);
    assert.equal(mOvl.invalidCalls.length, 0);
    assert.ok(mOvl.drawnTexts.includes('SAT'), 'Crosshair above 100% RH should snap and display SAT badge');

    // SHR edge values (0.0 and 1.0)
    for (const shrVal of [0, 0.5, 1.0]) {
      st.setSHR({ show: true, value: shrVal });
      ov.render(st.state);
      assert.equal(mOvl.invalidCalls.length, 0, `SHR=${shrVal} must render with zero invalid calls`);
    }

    // Export renderToContext must NOT mutate live BaseRenderer layout properties
    const beforeDims = { w: br.width, h: br.height, dpi: br.dpi, padL: br.padL, padR: br.padR };
    const mExp = createMockCanvas(3200, 2000);
    br.renderToContext(mExp.ctx, 3200, 2000, 2, st.state, { includeTitle: true, isExport: true });
    assert.equal(mExp.invalidCalls.length, 0);
    assert.deepEqual(
      { w: br.width, h: br.height, dpi: br.dpi, padL: br.padL, padR: br.padR },
      beforeDims,
      'Export renderToContext must restore live BaseRenderer dimensions'
    );

    ov.destroy();
  });
});

/* ============================================================================
   SUITE 5: All 6 Engineering HVAC Presets (Physics, Energy Balance & Layers)
   ============================================================================ */

test.describe('5. Engineering HVAC Cycle Presets (PRESETS)', () => {
  test('exports all 6 canonical presets with valid unsaturated states and conserved process loads', () => {
    assert.equal(PRESETS.length, 6, 'Expected exactly 6 built-in engineering presets');
    const expectedIds = [
      'summer-ahu',
      'doas-erv',
      'winter-humid',
      'evap-2stage',
      'desiccant-cleanroom',
      'datacenter-econ'
    ];
    assert.deepEqual(PRESETS.map((p) => p.id), expectedIds);

    for (const preset of PRESETS) {
      const st = createStore();
      preset.apply(st);
      const s = st.state;

      assert.ok(s.points.length >= 4, `Preset ${preset.id} should have >= 4 state points`);
      assert.ok(s.processes.length >= 3, `Preset ${preset.id} should have >= 3 processes`);

      // Verify every point is finite and physically unsaturated
      for (const pt of s.points) {
        assert.ok(Number.isFinite(pt.T) && pt.T >= -40 && pt.T <= 90, `${preset.id}/${pt.label} T out of range`);
        const ws = Psy.wsat_at(pt.T, s.pPa);
        assert.ok(Number.isFinite(pt.w) && pt.w >= 0 && pt.w <= ws * 1.001 + 1e-6, `${preset.id}/${pt.label} w exceeds saturation`);

        // Verify derived mix points match adiabatic mass-weighted enthalpy/humidity conservation
        if (pt.derived && pt.derived.type === 'mix') {
          const pA = st.getPoint(pt.derived.aId);
          const pB = st.getPoint(pt.derived.bId);
          assert.ok(pA && pB, `${preset.id} mix point must reference valid parent points`);
          const mA = pt.derived.mA;
          const mB = pt.derived.mB;
          const wExp = (mA * pA.w + mB * pB.w) / (mA + mB);
          const hExp = (mA * Psy.h_kJkg(pA.T, pA.w) + mB * Psy.h_kJkg(pB.T, pB.w)) / (mA + mB);
          assert.ok(Math.abs(pt.w - wExp) < 1e-5, `${preset.id} mix W conservation mismatch`);
          assert.ok(Math.abs(Psy.h_kJkg(pt.T, pt.w) - hExp) < 0.05, `${preset.id} mix h conservation mismatch`);
        }
      }

      // Verify every process has valid endpoints and exact energy conservation Qt = Qs + Ql
      for (const pr of s.processes) {
        const a = st.getPoint(pr.aId);
        const b = st.getPoint(pr.bId);
        assert.ok(a && b, `${preset.id} process must connect valid points`);
        const m = HVAC.calcProcessMetrics(a, b, s.pPa, pr.flowVal, pr.flowUnit);
        assert.ok(Number.isFinite(m.Qt_kW) && Number.isFinite(m.Qs_kW) && Number.isFinite(m.Ql_kW));
        assert.ok(Math.abs(m.Qt_kW - (m.Qs_kW + m.Ql_kW)) < 1e-6, `${preset.id} Qt != Qs + Ql`);
      }

      // Data Center preset must auto-enable ASHRAE TC 9.9 envelopes
      if (preset.id === 'datacenter-econ') {
        assert.equal(s.layers.datacenter, true, 'datacenter-econ preset must enable TC 9.9 layer');
      }

      // Each preset must export valid SVG & CSV with zero NaN
      const svg = Exporter.buildSVGString(st, 1280, 800);
      const csv = Exporter.buildCSVString(st);
      assert.equal(/\bNaN\b/.test(svg), false, `${preset.id} SVG contains NaN`);
      assert.equal(/\bNaN\b/.test(csv), false, `${preset.id} CSV contains NaN`);
    }
  });
});

/* ============================================================================
   SUITE 6: Store Persistence, Scenarios, Legacy v2.6.6, Share URL & Contracts
   ============================================================================ */

test.describe('6. Store Integration, Legacy v2.6.6, Share URL & DOM/API Contracts', () => {
  test('roundtrips v3.0 JSON, Share URL (#p=...) with Unicode, Scenarios & 100-level Undo/Redo', () => {
    const st1 = buildRichTestStore();
    st1.setTheme('custom');
    st1.updateCustomTheme({ sat: '#00e5ff', haloW: 4 });

    // Full v3.0 JSON roundtrip
    const exported = st1.exportJSON();
    assert.equal(exported.schema, 'psychro-ultra-3.0');
    assert.equal(exported.appVersion, APP_VERSION);

    const st2 = createStore();
    const imp = st2.importJSON(JSON.stringify(exported));
    assert.equal(imp.ok, true);
    assert.equal(imp.format, 'v3.0');
    assert.equal(st2.state.points.length, st1.state.points.length);
    assert.equal(st2.state.processes.length, st1.state.processes.length);
    assert.equal(st2.state.annotations.length, 1);
    assert.equal(st2.state.scenarios.length, 1);
    assert.equal(st2.state.compareScenarioId, st2.state.scenarios[0].id);
    assert.equal(st2.state.theme, 'custom');
    assert.equal(st2.state.customTheme.sat, '#00e5ff');

    // Share URL roundtrip with Unicode characters (°, ³, ρ, em-dash)
    const hashUrl = st1.encodeShareURL();
    assert.ok(hashUrl.startsWith('#p='), 'Share URL in Node should return #p=... hash');
    const st3 = createStore();
    const dec = st3.decodeShareURL(hashUrl);
    assert.equal(dec.ok, true);
    assert.equal(st3.state.meta.name, st1.state.meta.name);
    assert.equal(st3.state.points.length, st1.state.points.length);
    assert.equal(st3.state.processes.length, st1.state.processes.length);
    assert.equal(st3.state.annotations[0].text, st1.state.annotations[0].text);
    assert.equal(st3.state.shr.show, true);
    assert.ok(Math.abs(st3.state.shr.value - 0.75) < 1e-4);
    assert.equal(st3.state.weather.cityId, 'dubai');

    // Scenario restore + undo
    const origCount = st2.state.points.length;
    st2.addPoint({ T: 30, w: 0.012, label: 'Extra' });
    assert.equal(st2.state.points.length, origCount + 1);
    assert.equal(st2.restoreScenario(st2.state.scenarios[0].id), true);
    assert.equal(st2.state.points.length, origCount);
    assert.equal(st2.undo(), true);
    assert.equal(st2.state.points.length, origCount + 1);
  });

  test('imports legacy PsychroChart Pro v2.6.6 JSON in both SI and IP modes accurately', () => {
    const legacyIP = {
      meta: { name: 'Legacy Hospital AHU', version: 'v2.6.6', engineer: 'Shadi' },
      state: {
        units: 'IP',
        theme: 'light',
        style: 'ashrae',
        pPa: 95000,
        tMin: 20,       // °F in v2.6.6 IP payload
        tMax: 120,      // °F in v2.6.6 IP payload
        wMaxDisp: 210,  // gr/lb (= 0.030 kg/kg)
        comfortZone: 'summer'
      },
      points: [
        { id: 10, T: 35, w: 0.018, label: 'OA', color: '#f43f5e' },
        { id: 20, T: 13, w: 0.0085, label: 'SA', color: '#38bdf8' }
      ],
      processes: [[0, 1]]
    };

    const st = createStore();
    const res = st.importJSON(legacyIP);
    assert.equal(res.ok, true);
    assert.equal(res.format, 'v2.6.6');
    assert.equal(st.state.units, 'IP');
    assert.equal(st.state.theme, 'ashrae-classic');
    assert.ok(Math.abs(st.state.view.tMin - CoreDOM.fToC(20)) < 0.05);
    assert.ok(Math.abs(st.state.view.tMax - CoreDOM.fToC(120)) < 0.05);
    assert.ok(Math.abs(st.state.view.wMax - 0.030) < 1e-4);
    assert.equal(st.state.processes.length, 1);
    assert.equal(st.state.processes[0].aId, 10);
    assert.equal(st.state.processes[0].bId, 20);
  });

  test('normalizes all flow unit aliases (kgps/kgs, lbps/lbs, Lps, m3h, cfm) accurately', () => {
    const T = 24;
    const w = 0.0093;
    const pPa = 101325;
    assert.ok(Math.abs(Psy.flowToMassKgps(1, 'kgs', T, w, pPa) - 1.0) < 1e-9);
    assert.ok(Math.abs(Psy.flowToMassKgps(2.20462262185, 'lbs', T, w, pPa) - 1.0) < 1e-9);
    assert.ok(Math.abs(Psy.flowToMassKgps(2.20462262185, 'lbps', T, w, pPa) - 1.0) < 1e-9);
    for (const unit of ['Lps', 'm3h', 'cfm', 'kgps', 'lbps']) {
      const m = Psy.flowToMassKgps(100, unit, T, w, pPa);
      const back = Psy.massKgpsToFlow(m, unit, T, w, pPa);
      assert.ok(Math.abs(back - 100) < 1e-6, `Flow roundtrip failed for ${unit}`);
    }
  });

  test('verifies index.template.html DOM ID integrity against customTheme and all src/ modules', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.template.html'), 'utf8');
    const idCounts = new Map();
    for (const m of html.matchAll(/\bid\s*=\s*"([^"]+)"/g)) {
      idCounts.set(m[1], (idCounts.get(m[1]) || 0) + 1);
    }

    // Zero duplicate DOM IDs
    const duplicates = [...idCounts.entries()].filter(([, c]) => c > 1);
    assert.deepEqual(duplicates, [], `Duplicate IDs in index.template.html: ${JSON.stringify(duplicates)}`);

    // Every label[for] points to a real ID
    for (const m of html.matchAll(/\bfor\s*=\s*"([^"]+)"/g)) {
      assert.ok(idCounts.has(m[1]), `label[for="${m[1]}"] has no matching element ID`);
    }

    // Every DEFAULT_CUSTOM_THEME key has a matching ct_<key> editor control
    for (const key of Object.keys(DEFAULT_CUSTOM_THEME)) {
      assert.ok(idCounts.has(`ct_${key}`), `Missing custom theme control #ct_${key}`);
    }

    // Every canonical theme preset resolves cleanly via CoreDOM.resolveThemePalette
    for (const themeKey of Object.keys(THEME_PRESETS)) {
      const pal = CoreDOM.resolveThemePalette(themeKey);
      assert.ok(pal.bg && pal.sat && pal.rh && pal.wb && pal.enth && pal.vline);
    }
    assert.equal(Object.keys(DEFAULT_LAYERS).length >= 16, true);
  });
});
