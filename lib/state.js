// Loads the ward from the database into the shape the rule engine and the screens use.
import { can } from '../public/rules.js';

export async function loadState(q, opts = {}) {
  const lite = !!opts.lite;
  const [s] = await q(`select today::text as today, threshold::float8 as threshold, tz, version::int as version from settings where id = 1`);
  const ps = await q(`select id, name, age, sex, bed, admitted_on::text as admitted_on, status, closed_on::text as closed_on,
      eligible_on::text as eligible_on, close_note, last_bed, readmission_of, hold_reason, hold_by, hold_on::text as hold_on,
      hold_reviewed::text as hold_reviewed, hold_days from patients order by id`);
  const scope = lite ? `where patient_id in (select id from patients where status = 'admitted')` : '';
  const rs = await q(`select id, patient_id, date::text as date, temp::float8 as temp, med, by_name, role, at, void, void_reason,
      corrected_from::float8 as corrected_from, correct_reason, late from readings ${scope} order by id`);
  const vs = await q(`select id, patient_id, date::text as date, notes, by_name, at, extra from visits ${scope} order by id`);
  const as = await q(`select id, patient_id, date::text as date, reason, by_name, at from attempts ${scope} order by id`);
  const cl = await q(`select bed, since::text as since from cleaning`);
  const wl = await q(`select id, name, age, sex, added_on::text as added_on from waitlist order by added_at, id`);
  const bl = await q(`select day::text as day, n from blocked`);

  const byId = {};
  const patients = ps.map(r => (byId[r.id] = {
    id: r.id, name: r.name, age: r.age, sex: r.sex, bed: r.bed, admittedOn: r.admitted_on, status: r.status,
    closedOn: r.closed_on, eligibleOn: r.eligible_on, closeNote: r.close_note, lastBed: r.last_bed, readmissionOf: r.readmission_of,
    hold: r.hold_reason ? { reason: r.hold_reason, by: r.hold_by, on: r.hold_on, reviewed: r.hold_reviewed } : null,
    holdDays: r.hold_days, readings: [], visits: [], attempts: []
  }));
  rs.forEach(r => byId[r.patient_id] && byId[r.patient_id].readings.push({
    id: r.id, date: r.date, temp: r.temp, med: r.med, by: r.by_name, role: r.role, at: r.at, late: r.late,
    void: r.void, voidReason: r.void_reason, corrected: r.corrected_from != null ? { from: r.corrected_from, reason: r.correct_reason } : null
  }));
  vs.forEach(v => byId[v.patient_id] && byId[v.patient_id].visits.push({ id: v.id, date: v.date, notes: v.notes, by: v.by_name, at: v.at, extra: v.extra }));
  as.forEach(t => byId[t.patient_id] && byId[t.patient_id].attempts.push({ id: t.id, date: t.date, reason: t.reason, by: t.by_name, at: t.at }));
  const cleaning = {}; cl.forEach(c => { cleaning[c.bed] = c.since; });
  const blocked = {}; bl.forEach(b => { blocked[b.day] = b.n; });

  const S = { today: s.today, threshold: s.threshold, tz: s.tz, version: s.version, patients, cleaning, blocked,
    waitlist: wl.map(w => ({ id: w.id, name: w.name, age: w.age, sex: w.sex, addedOn: w.added_on })) };
  if (opts.role && can(opts.role, 'audit')) {
    S.audit = (await q(`select day::text as day, at, user_name, role, action, detail from audit order by id desc limit 60`))
      .map(e => ({ day: e.day, at: e.at, user: e.user_name, role: e.role, action: e.action, detail: e.detail }));
  }
  return S;
}
