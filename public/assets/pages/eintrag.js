import { addDays, effectiveSteps, isConfirmed, isValidDate, scoreDay, weekStart } from '../score.js';
import { animateIn, api, boot, confirmDialog, esc, fmt, fmtDate, fmtLong, icon, loadContext, ring, shell, statusLabel, toast } from '../app.js';

shell({ page: 'eintrag', title: 'Eintragen', subtitle: 'Bewegung · Ernährung · Alkohol' });

let dirty = false;
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

boot(async main => {
  const ctx = await loadContext(60);
  const { today, goals, daysByDate, scores, synced } = ctx;
  let date = new URLSearchParams(location.search).get('date');
  if (!isValidDate(date) || date > today) date = today;
  const day = daysByDate[date];
  const exists = isConfirmed(day);
  const syncSteps = synced[date] ?? null;
  const mfp = ctx.food[date] || null; // MyFitnessPal über Health Connect

  // Biere der Woche vor diesem Tag (für Wochenbudget im Score)
  let beersBefore = 0;
  for (let d = weekStart(date); d < date; d = addDays(d, 1)) beersBefore += daysByDate[d]?.beer_count || 0;

  const v = (k) => (day?.[k] ?? '');
  main.innerHTML = `
  <div class="grid grid-3">
    <form class="card form" id="f" data-reveal novalidate>
      <div class="datebar">
        <a class="icon-btn" href="/eintrag?date=${addDays(date, -1)}" aria-label="Vorheriger Tag">${icon('left')}</a>
        <input type="date" name="date" value="${date}" max="${today}" aria-label="Datum">
        ${date < today ? `<a class="icon-btn" href="/eintrag?date=${addDays(date, 1)}" aria-label="Nächster Tag">${icon('right')}</a>` : '<span class="icon-btn" style="visibility:hidden"></span>'}
      </div>
      <div class="muted" style="text-align:center;margin-top:-6px">${fmtLong(date)} · ${exists ? 'Eintrag vorhanden' : 'neuer Eintrag'}</div>

      <div class="field-label">Bewegung</div>
      <div class="toggles">
        <label class="toggle"><input type="checkbox" name="gym_kraft" ${day?.gym_kraft ? 'checked' : ''}><span>Gym: Kraft</span></label>
        <label class="toggle"><input type="checkbox" name="gym_kardio" ${day?.gym_kardio ? 'checked' : ''}><span>Gym: Kardio</span></label>
      </div>
      <div class="form-grid">
        <div class="field"><label for="steps">Schritte</label>
          <input id="steps" name="steps" type="number" inputmode="numeric" min="0" max="150000" step="1" value="${v('steps')}"
            placeholder="${syncSteps != null ? `Sync: ${fmt(syncSteps)}` : 'z. B. 10000'}">
          <span class="hint">${syncSteps != null ? `Leer lassen = Sync-Wert (${fmt(syncSteps)}) nutzen` : 'Kein Sync-Wert für diesen Tag'}</span></div>
        <div class="field"><label for="walk_km">Walk</label>
          <div class="input-wrap"><input id="walk_km" name="walk_km" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="${v('walk_km')}"><span class="suffix">km</span></div></div>
      </div>

      <div class="field-label">Ernährung & Trinken <span class="muted">${mfp ? '· MyFitnessPal-Werte vorhanden' : '(MyFitnessPal)'}</span></div>
      <div class="form-grid">
        <div class="field"><label for="kcal">Kalorien</label>
          <div class="input-wrap"><input id="kcal" name="calories_kcal" type="number" inputmode="numeric" min="0" max="10000" value="${v('calories_kcal')}" placeholder="${mfp ? `MFP: ${fmt(mfp.kcal)}` : `Ziel ≤ ${goals.kcal_target}`}"><span class="suffix">kcal</span></div>
          ${mfp ? `<span class="hint">Leer lassen = MyFitnessPal (${fmt(mfp.kcal)} kcal)</span>` : ''}</div>
        <div class="field"><label for="protein">Protein</label>
          <div class="input-wrap"><input id="protein" name="protein_g" type="number" inputmode="numeric" min="0" max="600" value="${v('protein_g')}" placeholder="${mfp ? `MFP: ${fmt(mfp.protein)}` : `Ziel ≥ ${goals.protein_target}`}"><span class="suffix">g</span></div>
          ${mfp ? `<span class="hint">Leer lassen = MyFitnessPal (${fmt(mfp.protein)} g)</span>` : ''}</div>
        <div class="field"><label for="water">Wasser</label>
          <div class="input-wrap"><input id="water" name="water_ml" type="number" inputmode="numeric" min="0" max="15000" step="250" value="${v('water_ml')}" placeholder="Ziel ≥ ${goals.water_target}"><span class="suffix">ml</span></div>
          <span class="hint">Jedes Bier zählt zusätzlich mit 250 ml</span></div>
        <div class="field"><label>Bier (0,5 l)</label>
          <div class="stepper"><button type="button" data-step="-1" aria-label="Weniger Bier">−</button>
            <input name="beer_count" type="number" inputmode="numeric" min="0" max="40" value="${day?.beer_count ?? 0}" aria-label="Anzahl Bier">
            <button type="button" data-step="1" aria-label="Mehr Bier">+</button></div></div>
      </div>

      <div class="field"><label for="note">Notiz</label><textarea id="note" name="note" maxlength="500" rows="2">${esc(v('note'))}</textarea></div>

      <div class="btn-row">
        <button class="btn" type="submit" style="flex:1">Speichern</button>
        ${exists ? `<button class="btn danger" type="button" id="del">${icon('trash')}</button>` : ''}
      </div>
    </form>

    <div class="grid" style="align-content:start">
      <section class="card" data-reveal>
        <div class="card-title">Live-Vorschau <span id="pv-pill"></span></div>
        <div class="big-score" id="pv"></div>
        <p class="muted" style="font-size:.82rem;margin:14px 0 0">Score 0–10 · Grün ab 7, Orange ab 4.
          <a href="/einstellungen#score" style="color:var(--accent)">Wie wird gerechnet?</a></p>
      </section>
      <section class="card" data-reveal>
        <div class="card-title">Letzte Einträge</div>
        <div class="list" id="list"></div>
      </section>
    </div>
  </div>`;

  const f = document.getElementById('f');

  const read = () => {
    const fd = new FormData(f);
    const n = k => (fd.get(k) === '' || fd.get(k) == null ? null : Number(fd.get(k)));
    return {
      entry_date: date, created_at: 'preview',
      gym_kraft: fd.get('gym_kraft') ? 1 : 0, gym_kardio: fd.get('gym_kardio') ? 1 : 0,
      steps: n('steps'), walk_km: n('walk_km'), synced_steps: syncSteps,
      synced_kcal: mfp?.kcal ?? null, synced_protein: mfp?.protein ?? null,
      calories_kcal: n('calories_kcal'), protein_g: n('protein_g'), water_ml: n('water_ml'),
      beer_count: n('beer_count') ?? 0,
      calories_tracked: n('calories_kcal') != null || mfp ? 1 : 0,
      note: fd.get('note'),
    };
  };

  const preview = () => {
    const s = scoreDay(read(), goals, beersBefore);
    document.getElementById('pv').innerHTML = `${ring(s.total, s.status)}
      <div class="parts">
        ${part('Bewegung', s.parts.bewegung, 4)}${part('Ernährung', s.parts.ernaehrung, 3)}${part('Alkohol', s.parts.alkohol, 3)}
      </div>`;
    document.getElementById('pv-pill').innerHTML = `<span class="pill ${s.status}">${statusLabel(s.status)}</span>`;
    animateIn(() => document.querySelectorAll('#pv [data-w]').forEach(i => (i.style.width = `${i.dataset.w}%`)));
  };
  preview();

  f.addEventListener('input', e => {
    if (e.target.name !== 'date') { dirty = true; preview(); }
  });
  f.date.addEventListener('change', () => {
    if (isValidDate(f.date.value)) go(`/eintrag?date=${f.date.value}`);
  });
  f.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const inp = f.beer_count;
    inp.value = Math.max(0, Math.min(40, (Number(inp.value) || 0) + Number(b.dataset.step)));
    dirty = true;
    preview();
  }));

  f.addEventListener('submit', async e => {
    e.preventDefault();
    f.querySelectorAll('[aria-invalid]').forEach(i => i.removeAttribute('aria-invalid'));
    const bad = [...f.querySelectorAll('input[type=number]')].find(i => !i.checkValidity());
    if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); toast('Bitte Eingaben prüfen', 'error'); return; }
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const d = read();
      await api(`/api/days/${date}`, { method: 'PUT', body: d });
      dirty = false;
      toast(`${fmtDate(date)} gespeichert`, 'success');
      document.dispatchEvent(new CustomEvent('datachange'));
    } catch (ex) {
      toast(ex.message, 'error');
      btn.disabled = false;
    }
  });

  document.getElementById('del')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Eintrag vom ${fmtDate(date)} löschen?`))) return;
    try {
      await api(`/api/days/${date}`, { method: 'DELETE' });
      dirty = false;
      toast('Eintrag gelöscht', 'success');
      document.dispatchEvent(new CustomEvent('datachange'));
    } catch (ex) { toast(ex.message, 'error'); }
  });

  // Liste der letzten Einträge
  const recent = Object.values(daysByDate).filter(isConfirmed).sort((a, b) => b.entry_date.localeCompare(a.entry_date)).slice(0, 10);
  const list = document.getElementById('list');
  list.innerHTML = recent.length ? recent.map(d => {
    const s = scores[d.entry_date];
    const st = effectiveSteps(d);
    return `<div class="list-item st-${s.status}">
      <div class="dot">${s.total}</div>
      <div class="meta"><b>${fmtDate(d.entry_date)}${d.entry_date === date ? ' · <span class="muted">offen</span>' : ''}</b>
        <span>${st != null ? `${fmt(st)} Schritte` : 'keine Schritte'} · ${d.calories_kcal != null ? `${fmt(d.calories_kcal)} kcal` : 'kcal –'} · ${d.beer_count || 0} Bier${d.gym_kraft || d.gym_kardio ? ' · Gym' : ''}</span></div>
      <div class="actions"><a href="/eintrag?date=${d.entry_date}" class="icon-btn" style="width:34px;height:34px;border:0" aria-label="Bearbeiten">${icon('edit')}</a></div>
    </div>`;
  }).join('') : '<div class="empty-state">Noch keine Einträge.</div>';
});

function go(url) {
  if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
  dirty = false;
  location.href = url;
}

function part(name, v, max) {
  return `<div class="part"><span>${name}</span><div class="bar"><i data-w="${(v / max) * 100}"></i></div><b>${v}/${max}</b></div>`;
}
