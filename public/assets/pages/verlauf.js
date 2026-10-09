import { addDays, effectiveSteps, isConfirmed, parseDate, statusFor, weekStart, weekSummary } from '../score.js';
import { boot, fmt, fmtDate, loadContext, shell, statusLabel } from '../app.js';
import { barChart, lineChart } from '../charts.js';

shell({ page: 'verlauf', title: 'Verlauf', subtitle: '90 Tage & Zusammenhänge' });

const WEEKS = 13; // 13 Wochen ≈ 90 Tage, als Kalender (Spalten = Wochen)

boot(async main => {
  const ctx = await loadContext(WEEKS * 7 + 7);
  const { today, goals, daysByDate, scores, weights } = ctx;
  const firstMonday = addDays(weekStart(today), -(WEEKS - 1) * 7);

  // ---- Heatmap ----
  const cells = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(firstMonday, i);
    const s = scores[d];
    const st = s?.status ?? 'none';
    const future = d > today;
    const title = future ? '' : `${fmtDate(d)}: ${st === 'none' ? 'kein Eintrag' : `Score ${s.total} (${statusLabel(st)}${s.provisional ? ', vorläufig' : ''})`}`;
    cells.push(`<a class="heat-cell st-${st} ${st === 'none' ? 'empty' : ''} ${s?.provisional ? 'prov' : ''} ${future ? 'future' : ''} ${d === today ? 'today' : ''}"
      ${future ? 'tabindex="-1"' : `href="/eintrag?date=${d}"`} title="${title}" aria-label="${title}" style="animation-delay:${i * 6}ms"></a>`);
  }
  const counted = Object.entries(scores).filter(([d, s]) => d >= firstMonday && s.status !== 'none');
  const cnt = st => counted.filter(([, s]) => s.status === st).length;

  // ---- Wochen ----
  const weeks = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const mon = addDays(weekStart(today), -i * 7);
    const w = weekSummary(daysByDate, scores, goals, mon, today);
    const wWeights = weights.filter(x => x.weight_kg != null && x.entry_date >= mon && x.entry_date <= addDays(mon, 6));
    const avgW = wWeights.length ? wWeights.reduce((s, x) => s + x.weight_kg, 0) / wWeights.length : null;
    weeks.push({ mon, w, avgW });
  }

  // ---- Zusammenhänge: Was passiert am Tag NACH Bier? ----
  const after = { beer: [], none: [] };
  for (const d of Object.keys(daysByDate)) {
    const prev = daysByDate[addDays(d, -1)];
    const cur = daysByDate[d];
    if (!isConfirmed(prev) || !isConfirmed(cur)) continue; // nur bestätigte Tage (Bier bekannt)
    const st = effectiveSteps(cur);
    (prev.beer_count > 0 ? after.beer : after.none).push({ steps: st, score: scores[d].total, tracked: cur.calories_kcal != null });
  }
  const avg = (arr, k) => { const v = arr.map(x => x[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const rate = arr => (arr.length ? (arr.filter(x => x.tracked).length / arr.length) * 100 : null);
  const budgetWeeks = weeks.filter(x => x.w.logged > 0);
  const budgetOk = budgetWeeks.filter(x => x.w.beers <= x.w.beerBudget).length;

  main.innerHTML = `
  <section class="card" data-reveal>
    <div class="card-title">Letzte ${WEEKS} Wochen <span class="muted" style="text-transform:none;letter-spacing:0">${counted.length} Tage eingetragen</span></div>
    <div class="heat">
      <div class="heat-days">${['Mo', '', 'Mi', '', 'Fr', '', 'So'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="heat-grid">${cells.join('')}</div>
    </div>
    <div class="legend">
      <span><i class="st-green"></i>Grün (${cnt('green')})</span>
      <span><i class="st-orange"></i>Orange (${cnt('orange')})</span>
      <span><i class="st-red"></i>Rot (${cnt('red')})</span>
      <span><i class="st-green" style="opacity:.45;outline:1.5px dashed var(--ink-2);outline-offset:-1.5px"></i>Vorläufig</span>
      <span><i style="background:var(--surface-2);outline:1px dashed var(--line)"></i>Kein Eintrag</span>
    </div>
  </section>

  <div class="grid grid-2" style="margin-top:16px">
    <section class="card" data-reveal>
      <div class="card-title">Ø Wochenscore</div>
      <div id="ch-score"></div>
      <div class="legend"><span><i class="st-green"></i>≥ 7</span><span><i class="st-orange"></i>≥ 4</span><span><i class="st-red"></i>&lt; 4</span></div>
    </section>
    <section class="card" data-reveal>
      <div class="card-title">Ø Wochengewicht</div>
      <div id="ch-weight"></div>
      <div class="legend"><span><i class="line" style="background:var(--accent)"></i>Ø kg pro Woche</span><span><i class="dash"></i>Ziel ${fmt(goals.weight_kg)} kg</span></div>
    </section>
  </div>

  <section class="card" data-reveal style="margin-top:16px">
    <div class="card-title">Zusammenhänge</div>
    <div class="rows">
      <div class="row"><span>Ø Schritte am Tag nach Bier</span><b>${fmt(avg(after.beer, 'steps'))} <small class="muted">vs. ${fmt(avg(after.none, 'steps'))} ohne</small></b></div>
      <div class="row"><span>Ø Score am Tag nach Bier</span><b>${fmt(avg(after.beer, 'score'), 1)} <small class="muted">vs. ${fmt(avg(after.none, 'score'), 1)} ohne</small></b></div>
      <div class="row"><span>Kalorien getrackt am Tag nach Bier</span><b>${fmt(rate(after.beer))} % <small class="muted">vs. ${fmt(rate(after.none))} % ohne</small></b></div>
      <div class="row"><span>Wochen im Bierbudget</span><b>${budgetOk} von ${budgetWeeks.length}</b></div>
    </div>
    <p class="muted" style="font-size:.78rem;margin:10px 0 0">Basis: ${after.beer.length} Tage nach Bier, ${after.none.length} Tage ohne. Aussagekräftig erst ab ca. 10 Tagen je Gruppe.</p>
  </section>`;

  const label = mon => parseDate(mon).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  barChart(document.getElementById('ch-score'), {
    bars: weeks.map(({ mon, w }) => ({
      label: label(mon), value: w.avgScore, status: statusFor(w.avgScore == null ? null : Math.round(w.avgScore)),
      tip: `<span>KW ab ${label(mon)}</span><br><b>Ø ${fmt(w.avgScore, 1)}</b> · ${w.green}/${w.goalGreen} grün · ${w.beers} Bier`,
    })),
    max: 10, goal: 7, height: 200, label: 'Durchschnittlicher Score je Woche',
  });
  lineChart(document.getElementById('ch-weight'), {
    series: [{ name: 'Ø Gewicht', color: 'var(--accent)', points: weeks.filter(x => x.avgW != null).map(x => ({ x: x.mon, y: x.avgW })), dots: true }],
    goal: { y: goals.weight_kg, label: '' }, height: 200, unit: 'kg', xFrom: weeks[0].mon, xTo: weeks[weeks.length - 1].mon,
    label: 'Durchschnittsgewicht je Woche', empty: 'Keine Gewichtsdaten in diesem Zeitraum',
  });
});
