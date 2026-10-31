// The same security checks as rules.test.js, run against a rules simulator so no Java or emulator is needed.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import targaryen from "targaryen";

const rules = JSON.parse(readFileSync("database.rules.json", "utf8"));
const KEY = "0123456789abcdef0123456789abcdef";
const data = {
  admins: { teacher1: true },
  meta: { title: "ITE", salt: "abc" },
  sections: { s1: { name: "3H-G1" } },
  roster: { "2024100001": { name: "A", sec: "s1", pin: "ABC234", key: KEY } },
  records: { [KEY]: { id: "2024100001", name: "A", sec: "s1", s: { activities1: 90 } } },
};
const db = targaryen.database(rules, data);
const visitor = null;
const other = { uid: "someone-else" };
const teacher = { uid: "teacher1" };
const canRead = (who, path) => db.as(who).read(path).allowed;
const canWrite = (who, path, value) => db.as(who).write(path, value).allowed;

describe("a student (not signed in)", () => {
  it("can read the public page details and section layouts", () => {
    expect(canRead(visitor, "/meta")).toBe(true);
    expect(canRead(visitor, "/sections")).toBe(true);
  });
  it("can read one record when they know its key", () => {
    expect(canRead(visitor, "/records/" + KEY)).toBe(true);
  });
  it("cannot list records, read the roster (PINs) or read admins", () => {
    expect(canRead(visitor, "/records")).toBe(false);
    expect(canRead(visitor, "/roster")).toBe(false);
    expect(canRead(visitor, "/roster/2024100001")).toBe(false);
    expect(canRead(visitor, "/admins")).toBe(false);
    expect(canRead(visitor, "/admins/teacher1")).toBe(false);
    expect(canRead(visitor, "/")).toBe(false);
  });
  it("cannot change anything", () => {
    expect(canWrite(visitor, "/records/" + KEY + "/s/activities1", 100)).toBe(false);
    expect(canWrite(visitor, "/meta/title", "Hacked")).toBe(false);
    expect(canWrite(visitor, "/sections/s1/name", "Hacked")).toBe(false);
    expect(canWrite(visitor, "/roster/2024100001/pin", "ZZZZZZ")).toBe(false);
    expect(canWrite(visitor, "/admins/someone", true)).toBe(false);
    expect(canWrite(visitor, "/records/" + KEY, null)).toBe(false);
  });
});

describe("a signed-in user who is not a teacher", () => {
  it("has the same limits as a student", () => {
    expect(canRead(other, "/records/" + KEY)).toBe(true);
    expect(canRead(other, "/records")).toBe(false);
    expect(canRead(other, "/roster")).toBe(false);
    expect(canWrite(other, "/records/" + KEY + "/s/activities1", 100)).toBe(false);
  });
  it("cannot make themselves a teacher or read the admin list", () => {
    expect(canWrite(other, "/admins/someone-else", true)).toBe(false);
    expect(canRead(other, "/admins/teacher1")).toBe(false);
    expect(canRead(other, "/admins/someone-else")).toBe(true); // own entry only: tells them whether they are a teacher
  });
});

describe("the teacher", () => {
  it("can read everything they need", () => {
    expect(canRead(teacher, "/records")).toBe(true);
    expect(canRead(teacher, "/roster")).toBe(true);
    expect(canRead(teacher, "/admins/teacher1")).toBe(true);
  });
  it("can edit scores, page details, sections and the roster", () => {
    expect(canWrite(teacher, "/records/" + KEY + "/s/activities1", 95)).toBe(true);
    expect(canWrite(teacher, "/records/" + KEY + "/s/final1", "INC")).toBe(true);
    expect(canWrite(teacher, "/meta/title", "New title")).toBe(true);
    expect(canWrite(teacher, "/sections/s2", { name: "2A" })).toBe(true);
    expect(canWrite(teacher, "/roster/2024100002", { name: "B", sec: "s1", pin: "QWE789", key: "k2" })).toBe(true);
  });
  it("can add and remove a student record", () => {
    const k2 = "fedcba9876543210fedcba9876543210";
    expect(canWrite(teacher, "/records/" + k2, { id: "2024100002", name: "B", sec: "s1" })).toBe(true);
    expect(canWrite(teacher, "/records/" + KEY, null)).toBe(true);
  });
  it("cannot store malformed scores or records", () => {
    expect(canWrite(teacher, "/records/" + KEY + "/s/activities1", { nested: true })).toBe(false);
    expect(canWrite(teacher, "/records/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { name: "no id or section" })).toBe(false);
  });
});
