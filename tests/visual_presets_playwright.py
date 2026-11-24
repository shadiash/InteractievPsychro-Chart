#!/usr/bin/env python3
"""
PsychroChart Ultra 3.0 — Famous Visualization Presets, Axis/Trend Controls &
WCAG 2.1 AA Chrome Certification Suite
============================================================================
Verifies against the compiled single-file `index.html` in real Google Chrome
(`/usr/bin/google-chrome`) at 1440x900 (2x HiDPI):

  1. Zero console.error & zero uncaught pageerror throughout the entire run
  2. All 9 Famous Chart Visualization Presets:
     - `data-theme` sync
     - `#topBar` zero horizontal overflow (`scrollWidth <= clientWidth`)
     - Exact sync of all 11 Axis Style & Trend Style DOM controls
     - Distinct rendered canvas pixels across all 9 presets
     - `Exporter.buildSVGString(store)` valid well-formed XML (browser DOMParser
       + Python ElementTree), zero `NaN`/`undefined`, and `stroke-dasharray="7 3 1.5 3"`
       present on `print-bw` & `carrier-classic`
  3. WCAG 2.1 AA contrast (>= 4.5:1) on all 5 NEW themes (`carrier-classic`,
     `trane-hvac`, `cibse-metric`, `mollier-din`, `print-bw`) for:
     `.btn.accent`, `.btn.chip`, `.btn.danger`, `.panelTabs button.active`,
     `--dim` (on `--panel` & `--panel2`), `#hud .hud-val`, and `.badge.*`
  4. Interactive Axis Style & Process Trend Style live overrides — verifies
     store sync + live canvas pixel re-render on every single control change
  5. Custom Theme Studio `#tePresetBar` (9 preset chips), live Carrier Classic
     seed (`#ct_sat`, `#ct_enth`, etc.), and clean full revert on Close
     (`theme`, `customTheme`, `axisStyle`, `trendStyle`)
  6. Command Palette (`Ctrl+K`) discovery for:
     "carrier", "trane", "cibse", "mollier", "print", "pv scale", "legs"
  7. Captures 6 iconic preset screenshots at 1440x900 for visual sign-off
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import traceback
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List

from playwright.sync_api import ConsoleMessage, Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = REPO_ROOT / "index.html"
ARTIFACT_DIR = Path(
    os.environ.get(
        "PSYCHRO_SHOT_DIR",
        "/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/c1768639-9edd-48d4-a64a-9cd2ad2795a7",
    )
)
CHROME_BIN = "/usr/bin/google-chrome"

# Canonical expected axisStyle and trendStyle for all 9 presets (from src/core/contracts.js)
EXPECTED_PRESETS: Dict[str, Dict[str, Any]] = {
    "ashrae-classic": {
        "axisStyle": {
            "frame": "ashrae-open",
            "tickDir": "out",
            "yAxisSide": "right",
            "showSubTicks": True,
            "showDualPvScale": True,
            "enthalpyRulerStyle": "ashrae-rail",
        },
        "trendStyle": {
            "arrowStyle": "solid-triangle",
            "lineWeight": "standard",
            "pointMarker": "solid-dot",
            "badgeStyle": "pill",
            "showDecompLegs": False,
        },
        "expectDashDot": False,
        "shot": "preset_01_ashrae_handbook.png",
    },
    "carrier-classic": {
        "axisStyle": {
            "frame": "ashrae-open",
            "tickDir": "cross",
            "yAxisSide": "right",
            "showSubTicks": True,
            "showDualPvScale": True,
            "enthalpyRulerStyle": "carrier-dual",
        },
        "trendStyle": {
            "arrowStyle": "solid-triangle",
            "lineWeight": "bold",
            "pointMarker": "crosshair-circle",
            "badgeStyle": "detailed",
            "showDecompLegs": True,
        },
        "expectDashDot": True,
        "shot": "preset_02_carrier_classic.png",
    },
    "trane-hvac": {
        "axisStyle": {
            "frame": "full-box",
            "tickDir": "out",
            "yAxisSide": "right",
            "showSubTicks": True,
            "showDualPvScale": True,
            "enthalpyRulerStyle": "ashrae-rail",
        },
        "trendStyle": {
            "arrowStyle": "cad-chevron",
            "lineWeight": "bold",
            "pointMarker": "precision-ring",
            "badgeStyle": "detailed",
            "showDecompLegs": False,
        },
        "expectDashDot": False,
        "shot": "preset_03_trane_hvac.png",
    },
    "cibse-metric": {
        "axisStyle": {
            "frame": "full-box",
            "tickDir": "in",
            "yAxisSide": "right",
            "showSubTicks": True,
            "showDualPvScale": True,
            "enthalpyRulerStyle": "ashrae-rail",
        },
        "trendStyle": {
            "arrowStyle": "open-vector",
            "lineWeight": "standard",
            "pointMarker": "diamond",
            "badgeStyle": "pill",
            "showDecompLegs": False,
        },
        "expectDashDot": True,
        "shot": "preset_04_cibse_metric.png",
    },
    "mollier-din": {
        "axisStyle": {
            "frame": "cad-ticks",
            "tickDir": "in",
            "yAxisSide": "both",
            "showSubTicks": True,
            "showDualPvScale": True,
            "enthalpyRulerStyle": "ashrae-rail",
        },
        "trendStyle": {
            "arrowStyle": "open-vector",
            "lineWeight": "fine",
            "pointMarker": "crosshair-circle",
            "badgeStyle": "inline-minimal",
            "showDecompLegs": True,
        },
        "expectDashDot": True,
        "shot": "preset_05_mollier_din.png",
    },
    "print-bw": {
        "axisStyle": {
            "frame": "full-box",
            "tickDir": "in",
            "yAxisSide": "both",
            "showSubTicks": True,
            "showDualPvScale": False,
            "enthalpyRulerStyle": "ashrae-rail",
        },
        "trendStyle": {
            "arrowStyle": "solid-triangle",
            "lineWeight": "standard",
            "pointMarker": "solid-dot",
            "badgeStyle": "inline-minimal",
            "showDecompLegs": True,
        },
        "expectDashDot": True,
        "shot": "preset_06_print_bw.png",
    },
    "studio-dark": {
        "axisStyle": {
            "frame": "full-box",
            "tickDir": "out",
            "yAxisSide": "both",
            "showSubTicks": True,
            "showDualPvScale": False,
            "enthalpyRulerStyle": "ashrae-rail",
        },
        "trendStyle": {
            "arrowStyle": "cad-chevron",
            "lineWeight": "standard",
            "pointMarker": "precision-ring",
            "badgeStyle": "detailed",
            "showDecompLegs": False,
        },
        "expectDashDot": False,
        "shot": None,
    },
    "drafting-light": {
        "axisStyle": {
            "frame": "full-box",
            "tickDir": "out",
            "yAxisSide": "both",
            "showSubTicks": True,
            "showDualPvScale": False,
            "enthalpyRulerStyle": "ashrae-rail",
        },
        "trendStyle": {
            "arrowStyle": "cad-chevron",
            "lineWeight": "standard",
            "pointMarker": "precision-ring",
            "badgeStyle": "detailed",
            "showDecompLegs": False,
        },
        "expectDashDot": False,
        "shot": None,
    },
    "blueprint-cad": {
        "axisStyle": {
            "frame": "cad-ticks",
            "tickDir": "cross",
            "yAxisSide": "both",
            "showSubTicks": True,
            "showDualPvScale": True,
            "enthalpyRulerStyle": "carrier-dual",
        },
        "trendStyle": {
            "arrowStyle": "open-vector",
            "lineWeight": "standard",
            "pointMarker": "crosshair-circle",
            "badgeStyle": "detailed",
            "showDecompLegs": True,
        },
        "expectDashDot": False,
        "shot": None,
    },
}

NEW_THEMES_WCAG = [
    "carrier-classic",
    "trane-hvac",
    "cibse-metric",
    "mollier-din",
    "print-bw",
]


class CertRunner:
    def __init__(self) -> None:
        self.results: List[Dict[str, Any]] = []
        self.console_errors: List[Dict[str, Any]] = []
        self.page_errors: List[Dict[str, Any]] = []
        self.current_section: str = "init"

    def section(self, name: str) -> None:
        self.current_section = name
        print(f"\n=== [{name}] ===")

    def check(self, name: str, condition: bool, detail: str = "") -> bool:
        ok = bool(condition)
        self.results.append(
            {
                "section": self.current_section,
                "name": name,
                "passed": ok,
                "detail": detail,
            }
        )
        tag = "  [PASS]" if ok else "  [FAIL]"
        msg = f"{tag} {name}"
        if detail:
            msg += f" — {detail}"
        print(msg)
        return ok

    def attach(self, page: Page) -> None:
        def on_console(msg: ConsoleMessage) -> None:
            if msg.type == "error":
                entry = {
                    "section": self.current_section,
                    "text": msg.text,
                    "location": msg.location,
                }
                self.console_errors.append(entry)
                print(f"  [CONSOLE.ERROR @ {self.current_section}] {msg.text}")

        def on_pageerror(err: Exception) -> None:
            entry = {"section": self.current_section, "error": str(err)}
            self.page_errors.append(entry)
            print(f"  [PAGEERROR @ {self.current_section}] {err}")

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)


def wait_raf(page: Page, frames: int = 4, delay_ms: int = 120) -> None:
    page.evaluate(
        """(n) => new Promise(resolve => {
            let count = 0;
            function tick() {
                count++;
                if (count >= n) resolve();
                else requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        })""",
        frames,
    )
    if delay_ms > 0:
        page.wait_for_timeout(delay_ms)


def clear_toasts(page: Page) -> None:
    page.evaluate(
        """() => {
            const c = document.getElementById('toastContainer');
            if (c) c.innerHTML = '';
        }"""
    )


def move_mouse_neutral(page: Page) -> None:
    page.mouse.move(4, 4)
    page.evaluate(
        """() => {
            const hud = document.getElementById('hud');
            if (hud) hud.classList.add('hidden');
        }"""
    )


def canvas_fingerprint(page: Page, which: str = "both") -> str:
    """Return a deterministic SHA-256 digest of `#cvBase` and/or `#cvOverlay` pixel data."""
    b64_map = page.evaluate(
        """(which) => {
            const out = {};
            if (which === 'base' || which === 'both') {
                const b = document.getElementById('cvBase');
                out.base = b ? b.toDataURL('image/png') : '';
            }
            if (which === 'overlay' || which === 'both') {
                const o = document.getElementById('cvOverlay');
                out.overlay = o ? o.toDataURL('image/png') : '';
            }
            return out;
        }""",
        which,
    )
    h = hashlib.sha256()
    if "base" in b64_map:
        h.update(b64_map["base"].encode("ascii"))
    if "overlay" in b64_map:
        h.update(b64_map["overlay"].encode("ascii"))
    return h.hexdigest()[:16]


def check_wcag_contrast_for_theme(page: Page) -> Dict[str, Any]:
    return page.evaluate(
        """() => {
            function parseRGBA(str) {
                if (!str || str === 'transparent') return [0, 0, 0, 0];
                const m = str.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?\\s*\\)/i);
                if (!m) return [0, 0, 0, 0];
                return [
                    parseFloat(m[1]),
                    parseFloat(m[2]),
                    parseFloat(m[3]),
                    m[4] !== undefined ? parseFloat(m[4]) : 1
                ];
            }

            function composite(fg, bg) {
                const a = fg[3];
                if (a >= 0.999) return [fg[0], fg[1], fg[2], 1];
                const outA = a + bg[3] * (1 - a);
                if (outA <= 0) return [0, 0, 0, 0];
                return [
                    (fg[0] * a + bg[0] * bg[3] * (1 - a)) / outA,
                    (fg[1] * a + bg[1] * bg[3] * (1 - a)) / outA,
                    (fg[2] * a + bg[2] * bg[3] * (1 - a)) / outA,
                    outA
                ];
            }

            function resolveBg(el) {
                const layers = [];
                let cur = el;
                while (cur && cur.nodeType === 1) {
                    const cs = getComputedStyle(cur);
                    const c = parseRGBA(cs.backgroundColor);
                    if (c[3] > 0) {
                        layers.push(c);
                        if (c[3] >= 0.999) break;
                    }
                    cur = cur.parentElement;
                }
                let bg = [0, 0, 0, 1];
                const rootBg = parseRGBA(getComputedStyle(document.getElementById('app') || document.body).backgroundColor);
                if (rootBg[3] >= 0.999) bg = rootBg;
                for (let i = layers.length - 1; i >= 0; i--) {
                    bg = composite(layers[i], bg);
                }
                return bg;
            }

            function relLum(rgb) {
                const ch = [rgb[0], rgb[1], rgb[2]].map(v => {
                    const s = Math.max(0, Math.min(255, v)) / 255;
                    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
            }

            function contrast(fg, bg) {
                const fgComp = composite(fg, bg);
                const L1 = relLum(fgComp);
                const L2 = relLum(bg);
                const hi = Math.max(L1, L2);
                const lo = Math.min(L1, L2);
                return (hi + 0.05) / (lo + 0.05);
            }

            function measureEl(el) {
                if (!el) return null;
                const cs = getComputedStyle(el);
                const fg = parseRGBA(cs.color);
                const bg = resolveBg(el);
                return {
                    ratio: Math.round(contrast(fg, bg) * 100) / 100,
                    fg: cs.color,
                    bg: `rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`
                };
            }

            const out = {};
            out['.btn.accent'] = measureEl(document.querySelector('#leftPanel .btn.accent'));
            out['.btn.chip'] = measureEl(document.querySelector('#leftPanel .btn.chip'));
            out['.btn.danger'] = measureEl(document.querySelector('#leftPanel .btn.danger'));
            out['.panelTabs button.active'] = measureEl(document.querySelector('#leftPanel .panelTabs button.active'));

            const procCards = document.getElementById('processCards');
            const probeCard = document.createElement('div');
            probeCard.className = 'procCard';
            probeCard.style.position = 'absolute';
            probeCard.style.left = '-9999px';
            probeCard.style.visibility = 'hidden';

            const badgeKinds = ['heat', 'cool', 'humid', 'dehum', 'evap', 'mix'];
            for (const k of badgeKinds) {
                const sp = document.createElement('span');
                sp.className = 'badge ' + k;
                sp.textContent = k.toUpperCase();
                sp.dataset.probe = k;
                probeCard.appendChild(sp);
            }

            const dimPanel = document.createElement('span');
            dimPanel.style.color = 'var(--dim)';
            dimPanel.style.background = 'var(--panel)';
            dimPanel.textContent = 'DIM';
            probeCard.appendChild(dimPanel);

            const dimPanel2 = document.createElement('span');
            dimPanel2.style.color = 'var(--dim)';
            dimPanel2.style.background = 'var(--panel2)';
            dimPanel2.textContent = 'DIM2';
            probeCard.appendChild(dimPanel2);

            (procCards || document.getElementById('rightPanel')).appendChild(probeCard);

            for (const k of badgeKinds) {
                out['.badge.' + k] = measureEl(probeCard.querySelector(`[data-probe="${k}"]`));
            }
            out['--dim (on --panel)'] = measureEl(dimPanel);
            out['--dim (on --panel2)'] = measureEl(dimPanel2);
            probeCard.remove();

            const hud = document.getElementById('hud');
            if (hud) {
                const prevHidden = hud.classList.contains('hidden');
                const prevHTML = hud.innerHTML;
                hud.classList.remove('hidden');
                hud.innerHTML = '<span class="hud-lbl">Tdb</span> <span class="hud-val">24.0 °C</span>';
                out['#hud .hud-val'] = measureEl(hud.querySelector('.hud-val'));
                hud.innerHTML = prevHTML;
                if (prevHidden) hud.classList.add('hidden');
            }

            return out;
        }"""
    )


def run_certification() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    runner = CertRunner()

    if not INDEX_HTML.exists():
        print(f"FATAL: {INDEX_HTML} does not exist. Run `node scripts/build.mjs` first.")
        return 1

    url = INDEX_HTML.as_uri()
    print(f"Certifying Famous Visualization Presets: {url}")
    print(f"Screenshots -> {ARTIFACT_DIR}")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_BIN,
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-gpu-sandbox",
                "--disable-dev-shm-usage",
                "--font-render-hinting=medium",
            ],
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2,
        )
        page = context.new_page()
        runner.attach(page)

        try:
            # =================================================================
            # 1. CLEAN BOOT AT 1440x900
            # =================================================================
            runner.section("1. Clean Boot at 1440x900")
            page.goto(url, wait_until="load", timeout=25000)
            page.wait_for_function("() => Boolean(window.__PSYCHRO__ && window.__PSYCHRO__.store)", timeout=15000)
            page.evaluate("() => { try { localStorage.clear(); } catch(e) {} }")
            page.reload(wait_until="load", timeout=25000)
            page.wait_for_function("() => Boolean(window.__PSYCHRO__ && window.__PSYCHRO__.store)", timeout=15000)
            wait_raf(page, 5, 220)

            sel_opts = page.evaluate(
                """() => Array.from(document.querySelectorAll('#selTheme option')).map(o => o.value)"""
            )
            missing_opts = [k for k in EXPECTED_PRESETS if k not in sel_opts]
            runner.check(
                "#selTheme exposes all 9 famous chart visualization presets + custom",
                len(missing_opts) == 0 and "custom" in sel_opts,
                f"options={sel_opts}",
            )

            # =================================================================
            # 2. ALL 9 FAMOUS VISUALIZATION PRESETS + SVG EXPORT + 6 SHOTS
            # =================================================================
            runner.section("2. All 9 Famous Chart Visualization Presets (DOM Sync, TopBar, Pixels, SVG & 6 Screenshots)")
            pixel_hashes: Dict[str, str] = {}

            for preset_id, spec in EXPECTED_PRESETS.items():
                page.select_option("#selTheme", preset_id)
                wait_raf(page, 5, 160)

                dom_state = page.evaluate(
                    """() => {
                        const tb = document.getElementById('topBar');
                        const app = document.getElementById('app');
                        const st = window.__PSYCHRO__.store.state;
                        return {
                            dataTheme: app?.getAttribute('data-theme'),
                            storeTheme: st.theme,
                            topBarScrollW: tb ? tb.scrollWidth : -1,
                            topBarClientW: tb ? tb.clientWidth : -1,
                            dom: {
                                axisFrame: document.getElementById('axisFrame')?.value,
                                axisTickDir: document.getElementById('axisTickDir')?.value,
                                axisYSide: document.getElementById('axisYSide')?.value,
                                chkAxisSubTicks: document.getElementById('chkAxisSubTicks')?.checked,
                                chkDualPvScale: document.getElementById('chkDualPvScale')?.checked,
                                axisRulerStyle: document.getElementById('axisRulerStyle')?.value,
                                trendArrowStyle: document.getElementById('trendArrowStyle')?.value,
                                trendLineWeight: document.getElementById('trendLineWeight')?.value,
                                trendPointMarker: document.getElementById('trendPointMarker')?.value,
                                trendBadgeStyle: document.getElementById('trendBadgeStyle')?.value,
                                chkTrendDecomp: document.getElementById('chkTrendDecomp')?.checked,
                            },
                            storeAxisStyle: st.axisStyle,
                            storeTrendStyle: st.trendStyle,
                        };
                    }"""
                )

                exp_ax = spec["axisStyle"]
                exp_tr = spec["trendStyle"]
                mismatches = []
                if dom_state["dataTheme"] != preset_id:
                    mismatches.append(f"data-theme={dom_state['dataTheme']}!= {preset_id}")
                if dom_state["storeTheme"] != preset_id:
                    mismatches.append(f"store.theme={dom_state['storeTheme']}")

                dom_checks = [
                    ("axisFrame", exp_ax["frame"]),
                    ("axisTickDir", exp_ax["tickDir"]),
                    ("axisYSide", exp_ax["yAxisSide"]),
                    ("chkAxisSubTicks", exp_ax["showSubTicks"]),
                    ("chkDualPvScale", exp_ax["showDualPvScale"]),
                    ("axisRulerStyle", exp_ax["enthalpyRulerStyle"]),
                    ("trendArrowStyle", exp_tr["arrowStyle"]),
                    ("trendLineWeight", exp_tr["lineWeight"]),
                    ("trendPointMarker", exp_tr["pointMarker"]),
                    ("trendBadgeStyle", exp_tr["badgeStyle"]),
                    ("chkTrendDecomp", exp_tr["showDecompLegs"]),
                ]
                for dom_id, exp_val in dom_checks:
                    actual = dom_state["dom"].get(dom_id)
                    if actual != exp_val:
                        mismatches.append(f"#{dom_id}={actual!r} (expected {exp_val!r})")

                overflow = dom_state["topBarScrollW"] - dom_state["topBarClientW"]
                runner.check(
                    f"Preset '{preset_id}': data-theme, 0px #topBar overflow & all 11 Axis/Trend controls synced",
                    len(mismatches) == 0 and overflow <= 0,
                    f"topBar={dom_state['topBarScrollW']}/{dom_state['topBarClientW']}px, "
                    + ("ALL 11 CONTROLS SYNCED" if not mismatches else "MISMATCHES: " + ", ".join(mismatches)),
                )

                # Capture canvas pixel fingerprint
                fp = canvas_fingerprint(page, "both")
                pixel_hashes[preset_id] = fp

                # Verify Exporter.buildSVGString(store)
                svg_text = page.evaluate(
                    """() => window.__PSYCHRO__.Exporter.buildSVGString(window.__PSYCHRO__.store)"""
                )
                browser_xml_ok = page.evaluate(
                    """(svgStr) => {
                        const doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
                        const err = doc.querySelector('parsererror');
                        return { ok: !err && doc.documentElement?.tagName === 'svg', errText: err ? err.textContent : '' };
                    }""",
                    svg_text,
                )
                py_xml_ok = False
                py_xml_err = ""
                try:
                    root = ET.fromstring(svg_text)
                    py_xml_ok = root.tag.endswith("svg")
                except Exception as exc:
                    py_xml_err = str(exc)

                has_nan = "NaN" in svg_text
                has_undef = "undefined" in svg_text
                has_dashdot = 'stroke-dasharray="7 3 1.5 3"' in svg_text
                dashdot_ok = (not spec["expectDashDot"]) or has_dashdot

                runner.check(
                    f"Preset '{preset_id}': Exporter.buildSVGString valid XML, zero NaN/undefined"
                    + (" + dashdot" if spec["expectDashDot"] else ""),
                    browser_xml_ok["ok"] and py_xml_ok and not has_nan and not has_undef and dashdot_ok,
                    f"len={len(svg_text)}B, domXML={browser_xml_ok['ok']}, pyXML={py_xml_ok}({py_xml_err}), "
                    f"NaN={has_nan}, undef={has_undef}, dashdot={has_dashdot}",
                )

                # Capture iconic screenshot for the 6 hero presets
                if spec["shot"]:
                    clear_toasts(page)
                    move_mouse_neutral(page)
                    wait_raf(page, 4, 140)
                    shot_path = ARTIFACT_DIR / spec["shot"]
                    page.screenshot(path=str(shot_path))
                    runner.check(
                        f"Captured {spec['shot']}",
                        shot_path.exists() and shot_path.stat().st_size > 25000,
                        f"{shot_path.name} ({shot_path.stat().st_size // 1024} KB)",
                    )

            # Verify all 9 presets produce distinct rendered canvases
            unique_hashes = set(pixel_hashes.values())
            runner.check(
                "All 9 presets produce distinct rendered canvas pixels (9/9 unique visual styles)",
                len(unique_hashes) == len(EXPECTED_PRESETS),
                f"unique={len(unique_hashes)}/{len(EXPECTED_PRESETS)} | hashes={pixel_hashes}",
            )

            # =================================================================
            # 3. WCAG 2.1 AA CONTRAST CHECK ON ALL 5 NEW THEMES
            # =================================================================
            runner.section("3. WCAG 2.1 AA Contrast Check (>= 4.5:1) on All 5 NEW Themes")
            for theme_id in NEW_THEMES_WCAG:
                page.select_option("#selTheme", theme_id)
                wait_raf(page, 4, 120)
                ratios = check_wcag_contrast_for_theme(page)
                failures = []
                summary = []
                for sel, info in ratios.items():
                    if not info:
                        failures.append(f"{sel}=MISSING")
                        continue
                    r = info["ratio"]
                    summary.append(f"{sel}:{r:.2f}")
                    if r < 4.5:
                        failures.append(f"{sel}={r:.2f} (fg={info['fg']} on bg={info['bg']})")
                runner.check(
                    f"Theme '{theme_id}': WCAG 2.1 AA contrast >= 4.5:1 across all UI controls & tokens",
                    len(failures) == 0,
                    "ALL PASS [" + ", ".join(summary) + "]" if not failures else "FAILURES: " + "; ".join(failures),
                )

            # =================================================================
            # 4. INTERACTIVE AXIS STYLE & TREND STYLE LIVE OVERRIDES
            # =================================================================
            runner.section("4. Interactive Axis Style & Process Trend Style Overrides")
            # Start from a clean known baseline: studio-dark
            page.select_option("#selTheme", "studio-dark")
            wait_raf(page, 4, 140)
            # Ensure Grid & Curves accordion is expanded and visible
            page.evaluate(
                """() => {
                    const tabAtmoBtn = document.getElementById('tabBtnAtmo');
                    if (tabAtmoBtn) tabAtmoBtn.click();
                    const acc = document.getElementById('axisFrame')?.closest('details');
                    if (acc) acc.open = true;
                }"""
            )
            wait_raf(page, 3, 80)

            override_steps = [
                # (selector, kind, value, store_section, store_key, canvas_target)
                ("#axisFrame", "select", "ashrae-open", "axisStyle", "frame", "base"),
                ("#axisFrame", "select", "cad-ticks", "axisStyle", "frame", "base"),
                ("#axisFrame", "select", "full-box", "axisStyle", "frame", "base"),
                ("#axisTickDir", "select", "in", "axisStyle", "tickDir", "base"),
                ("#axisTickDir", "select", "cross", "axisStyle", "tickDir", "base"),
                ("#axisTickDir", "select", "out", "axisStyle", "tickDir", "base"),
                ("#axisYSide", "select", "right", "axisStyle", "yAxisSide", "base"),
                ("#axisYSide", "select", "left", "axisStyle", "yAxisSide", "base"),
                ("#axisYSide", "select", "both", "axisStyle", "yAxisSide", "base"),
                ("#chkDualPvScale", "checkbox", True, "axisStyle", "showDualPvScale", "base"),
                ("#axisRulerStyle", "select", "carrier-dual", "axisStyle", "enthalpyRulerStyle", "base"),
                ("#axisRulerStyle", "select", "minimal", "axisStyle", "enthalpyRulerStyle", "base"),
                ("#axisRulerStyle", "select", "ashrae-rail", "axisStyle", "enthalpyRulerStyle", "base"),
                ("#trendArrowStyle", "select", "solid-triangle", "trendStyle", "arrowStyle", "overlay"),
                ("#trendArrowStyle", "select", "open-vector", "trendStyle", "arrowStyle", "overlay"),
                ("#trendArrowStyle", "select", "cad-chevron", "trendStyle", "arrowStyle", "overlay"),
                ("#trendLineWeight", "select", "fine", "trendStyle", "lineWeight", "overlay"),
                ("#trendLineWeight", "select", "bold", "trendStyle", "lineWeight", "overlay"),
                ("#trendPointMarker", "select", "crosshair-circle", "trendStyle", "pointMarker", "overlay"),
                ("#trendPointMarker", "select", "diamond", "trendStyle", "pointMarker", "overlay"),
                ("#trendPointMarker", "select", "solid-dot", "trendStyle", "pointMarker", "overlay"),
                ("#trendBadgeStyle", "select", "inline-minimal", "trendStyle", "badgeStyle", "overlay"),
                ("#trendBadgeStyle", "select", "pill", "trendStyle", "badgeStyle", "overlay"),
                ("#trendBadgeStyle", "select", "detailed", "trendStyle", "badgeStyle", "overlay"),
                ("#chkTrendDecomp", "checkbox", True, "trendStyle", "showDecompLegs", "overlay"),
            ]

            for sel, kind, val, sec, key, cv_target in override_steps:
                before_fp = canvas_fingerprint(page, cv_target)
                if kind == "select":
                    page.select_option(sel, val)
                else:
                    page.set_checked(sel, bool(val))
                wait_raf(page, 4, 90)
                after_fp = canvas_fingerprint(page, cv_target)
                actual_store = page.evaluate(
                    """([s, k]) => window.__PSYCHRO__.store.state[s]?.[k]""",
                    [sec, key],
                )
                runner.check(
                    f"Override {sel} -> {val!r} updates store.{sec}.{key} & re-renders #{cv_target}",
                    actual_store == val and after_fp != before_fp,
                    f"store={actual_store!r}, fp {before_fp} -> {after_fp}",
                )

            # =================================================================
            # 5. CUSTOM THEME STUDIO `#tePresetBar` & FULL REVERT ON CLOSE
            # =================================================================
            runner.section("5. Custom Theme Studio #tePresetBar & Full Revert on Close")
            page.select_option("#selTheme", "trane-hvac")
            wait_raf(page, 4, 140)

            before_snap = page.evaluate(
                """() => {
                    const st = window.__PSYCHRO__.store.state;
                    return {
                        theme: st.theme,
                        dataTheme: document.getElementById('app')?.getAttribute('data-theme'),
                        customTheme: JSON.parse(JSON.stringify(st.customTheme)),
                        axisStyle: JSON.parse(JSON.stringify(st.axisStyle)),
                        trendStyle: JSON.parse(JSON.stringify(st.trendStyle)),
                    };
                }"""
            )

            # Open Custom Theme Studio via #selTheme -> custom
            page.select_option("#selTheme", "custom")
            wait_raf(page, 4, 150)

            te_info = page.evaluate(
                """() => {
                    const ov = document.getElementById('themeEditorOverlay');
                    const bar = document.getElementById('tePresetBar');
                    const chips = bar ? Array.from(bar.querySelectorAll('.te-preset-btn')) : [];
                    return {
                        visible: Boolean(ov && ov.classList.contains('visible')),
                        chipCount: chips.length,
                        chipIds: chips.map(b => b.dataset.presetId),
                        chipLabels: chips.map(b => b.textContent.trim()),
                    };
                }"""
            )
            runner.check(
                "Custom Theme Studio opens & renders all 9 preset chips inside #tePresetBar",
                te_info["visible"] and te_info["chipCount"] == 9 and "carrier-classic" in te_info["chipIds"],
                json.dumps(te_info),
            )

            # Click Carrier Classic chip
            page.click('#tePresetBar .te-preset-btn[data-preset-id="carrier-classic"]')
            wait_raf(page, 4, 150)

            during_carrier = page.evaluate(
                """() => {
                    const st = window.__PSYCHRO__.store.state;
                    return {
                        ct_sat: document.getElementById('ct_sat')?.value?.toLowerCase(),
                        ct_enth: document.getElementById('ct_enth')?.value?.toLowerCase(),
                        ct_wb: document.getElementById('ct_wb')?.value?.toLowerCase(),
                        ct_vline: document.getElementById('ct_vline')?.value?.toLowerCase(),
                        ct_vline_ls: document.getElementById('ct_vline_ls')?.value,
                        storeTheme: st.theme,
                        storeAxisRuler: st.axisStyle?.enthalpyRulerStyle,
                        storeTrendDecomp: st.trendStyle?.showDecompLegs,
                        activeChip: document.querySelector('#tePresetBar .te-preset-btn.active')?.dataset?.presetId,
                    };
                }"""
            )
            runner.check(
                "Clicking 'Carrier Classic' chip updates #ct_sat, #ct_enth, #ct_wb, #ct_vline & axis/trend live",
                during_carrier["ct_sat"] == "#0f172a"
                and during_carrier["ct_enth"] == "#dc2626"
                and during_carrier["ct_wb"] == "#b91c1c"
                and during_carrier["ct_vline"] == "#15803d"
                and during_carrier["ct_vline_ls"] == "dashdot"
                and during_carrier["storeAxisRuler"] == "carrier-dual"
                and during_carrier["storeTrendDecomp"] is True
                and during_carrier["activeChip"] == "carrier-classic",
                json.dumps(during_carrier),
            )

            # Click Close -> verify complete revert of theme, customTheme, axisStyle, trendStyle
            page.click("#closeThemeEditor")
            wait_raf(page, 4, 150)

            after_close = page.evaluate(
                """() => {
                    const ov = document.getElementById('themeEditorOverlay');
                    const st = window.__PSYCHRO__.store.state;
                    return {
                        visible: Boolean(ov && ov.classList.contains('visible')),
                        theme: st.theme,
                        dataTheme: document.getElementById('app')?.getAttribute('data-theme'),
                        selThemeVal: document.getElementById('selTheme')?.value,
                        customTheme: JSON.parse(JSON.stringify(st.customTheme)),
                        axisStyle: JSON.parse(JSON.stringify(st.axisStyle)),
                        trendStyle: JSON.parse(JSON.stringify(st.trendStyle)),
                    };
                }"""
            )
            runner.check(
                "Closing Custom Theme Studio reverts theme, customTheme, axisStyle & trendStyle cleanly",
                not after_close["visible"]
                and after_close["theme"] == before_snap["theme"]
                and after_close["dataTheme"] == before_snap["dataTheme"]
                and after_close["selThemeVal"] == before_snap["theme"]
                and after_close["customTheme"] == before_snap["customTheme"]
                and after_close["axisStyle"] == before_snap["axisStyle"]
                and after_close["trendStyle"] == before_snap["trendStyle"],
                f"theme={before_snap['theme']}->{after_close['theme']}, "
                f"ctEqual={after_close['customTheme'] == before_snap['customTheme']}, "
                f"axEqual={after_close['axisStyle'] == before_snap['axisStyle']}, "
                f"trEqual={after_close['trendStyle'] == before_snap['trendStyle']}",
            )

            # =================================================================
            # 6. COMMAND PALETTE (Ctrl+K) DISCOVERY
            # =================================================================
            runner.section("6. Command Palette (Ctrl+K) Discovery")
            page.keyboard.press("Control+k")
            wait_raf(page, 3, 120)
            cmd_open = page.evaluate("() => document.getElementById('cmdPaletteOverlay')?.classList.contains('visible')")
            runner.check("Ctrl+K opens Command Palette", bool(cmd_open), f"visible={cmd_open}")

            cmd_queries = [
                ("carrier", "Carrier Classic"),
                ("trane", "Trane HVAC"),
                ("cibse", "CIBSE Metric"),
                ("mollier", "Mollier / DIN"),
                ("print", "Print B&W"),
                ("pv scale", "Secondary Pv Scale"),
                ("legs", "ΔT/ΔW Legs"),
            ]
            for query, expected_substr in cmd_queries:
                page.fill("#cmdInput", query)
                wait_raf(page, 2, 70)
                top_hits = page.evaluate(
                    """() => Array.from(document.querySelectorAll('#cmdList .cmd-item'))
                        .slice(0, 3)
                        .map(el => el.textContent.trim())"""
                )
                top_hit = top_hits[0] if top_hits else ""
                runner.check(
                    f"Ctrl+K query {query!r} returns top match containing {expected_substr!r}",
                    expected_substr.lower() in top_hit.lower(),
                    f"top='{top_hit[:96]}'",
                )

            page.keyboard.press("Escape")
            wait_raf(page, 2, 80)

            # =================================================================
            # 7. ZERO RUNTIME ERROR GATE
            # =================================================================
            runner.section("7. Runtime Error Gate")
            runner.check(
                "Zero console.error throughout entire session",
                len(runner.console_errors) == 0,
                f"count={len(runner.console_errors)}",
            )
            runner.check(
                "Zero uncaught pageerror throughout entire session",
                len(runner.page_errors) == 0,
                f"count={len(runner.page_errors)}",
            )

        except Exception:
            traceback.print_exc()
            runner.check("Unhandled test runner exception", False, "See traceback above")
        finally:
            context.close()
            browser.close()

    total = len(runner.results)
    passed = sum(1 for r in runner.results if r["passed"])
    failed = total - passed
    print("\n" + "=" * 78)
    print(f"FAMOUS VISUALIZATION PRESETS CHROME SCORECARD: {passed}/{total} PASSED ({failed} FAILED)")
    print("=" * 78)
    if failed > 0:
        print("\nFAILED CHECKS:")
        for r in runner.results:
            if not r["passed"]:
                print(f"  - [{r['section']}] {r['name']}: {r['detail']}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(run_certification())
