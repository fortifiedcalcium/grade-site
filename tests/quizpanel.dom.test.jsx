// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import QuizPanel from "../src/pages/QuizPanel.jsx";

const LIST = [{ id: "qz", title: "Quiz 1", count: 1, total: 1, timeLimit: null, lockdown: true, maxViolations: 2, started: null, submitted: null }];
const SESSION = { id: "qz", title: "Quiz 1", remainingMs: null, violations: 0, lockdown: true, maxViolations: 2, shuffle: false,
  questions: [{ id: "a1", type: "mc", text: "2+2?", points: 1, choices: ["3", "4"] }] };

beforeEach(() => { cleanup(); window.confirm = vi.fn(() => true); });

const setup = (over = {}) => {
  const quizApi = { list: vi.fn(async () => LIST), start: vi.fn(async () => SESSION), submit: vi.fn(async () => ({ points: 1, total: 1, late: false })), event: vi.fn(async () => 1), ...over };
  render(<QuizPanel quizApi={quizApi} quizKey="k1" onSubmitted={() => {}} />);
  return quizApi;
};
/* The page attaches its anti-cheat listeners in an effect, which runs a moment AFTER the question appears. On a busy machine a
   test that acts the instant the question is visible can get in first, so wait until the listeners are there. A right-click is
   used to check: the page blocks it but never counts it as a warning. */
const listening = () => waitFor(() => {
  const probe = new Event("contextmenu", { cancelable: true, bubbles: true });
  document.dispatchEvent(probe);
  expect(probe.defaultPrevented).toBe(true);
});
const begin = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /start quiz/i }));
  await screen.findByText("2+2?");
  await listening();
};

describe("student quiz anti-cheat", () => {
  it("lists what counts as cheating before the quiz starts, with the quiz's own warning limit", async () => {
    setup();
    await screen.findByRole("button", { name: /start quiz/i });
    const rules = document.querySelector("details.quiz-rules");
    expect(rules.open).toBe(true);
    expect(rules.textContent).toMatch(/what counts as cheating/i);
    expect(rules.textContent).toMatch(/switching to another browser tab/i);
    expect(rules.textContent).toMatch(/locking your phone/i);
    expect(rules.textContent).toMatch(/blocked, but not counted/i);
    expect(rules.textContent).toMatch(/after 2 warnings/i);
    await begin();
    expect(document.querySelector("details.quiz-rules").open).toBe(false);   // still there during the quiz, folded away
  });
  it("lets the floating panel be hidden and brought back, keeping the essentials on the small button", async () => {
    setup({ start: vi.fn(async () => ({ ...SESSION, remainingMs: 600000, maxViolations: 3 })) });
    await begin();
    const run = () => document.querySelector(".quiz-run");
    fireEvent.click(screen.getByRole("button", { name: /^\s*hide/i }));
    expect(run().classList.contains("bar-closed")).toBe(true);
    const pill = document.querySelector(".quiz-pill");
    expect(pill.textContent).toMatch(/Time left (10:00|9:59)/);
    expect(pill.textContent).toMatch(/Warnings 0\/3/);
    expect(pill.textContent).toMatch(/Answered 0\/1/);
    fireEvent.click(screen.getByLabelText("4"));   // answering works with the panel hidden, and the count follows
    expect(document.querySelector(".quiz-pill").textContent).toMatch(/Answered 1\/1/);
    fireEvent.click(document.querySelector(".quiz-pill"));
    expect(run().classList.contains("bar-closed")).toBe(false);
    expect(document.querySelector(".quiz-pill")).toBeNull();
  });
  it("reopens a hidden panel when there is a new warning, so it is not missed", async () => {
    const api = setup({ start: vi.fn(async () => ({ ...SESSION, maxViolations: 3 })) });
    await begin();
    fireEvent.click(screen.getByRole("button", { name: /^\s*hide/i }));
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(api.event).toHaveBeenCalledWith("qz", "left-page");
    expect(document.querySelector(".quiz-run").classList.contains("bar-closed")).toBe(false);
    expect(screen.getByRole("alert").textContent).toMatch(/you left the quiz page/i);
  });
  it("shows no rules for a quiz with lockdown off, since nothing is recorded", async () => {
    setup({ list: vi.fn(async () => [{ ...LIST[0], lockdown: false }]) });
    await screen.findByRole("button", { name: /start quiz/i });
    expect(document.querySelector("details.quiz-rules")).toBeNull();
  });
  it("submits the ORIGINAL choice index and shows the result", async () => {
    const api = setup();
    await begin();
    fireEvent.click(screen.getByLabelText("4"));
    fireEvent.click(screen.getByRole("button", { name: /submit quiz/i }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith("qz", { a1: 1 }));
    expect(await screen.findByText(/you scored 1 \/ 1/i)).toBeTruthy();
  });
  it("logs leaving the page, blocks paste, and auto-submits at the warning limit", async () => {
    const api = setup();
    await begin();
    const paste = new Event("paste", { cancelable: true, bubbles: true });
    act(() => { document.dispatchEvent(paste); });
    expect(paste.defaultPrevented).toBe(true);
    expect(api.event).toHaveBeenCalledWith("qz", "paste");
    expect(api.submit).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 1600));   // events within 1.5 s count once
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(api.event).toHaveBeenCalledWith("qz", "left-page");
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));   // 2 warnings = the limit
  });
});
