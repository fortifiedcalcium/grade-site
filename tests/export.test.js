import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import JSZip from "jszip";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { buildReport } from "../src/lib/report.js";
import { makeReportFile, buildPdfDoc } from "../src/lib/exporters.js";
import { DEFAULT_SCALE } from "../src/lib/grading.js";

const sec = {
  name: "2A", instructor: "Edgar Dominic P. Alconera", subject: { code: "IT 101", desc: "Intro" },
  scheme: {
    passEquiv: 3, finalCategory: "final", holdFinal: true, scale: DEFAULT_SCALE,
    categories: [
      { id: "q", title: "Quizzes", weight: 60, items: [{ k: "q1", label: "Quiz 1", max: 10 }, { k: "q2", label: "Quiz 2", max: 10 }] },
      { id: "final", title: "Final Exam", weight: 40, items: [{ k: "f1", label: "Final", max: 50 }] },
    ],
  },
};
const students = (n) => Array.from({ length: n }, (_, i) => ({
  id: "2026-" + (10000 + i), name: i === 0 ? "PEÑA, ÑOR" : "STUDENT " + i,
  s: i === 1 ? { q1: 5 } : { q1: 9, q2: 8, f1: 45 },   // student 1 has no final yet -> pending
}));
const meta = { term: "1ST SEMESTER" };
const now = new Date("2026-10-31T10:00:00");
let assets;

beforeAll(() => {
  const read = (f) => new Uint8Array(fs.readFileSync(new URL("../public/report/" + f, import.meta.url)));
  assets = { letterhead: read("letterhead.png"), banner: read("banner.png"), logos: read("logos.png"), strip: read("strip.png") };
});

describe("report data", () => {
  it("has one row per student with weighted points, final, equivalent and remarks", () => {
    const r = buildReport({ sec, meta, students: students(3), now });
    expect(r.columns.map((c) => c.label)).toEqual(["No.", "Name", "Quizzes (60%)", "Final Exam (40%)", "Final", "Eq.", "Remarks"]);
    expect(r.rows[0]).toEqual(["2026-10000", "PEÑA, ÑOR", "51.00", "36.00", "87.00", "2.00", "Passed"]);
    expect(r.rows[1].slice(-3)).toEqual(["—", "—", "Pending"]);
    expect(r.summary).toBe("Passed: 2   Failed: 0   Pending: 1");
    expect(r.info).toContainEqual(["Date generated", "October 31, 2026"]);
  });
});

describe("export files", () => {
  const report = () => buildReport({ sec, meta, students: students(5), now });

  it("csv has a byte order mark so Excel reads accents, and every score", async () => {
    const { blob, filename } = await makeReportFile("csv", report(), assets);
    expect(filename).toBe("2A-grade-report.csv");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes);
    expect(text).toContain('"PEÑA, ÑOR"');
    expect(text.split("\r\n")[0]).toBe("Student no.,Name,Quizzes Quiz 1,Quizzes Quiz 2,Final Exam Final,Final grade,Equivalent,Remarks");
  });

  it("xlsx letterhead: full-width maroon band, centred merged titles, one info item per row, landscape print setup", async () => {
    const rep = report();
    const { blob } = await makeReportFile("xlsx", rep, assets);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet("Grade Report");
    const n = rep.columns.length;
    const lastCol = ws.getColumn(n).letter;
    expect(ws.getCell("A1").fill.fgColor.argb).toBe("FF990000");
    expect(ws.getCell("A1").isMerged && ws.getCell("A1").master.address).toBe("A1");
    expect(ws.model.merges).toContain("A1:" + lastCol + "1");
    const titles = ["Republic of the Philippines", "City of Malolos, Bulacan", "BULACAN STATE UNIVERSITY", rep.college, "GRADE REPORT"];
    titles.forEach((t, i) => {
      const c = ws.getCell(2 + i, 1);
      expect(c.value).toBe(t);
      expect(ws.model.merges).toContain("A" + (2 + i) + ":" + lastCol + (2 + i));
      expect(c.alignment).toMatchObject({ horizontal: "center", vertical: "middle" });
    });
    expect(ws.getCell("A4").font).toMatchObject({ size: 18, bold: true });
    expect(ws.getCell("A2").font.size).toBe(12);
    // each info item in its own row, label bold
    const infoStart = 9;
    rep.info.forEach(([label], i) => {
      const v = ws.getCell(infoStart + i, 1).value;
      expect(v.richText[0]).toMatchObject({ text: label + ": " });
      expect(v.richText[0].font.bold).toBe(true);
    });
    expect(ws.pageSetup).toMatchObject({ orientation: "landscape", fitToWidth: 1 });
    expect(ws.pageSetup.printArea).toMatch(new RegExp("^A1:" + lastCol + "\\d+$"));
    expect(ws.views[0]).toMatchObject({ state: "frozen" });
    // the logos sit inside the header rows
    for (const img of ws.getImages()) expect(img.range.tl.nativeRow).toBeLessThan(8);
  });

  it("xlsx is Arial throughout, keeps numbers as numbers, and has a second sheet with every score", async () => {
    const { blob } = await makeReportFile("xlsx", report(), assets);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Grade Report", "All scores", "Statistics"]);
    const ws = wb.getWorksheet("Grade Report");
    const fonts = new Set();
    let finalCell;
    ws.eachRow((row) => row.eachCell((c) => { if (c.value != null && c.font) fonts.add(c.font.name); if (c.value === 87) finalCell = c; }));
    expect([...fonts]).toEqual(["Arial"]);
    expect(finalCell && typeof finalCell.value).toBe("number");
    expect(ws.getImages().length).toBe(2); // seal + Bagong Pilipinas, and the accreditation strip
    const all = wb.getWorksheet("All scores");
    expect(all.getRow(1).getCell(3).value).toBe("Quizzes Quiz 1");
    expect(all.getRow(2).getCell(2).value).toBe("Maximum score");
  });

  it("docx uses only Arial, puts the letterhead behind the text, and has the footer contacts", async () => {
    const { blob } = await makeReportFile("docx", report(), assets);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    const doc = await zip.file("word/document.xml").async("string");
    const styles = await zip.file("word/styles.xml").async("string");
    const header = await zip.file(names.find((n) => /word\/header\d*\.xml$/.test(n))).async("string");
    const footer = await zip.file(names.find((n) => /word\/footer\d*\.xml$/.test(n))).async("string");
    const fonts = new Set([...(doc + footer + styles).matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]));
    expect([...fonts]).toEqual(["Arial"]);
    expect(header).toContain('behindDoc="1"');
    expect(names.some((n) => n.startsWith("word/media/"))).toBe(true);
    expect(footer).toContain("OfficeoftheDean.CICT@BulSU.edu.ph");
    expect(doc).toContain("College of Information and Communications Technology");
    expect(doc).toContain("GRADE REPORT");
    expect(doc).toContain("PEÑA, ÑOR");
    expect(doc).toContain('w:tblHeader');   // header row repeats on every page
  });

  it("pdf is a real PDF; long lists run onto more pages", async () => {
    const { blob } = await makeReportFile("pdf", report(), assets);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    const one = await buildPdfDoc(buildReport({ sec, meta, students: students(5), now }), assets);
    const many = await buildPdfDoc(buildReport({ sec, meta, students: students(70), now }), assets);
    expect(one.getNumberOfPages()).toBe(1);
    expect(many.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  }, 30000);
});
