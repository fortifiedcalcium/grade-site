// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import QuizPanel from "../src/pages/QuizPanel.jsx";
import { draftName, readDraft, restoreDraft, writeDraft } from "../src/lib/quizDraft.js";

const KEY = "secretkey123";
const LIST = [{ id: "qz", title: "Quiz 1", count: 2, total: 2, lockdown: false, maxViolations: 3, started: null, submitted: null }];
const QUESTIONS = [
  { id: "a1", type: "mc", text: "2+2?", points: 1, choices: ["three", "four"] },
  { id: "a2", type: "tf", text: "Sky is green", points: 1 },
];
const session = (over) => ({ id: "qz", title: "Quiz 1", remainingMs: null, violations: 0, lockdown: false, maxViolations: 3, shuffle: false, started: 111, draft: null, draftRev: 0, questions: QUESTIONS, ...over });

beforeEach(() => { cleanup(); window.localStorage.clear(); window.confirm = vi.fn(() => true); });

const open = async (over = {}, s = session()) => {
  const api = { list: vi.fn(async () => LIST), start: vi.fn(async () => s), save: vi.fn(async (_id, _a, rev) => rev), submit: vi.fn(async () => ({ points: 2, total: 2, late: false })), event: vi.fn(), ...over };
  render(<QuizPanel quizApi={api} quizKey={KEY} onSubmitted={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /start quiz/i }));
  await screen.findByText("2+2?");
  return api;
};
const status = () => screen.getByLabelText("Autosave status").textContent;
const later = { timeout: 3000 };

describe("quiz autosave", () => {
  it("keeps each answer on the device at once and then saves it to the database", async () => {
    const api = await open();
    fireEvent.click(screen.getByLabelText("four"));
    expect(readDraft(draftName(KEY, "qz", 111))).toEqual({ answers: { a1: 1 }, rev: 1 });   // before any network
    fireEvent.click(screen.getByLabelText("False"));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith("qz", { a1: 1, a2: false }, 2), later);
    await waitFor(() => expect(status()).toMatch(/answers saved/i), later);
  });
  it("brings the answers back after a reload, even if they never reached the database", async () => {
    await open({ save: vi.fn(async () => { throw new Error("offline"); }) });
    fireEvent.click(screen.getByLabelText("four"));
    await waitFor(() => expect(status()).toMatch(/saved on this device only/i), later);
    cleanup();   // the page closes; the student signs in again
    const api = await open();
    expect(screen.getByLabelText("four").checked).toBe(true);
    expect(document.body.textContent).toMatch(/saved answers were restored/i);
    await waitFor(() => expect(api.save).toHaveBeenCalledWith("qz", { a1: 1 }, 1), later);   // and is sent now that it can be
  });
  it("restores from the database on another device, and submits what was restored", async () => {
    const api = await open({}, session({ draft: { a1: 1, a2: false }, draftRev: 7 }));
    expect(screen.getByLabelText("four").checked).toBe(true);
    expect(screen.getByLabelText("False").checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /submit quiz/i }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith("qz", { a1: 1, a2: false }));
    expect(api.save).not.toHaveBeenCalled();   // nothing had changed
  });
  it("removes the device copy once the quiz is submitted, but keeps it if the submit fails", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ points: 1, total: 2, late: false });
    await open({ submit });
    fireEvent.click(screen.getByLabelText("four"));
    fireEvent.click(screen.getByRole("button", { name: /submit quiz/i }));
    await screen.findByText(/something went wrong/i);
    expect(readDraft(draftName(KEY, "qz", 111))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /submit quiz/i }));
    await waitFor(() => expect(readDraft(draftName(KEY, "qz", 111))).toBeNull());
  });
  it("saves right away when the student leaves the page, without waiting", async () => {
    const api = await open();
    fireEvent.click(screen.getByLabelText("four"));
    window.dispatchEvent(new Event("pagehide"));
    expect(api.save).toHaveBeenCalledTimes(1);
  });
  it("warns when the browser cannot store anything and the database cannot be reached", async () => {
    const spy = vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await open({ save: vi.fn(async () => { throw new Error("offline"); }) });
    fireEvent.click(screen.getByLabelText("four"));
    await waitFor(() => expect(status()).toMatch(/not being saved/i), later);
    spy.mockRestore();
  });
});

describe("draft rules", () => {
  it("takes the newer copy, and only answers that still fit the quiz", () => {
    const s = { questions: QUESTIONS, draft: { a1: 0 }, draftRev: 3 };
    expect(restoreDraft(s, { answers: { a1: 1 }, rev: 5 }).answers).toEqual({ a1: 1 });
    expect(restoreDraft(s, { answers: { a1: 1 }, rev: 2 }).answers).toEqual({ a1: 0 });
    expect(restoreDraft(s, { answers: { a1: 9, a2: "yes", zz: 1 }, rev: 8 }).answers).toEqual({});
  });
  it("never stores the secret key, and keeps students and retakes apart", () => {
    const name = draftName(KEY, "qz", 111);
    writeDraft(name, { a1: 1 }, 1);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(KEY);
    expect(draftName("another-student", "qz", 111)).not.toBe(name);
    expect(draftName(KEY, "qz", 222)).not.toBe(name);   // a retake starts clean
  });
});
