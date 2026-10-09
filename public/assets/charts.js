// Leichte SVG-Charts ohne Abhängigkeiten: Zeitachse, monotone Kurven, Zielgerade, Tooltip, Animation.
import { daysBetween, parseDate } from './score.js';
import { fmt } from './app.js';

const NS = 'http://www.w3.org/2000/svg';

// Monotone kubische Interpolation (Fritsch–Carlson): glatt, aber ohne Überschwinger
export function smoothPath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
  const dx = [], dy = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    dy[i] = pts[i + 1][1] - pts[i][1];
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(s => s * mag).find(s => s >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

const shortDate = s => parseDate(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const monthDate = s => parseDate(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });

/**
 * Liniendiagramm über eine Datumsachse.
 * opts: { series:[{name, color, points:[{x:'YYYY-MM-DD', y}], area, dots, dashed}], goal:{y,label},
 *         height, decimals, unit, xFrom, xTo, onHover }
 */
export function lineChart(container, opts) {
  const all = opts.series.flatMap(s => s.points.filter(p => p.y != null));
  if (all.length === 0) {
    container.innerHTML = `<div class="chart-empty">${opts.empty || 'Noch keine Daten'}</div>`;
    return;
  }
  let animated = false;
  const draw = () => {
    const W = Math.max(260, container.clientWidth);
    const H = opts.height || 220;
    const pad = { t: 14, r: 12, b: 26, l: opts.yAxis === false ? 8 : 38 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

    const xs = all.map(p => p.x).sort();
    const x0 = opts.xFrom || xs[0], x1 = opts.xTo || xs[xs.length - 1];
    const span = Math.max(1, daysBetween(x0, x1));
    const X = d => pad.l + (daysBetween(x0, d) / span) * iw;

    const ys = all.map(p => p.y);
    if (opts.goal) ys.push(opts.goal.y);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    const padY = (hi - lo) * 0.12 || 1;
    lo -= padY; hi += padY;
    if (opts.yMin != null) lo = Math.min(lo, opts.yMin);
    const ticks = niceTicks(lo, hi, 4);
    lo = ticks[0]; hi = ticks[ticks.length - 1];
    const Y = v => pad.t + (1 - (v - lo) / (hi - lo)) * ih;
    // Nachkommastellen der Achse aus der Schrittweite (0,5 -> 1 Stelle, 0,05 -> 2)
    const stepY = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const tickDec = opts.tickDecimals ?? (stepY >= 1 ? 0 : stepY >= 0.1 ? 1 : 2);

    container.innerHTML = '';
    container.classList.add('chart');
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': opts.label || 'Diagramm' }, container);

    for (const t of ticks) {
      el('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }, svg);
      if (opts.yAxis !== false) el('text', { class: 'axis-label', x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = fmt(t, tickDec);
    }
    // X-Beschriftung: max. ~5 Labels
    const nLabels = Math.min(5, Math.max(2, Math.floor(iw / 80)));
    for (let i = 0; i < nLabels; i++) {
      const d = new Date(parseDate(x0).getTime() + (span * i / (nLabels - 1)) * 86400000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      el('text', { class: 'axis-label', x: X(iso), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === nLabels - 1 ? 'end' : 'middle' }, svg)
        .textContent = span > 60 ? monthDate(iso) : shortDate(iso);
    }

    if (opts.goal) {
      el('line', { class: 'goal-line', x1: pad.l, x2: W - pad.r, y1: Y(opts.goal.y), y2: Y(opts.goal.y) }, svg);
      el('text', { class: 'goal-label', x: pad.l + 4, y: Y(opts.goal.y) - 6, 'text-anchor': 'start' }, svg).textContent = opts.goal.label;
    }

    const defs = el('defs', {}, svg);
    const plotted = [];
    opts.series.forEach((s, si) => {
      const pts = s.points.filter(p => p.y != null).sort((a, b) => a.x.localeCompare(b.x));
      if (!pts.length) return;
      const xy = pts.map(p => [X(p.x), Y(p.y)]);
      const d = s.smooth === false ? `M${xy.map(p => p.join(',')).join('L')}` : smoothPath(xy);
      if (s.area) {
        const gid = `g${si}${Math.random().toString(36).slice(2, 6)}`;
        const g = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
        el('stop', { offset: '0%', style: `stop-color:${s.color};stop-opacity:${s.areaOpacity ?? 0.28}` }, g);
        el('stop', { offset: '100%', style: `stop-color:${s.color};stop-opacity:0` }, g);
        el('path', { d: `${d}L${xy[xy.length - 1][0]},${pad.t + ih}L${xy[0][0]},${pad.t + ih}Z`, fill: `url(#${gid})`, class: animated ? '' : 'fade' }, svg);
      }
      const path = el('path', { d, class: 'series-line', style: `stroke:${s.color}`, 'stroke-width': s.width || 2.5 }, svg);
      if (s.dashed) path.setAttribute('stroke-dasharray', '2 6');
      else if (!animated) {
        const len = path.getTotalLength();
        path.style.setProperty('--len', len);
        path.classList.add('draw');
      }
      if (s.dots || pts.length === 1) {
        for (const [x, y] of xy) el('circle', { cx: x, cy: y, r: 3.5, style: `fill:${s.color}`, class: animated ? '' : 'fade' }, svg);
      }
      plotted.push({ s, pts, xy });
    });

    // Hover / Touch
    const cursor = el('line', { class: 'cursor', y1: pad.t, y2: pad.t + ih }, svg);
    const dots = plotted.map(p => el('circle', { class: 'cursor-dot', r: 5, style: `fill:${p.s.color}` }, svg));
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    container.append(tip);
    const dates = [...new Set(plotted.flatMap(p => p.pts.map(q => q.x)))].sort();
    const hit = el('rect', { x: pad.l, y: 0, width: iw, height: H, fill: 'transparent' }, svg);
    const move = ev => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.touches?.[0]?.clientX ?? ev.clientX) - rect.left) * (W / rect.width);
      let best = dates[0], bd = Infinity;
      for (const d of dates) { const dd = Math.abs(X(d) - px); if (dd < bd) { bd = dd; best = d; } }
      const cx = X(best);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.style.opacity = 1;
      const lines = [];
      plotted.forEach((p, i) => {
        const q = p.pts.find(v => v.x === best);
        if (q) {
          dots[i].setAttribute('cx', cx); dots[i].setAttribute('cy', Y(q.y)); dots[i].style.opacity = 1;
          lines.push(`<span>${p.s.name}</span> <b>${fmt(q.y, opts.decimals ?? 1)}${opts.unit ? ' ' + opts.unit : ''}</b>`);
        } else dots[i].style.opacity = 0;
      });
      const topY = Math.min(...plotted.map(p => p.pts.find(v => v.x === best)).filter(Boolean).map(q => Y(q.y)));
      tip.innerHTML = `<span>${parseDate(best).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span><br>${lines.join('<br>')}`;
      const scale = rect.width / W;
      const left = Math.min(Math.max(cx * scale, 60), rect.width - 60);
      tip.style.left = `${left}px`;
      tip.style.top = `${topY * scale - 8}px`;
      tip.style.opacity = 1;
    };
    const leave = () => { cursor.style.opacity = 0; dots.forEach(d => (d.style.opacity = 0)); tip.style.opacity = 0; };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
    animated = true;
  };
  draw();
  observeResize(container, draw);
}

/**
 * Säulen mit kategorialer X-Achse (z. B. Wochen).
 * bars: [{ label, value, status, tip }]
 */
export function barChart(container, { bars, max, height = 200, goal, label, decimals = 1 }) {
  if (!bars.some(b => b.value != null)) {
    container.innerHTML = `<div class="chart-empty">Noch keine Daten</div>`;
    return;
  }
  let animated = false;
  const draw = () => {
    const W = Math.max(260, container.clientWidth), H = height;
    const pad = { t: 14, r: 8, b: 26, l: 30 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const top = max ?? Math.max(...bars.map(b => b.value || 0)) * 1.1;
    const ticks = niceTicks(0, top, 4);
    const hi = ticks[ticks.length - 1];
    const Y = v => pad.t + (1 - v / hi) * ih;
    const bw = iw / bars.length;

    container.innerHTML = '';
    container.classList.add('chart');
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': label || 'Säulendiagramm' }, container);
    for (const t of ticks) {
      el('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }, svg);
      el('text', { class: 'axis-label', x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = fmt(t);
    }
    if (goal != null) el('line', { class: 'goal-line', x1: pad.l, x2: W - pad.r, y1: Y(goal), y2: Y(goal) }, svg);
    const every = Math.ceil(bars.length / Math.max(2, Math.floor(iw / 48)));
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    container.append(tip);
    bars.forEach((b, i) => {
      const x = pad.l + i * bw;
      const w = Math.max(4, Math.min(34, bw - 6));
      if (i % every === 0) el('text', { class: 'axis-label', x: x + bw / 2, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = b.label;
      if (b.value == null) return;
      const h = Math.max(2, Y(0) - Y(b.value));
      const r = el('rect', {
        x: x + (bw - w) / 2, y: Y(0) - h, width: w, height: h, rx: Math.min(4, w / 2),
        style: `fill:var(--${b.status === 'green' ? 'good' : b.status === 'orange' ? 'warn' : b.status === 'red' ? 'bad' : 'blue'})`,
        class: animated ? '' : 'bar-rect',
      }, svg);
      if (!animated) r.style.animationDelay = `${i * 30}ms`;
      const hit = el('rect', { x, y: pad.t, width: bw, height: ih, fill: 'transparent' }, svg);
      const show = () => {
        const rect = svg.getBoundingClientRect(), s = rect.width / W;
        tip.innerHTML = b.tip || `<b>${fmt(b.value, decimals)}</b>`;
        tip.style.left = `${Math.min(Math.max((x + bw / 2) * s, 70), rect.width - 70)}px`;
        tip.style.top = `${(Y(b.value) - 6) * s}px`;
        tip.style.opacity = 1;
        r.style.opacity = 0.8;
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', () => { tip.style.opacity = 0; r.style.opacity = 1; });
    });
    animated = true;
  };
  draw();
  observeResize(container, draw);
}

/** Kleine Wellen-Sparkline für Kacheln */
export function sparkline(container, values, color = 'var(--blue)', { area = false } = {}) {
  const v = values.map(x => (x == null ? null : Number(x)));
  const valid = v.filter(x => x != null);
  if (valid.length < 2) { container.innerHTML = ''; return; }
  const W = 120, H = 34;
  const lo = Math.min(...valid), hi = Math.max(...valid);
  const pts = [];
  v.forEach((x, i) => { if (x != null) pts.push([(i / (v.length - 1)) * W, H - 3 - ((x - lo) / (hi - lo || 1)) * (H - 6)]); });
  const d = smoothPath(pts);
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${area ? `<path d="${d}L${W},${H}L0,${H}Z" style="fill:${color}" opacity=".12"/>` : ''}
    <path d="${d}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" class="spark"/></svg>`;
  const p = container.querySelector('.spark');
  const len = p.getTotalLength();
  p.style.strokeDasharray = len;
  p.style.strokeDashoffset = len;
  p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 1200, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
}

const observers = new WeakMap();
function observeResize(container, draw) {
  observers.get(container)?.disconnect();
  let w = container.clientWidth, raf;
  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - w) < 4) return;
    w = container.clientWidth;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  });
  ro.observe(container);
  observers.set(container, ro);
  // Farben hängen am Theme (CSS-Variablen) – SVG nutzt var(), daher kein Neuzeichnen nötig
}
