export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError('Ungültiges JSON', 400);
  }
}

export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Wrapper: fängt HttpError und unerwartete Fehler einheitlich ab. */
export function handler(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof HttpError) return error(e.message, e.status);
      console.error(e);
      return error('Interner Fehler', 500);
    }
  };
}
