/* ============================================================================
   PsychroChart Ultra 3.0 — Main Application Bootstrap & Top Command Bar Wiring
   Coordinates dual-canvas HiDPI rendering, reactive store subscriptions,
   UI panels, modals, presets, URL sharing, autosave, and export pipelines.
   ============================================================================ */

import { CoreDOM, UNIT_LABELS } from './core/contracts.js';
import { Psy } from './engine/psychro.js';
import { store } from './state/store.js';
import { BaseRenderer } from './render/baseRenderer.js';
import { OverlayRenderer } from './render/overlayRenderer.js';
import { Exporter } from './export/exporter.js';
import { initChartInteraction } from './ui/interaction.js';
import { initLeftPanel } from './ui/leftPanel.js';
import { initRightPanel } from './ui/rightPanel.js';
import { initModals, PRESETS } from './ui/modals.js';

const _APP_lastAction = { el: null, x: 0, y: 0, time: 0 };

if (typeof document !== 'undefined') {
  const _recordActionEl = (target, cx, cy) => {
    const el = target && target.nodeType === 1
      ? (target.closest('button, input, select, textarea, [role="button"], canvas') || target)
      : null;
    _APP_lastAction.el = el;
    _APP_lastAction.x = Number.isFinite(cx) ? cx : 0;
    _APP_lastAction.y = Number.isFinite(cy) ? cy : 0;
    _APP_lastAction.time = Date.now();
  };
  document.addEventListener('pointerdown', (e) => {
    _recordActionEl(e.target, e.clientX, e.clientY);
  }, true);
  document.addEventListener('click', (e) => {
    _recordActionEl(e.target, e.clientX, e.clientY);
  }, true);
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el && el.nodeType === 1 && typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      _recordActionEl(el, r.left + r.width * 0.5, r.top + r.height * 0.5);
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const el = document.activeElement;
      if (el && el !== document.body && typeof el.getBoundingClientRect === 'function') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          _recordActionEl(el, r.left + r.width * 0.5, r.top + r.height * 0.5);
        }
      }
    }
  }, true);
}

function _resolveToastAnchor(tone, explicitAnchor) {
  if (explicitAnchor) {
    if (explicitAnchor.nodeType === 1 && explicitAnchor.isConnected) {
      const r = explicitAnchor.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { kind: 'el', rect: r };
    } else if (Number.isFinite(explicitAnchor.x) && Number.isFinite(explicitAnchor.y)) {
      return { kind: 'xy', x: explicitAnchor.x, y: explicitAnchor.y };
    }
  }
  if (tone !== 'error' && tone !== 'warn') return null;

  const now = Date.now();
  if (now - _APP_lastAction.time <= 1400) {
    const el = _APP_lastAction.el;
    if (el && el.isConnected) {
      if (el.tagName === 'CANVAS' || el.id === 'chartStage' || el.id === 'chartWrap') {
        if (_APP_lastAction.x > 0 || _APP_lastAction.y > 0) {
          return { kind: 'xy', x: _APP_lastAction.x, y: _APP_lastAction.y };
        }
      } else {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { kind: 'el', rect: r };
      }
    }
    if (_APP_lastAction.x > 0 || _APP_lastAction.y > 0) {
      return { kind: 'xy', x: _APP_lastAction.x, y: _APP_lastAction.y };
    }
  }

  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected &&
      active.matches?.('button, input, select, textarea, [role="button"]')) {
    const r = active.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { kind: 'el', rect: r };
  }
  return null;
}

