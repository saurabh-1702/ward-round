import { route, body, bad, ApiError } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { ensureReady } from '../lib/seed.js';
import { sign, pinMatches } from '../lib/auth.js';

export default route('POST', async req => {
  const b = body(req), db = getDb();
  if (!['nurse', 'doctor', 'admin', 'head'].includes(b.role)) throw bad('Choose your role.');
  if (!/^\d{4}$/.test(String(b.pin || ''))) throw bad('Enter your 4-digit PIN.');
  await ensureReady(db);
  return db.tx(async q => {
    const [u] = await q('select id, name, role, pin_salt, pin_hash, failed, locked_until from users where role = $1 for update', [b.role]);
    if (!u) throw bad('That account does not exist.');
    if (u.locked_until && new Date(u.locked_until) > new Date()) throw new ApiError(429, 'Too many wrong PINs. Try again in 5 minutes.');
    if (!pinMatches(b.pin, u.pin_salt, u.pin_hash)) {
      const n = u.failed + 1;
      await q(`update users set failed = $2, locked_until = case when $2 >= 5 then now() + interval '5 minutes' else null end where id = $1`, [u.id, n >= 5 ? 0 : n]);
      throw new ApiError(401, n >= 5 ? 'Too many wrong PINs. Try again in 5 minutes.' : 'Wrong PIN. ' + (5 - n) + ' attempts left.');
    }
    await q('update users set failed = 0, locked_until = null where id = $1', [u.id]);
    const user = { uid: u.id, name: u.name, role: u.role };
    return { session: sign(user), me: { name: u.name, role: u.role } };
  });
});
