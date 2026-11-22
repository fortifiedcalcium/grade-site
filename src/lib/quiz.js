/* Quiz helpers shared by the instructor editor and the student page.

   A question is { id, type: "mc" | "tf", text, points, choices (mc only), answer }.
   answer is the index of the right choice (mc) or true/false (tf). The server removes `answer` before a student sees it,
   and the answers a student sends back use the ORIGINAL choice index, so shuffling never changes the scoring. */

export const newQuizId = () => "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const newQuestionId = () => "n" + Math.random().toString(36).slice(2, 9);

export const blankQuestion = (type = "mc") =>
  type === "tf"
    ? { id: newQuestionId(), type: "tf", text: "", points: 1, answer: true }
    : { id: newQuestionId(), type: "mc", text: "", points: 1, choices: ["", "", "", ""], answer: 0 };

export const blankQuiz = (sec) => ({
  sec, title: "", itemKey: "", itemMax: null, questions: [blankQuestion()], published: false,
  timeLimit: null, shuffle: true, lockdown: true, maxViolations: 3, showAnswers: false,
});

export const totalPoints = (questions) => (questions || []).reduce((a, q) => a + (Number(q.points) > 0 ? Number(q.points) : 0), 0);

/* Returns a list of problems (empty = fine). */
export function quizProblems(quiz) {
  const out = [];
  if (!String(quiz.title || "").trim()) out.push("Give the quiz a title.");
  if (!quiz.questions || !quiz.questions.length) out.push("Add at least one question.");
  (quiz.questions || []).forEach((q, i) => {
    const n = "Question " + (i + 1);
    if (!String(q.text || "").trim()) out.push(n + " has no text.");
    if (!(Number(q.points) > 0)) out.push(n + " needs points above 0.");
    if (q.type === "mc") {
      const filled = (q.choices || []).filter((c) => String(c).trim());
      if (filled.length < 2) out.push(n + " needs at least two choices.");
      if (!Number.isInteger(q.answer) || !String(((q.choices || [])[q.answer]) || "").trim()) out.push(n + " needs a correct choice that is not empty.");
    } else if (typeof q.answer !== "boolean") out.push(n + " needs True or False as the answer.");
  });
  if (quiz.timeLimit != null && !(Number(quiz.timeLimit) >= 1 && Number(quiz.timeLimit) <= 600)) out.push("The time limit must be between 1 and 600 minutes.");
  return out;
}

