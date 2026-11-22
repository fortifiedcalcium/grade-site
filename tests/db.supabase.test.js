import { describe, it, expect } from "vitest";
import { createStudentApi, listen, isTeacher } from "../src/lib/db.js";
import { recordKey } from "../src/lib/keys.js";
import { describeAuthError } from "../src/lib/authErrors.js";

/* A stand-in for the Supabase client that supports just the calls db.js makes. */
function fakeClient({ tables = {}, rpc = {} } = {}) {
  const handlers = [];
  const client = {
    from(table) {
      const q = { rows: tables[table] || [], filters: [] };
      const api = {
        select() { return api; },
        eq(col, val) { q.filters.push([col, val]); return api; },
        maybeSingle() { return Promise.resolve({ data: result()[0] || null, error: null }); },
        then(res, rej) { return Promise.resolve({ data: result(), error: null }).then(res, rej); },
      };
      const result = () => q.rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
      return api;
    },
    rpc: (name, args) => Promise.resolve({ data: rpc[name] ? rpc[name](args) : null, error: null }),
    channel() {
      const ch = { on: (_t, _f, cb) => { handlers.push(cb); return ch; }, subscribe: () => ch };
      return ch;
    },
    removeChannel() {},
    emit: (payload) => handlers.forEach((h) => h(payload)),
  };
  return client;
}

describe("student lookup", () => {
  it("finds a record from student number + PIN, and rejects a wrong PIN", async () => {
    const key = await recordKey("salt", "2026-00001", "ABC234");
    const db = fakeClient({
      tables: {
        meta: [{ id: 1, title: "T", term: "Term", note: "", salt: "salt", updated: "2026-01-01T00:00:00Z" }],
        sections: [{ id: "a", name: "Section A", term: "2026-2027 1st Semester", subject_code: "IT 101", subjects: { description: "Intro" }, headings: [], instructor: "Dr. X", room_time: "Rm 1", scheme: { categories: [] } }],
      },
      rpc: { get_records: ({ p_keys }) => (p_keys.includes(key) ? [{ key, id: "2026-00001", name: "Ana", sec: "a", s: { q1: 9 }, updated: 1 }] : []) },
    });
    const api = createStudentApi(db);
    const ok = await api.login("2026-00001", "abc234");
    expect(ok.record.name).toBe("Ana");
    expect(ok.section.name).toBe("Section A");
    // the subject is stored once and joined in; the section still looks the way the screens expect
    expect(ok.section).toMatchObject({ term: "2026-2027 1st Semester", subject: { code: "IT 101", desc: "Intro" }, instructor: "Dr. X", roomTime: "Rm 1" });
    expect(ok.meta.updated).toBe(Date.parse("2026-01-01T00:00:00Z"));
    await expect(api.login("2026-00001", "WRONG1")).rejects.toMatchObject({ code: "nomatch" });
  });
  it("acknowledges a grade and rejects an unknown key", async () => {
    const db = fakeClient({ tables: {}, rpc: { acknowledge_grade: ({ p_key }) => (p_key === "good" ? 1234 : null) } });
    const api = createStudentApi(db);
    await expect(api.acknowledge("good")).resolves.toBe(1234);
    await expect(api.acknowledge("bad")).rejects.toMatchObject({ code: "nomatch" });
  });
  it("says grades are not published when there is no salt yet", async () => {
    const db = fakeClient({ tables: { meta: [], sections: [] } });
    await expect(createStudentApi(db).login("1", "2")).rejects.toMatchObject({ code: "notpublished" });
  });
});

