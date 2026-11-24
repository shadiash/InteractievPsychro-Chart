#!/usr/bin/env python3
"""
PsychroChart Ultra 3.0 — Headless Chrome Playwright Visual & Interactive E2E Audit
==================================================================================
Tests the compiled single-file `index.html` inside real Google Chrome / Chromium
via Playwright, covering:
  1. Zero console.error & zero uncaught pageerror throughout the entire session
  2. Initial boot (studio-dark, Summer AHU preset), non-blank HiDPI canvases, HUD
  3. IP units switch & drafting-light theme (gr/lb, °F, true 0°F-datum Btu/lb, BTU/h, TR)
  4. ASHRAE Classic theme + Dubai 8,760-hr TMY weather heatmap + Givoni zones
  5. Blueprint CAD theme + Data Center TC 9.9 preset + SHR protractor
  6. Interactive tools, Systems AHU DOAS+ERV wizard, Any-2-of-8 Calculator (Twb+RH),
     ASHRAE 62.1 Ventilation (Classroom), Measure Ruler drag, Command Palette (Ctrl+K)
  7. Undo / Redo & SVG / CSV Exporter smoke verification
  8. Compact responsive check (960x700) for zero horizontal overflow

Usage:
  /opt/pyenv/shims/python3 tests/e2e_playwright.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from playwright.sync_api import ConsoleMessage, Page, sync_playwright

# ---------------------------------------------------------------------------
# Paths & Configuration
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = REPO_ROOT / "index.html"
ARTIFACT_DIR = Path(
    os.environ.get(
        "PSYCHRO_SHOT_DIR",
        "/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/c1768639-9edd-48d4-a64a-9cd2ad2795a7",
    )
)
CHROME_BIN = "/usr/bin/google-chrome"


class AuditRunner:
    def __init__(self) -> None:
        self.results: List[Dict[str, Any]] = []
        self.console_messages: List[Dict[str, Any]] = []
        self.console_errors: List[Dict[str, Any]] = []
        self.page_errors: List[Dict[str, Any]] = []
        self.current_step: str = "init"

    def set_step(self, step: str) -> None:
        self.current_step = step
        print(f"\n=== [{step}] ===")

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        status = "PASS" if condition else "FAIL"
        self.results.append(
            {
                "step": self.current_step,
                "name": name,
                "passed": bool(condition),
                "detail": detail,
            }
        )
        prefix = "  [PASS]" if condition else "  [FAIL]"
        msg = f"{prefix} {name}"
        if detail:
            msg += f" — {detail}"
        print(msg)

    def attach_listeners(self, page: Page) -> None:
        def on_console(msg: ConsoleMessage) -> None:
            entry = {
                "step": self.current_step,
                "type": msg.type,
                "text": msg.text,
                "location": msg.location,
            }
            self.console_messages.append(entry)
            if msg.type == "error":
                self.console_errors.append(entry)
                print(f"  [CONSOLE.ERROR @ {self.current_step}] {msg.text}")

        def on_pageerror(err: Exception) -> None:
            entry = {
                "step": self.current_step,
                "error": str(err),
            }
            self.page_errors.append(entry)
            print(f"  [PAGEERROR @ {self.current_step}] {err}")

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)


def wait_raf(page: Page, frames: int = 3, delay_ms: int = 120) -> None:
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


def inspect_canvas_pixels(page: Page, selector: str) -> Dict[str, Any]:
    return page.evaluate(
        """(sel) => {
            const cv = document.querySelector(sel);
            if (!cv) return { exists: false };
            const rect = cv.getBoundingClientRect();
            const w = cv.width;
            const h = cv.height;
            if (!w || !h) {
                return { exists: true, cssW: rect.width, cssH: rect.height, pxW: w, pxH: h, nonTransparent: 0, distinctColors: 0 };
            }
            const tmp = document.createElement('canvas');
            tmp.width = w;
            tmp.height = h;
            const tctx = tmp.getContext('2d', { willReadFrequently: true });
            tctx.drawImage(cv, 0, 0);
            const data = tctx.getImageData(0, 0, w, h).data;
            let nonTransparent = 0;
            const colorSet = new Set();
            // Stride sampling for fast full-frame coverage
            const step = Math.max(1, Math.floor((w * h) / 40000));
            let sampled = 0;
            for (let i = 0; i < w * h; i += step) {
                sampled++;
                const idx = i * 4;
                const a = data[idx + 3];
                if (a > 0) {
                    nonTransparent++;
                    const key = (data[idx] >> 3) << 10 | (data[idx + 1] >> 3) << 5 | (data[idx + 2] >> 3);
                    colorSet.add(key);
                }
            }
            return {
                exists: true,
                cssW: Math.round(rect.width * 10) / 10,
                cssH: Math.round(rect.height * 10) / 10,
                pxW: w,
                pxH: h,
                sampled,
                nonTransparent,
                distinctColors: colorSet.size
            };
        }""",
        selector,
    )


def map_tw_to_client_xy(page: Page, T_c: float, w_kgkg: float) -> Optional[Tuple[float, float]]:
    res = page.evaluate(
        """([T, w]) => {
            const api = window.__PSYCHRO__;
            const cv = document.getElementById('cvOverlay');
            if (!api || !cv) return null;
            const rect = cv.getBoundingClientRect();
            const br = api.baseRenderer;
            if (br && typeof br.tToX === 'function' && typeof br.wToY === 'function') {
                return { x: rect.left + br.tToX(T), y: rect.top + br.wToY(w) };
            }
            if (br && typeof br.twToPx === 'function') {
                const p = br.twToPx(T, w);
                return { x: rect.left + p.x, y: rect.top + p.y };
            }
            return null;
        }""",
        [T_c, w_kgkg],
    )
    if res and isinstance(res.get("x"), (int, float)) and isinstance(res.get("y"), (int, float)):
        return float(res["x"]), float(res["y"])
    return None


def contains_bad_tokens(text: str) -> List[str]:
    bad: List[str] = []
    if re.search(r"\bNaN\b", text):
        bad.append("NaN")
    if re.search(r"\bundefined\b", text, re.IGNORECASE):
        bad.append("undefined")
    if re.search(r"\bInfinity\b", text):
        bad.append("Infinity")
    return bad


def run_audit() -> int:
    if not INDEX_HTML.exists():
        print(f"FATAL: Compiled index.html not found at {INDEX_HTML}")
        return 2

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    audit = AuditRunner()

    with sync_playwright() as pw:
        launch_kwargs: Dict[str, Any] = {
            "headless": True,
            "args": [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--font-render-hinting=none",
            ],
        }
        if Path(CHROME_BIN).exists():
            launch_kwargs["executable_path"] = CHROME_BIN
            print(f"Launching real Google Chrome: {CHROME_BIN}")
        else:
            print("Launching Playwright bundled Chromium")

        browser = pw.chromium.launch(**launch_kwargs)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=1,
        )
        page = context.new_page()
        audit.attach_listeners(page)

        try:
            # ===============================================================
            # 1 & 2. INITIAL BOOT (studio-dark, Summer AHU Preset)
            # ===============================================================
            audit.set_step("Step 1: Initial Boot (studio-dark, Summer AHU Preset)")
            url = INDEX_HTML.as_uri()
            page.goto(url, wait_until="load")
            page.wait_for_function("() => Boolean(window.__PSYCHRO__ && window.__PSYCHRO__.store)", timeout=15000)
            wait_raf(page, frames=5, delay_ms=250)

            app_theme = page.get_attribute("#app", "data-theme")
            audit.check("Default theme is studio-dark", app_theme == "studio-dark", f"data-theme={app_theme!r}")

            base_px = inspect_canvas_pixels(page, "#cvBase")
            ov_px = inspect_canvas_pixels(page, "#cvOverlay")
            audit.check(
                "#cvBase dimensions > 600px and non-blank",
                bool(
                    base_px.get("exists")
                    and base_px.get("cssW", 0) > 600
                    and base_px.get("cssH", 0) > 600
                    and base_px.get("nonTransparent", 0) > 100
                    and base_px.get("distinctColors", 0) >= 4
                ),
                f"{base_px}",
            )
            audit.check(
                "#cvOverlay dimensions > 600px and non-blank",
                bool(
                    ov_px.get("exists")
                    and ov_px.get("cssW", 0) > 600
                    and ov_px.get("cssH", 0) > 600
                    and ov_px.get("nonTransparent", 0) > 50
                    and ov_px.get("distinctColors", 0) >= 3
                ),
                f"{ov_px}",
            )

            boot_counts = page.evaluate(
                """() => ({
                    points: window.__PSYCHRO__.store.state.points.length,
                    processes: window.__PSYCHRO__.store.state.processes.length,
                    labels: window.__PSYCHRO__.store.state.points.map(p => p.label)
                })"""
            )
            audit.check(
                "Initial boot points >= 4 & processes exist",
                boot_counts["points"] >= 4 and boot_counts["processes"] >= 1,
                f"points={boot_counts['points']} ({boot_counts['labels']}), processes={boot_counts['processes']}",
            )

            # Hover near center of chart (below saturation curve, e.g., 26°C, 0.010 kg/kg)
            ov_box = page.locator("#cvOverlay").bounding_box()
            assert ov_box is not None, "#cvOverlay bounding_box is None"
            hover_xy = map_tw_to_client_xy(page, 26.0, 0.010)
            if hover_xy is None:
                hover_xy = (ov_box["x"] + ov_box["width"] * 0.55, ov_box["y"] + ov_box["height"] * 0.60)
            page.mouse.move(hover_xy[0] - 20, hover_xy[1] - 10)
            page.mouse.move(hover_xy[0], hover_xy[1], steps=6)
            wait_raf(page, frames=3, delay_ms=180)

            hud_info = page.evaluate(
                """() => {
                    const el = document.getElementById('hud');
                    if (!el) return { exists: false };
                    const cs = getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    const cw = document.getElementById('chartWrap')?.getBoundingClientRect();
                    const tb = document.getElementById('topBar');
                    return {
                        exists: true,
                        hiddenClass: el.classList.contains('hidden'),
                        display: cs.display,
                        opacity: cs.opacity,
                        text: el.innerText.trim(),
                        rawText: el.textContent.trim(),
                        hudWidth: Math.round(r.width),
                        hudScrollWidth: el.scrollWidth,
                        chartWrapWidth: cw ? Math.round(cw.width) : 0,
                        topBarClientW: tb ? tb.clientWidth : 0,
                        topBarScrollW: tb ? tb.scrollWidth : 0
                    };
                }"""
            )
            hud_text = hud_info.get("text", "")
            hud_bad = contains_bad_tokens(hud_text)
            required_hud_keys = ["Tdb", "W", "RH", "Twb", "Tdp", "h", "v"]
            missing_hud_keys = [
                k for k in required_hud_keys
                if not re.search(rf"\b{re.escape(k)}\b", hud_text, re.IGNORECASE)
            ]
            hud_nums = re.findall(r"-?\d+(?:\.\d+)?", hud_text)
            audit.check(
                "#hud visible on hover with finite Tdb/W/RH/Twb/Tdp/h/v",
                bool(
                    hud_info.get("exists")
                    and not hud_info.get("hiddenClass")
                    and hud_info.get("display") != "none"
                    and not missing_hud_keys
                    and not hud_bad
                    and len(hud_nums) >= 7
                ),
                f"missing={missing_hud_keys}, bad={hud_bad}, text={hud_text.replace(chr(10), ' | ')!r}",
            )
            print(
                f"  [DIAG @ 1440x900] topBar clientW={hud_info.get('topBarClientW')}px vs scrollW={hud_info.get('topBarScrollW')}px; "
                f"hud width={hud_info.get('hudWidth')}px scrollW={hud_info.get('hudScrollWidth')}px inside chartWrap={hud_info.get('chartWrapWidth')}px"
            )

            shot1 = ARTIFACT_DIR / "shot_01_studio_dark_ahu.png"
            page.screenshot(path=str(shot1), full_page=False)
            audit.check("Saved shot_01_studio_dark_ahu.png", shot1.exists() and shot1.stat().st_size > 20000, f"{shot1.stat().st_size} B")

            # ===============================================================
            # 3. IP UNITS SWITCH & DRAFTING LIGHT THEME
            # ===============================================================
            audit.set_step("Step 2: IP Units Switch & Drafting Light Theme")
            page.select_option("#selUnits", "IP")
            page.select_option("#selTheme", "drafting-light")
            wait_raf(page, frames=5, delay_ms=250)

            theme_ip = page.get_attribute("#app", "data-theme")
            audit.check("Theme switched to drafting-light", theme_ip == "drafting-light", f"data-theme={theme_ip!r}")

            yaxis_txt = page.locator("#yAxisLabel").inner_text().strip()
            audit.check(
                "#yAxisLabel updated to gr/lb or Grains",
                ("gr/lb" in yaxis_txt.lower()) or ("grains" in yaxis_txt.lower()),
                f"yAxisLabel={yaxis_txt!r}",
            )

            # Hover room conditions: Tdb=24°C (75.2°F), w=0.0093 kg/kg (~50% RH -> h_IP ≈ 28.3 Btu/lb)
            room_xy = map_tw_to_client_xy(page, 24.0, 0.0093)
            if room_xy is None:
                room_xy = (ov_box["x"] + ov_box["width"] * 0.50, ov_box["y"] + ov_box["height"] * 0.62)
            page.mouse.move(room_xy[0] - 15, room_xy[1] - 15)
            page.mouse.move(room_xy[0], room_xy[1], steps=6)
            wait_raf(page, frames=3, delay_ms=180)

            hud_ip_txt = page.locator("#hud").inner_text().strip()
            hud_ip_bad = contains_bad_tokens(hud_ip_txt)
            m_btu = re.search(r"(-?\d+(?:\.\d+)?)\s*Btu/lb", hud_ip_txt, re.IGNORECASE)
            h_ip_val = float(m_btu.group(1)) if m_btu else None
            audit.check(
                "#hud displays °F and true 0°F-datum Btu/lb (25-35 Btu/lb near room conditions)",
                bool(
                    "°F" in hud_ip_txt
                    and "Btu/lb" in hud_ip_txt
                    and not hud_ip_bad
                    and h_ip_val is not None
                    and 25.0 <= h_ip_val <= 35.0
                ),
                f"h_ip={h_ip_val}, bad={hud_ip_bad}, hud={hud_ip_txt.replace(chr(10), ' | ')!r}",
            )

            # Check #mQt and #mTons on Right Panel Processes tab
            # Select a cooling/conditioning process if first process has zero load
            mqt_txt = page.locator("#mQt").inner_text().strip()
            mtons_txt = page.locator("#mTons").inner_text().strip()
            audit.check(
                "#mQt displays BTU/h or MBH in IP mode",
                ("BTU/h" in mqt_txt or "MBH" in mqt_txt) and not contains_bad_tokens(mqt_txt),
                f"mQt={mqt_txt!r}",
            )
            audit.check(
                "#mTons displays TR in IP mode",
                ("TR" in mtons_txt) and not contains_bad_tokens(mtons_txt),
                f"mTons={mtons_txt!r}",
            )

            shot2 = ARTIFACT_DIR / "shot_02_drafting_light_ip.png"
            page.screenshot(path=str(shot2), full_page=False)
            audit.check("Saved shot_02_drafting_light_ip.png", shot2.exists() and shot2.stat().st_size > 20000, f"{shot2.stat().st_size} B")

            # ===============================================================
            # 4. ASHRAE CLASSIC + DUBAI 8,760-HR HEATMAP + GIVONI ZONES
            # ===============================================================
            audit.set_step("Step 3: ASHRAE Classic + Dubai 8,760h Weather Heatmap + Givoni Zones")
            page.select_option("#selUnits", "SI")
            page.select_option("#selTheme", "ashrae-classic")
            wait_raf(page, frames=4, delay_ms=150)

            # Ensure Left Panel Atmosphere tab is active
            page.click('#leftPanel button[data-tab="tabAtmo"]')
            dubai_val = page.evaluate(
                """() => {
                    const sel = document.getElementById('citySelect');
                    if (!sel) return null;
                    for (const opt of sel.options) {
                        if (/dubai/i.test(opt.textContent || '') || /dubai/i.test(opt.value || '')) {
                            return { value: opt.value, text: opt.textContent };
                        }
                    }
                    return null;
                }"""
            )
            audit.check("Dubai found in #citySelect", dubai_val is not None, f"{dubai_val}")
            if dubai_val:
                page.select_option("#citySelect", dubai_val["value"])
                page.click("#btnLoadCityTMY")
            page.locator("#chkGivoni").check()
            wait_raf(page, frames=6, delay_ms=350)

            # Move mouse off canvas so HUD does not cover the heatmap screenshot
            page.mouse.move(10, 10)
            wait_raf(page, frames=3, delay_ms=150)

            weather_stats_txt = page.locator("#weatherStats").inner_text().strip()
            weather_bad = contains_bad_tokens(weather_stats_txt)
            has_8760 = ("8,760" in weather_stats_txt) or ("8760" in weather_stats_txt)
            has_comfort = bool(re.search(r"comfort", weather_stats_txt, re.IGNORECASE))
            has_cooling = bool(re.search(r"cool", weather_stats_txt, re.IGNORECASE))
            has_dehum = bool(re.search(r"dehum", weather_stats_txt, re.IGNORECASE))
            weather_meta = page.evaluate(
                """() => ({
                    layerWeather: Boolean(window.__PSYCHRO__.store.state.layers.weather),
                    layerGivoni: Boolean(window.__PSYCHRO__.store.state.layers.givoni),
                    recordCount: (window.__PSYCHRO__.store.state.weather?.records || window.__PSYCHRO__.store.state.weather?.hours || []).length
                })"""
            )
            audit.check(
                "#weatherStats shows 8,760 hours & comfort/cooling/dehum breakdown",
                bool(has_8760 and has_comfort and has_cooling and has_dehum and not weather_bad and weather_meta["recordCount"] == 8760),
                f"meta={weather_meta}, stats={weather_stats_txt.replace(chr(10), ' | ')!r}",
            )

            shot3 = ARTIFACT_DIR / "shot_03_ashrae_dubai_heatmap.png"
            page.screenshot(path=str(shot3), full_page=False)
            audit.check("Saved shot_03_ashrae_dubai_heatmap.png", shot3.exists() and shot3.stat().st_size > 20000, f"{shot3.stat().st_size} B")

            # ===============================================================
            # 5. BLUEPRINT CAD + DATA CENTER TC 9.9 PRESET + SHR PROTRACTOR
            # ===============================================================
            audit.set_step("Step 4: Blueprint CAD + Data Center TC 9.9 Preset + SHR Protractor")
            # Clear weather and Givoni so TC 9.9 envelope & SHR protractor are crystal clear
            page.click("#btnClearWeather")
            page.locator("#chkGivoni").uncheck()
            page.select_option("#selTheme", "blueprint-cad")
            page.select_option("#selPreset", "datacenter-econ")
            page.select_option("#shrShow", "on")
            wait_raf(page, frames=5, delay_ms=250)

            dc_check = page.evaluate(
                """() => {
                    const st = window.__PSYCHRO__.store.state;
                    const Psy = window.__PSYCHRO__.Psy;
                    const pPa = st.pPa || 101325;
                    const pts = st.points.map(p => {
                        const s = Psy.stateFromTw(p.T, p.w, pPa);
                        const inRecommended = (s.T >= 18.0 - 1e-6 && s.T <= 27.0 + 1e-6 && s.Tdp >= -9.0 - 1e-6 && s.Tdp <= 15.0 + 1e-6 && s.rh <= 60.0 + 1e-6);
                        const inAllowableA1 = (s.T >= 15.0 && s.T <= 32.0 && s.Tdp >= -12.0 && s.Tdp <= 17.0 && s.rh >= 8.0 && s.rh <= 80.0);
                        const inAllowableA2 = (s.T >= 10.0 && s.T <= 35.0 && s.Tdp >= -12.0 && s.Tdp <= 21.0 && s.rh >= 8.0 && s.rh <= 80.0);
                        return {
                            label: p.label,
                            T: Math.round(s.T * 100) / 100,
                            rh: Math.round(s.rh * 100) / 100,
                            Tdp: Math.round(s.Tdp * 100) / 100,
                            inRecommended,
                            inAllowableA1,
                            inAllowableA2
                        };
                    });
                    return {
                        theme: document.getElementById('app')?.getAttribute('data-theme'),
                        datacenterLayer: Boolean(st.layers.datacenter),
                        shrShow: Boolean(st.shr?.show),
                        pts
                    };
                }"""
            )
            rec_pts = [p for p in dc_check["pts"] if p["inRecommended"]]
            cold_aisle_ok = any("cold aisle" in p["label"].lower() and p["inRecommended"] for p in dc_check["pts"])
            econ_mix_ok = any("econ mix" in p["label"].lower() and p["inRecommended"] for p in dc_check["pts"])
            audit.check(
                "Blueprint CAD + TC 9.9 layer + SHR protractor ON",
                bool(dc_check["theme"] == "blueprint-cad" and dc_check["datacenterLayer"] and dc_check["shrShow"]),
                f"theme={dc_check['theme']}, datacenterLayer={dc_check['datacenterLayer']}, shrShow={dc_check['shrShow']}",
            )
            audit.check(
                "Data Center supply/mix points inside TC 9.9 Recommended envelope",
                bool(cold_aisle_ok and econ_mix_ok and len(rec_pts) >= 3),
                f"inRecommended={len(rec_pts)}/{len(dc_check['pts'])}, pts={dc_check['pts']}",
            )

            shot4 = ARTIFACT_DIR / "shot_04_blueprint_datacenter_shr.png"
            page.screenshot(path=str(shot4), full_page=False)
            audit.check("Saved shot_04_blueprint_datacenter_shr.png", shot4.exists() and shot4.stat().st_size > 20000, f"{shot4.stat().st_size} B")

            # ===============================================================
            # 6. INTERACTIVE TOOLS, SYSTEMS WIZARDS & COMMAND PALETTE (Ctrl+K)
            # ===============================================================
            audit.set_step("Step 5: Interactive Tools, Systems Wizards & Command Palette")
            page.select_option("#selTheme", "studio-dark")
            page.select_option("#shrShow", "off")
            wait_raf(page, frames=4, delay_ms=150)

            # 6a. Right Panel -> Systems tab -> DOAS + ERV AHU Builder
            page.click('#rightPanel button[data-tab="tabSystems"]')
            page.select_option("#sysToolSel", "ahu")
            ahu_modes = page.eval_on_selector_all("#ahuMode option", "opts => opts.map(o => ({v:o.value, t:o.textContent}))")
            doas_val = next((m["v"] for m in ahu_modes if "doas" in m["v"].lower() or "erv" in m["v"].lower()), "doas_erv")
            page.select_option("#ahuMode", doas_val)
            page.click("#ahuBuildBtn")
            wait_raf(page, frames=5, delay_ms=250)

            ahu_res_txt = page.locator("#ahuResults").inner_text().strip()
            ahu_bad = contains_bad_tokens(ahu_res_txt)
            ahu_nums = re.findall(r"\d+(?:\.\d+)?", ahu_res_txt)
            has_cool_kpi = bool(re.search(r"cool", ahu_res_txt, re.IGNORECASE))
            has_erv_kpi = bool(re.search(r"erv", ahu_res_txt, re.IGNORECASE))
            has_cond_kpi = bool(re.search(r"condensate|water", ahu_res_txt, re.IGNORECASE))
            audit.check(
                "Systems AHU Builder (DOAS+ERV) renders finite cooling/ERV/condensate KPIs",
                bool(has_cool_kpi and has_erv_kpi and has_cond_kpi and not ahu_bad and len(ahu_nums) >= 6),
                f"mode={doas_val!r}, bad={ahu_bad}, text={ahu_res_txt.replace(chr(10), ' | ')!r}",
            )

            # 6b. Left Panel -> Calculator tab -> Non-Tdb pair (Twb=18, RH=50)
            page.click('#leftPanel button[data-tab="tabCalc"]')
            page.select_option("#calcIn1", "Twb")
            page.fill("#calcV1", "18")
            page.select_option("#calcIn2", "RH")
            page.fill("#calcV2", "50")
            page.click("#calcBtn")
            wait_raf(page, frames=3, delay_ms=150)

            calc_res_txt = page.locator("#calcResults").inner_text().strip()
            calc_cmf_txt = page.locator("#calcComfortSummary").inner_text().strip()
            calc_bad = contains_bad_tokens(calc_res_txt + " " + calc_cmf_txt)
            m_tdb = re.search(r"Tdb\s*[:\n\r\s]*(-?\d+(?:\.\d+)?)\s*°C", calc_res_txt, re.IGNORECASE)
            solved_tdb = float(m_tdb.group(1)) if m_tdb else None
            has_pmv_ppd = ("PMV" in calc_cmf_txt) and ("PPD" in calc_cmf_txt)
            audit.check(
                "Calculator solves non-Tdb pair (Twb=18°C, RH=50%) -> Tdb ≈ 25°C + PMV/PPD",
                bool(solved_tdb is not None and 24.0 <= solved_tdb <= 26.5 and has_pmv_ppd and not calc_bad),
                f"solved_Tdb={solved_tdb}, bad={calc_bad}, comfort={calc_cmf_txt.replace(chr(10), ' | ')!r}",
            )

            # 6c. Right Panel -> Coil/Vent tab -> Classroom -> ASHRAE 62.1 Vent calc
            page.click('#rightPanel button[data-tab="tabCoil"]')
            page.select_option("#ventSpaceType", "classroom")
            page.click("#ventCalc")
            wait_raf(page, frames=3, delay_ms=150)

            vent_res_txt = page.locator("#ventResults").inner_text().strip()
            vent_bad = contains_bad_tokens(vent_res_txt)
            has_vbz = bool(re.search(r"Vbz|Breathing Zone", vent_res_txt, re.IGNORECASE)) and bool(re.search(r"\d+(?:\.\d+)?\s*(L/s|CFM)", vent_res_txt))
            has_co2 = bool(re.search(r"\d+(?:,\d+)?(?:\.\d+)?\s*ppm", vent_res_txt, re.IGNORECASE))
            audit.check(
                "ASHRAE 62.1 Ventilation (Classroom) shows finite Vbz and CO₂ ppm",
                bool(has_vbz and has_co2 and not vent_bad),
                f"bad={vent_bad}, text={vent_res_txt.replace(chr(10), ' | ')!r}",
            )

            # 6d. Measure Ruler tool drag across chart center
            page.click("#btnToolMeasure")
            wait_raf(page, frames=2, delay_ms=100)
            ov_box2 = page.locator("#cvOverlay").bounding_box()
            assert ov_box2 is not None
            before_measure_px = inspect_canvas_pixels(page, "#cvOverlay")
            start_x = ov_box2["x"] + ov_box2["width"] * 0.34
            start_y = ov_box2["y"] + ov_box2["height"] * 0.66
            end_x = ov_box2["x"] + ov_box2["width"] * 0.68
            end_y = ov_box2["y"] + ov_box2["height"] * 0.44
            page.mouse.move(start_x, start_y)
            page.mouse.down()
            page.mouse.move(end_x, end_y, steps=12)
            page.mouse.up()
            wait_raf(page, frames=4, delay_ms=200)

            measure_state = page.evaluate(
                """() => {
                    const ui = window.__PSYCHRO__.store.state.ui || {};
                    const banner = document.getElementById('modeBanner')?.innerText?.trim() || '';
                    return {
                        activeTool: ui.activeTool,
                        measureStart: ui.measureStart,
                        measureEnd: ui.measureEnd,
                        banner
                    };
                }"""
            )
            after_measure_px = inspect_canvas_pixels(page, "#cvOverlay")
            m_start = measure_state.get("measureStart")
            m_end = measure_state.get("measureEnd")
            measure_ok = bool(
                measure_state.get("activeTool") == "measure"
                and isinstance(m_start, dict)
                and isinstance(m_end, dict)
                and abs(float(m_end.get("T", 0)) - float(m_start.get("T", 0))) > 2.0
                and after_measure_px.get("nonTransparent", 0) > before_measure_px.get("nonTransparent", 0)
            )
            audit.check(
                "Measure Ruler drag renders live measurement caliper",
                measure_ok,
                f"start={m_start}, end={m_end}, ovPixels {before_measure_px.get('nonTransparent')}->{after_measure_px.get('nonTransparent')}",
            )

            # 6e. Command Palette (Ctrl+K) + search "tokyo"
            # Move cursor to neutral corner and blur active input so top match stays cleanly highlighted
            page.mouse.move(10, 10)
            page.evaluate("() => document.activeElement?.blur?.()")
            page.keyboard.press("Control+k")
            wait_raf(page, frames=3, delay_ms=150)

            cmd_visible = page.evaluate("() => document.getElementById('cmdPaletteOverlay')?.classList.contains('visible') || false")
            page.fill("#cmdInput", "tokyo")
            wait_raf(page, frames=3, delay_ms=150)
            cmd_items = page.evaluate(
                """() => Array.from(document.querySelectorAll('#cmdList > *')).map(el => el.innerText.trim()).filter(Boolean)"""
            )
            tokyo_hits = [t for t in cmd_items if "tokyo" in t.lower()]
            audit.check(
                "Command Palette (Ctrl+K) opens and filters 'tokyo' results",
                bool(cmd_visible and len(tokyo_hits) >= 1),
                f"visible={cmd_visible}, totalItems={len(cmd_items)}, tokyoHits={len(tokyo_hits)}, topResult={cmd_items[0].replace(chr(10), ' | ') if cmd_items else ''!r}",
            )

            shot5 = ARTIFACT_DIR / "shot_05_cmd_palette_and_tools.png"
            page.screenshot(path=str(shot5), full_page=False)
            audit.check("Saved shot_05_cmd_palette_and_tools.png", shot5.exists() and shot5.stat().st_size > 20000, f"{shot5.stat().st_size} B")

            # Close Command Palette via Escape
            page.keyboard.press("Escape")
            wait_raf(page, frames=2, delay_ms=100)
            cmd_closed = page.evaluate("() => !document.getElementById('cmdPaletteOverlay')?.classList.contains('visible')")
            audit.check("Command Palette closes on Escape", bool(cmd_closed))

            # ===============================================================
            # 7. UNDO / REDO & SVG / CSV EXPORT SMOKE TEST
            # ===============================================================
            audit.set_step("Step 6: Undo/Redo & SVG/CSV Export Smoke Test")
            pre_undo = page.evaluate(
                """() => ({
                    undoDisabled: document.getElementById('btnUndo')?.disabled,
                    redoDisabled: document.getElementById('btnRedo')?.disabled,
                    ptCount: window.__PSYCHRO__.store.state.points.length,
                    labels: window.__PSYCHRO__.store.state.points.map(p => p.label)
                })"""
            )
            page.click("#btnUndo")
            wait_raf(page, frames=4, delay_ms=150)
            after_undo = page.evaluate(
                """() => ({
                    undoDisabled: document.getElementById('btnUndo')?.disabled,
                    redoDisabled: document.getElementById('btnRedo')?.disabled,
                    ptCount: window.__PSYCHRO__.store.state.points.length,
                    labels: window.__PSYCHRO__.store.state.points.map(p => p.label)
                })"""
            )
            page.click("#btnRedo")
            wait_raf(page, frames=4, delay_ms=150)
            after_redo = page.evaluate(
                """() => ({
                    undoDisabled: document.getElementById('btnUndo')?.disabled,
                    redoDisabled: document.getElementById('btnRedo')?.disabled,
                    ptCount: window.__PSYCHRO__.store.state.points.length,
                    labels: window.__PSYCHRO__.store.state.points.map(p => p.label)
                })"""
            )
            audit.check(
                "Undo & Redo execute cleanly and restore state",
                bool(
                    pre_undo["undoDisabled"] is False
                    and after_undo["redoDisabled"] is False
                    and after_undo["labels"] != pre_undo["labels"]
                    and after_redo["labels"] == pre_undo["labels"]
                ),
                f"before={pre_undo['labels']}, afterUndo={after_undo['labels']}, afterRedo={after_redo['labels']}",
            )

            export_info = page.evaluate(
                """() => {
                    const exp = window.__PSYCHRO__.Exporter;
                    const st = window.__PSYCHRO__.store;
                    const svg = exp.buildSVGString(st);
                    const csv = typeof exp.buildCSVString === 'function' ? exp.buildCSVString(st) : '';
                    const trimmedSvg = typeof svg === 'string' ? svg.trim() : '';
                    const hasSvgRoot = /^(?:<\\?xml[^>]*\\?>\\s*)?<svg\\b/i.test(trimmedSvg);
                    let xmlValid = false;
                    if (trimmedSvg && typeof DOMParser !== 'undefined') {
                        const doc = new DOMParser().parseFromString(trimmedSvg, 'image/svg+xml');
                        xmlValid = !doc.querySelector('parsererror') && doc.documentElement?.tagName?.toLowerCase() === 'svg';
                    }
                    return {
                        hasSvgRoot,
                        xmlValid,
                        svgEndsWithSvg: trimmedSvg.endsWith('</svg>'),
                        svgPrefix: trimmedSvg.slice(0, 64),
                        svgLen: trimmedSvg.length,
                        svgHasNaN: /\\bNaN\\b/.test(trimmedSvg),
                        svgHasUndefined: /\\bundefined\\b/i.test(trimmedSvg),
                        csvLen: typeof csv === 'string' ? csv.length : 0,
                        csvLines: typeof csv === 'string' ? csv.trim().split(/\\r?\\n/).length : 0,
                        csvHasNaN: /\\bNaN\\b/.test(csv || ''),
                        csvHasUndefined: /\\bundefined\\b/i.test(csv || '')
                    };
                }"""
            )
            audit.check(
                "Exporter.buildSVGString returns valid <svg> > 10 KB with zero NaN/undefined",
                bool(
                    export_info["hasSvgRoot"]
                    and export_info["xmlValid"]
                    and export_info["svgEndsWithSvg"]
                    and export_info["svgLen"] > 10240
                    and not export_info["svgHasNaN"]
                    and not export_info["svgHasUndefined"]
                ),
                f"len={export_info['svgLen']} B, xmlValid={export_info['xmlValid']}, prefix={export_info['svgPrefix']!r}, hasNaN={export_info['svgHasNaN']}, hasUndef={export_info['svgHasUndefined']}",
            )
            audit.check(
                "Exporter.buildCSVString returns non-empty CSV with zero NaN/undefined",
                bool(
                    export_info["csvLen"] > 100
                    and export_info["csvLines"] >= 5
                    and not export_info["csvHasNaN"]
                    and not export_info["csvHasUndefined"]
                ),
                f"len={export_info['csvLen']} B, lines={export_info['csvLines']}, hasNaN={export_info['csvHasNaN']}",
            )

            # ===============================================================
            # 8. RESPONSIVE CHECK (960x700)
            # ===============================================================
            audit.set_step("Step 7: Responsive Compact Viewport Check (960x700)")
            page.set_viewport_size({"width": 960, "height": 700})
            wait_raf(page, frames=6, delay_ms=300)

            resp_info = page.evaluate(
                """() => {
                    const docSW = document.documentElement.scrollWidth;
                    const docCW = document.documentElement.clientWidth;
                    const bodySW = document.body.scrollWidth;
                    const topBar = document.getElementById('topBar');
                    const chartWrap = document.getElementById('chartWrap');
                    const cvBase = document.getElementById('cvBase');
                    return {
                        innerWidth: window.innerWidth,
                        innerHeight: window.innerHeight,
                        docScrollWidth: docSW,
                        docClientWidth: docCW,
                        bodyScrollWidth: bodySW,
                        topBarRect: topBar ? { w: Math.round(topBar.getBoundingClientRect().width), sw: topBar.scrollWidth, h: Math.round(topBar.getBoundingClientRect().height) } : null,
                        chartRect: chartWrap ? { w: Math.round(chartWrap.getBoundingClientRect().width), h: Math.round(chartWrap.getBoundingClientRect().height) } : null,
                        cvBaseRect: cvBase ? { w: Math.round(cvBase.getBoundingClientRect().width), h: Math.round(cvBase.getBoundingClientRect().height) } : null
                    };
                }"""
            )
            audit.check(
                "Zero horizontal overflow at 960x700 (scrollWidth <= 960)",
                bool(resp_info["docScrollWidth"] <= 960 and resp_info["bodyScrollWidth"] <= 960),
                f"{resp_info}",
            )
            audit.check(
                "Chart canvas stays usable & visible at 960x700",
                bool(
                    resp_info["cvBaseRect"]
                    and resp_info["cvBaseRect"]["w"] >= 280
                    and resp_info["cvBaseRect"]["h"] >= 400
                ),
                f"cvBaseRect={resp_info['cvBaseRect']}",
            )

        except Exception as exc:
            traceback.print_exc()
            audit.check("Unhandled exception during E2E execution", False, repr(exc))
        finally:
            # ===============================================================
            # FINAL GLOBAL ERROR GATE
            # ===============================================================
            audit.set_step("Final Gate: Zero Console Errors & Zero Uncaught Page Errors")
            audit.check(
                "Zero console.error messages across entire session",
                len(audit.console_errors) == 0,
                f"count={len(audit.console_errors)}, errors={audit.console_errors}",
            )
            audit.check(
                "Zero uncaught pageerror exceptions across entire session",
                len(audit.page_errors) == 0,
                f"count={len(audit.page_errors)}, errors={audit.page_errors}",
            )
            browser.close()

    # Summary printout
    passed = sum(1 for r in audit.results if r["passed"])
    failed = sum(1 for r in audit.results if not r["passed"])
    print("\n" + "=" * 72)
    print(f"E2E AUDIT SUMMARY: {passed}/{len(audit.results)} passed, {failed} failed")
    print(f"Total console messages captured: {len(audit.console_messages)} "
          f"(errors={len(audit.console_errors)}, pageerrors={len(audit.page_errors)})")
    if audit.console_messages:
        print("All console messages:")
        for cm in audit.console_messages:
            print(f"  [{cm['type']} @ {cm['step']}] {cm['text']}")
    print("=" * 72)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run_audit())
