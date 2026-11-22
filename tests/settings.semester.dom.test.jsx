// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import SettingsTab from "../src/pages/teacher/SettingsTab.jsx";

beforeEach(() => { cleanup(); window.sessionStorage.clear(); });

const scheme = { categories: [], scale: [], passEquiv: 3 };
const sec = (name, term) => ({ name, term, subject: { code: "", desc: "" }, scheme });
const sections = { a: sec("BSIT 3-A", "2026-2027 2nd Semester"), b: sec("BSIT 3-B", "2026-2027 1st Semester"), c: sec("BSIT 3-C", "2026-2027 1st Semester") };
const mount = () => render(<SettingsTab db={{}} meta={{}} sections={sections} roster={{}} takenIds={new Set()} />);
const listed = () => ["BSIT 3-A", "BSIT 3-B", "BSIT 3-C"].filter((n) => screen.queryByText(n, { selector: "summary strong" }));

describe("Settings sections by semester", () => {
  it("lists only the newest semester's sections at first, and switches with the dropdown", () => {
    mount();
    expect(listed()).toEqual(["BSIT 3-A"]);
    const pick = screen.getByLabelText("Show sections of semester");
    fireEvent.change(pick, { target: { value: "2026-2027 1st Semester" } });
    expect(listed()).toEqual(["BSIT 3-B", "BSIT 3-C"]);
    expect(document.body.textContent).toContain("2 of 3 sections");
    fireEvent.change(pick, { target: { value: "__all" } });
    expect(listed()).toEqual(["BSIT 3-A", "BSIT 3-B", "BSIT 3-C"]);
  });
  it("can show a single section of the semester", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Show sections of semester"), { target: { value: "2026-2027 1st Semester" } });
    const pick = screen.getByLabelText("Show section");
    expect([...pick.options].map((o) => o.textContent)).toEqual(["All sections (2)", "BSIT 3-B", "BSIT 3-C"]);
    fireEvent.change(pick, { target: { value: "c" } });
    expect(listed()).toEqual(["BSIT 3-C"]);
    fireEvent.change(screen.getByLabelText("Show sections of semester"), { target: { value: "2026-2027 2nd Semester" } });   // changing semester goes back to all of its sections
    expect(listed()).toEqual(["BSIT 3-A"]);
  });
  it("starts on the semester picked on another tab", () => {
    window.sessionStorage.setItem("term-filter", "2026-2027 1st Semester");
    mount();
    expect(listed()).toEqual(["BSIT 3-B", "BSIT 3-C"]);
  });
});