describe("listen", () => {
  it("patches a plain table from realtime events", async () => {
    const db = fakeClient({ tables: { quizzes: [{ id: "q1", sec: "a", title: "One", questions: [], published: false, updated: null }] } });
    const seen = [];
    const stop = listen(db, "quizzes", (v) => seen.push(v), () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.keys(seen.at(-1))).toEqual(["q1"]);
    db.emit({ eventType: "UPDATE", new: { id: "q1", sec: "a", title: "Renamed", questions: [], published: true, updated: null } });
    expect(seen.at(-1).q1).toMatchObject({ title: "Renamed", published: true });
    db.emit({ eventType: "INSERT", new: { id: "q2", sec: "a", title: "Two", questions: [], updated: null } });
    expect(Object.keys(seen.at(-1))).toEqual(["q1", "q2"]);
    db.emit({ eventType: "DELETE", old: { id: "q1" } });
    expect(Object.keys(seen.at(-1))).toEqual(["q2"]);
    stop();
  });
  it("builds the roster and the records from the same enrollments joined with their students", async () => {
    const enr = { login_id: "S1", student_no: "S1", sec: "a", pin: "ABC234", key: "k1", scores: { q1: 1 }, acknowledged: null, emailed: null, updated: null, students: { name: "Ana", email: "ana@example.com" } };
    const db = fakeClient({ tables: { enrollments: [enr] } });
    const roster = [], records = [];
    const stopA = listen(db, "roster", (v) => roster.push(v), () => {});
    const stopB = listen(db, "records", (v) => records.push(v), () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(roster.at(-1)).toEqual({ S1: { name: "Ana", sec: "a", pin: "ABC234", key: "k1", email: "ana@example.com", emailed: null } });
    expect(records.at(-1)).toEqual({ k1: { id: "S1", name: "Ana", sec: "a", s: { q1: 1 }, updated: null, ack: null } });
    stopA(); stopB();
  });
  it("reads a joined table again when something changes, instead of patching it", async () => {
    const table = [{ login_id: "S1", sec: "a", pin: "P", key: "k1", scores: {}, students: { name: "Ana" } }];
    const db = fakeClient({ tables: { enrollments: table } });
    const seen = [];
    const stop = listen(db, "records", (v) => seen.push(v), () => {});
    await new Promise((r) => setTimeout(r, 0));
    table.push({ login_id: "S2", sec: "a", pin: "P", key: "k2", scores: {}, students: { name: "Ben" } });
    db.emit({ eventType: "INSERT", new: { login_id: "S2" } });   // the event has no student name; the table is read again
    await new Promise((r) => setTimeout(r, 300));
    expect(Object.values(seen.at(-1)).map((r) => r.name)).toEqual(["Ana", "Ben"]);
    stop();
  });
  it("saves a section through save_sections, without its count or owner", async () => {
    const { saveSection } = await import("../src/lib/db.js");
    const calls = [];
    const db = { rpc: (name, args) => { calls.push([name, args]); return Promise.resolve({ data: null, error: null }); } };
    await saveSection(db, "a", { name: "A", count: 3, owner: "u1", term: "T", subject: { code: "X", desc: "D" }, scheme: { categories: [] } });
    expect(calls).toEqual([["save_sections", { p_rows: [{ id: "a", name: "A", term: "T", subject: { code: "X", desc: "D" }, scheme: { categories: [] } }] }]]);
  });
});

describe("instructor check", () => {
  it("is true only for users listed in admins", async () => {
    const db = fakeClient({ tables: { admins: [{ user_id: "u1" }] } });
    expect(await isTeacher(db, { id: "u1" })).toBe(true);
    expect(await isTeacher(db, { id: "u2" })).toBe(false);
  });
});

describe("sign-in errors", () => {
  it("explains the common Supabase auth failures", () => {
    expect(describeAuthError({ code: "invalid_credentials" }, false)).toMatch(/Wrong email or password/);
    expect(describeAuthError({ code: "email_not_confirmed" }, false)).toMatch(/confirm/i);
    expect(describeAuthError({ code: "user_already_exists" }, true)).toMatch(/already exists/);
    expect(describeAuthError({ code: "weak_password" }, true)).toMatch(/at least 6/);
    expect(describeAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }, false)).toMatch(/Network/);
    expect(describeAuthError({ code: "invalid_credentials" }, true)).toMatch(/^Registration failed/);
  });
});

describe("bulk operations", () => {
  const rpcLog = () => {
    const calls = [];
    return { calls, db: { rpc: (name, args) => { calls.push([name, args]); return Promise.resolve({ data: null, error: null }); } } };
  };
  it("clearSectionScores blanks scores for one section only and keeps PINs", async () => {
    const { clearSectionScores } = await import("../src/lib/db.js");
    const { calls, db } = rpcLog();
    const roster = {
      S1: { name: "Ana", sec: "a", pin: "111111", key: "k1" },
      S2: { name: "Ben", sec: "b", pin: "222222", key: "k2" },
      S3: { name: "Cy", sec: "a", pin: "333333", key: "k3" },
    };
    expect(await clearSectionScores(db, "a", roster)).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["clear_quiz_attempts", { p_sec: "a" }]);   // quiz attempts go too, so quizzes can be retaken
    expect(calls[1][0]).toBe("upsert_students");
    expect(calls[1][1].p_rows).toEqual([
      { id: "S1", name: "Ana", sec: "a", pin: "111111", key: "k1", s: {} },
      { id: "S3", name: "Cy", sec: "a", pin: "333333", key: "k3", s: {} },
    ]);
  });
  it("removeStudents sends big lists in chunks", async () => {
    const { removeStudents } = await import("../src/lib/db.js");
    const { calls, db } = rpcLog();
    const list = Array.from({ length: 450 }, (_, i) => ({ id: "S" + i, key: "k" + i }));
    expect(await removeStudents(db, list)).toBe(450);
    expect(calls.map((c) => c[1].p_rows.length)).toEqual([200, 200, 50]);
  });
});

describe("students shared by two instructors", () => {
  it("gives the new enrollment its own row id (and so its own key and PIN) when another instructor already uses the plain one", async () => {
    const { addStudent } = await import("../src/lib/db.js");
    const calls = [];
    const db = { rpc: (name, args) => { calls.push([name, args]); return Promise.resolve({ data: name === "taken_login_ids" ? ["2026-00001"] : null, error: null }); } };
    const r = await addStudent(db, { salt: "salt" }, { id: "2026-00001", name: "Ana", sec: "mine" }, {});
    expect(r.id).toBe("2026-00001@mine");
    expect(r.no).toBe("2026-00001");
    const row = calls.find((c) => c[0] === "upsert_students")[1].p_rows[0];
    expect(row).toMatchObject({ id: "2026-00001@mine", name: "Ana", sec: "mine" });
    // a free number keeps the plain row id
    const free = { rpc: (name, args) => { calls.push([name, args]); return Promise.resolve({ data: null, error: null }); } };
    expect((await addStudent(free, { salt: "salt" }, { id: "2026-00002", name: "Ben", sec: "mine" }, {})).id).toBe("2026-00002");
  });
});
