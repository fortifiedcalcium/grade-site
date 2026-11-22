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
