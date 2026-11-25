-- ALAB Student Portal: Supabase schema, row level security and helper functions.
-- Run this once in Supabase > SQL Editor (it is safe to run again).
--
-- Tables (each fact is stored once)
--   subjects      code + description                                   (one row per subject, anyone can read)
--   sections      one class: name, semester, subject, instructor, grading scheme    (anyone can read)
--   students      student number + name + email                        (instructors, for their own students)
--   enrollments   one student in one section: PIN, secret key, scores, acknowledgment   (instructors, own sections)
--   quizzes, quiz_attempts, meta, admins
-- A database set up with the older layout (roster + records) is converted in place by the migration block below; the old
-- tables are kept as roster_old and records_old, and sections.data as sections.legacy_data, so nothing is lost.
--
-- Who can do what
--   anyone (students)   read meta, sections and subjects; read ONE student record, and only by its secret key (get_record)
--   instructors         everything for their own sections, if their account is listed in public.admins
--   nobody from the app can write public.admins: add instructors in the SQL Editor (see the end of this file)

-- ---------------------------------------------------------------- tables
create table if not exists public.meta (
  id      int primary key default 1 check (id = 1),   -- a single row
  title   text not null default '',
  term    text not null default '',
  note    text not null default '',
  salt    text,
  updated timestamptz not null default now()
);

create table if not exists public.subjects (
  code        text primary key check (char_length(code) between 1 and 60),
  description text not null default ''
);

create table if not exists public.sections (
  id           text primary key,
  name         text not null,
  term         text not null default '',                 -- semester, e.g. "2026-2027 1st Semester"; empty counts as the first one
  subject_code text references public.subjects (code) on update cascade,
  instructor   text not null default '',
  room_time    text not null default '',
  headings     jsonb not null default '[]',
  scheme       jsonb not null default '{}',              -- grading categories, items, weights and the grade scale
  owner        uuid default auth.uid() references auth.users (id) on delete set null,   -- only this instructor (and a "super" one) manages it
  updated      timestamptz not null default now()
);
-- a database from before this layout has the old sections table: add the new columns (filled in by the migration below)
alter table public.sections add column if not exists name         text;
alter table public.sections add column if not exists term         text not null default '';
alter table public.sections add column if not exists subject_code text references public.subjects (code) on update cascade;
alter table public.sections add column if not exists instructor   text not null default '';
alter table public.sections add column if not exists room_time    text not null default '';
alter table public.sections add column if not exists headings     jsonb not null default '[]';
alter table public.sections add column if not exists scheme       jsonb not null default '{}';
alter table public.sections add column if not exists owner        uuid default auth.uid() references auth.users (id) on delete set null;
create index if not exists sections_subject_idx on public.sections (subject_code);

