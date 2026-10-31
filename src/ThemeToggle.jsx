import React, { useState } from "react";
import { applyTheme, getTheme, saveTheme } from "./lib/theme.js";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(getTheme);
  const dark = theme === "dark";
  const toggle = () => {
    const next = dark ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  };
  return (
    <button type="button" className="btn theme-toggle noprint" onClick={toggle} aria-pressed={dark} aria-label="Dark theme">
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span> {dark ? "Light" : "Dark"}
    </button>
  );
}
