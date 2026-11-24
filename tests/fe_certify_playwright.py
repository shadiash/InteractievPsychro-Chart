#!/usr/bin/env python3
"""
PsychroChart Ultra 3.0 — Final Front-End Chrome Certification & Visual Sign-Off Suite
=====================================================================================
Runs comprehensive automated certification against the compiled single-file
`index.html` inside real Google Chrome (`/usr/bin/google-chrome`) via Playwright.

Covers:
  1. Zero console.error & zero uncaught pageerror throughout the entire run
  2. Top Bar & Responsive Viewports (1920x1080, 1440x900, 1280x720, 1024x768, 768x1024)
  3. WCAG 2.1 AA Contrast Spot-Check across all 4 built-in themes
  4. Left Panel Deduplication, Scientific Casing & Zero Overflow
  5. Right Panel HVAC Engineering Accuracy, Scenario A/B, Mid-Click Flow Edit & Wizards
  6. Modals, Keyboard Focus, Esc/Enter Semantics & Accessibility (inert, aria-label, Tab)
  7. Canvas, HUD Clearance, Toast Placement, Measure Caliper Esc, Context Menu & Locked Mix Pt
  8. Captures 6 final polished certification screenshots for visual sign-off
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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
            entry = {
                "section": self.current_section,
                "error": str(err),
            }
            self.page_errors.append(entry)
            print(f"  [PAGEERROR @ {self.current_section}] {err}")

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


def load_preset_clean(page: Page, preset_id: str) -> None:
    page.select_option("#selPreset", preset_id)
    wait_raf(page, 4, 150)


def reset_to_clean_default(page: Page) -> None:
    page.evaluate(
        """() => {
            const app = document.getElementById('app');
            if (app) {
                app.classList.remove('left-collapsed', 'right-collapsed');
            }
            const lp = document.getElementById('leftPanel');
            const rp = document.getElementById('rightPanel');
            if (lp) lp.inert = false;
            if (rp) rp.inert = false;
            if (window.__PSYCHRO__?.store) {
                const st = window.__PSYCHRO__.store.state;
                st.ui.leftCollapsed = false;
                st.ui.rightCollapsed = false;
                window.__PSYCHRO__.store.setUnits('SI');
                window.__PSYCHRO__.store.setTheme('studio-dark');
            }
        }"""
    )
    load_preset_clean(page, "summer-ahu")


def check_wcag_contrast_for_theme(page: Page, theme_id: str) -> Dict[str, Any]:
    return page.evaluate(
        """(themeId) => {
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
                // Fallback to --bg if needed
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

            // 1. Buttons
            out['.btn.accent'] = measureEl(document.querySelector('#leftPanel .btn.accent'));
            out['.btn.chip'] = measureEl(document.querySelector('#leftPanel .btn.chip'));
            out['.btn.danger'] = measureEl(document.querySelector('#leftPanel .btn.danger'));

            // 2. Active panel tab
            out['.panelTabs button.active'] = measureEl(document.querySelector('#leftPanel .panelTabs button.active'));

            // 3. Badges inside a real .procCard context (probe inside #processCards)
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
            // --dim probe on --panel and --panel2
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
                const sp = probeCard.querySelector(`[data-probe="${k}"]`);
                out['.badge.' + k] = measureEl(sp);
            }
            out['--dim (on --panel)'] = measureEl(dimPanel);
            out['--dim (on --panel2)'] = measureEl(dimPanel2);
            probeCard.remove();

            // 4. #hud .hud-val over #hud background (composited over --plotBg)
            const hud = document.getElementById('hud');
            if (hud) {
                const prevHidden = hud.classList.contains('hidden');
                const prevHTML = hud.innerHTML;
                hud.classList.remove('hidden');
                hud.innerHTML = '<span class="hud-lbl">Tdb</span> <span class="hud-val">24.0 °C</span>';
                const hudVal = hud.querySelector('.hud-val');
                out['#hud .hud-val'] = measureEl(hudVal);
                hud.innerHTML = prevHTML;
                if (prevHidden) hud.classList.add('hidden');
            }

            return out;
        }""",
        theme_id,
    )


def run_certification() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    runner = CertRunner()

    if not INDEX_HTML.exists():
        print(f"FATAL: {INDEX_HTML} does not exist. Run `node scripts/build.mjs` first.")
        return 1

    url = INDEX_HTML.as_uri()
    print(f"Certifying: {url}")
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
            # 1. INITIAL BOOT & SCREENSHOT 01 (Studio Dark 1440x900)
            # =================================================================
            runner.section("1. Boot & Initial Studio Dark 1440x900")
            page.goto(url, wait_until="load", timeout=25000)
            page.wait_for_function("() => Boolean(window.__PSYCHRO__ && window.__PSYCHRO__.store)", timeout=15000)
            page.evaluate("() => { try { localStorage.clear(); } catch(e) {} }")
            page.reload(wait_until="load", timeout=25000)
            page.wait_for_function("() => Boolean(window.__PSYCHRO__ && window.__PSYCHRO__.store)", timeout=15000)
            wait_raf(page, 5, 250)

            boot_info = page.evaluate(
                """() => {
                    const st = window.__PSYCHRO__.store.state;
                    const cvB = document.getElementById('cvBase');
                    const cvO = document.getElementById('cvOverlay');
                    return {
                        theme: document.getElementById('app')?.dataset?.theme,
                        units: st.units,
                        pts: st.points.length,
                        procs: st.processes.length,
                        basePx: cvB ? [cvB.width, cvB.height] : [0, 0],
                        overlayPx: cvO ? [cvO.width, cvO.height] : [0, 0],
                    };
                }"""
            )
            runner.check(
                "Clean boot with studio-dark, SI, Summer AHU & HiDPI canvases",
                boot_info["theme"] == "studio-dark"
                and boot_info["units"] == "SI"
                and boot_info["pts"] >= 5
                and boot_info["procs"] >= 5
                and boot_info["basePx"][0] > 800
                and boot_info["overlayPx"][0] > 800,
                json.dumps(boot_info),
            )

            clear_toasts(page)
            move_mouse_neutral(page)
            wait_raf(page, 3, 120)
            shot1 = ARTIFACT_DIR / "final_01_studio_dark_1440.png"
            page.screenshot(path=str(shot1))
            runner.check("Captured final_01_studio_dark_1440.png", shot1.exists() and shot1.stat().st_size > 20000, str(shot1.name))

            # =================================================================
            # 2. TOP BAR & RESPONSIVE VIEWPORTS
            # =================================================================
            runner.section("2. Top Bar & Responsive Viewports")

            # Short names & non-truncation check for #selPreset, #selTheme, #selUnits
            sel_info = page.evaluate(
                """() => {
                    const ids = ['selPreset', 'selTheme', 'selUnits'];
                    const probe = document.createElement('span');
                    probe.style.position = 'absolute';
                    probe.style.visibility = 'hidden';
                    probe.style.whiteSpace = 'nowrap';
                    document.body.appendChild(probe);
                    const res = {};
                    for (const id of ids) {
                        const el = document.getElementById(id);
                        const cs = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        const selOpt = el.options[el.selectedIndex];
                        const selText = selOpt ? selOpt.textContent.trim() : '';
                        probe.style.font = cs.font;
                        probe.textContent = selText;
                        const textW = probe.getBoundingClientRect().width;
                        const padL = parseFloat(cs.paddingLeft) || 0;
                        const padR = parseFloat(cs.paddingRight) || 0;
                        const avail = rect.width - padL - padR;
                        res[id] = {
                            selectedText: selText,
                            boxW: Math.round(rect.width * 10) / 10,
                            availW: Math.round(avail * 10) / 10,
                            textW: Math.round(textW * 10) / 10,
                            fits: textW <= avail + 2,
                            options: Array.from(el.options).map(o => o.textContent.trim())
                        };
                    }
                    probe.remove();
                    return res;
                }"""
            )
            runner.check(
                "#selPreset, #selTheme, #selUnits have crisp short names without broken truncation",
                all(v["fits"] and len(v["selectedText"]) > 0 for v in sel_info.values()),
                ", ".join(f"{k}='{v['selectedText']}' ({v['textW']}px/{v['availW']}px)" for k, v in sel_info.items()),
            )

            # Check desktop viewports: 1920x1080, 1440x900, 1280x720, 1024x768
            for vw, vh in [(1920, 1080), (1440, 900), (1280, 720), (1024, 768)]:
                page.set_viewport_size({"width": vw, "height": vh})
                wait_raf(page, 4, 150)

                vp_metrics = page.evaluate(
                    """() => {
                        const tb = document.getElementById('topBar');
                        const btnR = document.getElementById('btnToggleRight');
                        const tbRect = tb.getBoundingClientRect();
                        const btnRect = btnR.getBoundingClientRect();
                        const clippedBtns = [];
                        for (const b of tb.querySelectorAll('button')) {
                            const cs = getComputedStyle(b);
                            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                            const r = b.getBoundingClientRect();
                            if (r.width === 0 || r.height === 0) continue;
                            if (r.right > window.innerWidth + 1.5 || r.left < -1.5) {
                                clippedBtns.push({ id: b.id, left: Math.round(r.left), right: Math.round(r.right) });
                            }
                        }
                        const ct = document.getElementById('chartToolbar');
                        const ctRect = ct ? ct.getBoundingClientRect() : { height: 0 };
                        return {
                            vw: window.innerWidth,
                            topBarScrollW: tb.scrollWidth,
                            topBarClientW: tb.clientWidth,
                            topBarOverflow: tb.scrollWidth - tb.clientWidth,
                            btnRVisible: btnRect.width > 0 && btnRect.height > 0 && btnRect.right <= window.innerWidth + 1.5 && btnRect.left >= 0,
                            btnRRect: { left: Math.round(btnRect.left), right: Math.round(btnRect.right), w: Math.round(btnRect.width) },
                            clippedBtns,
                            chartToolbarH: Math.round(ctRect.height),
                            docOverflow: document.documentElement.scrollWidth - window.innerWidth
                        };
                    }"""
                )

                if vw in (1920, 1440):
                    runner.check(
                        f"Viewport {vw}x{vh}: #topBar zero horizontal overflow",
                        vp_metrics["topBarOverflow"] <= 2,
                        f"scrollW={vp_metrics['topBarScrollW']}, clientW={vp_metrics['topBarClientW']}",
                    )

                # Test #btnToggleRight visibility and clickability across all desktop widths
                runner.check(
                    f"Viewport {vw}x{vh}: #btnToggleRight visible inside viewport",
                    vp_metrics["btnRVisible"] and len(vp_metrics["clippedBtns"]) == 0,
                    f"btnR={vp_metrics['btnRRect']}, clipped={vp_metrics['clippedBtns']}, topBarOverflow={vp_metrics['topBarOverflow']}",
                )
                page.click("#btnToggleRight")
                wait_raf(page, 2, 100)
                collapsed_after = page.evaluate("() => document.getElementById('app').classList.contains('right-collapsed')")
                page.click("#btnToggleRight")
                wait_raf(page, 2, 100)
                restored_after = page.evaluate("() => !document.getElementById('app').classList.contains('right-collapsed')")
                runner.check(
                    f"Viewport {vw}x{vh}: #btnToggleRight clickable toggle works",
                    collapsed_after and restored_after,
                    f"collapsed={collapsed_after}, restored={restored_after}",
                )

                if vw == 1280:
                    clear_toasts(page)
                    move_mouse_neutral(page)
                    wait_raf(page, 3, 120)
                    shot6 = ARTIFACT_DIR / "final_06_responsive_1280.png"
                    page.screenshot(path=str(shot6))
                    runner.check(
                        "Captured final_06_responsive_1280.png (non-bloated toolbar)",
                        shot6.exists() and shot6.stat().st_size > 20000 and vp_metrics["chartToolbarH"] <= 92,
                        f"toolbarH={vp_metrics['chartToolbarH']}px, topBarOverflow={vp_metrics['topBarOverflow']}px",
                    )

            # Check 768x1024 responsive portrait layout
            page.set_viewport_size({"width": 768, "height": 1024})
            wait_raf(page, 4, 150)
            mobile_metrics = page.evaluate(
                """() => {
                    window.scrollTo(0, 300);
                    const sy = window.scrollY;
                    const docScrollH = document.documentElement.scrollHeight;
                    const docScrollW = document.documentElement.scrollWidth;
                    const vw = window.innerWidth;
                    window.scrollTo(0, 0);
                    return { sy, docScrollH, docScrollW, vw, horizOverflow: docScrollW - vw };
                }"""
            )
            runner.check(
                "Viewport 768x1024: vertical scroll works (scrollY > 0) & zero horizontal overflow",
                mobile_metrics["sy"] > 0 and mobile_metrics["horizOverflow"] <= 2,
                json.dumps(mobile_metrics),
            )

            # Restore 1440x900 for all subsequent tests
            page.set_viewport_size({"width": 1440, "height": 900})
            wait_raf(page, 4, 150)

            # =================================================================
            # 3. WCAG 2.1 AA CONTRAST SPOT-CHECK ACROSS ALL 4 BUILT-IN THEMES
            # =================================================================
            runner.section("3. WCAG 2.1 AA Contrast Spot-Check (4 Built-In Themes)")
            for theme_id in ["studio-dark", "drafting-light", "ashrae-classic", "blueprint-cad"]:
                page.select_option("#selTheme", theme_id)
                wait_raf(page, 3, 120)
                ratios = check_wcag_contrast_for_theme(page, theme_id)
                failures = []
                summary_parts = []
                for sel, info in ratios.items():
                    if not info:
                        failures.append(f"{sel}=MISSING")
                        continue
                    r = info["ratio"]
                    summary_parts.append(f"{sel}:{r:.2f}")
                    if r < 4.5:
                        failures.append(f"{sel}={r:.2f} (fg={info['fg']} on bg={info['bg']})")
                runner.check(
                    f"Theme '{theme_id}': all checked UI tokens meet WCAG 2.1 AA (>= 4.5:1)",
                    len(failures) == 0,
                    "ALL PASS [" + ", ".join(summary_parts) + "]" if not failures else "FAILURES: " + "; ".join(failures),
                )

            # Back to studio-dark
            page.select_option("#selTheme", "studio-dark")
            wait_raf(page, 3, 120)

            # =================================================================
            # 4. LEFT PANEL DEDUPLICATION, SCIENTIFIC CASING & ZERO OVERFLOW
            # =================================================================
            runner.section("4. Left Panel Deduplication, Scientific Casing & Zero Overflow")

            # Confirm removed duplicate elements do not exist
            removed_check = page.evaluate(
                """() => ({
                    btnFit: document.getElementById('btnFit') !== null,
                    btnResetZoom: document.getElementById('btnResetZoom') !== null,
                    chkFlowAnim: document.getElementById('chkFlowAnim') !== null,
                    legendCount: document.querySelectorAll('.legend').length
                })"""
            )
            runner.check(
                "Removed duplicate controls (#btnFit, #btnResetZoom, #chkFlowAnim, .legend)",
                not removed_check["btnFit"]
                and not removed_check["btnResetZoom"]
                and not removed_check["chkFlowAnim"]
                and removed_check["legendCount"] == 0,
                json.dumps(removed_check),
            )

            # Points tab: #ptsTbl inside 360px #leftPanel zero overflow & all 4 action buttons visible + aria-label
            page.click("#tabBtnPoints")
            wait_raf(page, 3, 120)
            pts_tbl_metrics = page.evaluate(
                """() => {
                    const lp = document.getElementById('leftPanel');
                    const lpRect = lp.getBoundingClientRect();
                    const tbl = document.getElementById('ptsTbl');
                    const wrap = tbl.closest('.table-scroll');
                    const rows = Array.from(tbl.querySelectorAll('tbody tr'));
                    let minBtnsPerRow = Infinity;
                    let allBtnsVisible = true;
                    let missingAria = [];
                    let maxBtnRight = 0;
                    for (const tr of rows) {
                        const btns = Array.from(tr.querySelectorAll('button'));
                        minBtnsPerRow = Math.min(minBtnsPerRow, btns.length);
                        for (const b of btns) {
                            const r = b.getBoundingClientRect();
                            maxBtnRight = Math.max(maxBtnRight, r.right);
                            if (r.width === 0 || r.height === 0 || r.right > lpRect.right + 1.5) {
                                allBtnsVisible = false;
                            }
                            const txt = (b.textContent || '').trim();
                            // Icon-only buttons (1-2 chars or symbols) must have aria-label
                            if (!b.getAttribute('aria-label') || !b.getAttribute('aria-label').trim()) {
                                missingAria.push({ row: tr.rowIndex, text: txt, title: b.title });
                            }
                        }
                    }
                    return {
                        leftW: Math.round(lpRect.width),
                        tblScrollW: tbl.scrollWidth,
                        tblClientW: tbl.clientWidth,
                        wrapScrollW: wrap ? wrap.scrollWidth : 0,
                        wrapClientW: wrap ? wrap.clientWidth : 0,
                        rowCount: rows.length,
                        minBtnsPerRow,
                        allBtnsVisible,
                        maxBtnRight: Math.round(maxBtnRight),
                        lpRight: Math.round(lpRect.right),
                        missingAria
                    };
                }"""
            )
            runner.check(
                "#ptsTbl inside 360px #leftPanel: zero overflow & all 4 action buttons visible",
                pts_tbl_metrics["tblScrollW"] <= pts_tbl_metrics["tblClientW"] + 2
                and pts_tbl_metrics["wrapScrollW"] <= pts_tbl_metrics["wrapClientW"] + 2
                and pts_tbl_metrics["minBtnsPerRow"] == 4
                and pts_tbl_metrics["allBtnsVisible"],
                json.dumps({k: v for k, v in pts_tbl_metrics.items() if k != "missingAria"}),
            )
            runner.check(
                "All dynamic icon-only buttons in #ptsTbl have aria-label",
                len(pts_tbl_metrics["missingAria"]) == 0,
                f"missing={pts_tbl_metrics['missingAria']}",
            )

            # Capture final_02_drafting_light_ip_pts.png (Drafting Light + IP + Points tab)
            page.select_option("#selTheme", "drafting-light")
            page.select_option("#selUnits", "IP")
            wait_raf(page, 4, 180)
            pts_ip_overflow = page.evaluate(
                """() => {
                    const tbl = document.getElementById('ptsTbl');
                    const wrap = tbl.closest('.table-scroll');
                    return {
                        tblOverflow: tbl.scrollWidth - tbl.clientWidth,
                        wrapOverflow: wrap ? wrap.scrollWidth - wrap.clientWidth : 0
                    };
                }"""
            )
            clear_toasts(page)
            move_mouse_neutral(page)
            wait_raf(page, 3, 120)
            shot2 = ARTIFACT_DIR / "final_02_drafting_light_ip_pts.png"
            page.screenshot(path=str(shot2))
            runner.check(
                "Captured final_02_drafting_light_ip_pts.png (Drafting Light + IP + zero-overflow #ptsTbl)",
                shot2.exists() and shot2.stat().st_size > 20000 and pts_ip_overflow["wrapOverflow"] <= 2,
                f"ipOverflow={pts_ip_overflow}",
            )

            # Restore studio-dark & SI
            page.select_option("#selTheme", "studio-dark")
            page.select_option("#selUnits", "SI")
            wait_raf(page, 3, 120)

            # Calculator tab checks
            page.click("#tabBtnCalc")
            wait_raf(page, 3, 120)
            page.click("#calcBtn")
            wait_raf(page, 3, 120)

            calc_casing = page.evaluate(
                """() => {
                    const el = document.getElementById('calcResults');
                    const rendered = el ? el.innerText : '';
                    return {
                        hasRhoMoist: rendered.includes('ρ_moist'),
                        hasMu: rendered.includes('μ'),
                        hasUpperRho: rendered.includes('Ρ_MOIST'),
                        hasUpperMu: /(?:^|\\s)Μ(?:\\s|$|:)/.test(rendered),
                        sample: rendered.slice(0, 320).replace(/\\n+/g, ' | ')
                    };
                }"""
            )
            runner.check(
                "#calcResults preserves scientific casing (ρ_moist and μ, NOT Ρ_MOIST / Μ)",
                calc_casing["hasRhoMoist"]
                and calc_casing["hasMu"]
                and not calc_casing["hasUpperRho"]
                and not calc_casing["hasUpperMu"],
                json.dumps(calc_casing),
            )

            # Generate psychrometric saturation table
            page.click("#tblGen")
            wait_raf(page, 3, 120)
            psy_tbl = page.evaluate(
                """() => {
                    const wrap = document.getElementById('psyTableWrap');
                    const tbl = wrap ? wrap.querySelector('table') : null;
                    const ths = tbl ? Array.from(tbl.querySelectorAll('thead th')) : [];
                    const wrapRect = wrap.getBoundingClientRect();
                    const allColsVisible = ths.length === 6 && ths.every(th => th.getBoundingClientRect().right <= wrapRect.right + 2);
                    const rendered = wrap.innerText || '';
                    return {
                        scrollW: wrap.scrollWidth,
                        clientW: wrap.clientWidth,
                        overflow: wrap.scrollWidth - wrap.clientWidth,
                        colCount: ths.length,
                        allColsVisible,
                        headers: ths.map(t => t.innerText.trim()),
                        hasKPa: rendered.includes('kPa'),
                        hasKJkg: rendered.includes('kJ/kg'),
                        hasGkg: rendered.includes('g/kg'),
                        hasUpperBad: rendered.includes('KPA') || rendered.includes('KJ/KG') || rendered.includes('G/KG')
                    };
                }"""
            )
            runner.check(
                "#psyTableWrap zero overflow & all 6 columns visible",
                psy_tbl["overflow"] <= 2 and psy_tbl["colCount"] == 6 and psy_tbl["allColsVisible"],
                f"scrollW={psy_tbl['scrollW']}, clientW={psy_tbl['clientW']}, headers={psy_tbl['headers']}",
            )
            runner.check(
                "#psyTableWrap preserves scientific unit casing (kPa, kJ/kg, g/kg — NOT KPA/KJ/KG)",
                psy_tbl["hasKPa"] and psy_tbl["hasKJkg"] and psy_tbl["hasGkg"] and not psy_tbl["hasUpperBad"],
                f"headers={psy_tbl['headers']}",
            )

            # Switching #calcIn1 from Tdb to v does NOT flash a red error
            clear_toasts(page)
            page.select_option("#calcIn1", "v")
            wait_raf(page, 3, 150)
            v_switch = page.evaluate(
                """() => {
                    const res = document.getElementById('calcResults');
                    const errToasts = document.querySelectorAll('#toastContainer .toast.error').length;
                    const hasErrClass = Boolean(res && (res.querySelector('.error, .calc-err, .warn-err') || res.classList.contains('error')));
                    const txt = res ? res.innerText : '';
                    const hasErrText = /\\b(error|failed|invalid|cannot solve|impossible)\\b/i.test(txt);
                    const val1 = document.getElementById('calcV1')?.value;
                    return { errToasts, hasErrClass, hasErrText, val1, snippet: txt.slice(0, 180).replace(/\\n+/g, ' | ') };
                }"""
            )
            runner.check(
                "Switching #calcIn1 from Tdb to v does NOT flash a red error",
                v_switch["errToasts"] == 0 and not v_switch["hasErrClass"] and not v_switch["hasErrText"],
                json.dumps(v_switch),
            )
            # Reset #calcIn1 back to Tdb
            page.select_option("#calcIn1", "Tdb")
            wait_raf(page, 2, 80)

            # =================================================================
            # 5. RIGHT PANEL HVAC ENGINEERING ACCURACY & UX
            # =================================================================
            runner.section("5. Right Panel HVAC Engineering Accuracy & UX")
            reset_to_clean_default(page)
            page.click("#tabBtnProc")
            wait_raf(page, 3, 140)

            # Summer AHU #cycleSummary mechanical cooling ~107.5 kW (NOT 138.8 kW!)
            # S1/S2 badged MIXING, S5 badged SPACE LOAD
            proc_audit = page.evaluate(
                """() => {
                    const summaryText = document.getElementById('cycleSummary')?.innerText || '';
                    const cards = Array.from(document.querySelectorAll('#processCards .procCard')).map(c => ({
                        id: c.dataset.pid || c.dataset.id || '',
                        text: c.innerText.replace(/\\n+/g, ' | '),
                        badges: Array.from(c.querySelectorAll('.badge')).map(b => b.innerText.trim().toUpperCase())
                    }));
                    return { summaryText: summaryText.replace(/\\n+/g, ' | '), cards };
                }"""
            )
            m_cool = re.search(r"Cooling[^\d-]*([+-]?\d+(?:\.\d+)?)\s*kW", proc_audit["summaryText"], re.I)
            cool_kw = abs(float(m_cool.group(1))) if m_cool else None
            runner.check(
                "Default Summer AHU #cycleSummary Mechanical Cooling ~107.5 kW (NOT 138.8 kW)",
                cool_kw is not None and 103.0 <= cool_kw <= 112.0,
                f"parsed={cool_kw} kW | summary='{proc_audit['summaryText']}'",
            )

            s1_card = next((c for c in proc_audit["cards"] if "S1" in c["text"]), None)
            s2_card = next((c for c in proc_audit["cards"] if "S2" in c["text"]), None)
            s5_card = next((c for c in proc_audit["cards"] if "S5" in c["text"]), None)
            runner.check(
                "Summer AHU badges: S1/S2 badged MIXING, S5 badged SPACE LOAD",
                bool(s1_card and any("MIXING" in b for b in s1_card["badges"]))
                and bool(s2_card and any("MIXING" in b for b in s2_card["badges"]))
                and bool(s5_card and any("SPACE LOAD" in b for b in s5_card["badges"])),
                f"S1={s1_card['badges'] if s1_card else None}, S2={s2_card['badges'] if s2_card else None}, S5={s5_card['badges'] if s5_card else None}",
            )

            # Coil/Vent tab: #adpProc defaults to S3 and #adpCalc succeeds on first click
            page.click("#tabBtnCoil")
            wait_raf(page, 3, 120)
            adp_default = page.evaluate(
                """() => {
                    const sel = document.getElementById('adpProc');
                    const opt = sel && sel.options[sel.selectedIndex];
                    return { value: sel?.value, text: opt ? opt.textContent.trim() : '' };
                }"""
            )
            page.click("#adpCalc")
            wait_raf(page, 3, 120)
            adp_res = page.evaluate(
                """() => {
                    const el = document.getElementById('adpResults');
                    const txt = el ? el.innerText.replace(/\\n+/g, ' | ') : '';
                    const hasAdp = /ADP/i.test(txt) && /\\d+\\.\\d+\\s*°C/.test(txt);
                    const hasBpf = /BPF|Bypass/i.test(txt);
                    const hasErr = /not a cooling|no valid|cannot|error/i.test(txt);
                    return { hasAdp, hasBpf, hasErr, txt: txt.slice(0, 260) };
                }"""
            )
            runner.check(
                "#adpProc defaults to S3 and #adpCalc succeeds on first click",
                "S3" in adp_default["text"] and adp_res["hasAdp"] and adp_res["hasBpf"] and not adp_res["hasErr"],
                f"default='{adp_default['text']}', adpRes='{adp_res['txt']}'",
            )

            # Scenario A/B comparison: Save Summer AHU as Baseline, load DOAS + ERV, Compare
            page.click("#tabBtnMix")
            wait_raf(page, 3, 120)
            page.fill("#scenName", "Baseline Summer AHU")
            page.click("#btnSaveScen")
            wait_raf(page, 3, 120)

            scen_aria = page.evaluate(
                """() => {
                    const btns = Array.from(document.querySelectorAll('#scenList button'));
                    const missing = [];
                    for (const b of btns) {
                        const txt = (b.textContent || '').trim();
                        const isIconOnly = txt.length <= 2 || /^[^A-Za-z0-9]+$/.test(txt);
                        if (isIconOnly && (!b.getAttribute('aria-label') || !b.getAttribute('aria-label').trim())) {
                            missing.push({ text: txt, title: b.title, cls: b.className });
                        }
                    }
                    return { totalBtns: btns.length, missing };
                }"""
            )
            runner.check(
                "All dynamic icon-only buttons in #scenList have aria-label",
                scen_aria["totalBtns"] > 0 and len(scen_aria["missing"]) == 0,
                json.dumps(scen_aria),
            )

            # Load DOAS + ERV and compare against saved Baseline Summer AHU
            load_preset_clean(page, "doas-erv")
            page.click("#tabBtnMix")
            wait_raf(page, 3, 120)
            compare_clicked = page.evaluate(
                """() => {
                    const btns = Array.from(document.querySelectorAll('#scenList button'));
                    const cmp = btns.find(b => /compare/i.test(b.getAttribute('aria-label') || b.title || b.textContent || ''));
                    if (cmp) { cmp.click(); return true; }
                    return false;
                }"""
            )
            wait_raf(page, 3, 140)
            scen_cmp = page.evaluate(
                """() => {
                    const el = document.getElementById('scenCompareSummary');
                    return el ? el.innerText.replace(/\\n+/g, ' | ') : '';
                }"""
            )
            m_pct = re.search(r"([+-]?\d+(?:\.\d+)?)\s*%", scen_cmp)
            pct_val = float(m_pct.group(1)) if m_pct else None
            runner.check(
                "Scenario A/B Compare (Summer AHU vs DOAS+ERV) shows ENERGY SAVED (~30% reduction)",
                compare_clicked
                and "ENERGY SAVED" in scen_cmp.upper()
                and pct_val is not None
                and 18.0 <= abs(pct_val) <= 45.0
                and "+13.7%" not in scen_cmp,
                f"pct={pct_val}% | summary='{scen_cmp}'",
            )

            # Turn off comparison & reload Summer AHU
            page.evaluate(
                """() => {
                    const st = window.__PSYCHRO__.store.state;
                    st.compareScenarioId = null;
                    window.__PSYCHRO__.store.emit('change');
                }"""
            )
            load_preset_clean(page, "summer-ahu")

            # Mid-click .procCard flow edit: select S1, type 1250 in #flowVal, immediately click S3
            page.click("#tabBtnProc")
            wait_raf(page, 3, 120)
            page.locator("#processCards .procCard", has_text="S1").first.click()
            wait_raf(page, 2, 80)
            page.click("#flowVal")
            page.fill("#flowVal", "1250")
            # Immediately click card S3 without blurring first
            page.locator("#processCards .procCard", has_text="S3").first.click()
            wait_raf(page, 3, 120)
            midclick_state = page.evaluate(
                """() => {
                    const st = window.__PSYCHRO__.store.state;
                    const selProc = st.processes.find(p => p.id === st.ui.selectedProcId);
                    const s1Proc = st.processes.find(p => p.label === 'S1' || p.id === 1) || st.processes[0];
                    const activeCard = document.querySelector('#processCards .procCard.active, #processCards .procCard.selected');
                    const selEl = document.getElementById('procSel');
                    const selText = selEl && selEl.options[selEl.selectedIndex] ? selEl.options[selEl.selectedIndex].textContent : '';
                    return {
                        selectedProcId: st.ui.selectedProcId,
                        selectedProcIdx: st.processes.findIndex(p => p.id === st.ui.selectedProcId) + 1,
                        selText,
                        activeCardText: activeCard ? activeCard.innerText.replace(/\\n+/g, ' | ') : '',
                        s1FlowVal: s1Proc?.flowVal
                    };
                }"""
            )
            runner.check(
                "Mid-click .procCard flow edit: typing 1250 in S1 #flowVal then clicking S3 selects S3",
                "S3" in midclick_state["selText"] and "S3" in midclick_state["activeCardText"],
                json.dumps(midclick_state),
            )

            # #mWater in IP mode zero horizontal overflow (S3 is selected -> active condensate!)
            page.select_option("#selUnits", "IP")
            wait_raf(page, 3, 140)
            mwater_ip = page.evaluate(
                """() => {
                    const valEl = document.getElementById('mWater');
                    const boxEl = valEl ? valEl.closest('.metric') : null;
                    return {
                        text: valEl ? valEl.innerText.trim() : '',
                        valScrollW: valEl ? valEl.scrollWidth : 0,
                        valClientW: valEl ? valEl.clientWidth : 0,
                        boxScrollW: boxEl ? boxEl.scrollWidth : 0,
                        boxClientW: boxEl ? boxEl.clientWidth : 0
                    };
                }"""
            )
            runner.check(
                "#mWater in IP mode has zero horizontal overflow",
                len(mwater_ip["text"]) > 0
                and mwater_ip["valScrollW"] <= mwater_ip["valClientW"] + 2
                and mwater_ip["boxScrollW"] <= mwater_ip["boxClientW"] + 2,
                json.dumps(mwater_ip),
            )

            # System Wizards: SI -> IP immediate update on #ahuResults, #humTargetW valid in IP, winter_humid hides ERV/Cooling Coil
            page.select_option("#selUnits", "SI")
            wait_raf(page, 3, 120)
            page.click("#tabBtnSystems")
            wait_raf(page, 3, 120)
            page.select_option("#sysToolSel", "ahu")
            page.select_option("#ahuMode", "summer_reheat")
            page.click("#ahuBuildBtn")
            wait_raf(page, 4, 150)
            ahu_si_txt = page.evaluate("() => document.getElementById('ahuResults')?.innerText || ''")
            # Switch SI -> IP without re-clicking Build
            page.select_option("#selUnits", "IP")
            wait_raf(page, 4, 150)
            ahu_ip_txt = page.evaluate("() => document.getElementById('ahuResults')?.innerText || ''")
            runner.check(
                "AHU Wizard: switching SI -> IP immediately updates #ahuResults to °F / TR / MBH (or BTU/h)",
                "°C" in ahu_si_txt
                and "°F" in ahu_ip_txt
                and "TR" in ahu_ip_txt
                and ("MBH" in ahu_ip_txt or "BTU/h" in ahu_ip_txt),
                f"IP snippet='{ahu_ip_txt[:220].replace(chr(10), ' | ')}'",
            )

            # Humidifier #humTargetW checkValidity() === true in IP mode
            page.select_option("#sysToolSel", "humidifier")
            wait_raf(page, 3, 120)
            hum_valid = page.evaluate(
                """() => {
                    const el = document.getElementById('humTargetW');
                    return {
                        value: el?.value,
                        min: el?.min,
                        max: el?.max,
                        step: el?.step,
                        valid: el ? el.checkValidity() : false,
                        msg: el ? el.validationMessage : ''
                    };
                }"""
            )
            runner.check(
                "Humidifier #humTargetW is checkValidity() === true in IP mode",
                hum_valid["valid"] is True,
                json.dumps(hum_valid),
            )

            # AHU winter_humid hides ERV & Cooling Coil fields
            page.select_option("#sysToolSel", "ahu")
            wait_raf(page, 2, 80)
            page.select_option("#ahuMode", "winter_humid")
            wait_raf(page, 3, 120)
            winter_hidden = page.evaluate(
                """() => {
                    const ids = ['ahuErvSens', 'ahuErvLat', 'ahuCoilAdp', 'ahuCoilBpf'];
                    const res = {};
                    for (const id of ids) {
                        const el = document.getElementById(id);
                        const hidden = !el || el.offsetParent === null || getComputedStyle(el).display === 'none';
                        res[id] = hidden;
                    }
                    return res;
                }"""
            )
            runner.check(
                "AHU winter_humid hides ERV and Cooling Coil fields",
                all(winter_hidden.values()),
                json.dumps(winter_hidden),
            )

            # Restore clean Summer AHU SI
            page.select_option("#ahuMode", "summer_reheat")
            reset_to_clean_default(page)

            # =================================================================
            # 6. MODALS, KEYBOARD FOCUS & ACCESSIBILITY
            # =================================================================
            runner.section("6. Modals, Keyboard Focus & Accessibility")

            def snap_model() -> str:
                return page.evaluate(
                    """() => JSON.stringify({
                        pts: window.__PSYCHRO__.store.state.points.map(p => ({ id: p.id, label: p.label, T: Math.round(p.T*1e4), w: Math.round(p.w*1e6) })),
                        procs: window.__PSYCHRO__.store.state.processes.map(pr => ({ id: pr.id, a: pr.a, b: pr.b }))
                    })"""
                )

            def is_overlay_open(overlay_id: str) -> bool:
                return page.evaluate(
                    """(id) => {
                        const el = document.getElementById(id);
                        if (!el) return false;
                        const cs = getComputedStyle(el);
                        return el.classList.contains('open') || el.classList.contains('show') || (cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05);
                    }""",
                    overlay_id,
                )

            # 6a. Enter on #epCancel closes modal WITHOUT mutating points
            before_ep = snap_model()
            page.evaluate("() => window.__PSYCHRO__.modals.openEditPoint(window.__PSYCHRO__.store.state.points[0].id)")
            wait_raf(page, 2, 100)
            page.fill("#epLabel", "SHOULD_NOT_SAVE")
            page.focus("#epCancel")
            page.keyboard.press("Enter")
            wait_raf(page, 2, 100)
            runner.check(
                "Enter on #epCancel closes #editPtOverlay without mutating points/processes",
                (not is_overlay_open("editPtOverlay")) and snap_model() == before_ep,
                f"open={is_overlay_open('editPtOverlay')}, unchanged={snap_model() == before_ep}",
            )

            # 6b. Enter on #apCancel closes modal WITHOUT mutating points
            before_ap = snap_model()
            page.evaluate("() => window.__PSYCHRO__.modals.openAddPointParam(25, 0.010)")
            wait_raf(page, 2, 100)
            page.fill("#apLabel", "SHOULD_NOT_ADD")
            page.focus("#apCancel")
            page.keyboard.press("Enter")
            wait_raf(page, 2, 100)
            runner.check(
                "Enter on #apCancel closes #addPtParamOverlay without mutating points/processes",
                (not is_overlay_open("addPtParamOverlay")) and snap_model() == before_ap,
                f"open={is_overlay_open('addPtParamOverlay')}, unchanged={snap_model() == before_ap}",
            )

            # 6c. Enter on #mixFlowCancel closes modal WITHOUT mutating points/processes
            before_mx = snap_model()
            page.evaluate(
                """() => {
                    const pts = window.__PSYCHRO__.store.state.points;
                    window.__PSYCHRO__.modals.openMixFlow(pts[0].id, pts[1].id);
                }"""
            )
            wait_raf(page, 2, 100)
            page.fill("#mixFlowLabel", "SHOULD_NOT_MIX")
            page.focus("#mixFlowCancel")
            page.keyboard.press("Enter")
            wait_raf(page, 2, 100)
            runner.check(
                "Enter on #mixFlowCancel closes #mixFlowOverlay without mutating points/processes",
                (not is_overlay_open("mixFlowOverlay")) and snap_model() == before_mx,
                f"open={is_overlay_open('mixFlowOverlay')}, unchanged={snap_model() == before_mx}",
            )

            # 6d. #reportOverlay focus, metadata fields, 4 keyboard-reachable format radios, Screenshot 05, Enter on #rptCancel
            before_rp = snap_model()
            clear_toasts(page)
            move_mouse_neutral(page)
            page.click("#btnReport")
            wait_raf(page, 3, 150)
            rpt_audit = page.evaluate(
                """() => {
                    const ov = document.getElementById('reportOverlay');
                    const focusInside = Boolean(ov && ov.contains(document.activeElement));
                    const activeId = document.activeElement?.id || document.activeElement?.tagName;
                    const fieldsVisible = ['companyName', 'engineerName', 'projNotes'].every(id => {
                        const el = document.getElementById(id);
                        return el && el.offsetParent !== null;
                    });
                    const radios = Array.from(ov.querySelectorAll('input[type="radio"][name="rptFmt"]'));
                    let reachable = 0;
                    for (const r of radios) {
                        const cs = getComputedStyle(r);
                        if (cs.display !== 'none' && cs.visibility !== 'hidden' && !r.disabled) {
                            r.focus();
                            if (document.activeElement === r) reachable++;
                        }
                    }
                    // Reset first radio checked for clean visual screenshot
                    if (radios[0]) { radios[0].checked = true; }
                    return { focusInside, activeId, fieldsVisible, radioCount: radios.length, reachable };
                }"""
            )
            runner.check(
                "#reportOverlay moves focus inside, shows metadata fields & 4 keyboard-reachable format radios",
                rpt_audit["focusInside"]
                and rpt_audit["fieldsVisible"]
                and rpt_audit["radioCount"] == 4
                and rpt_audit["reachable"] == 4,
                json.dumps(rpt_audit),
            )

            # Populate realistic project metadata and capture final_05_report_modal_meta.png
            page.fill("#companyName", "Apex Mechanical Engineering")
            page.fill("#engineerName", "S. Alashkar, PE")
            page.fill("#projNotes", "ASHRAE 2021 Summer AHU Design Verification — 101.325 kPa sea level")
            wait_raf(page, 2, 100)
            shot5 = ARTIFACT_DIR / "final_05_report_modal_meta.png"
            page.screenshot(path=str(shot5))
            runner.check("Captured final_05_report_modal_meta.png", shot5.exists() and shot5.stat().st_size > 20000, shot5.name)

            page.focus("#rptCancel")
            page.keyboard.press("Enter")
            wait_raf(page, 2, 100)
            runner.check(
                "Enter on #rptCancel closes #reportOverlay without mutating points/processes",
                (not is_overlay_open("reportOverlay")) and snap_model() == before_rp,
                f"open={is_overlay_open('reportOverlay')}, unchanged={snap_model() == before_rp}",
            )

            # 6e. Opening #aboutOverlay while in Process tool & pressing Escape keeps activeTool === 'process'
            page.click("#btnToolProcess")
            wait_raf(page, 2, 80)
            page.click("#btnAbout")
            wait_raf(page, 2, 100)
            about_opened = is_overlay_open("aboutOverlay")
            page.keyboard.press("Escape")
            wait_raf(page, 2, 100)
            about_closed = not is_overlay_open("aboutOverlay")
            tool_after_esc = page.evaluate("() => window.__PSYCHRO__.store.state.ui.activeTool")
            runner.check(
                "Opening #aboutOverlay in Process tool & pressing Escape closes modal while keeping activeTool === 'process'",
                about_opened and about_closed and tool_after_esc == "process",
                f"opened={about_opened}, closed={about_closed}, activeTool='{tool_after_esc}'",
            )
            page.click("#btnToolSelect")
            wait_raf(page, 2, 60)

            # 6f. Ctrl+K opens Command Palette cleanly (single render) & Ctrl+K toggles it closed
            page.keyboard.press("Control+k")
            wait_raf(page, 2, 120)
            cmd_info = page.evaluate(
                """() => {
                    const ov = document.getElementById('cmdPaletteOverlay');
                    const items = Array.from(document.querySelectorAll('#cmdList .cmd-item, #cmdList [role="option"]'));
                    const labels = items.map(i => i.innerText.trim());
                    const unique = new Set(labels);
                    return {
                        open: ov?.classList.contains('open') || getComputedStyle(ov).display !== 'none',
                        count: items.length,
                        uniqueCount: unique.size,
                        focusInInput: document.activeElement?.id === 'cmdInput'
                    };
                }"""
            )
            page.keyboard.press("Control+k")
            wait_raf(page, 2, 100)
            cmd_closed = not is_overlay_open("cmdPaletteOverlay")
            runner.check(
                "Ctrl+K opens Command Palette cleanly (single render) & Ctrl+K toggles it closed",
                cmd_info["open"]
                and cmd_info["count"] > 10
                and cmd_info["count"] == cmd_info["uniqueCount"]
                and cmd_closed,
                f"openInfo={cmd_info}, toggledClosed={cmd_closed}",
            )

            # 6g. #themeEditorOverlay: changing #ct_sat then clicking Close reverts customTheme.sat
            orig_sat = page.evaluate("() => window.__PSYCHRO__.store.state.customTheme.sat")
            test_sat = "#ff00aa" if (orig_sat or "").lower() != "#ff00aa" else "#00ffaa"
            page.evaluate("() => window.__PSYCHRO__.modals.openThemeEditor()")
            wait_raf(page, 2, 120)
            page.evaluate(
                """(val) => {
                    const el = document.getElementById('ct_sat');
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                test_sat,
            )
            wait_raf(page, 2, 100)
            mid_sat = page.evaluate("() => window.__PSYCHRO__.store.state.customTheme.sat")
            page.click("#closeThemeEditor")
            wait_raf(page, 2, 120)
            after_sat = page.evaluate("() => window.__PSYCHRO__.store.state.customTheme.sat")
            runner.check(
                "#themeEditorOverlay: changing #ct_sat then clicking Close reverts customTheme.sat",
                (after_sat or "").lower() == (orig_sat or "").lower(),
                f"orig={orig_sat}, during={mid_sat}, afterClose={after_sat}",
            )
            page.select_option("#selTheme", "studio-dark")
            wait_raf(page, 2, 80)

            # 6h. All 13 #layerToggles inputs are Tab-reachable (not display: none)
            layers_a11y = page.evaluate(
                """() => {
                    const inputs = Array.from(document.querySelectorAll('#layerToggles input[type="checkbox"]'));
                    let focusable = 0;
                    const bad = [];
                    for (const inp of inputs) {
                        const cs = getComputedStyle(inp);
                        inp.focus();
                        const ok = cs.display !== 'none' && cs.visibility !== 'hidden' && !inp.disabled && inp.tabIndex >= 0 && document.activeElement === inp;
                        if (ok) focusable++;
                        else bad.push({ key: inp.dataset.layer || inp.id, display: cs.display, vis: cs.visibility, tabIndex: inp.tabIndex });
                    }
                    return { count: inputs.length, focusable, bad };
                }"""
            )
            runner.check(
                "All 13 #layerToggles inputs are Tab-reachable (not display: none)",
                layers_a11y["count"] == 13 and layers_a11y["focusable"] == 13,
                json.dumps(layers_a11y),
            )

            # 6i. Collapsed #leftPanel has inert === true
            page.click("#btnToggleLeft")
            wait_raf(page, 2, 100)
            lp_inert_closed = page.evaluate("() => document.getElementById('leftPanel').inert === true")
            page.click("#btnToggleLeft")
            wait_raf(page, 2, 100)
            lp_inert_open = page.evaluate("() => document.getElementById('leftPanel').inert === false")
            runner.check(
                "Collapsed #leftPanel has inert === true (and false when expanded)",
                lp_inert_closed and lp_inert_open,
                f"collapsedInert={lp_inert_closed}, expandedInert={not lp_inert_open}",
            )

            # =================================================================
            # 7. CANVAS, HUD, CONTEXT MENU & TOAST UX
            # =================================================================
            runner.section("7. Canvas, HUD, Context Menu & Toast UX")
            reset_to_clean_default(page)

            # 7a. #hud clears X-axis numeric ticks (bottom >= 48px)
            cv_box = page.locator("#cvOverlay").bounding_box()
            assert cv_box is not None
            page.mouse.move(cv_box["x"] + cv_box["width"] * 0.52, cv_box["y"] + cv_box["height"] * 0.55)
            wait_raf(page, 3, 120)
            hud_pos = page.evaluate(
                """() => {
                    const wrap = document.getElementById('chartWrap').getBoundingClientRect();
                    const hud = document.getElementById('hud');
                    const hr = hud.getBoundingClientRect();
                    const cs = getComputedStyle(hud);
                    return {
                        hidden: hud.classList.contains('hidden'),
                        cssBottom: parseFloat(cs.bottom),
                        clearancePx: Math.round((wrap.bottom - hr.bottom) * 10) / 10,
                        hudText: hud.innerText.slice(0, 80)
                    };
                }"""
            )
            runner.check(
                "#hud clears X-axis numeric ticks (bottom >= 48px)",
                (not hud_pos["hidden"]) and hud_pos["clearancePx"] >= 48.0,
                json.dumps(hud_pos),
            )

            # 7b. #toastContainer sits left of #rightPanel (zero overlap with Selected Process metrics)
            page.evaluate("() => window.__PSYCHRO__.toast('Toast layout clearance verification', 'info')")
            wait_raf(page, 2, 100)
            toast_pos = page.evaluate(
                """() => {
                    const tc = document.getElementById('toastContainer');
                    const toastEl = tc.querySelector('.toast');
                    const rp = document.getElementById('rightPanel');
                    const tr = (toastEl || tc).getBoundingClientRect();
                    const rpr = rp.getBoundingClientRect();
                    return {
                        toastLeft: Math.round(tr.left),
                        toastRight: Math.round(tr.right),
                        rightPanelLeft: Math.round(rpr.left),
                        gapPx: Math.round(rpr.left - tr.right)
                    };
                }"""
            )
            runner.check(
                "#toastContainer sits left of #rightPanel (zero overlap with Selected Process metrics)",
                toast_pos["toastRight"] <= toast_pos["rightPanelLeft"] + 2,
                json.dumps(toast_pos),
            )
            clear_toasts(page)

            # 7c. Measure Caliper Escape hides stale #hud
            page.click("#btnToolMeasure")
            wait_raf(page, 2, 80)
            m_start_x = cv_box["x"] + cv_box["width"] * 0.38
            m_start_y = cv_box["y"] + cv_box["height"] * 0.62
            m_end_x = cv_box["x"] + cv_box["width"] * 0.65
            m_end_y = cv_box["y"] + cv_box["height"] * 0.40
            page.mouse.move(m_start_x, m_start_y)
            page.mouse.down()
            page.mouse.move(m_end_x, m_end_y, steps=12)
            page.mouse.up()
            wait_raf(page, 3, 120)
            hud_before_esc = page.evaluate(
                """() => ({
                    visible: !document.getElementById('hud').classList.contains('hidden'),
                    text: document.getElementById('hud')?.innerText?.slice(0, 80) || ''
                })"""
            )
            page.keyboard.press("Escape")
            wait_raf(page, 2, 100)
            hud_after_esc = page.evaluate("() => document.getElementById('hud').classList.contains('hidden')")
            runner.check(
                "Measure Caliper Escape hides stale #hud",
                hud_before_esc["visible"] and hud_after_esc,
                f"beforeEsc={hud_before_esc}, hiddenAfterEsc={hud_after_esc}",
            )

            # 7d. Right-click context menu on empty chart is concise (<= 9 items, height < 320px, role="menuitem")
            # Click empty plot area near (38°C, 0.002 kg/kg) using CSS coordinates (device px / dpr)
            empty_pt = page.evaluate(
                """() => {
                    const br = window.__PSYCHRO__.baseRenderer;
                    const dpr = br.dpr || window.devicePixelRatio || 1;
                    const rect = document.getElementById('cvOverlay').getBoundingClientRect();
                    return { x: rect.left + br.xc(38) / dpr, y: rect.top + br.yc(0.002) / dpr };
                }"""
            )
            page.mouse.click(empty_pt["x"], empty_pt["y"], button="right")
            wait_raf(page, 2, 120)
            ctx_info = page.evaluate(
                """() => {
                    const m = document.getElementById('ctxMenu');
                    const r = m.getBoundingClientRect();
                    const items = Array.from(m.querySelectorAll('.ctx-item, button, [data-action]'));
                    const allMenuItemRole = items.length > 0 && items.every(i => i.getAttribute('role') === 'menuitem');
                    return {
                        visible: r.width > 0 && r.height > 0 && getComputedStyle(m).display !== 'none',
                        count: items.length,
                        height: Math.round(r.height),
                        allMenuItemRole,
                        labels: items.map(i => i.innerText.trim().split('\\n')[0])
                    };
                }"""
            )
            runner.check(
                "Right-click context menu on empty chart is concise (<= 9 items, height < 320px, role='menuitem')",
                ctx_info["visible"]
                and 3 <= ctx_info["count"] <= 9
                and ctx_info["height"] < 320
                and ctx_info["allMenuItemRole"],
                json.dumps(ctx_info),
            )
            page.keyboard.press("Escape")
            wait_raf(page, 2, 80)

            # 7e. Double-clicking locked derived mix point MA (25% OA) keeps it locked
            mix_pt_info = page.evaluate(
                """() => {
                    const st = window.__PSYCHRO__.store.state;
                    const br = window.__PSYCHRO__.baseRenderer;
                    const dpr = br.dpr || window.devicePixelRatio || 1;
                    const rect = document.getElementById('cvOverlay').getBoundingClientRect();
                    const mp = st.points.find(p => /MA/i.test(p.label) && p.derived?.type === 'mix');
                    if (!mp) return null;
                    return {
                        id: mp.id,
                        label: mp.label,
                        lockedBefore: Boolean(mp.locked),
                        x: rect.left + br.xc(mp.T) / dpr,
                        y: rect.top + br.yc(mp.w) / dpr
                    };
                }"""
            )
            assert mix_pt_info is not None, "MA (25% OA) derived mix point not found"
            page.mouse.dblclick(mix_pt_info["x"], mix_pt_info["y"])
            wait_raf(page, 3, 120)
            locked_after = page.evaluate(
                """(id) => {
                    const mp = window.__PSYCHRO__.store.state.points.find(p => p.id === id);
                    return Boolean(mp && mp.locked);
                }""",
                mix_pt_info["id"],
            )
            runner.check(
                "Double-clicking locked derived mix point MA (25% OA) keeps it locked",
                mix_pt_info["lockedBefore"] and locked_after,
                f"label='{mix_pt_info['label']}', before={mix_pt_info['lockedBefore']}, after={locked_after}",
            )

            # =================================================================
            # 8. FINAL POLISHED SHOWCASE SCREENSHOTS (03 & 04)
            # =================================================================
            runner.section("8. Showcase Screenshots (Blueprint TC 9.9 + SHR, ASHRAE Dubai Weather)")

            # Screenshot 03: Blueprint CAD + Data Center TC 9.9 + SHR dial
            page.click("#tabBtnAtmo")
            page.click("#tabBtnProc")
            page.select_option("#selTheme", "blueprint-cad")
            page.select_option("#selUnits", "SI")
            load_preset_clean(page, "datacenter-econ")
            page.evaluate(
                """() => {
                    const dets = document.querySelectorAll('#tabAtmo details');
                    dets.forEach(d => { d.open = true; });
                    const lp = document.getElementById('tabAtmo');
                    if (lp) lp.scrollTop = 0;
                }"""
            )
            page.select_option("#shrShow", "on")
            wait_raf(page, 4, 180)
            clear_toasts(page)
            move_mouse_neutral(page)
            wait_raf(page, 3, 120)
            shot3 = ARTIFACT_DIR / "final_03_blueprint_datacenter_shr.png"
            page.screenshot(path=str(shot3))
            runner.check("Captured final_03_blueprint_datacenter_shr.png", shot3.exists() and shot3.stat().st_size > 20000, shot3.name)

            # Screenshot 04: ASHRAE Classic + Dubai 8,760h heatmap + Givoni + reordered Climate/Weather section
            page.select_option("#shrShow", "off")
            page.select_option("#selTheme", "ashrae-classic")
            load_preset_clean(page, "summer-ahu")
            page.click("#tabBtnAtmo")
            page.click("#tabBtnProc")
            page.select_option("#citySelect", "dubai")
            page.click("#btnLoadCityTMY")
            wait_raf(page, 5, 220)
            page.check("#chkGivoni")
            wait_raf(page, 4, 180)
            # Scroll Left Panel back to top so reordered Climate/Weather section & Dubai 8760h stats are prominently displayed
            page.evaluate("() => { const lp = document.getElementById('tabAtmo'); if (lp) lp.scrollTop = 120; }")
            wait_raf(page, 2, 80)
            weather_ok = page.evaluate(
                """() => {
                    const st = window.__PSYCHRO__.store.state;
                    const ws = document.getElementById('weatherStats')?.innerText || '';
                    return {
                        records: st.weather?.records?.length || 0,
                        loaded: Boolean((st.weather?.records?.length || 0) >= 8760),
                        givoni: Boolean(st.layers?.givoni),
                        statsLen: ws.length
                    };
                }"""
            )
            clear_toasts(page)
            move_mouse_neutral(page)
            wait_raf(page, 3, 120)
            shot4 = ARTIFACT_DIR / "final_04_ashrae_dubai_weather.png"
            page.screenshot(path=str(shot4))
            runner.check(
                "Captured final_04_ashrae_dubai_weather.png (ASHRAE Classic + Dubai 8760h + Givoni)",
                shot4.exists() and shot4.stat().st_size > 20000 and weather_ok["loaded"] and weather_ok["givoni"],
                json.dumps(weather_ok),
            )

            # =================================================================
            # 9. ZERO CONSOLE / PAGE ERRORS GATE
            # =================================================================
            runner.section("9. Runtime Error Gate")
            runner.check(
                "Zero console.error across entire certification session",
                len(runner.console_errors) == 0,
                f"count={len(runner.console_errors)}",
            )
            runner.check(
                "Zero uncaught pageerror across entire certification session",
                len(runner.page_errors) == 0,
                f"count={len(runner.page_errors)}",
            )

        except Exception as exc:
            traceback.print_exc()
            runner.check("Unhandled exception during certification", False, str(exc))
        finally:
            browser.close()

    total = len(runner.results)
    passed = sum(1 for r in runner.results if r["passed"])
    failed = [r for r in runner.results if not r["passed"]]

    print("\n" + "=" * 76)
    print(f"FRONT-END CHROME CERTIFICATION SCORECARD: {passed}/{total} PASSED ({len(failed)} FAILED)")
    print("=" * 76)
    if failed:
        print("\nFAILED CHECKS:")
        for f in failed:
            print(f"  - [{f['section']}] {f['name']}: {f['detail']}")
    return 0 if len(failed) == 0 else 1


if __name__ == "__main__":
    sys.exit(run_certification())
