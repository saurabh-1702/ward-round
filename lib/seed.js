// Example ward used on first start and on "Reset demo". Names are invented.
import crypto from 'node:crypto';
import { BEDS, addDays, dateIn } from '../public/rules.js';
import { SCHEMA, DATA_TABLES } from './schema.js';
import { hashPin } from './auth.js';

export const DEMO_USERS = [
  { role: 'nurse', name: 'Nurse Fernandes', pin: '1111' },
  { role: 'doctor', name: 'Dr. Rao', pin: '2222' },
  { role: 'admin', name: 'A. Mehta', pin: '3333' },
  { role: 'head', name: 'Dr. Iyer', pin: '4444' }
];
const TZ = process.env.CENTRE_TZ || 'Asia/Kolkata';

async function insertMany(q, table, cols, rows) {
  for (let i = 0; i < rows.length; i += 300) {
    const params = [];
    const vals = rows.slice(i, i + 300).map(r => '(' + r.map(v => { params.push(v); return '$' + params.length; }).join(',') + ')').join(',');
    await q(`insert into ${table}(${cols.join(',')}) values ${vals}`, params);
  }
}

function generate(T) {
  let a = 20261112;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const fn = ['Aarav', 'Meera', 'Rohan', 'Priya', 'Kabir', 'Ananya', 'Vikram', 'Sana', 'Arjun', 'Neha', 'Imran', 'Kavya', 'Daniel', 'Fatima', 'Rahul', 'Leela', 'Joseph', 'Tara', 'Nikhil', 'Zoya', 'Suresh', 'Maya', 'Farhan', 'Isha'];
  const ln = ['Sharma', 'Nair', 'Khan', 'Patel', 'Dsouza', 'Iyer', 'Reddy', 'Kulkarni', 'Sheikh', 'Menon', 'Gupta', 'Fernandes', 'Joshi', 'Thomas', 'Bose', 'Pillai', 'Chopra', 'Ansari', 'Desai', 'Verma'];
  const t1 = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 10) / 10;
  const fixed = { 19: [38.2, 38.6, 39.1, 39.5, 39.9], 23: [38.9, 39.2, 38.6, 39.0, 38.8, 39.3, 38.7, 39.1, 38.9], 29: [38.9, 38.4, 37.1, 36.9, 38.7, 38.5] };
  const P = [], R = [], V = [], A = [];
  let id = 1;
  for (let i = 1; i <= BEDS; i++) {
    const elig = i % 11 === 0, fx = fixed[i];
    const d = fx ? fx.length : elig ? 5 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 10);
    const f = elig ? Math.max(0, d - 3 - (i % 3)) : Math.max(0, d - Math.floor(rnd() * 2.4));
    const adm = addDays(T, -d), pid = id++;
    const p = { id: pid, name: fn[Math.floor(rnd() * fn.length)] + ' ' + ln[Math.floor(rnd() * ln.length)], age: 6 + Math.floor(rnd() * 78), sex: rnd() < .5 ? 'F' : 'M', bed: i, admitted_on: adm, status: 'admitted' };
    for (let k = 0; k < d; k++) {
      const dt = addDays(adm, k);
      if (k === d - 1 && (i === 7 || i === 31)) { if (i === 31) A.push([pid, dt, 'Away for a test or scan', 'Nurse Fernandes', '09:40']); continue; }
      R.push([pid, dt, fx ? fx[k] : k < f ? t1(38.1, 39.8) : t1(36.3, 37.6), i === 37 && k === d - 1, 'Nurse Fernandes', 'nurse', '09:' + String(10 + k).padStart(2, '0')]);
      V.push([pid, dt, 'Routine review.', 'Dr. Rao', '11:' + String(10 + k * 3).padStart(2, '0')]);
    }
    if (i % 5 < 2 || i === 19 || (elig && i % 2 === 0)) {
      const hot = !elig && f >= d && rnd() < .6;
      R.push([pid, T, i === 19 ? 40.2 : hot ? t1(38.1, 39.6) : t1(36.4, 37.5), false, 'Nurse Fernandes', 'nurse', '08:' + String(10 + i % 50).padStart(2, '0')]);
      if (i % 5 === 0) V.push([pid, T, 'Routine review.', 'Dr. Rao', '10:' + String(10 + i % 50).padStart(2, '0')]);
    }
    if (i === 44) Object.assign(p, { hold_reason: 'Awaiting chest X-ray result', hold_by: 'Dr. Rao', hold_on: addDays(T, -2) });
    P.push(p);
  }
  for (let i = 0; i < 100; i++) {
    const recent = i < 60, closed = addDays(T, -(recent ? 1 + Math.floor(rnd() * 28) : 31 + Math.floor(rnd() * 44)));
    const st = i % 25 === 3 ? 'transferred' : (i === 40 || i === 90) ? 'lama' : (recent ? i % 6 === 5 : i % 9 === 8) ? 'deceased' : 'discharged';
    const los = st === 'discharged' ? 5 + Math.floor(rnd() * 9) : 3 + Math.floor(rnd() * 8), delay = st === 'discharged' ? [0, 0, 1, 0, 2][i % 5] : 0;
    P.push({ id: id++, name: fn[i % fn.length] + ' ' + ln[(i * 7) % ln.length], age: st === 'deceased' ? 52 + Math.floor(rnd() * 38) : 8 + Math.floor(rnd() * 72), sex: i % 2 ? 'F' : 'M', bed: null, admitted_on: addDays(closed, -los), status: st, closed_on: closed, eligible_on: st === 'discharged' ? addDays(closed, -delay) : null });
  }
  // Bed 52 is a readmission of an earlier recovered patient.
  P[51].name = P[BEDS + 1].name; P[51].age = P[BEDS + 1].age; P[51].readmission_of = P[BEDS + 1].id;
  const W = [['Gita Rao', 61, 'F', addDays(T, -1)], ['Omar Siddiqui', 34, 'M', T], ['Lata Pawar', 47, 'F', T]];
  return { P, R, V, A, W };
}

