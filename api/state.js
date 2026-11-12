import { route } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { ensureReady } from '../lib/seed.js';
import { requireUser, sign } from '../lib/auth.js';
import { loadState } from '../lib/state.js';

export default route('GET', async req => {
  const user = requireUser(req), db = getDb();
  await ensureReady(db);
  const poll = req.query && req.query.poll === '1';
  const session = poll ? undefined : sign(user); // background refreshes do not count as activity
  if (req.query && req.query.v) {
    const [s] = await db.query('select version::int as version from settings where id = 1');
    if (String(s.version) === String(req.query.v)) return { unchanged: true, session };
  }
  const state = await db.tx(q => loadState(q, { lite: true, role: user.role }));
  return { state, session, me: { name: user.name, role: user.role } };
});
