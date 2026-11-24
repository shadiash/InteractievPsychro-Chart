/* ============================================================================
   PsychroChart Ultra 3.0 — High-Speed Interactive Overlay Canvas Renderer
   ============================================================================ */

import { CoreDOM } from '../core/contracts.js';
import { Psy } from '../engine/psychro.js';
import { HVAC } from '../engine/hvac.js';

const _OVL = {
  FONT_MONO: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  FONT_SANS: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',

  parseColorRGB(col) {
    if (!col || typeof col !== 'string') return [148, 163, 184];
    const s = col.trim();
    if (s[0] === '#') {
      const hex = s.slice(1);
      if (hex.length === 3) {
        return [
          parseInt(hex[0] + hex[0], 16),
          parseInt(hex[1] + hex[1], 16),
          parseInt(hex[2] + hex[2], 16)
        ];
      }
      if (hex.length >= 6) {
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16)
        ];
      }
    }
    const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return [148, 163, 184];
  },

  withAlpha(col, alpha) {
    const [r, g, b] = _OVL.parseColorRGB(col);
    const a = CoreDOM.clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  },

  isDarkBg(col) {
    const [r, g, b] = _OVL.parseColorRGB(col);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum < 0.5;
  },

  readableLabelColor(col, isDark) {
    if (isDark) return col;
    const [r, g, b] = _OVL.parseColorRGB(col);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum > 0.52) {
      return `rgb(${Math.round(r * 0.58)},${Math.round(g * 0.58)},${Math.round(b * 0.58)})`;
    }
    return col;
  },

  rectOverlapArea(a, b, sep = 0) {
    const ovX = Math.min(a[0] + a[2], b[0] + b[2]) + sep - Math.max(a[0], b[0]);
    if (ovX <= 0) return 0;
    const ovY = Math.min(a[1] + a[3], b[1] + b[3]) + sep - Math.max(a[1], b[1]);
    if (ovY <= 0) return 0;
    return ovX * ovY;
  },

  measureBadgePill(ctx, text, dpi, opts = {}) {
    const fontPx = opts.fontPx || 9.5;
    const weight = opts.weight || '600';
    const padX = (opts.padX ?? 6) * dpi;
    const padY = (opts.padY ?? 3) * dpi;
    let tw = String(text || '').length * fontPx * 0.62 * dpi;
    if (ctx) {
      ctx.save();
      ctx.font = `${weight} ${fontPx * dpi}px ${_OVL.FONT_MONO}`;
      tw = ctx.measureText(text).width;
      ctx.restore();
    }
    return {
      bw: tw + padX * 2,
      bh: fontPx * dpi + padY * 2
    };
  },

  isNonCoilProcess(proc, b) {
    if (!proc) return false;
    if (
      proc.role === 'mix' ||
      proc.role === 'room' ||
      proc.role === 'erv' ||
      proc.role === 'erv_exhaust' ||
      b?.derived?.type === 'mix'
    ) {
      return true;
    }
    if (!proc.showCurve && proc.label) {
      const lbl = String(proc.label);
      if (/\b(erv|hrv|mix|mixing|recirc|room|space)\b/i.test(lbl) && !/\b(coil|dehum)\b/i.test(lbl)) {
        return true;
      }
    }
    return false;
  },

  normPlotRect(br) {
    const r = br && typeof br.getPlotRect === 'function' ? br.getPlotRect() : null;
    if (r) {
      const x = r.x ?? r.left ?? 0;
      const y = r.y ?? r.top ?? 0;
      const w = r.w ?? r.width ?? (r.right != null ? r.right - x : 0);
      const h = r.h ?? r.height ?? (r.bottom != null ? r.bottom - y : 0);
      return { x, y, w, h, right: x + w, bottom: y + h };
    }
    const x = br?.padL ?? 0;
    const y = br?.padT ?? 0;
    const W = br?.width ?? br?.W ?? br?.canvas?.width ?? 0;
    const H = br?.height ?? br?.H ?? br?.canvas?.height ?? 0;
    const w = Math.max(0, W - x - (br?.padR ?? 0));
    const h = Math.max(0, H - y - (br?.padB ?? 0));
    return { x, y, w, h, right: x + w, bottom: y + h };
  },

  invT(br, state, px) {
    if (br && typeof br.invT === 'function') return br.invT(px);
    const plot = _OVL.normPlotRect(br);
    const tMin = state?.view?.tMin ?? -10;
    const tMax = state?.view?.tMax ?? 55;
    return tMin + ((px - plot.x) / Math.max(1, plot.w)) * (tMax - tMin);
  },

  invW(br, state, py) {
    if (br && typeof br.invW === 'function') return br.invW(py);
    const plot = _OVL.normPlotRect(br);
    const wMax = state?.view?.wMax ?? 0.030;
    return ((plot.bottom - py) / Math.max(1, plot.h)) * wMax;
  },

  roundRect(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  },

  textHalo(ctx, str, px, py, col, pal, dpi, opts = {}) {
    const align = opts.align || 'left';
    const base = opts.base || 'alphabetic';
    const sizePx = opts.sizePx || 11;
    const weight = opts.weight || '500';
    const italic = opts.italic ? 'italic ' : '';
    const family = opts.sans ? _OVL.FONT_SANS : _OVL.FONT_MONO;
    const hw = opts.haloW ?? pal.haloW ?? 3;
    const alpha = opts.alpha ?? 1;

    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = base;
    ctx.font = `${italic}${weight} ${sizePx * dpi}px ${family}`;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    if (hw > 0) {
      ctx.lineWidth = hw * dpi;
      ctx.strokeStyle = pal.halo || 'rgba(12,16,23,0.92)';
      ctx.globalAlpha = 0.92 * alpha;
      ctx.strokeText(str, px, py);
    }
    ctx.fillStyle = col;
    ctx.globalAlpha = alpha;
    ctx.fillText(str, px, py);
    ctx.restore();
  },

  drawBadgePill(ctx, text, cx, cy, fgCol, borderCol, bgCol, dpi, opts = {}) {
    const fontPx = opts.fontPx || 9.5;
    const weight = opts.weight || '600';
    const padX = (opts.padX ?? 6) * dpi;
    const padY = (opts.padY ?? 3) * dpi;
    const radius = (opts.radius ?? 4) * dpi;

    ctx.save();
    ctx.font = `${weight} ${fontPx * dpi}px ${_OVL.FONT_MONO}`;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = fontPx * dpi + padY * 2;
    const rx = cx - bw * 0.5;
    const ry = cy - bh * 0.5;

    _OVL.roundRect(ctx, rx, ry, bw, bh, radius);
    ctx.fillStyle = bgCol;
    ctx.fill();
    if (borderCol) {
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = (opts.lineWidth ?? 1.1) * dpi;
      ctx.stroke();
    }

    ctx.fillStyle = fgCol;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 0.4 * dpi);
    ctx.restore();

    return { rx, ry, bw, bh };
  },

  resolveProcEndpoints(proc, points) {
    if (!proc || !Array.isArray(points)) return null;
    if (Array.isArray(proc)) {
      const a = points[proc[0]];
      const b = points[proc[1]];
      return a && b ? { a, b } : null;
    }
    const aId = proc.aId ?? proc.fromId ?? proc.startId;
    const bId = proc.bId ?? proc.toId ?? proc.endId;
    const a = points.find(p => p.id === aId);
    const b = points.find(p => p.id === bId);
    return a && b ? { a, b } : null;
  },

  resolveProcColor(proc, metrics, a, b, pal) {
    if (proc?.color) return proc.color;
    const cls = metrics?.typeInfo?.cls || metrics?.cls || metrics?.category || metrics?.kind;
    if (cls && pal[cls]) return pal[cls];
    const directColor = metrics?.typeInfo?.color || metrics?.color;
    if (directColor) return directColor;

    const dT = b.T - a.T;
    const dW = b.w - a.w;
    const epsT = 0.05;
    const epsW = 0.0001;
    if (Math.abs(dW) < epsW && dT > epsT) return pal.heat || '#f87171';
    if (Math.abs(dW) < epsW && dT < -epsT) return pal.cool || '#38bdf8';
    if (dT < -epsT && dW < -epsW) return pal.cool || '#38bdf8';
    if (dT > epsT && dW > epsW) return pal.heat || '#f87171';
    if (Math.abs(dT) < epsT && dW > epsW) return pal.humid || '#34d399';
    if (Math.abs(dT) < epsT && dW < -epsW) return pal.dehum || '#fbbf24';
    if (dT < -epsT && dW > epsW) {
      const h1 = Psy.h_kJkg(a.T, a.w);
      const h2 = Psy.h_kJkg(b.T, b.w);
      if (Math.abs(h2 - h1) < 2.2) return pal.evap || '#22d3ee';
      return pal.cool || '#38bdf8';
    }
    if (dT > epsT && dW < -epsW) return pal.desiccant || pal.heat || '#fb923c';
    return pal.muted || '#94a3b8';
  },

  extractMixStreams(derived, points) {
    if (!derived || derived.type !== 'mix' || !Array.isArray(points)) return [];
    const findPt = id => points.find(q => q.id === id);
    const raw = [];

    if (Array.isArray(derived.streams) && derived.streams.length >= 2) {
      for (const s of derived.streams) {
        if (!s) continue;
        const pid = s.id ?? s.ptId ?? s.pointId;
        const pt = findPt(pid);
        const m = Number(s.m ?? s.mDot ?? s.massFlow ?? s.flow ?? s.weight ?? s.frac ?? s.fraction ?? 0);
        if (pt && Number.isFinite(m) && m > 0) raw.push({ pt, m });
      }
    } else {
      const A = findPt(derived.aId);
      const B = findPt(derived.bId);
      const mA = Number(derived.mA ?? derived.wA ?? derived.fracA ?? 0);
      const mB = Number(derived.mB ?? derived.wB ?? derived.fracB ?? 0);
      if (A && Number.isFinite(mA) && mA > 0) raw.push({ pt: A, m: mA });
      if (B && Number.isFinite(mB) && mB > 0) raw.push({ pt: B, m: mB });
      if (derived.cId != null) {
        const C = findPt(derived.cId);
        const mC = Number(derived.mC ?? derived.wC ?? derived.fracC ?? 0);
        if (C && Number.isFinite(mC) && mC > 0) raw.push({ pt: C, m: mC });
      }
    }

    const total = raw.reduce((sum, s) => sum + s.m, 0);
    if (total <= 0) return [];
    return raw.map(s => ({ pt: s.pt, m: s.m, frac: s.m / total }));
  },

  buildCoilCurvePixelPath(a, b, adp, br) {
    if (adp && Array.isArray(adp.coilCurvePts) && adp.coilCurvePts.length >= 2) {
      const pts = [];
      for (const cp of adp.coilCurvePts) {
        const T = Array.isArray(cp) ? cp[0] : cp.T;
        const w = Array.isArray(cp) ? cp[1] : cp.w;
        if (Number.isFinite(T) && Number.isFinite(w)) {
          pts.push([br.xc(T), br.yc(w)]);
        }
      }
      if (pts.length >= 2) return pts;
    }

    // Fallback smooth psychrometric coil bend if coilCurvePts not returned
    const steps = 20;
    const pts = [];
    const ctrlT = b.T + (a.T - b.T) * 0.35;
    const ctrlW = a.w - (a.w - b.w) * 0.14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const omt = 1 - t;
      const T = omt * omt * a.T + 2 * omt * t * ctrlT + t * t * b.T;
      const w = omt * omt * a.w + 2 * omt * t * ctrlW + t * t * b.w;
      pts.push([br.xc(T), br.yc(w)]);
    }
    return pts;
  },

  computePolylineMetrics(pts) {
    const cum = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      total += Math.hypot(dx, dy);
      cum.push(total);
    }
    return { cum, total };
  },

  samplePolyline(pts, metrics, frac) {
    const { cum, total } = metrics;
    if (pts.length === 0) return { x: 0, y: 0, tx: 1, ty: 0 };
    if (pts.length === 1 || total <= 1e-6) return { x: pts[0][0], y: pts[0][1], tx: 1, ty: 0 };

    const target = CoreDOM.clamp(frac, 0, 1) * total;
    let hi = 1;
    while (hi < cum.length - 1 && cum[hi] < target) hi++;
    const lo = hi - 1;
    const segLen = Math.max(1e-6, cum[hi] - cum[lo]);
    const localT = CoreDOM.clamp((target - cum[lo]) / segLen, 0, 1);

    const p0 = pts[lo];
    const p1 = pts[hi];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: p0[0] + dx * localT,
      y: p0[1] + dy * localT,
      tx: dx / len,
      ty: dy / len
    };
  },

  trimPolylineEnd(pts, trimDist) {
    if (pts.length < 2 || trimDist <= 0) return pts;
    const out = pts.map(p => [p[0], p[1]]);
    let rem = trimDist;
    while (out.length >= 2 && rem > 0) {
      const n = out.length;
      const dx = out[n - 1][0] - out[n - 2][0];
      const dy = out[n - 1][1] - out[n - 2][1];
      const d = Math.hypot(dx, dy);
      if (d <= rem && out.length > 2) {
        out.pop();
        rem -= d;
      } else if (d > 1e-6) {
        const ratio = Math.max(0, (d - rem) / d);
        out[n - 1] = [out[n - 2][0] + dx * ratio, out[n - 2][1] + dy * ratio];
        rem = 0;
      } else {
        break;
      }
    }
    return out;
  },

  strokePolyline(ctx, pts) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.stroke();
  },

  resolveTrendStyle(pal, state) {
    const out = {
      arrowStyle: 'cad-chevron',
      lineWeight: 'standard',
      pointMarker: 'precision-ring',
      badgeStyle: 'detailed',
      showDecompLegs: false
    };
    const merge = (src) => {
      if (!src || typeof src !== 'object') return;
      for (const k of Object.keys(out)) {
        if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
      }
    };
    merge(pal?.trendStyle);
    merge(state?.trendStyle);
    return out;
  },

  resolveLineWeight(lineWeight, pal) {
    if (lineWeight === 'fine') return 1.75;
    if (lineWeight === 'bold') return 3.4;
    return Number.isFinite(pal?.arrowW) ? pal.arrowW : 2.5;
  },

  drawTaperedArrowhead(ctx, tipX, tipY, angle, headLen, color, alpha = 1, arrowStyle = 'cad-chevron', strokeW = 2) {
    if (!Number.isFinite(tipX) || !Number.isFinite(tipY) || !Number.isFinite(angle) || !Number.isFinite(headLen)) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    if (arrowStyle === 'open-vector') {
      const spread = Math.PI / 5.5;
      const leftX = tipX - headLen * Math.cos(angle - spread);
      const leftY = tipY - headLen * Math.sin(angle - spread);
      const rightX = tipX - headLen * Math.cos(angle + spread);
      const rightY = tipY - headLen * Math.sin(angle + spread);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.4, Number.isFinite(strokeW) ? strokeW : 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(leftX, leftY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(rightX, rightY);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (arrowStyle === 'solid-triangle') {
      const spread = Math.PI / 7.5;
      const leftX = tipX - headLen * Math.cos(angle - spread);
      const leftY = tipY - headLen * Math.sin(angle - spread);
      const rightX = tipX - headLen * Math.cos(angle + spread);
      const rightY = tipY - headLen * Math.sin(angle + spread);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    // Default: 'cad-chevron' — sleek notched engineering arrowhead
    const spread = Math.PI / 6.5;
    const notch = headLen * 0.76;
    const leftX = tipX - headLen * Math.cos(angle - spread);
    const leftY = tipY - headLen * Math.sin(angle - spread);
    const rightX = tipX - headLen * Math.cos(angle + spread);
    const rightY = tipY - headLen * Math.sin(angle + spread);
    const baseX = tipX - notch * Math.cos(angle);
    const baseY = tipY - notch * Math.sin(angle);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(baseX, baseY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  drawStatePointMarker(ctx, px, py, ptSz, ptCol, pal, isDark, dpi, pointMarker = 'precision-ring') {
    const bgCol = pal.plotBg || pal.bg || (isDark ? '#0f1520' : '#ffffff');
    ctx.save();
    ctx.setLineDash([]);

    if (pointMarker === 'crosshair-circle') {
      // Authentic Carrier / Mollier / CAD open target circle with 4 precision orthogonal hair-ticks
      const r = ptSz * 1.05;
      const tickOut = 4.5 * dpi;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = bgCol;
      ctx.fill();
      ctx.strokeStyle = ptCol;
      ctx.lineWidth = 1.8 * dpi;
      ctx.stroke();

      // Center precision pinpoint
      ctx.beginPath();
      ctx.arc(px, py, 1.35 * dpi, 0, Math.PI * 2);
      ctx.fillStyle = ptCol;
      ctx.fill();

      // 4 orthogonal hair-ticks extending outward
      ctx.strokeStyle = ptCol;
      ctx.lineWidth = 1.35 * dpi;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py - r);
      ctx.lineTo(px, py - r - tickOut);
      ctx.moveTo(px, py + r);
      ctx.lineTo(px, py + r + tickOut);
      ctx.moveTo(px - r, py);
      ctx.lineTo(px - r - tickOut, py);
      ctx.moveTo(px + r, py);
      ctx.lineTo(px + r + tickOut, py);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (pointMarker === 'solid-dot') {
      // Classic ASHRAE / Print B&W crisp filled dot with contrasting white/bg stroke rim (1.6 * dpi)
      const r = ptSz * 1.05;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = ptCol;
      ctx.fill();
      ctx.strokeStyle = bgCol;
      ctx.lineWidth = 1.6 * dpi;
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (pointMarker === 'diamond') {
      // Distinctive CIBSE rotated diamond state marker with crisp rim
      const dr = ptSz * 1.32;
      ctx.beginPath();
      ctx.moveTo(px, py - dr);
      ctx.lineTo(px + dr, py);
      ctx.lineTo(px, py + dr);
      ctx.lineTo(px - dr, py);
      ctx.closePath();
      ctx.fillStyle = ptCol;
      ctx.fill();
      ctx.strokeStyle = bgCol;
      ctx.lineWidth = 1.6 * dpi;
      ctx.lineJoin = 'miter';
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Default: 'precision-ring' — soft ambient glow + filled core + precision outer halo ring
    const gradR = ptSz + 5 * dpi;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, gradR);
    grad.addColorStop(0, _OVL.withAlpha(ptCol, 0.35));
    grad.addColorStop(1, _OVL.withAlpha(ptCol, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, gradR, 0, Math.PI * 2);
    ctx.fill();

    // Outer precision ring
    ctx.strokeStyle = ptCol;
    ctx.lineWidth = 1.5 * dpi;
    ctx.beginPath();
    ctx.arc(px, py, ptSz + 2 * dpi, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle contrast gap ring
    ctx.strokeStyle = bgCol;
    ctx.lineWidth = 1.1 * dpi;
    ctx.beginPath();
    ctx.arc(px, py, ptSz + 0.4 * dpi, 0, Math.PI * 2);
    ctx.stroke();

    // Solid inner core
    ctx.fillStyle = ptCol;
    ctx.beginPath();
    ctx.arc(px, py, ptSz, 0, Math.PI * 2);
    ctx.fill();

    // Crisp specular center pinpoint
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(px - ptSz * 0.18, py - ptSz * 0.18, ptSz * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  pointToSegDistSq(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    if (lenSq <= 1e-9) {
      const dx = px - ax;
      const dy = py - ay;
      return dx * dx + dy * dy;
    }
    const t = CoreDOM.clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1);
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy;
  },

  formatProcessBadge(idx, proc, metrics, units, isSelected, totalLenPx, dpi, badgeStyle = 'detailed') {
    const tag = proc?.tag || `S${idx + 1}`;
    if (badgeStyle === 'inline-minimal') return tag;

    const minLen = badgeStyle === 'pill' ? 110 * dpi : 95 * dpi;
    const showDetails = isSelected || totalLenPx >= minLen;
    if (!showDetails || !metrics) return tag;

    const qtKw = metrics.Qt_kW ?? metrics.Qt ?? metrics.qt_kW ?? metrics.qt;
    const tons = metrics.Qt_TR ?? metrics.tons ?? metrics.TR ?? metrics.tonsTR ?? (Number.isFinite(qtKw) ? qtKw / 3.51685284 : NaN);
    const shr = metrics.SHR ?? metrics.shr;

    const parts = [tag];
    if (Number.isFinite(qtKw) && Math.abs(qtKw) >= 0.05) {
      if (units === 'IP') {
        const absTons = Math.abs(tons);
        if (absTons >= 0.15) {
          parts.push(`${absTons.toFixed(1)} TR`);
        } else {
          const kbtuh = Math.abs(qtKw) * 3.412142;
          parts.push(`${kbtuh.toFixed(1)} kBTU/h`);
        }
      } else {
        parts.push(`${Math.abs(qtKw).toFixed(1)} kW`);
      }
    }

    if (badgeStyle === 'pill') {
      return parts.join(' · ');
    }

    if (isSelected && Number.isFinite(shr) && Math.abs(shr) <= 1.05) {
      parts.push(`SHR ${shr.toFixed(2)}`);
    } else if (parts.length === 1 && Number.isFinite(shr) && Math.abs(shr) <= 1.05 && totalLenPx >= 130 * dpi) {
      parts.push(`SHR ${shr.toFixed(2)}`);
    }

    return parts.join(' · ');
  },

  formatDecompLegLabels(dT, dW, metrics, units) {
    const isIP = units === 'IP';
    const qsKw = metrics?.Qs_kW ?? metrics?.Qs;
    const qlKw = metrics?.Ql_kW ?? metrics?.Ql;
    const hasLoad = Number.isFinite(qsKw) && Number.isFinite(qlKw) &&
      (Math.abs(qsKw) >= 0.05 || Math.abs(qlKw) >= 0.05);

    if (hasLoad) {
      const fmtQ = (prefix, qKw) => {
        const s = qKw > 0 ? '+' : (qKw < 0 ? '-' : '');
        const absKw = Math.abs(qKw);
        if (isIP) {
          const absTr = absKw / 3.51685284;
          if (absTr >= 0.15) return `${prefix} ${s}${absTr.toFixed(1)} TR`;
          return `${prefix} ${s}${(absKw * 3.412142).toFixed(1)} kBTU/h`;
        }
        return `${prefix} ${s}${absKw.toFixed(1)} kW`;
      };
      return {
        sensText: fmtQ('Qs', qsKw),
        latText: fmtQ('Ql', qlKw)
      };
    }

    const dTDisp = isIP ? dT * 1.8 : dT;
    const dWDisp = isIP ? dW * 7000 : dW * 1000;
    const sT = dTDisp >= 0 ? '+' : '';
    const sW = dWDisp >= 0 ? '+' : '';
    return {
      sensText: `ΔT ${sT}${dTDisp.toFixed(1)}${isIP ? '°F' : '°C'}`,
      latText: `ΔW ${sW}${dWDisp.toFixed(isIP ? 1 : 1)} ${isIP ? 'gr/lb' : 'g/kg'}`
    };
  },

  getLabelMetrics(ctx, p, idx, br, state, pal) {
    const dpi = br.dpi || 1;
    const ptx = br.xc(p.T);
    const pty = br.yc(p.w);
    const lx = (p.lx ?? 10) * dpi;
    const ly = (p.ly ?? -6) * dpi;
    const fontSize = CoreDOM.clamp(Number(state?.grid?.labelPx ?? state?.labelPx ?? pal?.lblPx ?? 11), 9, 16);
    const labelText = (p.locked ? '🔒 ' : '') + (p.label || `P${idx + 1}`);

    let tw = labelText.length * fontSize * 0.62 * dpi;
    if (ctx) {
      ctx.save();
      ctx.font = `500 ${fontSize * dpi}px ${_OVL.FONT_MONO}`;
      tw = ctx.measureText(labelText).width;
      ctx.restore();
    }

    const padX = 4 * dpi;
    const ascent = fontSize * 0.98 * dpi;
    const descent = fontSize * 0.36 * dpi;
    const tx = ptx + lx;
    const ty = pty + ly;
    const rx = tx - padX;
    const ry = ty - ascent;
    const rw = tw + padX * 2;
    const rh = ascent + descent;

    return {
      ptx,
      pty,
      lx,
      ly,
      tx,
      ty,
      rx,
      ry,
      rw,
      rh,
      cx: rx + rw * 0.5,
      cy: ry + rh * 0.5,
      dist: Math.hypot(lx, ly),
      fontSize,
      labelText
    };
  },

  getAnnotationRect(ctx, ann, br, plot = null) {
    const dpi = br.dpi || 1;
    const pinX = br.xc(ann.T);
    const pinY = br.yc(ann.w);
    const ox = (ann.dx ?? ann.lx ?? 16) * dpi;
    const oy = (ann.dy ?? ann.ly ?? -24) * dpi;
    const rawText = String(ann.text ?? ann.label ?? 'Note').trim() || 'Note';
    const lines = rawText.split(/\r?\n/);
    const fontSize = 10 * dpi;
    const lineH = 13.5 * dpi;
    const padX = 8 * dpi;
    const padY = 5 * dpi;
    const accentBarW = 3 * dpi;

    let maxW = 40 * dpi;
    if (ctx) {
      ctx.save();
      ctx.font = `500 ${fontSize}px ${_OVL.FONT_SANS}`;
      maxW = 0;
      for (const ln of lines) {
        const w = ctx.measureText(ln).width;
        if (w > maxW) maxW = w;
      }
      ctx.restore();
    } else {
      for (const ln of lines) {
        const w = ln.length * fontSize * 0.58;
        if (w > maxW) maxW = w;
      }
    }

    const bw = Math.max(36 * dpi, maxW + padX * 2 + accentBarW);
    const bh = lines.length * lineH + padY * 2;
    let bx = pinX + ox;
    let by = pinY + oy - bh * 0.5;

    const effPlot = plot || _OVL.normPlotRect(br);
    if (effPlot && effPlot.w > 0 && effPlot.h > 0) {
      const pad = 6 * dpi;
      const plotRight = effPlot.x + effPlot.w;
      const plotBottom = effPlot.y + effPlot.h;
      if (ox >= 0 && bx + bw > plotRight - pad) {
        bx = pinX - Math.abs(ox) - bw;
      }
      bx = CoreDOM.clamp(bx, effPlot.x + pad, Math.max(effPlot.x + pad, plotRight - bw - pad));
      by = CoreDOM.clamp(by, effPlot.y + pad, Math.max(effPlot.y + pad, plotBottom - bh - pad));
    }

    return { pinX, pinY, bx, by, bw, bh, lines, fontSize, lineH, padX, padY, accentBarW };
  }
};

export class OverlayRenderer {
  constructor(canvas, baseRenderer) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.br = baseRenderer;
    this._animPhase = 0;
    this._rafId = null;
    this._lastState = null;
    this._lastFrameTime = 0;
    this._resolvedLabels = new Map();

    this._onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (this._rafId != null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this._rafId);
          this._rafId = null;
        }
      } else if (this._lastState) {
        this.syncAnimation(this._lastState);
      }
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  getResolvedLabelPos(ptId) {
    return this._resolvedLabels.get(ptId) || null;
  }

  _shouldAnimate(state) {
    return Boolean(
      state &&
      state.layers?.flowAnim &&
      state.layers?.processes !== false &&
      Array.isArray(state.processes) &&
      state.processes.length > 0 &&
      typeof requestAnimationFrame === 'function' &&
      !(typeof document !== 'undefined' && document.hidden)
    );
  }

  syncAnimation(state) {
    this._lastState = state;
    if (this._shouldAnimate(state)) {
      if (this._rafId == null) {
        this._lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const tick = (now) => {
          const ts = typeof now === 'number' ? now : Date.now();
          const dt = CoreDOM.clamp((ts - this._lastFrameTime) / 1000, 0.001, 0.1);
          this._lastFrameTime = ts;
          this._animPhase = (this._animPhase + dt * 0.42) % 1;

          const st = this._lastState;
          if (!this._shouldAnimate(st)) {
            this._rafId = null;
            return;
          }
          this._renderInternal(st);
          if (this._shouldAnimate(this._lastState)) {
            this._rafId = requestAnimationFrame(tick);
          } else {
            this._rafId = null;
          }
        };
        this._rafId = requestAnimationFrame(tick);
      }
    } else if (this._rafId != null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this._rafId);
      }
      this._rafId = null;
    }
  }

  destroy() {
    if (this._rafId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function' && this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this._rafId = null;
    this._lastState = null;
    this._resolvedLabels.clear();
  }

  _placeNonCollidingRect(candidates, plot, occupiedRects, pad = 3, opts = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const excludeTag = opts.excludeTag ?? null;
    const record = opts.record !== false;
    const minX = plot.x + pad;
    const minY = plot.y + pad;

    let bestRect = null;
    let bestOverlap = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand) continue;
      const w = cand[2];
      const h = cand[3];
      const maxX = Math.max(minX, plot.right - pad - w);
      const maxY = Math.max(minY, plot.bottom - pad - h);
      const cx = CoreDOM.clamp(cand[0], minX, maxX);
      const cy = CoreDOM.clamp(cand[1], minY, maxY);
      const rect = [cx, cy, w, h];

      let overlap = 0;
      for (let j = 0; j < occupiedRects.length; j++) {
        const occ = occupiedRects[j];
        if (!occ) continue;
        if (excludeTag != null && occ.tag === excludeTag) continue;
        overlap += _OVL.rectOverlapArea(rect, occ, pad);
      }

      if (overlap === 0) {
        bestRect = rect;
        bestOverlap = 0;
        break;
      }
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestRect = rect;
      }
    }

    if (bestRect && record) {
      occupiedRects.push(bestRect);
    }
    return bestRect;
  }

  _renderInternal(state) {
    const br = this.br;
    if (!this.canvas || !this.ctx || !br || !state) return;

    const w = br.width ?? br.W ?? br.canvas?.width ?? 0;
    const h = br.height ?? br.H ?? br.canvas?.height ?? 0;
    if (w <= 0 || h <= 0) return;

    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;

    this.ctx.clearRect(0, 0, w, h);
    this.renderToContext(this.ctx, br, state, { isExport: false });
  }

  render(state) {
    this._lastState = state;
    this._renderInternal(state);
    this.syncAnimation(state);
  }

  renderToContext(ctx, br, state, opts = {}) {
    if (!ctx || !br || !state) return;
    const dpi = br.dpi || 1;
    const plot = _OVL.normPlotRect(br);
    if (plot.w <= 0 || plot.h <= 0) return;

    const pal = CoreDOM.resolveThemePalette(state.theme, state.customTheme);
    const tr = _OVL.resolveTrendStyle(pal, state);
    const isDark = _OVL.isDarkBg(pal.plotBg || pal.bg);
    const isExport = Boolean(opts.isExport);
    const layers = state.layers || {};

    // Shared 2D collision registry seeded with every point marker & SHR dial card
    const occupiedRects = [];
    if (layers.points !== false && Array.isArray(state.points)) {
      for (let i = 0; i < state.points.length; i++) {
        const p = state.points[i];
        if (!p || !Number.isFinite(p.T) || !Number.isFinite(p.w)) continue;
        const px = br.xc(p.T);
        const py = br.yc(p.w);
        const mRect = [px - 10 * dpi, py - 10 * dpi, 20 * dpi, 20 * dpi];
        mRect.tag = `pt:${p.id}`;
        occupiedRects.push(mRect);
      }
    }
    if (state.shr && state.shr.show && plot.w >= 170 * dpi && plot.h >= 170 * dpi) {
      occupiedRects.push([plot.x + 12 * dpi, plot.y + (isExport ? 12 : 54) * dpi, 114 * dpi, 128 * dpi]);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();

    // 1. Scenario Comparison Ghost Layer
    if (state.compareScenarioId) {
      this._drawScenarioGhost(ctx, br, state, pal, isDark, dpi);
    }

    // 2. Mixing Lever-Rule Bridge Lines (collect % badges for collision-free placement after processes)
    let pendingMixBadges = [];
    if (layers.mixlinks !== false) {
      pendingMixBadges = this._drawMixLinks(ctx, br, state, pal, isDark, dpi);
    }

    // 2b. Optional Sensible / Latent Right-Angle Decomposition Projection Legs (underneath process arrows)
    let pendingDecompLabels = [];
    if (layers.processes !== false && tr.showDecompLegs === true) {
      pendingDecompLabels = this._drawProcessDecompLegs(ctx, br, state, pal, isDark, dpi);
    }

    // 3. Processes, Curved Coil ADP Extensions & Animated Flow Particles (ADP pills placed immediately)
    let pendingProcBadges = [];
    if (layers.processes !== false) {
      pendingProcBadges = this._drawProcesses(ctx, br, plot, state, pal, isDark, dpi, isExport, occupiedRects, tr);
    }

    // 4. Resolve Point Label bounding boxes (fixed preset/dragged + collision-checked default offsets)
    let resolvedLabelMap = null;
    if (layers.points !== false) {
      resolvedLabelMap = this._resolvePointLabels(ctx, br, plot, state, pal, dpi, occupiedRects);
      if (!isExport) {
        this._resolvedLabels = resolvedLabelMap;
      }
    } else if (!isExport) {
      this._resolvedLabels.clear();
    }

    // 5. Place & Draw Process Midpoint Badges (collision-free against markers, ADP pills & point labels)
    if (pendingProcBadges.length > 0) {
      this._drawProcessBadges(ctx, plot, pendingProcBadges, pal, isDark, dpi, occupiedRects, tr);
    }

    // 5b. Place & Draw Sensible / Latent Decomposition Leg Mini-Labels (collision-free via occupiedRects)
    if (pendingDecompLabels.length > 0) {
      this._drawDecompLegLabels(ctx, plot, pendingDecompLabels, pal, isDark, dpi, occupiedRects, tr);
    }

    // 6. Place & Draw Mix % Badges (opposite side of bridge from any process badge)
    if (pendingMixBadges.length > 0) {
      this._drawMixBadges(ctx, plot, pendingMixBadges, isDark, dpi, occupiedRects);
    }

    // 7. Interactive ASHRAE SHR Protractor & Reference Slope Line
    if (state.shr && state.shr.show) {
      this._drawSHRReferenceAndProtractor(ctx, br, plot, state, pal, isDark, dpi, isExport);
    }

    // 8. State Points & Labels
    if (layers.points !== false) {
      this._drawPoints(ctx, br, state, pal, isDark, dpi, isExport, resolvedLabelMap, tr);
    }

    // 9. Custom Engineering Annotations
    if (layers.annotations !== false) {
      this._drawAnnotations(ctx, br, plot, state, pal, isDark, dpi);
    }

    // 10. Interactive Measure / Ruler Tool
    if (!isExport && state.ui?.measureStart && state.ui?.measureEnd) {
      this._drawMeasureTool(ctx, br, plot, state, pal, isDark, dpi);
    }

    // 11. Marquee Box-Zoom Rect
    if (!isExport && state.ui?.boxZoom) {
      this._drawBoxZoom(ctx, state.ui.boxZoom, isDark, dpi);
    }

    // 12. Precision Crosshair
    if (!isExport && state.ui?.hoverPx != null) {
      this._drawCrosshair(ctx, br, plot, state, pal, isDark, dpi);
    }

    ctx.restore();
  }

  /* --------------------------------------------------------------------------
     1. Scenario Comparison Ghost Layer
     -------------------------------------------------------------------------- */
  _drawScenarioGhost(ctx, br, state, pal, isDark, dpi) {
    const scenarios = state.scenarios || [];
    const scen = scenarios.find(
      s => s && (s.id === state.compareScenarioId || String(s.id) === String(state.compareScenarioId))
    );
    if (!scen) return;

    const ghostPts = Array.isArray(scen.points) ? scen.points : [];
    const ghostProcs = Array.isArray(scen.processes) ? scen.processes : [];
    const ghostStroke = isDark ? 'rgba(148,163,184,0.68)' : 'rgba(71,85,105,0.62)';
    const ghostLabelCol = isDark ? 'rgba(148,163,184,0.82)' : 'rgba(71,85,105,0.78)';
    const ptSz = (pal.ptSize || 4.5) * dpi;

    // Ghost processes
    ctx.save();
    ctx.strokeStyle = ghostStroke;
    ctx.lineWidth = 1.8 * dpi;
    ctx.setLineDash([6 * dpi, 4 * dpi]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const gp of ghostProcs) {
      const ep = _OVL.resolveProcEndpoints(gp, ghostPts);
      if (!ep) continue;
      const ax = br.xc(ep.a.T);
      const ay = br.yc(ep.a.w);
      const bx = br.xc(ep.b.T);
      const by = br.yc(ep.b.w);
      const dist = Math.hypot(bx - ax, by - ay);
      if (dist < 2 * dpi) continue;

      const ang = Math.atan2(by - ay, bx - ax);
      const endX = dist > 20 * dpi ? bx - Math.cos(ang) * (ptSz + 3 * dpi) : bx;
      const endY = dist > 20 * dpi ? by - Math.sin(ang) * (ptSz + 3 * dpi) : by;

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      _OVL.drawTaperedArrowhead(ctx, endX, endY, ang, 10 * dpi, ghostStroke, 0.72);
    }
    ctx.restore();

    // Ghost points as hollow ring markers with [Baseline] labels
    for (let i = 0; i < ghostPts.length; i++) {
      const p = ghostPts[i];
      if (!p || !Number.isFinite(p.T) || !Number.isFinite(p.w)) continue;
      const px = br.xc(p.T);
      const py = br.yc(p.w);

      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, ptSz + 1.5 * dpi, 0, Math.PI * 2);
      ctx.fillStyle = _OVL.withAlpha(pal.plotBg || pal.bg, 0.5);
      ctx.fill();
      ctx.strokeStyle = ghostStroke;
      ctx.lineWidth = 1.7 * dpi;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, py, 1.4 * dpi, 0, Math.PI * 2);
      ctx.fillStyle = ghostStroke;
      ctx.fill();
      ctx.restore();

      const lx = (p.lx ?? 10) * dpi;
      const ly = (p.ly ?? -6) * dpi;
      const lbl = `${p.label || `P${i + 1}`} [Baseline]`;
      _OVL.textHalo(ctx, lbl, px + lx, py + ly, ghostLabelCol, pal, dpi, {
        sizePx: 9.5,
        italic: true,
        alpha: 0.85
      });
    }
  }

  /* --------------------------------------------------------------------------
     2. Mixing Lever-Rule Bridges
     -------------------------------------------------------------------------- */
  _drawMixLinks(ctx, br, state, pal, isDark, dpi) {
    const pts = state.points || [];
    const mixCol = pal.mix || '#facc15';
    const badgeBg = isDark ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.92)';
    const pendingMixBadges = [];

    for (const p of pts) {
      if (!p || !p.derived || p.derived.type !== 'mix') continue;
      const streams = _OVL.extractMixStreams(p.derived, pts);
      if (streams.length < 2) continue;

      const mx = br.xc(p.T);
      const my = br.yc(p.w);

      ctx.save();
      ctx.strokeStyle = mixCol;
      ctx.lineWidth = 1.65 * dpi;
      ctx.setLineDash([6 * dpi, 4 * dpi]);
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.78;

      if (streams.length === 2) {
        const ax = br.xc(streams[0].pt.T);
        const ay = br.yc(streams[0].pt.w);
        const bx = br.xc(streams[1].pt.T);
        const by = br.yc(streams[1].pt.w);

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(mx, my);
        ctx.lineTo(bx, by);
        ctx.stroke();

        // Fulcrum tick perpendicular to the bridge at mix point
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        ctx.setLineDash([]);
        ctx.lineWidth = 1.6 * dpi;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(mx - nx * 8 * dpi, my - ny * 8 * dpi);
        ctx.lineTo(mx + nx * 8 * dpi, my + ny * 8 * dpi);
        ctx.stroke();
      } else {
        // Multi-stream (3+ streams): dashed spokes from each source into mix point
        for (const s of streams) {
          const sx = br.xc(s.pt.T);
          const sy = br.yc(s.pt.w);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(mx, my);
          ctx.stroke();
        }
      }
      ctx.restore();

      // Defer mass-fraction % badges until after process badges so they sit on opposite side
      for (const s of streams) {
        const sx = br.xc(s.pt.T);
        const sy = br.yc(s.pt.w);
        const segLen = Math.hypot(mx - sx, my - sy);
        if (segLen < 32 * dpi) continue;

        const pct = s.frac * 100;
        const pctTxt = Math.abs(pct - Math.round(pct)) < 0.05
          ? `${Math.round(pct)}%`
          : `${pct.toFixed(1)}%`;

        pendingMixBadges.push({
          sx,
          sy,
          mx,
          my,
          segLen,
          pctTxt,
          mixCol,
          badgeBg
        });
      }
    }

    return pendingMixBadges;
  }

  _drawMixBadges(ctx, plot, pendingMixBadges, isDark, dpi, occupiedRects) {
    const pillOpts = { fontPx: 8.5, padX: 4.5, padY: 2, radius: 3.5 };
    for (let i = 0; i < pendingMixBadges.length; i++) {
      const m = pendingMixBadges[i];
      if (m.segLen < 32 * dpi) continue;
      const dx = m.mx - m.sx;
      const dy = m.my - m.sy;
      const tx = dx / m.segLen;
      const ty = dy / m.segLen;
      let nx = -ty;
      let ny = tx;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }

      const { bw, bh } = _OVL.measureBadgePill(ctx, m.pctTxt, dpi, pillOpts);
      const midX = m.sx + dx * 0.46;
      const midY = m.sy + dy * 0.46;
      const t35X = m.sx + dx * 0.34;
      const t35Y = m.sy + dy * 0.34;
      const t65X = m.sx + dx * 0.62;
      const t65Y = m.sy + dy * 0.62;

      const makeRect = (cx, cy) => [cx - bw * 0.5, cy - bh * 0.5, bw, bh];
      // Prefer opposite side (-normal) first since process badges prefer +normal
      const candidates = [
        makeRect(midX - nx * 13 * dpi, midY - ny * 13 * dpi),
        makeRect(midX + nx * 13 * dpi, midY + ny * 13 * dpi),
        makeRect(t35X - nx * 14 * dpi, t35Y - ny * 14 * dpi),
        makeRect(t65X - nx * 14 * dpi, t65Y - ny * 14 * dpi),
        makeRect(t35X + nx * 14 * dpi, t35Y + ny * 14 * dpi),
        makeRect(t65X + nx * 14 * dpi, t65Y + ny * 14 * dpi),
        makeRect(midX - nx * 24 * dpi, midY - ny * 24 * dpi),
        makeRect(midX + nx * 24 * dpi, midY + ny * 24 * dpi)
      ];

      const chosen = this._placeNonCollidingRect(candidates, plot, occupiedRects, 3 * dpi);
      if (!chosen) continue;

      const textCol = _OVL.readableLabelColor(m.mixCol, isDark);
      _OVL.drawBadgePill(
        ctx,
        m.pctTxt,
        chosen[0] + bw * 0.5,
        chosen[1] + bh * 0.5,
        textCol,
        _OVL.withAlpha(textCol, 0.55),
        m.badgeBg,
        dpi,
        pillOpts
      );
    }
  }

  /* --------------------------------------------------------------------------
     2b. Sensible / Latent Right-Angle Decomposition Legs (trendStyle.showDecompLegs)
     -------------------------------------------------------------------------- */
  _drawProcessDecompLegs(ctx, br, state, pal, isDark, dpi) {
    const pts = state.points || [];
    const procs = state.processes || [];
    if (!procs.length) return [];

    let target = null;
    let targetEp = null;
    if (state.ui?.selectedProcId != null) {
      const sel = procs.find(p => p && p.id === state.ui.selectedProcId);
      if (sel) {
        const ep = _OVL.resolveProcEndpoints(sel, pts);
        if (ep && Math.abs(ep.b.T - ep.a.T) > 0.5 && Math.abs(ep.b.w - ep.a.w) > 0.0003) {
          target = sel;
          targetEp = ep;
        }
      }
    } else {
      let bestScore = -1;
      for (let i = 0; i < procs.length; i++) {
        const pr = procs[i];
        const ep = _OVL.resolveProcEndpoints(pr, pts);
        if (!ep) continue;
        const dT = ep.b.T - ep.a.T;
        const dW = ep.b.w - ep.a.w;
        if (Math.abs(dT) <= 0.5 || Math.abs(dW) <= 0.0003) continue;
        if (_OVL.isNonCoilProcess(pr, ep.b)) continue;
        const isCoil = (dT < -0.5 && dW < -0.0003) || Boolean(pr.showCurve);
        const score = (isCoil ? 1000 : 0) + Math.abs(dT) * 10 + Math.abs(dW) * 10000;
        if (score > bestScore) {
          bestScore = score;
          target = pr;
          targetEp = ep;
        }
      }
      if (!target) {
        for (let i = 0; i < procs.length; i++) {
          const pr = procs[i];
          const ep = _OVL.resolveProcEndpoints(pr, pts);
          if (!ep) continue;
          if (Math.abs(ep.b.T - ep.a.T) > 0.5 && Math.abs(ep.b.w - ep.a.w) > 0.0003) {
            target = pr;
            targetEp = ep;
            break;
          }
        }
      }
    }

    if (!target || !targetEp) return [];
    const { a, b } = targetEp;
    const dT = b.T - a.T;
    const dW = b.w - a.w;

    const ax = br.xc(a.T);
    const ay = br.yc(a.w);
    const bx = br.xc(b.T);
    const by = br.yc(b.w);
    // Right-angle corner point (b.T, a.w): horizontal sensible leg a -> corner, vertical latent leg corner -> b
    const cornerX = bx;
    const cornerY = ay;
    const legX = Math.abs(cornerX - ax);
    const legY = Math.abs(by - cornerY);
    if (legX < 6 * dpi || legY < 6 * dpi) return [];

    const sensCol = pal.heat || '#f87171';
    const latCol = dW >= 0 ? (pal.humid || '#34d399') : (pal.dehum || pal.humid || '#fbbf24');
    const cornerMarkCol = pal.muted || (isDark ? '#94a3b8' : '#475569');

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.25 * dpi;
    ctx.setLineDash([4.5 * dpi, 3.2 * dpi]);

    // Horizontal Sensible Leg (constant W = a.w)
    ctx.strokeStyle = _OVL.withAlpha(sensCol, 0.78);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(cornerX, cornerY);
    ctx.stroke();

    // Vertical Latent Leg (constant T = b.T)
    ctx.strokeStyle = _OVL.withAlpha(latCol, 0.78);
    ctx.beginPath();
    ctx.moveTo(cornerX, cornerY);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // Small right-angle square corner mark (6 * dpi)
    if (legX > 12 * dpi && legY > 12 * dpi) {
      const sq = 6 * dpi;
      const dirX = ax < cornerX ? -1 : 1;
      const dirY = by < cornerY ? -1 : 1;
      ctx.setLineDash([]);
      ctx.strokeStyle = _OVL.withAlpha(cornerMarkCol, 0.75);
      ctx.lineWidth = 1.05 * dpi;
      ctx.beginPath();
      ctx.moveTo(cornerX + dirX * sq, cornerY);
      ctx.lineTo(cornerX + dirX * sq, cornerY + dirY * sq);
      ctx.lineTo(cornerX, cornerY + dirY * sq);
      ctx.stroke();
    }

    // Crisp subtle vertex dot at corner (b.T, a.w)
    ctx.setLineDash([]);
    ctx.fillStyle = _OVL.withAlpha(cornerMarkCol, 0.85);
    ctx.beginPath();
    ctx.arc(cornerX, cornerY, 2.1 * dpi, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    let metrics = null;
    try {
      if (HVAC && typeof HVAC.calcProcessMetrics === 'function') {
        metrics = HVAC.calcProcessMetrics(a, b, state.pPa || 101325, target.flowVal, target.flowUnit);
      }
    } catch (_) {
      metrics = null;
    }

    const { sensText, latText } = _OVL.formatDecompLegLabels(dT, dW, metrics, state.units || 'SI');
    const badgeBg = isDark ? 'rgba(12,18,30,0.88)' : 'rgba(255,255,255,0.93)';
    const pending = [];

    if (legX >= 28 * dpi) {
      pending.push({
        kind: 'sens',
        text: sensText,
        color: sensCol,
        badgeBg,
        midX: (ax + cornerX) * 0.5,
        midY: cornerY,
        outDirY: by < cornerY ? 1 : -1,
        legLen: legX
      });
    }
    if (legY >= 22 * dpi) {
      pending.push({
        kind: 'lat',
        text: latText,
        color: latCol,
        badgeBg,
        midX: cornerX,
        midY: (cornerY + by) * 0.5,
        outDirX: ax < cornerX ? 1 : -1,
        legLen: legY
      });
    }

    return pending;
  }

  _drawDecompLegLabels(ctx, plot, pendingLabels, pal, isDark, dpi, occupiedRects, tr) {
    const isMinimal = tr?.badgeStyle === 'inline-minimal';
    const pillOpts = isMinimal
      ? { fontPx: 8.5, padX: 2.5, padY: 1.5, radius: 0 }
      : { fontPx: 8.2, padX: 4, padY: 1.8, radius: 3, lineWidth: 0.95 };

    for (let i = 0; i < pendingLabels.length; i++) {
      const item = pendingLabels[i];
      const { bw, bh } = _OVL.measureBadgePill(ctx, item.text, dpi, pillOpts);
      const makeRect = (cx, cy) => [cx - bw * 0.5, cy - bh * 0.5, bw, bh];
      let candidates;

      if (item.kind === 'sens') {
        const dy = item.outDirY;
        const off1 = bh * 0.5 + 6 * dpi;
        const off2 = bh * 0.5 + 16 * dpi;
        const shiftX = Math.min(22 * dpi, item.legLen * 0.22);
        candidates = [
          makeRect(item.midX, item.midY + dy * off1),
          makeRect(item.midX, item.midY - dy * off1),
          makeRect(item.midX - shiftX, item.midY + dy * off1),
          makeRect(item.midX + shiftX, item.midY + dy * off1),
          makeRect(item.midX, item.midY + dy * off2),
          makeRect(item.midX, item.midY - dy * off2)
        ];
      } else {
        const dx = item.outDirX;
        const off1 = bw * 0.5 + 7 * dpi;
        const off2 = bw * 0.5 + 16 * dpi;
        const shiftY = Math.min(18 * dpi, item.legLen * 0.22);
        candidates = [
          makeRect(item.midX + dx * off1, item.midY),
          makeRect(item.midX - dx * off1, item.midY),
          makeRect(item.midX + dx * off1, item.midY - shiftY),
          makeRect(item.midX + dx * off1, item.midY + shiftY),
          makeRect(item.midX + dx * off2, item.midY),
          makeRect(item.midX - dx * off2, item.midY)
        ];
      }

      const chosen = this._placeNonCollidingRect(candidates, plot, occupiedRects, 3 * dpi);
      if (!chosen) continue;

      const cx = chosen[0] + bw * 0.5;
      const cy = chosen[1] + bh * 0.5;
      const inkCol = _OVL.readableLabelColor(item.color, isDark);

      if (isMinimal) {
        _OVL.textHalo(ctx, item.text, cx, cy, inkCol, pal, dpi, {
          align: 'center',
          base: 'middle',
          sizePx: pillOpts.fontPx,
          weight: '600',
          haloW: Math.max(3, pal.haloW ?? 3)
        });
      } else {
        _OVL.drawBadgePill(
          ctx,
          item.text,
          cx,
          cy,
          inkCol,
          _OVL.withAlpha(inkCol, 0.55),
          item.badgeBg,
          dpi,
          pillOpts
        );
      }
    }
  }

  /* --------------------------------------------------------------------------
     3. Processes, Curved Coil ADP Extensions & Animated Flow Particles
     -------------------------------------------------------------------------- */
  _drawProcesses(ctx, br, plot, state, pal, isDark, dpi, isExport, occupiedRects, tr) {
    const trend = tr || _OVL.resolveTrendStyle(pal, state);
    const pts = state.points || [];
    const procs = state.processes || [];
    const pPa = state.pPa || 101325;
    const baseArrowW = _OVL.resolveLineWeight(trend.lineWeight, pal);
    const ptSz = (pal.ptSize || 4.5) * dpi;
    const badgeBg = isDark ? 'rgba(12,18,30,0.88)' : 'rgba(255,255,255,0.93)';
    const showAdpLines = state.layers?.adpLines !== false;
    const animateFlow = Boolean(state.layers?.flowAnim && !isExport);
    const pendingBadges = [];

    for (let i = 0; i < procs.length; i++) {
      const proc = procs[i];
      const ep = _OVL.resolveProcEndpoints(proc, pts);
      if (!ep) continue;
      const { a, b } = ep;

      const ax = br.xc(a.T);
      const ay = br.yc(a.w);
      const bx = br.xc(b.T);
      const by = br.yc(b.w);
      const chordLen = Math.hypot(bx - ax, by - ay);
      if (chordLen < 1.5 * dpi) continue;

      let metrics = null;
      try {
        if (HVAC && typeof HVAC.calcProcessMetrics === 'function') {
          metrics = HVAC.calcProcessMetrics(a, b, pPa, proc.flowVal, proc.flowUnit);
        }
      } catch (_) {
        metrics = null;
      }

      const color = _OVL.resolveProcColor(proc, metrics, a, b, pal);
      const isSelected = state.ui?.selectedProcId != null && state.ui.selectedProcId === proc.id;
      const dT = b.T - a.T;
      const dW = b.w - a.w;
      const isCoolDehum = dT < -0.5 && dW < -0.0002;
      const isNonCoilRole = _OVL.isNonCoilProcess(proc, b);

      let adp = null;
      if (isCoolDehum && !isNonCoilRole && (proc.showCurve || showAdpLines)) {
        try {
          if (HVAC && typeof HVAC.calcADP === 'function') {
            adp = HVAC.calcADP(a, b, pPa);
          }
        } catch (_) {
          adp = null;
        }
      }

      // Build polyline path (curved coil trajectory or direct vector)
      let rawPath;
      if (proc.showCurve && isCoolDehum && !isNonCoilRole) {
        rawPath = _OVL.buildCoilCurvePixelPath(a, b, adp, br);
      } else {
        rawPath = [[ax, ay], [bx, by]];
      }

      // Trim end so arrowhead cleanly kisses point B's outer marker rim
      const markerExtra = trend.pointMarker === 'crosshair-circle' ? 4.5 : (trend.pointMarker === 'diamond' ? 3.5 : 3);
      const trimEnd = chordLen > 24 * dpi ? ptSz + markerExtra * dpi : 0;
      const drawPath = _OVL.trimPolylineEnd(rawPath, trimEnd);
      const pathMetrics = _OVL.computePolylineMetrics(drawPath);

      const strokeW = (isSelected ? baseArrowW + 0.6 : baseArrowW) * dpi;
      const weightHeadDelta = trend.lineWeight === 'bold' ? 1.5 : (trend.lineWeight === 'fine' ? -1.5 : 0);
      let headLen;
      if (trend.arrowStyle === 'solid-triangle') {
        headLen = ((isSelected ? 12.5 : 11) + weightHeadDelta) * dpi;
      } else if (trend.arrowStyle === 'open-vector') {
        headLen = ((isSelected ? 12 : 10.5) + weightHeadDelta) * dpi;
      } else {
        headLen = ((isSelected ? 14 : 12.5) + weightHeadDelta) * dpi;
      }

      // Back off stroke slightly inside filled arrowheads so round lineCap never bulges past sharp tip
      const shaftBackoff = (trend.arrowStyle === 'open-vector')
        ? 0
        : (pathMetrics.total > headLen * 1.25 ? headLen * 0.55 : 0);
      const strokePath = shaftBackoff > 0 ? _OVL.trimPolylineEnd(drawPath, shaftBackoff) : drawPath;

      // Selected process halo
      if (isSelected) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = _OVL.withAlpha(color, 0.22);
        ctx.lineWidth = (baseArrowW + 7) * dpi;
        _OVL.strokePolyline(ctx, strokePath);

        ctx.strokeStyle = _OVL.withAlpha(color, 0.42);
        ctx.lineWidth = (baseArrowW + 3) * dpi;
        _OVL.strokePolyline(ctx, strokePath);
        ctx.restore();
      }

      // Main process vector stroke with subtle start-to-end gradient
      ctx.save();
      const grad = ctx.createLinearGradient(ax, ay, bx, by);
      grad.addColorStop(0, _OVL.withAlpha(color, 0.68));
      grad.addColorStop(1, _OVL.withAlpha(color, 1));
      ctx.strokeStyle = grad;
      ctx.lineWidth = strokeW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      _OVL.strokePolyline(ctx, strokePath);
      ctx.restore();

      // Exact styled arrowhead at end of path ('cad-chevron' | 'solid-triangle' | 'open-vector')
      const n = drawPath.length;
      const tip = drawPath[n - 1];
      const prev = drawPath[n - 2];
      const endAngle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
      _OVL.drawTaperedArrowhead(ctx, tip[0], tip[1], endAngle, headLen, color, 1, trend.arrowStyle, strokeW);

      // ADP saturation extension line + diamond ADP marker + collision-free clamped pill
      if (isCoolDehum && !isNonCoilRole && showAdpLines && adp && adp.valid && Number.isFinite(adp.T_adp) && Number.isFinite(adp.w_adp)) {
        const adpX = br.xc(adp.T_adp);
        const adpY = br.yc(adp.w_adp);
        const adpCol = pal.sat || color;

        ctx.save();
        ctx.strokeStyle = _OVL.withAlpha(adpCol, 0.72);
        ctx.lineWidth = 1.25 * dpi;
        ctx.setLineDash([4.5 * dpi, 3.5 * dpi]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(adpX, adpY);
        ctx.stroke();
        ctx.restore();

        // Crisp diamond ADP marker
        const dr = 5.2 * dpi;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(adpX, adpY - dr);
        ctx.lineTo(adpX + dr, adpY);
        ctx.lineTo(adpX, adpY + dr);
        ctx.lineTo(adpX - dr, adpY);
        ctx.closePath();
        ctx.fillStyle = pal.plotBg || pal.bg;
        ctx.fill();
        ctx.strokeStyle = adpCol;
        ctx.lineWidth = 1.7 * dpi;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(adpX, adpY, 1.5 * dpi, 0, Math.PI * 2);
        ctx.fillStyle = adpCol;
        ctx.fill();
        ctx.restore();

        // Register ADP diamond itself so pills don't cover the marker
        occupiedRects.push([adpX - 7 * dpi, adpY - 7 * dpi, 14 * dpi, 14 * dpi]);

        // ADP mini-tag clamped strictly inside plot (flips right near left plot edge)
        const adpTDisp = CoreDOM.tToDisp(adp.T_adp, state.units || 'SI');
        const adpTag = `ADP ${adpTDisp.toFixed(1)}°`;
        const adpPillOpts = { fontPx: 8.5, padX: 4.5, padY: 2, radius: 3.5 };
        const { bw: pillW, bh: pillH } = _OVL.measureBadgePill(ctx, adpTag, dpi, adpPillOpts);
        const leftAbove  = [adpX - pillW - 8 * dpi, adpY - pillH - 6 * dpi, pillW, pillH];
        const rightAbove = [adpX + 9 * dpi, adpY - pillH - 6 * dpi, pillW, pillH];
        const rightMid   = [adpX + 10 * dpi, adpY - pillH * 0.5, pillW, pillH];
        const rightBelow = [adpX + 9 * dpi, adpY + 7 * dpi, pillW, pillH];
        const leftBelow  = [adpX - pillW - 8 * dpi, adpY + 7 * dpi, pillW, pillH];
        const flipRight = (adpX - pillW < plot.x + 8 * dpi);
        const adpCandidates = flipRight
          ? [rightAbove, rightMid, rightBelow, leftAbove, leftBelow]
          : [leftAbove, rightAbove, rightBelow, leftBelow, rightMid];

        const chosenAdp = this._placeNonCollidingRect(adpCandidates, plot, occupiedRects, 4 * dpi);
        if (chosenAdp) {
          const adpInk = _OVL.readableLabelColor(adpCol, isDark);
          if (trend.badgeStyle === 'inline-minimal') {
            _OVL.textHalo(ctx, adpTag, chosenAdp[0] + pillW * 0.5, chosenAdp[1] + pillH * 0.5, adpInk, pal, dpi, {
              align: 'center',
              base: 'middle',
              sizePx: adpPillOpts.fontPx,
              weight: '600',
              haloW: Math.max(3, pal.haloW ?? 3)
            });
          } else {
            _OVL.drawBadgePill(
              ctx,
              adpTag,
              chosenAdp[0] + pillW * 0.5,
              chosenAdp[1] + pillH * 0.5,
              adpInk,
              _OVL.withAlpha(adpInk, 0.55),
              badgeBg,
              dpi,
              adpPillOpts
            );
          }
        }
      }

      // Animated directional flow particles along process path (high-contrast on both dark & light themes)
      if (animateFlow && pathMetrics.total > 18 * dpi) {
        const count = CoreDOM.clamp(Math.round(pathMetrics.total / (72 * dpi)), 3, 5);
        const coreCol = isDark ? '#ffffff' : color;
        for (let k = 0; k < count; k++) {
          const frac = (this._animPhase + k / count) % 1;
          const edgeFade = Math.min(1, frac / 0.08, (1 - frac) / 0.08);
          if (edgeFade <= 0.02) continue;

          const sp = _OVL.samplePolyline(drawPath, pathMetrics, frac);
          const tailLen = 8 * dpi;

          ctx.save();
          // Comet tail
          const tailX = sp.x - sp.tx * tailLen;
          const tailY = sp.y - sp.ty * tailLen;
          const tGrad = ctx.createLinearGradient(tailX, tailY, sp.x, sp.y);
          tGrad.addColorStop(0, _OVL.withAlpha(color, 0));
          tGrad.addColorStop(1, _OVL.withAlpha(coreCol, 0.88 * edgeFade));
          ctx.strokeStyle = tGrad;
          ctx.lineWidth = 2.4 * dpi;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(sp.x, sp.y);
          ctx.stroke();

          // Soft halo pulse
          const glowR = 6.5 * dpi;
          const rGrad = ctx.createRadialGradient(sp.x, sp.y, 0.5 * dpi, sp.x, sp.y, glowR);
          rGrad.addColorStop(0, _OVL.withAlpha(color, (isDark ? 0.72 : 0.58) * edgeFade));
          rGrad.addColorStop(1, _OVL.withAlpha(color, 0));
          ctx.fillStyle = rGrad;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, glowR, 0, Math.PI * 2);
          ctx.fill();

          // Bright micro-core (white on dark canvas, process color on light paper)
          ctx.fillStyle = _OVL.withAlpha(coreCol, (isDark ? 0.95 : 1.0) * edgeFade);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, (isDark ? 2.2 : 2.5) * dpi, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Queue process midpoint badge for collision-free placement
      const badgeText = _OVL.formatProcessBadge(i, proc, metrics, state.units || 'SI', isSelected, pathMetrics.total, dpi, trend.badgeStyle);
      pendingBadges.push({
        badgeText,
        color,
        isSelected,
        drawPath,
        pathMetrics,
        badgeBg
      });
    }

    return pendingBadges;
  }

  _drawProcessBadges(ctx, plot, pendingBadges, pal, isDark, dpi, occupiedRects, tr) {
    const badgeStyle = tr?.badgeStyle || 'detailed';
    const getUpNormal = (sp) => {
      let nx = -sp.ty;
      let ny = sp.tx;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      return { nx, ny };
    };

    for (let i = 0; i < pendingBadges.length; i++) {
      const b = pendingBadges[i];
      let pillOpts;
      if (badgeStyle === 'inline-minimal') {
        pillOpts = {
          fontPx: b.isSelected ? 10 : 9.2,
          padX: 2.5,
          padY: 1.5,
          radius: 0,
          lineWidth: 0
        };
      } else if (badgeStyle === 'pill') {
        pillOpts = {
          fontPx: b.isSelected ? 9 : 8.5,
          padX: 4.5,
          padY: 1.8,
          radius: 7,
          lineWidth: b.isSelected ? 1.35 : 0.95
        };
      } else {
        pillOpts = {
          fontPx: b.isSelected ? 9.5 : 9,
          padX: 5.5,
          padY: 2.5,
          radius: 4,
          lineWidth: b.isSelected ? 1.5 : 1.0
        };
      }
      const { bw, bh } = _OVL.measureBadgePill(ctx, b.badgeText, dpi, pillOpts);

      const mid = _OVL.samplePolyline(b.drawPath, b.pathMetrics, 0.5);
      const p38 = _OVL.samplePolyline(b.drawPath, b.pathMetrics, 0.38);
      const p62 = _OVL.samplePolyline(b.drawPath, b.pathMetrics, 0.62);
      const nMid = getUpNormal(mid);
      const n38 = getUpNormal(p38);
      const n62 = getUpNormal(p62);

      const makeRect = (cx, cy) => [cx - bw * 0.5, cy - bh * 0.5, bw, bh];
      const baseOff = badgeStyle === 'inline-minimal' ? 12 : 15;
      const candidates = [
        makeRect(mid.x + nMid.nx * baseOff * dpi, mid.y + nMid.ny * baseOff * dpi),
        makeRect(mid.x - nMid.nx * baseOff * dpi, mid.y - nMid.ny * baseOff * dpi),
        makeRect(p38.x + n38.nx * (baseOff + 1) * dpi, p38.y + n38.ny * (baseOff + 1) * dpi),
        makeRect(p62.x - n62.nx * (baseOff + 1) * dpi, p62.y - n62.ny * (baseOff + 1) * dpi),
        makeRect(mid.x + nMid.nx * 28 * dpi, mid.y + nMid.ny * 28 * dpi),
        makeRect(mid.x - nMid.nx * 28 * dpi, mid.y - nMid.ny * 28 * dpi),
        makeRect(p38.x - n38.nx * 18 * dpi,  p38.y - n38.ny * 18 * dpi),
        makeRect(p62.x + n62.nx * 18 * dpi,  p62.y + n62.ny * 18 * dpi),
        makeRect(mid.x + nMid.nx * 40 * dpi, mid.y + nMid.ny * 40 * dpi),
        makeRect(mid.x - nMid.nx * 40 * dpi, mid.y - nMid.ny * 40 * dpi)
      ];

      const chosen = this._placeNonCollidingRect(candidates, plot, occupiedRects, 3 * dpi);
      if (!chosen) continue;

      const inkCol = _OVL.readableLabelColor(b.color, isDark);
      const cx = chosen[0] + bw * 0.5;
      const cy = chosen[1] + bh * 0.5;

      if (badgeStyle === 'inline-minimal') {
        _OVL.textHalo(ctx, b.badgeText, cx, cy, inkCol, pal, dpi, {
          align: 'center',
          base: 'middle',
          sizePx: pillOpts.fontPx,
          weight: b.isSelected ? '700' : '600',
          haloW: Math.max(3, pal.haloW ?? 3)
        });
      } else {
        _OVL.drawBadgePill(
          ctx,
          b.badgeText,
          cx,
          cy,
          inkCol,
          _OVL.withAlpha(inkCol, b.isSelected ? 0.95 : 0.55),
          b.badgeBg,
          dpi,
          pillOpts
        );
      }
    }
  }

  _resolvePointLabels(ctx, br, plot, state, pal, dpi, occupiedRects) {
    const pts = state.points || [];
    const map = new Map();
    const defaultQueue = [];

    // Pass 1: Register manually positioned / preset-offset labels as fixed rects
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p || !Number.isFinite(p.T) || !Number.isFinite(p.w)) continue;
      const lm = _OVL.getLabelMetrics(ctx, p, i, br, state, pal);
      const isDefault = (p.lx == null || p.lx === 10) && (p.ly == null || p.ly === -6);
      if (!isDefault) {
        map.set(p.id, lm);
        occupiedRects.push([lm.rx, lm.ry, lm.rw, lm.rh]);
      } else {
        defaultQueue.push({ p, lm });
      }
    }

    // Pass 2: Check default-offset labels — nudge only if default box collides or clips
    const pad = 3 * dpi;
    for (let i = 0; i < defaultQueue.length; i++) {
      const { p, lm } = defaultQueue[i];
      const defRect = [lm.rx, lm.ry, lm.rw, lm.rh];
      const selfTag = `pt:${p.id}`;
      const padX = 4 * dpi;
      const ascent = lm.fontSize * 0.98 * dpi;

      const outOfBounds =
        defRect[0] < plot.x + pad ||
        defRect[0] + defRect[2] > plot.right - pad ||
        defRect[1] < plot.y + pad ||
        defRect[1] + defRect[3] > plot.bottom - pad;

      let collides = outOfBounds;
      if (!collides) {
        for (let j = 0; j < occupiedRects.length; j++) {
          const occ = occupiedRects[j];
          if (!occ || occ.tag === selfTag) continue;
          if (_OVL.rectOverlapArea(defRect, occ, pad) > 0) {
            collides = true;
            break;
          }
        }
      }

      if (!collides) {
        map.set(p.id, lm);
        occupiedRects.push(defRect);
        continue;
      }

      const px = lm.ptx;
      const py = lm.pty;
      const rw = lm.rw;
      const rh = lm.rh;
      const candidates = [
        [px + 10 * dpi - padX, py - 6 * dpi - ascent, rw, rh],
        [px - 10 * dpi - rw + padX, py - 6 * dpi - ascent, rw, rh],
        [px + 10 * dpi - padX, py + 16 * dpi - ascent, rw, rh],
        [px - 10 * dpi - rw + padX, py + 16 * dpi - ascent, rw, rh],
        [px - rw * 0.5, py - 14 * dpi - rh, rw, rh],
        [px - rw * 0.5, py + 14 * dpi, rw, rh],
        [px + 18 * dpi, py - rh * 0.5, rw, rh],
        [px - 18 * dpi - rw, py - rh * 0.5, rw, rh]
      ];

      const chosen = this._placeNonCollidingRect(candidates, plot, occupiedRects, pad, { excludeTag: selfTag });
      if (chosen) {
        const tx = chosen[0] + padX;
        const ty = chosen[1] + ascent;
        const lx = tx - px;
        const ly = ty - py;
        map.set(p.id, {
          ...lm,
          lx,
          ly,
          tx,
          ty,
          rx: chosen[0],
          ry: chosen[1],
          cx: chosen[0] + rw * 0.5,
          cy: chosen[1] + rh * 0.5,
          dist: Math.hypot(lx, ly)
        });
      } else {
        map.set(p.id, lm);
        occupiedRects.push(defRect);
      }
    }

    return map;
  }

  /* --------------------------------------------------------------------------
     4. Interactive ASHRAE SHR Protractor & Reference Slope Line
     -------------------------------------------------------------------------- */
  _drawSHRReferenceAndProtractor(ctx, br, plot, state, pal, isDark, dpi, isExport = false) {
    const rawShr = Number(state.shr?.value);
    const shr = Number.isFinite(rawShr) ? CoreDOM.clamp(rawShr, -2, 2) : 0.75;
    const pts = state.points || [];
    const pPa = state.pPa || 101325;
    const shrCol = pal.wb || '#f59e0b';

    // Determine reference point: explicit refPtId -> chart plot center when null
    let refPt = null;
    const explicitId = state.shr?.refPtId ?? state.shr?.refPointId;
    if (explicitId != null && explicitId !== '') {
      refPt = pts.find(p => p.id === explicitId || String(p.id) === String(explicitId)) || null;
    }
    if (!refPt) {
      const tMinV = state.view?.tMin ?? -10;
      const tMaxV = state.view?.tMax ?? 55;
      const wMaxV = state.view?.wMax ?? 0.030;
      const centerT = 0.5 * (tMinV + tMaxV);
      const centerW = Math.max(0.0005, Math.min(0.45 * wMaxV, Psy.wsat_at(centerT, pPa) * 0.72));
      refPt = { T: centerT, w: centerW, isChartCenter: true };
    }

    const cpm = 1.006 + 1.86 * (refPt ? refPt.w : 0.010);
    const slope = Math.abs(shr) <= 1e-4 ? Infinity : (Math.abs(shr - 1) <= 1e-6 ? 0 : ((1 - shr) / shr) * cpm / 2501);

    // 4a. Dashed SHR Reference Slope Line through refPt
    if (refPt && Number.isFinite(refPt.T) && Number.isFinite(refPt.w)) {
      const tMin = (state.view?.tMin ?? -10) - 5;
      const tMax = (state.view?.tMax ?? 55) + 5;
      const wMax = (state.view?.wMax ?? 0.030) * 1.1;

      ctx.save();
      ctx.strokeStyle = shrCol;
      ctx.lineWidth = 1.6 * dpi;
      ctx.setLineDash([7 * dpi, 4.5 * dpi]);
      ctx.globalAlpha = 0.82;
      ctx.beginPath();

      if (!Number.isFinite(slope)) {
        // Vertical (SHR = 0)
        const px = br.xc(refPt.T);
        const ws = Psy.wsat_at(refPt.T, pPa);
        const yBot = br.yc(0);
        const yTop = br.yc(Math.min(ws, wMax));
        ctx.moveTo(px, yBot);
        ctx.lineTo(px, yTop);
      } else {
        let started = false;
        const step = Math.max(0.15, (tMax - tMin) / 260);
        for (let T = tMin; T <= tMax; T += step) {
          const w = refPt.w + slope * (T - refPt.T);
          if (w < 0 || w > wMax) {
            started = false;
            continue;
          }
          const ws = Psy.wsat_at(T, pPa);
          if (w > ws + 0.00015) {
            started = false;
            continue;
          }
          const px = br.xc(T);
          const py = br.yc(Math.min(w, ws));
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
      }
      ctx.stroke();

      // Subtle anchor marker when anchored to chart center
      const rpx = br.xc(refPt.T);
      const rpy = br.yc(refPt.w);
      if (refPt.isChartCenter) {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(rpx, rpy, 4 * dpi, 0, Math.PI * 2);
        ctx.fillStyle = pal.plotBg || pal.bg;
        ctx.fill();
        ctx.lineWidth = 1.5 * dpi;
        ctx.stroke();
      }
      ctx.restore();

      // Inline SHR label offset nicely from refPt and clamped inside plot
      const lblX = CoreDOM.clamp(rpx + 18 * dpi, plot.x + 8 * dpi, Math.max(plot.x + 8 * dpi, plot.right - 78 * dpi));
      const lblY = CoreDOM.clamp(rpy - 12 * dpi, plot.y + 18 * dpi, plot.bottom - 8 * dpi);
      _OVL.textHalo(ctx, `SHR = ${shr.toFixed(2)}`, lblX, lblY, shrCol, pal, dpi, {
        sizePx: 9.5,
        weight: '600'
      });
    }

    // 4b. Compact ASHRAE Circular SHR Protractor Dial in upper-left plot corner
    if (plot.w < 170 * dpi || plot.h < 170 * dpi) return;

    const pxPerDegC = Math.abs(br.xc(21) - br.xc(20)) || 10 * dpi;
    const pxPerKgKg = Math.abs(br.yc(0) - br.yc(0.01)) / 0.01 || 15000 * dpi;

    // Exact chart-scaled inclination angle alpha in [0, PI/2] for graduated ticks in [0, 1]
    const shrToAlpha = (s) => {
      if (Math.abs(s) <= 1e-4) return Math.PI * 0.5;
      if (Math.abs(s - 1) <= 1e-6) return 0;
      const sl = ((1 - s) / s) * cpm / 2501;
      return Math.atan2(sl * pxPerKgKg, pxPerDegC);
    };

    const cardW = 114 * dpi;
    const cardH = 128 * dpi;
    const cardX = plot.x + 12 * dpi;
    const cardY = plot.y + 12 * dpi;
    const cx = cardX + cardW * 0.5;
    const cy = cardY + 62 * dpi;
    const R = 36 * dpi;

    const cardBg = isDark ? 'rgba(11,18,30,0.86)' : 'rgba(255,255,255,0.92)';
    const cardBorder = isDark ? 'rgba(148,163,184,0.28)' : 'rgba(51,65,85,0.24)';
    const dialTrack = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(71,85,105,0.25)';
    const tickCol = isDark ? 'rgba(203,213,225,0.75)' : 'rgba(51,65,85,0.75)';
    const mutedCol = pal.muted || '#94a3b8';

    ctx.save();
    // Glass instrument card
    _OVL.roundRect(ctx, cardX, cardY, cardW, cardH, 8 * dpi);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.strokeStyle = cardBorder;
    ctx.lineWidth = 1 * dpi;
    ctx.stroke();

    // Header
    ctx.fillStyle = mutedCol;
    ctx.font = `600 ${8 * dpi}px ${_OVL.FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('ASHRAE SHR DIAL', cx, cardY + 6 * dpi);

    // Outer protractor bezel circle
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = dialTrack;
    ctx.lineWidth = 1.2 * dpi;
    ctx.stroke();

    // Subtle highlighted lower-left active arc (SHR 1.0 horizontal down to 0.0 vertical)
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI * 0.5, Math.PI);
    ctx.strokeStyle = _OVL.withAlpha(shrCol, 0.55);
    ctx.lineWidth = 2.2 * dpi;
    ctx.stroke();

    // Crosshair reference axes inside dial (SHR 1.0 horizontal & SHR 0.0 vertical)
    ctx.strokeStyle = dialTrack;
    ctx.lineWidth = 0.8 * dpi;
    ctx.setLineDash([2 * dpi, 2 * dpi]);
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.setLineDash([]);

    // Radial tick marks from SHR = 1.0 (horizontal, PI) down to 0.0 (vertical, PI/2)
    // Plus mirrored subtle ticks on upper-right (0 to -PI/2)
    const ticks = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];
    const majorSet = new Set([1.0, 0.8, 0.6, 0.4, 0.2, 0.0]);
    let lastLabelAngle = -999;

    ctx.font = `500 ${7.5 * dpi}px ${_OVL.FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const val of ticks) {
      const alpha = shrToAlpha(val);
      const isMajor = majorSet.has(val);
      const angLL = Math.PI - alpha; // 1.0 -> PI (left), 0.0 -> PI/2 (down)
      const angUR = -alpha;          // 1.0 -> 0 (right), 0.0 -> -PI/2 (up)
      const innerR = R - (isMajor ? 6.5 : 3.8) * dpi;

      // Primary lower-left tick
      ctx.strokeStyle = isMajor ? tickCol : _OVL.withAlpha(tickCol, 0.5);
      ctx.lineWidth = (isMajor ? 1.2 : 0.8) * dpi;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angLL) * innerR, cy + Math.sin(angLL) * innerR);
      ctx.lineTo(cx + Math.cos(angLL) * R, cy + Math.sin(angLL) * R);
      ctx.stroke();

      // Secondary upper-right mirror tick
      ctx.strokeStyle = _OVL.withAlpha(tickCol, 0.32);
      ctx.lineWidth = 0.8 * dpi;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angUR) * (R - 3.5 * dpi), cy + Math.sin(angUR) * (R - 3.5 * dpi));
      ctx.lineTo(cx + Math.cos(angUR) * R, cy + Math.sin(angUR) * R);
      ctx.stroke();

      // Labels along lower-left outer perimeter with collision guard
      if (isMajor && Math.abs(angLL - lastLabelAngle) >= 0.24) {
        const lr = R + 10 * dpi;
        const lx = cx + Math.cos(angLL) * lr;
        const ly = cy + Math.sin(angLL) * lr;
        ctx.fillStyle = tickCol;
        ctx.fillText(val.toFixed(1), lx, ly);
        lastLabelAngle = angLL;
      }
    }

    // Current SHR needle (parallel to true slope, smoothly clamped within dial sweep)
    const curAlpha = !Number.isFinite(slope)
      ? Math.PI * 0.5
      : CoreDOM.clamp(Math.atan2(slope * pxPerKgKg, pxPerDegC), -Math.PI * 0.48, Math.PI * 0.5);
    const needleAng = Math.PI - curAlpha;
    const tipX = cx + Math.cos(needleAng) * (R - 2 * dpi);
    const tipY = cy + Math.sin(needleAng) * (R - 2 * dpi);
    const tailX = cx - Math.cos(needleAng) * (R - 6 * dpi);
    const tailY = cy - Math.sin(needleAng) * (R - 6 * dpi);

    // Subtle tail
    ctx.strokeStyle = _OVL.withAlpha(shrCol, 0.45);
    ctx.lineWidth = 1.4 * dpi;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    // Active needle shaft
    ctx.strokeStyle = shrCol;
    ctx.lineWidth = 2.2 * dpi;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Needle pointer head
    _OVL.drawTaperedArrowhead(ctx, tipX, tipY, needleAng, 7 * dpi, shrCol, 1);

    // Precision center pivot hub
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * dpi, 0, Math.PI * 2);
    ctx.fillStyle = pal.plotBg || pal.bg;
    ctx.fill();
    ctx.strokeStyle = shrCol;
    ctx.lineWidth = 1.6 * dpi;
    ctx.stroke();

    // Crisp monospace readout pill at bottom of dial card (displays true SHR value)
    _OVL.drawBadgePill(
      ctx,
      `SHR ${shr.toFixed(2)}`,
      cx,
      cardY + cardH - 13 * dpi,
      shrCol,
      _OVL.withAlpha(shrCol, 0.55),
      _OVL.withAlpha(shrCol, isDark ? 0.14 : 0.10),
      dpi,
      { fontPx: 9.5, padX: 7, padY: 2.5, radius: 4 }
    );

    ctx.restore();
  }

  /* --------------------------------------------------------------------------
     5. State Points
     -------------------------------------------------------------------------- */
  _drawPoints(ctx, br, state, pal, isDark, dpi, isExport, resolvedLabelMap = null, tr = null) {
    const trend = tr || _OVL.resolveTrendStyle(pal, state);
    const pts = state.points || [];
    const ui = state.ui || {};
    const ptSz = (pal.ptSize || 4.5) * dpi;
    const tool = ui.activeTool || ui.tool || 'select';
    const step = ui.toolStep;
    const stepPtId = (step == null)
      ? null
      : (typeof step === 'object'
        ? (step.startPtId ?? step.startId ?? step.aId ?? step.ptId ?? step.pointId ?? step.mixStartId ?? step.id ?? null)
        : step);
    const procStartId = ui.procStartId ?? ui.processStartId ?? (tool === 'process' ? (stepPtId ?? ui.toolStartId ?? ui.pickStartId) : null);
    const mixStartId = ui.mixStartId ?? (tool === 'mix' ? (stepPtId ?? ui.toolStartId ?? ui.pickStartId) : null);
    const hovPickId = ui.hovPickId ?? ui.hovPtId ?? ui.hoverPtId;
    const accentCol = isDark ? '#38bdf8' : '#0284c7';
    const mixCol = pal.mix || '#facc15';

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p || !Number.isFinite(p.T) || !Number.isFinite(p.w)) continue;

      const px = br.xc(p.T);
      const py = br.yc(p.w);
      const ptCol = p.color || pal.pt || '#f43f5e';
      const isSelected = ui.selectedPtId != null && ui.selectedPtId === p.id;
      const isProcStart = !isExport && tool === 'process' && procStartId === p.id;
      const isMixStart = !isExport && tool === 'mix' && mixStartId === p.id;
      const isHovPick = !isExport && hovPickId != null && hovPickId === p.id;

      // Active tool START / MIX A pick rings
      if (isProcStart) {
        ctx.save();
        ctx.strokeStyle = accentCol;
        ctx.lineWidth = 2.2 * dpi;
        ctx.setLineDash([4 * dpi, 3 * dpi]);
        ctx.globalAlpha = 0.88;
        ctx.beginPath();
        ctx.arc(px, py, ptSz + 8.5 * dpi, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        _OVL.textHalo(ctx, 'START', px, py + ptSz + 13 * dpi, accentCol, pal, dpi, {
          align: 'center',
          base: 'top',
          sizePx: 8.5,
          weight: '700'
        });
      }

      if (isMixStart) {
        ctx.save();
        ctx.strokeStyle = mixCol;
        ctx.lineWidth = 2.2 * dpi;
        ctx.setLineDash([4 * dpi, 3 * dpi]);
        ctx.globalAlpha = 0.88;
        ctx.beginPath();
        ctx.arc(px, py, ptSz + 8.5 * dpi, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        _OVL.textHalo(ctx, 'MIX A', px, py + ptSz + 13 * dpi, mixCol, pal, dpi, {
          align: 'center',
          base: 'top',
          sizePx: 8.5,
          weight: '700'
        });
      }

      // Hover pick halo
      if (isHovPick) {
        const isPickMode = tool === 'process' || tool === 'mix';
        const hCol = tool === 'mix' ? mixCol : (tool === 'process' ? accentCol : ptCol);

        ctx.save();
        const glowR = ptSz + (isPickMode ? 16 : 11) * dpi;
        const glow = ctx.createRadialGradient(px, py, ptSz, px, py, glowR);
        glow.addColorStop(0, _OVL.withAlpha(hCol, 0.36));
        glow.addColorStop(1, _OVL.withAlpha(hCol, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = hCol;
        ctx.lineWidth = 1.9 * dpi;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(px, py, ptSz + 6 * dpi, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        if (isPickMode) {
          const hint = tool === 'process'
            ? (procStartId != null ? 'Click to end' : 'Click start')
            : (mixStartId != null ? 'Click to mix' : 'Click stream A');
          _OVL.textHalo(ctx, hint, px, py - ptSz - 13 * dpi, hCol, pal, dpi, {
            align: 'center',
            base: 'bottom',
            sizePx: 8.5,
            weight: '600'
          });
        }
      }

      // Selected point double-ring indicator
      if (isSelected) {
        ctx.save();
        const auraR = ptSz + 13 * dpi;
        const aura = ctx.createRadialGradient(px, py, ptSz, px, py, auraR);
        aura.addColorStop(0, _OVL.withAlpha(ptCol, 0.28));
        aura.addColorStop(1, _OVL.withAlpha(ptCol, 0));
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(px, py, auraR, 0, Math.PI * 2);
        ctx.fill();

        // Outer precision ring
        ctx.strokeStyle = _OVL.withAlpha(ptCol, 0.85);
        ctx.lineWidth = 1.6 * dpi;
        ctx.beginPath();
        ctx.arc(px, py, ptSz + 7 * dpi, 0, Math.PI * 2);
        ctx.stroke();

        // Inner high-contrast ring
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(15,23,42,0.75)';
        ctx.lineWidth = 1.15 * dpi;
        ctx.beginPath();
        ctx.arc(px, py, ptSz + 4 * dpi, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Styled state point marker ('precision-ring' | 'crosshair-circle' | 'solid-dot' | 'diamond')
      _OVL.drawStatePointMarker(ctx, px, py, ptSz, ptCol, pal, isDark, dpi, trend.pointMarker);

      // Draggable label, hover pill, readable ink & 360° closest-point leader line
      const lm = (resolvedLabelMap && resolvedLabelMap.get(p.id))
        ? resolvedLabelMap.get(p.id)
        : _OVL.getLabelMetrics(ctx, p, i, br, state, pal);
      const labelInk = _OVL.readableLabelColor(ptCol, isDark);

      if (lm.dist > 18 * dpi) {
        const ex = CoreDOM.clamp(px, lm.rx, lm.rx + lm.rw);
        const ey = CoreDOM.clamp(py, lm.ry, lm.ry + lm.rh);
        const leaderDist = Math.hypot(ex - px, ey - py);
        if (leaderDist > ptSz + 4 * dpi) {
          const ang = Math.atan2(ey - py, ex - px);
          const sx = px + Math.cos(ang) * (ptSz + 3 * dpi);
          const sy = py + Math.sin(ang) * (ptSz + 3 * dpi);
          ctx.save();
          ctx.strokeStyle = _OVL.withAlpha(labelInk, 0.48);
          ctx.lineWidth = 0.85 * dpi;
          ctx.setLineDash([2.5 * dpi, 2.5 * dpi]);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (!isExport && ui.hovLabelId != null && ui.hovLabelId === p.id) {
        ctx.save();
        _OVL.roundRect(ctx, lm.rx, lm.ry, lm.rw, lm.rh, 3.5 * dpi);
        ctx.fillStyle = _OVL.withAlpha(labelInk, isDark ? 0.18 : 0.12);
        ctx.fill();
        ctx.strokeStyle = _OVL.withAlpha(labelInk, 0.65);
        ctx.lineWidth = 1 * dpi;
        ctx.setLineDash([3 * dpi, 2 * dpi]);
        ctx.stroke();
        ctx.restore();
      }

      _OVL.textHalo(ctx, lm.labelText, lm.tx, lm.ty, labelInk, pal, dpi, {
        sizePx: lm.fontSize,
        weight: isSelected ? '700' : '600'
      });
    }
  }

  /* --------------------------------------------------------------------------
     6. Custom Engineering Annotations
     -------------------------------------------------------------------------- */
  _drawAnnotations(ctx, br, plot, state, pal, isDark, dpi) {
    const anns = state.annotations || [];
    if (!anns.length) return;

    const cardBg = isDark ? 'rgba(15,23,42,0.90)' : 'rgba(255,255,255,0.94)';
    const textCol = pal.fg || (isDark ? '#e6edf7' : '#0f172a');
    const defaultCol = isDark ? '#38bdf8' : '#0284c7';

    for (const ann of anns) {
      if (!ann || !Number.isFinite(ann.T) || !Number.isFinite(ann.w)) continue;
      const r = _OVL.getAnnotationRect(ctx, ann, br, plot);
      const col = ann.color || defaultCol;
      const isActive = state.ui?.selectedAnnId === ann.id || state.ui?.hovAnnId === ann.id;

      // Nearest anchor on callout box edge to pin dot
      const ancX = CoreDOM.clamp(r.pinX, r.bx, r.bx + r.bw);
      const ancY = CoreDOM.clamp(r.pinY, r.by, r.by + r.bh);

      ctx.save();
      // Pointer stem
      ctx.strokeStyle = _OVL.withAlpha(col, 0.7);
      ctx.lineWidth = 1.2 * dpi;
      ctx.beginPath();
      ctx.moveTo(r.pinX, r.pinY);
      ctx.lineTo(ancX, ancY);
      ctx.stroke();

      // Subtle pin halo + dot
      ctx.beginPath();
      ctx.arc(r.pinX, r.pinY, 5.2 * dpi, 0, Math.PI * 2);
      ctx.fillStyle = _OVL.withAlpha(col, 0.24);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(r.pinX, r.pinY, 2.7 * dpi, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      // Callout rounded box
      _OVL.roundRect(ctx, r.bx, r.by, r.bw, r.bh, 5 * dpi);
      ctx.fillStyle = cardBg;
      ctx.fill();
      ctx.strokeStyle = _OVL.withAlpha(col, isActive ? 0.95 : 0.55);
      ctx.lineWidth = (isActive ? 1.6 : 1.1) * dpi;
      ctx.stroke();

      // Left accent bar clipped inside rounded callout
      ctx.save();
      _OVL.roundRect(ctx, r.bx, r.by, r.bw, r.bh, 5 * dpi);
      ctx.clip();
      ctx.fillStyle = col;
      ctx.fillRect(r.bx, r.by, r.accentBarW, r.bh);
      ctx.restore();

      // Text lines
      ctx.fillStyle = textCol;
      ctx.font = `500 ${r.fontSize}px ${_OVL.FONT_SANS}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let li = 0; li < r.lines.length; li++) {
        const ly = r.by + r.padY + (li + 0.5) * r.lineH;
        ctx.fillText(r.lines[li], r.bx + r.accentBarW + r.padX, ly);
      }
      ctx.restore();
    }
  }

  /* --------------------------------------------------------------------------
     7. Interactive Measure / Ruler Tool
     -------------------------------------------------------------------------- */
  _drawMeasureTool(ctx, br, plot, state, pal, isDark, dpi) {
    const resolveCoord = (pt) => {
      if (pt && Number.isFinite(pt.T) && Number.isFinite(pt.w)) {
        return { T: pt.T, w: pt.w, x: br.xc(pt.T), y: br.yc(pt.w) };
      }
      if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
        const T = _OVL.invT(br, state, pt.x);
        const w = Math.max(0, _OVL.invW(br, state, pt.y));
        return { T, w, x: pt.x, y: pt.y };
      }
      return null;
    };

    const s = resolveCoord(state.ui.measureStart);
    const e = resolveCoord(state.ui.measureEnd);
    if (!s || !e) return;

    const cyan = isDark ? '#22d3ee' : '#0891b2';
    const sensCol = pal.heat || '#f87171';
    const latCol = pal.humid || '#10b981';
    const units = state.units || 'SI';
    const isSI = units !== 'IP';

    const dT = e.T - s.T;
    const dW = e.w - s.w;
    const h1 = Psy.h_kJkg(s.T, s.w);
    const h2 = Psy.h_kJkg(e.T, e.w);
    const dh = h2 - h1;
    const cpm = 1.006 + 1.86 * ((s.w + e.w) * 0.5);
    const dhs = cpm * dT;
    const shr = Math.abs(dh) > 1e-6 ? dhs / dh : (Math.abs(dT) > 1e-6 ? 1 : NaN);

    const sign = v => (v >= 0 ? '+' : '');
    const dTVal = isSI ? dT : dT * 1.8;
    const dWVal = isSI ? dW * 1000 : dW * 7000;
    const dhVal = isSI ? dh : dh * 0.429922614;

    const strDT = `${sign(dTVal)}${dTVal.toFixed(2)} ${isSI ? '°C' : '°F'}`;
    const strDW = `${sign(dWVal)}${dWVal.toFixed(isSI ? 2 : 1)} ${isSI ? 'g/kg' : 'gr/lb'}`;
    const strDh = `${sign(dhVal)}${dhVal.toFixed(2)} ${isSI ? 'kJ/kg' : 'Btu/lb'}`;
    const strSHR = Number.isFinite(shr) ? CoreDOM.clamp(shr, -9.99, 9.99).toFixed(2) : '—';

    const legX = Math.abs(e.x - s.x);
    const legY = Math.abs(e.y - s.y);
    const cornerX = e.x;
    const cornerY = s.y;

    ctx.save();

    // Right-angle Sensible (horizontal ΔT) and Latent (vertical ΔW) decomposition legs
    if (legX > 6 * dpi && legY > 6 * dpi) {
      // Horizontal sensible leg
      ctx.strokeStyle = _OVL.withAlpha(sensCol, 0.78);
      ctx.lineWidth = 1.35 * dpi;
      ctx.setLineDash([4 * dpi, 3 * dpi]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(cornerX, cornerY);
      ctx.stroke();

      // Vertical latent leg
      ctx.strokeStyle = _OVL.withAlpha(latCol, 0.78);
      ctx.beginPath();
      ctx.moveTo(cornerX, cornerY);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();

      // Right-angle corner square marker
      if (legX > 18 * dpi && legY > 18 * dpi) {
        const sq = 7 * dpi;
        const dirX = s.x < cornerX ? -1 : 1;
        const dirY = e.y < cornerY ? -1 : 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = _OVL.withAlpha(cyan, 0.65);
        ctx.lineWidth = 1.1 * dpi;
        ctx.beginPath();
        ctx.moveTo(cornerX + dirX * sq, cornerY);
        ctx.lineTo(cornerX + dirX * sq, cornerY + dirY * sq);
        ctx.lineTo(cornerX, cornerY + dirY * sq);
        ctx.stroke();
      }

      // Mini leg tags when spacious
      if (legX > 52 * dpi) {
        const yOff = e.y < s.y ? 11 * dpi : -10 * dpi;
        _OVL.textHalo(ctx, `ΔT ${strDT}`, (s.x + cornerX) * 0.5, cornerY + yOff, sensCol, pal, dpi, {
          align: 'center',
          base: 'middle',
          sizePx: 8.5,
          weight: '600'
        });
      }
      if (legY > 38 * dpi) {
        const xOff = e.x >= s.x ? 8 * dpi : -8 * dpi;
        _OVL.textHalo(ctx, `ΔW ${strDW}`, cornerX + xOff, (cornerY + e.y) * 0.5, latCol, pal, dpi, {
          align: e.x >= s.x ? 'left' : 'right',
          base: 'middle',
          sizePx: 8.5,
          weight: '600'
        });
      }
    }

    // Main high-contrast cyan dashed caliper line
    ctx.strokeStyle = cyan;
    ctx.lineWidth = 2.1 * dpi;
    ctx.setLineDash([7 * dpi, 4 * dpi]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Caliper endpoint markers
    for (const [cx, cy] of [[s.x, s.y], [e.x, e.y]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5 * dpi, 0, Math.PI * 2);
      ctx.fillStyle = pal.plotBg || pal.bg;
      ctx.fill();
      ctx.strokeStyle = cyan;
      ctx.lineWidth = 1.8 * dpi;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 1.5 * dpi, 0, Math.PI * 2);
      ctx.fillStyle = cyan;
      ctx.fill();
    }

    // Floating engineering callout box
    const rows = [
      ['ΔT', strDT, sensCol],
      ['ΔW', strDW, latCol],
      ['Δh', strDh, pal.enth || '#fb923c'],
      ['SHR', strSHR, cyan]
    ];

    const boxW = 148 * dpi;
    const rowH = 15 * dpi;
    const headerH = 16 * dpi;
    const boxH = headerH + rows.length * rowH + 8 * dpi;

    const midX = (s.x + e.x) * 0.5;
    const midY = (s.y + e.y) * 0.5;
    // Place callout on the opposite side of the diagonal from right-angle corner (cornerX=e.x, cornerY=s.y)
    const oppLeft = e.x >= s.x;
    const oppUp = e.y <= s.y;
    let bx = oppLeft ? (midX - boxW - 18 * dpi) : (midX + 18 * dpi);
    let by = oppUp ? (midY - boxH - 10 * dpi) : (midY + 10 * dpi);

    if (bx < plot.x + 8 * dpi) {
      bx = Math.max(s.x, e.x) + 18 * dpi;
      if (bx + boxW > plot.right - 8 * dpi) bx = plot.x + 8 * dpi;
    } else if (bx + boxW > plot.right - 8 * dpi) {
      bx = Math.min(s.x, e.x) - boxW - 18 * dpi;
      if (bx < plot.x + 8 * dpi) bx = plot.right - boxW - 8 * dpi;
    }
    if (by < plot.y + 8 * dpi) {
      by = Math.max(s.y, e.y) + 14 * dpi;
      if (by + boxH > plot.bottom - 8 * dpi) by = plot.y + 8 * dpi;
    } else if (by + boxH > plot.bottom - 8 * dpi) {
      by = Math.min(s.y, e.y) - boxH - 14 * dpi;
      if (by < plot.y + 8 * dpi) by = plot.bottom - boxH - 8 * dpi;
    }
    bx = CoreDOM.clamp(bx, plot.x + 8 * dpi, Math.max(plot.x + 8 * dpi, plot.right - boxW - 8 * dpi));
    by = CoreDOM.clamp(by, plot.y + 8 * dpi, Math.max(plot.y + 8 * dpi, plot.bottom - boxH - 8 * dpi));

    const boxBg = isDark ? 'rgba(10,16,28,0.92)' : 'rgba(255,255,255,0.95)';
    _OVL.roundRect(ctx, bx, by, boxW, boxH, 6 * dpi);
    ctx.fillStyle = boxBg;
    ctx.fill();
    ctx.strokeStyle = _OVL.withAlpha(cyan, 0.75);
    ctx.lineWidth = 1.3 * dpi;
    ctx.stroke();

    // Top accent bar
    ctx.save();
    _OVL.roundRect(ctx, bx, by, boxW, boxH, 6 * dpi);
    ctx.clip();
    ctx.fillStyle = cyan;
    ctx.fillRect(bx, by, boxW, 2.5 * dpi);
    ctx.restore();

    // Header text
    ctx.fillStyle = cyan;
    ctx.font = `700 ${8 * dpi}px ${_OVL.FONT_MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('MEASURE CALIPER', bx + 8 * dpi, by + 11 * dpi);

    // Metric rows
    for (let r = 0; r < rows.length; r++) {
      const [k, v, col] = rows[r];
      const ry = by + headerH + 4 * dpi + (r + 0.5) * rowH;

      ctx.fillStyle = pal.muted || '#94a3b8';
      ctx.font = `600 ${9 * dpi}px ${_OVL.FONT_MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(k, bx + 8 * dpi, ry);

      ctx.fillStyle = col;
      ctx.font = `600 ${9.5 * dpi}px ${_OVL.FONT_MONO}`;
      ctx.textAlign = 'right';
      ctx.fillText(v, bx + boxW - 8 * dpi, ry);
    }

    ctx.restore();
  }

  /* --------------------------------------------------------------------------
     8. Marquee Box-Zoom Rect
     -------------------------------------------------------------------------- */
  _drawBoxZoom(ctx, bz, isDark, dpi) {
    let rx, ry, rw, rh;
    if (Number.isFinite(bz.x1) && Number.isFinite(bz.y1) && Number.isFinite(bz.x2) && Number.isFinite(bz.y2)) {
      rx = Math.min(bz.x1, bz.x2);
      ry = Math.min(bz.y1, bz.y2);
      rw = Math.abs(bz.x2 - bz.x1);
      rh = Math.abs(bz.y2 - bz.y1);
    } else if (Number.isFinite(bz.startX) && Number.isFinite(bz.startY) && Number.isFinite(bz.curX) && Number.isFinite(bz.curY)) {
      rx = Math.min(bz.startX, bz.curX);
      ry = Math.min(bz.startY, bz.curY);
      rw = Math.abs(bz.curX - bz.startX);
      rh = Math.abs(bz.curY - bz.startY);
    } else if (Number.isFinite(bz.x) && Number.isFinite(bz.y) && Number.isFinite(bz.w) && Number.isFinite(bz.h)) {
      rx = bz.w >= 0 ? bz.x : bz.x + bz.w;
      ry = bz.h >= 0 ? bz.y : bz.y + bz.h;
      rw = Math.abs(bz.w);
      rh = Math.abs(bz.h);
    } else {
      return;
    }
    if (rw < 2 && rh < 2) return;

    const accent = isDark ? '#38bdf8' : '#0284c7';
    ctx.save();
    ctx.fillStyle = _OVL.withAlpha(accent, isDark ? 0.14 : 0.11);
    ctx.fillRect(rx, ry, rw, rh);

    ctx.strokeStyle = _OVL.withAlpha(accent, 0.9);
    ctx.lineWidth = 1.4 * dpi;
    ctx.setLineDash([5 * dpi, 3.5 * dpi]);
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);

    // Crisp CAD corner brackets
    const bLen = Math.min(10 * dpi, rw * 0.35, rh * 0.35);
    if (bLen > 3 * dpi) {
      ctx.setLineDash([]);
      ctx.lineWidth = 2.2 * dpi;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      // Top-left
      ctx.moveTo(rx, ry + bLen);
      ctx.lineTo(rx, ry);
      ctx.lineTo(rx + bLen, ry);
      // Top-right
      ctx.moveTo(rx + rw - bLen, ry);
      ctx.lineTo(rx + rw, ry);
      ctx.lineTo(rx + rw, ry + bLen);
      // Bottom-right
      ctx.moveTo(rx + rw, ry + rh - bLen);
      ctx.lineTo(rx + rw, ry + rh);
      ctx.lineTo(rx + rw - bLen, ry + rh);
      // Bottom-left
      ctx.moveTo(rx + bLen, ry + rh);
      ctx.lineTo(rx, ry + rh);
      ctx.lineTo(rx, ry + rh - bLen);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* --------------------------------------------------------------------------
     9. Precision Crosshair (with Magnetic Saturation Snap)
     -------------------------------------------------------------------------- */
  _drawCrosshair(ctx, br, plot, state, pal, isDark, dpi) {
    let hx = null;
    let hy = null;
    const hp = state.ui?.hoverPx;
    if (typeof hp === 'number' && Number.isFinite(hp)) {
      hx = hp;
      hy = state.ui?.hoverPy;
    } else if (hp && typeof hp === 'object' && Number.isFinite(hp.x) && Number.isFinite(hp.y)) {
      hx = hp.x;
      hy = hp.y;
    }
    if (hx == null || hy == null || !Number.isFinite(hx) || !Number.isFinite(hy)) return;
    if (hx < plot.x - 1 || hx > plot.right + 1 || hy < plot.y - 1 || hy > plot.bottom + 1) return;

    const pPa = state.pPa || 101325;
    const T = _OVL.invT(br, state, hx);
    const wRaw = _OVL.invW(br, state, hy);
    const ws = Psy.wsat_at(T, pPa);

    let snappedSat = false;
    let sx = CoreDOM.clamp(hx, plot.x, plot.right);
    let sy = CoreDOM.clamp(hy, plot.y, plot.bottom);

    if (wRaw > ws) {
      const satY = br.yc(ws);
      if (Number.isFinite(satY)) {
        snappedSat = true;
        sy = CoreDOM.clamp(satY, plot.y, plot.bottom);
      }
    } else if (wRaw < 0) {
      sy = CoreDOM.clamp(br.yc(0), plot.y, plot.bottom);
    }

    const guideCol = pal.muted || '#94a3b8';
    const reticleCol = snappedSat ? (pal.sat || '#22d3ee') : (isDark ? '#38bdf8' : '#0284c7');

    ctx.save();
    // Orthogonal dashed guide lines
    ctx.strokeStyle = _OVL.withAlpha(guideCol, isDark ? 0.36 : 0.42);
    ctx.lineWidth = 0.9 * dpi;
    ctx.setLineDash([4 * dpi, 4 * dpi]);
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(sy) + 0.5);
    ctx.lineTo(plot.right, Math.round(sy) + 0.5);
    ctx.moveTo(Math.round(sx) + 0.5, plot.y);
    ctx.lineTo(Math.round(sx) + 0.5, plot.bottom);
    ctx.stroke();

    // Subtle vertical tether if cursor was snapped down onto saturation curve
    if (snappedSat && sy - hy > 5 * dpi) {
      ctx.strokeStyle = _OVL.withAlpha(reticleCol, 0.35);
      ctx.lineWidth = 1 * dpi;
      ctx.setLineDash([2 * dpi, 2.5 * dpi]);
      ctx.beginPath();
      ctx.moveTo(sx, hy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }

    // Center precision target reticle
    ctx.setLineDash([]);
    ctx.strokeStyle = reticleCol;
    ctx.lineWidth = 1.45 * dpi;
    ctx.globalAlpha = 0.92;
    const gap = 3.5 * dpi;
    const arm = 10 * dpi;

    ctx.beginPath();
    ctx.moveTo(sx - arm, sy);
    ctx.lineTo(sx - gap, sy);
    ctx.moveTo(sx + gap, sy);
    ctx.lineTo(sx + arm, sy);
    ctx.moveTo(sx, sy - arm);
    ctx.lineTo(sx, sy - gap);
    ctx.moveTo(sx, sy + gap);
    ctx.lineTo(sx, sy + arm);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sx, sy, 3.5 * dpi, 0, Math.PI * 2);
    ctx.lineWidth = 1.15 * dpi;
    ctx.stroke();

    if (snappedSat) {
      _OVL.textHalo(ctx, 'SAT', sx + 12 * dpi, sy - 9 * dpi, reticleCol, pal, dpi, {
        sizePx: 8,
        weight: '700'
      });
    }
    ctx.restore();
  }

  /* --------------------------------------------------------------------------
     Hit-Testing Methods (pixel coordinates scaled by dpi)
     -------------------------------------------------------------------------- */
  pickPoint(px, py, state) {
    if (!state || state.layers?.points === false || !Array.isArray(state.points) || !this.br) {
      return null;
    }
    const dpi = this.br.dpi || 1;
    const threshSq = (16 * dpi) * (16 * dpi);
    let bestId = null;
    let bestD = Infinity;

    for (let i = 0; i < state.points.length; i++) {
      const p = state.points[i];
      if (!p || !Number.isFinite(p.T) || !Number.isFinite(p.w)) continue;
      const dx = px - this.br.xc(p.T);
      const dy = py - this.br.yc(p.w);
      const d = dx * dx + dy * dy;
      if (d < threshSq && d <= bestD) {
        bestD = d;
        bestId = p.id;
      }
    }
    return bestId;
  }

  pickLabel(px, py, state) {
    if (!state || state.layers?.points === false || !Array.isArray(state.points) || !this.br) {
      return null;
    }
    const dpi = this.br.dpi || 1;
    const pal = CoreDOM.resolveThemePalette(state.theme, state.customTheme);
    const pad = 4 * dpi;
    let bestId = null;
    let bestD = Infinity;

    for (let i = 0; i < state.points.length; i++) {
      const p = state.points[i];
      if (!p || !Number.isFinite(p.T) || !Number.isFinite(p.w)) continue;
      const lm = this._resolvedLabels.get(p.id) || _OVL.getLabelMetrics(this.ctx, p, i, this.br, state, pal);
      if (
        px >= lm.rx - pad &&
        px <= lm.rx + lm.rw + pad &&
        py >= lm.ry - pad &&
        py <= lm.ry + lm.rh + pad
      ) {
        const dx = px - lm.cx;
        const dy = py - lm.cy;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          bestId = p.id;
        }
      }
    }
    return bestId;
  }

  pickProcess(px, py, state) {
    if (!state || state.layers?.processes === false || !Array.isArray(state.processes) || !this.br) {
      return null;
    }
    const dpi = this.br.dpi || 1;
    const threshSq = (10 * dpi) * (10 * dpi);
    const pts = state.points || [];
    const pPa = state.pPa || 101325;
    let bestId = null;
    let bestD = Infinity;

    for (let i = 0; i < state.processes.length; i++) {
      const proc = state.processes[i];
      const ep = _OVL.resolveProcEndpoints(proc, pts);
      if (!ep) continue;
      const { a, b } = ep;

      const dT = b.T - a.T;
      const dW = b.w - a.w;
      const isCoolDehum = dT < -0.5 && dW < -0.0002;
      const isNonCoilRole = _OVL.isNonCoilProcess(proc, b);

      let poly;
      if (proc.showCurve && isCoolDehum && !isNonCoilRole) {
        let adp = null;
        try {
          if (HVAC && typeof HVAC.calcADP === 'function') {
            adp = HVAC.calcADP(a, b, pPa);
          }
        } catch (_) {
          adp = null;
        }
        poly = _OVL.buildCoilCurvePixelPath(a, b, adp, this.br);
      } else {
        poly = [
          [this.br.xc(a.T), this.br.yc(a.w)],
          [this.br.xc(b.T), this.br.yc(b.w)]
        ];
      }

      let procMinD = Infinity;
      for (let s = 1; s < poly.length; s++) {
        const dSq = _OVL.pointToSegDistSq(
          px,
          py,
          poly[s - 1][0],
          poly[s - 1][1],
          poly[s][0],
          poly[s][1]
        );
        if (dSq < procMinD) procMinD = dSq;
      }

      if (procMinD < threshSq && procMinD <= bestD) {
        bestD = procMinD;
        bestId = proc.id;
      }
    }
    return bestId;
  }

  pickAnnotation(px, py, state) {
    if (!state || state.layers?.annotations === false || !Array.isArray(state.annotations) || !this.br) {
      return null;
    }
    const dpi = this.br.dpi || 1;
    const pad = 3 * dpi;
    const pinThreshSq = (10 * dpi) * (10 * dpi);
    const plot = _OVL.normPlotRect(this.br);

    // Reverse order so top-most rendered annotation is picked first
    for (let i = state.annotations.length - 1; i >= 0; i--) {
      const ann = state.annotations[i];
      if (!ann || !Number.isFinite(ann.T) || !Number.isFinite(ann.w)) continue;
      const r = _OVL.getAnnotationRect(this.ctx, ann, this.br, plot);
      const inBox = (
        px >= r.bx - pad &&
        px <= r.bx + r.bw + pad &&
        py >= r.by - pad &&
        py <= r.by + r.bh + pad
      );
      const dx = px - r.pinX;
      const dy = py - r.pinY;
      const onPin = dx * dx + dy * dy <= pinThreshSq;
      if (inBox || onPin) return ann.id;
    }
    return null;
  }
}
