// Alkohol-Pause-Challenge: Karte auf der Startseite, Entscheidungsrechner, Verlangen-Hilfe.
import { addDays, BEER, CHALLENGE_DEFAULT_CHECK, daysBetween, drinkDecision, MILESTONES, SHOT_KCAL } from './score.js';
import { api, esc, fmt, fmtDate, icon, modal, statusLabel, toast, today as todayIso } from './app.js';
import { lineChart } from './charts.js';

export const TRIGGERS = [['stress', 'Stress'], ['langeweile', 'Langeweile'], ['hitze', 'Hitze'], ['abend', 'Abend']];
const CRAVE_MS = 10 * 60 * 1000;

// Kurzes, sachliches Feedback je Meilenstein (Tage in Folge ohne Alkohol)
const MILESTONE_TEXT = {
  3: 'Die ersten Tage sind meist die schwersten – geschafft. Der Alkohol der letzten Wochen ist abgebaut.',
  7: 'Eine Woche. Ohne Alkohol bildet die Leber weniger Fett; Triglyceride reagieren darauf innerhalb von Tagen bis Wochen.',
  14: 'Zwei Wochen. Schlaf und Ruhepuls stabilisieren sich bei vielen in dieser Zeit spürbar.',
  21: 'Drei Wochen. Der Abend ohne Getränk wird zur Gewohnheit statt zur Ausnahme.',
  28: 'Vier Wochen. Ab jetzt zeigt eine Blutkontrolle, was die Pause bewirkt hat.',
  42: 'Sechs Wochen. Der ganze Kontrollzeitraum alkoholfrei.',
};

const dayWord = n => (n === 1 ? 'Tag' : 'Tage');
const dm = s => fmtDate(s, { day: '2-digit', month: '2-digit' });
const saveChallenge = value => api('/api/settings', { method: 'PUT', body: { key: 'challenge', value } });

/** Startkarte, wenn noch keine Challenge läuft */
export function startCard() {
  return `
  <section class="card challenge start" data-reveal>
    <div class="card-title">Alkohol-Pause</div>
    <p style="margin:0 0 14px">Eine Pause bis zur nächsten Blutkontrolle – jeder alkoholfreie Tag zählt und wird sichtbar.</p>
    <button class="btn block" id="ch-start">Challenge starten</button>
  </section>`;
}

export function openStart(today) {
  modal(`
    <h2>Alkohol-Pause starten</h2>
    <form class="form" id="ch-form" novalidate>
      <div class="form-grid">
        <div class="field"><label for="ch-s">Start</label><input id="ch-s" type="date" name="start" value="${today}"></div>
        <div class="field"><label for="ch-c">Kontrolltermin</label><input id="ch-c" type="date" name="check" value="${CHALLENGE_DEFAULT_CHECK > today ? CHALLENGE_DEFAULT_CHECK : addDays(today, 35)}" min="${addDays(today, 7)}"></div>
      </div>
      <ul class="ch-rules">
        <li>Bier-Budget während der Challenge: <b>0</b></li>
        <li>Alkoholfreier Tag: <b>+2 Bonuspunkte</b></li>
        <li>Tag mit Alkohol: höchstens <b>Orange</b></li>
      </ul>
      <p class="safety">${icon('heart')}<span>Nach Wochen mit täglichem Alkohol kann ein abruptes Aufhören Schlafstörungen, Zittern oder Schwitzen auslösen.
        Bei starken Beschwerden: Hausarzt oder <b>1450</b> anrufen.</span></p>
      <button class="btn block" type="submit">Los geht's</button>
    </form>`, {
    onOpen: (m, close) => m.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (!f.start.value || !f.check.value || f.check.value <= f.start.value) { toast('Kontrolltermin muss nach dem Start liegen', 'error'); return; }
      try {
        // Der Hinweis wurde hier gezeigt -> nicht noch einmal einblenden
        await saveChallenge({ start: f.start.value, check: f.check.value, safety_ack: true });
        toast('Challenge gestartet', 'success');
        close();
        document.dispatchEvent(new CustomEvent('datachange'));
      } catch (ex) { toast(ex.message, 'error'); }
    }),
  });
}

