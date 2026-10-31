// Security rules: run with `npm run test:rules` (starts the Firebase Realtime Database emulator, needs Java).
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { ref, get, set, update, remove } from "firebase/database";

const KEY = "0123456789abcdef0123456789abcdef";
let env;

beforeAll(async () => {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000").split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-grade-portal",
    database: { rules: readFileSync("database.rules.json", "utf8"), host, port: Number(port) },
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, "admins/teacher1"), true);
    await set(ref(db, "meta"), { title: "ITE", salt: "abc" });
    await set(ref(db, "sections/s1"), { name: "3H-G1" });
    await set(ref(db, "roster/2024100001"), { name: "A", sec: "s1", pin: "ABC234", key: KEY });
    await set(ref(db, "records/" + KEY), { id: "2024100001", name: "A", sec: "s1", s: { activities1: 90 } });
  });
});

const visitor = () => env.unauthenticatedContext().database();
const otherUser = () => env.authenticatedContext("someone-else").database();
const teacher = () => env.authenticatedContext("teacher1").database();

describe("a student (not signed in)", () => {
  it("can read the public page details and section layouts", async () => {
    await assertSucceeds(get(ref(visitor(), "meta")));
    await assertSucceeds(get(ref(visitor(), "sections")));
  });
  it("can read one record when they know its key", async () => {
    await assertSucceeds(get(ref(visitor(), "records/" + KEY)));
  });
  it("cannot list records, read the roster (PINs) or read admins", async () => {
    await assertFails(get(ref(visitor(), "records")));
    await assertFails(get(ref(visitor(), "roster")));
    await assertFails(get(ref(visitor(), "roster/2024100001")));
    await assertFails(get(ref(visitor(), "admins")));
    await assertFails(get(ref(visitor(), "admins/teacher1")));
  });
  it("cannot read the database root", async () => {
    await assertFails(get(ref(visitor(), "/")));
  });
  it("cannot change anything", async () => {
    await assertFails(set(ref(visitor(), "records/" + KEY + "/s/activities1"), 100));
    await assertFails(set(ref(visitor(), "meta/title"), "Hacked"));
    await assertFails(set(ref(visitor(), "sections/s1/name"), "Hacked"));
    await assertFails(set(ref(visitor(), "roster/2024100001/pin"), "ZZZZZZ"));
    await assertFails(set(ref(visitor(), "admins/someone"), true));
    await assertFails(remove(ref(visitor(), "records/" + KEY)));
  });
});

describe("a signed-in user who is not a teacher", () => {
  it("has the same limits as a student", async () => {
    await assertSucceeds(get(ref(otherUser(), "records/" + KEY)));
    await assertFails(get(ref(otherUser(), "records")));
    await assertFails(get(ref(otherUser(), "roster")));
    await assertFails(set(ref(otherUser(), "records/" + KEY + "/s/activities1"), 100));
  });
  it("cannot make themselves a teacher", async () => {
    await assertFails(set(ref(otherUser(), "admins/someone-else"), true));
    await assertFails(get(ref(otherUser(), "admins/teacher1")));
  });
});

describe("the teacher", () => {
  it("can read everything they need", async () => {
    await assertSucceeds(get(ref(teacher(), "records")));
    await assertSucceeds(get(ref(teacher(), "roster")));
    await assertSucceeds(get(ref(teacher(), "admins/teacher1")));
  });
  it("can edit scores, page details, sections and the roster", async () => {
    await assertSucceeds(set(ref(teacher(), "records/" + KEY + "/s/activities1"), 95));
    await assertSucceeds(set(ref(teacher(), "records/" + KEY + "/s/final1"), "INC"));
    await assertSucceeds(update(ref(teacher(), "meta"), { title: "New title" }));
    await assertSucceeds(set(ref(teacher(), "sections/s2"), { name: "2A" }));
    await assertSucceeds(set(ref(teacher(), "roster/2024100002"), { name: "B", sec: "s1", pin: "QWE789", key: "k2" }));
  });
  it("can add and remove a student record", async () => {
    const k2 = "fedcba9876543210fedcba9876543210";
    await assertSucceeds(set(ref(teacher(), "records/" + k2), { id: "2024100002", name: "B", sec: "s1" }));
    await assertSucceeds(remove(ref(teacher(), "records/" + k2)));
  });
  it("cannot store malformed scores or records", async () => {
    await assertFails(set(ref(teacher(), "records/" + KEY + "/s/activities1"), { nested: true }));
    await assertFails(set(ref(teacher(), "records/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), { name: "no id or section" }));
  });
});
