import { firstName } from "./mailmerge.js";

/* Emailing PINs from the app (the Edge Function in supabase/functions/send-pins does the sending).
   Everything here is plain functions so it can be tested without a browser or a mail provider. */

export const DEFAULT_TEMPLATE = {
  subject: "Your grade portal PIN ({{Section}})",
  sender: "Grade Portal",
  replyTo: "",
  pattern: "",
  body:
    "Hi {{First name}},\n\n" +
    "You can now check your grades online.\n\n" +
    "Website: {{Link}}\n" +
    "Student number: {{Student no.}}\n" +
    "PIN: {{PIN}}\n\n" +
    "Sign in with your student number and this PIN. Your PIN is private: please do not share it with anyone. " +
    "If you lose it, reply to this email and I will issue a new one.\n\n" +
    "Regards,\nYour instructor",
};

export const PLACEHOLDERS = ["First name", "Name", "Student no.", "Section", "PIN", "Link"];
export const MAX_BATCH = 25;

export const isValidEmail = (s) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(String(s == null ? "" : s).trim()) && String(s).trim().length <= 254;

/* the stored email, or the pattern with {id} = student number in lowercase ("{id}@school.edu.ph") */
export function emailFor(email, studentId, pattern) {
  if (isValidEmail(email)) return String(email).trim();
  const id = String(studentId || "").trim().toLowerCase();
  if (pattern && id) {
    const built = String(pattern).replace(/\{id\}/gi, id);
    if (isValidEmail(built)) return built;
  }
  return "";
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function valuesFor(id, r, sections, link) {
  const sec = (sections && sections[r.sec] && sections[r.sec].name) || r.sec;
  return { "first name": firstName(r.name), name: r.name, "student no.": id, section: sec, pin: r.pin, link };
}

export const unknownPlaceholders = (text, values) =>
  [...new Set([...String(text).matchAll(TOKEN)].map((m) => m[1].trim()).filter((n) => !Object.prototype.hasOwnProperty.call(values, n.toLowerCase())))];

export const renderText = (text, values) => String(text).replace(TOKEN, (_, n) => String(values[n.trim().toLowerCase()] ?? ""));

/* values are escaped (a name with & or < cannot break the email) and the PIN is shown in bold */
export function renderHtml(text, values) {
  const html = esc(text)
    .replace(TOKEN, (_, n) => {
      const key = n.trim().toLowerCase();
      const v = esc(values[key] ?? "");
      return key === "pin" ? '<b style="font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:2px;">' + v + "</b>" : v;
    })
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, "<br>");
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;">' + html + "</div>";
}

export function renderMessage(template, id, r, sections, link, to) {
  const values = valuesFor(id, r, sections, link);
  return { id, to, subject: renderText(template.subject, values), text: renderText(template.body, values), html: renderHtml(template.body, values) };
}

/* ids: the students to email (in order). Students with no usable email or no PIN are skipped with a reason.
   unknown: {{placeholders}} that match nothing; the caller should refuse to send when this is not empty. */
export function buildPlan({ roster, sections, ids, template, link, onlyUnsent }) {
  const ready = [], skipped = [];
  const probe = valuesFor("", { name: "", sec: "", pin: "" }, {}, link);
  const unknown = [...new Set([...unknownPlaceholders(template.subject, probe), ...unknownPlaceholders(template.body, probe)])];
  for (const id of ids) {
    const r = roster[id];
    if (!r) continue;
    if (onlyUnsent && r.emailed) { skipped.push({ id, name: r.name, reason: "already emailed" }); continue; }
    const to = emailFor(r.email, id, template.pattern);
    if (!to) { skipped.push({ id, name: r.name, reason: "no valid email" }); continue; }
    if (!String(r.pin || "").trim()) { skipped.push({ id, name: r.name, reason: "no PIN" }); continue; }
    ready.push(renderMessage(template, id, r, sections, link, to));
  }
  return { ready, skipped, unknown };
}

/* Reads a CSV the teacher pasted or uploaded. With a header row it finds "Student no." and "Email"
   columns (and a "Status" column starting with "Sent" marks that student as already emailed); without one the first column is the student number and the second the email. */
export function parseEmailCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const src = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((x) => x.trim().toLowerCase());
  let idCol = head.findIndex((h) => /^(student\s*(no\.?|number|id)|id)$/.test(h));
  let emailCol = head.findIndex((h) => /e-?mail/.test(h));
  let start = 1;
  if (idCol < 0 || emailCol < 0) { idCol = 0; emailCol = 1; start = isValidEmail(rows[0][1]) ? 0 : 1; }
  const statusCol = start === 1 ? head.findIndex((h) => h === "status") : -1;
  return rows.slice(start).map((r) => ({
    id: String(r[idCol] || "").trim(),
    email: String(r[emailCol] || "").trim(),
    sent: statusCol >= 0 && /^sent/i.test(String(r[statusCol] || "").trim()), // the old Gmail mail merge marks "Sent ..."
  })).filter((x) => x.id);
}
