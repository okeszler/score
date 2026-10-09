import { addDays, activeStreak, BEER, isValidDate, MIN_ALCOHOL_FREE_DAYS, RISK_DAY_G, weekStart, weekStreak, weekSummary, daysBetween } from '../score.js';
import { animateIn, boot, countUp, fmt, fmtDate, icon, loadContext, shell } from '../app.js';

shell({ page: 'woche', title: 'Woche', subtitle: 'Grüne Tage, Streaks & Bier' });

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

boot(async main => {
  const ctx = await loadContext(400);
  const { today, goals, daysByDate, scores } = ctx;
  let monday = new URLSearchParams(location.search).get('w');
  monday = isValidDate(monday) ? weekStart(monday) : weekStart(today);
  if (monday > weekStart(today)) monday = weekStart(today);
  const isCurrent = monday === weekStart(today);
  const w = weekSummary(daysByDate, scores, goals, monday, today);
  const sunday = addDays(monday, 6);
  const daysLeft = isCurrent ? 7 - (daysBetween(monday, today) + 1) : 0;
  const greenPct = Math.min(100, (w.green / w.goalGreen) * 100);
  const alcPct = Math.min(100, (w.alcoholG / Math.max(1, w.alcoholBudgetG)) * 100);
  const afOk = w.alcoholFree >= MIN_ALCOHOL_FREE_DAYS;
  const afPossible = w.alcoholFree + daysLeft >= MIN_ALCOHOL_FREE_DAYS;

  main.innerHTML = `
  <div class="weekbar" data-reveal>
    <a class="icon-btn" href="/woche?w=${addDays(monday, -7)}" aria-label="Vorherige Woche">${icon('left')}</a>
    <b>${fmtDate(monday, { day: '2-digit', month: '2-digit' })} – ${fmtDate(sunday, { day: '2-digit', month: '2-digit', year: 'numeric' })}${isCurrent ? ' · aktuell' : ''}</b>
    ${isCurrent ? '<span class="icon-btn" style="visibility:hidden"></span>' : `<a class="icon-btn" href="/woche?w=${addDays(monday, 7)}" aria-label="Nächste Woche">${icon('right')}</a>`}
  </div>

  <a class="btn secondary block" href="/verlauf" data-reveal style="margin-bottom:16px">${icon('chart')} 13-Wochen-Verlauf & Zusammenhänge</a>

  <section class="card" data-reveal>
    <div class="week">${w.days.map((d, i) => `
      <a class="wday st-${d.score.status} ${d.date === today ? 'today' : ''} ${d.future ? 'future' : ''}"
         ${d.future ? '' : `href="/eintrag?date=${d.date}"`} title="${fmtDate(d.date)}: ${d.score.total ?? 'kein Eintrag'}">
        ${WD[i]}<b>${d.score.total ?? '–'}</b></a>`).join('')}</div>
    <div style="margin-top:18px">
      <div class="row" style="border:0;padding-top:0"><span>Grüne Tage</span><b><span id="g">0</span> von ${w.goalGreen} ${w.reached ? '✓' : ''}</b></div>
      <div class="progress ${w.reached ? '' : 'warn'}"><i data-w="${greenPct}"></i></div>
      <p class="muted" style="font-size:.85rem;margin:10px 0 0">${w.logged} von ${isCurrent ? 7 - daysLeft : 7} Tagen eingetragen${
        isCurrent && !w.reached ? ` · noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'}, ${Math.max(0, w.goalGreen - w.green)} grüne fehlen${w.goalGreen - w.green > daysLeft ? ' – diese Woche nicht mehr erreichbar' : ''}` : ''}</p>
    </div>
  </section>

  <div class="grid grid-2" style="margin-top:16px">
    <section class="card" data-reveal>
      <div class="card-title">Streaks & Schnitt</div>
      <div class="kv" style="margin-bottom:14px">
        <div><b id="s1">0</b><span>Aktiv-Streak (grüne Tage)</span></div>
        <div><b id="s2">0</b><span>Wochen-Streak</span></div>
      </div>
      <div class="rows">
        <div class="row"><span>Ø Score</span><b>${fmt(w.avgScore, 1)}</b></div>
        <div class="row"><span>Ø Schritte</span><b>${fmt(w.avgSteps)}</b></div>
        <div class="row"><span>Ø Kalorien</span><b>${w.avgKcal != null ? `${fmt(w.avgKcal)} kcal` : '–'}</b></div>
        <div class="row"><span>Ø Wasser</span><b class="${w.avgWater == null ? '' : w.avgWater >= goals.water_target ? 'good' : 'warn'}">${w.avgWater != null ? `${fmt(w.avgWater)} ml` : '–'}</b></div>
        <div class="row"><span>Trainings</span><b>${w.trainings}</b></div>
      </div>
    </section>

    <section class="card" data-reveal>
      <div class="card-title">Bierkonsum</div>
      <div class="stats">
        <div><b id="b1">0</b><span>Bier / ${w.beerBudget}</span></div>
        <div><b>${fmt(w.alcoholG)}</b><span>g Alkohol</span></div>
        <div><b>${fmt(w.beers * BEER.kcal)}</b><span>kcal</span></div>
      </div>
      <div class="rows">
        <div class="row" style="display:block">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Wochenalkohol</span>
            <b class="${alcPct >= 100 ? 'bad' : alcPct >= 75 ? 'warn' : 'good'}">${fmt(w.alcoholG)} g / ${fmt(w.alcoholBudgetG)} g</b></div>
          <div class="progress ${alcPct >= 100 ? 'bad' : alcPct >= 75 ? 'warn' : ''}"><i data-w="${alcPct}"></i></div>
        </div>
        <div class="row"><span>Alkoholfreie Tage</span>
          <b class="${afOk ? 'good' : afPossible ? 'warn' : 'bad'}">${w.alcoholFree} von min. ${MIN_ALCOHOL_FREE_DAYS}${!afOk && afPossible && isCurrent ? ' (noch möglich)' : ''}</b></div>
        <div class="row"><span>Risikotage (&gt; ${RISK_DAY_G} g)</span><b class="${w.riskDays ? 'bad' : 'good'}">${w.riskDays} ${w.riskDays === 1 ? 'Tag' : 'Tage'}</b></div>
      </div>
      <p class="muted" style="font-size:.78rem;margin:10px 0 0">Nur eingetragene Tage zählen. 1 Bier = 0,5 l, 5 % ≈ ${fmt(BEER.alcoholG, 1)} g Alkohol.</p>
    </section>
  </div>`;

  countUp(document.getElementById('g'), w.green, 0, 600);
  countUp(document.getElementById('b1'), w.beers, 0, 600);
  countUp(document.getElementById('s1'), activeStreak(scores, today), 0, 800);
  countUp(document.getElementById('s2'), weekStreak(daysByDate, scores, goals, today), 0, 800);
  animateIn(() => main.querySelectorAll('[data-w]').forEach(i => (i.style.width = `${i.dataset.w}%`)));
});
