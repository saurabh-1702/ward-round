// Ward Round rule engine. Shared by the browser (for display) and the server (for enforcement).
// Pure functions only: everything takes the ward state S = { today, threshold, patients, cleaning, ... }.

export const BEDS = 74, MIN_SAMPLE = 20, BENCH = 15;
export const ROLES = { nurse: 'Nurse', doctor: 'Doctor', admin: 'Admin', head: 'Head doctor' };
export const CAN = {
  temp: ['nurse', 'doctor', 'head'], visit: ['doctor', 'head'], exit: ['doctor', 'head'], hold: ['doctor', 'head'],
  discharge: ['admin'], admit: ['admin'], beds: ['admin'], settings: ['head'], reopen: ['head'], audit: ['head']
};
export const OUTCOME = { discharged: 'Recovered', deceased: 'Died', transferred: 'Transferred out', lama: 'Left against advice' };
export const UNABLE_REASONS = ['Asleep', 'Away for a test or scan', 'Refused', 'Not in the room'];
export const can = (role, action) => (CAN[action] || []).includes(role);

/* ---------- dates (ISO yyyy-mm-dd strings, no time zone drift) ---------- */
export function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const diff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
export const mins = t => { const m = /^(\d\d):(\d\d)$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
export function dateIn(tz, when = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when); }
export function clockIn(tz, when = new Date()) { return when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }); }

/* ---------- temperature input ---------- */
export function parseTemp(v) {
  v = String(v == null ? '' : v).trim().replace(',', '.');
  if (!v) return { err: 'Enter the temperature.' };
  if (!/^\d{2,3}(\.\d)?$/.test(v)) return { err: 'Enter a number with at most one decimal place, for example 37.4.' };
  const t = parseFloat(v);
  if (t >= 90 && t <= 113) return { err: 'That looks like Fahrenheit. Enter the reading in °C.' };
  if (t < 30 || t > 45) return { err: 'Enter a value between 30.0 and 45.0 °C.' };
  return { t, unusual: t < 35 || t >= 41 };
}

/* ---------- core rule ----------
   A day is fever-free when its highest reading is below the threshold and no fever reducer was given.
   A patient is eligible the morning after three such completed days in a row. Only a fever removes eligibility. */
export function analyse(p, S) {
  const thr = S.threshold, T = S.today, by = {};
  p.readings.forEach(r => { if (!r.void) (by[r.date] = by[r.date] || []).push(r); });
  let run = 0, eligibleOn = null, feverRun = 0, relapseOn = null, d = p.admittedOn;
  const series = [];
  while (d <= T) {
    const rs = by[d] || []; let o = null, med = false;
    rs.forEach(r => { if (!o || r.temp > o.temp) o = r; if (r.med) med = true; });
    const st = !o ? 'none' : o.temp >= thr ? 'fever' : med ? 'masked' : 'free';
    series.push({ date: d, o, st, n: rs.length, rs });
    if (st === 'fever') { if (run >= 2 || eligibleOn) relapseOn = d; run = 0; eligibleOn = null; feverRun++; }
    else {
      if (st === 'free') feverRun = 0;
      if (d < T) { if (st === 'free') { run++; if (run >= 3 && !eligibleOn) eligibleOn = addDays(d, 1); } else run = 0; }
    }
    d = addDays(d, 1);
  }
  const today = series[series.length - 1], yest = series.length > 1 ? series[series.length - 2] : null;
  const offs = series.filter(x => x.o), last = offs.length ? offs[offs.length - 1] : null;
  const visits = p.visits.filter(v => v.date === T), att = p.attempts || [];
  const flags = [];
  if (last && last.o.temp >= 40 && diff(last.date, T) <= 1) flags.push(['crit', 'Very high: ' + last.o.temp.toFixed(1) + ' °C']);
  if (offs.length >= 3) { const a = offs.slice(-3).map(x => x.o.temp); if (a[0] < a[1] && a[1] < a[2] && a[2] >= 37.5) flags.push(['warn', 'Rising for 3 days']); }
  if (feverRun >= 7) flags.push(['warn', 'Fever for ' + feverRun + ' days']);
  if (relapseOn && diff(relapseOn, T) <= 2 && !eligibleOn) flags.push(['crit', 'Fever returned']);
  if (p.readmissionOf) flags.push(['warn', 'Readmission']);
  if (p.hold && (p.hold.reviewed || p.hold.on) < T) flags.push(['warn', 'Hold needs review']);
  return {
    series, today, last, visits, flags, streak: Math.min(run, 3), eligibleOn, eligible: !!eligibleOn,
    waiting: eligibleOn ? diff(eligibleOn, T) : 0,
    tomorrow: !eligibleOn && run === 2 && (today.st === 'free' || today.st === 'none') ? (today.st === 'free' ? 'likely' : 'possible') : null,
    missedYesterday: !!yest && yest.st === 'none',
    missedWhy: yest ? (att.filter(x => x.date === yest.date).pop() || {}).reason : null,
    unable: today.st === 'none' ? att.filter(x => x.date === T).pop() || null : null,
    stay: diff(p.admittedOn, T) + 1
  };
}

export const active = S => S.patients.filter(p => p.status === 'admitted').sort((a, b) => a.bed - b.bed);
export function freeBeds(S) {
  const used = {}; active(S).forEach(p => { used[p.bed] = 1; });
  const f = []; for (let i = 1; i <= BEDS; i++) if (!used[i] && !S.cleaning[i]) f.push(i);
  return f;
}
export const cleaningBeds = S => Object.keys(S.cleaning).map(Number).sort((a, b) => a - b);
export function forecast(S) {
  const A = active(S).map(p => [p, analyse(p, S)]);
  return { likely: A.filter(x => x[1].tomorrow === 'likely' && !x[0].hold).length, possible: A.filter(x => x[1].tomorrow === 'possible' && !x[0].hold).length };
}
export function rates(list) {
  const rec = list.filter(p => p.status === 'discharged').length, dead = list.filter(p => p.status === 'deceased').length, n = rec + dead;
  return { rec, dead, n, mort: n ? dead / n * 100 : 0 };
}
// Probability of at least k deaths in n closed cases if the true rate were p (binomial tail).
export function pAtLeast(n, k, p) {
  let s = 0, lc = 0;
  for (let i = 0; i <= n; i++) { if (i > 0) lc += Math.log((n - i + 1) / i); if (i >= k) s += Math.exp(lc + i * Math.log(p) + (n - i) * Math.log(1 - p)); }
  return Math.min(1, s);
}
// Days of hold that overlap the time the patient was eligible; excluded from discharge delay.
export function heldWhileEligible(p, a, today) {
  if (!p.hold || !a.eligibleOn) return 0;
  const from = p.hold.on > a.eligibleOn ? p.hold.on : a.eligibleOn;
  return Math.max(0, diff(from, today));
}
