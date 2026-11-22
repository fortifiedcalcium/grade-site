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
const begin = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /start quiz/i }));
  await screen.findByText("2+2?");
};

describe("student quiz anti-cheat", () => {
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
