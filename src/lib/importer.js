/* Reads a class record workbook (one sheet per section) into sections, grading schemes and students.

   Layout it understands (matches the BulSU class record):
     header row  : ID NO. | NAME | ... group headings (Activities/Project, Quizes, Attendance, Term Exam, FINAL GRADE)
     next row    : item labels (HA01, Ass1, 1, 2, ME, FE, "Equiv", ...)
     next row    : maximum score of each item, and the weight of each group (0.4, 0.2, ...)
     student rows: No. | ID | Name | scores
   A column is a graded item only when the maximum row has a number above 1 for it. */

import { DEFAULT_SCALE, DEFAULT_SCALE_NOTE, computeGrade, isNum } from "./grading.js";
import { normId, safeId } from "./keys.js";

const txt = (v) => (v == null ? "" : String(v).trim());
const cellVal = (v) => {
  if (isNum(v)) return v;
  const t = txt(v);
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t.slice(0, 20);
};
export const colLetter = (n) => {
  let s = "";
  n += 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const round1 = (x) => Math.round(x * 10) / 10;
const FRIENDLY = { ME: "Midterm Exam", FE: "Final Exam", PRJ: "Project" };

export function sheetsFromWorkbook(XLSX, data, type = "array") {
  const wb = XLSX.read(data, { type });
  return wb.SheetNames.map((name, i) => {
    const m = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[i];
    return {
      name,
      hidden: !!(m && m.Hidden),
      aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" }),
    };
  });
}

function parseSheet(name, aoa) {
  let hr = -1, idC = -1;
  for (let r = 0; r < Math.min(aoa.length, 40) && hr < 0; r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (/^id\s*no\.?$/i.test(txt(row[c]))) { hr = r; idC = c; break; }
    }
  }
  if (hr < 0) return null;
  const H = aoa[hr], LBL = aoa[hr + 1] || [], MAX = aoa[hr + 2] || [];
  let nameC = H.findIndex((c) => /^name$/i.test(txt(c)));
  if (nameC < 0) nameC = idC + 1;
  const width = Math.max(H.length, LBL.length, MAX.length);
  const warnings = [];

  // facts above the table
  const headings = [];
  const facts = {};
  for (let r = 0; r < hr; r++) {
    const row = aoa[r] || [];
    const filled = row.map((c, i) => [i, txt(c)]).filter((x) => x[1] !== "");
    if (filled.length === 1 && !/:\s*$/.test(filled[0][1])) headings.push(filled[0][1]);
    row.forEach((c, i) => {
      const t = txt(c);
      let key = null;
      if (/^subject\s*code\s*:?$/i.test(t)) key = "code";
      else if (/^subject\s*description\s*:?$/i.test(t)) key = "desc";
      else if (/^instructor\s*name\s*:?$/i.test(t)) key = "instructor";
      else if (/^section\b.*:\s*$/i.test(t)) key = "section";
      if (!key) return;
      for (let cc = i + 1; cc < row.length; cc++) {
        const v = txt(row[cc]);
        if (v === "") continue;
        if (/:\s*$/.test(v)) break;
        facts[key] = v;
        break;
      }
    });
  }

  // column groups
  const starts = [];
  for (let c = nameC + 1; c < width; c++) if (txt(H[c]) !== "") starts.push(c);
  const groups = [];
  let finalCols = null;
  const strays = [];
  starts.forEach((c, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : width;
    const rawTitle = txt(H[c]);
    const spanLabels = [];
    for (let cc = c; cc < end; cc++) spanLabels.push(txt(LBL[cc]));
    if (/^final\s*grade$/i.test(rawTitle) && spanLabels.some((l) => /^grade$/i.test(l))) {
      finalCols = {};
      for (let cc = c; cc < end; cc++) {
        const l = txt(LBL[cc]);
        if (/^grade$/i.test(l)) finalCols.grade = cc;
        else if (/^equiv/i.test(l)) finalCols.equiv = cc;
        else if (/^remarks?$/i.test(l)) finalCols.remarks = cc;
      }
      return;
    }
    const title = /^quizes$/i.test(rawTitle) ? "Quizzes" : rawTitle;
    const items = [];
    let weight = null;
    for (let cc = c; cc < end; cc++) {
      const label = txt(LBL[cc]);
      const mx = MAX[cc];
      if (isNum(mx) && mx > 0 && mx <= 1) { weight = round1(mx * 100); continue; }
      if (/^equiv/i.test(label)) continue;
      if (isNum(mx) && mx > 1) { items.push({ col: cc, raw: LBL[cc], max: mx }); continue; }
      if (!/^final\s*grade$/i.test(rawTitle)) strays.push({ col: cc, title });
    }
    if (!items.length) return;
    const single = /^quiz/i.test(title) ? "Quiz" : title;
    const seen = new Map();
    const outItems = items.map((it) => {
      let l = txt(it.raw);
      if (isNum(it.raw)) l = single + " " + it.raw;
      else if (l === "") {
        if (items.length === 1) l = title;
        else {
          l = "Column " + colLetter(it.col);
          warnings.push("Section " + name + ": column " + colLetter(it.col) + " (" + title + ") has no label in row " + (hr + 2) + ", so it is named \"" + l + "\". Rename it in Settings.");
        }
      }
      if (FRIENDLY[l.toUpperCase()]) l = FRIENDLY[l.toUpperCase()];
      const n = (seen.get(l) || 0) + 1;
      seen.set(l, n);
      if (n > 1) l = l + " (" + n + ")";
      return { col: it.col, label: l, max: it.max };
    });
    groups.push({ title, weight, items: outItems });
  });
  if (!groups.length) return null;

  // grade equivalent table ("Based on ...")
  let scale = null, scaleNote = "";
  for (let r = 0; r < aoa.length && !scale; r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (/^based on/i.test(txt(row[c]))) {
        scaleNote = txt(row[c]);
        const list = [];
        for (let rr = r + 1; rr < aoa.length; rr++) {
          const lab = (aoa[rr] || [])[c], eq = (aoa[rr] || [])[c + 1];
          if (!isNum(eq)) break;
          list.push({ range: isNum(lab) ? String(lab) : txt(lab), eq });
        }
        if (list.length > 1) {
          scale = list.map((x, i) => ({ min: i === 0 ? 0 : parseFloat(x.range), eq: x.eq, range: x.range }));
          if (/^0(\.0+)?$/.test(scale[0].range)) scale[0].range = "Below " + scale[1].range.split("-")[0];
          if (scale.some((x) => !Number.isFinite(x.min))) scale = null;
        }
        break;
      }
    }
  }

  // students
  const rows = [];
  let lastStudent = hr + 2;
  for (let r = hr + 3; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const id = normId(row[idC]);
    const nm = txt(row[nameC]);
    if (!id || !nm || !/^[A-Z0-9-]{4,}$/.test(id)) continue;
    lastStudent = r;
    const cols = {};
    groups.forEach((g) => g.items.forEach((it) => { cols[it.col] = cellVal(row[it.col]); }));
    const excel = finalCols
      ? {
          grade: isNum(cellVal(row[finalCols.grade])) ? cellVal(row[finalCols.grade]) : null,
          equiv: isNum(cellVal(row[finalCols.equiv])) ? cellVal(row[finalCols.equiv]) : null,
          remarks: txt(row[finalCols.remarks]) || null,
        }
      : null;
    rows.push({ id, name: nm, cols, excel, _r: r });
  }
  strays.forEach((sc) => {
    const count = rows.filter((st) => isNum(cellVal(aoa[st._r][sc.col]))).length;
    if (count) warnings.push("Section " + name + ": column " + colLetter(sc.col) + " (" + sc.title + ") has scores for " + count + " student(s) but no maximum score, so it is ignored.");
  });

  let instructor = facts.instructor || "";
  if (!instructor) {
    for (let r = lastStudent + 1; r < aoa.length && !instructor; r++) {
      (aoa[r] || []).forEach((c, ci) => {
        if (!instructor && /^professor$/i.test(txt(c)) && r > 0 && txt(aoa[r - 1][ci])) instructor = txt(aoa[r - 1][ci]);
      });
    }
  }

  return { name, headings: headings.slice(0, 3), facts, instructor, groups, scale, scaleNote, rows, warnings };
}

