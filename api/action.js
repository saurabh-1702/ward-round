import { route, body, bad } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { ensureReady } from '../lib/seed.js';
import { requireUser, sign } from '../lib/auth.js';
import { loadState } from '../lib/state.js';
import { runAction } from '../lib/actions.js';

export default route('POST', async req => {
  const user = requireUser(req), b = body(req), db = getDb();
  if (!b.rid || !/^[\w-]{8,64}$/.test(b.rid)) throw bad('Missing request id.');
  await ensureReady(db);
  const msg = await db.tx(async q => {
    await q('select 1 from settings where id = 1 for update'); // one change at a time, so rules see a consistent ward
    const fresh = await q('insert into requests(id) values ($1) on conflict do nothing returning id', [b.rid]);
    if (!fresh.length) return 'Already saved.'; // a repeated tap or an offline entry sent twice
    const S = await loadState(q);
    const m = await runAction(q, S, user, b);
    await q('update settings set version = version + 1 where id = 1');
    return m;
  });
  const state = await db.tx(q => loadState(q, { lite: true, role: user.role }));
  return { msg, state, session: sign(user) };
});
