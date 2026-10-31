// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import GradesTab from "../src/pages/teacher/GradesTab.jsx";

const sections = {
  a: { name: "Section A", scheme: { passEquiv: 3, categories: [
    { id: "act", title: "Activities", weight: 50, items: [{ k: "a1", label: "Act 1", max: 10 }, { k: "a2", label: "Act 2", max: 10 }] },
    { id: "quiz", title: "Quizzes", weight: 50, items: [{ k: "z1", label: "Quiz 1", max: 10 }] },
  ] } },
};
const roster = {
  S1: { name: "Ana", sec: "a", pin: "1", key: "k1" },
  S2: { name: "Ben", sec: "a", pin: "2", key: "k2" },
  S3: { name: "Cy", sec: "a", pin: "3", key: "k3" },
};
const records = {
  k1: { s: { a1: 10, a2: 8, z1: 9 } },
  k2: { s: { a1: 6, z1: 4 } },
  k3: { s: { a1: 8, a2: 8, z1: 10 } },
};
const mount = () => render(<GradesTab db={{ rpc: vi.fn() }} meta={{ salt: "x" }} sections={sections} roster={roster} records={records} goImport={() => {}} />);
const statRow = (label) => screen.getByText(label, { selector: "tfoot th" }).closest("tr");

beforeEach(() => cleanup());

describe("grades tab statistics and filters", () => {
  it("shows highest, lowest and average under every score", () => {
    mount();
    expect(statRow("Highest").textContent).toContain("10.00");
    expect(statRow("Lowest").textContent).toContain("6.00");
    expect(statRow("Average").textContent).toContain("8.00");   // Act 1: (10 + 6 + 8) / 3
  });
  it("lists who scored highest and lowest in each component", () => {
    mount();
    const card = screen.getByLabelText("Statistics by component");
    const act = within(card).getByText("Activities").closest("tr");
    expect(act.textContent).toContain("Ana");   // 18/20 * 50 = 45 is the highest
    expect(act.textContent).toContain("Ben");   // 6/20 * 50 = 15 is the lowest
  });
  it("names who is closest to the average in each component", () => {
    mount();
    const card = screen.getByLabelText("Statistics by component");
    expect(within(card).getByText("Average scored by", { selector: "th" })).toBeTruthy();
    const act = within(card).getByText("Activities").closest("tr");
    // Activities points: Ana 45, Ben 15, Cy 40 -> average 33.33; Cy (40) is closest
    expect(act.cells[act.cells.length - 1].textContent).toBe("Cy");
  });
  it("hiding a column group removes its scores and its statistics", () => {
    mount();
    expect(screen.getByText("Act 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Quizzes" }));
    expect(screen.queryByText("Quiz 1")).toBeNull();
    expect(screen.getByText("Act 1")).toBeTruthy();
    const card = screen.getByLabelText("Statistics by component");
    expect(within(card).queryByText("Quizzes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("Quiz 1")).toBeTruthy();
  });
  it("unticking Final grade hides those columns", () => {
    mount();
    expect(screen.getByText("Remarks", { selector: "th" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Final grade" }));
    expect(screen.queryByText("Remarks", { selector: "th" })).toBeNull();
  });
  it("status filter narrows the students and the statistics follow", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "failed" } });   // only Ben (35)
    expect(screen.queryByLabelText("Select Ana")).toBeNull();
    expect(screen.getByLabelText("Select Ben")).toBeTruthy();
    expect(statRow("Highest").textContent).toContain("6.00");
    expect(screen.getByText(/1 of 3 students/)).toBeTruthy();
  });
  it("statistics only hides the student rows but keeps the statistics", () => {
    mount();
    fireEvent.change(screen.getByLabelText("View"), { target: { value: "stats" } });
    expect(screen.queryByLabelText("Select Ana")).toBeNull();
    expect(statRow("Average")).toBeTruthy();
  });
  it("students only hides the statistics", () => {
    mount();
    fireEvent.change(screen.getByLabelText("View"), { target: { value: "students" } });
    expect(screen.queryByText("Highest", { selector: "tfoot th" })).toBeNull();
    expect(screen.queryByLabelText("Statistics by component")).toBeNull();
    expect(screen.getByLabelText("Select Ana")).toBeTruthy();
  });
  it("sorting by highest grade puts the best student first", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "high" } });
    const names = screen.getAllByLabelText(/^Select (Ana|Ben|Cy)$/).map((el) => el.getAttribute("aria-label"));
    expect(names).toEqual(["Select Ana", "Select Cy", "Select Ben"]);   // Ana and Cy tie on 90, so by name; Ben has 35
  });
});