/** Große Challenge-Karte: Streak, Gesamt, Fortschritt bis zur Kontrolle, Abzeichen */
export function challengeCard(st, ch) {
  const pct = Math.round(st.progress * 100);
  const lead = st.ended
    ? `Kontrolltermin war am ${dm(st.check)}. Trag den Triglycerid-Wert unter Gesundheit › Blutwerte ein.`
    : st.streak === 0 && st.blockedBy === 'alcohol' && st.free > 0
      ? `Der Streak beginnt neu. ${st.free} alkoholfreie ${dayWord(st.free)} hast du in der Challenge schon gesammelt – die bleiben.`
      : st.streak === 0 && st.blockedBy === 'open' && st.open
        ? `${st.open} ${st.open === 1 ? 'Tag ist' : 'Tage sind'} noch offen. Nachtragen, dann zählt der Streak weiter.`
        : st.nextMilestone ? `Noch ${st.nextMilestone - st.streak} ${dayWord(st.nextMilestone - st.streak)} bis zum nächsten Abzeichen (${st.nextMilestone}).` : 'Alle Abzeichen gesammelt.';
  return `
  <section class="card challenge" data-reveal>
    <div class="ch-top">
      <div class="ch-count ${st.streak ? '' : 'zero'}"><b id="ch-streak">${st.streak}</b><span>${st.streak === 1 ? 'Tag' : 'Tage'} ohne Alkohol</span></div>
      <div class="ch-side">
        <div><b>${st.free}</b><span>alkoholfrei seit ${dm(st.start)}</span></div>
        ${st.best > st.streak ? `<div><b>${st.best}</b><span>längste Serie</span></div>` : ''}
      </div>
    </div>
    <p class="ch-lead">${lead}</p>
    ${st.total ? `
    <div class="ch-progress" role="img" aria-label="Fortschritt bis zur Kontrolle: ${pct} %"><i data-w="${pct}"></i></div>
    <div class="ch-progress-label"><span>Tag ${Math.min(st.elapsed, st.total)} von ${st.total}</span><span>${st.ended ? 'Kontrolle erreicht' : `Noch <b>${st.daysToCheck}</b> ${dayWord(st.daysToCheck)} bis zur Kontrolle (${dm(st.check)})`}</span></div>` : ''}
    <div class="badges" aria-label="Abzeichen">${MILESTONES.map(m => `<span class="badge ${st.badges.includes(m) ? 'got' : ''}" data-ms="${m}" title="${m} Tage in Folge">${m}</span>`).join('')}</div>
    ${st.milestone ? `<div class="ms-feedback"><b>${st.milestone} Tage!</b> ${MILESTONE_TEXT[st.milestone]}</div>` : ''}
    ${st.savedUnits ? `<p class="muted" style="font-size:.8rem;margin:10px 0 0">Im Vergleich zu den 4 Wochen davor ≈ <b>${fmt(st.savedUnits, 0)} Bier</b> weniger
      (≈ ${fmt(Math.round(st.savedUnits * BEER.kcal / 100) * 100)} kcal, ${fmt(Math.round(st.savedUnits * BEER.alcoholG))} g Alkohol).</p>` : ''}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn" id="crave-btn" style="flex:1">Ich habe Lust auf Alkohol</button>
      <button class="btn secondary" id="drink-btn" style="flex:1">Ich will etwas trinken</button>
    </div>
    ${ch.safety_ack ? '' : `<p class="safety">${icon('heart')}<span>Nach Wochen mit täglichem Alkohol kann ein abruptes Aufhören Schlafstörungen, Zittern oder Schwitzen auslösen.
      Bei starken Beschwerden: Hausarzt oder <b>1450</b>. <button class="btn ghost" id="safety-ok" style="padding:0">Verstanden</button></span></p>`}
  </section>`;
}