/* Turns the worksheet groups into grading categories with weights that add up to the group weights. */
function buildScheme(parsed, warnings) {
  const cats = [];
  const keyOfCol = new Map();
  const ids = new Set();
  const add = (id, title, weight, items) => {
    let uid = id, n = 2;
    while (ids.has(uid)) uid = id + n++;
    ids.add(uid);
    cats.push({
      id: uid, title, weight: weight == null ? 0 : weight,
      items: items.map((it, i) => { const k = uid + (i + 1); keyOfCol.set(it.col, k); return { k, label: it.label, max: it.max }; }),
    });
  };
  parsed.groups.forEach((g) => {
    const W = g.weight;
    if (W == null) warnings.push("Section " + parsed.name + ': group "' + g.title + '" has no weight in the maximum row, so its weight is 0. Set it in Settings.');
    if (/activit|project/i.test(g.title)) {
      const proj = g.items.filter((i) => /^project$/i.test(i.label));
      const acts = g.items.filter((i) => !/^project$/i.test(i.label));
      if (proj.length && acts.length) {
        const pw = Math.min(15, W == null ? 15 : W);
        add("activities", "Activities", round1((W == null ? 0 : W) - pw), acts);
        add("project", "Project", pw, proj);
      } else add(acts.length ? "activities" : "project", acts.length ? "Activities" : "Project", W, g.items);
    } else if (/exam/i.test(g.title) && g.items.length > 1) {
      const each = W == null ? 0 : round1(W / g.items.length);
      g.items.forEach((it) => {
        const id = /final/i.test(it.label) ? "final" : /mid/i.test(it.label) ? "midterm" : slug(it.label);
        add(id, it.label, each, [it]);
      });
    } else add(slug(g.title), g.title, W, g.items);
  });
  const finalCategory = cats.some((c) => c.id === "final") ? "final" : null;
  return {
    scheme: {
      categories: cats,
      scale: parsed.scale || DEFAULT_SCALE,
      scaleNote: parsed.scale ? parsed.scaleNote : DEFAULT_SCALE_NOTE,
      passEquiv: 3,
      finalCategory,
      holdFinal: Boolean(finalCategory),
    },
    keyOfCol,
  };
}

