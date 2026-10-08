// Passkey / Fingerabdruck im Browser (WebAuthn)
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export const DEVICE_FLAG = 'passkeyOnDevice';

export function deviceHasPasskey() {
  try { return localStorage.getItem(DEVICE_FLAG) === '1'; } catch { return false; }
}
function setDeviceFlag(on) {
  try { on ? localStorage.setItem(DEVICE_FLAG, '1') : localStorage.removeItem(DEVICE_FLAG); } catch {}
}

export async function passkeySupported() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

/** Fingerabdruck auf diesem Gerät einrichten (Session nötig). */
export async function registerPasskey(label) {
  const res = await fetch('/api/webauthn/register-options', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Bitte zuerst mit PIN anmelden');
  const o = await res.json();
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64url(o.challenge),
      rp: o.rp,
      user: { id: fromB64url(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      excludeCredentials: o.excludeCredentials.map(id => ({ type: 'public-key', id: fromB64url(id) })),
      attestation: 'none',
      timeout: 60000,
    },
  });
  const r = cred.response;
  if (!r.getPublicKey) throw new Error('Dieser Browser unterstützt die Einrichtung nicht');
  await post('/api/webauthn/register', {
    token: o.token,
    id: cred.id,
    label: label || deviceLabel(),
    clientDataJSON: b64url(r.clientDataJSON),
    authenticatorData: b64url(r.getAuthenticatorData()),
    publicKey: b64url(r.getPublicKey()),
    publicKeyAlgorithm: r.getPublicKeyAlgorithm(),
  });
  setDeviceFlag(true);
}

/** Anmeldung per Fingerabdruck. Liefert false, wenn keine Passkeys eingerichtet sind. */
export async function loginWithPasskey() {
  const o = await (await fetch('/api/webauthn/login-options')).json();
  if (!o.available) { setDeviceFlag(false); return false; }
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64url(o.challenge),
      rpId: o.rpId,
      allowCredentials: o.allowCredentials.map(id => ({ type: 'public-key', id: fromB64url(id) })),
      userVerification: 'required',
      timeout: 60000,
    },
  });
  const r = cred.response;
  await post('/api/webauthn/login', {
    token: o.token,
    id: cred.id,
    clientDataJSON: b64url(r.clientDataJSON),
    authenticatorData: b64url(r.authenticatorData),
    signature: b64url(r.signature),
  });
  setDeviceFlag(true);
  return true;
}

export function forgetDevice() { setDeviceFlag(false); }

function deviceLabel() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  if (m) return m[1].replace(/ Build.*$/, '');
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows-PC';
  return 'Gerät';
}
