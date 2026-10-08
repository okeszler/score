// Minimaler WebAuthn-Server (Passkeys / Fingerabdruck) ohne Abhängigkeiten.
// Registrierung: Der Browser liefert den öffentlichen Schlüssel als SPKI (getPublicKey()),
// daher ist kein CBOR-Parser nötig. Anmeldung: Signatur über authData || SHA-256(clientDataJSON).

import { hmac, safeEqual } from './auth.js';

const enc = new TextEncoder();
export const ALG_ES256 = -7;
export const ALG_RS256 = -257;
const CHALLENGE_TTL = 120; // Sekunden

export const b64url = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function fromB64url(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

const sha256 = async data => new Uint8Array(await crypto.subtle.digest('SHA-256', data));

/** Zustandslose Challenge: "<ablauf>.<zufall>.<hmac>" – gültig 2 Minuten. */
export async function createChallenge(secret, purpose) {
  const exp = Math.floor(Date.now() / 1000) + CHALLENGE_TTL;
  const rnd = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const sig = await hmac(secret, `webauthn:${purpose}:${exp}.${rnd}`);
  return { token: `${exp}.${rnd}.${sig}`, challenge: rnd };
}

async function checkChallenge(secret, purpose, token, challengeFromClient) {
  const [exp, rnd, sig] = String(token || '').split('.');
  if (!exp || !rnd || !sig || Number(exp) < Date.now() / 1000) throw new Error('Challenge abgelaufen');
  if (!safeEqual(sig, await hmac(secret, `webauthn:${purpose}:${exp}.${rnd}`))) throw new Error('Challenge ungültig');
  if (!safeEqual(rnd, challengeFromClient)) throw new Error('Challenge passt nicht');
}

function parseClientData(bytes, type, origin) {
  const cd = JSON.parse(new TextDecoder().decode(bytes));
  if (cd.type !== type) throw new Error('Falscher Typ');
  if (cd.origin !== origin) throw new Error('Falscher Ursprung');
  return cd;
}

async function checkAuthData(authData, rpId, { requireUV = true } = {}) {
  if (authData.length < 37) throw new Error('authData zu kurz');
  const rpHash = await sha256(enc.encode(rpId));
  for (let i = 0; i < 32; i++) if (authData[i] !== rpHash[i]) throw new Error('Falsche RP-ID');
  const flags = authData[32];
  if (!(flags & 0x01)) throw new Error('Nutzer nicht anwesend');
  if (requireUV && !(flags & 0x04)) throw new Error('Nutzer nicht verifiziert (Fingerabdruck/PIN fehlt)');
  return { signCount: new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0) };
}

/** Prüft eine Registrierung (nur mit bestehender Session aufrufen). */
export async function verifyRegistration({ secret, token, origin, rpId, body }) {
  const clientData = fromB64url(body.clientDataJSON);
  const cd = parseClientData(clientData, 'webauthn.create', origin);
  await checkChallenge(secret, 'register', token, cd.challenge);
  const authData = fromB64url(body.authenticatorData);
  const { signCount } = await checkAuthData(authData, rpId);
  const alg = Number(body.publicKeyAlgorithm);
  if (alg !== ALG_ES256 && alg !== ALG_RS256) throw new Error('Nicht unterstützter Algorithmus');
  // Schlüssel testweise importieren, damit nur gültige Schlüssel gespeichert werden
  await importKey(body.publicKey, alg);
  if (!body.id || body.id.length > 1024) throw new Error('Ungültige Credential-ID');
  return { id: body.id, publicKey: body.publicKey, alg, signCount };
}

function importKey(spkiB64, alg) {
  const params = alg === ALG_ES256 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  return crypto.subtle.importKey('spki', fromB64url(spkiB64), params, false, ['verify']);
}

// ECDSA-Signaturen kommen DER-kodiert, WebCrypto erwartet r||s (je 32 Byte)
export function derToRaw(der) {
  let p = 2;
  if (der[0] !== 0x30) throw new Error('Ungültige Signatur');
  if (der[1] & 0x80) p += der[1] & 0x7f;
  const read = () => {
    if (der[p] !== 0x02) throw new Error('Ungültige Signatur');
    const len = der[p + 1];
    let v = der.slice(p + 2, p + 2 + len);
    p += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read(), s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0); raw.set(s, 32);
  return raw;
}

/** Prüft eine Anmeldung gegen den gespeicherten Schlüssel. */
export async function verifyAssertion({ secret, token, origin, rpId, body, credential }) {
  const clientData = fromB64url(body.clientDataJSON);
  const cd = parseClientData(clientData, 'webauthn.get', origin);
  await checkChallenge(secret, 'login', token, cd.challenge);
  const authData = fromB64url(body.authenticatorData);
  const { signCount } = await checkAuthData(authData, rpId);
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(await sha256(clientData), authData.length);
  const key = await importKey(credential.public_key, credential.alg);
  let sig = fromB64url(body.signature);
  const algo = credential.alg === ALG_ES256 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
  if (credential.alg === ALG_ES256) sig = derToRaw(sig);
  if (!(await crypto.subtle.verify(algo, key, sig, signed))) throw new Error('Signatur ungültig');
  // Zähler: Geräte mit Zähler 0 unterstützen ihn nicht – dann nicht prüfen
  if (signCount && credential.sign_count && signCount <= credential.sign_count) throw new Error('Zähler ungültig (möglicher Klon)');
  return { signCount };
}
