import { addDays, beerDecision, daysBetween, effectiveFluid, effectiveKcal, effectiveProtein, effectiveSteps, BEER_FLUID_ML, isConfirmed, weekStart, weekSummary, weightTrend, activeStreak, BEER } from '../score.js';
import { animateIn, api, boot, countUp, esc, fmt, fmtDate, fmtLong, icon, loadContext, modal, ring, shell, statusLabel, toast, today as todayIso } from '../app.js';
import { lineChart, miniBars, sparkline } from '../charts.js';
import { bpCategory } from '../health.js';
import { applyOrder, grip, makeSortable } from '../sortable.js';

shell({ page: 'heute', title: 'Hallo Oliver', subtitle: 'Mein Weg zu 85 kg' });

// Schnelltasten am App-Symbol (manifest.webmanifest → shortcuts): /?quick=bier | /?quick=wasser
const QUICK = {
  bier: { body: { beer_delta: 1 }, msg: '+1 Bier eingetragen' },
  wasser: { body: { water_delta: 250 }, msg: '+250 ml Wasser eingetragen' },
};
const quick = QUICK[new URLSearchParams(location.search).get('quick')];
if (quick) history.replaceState(null, '', '/'); // Neuladen trägt nicht doppelt ein
const quickDone = quick && api(`/api/days/${todayIso()}`, { method: 'PATCH', body: quick.body })
  .then(() => toast(quick.msg, 'success'), ex => toast(ex.message, 'error'));