function _positionAnchoredToast(node, anchor) {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const pad = 10;
  const tw = node.offsetWidth || 260;
  const th = node.offsetHeight || 38;

  if (anchor.kind === 'el') {
    const r = anchor.rect;
    const targetCx = r.left + r.width * 0.5;
    let left = targetCx - tw * 0.5;
    // Align cleanly inside right/left edges
    left = CoreDOM.clamp(left, pad, Math.max(pad, vw - tw - pad));

    let top = r.bottom + 10;
    let placement = 'anchor-below';
    if (top + th > vh - pad && r.top - th - 10 >= pad) {
      top = r.top - th - 10;
      placement = 'anchor-above';
    } else {
      top = CoreDOM.clamp(top, pad, Math.max(pad, vh - th - pad));
    }

    const caretX = CoreDOM.clamp(targetCx - left, 14, Math.max(14, tw - 14));
    node.classList.add(placement);
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
    node.style.setProperty('--caret-x', `${Math.round(caretX)}px`);
    return;
  }

  // Canvas / point / cursor coordinate anchor (prefer staying cleanly inside #chartStage)
  const stageEl = CoreDOM.byId('chartStage') || CoreDOM.byId('chartWrap');
  const stageRect = stageEl ? stageEl.getBoundingClientRect() : null;
  const boundL = (stageRect && anchor.x >= stageRect.left && anchor.x <= stageRect.right)
    ? Math.max(pad, stageRect.left + 8)
    : pad;
  const boundR = (stageRect && anchor.x >= stageRect.left && anchor.x <= stageRect.right)
    ? Math.min(vw - pad, stageRect.right - 8)
    : (vw - pad);

  let left = anchor.x + 16;
  if (left + tw > boundR && anchor.x - tw - 16 >= boundL) {
    left = anchor.x - tw - 16;
  }
  left = CoreDOM.clamp(left, boundL, Math.max(boundL, boundR - tw));

  let top = anchor.y - th - 14;
  if (top < pad) top = anchor.y + 18;
  top = CoreDOM.clamp(top, pad, Math.max(pad, vh - th - pad));

  node.classList.add('anchor-point');
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

export function toast(msg, type = 'info', anchor = null) {
  if (typeof document === 'undefined') return;
  const container = CoreDOM.byId('toastContainer');
  if (!container) return;

  const icons = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
  const tone = icons[type] ? type : 'info';
  const durationMs = tone === 'error' ? 4000 : (tone === 'warn' ? 3400 : 2200);
  const cleanMsg = String(msg ?? '');
  const key = `${tone}|${cleanMsg}`;
  const resolvedAnchor = _resolveToastAnchor(tone, anchor);

  const dismissNode = (el) => {
    if (!el || el.dataset.dismissed === '1') return;
    el.dataset.dismissed = '1';
    if (el._toastTimer) {
      clearTimeout(el._toastTimer);
      el._toastTimer = null;
    }
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };

  if (resolvedAnchor) {
    // Replace any existing anchored toast so repeated actions next to a button never stack messily
    container.querySelectorAll('.toast-anchored').forEach((old) => {
      if (old._toastTimer) clearTimeout(old._toastTimer);
      old.remove();
    });
  } else {
    // Coalesce identical active stacked toasts by resetting dismiss timer
    const existing = Array.from(container.children).find(
      ch => !ch.classList.contains('toast-anchored') && ch.dataset?.toastKey === key && ch.dataset?.dismissed !== '1'
    );
    if (existing) {
      if (existing._toastTimer) clearTimeout(existing._toastTimer);
      existing._toastTimer = setTimeout(() => dismissNode(existing), durationMs);
      return;
    }

    // Keep passive toast stack clean and compact (max 3 simultaneous)
    const stacked = Array.from(container.children).filter(ch => !ch.classList.contains('toast-anchored'));
    while (stacked.length >= 3) {
      const oldest = stacked.shift();
      if (oldest?._toastTimer) clearTimeout(oldest._toastTimer);
      oldest?.remove();
    }
  }

  const node = document.createElement('div');
  node.className = `toast ${tone}${resolvedAnchor ? ' toast-anchored' : ''}`;
  node.dataset.toastKey = key;
  node.style.cursor = 'pointer';
  node.title = 'Click to dismiss';
  node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  node.innerHTML = `<span class="toast-ico" aria-hidden="true">${icons[tone]}</span><span>${CoreDOM.esc(cleanMsg)}</span>`;
  node.addEventListener('click', () => dismissNode(node));
  container.appendChild(node);

  if (resolvedAnchor) {
    _positionAnchoredToast(node, resolvedAnchor);
  }

  node._toastTimer = setTimeout(() => dismissNode(node), durationMs);
}

export function initPanelTabs() {
  if (typeof document === 'undefined') return;
  const tabBars = document.querySelectorAll('.panelTabs');

  tabBars.forEach(bar => {
    const panel = bar.closest('.panel') || bar.parentElement;
    if (!panel) return;
    const buttons = Array.from(bar.querySelectorAll('button[data-tab]'));

    function activateTab(btn) {
      const targetId = btn?.dataset?.tab;
      if (!targetId) return;

      buttons.forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      const contents = panel.querySelectorAll(':scope > .tabContent');
      contents.forEach(tc => {
        tc.classList.toggle('active', tc.id === targetId);
      });

      if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('psychro:tab-changed', {
          detail: { panelId: panel.id || '', tabId: targetId }
        }));
      }
    }

    buttons.forEach((btn, idx) => {
      CoreDOM.on(btn, 'click', () => activateTab(btn));
      CoreDOM.on(btn, 'keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          const next = buttons[(idx + dir + buttons.length) % buttons.length];
          if (next) {
            next.focus();
            activateTab(next);
          }
        }
      });
    });
  });
}

