// Local test server: same API files as Vercel, with an in-memory Postgres (PGlite). Not deployed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pg = new PGlite();
globalThis.__wardDb = {
  tx: fn => pg.transaction(tx => fn((t, p) => tx.query(t, p).then(r => r.rows))),
  query: (t, p) => pg.query(t, p).then(r => r.rows)
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (u.pathname.startsWith('/api/')) {
    let raw = ''; for await (const c of req) raw += c;
    req.body = raw ? JSON.parse(raw) : {}; req.query = Object.fromEntries(u.searchParams);
    if (process.env.OFFLINE === '1') { res.destroy(); return; }
    const mod = await import(path.join(root, 'api', u.pathname.slice(5) + '.js'));
    return mod.default(req, res);
  }
  const f = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.join(root, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'text/plain'); res.end(fs.readFileSync(f));
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
