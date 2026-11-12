// Error type and request wrapper shared by every API route.
export class ApiError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
export const bad = (msg, extra) => new ApiError(400, msg, extra);
export const conflict = (msg, extra) => new ApiError(409, msg, Object.assign({ refresh: true }, extra));

export function route(method, fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== method) throw new ApiError(405, 'Use ' + method + ' for this address.');
      const out = await fn(req);
      res.status(200).json(out);
    } catch (e) {
      if (e instanceof ApiError) return res.status(e.status).json(Object.assign({ error: e.message }, e.extra));
      if (e && e.code === '23505') return res.status(409).json({ error: 'Someone else changed this record at the same moment. The screen has been refreshed; check it and try again.', refresh: true, reopen: true });
      console.error(e);
      res.status(500).json({ error: 'The server could not complete this. Try again in a moment.' });
    }
  };
}
export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { throw bad('The request was not valid JSON.'); }
}
