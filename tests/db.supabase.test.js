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
        sections: [{ id: "a", data: { name: "Section A" } }],
      },
      rpc: { get_record: ({ p_key }) => (p_key === key ? { id: "2026-00001", name: "Ana", sec: "a", s: { q1: 9 }, updated: 1 } : null) },
    });
    const api = createStudentApi(db);
    const ok = await api.login("2026-00001", "abc234");
    expect(ok.record.name).toBe("Ana");
    expect(ok.section.name).toBe("Section A");
    expect(ok.meta.updated).toBe(Date.parse("2026-01-01T00:00:00Z"));
    await expect(api.login("2026-00001", "WRONG1")).rejects.toMatchObject({ code: "nomatch" });
  });
  it("says grades are not published when there is no salt yet", async () => {
    const db = fakeClient({ tables: { meta: [], sections: [] } });
    await expect(createStudentApi(db).login("1", "2")).rejects.toMatchObject({ code: "notpublished" });
  });
});

describe("listen", () => {
  it("delivers the table as a map and patches it from realtime events", async () => {
    const db = fakeClient({ tables: { records: [{ key: "k1", student_id: "S1", name: "Ana", sec: "a", s: { q1: 1 }, updated: null }] } });
    const seen = [];
    const stop = listen(db, "records", (v) => seen.push(v), () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.at(-1)).toEqual({ k1: { id: "S1", name: "Ana", sec: "a", s: { q1: 1 }, updated: null } });
    db.emit({ eventType: "UPDATE", new: { key: "k1", student_id: "S1", name: "Ana", sec: "a", s: { q1: 2 }, updated: null } });
    expect(seen.at(-1).k1.s).toEqual({ q1: 2 });
    db.emit({ eventType: "INSERT", new: { key: "k2", student_id: "S2", name: "Ben", sec: "a", s: {}, updated: null } });
    expect(Object.keys(seen.at(-1))).toEqual(["k1", "k2"]);
    db.emit({ eventType: "DELETE", old: { key: "k1" } });
    expect(Object.keys(seen.at(-1))).toEqual(["k2"]);
    stop();
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
