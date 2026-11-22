/* Grade computation. It follows the formulas in the class record:
     category points = (sum of the student's scores / sum of the item maximums) x category weight
     final grade     = sum of category points, rounded to 2 decimals
     equivalent      = row of the grade equivalent table with the largest minimum <= final grade
     remarks         = Passed when the equivalent is at or below the passing equivalent (3.00), else Failed
   Blank scores count as 0, exactly like the spreadsheet. */

export const DEFAULT_SCALE_NOTE = "Based on BOR #233, s.2024";
export const DEFAULT_SCALE = [
  { min: 0, eq: 5, range: "Below 75.00" },
  { min: 75, eq: 3, range: "75.00-75.49" },
  { min: 75.5, eq: 2.75, range: "75.50-78.49" },
  { min: 78.5, eq: 2.5, range: "78.50-81.49" },
  { min: 81.5, eq: 2.25, range: "81.50-84.49" },
  { min: 84.5, eq: 2, range: "84.50-87.49" },
  { min: 87.5, eq: 1.75, range: "87.50-90.49" },
  { min: 90.5, eq: 1.5, range: "90.50-93.49" },
  { min: 93.5, eq: 1.25, range: "93.50-96.49" },
  { min: 96.5, eq: 1, range: "96.50-100" },
];

export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const hasValue = (v) => isNum(v) || (typeof v === "string" && v.trim() !== "");

/* A table that stops short of the top (for example a workbook sheet whose lower rows were left blank) would
   give every high score the equivalent of its last row, so it is not trusted: the highest row must reach 100. */
export function isCompleteScale(scale) {
  if (!Array.isArray(scale) || scale.length < 2) return false;
  const top = [...scale].sort((a, b) => a.min - b.min)[scale.length - 1];
  return /100(\.0+)?\s*$|above|up/i.test(String((top && top.range) || ""));
}

export const usableScale = (scale) => (isCompleteScale(scale) ? scale : DEFAULT_SCALE);

export function lookupEquivalent(scale, total) {
  const rows = [...usableScale(scale)].sort((a, b) => a.min - b.min);
  let eq = rows[0].eq;
  for (const r of rows) if (total >= r.min) eq = r.eq;
  return eq;
}

export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function computeGrade(scheme, scores) {
  const s = scores || {};
  const cats = (scheme.categories || []).map((c) => {
    const items = c.items || [];
    const maxSum = items.reduce((a, i) => a + (isNum(i.max) ? i.max : 0), 0);
    const got = items.reduce((a, i) => a + (isNum(s[i.k]) ? s[i.k] : 0), 0);
    const entered = items.filter((i) => hasValue(s[i.k])).length;
    const weight = isNum(c.weight) ? c.weight : 0;
    const pts = maxSum > 0 ? (got / maxSum) * weight : 0;
    return { id: c.id, title: c.title, weight, pts, entered, count: items.length };
  });
  const total = round2(cats.reduce((a, c) => a + c.pts, 0));
  const finalCat = cats.find((c) => c.id === scheme.finalCategory);
  const finalRecorded = finalCat ? finalCat.entered > 0 : true;
  const pending = Boolean(scheme.holdFinal) && !finalRecorded;
  const equiv = lookupEquivalent(scheme.scale, total);
  const passEquiv = isNum(scheme.passEquiv) ? scheme.passEquiv : 3;
  return { cats, total, equiv, remarks: equiv <= passEquiv ? "Passed" : "Failed", pending, finalRecorded };
}

/* The class record lays its columns out as Activities, Quizzes, Project, Attendance, then the term exams (Midterm, Final).
   Sections made earlier, or imported with another order, keep their stored order; screens and exports use this one so every
   section reads the same way. Categories it does not recognise go after Attendance, in their stored order. */
const RECORD_ORDER = [[/activit/i, 0], [/quiz/i, 1], [/proj/i, 2], [/attend/i, 3], [/mid/i, 5], [/final/i, 6], [/exam/i, 5]];
export function recordRank(cat) {
  const text = (cat.id || "") + " " + (cat.title || "");
  const hit = RECORD_ORDER.find(([re]) => re.test(text));
  return hit ? hit[1] : 4;
}
export function orderedCategories(scheme) {
  return ((scheme && scheme.categories) || []).map((c, i) => [c, i]).sort((a, b) => recordRank(a[0]) - recordRank(b[0]) || a[1] - b[1]).map(([c]) => c);
}
/* A section whose scheme lists its categories in class record order (nothing else changes). */
export const inRecordOrder = (section) => (section && section.scheme ? { ...section, scheme: { ...section.scheme, categories: orderedCategories(section.scheme) } } : section);
