import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { firstName, buildMailMergeRows, mailMergeCsv, MAILMERGE_HEAD } from "../src/lib/mailmerge.js";

/* ---------------------------------------------------------------- the CSV the app exports */

describe("mail merge file from the app", () => {
  it("makes a friendly first name from 'LAST, FIRST M.'", () => {
    expect(firstName("DELA CRUZ, JUAN A.")).toBe("Juan A.");
    expect(firstName("PEÑA, MARIA ÑOR B.")).toBe("Maria Ñor B.");
    expect(firstName("O'BRIEN, MARY-ANN")).toBe("Mary-Ann");
    expect(firstName("SINGLE NAME")).toBe("Single Name");
    expect(firstName("")).toBe("");
  });
  it("has one row per student across all sections, with PIN, link and an empty Email", () => {
    const roster = {
      S2: { name: "REYES, BEN", sec: "b", pin: "BBB222" },
      S1: { name: "AQUINO, ANA", sec: "a", pin: "AAA111" },
      S3: { name: "ZARA, CY", sec: "a", pin: "CCC333" },
    };
    const sections = { a: { name: "BSIT 3-A" }, b: { name: "BSIT 3-B" } };
    const rows = buildMailMergeRows(roster, sections, "https://site.example");
    expect(rows).toEqual([
      ["", "S1", "AQUINO, ANA", "Ana", "BSIT 3-A", "AAA111", "https://site.example", ""],
      ["", "S3", "ZARA, CY", "Cy", "BSIT 3-A", "CCC333", "https://site.example", ""],
      ["", "S2", "REYES, BEN", "Ben", "BSIT 3-B", "BBB222", "https://site.example", ""],
    ]);
    const csv = mailMergeCsv(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split("\r\n")[0].slice(1)).toBe(MAILMERGE_HEAD.join(","));
    expect(csv.split("\r\n")).toHaveLength(4);
  });
  it("quotes names that contain commas", () => {
    const csv = mailMergeCsv(buildMailMergeRows({ S1: { name: "DELA CRUZ, JUAN", sec: "a", pin: "P" } }, { a: { name: "A" } }, "x"));
    expect(csv).toContain('"DELA CRUZ, JUAN"');
  });
});

/* ---------------------------------------------------------------- the Apps Script, run against a fake Google */

const SOURCE = fs.readFileSync(new URL("../mailmerge/Code.gs", import.meta.url), "utf8");
const HEAD = ["Email", "Student no.", "Name", "First name", "Section", "PIN", "Link", "Status"];
const absorb = () => new Proxy(function () {}, { get: () => absorb(), apply: () => absorb() });

class FakeSheet {
  constructor(name, values) { this.name = name; this.values = values.map((r) => [...r]); }
  getName() { return this.name; }
  getDataRange() {
    const width = Math.max(...this.values.map((r) => r.length));
    return { getValues: () => this.values.map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined ? "" : r[i]))) };
  }
  getRange(row, col, nr, nc) {
    const sheet = this;
    const set = (r, c, v) => { while (sheet.values.length < r) sheet.values.push([]); while (sheet.values[r - 1].length < c) sheet.values[r - 1].push(""); sheet.values[r - 1][c - 1] = v; };
    if (nr === undefined) return { setValue: (v) => set(row, col, v), getValue: () => (sheet.values[row - 1] || [])[col - 1] };
    return { setValues: (grid) => grid.forEach((line, i) => line.forEach((v, j) => set(row + i, col + j, v))), setFontWeight: absorb, setWrap: absorb, setVerticalAlignment: absorb };
  }
  setColumnWidth() {}
}

