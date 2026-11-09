// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import PinsTab from "../src/pages/teacher/PinsTab.jsx";

const sections = { a: { name: "BSIT 3-A" }, b: { name: "BSIT 3-B" } };
const roster = {
  S1: { name: "AQUINO, ANA", sec: "a", pin: "AAA111", key: "k1" },
  S2: { name: "REYES, BEN", sec: "b", pin: "BBB222", key: "k2" },
};

beforeEach(() => {
  cleanup();
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

describe("Students & PINs: mail merge file", () => {
  it("downloads every student from every section with PINs and the site link", async () => {
    let blob;
    URL.createObjectURL = vi.fn((b) => { blob = b; return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
    render(<PinsTab db={{ rpc: vi.fn() }} meta={{ salt: "x" }} sections={sections} roster={roster} />);
    fireEvent.click(screen.getByRole("button", { name: /mail merge file/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    const text = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob); });
    const lines = text.replace(/^\ufeff/, "").split("\r\n");
    expect(lines[0]).toBe("Email,Student no.,Name,First name,Section,PIN,Link,Status");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(',S1,"AQUINO, ANA",Ana,BSIT 3-A,AAA111,' + window.location.origin + ",");
    expect(lines[2]).toContain("BSIT 3-B,BBB222");   // the other section is included too
    expect(screen.getByText(/pin-mail-merge\.csv with 2 students from all sections/)).toBeTruthy();
  });
});

describe("Students & PINs: email PINs from the app", () => {
  it("sends only students who have an email and passes the instructor's session to the function", async () => {
    const invoke = vi.fn(async (name, { body }) => ({ data: { results: body.messages.map((m) => ({ id: m.id, ok: true })) }, error: null }));
    const rpc = vi.fn();
    window.confirm = vi.fn(() => true);
    const r = { ...roster, S1: { ...roster.S1, email: "ana@x.edu" } };
    render(<PinsTab db={{ rpc, functions: { invoke } }} user={{ email: "teacher@x.edu" }} meta={{ salt: "x" }} sections={sections} roster={r} />);
    fireEvent.click(screen.getByRole("button", { name: /^email pins$/i }));
    expect(screen.getByText(/ready to send/).textContent).toContain("1");
    fireEvent.click(screen.getByRole("button", { name: /send pins \(1\)/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][0]).toBe("send-pins");
    const body = invoke.mock.calls[0][1].body;
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ id: "S1", to: "ana@x.edu" });
    expect(body.messages[0].text).toContain("AAA111");
    expect(body.test).toBe(false);
    await waitFor(() => expect(screen.getByText(/Sent 1 email/)).toBeTruthy());
    const asked = window.confirm.mock.calls[0][0];
    expect(asked).toContain("AQUINO, ANA <ana@x.edu>");     // the confirmation lists who is about to be emailed
    expect(asked).toContain("section BSIT 3-A");
  });

  it("can mark students as already emailed without sending anything", async () => {
    const invoke = vi.fn();
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    window.confirm = vi.fn(() => true);
    const r = { ...roster, S1: { ...roster.S1, email: "ana@x.edu" } };
    render(<PinsTab db={{ rpc, functions: { invoke } }} user={{ email: "t@x.edu" }} meta={{ salt: "x" }} sections={sections} roster={r} />);
    fireEvent.click(screen.getByRole("button", { name: /^email pins$/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark as already emailed/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("mark_emailed", { p_ids: ["S1"] }));
    expect(invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/No email was sent/)).toBeTruthy());
  });
});
