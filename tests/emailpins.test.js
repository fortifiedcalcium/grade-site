import { describe, it, expect } from "vitest";
import { buildPlan, emailFor, isValidEmail, parseEmailCsv, renderHtml, renderText, DEFAULT_TEMPLATE } from "../src/lib/emailpins.js";

const sections = { a: { name: "BSIT 3-A" } };
const roster = {
  S1: { name: "AQUINO, ANA", sec: "a", pin: "AAA111", email: "ana@x.edu" },
  S2: { name: "REYES, BEN", sec: "a", pin: "BBB222", email: "" },
  S3: { name: "CRUZ, CY", sec: "a", pin: "CCC333", email: "cy@x.edu", emailed: 1 },
};
const link = "https://grades.example";

describe("emailing PINs", () => {
  it("validates emails and builds one from a pattern only when none is saved", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a b@c.d")).toBe(false);
    expect(emailFor("", "2026-00123", "{id}@school.edu")).toBe("2026-00123@school.edu");
    expect(emailFor("me@x.com", "S1", "{id}@school.edu")).toBe("me@x.com");
    expect(emailFor("", "S1", "")).toBe("");
  });
  it("fills placeholders, escapes html and bolds the PIN", () => {
    const v = { "first name": "A&B", pin: "X1" };
    expect(renderText("Hi {{First name}} {{ PIN }}", v)).toBe("Hi A&B X1");
    const h = renderHtml("Hi {{First name}} {{PIN}}\nsee https://x.y", v);
    expect(h).toContain("A&amp;B");
    expect(h).toContain("<b ");
    expect(h).toContain("<br>");
    expect(h).toContain('<a href="https://x.y">');
  });
  it("plans who gets an email, with reasons for the rest", () => {
    const p = buildPlan({ roster, sections, ids: ["S1", "S2", "S3"], template: DEFAULT_TEMPLATE, link, onlyUnsent: true });
    expect(p.ready.map((m) => m.id)).toEqual(["S1"]);
    expect(p.ready[0]).toMatchObject({ to: "ana@x.edu", subject: "Your grade portal PIN (BSIT 3-A)" });
    expect(p.ready[0].text).toContain("PIN: AAA111");
    expect(p.skipped.map((s) => s.reason)).toEqual(["no valid email", "already emailed"]);
    const all = buildPlan({ roster, sections, ids: ["S3"], template: DEFAULT_TEMPLATE, link, onlyUnsent: false });
    expect(all.ready).toHaveLength(1);
  });
  it("reports unknown placeholders", () => {
    const p = buildPlan({ roster, sections, ids: ["S1"], template: { ...DEFAULT_TEMPLATE, body: "Hi {{Nickname}}" }, link });
    expect(p.unknown).toEqual(["Nickname"]);
  });
  it("reads emails from a CSV with or without a header", () => {
    expect(parseEmailCsv('Student no.,Name,Email\r\nS1,"X, Y",a@b.co\n')).toEqual([{ id: "S1", email: "a@b.co", sent: false }]);
    expect(parseEmailCsv("S1,a@b.co\nS2,c@d.co")).toEqual([{ id: "S1", email: "a@b.co", sent: false }, { id: "S2", email: "c@d.co", sent: false }]);
    const old = parseEmailCsv("Email,Student no.,Name,Status\na@b.co,S1,X,sent\nc@d.co,S2,Y,\n");
    expect(old.map((r) => r.sent)).toEqual([true, false]);
    expect(parseEmailCsv("")).toEqual([]);
  });
});
