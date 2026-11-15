import { describe, it, expect } from "vitest";
import { LEGACY_TERM, termOf, termsOf, scopeToTerm, compareTerms } from "../src/lib/terms.js";

const parsed = () => ({
  sections: [{ id: "bsit-3a", name: "BSIT 3-A", subject: { code: "IT101" }, scheme: {} }],
  students: [{ id: "S1", name: "ANA", sec: "bsit-3a", s: {} }],
});

describe("semesters", () => {
  it("files sections saved before terms existed under 2026-2027 1st Semester", () => {
    expect(termOf({ name: "x" })).toBe(LEGACY_TERM);
    expect(termOf({ term: "2026-2027 2nd Semester" })).toBe("2026-2027 2nd Semester");
  });
  it("lists terms newest first", () => {
    const secs = { a: {}, b: { term: "2026-2027 2nd Semester" }, c: { term: "2025-2026 2nd Semester" } };
    expect(termsOf(secs)).toEqual(["2026-2027 2nd Semester", "2026-2027 1st Semester", "2025-2026 2nd Semester"]);
    expect(compareTerms("2026-2027 1st Semester", "2026-2027 Summer")).toBeGreaterThan(0);
  });
  it("re-importing into the same semester updates the same sections", () => {
    const out = scopeToTerm(parsed(), LEGACY_TERM, { "bsit-3a": { name: "BSIT 3-A" } });
    expect(out.sections[0]).toMatchObject({ id: "bsit-3a", term: LEGACY_TERM });
    expect(out.students[0].sec).toBe("bsit-3a");
  });
  it("importing the same sheet name into a new semester never touches the old section", () => {
    const out = scopeToTerm(parsed(), "2026-2027 2nd Semester", { "bsit-3a": { name: "BSIT 3-A" } });
    expect(out.sections[0].id).toBe("2026-2027-2nd-semester--bsit-3a");
    expect(out.sections[0].term).toBe("2026-2027 2nd Semester");
    expect(out.students[0].sec).toBe("2026-2027-2nd-semester--bsit-3a");
    // and importing that semester again lands on the section it made
    const again = scopeToTerm(parsed(), "2026-2027 2nd Semester", { "bsit-3a": {}, [out.sections[0].id]: { term: "2026-2027 2nd Semester" } });
    expect(again.sections[0].id).toBe(out.sections[0].id);
  });
});
