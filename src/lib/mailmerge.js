import { csvCell } from "./util.js";

/* The file that feeds the Gmail mail merge (see mailmerge/README.md): one row per student with the PIN,
   the sign-in link and an empty Email column to fill in. Student emails are deliberately not kept in the
   grade website's database; they live in the instructor's own Google Sheet. */

export const MAILMERGE_HEAD = ["Email", "Student no.", "Name", "First name", "Section", "PIN", "Link", "Status"];

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

/* "DELA CRUZ, JUAN A." -> "Juan A."; a name without a comma is used as it is */
export function firstName(name) {
  const s = String(name || "").trim();
  const i = s.indexOf(",");
  const given = i >= 0 ? s.slice(i + 1).trim() : s;
  return titleCase(given || s);
}

/* roster: { studentId: { name, sec, pin } }, sections: { id: { name } }; sorted by section, then name */
export function buildMailMergeRows(roster, sections, link) {
  const secName = (id) => (sections[id] && sections[id].name) || id;
  return Object.entries(roster)
    .map(([id, r]) => ({ id, r, sec: secName(r.sec) }))
    .sort((a, b) => a.sec.localeCompare(b.sec) || a.r.name.localeCompare(b.r.name))
    .map(({ id, r, sec }) => ["", id, r.name, firstName(r.name), sec, r.pin, link, ""]);
}

// the byte order mark keeps names with accents (Ñ) intact when the file is opened in Google Sheets or Excel
export const mailMergeCsv = (rows) => "﻿" + [MAILMERGE_HEAD, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
