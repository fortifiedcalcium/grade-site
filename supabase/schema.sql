-- Grade Portal: Supabase schema, row level security and helper functions.
-- Run this once in Supabase > SQL Editor (it is safe to run again).
--
-- Who can do what
--   anyone (students)   read meta + sections; read ONE student record, and only by its secret key (get_record)
--   instructors         everything, if their account is listed in public.admins
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

create table if not exists public.sections (
  id      text primary key,
  data    jsonb not null,                              -- name, subject, instructor, grading scheme, ...
  updated timestamptz not null default now()
);

-- who owns a section: only that instructor (and a "super" instructor) can see or change its students and scores
alter table public.sections add column if not exists owner uuid default auth.uid() references auth.users (id) on delete set null;

create table if not exists public.roster (
  student_id text primary key,
  name       text not null check (char_length(name) < 200),
  sec        text not null,
  pin        text not null,
  key        text not null unique                      -- hash of salt + student number + PIN
);

-- student email (for sending PINs from the app) and when the PIN email last went out; instructors only
alter table public.roster add column if not exists email   text check (email is null or (char_length(email) <= 254 and email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'));
alter table public.roster add column if not exists emailed timestamptz;

create or replace function public.valid_scores(s jsonb) returns boolean
  language sql immutable as $$
  select jsonb_typeof(s) = 'object' and not exists (
    select 1 from jsonb_each(s) e
    where not (jsonb_typeof(e.value) = 'number'
            or (jsonb_typeof(e.value) = 'string' and char_length(e.value #>> '{}') <= 20))
  )
$$;

create table if not exists public.records (
  key        text primary key,                         -- the secret a student's number + PIN produce
  student_id text not null,
  name       text not null check (char_length(name) < 200),
  sec        text not null,
  s          jsonb not null default '{}' check (public.valid_scores(s)),
  updated    timestamptz not null default now()
);
create index if not exists records_sec_idx on public.records (sec);
-- When the student pressed "I acknowledge my grade". Cleared again whenever their scores change.
alter table public.records add column if not exists acknowledged timestamptz;

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

-- True when a roster row or record with this student number / key already belongs to a section the caller cannot
-- manage. Security definer so it can see rows that row level security hides from the caller.
create or replace function public.student_conflict(p_id text, p_key text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.roster ro where ro.student_id = p_id and not public.can_manage_section(ro.sec))
      or exists (select 1 from public.records rc where rc.key = p_key and not public.can_manage_section(rc.sec))
$$;

-- ---------------------------------------------------------------- row level security
alter table public.meta     enable row level security;
alter table public.sections enable row level security;
alter table public.roster   enable row level security;
alter table public.records  enable row level security;
alter table public.admins   enable row level security;

drop policy if exists meta_read      on public.meta;
drop policy if exists meta_write     on public.meta;
drop policy if exists sections_read  on public.sections;
drop policy if exists sections_write on public.sections;
drop policy if exists roster_all     on public.roster;
drop policy if exists records_all    on public.records;
drop policy if exists admins_self    on public.admins;

create policy meta_read      on public.meta     for select to anon, authenticated using (true);
create policy meta_write     on public.meta     for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sections_read  on public.sections for select to anon, authenticated using (true);
create policy sections_write on public.sections for all    to authenticated
  using (public.is_admin() and (owner = auth.uid() or public.is_super()))
  with check (public.is_admin() and (owner = auth.uid() or public.is_super()));
create policy roster_all     on public.roster   for all    to authenticated using (public.can_manage_section(sec)) with check (public.can_manage_section(sec));
create policy records_all    on public.records  for all    to authenticated using (public.can_manage_section(sec)) with check (public.can_manage_section(sec));
create policy admins_self    on public.admins   for select to authenticated using (user_id = auth.uid());

-- table privileges: RLS above decides which rows; this decides which roles may touch the tables at all
revoke all on public.meta, public.sections, public.roster, public.records, public.admins from anon, authenticated;
grant select on public.meta, public.sections to anon, authenticated;
grant insert, update, delete on public.meta, public.sections to authenticated;
grant select, insert, update, delete on public.roster, public.records to authenticated;
grant select on public.admins to authenticated;

-- ---------------------------------------------------------------- student lookup (no listing possible)
create or replace function public.get_record(p_key text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', student_id, 'name', name, 'sec', sec, 's', s,
    'updated', (extract(epoch from updated) * 1000)::bigint,
    'ack', (extract(epoch from acknowledged) * 1000)::bigint)
  from public.records where key = p_key
$$;

-- A student marks their grade as acknowledged (needs the same secret key as get_record). Returns the time in ms,
-- or null if the key matches no record. Pressing it again keeps the first time.
create or replace function public.acknowledge_grade(p_key text) returns bigint
  language sql security definer set search_path = public as $$
  update public.records set acknowledged = coalesce(acknowledged, now()) where key = p_key
  returning (extract(epoch from acknowledged) * 1000)::bigint
$$;

-- Same as get_record for several keys at once (a student in more than one section has one record per section).
-- Returns only the records whose key matches; at most 50 keys per call, and nothing can be listed.
create or replace function public.get_records(p_keys text[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', key, 'id', student_id, 'name', name, 'sec', sec, 's', s,
    'ack', (extract(epoch from acknowledged) * 1000)::bigint,
    'updated', (extract(epoch from updated) * 1000)::bigint) order by name, sec), '[]'::jsonb)
  from public.records where key = any (p_keys[1:50])
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
  language plpgsql as $$
begin
  perform public.require_admin();
  update public.records
     set s = case when p_value is null or jsonb_typeof(p_value) = 'null'
                  then s - p_item
                  else jsonb_set(s, array[p_item], p_value, true) end,
         acknowledged = null,   -- the grade changed, so an earlier acknowledgment no longer applies
         updated = now()
   where key = p_key and public.can_manage_section(sec);
end $$;

-- p_rows: [{ "id", "name", "sec", "pin", "key", "s" (optional) }]
create or replace function public.upsert_students(p_rows jsonb) returns void
  language plpgsql as $$
begin
  perform public.require_admin();
  if exists (select 1 from jsonb_array_elements(p_rows) r where not public.can_manage_section(r ->> 'sec')) then
    raise exception 'not allowed: that section belongs to another instructor' using errcode = '42501';
  end if;
  -- never overwrite another instructor's student (student numbers are shared across the whole database)
  if exists (select 1 from jsonb_array_elements(p_rows) r where public.student_conflict(r ->> 'id', r ->> 'key')) then
    raise exception 'not allowed: that student number is already used by another instructor' using errcode = '42501';
  end if;
  insert into public.roster (student_id, name, sec, pin, key)
    select r ->> 'id', r ->> 'name', r ->> 'sec', r ->> 'pin', r ->> 'key'
    from jsonb_array_elements(p_rows) r
  on conflict (student_id) do update
    set name = excluded.name, sec = excluded.sec, pin = excluded.pin, key = excluded.key;
  insert into public.records (key, student_id, name, sec, s, updated)
    select r ->> 'key', r ->> 'id', r ->> 'name', r ->> 'sec', coalesce(r -> 's', '{}'::jsonb), now()
    from jsonb_array_elements(p_rows) r
  on conflict (key) do update
    set student_id = excluded.student_id, name = excluded.name, sec = excluded.sec,
        s = excluded.s, updated = now(),
        acknowledged = case when public.records.s is distinct from excluded.s then null else public.records.acknowledged end;
end $$;

-- p_rows: [{ "id", "key" }]
create or replace function public.delete_students(p_rows jsonb) returns void
  language plpgsql as $$
begin
  perform public.require_admin();
  if exists (select 1 from jsonb_array_elements(p_rows) r where public.student_conflict(r ->> 'id', r ->> 'key')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.quiz_attempts where key in (select r ->> 'key' from jsonb_array_elements(p_rows) r);
  delete from public.records where key in (select r ->> 'key' from jsonb_array_elements(p_rows) r);
  delete from public.roster  where student_id in (select r ->> 'id' from jsonb_array_elements(p_rows) r);
end $$;

-- Gives a student a new PIN (and therefore a new key) and keeps their scores.
create or replace function public.reset_pin(p_id text, p_old_key text, p_new_key text, p_pin text) returns void
  language plpgsql as $$
begin
  perform public.require_admin();
  if not coalesce(public.can_manage_section((select sec from public.roster where student_id = p_id)), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.quiz_attempts set key = p_new_key where key = p_old_key;
  update public.records set key = p_new_key, updated = now() where key = p_old_key;
  if not found then
    insert into public.records (key, student_id, name, sec)
      select p_new_key, student_id, name, sec from public.roster where student_id = p_id;
  end if;
  update public.roster set pin = p_pin, key = p_new_key, emailed = null where student_id = p_id;
end $$;

-- p_rows: [{ "id", "email" }]; an empty or null email clears it. Other columns are untouched.
create or replace function public.set_student_emails(p_rows jsonb) returns void
  language plpgsql as $$
begin
  perform public.require_admin();
  update public.roster ro
     set email = nullif(btrim(r ->> 'email'), ''),
         emailed = case when lower(coalesce(nullif(btrim(r ->> 'email'), ''), '')) = lower(coalesce(ro.email, '')) then ro.emailed else null end
    from jsonb_array_elements(p_rows) r
   where ro.student_id = r ->> 'id' and public.can_manage_section(ro.sec);
end $$;

-- p_ids: ["student number", ...]; called after the PIN email was sent
create or replace function public.mark_emailed(p_ids jsonb) returns void
  language plpgsql as $$
begin
  perform public.require_admin();
  update public.roster set emailed = now()
   where student_id in (select jsonb_array_elements_text(p_ids)) and public.can_manage_section(sec);
end $$;

-- Deletes a section together with its students and their scores. Returns how many students were removed.
create or replace function public.delete_section(p_id text) returns int
  language plpgsql as $$
declare n int;
begin
  perform public.require_admin();
  if not public.can_manage_section(p_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.quizzes where sec = p_id;   -- their attempts go with them
  delete from public.records where sec = p_id;
  delete from public.roster  where sec = p_id;
  get diagnostics n = row_count;
  delete from public.sections where id = p_id;
  return n;
end $$;

revoke execute on function
  public.get_record(text), public.get_records(text[]), public.acknowledge_grade(text), public.is_admin(), public.require_admin(), public.set_score(text, text, jsonb),
  public.upsert_students(jsonb), public.delete_students(jsonb), public.reset_pin(text, text, text, text),
  public.delete_section(text), public.set_student_emails(jsonb), public.mark_emailed(jsonb)
  from public, anon, authenticated;
grant execute on function public.get_record(text), public.get_records(text[]), public.acknowledge_grade(text) to anon, authenticated;
revoke execute on function public.is_super(), public.can_manage_section(text), public.student_conflict(text, text) from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_super(), public.can_manage_section(text), public.student_conflict(text, text) to authenticated;
grant execute on function
  public.require_admin(), public.set_score(text, text, jsonb), public.upsert_students(jsonb),
  public.delete_students(jsonb), public.reset_pin(text, text, text, text), public.delete_section(text),
  public.set_student_emails(jsonb), public.mark_emailed(jsonb)
  to authenticated;

-- ---------------------------------------------------------------- quizzes
-- An instructor builds a quiz per section. The questions (with the answers) are readable by instructors only: a student
-- gets the questions WITHOUT the answers from start_quiz, one attempt per student, and the server does the scoring.
create table if not exists public.quizzes (
  id             text primary key,
  sec            text not null,
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
create index if not exists quizzes_sec_idx on public.quizzes (sec);

create table if not exists public.quiz_attempts (
  quiz_id    text not null references public.quizzes (id) on delete cascade,
  key        text not null,
  sec        text not null,
  student_id text not null,
  name       text not null,
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
create index if not exists quiz_attempts_sec_idx on public.quiz_attempts (sec);

alter table public.quizzes       enable row level security;
alter table public.quiz_attempts enable row level security;
drop policy if exists quizzes_all   on public.quizzes;
drop policy if exists attempts_read on public.quiz_attempts;
drop policy if exists attempts_del  on public.quiz_attempts;
drop policy if exists attempts_upd  on public.quiz_attempts;
create policy quizzes_all   on public.quizzes       for all    to authenticated using (public.can_manage_section(sec)) with check (public.can_manage_section(sec));
create policy attempts_read on public.quiz_attempts for select to authenticated using (public.can_manage_section(sec));
create policy attempts_del  on public.quiz_attempts for delete to authenticated using (public.can_manage_section(sec));
-- only the key column may change (reset_pin moves an attempt to the student's new key)
create policy attempts_upd  on public.quiz_attempts for update to authenticated using (public.can_manage_section(sec)) with check (public.can_manage_section(sec));
revoke all on public.quizzes, public.quiz_attempts from anon, authenticated;
grant select, insert, update, delete on public.quizzes to authenticated;
grant select, delete on public.quiz_attempts to authenticated;
grant update (key) on public.quiz_attempts to authenticated;

-- Published quizzes of the student's section: no questions and no answers, only what is needed to list them.
create or replace function public.get_quizzes(p_key text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'title', q.title, 'count', jsonb_array_length(q.questions),
    'total', (select coalesce(sum(coalesce((x ->> 'points')::numeric, 1)), 0) from jsonb_array_elements(q.questions) x),
    'timeLimit', q.time_limit, 'lockdown', q.lockdown, 'maxViolations', q.max_violations,
    'started', (extract(epoch from a.started) * 1000)::bigint,
    'submitted', (extract(epoch from a.submitted) * 1000)::bigint,
    'points', a.points, 'attemptTotal', a.total, 'late', a.late) order by q.updated, q.title), '[]'::jsonb)
  from public.records r
  join public.quizzes q on q.sec = r.sec and q.published
  left join public.quiz_attempts a on a.quiz_id = q.id and a.key = r.key
  where r.key = p_key
$$;

-- Starts (or resumes) the student's one attempt and returns the questions WITHOUT their answers. The clock starts here.
create or replace function public.start_quiz(p_key text, p_quiz text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r public.records; q public.quizzes; a public.quiz_attempts; left_ms bigint;
begin
  select * into r from public.records where key = p_key;
  select * into q from public.quizzes where id = p_quiz and published and sec = r.sec;
  if r.key is null or q.id is null then raise exception 'quiz not available' using errcode = 'P0002'; end if;
  select * into a from public.quiz_attempts where quiz_id = q.id and key = r.key;
  if a.quiz_id is not null and a.submitted is not null then raise exception 'already submitted' using errcode = 'P0001'; end if;
  if a.quiz_id is null then
    insert into public.quiz_attempts (quiz_id, key, sec, student_id, name) values (q.id, r.key, r.sec, r.student_id, r.name)
      returning * into a;
  end if;
  left_ms := case when q.time_limit is null then null
                  else greatest(0, (extract(epoch from (a.started + make_interval(mins => q.time_limit) - now())) * 1000)::bigint) end;
  return jsonb_build_object(
    'id', q.id, 'title', q.title, 'remainingMs', left_ms, 'violations', a.violations,
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

-- Scores the answers on the server ({ questionId: choice index | true | false }) and puts the result in the grade item.
-- After the time limit (30 seconds of grace for the network) the attempt is recorded as late and scores 0.
create or replace function public.submit_quiz(p_key text, p_quiz text, p_answers jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare q public.quizzes; a public.quiz_attempts; pts numeric := 0; tot numeric := 0; is_late boolean; shown numeric;
begin
  select * into a from public.quiz_attempts where quiz_id = p_quiz and key = p_key;
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
  if q.item_key is not null and q.item_max is not null and tot > 0 then
    shown := round(pts / tot * q.item_max, 2);
    update public.records set s = jsonb_set(s, array[q.item_key], to_jsonb(shown)), acknowledged = null, updated = now() where key = p_key;
  end if;
  return jsonb_build_object('points', pts, 'total', tot, 'late', is_late, 'score', shown);
end $$;

-- Lets a student take a quiz again: removes the attempt and the score it wrote.
create or replace function public.reset_quiz_attempt(p_quiz text, p_key text) returns void
  language plpgsql as $$
declare q public.quizzes;
begin
  perform public.require_admin();
  select * into q from public.quizzes where id = p_quiz;
  if q.id is null or not public.can_manage_section(q.sec) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.quiz_attempts where quiz_id = p_quiz and key = p_key;
  if q.item_key is not null then
    update public.records set s = s - q.item_key, acknowledged = null, updated = now() where key = p_key and sec = q.sec;
  end if;
end $$;

-- Removes every quiz attempt of a section (used by "Clear all scores", so students can retake those quizzes).
create or replace function public.clear_quiz_attempts(p_sec text) returns void
  language plpgsql as $$
begin
  perform public.require_admin();
  if not public.can_manage_section(p_sec) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.quiz_attempts where sec = p_sec;
end $$;

revoke execute on function public.get_quizzes(text), public.start_quiz(text, text), public.log_quiz_event(text, text, text),
  public.submit_quiz(text, text, jsonb), public.reset_quiz_attempt(text, text), public.clear_quiz_attempts(text) from public, anon, authenticated;
grant execute on function public.get_quizzes(text), public.start_quiz(text, text), public.log_quiz_event(text, text, text),
  public.submit_quiz(text, text, jsonb) to anon, authenticated;
grant execute on function public.reset_quiz_attempt(text, text), public.clear_quiz_attempts(text) to authenticated;

-- ---------------------------------------------------------------- live updates for the instructor screens
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.meta;     exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.sections; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.roster;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.records;  exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.quizzes;  exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.quiz_attempts; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------- make an instructor
-- 1. Register on the site's instructor page (and confirm the email if Supabase asks you to).
-- 2. Run this with that email. It does nothing if the account does not exist yet.
insert into public.admins (user_id)
  select id from auth.users where lower(email) = lower('aedgardominic@gmail.com')
on conflict do nothing;

-- Migration for data saved before sections had owners: this account becomes a super instructor and owns every
-- section that has no owner yet. Other instructors (added to public.admins) then only see what they create.
update public.admins set is_super = true
  where user_id in (select id from auth.users where lower(email) = lower('aedgardominic@gmail.com'));
update public.sections set owner = (select id from auth.users where lower(email) = lower('aedgardominic@gmail.com'))
  where owner is null;
