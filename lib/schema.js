// Tables are created automatically on the first request. Constraints back up the rules in actions.js,
// so a bug or a race in application code still cannot put two patients in one bed.
export const SCHEMA = [
  `create table if not exists settings(
     id int primary key check (id = 1),
     today date not null,
     threshold numeric(3,1) not null check (threshold between 37 and 39),
     tz text not null default 'Asia/Kolkata',
     version bigint not null default 0)`,
  `create table if not exists users(
     id serial primary key, name text not null, role text not null unique check (role in ('nurse','doctor','admin','head')),
     pin_salt text not null, pin_hash text not null, failed int not null default 0, locked_until timestamptz)`,
  `create table if not exists patients(
     id serial primary key,
     name text not null check (length(name) between 2 and 80),
     age int not null check (age between 0 and 120),
     sex text not null check (sex in ('F','M','X')),
     bed int check (bed between 1 and 74),
     admitted_on date not null,
     status text not null check (status in ('admitted','discharged','deceased','transferred','lama')),
     closed_on date, close_note text, eligible_on date, last_bed int,
     readmission_of int references patients(id),
     hold_reason text, hold_by text, hold_on date, hold_reviewed date,
     hold_days int not null default 0,
     check ((status = 'admitted') = (bed is not null)))`,
  `create unique index if not exists one_patient_per_bed on patients(bed) where status = 'admitted'`,
  `create table if not exists readings(
     id serial primary key, patient_id int not null references patients(id),
     date date not null, temp numeric(3,1) not null check (temp between 30 and 45), med boolean not null default false,
     by_name text not null, role text not null, at text not null,
     void boolean not null default false, void_reason text, void_by text,
     corrected_from numeric(3,1), correct_reason text, late boolean not null default false)`,
  `create index if not exists readings_patient on readings(patient_id, date)`,
  `create table if not exists attempts(
     id serial primary key, patient_id int not null references patients(id), date date not null,
     reason text not null, by_name text not null, at text not null)`,
  `create table if not exists visits(
     id serial primary key, patient_id int not null references patients(id), date date not null,
     notes text not null default '', by_name text not null, at text not null, extra boolean not null default false)`,
  `create unique index if not exists one_visit_per_day on visits(patient_id, date) where not extra`,
  `create table if not exists cleaning(bed int primary key check (bed between 1 and 74), since date not null)`,
  `create table if not exists waitlist(
     id serial primary key, name text not null, age int not null check (age between 0 and 120), sex text not null,
     added_on date not null, added_at timestamptz not null default now())`,
  `create table if not exists blocked(day date primary key, n int not null default 0)`,
  `create table if not exists audit(
     id bigserial primary key, day date not null, at text not null, user_name text not null, role text not null,
     action text not null, detail text not null, created_at timestamptz not null default now())`,
  `create table if not exists requests(id text primary key, created_at timestamptz not null default now())`
];
export const DATA_TABLES = 'audit, readings, visits, attempts, cleaning, waitlist, blocked, requests, patients';
