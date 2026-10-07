import { addDays, beerDecision, daysBetween, effectiveSteps, hasEntry, weekStart, weekSummary, weightTrend, activeStreak, BEER } from '../score.js';
import { animateIn, api, boot, countUp, esc, fmt, fmtDate, fmtLong, icon, loadContext, modal, ring, shell, statusLabel, toast } from '../app.js';
import { lineChart, sparkline } from '../charts.js';

shell({ page: 'heute', title: 'Hallo Oliver', subtitle: 'Mein Weg zu 85 kg' });

boot(async main => {
  const ctx = await loadContext(35);
  const { today, goals, daysByDate, scores, lastWeight, firstWeight, synced } = ctx;
  const day = daysByDate[today];
  const sc = scores[today];
  const week = weekSummary(daysByDate, scores, goals, weekStart(today), today);

  // ---- Gewicht / Fortschritt ----
  const start = goals.start_weight_kg ?? firstWeight?.weight_kg ?? null;
  const cur = lastWeight?.weight_kg ?? null;
  const toGo = cur != null ? Math.max(0, cur - goals.weight_kg) : null;
  const progress = start != null && cur != null && start > goals.weight_kg
    ? Math.min(100, Math.max(0, ((start - cur) / (start - goals.weight_kg)) * 100)) : 0;
  const trend = weightTrend(ctx.weights, goals.weight_kg, today);
  const weightAge = lastWeight ? daysBetween(lastWeight.entry_date, today) : null;

  // ---- Schritte ----
  const stepsToday = day ? effectiveSteps(day) : synced[today] ?? null;
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const stepsSeries = last14.map(d => ({ x: d, y: daysByDate[d] ? effectiveSteps(daysByDate[d]) : synced[d] ?? null }));
  const kcalSeries = last14.map(d => daysByDate[d]?.calories_kcal ?? null);

  const beerPct = Math.min(100, (week.beers / Math.max(1, week.beerBudget)) * 100);
  const streak = activeStreak(scores, today);

  main.innerHTML = `
  <div class="grid grid-3">
    <section class="hero" data-reveal>
      <div class="hero-top">
        <div class="hero-eyebrow">${fmtLong(today)}</div>
        <div class="hero-value"><span id="hw">–</span><span class="unit">kg</span></div>
        <div class="hero-sub">${cur == null ? 'Noch keine Gewichtsmessung' :
          toGo > 0 ? `Noch <b>${fmt(toGo, 1)} kg</b> bis ${fmt(goals.weight_kg)} kg` : '<b>Ziel erreicht!</b> 🎉'}
          ${weightAge != null ? ` · gemessen ${weightAge === 0 ? 'heute' : weightAge === 1 ? 'gestern' : `vor ${weightAge} Tagen`}` : ''}</div>
        <div class="hero-badge"><b><span id="hp">0</span> %</b>geschafft</div>
      </div>
      <div class="hero-progress"><i id="hpb"></i></div>
      <div class="hero-cells">
        <div><b>${start != null ? fmt(start, 1) : '–'}<small>kg</small></b><span>Start</span></div>
        <div><b>${trend ? `${trend.perWeek > 0 ? '+' : ''}${fmt(trend.perWeek, 2)}` : '–'}<small>kg/Wo</small></b><span>Trend (6 Wo.)</span></div>
        <div><b>${trend?.eta ? fmtDate(trend.eta, { month: 'short', year: '2-digit' }) : '–'}</b><span>Prognose 85 kg</span></div>
      </div>
    </section>

    <section class="card" data-reveal>
      <div class="card-title">Score heute ${sc && sc.status !== 'none' ? `<span class="pill ${sc.status}">${statusLabel(sc.status)}</span>` : ''}</div>
      ${hasEntry(day) ? `
        <div class="big-score">
          ${ring(sc.total, sc.status)}
          <div class="parts">
            ${part('Bewegung', sc.parts.bewegung, 4)}
            ${part('Ernährung', sc.parts.ernaehrung, 3)}
            ${part('Alkohol', sc.parts.alkohol, 3)}
          </div>
        </div>
        <a class="btn secondary block" style="margin-top:16px" href="/eintrag?date=${today}">${icon('edit')} Eintrag bearbeiten</a>` : `
        <div class="empty-state">Für heute gibt es noch keinen Eintrag.<br>
          <a class="btn" href="/eintrag?date=${today}">${icon('plus')} Jetzt eintragen</a></div>`}
    </section>
  </div>

  ${weightAge != null && weightAge > 7 ? `<div class="card" data-reveal style="margin-top:16px;border-left:3px solid var(--warn)">
    Deine letzte Gewichtsmessung ist <b>${weightAge} Tage</b> alt. Wiegen und
    <button class="btn ghost" data-sync-inline style="padding:0">Health Sync</button> starten oder
    <a href="/gewicht" style="color:var(--accent)">manuell eintragen</a>.</div>` : ''}

  <div class="section-title">Auf einen Blick</div>
  <div class="tiles tiles-4" data-reveal>
    <a class="tile" href="/eintrag?date=${today}">
      <div class="tile-value"><span id="t-steps">–</span></div>
      <div class="tile-label">Schritte heute · Ziel ${fmt(goals.steps_target)}</div>
      <div class="tile-viz" id="sp-steps"></div>
    </a>
    <a class="tile" href="/eintrag?date=${today}">
      <div class="tile-value"><span id="t-kcal">–</span><span class="unit">kcal</span></div>
      <div class="tile-label">Kalorien heute · Ziel ≤ ${fmt(goals.kcal_target)}</div>
      <div class="tile-viz" id="sp-kcal"></div>
    </a>
    <a class="tile" href="/woche">
      <div class="tile-value"><span id="t-beer">0</span><span class="unit">/ ${fmt(week.beerBudget)} Bier</span></div>
      <div class="tile-label">diese Woche · ${week.beerLeft >= 0 ? `${week.beerLeft} übrig` : `${-week.beerLeft} drüber`}</div>
      <div class="tile-viz" style="display:flex;align-items:flex-end"><div class="progress ${beerPct >= 100 ? 'bad' : beerPct >= 75 ? 'warn' : ''}" style="width:100%"><i data-w="${beerPct}"></i></div></div>
    </a>
    <a class="tile" href="/woche">
      <div class="tile-value"><span id="t-green">0</span><span class="unit">/ ${week.goalGreen} grün</span></div>
      <div class="tile-label">Wochenziel · Streak ${streak} ${streak === 1 ? 'Tag' : 'Tage'}</div>
      <div class="tile-viz"><div class="week" style="gap:4px">${week.days.map(d =>
        `<i class="st-${d.score.status}" style="height:8px;border-radius:4px;background:var(--st);opacity:${d.future ? 0.35 : 1}"></i>`).join('')}</div></div>
    </a>
  </div>

  <div class="grid grid-2" style="margin-top:16px">
    <section class="card" data-reveal>
      <div class="card-title">Bewegung · 14 Tage <a href="/verlauf">Verlauf</a></div>
      <div id="ch-steps"></div>
      <div class="legend"><span><i class="line" style="background:var(--blue)"></i>Schritte</span><span><i class="dash"></i>Ziel ${fmt(goals.steps_target)}</span></div>
    </section>
    <section class="card" data-reveal>
      <div class="card-title"><span>Noch ein Bier?</span>${icon('beer', '').replace('<svg', '<svg style="width:20px;height:20px;color:var(--accent)"')}</div>
      <p class="muted" style="margin:0 0 14px">Bevor du bestellst: Was kostet dich das nächste Bier – Wochenbudget, Score und Kalorien?</p>
      <button class="btn block" id="beer-btn">Entscheidungsrechner öffnen</button>
    </section>
  </div>`;

  countUp(document.getElementById('hw'), cur, 1);
  countUp(document.getElementById('hp'), Math.round(progress));
  countUp(document.getElementById('t-steps'), stepsToday);
  countUp(document.getElementById('t-kcal'), day?.calories_kcal ?? null);
  countUp(document.getElementById('t-beer'), week.beers, 0, 600);
  countUp(document.getElementById('t-green'), week.green, 0, 600);
  animateIn(() => {
    document.getElementById('hpb').style.width = `${progress}%`;
    main.querySelectorAll('[data-w]').forEach(i => (i.style.width = `${i.dataset.w}%`));
  });
  sparkline(document.getElementById('sp-steps'), stepsSeries.map(p => p.y), 'var(--blue)', { area: true });
  sparkline(document.getElementById('sp-kcal'), kcalSeries, 'var(--accent)');
  lineChart(document.getElementById('ch-steps'), {
    series: [{ name: 'Schritte', color: 'var(--blue)', points: stepsSeries, area: true, dots: true }],
    goal: { y: goals.steps_target, label: 'Ziel' }, height: 190, decimals: 0, yMin: 0,
    xFrom: last14[0], xTo: today, label: 'Schritte der letzten 14 Tage', empty: 'Noch keine Schritte – Health Sync starten',
  });

  main.querySelector('[data-sync-inline]')?.addEventListener('click', () => document.querySelector('[data-sync]').click());
  document.getElementById('beer-btn').addEventListener('click', () => openBeer(ctx));
});