/* Small seeded random generator so a student sees the SAME order after a reload, but a different order than a neighbour. */
function seeded(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Questions as the student sees them: [{ ...question, options: [{ index, label }] }]. `index` is the original position. */
export function presentQuestions(questions, { shuffle, seed }) {
  const rand = seeded(String(seed));
  const base = (questions || []).map((q) => {
    const options = q.type === "mc" ? (q.choices || []).map((label, index) => ({ index, label })).filter((o) => String(o.label).trim()) : null;
    return { ...q, options: options && shuffle ? shuffled(options, rand) : options };
  });
  return shuffle ? shuffled(base, rand) : base;
}

export const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

/* ---------------------------------------------------------------- import
   Reads questions and answers from a sheet (rows of cells, header row first). Columns, in any order, matched by header:
     Question | Type (optional: MC or TF) | A, B, C, D ... (choices) | Answer | Points (optional, default 1)
   Answer is the letter of the right choice (B), or its text, or True/False for a true/false question.
   Returns { questions, errors }; a row with a problem is skipped and named in errors. */
const cell = (v) => (v == null ? "" : String(v).trim());
const LETTERS = "ABCDEFGH";

export const QUIZ_TEMPLATE_ROWS = [
  ["Question", "Type", "A", "B", "C", "D", "Answer", "Points"],
  ["What is 2 + 2?", "MC", "3", "4", "5", "6", "B", 1],
  ["The sky is green.", "TF", "", "", "", "", "False", 1],
];

export function parseQuizRows(rows) {
  const errors = [];
  const head = (rows || []).findIndex((r) => (r || []).some((c) => /^question/i.test(cell(c))));
  if (head < 0) return { questions: [], errors: ['Put a header row first, with a "Question" column, choice columns A, B, C, D, and an "Answer" column.'] };
  const H = rows[head].map(cell);
  const col = (re) => H.findIndex((h) => re.test(h));
  const qC = col(/^question/i), tC = col(/^type/i), aC = col(/^(correct\s*)?(answer|key)\b/i), pC = col(/^(points?|pts)\b/i);
  const choiceCols = [];
  H.forEach((h, i) => {
    const m = /^(?:choice|option)?\s*([a-h])$/i.exec(h) || /^(?:choice|option)\s*([1-8])$/i.exec(h);
    if (m) choiceCols.push([i, /\d/.test(m[1]) ? Number(m[1]) - 1 : LETTERS.indexOf(m[1].toUpperCase())]);
  });
  if (aC < 0) return { questions: [], errors: ['There is no "Answer" column.'] };
  const questions = [];
  rows.slice(head + 1).forEach((r, k) => {
    const row = r || [];
    const text = cell(row[qC]);
    if (!text) return;
    const where = "Row " + (head + k + 2);
    const raw = cell(row[aC]);
    const slots = [];   // choice text by letter position, empty ones kept so "B" still means column B
    choiceCols.forEach(([i, pos]) => { slots[pos] = cell(row[i]); });
    const filled = slots.map((t, pos) => ({ t: t || "", pos })).filter((x) => x.t);
    const typeWord = cell(row[tC]).toLowerCase();
    const isTf = /^(tf|t\/f|true.?or.?false|true.?false|boolean)$/.test(typeWord) || (!typeWord && filled.length === 0 && /^(true|false|t|f)$/i.test(raw));
    const points = pC >= 0 && cell(row[pC]) !== "" ? Number(cell(row[pC])) : 1;
    if (!(points > 0)) return errors.push(where + ": points must be a number above 0.");
    if (isTf) {
      if (/^(true|t|yes)$/i.test(raw)) questions.push({ id: newId(), type: "tf", text, points, answer: true });
      else if (/^(false|f|no)$/i.test(raw)) questions.push({ id: newId(), type: "tf", text, points, answer: false });
      else errors.push(where + ': a true/false question needs "True" or "False" as its answer.');
      return;
    }
    if (filled.length < 2) return errors.push(where + ": a multiple choice question needs at least two choices.");
    let at = -1;
    if (/^[a-h]$/i.test(raw) && slots[LETTERS.indexOf(raw.toUpperCase())]) at = filled.findIndex((x) => x.pos === LETTERS.indexOf(raw.toUpperCase()));
    if (at < 0) at = filled.findIndex((x) => x.t.toLowerCase() === raw.toLowerCase());
    if (at < 0 && /^[1-8]$/.test(raw)) at = filled.findIndex((x) => x.pos === Number(raw) - 1);
    if (at < 0) return errors.push(where + ': the answer "' + raw + '" is not one of the choices.');
    questions.push({ id: newId(), type: "mc", text, points, choices: filled.map((x) => x.t), answer: at });
  });
  if (!questions.length && !errors.length) errors.push("No questions found below the header row.");
  return { questions, errors };
}
const newId = () => "n" + Math.random().toString(36).slice(2, 9);

/* ---------------------------------------------------------------- summaries
   answers are { questionId: choice index | true | false }, as sent by the student. */
export const answerLabel = (q, value) => {
  if (value === undefined || value === null) return null;
  if (q.type === "tf") return value === true ? "True" : value === false ? "False" : null;
  return Number.isInteger(value) && q.choices && q.choices[value] != null ? String(q.choices[value]) : null;
};
export const correctLabel = (q) => answerLabel(q, q.answer);
export const isRight = (q, value) => value !== undefined && value !== null && value === q.answer;

/* One student's attempt, question by question: [{ q, yours (text or null), correct (text), right }]. */
export function reviewAttempt(quiz, answers) {
  return (quiz.questions || []).map((q) => {
    const v = answers ? answers[q.id] : undefined;
    return { q, yours: answerLabel(q, v), correct: correctLabel(q), right: isRight(q, v) };
  });
}

/* How the class did on each question, from the submitted attempts that were not late:
   [{ q, taken, right, wrong, blank, pct, choices: [{ label, count, correct }] }]. */
export function questionStats(quiz, attempts) {
  const done = (attempts || []).filter((a) => a.submitted && !a.late);
  return (quiz.questions || []).map((q) => {
    const options = q.type === "tf" ? [true, false] : (q.choices || []).map((_, i) => i);
    const choices = options.map((o) => ({ label: answerLabel(q, o), count: 0, correct: o === q.answer })).filter((c) => c.label && String(c.label).trim());
    let right = 0, blank = 0;
    done.forEach((a) => {
      const v = a.answers ? a.answers[q.id] : undefined;
      if (v === undefined || v === null) { blank++; return; }
      if (isRight(q, v)) right++;
      const hit = choices.find((c) => c.label === answerLabel(q, v));
      if (hit) hit.count++;
    });
    const taken = done.length;
    return { q, taken, right, blank, wrong: taken - right - blank, pct: taken ? Math.round((right / taken) * 100) : null, choices };
  });
}
