// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import GradesTab from "../src/pages/teacher/GradesTab.jsx";

const sections = {
  a: { name: "Section A", scheme: { passEquiv: 3, categories: [{ id: "q", title: "Quizzes", weight: 100, items: [{ k: "q1", label: "Quiz 1", max: 10 }] }] } },
};
const roster = {
  S1: { name: "Ana", sec: "a", pin: "111111", key: "k1" },
  S2: { name: "Ben", sec: "a", pin: "222222", key: "k2" },
  S3: { name: "Cy", sec: "a", pin: "333333", key: "k3" },
};
const records = { k1: { s: { q1: 5 } }, k2: { s: { q1: 6 } }, k3: { s: {} } };

let calls;
const db = { rpc: (name, args) => { calls.push([name, args]); return Promise.resolve({ data: null, error: null }); } };
const mount = () => render(<GradesTab db={db} meta={{ salt: "x" }} sections={sections} roster={roster} records={records} goImport={() => {}} />);

beforeEach(() => {
  cleanup();
  calls = [];
  window.confirm = vi.fn(() => true);
});

describe("grades tab selection", () => {
  it("deletes only the ticked students", async () => {
    mount();
    expect(screen.queryByRole("button", { name: /delete selected/i })).toBeNull();
    fireEvent.click(screen.getByLabelText("Select Ana"));
    fireEvent.click(screen.getByLabelText("Select Cy"));
    fireEvent.click(screen.getByRole("button", { name: /delete selected \(2\)/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0][0]).toBe("delete_students");
    expect(calls[0][1].p_rows).toEqual([{ id: "S1", key: "k1" }, { id: "S3", key: "k3" }]);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/2 selected students/));
  });
  it("select all picks every visible student, and cancelling the confirm deletes nothing", async () => {
    window.confirm = vi.fn(() => false);
    mount();
    fireEvent.click(screen.getByLabelText("Select all students"));
    fireEvent.click(screen.getByRole("button", { name: /delete selected \(3\)/i }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });
  it("search narrows what select all and delete can touch", async () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ben" } });
    fireEvent.click(screen.getByLabelText("Select all students"));
    fireEvent.click(screen.getByRole("button", { name: /delete selected \(1\)/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0][1].p_rows).toEqual([{ id: "S2", key: "k2" }]);
  });
});

describe("clear all scores", () => {
  it("blanks the section's scores after confirming", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /clear all scores/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0][0]).toBe("upsert_students");
    expect(calls[0][1].p_rows).toHaveLength(3);
    expect(calls[0][1].p_rows.every((r) => JSON.stringify(r.s) === "{}")).toBe(true);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Clear ALL scores for the 3 students/));
  });
});
