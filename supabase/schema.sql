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

create table if not exists public.roster (
  student_id text primary key,
  name       text not null check (char_length(name) < 200),
  sec        text not null,
  pin        text not null,
  key        text not null unique                      -- hash of salt + student number + PIN
);

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

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
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
create policy sections_write on public.sections for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy roster_all     on public.roster   for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy records_all    on public.records  for all    to authenticated using (public.is_admin()) with check (public.is_admin());
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
   where key = p_key;
end $$;

-- p_rows: [{ "id", "name", "sec", "pin", "key", "s" (optional) }]
create or replace function public.upsert_students(p_rows jsonb) returns void
  language plpgsql as $$
begin
  perform public.require_admin();
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
  delete from public.records where key in (select r ->> 'key' from jsonb_array_elements(p_rows) r);
  delete from public.roster  where student_id in (select r ->> 'id' from jsonb_array_elements(p_rows) r);
end $$;

-- Gives a student a new PIN (and therefore a new key) and keeps their scores.
create or replace function public.reset_pin(p_id text, p_old_key text, p_new_key text, p_pin text) returns void
  language plpgsql as $$
begin
  perform public.require_admin();
  update public.records set key = p_new_key, updated = now() where key = p_old_key;
  if not found then
    insert into public.records (key, student_id, name, sec)
      select p_new_key, student_id, name, sec from public.roster where student_id = p_id;
  end if;
  update public.roster set pin = p_pin, key = p_new_key where student_id = p_id;
end $$;

-- Deletes a section together with its students and their scores. Returns how many students were removed.
create or replace function public.delete_section(p_id text) returns int
  language plpgsql as $$
declare n int;
begin
  perform public.require_admin();
  delete from public.records where sec = p_id;
  delete from public.roster  where sec = p_id;
  get diagnostics n = row_count;
  delete from public.sections where id = p_id;
  return n;
end $$;

revoke execute on function
  public.get_record(text), public.acknowledge_grade(text), public.is_admin(), public.require_admin(), public.set_score(text, text, jsonb),
  public.upsert_students(jsonb), public.delete_students(jsonb), public.reset_pin(text, text, text, text),
  public.delete_section(text)
  from public, anon, authenticated;
grant execute on function public.get_record(text), public.acknowledge_grade(text) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function
  public.require_admin(), public.set_score(text, text, jsonb), public.upsert_students(jsonb),
  public.delete_students(jsonb), public.reset_pin(text, text, text, text), public.delete_section(text)
  to authenticated;

-- ---------------------------------------------------------------- live updates for the instructor screens
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.meta;     exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.sections; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.roster;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.records;  exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------- make an instructor
-- 1. Register on the site's instructor page (and confirm the email if Supabase asks you to).
-- 2. Run this with that email. It does nothing if the account does not exist yet.
insert into public.admins (user_id)
  select id from auth.users where lower(email) = lower('aedgardominic@gmail.com')
on conflict do nothing;