/** Nach dem Rendern: Meilenstein-Animation (einmal pro Abzeichen und Gerät), Hinweis bestätigen */
export function wireChallenge(root, st, ch) {
  root.querySelector('#safety-ok')?.addEventListener('click', async e => {
    try { await saveChallenge({ ...ch, safety_ack: true }); e.target.closest('.safety').remove(); } catch (ex) { toast(ex.message, 'error'); }
  });
  for (const m of st.badges) {
    const key = `ms-${ch.start}-${m}`;
    let seen = true;
    try { seen = localStorage.getItem(key) === '1'; localStorage.setItem(key, '1'); } catch {}
    if (seen) continue;
    const b = root.querySelector(`.badge[data-ms="${m}"]`);
    b?.classList.add('new');
    if (b) celebrate(b);
    if (m === st.badges.at(-1)) toast(`Abzeichen: ${m} Tage ohne Alkohol`, 'success');
  }
}

function celebrate(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('span');
  box.className = 'burst';
  box.innerHTML = Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg;--d:${i % 3}"></i>`).join('');
  el.append(box);
  setTimeout(() => box.remove(), 1400);
}

/** Dringlichkeits-Banner: Triglycerid-Verlauf mit Ziellinien 500 und 200 */
export function tgCard(labs, ch, today) {
  const rows = labs.filter(l => /trigly/i.test(l.test_name)).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  if (!rows.length) return '';
  const last = rows.at(-1);
  const weeks = ch?.check ? Math.max(1, Math.round(daysBetween(today, ch.check) / 7)) : null;
  return `
  <section class="card tg" data-reveal>
    <div class="card-title">Triglyceride <span class="tg-last ${last.value >= 500 ? 'bad' : last.value >= 200 ? 'warn' : 'good'}">${fmt(last.value)} <small>${esc(last.unit || 'mg/dl')} · ${dm(last.entry_date)}</small></span></div>
    <div id="ch-tg"></div>
    ${weeks && today <= ch.check ? `<p class="tg-hint">Der Wert, den du in ${weeks} ${weeks === 1 ? 'Woche' : 'Wochen'} selbst beeinflusst.</p>` : ''}
  </section>`;
}

export function drawTg(labs) {
  const el = document.getElementById('ch-tg');
  if (!el) return;
  const rows = labs.filter(l => /trigly/i.test(l.test_name)).sort((a, b) => a.entry_date.localeCompare(b.entry_date)).slice(-8);
  lineChart(el, {
    series: [{ name: 'Triglyceride', color: 'var(--bad)', points: rows.map(l => ({ x: l.entry_date, y: l.value })), dots: true, smooth: false }],
    goals: [{ y: 500, label: '500', color: 'var(--warn)' }, { y: 200, label: '200 Ziel', color: 'var(--good)' }],
    height: 150, unit: 'mg/dl', decimals: 0, yMin: 0, label: 'Triglycerid-Verlauf',
  });
}

/**
 * Entscheidungsrechner "Ich will etwas trinken": zeigt Streak, Verlust, Score danach und Gegenvorschläge,
 * erst dann "Trotzdem eintragen". Ganz ohne Moral – nur die Zahlen.
 */