boot(async main => {
  await quickDone;
  const [ctx, health, settingsRes] = await Promise.all([
    loadContext(35),
    api(`/api/health?from=${addDays(todayIso(), -30)}`).catch(() => null),
    api('/api/settings').catch(() => ({})),
  ]);
  const settings = settingsRes.settings || {};
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
  const kcalOf = d => (daysByDate[d] ? effectiveKcal(daysByDate[d]) : ctx.food[d]?.kcal ?? null);
  const kcalSeries = last14.map(kcalOf);
  const kcalToday = kcalOf(today);
  const water = effectiveFluid(day) ?? 0;
  const beerFluid = (day?.beer_count || 0) * BEER_FLUID_ML;
  const waterPct = Math.min(100, (water / goals.water_target) * 100);

  const beerPct = Math.min(100, (week.beers / Math.max(1, week.beerBudget)) * 100);
  const streak = activeStreak(scores, today);

  // Offene Tage (Bier unbestätigt) der letzten 4 Wochen, ohne heute – neueste zuerst
  const openDays = Array.from({ length: 28 }, (_, i) => addDays(today, -1 - i))
    .filter(d => daysByDate[d] && !isConfirmed(daysByDate[d]));
  const review = weeklyReview(ctx);

  main.innerHTML = `
  <div class="pinned">
  ${weightAge != null && weightAge > 7 ? `
    <div class="card notice warn" data-reveal>${icon('scale')}
      <div>Deine letzte Gewichtsmessung ist <b>${weightAge} Tage</b> alt. Wiegen und
      <button class="btn ghost" data-sync-inline style="padding:0">Health Sync</button> starten oder
      <a href="/gewicht" style="color:var(--accent)">manuell eintragen</a>.</div></div>` : ''}
  ${openDays.length ? `
    <div class="card notice open-days" data-reveal>${icon('beer')}
      <div><b>${openDays.length} ${openDays.length === 1 ? 'Tag' : 'Tage'} offen</b> – Bier noch nicht bestätigt, ${openDays.length === 1 ? 'zählt' : 'zählen'} deshalb nicht fürs Wochenziel.</div>
      <button class="btn" id="fill-open">Nachtragen</button></div>` : ''}
  ${settingsRes.pinShort ? `
    <div class="card notice warn" data-reveal>${icon('settings')}
      <div>Deine PIN ist kurz. Bitte in den <a href="/einstellungen#pin" style="color:var(--accent)">Einstellungen</a> eine neue mit mind. 6 Ziffern festlegen.</div></div>` : ''}
  ${review ? reviewCard(review) : ''}
  </div>
  <div class="board" data-sort="home">
  <div class="blk" data-id="hero" data-span="1" data-reveal>${grip("grip-top")}
    <section class="hero">
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
        <div><b>${trend?.eta ? fmtDate(trend.eta, { month: '2-digit', year: 'numeric' }) : '–'}</b><span>Prognose ${fmt(goals.weight_kg)} kg</span></div>
      </div>
    </section>
  </div>
  <div class="blk" data-id="score" data-span="1" data-reveal>${grip("grip-top")}
    <section class="card">
      <div class="card-title">Score heute
        <span style="display:flex;gap:6px;flex-wrap:nowrap">${sc.provisional ? '<span class="pill">Vorläufig</span>' : ''}<span class="pill ${sc.status}">${statusLabel(sc.status)}</span></span></div>
      <div class="big-score">
        ${ring(sc.total, sc.status)}
        <div class="parts">
          ${part('Bewegung', sc.parts.bewegung, 4)}
          ${part('Ernährung', sc.parts.ernaehrung, 3)}
          ${part('Alkohol', sc.parts.alkohol, 3)}
        </div>
      </div>
      ${sc.provisional ? `
        <p class="muted" style="font-size:.85rem;margin:14px 0 0">Aus importierten Daten berechnet${stepsToday != null ? ` (${fmt(stepsToday)} Schritte${kcalToday != null ? `, ${fmt(kcalToday)} kcal` : ''})` : ''}.
          Annahme: <b>0 Bier, kein Training</b> – bitte bestätigen.</p>
        <div class="btn-row" style="margin-top:12px">
          <a class="btn" style="flex:2" href="/eintrag?date=${today}">${icon('plus')} Daten ergänzen</a>
          <button class="btn secondary" style="flex:1" id="confirm-day" title="Kein Bier, kein Training – Tag so bestätigen">Passt so ✓</button>
        </div>` : `
        <a class="btn secondary block" style="margin-top:16px" href="/eintrag?date=${today}">${icon('edit')} Daten ergänzen</a>`}
    </section>
  </div>
  <div class="blk" data-id="glance" data-span="2" data-reveal>${grip("grip-top")}
    <div class="section-title" style="margin-top:0">Auf einen Blick</div>
  <div class="tiles tiles-4" data-sort="glance">
    <a class="tile" data-id="steps" href="/eintrag?date=${today}">${grip("grip-tile")}
      <div class="tile-value"><span id="t-steps">–</span></div>
      <div class="tile-label">Schritte heute · Ziel ${fmt(goals.steps_target)}</div>
      <div class="tile-viz" id="sp-steps"></div>
    </a>
    <a class="tile" data-id="kcal" href="/eintrag?date=${today}">${grip("grip-tile")}
      <div class="tile-value"><span id="t-kcal">–</span><span class="unit">kcal</span></div>
      <div class="tile-label">Kalorien heute · Ziel ≤ ${fmt(goals.kcal_target)}</div>
      <div class="tile-viz" id="sp-kcal"></div>
    </a>
    <a class="tile" data-id="beer" href="/woche">${grip("grip-tile")}
      <div class="tile-value"><span id="t-beer">0</span><span class="unit">/ ${fmt(week.beerBudget)} Bier</span></div>
      <div class="tile-label">diese Woche · ${week.beerLeft >= 0 ? `${week.beerLeft} übrig` : `${-week.beerLeft} drüber`}</div>
      <div class="tile-viz" style="display:flex;align-items:flex-end"><div class="progress ${beerPct >= 100 ? 'bad' : beerPct >= 75 ? 'warn' : ''}" style="width:100%"><i data-w="${beerPct}"></i></div></div>
    </a>
    <a class="tile" data-id="green" href="/woche">${grip("grip-tile")}
      <div class="tile-value"><span id="t-green">0</span><span class="unit">/ ${week.goalGreen} grün</span></div>
      <div class="tile-label">Wochenziel · Streak ${streak} ${streak === 1 ? 'Tag' : 'Tage'}</div>
      <div class="tile-viz"><div class="week" style="gap:4px">${week.days.map(d =>
        `<i class="st-${d.score.status}" style="height:8px;border-radius:4px;background:var(--st);opacity:${d.future ? 0.35 : 1}"></i>`).join('')}</div></div>
    </a>
  </div>
  </div>
  ${health ? healthRow(health) : ''}
  <div class="blk" data-id="steps" data-span="1" data-reveal>${grip("grip-top")}
    <section class="card">
      <div class="card-title">Bewegung · 14 Tage <a href="/verlauf">Verlauf</a></div>
      <div id="ch-steps"></div>
      <div class="legend"><span><i class="line" style="background:var(--blue)"></i>Schritte</span><span><i class="dash"></i>Ziel ${fmt(goals.steps_target)}</span></div>
    </section>
  </div>
  <div class="blk" data-id="water" data-span="1" data-reveal>${grip("grip-top")}
    <section class="card">
      <div class="card-title"><span>Trinken heute</span><b style="text-transform:none;letter-spacing:0;color:var(--ink)"><span id="t-water">0</span> / ${fmt(goals.water_target)} ml</b></div>
      <div class="progress ${waterPct >= 100 ? '' : 'warn'}" style="height:10px"><i data-w="${waterPct}" style="background:var(--blue)"></i></div>
      <p class="muted" style="margin:10px 0 14px;font-size:.85rem">${waterPct >= 100 ? 'Ziel erreicht – +1 Punkt im Score ✓' : `Noch ${fmt(Math.max(0, goals.water_target - water))} ml bis zum Ziel (+1 Punkt)`}${beerFluid ? `<br>inkl. ${fmt(beerFluid)} ml aus ${day.beer_count} Bier (zählt halb)` : ''}</p>
      <div class="btn-row">
        <button class="btn secondary" data-water="250" style="flex:1">+250 ml</button>
        <button class="btn secondary" data-water="500" style="flex:1">+500 ml</button>
        <button class="btn ghost" data-water="-250" aria-label="250 ml abziehen">−250</button>
      </div>
    </section>
  </div>
  <div class="blk" data-id="beer" data-span="1" data-reveal>${grip("grip-top")}
    <section class="card">
      <div class="card-title"><span>Noch ein Bier?</span>${icon('beer', '').replace('<svg', '<svg style="width:20px;height:20px;color:var(--accent)"')}</div>
      <p class="muted" style="margin:0 0 14px">Bevor du bestellst: Was kostet dich das nächste Bier – Wochenbudget, Score und Kalorien?</p>
      <button class="btn block" id="beer-btn">Entscheidungsrechner öffnen</button>
    </section>
  </div>
  </div>`;

  const pin = main.querySelector('.pinned');
  if (!pin.children.length) pin.remove();

  // Reihenfolge der Blöcke/Kacheln: gespeichert in app_settings, per Anfasser änderbar
  const SORTS = [['home', '.blk', 'order_home'], ['glance', '.tile', 'order_glance'], ['health', '.tile', 'order_health']];
  for (const [name, sel, key] of SORTS) {
    const box = main.querySelector(`[data-sort="${name}"]`);
    if (!box) continue;
    applyOrder(box, sel, settings[key]);
    makeSortable(box, {
      itemSelector: sel,
      onChange: order => {
        if (name === 'home') fillRows(box);
        api('/api/settings', { method: 'PUT', body: { key, value: order } })
          .catch(ex => toast(`Reihenfolge nicht gespeichert: ${ex.message}`, 'error'));
      },
    });
    if (name === 'home') fillRows(box);
  }

  countUp(document.getElementById('hw'), cur, 1);
  countUp(document.getElementById('hp'), Math.round(progress));
  countUp(document.getElementById('t-steps'), stepsToday);
  countUp(document.getElementById('t-kcal'), kcalToday);
  countUp(document.getElementById('t-beer'), week.beers, 0, 600);
  countUp(document.getElementById('t-green'), week.green, 0, 600);
  animateIn(() => {
    document.getElementById('hpb').style.width = `${progress}%`;
    main.querySelectorAll('[data-w]').forEach(i => (i.style.width = `${i.dataset.w}%`));
  });
  sparkline(document.getElementById('sp-steps'), stepsSeries.map(p => p.y), 'var(--blue)', { area: true });
  miniBars(document.getElementById('sp-kcal'), kcalSeries, { max: goals.kcal_target, color: 'var(--good)' });
  lineChart(document.getElementById('ch-steps'), {
    series: [{ name: 'Schritte', color: 'var(--blue)', points: stepsSeries, area: true, dots: true }],
    goal: { y: goals.steps_target }, height: 190, decimals: 0, yMin: 0,
    xFrom: last14[0], xTo: today, label: 'Schritte der letzten 14 Tage', empty: 'Noch keine Schritte – Health Sync starten',
  });

  document.getElementById('fill-open')?.addEventListener('click', () => openFillDays(ctx, openDays));
  main.querySelector('[data-review-close]')?.addEventListener('click', e => {
    try { localStorage.setItem('review-dismissed', review.monday); } catch {}
    e.target.closest('.review').remove();
  });
  main.querySelector('[data-sync-inline]')?.addEventListener('click', () => document.querySelector('[data-sync]').click());
  document.getElementById('beer-btn').addEventListener('click', () => openBeer(ctx));
  document.getElementById('confirm-day')?.addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      // legt den Tageseintrag mit 0 Bier an -> Score ist bestätigt
      await api(`/api/days/${today}`, { method: 'PATCH', body: { beer_delta: 0 } });
      toast('Tag bestätigt', 'success');
      document.dispatchEvent(new CustomEvent('datachange'));
    } catch (ex) { toast(ex.message, 'error'); e.target.disabled = false; }
  });
  countUp(document.getElementById('t-water'), water, 0, 600);
  main.querySelectorAll('[data-water]').forEach(b => b.addEventListener('click', async () => {
    main.querySelectorAll('[data-water]').forEach(x => (x.disabled = true));
    try {
      await api(`/api/days/${today}`, { method: 'PATCH', body: { water_delta: Number(b.dataset.water) } });
      document.dispatchEvent(new CustomEvent('datachange'));
    } catch (ex) {
      toast(ex.message, 'error');
      main.querySelectorAll('[data-water]').forEach(x => (x.disabled = false));
    }
  }));
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