export async function seedData(q) {
  const T = dateIn(TZ);
  await q(`insert into settings(id, today, threshold, tz, version) values (1, $1, 38.0, $2, 1)
           on conflict (id) do update set today = excluded.today, threshold = 38.0, tz = excluded.tz, version = settings.version + 1`, [T, TZ]);
  const { P, R, V, A, W } = generate(T);
  await insertMany(q, 'patients', ['id', 'name', 'age', 'sex', 'bed', 'admitted_on', 'status', 'closed_on', 'eligible_on', 'hold_reason', 'hold_by', 'hold_on'],
    P.map(p => [p.id, p.name, p.age, p.sex, p.bed, p.admitted_on, p.status, p.closed_on || null, p.eligible_on || null, p.hold_reason || null, p.hold_by || null, p.hold_on || null]));
  for (const p of P) if (p.readmission_of) await q('update patients set readmission_of = $1 where id = $2', [p.readmission_of, p.id]);
  await q(`select setval(pg_get_serial_sequence('patients','id'), (select max(id) from patients))`);
  await insertMany(q, 'readings', ['patient_id', 'date', 'temp', 'med', 'by_name', 'role', 'at'], R);
  await insertMany(q, 'visits', ['patient_id', 'date', 'notes', 'by_name', 'at'], V);
  if (A.length) await insertMany(q, 'attempts', ['patient_id', 'date', 'reason', 'by_name', 'at'], A);
  await insertMany(q, 'waitlist', ['name', 'age', 'sex', 'added_on'], W);
}

export async function seedUsers(q) {
  for (const u of DEMO_USERS) {
    const salt = crypto.randomBytes(16).toString('hex');
    await q(`insert into users(name, role, pin_salt, pin_hash) values ($1,$2,$3,$4) on conflict (role) do nothing`, [u.name, u.role, salt, hashPin(u.pin, salt)]);
  }
}

export async function resetData(q) {
  await q(`truncate ${DATA_TABLES} restart identity cascade`);
  await seedData(q);
}

let ready = null;
export function ensureReady(db) {
  if (!ready) {
    ready = db.tx(async q => {
      await q('select pg_advisory_xact_lock(7401)');
      for (const s of SCHEMA) await q(s);
      const has = await q('select 1 from settings where id = 1');
      if (!has.length) { await seedUsers(q); await seedData(q); }
    }).catch(e => { ready = null; throw e; });
  }
  return ready;
}
