import { computeGrade, hasValue, isNum } from "./grading.js";
import { buildStats, namesText } from "./stats.js";
import { fmt2, fmtNum } from "./util.js";

/* The grade report as plain data, shared by every export format (xlsx, csv, docx, pdf).
   Text in the Word, PDF and Excel files is Arial.

   `view` carries what the instructor is looking at on the Grades tab, so an export matches the screen:
     hiddenCats   ids of the categories to leave out
     showFinal    include the Final, Eq. and Remarks columns
     show         "both" | "students" (no statistics rows) | "stats" (statistics rows only)
     filterNote   one line describing the filters, printed on the report */

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

/* When only some categories are shown and they have this many scores or fewer, Word and PDF list each
   score; otherwise they show one column of points per category so the table still fits the page. */
export const MAX_ITEM_COLUMNS = 8;
const PAGE_WIDTH_CM = 18;

const safeName = (s) => String(s || "section").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "section";
const show2 = (v) => (isNum(v) ? fmt2(v) : "—");
const cellText = (v) => (hasValue(v) ? (isNum(v) ? fmtNum(v) : String(v)) : "");

/* sec: the section object; students: [{ id, name, s }] already sorted and filtered the way they are on screen */
export function buildReport({ sec, meta, students, now = new Date(), view = {} }) {
  const { hiddenCats = [], showFinal = true, show = "both", filterNote = "" } = view;
  const allCats = sec.scheme.categories || [];
  const cats = allCats.filter((c) => !hiddenCats.includes(c.id));
  const items = cats.flatMap((c) => (c.items || []).map((i) => ({ ...i, cat: c })));
  const showStudents = show !== "stats";
  const showStats = show !== "students";
  const dateText = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const graded = students.map((st) => ({ ...st, g: computeGrade(sec.scheme, st.s) }));
  const stats = buildStats(sec, graded, cats.map((c) => c.id));

  const info = [
    ["Section", sec.name],
    ["Subject", [sec.subject && sec.subject.code, sec.subject && sec.subject.desc].filter(Boolean).join(" – ")],
    ["Instructor", sec.instructor],
    ["Term", meta && meta.term],
    ["Room / time", sec.roomTime],
    ["Students", String(students.length)],
    ["Date generated", dateText],
  ].filter(([, v]) => v);

  /* ---- the report table */
  const byItems = cats.length < allCats.length && items.length > 0 && items.length <= MAX_ITEM_COLUMNS;
  const finalCols = showFinal
    ? [{ label: "Final", align: "right", widthCm: 1.2 }, { label: "Eq.", align: "right", widthCm: 0.9 }, { label: "Remarks", align: "left", widthCm: 1.5 }]
    : [];
  const fixed = [{ label: "No.", align: "left", widthCm: 1.9 }, { label: "Name", align: "left", widthCm: 3.4 }];
  const used = [...fixed, ...finalCols].reduce((a, c) => a + c.widthCm, 0);
  const bodyCount = byItems ? items.length : cats.length;
  const bodyW = bodyCount ? Math.min(byItems ? 1.8 : 1.55, Math.max(1.1, (PAGE_WIDTH_CM - used) / bodyCount)) : 0;
  const bodyCols = byItems
    ? items.map((i) => ({ label: i.label + " (/" + fmtNum(i.max) + ")", align: "right", widthCm: bodyW }))
    : cats.map((c) => ({ label: c.title + " (" + fmtNum(c.weight) + "%)", align: "right", widthCm: bodyW }));
  const columns = [...fixed, ...bodyCols, ...finalCols];

  const visibleCatPts = (g) => g.cats.filter((c) => cats.some((k) => k.id === c.id));
  const studentRow = ({ id, name, s, g }) => [
    id,
    name,
    ...(byItems ? items.map((i) => cellText(s[i.k])) : visibleCatPts(g).map((c) => fmt2(c.pts))),
    ...(showFinal ? [g.pending ? "—" : fmt2(g.total), g.pending ? "—" : g.equiv.toFixed(2), g.pending ? "Pending" : g.remarks] : []),
  ];
  const studentRaw = ({ id, name, s, g }) => [
    id,
    name,
    ...(byItems ? items.map((i) => (hasValue(s[i.k]) ? s[i.k] : null)) : visibleCatPts(g).map((c) => Math.round(c.pts * 100) / 100)),
    ...(showFinal ? [g.pending ? null : g.total, g.pending ? null : g.equiv, g.pending ? "Pending" : g.remarks] : []),
  ];

  const STAT_LABELS = [["Highest", "max"], ["Lowest", "min"], ["Average", "avg"]];
  const bodyStat = (pick) => (byItems ? items.map((i) => stats.items[i.k][pick]) : stats.cats.map((c) => c[pick]));
  const finalStat = (pick) => (showFinal ? [stats.final[pick], pick === "avg" ? stats.equiv.avg : null, ""] : []);
  const statRaw = (pick) => ["", STAT_LABELS.find(([, p]) => p === pick)[0], ...bodyStat(pick), ...finalStat(pick)];
  const statText = (pick) => statRaw(pick).map((v, i) => (i < 2 ? v : v === "" ? "" : show2(v)));

  const rows = [];
  const rawRows = [];
  const rowKinds = [];
  if (showStudents) graded.forEach((x) => { rows.push(studentRow(x)); rawRows.push(studentRaw(x)); rowKinds.push("student"); });
  if (showStats && graded.length) STAT_LABELS.forEach(([, pick]) => { rows.push(statText(pick)); rawRows.push(statRaw(pick)); rowKinds.push("stat"); });

  /* ---- every score (CSV and the second Excel sheet): always the individual scores of the shown categories */
  const detailHead = ["Student no.", "Name", ...items.map((i) => i.cat.title + " " + i.label), ...(showFinal ? ["Final grade", "Equivalent", "Remarks"] : [])];
  const detailFinal = (g) => (showFinal ? [g.pending ? null : g.total, g.pending ? null : g.equiv, g.pending ? "Pending" : g.remarks] : []);
  const detailRows = [];
  const detailKinds = [];
  detailRows.push(["", "Maximum score", ...items.map((i) => i.max), ...(showFinal ? [null, null, ""] : [])]);
  detailKinds.push("max");
  if (showStudents) graded.forEach((x) => { detailRows.push([x.id, x.name, ...items.map((i) => (hasValue(x.s[i.k]) ? x.s[i.k] : null)), ...detailFinal(x.g)]); detailKinds.push("student"); });
  if (showStats && graded.length) {
    STAT_LABELS.forEach(([label, pick]) => {
      detailRows.push(["", label, ...items.map((i) => stats.items[i.k][pick]), ...(showFinal ? [stats.final[pick], pick === "avg" ? stats.equiv.avg : null, ""] : [])]);
      detailKinds.push("stat");
    });
  }
  // CSV wants text: whole numbers stay whole, final and equivalent get two decimals
  const decimalFrom = showFinal ? detailHead.length - 3 : detailHead.length;
  const detailText = detailRows.map((row, ri) => row.map((v, ci) => {
    if (v == null) return "";
    if (!isNum(v)) return v;
    if (ci >= decimalFrom && ci < decimalFrom + 2) return v.toFixed(2);
    return detailKinds[ri] === "stat" ? fmt2(v) : fmtNum(v);
  }));

  /* ---- statistics by component (with who holds the highest and lowest) */
  let statsTable = null;
  if (showStats && graded.length) {
    const head = ["Component", "Weight", "Counted", "Highest", "Lowest", "Average", "Highest scored by", "Lowest scored by", "Average scored by"];
    const line = (title, weightText, s) => ({
      text: [title, weightText, String(s.n), show2(s.max), show2(s.min), show2(s.avg), namesText(s.highest), namesText(s.lowest), namesText(s.closest)],
      raw: [title, weightText, s.n, s.max, s.min, s.avg, namesText(s.highest), namesText(s.lowest), namesText(s.closest)],
    });
    const lines = stats.cats.map((c) => line(c.title, fmtNum(c.weight) + "%", c));
    if (showFinal) lines.push(line("Final grade", fmtNum(allCats.reduce((a, c) => a + (isNum(c.weight) ? c.weight : 0), 0)) + "%", stats.final));
    statsTable = {
      title: "Summary statistics",
      note: "Points earned out of each component's weight. Blank scores are not counted. \"Average scored by\" is the student whose points are closest to the average.",
      head,
      rows: lines.map((l) => l.text),
      rawRows: lines.map((l) => l.raw),
      widthsCm: [3.0, 1.2, 1.2, 1.5, 1.5, 1.5, 3.0, 3.0, 3.0],
    };
  }

  const passed = graded.filter(({ g }) => !g.pending && g.remarks === "Passed").length;
  const failed = graded.filter(({ g }) => !g.pending && g.remarks !== "Passed").length;
  const pending = graded.filter(({ g }) => g.pending).length;
  // the pass count is about final grades, so it is left out when those columns are hidden
  const summary = showFinal ? `Passed: ${passed}   Failed: ${failed}` + (pending ? `   Pending: ${pending}` : "") : "";

  return {
    college: COLLEGE,
    title: "GRADE REPORT",
    info,
    filterNote,
    columns,
    rows,
    rawRows,
    rowKinds,
    detailHead,
    detailRows,
    detailKinds,
    detailText,
    statsTable,
    summary,
    contact: CONTACT_LINES,
    dateText,
    baseName: safeName(sec.name) + "-grade-report",
  };
}