function healthRow(h) {
  const hm = s => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const rest = h.pulse.filter(p => p.resting != null).at(-1);
  const night = h.nights.at(-1);
  const bp = h.bloodPressure.at(-1);
  const cat = bp ? bpCategory(bp.systolic, bp.diastolic) : null;
  if (!rest && !night && !bp) return '';
  return `
  <div class="blk" data-id="health" data-span="2" data-reveal>${grip('grip-top')}
  <div class="section-title" style="margin-top:0">Gesundheit</div>
  <div class="tiles tiles-3" data-sort="health">
    <a class="tile" data-id="rest" href="/gesundheit#puls">${grip('grip-tile')}<div class="tile-value">${rest ? fmt(rest.resting, 0) : '–'}<span class="unit">bpm</span></div><div class="tile-label">Ruhepuls</div></a>
    <a class="tile" data-id="sleep" href="/gesundheit#schlaf">${grip('grip-tile')}<div class="tile-value">${night ? hm(night.asleepSeconds) : '–'}<span class="unit">h</span></div><div class="tile-label">Schlaf letzte Nacht</div></a>
    <a class="tile" data-id="bp" href="/gesundheit#bp">${grip('grip-tile')}<div class="tile-value">${bp ? `${bp.systolic}/${bp.diastolic}` : '–'}</div><div class="tile-label">${cat ? `<span class="pill ${cat.status}" style="font-size:.7rem;padding:2px 8px">${cat.label}</span>` : 'Blutdruck'}</div></a>
  </div>
  </div>`;
}

