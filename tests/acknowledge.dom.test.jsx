// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GradeView } from "../src/pages/StudentPortal.jsx";

const section = { name: "A", scheme: { passEquiv: 3, categories: [{ id: "q", title: "Quizzes", weight: 100, items: [{ k: "q1", label: "Quiz 1", max: 10 }] }] } };
const data = (record) => ({ record: { id: "S1", name: "Ana", sec: "a", s: { q1: 9 }, ...record }, section, meta: {} });

beforeEach(cleanup);

describe("student acknowledgment", () => {
  it("shows the button, and pressing it calls onAcknowledge", () => {
    const onAck = vi.fn();
    render(<GradeView data={data({})} onAcknowledge={onAck} onRefresh={() => {}} onLogout={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /i acknowledge my grade/i }));
    expect(onAck).toHaveBeenCalled();
  });
  it("replaces the button with a confirmation once acknowledged", () => {
    render(<GradeView data={data({ ack: 1700000000000 })} onAcknowledge={() => {}} onRefresh={() => {}} onLogout={() => {}} />);
    expect(screen.queryByRole("button", { name: /i acknowledge my grade/i })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/you acknowledged your grade/i);
  });
  it("hides the button while the final grade is pending", () => {
    render(<GradeView data={data({ s: {} })} onAcknowledge={() => {}} onRefresh={() => {}} onLogout={() => {}} />);
    expect(screen.queryByRole("button", { name: /i acknowledge my grade/i })).toBeNull();
  });
});
