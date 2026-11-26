// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { buildDashboard } from "../src/lib/quizDashboard.js";
import QuizzesTab from "../src/pages/teacher/QuizzesTab.jsx";

const NOW = Date.now();
const questions = [
  { id: "a", type: "tf", text: "Easy one", points: 1, answer: true },
  { id: "b", type: "tf", text: "Hard one", points: 1, answer: true },
];
const quiz = (title, over) => ({ sec: "s", title, questions, published: true, timeLimit: 10, lockdown: true, maxViolations: 3, shuffle: true, updated: 1, ...over });
const quizzes = { q1: quiz("Quiz One"), q2: quiz("Draft Quiz", { published: false, updated: 2 }), other: quiz("Other section", { sec: "x" }) };
const records = { k1: { sec: "s", name: "Ana" }, k2: { sec: "s", name: "Ben" }, k3: { sec: "s", name: "Cy" }, k4: { sec: "s", name: "Dee" }, k5: { sec: "s", name: "Eli", id: "2026-00005@s" }, kx: { sec: "x", name: "Zed" } };
const att = (quizId, key, over) => ({ quizId, key, started: NOW - 60000, submitted: NOW - 30000, points: 2, total: 2, violations: 0, events: [], late: false, answers: { a: true, b: true }, ...over });
const attempts = Object.fromEntries([
  att("q1", "k1"),
  att("q1", "k2", { points: 1, violations: 3, answers: { a: true, b: false } }),
  att("q1", "k3", { submitted: null, points: null, total: null, violations: 1, answers: null }),                          // working on it
  att("q1", "k4", { submitted: null, points: null, total: null, started: NOW - 3600000, answers: null }),                // time ran out
  att("q1", "kx"),                                                                                                       // not in this section
].map((a) => [a.quizId + "|" + a.key, a]));
const students = Object.entries(records).filter(([, r]) => r.sec === "s");
const mine = Object.entries(quizzes).filter(([, q]) => q.sec === "s");

beforeEach(cleanup);

describe("quiz dashboard numbers", () => {
  const d = buildDashboard({ quizzes: mine, attempts, students, now: NOW });
  it("counts completion and averages over published quizzes and this section only", () => {
    expect(d.totals).toMatchObject({ published: 1, drafts: 1, students: 5, submitted: 2, expected: 5, inProgress: 1, toReview: 3 });
    expect(d.totals.completion).toBe(40);
    expect(d.totals.average).toBe(75);
    expect(d.rows[0]).toMatchObject({ submitted: 2, inProgress: 1, expired: 1, flagged: 2, notStarted: ["Eli"], highest: 100, lowest: 50 });
  });
  it("lists who is working, what needs review (serious first) and the hardest questions", () => {
    expect(d.live.map((a) => a.name)).toEqual(["Cy"]);
    expect(d.live[0].leftMs).toBe(9 * 60000);
    expect(d.review.map((a) => a.name)).toEqual(["Ben", "Dee", "Cy"]);
    expect(d.review[0].reasons[0]).toMatch(/3 warnings \(reached the limit\)/);
    expect(d.review[1].reasons.join()).toMatch(/never submitted/);
    expect(d.hardest.map((h) => [h.text, h.pct])).toEqual([["Hard one", 50], ["Easy one", 100]]);
  });
  it("leaves late attempts out of the average but lists them", () => {
    const x = buildDashboard({ quizzes: mine, students, now: NOW, attempts: { l: att("q1", "k1", { late: true, points: 0 }), o: att("q1", "k2") } });
    expect(x.totals.average).toBe(100);
    expect(x.totals.submitted).toBe(2);
    expect(x.review[0].reasons).toEqual(["submitted late: 0 / 2 from answers saved in time"]);
  });
  it("copes with nothing to show", () => {
    const x = buildDashboard({ quizzes: [], attempts: {}, students: [], now: NOW });
    expect(x.totals).toMatchObject({ completion: null, average: null, expected: 0 });
  });
});

describe("quizzes tab", () => {
  const sections = { s: { name: "3A", term: "2026-2027 1st Semester", subject: { code: "" }, scheme: { categories: [] } } };
  const mount = () => render(<QuizzesTab db={{}} sections={sections} quizzes={quizzes} attempts={attempts} records={records} />);
  it("opens on the dashboard and jumps to a quiz picked there", () => {
    mount();
    const dash = screen.getByRole("region", { name: "Quiz dashboard" });
    expect(dash.textContent).toContain("40%");
    expect(dash.textContent).toContain("75%");
    expect(dash.textContent).not.toContain("Other section");
    const card = document.getElementById("quiz-q1");
    expect(card.closest("div[hidden]")).not.toBeNull();
    fireEvent.click(within(screen.getByRole("region", { name: "Quizzes at a glance" })).getByRole("button", { name: "Quiz One" }));
    expect(card.closest("div[hidden]")).toBeNull();
    expect(card.open).toBe(true);
  });
  it("shows a student number, never the secret key, next to a student who has not started", () => {
    mount();
    fireEvent.click(within(screen.getByRole("region", { name: "Quizzes at a glance" })).getByRole("button", { name: "Quiz One" }));
    const row = screen.getAllByText("Eli").map((el) => el.closest("tr")).find((tr) => tr && tr.textContent.includes("Not started"));
    expect(row.textContent).toContain("2026-00005");
    expect(row.textContent).not.toContain("k5");
  });
  it("keeps unsaved edits when switching between the views", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /new quiz/i }));
    fireEvent.change(screen.getAllByPlaceholderText(/Quiz 1: Arrays/)[0], { target: { value: "Half-typed title" } });
    fireEvent.click(screen.getByRole("button", { name: /^\s*dashboard/i }));
    fireEvent.click(screen.getByRole("button", { name: /manage quizzes/i }));
    expect(screen.getByDisplayValue("Half-typed title")).toBeTruthy();
  });
});
