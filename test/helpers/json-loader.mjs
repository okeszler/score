// Node verlangt für JSON-Importe `with { type: 'json' }`; der Cloudflare-Build (Wrangler 3) kennt diese Syntax nicht.
// lib/db.js importiert die Seed-Datei deshalb ohne Attribut – dieser Hook macht das für die Tests lauffähig.
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  export async function load(url, context, next) {
    if (url.endsWith('.json')) {
      const source = await readFile(new URL(url), 'utf8');
      return { format: 'module', source: 'export default ' + source + ';', shortCircuit: true };
    }
    return next(url, context);
  }
`));
