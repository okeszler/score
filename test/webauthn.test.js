import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64url, createChallenge, fromB64url, verifyAssertion, verifyRegistration, ALG_ES256 } from '../lib/webauthn.js';

const SECRET = 'pin-1234';
const ORIGIN = 'https://olivers-score.pages.dev';
const RP = 'olivers-score.pages.dev';
const enc = new TextEncoder();
const sha = async d => new Uint8Array(await crypto.subtle.digest('SHA-256', d));

// raw r||s -> DER, wie es echte Authenticatoren liefern
function rawToDer(raw) {
  const int = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); return b[0] & 0x80 ? [0, ...b] : [...b]; };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length + 4, 0x02, r.length, ...r, 0x02, s.length, ...s]);
}

async function authData(flags = 0x05, count = 1) {
  const a = new Uint8Array(37);
  a.set(await sha(enc.encode(RP)), 0);
  a[32] = flags;
  new DataView(a.buffer).setUint32(33, count);
  return a;
}

async function setup() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = b64url(await crypto.subtle.exportKey('spki', keys.publicKey));
  const reg = await createChallenge(SECRET, 'register');
  const cd = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: reg.challenge, origin: ORIGIN }));
  const cred = await verifyRegistration({ secret: SECRET, token: reg.token, origin: ORIGIN, rpId: RP, body: {
    id: 'cred-1', clientDataJSON: b64url(cd), authenticatorData: b64url(await authData()), publicKey: spki, publicKeyAlgorithm: ALG_ES256 } });
  return { keys, credential: { id: cred.id, public_key: cred.publicKey, alg: cred.alg, sign_count: 0 } };
}

async function assertion(keys, { origin = ORIGIN, flags = 0x05, challenge, count = 5 } = {}) {
  const login = await createChallenge(SECRET, 'login');
  const cd = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: challenge ?? login.challenge, origin }));
  const ad = await authData(flags, count);
  const signed = new Uint8Array([...ad, ...(await sha(cd))]);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed));
  return { token: login.token, body: { id: 'cred-1', clientDataJSON: b64url(cd), authenticatorData: b64url(ad), signature: b64url(rawToDer(raw)) } };
}

test('Registrierung + Anmeldung mit gültiger Signatur', async () => {
  const { keys, credential } = await setup();
  const a = await assertion(keys);
  const r = await verifyAssertion({ secret: SECRET, origin: ORIGIN, rpId: RP, credential, ...a });
  assert.equal(r.signCount, 5);
});

test('Abgelehnt: falscher Ursprung, ohne Fingerabdruck, fremde Challenge, manipulierte Daten', async () => {
  const { keys, credential } = await setup();
  const v = a => verifyAssertion({ secret: SECRET, origin: ORIGIN, rpId: RP, credential, ...a });
  await assert.rejects(v(await assertion(keys, { origin: 'https://evil.example' })), /Ursprung/);
  await assert.rejects(v(await assertion(keys, { flags: 0x01 })), /verifiziert/);
  await assert.rejects(v(await assertion(keys, { challenge: 'abc' })), /Challenge/);
  const a = await assertion(keys);
  const ad = fromB64url(a.body.authenticatorData); ad[36] ^= 1;
  a.body.authenticatorData = b64url(ad);
  await assert.rejects(v(a), /Signatur/);
  // anderer Schlüssel
  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  await assert.rejects(v(await assertion(other)), /Signatur/);
  // Zähler darf nicht zurückgehen
  await assert.rejects(verifyAssertion({ secret: SECRET, origin: ORIGIN, rpId: RP, credential: { ...credential, sign_count: 9 }, ...(await assertion(keys, { count: 5 })) }), /Zähler/);
});
