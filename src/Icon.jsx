import React from "react";

/* Small inline SVG icon set (no external requests, so it works with the site's CSP).
   Icons are decorative by default: the visible text label stays the accessible name.
   Pass `label` for an icon that stands alone. */
const PATHS = {
  refresh: "M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5",
  logout: "M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9",
  summary: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  scores: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  scale: "M4 20h16M6 20V10M12 20V4M18 20v-7",
  grades: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7",
  import: "M12 3v12M7 10l5 5 5-5M4 20h16",
  download: "M12 3v12M7 10l5 5 5-5M4 20h16",
  settings: "M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6",
  print: "M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  key: "M14 10a4 4 0 1 0-3.9 4H12l1.5 1.5L15 14l1.5 1.5L18 14l-3-4M7.5 10h.01",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  back: "M10 6l-6 6 6 6M4 12h16",
  login: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M8 8l-4 4 4 4M4 12h11",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};

export default function Icon({ name, label, size = 16, className = "" }) {
  const d = PATHS[name];
  if (!d) return null;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true", focusable: "false" };
  return (
    <svg
      className={"icon " + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      <path d={d} />
    </svg>
  );
}
