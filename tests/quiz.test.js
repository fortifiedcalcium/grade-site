import { describe, it, expect } from "vitest";
import { blankQuestion, blankQuiz, fmtClock, presentQuestions, quizProblems, totalPoints } from "../src/lib/quiz.js";

const qs = () => [
  { id: "a", type: "mc", text: "A", points: 1, choices: ["w", "x", "y", "z"], answer: 2 },
  { id: "b", type: "tf", text: "B", points: 2, answer: true },
  { id: "c", type: "mc", text: "C", points: 1, choices: ["1", "2", "3", "4"], answer: 0 },
  { id: "d", type: "mc", text: "D", points: 1, choices: ["p", "q", "", "r"], answer: 1 },
];

describe("quiz helpers", () => {
  it("validates a quiz", () => {
    expect(quizProblems(blankQuiz("a"))).not.toEqual([]);
    const ok = { ...blankQuiz("a"), title: "T", questions: [{ ...blankQuestion("mc"), text: "Q", choices: ["a", "b", "", ""], answer: 0 }, { ...blankQuestion("tf"), text: "R" }] };
    expect(quizProblems(ok)).toEqual([]);
    expect(quizProblems({ ...ok, questions: [{ ...ok.questions[0], answer: 3 }] }).join()).toMatch(/correct choice/);
    expect(quizProblems({ ...ok, timeLimit: 0.5 }).join()).toMatch(/time limit/);
    expect(totalPoints(qs())).toBe(5);
  });
  it("shuffles the same way for the same student and differently for another, keeping original choice indexes", () => {
    const a1 = presentQuestions(qs(), { shuffle: true, seed: "key1|q" });
    const a2 = presentQuestions(qs(), { shuffle: true, seed: "key1|q" });
    expect(a1.map((q) => q.id)).toEqual(a2.map((q) => q.id));
    const orders = new Set(["k1", "k2", "k3", "k4", "k5", "k6"].map((k) => presentQuestions(qs(), { shuffle: true, seed: k + "|q" }).map((q) => q.id).join()));
    expect(orders.size).toBeGreaterThan(1);
    const mc = a1.find((q) => q.id === "a");
    expect(mc.options.find((o) => o.label === "y").index).toBe(2);   // the answer still maps to the original index
    expect(a1.find((q) => q.id === "d").options.map((o) => o.label).sort()).toEqual(["p", "q", "r"]);   // empty choices are dropped
    expect(presentQuestions(qs(), { shuffle: false, seed: "x" }).map((q) => q.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("formats the countdown", () => {
    expect(fmtClock(65000)).toBe("1:05");
    expect(fmtClock(0)).toBe("0:00");
  });
});

import { parseQuizRows, QUIZ_TEMPLATE_ROWS } from "../src/lib/quiz.js";
import { termChoices } from "../src/lib/terms.js";

describe("quiz import", () => {
  it("reads the template: letter answers, true/false and points", () => {
    const { questions, errors } = parseQuizRows(QUIZ_TEMPLATE_ROWS);
    expect(errors).toEqual([]);
    expect(questions).toMatchObject([
      { type: "mc", text: "What is 2 + 2?", choices: ["3", "4", "5", "6"], answer: 1, points: 1 },
      { type: "tf", text: "The sky is green.", answer: false, points: 1 },
    ]);
  });
  it("accepts the answer as text, skips empty choices without breaking the letter, and reports bad rows", () => {
    const rows = [
      ["#", "Question", "Option A", "Option B", "Option C", "Correct answer", "Pts"],
      [1, "Pick", "x", "", "z", "C", 2],            // letter C is the third column even though B is empty
      [2, "Pick text", "red", "green", "blue", "green", ""],
      [3, "Bad answer", "a", "b", "c", "Q", 1],
      [4, "One choice", "a", "", "", "A", 1],
      [5, "True or false?", "", "", "", "true", 1],  // type inferred
      [6, "", "", "", "", "", ""],                   // blank rows are ignored
    ];
    const { questions, errors } = parseQuizRows(rows);
    expect(questions.map((q) => [q.text, q.answer, q.points])).toEqual([["Pick", 1, 2], ["Pick text", 1, 1], ["True or false?", true, 1]]);
    expect(questions[0].choices).toEqual(["x", "z"]);   // answer index follows the kept choices
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Row 4.*"Q"/);
    expect(errors[1]).toMatch(/Row 5.*two choices/);
  });
  it("explains a file without the expected header", () => {
    expect(parseQuizRows([["foo", "bar"]]).errors[0]).toMatch(/header row/);
    expect(parseQuizRows([["Question", "A", "B"], ["x", "1", "2"]]).errors[0]).toMatch(/Answer/);
  });
});

describe("semester choices", () => {
  it("lists the school years around today, newest first, keeps used terms and hides excluded ones", () => {
    const list = termChoices(["2019-2020 1st Semester"], { today: new Date("2026-11-22"), exclude: ["2026-2027 2nd Semester"] });
    expect(list[0]).toBe("2028-2029 Summer");
    expect(list).toContain("2026-2027 1st Semester");
    expect(list).not.toContain("2026-2027 2nd Semester");
    expect(list).toContain("2019-2020 1st Semester");
    expect(list.indexOf("2026-2027 Summer")).toBeLessThan(list.indexOf("2026-2027 1st Semester"));   // Summer counts as last of the year
    expect(termChoices([], { today: new Date("2026-03-01") })).toContain("2025-2026 2nd Semester");    // before June: still last school year
  });
});