export function openDrink(ctx, kind = 'beer') {
  const render = k => {
    const r = drinkDecision(ctx.daysByDate, ctx.goals, ctx.today, ctx.challenge, k);
    const loss = r.challenge && r.streak > 0
      ? `<div class="dd-loss"><b>${r.streak} ${dayWord(r.streak)}</b> ohne Alkohol <span>→</span> <b>0</b><small>Die Gesamtzahl alkoholfreier Tage bleibt.</small></div>`
      : '';
    return `
    <h2>Etwas trinken?</h2>
    <div class="seg" role="group" aria-label="Getränk">
      <button type="button" data-kind="beer" aria-pressed="${k === 'beer'}">Bier 0,5 l</button>
      <button type="button" data-kind="shot" aria-pressed="${k === 'shot'}">Stamperl 2 cl</button>
    </div>
    ${loss}
    <div class="rows">
      <div class="row"><span>Score heute</span><b>${r.scoreNow ?? '–'} → <span class="${r.statusNext === 'red' ? 'bad' : ''}">${r.scoreNext}</span> <small class="muted">(${statusLabel(r.statusNext)})</small></b></div>
      ${r.bonusLost ? `<div class="row"><span>Bonus alkoholfrei</span><b class="bad">−${r.bonusLost}</b></div>` : ''}
      <div class="row"><span>Woche danach</span><b>${fmt(r.weekAfter, r.weekAfter % 1 ? 2 : 0)} / ${r.budget} Bier</b></div>
      <div class="row"><span>Kalorien</span><b>+${r.kcal} kcal</b></div>
    </div>
    <div class="fill-q" style="margin-top:16px">Stattdessen?</div>
    <div class="alt-grid">
      <button type="button" class="btn secondary" data-alt="water">${icon('drop')} Glas Wasser</button>
      <button type="button" class="btn secondary" data-alt="af">${icon('beer')} Alkoholfreies</button>
      <button type="button" class="btn secondary" data-alt="walk">${icon('flex')} 15 Min. gehen</button>
    </div>
    <button type="button" class="btn ghost block" data-anyway style="margin-top:14px">Trotzdem eintragen</button>`;
  };
  modal(render(kind), {
    onOpen: (m, close) => {
      m.addEventListener('click', async e => {
        const seg = e.target.closest('[data-kind]');
        if (seg) { kind = seg.dataset.kind; m.innerHTML = render(kind); return; }
        const alt = e.target.closest('[data-alt]')?.dataset.alt;
        if (alt === 'walk') { toast('Gute Wahl. Nach 15 Minuten fühlt sich die Entscheidung meist anders an.', 'success'); close(); return; }
        if (alt) {
          try {
            await api(`/api/days/${todayIso()}`, { method: 'PATCH', body: { water_delta: alt === 'af' ? 500 : 250 } });
            toast(alt === 'af' ? 'Alkoholfreies eingetragen (+500 ml)' : '+250 ml Wasser', 'success');
            close();
            document.dispatchEvent(new CustomEvent('datachange'));
          } catch (ex) { toast(ex.message, 'error'); }
          return;
        }
        if (e.target.closest('[data-anyway]')) {
          e.target.disabled = true;
          try {
            await api(`/api/days/${todayIso()}`, { method: 'PATCH', body: kind === 'shot' ? { shots_delta: 1 } : { beer_delta: 1 } });
            toast(kind === 'shot' ? 'Stamperl eingetragen' : 'Bier eingetragen', 'success');
            close();
            document.dispatchEvent(new CustomEvent('datachange'));
          } catch (ex) { toast(ex.message, 'error'); e.target.disabled = false; }
        }
      });
    },
  });
}

