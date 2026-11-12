// Database access. Uses Postgres through DATABASE_URL (Neon on Vercel sets this for you).
// Tests can inject another driver through globalThis.__wardDb.
import pg from 'pg';
import { ApiError } from './http.js';

let pool;
export function getDb() {
  if (globalThis.__wardDb) return globalThis.__wardDb;
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new ApiError(503, 'The database is not connected yet. In Vercel, open Storage and connect a Neon database to this project, then redeploy.');
    pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
  }
  return {
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const out = await fn((text, params) => c.query(text, params).then(r => r.rows));
        await c.query('commit');
        return out;
      } catch (e) { try { await c.query('rollback'); } catch { /* connection already gone */ } throw e; }
      finally { c.release(); }
    },
    query: (text, params) => pool.query(text, params).then(r => r.rows)
  };
}