/** Desktop (2 Spalten): ein einzelner schmaler Block ohne Partner in seiner Zeile wird breit – keine Lücken. */
function fillRows(board) {
  const items = [...board.children].filter(b => b.matches('.blk')).sort((a, b) => (a.style.order || 0) - (b.style.order || 0));
  let col = 0, prev = null;
  for (const b of items) {
    b.classList.remove('fill');
    if (b.dataset.span === '2') {
      if (col === 1) prev.classList.add('fill');
      col = 0;
    } else {
      col = (col + 1) % 2;
      prev = b;
    }
  }
  if (col === 1 && prev) prev.classList.add('fill');
}

// ---------- Offene Tage nachtragen: ein Tag pro Karte, ein Tipp ----------
function openFillDays(ctx, dates) {
  let i = 0, saved = 0;
  const card = d => {
    const day = ctx.daysByDate[d];
    const st = effectiveSteps(day), kc = effectiveKcal(day), pr = effectiveProtein(day);
    const facts = [st != null ? `${fmt(st)} Schritte` : null, kc != null ? `${fmt(kc)} kcal` : null, pr != null ? `${fmt(pr)} g Protein` : null,
      day.water_ml ? `${fmt(day.water_ml)} ml Wasser` : null].filter(Boolean).join(' · ');
    return `
      <div class="fill-head"><span class="muted">${i + 1} von ${dates.length}</span><button class="btn ghost" data-close>Später</button></div>
      <h2 style="margin:6px 0 4px">${fmtLong(d)}</h2>
      <p class="muted" style="margin:0 0 18px">${facts || 'Keine importierten Daten'}</p>
      <div class="fill-q">Wie viel Bier?</div>
      <div class="fill-beers">${[0, 1, 2, 3, 4, 5].map(n => `<button class="btn ${n === 0 ? '' : 'secondary'}" data-beers="${n}">${n === 5 ? '5+' : n}</button>`).join('')}</div>
      <label class="toggle" style="margin-top:14px"><input type="checkbox" data-gym><span>Training</span></label>
      <button class="btn ghost block" data-skip style="margin-top:10px">Überspringen</button>`;
  };
  modal(card(dates[0]), {
    onOpen: (m, close) => {
      const next = () => {
        i++;
        if (i >= dates.length) { if (saved) toast(`${saved} ${saved === 1 ? 'Tag' : 'Tage'} bestätigt`, 'success'); close(); return; }
        m.innerHTML = card(dates[i]);
        m.querySelector('[data-beers="0"]').focus({ preventScroll: true });
      };
      m.addEventListener('click', async e => {
        const b = e.target.closest('[data-beers]');
        if (e.target.closest('[data-skip]')) return next();
        if (!b) return;
        m.querySelectorAll('button').forEach(x => (x.disabled = true));
        try {
          await api(`/api/days/${dates[i]}`, { method: 'PATCH', body: { beer_count: Number(b.dataset.beers), gym: m.querySelector('[data-gym]').checked } });
          saved++;
          next();
        } catch (ex) {
          toast(ex.message, 'error');
          m.querySelectorAll('button').forEach(x => (x.disabled = false));
        }
      });
    },
    onClose: () => { if (saved) document.dispatchEvent(new CustomEvent('datachange')); },
  });
}

