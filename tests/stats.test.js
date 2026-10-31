import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import JSZip from "jszip";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { computeGrade, DEFAULT_SCALE } from "../src/lib/grading.js";
import { summarize, summarizeNamed, buildStats, filterAndSort, namesText } from "../src/lib/stats.js";
import { buildReport } from "../src/lib/report.js";
import { makeReportFile, buildPdfDoc } from "../src/lib/exporters.js";

const sec = {
  name: "2A", instructor: "Prof. Cruz",
  scheme: {
    passEquiv: 3, scale: DEFAULT_SCALE, finalCategory: "final", holdFinal: true,
    categories: [
      { id: "act", title: "Activities", weight: 30, items: [{ k: "a1", label: "Act 1", max: 10 }, { k: "a2", label: "Act 2", max: 10 }] },
      { id: "quiz", title: "Quizzes", weight: 30, items: [{ k: "z1", label: "Quiz 1", max: 10 }] },
      { id: "final", title: "Final Exam", weight: 40, items: [{ k: "f1", label: "Final", max: 50 }] },
    ],
  },
};
const raw = [
  { id: "S1", name: "ANA", s: { a1: 10, a2: 8, z1: 9, f1: 45 } },
  { id: "S2", name: "BEN", s: { a1: 6, z1: 4, f1: 20 } },            // a2 blank
  { id: "S3", name: "CY", s: { a1: 8, a2: "INC", z1: 10, f1: 50 } },  // a2 is text
  { id: "S4", name: "DEE", s: { a1: 9, a2: 9, z1: 8 } },              // final not recorded -> pending
];
const graded = raw.map((x) => ({ ...x, g: computeGrade(sec.scheme, x.s) }));

describe("statistics", () => {
  it("summarize ignores blanks and text", () => {
    expect(summarize([10, 6, 8, null, undefined, "INC"])).toEqual({ n: 3, max: 10, min: 6, avg: 8 });
    expect(summarize([])).toEqual({ n: 0, max: null, min: null, avg: null });
  });
  it("summarizeNamed reports everyone tied for highest and lowest", () => {
    const s = summarizeNamed([{ name: "A", value: 5 }, { name: "B", value: 9 }, { name: "C", value: 9 }, { name: "D", value: 1 }]);
    expect(s.highest).toEqual(["B", "C"]);
    expect(s.lowest).toEqual(["D"]);
    expect(namesText(s.highest)).toBe("B (+1 more)");
  });
  it("per-score statistics only count scores that are numbers", () => {
    const st = buildStats(sec, graded, ["act", "quiz", "final"]);
    expect(st.items.a1).toMatchObject({ n: 4, max: 10, min: 6 });
    expect(st.items.a1.avg).toBeCloseTo(8.25);
    expect(st.items.a2).toMatchObject({ n: 2, max: 9, min: 8 });   // BLANK and INC are not counted
  });
  it("category statistics use points out of the weight and skip students with nothing recorded", () => {
    const st = buildStats(sec, graded, ["act"]);
    expect(st.cats).toHaveLength(1);
    const act = st.cats[0];
    expect(act.n).toBe(4);
    expect(act.highest).toEqual(["ANA", "DEE"]);   // both 18/20 * 30 = 27
    expect(act.max).toBeCloseTo(27);
    expect(act.lowest).toEqual(["BEN"]);    // 6/20 * 30 = 9
    expect(Object.keys(st.items)).toEqual(["a1", "a2"]);   // only the chosen category
  });
  it("final statistics leave out students whose final is pending", () => {
    const st = buildStats(sec, graded, ["act", "quiz", "final"]);
    expect(st.final.n).toBe(3);
    expect(st.final.highest).toEqual(["ANA"]);
  });
});

describe("filter and sort", () => {
  it("filters by status", () => {
    expect(filterAndSort(graded, "pending", "name").map((x) => x.name)).toEqual(["DEE"]);
    const passed = filterAndSort(graded, "passed", "name").map((x) => x.name);
    const failed = filterAndSort(graded, "failed", "name").map((x) => x.name);
    expect([...passed, ...failed].sort()).toEqual(["ANA", "BEN", "CY"]);
    expect(filterAndSort(graded, "all", "name")).toHaveLength(4);
  });
  it("sorts by grade with pending students last", () => {
    // ANA 90, CY 82 (the INC counts as 0), BEN 37, DEE pending
    expect(filterAndSort(graded, "all", "high").map((x) => x.name)).toEqual(["ANA", "CY", "BEN", "DEE"]);
    expect(filterAndSort(graded, "all", "low").map((x) => x.name)).toEqual(["BEN", "CY", "ANA", "DEE"]);
    expect(filterAndSort(graded, "all", "id").map((x) => x.id)).toEqual(["S1", "S2", "S3", "S4"]);
  });
});