function makeEnv({ students, template, quota = 100, user = "teacher@gmail.com", answer = "YES", failFor = [] }) {
  const sent = [];
  const sheets = [new FakeSheet("Students", [HEAD, ...students])];
  if (template !== null) sheets.push(new FakeSheet("Template", template || defaultTemplate()));
  const ui = {
    alerts: [],
    ButtonSet: { YES_NO: "YES_NO", OK: "OK" },
    Button: { YES: "YES", NO: "NO" },
    alert(...args) { this.alerts.push(args); return args.includes("YES_NO") ? answer : undefined; },
    createMenu: () => absorb(),
  };
  const ss = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    getSheets: () => sheets,
    insertSheet: (n) => { const s = new FakeSheet(n, [[]]); sheets.push(s); return s; },
  };
  const sandbox = {
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ss, flush() {} },
    GmailApp: { sendEmail: (to, subject, body, options) => { if (failFor.includes(to)) throw new Error("Address rejected"); sent.push({ to, subject, body, options }); } },
    MailApp: { getRemainingDailyQuota: () => quota - sent.length },
    Utilities: { formatDate: () => "2026-10-31 10:00" },
    Session: { getScriptTimeZone: () => "UTC", getActiveUser: () => ({ getEmail: () => user }), getEffectiveUser: () => ({ getEmail: () => user }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { sandbox, sent, ui, ss, students: sheets[0], template: sheets.find((s) => s.name === "Template") };
}

const defaultTemplate = (over = {}) => [
  ["Subject", over.subject ?? "PIN for {{Section}}"],
  ["Sender name", over.sender ?? "CICT Grade Portal"],
  ["Reply-to email", over.replyTo ?? "teacher@gmail.com"],
  ["Email pattern", over.pattern ?? ""],
  ["Only send to section", over.section ?? ""],
  ["Message", over.body ?? "Hi {{First name}},\nStudent number: {{Student no.}}\nPIN: {{PIN}}\n{{Link}}"],
];
const student = (n, o = {}) => [o.email ?? `s${n}@mail.test`, "2026-0000" + n, o.name ?? `LAST${n}, FIRST${n}`, o.first ?? `First${n}`, o.section ?? "A", o.pin ?? "PIN" + n + "XYZ", "https://site.example", o.status ?? ""];
const statusOf = (env, row) => env.students.values[row - 1][7];

describe("template helpers", () => {
  const { sandbox: g } = makeEnv({ students: [] });
  it("fills {{placeholders}} case-insensitively and leaves other text alone", () => {
    expect(g.renderTemplate_("Hi {{First name}}! PIN {{ pin }}", { "first name": "Juan", pin: "ABC" }, false)).toBe("Hi Juan! PIN ABC");
  });
  it("in the HTML version, a name with & < > cannot break the email, and the PIN is bold", () => {
    const html = g.buildHtmlBody_("Hi {{Name}}\nPIN: {{PIN}}\nhttps://site.example/x?a=1&b=2", { name: "O'Neil & <Sons>", pin: "AB12" });
    expect(html).toContain("O'Neil &amp; &lt;Sons&gt;");
    expect(html).not.toContain("<Sons>");
    expect(html).toMatch(/<b[^>]*>AB12<\/b>/);
    expect(html).toContain("<br>");
    expect(html).toContain('<a href="https://site.example/x?a=1&amp;b=2">');
    expect(html).toContain("font-family:Arial");
  });
  it("recognises valid emails and builds one from the pattern when the cell is blank", () => {
    expect(g.isValidEmail_("juan@bulsu.edu.ph")).toBe(true);
    expect(g.isValidEmail_("juan@bulsu")).toBe(false);
    expect(g.isValidEmail_("a@b.co, c@d.co")).toBe(false);
    expect(g.isValidEmail_("")).toBe(false);
    expect(g.emailFor_("", "2026-00123", "{id}@school.edu")).toBe("2026-00123@school.edu");
    expect(g.emailFor_("real@x.com", "2026-1", "{id}@school.edu")).toBe("real@x.com");
    expect(g.emailFor_("", "2026-1", "")).toBe("");
  });
  it("finds placeholders that do not match a column", () => {
    expect(g.unknownPlaceholders_("{{PIN}} {{Nickname}} {{nickname}}", ["PIN", "Name"])).toEqual(["Nickname"]);
    expect(g.unknownPlaceholders_("{{pin}} {{NAME}}", ["PIN", "Name"])).toEqual([]);
  });
});

describe("sending", () => {
  it("emails each ready student once, with their own PIN, and marks them Sent", () => {
    const env = makeEnv({ students: [student(1), student(2)] });
    env.sandbox.sendAll();
    expect(env.sent.map((m) => m.to)).toEqual(["s1@mail.test", "s2@mail.test"]);
    expect(env.sent[0].subject).toBe("PIN for A");
    expect(env.sent[0].body).toContain("PIN: PIN1XYZ");
    expect(env.sent[0].body).not.toContain("PIN2XYZ");
    expect(env.sent[0].options).toMatchObject({ name: "CICT Grade Portal", replyTo: "teacher@gmail.com" });
    expect(env.sent[0].options.htmlBody).toContain("PIN1XYZ");
    expect(statusOf(env, 2)).toMatch(/^Sent 2026-10-31/);
  });
  it("never sends twice: a second run sends nothing", () => {
    const env = makeEnv({ students: [student(1), student(2)] });
    env.sandbox.sendAll();
    env.sandbox.sendAll();
    expect(env.sent).toHaveLength(2);
  });
  it("skips rows already Sent, with no valid email, or with no PIN, and says why", () => {
    const env = makeEnv({ students: [student(1, { status: "Sent 2026-10-30" }), student(2, { email: "" }), student(3, { email: "not-an-email" }), student(4, { pin: "" }), student(5)] });
    env.sandbox.sendAll();
    expect(env.sent.map((m) => m.to)).toEqual(["s5@mail.test"]);
    expect(statusOf(env, 2)).toBe("Sent 2026-10-30");
    expect(statusOf(env, 3)).toBe("Skipped: no valid email");
    expect(statusOf(env, 4)).toBe("Skipped: no valid email");
    expect(statusOf(env, 5)).toBe("Skipped: no PIN");
  });
  it("builds the address from the pattern when the Email cell is blank", () => {
    const env = makeEnv({ students: [student(1, { email: "" })], template: defaultTemplate({ pattern: "{id}@school.edu" }) });
    env.sandbox.sendAll();
    expect(env.sent.map((m) => m.to)).toEqual(["2026-00001@school.edu"]);
  });
  it("only sends to the chosen section when one is set", () => {
    const env = makeEnv({ students: [student(1, { section: "A" }), student(2, { section: "B" }), student(3, { section: "b" })], template: defaultTemplate({ section: "B" }) });
    env.sandbox.sendAll();
    expect(env.sent.map((m) => m.to)).toEqual(["s2@mail.test", "s3@mail.test"]);
  });
  it("stops at the daily limit and finishes the rest on the next run", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => student(n));
    const env = makeEnv({ students: rows, quota: 3 });
    env.sandbox.sendAll();
    expect(env.sent).toHaveLength(3);
    expect(statusOf(env, 4)).toMatch(/^Sent/);   // student 3 (row 4) was the last one allowed today
    expect(statusOf(env, 5)).toBe("");           // students 4 and 5 are still waiting
    expect(statusOf(env, 6)).toBe("");
    expect(env.ui.alerts.at(-1)[1]).toMatch(/Stopped at the daily email limit.*2 student/s);
    // next day: a fresh limit, and the first three are skipped because they are marked Sent
    const sentBefore = env.sent.length;
    env.sandbox.MailApp.getRemainingDailyQuota = () => 100;
    env.sandbox.sendAll();
    expect(env.sent.slice(sentBefore).map((m) => m.to)).toEqual(["s4@mail.test", "s5@mail.test"]);
  });
  it("records an error against the student and keeps going", () => {
    const env = makeEnv({ students: [student(1), student(2), student(3)], failFor: ["s2@mail.test"] });
    env.sandbox.sendAll();
    expect(env.sent.map((m) => m.to)).toEqual(["s1@mail.test", "s3@mail.test"]);
    expect(statusOf(env, 3)).toBe("Error: Address rejected");
  });
  it("sends nothing if the message uses a placeholder with no matching column", () => {
    const env = makeEnv({ students: [student(1)], template: defaultTemplate({ body: "Hi {{Nickname}} {{PIN}}" }) });
    env.sandbox.sendAll();
    expect(env.sent).toHaveLength(0);
    expect(env.ui.alerts.at(-1)[1]).toContain("{{Nickname}}");
    expect(statusOf(env, 2)).toBe("");
  });
  it("sends nothing and marks nothing if you answer No", () => {
    const env = makeEnv({ students: [student(1)], answer: "NO" });
    env.sandbox.sendAll();
    expect(env.sent).toHaveLength(0);
    expect(statusOf(env, 2)).toBe("");
  });
  it("creates the Template sheet and sends nothing when it is missing", () => {
    const env = makeEnv({ students: [student(1)], template: null });
    env.sandbox.sendAll();
    expect(env.sent).toHaveLength(0);
    expect(env.ss.getSheetByName("Template")).toBeTruthy();
    expect(env.ss.getSheetByName("Template").values[0][0]).toBe("Subject");
  });
  it("complains about a missing column instead of guessing", () => {
    const env = makeEnv({ students: [] });
    env.students.values[0] = ["Email", "Name", "Status"];   // no Student no. / PIN
    env.sandbox.sendAll();
    expect(env.sent).toHaveLength(0);
    expect(env.ui.alerts.at(-1)[0]).toMatch(/needs a column called "Student no\."/);
  });
});

describe("test email", () => {
  it("goes to the teacher, is labelled [TEST], and marks nobody as Sent", () => {
    const env = makeEnv({ students: [student(1), student(2)], user: "me@gmail.com" });
    env.sandbox.sendTest();
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0].to).toBe("me@gmail.com");
    expect(env.sent[0].subject).toBe("[TEST] PIN for A");
    expect(env.sent[0].body).toContain("PIN: PIN1XYZ");
    expect(statusOf(env, 2)).toBe("");
  });
});
