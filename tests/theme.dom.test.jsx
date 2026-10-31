// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import App from "../src/App.jsx";

beforeEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

describe("theme toggle", () => {
  it("is on the page and switches the theme and remembers it", () => {
    render(<App />);
    const btn = screen.getByRole("button", { name: /dark theme/i });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
