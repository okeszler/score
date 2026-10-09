import { BEER, RISK_DAY_G } from '../score.js';
import { api, boot, confirmDialog, currentTheme, esc, fmt, icon, loadContext, setTheme, shell, toast } from '../app.js';
import { deviceHasPasskey, forgetDevice, passkeySupported, registerPasskey } from '../passkey.js';

shell({ page: 'einstellungen', title: 'Einstellungen', subtitle: 'Ziele, Sync & Konto' });

const FIELDS = [
  ['weight_kg', 'Zielgewicht', 'kg', 0.1],
  ['start_weight_kg', 'Startgewicht', 'kg', 0.1, 'Leer = erste Messung'],
  ['body_fat_pct', 'Ziel Körperfett', '%', 0.1],
  ['weekly_beer_budget', 'Bier-Budget pro Woche', 'Bier', 1],
  ['kcal_target', 'Kalorienziel pro Tag (max.)', 'kcal', 50],
  ['water_target', 'Wasserziel pro Tag (min.)', 'ml', 250],
  ['protein_target', 'Proteinziel pro Tag (min.)', 'g', 5],
  ['steps_target', 'Schrittziel pro Tag', 'Schritte', 500],
  ['green_days_per_week', 'Grüne Tage pro Woche', 'Tage', 1],
];

