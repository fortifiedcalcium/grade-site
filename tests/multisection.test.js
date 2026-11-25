import { describe, it, expect } from "vitest";
import { parseClassRecord } from "../src/lib/importer.js";
import { resolveRow, createStudentApi } from "../src/lib/db.js";
import { recordKey, studentNo, taggedRowId } from "../src/lib/keys.js";

// header row, label row, maximum-score row, then the students
const sheet = (name, rows) => ({ name, hidden: false, aoa: [["ID NO.", "NAME", "Quizzes"], ["", "", "Quiz 1"], ["", "", 10], ...rows] });

describe("the same student in several sections", () => {
  it("is accepted across sheets, but not twice in one sheet", () => {
    const ok = parseClassRecord([sheet("3A", [["S1000", "ANA", 5], ["S2000", "BEN", 6]]), sheet("3B", [["S1000", "ANA", 7]])]);
    expect(ok.errors).toEqual([]);
    expect(ok.students.filter((s) => s.id === "S1000").map((s) => s.sec)).toHaveLength(2);
    const twice = parseClassRecord([sheet("3A", [["S1000", "ANA", 5], ["S1000", "ANA", 6]])]);
    expect(twice.errors.join(" ")).toMatch(/appears twice/);
  });

  it("gives the second section a tagged row and keeps the student's PIN", () => {
    const roster = { S1: { name: "ANA", sec: "a", pin: "AAA111", key: "k1" } };
    const second = resolveRow(roster, "S1", "b");
    expect(second).toMatchObject({ id: "S1@b", existing: null, pin: "AAA111" });
    const again = resolveRow({ ...roster, "S1@b": { name: "ANA", sec: "b", pin: "AAA111", key: "k2" } }, "S1", "b");
    expect(again.id).toBe("S1@b");
    expect(again.existing.key).toBe("k2");               // re-importing finds the same row
    expect(resolveRow(roster, "S1", "a").id).toBe("S1");   // and the first section keeps the plain id
    expect(resolveRow({}, "S9", "a")).toMatchObject({ id: "S9", existing: null });
  });

  it("shows the plain student number", () => {
    expect(studentNo("2025012382@3h-g2")).toBe("2025012382");
    expect(studentNo("2025012382")).toBe("2025012382");
    expect(taggedRowId("2025 012", "b")).toBe("2025012@b");
  });

  it("signs in with one number + PIN and finds every section", async () => {
    const salt = "salt";
    const k1 = await recordKey(salt, "S1", "ABC234");
    const k2 = await recordKey(salt, "S1@b", "ABC234");
    expect(k1).not.toBe(k2);
    const recs = { [k1]: { key: k1, id: "S1", name: "Ana", sec: "a", s: {} }, [k2]: { key: k2, id: "S1@b", name: "Ana", sec: "b", s: {} } };
    const tables = { meta: [{ id: 1, salt, title: "T", term: "", note: "", updated: null }], sections: [{ id: "a", name: "A", subject_code: null, scheme: {} }, { id: "b", name: "B", subject_code: null, scheme: {} }] };
    const db = {
      from: (t) => { const api = { select: () => api, eq: () => api, maybeSingle: () => Promise.resolve({ data: tables[t][0], error: null }), then: (res, rej) => Promise.resolve({ data: tables[t], error: null }).then(res, rej) }; return api; },
      rpc: (name, { p_keys }) => Promise.resolve({ data: name === "get_records" ? p_keys.filter((k) => recs[k]).map((k) => recs[k]) : null, error: null }),
    };
    const r = await createStudentApi(db).login("s1", "abc234");
    expect(r.others.map((o) => o.section.name)).toEqual(["A", "B"]);
    expect(r.record.sec).toBe("a");
    await expect(createStudentApi(db).login("S1", "WRONG1")).rejects.toMatchObject({ code: "nomatch" });
  });
});

describe("sign-in with more than 50 sections", () => {
  // the stand-in behaves like the real get_records: it only looks at the first 50 keys of a request
  const portal = async (count, enrolledIn, { failGroup } = {}) => {
    const { createStudentApi } = await import("../src/lib/db.js");
    const { recordKey, taggedRowId } = await import("../src/lib/keys.js");
    const ids = Array.from({ length: count }, (_, i) => "s" + String(i).padStart(3, "0"));
    const recs = {};
    for (const [sec, plain] of enrolledIn) {
      const id = plain ? "2026-1" : taggedRowId("2026-1", sec);
      const key = await recordKey("salt", id, "ABC234");
      recs[key] = { key, id, name: "Ana", sec, s: {} };
    }
    const requests = [];
    const tables = { meta: [{ id: 1, salt: "salt", title: "T", term: "", note: "", updated: null }], sections: ids.map((id) => ({ id, name: id, subject_code: null, scheme: {} })) };
    const db = {
      from: (t) => { const api = { select: () => api, eq: () => api, maybeSingle: () => Promise.resolve({ data: tables[t][0], error: null }), then: (res, rej) => Promise.resolve({ data: tables[t], error: null }).then(res, rej) }; return api; },
      rpc: (_name, { p_keys }) => {
        requests.push(p_keys.length);
        if (failGroup === requests.length) return Promise.resolve({ data: null, error: new Error("network") });
        return Promise.resolve({ data: p_keys.slice(0, 50).filter((k) => recs[k]).map((k) => recs[k]), error: null });
      },
    };
    return { api: createStudentApi(db), requests };
  };
  it("finds classes beyond the first 50 keys, all in one stable order", async () => {
    const { api, requests } = await portal(120, [["s119", false], ["s002", true], ["s075", false]]);
    const r = await api.login("2026-1", "ABC234");
    expect(r.others.map((o) => o.record.sec)).toEqual(["s002", "s075", "s119"]);
    expect(r.record.sec).toBe("s002");
    expect(requests).toEqual([50, 50, 21]);   // 120 sections + the plain number, never more than 50 at once
  }, 60000);
  it("signs in a student whose only class is past the 50th key", async () => {
    const { api } = await portal(60, [["s058", false]]);
    expect((await api.login("2026-1", "ABC234")).record.sec).toBe("s058");
  }, 60000);
  it("uses one request while there are few sections", async () => {
    const { api, requests } = await portal(37, [["s010", true]]);
    await api.login("2026-1", "ABC234");
    expect(requests).toEqual([38]);
  }, 60000);
  it("fails the sign-in if any group fails, rather than hiding a class; a wrong PIN still says no match", async () => {
    const broken = await portal(120, [["s002", true], ["s119", false]], { failGroup: 3 });
    await expect(broken.api.login("2026-1", "ABC234")).rejects.toThrow(/network/);
    const { api } = await portal(60, [["s058", false]]);
    await expect(api.login("2026-1", "WRONG1")).rejects.toMatchObject({ code: "nomatch" });
  }, 60000);
});