describe("report with a view", () => {
  const build = (view) => buildReport({ sec, meta: {}, students: raw, now: new Date("2026-10-31"), view });

  it("with every category shown it lists category points", () => {
    const r = build({});
    expect(r.columns.map((c) => c.label)).toEqual(["No.", "Name", "Activities (30%)", "Quizzes (30%)", "Final Exam (40%)", "Final", "Eq.", "Remarks"]);
    expect(r.rowKinds).toEqual(["student", "student", "student", "student", "stat", "stat", "stat"]);
  });
  it("with one category shown it lists each score of that category and its statistics", () => {
    const r = build({ hiddenCats: ["quiz", "final"], showFinal: false, filterNote: "Columns: Activities" });
    expect(r.columns.map((c) => c.label)).toEqual(["No.", "Name", "Act 1 (/10)", "Act 2 (/10)"]);
    expect(r.rows[0]).toEqual(["S1", "ANA", "10", "8"]);
    expect(r.rows[1]).toEqual(["S2", "BEN", "6", ""]);
    const stat = Object.fromEntries(r.rows.slice(4).map((row) => [row[1], row.slice(2)]));
    expect(stat.Highest).toEqual(["10.00", "9.00"]);
    expect(stat.Lowest).toEqual(["6.00", "8.00"]);
    expect(stat.Average).toEqual(["8.25", "8.50"]);
    expect(r.filterNote).toBe("Columns: Activities");
    expect(r.statsTable.rows.map((x) => x[0])).toEqual(["Activities"]);   // no Final grade row
  });
  it("statistics only drops the student rows; students only drops the statistics", () => {
    const only = build({ show: "stats" });
    expect(only.rowKinds).toEqual(["stat", "stat", "stat"]);
    const students = build({ show: "students" });
    expect(students.rowKinds.every((k) => k === "student")).toBe(true);
    expect(students.statsTable).toBeNull();
  });
  it("many scores fall back to category points so the table fits the page", () => {
    const wide = { ...sec, scheme: { ...sec.scheme, categories: [{ id: "big", title: "Big", weight: 50, items: Array.from({ length: 12 }, (_, i) => ({ k: "b" + i, label: "B" + i, max: 5 })) }, sec.scheme.categories[2]] } };
    const r = buildReport({ sec: wide, meta: {}, students: [{ id: "S1", name: "ANA", s: {} }], view: { hiddenCats: ["final"] } });
    expect(r.columns.map((c) => c.label)).toContain("Big (50%)");
  });
  it("the CSV text keeps whole scores whole and gives grades two decimals", () => {
    const r = build({ hiddenCats: ["quiz", "final"] });
    expect(r.detailHead).toEqual(["Student no.", "Name", "Activities Act 1", "Activities Act 2", "Final grade", "Equivalent", "Remarks"]);
    expect(r.detailText[1].slice(0, 4)).toEqual(["S1", "ANA", "10", "8"]);
    expect(r.detailText.at(-3).slice(0, 4)).toEqual(["", "Highest", "10.00", "9.00"]);
  });
});

describe("filtered exports", () => {
  let assets;
  beforeAll(() => {
    const read = (f) => new Uint8Array(fs.readFileSync(new URL("../public/report/" + f, import.meta.url)));
    assets = { letterhead: read("letterhead.png"), banner: read("banner.png"), logos: read("logos.png"), strip: read("strip.png") };
  });
  const report = () => buildReport({ sec, meta: {}, students: raw, now: new Date("2026-10-31"), view: { hiddenCats: ["quiz", "final"], showFinal: false, filterNote: 'Status: Passed  ·  Columns: Activities' } });

  it("xlsx has the statistics sheet, Arial everywhere, and styled statistic rows", async () => {
    const { blob } = await makeReportFile("xlsx", report(), assets);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Grade Report", "All scores", "Statistics"]);
    const fonts = new Set();
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { if (c.value != null && c.font) fonts.add(c.font.name); })));
    expect([...fonts]).toEqual(["Arial"]);
    const st = wb.getWorksheet("Statistics");
    expect(st.getRow(5).getCell(1).value).toBe("Activities");
    expect(typeof st.getRow(5).getCell(4).value).toBe("number");
  });
  it("docx carries the filter line, the statistics table and only Arial", async () => {
    const { blob } = await makeReportFile("docx", report(), assets);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const doc = await zip.file("word/document.xml").async("string");
    expect(doc).toContain("Filters: ");
    expect(doc).toContain("Status: Passed");
    expect(doc).toContain("Summary statistics");
    expect(doc).toContain("Highest scored by");
    expect(new Set([...doc.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]))).toEqual(new Set(["Arial"]));
  });
  it("pdf builds with the statistics table, and csv holds the statistic rows", async () => {
    const doc = await buildPdfDoc(report(), assets);
    expect(doc.getNumberOfPages()).toBe(1);
    const { blob } = await makeReportFile("csv", report(), assets);
    const text = await blob.text();
    expect(text).toContain("Highest");
    expect(text).toContain("Average");
  });
});

describe("pass count line", () => {
  it("is left out when the final grade columns are hidden", () => {
    const withFinal = buildReport({ sec, meta: {}, students: raw, view: {} });
    const without = buildReport({ sec, meta: {}, students: raw, view: { showFinal: false } });
    expect(withFinal.summary).toMatch(/^Passed: \d+/);
    expect(without.summary).toBe("");
  });
});

describe("average scored by", () => {
  it("is the student closest to the average, and everyone tied for closest", () => {
    const s = summarizeNamed([{ name: "A", value: 10 }, { name: "B", value: 20 }, { name: "C", value: 30 }, { name: "D", value: 40 }]);
    expect(s.avg).toBe(25);
    expect(s.closest).toEqual(["B", "C"]);          // both are 5 away
    expect(summarizeNamed([{ name: "A", value: 10 }, { name: "B", value: 14 }, { name: "C", value: 30 }]).closest).toEqual(["B"]);   // avg 18, B is 4 away
    expect(summarizeNamed([]).closest).toEqual([]);
  });
  it("appears in the statistics table and on the report", () => {
    const r = buildReport({ sec, meta: {}, students: raw, view: {} });
    expect(r.statsTable.head.at(-1)).toBe("Average scored by");
    expect(r.statsTable.rows[0]).toHaveLength(9);
    expect(r.statsTable.rows.every((row) => row.at(-1) !== "")).toBe(true);
  });
});