function part(name, v, max) {
  return `<div class="part"><span>${name}</span><div class="bar"><i data-w="${(v / max) * 100}"></i></div><b>${v}/${max}</b></div>`;
}

function openBeer(ctx) {
  const r = beerDecision(ctx.daysByDate, ctx.goals, ctx.today);
  const title = { ok: 'Vertretbar', meh: 'Grenzwertig', no: 'Lieber nicht' }[r.verdict];
  modal(`
    <h2>Noch ein Bier?</h2>
    <div class="verdict ${r.verdict}"><b>${title}</b>
      ${r.reasons.length ? `<ul>${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : 'Budget und Score bleiben im grünen Bereich.'}</div>
    <div class="rows">
      <div class="row"><span>Heute bisher</span><b>${r.todayBeers} Bier</b></div>
      <div class="row"><span>Woche danach</span><b class="${r.weekAfter > r.budget ? 'bad' : 'good'}">${r.weekAfter} / ${r.budget}</b></div>
      <div class="row"><span>Score heute</span><b>${r.scoreNow ?? '–'} → ${r.scoreNext}</b></div>
      <div class="row"><span>Alkohol heute danach</span><b class="${r.alcoholTodayG > 24 ? 'bad' : ''}">${fmt(r.alcoholTodayG)} g</b></div>
      <div class="row"><span>Zusätzliche Kalorien</span><b>+${r.kcal} kcal</b></div>
      <div class="row"><span>Zum Abtrainieren</span><b>≈ ${fmt(r.stepsToBurn)} Schritte</b></div>
    </div>
    <p class="muted" style="font-size:.8rem">Annahme: 0,5 l, 5 % vol. ≈ ${fmt(BEER.alcoholG, 1)} g Alkohol, ${BEER.kcal} kcal.</p>
    <div class="btn-row"><button class="btn secondary" data-close style="flex:1">Lieber Wasser</button>
      <button class="btn" data-add style="flex:1">+1 Bier eintragen</button></div>`, {
    onOpen: (m, close) => m.querySelector('[data-add]').addEventListener('click', async e => {
      e.target.disabled = true;
      try {
        await api(`/api/days/${ctx.today}`, { method: 'PATCH', body: { beer_delta: 1 } });
        toast('Bier eingetragen. Prost – mit Maß!', 'success');
        close();
        document.dispatchEvent(new CustomEvent('datachange'));
      } catch (ex) { toast(ex.message, 'error'); e.target.disabled = false; }
    }),
  });
}
