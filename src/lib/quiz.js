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
  timeLimit: null, shuffle: true, lockdown: true, maxViolations: 3,
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
