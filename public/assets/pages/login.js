const form = document.getElementById('login');
const err = document.getElementById('err');
form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = form.querySelector('button');
  btn.disabled = true;
  err.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: form.password.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Anmeldung fehlgeschlagen');
    const next = new URLSearchParams(location.search).get('next') || '/';
    // Nur relative Pfade zulassen (kein Open Redirect)
    location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  } catch (ex) {
    err.textContent = ex.message;
    form.password.select();
  } finally {
    btn.disabled = false;
  }
});
