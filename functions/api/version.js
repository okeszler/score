import { json } from '../../lib/http.js';

// GET /api/version -> aktueller Stand (Cloudflare setzt CF_PAGES_COMMIT_SHA beim Build)
export const onRequestGet = ({ env }) => json({
  commit: (env.CF_PAGES_COMMIT_SHA || 'lokal').slice(0, 7),
  branch: env.CF_PAGES_BRANCH || null,
});
