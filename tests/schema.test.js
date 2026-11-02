import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/* Runs supabase/schema.sql in an in-process Postgres with Supabase's roles and auth.uid() stubbed,
   then checks who can read and write what. */

const ADMIN = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
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
    insert into auth.users values ('${ADMIN}', 'teacher@example.com'), ('${OTHER}', 'someone@example.com');
  `);
  await pg.exec(fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  await pg.exec(`insert into public.admins values ('${ADMIN}')`);
  await pg.exec(`
    insert into public.meta (id, title, salt) values (1, 'Grades', 'salt');
    insert into public.sections (id, data) values ('a', '{"name":"A"}');
    insert into public.roster values ('S1', 'Ana', 'a', '111111', 'key1'), ('S2', 'Ben', 'a', '222222', 'key2');
    insert into public.records (key, student_id, name, sec, s) values
      ('key1', 'S1', 'Ana', 'a', '{"q1": 9}'), ('key2', 'S2', 'Ben', 'a', '{}');
  `);
});

describe("students (not signed in)", () => {
  it("can read the public tables", async () => {
    await as("anon");
    expect((await pg.query("select title from public.meta")).rows).toEqual([{ title: "Grades" }]);
    expect((await pg.query("select id from public.sections")).rows).toEqual([{ id: "a" }]);
  });
  it("cannot read or list the roster, records or admins", async () => {
    await as("anon");
    await rejects(pg.query("select * from public.roster"), /permission denied/);
    await rejects(pg.query("select * from public.records"), /permission denied/);
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
    expect((await pg.query("select acknowledged from public.records where key = 'key1'")).rows[0].acknowledged).not.toBeNull(); // same scores: kept
    await pg.query("select public.set_score('key1', 'q1', '10')");
    expect((await pg.query("select acknowledged from public.records where key = 'key1'")).rows[0].acknowledged).toBeNull();
    await pg.query("select public.set_score('key1', 'q1', '9')"); // put it back for the tests below
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
    expect((await pg.query("select * from public.roster")).rows).toHaveLength(0);
    expect((await pg.query("select * from public.records")).rows).toHaveLength(0);
    expect((await pg.query("select * from public.admins")).rows).toHaveLength(0);
    await rejects(pg.query("insert into public.meta (id, title) values (2, 'x')"));
    await rejects(pg.query("select public.set_score('key1', 'q1', '10')"), /not allowed/);
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
    expect((await pg.query("select * from public.roster")).rows).toHaveLength(2);
  });
  it("sets, replaces and clears a single score without touching the others", async () => {
    await as("authenticated", ADMIN);
    await pg.query("select public.set_score('key1', 'q2', '7.5')");
    await pg.query("select public.set_score('key1', 'q3', '\"INC\"')");
    let s = (await pg.query("select s from public.records where key = 'key1'")).rows[0].s;
    expect(s).toEqual({ q1: 9, q2: 7.5, q3: "INC" });
    await pg.query("select public.set_score('key1', 'q3', null)");
    await pg.query("select public.set_score('key1', 'q2', 'null'::jsonb)");
    s = (await pg.query("select s from public.records where key = 'key1'")).rows[0].s;
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
    expect((await pg.query("select s from public.records where key = 'key3'")).rows[0].s).toEqual({});
    await pg.query("select public.set_score('key3', 'q1', '5')");
    await pg.query("select public.reset_pin('S3', 'key3', 'key3b', '444444')");
    expect((await pg.query("select pin, key from public.roster where student_id = 'S3'")).rows[0]).toEqual({ pin: "444444", key: "key3b" });
    expect((await pg.query("select s from public.records where key = 'key3b'")).rows[0].s).toEqual({ q1: 5 });
    expect((await pg.query("select 1 from public.records where key = 'key3'")).rows).toHaveLength(0);
    await pg.query(`select public.delete_students('[{"id":"S3","key":"key3b"}]')`);
    expect((await pg.query("select 1 from public.roster where student_id = 'S3'")).rows).toHaveLength(0);
    expect((await pg.query("select 1 from public.records where key = 'key3b'")).rows).toHaveLength(0);
  });
  it("re-importing replaces a student's scores", async () => {
    await as("authenticated", ADMIN);
    await pg.query(`select public.upsert_students('[{"id":"S2","name":"Ben","sec":"a","pin":"222222","key":"key2","s":{"q1":3}}]')`);
    expect((await pg.query("select s from public.records where key = 'key2'")).rows[0].s).toEqual({ q1: 3 });
  });
  it("updates one meta field without wiping the others", async () => {
    await as("authenticated", ADMIN);
    await pg.query("insert into public.meta (id, term) values (1, 'T1') on conflict (id) do update set term = excluded.term");
    expect((await pg.query("select title, term, salt from public.meta")).rows[0]).toEqual({ title: "Grades", term: "T1", salt: "salt" });
  });
  it("deleting a section removes its students and their scores and reports the count", async () => {
    await as("authenticated", ADMIN);
    await pg.query("insert into public.sections (id, data) values ('b', '{\"name\":\"B\"}')");
    await pg.query(`select public.upsert_students('[{"id":"B1","name":"Di","sec":"b","pin":"555555","key":"keyb1"}]')`);
    const n = (await pg.query("select public.delete_section('b') as n")).rows[0].n;
    expect(n).toBe(1);
    expect((await pg.query("select 1 from public.sections where id = 'b'")).rows).toHaveLength(0);
    expect((await pg.query("select 1 from public.records where sec = 'b'")).rows).toHaveLength(0);
    expect((await pg.query("select 1 from public.roster where sec = 'a'")).rows.length).toBeGreaterThan(0);
  });
});
