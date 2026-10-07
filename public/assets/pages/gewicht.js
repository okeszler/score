import { addDays, daysBetween, weightTrend, KCAL_PER_KG_FAT } from '../score.js';
import { api, boot, confirmDialog, countUp, fmt, fmtDate, fmtLong, icon, loadContext, shell, toast } from '../app.js';
import { lineChart } from '../charts.js';

shell({ page: 'gewicht', title: 'Gewicht', subtitle: 'Verlauf, Trend & Prognose' });

let range = 90;
try { range = Number(localStorage.getItem('weightRange')) || 90; } catch {}

boot(async main => {
  const ctx = await loadContext(7);
  const { today, goals, weights, lastWeight, firstWeight, lastFat } = ctx;
  const ws = weights.filter(w => w.weight_kg != null);
  const fats = weights.filter(w => w.body_fat_pct != null);
  const start = goals.start_weight_kg ?? firstWeight?.weight_kg ?? null;
  const min = ws.length ? Math.min(...ws.map(w => w.weight_kg)) : null;
  const trend = weightTrend(weights, goals.weight_kg, today);
  const toGo = lastWeight ? lastWeight.weight_kg - goals.weight_kg : null;

  // Szenarien: bei welchem Tempo wann am Ziel?
  const scen = toGo > 0 ? [0.25, 0.5, 0.75].map(r => ({
    rate: r, date: addDays(today, Math.ceil((toGo / r) * 7)), deficit: Math.round((r * KCAL_PER_KG_FAT) / 7),
  })) : [];

  main.innerHTML = `
  <section class="hero" data-reveal>
    <div class="hero-top">
      <div class="hero-eyebrow">${lastWeight ? fmtLong(lastWeight.entry_date) : 'Noch keine Messung'}</div>
      <div class="hero-value"><span id="w">–</span><span class="unit">kg</span></div>
      <div class="hero-sub">Körpergewicht${toGo != null ? ` · ${toGo > 0 ? `noch <b>${fmt(toGo, 1)} kg</b> bis ${fmt(goals.weight_kg)} kg` : '<b>Ziel erreicht</b>'}` : ''}</div>
    </div>
    <div class="hero-range" role="group" aria-label="Zeitraum">
      ${[[30, '30 T'], [90, '90 T'], [0, 'Alles']].map(([v, l]) => `<button class="pill" data-range="${v}" aria-pressed="${range === v}">${l}</button>`).join('')}
    </div>
    <div style="padding:0 10px 6px" id="ch-w"></div>
    <div class="hero-cells">
      <div><b>${start != null ? fmt(start, 1) : '–'}<small>kg</small></b><span>Start</span></div>
      <div><b>${min != null ? fmt(min, 1) : '–'}<small>kg</small></b><span>Tiefstwert</span></div>
      <div><b>${lastFat ? fmt(lastFat.body_fat_pct, 1) : '–'}<small>%</small></b><span>Körperfett</span></div>
    </div>
  </section>

  <div class="grid grid-2" style="margin-top:16px">
    <section class="card" data-reveal>
      <div class="card-title">Trend & Prognose</div>
      ${trend ? `<div class="kv" style="margin-bottom:12px">
          <div><b>${trend.perWeek > 0 ? '+' : ''}${fmt(trend.perWeek, 2)}</b><span>kg pro Woche (6 Wo.)</span></div>
          <div><b>${trend.eta ? fmtDate(trend.eta, { day: '2-digit', month: 'short', year: 'numeric' }) : '–'}</b><span>${trend.eta ? 'Ziel bei aktuellem Tempo' : 'Trend zeigt nicht Richtung Ziel'}</span></div>
        </div>` : `<p class="muted" style="margin-top:0">Für einen Trend braucht es mind. 2 Messungen über 7+ Tage in den letzten 6 Wochen.${lastWeight && daysBetween(lastWeight.entry_date, today) > 14 ? ' Letzte Messung ist schon älter – am besten 2–3× pro Woche morgens wiegen.' : ''}</p>`}
      ${scen.length ? `<div class="rows">${scen.map(s => `<div class="row"><span>${fmt(s.rate, 2)} kg/Woche <small class="muted">(≈ ${s.deficit} kcal Defizit/Tag)</small></span><b>${fmtDate(s.date, { month: 'short', year: 'numeric' })}</b></div>`).join('')}</div>` : ''}
    </section>

    <section class="card" data-reveal>
      <div class="card-title">Messung erfassen</div>
      <form class="form" id="f" novalidate>
        <div class="form-grid">
          <div class="field"><label for="d">Datum</label><input id="d" type="date" name="date" value="${today}" max="${today}" required></div>
          <div class="field"><label for="kg">Gewicht</label><div class="input-wrap"><input id="kg" name="weight_kg" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="${lastWeight ? fmt(lastWeight.weight_kg, 1) : ''}"><span class="suffix">kg</span></div></div>
          <div class="field"><label for="bf">Körperfett</label><div class="input-wrap"><input id="bf" name="body_fat_pct" type="number" inputmode="decimal" step="0.1" min="2" max="70"><span class="suffix">%</span></div></div>
        </div>
        <button class="btn block" type="submit">Speichern</button>
      </form>
    </section>
  </div>

  <div class="grid grid-2" style="margin-top:16px">
    <section class="card" data-reveal>
      <div class="card-title">Körperfett</div>
      <div id="ch-f"></div>
    </section>
    <section class="card" data-reveal>
      <div class="card-title">Messungen</div>
      <div class="list" id="list"></div>
    </section>
  </div>`;

  countUp(document.getElementById('w'), lastWeight?.weight_kg ?? null, 1);

  const from = range ? addDays(today, -range) : null;
  const inRange = arr => (from ? arr.filter(w => w.entry_date >= from) : arr);
  const wPts = inRange(ws);
  lineChart(document.getElementById('ch-w'), {
    series: [{ name: 'Gewicht', color: 'var(--accent)', points: wPts.map(w => ({ x: w.entry_date, y: w.weight_kg })), area: true, dots: true, areaOpacity: 0.35 }],
    goal: { y: goals.weight_kg, label: `Ziel ${fmt(goals.weight_kg)} kg` }, height: 230, unit: 'kg', tickDecimals: 0,
    label: 'Gewichtsverlauf', empty: `Keine Messungen ${range ? `in den letzten ${range} Tagen` : ''}`,
  });
  lineChart(document.getElementById('ch-f'), {
    series: [{ name: 'Körperfett', color: 'var(--blue)', points: inRange(fats).map(w => ({ x: w.entry_date, y: w.body_fat_pct })), area: true, dots: true }],
    goal: { y: goals.body_fat_pct, label: `Ziel ${fmt(goals.body_fat_pct)} %` }, height: 190, unit: '%', label: 'Körperfettverlauf',
  });

  main.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    range = Number(b.dataset.range);
    try { localStorage.setItem('weightRange', range); } catch {}
    document.dispatchEvent(new CustomEvent('datachange'));
  }));

  const list = document.getElementById('list');
  const rows = [...weights].reverse().slice(0, 15);
  list.innerHTML = rows.length ? rows.map(w => `
    <div class="list-item">
      <div class="meta"><b>${w.weight_kg != null ? `${fmt(w.weight_kg, 1)} kg` : '–'}${w.body_fat_pct != null ? ` · ${fmt(w.body_fat_pct, 1)} %` : ''}</b>
        <span>${fmtDate(w.entry_date, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} · ${w.source === 'sync' ? 'Health Sync' : 'manuell'}</span></div>
      <div class="actions"><button class="del" data-del="${w.entry_date}" aria-label="Löschen">${icon('trash')}</button></div>
    </div>`).join('') : '<div class="empty-state">Noch keine Messungen.</div>';
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog(`Messung vom ${fmtDate(b.dataset.del)} löschen?`))) return;
    try {
      await api(`/api/weight/${b.dataset.del}`, { method: 'DELETE' });
      toast('Messung gelöscht', 'success');
      document.dispatchEvent(new CustomEvent('datachange'));
    } catch (ex) { toast(ex.message, 'error'); }
  }));

  const f = document.getElementById('f');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!f.weight_kg.value && !f.body_fat_pct.value) { f.weight_kg.setAttribute('aria-invalid', 'true'); f.weight_kg.focus(); return toast('Gewicht oder Körperfett angeben', 'error'); }
    if (![...f.elements].every(i => !i.checkValidity || i.checkValidity())) return toast('Bitte Eingaben prüfen', 'error');
    try {
      await api(`/api/weight/${f.date.value}`, { method: 'PUT', body: { weight_kg: f.weight_kg.value, body_fat_pct: f.body_fat_pct.value } });
      toast('Messung gespeichert', 'success');
      document.dispatchEvent(new CustomEvent('datachange'));
    } catch (ex) { toast(ex.message, 'error'); }
  });
});
