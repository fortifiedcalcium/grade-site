// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/firebase.js", () => ({ isConfigured: true, getAuthInstance: () => ({}), getDb: () => ({}) }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth, cb) => { cb(null); return () => {}; },
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
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
