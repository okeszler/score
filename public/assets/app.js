// Gemeinsame Client-Logik: Navigation, API, Formatierung, Animationen, Daten-Kontext.
import { addDays, isoDate, mergeGoals, scoreAll, STATUS, withProvisionalDays } from './score.js';

// ---------- Icons (Lucide-Stil, inline) ----------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  week: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  scale: '<path d="M5 7h14l-1.5 13h-11z"/><path d="M9 11a3 3 0 0 1 6 0"/><path d="M12 11l1.5-2"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  beer: '<path d="M6 8h10v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 11h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2"/><path d="M6 8a3 3 0 0 1 3-4 3 3 0 0 1 5 0 2.5 2.5 0 0 1 2 4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l2-3 3 6 2-3h6"/>',
  moonSleep: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  drop: '<path d="M12 2.7s-6 6.4-6 11a6 6 0 0 0 12 0c0-4.6-6-11-6-11z"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  flex: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

const PAGES = [
  { id: 'heute', href: '/', label: 'Heute', icon: 'home' },
  { id: 'woche', href: '/woche', label: 'Woche', icon: 'week' },
  { id: 'eintrag', href: '/eintrag', label: 'Eintragen', icon: 'plus', cls: 'nav-add' },
  { id: 'gewicht', href: '/gewicht', label: 'Körper', icon: 'scale' },
  { id: 'gesundheit', href: '/gesundheit', label: 'Gesundheit', icon: 'heart' },
];
// nur in der Desktop-Seitenleiste (mobil über die Wochenseite erreichbar)
const EXTRA_PAGES = [{ id: 'verlauf', href: '/verlauf', label: 'Verlauf', icon: 'chart' }];