/** "Ich habe Lust auf Alkohol": 10-Minuten-Timer, Glas Wasser, Verlangen und Auslöser notieren */
export function openCraving() {
  const started = Date.now();
  const startedAt = new Date().toTimeString().slice(0, 5);
  const date = todayIso();
  let timer, done = false, saved = false;
  const state = { level: null, triggers: new Set() };
  modal(`
    <h2>Verlangen aushalten</h2>
    <p class="muted" style="margin:0 0 12px">Verlangen kommt in Wellen und wird meist nach 10–20 Minuten schwächer. Trink in der Zeit ein großes Glas Wasser.</p>
    <div class="crave-timer"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="bar" cx="50" cy="50" r="44"/></svg><b id="cr-time">10:00</b></div>
    <button type="button" class="btn secondary block" data-water>${icon('drop')} Glas Wasser getrunken (+250 ml)</button>
    <div class="fill-q" style="margin-top:16px">Wie stark? <small class="muted">(optional)</small></div>
    <div class="seg levels" role="group" aria-label="Verlangen">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-level="${n}" aria-pressed="false">${n}</button>`).join('')}</div>
    <div class="fill-q" style="margin-top:14px">Auslöser <small class="muted">(optional)</small></div>
    <div class="chips">${TRIGGERS.map(([k, l]) => `<button type="button" class="chip" data-trig="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
    <button type="button" class="btn block" data-done style="margin-top:16px">Fertig</button>`, {
    onOpen: (m, close) => {
      const C = 2 * Math.PI * 44, bar = m.querySelector('.bar'), t = m.querySelector('#cr-time');
      bar.style.strokeDasharray = C;
      const tick = () => {
        const left = Math.max(0, CRAVE_MS - (Date.now() - started));
        t.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
        bar.style.strokeDashoffset = C * (left / CRAVE_MS);
        if (!left && !done) {
          done = true;
          clearInterval(timer);
          t.textContent = '✓';
          m.querySelector('.crave-timer').classList.add('done');
          navigator.vibrate?.([60, 40, 60]);
          toast('10 Minuten geschafft. Wie fühlt es sich jetzt an?', 'success');
        }
      };
      tick();
      timer = setInterval(tick, 500);
      m.addEventListener('click', async e => {
        const lv = e.target.closest('[data-level]');
        if (lv) { state.level = Number(lv.dataset.level); m.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b === lv))); return; }
        const tr = e.target.closest('[data-trig]');
        if (tr) { const k = tr.dataset.trig; state.triggers.has(k) ? state.triggers.delete(k) : state.triggers.add(k); tr.setAttribute('aria-pressed', String(state.triggers.has(k))); return; }
        if (e.target.closest('[data-water]')) {
          e.target.closest('[data-water]').disabled = true;
          try { await api(`/api/days/${date}`, { method: 'PATCH', body: { water_delta: 250 } }); toast('+250 ml Wasser', 'success'); } catch (ex) { toast(ex.message, 'error'); }
          return;
        }
        if (e.target.closest('[data-done]')) close();
      });
    },
    onClose: () => {
      clearInterval(timer);
      if (saved) return;
      saved = true;
      done = done || Date.now() - started >= CRAVE_MS;
      api('/api/cravings', { method: 'POST', body: { entry_date: date, started_at: startedAt, level: state.level, triggers: [...state.triggers], completed: done } })
        .then(() => document.dispatchEvent(new CustomEvent('datachange')))
        .catch(ex => toast(`Nicht gespeichert: ${ex.message}`, 'error'));
    },
  });
}

/** Auslöser-Auswertung für die Wochenansicht */
export function cravingSummary(cravings) {
  if (!cravings.length) return '<p class="muted" style="margin:0">Diese Woche kein Verlangen notiert. Über „Ich habe Lust auf Alkohol“ auf der Startseite.</p>';
  const count = Object.fromEntries(TRIGGERS.map(([k]) => [k, 0]));
  for (const c of cravings) for (const t of c.triggers) if (t in count) count[t]++;
  const max = Math.max(1, ...Object.values(count));
  const levels = cravings.map(c => c.level).filter(Boolean);
  const done = cravings.filter(c => c.completed).length;
  const hours = cravings.map(c => Number(c.started_at.slice(0, 2)));
  const evening = hours.filter(h => h >= 17).length;
  return `
    <div class="kv" style="margin-bottom:12px">
      <div><b>${cravings.length}</b><span>Mal Verlangen</span></div>
      <div><b>${done}</b><span>10 Min. durchgehalten</span></div>
      <div><b>${levels.length ? fmt(levels.reduce((a, b) => a + b, 0) / levels.length, 1) : '–'}</b><span>Ø Stärke (1–5)</span></div>
    </div>
    <div class="trig-bars">${TRIGGERS.map(([k, l]) => `<div><span>${l}</span><i style="--w:${(count[k] / max) * 100}%"></i><b>${count[k]}</b></div>`).join('')}</div>
    <p class="muted" style="font-size:.8rem;margin:10px 0 0">${evening ? `${evening} von ${cravings.length} nach 17 Uhr. ` : ''}${
      (() => { const top = TRIGGERS.filter(([k]) => count[k] === max && count[k] > 0).map(([, l]) => l); return top.length ? `Häufigster Auslöser: ${top.join(', ')}.` : ''; })()}</p>`;
}

export { SHOT_KCAL };
