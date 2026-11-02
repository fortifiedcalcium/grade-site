import { isNum } from "./grading.js";

/* Highest, lowest and average of the students on screen. Blank scores and text such as INC or DRP are
   left out of every statistic (they are not numbers); a student with nothing recorded in a category is
   left out of that category's statistics, and a student whose final is still pending is left out of the
   final grade statistics. */

export function summarize(values) {
  const nums = values.filter(isNum);
  if (!nums.length) return { n: 0, max: null, min: null, avg: null };
  return {
    n: nums.length,
    max: Math.max(...nums),
    min: Math.min(...nums),
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
  };
}

/* entries: [{ name, value }] -> the figures plus who holds the highest and lowest, and who is closest to
   the average (all of them, if tied). Nobody scores exactly the average, so "closest" stands in for it. */
export function summarizeNamed(entries) {
  const valid = entries.filter((e) => isNum(e.value));
  const s = summarize(valid.map((e) => e.value));
  const gap = (e) => Math.abs(e.value - s.avg);
  const nearest = s.n ? Math.min(...valid.map(gap)) : 0;
  return {
    ...s,
    highest: s.n ? valid.filter((e) => e.value === s.max).map((e) => e.name) : [],
    lowest: s.n ? valid.filter((e) => e.value === s.min).map((e) => e.name) : [],
    closest: s.n ? valid.filter((e) => gap(e) - nearest < 1e-9).map((e) => e.name) : [],
  };
}

/* graded: [{ id, name, s, g }] with g from computeGrade; catIds: the categories being shown */
export function buildStats(sec, graded, catIds) {
  const cats = sec.scheme.categories.filter((c) => catIds.includes(c.id));
  const items = {};
  cats.forEach((c) => (c.items || []).forEach((i) => {
    items[i.k] = { ...summarize(graded.map((x) => x.s[i.k])), mark: i.max };
  }));
  const catStats = cats.map((c) => ({
    id: c.id,
    title: c.title,
    weight: isNum(c.weight) ? c.weight : 0,
    ...summarizeNamed(graded.flatMap((x) => {
      const gc = x.g.cats.find((k) => k.id === c.id);
      return gc && gc.entered > 0 ? [{ name: x.name, value: gc.pts }] : [];
    })),
  }));
  const final = summarizeNamed(graded.filter((x) => !x.g.pending).map((x) => ({ name: x.name, value: x.g.total })));
  const equiv = summarize(graded.filter((x) => !x.g.pending).map((x) => x.g.equiv));
  return { items, cats: catStats, final, equiv };
}

/* "REYES, ANA" or "REYES, ANA (+2 more)" */
export const namesText = (names) => (names.length <= 1 ? names[0] || "" : names[0] + " (+" + (names.length - 1) + " more)");

export const STATUS_OPTIONS = [
  ["all", "All students"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["pending", "Pending final"],
  ["ready", "Ready for posting"],
];

export const SORT_OPTIONS = [
  ["name", "Name (A–Z)"],
  ["id", "Student number"],
  ["high", "Final grade (highest first)"],
  ["low", "Final grade (lowest first)"],
];

export function statusOf(g) {
  return g.pending ? "pending" : g.remarks === "Passed" ? "passed" : "failed";
}

/* graded rows -> filtered by status and sorted. Pending students sort last when sorting by grade. */
export function filterAndSort(graded, status, sort) {
  const rows = graded.filter((x) => status === "all" || (status === "ready" ? Boolean(x.ack) : statusOf(x.g) === status));
  const byName = (a, b) => a.name.localeCompare(b.name);
  const cmp = {
    name: byName,
    id: (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }),
    high: (a, b) => (a.g.pending - b.g.pending) || (b.g.total - a.g.total) || byName(a, b),
    low: (a, b) => (a.g.pending - b.g.pending) || (a.g.total - b.g.total) || byName(a, b),
  }[sort] || byName;
  return [...rows].sort(cmp);
}
