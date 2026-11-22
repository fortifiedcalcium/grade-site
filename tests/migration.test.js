import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/* Builds a database exactly as it is today (the schema from before normalization, saved in tests/fixtures), fills it with
   data in the old layout, then runs the new supabase/schema.sql over it. Nothing a student or instructor could see may change. */

const ADMIN = "11111111-1111-1111-1111-111111111111";
const TEACHER2 = "33333333-3333-3333-3333-333333333333";
const OLD = fs.readFileSync(new URL("./fixtures/schema.before-normalize.sql", import.meta.url), "utf8");
const NEW = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
let pg;
const before = {};

const as = async (role, uid) => {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ""]);
  if (role) await pg.exec("set role " + role);
};
const val = async (sql) => (await pg.query(sql)).rows[0].r;
const KEYS = ["key1", "key1b", "key2", "key3"];
const snapshot = async () => {
  await as("anon");
  const out = {};
  for (const k of KEYS) out["get_record " + k] = await val(`select public.get_record('${k}') as r`);
  out.records = await val("select public.get_records(array['key1','key1b','key2','key3','nope']) as r");
  out.quizzes = await val("select public.get_quizzes('key1') as r");
  return out;
};

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to public;
    insert into auth.users values ('${ADMIN}', 'teacher@example.com'), ('${TEACHER2}', 'teacher2@example.com');
  `);
  await pg.exec(OLD);
  await pg.exec(`insert into public.admins (user_id) values ('${ADMIN}'), ('${TEACHER2}') on conflict do nothing`);
  const scheme = JSON.stringify({ categories: [{ id: "quizzes", title: "Quizzes", weight: 100, items: [{ k: "quizzes1", label: "Quiz 1", max: 50 }] }], passEquiv: 3 });
  const sec = (o) => JSON.stringify(Object.assign({ scheme: JSON.parse(scheme) }, o));
  await pg.exec(`insert into public.meta (id, title, salt) values (1, 'Grades', 'salt') on conflict (id) do update set salt = 'salt'`);
  await pg.query(
    `insert into public.sections (id, data, owner) values
       ('a', $1::jsonb, '${ADMIN}'), ('b', $2::jsonb, '${ADMIN}'), ('c', $3::jsonb, '${TEACHER2}'),
       ('d', $4::jsonb, '${ADMIN}'), ('e', '{"name":"Bare"}', '${ADMIN}')`,
    [
      sec({ name: "3H-G1", term: "2026-2027 1st Semester", subject: { code: "IT304W", desc: "Web Dev" }, instructor: "Dr A", roomTime: "Rm 1", headings: ["BSIT"] }),
      sec({ name: "3H-G2", term: "2026-2027 1st Semester", subject: { code: "IT304W", desc: "Web Dev" }, instructor: "Dr A" }),
      sec({ name: "3G-G2", term: "2026-2027 1st Semester", subject: { code: "IT304W", desc: "Web Development (old)" } }),
      sec({ name: "Legacy", subject: { code: "", desc: "" } }),   // no term, no subject code
    ]
  );
  await pg.exec(`
     insert into public.roster (student_id, name, sec, pin, key, email, emailed) values
       ('S1',    'Ana Reyes', 'a', '111111', 'key1',  'ana@school.edu', '2026-11-01 10:00+00'),
       ('S1@b',  'Ana Reyes', 'b', '111111', 'key1b', 'ana@school.edu', null),
       ('S2',    'Ben Cruz',  'a', '222222', 'key2',  null, null),
       ('S3',    'Cy Tan',    'c', '333333', 'key3',  null, null),
       ('GHOST', 'Gone',      'zzz', '999999', 'keyghost', null, null);
     insert into public.records (key, student_id, name, sec, s, acknowledged, updated) values
       ('key1',  'S1',   'Ana Reyes', 'a', '{"quizzes1": 45, "x": "INC"}', '2026-11-02 08:00+00', '2026-11-02 08:00+00'),
       ('key1b', 'S1@b', 'Ana Reyes', 'b', '{"quizzes1": 40}', null, '2026-11-03 08:00+00'),
       ('key2',  'S2',   'Benjamin Cruz', 'a', '{}', null, '2026-11-04 08:00+00'),
       ('key3',  'S3',   'Cy Tan', 'c', '{"quizzes1": 10}', null, '2026-11-05 08:00+00'),
       ('keyorphan', 'S9', 'No Roster', 'a', '{}', null, now());
     insert into public.quizzes (id, sec, title, item_key, item_max, questions, published, time_limit, show_answers) values
       ('q1', 'a', 'Quiz One', 'quizzes1', 50, '[{"id":"a1","type":"tf","text":"T","answer":true,"points":1}]', true, 20, true),
       ('q2', 'ghostsec', 'Orphan quiz', null, null, '[]', false, null, false);
     insert into public.quiz_attempts (quiz_id, key, sec, student_id, name, violations, events) values
       ('q1', 'key1', 'a', 'S1', 'Ana Reyes', 2, '[{"t":1,"type":"paste"}]'),
       ('q1', 'nokey', 'a', 'SX', 'Nobody', 0, '[]');`);
  Object.assign(before, await snapshot());
  await pg.exec("reset role");
  await pg.exec(NEW);   // the migration
});

describe("migrating a database from the old layout", () => {
  it("keeps every student's lookup exactly as it was (same keys, same answers)", async () => {
    const after = await snapshot();
    // the only difference: Ben's name is now the roster's ("Ben Cruz"), not the second copy kept in his record ("Benjamin Cruz")
    const expected = JSON.parse(JSON.stringify(before));
    expected["get_record key2"].name = "Ben Cruz";
    expected.records.find((r) => r.key === "key2").name = "Ben Cruz";
    expect(after).toEqual(expected);
    expect(after["get_record key1"]).toMatchObject({ id: "S1", name: "Ana Reyes", sec: "a", s: { quizzes1: 45, x: "INC" } });
    expect(after["get_record key1b"].id).toBe("S1@b");   // the second section keeps its row id, so its PIN still works
    expect(typeof after["get_record key1"].ack).toBe("number");
  });
  it("stores each student once, with one name and the email once", async () => {
    await pg.exec("reset role");
    expect((await pg.query("select student_no, name, email from public.students order by 1")).rows).toEqual([
      { student_no: "S1", name: "Ana Reyes", email: "ana@school.edu" },
      { student_no: "S2", name: "Ben Cruz", email: null },        // the roster's name wins over the record's copy
      { student_no: "S3", name: "Cy Tan", email: null },
    ]);
  });
  it("turns roster + records into enrollments, keeping PINs, keys, scores, acknowledgments and email status", async () => {
    const rows = (await pg.query("select login_id, student_no, sec, pin, key, scores, (acknowledged is not null) as ack, (emailed is not null) as emailed from public.enrollments order by login_id")).rows;
    expect(rows).toEqual([
      { login_id: "S1", student_no: "S1", sec: "a", pin: "111111", key: "key1", scores: { quizzes1: 45, x: "INC" }, ack: true, emailed: true },
      { login_id: "S1@b", student_no: "S1", sec: "b", pin: "111111", key: "key1b", scores: { quizzes1: 40 }, ack: false, emailed: false },
      { login_id: "S2", student_no: "S2", sec: "a", pin: "222222", key: "key2", scores: {}, ack: false, emailed: false },
      { login_id: "S3", student_no: "S3", sec: "c", pin: "333333", key: "key3", scores: { quizzes1: 10 }, ack: false, emailed: false },
    ]);   // the roster row of a section that no longer exists, and the record without a roster row, are left behind
  });
  it("moves the section fields out of the json: one subject row, the common description", async () => {
    expect((await pg.query("select code, description from public.subjects")).rows).toEqual([{ code: "IT304W", description: "Web Dev" }]);
    const a = (await pg.query("select name, term, subject_code, instructor, room_time, headings, scheme from public.sections where id = 'a'")).rows[0];
    expect(a).toMatchObject({ name: "3H-G1", term: "2026-2027 1st Semester", subject_code: "IT304W", instructor: "Dr A", room_time: "Rm 1", headings: ["BSIT"] });
    expect(a.scheme.categories[0].items[0]).toEqual({ k: "quizzes1", label: "Quiz 1", max: 50 });
    expect((await pg.query("select name, term, subject_code from public.sections where id = 'd'")).rows[0]).toEqual({ name: "Legacy", term: "", subject_code: null });
    expect((await pg.query("select name, scheme from public.sections where id = 'e'")).rows[0]).toEqual({ name: "Bare", scheme: {} });
    expect((await pg.query("select count(*)::int as n from public.sections where legacy_data is not null")).rows[0].n).toBe(5);   // the old json is kept
  });
  it("keeps quizzes and their attempts, dropping only the ones that pointed at nothing", async () => {
    expect((await pg.query("select id, show_answers from public.quizzes")).rows).toEqual([{ id: "q1", show_answers: true }]);
    expect((await pg.query("select quiz_id, key, violations, events from public.quiz_attempts")).rows).toEqual([{ quiz_id: "q1", key: "key1", violations: 2, events: [{ t: 1, type: "paste" }] }]);
    const cols = (await pg.query("select column_name from information_schema.columns where table_name = 'quiz_attempts'")).rows.map((r) => r.column_name);
    expect(cols).not.toContain("name");
    expect(cols).not.toContain("student_id");
  });
  it("keeps the old tables aside, locked, and never drops them", async () => {
    await pg.exec("reset role");
    expect(Number((await pg.query("select count(*) as n from public.roster_old")).rows[0].n)).toBe(5);
    expect(Number((await pg.query("select count(*) as n from public.records_old")).rows[0].n)).toBe(5);
    expect((await pg.query("select to_regclass('public.roster') as t")).rows[0].t).toBeNull();
    await as("anon");
    await expect(pg.query("select * from public.roster_old")).rejects.toThrow(/permission denied/);
    await as("authenticated", ADMIN);
    await expect(pg.query("select * from public.records_old")).rejects.toThrow(/permission denied/);
  });
  it("applies the access rules to the new tables", async () => {
    await as("authenticated", ADMIN);
    expect((await pg.query("select login_id from public.enrollments order by 1")).rows.map((r) => r.login_id)).toEqual(["S1", "S1@b", "S2"]);
    await as("authenticated", TEACHER2);
    expect((await pg.query("select login_id from public.enrollments")).rows.map((r) => r.login_id)).toEqual(["S3"]);
    expect((await pg.query("select student_no from public.students")).rows.map((r) => r.student_no)).toEqual(["S3"]);
  });
  it("works for instructors afterwards", async () => {
    await as("authenticated", ADMIN);
    await pg.query("select public.set_score('key2', 'quizzes1', '30')");
    expect((await pg.query("select scores from public.enrollments where key = 'key2'")).rows[0].scores).toEqual({ quizzes1: 30 });
    await pg.query(`select public.save_sections('[{"id":"a","name":"3H-G1","term":"2026-2027 1st Semester","subject":{"code":"IT304W","desc":"Web Dev"},"scheme":{"categories":[]}}]')`);
    expect((await pg.query("select count(*)::int as n from public.enrollments")).rows[0].n).toBe(3);   // saving a section leaves its students alone
  });
  it("is safe to run again: nothing is migrated twice or lost", async () => {
    await pg.exec("reset role");
    const counts = async () => (await pg.query("select (select count(*) from public.students)::int as st, (select count(*) from public.enrollments)::int as en, (select count(*) from public.sections)::int as se, (select count(*) from public.subjects)::int as su, (select count(*) from public.quiz_attempts)::int as qa")).rows[0];
    const first = await counts();
    await pg.exec(NEW);
    await pg.exec(NEW);
    expect(await counts()).toEqual(first);
    expect(Number((await pg.query("select count(*) as n from public.roster_old")).rows[0].n)).toBe(5);
  });
});