export function parseClassRecord(sheets) {
  const out = { sections: [], students: [], notes: [], warnings: [], errors: [], mismatches: [] };
  const seen = new Map();
  const secIds = new Set();
  sheets.forEach((sh) => {
    if (sh.hidden) { out.notes.push('Skipped hidden sheet "' + sh.name + '".'); return; }
    let parsed = null;
    try { parsed = parseSheet(sh.name, sh.aoa); } catch (e) { parsed = null; }
    if (!parsed) { out.notes.push('Skipped sheet "' + sh.name + '" (no class record table found).'); return; }
    const warnings = [...parsed.warnings];
    const { scheme, keyOfCol } = buildScheme(parsed, warnings);
    let id = slug(sh.name), n = 2;
    while (secIds.has(id)) id = slug(sh.name) + n++;
    secIds.add(id);
    const section = {
      id, name: sh.name, headings: parsed.headings,
      subject: { code: parsed.facts.code || "", desc: parsed.facts.desc || "" },
      instructor: parsed.instructor || "", roomTime: parsed.facts.section || "",
      scheme,
    };
    let count = 0;
    parsed.rows.forEach((r) => {
      const sid = safeId(r.id);
      if (seen.has(sid)) { out.errors.push("Student number " + r.id + " appears in both " + seen.get(sid) + " and " + sh.name + "."); return; }
      seen.set(sid, sh.name);
      const s = {};
      Object.entries(r.cols).forEach(([col, v]) => { if (v != null) s[keyOfCol.get(Number(col))] = v; });
      out.students.push({ id: sid, name: r.name, sec: id, s });
      count++;
      if (r.excel && isNum(r.excel.grade)) {
        const calc = computeGrade(scheme, s);
        if (Math.abs(calc.total - r.excel.grade) > 0.011) out.mismatches.push({ id: sid, name: r.name, section: sh.name, sheet: r.excel.grade, app: calc.total });
      }
    });
    if (!count) warnings.push('Section "' + sh.name + '" has no students.');
    section.count = count;
    out.warnings.push(...warnings);
    out.sections.push(section);
  });
  if (!out.sections.length) { out.errors.push('No class record found. The header row needs an "ID NO." cell and a "NAME" cell.'); return out; }
  if (!out.students.length && !out.errors.length) out.errors.push("No student rows found.");
  const first = out.sections[0];
  out.term = (first.headings || []).find((h) => /semester|academic year|term/i.test(h)) || "";
  out.title = first.subject.desc || "";
  if (out.mismatches.length) {
    out.warnings.push(out.mismatches.length + " student(s) have a final grade here that differs from the one saved in your file (for example a score in a column without a maximum). Check the Grades tab after importing.");
  }
  return out;
}