const _APP_boot = (() => {
  const FT_PER_M = 3.280839895013123;
  const KPA_PER_PSI = Psy?.KPA_PER_PSI || 6.894757293168361;

  function _normalizePresetsList(presetsSource) {
    if (!presetsSource) return [];
    if (Array.isArray(presetsSource)) {
      return presetsSource.map(p => ({
        id: p.id || p.key || '',
        name: p.name || p.label || p.title || p.id || '',
        shortName: p.shortName || p.name || p.label || p.title || p.id || '',
        raw: p
      })).filter(p => p.id);
    }
    if (typeof presetsSource === 'object') {
      return Object.entries(presetsSource).map(([id, p]) => ({
        id: p?.id || id,
        name: p?.name || p?.label || p?.title || id,
        shortName: p?.shortName || p?.name || p?.label || p?.title || id,
        raw: p
      }));
    }
    return [];
  }

  function _syncBarometricBadge() {
    const el = CoreDOM.byId('pUsed');
    if (!el) return;
    const st = store.state;
    const pPa = Number.isFinite(st.pPa) ? st.pPa : 101325;
    const pKpa = pPa / 1000;
    const altM = Number.isFinite(st.altM)
      ? st.altM
      : (typeof Psy?.invBaroAlt_m === 'function' ? Psy.invBaroAlt_m(pPa) : 0);

    if (st.units === 'IP') {
      const psia = pKpa / KPA_PER_PSI;
      const altFt = Math.round(altM * FT_PER_M);
      el.textContent = `${psia.toFixed(3)} psia (${altFt} ft)`;
    } else {
      el.textContent = `${pKpa.toFixed(3)} kPa (${Math.round(altM)} m)`;
    }
  }

  function _syncYAxisLabel() {
    const el = CoreDOM.byId('yAxisLabel');
    if (!el) return;
    const st = store.state;
    const units = st.units === 'IP' ? 'IP' : 'SI';
    const wUnit = UNIT_LABELS?.[units]?.W || (units === 'IP' ? 'gr/lb' : 'g/kg');
    el.textContent = `Humidity Ratio, W (${wUnit} dry air)`;
    if (st.theme === 'custom' && st.customTheme?.axisText) {
      el.style.color = st.customTheme.axisText;
    } else {
      el.style.color = '';
    }
  }

  function _syncUndoRedoButtons() {
    const btnUndo = CoreDOM.byId('btnUndo');
    const btnRedo = CoreDOM.byId('btnRedo');
    if (btnUndo) {
      const can = typeof store.canUndo === 'function' ? store.canUndo() : false;
      const lbl = typeof store.getUndoLabel === 'function' ? store.getUndoLabel() : '';
      btnUndo.disabled = !can;
      btnUndo.title = lbl ? `Undo: ${lbl} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    }
    if (btnRedo) {
      const can = typeof store.canRedo === 'function' ? store.canRedo() : false;
      const lbl = typeof store.getRedoLabel === 'function' ? store.getRedoLabel() : '';
      btnRedo.disabled = !can;
      btnRedo.title = lbl ? `Redo: ${lbl} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
    }
  }

  function _syncScenarioBanner() {
    const banner = CoreDOM.byId('scenarioBanner');
    if (!banner) return;
    const cmpId = store.state.compareScenarioId;
    const scen = cmpId != null
      ? (store.state.scenarios || []).find(s => String(s.id) === String(cmpId))
      : null;

    if (!scen) {
      banner.classList.remove('visible');
      banner.innerHTML = '';
      return;
    }

    banner.innerHTML =
      `<span>Comparing vs Ghost: <strong>${CoreDOM.esc(scen.name || 'Scenario')}</strong></span>` +
      `<button type="button" id="btnExitScenarioCompare">Exit Compare</button>`;
    banner.classList.add('visible');

    const exitBtn = CoreDOM.byId('btnExitScenarioCompare');
    if (exitBtn) {
      CoreDOM.on(exitBtn, 'click', () => {
        store.setCompareScenario(null);
        toast('Exited scenario comparison', 'info');
      });
    }
  }

  function _syncTopBarFields() {
    const st = store.state;
    const appEl = CoreDOM.byId('app');
    if (appEl && st.theme) {
      appEl.setAttribute('data-theme', st.theme);
    }

    const syncInput = (id, val) => {
      const el = CoreDOM.byId(id);
      if (!el) return;
      if (document.activeElement === el) return;
      const str = val ?? '';
      if (el.value !== str) el.value = str;
    };

    syncInput('projName', st.meta?.name || '');
    syncInput('projVer', st.meta?.version || '');
    syncInput('companyName', st.meta?.company || '');
    syncInput('engineerName', st.meta?.engineer || '');

    const selTheme = CoreDOM.byId('selTheme');
    if (selTheme && st.theme && selTheme.value !== st.theme) {
      selTheme.value = st.theme;
    }
    const btnEditCustomTheme = CoreDOM.byId('btnEditCustomTheme');
    if (btnEditCustomTheme) {
      const isCustom = st.theme === 'custom';
      btnEditCustomTheme.hidden = !isCustom;
      btnEditCustomTheme.style.display = isCustom ? '' : 'none';
    }
    const selUnits = CoreDOM.byId('selUnits');
    if (selUnits && st.units && selUnits.value !== st.units) {
      selUnits.value = st.units;
    }

    _syncBarometricBadge();
    _syncYAxisLabel();
    _syncUndoRedoButtons();
    _syncScenarioBanner();
  }

  function _populatePresetSelector() {
    const selPreset = CoreDOM.byId('selPreset');
    if (!selPreset) return;
    const list = _normalizePresetsList(PRESETS);
    if (!list.length) return;

    const prev = selPreset.value;
    selPreset.innerHTML = '<option value="">Presets…</option>' +
      list.map(p => `<option value="${CoreDOM.esc(p.id)}" title="${CoreDOM.esc(p.name)}">${CoreDOM.esc(p.shortName || p.name)}</option>`).join('');
    if (prev && list.some(p => p.id === prev)) {
      selPreset.value = prev;
    }
  }

  function _applyPresetById(presetId, modalsApi, silent = false) {
    if (!presetId) return false;
    if (!silent && modalsApi && typeof modalsApi.loadPresetById === 'function') {
      return modalsApi.loadPresetById(presetId) !== false;
    }

    // Silent boot path or fallback if PRESETS holds declarative cycle data / apply(store)
    const list = _normalizePresetsList(PRESETS);
    const match = list.find(p => p.id === presetId);
    if (!match || !match.raw) return false;
    const raw = match.raw;

    if (typeof raw.apply === 'function') {
      raw.apply(store);
      const selPreset = CoreDOM.byId('selPreset');
      if (selPreset) selPreset.value = match.id;
    } else if (typeof modalsApi?.loadPresetById === 'function') {
      return modalsApi.loadPresetById(presetId) !== false;
    } else if (typeof raw.build === 'function') {
      const built = raw.build(store.state.pPa || 101325);
      if (built && Array.isArray(built.points) && typeof store.loadCycle === 'function') {
        store.loadCycle(
          built.points,
          built.processes || [],
          built.meta || { name: raw.name || presetId },
          raw.name || presetId
        );
      }
    } else if (Array.isArray(raw.points) && typeof store.loadCycle === 'function') {
      store.loadCycle(
        raw.points,
        raw.processes || [],
        raw.meta || { name: raw.name || presetId },
        raw.name || presetId
      );
      if (raw.view && typeof store.setView === 'function') {
        store.setView(raw.view, false);
      }
    } else {
      return false;
    }

    if (!silent) {
      toast(`Loaded preset: ${match.name}`, 'success');
    }
    return true;
  }

  function _openModalById(overlayId) {
    const el = CoreDOM.byId(overlayId);
    if (el) el.classList.add('visible');
  }

  function _wireTopBar(baseRenderer, overlayRenderer, modalsApi) {
    const { byId, on } = CoreDOM;

    // Project metadata bindings
    const bindMeta = (id, key) => {
      const el = byId(id);
      if (!el) return;
      on(el, 'input', () => store.setMeta({ [key]: el.value }));
      on(el, 'change', () => store.setMeta({ [key]: el.value.trim() }));
    };
    bindMeta('projName', 'name');
    bindMeta('projVer', 'version');
    bindMeta('companyName', 'company');
    bindMeta('engineerName', 'engineer');

    // Preset selector
    _populatePresetSelector();
    const selPreset = byId('selPreset');
    on(selPreset, 'change', () => {
      const id = selPreset.value;
      if (!id) return;
      _applyPresetById(id, modalsApi, false);
    });

    // Theme / Visualization Preset selector & Custom Theme Studio reopen button
    const selTheme = byId('selTheme');
    on(selTheme, 'change', () => {
      const val = selTheme.value;
      if (val === 'custom') {
        if (typeof modalsApi?.openThemeEditor === 'function') {
          // Let Theme Editor snapshot the previous theme cleanly so Cancel/Esc reverts
          modalsApi.openThemeEditor();
        } else {
          store.setTheme('custom');
          _openModalById('themeEditorOverlay');
        }
      } else {
        if (typeof store.applyVisualPreset === 'function') {
          store.applyVisualPreset(val);
        } else {
          store.setTheme(val);
        }
        const presetLabel = selTheme.options[selTheme.selectedIndex]?.text || val;
        toast(`Chart Preset: ${presetLabel}`, 'info');
      }
    });

    on(byId('btnEditCustomTheme'), 'click', () => {
      if (typeof modalsApi?.openThemeEditor === 'function') {
        modalsApi.openThemeEditor();
      } else {
        _openModalById('themeEditorOverlay');
      }
    });

    // Units selector (SI / IP)
    const selUnits = byId('selUnits');
    on(selUnits, 'change', () => {
      const val = selUnits.value === 'IP' ? 'IP' : 'SI';
      store.setUnits(val);
      toast(`Units switched to ${val === 'IP' ? 'IP (°F, gr/lb, Btu/lb)' : 'SI (°C, g/kg, kJ/kg)'}`, 'info');
    });

    // Undo / Redo
    on(byId('btnUndo'), 'click', () => {
      const lbl = store.getUndoLabel?.() || '';
      if (store.undo()) {
        toast(lbl ? `Undid: ${lbl}` : 'Undone', 'info');
      }
    });
    on(byId('btnRedo'), 'click', () => {
      const lbl = store.getRedoLabel?.() || '';
      if (store.redo()) {
        toast(lbl ? `Redid: ${lbl}` : 'Redone', 'info');
      }
    });

    // Command Palette (Ctrl+K) — modals.js wires #btnCmdPalette directly when present
    if (typeof modalsApi?.openCmdPalette !== 'function') {
      on(byId('btnCmdPalette'), 'click', () => {
        _openModalById('cmdPaletteOverlay');
        byId('cmdInput')?.focus();
      });
    }

    // Save / Load JSON
    on(byId('btnSave'), 'click', () => {
      if (typeof Exporter?.downloadJSON === 'function') {
        Exporter.downloadJSON(store);
      } else {
        const json = JSON.stringify(store.exportJSON(), null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `${(store.state.meta?.name || 'psychro-project').replace(/[^\w.-]+/g, '_')}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast('Project saved as JSON', 'success');
      }
    });

    const fileLoad = byId('fileLoad');
    on(byId('btnLoad'), 'click', () => fileLoad?.click());
    on(fileLoad, 'change', async () => {
      const file = fileLoad.files?.[0];
      if (!file) return;
      try {
        if (typeof Exporter?.loadJSONFile === 'function') {
          await Exporter.loadJSONFile(store, file);
        } else {
          const text = await file.text();
          const data = JSON.parse(text);
          const res = store.importJSON(data);
          if (res?.ok) {
            toast(`Loaded project: ${store.state.meta?.name || file.name}`, 'success');
          } else {
            toast(res?.error || 'Could not load project file', 'error');
          }
        }
      } catch (err) {
        toast(`Failed to load JSON: ${err?.message || err}`, 'error');
      } finally {
        fileLoad.value = '';
      }
    });

    // Shareable URL
    on(byId('btnShareUrl'), 'click', async () => {
      if (typeof Exporter?.copyShareURL === 'function') {
        await Exporter.copyShareURL(store);
      } else {
        const url = store.encodeShareURL();
        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
          }
          toast('Shareable project URL copied to clipboard', 'success');
        } catch {
          toast('Could not access clipboard — URL ready in address bar', 'warn');
          if (typeof history !== 'undefined' && url.includes('#')) {
            history.replaceState(null, '', url.slice(url.indexOf('#')));
          }
        }
      }
    });

    // PNG / SVG / CSV / Engineering Report exports
    on(byId('btnExportPng'), 'click', () => {
      Exporter?.exportPNG?.(store, baseRenderer, overlayRenderer, 2);
    });
    on(byId('btnExportSvg'), 'click', () => {
      Exporter?.exportSVG?.(store, baseRenderer);
    });
    on(byId('btnExportCsv'), 'click', () => {
      Exporter?.exportCSV?.(store);
    });
    on(byId('btnReport'), 'click', () => {
      if (typeof modalsApi?.openReport === 'function') {
        modalsApi.openReport();
      } else {
        _openModalById('reportOverlay');
      }
    });

    // Reference & Info modals
    on(byId('btnGlossary'), 'click', () => {
      if (typeof modalsApi?.openGlossary === 'function') modalsApi.openGlossary();
      else _openModalById('glossaryOverlay');
    });
    on(byId('btnShortcuts'), 'click', () => {
      if (typeof modalsApi?.openShortcuts === 'function') modalsApi.openShortcuts();
      else _openModalById('shortcutsOverlay');
    });
    const openAbout = () => {
      if (typeof modalsApi?.openAbout === 'function') modalsApi.openAbout();
      else _openModalById('aboutOverlay');
    };
    on(byId('btnAbout'), 'click', openAbout);
    on(byId('logoClick'), 'click', openAbout);
    on(byId('logoClick'), 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openAbout();
      }
    });

    // Global Ctrl+S / Cmd+S shortcut to save project JSON
    on(window, 'keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        byId('btnSave')?.click();
      }
    });
  }

  function _restoreInitialProject(modalsApi) {
    // 1. Check URL hash (#p=... or #p3=...)
    const hash = typeof window !== 'undefined' ? String(window.location.hash || '') : '';
    if (hash && /(?:#|&)p3?=/.test(hash)) {
      const normalizedHash = hash.replace(/#p3=/, '#p=');
      const res = store.decodeShareURL(normalizedHash);
      if (res && res.ok) {
        toast('Restored shared project from URL', 'success');
        return 'url';
      }
    }

    // 2. Check localStorage autosave (restore only if valid and contains points)
    if (typeof store.restoreAutosave === 'function') {
      const restored = store.restoreAutosave();
      if (restored && Array.isArray(store.state.points) && store.state.points.length > 0) {
        return 'autosave';
      }
    }

    // 3. Default preset: 'summer-ahu'
    const loaded = _applyPresetById('summer-ahu', modalsApi, true);
    if (!loaded && store.state.points.length === 0) {
      // Defensive fallback if preset registry is unavailable
      const oa = store.addPoint({ T: 35, w: Psy.w_from_TRH(35, 0.55, 101325), label: 'OA', color: '#f43f5e' }, false);
      const ra = store.addPoint({ T: 24, w: Psy.w_from_TRH(24, 0.50, 101325), label: 'RA', color: '#10b981' }, false);
      const sa = store.addPoint({ T: 13, w: Psy.w_from_TRH(13, 0.92, 101325), label: 'SA', color: '#38bdf8' }, false);
      store.addProcess(oa.id, sa.id, { flowVal: 1000, flowUnit: 'Lps', showCurve: true }, false);
      store.addProcess(sa.id, ra.id, { flowVal: 1000, flowUnit: 'Lps' }, false);
    }
    return 'preset';
  }

  function start() {
    const cvBase = CoreDOM.byId('cvBase');
    const cvOverlay = CoreDOM.byId('cvOverlay');
    const chartWrap = CoreDOM.byId('chartWrap');

    if (!cvBase || !cvOverlay) {
      console.error('[PSYCHRO·ULTRA] Required canvases #cvBase and #cvOverlay not found.');
      return null;
    }

    // 1. Instantiate dual-canvas HiDPI renderers
    const baseRenderer = new BaseRenderer(cvBase);
    const overlayRenderer = new OverlayRenderer(cvOverlay, baseRenderer);

    // Coalesced requestAnimationFrame rendering scheduler
    let rafId = null;
    let dirtyBase = false;
    let forceBase = false;
    let dirtyOverlay = false;

    function flushRender() {
      rafId = null;
      const st = store.state;
      if (dirtyBase || forceBase) {
        baseRenderer.render(st, forceBase);
        dirtyBase = false;
        forceBase = false;
        dirtyOverlay = true;
      }
      if (dirtyOverlay) {
        overlayRenderer.render(st);
        dirtyOverlay = false;
      }
    }

    function scheduleRender({ base = false, overlay = true, force = false } = {}) {
      if (base) dirtyBase = true;
      if (force) {
        dirtyBase = true;
        forceBase = true;
      }
      if (overlay) dirtyOverlay = true;
      if (rafId == null) {
        rafId = requestAnimationFrame(flushRender);
      }
    }

    // 2. Initialize tabs, modals, side panels, and canvas interaction
    initPanelTabs();

    const modals = typeof initModals === 'function'
      ? initModals(store, Exporter, baseRenderer, overlayRenderer, toast)
      : {};

    const sharedCallbacks = {
      toast,
      openEditPoint: ptId => modals?.openEditPoint?.(ptId),
      openAddPointParam: (T, w) => modals?.openAddPointParam?.(T, w),
      openMixFlow: (aId, bId) => modals?.openMixFlow?.(aId, bId),
      openReport: () => modals?.openReport?.(),
      openThemeEditor: () => modals?.openThemeEditor?.(),
      openCmdPalette: () => modals?.openCmdPalette?.(),
      openGlossary: () => modals?.openGlossary?.(),
      openShortcuts: () => modals?.openShortcuts?.(),
      openAbout: () => modals?.openAbout?.(),
      loadPreset: id => _applyPresetById(id, modals, false),
      exportPng: () => Exporter?.exportPNG?.(store, baseRenderer, overlayRenderer, 2),
      copyPng: () => Exporter?.copyPNG?.(store, baseRenderer, overlayRenderer),
      exportSvg: () => Exporter?.exportSVG?.(store, baseRenderer),
      exportCsv: () => Exporter?.exportCSV?.(store),
      saveJson: () => Exporter?.downloadJSON?.(store)
    };

    const leftPanel = typeof initLeftPanel === 'function'
      ? initLeftPanel(store, sharedCallbacks)
      : {};

    const rightPanel = typeof initRightPanel === 'function'
      ? initRightPanel(store, sharedCallbacks)
      : {};

    const interaction = typeof initChartInteraction === 'function'
      ? initChartInteraction(store, baseRenderer, overlayRenderer, sharedCallbacks)
      : {};

    // Wire top command bar controls
    _wireTopBar(baseRenderer, overlayRenderer, modals);

    // 3. Wire reactive store subscriptions BEFORE initial project load
    store.on('base-dirty', () => scheduleRender({ base: true, overlay: true }));
    store.on('overlay-dirty', () => scheduleRender({ overlay: true }));
    store.on('units-changed', () => {
      _syncTopBarFields();
      scheduleRender({ base: true, overlay: true, force: true });
    });
    store.on('theme-changed', () => {
      _syncTopBarFields();
      scheduleRender({ base: true, overlay: true, force: true });
    });
    store.on('change', () => {
      _syncTopBarFields();
      scheduleRender({ overlay: true });
    });
    store.on('history', () => _syncUndoRedoButtons());
    store.on('toast', payload => {
      if (!payload) return;
      const msg = typeof payload === 'string' ? payload : (payload.message || payload.msg || '');
      if (msg) toast(msg, payload.type || 'info', payload.anchor || null);
    });

    // 4. Restore URL hash -> localStorage autosave -> default 'summer-ahu' preset
    _restoreInitialProject(modals);

    // 5. Initial UI sync & crisp first render
    _syncTopBarFields();
    if (typeof leftPanel?.syncAll === 'function') leftPanel.syncAll();
    else if (typeof leftPanel?.refresh === 'function') leftPanel.refresh();
    if (typeof rightPanel?.refresh === 'function') rightPanel.refresh();
    else if (typeof rightPanel?.syncAll === 'function') rightPanel.syncAll();
    baseRenderer.render(store.state, true);
    overlayRenderer.render(store.state);

    // 6. Responsive ResizeObserver on #chartStage / #chartWrap (with window resize fallback)
    const chartStage = CoreDOM.byId('chartStage') || chartWrap;
    if (chartStage && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        scheduleRender({ base: true, overlay: true, force: true });
      });
      ro.observe(chartStage);
    }
    CoreDOM.on(window, 'resize', () => {
      scheduleRender({ base: true, overlay: true, force: true });
    });

    // Handle runtime hash changes (e.g., pasting a new share link in the same tab)
    CoreDOM.on(window, 'hashchange', () => {
      const h = String(window.location.hash || '');
      if (h && /(?:#|&)p3?=/.test(h)) {
        const res = store.decodeShareURL(h.replace(/#p3=/, '#p='));
        if (res?.ok) {
          toast('Loaded shared project from URL hash', 'success');
        }
      }
    });

    // 7. Expose clean global API for debugging & automated E2E verification
    const api = {
      store,
      baseRenderer,
      overlayRenderer,
      Exporter,
      Psy,
      PRESETS,
      modals,
      leftPanel,
      rightPanel,
      interaction,
      toast,
      scheduleRender
    };
    if (typeof window !== 'undefined') {
      window.__PSYCHRO__ = api;
    }
    return api;
  }

  return { start };
})();

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => _APP_boot.start(), { once: true });
  } else {
    _APP_boot.start();
  }
}
