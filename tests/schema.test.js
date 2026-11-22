import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/* Runs supabase/schema.sql in an in-process Postgres with Supabase's roles and auth.uid() stubbed,
   then checks who can read and write what. */

const ADMIN = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const TEACHER2 = "33333333-3333-3333-3333-333333333333";   // another instructor, owns section "c"
const SUPER = "44444444-4444-4444-4444-444444444444";      // sees everything
let pg;

const as = async (role, uid) => {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ""]);
  if (role) await pg.exec("set role " + role);
};
const rejects = async (promise, re) => {
  let err;
  try { await promise; } catch (e) { err = e; }
  expect(err, "expected the statement to be rejected").toBeTruthy();
  if (re) expect(String(err.message)).toMatch(re);
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
    insert into auth.users values ('${ADMIN}', 'teacher@example.com'), ('${OTHER}', 'someone@example.com'),
      ('${TEACHER2}', 'teacher2@example.com'), ('${SUPER}', 'super@example.com');
  `);
  await pg.exec(fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  await pg.exec(`insert into public.admins (user_id) values ('${ADMIN}'), ('${TEACHER2}')`);
  await pg.exec(`insert into public.admins (user_id, is_super) values ('${SUPER}', true)`);
  await pg.exec(`
    insert into public.meta (id, title, salt) values (1, 'Grades', 'salt');
    insert into public.subjects values ('IT 101', 'Intro to IT');
    insert into public.sections (id, name, subject_code, owner) values ('a', 'A', 'IT 101', '${ADMIN}'), ('c', 'C', null, '${TEACHER2}');
    insert into public.students (student_no, name) values ('S1', 'Ana'), ('S2', 'Ben'), ('T1', 'Tess');
    insert into public.enrollments (login_id, student_no, sec, pin, key, scores) values
      ('S1', 'S1', 'a', '111111', 'key1', '{"q1": 9}'), ('S2', 'S2', 'a', '222222', 'key2', '{}'), ('T1', 'T1', 'c', '666666', 'keyt1', '{"q1": 4}');
  `);
});

describe("students (not signed in)", () => {
  it("can read the public tables", async () => {
    await as("anon");
    expect((await pg.query("select title from public.meta")).rows).toEqual([{ title: "Grades" }]);
    expect((await pg.query("select id from public.sections order by id")).rows).toEqual([{ id: "a" }, { id: "c" }]);   // sections stay public so students can see their grading scheme
  });
  it("cannot read or list students, enrollments or admins", async () => {
    await as("anon");
    await rejects(pg.query("select * from public.students"), /permission denied/);
    await rejects(pg.query("select * from public.enrollments"), /permission denied/);
    await rejects(pg.query("select * from public.admins"), /permission denied/);
  });
  it("get_record returns one record for the right key and nothing for a wrong one", async () => {
    await as("anon");
    const ok = (await pg.query("select public.get_record('key1') as r")).rows[0].r;
    expect(ok).toMatchObject({ id: "S1", name: "Ana", sec: "a", s: { q1: 9 } });
    expect(typeof ok.updated).toBe("number");
    expect((await pg.query("select public.get_record('nope') as r")).rows[0].r).toBeNull();
    expect(ok).not.toHaveProperty("pin");
  });
  it("can acknowledge their own grade once, and a wrong key does nothing", async () => {
    await as("anon");
    expect((await pg.query("select public.get_record('key2') as r")).rows[0].r.ack).toBeNull();
    const first = (await pg.query("select public.acknowledge_grade('key2') as t")).rows[0].t;
    expect(Number(first)).toBeGreaterThan(0);
    expect((await pg.query("select public.get_record('key2') as r")).rows[0].r.ack).toBe(first);
    expect((await pg.query("select public.acknowledge_grade('key2') as t")).rows[0].t).toBe(first); // keeps the first time
    expect((await pg.query("select public.acknowledge_grade('nope') as t")).rows[0].t).toBeNull();
  });
  it("loses the acknowledgment when an instructor changes a score or re-imports different scores", async () => {
    await as("anon");
    await pg.query("select public.acknowledge_grade('key1')");
    await as("authenticated", ADMIN);
    await pg.query("select public.upsert_students('[{\"id\":\"S1\",\"name\":\"Ana\",\"sec\":\"a\",\"pin\":\"111111\",\"key\":\"key1\",\"s\":{\"q1\":9}}]'::jsonb)");
    expect((await pg.query("select acknowledged from public.enrollments where key = 'key1'")).rows[0].acknowledged).not.toBeNull(); // same scores: kept
    await pg.query("select public.set_score('key1', 'q1', '10')");
    expect((await pg.query("select acknowledged from public.enrollments where key = 'key1'")).rows[0].acknowledged).toBeNull();
    await pg.query("select public.set_score('key1', 'q1', '9')"); // put it back for the tests below
  });
  it("get_records returns only the records whose keys match and cannot list the rest", async () => {
    await as("anon");
    const rows = (await pg.query("select public.get_records(array['key1','nope','key2']) as r")).rows[0].r;
    expect(rows.map((r) => r.id)).toEqual(["S1", "S2"]);
    expect((await pg.query("select public.get_records(array['nope']) as r")).rows[0].r).toEqual([]);
    expect((await pg.query("select public.get_records(array[]::text[]) as r")).rows[0].r).toEqual([]);
  });
  it("cannot write anything", async () => {
    await as("anon");
    await rejects(pg.query("update public.meta set title = 'x'"), /permission denied/);
    await rejects(pg.query("select public.set_score('key1', 'q1', '10')"), /permission denied/);
    await rejects(pg.query("select public.delete_section('a')"), /permission denied/);
  });
});

describe("a signed-in user who is not an instructor", () => {
  it("sees no private rows and cannot write", async () => {
    await as("authenticated", OTHER);
    expect((await pg.query("select * from public.students")).rows).toHaveLength(0);
    expect((await pg.query("select * from public.enrollments")).rows).toHaveLength(0);
    expect((await pg.query("select * from public.admins")).rows).toHaveLength(0);
    await rejects(pg.query("insert into public.meta (id, title) values (2, 'x')"));
    await rejects(pg.query("select public.set_score('key1', 'q1', '10')"), /not allowed/);
    await rejects(pg.query(`select public.set_student_emails('[{"id":"S1","email":"a@b.co"}]')`), /not allowed/);
    await rejects(pg.query(`select public.mark_emailed('["S1"]')`), /not allowed/);
    await rejects(pg.query("select public.upsert_students('[{\"id\":\"S9\",\"name\":\"Z\",\"sec\":\"a\",\"pin\":\"1\",\"key\":\"k9\"}]')"), /not allowed/);
  });
  it("cannot make themselves an instructor", async () => {
    await as("authenticated", OTHER);
    await rejects(pg.query(`insert into public.admins values ('${OTHER}')`), /permission denied/);
  });
});

describe("instructor", () => {
  it("can read their own admin row and the private tables", async () => {
    await as("authenticated", ADMIN);
    expect((await pg.query("select user_id from public.admins")).rows).toEqual([{ user_id: ADMIN }]);
    expect((await pg.query("select * from public.enrollments")).rows).toHaveLength(2);
    expect((await pg.query("select * from public.students order by 1")).rows.map((r) => r.name)).toEqual(["Ana", "Ben"]);
  });
  it("sets, replaces and clears a single score without touching the others", async () => {
    await as("authenticated", ADMIN);
    await pg.query("select public.set_score('key1', 'q2', '7.5')");
    await pg.query("select public.set_score('key1', 'q3', '\"INC\"')");
    let s = (await pg.query("select scores as s from public.enrollments where key = 'key1'")).rows[0].s;
    expect(s).toEqual({ q1: 9, q2: 7.5, q3: "INC" });
    await pg.query("select public.set_score('key1', 'q3', null)");
    await pg.query("select public.set_score('key1', 'q2', 'null'::jsonb)");
    s = (await pg.query("select scores as s from public.enrollments where key = 'key1'")).rows[0].s;
    expect(s).toEqual({ q1: 9 });
  });
  it("rejects scores that are neither numbers nor short text", async () => {
    await as("authenticated", ADMIN);
    await rejects(pg.query("select public.set_score('key1', 'q9', 'true')"), /valid_scores|check/);
    await rejects(pg.query("select public.set_score('key1', 'q9', '\"123456789012345678901\"')"), /valid_scores|check/);
  });
  it("adds a student, resets the PIN keeping scores, and deletes the student", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.upsert_students('[{"id":"S3","name":"Cy","sec":"a","pin":"333333","key":"key3"}]')`);
    expect((await pg.query("select scores as s from public.enrollments where key = 'key3'")).rows[0].s).toEqual({});
    await pg.query("select public.set_score('key3', 'q1', '5')");
    await pg.query("select public.reset_pin('S3', 'key3', 'key3b', '444444')");
    expect((await pg.query("select pin, key from public.enrollments where login_id = 'S3'")).rows[0]).toEqual({ pin: "444444", key: "key3b" });
    expect((await pg.query("select scores as s from public.enrollments where key = 'key3b'")).rows[0].s).toEqual({ q1: 5 });
    expect((await pg.query("select 1 from public.enrollments where key = 'key3'")).rows).toHaveLength(0);
    await pg.query(`select public.delete_students('[{"id":"S3","key":"key3b"}]')`);
    expect((await pg.query("select 1 from public.enrollments where login_id = 'S3'")).rows).toHaveLength(0);
    expect((await pg.query("select 1 from public.enrollments where key = 'key3b'")).rows).toHaveLength(0);
  });
  it("saves and clears student emails; changing one (or a PIN reset) makes the student 'not emailed' again", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.set_student_emails('[{"id":"S1","email":" ana@x.edu "}]')`);
    await pg.query(`select public.mark_emailed('["S1"]')`);
    let row = (await pg.query("select st.email, e.emailed from public.enrollments e join public.students st using (student_no) where e.login_id = 'S1'")).rows[0];
    expect(row.email).toBe("ana@x.edu");
    expect(row.emailed).toBeTruthy();
    await pg.query(`select public.set_student_emails('[{"id":"S1","email":"ANA@x.edu"}]')`);   // same address: still emailed
    expect((await pg.query("select emailed from public.enrollments where login_id = 'S1'")).rows[0].emailed).toBeTruthy();
    await pg.query(`select public.set_student_emails('[{"id":"S1","email":"new@x.edu"}]')`);
    expect((await pg.query("select emailed from public.enrollments where login_id = 'S1'")).rows[0].emailed).toBeNull();
    await rejects(pg.query(`select public.set_student_emails('[{"id":"S1","email":"not an email"}]')`), /check/);
    await pg.query(`select public.set_student_emails('[{"id":"S1","email":""}]')`);
    expect((await pg.query("select st.email from public.enrollments e join public.students st using (student_no) where e.login_id = 'S1'")).rows[0].email).toBeNull();
  });
  it("re-importing replaces a student's scores", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.upsert_students('[{"id":"S2","name":"Ben","sec":"a","pin":"222222","key":"key2","s":{"q1":3}}]')`);
    expect((await pg.query("select scores as s from public.enrollments where key = 'key2'")).rows[0].s).toEqual({ q1: 3 });
  });
  it("updates one meta field without wiping the others", async () => {
    await as("authenticated", ADMIN);
    await pg.query("insert into public.meta (id, term) values (1, 'T1') on conflict (id) do update set term = excluded.term");
    expect((await pg.query("select title, term, salt from public.meta")).rows[0]).toEqual({ title: "Grades", term: "T1", salt: "salt" });
  });
  it("deleting a section removes its students and their scores and reports the count", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.save_sections('[{"id":"b","name":"B"}]')`);
    await pg.query(`select public.upsert_students('[{"id":"B1","name":"Di","sec":"b","pin":"555555","key":"keyb1"}]')`);
    const n = (await pg.query("select public.delete_section('b') as n")).rows[0].n;
    expect(n).toBe(1);
    expect((await pg.query("select 1 from public.sections where id = 'b'")).rows).toHaveLength(0);
    expect((await pg.query("select 1 from public.enrollments where sec = 'b'")).rows).toHaveLength(0);
    expect((await pg.query("select 1 from public.enrollments where sec = 'a'")).rows.length).toBeGreaterThan(0);
  });
});

describe("each instructor only sees and changes their own sections", () => {
  it("lists only the instructor's own students and scores", async () => {
    await as("authenticated", ADMIN);
    expect((await pg.query("select login_id from public.enrollments order by 1")).rows.map((r) => r.login_id)).toEqual(["S1", "S2"]);
    expect((await pg.query("select key from public.enrollments order by 1")).rows.map((r) => r.key)).toEqual(["key1", "key2"]);
    await as("authenticated", TEACHER2);
    expect((await pg.query("select login_id from public.enrollments")).rows.map((r) => r.login_id)).toEqual(["T1"]);
  });
  it("a super instructor sees everyone", async () => {
    await as("authenticated", SUPER);
    expect((await pg.query("select * from public.enrollments")).rows.length).toBeGreaterThanOrEqual(3);
  });
  it("new sections belong to whoever creates them", async () => {
    await as("authenticated", TEACHER2);
    await pg.query(`select public.save_sections('[{"id":"c2","name":"C2"}]')`);
    expect((await pg.query("select owner from public.sections where id = 'c2'")).rows[0].owner).toBe(TEACHER2);
    await rejects(pg.query(`insert into public.sections (id, name, owner) values ('c3', 'C3', '${ADMIN}')`), /permission denied/);   // sections change only through save_sections
  });
  it("cannot edit, take over or delete another instructor's section", async () => {
    await as("authenticated", TEACHER2);
    await rejects(pg.query(`update public.sections set name = 'hacked' where id = 'a'`), /permission denied/);
    await rejects(pg.query(`select public.save_sections('[{"id":"a","name":"mine"}]')`), /not allowed/);
    await as("authenticated", ADMIN);
    expect((await pg.query("select name from public.sections where id = 'a'")).rows[0].name).toBe("A");
    await as("authenticated", TEACHER2);
    await rejects(pg.query("select public.delete_section('a')"), /not allowed/);
  });
  it("cannot change scores, PINs, emails or students of another instructor's section", async () => {
    await as("authenticated", TEACHER2);
    await pg.query("select public.set_score('key1', 'q1', '1')");
    await rejects(pg.query("select public.reset_pin('S1', 'key1', 'keyx', '999999')"), /not allowed/);
    await rejects(pg.query(`select public.delete_students('[{"id":"S1","key":"key1"}]')`), /not allowed/);
    await rejects(pg.query(`select public.upsert_students('[{"id":"X1","name":"X","sec":"a","pin":"1","key":"kx"}]')`), /not allowed/);
    await rejects(pg.query(`select public.upsert_students('[{"id":"S1","name":"Mine now","sec":"c","pin":"1","key":"keyz"}]')`), /already used by another instructor/);
    await pg.query(`select public.set_student_emails('[{"id":"S1","email":"x@y.co"}]')`);
    await pg.query(`select public.mark_emailed('["S1"]')`);
    await as("authenticated", ADMIN);
    expect((await pg.query("select scores as s from public.enrollments where key = 'key1'")).rows[0].s).toEqual({ q1: 9 });
    const r = (await pg.query("select st.name, e.pin, st.email, e.emailed from public.enrollments e join public.students st using (student_no) where e.login_id = 'S1'")).rows[0];
    expect(r).toMatchObject({ name: "Ana", pin: "111111", email: null, emailed: null });
  });
  it("students can still look up their record whoever owns the section", async () => {
    await as("anon");
    expect((await pg.query("select public.get_record('keyt1') as r")).rows[0].r).toMatchObject({ id: "T1", s: { q1: 4 } });
  });
});

describe("quizzes and anti-cheat", () => {
  const QS = JSON.stringify([
    { id: "a1", type: "mc", text: "2+2?", choices: ["3", "4", "5"], answer: 1, points: 2 },
    { id: "a2", type: "tf", text: "Sky is green", answer: false, points: 1 },
  ]);
  beforeAll(async () => {
    await as("authenticated", ADMIN);
    await pg.query(`insert into public.quizzes (id, sec, title, item_key, item_max, questions, published, time_limit)
      values ('qz', 'a', 'Quiz 1', 'qz_item', 30, $1::jsonb, true, 10), ('draft', 'a', 'Hidden', null, null, $1::jsonb, false, null)`, [QS]);
  });
  it("hides the answers: the list has no questions and start_quiz strips `answer`", async () => {
    await as("anon");
    const list = (await pg.query("select public.get_quizzes('key1') as r")).rows[0].r;
    expect(list.map((q) => q.id)).toEqual(["qz"]);            // drafts are not shown
    expect(list[0]).not.toHaveProperty("questions");
    expect(Number(list[0].total)).toBe(3);
    const run = (await pg.query("select public.start_quiz('key1', 'qz') as r")).rows[0].r;
    expect(run.questions).toHaveLength(2);
    expect(JSON.stringify(run)).not.toContain('"answer"');
    expect(run.remainingMs).toBeGreaterThan(590000);
    await rejects(pg.query("select public.start_quiz('key1', 'draft')"), /not available/);
    await rejects(pg.query("select public.start_quiz('wrong', 'qz')"), /not available/);
    await rejects(pg.query("select * from public.quizzes"), /permission denied/);
    await rejects(pg.query("select * from public.quiz_attempts"), /permission denied/);
  });
  it("logs violations only for an open attempt", async () => {
    await as("anon");
    expect((await pg.query("select public.log_quiz_event('key1', 'qz', 'left-page') as n")).rows[0].n).toBe(1);
    expect((await pg.query("select public.log_quiz_event('key1', 'qz', 'paste') as n")).rows[0].n).toBe(2);
    expect((await pg.query("select public.log_quiz_event('key2', 'qz', 'paste') as n")).rows[0].n).toBeNull();   // key2 never started
    expect((await pg.query("select public.start_quiz('key1', 'qz') as r")).rows[0].r.violations).toBe(2);        // resuming keeps the count and the clock
  });
  it("scores on the server and writes the scaled score into the grade item", async () => {
    await as("anon");
    const r = (await pg.query(`select public.submit_quiz('key1', 'qz', '{"a1":1,"a2":true}'::jsonb) as r`)).rows[0].r;
    expect(r).toMatchObject({ points: 2, total: 3, late: false });
    expect(Number(r.score)).toBe(20);                       // 2 of 3 points on a 30-point item
    await as("authenticated", ADMIN);
    expect(Number((await pg.query("select scores ->> 'qz_item' as v from public.enrollments where key = 'key1'")).rows[0].v)).toBe(20);
    await as("anon");
    await rejects(pg.query(`select public.submit_quiz('key1', 'qz', '{}'::jsonb)`), /already submitted/);
    await rejects(pg.query("select public.start_quiz('key1', 'qz')"), /already submitted/);
    await rejects(pg.query(`select public.submit_quiz('key2', 'qz', '{}'::jsonb)`), /not started/);
  });
  it("scores 0 and flags it late when the time limit has passed", async () => {
    await as("anon");
    await pg.query("select public.start_quiz('key2', 'qz')");
    await pg.exec("reset role");
    await pg.query("update public.quiz_attempts set started = now() - interval '11 minutes' where key = 'key2'");
    await as("anon");
    const r = (await pg.query(`select public.submit_quiz('key2', 'qz', '{"a1":1,"a2":false}'::jsonb) as r`)).rows[0].r;
    expect(r).toMatchObject({ points: 0, total: 3, late: true });
  });
  it("lets only the owning instructor see attempts and allow a retake", async () => {
    await as("authenticated", TEACHER2);
    expect((await pg.query("select * from public.quiz_attempts")).rows).toHaveLength(0);
    expect((await pg.query("select * from public.quizzes")).rows).toHaveLength(0);
    await rejects(pg.query("select public.reset_quiz_attempt('qz', 'key1')"), /not allowed/);
    await as("authenticated", ADMIN);
    const seen = (await pg.query("select key, violations, late from public.quiz_attempts order by key")).rows;
    expect(seen).toEqual([{ key: "key1", violations: 2, late: false }, { key: "key2", violations: 0, late: true }]);
    await pg.query("select public.reset_quiz_attempt('qz', 'key1')");
    expect((await pg.query("select scores ? 'qz_item' as has from public.enrollments where key = 'key1'")).rows[0].has).toBe(false);
    await as("anon");
    expect((await pg.query("select public.start_quiz('key1', 'qz') as r")).rows[0].r.violations).toBe(0);         // a fresh attempt
  });
  it("does not let a student of another section open the quiz", async () => {
    await as("anon");
    await rejects(pg.query("select public.start_quiz('keyt1', 'qz')"), /not available/);
  });
});

describe("quiz answer review", () => {
  it("shows right and wrong only when the instructor allows it, only to the student who took it, and never for a late attempt", async () => {
    await as("anon");
    // key1 has a fresh, unsubmitted attempt from the retake test; the quiz does not show answers yet
    const sub = (await pg.query(`select public.submit_quiz('key1', 'qz', '{"a1":0,"a2":false}'::jsonb) as r`)).rows[0].r;
    expect(sub.review).toBeNull();
    expect((await pg.query("select public.quiz_review('key1', 'qz') as r")).rows[0].r).toBeNull();
    expect((await pg.query("select public.get_quizzes('key1') as r")).rows[0].r[0].showAnswers).toBe(false);

    await as("authenticated", ADMIN);
    await pg.query("update public.quizzes set show_answers = true where id = 'qz'");
    await as("anon");
    const rev = (await pg.query("select public.quiz_review('key1', 'qz') as r")).rows[0].r;
    expect(rev.map((x) => [x.id, x.right, x.yours, x.answer])).toEqual([["a1", false, 0, 1], ["a2", true, false, false]]);
    expect((await pg.query("select public.get_quizzes('key1') as r")).rows[0].r[0].showAnswers).toBe(true);
    expect((await pg.query("select public.quiz_review('key2', 'qz') as r")).rows[0].r).toBeNull();     // key2's attempt was late
    expect((await pg.query("select public.quiz_review('keyt1', 'qz') as r")).rows[0].r).toBeNull();    // never took it
    expect((await pg.query("select public.quiz_review('wrong', 'qz') as r")).rows[0].r).toBeNull();

    // a student who submits after it is on gets the review straight away
    await as("authenticated", ADMIN);
    await pg.query("select public.reset_quiz_attempt('qz', 'key1')");
    await as("anon");
    await pg.query("select public.start_quiz('key1', 'qz')");
    const now = (await pg.query(`select public.submit_quiz('key1', 'qz', '{"a1":1,"a2":true}'::jsonb) as r`)).rows[0].r;
    expect(now.review.map((x) => x.right)).toEqual([true, false]);
  });
});

describe("normalized tables: each fact is stored once", () => {
  const one = async (sql) => (await pg.query(sql)).rows[0];
  it("a student in two sections is one student with two enrollments, and one name", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.save_sections('[{"id":"a2","name":"A2","term":"2026-2027 2nd Semester"}]')`);
    await pg.query(`select public.upsert_students('[{"id":"S1@a2","name":"Ana","sec":"a2","pin":"111111","key":"key1b"}]')`);   // S1 again, in a second section
    expect((await one("select count(*)::int as n from public.students where student_no = 'S1'")).n).toBe(1);
    expect((await one("select count(*)::int as n from public.enrollments where student_no = 'S1'")).n).toBe(2);
    await as("anon");
    const both = (await one("select public.get_records(array['key1','key1b']) as r")).r;
    expect(both.map((r) => [r.id, r.name, r.sec])).toEqual([["S1", "Ana", "a"], ["S1@a2", "Ana", "a2"]]);
    // renaming the student once renames her in every section
    await as("authenticated", ADMIN);
    await pg.query(`select public.upsert_students('[{"id":"S1@a2","name":"Ana Reyes","sec":"a2","pin":"111111","key":"key1b"}]')`);
    await as("anon");
    expect((await one("select public.get_record('key1') as r")).r.name).toBe("Ana Reyes");
    await as("authenticated", ADMIN);
    await pg.query(`select public.upsert_students('[{"id":"S1@a2","name":"Ana","sec":"a2","pin":"111111","key":"key1b"}]')`);   // put it back
  });
  it("the email belongs to the student, so every section shows it", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.set_student_emails('[{"id":"S1@a2","email":"ana@school.edu"}]')`);
    const rows = (await pg.query("select e.login_id, st.email from public.enrollments e join public.students st using (student_no) where e.student_no = 'S1' order by 1")).rows;
    expect(rows).toEqual([{ login_id: "S1", email: "ana@school.edu" }, { login_id: "S1@a2", email: "ana@school.edu" }]);
    await pg.query(`select public.set_student_emails('[{"id":"S1","email":""}]')`);
  });
  it("removing the last enrollment removes the student; removing one of two keeps her", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.delete_students('[{"id":"S1@a2","key":"key1b"}]')`);
    expect((await one("select count(*)::int as n from public.students where student_no = 'S1'")).n).toBe(1);
    await pg.query(`select public.upsert_students('[{"id":"Z9","name":"Zed","sec":"a2","pin":"999999","key":"keyz9"}]')`);
    expect((await one("select count(*)::int as n from public.students where student_no = 'Z9'")).n).toBe(1);
    await pg.query(`select public.delete_students('[{"id":"Z9","key":"keyz9"}]')`);
    expect((await one("select count(*)::int as n from public.students where student_no = 'Z9'")).n).toBe(0);
  });
  it("a subject is stored once, shared by its sections, and goes away with its last section", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.save_sections('[
      {"id":"s1","name":"3A","subject":{"code":"IT 305","desc":"Web Dev"}},
      {"id":"s2","name":"3B","subject":{"code":"IT 305","desc":"Web Development"}}]')`);
    expect((await pg.query("select code, description from public.subjects where code = 'IT 305'")).rows).toEqual([{ code: "IT 305", description: "Web Development" }]);
    expect((await one("select count(*)::int as n from public.sections where subject_code = 'IT 305'")).n).toBe(2);
    await pg.query(`select public.save_sections('[{"id":"s2","name":"3B","subject":{"code":"IT 305","desc":""}}]')`);   // a blank description does not wipe the shared one
    expect((await one("select description from public.subjects where code = 'IT 305'")).description).toBe("Web Development");
    await pg.query(`select public.save_sections('[{"id":"s1","name":"3A","subject":{"code":"IT 306","desc":"Other"}}]')`);   // moving s1 to another subject
    expect((await one("select subject_code from public.sections where id = 's1'")).subject_code).toBe("IT 306");
    await pg.query("select public.delete_section('s2')");
    expect((await pg.query("select 1 from public.subjects where code = 'IT 305'")).rows).toHaveLength(0);   // nothing uses it any more
    await pg.query("select public.delete_section('s1')");
    await pg.query("select public.delete_section('a2')");
  });
  it("students are only visible to the instructor of their section; subjects are public", async () => {
    await as("authenticated", TEACHER2);
    expect((await pg.query("select student_no from public.students")).rows.map((r) => r.student_no)).toEqual(["T1"]);
    await as("anon");
    expect((await pg.query("select code from public.subjects order by 1")).rows.map((r) => r.code)).toContain("IT 101");
    await rejects(pg.query("select * from public.students"), /permission denied/);
  });
  it("one enrollment per student per section, and quiz attempts follow a PIN reset", async () => {
    await as("authenticated", ADMIN);
    await rejects(pg.query(`select public.upsert_students('[{"id":"S1@dup","name":"Ana","sec":"a","pin":"1","key":"keydup"}]')`), /unique|duplicate/);
    await pg.query(`select public.save_sections('[{"id":"qs","name":"QS"}]')`);
    await pg.query(`insert into public.quizzes (id, sec, title, questions, published) values ('qq', 'qs', 'Q', '[{"id":"x","type":"tf","text":"t","answer":true,"points":1}]', true)`);
    await pg.query(`select public.upsert_students('[{"id":"Q1","name":"Quin","sec":"qs","pin":"123456","key":"keyq1"}]')`);
    await as("anon");
    await pg.query("select public.start_quiz('keyq1', 'qq')");
    await as("authenticated", ADMIN);
    await pg.query("select public.reset_pin('Q1', 'keyq1', 'keyq1b', '654321')");
    expect((await pg.query("select key from public.quiz_attempts where quiz_id = 'qq'")).rows).toEqual([{ key: "keyq1b" }]);   // the attempt moved with the new key
    await pg.query("select public.delete_section('qs')");
    expect((await pg.query("select 1 from public.quiz_attempts where quiz_id = 'qq'")).rows).toHaveLength(0);   // and goes with the section
  });
});

