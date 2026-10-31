import { describe, it, expect } from "vitest";
import fs from "node:fs";
import * as XLSX from "xlsx";
import { computeGrade, lookupEquivalent, DEFAULT_SCALE } from "../src/lib/grading.js";
import { parseScoreInput } from "../src/lib/util.js";
import { recordKey, safeId, makePin } from "../src/lib/keys.js";
import { sheetsFromWorkbook, parseClassRecord } from "../src/lib/importer.js";
import { mergeSection } from "../src/lib/db.js";

const scheme = {
  finalCategory: "final", holdFinal: true, passEquiv: 3, scale: DEFAULT_SCALE,
  categories: [
    { id: "act", title: "Activities", weight: 60, items: [{ k: "a1", max: 10 }, { k: "a2", max: 10 }] },
    { id: "final", title: "Final", weight: 40, items: [{ k: "f1", max: 50 }] },
  ],
};

describe("grading", () => {
  it("computes weighted points and equivalent", () => {
    const g = computeGrade(scheme, { a1: 10, a2: 5, f1: 40 });
    expect(g.total).toBe(77);
    expect(g.equiv).toBe(2.75);
    expect(g.remarks).toBe("Passed");
  });
  it("holds when final missing; blanks count as 0; text counts as 0", () => {
    const g = computeGrade(scheme, { a1: 10, a2: "INC" });
    expect(g.pending).toBe(true);
    expect(g.total).toBe(30);
    expect(g.remarks).toBe("Failed");
  });
  it("scale boundaries", () => {
    expect(lookupEquivalent(DEFAULT_SCALE, 74.99)).toBe(5);
    expect(lookupEquivalent(DEFAULT_SCALE, 75)).toBe(3);
    expect(lookupEquivalent(DEFAULT_SCALE, 96.5)).toBe(1);
  });
});

describe("helpers", () => {
  it("parses score input", () => {
    expect(parseScoreInput("")).toBe(null);
    expect(parseScoreInput(" 12.5 ")).toBe(12.5);
    expect(parseScoreInput("INC")).toBe("INC");
  });
  it("keys are stable and depend on PIN", async () => {
    const a = await recordKey("salt", "2026-00001", "abc123");
    expect(a).toBe(await recordKey("salt", " 2026-00001 ", "ABC123"));
    expect(a).not.toBe(await recordKey("salt", "2026-00001", "ABC124"));
    expect(a).toHaveLength(32);
    expect(safeId("a.b/c")).toBe("A-B-C");
    expect(makePin()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it("mergeSection keeps teacher edits", () => {
    const inc = { name: "X", headings: [], subject: { code: "", desc: "" }, instructor: "", roomTime: "", scheme: { ...scheme, categories: scheme.categories } };
    const ex = { ...inc, instructor: "Mr. E", scheme: { ...scheme, passEquiv: 2.5, categories: [{ ...scheme.categories[0], weight: 55 }, scheme.categories[1]] } };
    const m = mergeSection(ex, inc);
    expect(m.instructor).toBe("Mr. E");
    expect(m.scheme.passEquiv).toBe(2.5);
    expect(m.scheme.categories[0].weight).toBe(55);
  });
});

const REAL = process.env.CLASS_RECORD;
describe.skipIf(!REAL || !fs.existsSync(REAL || ""))("real workbook", () => {
  it("matches the file's final grades except known formula bug", () => {
    const res = parseClassRecord(sheetsFromWorkbook(XLSX, fs.readFileSync(REAL), "buffer"));
    expect(res.errors).toEqual([]);
    expect(res.students.length).toBe(144);
    expect(res.sections.length).toBe(6);
    expect(res.mismatches.length).toBeLessThanOrEqual(2);
  });
});

describe("sections and items", () => {
  it("a new section's weights add up to 100 and it computes a grade", async () => {
    const { blankScheme } = await import("../src/lib/db.js");
    const sc = blankScheme();
    expect(sc.categories.reduce((a, c) => a + c.weight, 0)).toBe(100);
    const all = {};
    sc.categories.forEach((c) => c.items.forEach((i) => { all[i.k] = i.max; }));
    expect(computeGrade(sc, all).total).toBe(100);
  });
  it("item keys are unique, even when made in the same millisecond", async () => {
    const { newItemKey } = await import("../src/lib/db.js");
    const keys = new Set(Array.from({ length: 500 }, () => newItemKey("quizzes")));
    expect(keys.size).toBe(500);
    keys.forEach((k) => expect(k).toMatch(/^[A-Za-z0-9_]+$/));
  });
});
