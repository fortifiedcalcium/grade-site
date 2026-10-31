// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/supabase.js", () => ({
  isConfigured: true,
  getDb: () => ({}),
  getAuth: () => ({
    onAuthStateChange: (cb) => { cb("INITIAL_SESSION", null); return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

beforeEach(() => {
  cleanup();
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

describe("instructor sign-in screen", () => {
  it("shows the sign-in form and the theme toggle", async () => {
    window.history.pushState({}, "", "/teacher");
    const App = (await import("../src/App.jsx")).default;
    render(<App />);
    expect(await screen.findByRole("heading", { name: /instructor sign in/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /dark theme/i })).toBeTruthy();
  });
});