describe("two instructors teaching the same student", () => {
  it("shares the student, but not the enrollments: each instructor sees only their own PIN, scores and sections", async () => {
    await as("authenticated", TEACHER2);
    expect(JSON.parse(JSON.stringify((await pg.query(`select public.taken_login_ids('["S1","T1","NEW1"]') as r`)).rows[0].r))).toEqual(["S1"]);   // S1 is ADMIN's; T1 is TEACHER2's own
    await rejects(pg.query(`select public.upsert_students('[{"id":"S1","name":"Ana","sec":"c","pin":"7","key":"keyshare0"}]')`), /already used by another instructor/);
    await pg.query(`select public.upsert_students('[{"id":"S1@c","name":"Someone Else","sec":"c","pin":"777777","key":"keyshare"}]')`);   // the second instructor's row id for the same student
    expect((await pg.query("select student_no, name from public.students order by 1")).rows).toEqual([{ student_no: "S1", name: "Ana" }, { student_no: "T1", name: "Tess" }]);   // one S1, and the name is not overwritten
    expect((await pg.query("select login_id, pin from public.enrollments order by 1")).rows).toEqual([{ login_id: "S1@c", pin: "777777" }, { login_id: "T1", pin: "666666" }]);
    await as("authenticated", ADMIN);
    expect((await pg.query("select login_id from public.enrollments where student_no = 'S1' order by 1")).rows.map((r) => r.login_id)).toEqual(["S1"]);   // the first instructor does not see the other's enrollment
    await as("anon");
    expect((await pg.query("select public.get_records(array['key1','keyshare']) as r")).rows[0].r.map((r) => [r.id, r.sec])).toEqual([["S1", "a"], ["S1@c", "c"]]);
    await as("authenticated", TEACHER2);
    await pg.query(`select public.delete_students('[{"id":"S1@c","key":"keyshare"}]')`);
    await as("authenticated", ADMIN);
    expect((await pg.query("select student_no from public.students where student_no = 'S1'")).rows).toHaveLength(1);   // S1 stays: still in the first instructor's section
  });
  it("nobody is a super instructor unless made one by hand: running the schema does not promote anyone", async () => {
    await pg.exec("reset role");
    expect((await pg.query("select count(*)::int as n from public.admins where is_super")).rows[0].n).toBe(1);   // only the one these tests created
  });
});
