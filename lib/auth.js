// Sessions: an HMAC-signed token that expires after 10 minutes without activity.
import crypto from 'node:crypto';
import { ApiError } from './http.js';

export const IDLE_MS = 10 * 60 * 1000;
const secret = () => process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('ward-round:' + (process.env.DATABASE_URL || process.env.POSTGRES_URL || 'local-dev')).digest('hex');
const mac = b => crypto.createHmac('sha256', secret()).update(b).digest('base64url');

export function sign(u) {
  const b = Buffer.from(JSON.stringify({ uid: u.uid, name: u.name, role: u.role, exp: Date.now() + IDLE_MS })).toString('base64url');
  return b + '.' + mac(b);
}
export function requireUser(req) {
  const h = req.headers.authorization || '', tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [b, m] = tok.split('.');
  if (!b || !m) throw new ApiError(401, 'Sign in to continue.', { signedOut: 'none' });
  const want = mac(b);
  if (m.length !== want.length || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(want))) throw new ApiError(401, 'Sign in to continue.', { signedOut: 'invalid' });
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (p.exp < Date.now()) throw new ApiError(401, 'You were signed out after 10 minutes without activity.', { signedOut: 'idle' });
  return p;
}
export function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
export function pinMatches(pin, salt, hash) {
  const a = Buffer.from(hashPin(pin, salt), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
