import { safeEqual, signingKey, verifySession } from '../lib/auth.js';
import { ensureSchema } from '../lib/db.js';
import { error } from '../lib/http.js';

// Öffentlich erreichbar ohne Login
const PUBLIC = [/^\/login(\.html)?$/, /^\/api\/login$/, /^\/api\/webauthn\/login(-options)?$/, /^\/assets\//, /^\/manifest\.webmanifest$/, /^\/icon\.svg$/, /^\/favicon\.ico$/];

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const url = new URL(request.url);
  const path = url.pathname;

  if (!env.APP_PASSWORD) return new Response('APP_PASSWORD ist nicht gesetzt', { status: 500 });
  if (!env.SESSION_SECRET && !env.CRON_SECRET) return new Response('SESSION_SECRET ist nicht gesetzt', { status: 500 });

  // Schreibzugriffe nur von der eigenen Seite (zusätzlich zu SameSite=Lax)
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin && !['GET', 'HEAD'].includes(request.method)) return error('Fremde Herkunft', 403);
  // Schnelltasten (/?quick=…) tragen sofort ein – nicht über Links von fremden Seiten auslösbar
  if (url.searchParams.has('quick') && request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return Response.redirect(new URL('/', url).toString(), 302);
  }

  if (!PUBLIC.some(r => r.test(path)) && !isCron(request, env, path) && !(await verifySession(request, await signingKey(env)))) {
    if (path.startsWith('/api/')) return error('Nicht angemeldet', 401);
    const target = `/login?next=${encodeURIComponent(path + url.search)}`;
    return Response.redirect(new URL(target, url).toString(), 302);
  }

  if (path.startsWith('/api/') && env.DB) await ensureSchema(env.DB);

  const res = await next();
  // Sicherheits-Header für alle Antworten
  const out = new Response(res.body, res);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'same-origin');
  out.headers.set('X-Frame-Options', 'DENY');
  return out;
}

// Nächtlicher Sync durch den Worker "olivers-score-cron": nur POST /api/sync mit Bearer CRON_SECRET
function isCron(request, env, path) {
  if (!env.CRON_SECRET || path !== '/api/sync' || request.method !== 'POST') return false;
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') && safeEqual(auth.slice(7), env.CRON_SECRET);
}
