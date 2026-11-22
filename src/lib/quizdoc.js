/* Reads a quiz from a Word (.docx) file: the questions with their A, B, C, D choices, and the answer key.

   What it understands (the layout teachers usually type):
     questions   numbered ("1. What is...", "____ What is...", or Word's own automatic numbering) with choices on the
                 lines below that start with "A.", "B.", ... Lines that are not followed by choices (the title,
                 directions, "Part 1: ...") are ignored.
     answer key  after a heading "Answer Key": a table with a number column (No. or #) and an Answer column (a
                 Points column is optional), or lines like "1. B". Instead of a key, a line "Answer: B" under a question works too.
     true/false  a numbered line with no choices whose answer in the key is True or False.
   Questions are matched to the key by their number in the file (or, when the file has no typed numbers, their order). */

import { parseQuizRows } from "./quiz.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const clean = (s) => String(s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

function paraText(p) {
  let out = "";
  const walk = (n) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === W && c.localName === "t") out += c.textContent;
      else if (c.namespaceURI === W && (c.localName === "tab" || c.localName === "br")) out += " ";
      else if (!(c.namespaceURI === W && (c.localName === "pPr" || c.localName === "rPr"))) walk(c);
    }
  };
  walk(p);
  return clean(out);
}

/* The document's paragraphs and tables in reading order: [{ type: "p", text } | { type: "table", rows: [[cell text]] }]. */
export function blocksFromXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Not a Word document.");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const blocks = [];
  const visit = (parent) => {
    for (const el of Array.from(parent.childNodes)) {
      if (el.nodeType !== 1 || el.namespaceURI !== W) continue;
      if (el.localName === "p") blocks.push({ type: "p", text: paraText(el) });
      else if (el.localName === "tbl") {
        const rows = [];
        for (const tr of Array.from(el.childNodes)) {
          if (tr.nodeType !== 1 || tr.localName !== "tr") continue;
          rows.push(Array.from(tr.childNodes).filter((tc) => tc.nodeType === 1 && tc.localName === "tc").map((tc) => Array.from(tc.getElementsByTagNameNS(W, "p")).map(paraText).join(" ").trim()));
        }
        blocks.push({ type: "table", rows });
      } else if (el.localName === "sdt") {
        const content = Array.from(el.childNodes).find((c) => c.nodeType === 1 && c.localName === "sdtContent");
        if (content) visit(content);
      }
    }
  };
  if (body) visit(body);
  return blocks;
}

export async function docxBlocks(arrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Not a Word document.");
  return blocksFromXml(await file.async("string"));
}

const CHOICE = /^\(?([A-Ha-h])\s*[.)]\s+(\S.*)$/;
const INLINE_ANSWER = /^(?:correct\s+)?(?:answer|ans|key)\s*[:=\-–]\s*(.+)$/i;
const KEY_HEADING = /^answer\s*key\b/i;
const LETTERS = "ABCDEFGH";
const answerOf = (t) => {
  const s = clean(t);
  if (/^(true|t)$/i.test(s)) return true;
  if (/^(false|f)$/i.test(s)) return false;
  const m = /^\(?([A-Ha-h])\b\s*[.)]?/.exec(s);
  return m ? m[1].toUpperCase() : s;
};

/* Returns { questions, errors } like parseQuizRows. */
export function parseQuizBlocks(blocks) {
  const errors = [];
  const key = new Map();      // question number -> { answer, points }
  const lines = [];           // paragraphs of the question section, in order
  let inKey = false;

  for (const b of blocks) {
    if (b.type === "table") {
      const head = (b.rows[0] || []).map((c) => c.toLowerCase());
      const nC = head.findIndex((h) => /^(no\.?|#|item|number|q\.?)$/.test(h)), aC = head.findIndex((h) => /^(correct\s*)?(answer|key)\b/.test(h)), pC = head.findIndex((h) => /^(points?|pts)\b/.test(h));
      if (nC >= 0 && aC >= 0) {
        b.rows.slice(1).forEach((r) => {
          const n = Number(String(r[nC] || "").replace(/\D/g, ""));
          if (n && clean(r[aC])) key.set(n, { answer: clean(r[aC]), points: pC >= 0 && r[pC] ? Number(r[pC]) : 1 });
        });
      }
      continue;
    }
    if (!b.text) continue;
    if (KEY_HEADING.test(b.text)) { inKey = true; continue; }
    if (inKey) {   // a key typed as text: "1. B   2. C ..." on one or several lines
      for (const m of b.text.matchAll(/(\d+)\s*[.):\-–]\s*(true|false|[A-Ha-h])\b/gi)) key.set(Number(m[1]), { answer: m[2], points: 1 });
      continue;
    }
    lines.push(b.text);
  }

  const items = [];   // { no (typed number or null), text, choices: [{ letter, text }], inline }
  let cur = null;
  const finish = () => { if (cur && (cur.choices.length || cur.no != null)) items.push(cur); cur = null; };
  for (const line of lines) {
    const ch = CHOICE.exec(line);
    const inline = INLINE_ANSWER.exec(line);
    if (ch && cur) cur.choices.push({ letter: ch[1].toUpperCase(), text: clean(ch[2]) });
    else if (inline && cur) cur.inline = inline[1];
    else {
      if (cur && cur.choices.length === 0 && cur.no == null) cur = null;   // a heading or directions that had no choices
      else finish();
      const num = /^(\d+)\s*[.)]\s*(.+)$/.exec(line);
      const text = (num ? num[2] : line).replace(/^_{2,}\s*/, "").trim();
      cur = { no: num ? Number(num[1]) : null, text, choices: [], inline: null };
    }
  }
  finish();

  const rows = [["Question", "Type", "A", "B", "C", "D", "E", "F", "G", "H", "Answer", "Points"]];
  const notes = [];
  items.forEach((it, i) => {
    const n = it.no != null ? it.no : i + 1;
    const k = key.get(n) || (it.inline ? { answer: it.inline, points: 1 } : null);
    const label = "Question " + n;
    if (!k) return errors.push(label + " has no answer in the answer key.");
    const ans = answerOf(k.answer);
    if (!it.choices.length) {
      if (typeof ans !== "boolean") return errors.push(label + " has no choices, so its answer must be True or False.");
      rows.push([it.text, "TF", "", "", "", "", "", "", "", "", ans ? "True" : "False", k.points || 1]);
      return;
    }
    const cells = Array(8).fill("");
    it.choices.forEach((c) => { cells[LETTERS.indexOf(c.letter)] = c.text; });
    rows.push([it.text, "MC", ...cells, typeof ans === "boolean" ? String(ans) : ans, k.points || 1]);
    notes.push(n);
  });
  if (rows.length === 1) return { questions: [], errors: errors.length ? errors : ["No questions found. Each question needs choices starting with A., B., C., D. and an answer key."] };
  const parsed = parseQuizRows(rows);
  // the row numbers parseQuizRows reports count the rebuilt rows; say the question instead
  const fixed = parsed.errors.map((e) => e.replace(/^Row (\d+)/, (_, r) => "Question " + (Number(r) - 1)));
  return { questions: parsed.questions, errors: [...errors, ...fixed] };
}

export async function parseQuizDocx(arrayBuffer) {
  return parseQuizBlocks(await docxBlocks(arrayBuffer));
}
