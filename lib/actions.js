// Every change to the ward goes through here. Each action re-checks permissions and rules on the server.
import * as R from '../public/rules.js';
import { bad, conflict, ApiError } from './http.js';
import { resetData } from './seed.js';

const days = n => n + (n === 1 ? ' day' : ' days');
const NAME_RE = /^[A-Za-zÀ-ɏऀ-ॿ .'-]+$/;

export async function runAction(q, S, user, b) {
  const clock = R.clockIn(S.tz), T = S.today;
  const need = a => { if (!R.can(user.role, a)) throw new ApiError(403, R.ROLES[user.role] + ' cannot do this.'); };
  const log = (action, detail) => q(`insert into audit(day, at, user_name, role, action, detail) values ($1,$2,$3,$4,$5,$6)`, [T, clock, user.name, R.ROLES[user.role], action, detail]);
  const pat = () => {
    const p = S.patients.find(x => x.id === +b.id);
    if (!p || p.status !== 'admitted') throw conflict('This patient is no longer admitted.', { close: true });
    return p;
  };
  const sameDay = () => { if (b.day && b.day !== T) throw conflict('The day changed while this form was open. Open it again to record for today.', { close: true }); };
  const freeBed = (bed, reopen) => { if (!R.freeBeds(S).includes(+bed)) throw conflict('Bed ' + bed + ' was just taken or is being cleaned. Pick another bed.', { reopen }); };
  const closeCase = async (p, status, note) => {
    const a = R.analyse(p, S), held = (p.holdDays || 0) + R.heldWhileEligible(p, a, T);
    await q(`update patients set status=$2, closed_on=$3, eligible_on=$4, close_note=$5, last_bed=bed, bed=null,
             hold_reason=null, hold_by=null, hold_on=null, hold_reviewed=null, hold_days=$6 where id=$1`, [p.id, status, T, a.eligibleOn, note || null, held]);
    await q(`insert into cleaning(bed, since) values ($1,$2) on conflict (bed) do update set since = excluded.since`, [p.bed, T]);
    return { bed: p.bed, a };
  };

  switch (b.type) {
    case 'temp': {
      need('temp'); const p = pat();
      const mode = ['new', 'correct', 'remove'].includes(b.mode) ? b.mode : 'new';
      let date = T, late = false;
      if (b.day !== T) {
        if (b.offline && mode === 'new' && b.day === R.addDays(T, -1) && b.day >= p.admittedOn) { date = b.day; late = true; }
        else sameDay();
      }
      const rs = p.readings.filter(r => r.date === date && !r.void), last = rs[rs.length - 1];
      if (!b.offline && +b.seen !== rs.length) throw conflict('Someone recorded a reading for this patient just now. Check it before adding another.', { reopen: true });
      const before = R.analyse(p, S), reason = String(b.reason || '').trim();
      let msg;
      if (mode === 'remove') {
        if (!last) throw bad('There is no reading to remove.');
        if (reason.length < 5) throw bad('Say why the reading is being removed.');
        await q(`update readings set void=true, void_reason=$2, void_by=$3 where id=$1`, [last.id, reason, user.name]);
        last.void = true;
        await log('Reading removed', `Bed ${p.bed} ${p.name}: ${last.temp.toFixed(1)} °C. ${reason}`);
        msg = 'Reading removed from bed ' + p.bed + '.';
      } else {
        const r = R.parseTemp(b.temp); if (r.err) throw bad(r.err);
        if (mode === 'correct') {
          if (!last) throw bad('There is no reading to correct.');
          if (r.t === last.temp) throw bad('That is the same value as the saved reading. Nothing to correct.');
          if (reason.length < 5) throw bad('Give a short reason for the correction.');
        }
        if (r.unusual && !b.confirm) throw bad(r.t.toFixed(1) + ' °C is outside the usual range. Re-measure, then tick the box to save.', { reveal: 'unusualBox' });
        if (mode === 'correct') {
          await q(`update readings set temp=$2, med=$3, corrected_from=$4, correct_reason=$5 where id=$1`, [last.id, r.t, !!b.med, last.temp, reason]);
          await log('Reading corrected', `Bed ${p.bed} ${p.name}: ${last.temp.toFixed(1)} to ${r.t.toFixed(1)} °C. ${reason}`);
          last.temp = r.t; last.med = !!b.med;
        } else {
          const role = user.role === 'nurse' ? 'nurse' : 'doctor';
          await q(`insert into readings(patient_id, date, temp, med, by_name, role, at, late) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [p.id, date, r.t, !!b.med, user.name, role, clock, late]);
          p.readings.push({ date, temp: r.t, med: !!b.med });
          await log(rs.length ? 'Extra reading recorded' : 'Temperature recorded', `Bed ${p.bed} ${p.name}: ${r.t.toFixed(1)} °C` + (b.med ? ', fever reducer given' : '') + (role === 'doctor' ? ' (recorded by doctor)' : '') + (late ? ', synced late from an offline device' : ''));
        }
        msg = 'Saved ' + r.t.toFixed(1) + ' °C for bed ' + p.bed + '.' + (late ? ' Synced from an offline device.' : '');
      }
      const now = R.analyse(p, S);
      if (before.eligible && !now.eligible) msg += ' Fever recorded: removed from the discharge queue.';
      else if (!before.eligible && now.eligible) msg += ' Back in the discharge queue.';
      else if (now.today.st === 'masked') msg += ' Today will not count as fever-free because a fever reducer was given.';
      else if (now.tomorrow === 'likely') msg += ' Third fever-free day so far: joins the discharge queue tomorrow morning if it holds.';
      else if (now.today.st === 'fever' && before.streak > 0) msg += ' Fever-free count restarts.';
      return msg;
    }
    case 'unable': {
      need('temp'); const p = pat();
      if (!R.UNABLE_REASONS.includes(b.reason)) throw bad('Choose a reason from the list.');
      await q(`insert into attempts(patient_id, date, reason, by_name, at) values ($1,$2,$3,$4,$5)`, [p.id, T, b.reason, user.name, clock]);
      await log('Could not measure', `Bed ${p.bed} ${p.name}: ${b.reason}`);
      return 'Noted for bed ' + p.bed + '. It stays on the To measure list.';
    }
    case 'blocked': {
      need('visit');
      await q(`insert into blocked(day, n) values ($1, 1) on conflict (day) do update set n = blocked.n + 1`, [T]);
      return '';
    }
    case 'visit': {
      need('visit'); const p = pat(); sameDay(); const a = R.analyse(p, S);
      if (!a.today.o) throw bad('Today\'s temperature has not been recorded yet.');
      const notes = String(b.notes || '').trim().slice(0, 500), extra = a.visits.length > 0;
      if (extra && !notes) throw bad('Write the note you want to add.');
      await q(`insert into visits(patient_id, date, notes, by_name, at, extra) values ($1,$2,$3,$4,$5,$6)`, [p.id, T, notes, user.name, clock, extra]);
      await log(extra ? 'Visit note added' : 'Visit logged', `Bed ${p.bed} ${p.name}`);
      return extra ? 'Note added for bed ' + p.bed + '.' : 'Visit logged for bed ' + p.bed + '.';
    }
    case 'admit': {
      need('admit');
      const name = String(b.name || '').trim().replace(/\s+/g, ' '), age = String(b.age || '').trim(), sex = ['F', 'M', 'X'].includes(b.sex) ? b.sex : null;
      const wid = b.wid ? +b.wid : null, toWaitlist = !b.bed;
      if (name.length < 2) throw bad('Enter the patient\'s full name.');
      if (!NAME_RE.test(name)) throw bad('The name can contain letters, spaces, dots, apostrophes and hyphens only.');
      if (!/^\d{1,3}$/.test(age) || +age > 120) throw bad('Enter an age between 0 and 120.');
      if (!sex) throw bad('Choose the patient\'s sex.');
      const same = x => x.name.toLowerCase() === name.toLowerCase() && x.age === +age;
      if ((R.active(S).some(same) || S.waitlist.some(x => same(x) && x.id !== wid)) && !b.confirm)
        throw bad('Possible duplicate. Check the patient list, then tick the box to continue.', { reveal: 'dupBox' });
      if (toWaitlist) {
        if (R.freeBeds(S).length) throw conflict('A bed has just become free. Admit the patient directly.', { reopen: true });
        await q(`insert into waitlist(name, age, sex, added_on) values ($1,$2,$3,$4)`, [name, +age, sex, T]);
        await log('Added to waiting list', name);
        return name + ' added to the waiting list at position ' + (S.waitlist.length + 1) + '.';
      }
      freeBed(b.bed, true);
      const prev = S.patients.filter(x => x.status === 'discharged' && same(x)).sort((x, y) => x.closedOn < y.closedOn ? 1 : -1)[0];
      if (prev && !['yes', 'no'].includes(b.ret)) throw bad(name + ' was discharged on ' + prev.closedOn + '. Say whether this is the same person.', { reveal: 'retBox' });
      await q(`insert into patients(name, age, sex, bed, admitted_on, status, readmission_of) values ($1,$2,$3,$4,$5,'admitted',$6)`,
        [name, +age, sex, +b.bed, T, prev && b.ret === 'yes' ? prev.id : null]);
      if (wid) await q('delete from waitlist where id = $1', [wid]);
      await log(prev && b.ret === 'yes' ? 'Patient readmitted' : 'Patient admitted', `${name} to bed ${b.bed}` + (wid ? ' from the waiting list' : ''));
      return name + ' admitted to bed ' + b.bed + '.' + (prev && b.ret === 'yes' ? ' Flagged as a readmission.' : '');
    }
    case 'unwait': {
      need('admit'); const w = S.waitlist.find(x => x.id === +b.wid);
      if (!w) throw conflict('That person is no longer on the waiting list.', { close: true });
      await q('delete from waitlist where id = $1', [w.id]); await log('Removed from waiting list', w.name);
      return w.name + ' removed from the waiting list.';
    }
    case 'discharge': {
      need('discharge'); const p = pat(), a = R.analyse(p, S);
      if (p.hold) throw conflict('A doctor placed a medical hold: ' + p.hold.reason + '. It must be released first.', { close: true });
      if (!a.eligible) throw conflict('This patient no longer meets the 3-day fever-free criterion.', { close: true });
      const r = await closeCase(p, 'discharged');
      await log('Patient discharged', `${p.name} from bed ${r.bed} after ${days(a.stay)}` + (a.waiting ? ` (${days(a.waiting)} after becoming eligible)` : ''));
      return p.name + ' discharged. Bed ' + r.bed + ' is being cleaned.';
    }
    case 'death': {
      need('exit'); const p = pat(), note = String(b.note || '').trim();
      if (note.length < 5) throw bad('Enter the time and cause of death.');
      if (!b.confirm) throw bad('Tick the confirmation box to continue.');
      const r = await closeCase(p, 'deceased', note); await log('Death recorded', `${p.name}, bed ${r.bed}. ${note}`);
      return 'Death recorded. Bed ' + r.bed + ' is being cleaned.';
    }
    case 'exit': {
      need('exit'); const p = pat(), note = String(b.note || '').trim();
      if (!['transferred', 'lama'].includes(b.kind)) throw bad('Choose the outcome.');
      if (note.length < 5) throw bad('Add the details: where the patient went, or why they left.');
      const r = await closeCase(p, b.kind, note); await log(R.OUTCOME[b.kind], `${p.name}, bed ${r.bed}. ${note}`);
      return p.name + ': ' + R.OUTCOME[b.kind].toLowerCase() + '. Not counted in recovery or mortality.';
    }
    case 'hold': {
      need('hold'); const p = pat(), reason = String(b.reason || '').trim();
      if (p.hold) throw conflict('This patient is already on hold.', { close: true });
      if (reason.length < 5) throw bad('Give the reason for the hold.');
      await q('update patients set hold_reason=$2, hold_by=$3, hold_on=$4, hold_reviewed=null where id=$1', [p.id, reason, user.name, T]);
      await log('Medical hold placed', `Bed ${p.bed} ${p.name}: ${reason}`);
      return 'Hold placed on bed ' + p.bed + '.';
    }
    case 'renew': {
      need('hold'); const p = pat(); if (!p.hold) throw conflict('This patient has no hold.', { close: true });
      await q('update patients set hold_reviewed=$2 where id=$1', [p.id, T]); await log('Medical hold kept', `Bed ${p.bed} ${p.name}: ${p.hold.reason}`);
      return 'Hold kept for bed ' + p.bed + '. It comes up for review again tomorrow.';
    }
    case 'release': {
      need('hold'); const p = pat(); if (!p.hold) throw conflict('This patient has no hold.', { close: true });
      const a = R.analyse(p, S);
      await q('update patients set hold_reason=null, hold_by=null, hold_on=null, hold_reviewed=null, hold_days=hold_days+$2 where id=$1', [p.id, R.heldWhileEligible(p, a, T)]);
      await log('Medical hold released', `Bed ${p.bed} ${p.name}`);
      return 'Hold released for bed ' + p.bed + '.' + (a.eligible ? ' The patient is back in the discharge queue.' : '');
    }
    case 'move': {
      need('beds'); const p = pat(); freeBed(b.bed, true);
      await q('update patients set bed=$2 where id=$1', [p.id, +b.bed]);
      await q(`insert into cleaning(bed, since) values ($1,$2) on conflict (bed) do update set since = excluded.since`, [p.bed, T]);
      await log('Patient moved', `${p.name} from bed ${p.bed} to bed ${b.bed}`);
      return p.name + ' moved to bed ' + b.bed + '. Bed ' + p.bed + ' is being cleaned.';
    }
    case 'clean': {
      need('beds'); if (!S.cleaning[+b.bed]) throw conflict('That bed is not waiting for cleaning.', { close: true });
      await q('delete from cleaning where bed=$1', [+b.bed]); await log('Bed marked clean', 'Bed ' + b.bed);
      return 'Bed ' + b.bed + ' is free.' + (S.waitlist.length ? ' Next on the waiting list: ' + S.waitlist[0].name + '.' : '');
    }
    case 'reopen': {
      need('reopen'); const p = S.patients.find(x => x.id === +b.id), reason = String(b.reason || '').trim();
      if (!p || p.status === 'admitted') throw conflict('This case is already open.', { close: true });
      if (reason.length < 5) throw bad('Give the reason for reopening.');
      freeBed(b.bed, true);
      await q(`update patients set status='admitted', bed=$2, closed_on=null, close_note=null where id=$1`, [p.id, +b.bed]);
      await log('Case reopened', `${p.name}, was "${R.OUTCOME[p.status]}", now in bed ${b.bed}. ${reason}`);
      return p.name + ' is admitted again in bed ' + b.bed + '.';
    }
    case 'settings': {
      need('settings'); const v = String(b.thr || '').trim().replace(',', '.');
      if (!/^\d{2}(\.\d)?$/.test(v) || +v < 37 || +v > 39) throw bad('Enter a threshold between 37.0 and 39.0 °C.');
      const count = thr => R.active(S).filter(p => R.analyse(p, { ...S, threshold: thr }).eligible).length;
      const before = count(S.threshold), after = count(+v);
      await q('update settings set threshold=$1 where id=1', [+v]);
      await log('Fever threshold changed', `${S.threshold.toFixed(1)} to ${(+v).toFixed(1)} °C. Discharge-ready patients: ${before} to ${after}`);
      return 'Threshold set to ' + (+v).toFixed(1) + ' °C. Ready for discharge: ' + before + ' to ' + after + '.';
    }
    case 'next': case 'nextday': {
      if (b.fill) for (const p of R.active(S)) {
        const a = R.analyse(p, S);
        if (!a.today.o) {
          const hot = a.last && (a.last.st === 'fever' ? Math.random() < .85 : (!a.eligible && Math.random() < .25));
          await q(`insert into readings(patient_id, date, temp, med, by_name, role, at) values ($1,$2,$3,false,'Example value','example','18:00')`,
            [p.id, T, Math.round((hot ? 38.1 + Math.random() * 1.3 : 36.4 + Math.random() * 1.1) * 10) / 10]);
        }
        if (!a.visits.length) await q(`insert into visits(patient_id, date, notes, by_name, at) values ($1,$2,'Example visit.','Example value','19:00')`, [p.id, T]);
      }
      await q(`update settings set today = today + 1 where id = 1`);
      await log('Demo day moved forward', 'To ' + R.addDays(T, 1));
      return 'Now showing ' + R.addDays(T, 1) + '.';
    }
    case 'reset': {
      await resetData(q);
      await q(`insert into audit(day, at, user_name, role, action, detail) select today, $1, $2, $3, 'Demo reset', 'Example ward restored' from settings`, [clock, user.name, R.ROLES[user.role]]);
      return 'Demo data reset.';
    }
    default: throw bad('Unknown action.');
  }
}
