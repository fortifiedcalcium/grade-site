import { computeGrade } from "./grading.js";
import { fmt2, fmtNum } from "./util.js";

/* The grade report as plain data, shared by every export format (xlsx, csv, docx, pdf).
   Text in the Word, PDF and Excel files is Arial. */

export const REPORT_FONT = "Arial";
export const COLLEGE = "College of Information and Communications Technology";
export const CONTACT_LINES = [
  "OfficeoftheDean.CICT@BulSU.edu.ph | (044) 919 7800 Local 1102",
  "Bulacan State University Main Campus, Capitol Compound, McArthur Highway, Guinhawa, City of Malolos, Bulacan",
];
export const FORMATS = [
  ["xlsx", "Excel (.xlsx)"],
  ["csv", "CSV (.csv)"],
  ["docx", "Word (.docx)"],
  ["pdf", "PDF (.pdf)"],
];

const safeName = (s) => String(s || "section").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "section";

/* sec: the section object; students: [{ id, name, s }] already sorted and filtered the way they are on screen */
export function buildReport({ sec, meta, students, now = new Date() }) {
  const cats = sec.scheme.categories || [];
  const items = cats.flatMap((c) => (c.items || []).map((i) => ({ ...i, cat: c })));
  const dateText = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const info = [
    ["Section", sec.name],
    ["Subject", [sec.subject && sec.subject.code, sec.subject && sec.subject.desc].filter(Boolean).join(" – ")],
    ["Instructor", sec.instructor],
    ["Term", meta && meta.term],
    ["Room / time", sec.roomTime],
    ["Students", String(students.length)],
    ["Date generated", dateText],
  ].filter(([, v]) => v);

  const graded = students.map((st) => ({ st, g: computeGrade(sec.scheme, st.s) }));

  const columns = [
    { label: "No.", align: "left", widthCm: 1.9 },
    { label: "Name", align: "left", widthCm: 3.4 },
    ...cats.map((c) => ({ label: c.title + " (" + fmtNum(c.weight) + "%)", align: "right", widthCm: 1.55 })),
    { label: "Final", align: "right", widthCm: 1.2 },
    { label: "Eq.", align: "right", widthCm: 0.9 },
    { label: "Remarks", align: "left", widthCm: 1.5 },
  ];
  const rows = graded.map(({ st, g }) => [
    st.id,
    st.name,
    ...g.cats.map((c) => fmt2(c.pts)),
    g.pending ? "—" : fmt2(g.total),
    g.pending ? "—" : g.equiv.toFixed(2),
    g.pending ? "Pending" : g.remarks,
  ]);
  // numbers stay numbers for Excel
  const rawRows = graded.map(({ st, g }) => [
    st.id,
    st.name,
    ...g.cats.map((c) => Math.round(c.pts * 100) / 100),
    g.pending ? null : g.total,
    g.pending ? null : g.equiv,
    g.pending ? "Pending" : g.remarks,
  ]);

  const detailHead = ["Student no.", "Name", ...items.map((i) => i.cat.title + " " + i.label), "Final grade", "Equivalent", "Remarks"];
  const detailRows = graded.map(({ st, g }) => [
    st.id,
    st.name,
    ...items.map((i) => (st.s[i.k] == null ? "" : st.s[i.k])),
    g.pending ? "" : g.total,
    g.pending ? "" : g.equiv.toFixed(2),
    g.pending ? "Pending" : g.remarks,
  ]);
  const maxRow = ["", "Maximum score", ...items.map((i) => i.max), "", "", ""];

  const passed = graded.filter(({ g }) => !g.pending && g.remarks === "Passed").length;
  const failed = graded.filter(({ g }) => !g.pending && g.remarks !== "Passed").length;
  const pending = graded.filter(({ g }) => g.pending).length;
  const summary = `Passed: ${passed}   Failed: ${failed}` + (pending ? `   Pending: ${pending}` : "");

  return {
    college: COLLEGE,
    title: "GRADE REPORT",
    info,
    columns,
    rows,
    rawRows,
    detailHead,
    detailRows,
    maxRow,
    summary,
    contact: CONTACT_LINES,
    dateText,
    baseName: safeName(sec.name) + "-grade-report",
  };
}