create table if not exists public.students (
  student_no text primary key,                           -- the number the student knows, e.g. 2024100934
  name       text not null check (char_length(name) < 200),
  email      text check (email is null or (char_length(email) <= 254 and email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'))
);

create or replace function public.valid_scores(s jsonb) returns boolean
  language sql immutable as $$
  select jsonb_typeof(s) = 'object' and not exists (
    select 1 from jsonb_each(s) e
    where not (jsonb_typeof(e.value) = 'number'
            or (jsonb_typeof(e.value) = 'string' and char_length(e.value #>> '{}') <= 20))
  )
$$;

-- "S1" is the first section of a student; a second section is "S1@<section id>" so its row and secret key stay unique.
-- Only the student number part is the student's.
create or replace function public.student_no_of(p_id text) returns text
  language sql immutable as $$ select split_part(p_id, '@', 1) $$;

create table if not exists public.enrollments (
  login_id     text primary key,                         -- the row id the secret key is made from (see src/lib/keys.js); never shown
  student_no   text not null references public.students (student_no) on update cascade,
  sec          text not null references public.sections (id) on delete cascade on update cascade,
  pin          text not null,
  key          text not null unique,                     -- hash of salt + login id + PIN: the only way a student reaches the record
  scores       jsonb not null default '{}' check (public.valid_scores(scores)),
  acknowledged timestamptz,                              -- when the student pressed "I acknowledge my grade"; cleared when scores change
  emailed      timestamptz,                              -- when the PIN email last went out
  updated      timestamptz not null default now(),
  unique (student_no, sec)
);
create index if not exists enrollments_sec_idx on public.enrollments (sec);
create index if not exists enrollments_student_idx on public.enrollments (student_no);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.admins add column if not exists is_super boolean not null default false;

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- A "super" instructor (set in the SQL editor, see the end of this file) can see and manage every section.
create or replace function public.is_super() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and is_super)
$$;

-- True when the caller is an instructor who owns section p_sec (or is a super instructor).
create or replace function public.can_manage_section(p_sec text) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_admin() and (
    public.is_super()
    or exists (select 1 from public.sections where id = p_sec and owner = auth.uid())
  )
$$;

-- True when the caller manages at least one section this student is enrolled in.
create or replace function public.can_see_student(p_no text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e where e.student_no = p_no and public.can_manage_section(e.sec))
$$;

-- True when an enrollment with this row id / key already belongs to a section the caller cannot manage. Security definer so it
-- can see rows that row level security hides from the caller.
create or replace function public.student_conflict(p_id text, p_key text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e where e.login_id = p_id and not public.can_manage_section(e.sec))
      or exists (select 1 from public.enrollments e where e.key = p_key and not public.can_manage_section(e.sec))
$$;

-- ---------------------------------------------------------------- quizzes (tables)
-- An instructor builds a quiz per section. The questions (with the answers) are readable by instructors only: a student
-- gets the questions WITHOUT the answers from start_quiz, one attempt per student, and the server does the scoring.
create table if not exists public.quizzes (
  id             text primary key,
  sec            text not null references public.sections (id) on delete cascade on update cascade,
  title          text not null check (char_length(title) < 200),
  item_key       text,                                   -- grade item that receives the score (null = do not record)
  item_max       numeric,                                -- that item's maximum score; the quiz score is scaled to it
  questions      jsonb not null default '[]' check (jsonb_typeof(questions) = 'array' and char_length(questions::text) < 200000),
  published      boolean not null default false,
  time_limit     int check (time_limit is null or time_limit between 1 and 600),   -- minutes, enforced by the server
  shuffle        boolean not null default true,          -- questions and choices come in a different order per student
  lockdown       boolean not null default true,          -- tab switches are logged; too many auto-submit the quiz
  max_violations int not null default 3 check (max_violations between 1 and 20),
  updated        timestamptz not null default now()
);
alter table public.quizzes add column if not exists show_answers boolean not null default false;   -- students may review their answers and the key after submitting
create index if not exists quizzes_sec_idx on public.quizzes (sec);

create table if not exists public.quiz_attempts (
  quiz_id    text not null references public.quizzes (id) on delete cascade,
  key        text not null references public.enrollments (key) on delete cascade on update cascade,   -- the student's enrollment
  started    timestamptz not null default now(),         -- set by the server: the time limit counts from here
  submitted  timestamptz,
  points     numeric,
  total      numeric,
  answers    jsonb,
  violations int not null default 0,
  events     jsonb not null default '[]',                -- [{ t (ms), type }]: what the page noticed (tab switch, paste, ...)
  late       boolean not null default false,             -- submitted after the time limit: scored 0
  primary key (quiz_id, key)
);

-- True when the caller manages the section the quiz belongs to.
create or replace function public.can_manage_quiz(p_quiz text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.quizzes q where q.id = p_quiz and public.can_manage_section(q.sec))
$$;

-- ---------------------------------------------------------------- one-time migration from the old layout
-- Runs only while the old public.roster and public.records tables still exist, i.e. once. All-or-nothing: if a check fails the
-- whole block is undone and nothing changes. The old tables are renamed (roster_old, records_old), never dropped.
do $migrate$
declare
  n_roster int; n_skipped int; n_enr int; n_names int; n_attempts int;
begin
  if to_regclass('public.roster') is null or to_regclass('public.records') is null then
    return;
  end if;

  -- 1. sections: move the fields out of the old `data` json; subjects become their own rows
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sections' and column_name = 'data') then
    insert into public.subjects (code, description)
      select x.code, coalesce((
          select t.d from (select btrim(s2.data -> 'subject' ->> 'desc') as d, count(*) as c
                             from public.sections s2
                            where btrim(coalesce(s2.data -> 'subject' ->> 'code', '')) = x.code
                              and btrim(coalesce(s2.data -> 'subject' ->> 'desc', '')) <> ''
                            group by btrim(s2.data -> 'subject' ->> 'desc')) t
           order by t.c desc, t.d limit 1), '')
        from (select distinct btrim(data -> 'subject' ->> 'code') as code from public.sections
               where btrim(coalesce(data -> 'subject' ->> 'code', '')) <> '') x
      on conflict (code) do nothing;
    update public.sections set
        name         = coalesce(nullif(btrim(data ->> 'name'), ''), id),
        term         = coalesce(btrim(data ->> 'term'), ''),
        subject_code = nullif(btrim(data -> 'subject' ->> 'code'), ''),
        instructor   = coalesce(data ->> 'instructor', ''),
        room_time    = coalesce(data ->> 'roomTime', ''),
        headings     = case when jsonb_typeof(data -> 'headings') = 'array' then data -> 'headings' else '[]'::jsonb end,
        scheme       = case when jsonb_typeof(data -> 'scheme') = 'object' then data -> 'scheme' else '{}'::jsonb end
      where name is null;
    alter table public.sections alter column name set not null;
    alter table public.sections rename column data to legacy_data;
    alter table public.sections alter column legacy_data drop not null;
  end if;

  -- 2. students: one row per student number (the roster kept the name once per section, and once more in records)
  select count(*) into n_names from (select public.student_no_of(student_id) as sno from public.roster
                                      group by 1 having count(distinct name) > 1) z;
  if n_names > 0 then
    raise notice 'migration: % student number(s) had different names in different sections; the name from the first section is kept', n_names;
  end if;
  insert into public.students (student_no, name, email)
    select distinct on (t.sno) t.sno, t.name, (select max(r2.email) from public.roster r2 where public.student_no_of(r2.student_id) = t.sno)
      from (select public.student_no_of(student_id) as sno, name, (position('@' in student_id) > 0) as tagged from public.roster
             where exists (select 1 from public.sections s where s.id = public.roster.sec)) t
     order by t.sno, t.tagged, t.name
    on conflict (student_no) do nothing;

  -- 3. enrollments: roster (PIN, key, email status) joined with records (scores, acknowledgment); every key stays the same
  insert into public.enrollments (login_id, student_no, sec, pin, key, scores, acknowledged, emailed, updated)
    select ro.student_id, public.student_no_of(ro.student_id), ro.sec, ro.pin, ro.key,
           coalesce(rc.s, '{}'::jsonb), rc.acknowledged, ro.emailed, coalesce(rc.updated, now())
      from public.roster ro
      left join public.records rc on rc.key = ro.key
     where exists (select 1 from public.sections s where s.id = ro.sec)
    on conflict do nothing;
  select count(*) into n_roster from public.roster;
  select count(*) into n_skipped from public.roster ro where not exists (select 1 from public.sections s where s.id = ro.sec);
  select count(*) into n_enr from public.enrollments;
  if n_skipped > 0 then
    raise notice 'migration: % roster row(s) belonged to a section that no longer exists and were not copied (kept in roster_old)', n_skipped;
  end if;
  if n_enr < n_roster - n_skipped then
    raise exception 'migration check failed: % roster rows (% skipped) but only % enrollments', n_roster, n_skipped, n_enr;
  end if;
  if exists (select 1 from public.enrollments e where e.key not in (select key from public.roster)) and n_enr > n_roster then
    raise notice 'migration: enrollments already held rows that are not in the old roster';
  end if;

  -- 4. quizzes and attempts: real links to sections and enrollments
  delete from public.quizzes q where not exists (select 1 from public.sections s where s.id = q.sec);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quiz_attempts' and column_name = 'student_id') then
    drop policy if exists attempts_read on public.quiz_attempts;
    drop policy if exists attempts_del  on public.quiz_attempts;
    drop policy if exists attempts_upd  on public.quiz_attempts;
    delete from public.quiz_attempts a where not exists (select 1 from public.enrollments e where e.key = a.key);
    alter table public.quiz_attempts drop column sec, drop column student_id, drop column name;
    select count(*) into n_attempts from public.quiz_attempts;
    raise notice 'migration: % quiz attempt(s) kept', n_attempts;
  end if;

  -- 5. the old tables: no policies, no access from the app, kept for safety (they hold PINs and scores)
  drop policy if exists roster_all  on public.roster;
  drop policy if exists records_all on public.records;
  revoke all on public.roster, public.records from anon, authenticated;
  begin
    alter publication supabase_realtime drop table public.roster, public.records;
  exception when others then null;
  end;
  alter table public.roster  rename to roster_old;
  alter table public.records rename to records_old;
  raise notice 'migration done: % students, % enrollments; old tables are now roster_old and records_old', (select count(*) from public.students), n_enr;
end
$migrate$;

-- links that older databases lack
do $links$
begin
  delete from public.quizzes q where not exists (select 1 from public.sections s where s.id = q.sec);
  if not exists (select 1 from pg_constraint where conname = 'quizzes_sec_fkey' and conrelid = 'public.quizzes'::regclass) then
    alter table public.quizzes add constraint quizzes_sec_fkey foreign key (sec) references public.sections (id) on delete cascade on update cascade;
  end if;
  delete from public.quiz_attempts a where not exists (select 1 from public.enrollments e where e.key = a.key);
  if not exists (select 1 from pg_constraint where conname = 'quiz_attempts_key_fkey' and conrelid = 'public.quiz_attempts'::regclass) then
    alter table public.quiz_attempts add constraint quiz_attempts_key_fkey foreign key (key) references public.enrollments (key) on delete cascade on update cascade;
  end if;
end
$links$;

-- Answers saved while a quiz is still open, so a reload, a closed browser or a change of device does not lose them. Nobody can
-- read or write this table directly (it is not part of the instructor's live updates either): only the functions below do.
create table if not exists public.quiz_drafts (
  quiz_id text not null,
  key     text not null,
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and char_length(answers::text) < 20000),
  rev     bigint not null,                               -- counts up with every change, so a late, older save cannot replace a newer one
  updated timestamptz not null default now(),
  primary key (quiz_id, key),
  foreign key (quiz_id, key) references public.quiz_attempts (quiz_id, key) on delete cascade on update cascade
);
alter table public.quiz_drafts enable row level security;
revoke all on public.quiz_drafts from anon, authenticated;

-- ---------------------------------------------------------------- row level security
alter table public.meta          enable row level security;
alter table public.subjects      enable row level security;
alter table public.sections      enable row level security;
alter table public.students      enable row level security;
alter table public.enrollments   enable row level security;
alter table public.quizzes       enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.admins        enable row level security;

drop policy if exists meta_read        on public.meta;
drop policy if exists meta_write       on public.meta;
drop policy if exists subjects_read    on public.subjects;
drop policy if exists sections_read    on public.sections;
drop policy if exists sections_write   on public.sections;
drop policy if exists students_read    on public.students;
drop policy if exists enrollments_read on public.enrollments;
drop policy if exists quizzes_all      on public.quizzes;
drop policy if exists attempts_read    on public.quiz_attempts;
drop policy if exists attempts_del     on public.quiz_attempts;
drop policy if exists attempts_upd     on public.quiz_attempts;
drop policy if exists admins_self      on public.admins;

create policy meta_read        on public.meta        for select to anon, authenticated using (true);
create policy meta_write       on public.meta        for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy subjects_read    on public.subjects    for select to anon, authenticated using (true);
create policy sections_read    on public.sections    for select to anon, authenticated using (true);   -- students see their section's grading scheme
create policy students_read    on public.students    for select to authenticated using (public.can_see_student(student_no));
create policy enrollments_read on public.enrollments for select to authenticated using (public.can_manage_section(sec));
create policy quizzes_all      on public.quizzes     for all    to authenticated using (public.can_manage_section(sec)) with check (public.can_manage_section(sec));
create policy attempts_read    on public.quiz_attempts for select to authenticated using (public.can_manage_quiz(quiz_id));
create policy attempts_del     on public.quiz_attempts for delete to authenticated using (public.can_manage_quiz(quiz_id));
create policy admins_self      on public.admins      for select to authenticated using (user_id = auth.uid());

-- table privileges: RLS above decides which rows; this decides which roles may touch the tables at all.
-- Sections, subjects, students and enrollments can only be changed through the functions below.
revoke all on public.meta, public.subjects, public.sections, public.students, public.enrollments, public.quizzes, public.quiz_attempts, public.admins from anon, authenticated;
grant select on public.meta, public.subjects, public.sections to anon, authenticated;
grant insert, update, delete on public.meta to authenticated;
grant select on public.students, public.enrollments, public.admins to authenticated;
grant select, insert, update, delete on public.quizzes to authenticated;
grant select, delete on public.quiz_attempts to authenticated;

-- ---------------------------------------------------------------- student lookup (no listing possible)
create or replace function public.get_record(p_key text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.login_id, 'name', st.name, 'sec', e.sec, 's', e.scores,
    'updated', (extract(epoch from e.updated) * 1000)::bigint,
    'ack', (extract(epoch from e.acknowledged) * 1000)::bigint)
  from public.enrollments e join public.students st on st.student_no = e.student_no
  where e.key = p_key
$$;

-- A student marks their grade as acknowledged (needs the same secret key as get_record). Returns the time in ms,
-- or null if the key matches no record. Pressing it again keeps the first time.
create or replace function public.acknowledge_grade(p_key text) returns bigint
  language sql security definer set search_path = public as $$
  update public.enrollments set acknowledged = coalesce(acknowledged, now()) where key = p_key
  returning (extract(epoch from acknowledged) * 1000)::bigint
$$;

-- Same as get_record for several keys at once (a student in more than one section has one record per section).
-- Returns only the records whose key matches; at most 50 keys per call, and nothing can be listed.
create or replace function public.get_records(p_keys text[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', e.key, 'id', e.login_id, 'name', st.name, 'sec', e.sec, 's', e.scores,
    'ack', (extract(epoch from e.acknowledged) * 1000)::bigint,
    'updated', (extract(epoch from e.updated) * 1000)::bigint) order by st.name, e.sec), '[]'::jsonb)
  from public.enrollments e join public.students st on st.student_no = e.student_no
  where e.key = any (p_keys[1:50])
$$;

-- ---------------------------------------------------------------- instructor operations (all-or-nothing)
create or replace function public.require_admin() returns void
  language plpgsql stable as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

-- Sets or clears (null) one score without touching the student's other scores.
create or replace function public.set_score(p_key text, p_item text, p_value jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  update public.enrollments
     set scores = case when p_value is null or jsonb_typeof(p_value) = 'null'
                       then scores - p_item
                       else jsonb_set(scores, array[p_item], p_value, true) end,
         acknowledged = null,   -- the grade changed, so an earlier acknowledgment no longer applies
         updated = now()
   where key = p_key and public.can_manage_section(sec);
end $$;

-- Creates or updates sections. p_rows: [{ "id", "name", "term", "headings", "subject": { "code", "desc" }, "instructor", "roomTime", "scheme" }]
-- The subject is stored once (its description is shared by every section with that code). A new section belongs to the caller.
create or replace function public.save_sections(p_rows jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id text; v_code text;
begin
  perform public.require_admin();
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows must be a list'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := r ->> 'id';
    if coalesce(v_id, '') = '' then raise exception 'section id missing'; end if;
    if exists (select 1 from public.sections where id = v_id) and not public.can_manage_section(v_id) then
      raise exception 'not allowed: that section belongs to another instructor' using errcode = '42501';
    end if;
    v_code := nullif(btrim(r #>> '{subject,code}'), '');
    if v_code is not null then
      insert into public.subjects (code, description) values (v_code, coalesce(btrim(r #>> '{subject,desc}'), ''))
        on conflict (code) do update
          set description = case when excluded.description <> '' then excluded.description else subjects.description end;
    end if;
    insert into public.sections (id, name, term, subject_code, instructor, room_time, headings, scheme, owner, updated)
      values (v_id, coalesce(nullif(btrim(r ->> 'name'), ''), v_id), coalesce(btrim(r ->> 'term'), ''), v_code,
              coalesce(r ->> 'instructor', ''), coalesce(r ->> 'roomTime', ''),
              coalesce(r -> 'headings', '[]'::jsonb), coalesce(r -> 'scheme', '{}'::jsonb), auth.uid(), now())
    on conflict (id) do update
      set name = excluded.name, term = excluded.term, subject_code = excluded.subject_code, instructor = excluded.instructor,
          room_time = excluded.room_time, headings = excluded.headings, scheme = excluded.scheme, updated = now();
  end loop;
  delete from public.subjects s where not exists (select 1 from public.sections x where x.subject_code = s.code);
end $$;

-- p_rows: [{ "id" (row id), "name", "sec", "pin", "key", "s" (optional scores) }]
create or replace function public.upsert_students(p_rows jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if exists (select 1 from jsonb_array_elements(p_rows) r where not public.can_manage_section(r ->> 'sec')) then
    raise exception 'not allowed: that section belongs to another instructor' using errcode = '42501';
  end if;
  -- never overwrite another instructor's student (row ids and keys are shared across the whole database)
  if exists (select 1 from jsonb_array_elements(p_rows) r where public.student_conflict(r ->> 'id', r ->> 'key')) then
    raise exception 'not allowed: that student number is already used by another instructor' using errcode = '42501';
  end if;
  insert into public.students (student_no, name)
    select distinct on (public.student_no_of(r ->> 'id')) public.student_no_of(r ->> 'id'), r ->> 'name'
      from jsonb_array_elements(p_rows) r
     order by public.student_no_of(r ->> 'id')
  on conflict (student_no) do update set name = excluded.name
    where not exists (select 1 from public.enrollments e where e.student_no = students.student_no and not public.can_manage_section(e.sec));
  insert into public.enrollments (login_id, student_no, sec, pin, key, scores, updated)
    select r ->> 'id', public.student_no_of(r ->> 'id'), r ->> 'sec', r ->> 'pin', r ->> 'key', coalesce(r -> 's', '{}'::jsonb), now()
      from jsonb_array_elements(p_rows) r
  on conflict (login_id) do update
    set student_no = excluded.student_no, sec = excluded.sec, pin = excluded.pin, key = excluded.key,
        scores = excluded.scores, updated = now(),
        acknowledged = case when enrollments.scores is distinct from excluded.scores then null else enrollments.acknowledged end;
end $$;

-- p_rows: [{ "id" (row id), "key" }]. Students left without any section are removed too.
create or replace function public.delete_students(p_rows jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if exists (select 1 from jsonb_array_elements(p_rows) r where public.student_conflict(r ->> 'id', r ->> 'key')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.enrollments
   where key in (select r ->> 'key' from jsonb_array_elements(p_rows) r)
      or login_id in (select r ->> 'id' from jsonb_array_elements(p_rows) r);
  delete from public.students st
   where st.student_no in (select public.student_no_of(r ->> 'id') from jsonb_array_elements(p_rows) r)
     and not exists (select 1 from public.enrollments e where e.student_no = st.student_no);
end $$;

-- Which of these row ids already belong to a section the caller does not manage? The same student can be in two instructors'
-- sections: the student row (number + name) is shared, but each enrollment has its own row id, PIN, key and scores, so the app
-- gives the second instructor's enrollment a different row id ("<number>@<section id>").
create or replace function public.taken_login_ids(p_ids jsonb) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return (select coalesce(jsonb_agg(e.login_id), '[]'::jsonb) from public.enrollments e
           where e.login_id in (select jsonb_array_elements_text(p_ids)) and not public.can_manage_section(e.sec));
end $$;

-- Gives a student a new PIN (and therefore a new key) and keeps their scores and quiz attempts.
create or replace function public.reset_pin(p_id text, p_old_key text, p_new_key text, p_pin text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if not coalesce(public.can_manage_section((select sec from public.enrollments where login_id = p_id)), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.enrollments set pin = p_pin, key = p_new_key, emailed = null, updated = now() where login_id = p_id;
end $$;

-- p_rows: [{ "id" (row id), "email" }]; an empty or null email clears it. The email belongs to the student.
create or replace function public.set_student_emails(p_rows jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  -- a changed address means the PIN has not been emailed to it yet
  update public.enrollments e
     set emailed = case when lower(coalesce(nullif(btrim(r ->> 'email'), ''), '')) = lower(coalesce(st.email, '')) then e.emailed else null end
    from jsonb_array_elements(p_rows) r, public.students st
   where e.login_id = r ->> 'id' and st.student_no = e.student_no and public.can_manage_section(e.sec);
  update public.students st
     set email = nullif(btrim(r ->> 'email'), '')
    from jsonb_array_elements(p_rows) r join public.enrollments e on e.login_id = r ->> 'id'
   where st.student_no = e.student_no and public.can_manage_section(e.sec);
end $$;

-- p_ids: ["row id", ...]; called after the PIN email was sent
create or replace function public.mark_emailed(p_ids jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  update public.enrollments set emailed = now()
   where login_id in (select jsonb_array_elements_text(p_ids)) and public.can_manage_section(sec);
end $$;

-- Deletes a section together with its enrollments, quizzes and scores. Returns how many students were enrolled in it.
create or replace function public.delete_section(p_id text) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_admin();
  if not public.can_manage_section(p_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select count(*) into n from public.enrollments where sec = p_id;
  delete from public.sections where id = p_id;   -- enrollments, quizzes and attempts go with it
  delete from public.students st where not exists (select 1 from public.enrollments e where e.student_no = st.student_no);
  delete from public.subjects s where not exists (select 1 from public.sections x where x.subject_code = s.code);
  return n;
end $$;

-- ---------------------------------------------------------------- quiz functions
-- Published quizzes of the student's section: no questions and no answers, only what is needed to list them.
create or replace function public.get_quizzes(p_key text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'title', q.title, 'count', jsonb_array_length(q.questions),
    'total', (select coalesce(sum(coalesce((x ->> 'points')::numeric, 1)), 0) from jsonb_array_elements(q.questions) x),
    'timeLimit', q.time_limit, 'lockdown', q.lockdown, 'maxViolations', q.max_violations, 'showAnswers', q.show_answers,
    'started', (extract(epoch from a.started) * 1000)::bigint,
    'submitted', (extract(epoch from a.submitted) * 1000)::bigint,
    'points', a.points, 'attemptTotal', a.total, 'late', a.late) order by q.updated, q.title), '[]'::jsonb)
  from public.enrollments r
  join public.quizzes q on q.sec = r.sec and q.published
  left join public.quiz_attempts a on a.quiz_id = q.id and a.key = r.key
  where r.key = p_key
$$;

-- A student's own answers next to the right ones, question by question. Only when the instructor turned on "show correct
-- answers" for the quiz, only after the student submitted in time, and only for the student who holds the key.
create or replace function public.quiz_review(p_key text, p_quiz text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when q.show_answers and a.submitted is not null and not a.late then
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x ->> 'id', 'type', x ->> 'type', 'text', x ->> 'text', 'choices', x -> 'choices',
        'points', coalesce((x ->> 'points')::numeric, 1), 'answer', x -> 'answer', 'yours', a.answers -> (x ->> 'id'),
        'right', coalesce(a.answers -> (x ->> 'id') = x -> 'answer', false)) order by ord), '[]'::jsonb)
       from jsonb_array_elements(q.questions) with ordinality t(x, ord))
  end
  from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id
  where a.quiz_id = p_quiz and a.key = p_key
$$;

-- Starts (or resumes) the student's one attempt and returns the questions WITHOUT their answers. The clock starts here.
create or replace function public.start_quiz(p_key text, p_quiz text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r public.enrollments; q public.quizzes; a public.quiz_attempts; d public.quiz_drafts; left_ms bigint;
begin
  select * into r from public.enrollments where key = p_key;
  select * into q from public.quizzes where id = p_quiz and published and sec = r.sec;
  if r.key is null or q.id is null then raise exception 'quiz not available' using errcode = 'P0002'; end if;
  select * into a from public.quiz_attempts where quiz_id = q.id and key = r.key;
  if a.quiz_id is not null and a.submitted is not null then raise exception 'already submitted' using errcode = 'P0001'; end if;
  if a.quiz_id is null then
    -- two starts at the same moment: one creates the attempt, the other just reads it
    insert into public.quiz_attempts (quiz_id, key) values (q.id, r.key) on conflict (quiz_id, key) do nothing;
    select * into a from public.quiz_attempts where quiz_id = q.id and key = r.key;
    if a.submitted is not null then raise exception 'already submitted' using errcode = 'P0001'; end if;
  end if;
  select * into d from public.quiz_drafts where quiz_id = q.id and key = r.key;
  left_ms := case when q.time_limit is null then null
                  else greatest(0, (extract(epoch from (a.started + make_interval(mins => q.time_limit) - now())) * 1000)::bigint) end;
  return jsonb_build_object(
    'id', q.id, 'title', q.title, 'remainingMs', left_ms, 'violations', a.violations,
    'started', (extract(epoch from a.started) * 1000)::bigint, 'draft', d.answers, 'draftRev', coalesce(d.rev, 0),
    'timeLimit', q.time_limit, 'lockdown', q.lockdown, 'maxViolations', q.max_violations, 'shuffle', q.shuffle,
    'questions', (select coalesce(jsonb_agg(x - 'answer' order by ord), '[]'::jsonb) from jsonb_array_elements(q.questions) with ordinality t(x, ord)));
end $$;

-- The page tells the server what it noticed (switching tabs, pasting, ...). Returns the running count, null if there is nothing open.
create or replace function public.log_quiz_event(p_key text, p_quiz text, p_type text) returns int
  language sql security definer set search_path = public as $$
  update public.quiz_attempts
     set violations = violations + 1,
         events = case when jsonb_array_length(events) < 100
                       then events || jsonb_build_array(jsonb_build_object('t', (extract(epoch from now()) * 1000)::bigint, 'type', left(coalesce(p_type, ''), 30)))
                       else events end
   where key = p_key and quiz_id = p_quiz and submitted is null
  returning violations
$$;

-- Saves the answers of an attempt that is still open and within its time. Returns the newest revision stored (higher than p_rev
-- when another device is ahead), or null when there is nothing open to save to. It never changes the score or the clock.
create or replace function public.save_quiz_answers(p_key text, p_quiz text, p_answers jsonb, p_rev bigint) returns bigint
  language plpgsql security definer set search_path = public as $$
declare a public.quiz_attempts; v_limit int; v_rev bigint;
begin
  -- `for share`: a save arriving while the same attempt is being submitted waits, then sees it is closed
  select * into a from public.quiz_attempts where quiz_id = p_quiz and key = p_key for share;
  if a.quiz_id is null or a.submitted is not null then return null; end if;
  select time_limit into v_limit from public.quizzes where id = p_quiz;
  if v_limit is not null and now() > a.started + make_interval(mins => v_limit) + interval '30 seconds' then return null; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or p_rev is null then return null; end if;
  insert into public.quiz_drafts as d (quiz_id, key, answers, rev) values (p_quiz, p_key, p_answers, p_rev)
  on conflict (quiz_id, key) do update set answers = excluded.answers, rev = excluded.rev, updated = now()
    where d.rev < excluded.rev;
  select rev into v_rev from public.quiz_drafts where quiz_id = p_quiz and key = p_key;
  return v_rev;
end $$;

-- Scores the answers on the server ({ questionId: choice index | true | false }) and puts the result in the grade item.
-- After the time limit (30 seconds of grace for the network) the attempt is recorded as late and scores 0.
create or replace function public.submit_quiz(p_key text, p_quiz text, p_answers jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare q public.quizzes; a public.quiz_attempts; pts numeric := 0; tot numeric := 0; is_late boolean; shown numeric; rev jsonb;
begin
  -- `for update` locks the attempt: a second submit arriving at the same moment waits, then sees it is already submitted
  select * into a from public.quiz_attempts where quiz_id = p_quiz and key = p_key for update;
  if a.quiz_id is null then raise exception 'not started' using errcode = 'P0002'; end if;
  if a.submitted is not null then raise exception 'already submitted' using errcode = 'P0001'; end if;
  select * into q from public.quizzes where id = p_quiz;
  if jsonb_typeof(p_answers) is distinct from 'object' then p_answers := '{}'::jsonb; end if;
  is_late := q.time_limit is not null and now() > a.started + make_interval(mins => q.time_limit) + interval '30 seconds';
  select coalesce(sum(coalesce((x ->> 'points')::numeric, 1)), 0),
         coalesce(sum(case when not is_late and p_answers -> (x ->> 'id') = x -> 'answer' then coalesce((x ->> 'points')::numeric, 1) else 0 end), 0)
    into tot, pts from jsonb_array_elements(q.questions) x;
  update public.quiz_attempts set submitted = now(), points = pts, total = tot, late = is_late, answers = p_answers
   where quiz_id = p_quiz and key = p_key;
  delete from public.quiz_drafts where quiz_id = p_quiz and key = p_key;
  if q.item_key is not null and q.item_max is not null and tot > 0 then
    shown := round(pts / tot * q.item_max, 2);
    update public.enrollments set scores = jsonb_set(scores, array[q.item_key], to_jsonb(shown)), acknowledged = null, updated = now() where key = p_key;
  end if;
  rev := public.quiz_review(p_key, p_quiz);
  return jsonb_build_object('points', pts, 'total', tot, 'late', is_late, 'score', shown, 'review', rev);
end $$;

-- Lets a student take a quiz again: removes the attempt and the score it wrote.
create or replace function public.reset_quiz_attempt(p_quiz text, p_key text) returns void
  language plpgsql security definer set search_path = public as $$
declare q public.quizzes;
begin
  perform public.require_admin();
  select * into q from public.quizzes where id = p_quiz;
  if q.id is null or not public.can_manage_section(q.sec) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.quiz_attempts where quiz_id = p_quiz and key = p_key;
  if q.item_key is not null then
    update public.enrollments set scores = scores - q.item_key, acknowledged = null, updated = now() where key = p_key and sec = q.sec;
  end if;
end $$;

-- Removes every quiz attempt of a section (used by "Clear all scores", so students can retake those quizzes).
create or replace function public.clear_quiz_attempts(p_sec text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if not public.can_manage_section(p_sec) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.quiz_attempts where quiz_id in (select id from public.quizzes where sec = p_sec);
end $$;

revoke execute on function public.save_quiz_answers(text, text, jsonb, bigint), public.quiz_review(text, text), public.get_quizzes(text), public.start_quiz(text, text), public.log_quiz_event(text, text, text),
  public.submit_quiz(text, text, jsonb), public.reset_quiz_attempt(text, text), public.clear_quiz_attempts(text) from public, anon, authenticated;
grant execute on function public.save_quiz_answers(text, text, jsonb, bigint), public.quiz_review(text, text), public.get_quizzes(text), public.start_quiz(text, text), public.log_quiz_event(text, text, text),
  public.submit_quiz(text, text, jsonb) to anon, authenticated;
grant execute on function public.reset_quiz_attempt(text, text), public.clear_quiz_attempts(text) to authenticated;

revoke execute on function
  public.get_record(text), public.get_records(text[]), public.acknowledge_grade(text), public.is_admin(), public.require_admin(), public.set_score(text, text, jsonb),
  public.save_sections(jsonb), public.upsert_students(jsonb), public.delete_students(jsonb), public.reset_pin(text, text, text, text),
  public.delete_section(text), public.set_student_emails(jsonb), public.mark_emailed(jsonb), public.taken_login_ids(jsonb)
  from public, anon, authenticated;
grant execute on function public.get_record(text), public.get_records(text[]), public.acknowledge_grade(text) to anon, authenticated;
revoke execute on function public.is_super(), public.can_manage_section(text), public.can_manage_quiz(text), public.can_see_student(text), public.student_conflict(text, text) from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_super(), public.can_manage_section(text), public.can_manage_quiz(text), public.can_see_student(text), public.student_conflict(text, text) to authenticated;
grant execute on function
  public.require_admin(), public.set_score(text, text, jsonb), public.save_sections(jsonb), public.upsert_students(jsonb),
  public.delete_students(jsonb), public.reset_pin(text, text, text, text), public.delete_section(text),
  public.set_student_emails(jsonb), public.mark_emailed(jsonb), public.taken_login_ids(jsonb)
  to authenticated;

-- ---------------------------------------------------------------- live updates for the instructor screens
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.meta;          exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.subjects;      exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.sections;      exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.students;      exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.enrollments;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.quizzes;       exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.quiz_attempts; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------- make an instructor
-- 1. Register on the site's instructor page (and confirm the email if Supabase asks you to).
-- 2. Run this with that email. It does nothing if the account does not exist yet.
insert into public.admins (user_id)
  select id from auth.users where lower(email) = lower('aedgardominic@gmail.com')
on conflict do nothing;

-- Sections that have no owner yet belong to this account. (Only this: running this file again never gives anyone more access.)
update public.sections set owner = (select id from auth.users where lower(email) = lower('aedgardominic@gmail.com'))
  where owner is null;

-- Every instructor sees only the sections they own, and the students enrolled in them. Nobody is a "super" instructor unless you
-- make them one by hand, which shows them every instructor's sections, PINs and scores:
--   update public.admins set is_super = true  where user_id = (select id from auth.users where lower(email) = lower('someone@example.com'));
-- and takes it away again:
--   update public.admins set is_super = false where user_id = (select id from auth.users where lower(email) = lower('someone@example.com'));
-- To hand a section to another instructor (for example one that was copied from theirs):
--   update public.sections set owner = (select id from auth.users where lower(email) = lower('them@example.com')) where id = 'the-section-id';
