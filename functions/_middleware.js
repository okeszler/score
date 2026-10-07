import { verifySession } from '../lib/auth.js';
import { ensureSchema } from '../lib/db.js';
import { error } from '../lib/http.js';

// Öffentlich erreichbar ohne Login
const PUBLIC = [/^\/login(\.html)?$/, /^\/api\/login$/, /^\/assets\//, /^\/manifest\.webmanifest$/, /^\/icon\.svg$/, /^\/favicon\.ico$/];

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const url = new URL(request.url);
  const path = url.pathname;

  if (!env.APP_PASSWORD) return new Response('APP_PASSWORD ist nicht gesetzt', { status: 500 });

  if (!PUBLIC.some(r => r.test(path)) && !(await verifySession(request, env.APP_PASSWORD))) {
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
