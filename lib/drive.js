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

async function driveList(token, q, fields = 'nextPageToken, files(id, name, modifiedTime, size, parents)', max = 1000) {
  const files = [];
  let pageToken;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', q);
    url.searchParams.set('fields', fields);
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('pageSize', '500');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive-Liste fehlgeschlagen (${res.status})`);
    const data = await res.json();
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken && files.length < max);
  return files;
}

// Kategorie aus dem Dateinamen (Health Connect / Samsung Health Exporte von Health Sync)
export function categoryFromName(name) {
  if (name.startsWith('Schritte')) return 'schritte';
  if (name.startsWith('Gewicht')) return 'gewicht';
  if (name.startsWith('Ernährung')) return 'ernaehrung';
  if (name.startsWith('Puls')) return 'puls';
  if (name.startsWith('Schlaf')) return 'schlaf';
  if (name.startsWith('Blutdruck')) return 'blutdruck';
  return null;
}

export async function listHealthFiles(token) {
  // Aktivitäten heißen nach ihrem Typ ("WALKING 2026.10.07 16.22.csv") -> über den Ordner erkennen
  const folders = await driveList(token,
    "mimeType = 'application/vnd.google-apps.folder' and name = 'Health Sync Aktivitäten' and trashed = false",
    'files(id, name)', 50);
  const actIds = new Set(folders.map(f => f.id));
  const parentsQ = [...actIds].map(id => ` or '${id}' in parents`).join('');
  const q = "trashed = false and name contains '.csv' and ("
    + "(name contains 'Health Connect' and (name contains 'Schritte' or name contains 'Gewicht' or name contains 'Ernährung' or name contains 'Puls' or name contains 'Schlaf'))"
    + " or name contains 'Blutdruck'" + parentsQ + ')';
  const files = await driveList(token, q);
  return files
    .map(f => ({ ...f, category: (f.parents || []).some(p => actIds.has(p)) ? 'aktivitaeten' : categoryFromName(f.name) }))
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
  const iMus = head.indexOf('muskelmasse'), iSkel = head.indexOf('skelettmuskelmasse');
  const iWat = head.indexOf('gesamtkörperwasser'), iBmr = head.indexOf('grundumsatz');
  // 0 bedeutet bei Health Sync "nicht gemessen"
  const pos = (c, i) => { const n = i >= 0 ? Number(c[i]) : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
  if (iDate < 0 || iW < 0) throw new FormatError('Unbekanntes Gewicht-CSV-Format');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    const st = parseStamp(c[iDate] || '');
    const w = Number(c[iW]);
    if (!st || !Number.isFinite(w) || w < 30 || w > 300) continue;
    const f = iF >= 0 ? Number(c[iF]) : NaN;
    out.push({
      entry_date: st[0], reading_time: st[1], weight_kg: w, body_fat_pct: Number.isFinite(f) && f > 0 ? f : null,
      muscle_kg: pos(c, iMus) ?? pos(c, iSkel), body_water_kg: pos(c, iWat), bmr_kcal: pos(c, iBmr),
    });
  }
  return out;
}

/**
 * Ernährung (MyFitnessPal → Health Connect → Health Sync):
 * Header "Datum,Zeit,Mahlzeit,Name,Beschreibung,kcal,…,Protein (g),…", eine Zeile pro Mahlzeit.
 * -> { 'YYYY-MM-DD': { kcal, protein } } (Tagessummen; protein null, wenn die Spalte fehlt)
 */
export function parseNutritionCsv(text) {
  const lines = text.split(/\r?\n/);
  const head = splitCsvLine(lines[0] || '').map(h => h.trim().toLowerCase());
  const iDate = head.indexOf('datum');
  const iKcal = head.findIndex(h => h === 'kcal' || h.startsWith('kalorien') || h.startsWith('energie'));
  const iProt = head.findIndex(h => h.startsWith('protein'));
  if (iDate < 0 || iKcal < 0) throw new FormatError('Unbekanntes Ernährungs-CSV-Format');
  const days = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    const st = parseStamp(c[iDate] || '');
    if (!st) continue;
    const k = Number(c[iKcal]), p = iProt >= 0 ? Number(c[iProt]) : NaN;
    const d = (days[st[0]] ||= { kcal: 0, protein: iProt >= 0 ? 0 : null });
    if (Number.isFinite(k) && k >= 0) d.kcal += k;
    if (d.protein != null && Number.isFinite(p) && p >= 0) d.protein += p;
  }
  for (const d of Object.values(days)) { d.kcal = Math.round(d.kcal); if (d.protein != null) d.protein = Math.round(d.protein); }
  return days;
}

// Zeitraum aus dem Dateinamen: "Schritte 2026.09.06-2026.10.06 …" oder "Schritte 2026.10.07 …"
export function rangeFromName(name) {
  const m = /(\d{4})\.(\d{2})\.(\d{2})(?:-(\d{4})\.(\d{2})\.(\d{2}))?/.exec(name);
  if (!m) return null;
  const a = `${m[1]}-${m[2]}-${m[3]}`;
  return { from: a, to: m[4] ? `${m[4]}-${m[5]}-${m[6]}` : a };
}

// ---------- Gesundheit: Puls, Schlaf, Blutdruck, Aktivitäten ----------

function headerIndex(lines) {
  const head = splitCsvLine(lines[0] || '').map(h => h.trim().toLowerCase());
  return name => head.findIndex(h => h === name || h.startsWith(name));
}

/**
 * Puls: "Datum,Zeit,Puls,Datenquelle" (eine Messung alle paar Minuten).
 * Gespeichert werden Stundenwerte -> { 'YYYY-MM-DD': { [stunde]: { n, sum, min, max } } }
 */
export function parsePulseCsv(text) {
  const lines = text.split(/\r?\n/);
  const col = headerIndex(lines);
  const iDate = col('datum'), iBpm = col('puls');
  if (iDate < 0 || iBpm < 0) throw new FormatError('Unbekanntes Puls-CSV-Format');
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    const st = parseStamp(c[iDate] || '');
    const bpm = Number(c[iBpm]);
    if (!st || !Number.isFinite(bpm) || bpm < 25 || bpm > 240) continue;
    const h = Number(st[1].slice(0, 2));
    const d = ((out[st[0]] ||= {})[h] ||= { n: 0, sum: 0, min: bpm, max: bpm });
    d.n++; d.sum += bpm; d.min = Math.min(d.min, bpm); d.max = Math.max(d.max, bpm);
  }
  return out;
}

/** Schlaf: "Datum,Zeit,Durée en secondes,Schlafstadium" -> Segmente { start: 'YYYY-MM-DD HH:MM:SS', seconds, stage } */
export function parseSleepCsv(text) {
  const lines = text.split(/\r?\n/);
  const head = splitCsvLine(lines[0] || '').map(h => h.trim().toLowerCase());
  const iDate = head.indexOf('datum');
  const iDur = head.findIndex(h => /sekund|second|durée|duration|dauer/.test(h));
  const iStage = head.findIndex(h => /stadium|stage|phase/.test(h));
  if (iDate < 0 || iDur < 0) throw new FormatError('Unbekanntes Schlaf-CSV-Format');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    const st = parseStamp(c[iDate] || '');
    const sec = Math.round(Number(c[iDur]));
    if (!st || !Number.isFinite(sec) || sec <= 0 || sec > 86400) continue;
    const stage = iStage >= 0 ? (c[iStage] || '').trim().toLowerCase() || null : null;
    out.push({ start: `${st[0]} ${st[1]}`, seconds: sec, stage });
  }
  return out;
}

/** Blutdruck (Samsung Health): "Datum,Zeit,Diastolisch,Systolisch,Puls,Kommentar" */
export function parseBpCsv(text) {
  const lines = text.split(/\r?\n/);
  const col = headerIndex(lines);
  const iDate = col('datum'), iSys = col('systolisch'), iDia = col('diastolisch'), iPulse = col('puls'), iNote = col('kommentar');
  if (iDate < 0 || iSys < 0 || iDia < 0) throw new FormatError('Unbekanntes Blutdruck-CSV-Format');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    const st = parseStamp(c[iDate] || '');
    const sys = Math.round(Number(c[iSys])), dia = Math.round(Number(c[iDia]));
    if (!st || !(sys >= 60 && sys <= 260) || !(dia >= 30 && dia <= 160)) continue;
    const p = iPulse >= 0 ? Math.round(Number(c[iPulse])) : NaN;
    out.push({ entry_date: st[0], reading_time: st[1], systolic: sys, diastolic: dia, pulse: p > 0 ? p : null, note: iNote >= 0 ? (c[iNote] || '').trim() || null : null });
  }
  return out;
}

/** Aktivität (Health Sync, eine Datei pro Training) */
export function parseActivityCsv(text) {
  const lines = text.split(/\r?\n/);
  const col = headerIndex(lines);
  const iDate = col('datum'), iType = col('aktivitätstyp');
  if (iDate < 0 || iType < 0) throw new FormatError('Unbekanntes Aktivitäts-CSV-Format');
  const num = (c, name) => { const i = col(name); const n = i >= 0 ? Number(c[i]) : NaN; return Number.isFinite(n) ? n : null; };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsvLine(lines[i]);
    const st = parseStamp(c[iDate] || '');
    if (!st) continue;
    const src = col('quell-app');
    out.push({
      entry_date: st[0], start_time: st[1], activity_type: (c[iType] || '').trim() || 'UNBEKANNT',
      source_app: src >= 0 ? c[src] || null : null,
      elapsed_seconds: num(c, 'verstrichene zeit'), active_seconds: num(c, 'aktive zeit'),
      distance_km: num(c, 'entfernung'), calories: num(c, 'kalorien'), steps: num(c, 'schritte'),
      avg_hr: num(c, 'durchschnittliche herzfrequenz'), max_hr: num(c, 'maximale herzfrequenz'),
    });
  }
  return out;
}
