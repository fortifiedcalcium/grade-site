// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../src/supabase.js", () => ({ isConfigured: true, getDb: () => ({}), getAuth: () => ({}) }));

beforeEach(() => {
  cleanup();
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

const scheme = { categories: [], scale: [], passEquiv: 3 };
const entry = (key, sec, name) => ({ key, record: { id: sec === "a" ? "S1" : "S1@b", name: "Ana", sec, s: {} }, section: { name, scheme } });

describe("student with two sections", () => {
  it("shows the plain student number and switches section", async () => {
    const { GradeView } = await import("../src/pages/StudentPortal.jsx");
    const a = entry("ka", "a", "BSIT 3-A"), b = entry("kb", "b", "BSIT 3-B");
    const onSwitch = vi.fn();
    render(<GradeView data={{ ...a, meta: { title: "T" }, others: [a, b] }} onRefresh={() => {}} onLogout={() => {}} onAcknowledge={() => {}} onSwitch={onSwitch} />);
    expect(document.body.textContent).toContain("Ana · S1");
    expect(document.body.textContent).not.toContain("S1@b");
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "kb" } });
    expect(onSwitch).toHaveBeenCalledWith("kb");
  });
  it("hides the switcher for a student in one section", async () => {
    const { GradeView } = await import("../src/pages/StudentPortal.jsx");
    const a = entry("ka", "a", "BSIT 3-A");
    render(<GradeView data={{ ...a, meta: { title: "T" }, others: [a] }} onRefresh={() => {}} onLogout={() => {}} onAcknowledge={() => {}} />);
    expect(screen.queryByLabelText("Section")).toBeNull();
  });
});
