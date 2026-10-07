// Google Drive via Service Account (JWT RS256 mit WebCrypto, ohne Abhängigkeiten).
// Der Service Account sieht nur Ordner/Dateien, die mit seiner E-Mail geteilt wurden.

const b64url = buf =>
  btoa(typeof buf === 'string' ? buf : String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function getAccessToken(serviceAccountJson) {
  let sa;
  try { sa = JSON.parse(serviceAccountJson); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ist kein gültiges JSON'); }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google-Token fehlgeschlagen (${res.status})`);
  return (await res.json()).access_token;
}

export async function listHealthFiles(token) {
  const q = "name contains 'Health Connect' and name contains '.csv' and trashed = false and (name contains 'Schritte' or name contains 'Gewicht')";
  const files = [];
  let pageToken;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', q);
    url.searchParams.set('fields', 'nextPageToken, files(id, name, modifiedTime, size)');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('pageSize', '200');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive-Liste fehlgeschlagen (${res.status})`);
    const data = await res.json();
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken && files.length < 1000);
  return files.map(f => ({ ...f, category: f.name.startsWith('Schritte') ? 'schritte' : f.name.startsWith('Gewicht') ? 'gewicht' : null }))
    .filter(f => f.category);
}

export async function downloadFile(token, id) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  return res.text();
}

// ---------- CSV-Parser (Health Connect Export, deutsch) ----------

export class FormatError extends Error {}

function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// "2026.10.07 06:00:00" -> ["2026-10-07", "06:00:00"]
function parseStamp(s) {
  const m = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(s.trim());
  return m ? [`${m[1]}-${m[2]}-${m[3]}`, m[4].length === 5 ? `${m[4]}:00` : m[4]] : null;
}

/** Schritte: Header "Datum,Zeit,Schritte" -> { 'YYYY-MM-DD': summe } */
export function parseStepsCsv(text) {
  const lines = text.split(/\r?\n/);
  const head = splitCsvLine(lines[0] || '').map(h => h.trim().toLowerCase());
  const iDate = head.indexOf('datum'), iSteps = head.indexOf('schritte');
  if (iDate < 0 || iSteps < 0) throw new FormatError('Unbekanntes Schritte-CSV-Format');
  const sums = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    const st = parseStamp(c[iDate] || '');
    const n = Number(c[iSteps]);
    if (!st || !Number.isFinite(n) || n < 0) continue;
    sums[st[0]] = (sums[st[0]] || 0) + Math.round(n);
  }
  return sums;
}

/** Gewicht: Header "Datum,Zeit,Gewicht,Körperfettanteil,..." -> Messungen */
export function parseWeightCsv(text) {
  const lines = text.split(/\r?\n/);
  const head = splitCsvLine(lines[0] || '').map(h => h.trim().toLowerCase());
  const iDate = head.indexOf('datum'), iW = head.indexOf('gewicht'), iF = head.indexOf('körperfettanteil');
  if (iDate < 0 || iW < 0) throw new FormatError('Unbekanntes Gewicht-CSV-Format');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    const st = parseStamp(c[iDate] || '');
    const w = Number(c[iW]);
    if (!st || !Number.isFinite(w) || w < 30 || w > 300) continue;
    const f = iF >= 0 ? Number(c[iF]) : NaN;
    out.push({ entry_date: st[0], reading_time: st[1], weight_kg: w, body_fat_pct: Number.isFinite(f) && f > 0 ? f : null });
  }
  return out;
}

// Zeitraum aus dem Dateinamen: "Schritte 2026.09.06-2026.10.06 …" oder "Schritte 2026.10.07 …"
export function rangeFromName(name) {
  const m = /(\d{4})\.(\d{2})\.(\d{2})(?:-(\d{4})\.(\d{2})\.(\d{2}))?/.exec(name);
  if (!m) return null;
  const a = `${m[1]}-${m[2]}-${m[3]}`;
  return { from: a, to: m[4] ? `${m[4]}-${m[5]}-${m[6]}` : a };
}
