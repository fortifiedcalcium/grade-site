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
    const tables = { meta: [{ id: 1, salt, title: "T", term: "", note: "", updated: null }], sections: [{ id: "a", data: { name: "A" } }, { id: "b", data: { name: "B" } }] };
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
