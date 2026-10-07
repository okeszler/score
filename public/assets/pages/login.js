const form = document.getElementById('login');
const pw = document.getElementById('pw');
const err = document.getElementById('err');
const dots = document.getElementById('dots');
const wrap = document.querySelector('.login');
const ok = form.querySelector('.key-ok');
const modeBtn = document.getElementById('mode');
const MAX = 32;

let textMode = false;
try { textMode = localStorage.getItem('loginMode') === 'text'; } catch {}

const render = () => { dots.innerHTML = '<i></i>'.repeat(pw.value.length); };
const buzz = () => navigator.vibrate?.(8);

function setMode(text) {
  textMode = text;
  wrap.classList.toggle('text-mode', text);
  pw.setAttribute('inputmode', text ? 'text' : 'none');
  modeBtn.textContent = text ? 'Ziffernfeld verwenden' : 'Passwort mit Tastatur eingeben';
  try { localStorage.setItem('loginMode', text ? 'text' : 'pin'); } catch {}
  if (text) pw.focus();
}

function press(k) {
  err.textContent = '';
  if (k === 'del') pw.value = pw.value.slice(0, -1);
  else if (pw.value.length < MAX) pw.value += k;
  buzz();
  render();
}

document.getElementById('keypad').addEventListener('click', e => {
  const b = e.target.closest('[data-k]');
  if (b) press(b.dataset.k);
});
modeBtn.addEventListener('click', () => setMode(!textMode));

// Physische Tastatur im Ziffernfeld-Modus
document.addEventListener('keydown', e => {
  if (textMode || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
  else if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
});
// Passwort-Manager-Autofill aktualisiert die Punkte
pw.addEventListener('input', render);

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!pw.value) { err.textContent = 'Bitte PIN eingeben'; return; }
  ok.disabled = true;
  err.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Anmeldung fehlgeschlagen');
    const next = new URLSearchParams(location.search).get('next') || '/';
    // Nur relative Pfade zulassen (kein Open Redirect)
    location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  } catch (ex) {
    err.textContent = ex.message;
    pw.value = '';
    render();
    dots.classList.remove('shake');
    void dots.offsetWidth;
    dots.classList.add('shake');
    navigator.vibrate?.([30, 40, 30]);
  } finally {
    ok.disabled = false;
  }
});

setMode(textMode);
render();