// ---------- Theme ----------
export function currentTheme() {
  return document.documentElement.dataset.theme || 'light';
}
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  document.querySelectorAll('[data-theme-toggle]').forEach(b => (b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon')));
  document.dispatchEvent(new CustomEvent('themechange'));
}

// ---------- Shell (Navigation + Kopfzeile) ----------
export function shell({ page, title, subtitle = '' }) {
  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.setAttribute('aria-label', 'Hauptnavigation');
  nav.innerHTML = `
    <div class="nav-brand"><span class="logo">${icon('flex')}</span><div><b>SCORE</b><i>Weg zu 85 kg</i></div></div>
    ${PAGES.map(p => `<a href="${p.href}" class="${p.cls || ''}" ${p.id === page ? 'aria-current="page"' : ''}>${icon(p.icon)}<span>${p.label}</span></a>`).join('')}
    ${EXTRA_PAGES.map(p => `<a href="${p.href}" class="nav-extra" ${p.id === page ? 'aria-current="page"' : ''}>${icon(p.icon)}<span>${p.label}</span></a>`).join('')}
    <div class="spacer nav-extra" style="padding:0"></div>
    <a href="/einstellungen" class="nav-extra" ${page === 'einstellungen' ? 'aria-current="page"' : ''}>${icon('settings')}<span>Einstellungen</span></a>`;
  document.body.prepend(nav);

  const top = document.querySelector('.topbar');
  if (top) {
    top.innerHTML = `
      <h1>${title}${subtitle ? `<small>${subtitle}</small>` : ''}</h1>
      <button class="icon-btn" data-sync title="Health Sync: Schritte & Gewicht aus Google Drive" aria-label="Health Sync">${icon('sync')}</button>
      <button class="icon-btn" data-theme-toggle aria-label="Hell/Dunkel umschalten">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
      ${page !== 'einstellungen' ? `<a class="icon-btn" href="/einstellungen" aria-label="Einstellungen">${icon('settings')}</a>` : ''}`;
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(b =>
    b.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')));
  document.querySelectorAll('[data-sync]').forEach(b => b.addEventListener('click', () => runSync(b)));
}

// ---------- API ----------
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.endsWith('/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error('Nicht angemeldet');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `Fehler ${res.status}`);
  return data;
}

// ---------- Daten-Kontext ----------
export const today = () => isoDate(new Date());

/** Lädt Tage ab `daysBack` (für Wochenbudget immer ab Wochenbeginn) + Gewicht + Ziele und rechnet Scores. */
export async function loadContext(daysBack = 120) {
  const t = today();
  // Für Wochen-Streaks/Budget eine Woche Puffer
  const from = addDays(t, -(daysBack + 7));
  const data = await api(`/api/data?from=${from}`);
  const goals = mergeGoals(data.goals);
  let daysByDate = {};
  for (const d of data.days) daysByDate[d.entry_date] = d;
  daysByDate = withProvisionalDays(daysByDate, data.synced, data.food || {}, t);
  const scores = scoreAll(daysByDate, goals);
  const weights = data.weights;
  const lastWeight = [...weights].reverse().find(w => w.weight_kg != null) || null;
  const firstWeight = weights.find(w => w.weight_kg != null) || null;
  const lastFat = [...weights].reverse().find(w => w.body_fat_pct != null) || null;
  return { today: t, goals, daysByDate, scores, weights, synced: data.synced, food: data.food || {}, lastWeight, firstWeight, lastFat };
}

// ---------- Formatierung ----------
const nf = (d = 0) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? '–' : nf(d).format(v));
export const fmtDate = (s, opts = { weekday: 'short', day: '2-digit', month: '2-digit' }) =>
  new Date(`${s}T12:00:00`).toLocaleDateString('de-DE', opts);
export const fmtLong = s => fmtDate(s, { weekday: 'long', day: '2-digit', month: 'long' });
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const statusLabel = s => STATUS[s]?.label ?? '–';

// ---------- Animationen ----------
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function countUp(el, value, decimals = 0, duration = 1000) {
  if (!el) return;
  if (value == null || Number.isNaN(value)) { el.textContent = '–'; return; }
  if (reduced()) { el.textContent = fmt(value, decimals); return; }
  const start = performance.now();
  const from = 0;
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (value - from) * e, decimals);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Setzt Breiten/Offsets erst im nächsten Frame, damit CSS-Transitions greifen. */
export function animateIn(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export function reveal(root = document) {
  root.querySelectorAll('[data-reveal]').forEach((el, i) => {
    el.classList.add('reveal');
    el.style.setProperty('--i', i);
  });
}

/** Score-Ring (0–10) */
export function ring(total, status, { size = '', max = 10, label = 'Score' } = {}) {
  const r = 40, c = 2 * Math.PI * r;
  const id = `r${Math.random().toString(36).slice(2, 8)}`;
  const html = `<div class="ring ${size}" id="${id}">
      <svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="${r}"/><circle class="bar" cx="50" cy="50" r="${r}"
        stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg>
      <div class="ring-label"><div><span>${total == null ? '–' : total}</span><small>${label}</small></div></div></div>`;
  animateIn(() => {
    const bar = document.querySelector(`#${id} .bar`);
    if (!bar) return;
    bar.style.stroke = `var(--${status === 'green' ? 'good' : status === 'orange' ? 'warn' : status === 'red' ? 'bad' : 'none'})`;
    bar.style.strokeDashoffset = c * (1 - (total ?? 0) / max);
  });
  return html;
}

// ---------- Toast & Modal ----------
export function toast(msg, type = '') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.append(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  wrap.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, type === 'error' ? 5000 : 2800);
}

export function modal(html, { onOpen, onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const prevFocus = document.activeElement;
  const close = () => {
    back.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => back.remove(), 300);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = e => e.key === 'Escape' && close();
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  animateIn(() => back.classList.add('open'));
  back.querySelector('button, input, a')?.focus({ preventScroll: true });
  onOpen?.(back.querySelector('.modal'), close);
  return close;
}

export function confirmDialog(text, okLabel = 'Löschen') {
  return new Promise(resolve => {
    let result = false;
    modal(`<h2>${esc(text)}</h2>
      <div class="btn-row"><button class="btn danger" data-ok>${esc(okLabel)}</button><button class="btn secondary" data-close>Abbrechen</button></div>`, {
      onOpen: (m, close) => m.querySelector('[data-ok]').addEventListener('click', () => { result = true; close(); }),
      onClose: () => resolve(result),
    });
  });
}

// ---------- Health Sync ----------
async function runSync(btn) {
  if (btn.classList.contains('spinning')) return;
  btn.classList.add('spinning');
  let total = { imported: 0, steps: 0, weights: 0, errors: [] };
  try {
    for (let round = 0; round < 10; round++) {
      const r = await api('/api/sync', { method: 'POST' });
      total.imported += r.imported.length;
      total.steps += r.stepsDays;
      total.weights += r.weightReadings;
      total.errors.push(...r.errors);
      if (!r.remaining || (r.imported.length === 0 && r.skipped === 0)) break;
    }
    if (total.errors.length) toast(`Sync teilweise fehlgeschlagen: ${total.errors[0]}`, 'error');
    else if (total.imported === 0) toast('Alles aktuell – keine neuen Dateien', 'success');
    else toast(`${total.imported} Datei(en) importiert · ${total.steps} Schritt-Tage · ${total.weights} Gewichtsmessungen`, 'success');
    if (total.imported) document.dispatchEvent(new CustomEvent('datachange'));
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.classList.remove('spinning');
  }
}

/** Seite starten: Fehler sichtbar machen statt leerer Seite. */
export async function boot(render) {
  const main = document.querySelector('#content');
  const run = async () => {
    try {
      await render(main);
      reveal(main);
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="card empty-state">Daten konnten nicht geladen werden.<br><small>${esc(e.message)}</small><br>
        <button class="btn secondary" onclick="location.reload()">Erneut versuchen</button></div>`;
    }
  };
  document.addEventListener('datachange', run);
  await run();
}
