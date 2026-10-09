import { addDays } from '../score.js';
import { bpCategory, STAGE_LABELS } from '../health.js';
import { api, boot, confirmDialog, countUp, esc, fmt, fmtDate, icon, shell, today, toast } from '../app.js';
import { barChart, lineChart } from '../charts.js';

shell({ page: 'gesundheit', title: 'Gesundheit', subtitle: 'Blutdruck · Puls · Schlaf · Blutwerte' });

const RANGES = [[30, '30 T'], [90, '90 T'], [365, '1 J'], [0, 'Alles']];
let range = 90;
let labTest = null;
try { range = Number(localStorage.getItem('healthRange') ?? 90); labTest = localStorage.getItem('labTest'); } catch {}

const ACT = { WALKING: 'Gehen', RUNNING: 'Laufen', BIKING: 'Radfahren', CYCLING: 'Radfahren', SWIMMING: 'Schwimmen',
  STRENGTH_TRAINING: 'Krafttraining', WEIGHTLIFTING: 'Krafttraining', HIKING: 'Wandern', ELLIPTICAL: 'Crosstrainer',
  ROWING: 'Rudern', YOGA: 'Yoga', OTHER: 'Sonstiges', WORKOUT: 'Training' };
const actLabel = t => ACT[t] || (t ? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ') : 'Aktivität');
const hm = s => (s == null ? '–' : `${Math.floor(s / 3600)}:${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`);
const clock = ms => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const STAGE_COLOR = { deep: 'var(--hero)', rem: 'var(--blue)', light: 'color-mix(in srgb, var(--blue) 45%, var(--surface-2))', awake: 'var(--warn)' };
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

boot(async main => {
  const t = today();
  const h = await api('/api/health?from=0000-01-01');
  const from = range ? addDays(t, -range) : null;
  const inR = d => !from || d >= from;

  // ---- Blutdruck ----
  const bps = h.bloodPressure;
  const lastBp = bps.at(-1) || null;
  const lastCat = lastBp ? bpCategory(lastBp.systolic, lastBp.diastolic) : null;

  // ---- Puls ----
  const restingDays = h.pulse.filter(p => p.resting != null);
  const lastRest = restingDays.at(-1) || null;
  const rest7 = avg(restingDays.filter(p => p.date > addDays(t, -7)).map(p => p.resting));
  const restPrev7 = avg(restingDays.filter(p => p.date > addDays(t, -14) && p.date <= addDays(t, -7)).map(p => p.resting));

  // ---- Schlaf ----
  const lastNight = h.nights.at(-1) || null;
  const sleep7 = avg(h.nights.filter(n => n.date > addDays(t, -7)).map(n => n.asleepSeconds));

  // ---- Blutwerte ----
  const tests = [...new Set(h.labs.map(l => l.test_name))].sort((a, b) => a.localeCompare(b, 'de'));
  if (!tests.includes(labTest)) {
    const counts = {};
    for (const l of h.labs) counts[l.test_name] = (counts[l.test_name] || 0) + 1;
    labTest = tests.slice().sort((a, b) => counts[b] - counts[a])[0] || null;
  }
  const latestPerTest = tests.map(name => {
    const rows = h.labs.filter(l => l.test_name === name); // neueste zuerst
    return { name, last: rows[0], prev: rows[1] || null, count: rows.length };
  });

  main.innerHTML = `
  <div class="tiles tiles-4" data-reveal>
    <a class="tile" href="#bp">
      <div class="tile-value">${lastBp ? `${lastBp.systolic}/${lastBp.diastolic}` : '–'}<span class="unit">mmHg</span></div>
      <div class="tile-label">Blutdruck${lastBp ? ` · ${fmtDate(lastBp.entry_date)}` : ''}</div>
      <div class="tile-viz">${lastCat ? `<span class="pill ${lastCat.status}">${lastCat.label}</span>` : ''}</div>
    </a>
    <a class="tile" href="#puls">
      <div class="tile-value"><span id="t-rest">–</span><span class="unit">bpm</span></div>
      <div class="tile-label">Ruhepuls${lastRest ? ` · ${fmtDate(lastRest.date)}` : ''}</div>
      <div class="tile-viz muted" style="font-size:.8rem">${rest7 != null ? `Ø 7 Tage ${fmt(rest7, 1)}${restPrev7 != null ? ` (${rest7 - restPrev7 > 0 ? '+' : ''}${fmt(rest7 - restPrev7, 1)})` : ''}` : ''}</div>
    </a>
    <a class="tile" href="#schlaf">
      <div class="tile-value">${lastNight ? hm(lastNight.asleepSeconds) : '–'}<span class="unit">h</span></div>
      <div class="tile-label">Schlaf${lastNight ? ` · Nacht auf ${fmtDate(lastNight.date)}` : ''}</div>
      <div class="tile-viz muted" style="font-size:.8rem">${sleep7 != null ? `Ø 7 Nächte ${hm(sleep7)} h` : ''}</div>
    </a>
    <a class="tile" href="#labor">
      <div class="tile-value">${tests.length}<span class="unit">Werte</span></div>
      <div class="tile-label">Blutwerte${h.labs[0] ? ` · zuletzt ${fmtDate(h.labs[0].entry_date, { day: '2-digit', month: '2-digit', year: 'numeric' })}` : ''}</div>
      <div class="tile-viz"></div>
    </a>
  </div>

  <div class="toggles" style="margin:18px 0 0" role="group" aria-label="Zeitraum">
    ${RANGES.map(([v, l]) => `<button class="pill" data-range="${v}" style="cursor:pointer;border:0;${range === v ? 'background:var(--accent-soft);color:var(--accent)' : ''}">${l}</button>`).join('')}
  </div>

  <div class="grid grid-2" style="margin-top:16px">
    <section class="card" id="bp" data-reveal>
      <div class="card-title">Blutdruck ${lastCat ? `<span class="pill ${lastCat.status}">${lastCat.label}</span>` : ''}</div>
      <div id="ch-bp"></div>
      <div class="legend"><span><i class="line" style="background:var(--accent)"></i>Systolisch</span><span><i class="line" style="background:var(--blue)"></i>Diastolisch</span><span><i class="dash"></i>130/85 (hoch-normal ab)</span></div>
      <details style="margin-top:14px"><summary class="btn ghost" style="padding:0">+ Messung eintragen</summary>
        <form class="form" id="bp-form" style="margin-top:12px" novalidate>
          <div class="form-grid">
            <div class="field"><label for="bp-d">Datum</label><input id="bp-d" type="date" name="entry_date" value="${t}" max="${t}"></div>
            <div class="field"><label for="bp-t">Uhrzeit</label><input id="bp-t" type="time" name="reading_time"></div>
            <div class="field"><label for="bp-s">Systolisch</label><div class="input-wrap"><input id="bp-s" name="systolic" type="number" inputmode="numeric" min="60" max="260" required><span class="suffix">mmHg</span></div></div>
            <div class="field"><label for="bp-di">Diastolisch</label><div class="input-wrap"><input id="bp-di" name="diastolic" type="number" inputmode="numeric" min="30" max="160" required><span class="suffix">mmHg</span></div></div>
            <div class="field"><label for="bp-p">Puls</label><div class="input-wrap"><input id="bp-p" name="pulse" type="number" inputmode="numeric" min="25" max="240"><span class="suffix">bpm</span></div></div>
            <div class="field"><label for="bp-n">Notiz</label><input id="bp-n" type="text" name="note" maxlength="300"></div>
          </div>
          <button class="btn block" type="submit">Speichern</button>
        </form>
      </details>
      ${bpList(bps.slice(-3).reverse())}
      ${bps.length > 3 ? `<details style="margin-top:4px"><summary class="btn ghost" style="padding:0">Alle ${bps.length} Messungen</summary>${bpList(bps.slice(0, -3).reverse())}</details>` : ''}
    </section>

    <section class="card" id="puls" data-reveal>
      <div class="card-title">Puls</div>
      <div class="kv" style="margin-bottom:12px">
        <div><b>${lastRest ? fmt(lastRest.resting, 0) : '–'}</b><span>Ruhepuls letzte Nacht</span></div>
        <div><b>${rest7 != null ? fmt(rest7, 1) : '–'}</b><span>Ø Ruhepuls 7 Tage</span></div>
        <div><b>${h.pulse.at(-1) ? fmt(h.pulse.at(-1).avg, 0) : '–'}</b><span>Ø Puls heute/zuletzt</span></div>
      </div>
      <div id="ch-pulse"></div>
      <div class="legend"><span><i class="line" style="background:var(--accent)"></i>Ruhepuls (Nacht)</span><span><i class="line" style="background:var(--muted)"></i>Ø Tagespuls</span></div>
      <p class="muted" style="font-size:.78rem;margin:10px 0 0">Ruhepuls = Ø Puls während der Hauptnacht (Uhr/Ring über Health Connect). Ein sinkender Ruhepuls zeigt bessere Fitness und Erholung; nach Alkohol steigt er meist deutlich.</p>
    </section>
  </div>

  <section class="card" id="schlaf" data-reveal style="margin-top:16px">
    <div class="card-title">Schlaf ${lastNight ? `<span class="muted" style="text-transform:none;letter-spacing:0">Nacht auf ${fmtDate(lastNight.date, { weekday: 'long', day: '2-digit', month: '2-digit' })}</span>` : ''}</div>
    ${lastNight ? `
      <div class="kv" style="margin-bottom:12px">
        <div><b>${hm(lastNight.asleepSeconds)}</b><span>geschlafen</span></div>
        <div><b>${clock(lastNight.bed)}–${clock(lastNight.wake)}</b><span>im Bett ${hm(lastNight.inBedSeconds)} h</span></div>
        ${['deep', 'rem', 'light', 'awake'].filter(s => lastNight.stages[s]).map(s => `<div><b>${hm(lastNight.stages[s])}</b><span>${STAGE_LABELS[s]}</span></div>`).join('')}
      </div>
      <div class="sleepbar" aria-label="Schlafphasen letzte Nacht">${h.lastNightSegments.map(sg => {
        const w = ((sg.end - sg.start) / (lastNight.wake - lastNight.bed)) * 100;
        return `<i style="width:${w}%;background:${STAGE_COLOR[sg.stage] || 'var(--blue)'}" title="${STAGE_LABELS[sg.stage] || sg.stage} ${clock(sg.start)}–${clock(sg.end)}"></i>`;
      }).join('')}</div>
      <div class="legend">${['deep', 'rem', 'light', 'awake'].map(s => `<span><i style="background:${STAGE_COLOR[s]}"></i>${STAGE_LABELS[s]}</span>`).join('')}</div>` : '<div class="empty-state">Noch keine Schlafdaten.</div>'}
    <div id="ch-sleep" style="margin-top:16px"></div>
    <div class="legend"><span><i class="st-green"></i>≥ 7 h</span><span><i class="st-orange"></i>6–7 h</span><span><i class="st-red"></i>&lt; 6 h</span></div>
  </section>

  <section class="card" id="labor" data-reveal style="margin-top:16px">
    <div class="card-title">Blutwerte <a href="/api/export?type=blutwerte">${icon('download').replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')} CSV</a></div>
    ${tests.length ? `<div class="field" style="margin-bottom:12px"><label for="lab-sel">Test</label>
        <select id="lab-sel">${tests.map(n => `<option ${n === labTest ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div id="ch-lab"></div><div class="list" id="lab-rows"></div>` : '<div class="empty-state">Noch keine Blutwerte.</div>'}
    <details style="margin-top:10px"><summary class="btn ghost" style="padding:0">+ Blutwert eintragen</summary>
      <form class="form" id="lab-form" novalidate style="margin-top:12px">
        <input type="hidden" name="id">
        <div class="form-grid">
          <div class="field"><label for="l-d">Datum</label><input id="l-d" type="date" name="entry_date" value="${t}" max="${t}"></div>
          <div class="field"><label for="l-n">Test</label><input id="l-n" name="test_name" list="l-names" maxlength="80" placeholder="z. B. HbA1c" value="${esc(labTest || '')}"></div>
          <div class="field"><label for="l-v">Wert</label><input id="l-v" name="value" type="text" inputmode="decimal"></div>
          <div class="field"><label for="l-u">Einheit</label><input id="l-u" name="unit" maxlength="30" value="${esc(latestPerTest.find(x => x.name === labTest)?.last.unit || '')}"></div>
        </div>
        <datalist id="l-names">${tests.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="field"><label for="l-no">Notiz</label><input id="l-no" name="note" maxlength="300" placeholder="z. B. nüchtern, Beginn Medikament"></div>
        <div class="btn-row"><button class="btn" type="submit" style="flex:1">Blutwert speichern</button><button class="btn secondary hidden" type="button" id="l-cancel">Abbrechen</button></div>
      </form>
    </details>
    ${tests.length ? `<details style="margin-top:6px"><summary class="btn ghost" style="padding:0">Alle ${tests.length} Tests im Überblick</summary>
      <div class="lab-grid">${latestPerTest.map(x => {
        const d = x.prev ? x.last.value - x.prev.value : null;
        return `<button type="button" class="lab-cell" data-pick="${esc(x.name)}"><span>${esc(x.name)}</span>
          <b>${fmt(x.last.value, x.last.value % 1 ? 2 : 0)} <small>${esc(x.last.unit || '')}</small>${d ? ` <small class="muted">${d > 0 ? '▲' : '▼'}</small>` : ''}</b>
          <small class="muted">${fmtDate(x.last.entry_date, { month: '2-digit', year: 'numeric' })}</small></button>`;
      }).join('')}</div></details>` : ''}
  </section>

  <section class="card" data-reveal style="margin-top:16px">
    <div class="card-title">Aktivitäten</div>
    <div class="list wrap">${h.activities.slice(0, 8).map(a => `
      <div class="list-item"><div class="dot" style="background:var(--blue)">${icon('flex').replace('<svg', '<svg style="width:18px;height:18px"')}</div>
        <div class="meta"><b>${actLabel(a.activity_type)} · ${hm(a.active_seconds ?? a.elapsed_seconds)} h</b>
        <span>${fmtDate(a.entry_date)} ${a.start_time ? a.start_time.slice(0, 5) : ''}${a.distance_km ? ` · ${fmt(a.distance_km, 2)} km` : ''}${a.calories ? ` · ${fmt(a.calories)} kcal` : ''}${a.steps ? ` · ${fmt(a.steps)} Schritte` : ''}${a.avg_hr ? ` · Ø ${fmt(a.avg_hr)} bpm` : ''}</span></div></div>`).join('') || '<div class="empty-state">Noch keine Aktivitäten.</div>'}</div>
  </section>`;

  countUp(document.getElementById('t-rest'), lastRest?.resting ?? null, 0, 700);

  // ---- Diagramme ----
  const bpR = bps.filter(b => inR(b.entry_date));
  // pro Tag die erste Messung (morgens) für eine ruhige Kurve
  const bpDay = Object.values(Object.fromEntries([...bpR].reverse().map(b => [b.entry_date, b])));
  lineChart(document.getElementById('ch-bp'), {
    series: [
      { name: 'Systolisch', color: 'var(--accent)', points: bpDay.map(b => ({ x: b.entry_date, y: b.systolic })), dots: true },
      { name: 'Diastolisch', color: 'var(--blue)', points: bpDay.map(b => ({ x: b.entry_date, y: b.diastolic })), dots: true },
    ],
    goal: { y: 130, label: '130' }, height: 200, unit: 'mmHg', decimals: 0, label: 'Blutdruckverlauf',
    empty: 'Keine Messungen im Zeitraum',
  });
  const pR = h.pulse.filter(p => inR(p.date));
  lineChart(document.getElementById('ch-pulse'), {
    series: [
      { name: 'Ruhepuls', color: 'var(--accent)', points: pR.filter(p => p.resting != null).map(p => ({ x: p.date, y: p.resting })), dots: true },
      { name: 'Ø Tag', color: 'color-mix(in srgb, var(--muted) 55%, transparent)', points: pR.map(p => ({ x: p.date, y: p.avg })), width: 1.2 },
    ],
    height: 200, unit: 'bpm', decimals: 0, label: 'Pulsverlauf', empty: 'Noch keine Pulsdaten',
  });
  const nR = h.nights.filter(n => inR(n.date)).slice(-60);
  barChart(document.getElementById('ch-sleep'), {
    bars: nR.map(n => {
      const hrs = n.asleepSeconds / 3600;
      return { label: fmtDate(n.date, { day: '2-digit', month: '2-digit' }), value: Math.round(hrs * 10) / 10,
        status: hrs >= 7 ? 'green' : hrs >= 6 ? 'orange' : 'red', tip: `<span>${fmtDate(n.date)}</span><br><b>${hm(n.asleepSeconds)} h</b> · ${clock(n.bed)}–${clock(n.wake)}` };
    }),
    goal: 7, height: 180, label: 'Schlafdauer pro Nacht',
  });
  if (labTest) {
    const rows = h.labs.filter(l => l.test_name === labTest).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    lineChart(document.getElementById('ch-lab'), {
      series: [{ name: labTest, color: 'var(--accent)', points: rows.map(l => ({ x: l.entry_date, y: l.value })), dots: true, area: true }],
      height: 190, unit: rows[0]?.unit || '', decimals: 2, label: `Verlauf ${labTest}`,
    });
    const labRow = l => `
      <div class="list-item"><div class="meta"><b>${fmt(l.value, l.value % 1 ? 2 : 0)} ${esc(l.unit || '')}</b><span>${fmtDate(l.entry_date, { day: '2-digit', month: '2-digit', year: 'numeric' })}${l.note ? ` · ${esc(l.note)}` : ''}</span></div>
      <div class="actions"><button type="button" data-edit="${l.id}" aria-label="Bearbeiten">${icon('edit')}</button><button type="button" class="del" data-lab="${l.id}" aria-label="Löschen">${icon('trash')}</button></div></div>`;
    const rev = [...rows].reverse();
    document.getElementById('lab-rows').innerHTML = rev.slice(0, 5).map(labRow).join('')
      + (rev.length > 5 ? `<details><summary class="btn ghost" style="padding:8px 0">Ältere Werte (${rev.length - 5})</summary>${rev.slice(5).map(labRow).join('')}</details>` : '');
  }

  // ---- Interaktion ----
  const reload = () => document.dispatchEvent(new CustomEvent('datachange'));
  main.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    range = Number(b.dataset.range); try { localStorage.setItem('healthRange', range); } catch {} reload();
  }));
  const pick = name => { labTest = name; try { localStorage.setItem('labTest', name); } catch {} reload(); };
  document.getElementById('lab-sel')?.addEventListener('change', e => pick(e.target.value));
  main.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => pick(b.dataset.pick)));

  const bpForm = document.getElementById('bp-form');
  bpForm.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/bp', { method: 'POST', body: Object.fromEntries(new FormData(bpForm)) });
      toast('Blutdruck gespeichert', 'success'); reload();
    } catch (ex) { toast(ex.message, 'error'); }
  });
  main.querySelectorAll('[data-bp]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Blutdruckmessung löschen?'))) return;
    try { await api(`/api/bp?id=${b.dataset.bp}`, { method: 'DELETE' }); toast('Gelöscht', 'success'); reload(); } catch (ex) { toast(ex.message, 'error'); }
  }));

  const lf = document.getElementById('lab-form');
  const units = Object.fromEntries(latestPerTest.map(x => [x.name, x.last.unit || '']));
  const nameEl = lf.elements.namedItem('test_name'), unitEl = lf.elements.namedItem('unit');
  nameEl.addEventListener('change', () => { if (units[nameEl.value] != null) unitEl.value = units[nameEl.value]; });
  lf.addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(lf));
    try {
      await api('/api/labs', { method: body.id ? 'PUT' : 'POST', body });
      toast(body.id ? 'Blutwert geändert' : 'Blutwert gespeichert', 'success');
      labTest = body.test_name; try { localStorage.setItem('labTest', labTest); } catch {}
      reload();
    } catch (ex) { toast(ex.message, 'error'); }
  });
  main.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const l = h.labs.find(x => String(x.id) === b.dataset.edit);
    const el = n => lf.elements.namedItem(n);
    for (const k of ['id', 'entry_date', 'test_name', 'value', 'unit', 'note']) el(k).value = l[k] ?? '';
    el('value').value = String(l.value).replace('.', ',');
    lf.querySelector('[type=submit]').textContent = 'Änderung speichern';
    document.getElementById('l-cancel').classList.remove('hidden');
    lf.closest('details').open = true;
    lf.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  document.getElementById('l-cancel').addEventListener('click', reload);
  main.querySelectorAll('[data-lab]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Blutwert löschen?'))) return;
    try { await api(`/api/labs?id=${b.dataset.lab}`, { method: 'DELETE' }); toast('Gelöscht', 'success'); reload(); } catch (ex) { toast(ex.message, 'error'); }
  }));
});

function bpList(rows) {
  return `<div class="list" style="margin-top:8px">${rows.map(b => {
    const c = bpCategory(b.systolic, b.diastolic);
    return `<div class="list-item"><div class="meta"><b>${b.systolic}/${b.diastolic}${b.pulse ? ` · ${b.pulse} bpm` : ''} <em class="pill ${c.status}" style="font-size:.7rem;font-style:normal">${c.label}</em></b>
      <span>${fmtDate(b.entry_date, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}${b.reading_time ? ` · ${b.reading_time.slice(0, 5)}` : ''} · ${b.source === 'sync' ? 'Samsung Health' : 'manuell'}${b.note ? ` · ${esc(b.note)}` : ''}</span></div>
      <div class="actions"><button class="del" data-bp="${b.id}" aria-label="Löschen">${icon('trash')}</button></div></div>`;
  }).join('') || '<div class="empty-state">Noch keine Messungen.</div>'}</div>`;
}
