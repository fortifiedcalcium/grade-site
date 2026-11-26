// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import Busy, { useBusy } from "../src/Busy.jsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("wait box", () => {
  it("stays hidden for a quick request, then appears if it takes longer", () => {
    render(<Busy show text="Submitting your quiz…" />);
    expect(screen.queryByRole("alertdialog")).toBeNull();           // a quick request would only flash
    act(() => { vi.advanceTimersByTime(300); });
    const box = screen.getByRole("alertdialog");
    expect(box.textContent).toContain("Submitting your quiz…");
    expect(box.getAttribute("aria-busy")).toBe("true");
    expect(box.parentElement).toBe(document.body);                  // drawn over the whole page
  });
  it("never shows when the request finishes first, and goes away when it does", () => {
    const { rerender } = render(<Busy show text="Saving…" />);
    act(() => { vi.advanceTimersByTime(100); });
    rerender(<Busy show={false} text="Saving…" />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    rerender(<Busy show text="Saving…" />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    rerender(<Busy show={false} text="Saving…" />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("says so when a request takes unusually long", () => {
    render(<Busy show text="Loading…" />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/longer than usual/);
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.getByRole("alertdialog").textContent).toMatch(/longer than usual/);
  });
  it("does not take the keyboard focus (the quiz page watches for the student leaving it)", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    render(<Busy show text="Submitting…" />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});

describe("useBusy", () => {
  it("shows the label while the work runs, and clears it afterwards, also when it fails", async () => {
    vi.useRealTimers();
    let run, label;
    function Probe() { [label, run] = useBusy(); return null; }
    render(<Probe />);
    let release, work;
    act(() => { work = run("Saving the quiz…", () => new Promise((r) => { release = r; })); });
    expect(label).toBe("Saving the quiz…");
    await act(async () => { release("done"); await work; });
    expect(label).toBeNull();
    await act(async () => { await expect(run("x", async () => { throw new Error("no"); })).rejects.toThrow("no"); });
    expect(label).toBeNull();
  });
});
