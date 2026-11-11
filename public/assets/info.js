// "Info des Tages": täglicher, sachlicher Impuls zur Alkohol-Pause + "Meine Zahlen" aus den eigenen Daten.
import { addDays, alcoholUnits, BEER, daysBetween, INFO_BONUS, isConfirmed, SHOT_KCAL } from './score.js';
import { api, esc, fmt, fmtDate, toast } from './app.js';

export const CATEGORIES = {
  folgen: 'Folgen', abstinenz: 'Abstinenz', training: 'Training', motivation: 'Motivation',
  verlangen: 'Verlangen', alternativen: 'Alternativen', soziales: 'Soziales',
};

let view = 'tip';
try { view = sessionStorage.getItem('infoView') || 'tip'; } catch {}

/** Platzhalter; der Inhalt wird nach dem Rendern geladen (blockiert die Startseite nicht). */
export const infoCardShell = () => `<section class="card info-card" id="info-card" data-reveal aria-live="polite"><div class="skeleton" style="height:120px"></div></section>`;

export async function loadInfo(ctx, { streak = 0, labs = [] } = {}) {
  const box = document.getElementById('info-card');
  if (!box) return;
  let data;
  try {
    data = await api(`/api/info?date=${ctx.today}&streak=${streak}`);
  } catch (ex) {
    box.innerHTML = `<div class="card-title">Info des Tages</div><p class="muted" style="margin:0">Konnte nicht geladen werden: ${esc(ex.message)}</p>`;
    return;
  }
  const render = () => {
    box.innerHTML = `
      <div class="info-head">
        <div class="seg info-tabs" role="tablist" aria-label="Info">
          <button type="button" role="tab" data-view="tip" aria-pressed="${view === 'tip'}">Info des Tages</button>
          <button type="button" role="tab" data-view="nums" aria-pressed="${view === 'nums'}">Meine Zahlen</button>
        </div>
      </div>
      ${view === 'tip' ? tipView(data) : numbersView(ctx, labs)}
      <p class="info-foot">Kein Ersatz für ärztlichen Rat.</p>`;
  };
  render();
  box.addEventListener('click', async e => {
    const v = e.target.closest('[data-view]')?.dataset.view;
    if (v) { view = v; try { sessionStorage.setItem('infoView', v); } catch {} render(); return; }
    const read = e.target.closest('[data-read]');
    if (read) {
      read.disabled = true;
      const first = !data.read;
      try {
        data = await api('/api/info', { method: 'POST', body: { date: ctx.today, action: 'read', tip_id: Number(read.dataset.read) } });
        if (first) { toast(`Gelesen ✓  +${INFO_BONUS} Punkt im heutigen Score`, 'success'); document.dispatchEvent(new CustomEvent('datachange')); }
        else render();
      } catch (ex) { toast(ex.message, 'error'); read.disabled = false; }
      return;
    }
    if (e.target.closest('[data-more]')) {
      e.target.disabled = true;
      try {
        data = await api('/api/info', { method: 'POST', body: { date: ctx.today, action: 'next' } });
        render();
        box.querySelector('.info-tip:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (ex) { toast(ex.message, 'error'); e.target.disabled = false; }
    }
  });
}

function tipView(data) {
  if (!data.tip) return '<p class="muted" style="margin:0">Noch keine Inhalte vorhanden.</p>';
  const tips = [data.tip, ...data.more];
  return `
    ${tips.map((t, i) => `
    <article class="info-tip ${i ? 'extra' : ''}">
      <div class="info-meta"><span class="chip-cat cat-${esc(t.kategorie)}">${esc(CATEGORIES[t.kategorie] || t.kategorie)}</span>${t.streak_tag ? `<span class="muted">Tag ${t.streak_tag}</span>` : ''}</div>
      <h3>${esc(t.titel)}</h3>
      <p>${esc(t.kurz)}</p>
      ${t.lang ? `<details><summary>Mehr lesen</summary><p>${esc(t.lang)}</p></details>` : ''}
      ${t.quelle ? `<p class="muted info-src">Quelle: ${esc(t.quelle)}</p>` : ''}
      <button type="button" class="btn ${t.gelesen ? 'ghost' : 'secondary'} btn-read" data-read="${t.id}" ${t.gelesen ? 'disabled' : ''}>
        ${t.gelesen ? 'Gelesen ✓' : i === 0 && !data.read ? `Gelesen <small>+${INFO_BONUS} Punkt</small>` : 'Gelesen'}</button>
    </article>`).join('')}
    <div class="info-actions">
      <button type="button" class="btn ghost" data-more>Noch eine Info</button>
      <span class="muted">${data.readTotal} von ${data.total} gelesen</span>
    </div>`;
}

// ---------- Meine Zahlen ----------
const labSeries = (labs, re) => labs.filter(l => re.test(l.test_name)).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
const dm = s => fmtDate(s, { day: '2-digit', month: '2-digit', year: '2-digit' });
const kcalOf = d => (d?.beer_count || 0) * BEER.kcal + (d?.shots_count || 0) * SHOT_KCAL;
const unitsOf = d => alcoholUnits(d);

export function myNumbers(ctx, labs) {
  const { today, daysByDate, weights, challenge: ch } = ctx;
  const out = {};
  // Triglyceride
  const tg = labSeries(labs, /trigly/i);
  if (tg.length) {
    const last = tg.at(-1), prev = tg.at(-2) || null;
    out.tg = { last, prev, goal: last.value >= 500 ? 500 : last.value >= 200 ? 200 : null };
  }
  // Leber
  out.liver = [['Gamma-GT', /^gamma-?gt|^ggt/i], ['GOT', /^got\b|^ast\b|got \(ast\)/i], ['GPT', /^gpt\b|^alt\b|gpt \(alt\)/i]]
    .map(([name, re]) => ({ name, rows: labSeries(labs, re).slice(-3) })).filter(x => x.rows.length);
  // Challenge: Tage, alkoholfreie Tage, weggelassene Getränke und kcal gegenüber den 4 Wochen davor
  if (ch?.start) {
    const end = ch.check && ch.check < today ? ch.check : today;
    let free = 0;
    for (let d = ch.start; d <= end; d = addDays(d, 1)) if (isConfirmed(daysByDate[d]) && !unitsOf(daysByDate[d])) free++;
    let n = 0, units = 0, kcal = 0;
    for (let i = 1; i <= 28; i++) {
      const d = daysByDate[addDays(ch.start, -i)];
      if (isConfirmed(d)) { n++; units += unitsOf(d); kcal += kcalOf(d); }
    }
    out.challenge = {
      days: Math.max(0, daysBetween(ch.start, end) + 1), free,
      skipped: n ? (units / n) * free : null, kcal: n ? (kcal / n) * free : null, baseDays: n,
      check: ch.check, toCheck: ch.check ? daysBetween(today, ch.check) : null,
    };
    // Gewicht: letzte Messung vor/am Start vs. letzte Messung
    const ws = weights.filter(w => w.weight_kg != null);
    const atStart = [...ws].reverse().find(w => w.entry_date <= ch.start) || null;
    const last = ws.at(-1) || null;
    out.weight = { atStart, last, since: last && atStart && last.entry_date > atStart.entry_date ? last.weight_kg - atStart.weight_kg : null };
  }
  return out;
}

function numbersView(ctx, labs) {
  const n = myNumbers(ctx, labs);
  const trend = (a, b) => (b == null ? '' : a < b ? '<span class="good">▼</span>' : a > b ? '<span class="bad">▲</span>' : '=');
  const rows = [];
  if (n.tg) {
    const { last, prev, goal } = n.tg;
    rows.push(`<div class="num-block"><h4>Triglyceride</h4>
      <p><b class="${last.value >= 500 ? 'bad' : last.value >= 200 ? 'warn' : 'good'}">${fmt(last.value)} ${esc(last.unit || 'mg/dl')}</b> am ${dm(last.entry_date)}
        ${prev ? ` · davor ${fmt(prev.value)} (${dm(prev.entry_date)}) ${trend(last.value, prev.value)}` : ''}</p>
      <p class="muted">${goal ? `Nächstes Ziel: unter ${goal}${goal === 500 ? ', danach unter 200' : ''}.` : 'Im Zielbereich unter 200.'}
        ${n.challenge?.check && n.challenge.toCheck >= 0 ? ` Kontrolle in ${n.challenge.toCheck} ${n.challenge.toCheck === 1 ? 'Tag' : 'Tagen'} (${fmtDate(n.challenge.check, { day: '2-digit', month: '2-digit' })}):` : ' Zur Kontrolle:'}
        nüchtern zur Blutabnahme – morgens ohne Frühstück, nur Wasser.</p></div>`);
  }
  if (n.challenge) {
    const c = n.challenge;
    rows.push(`<div class="num-block"><h4>Alkohol-Pause</h4>
      <div class="num-grid">
        <div><b>${c.days}</b><span>Tage seit Start</span></div>
        <div><b>${c.free}</b><span>davon bestätigt alkoholfrei</span></div>
        <div><b>${c.skipped != null ? `≈ ${fmt(c.skipped, c.skipped < 10 ? 1 : 0)}` : '–'}</b><span>Getränke weggelassen (Bier-Äquivalente)</span></div>
        <div><b>${c.kcal != null ? `≈ ${fmt(Math.round(c.kcal / 50) * 50)}` : '–'}</b><span>kcal eingespart</span></div>
      </div>
      <p class="muted">${c.baseDays ? `Vergleich mit deinem Ø der 4 Wochen vor dem Start (${c.baseDays} bestätigte Tage). Näherung: Bier ≈ ${BEER.kcal} kcal / 0,5 l, Stamperl ≈ ${SHOT_KCAL} kcal.`
        : 'Für den Vergleich fehlen bestätigte Tage aus den 4 Wochen vor dem Start.'}</p></div>`);
  }
  if (n.weight) {
    const w = n.weight;
    rows.push(`<div class="num-block"><h4>Gewicht</h4>
      <p>${w.last ? `<b>${fmt(w.last.weight_kg, 1)} kg</b> am ${dm(w.last.entry_date)}` : 'Noch keine Messung'}
        ${w.since != null ? ` · <b class="${w.since <= 0 ? 'good' : 'bad'}">${w.since > 0 ? '+' : w.since < 0 ? '−' : '±'}${fmt(Math.abs(w.since), 1)} kg</b> seit Start` : ''}</p>
      ${w.since == null ? '<p class="muted">Seit dem Start noch keine Messung – einmal wiegen, dann siehst du hier die Veränderung.</p>' : ''}</div>`);
  }
  if (n.liver.length) {
    rows.push(`<div class="num-block"><h4>Leberwerte</h4>
      <table class="cmp liver"><tbody>${n.liver.map(x => `<tr><th>${x.name}</th>${x.rows.map((r, i) => `<td>${fmt(r.value)} <small>${dm(r.entry_date)}</small>${i === x.rows.length - 1 && i ? ` ${trend(r.value, x.rows[i - 1].value)}` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="muted">Einheit U/l. Die Einordnung der Werte gehört zum Hausarzt.</p></div>`);
  }
  return rows.length ? rows.join('') : '<p class="muted" style="margin:0">Noch keine Daten. Blutwerte trägst du unter Gesundheit › Blutwerte ein.</p>';
}