boot(async main => {
  const [ctx, sync, keys, bioOk] = await Promise.all([loadContext(1), api('/api/sync'), api('/api/webauthn/credentials'), passkeySupported()]);
  const g = ctx.goals;

  main.innerHTML = `
  <div class="grid grid-2">
    <section class="card" data-reveal>
      <div class="card-title">Ziele</div>
      <form class="form" id="goals" novalidate>
        <div class="form-grid">${FIELDS.map(([k, l, u, step, hint]) => `
          <div class="field"><label for="g-${k}">${l}</label>
            <div class="input-wrap"><input id="g-${k}" name="${k}" type="number" inputmode="decimal" step="${step}" value="${g[k] ?? ''}"><span class="suffix">${u}</span></div>
            ${hint ? `<span class="hint">${hint}</span>` : ''}</div>`).join('')}
        </div>
        <button class="btn block" type="submit">Ziele speichern</button>
      </form>
    </section>

    <div class="grid" style="align-content:start">
      <section class="card" data-reveal>
        <div class="card-title">Health Sync</div>
        ${sync.configured ? `<div class="rows">
            <div class="row"><span>Letzter Import</span><b>${sync.lastImport ? new Date(sync.lastImport.replace(' ', 'T') + 'Z').toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : 'nie'}</b></div>
            <div class="row"><span>Schritte bis</span><b>${sync.lastStepsDate ?? '–'}</b></div>
            <div class="row"><span>Gewicht bis</span><b>${sync.lastWeightDate ?? '–'}</b></div>
            <div class="row"><span>Verarbeitete Dateien</span><b>${fmt(sync.files)}</b></div>
            ${sync.lastRun ? `<div class="row"><span>Letzter Lauf (${sync.lastRun.source === 'cron' ? 'automatisch' : 'manuell'})</span>
              <b class="${sync.lastRun.errors.length ? 'bad' : 'good'}">${new Date(sync.lastRun.ran_at.replace(' ', 'T') + 'Z').toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
              · ${sync.lastRun.errors.length ? 'Fehler' : `${sync.lastRun.imported} neu`}</b></div>
              ${sync.lastRun.errors.length ? `<div class="row" style="display:block;color:var(--bad);font-size:.82rem">${sync.lastRun.errors.map(esc).join('<br>')}</div>` : ''}` : ''}
          </div>
          <button class="btn secondary block" style="margin-top:14px" id="sync">${icon('sync')} Jetzt synchronisieren</button>
          <p class="muted" style="font-size:.8rem;margin:10px 0 0">Automatisch jeden Tag um 23:59 Uhr. Liest Schritte, Gewicht, Ernährung, Puls, Schlaf, Blutdruck und Aktivitäten („Health Sync …“-Ordner) aus den Google-Drive-Ordnern, die mit dem Service Account geteilt sind.</p>`
        : '<p class="muted">Nicht eingerichtet: Secret <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> fehlt im Pages-Projekt.</p>'}
      </section>

      <section class="card" data-reveal>
        <div class="card-title">Fingerabdruck-Anmeldung</div>
        ${keys.credentials.length ? `<div class="list">${keys.credentials.map(k => `
          <div class="list-item"><div class="meta"><b>${esc(k.label || 'Gerät')}</b>
            <span>eingerichtet ${new Date(k.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE')}${k.last_used ? ` · zuletzt ${new Date(k.last_used.replace(' ', 'T') + 'Z').toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span></div>
            <div class="actions"><button class="del" data-key="${esc(k.id)}" aria-label="Entfernen">${icon('trash')}</button></div></div>`).join('')}</div>`
          : '<p class="muted" style="margin-top:0">Noch kein Gerät eingerichtet.</p>'}
        ${bioOk ? (deviceHasPasskey() && keys.credentials.length ? '<p class="muted" style="font-size:.82rem;margin:10px 0 0">Auf diesem Gerät eingerichtet. Beim Öffnen der Login-Seite wird der Fingerabdruck direkt abgefragt.</p>'
          : `<button class="btn secondary block" id="bio-add" style="margin-top:12px">Auf diesem Gerät einrichten</button>`)
          : '<p class="muted" style="font-size:.82rem;margin:10px 0 0">Dieser Browser bzw. dieses Gerät unterstützt keine Fingerabdruck-Anmeldung.</p>'}
      </section>

      <section class="card" data-reveal>
        <div class="card-title">Daten exportieren (CSV, Excel)</div>
        <div class="btn-row">${[['tage', 'Tage'], ['koerper', 'Körper'], ['blutdruck', 'Blutdruck'], ['blutwerte', 'Blutwerte']]
          .map(([k, l]) => `<a class="btn secondary" style="flex:1" href="/api/export?type=${k}">${icon('download')} ${l}</a>`).join('')}</div>
      </section>

      <section class="card" data-reveal>
        <div class="card-title">Darstellung & Konto</div>
        <div class="btn-row">
          <button class="btn secondary" id="theme" style="flex:1">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')} ${currentTheme() === 'dark' ? 'Hell' : 'Dunkel'}</button>
          <button class="btn danger" id="logout" style="flex:1">${icon('logout')} Abmelden</button>
        </div>
      </section>
    </div>
  </div>

  <section class="card" id="score" data-reveal style="margin-top:16px">
    <div class="card-title">So wird der Score berechnet (0–10)</div>
    <div class="rows">
      <div class="row"><span><b>Bewegung</b> (max. 4)</span><b>Schritte ≥ 100 % Ziel: 3 · ≥ 75 %: 2 · ≥ 50 %: 1 · + Training: 1</b></div>
      <div class="row"><span><b>Ernährung</b> (max. 3)</span><b>kcal ≤ Ziel: 1 · Protein ≥ Ziel: 1 · Wasser ≥ Ziel: 1</b></div>
      <div class="row"><span><b>Alkohol</b> (max. 3)</span><b>0 Bier: 3 · 1: 2 · 2: 1 · ab 3: 0 · Wochenbudget überschritten: 0</b></div>
      <div class="row"><span><b>Ampel</b></span><b><span class="pill green">ab 7</span> <span class="pill orange">ab 4</span> <span class="pill red">darunter</span></b></div>
    </div>
    <p class="muted" style="font-size:.82rem;margin:12px 0 0">Schritte: manueller Wert hat Vorrang, sonst Health Sync, sonst Walk-km × 1.300. kcal und Protein: manueller Wert hat Vorrang, sonst MyFitnessPal (über Health Connect).
      Tage ohne Eintrag zählen als „kein Eintrag“ (grau), nicht als rot. Risikotag = mehr als ${RISK_DAY_G} g Alkohol (≈ ${fmt(RISK_DAY_G / BEER.alcoholG, 1)} Bier).</p>
  </section>`;

  const f = document.getElementById('goals');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, f[k].value]));
    try {
      await api('/api/goals', { method: 'PUT', body });
      toast('Ziele gespeichert', 'success');
    } catch (ex) { toast(ex.message, 'error'); }
  });
  document.getElementById('sync')?.addEventListener('click', () => document.querySelector('[data-sync]').click());
  document.getElementById('theme').addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    document.dispatchEvent(new CustomEvent('datachange'));
  });
  document.getElementById('bio-add')?.addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      await registerPasskey();
      toast('Fingerabdruck eingerichtet', 'success');
      document.dispatchEvent(new CustomEvent('datachange'));
    } catch (ex) {
      if (ex.name !== 'NotAllowedError') toast(ex.message, 'error');
      e.target.disabled = false;
    }
  });
  main.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Fingerabdruck-Anmeldung für dieses Gerät entfernen?', 'Entfernen'))) return;
    try {
      await api(`/api/webauthn/credentials?id=${encodeURIComponent(b.dataset.key)}`, { method: 'DELETE' });
      forgetDevice();
      toast('Entfernt', 'success');
      document.dispatchEvent(new CustomEvent('datachange'));
    } catch (ex) { toast(ex.message, 'error'); }
  }));
  document.getElementById('logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  });
});