// ---------- Wochenrückblick: Sonntag ab 17 Uhr (laufende Woche) und Montag (letzte Woche) ----------
function weeklyReview(ctx) {
  const { today, daysByDate, scores, goals, weights } = ctx;
  const dow = (new Date().getDay() + 6) % 7; // Mo=0
  let monday;
  if (dow === 6 && new Date().getHours() >= 17) monday = weekStart(today);
  else if (dow === 0) monday = addDays(weekStart(today), -7);
  else return null;
  try { if (localStorage.getItem('review-dismissed') === monday) return null; } catch {}
  const w = weekSummary(daysByDate, scores, goals, monday, today);
  const prev = weekSummary(daysByDate, scores, goals, addDays(monday, -7), today);
  const sunday = addDays(monday, 6);
  const inWeek = weights.filter(x => x.weight_kg != null && x.entry_date >= addDays(monday, -3) && x.entry_date <= sunday);
  const dW = inWeek.length >= 2 ? inWeek.at(-1).weight_kg - inWeek[0].weight_kg : null;
  const best = w.days.filter(d => d.score.total != null && !d.score.provisional).sort((a, b) => b.score.total - a.score.total)[0];
  return { monday, sunday, w, prev, dW, best, current: monday === weekStart(today) };
}

function reviewCard({ monday, sunday, w, prev, dW, best, current }) {
  const delta = (a, b, dec = 0, unit = '') => (a == null || b == null ? '' :
    `<small class="${a - b >= 0 ? 'good' : 'bad'}">${a - b >= 0 ? '+' : '−'}${fmt(Math.abs(a - b), dec)}${unit} ggü. Vorwoche</small>`);
  const headline = w.reached ? 'Wochenziel geschafft 🎉'
    : w.green + w.greenProvisional >= w.goalGreen ? 'Ziel in Reichweite – offene Tage bestätigen'
    : `${w.goalGreen - w.green} grüne ${w.goalGreen - w.green === 1 ? 'Tag fehlt' : 'Tage fehlen'}`;
  return `
  <section class="card review" data-reveal>
    <div class="card-title">${current ? 'Deine Woche' : 'Letzte Woche'} · ${fmtDate(monday, { day: '2-digit', month: '2-digit' })}–${fmtDate(sunday, { day: '2-digit', month: '2-digit' })}
      <button class="icon-btn" data-review-close aria-label="Rückblick ausblenden" style="width:32px;height:32px;border:0">×</button></div>
    <p style="margin:0 0 14px;font-weight:600">${headline}</p>
    <div class="review-grid">
      <div><b>${w.green}<small> / ${w.goalGreen}</small></b><span>grüne Tage${w.greenProvisional ? ` (+${w.greenProvisional} offen)` : ''}</span></div>
      <div><b>${w.avgScore != null ? fmt(w.avgScore, 1) : '–'}</b><span>Ø Score</span>${delta(w.avgScore, prev.avgScore, 1)}</div>
      <div><b>${w.avgSteps != null ? fmt(w.avgSteps) : '–'}</b><span>Ø Schritte</span>${delta(w.avgSteps, prev.avgSteps)}</div>
      <div><b class="${w.beers > w.beerBudget ? 'bad' : ''}">${w.beers}<small> / ${w.beerBudget}</small></b><span>Bier · ${w.alcoholFree} alkoholfrei</span></div>
      <div><b>${dW != null ? `${dW > 0 ? '+' : dW < 0 ? '−' : '±'}${fmt(Math.abs(dW), 1)}` : '–'}<small> kg</small></b><span>Gewicht</span></div>
      <div><b>${best ? best.score.total : '–'}</b><span>${best ? `bester Tag: ${fmtDate(best.date, { weekday: 'long' })}` : 'bester Tag'}</span></div>
    </div>
    <a class="btn secondary block" style="margin-top:14px" href="/woche?w=${monday}">Woche ansehen</a>
  </section>`;
}
