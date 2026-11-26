/* All reads and writes to the Supabase (Postgres) database. The tables and the access rules are in
   supabase/schema.sql.

   Data layout (each fact is stored once)
     meta           page title, term, note, secret salt                     (anyone can read)
     subjects       code + description                                       (anyone can read)
     sections       one class: name, semester, subject, grading scheme       (anyone can read)
     students       student number + name + email                            (instructors only)
     enrollments    one student in one section: PIN, secret key, scores      (instructors only; a student can fetch ONE
                    by its key, nobody can list them)
     admins         user ids of instructor accounts                          (added by hand in the SQL editor)

   The screens work with plain objects shaped like the old roster / records / sections tables (maps keyed by id), so the
   rows of the joined tables are converted on the way in. Times are milliseconds since 1970. */

import { recordKey, makePin, makeSalt, safeId, normId, studentNo, taggedRowId } from "./keys.js";
import { DEFAULT_SCALE, DEFAULT_SCALE_NOTE } from "./grading.js";
import { LEGACY_TERM, scopeToTerm, termOf, termsOf } from "./terms.js";

const clean = (obj) => JSON.parse(JSON.stringify(obj)); // drops undefined

export function withTimeout(promise, ms = 20000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

const ms = (t) => (t ? Date.parse(t) : null);
const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const toMeta = (r) => (r ? { title: r.title, term: r.term, note: r.note, salt: r.salt, updated: ms(r.updated) } : null);
/* A sections row (with its subject joined in) -> the object the screens use. An empty semester stays out, so the section counts as the first one. */
export const SECTION_SELECT = "*, subjects(description)";
export const toSection = (r) => ({
  name: r.name,
  ...(r.term ? { term: r.term } : {}),
  headings: r.headings || [],
  subject: { code: r.subject_code || "", desc: (r.subjects && r.subjects.description) || "" },
  instructor: r.instructor || "",
  roomTime: r.room_time || "",
  scheme: r.scheme && Object.keys(r.scheme).length ? r.scheme : undefined,
});
const toSections = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, toSection(r)]));

/* ---------------------------- student side ---------------------------- */

export const KEYS_PER_REQUEST = 50;   // the same limit as get_records in supabase/schema.sql

export function createStudentApi(db) {
  const fetchPublic = async () => {
    const [m, s] = await Promise.all([
      db.from("meta").select("*").eq("id", 1).maybeSingle(),
      db.from("sections").select(SECTION_SELECT),
    ]);
    return { meta: toMeta(unwrap(m)), sections: toSections(unwrap(s)) };
  };

  const fetchRecord = async (key) => {
    const record = unwrap(await db.rpc("get_record", { p_key: key }));
    if (!record) throw Object.assign(new Error("no match"), { code: "nomatch" });
    return record;
  };

  /* get_records looks at no more than 50 keys per request (it ignores the rest), and sign-in has one key per section plus one,
     so they go in groups of 50. If any group fails, the sign-in fails: a partial answer could hide one of the student's classes. */
  const fetchRecords = async (keys) => {
    const groups = [];
    for (let i = 0; i < keys.length; i += KEYS_PER_REQUEST) groups.push(keys.slice(i, i + KEYS_PER_REQUEST));
    const answers = await Promise.all(groups.map(async (group) => unwrap(await db.rpc("get_records", { p_keys: group })) || []));
    // the order one request would have given (name, then section), so the class shown first does not depend on the grouping
    return answers.flat().sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.sec).localeCompare(String(b.sec)));
  };

  return {
    loadMeta: () => withTimeout(fetchPublic().then((x) => x.meta)),

    /* A student can be in several sections, each with its own record: try the plain student number and the
       section-tagged one for every section, and return every record that matches (the first is shown). */
    login: (idInput, pinInput) =>
      withTimeout(
        (async () => {
          const { meta, sections } = await fetchPublic();
          if (!meta || !meta.salt) throw Object.assign(new Error("not published"), { code: "notpublished" });
          const no = normId(idInput);
          const ids = [no, ...Object.keys(sections).map((secId) => taggedRowId(no, secId))];
          const keys = await Promise.all(ids.map((id) => recordKey(meta.salt, id, pinInput)));
          const found = await fetchRecords(keys);
          if (!found.length) throw Object.assign(new Error("no match"), { code: "nomatch" });
          const entries = found.map((rec) => ({ key: rec.key, record: rec, section: sections[rec.sec] || null }));
          return { ...entries[0], meta, others: entries };
        })()
      ),

    /* Marks the grade as acknowledged. Resolves to the time in ms; rejects if the key matches nothing. */
    acknowledge: (key) =>
      withTimeout(
        (async () => {
          const at = unwrap(await db.rpc("acknowledge_grade", { p_key: key }));
          if (!at) throw Object.assign(new Error("no match"), { code: "nomatch" });
          return at;
        })()
      ),

    /* Quizzes: the list has no questions. start() returns them without answers and starts the server's clock;
       submit() is scored on the server. event() reports something suspicious the page noticed. */
    quizzes: (key) => withTimeout(Promise.resolve(db.rpc("get_quizzes", { p_key: key })).then((r) => unwrap(r) || [])),
    startQuiz: (key, quizId) => withTimeout(Promise.resolve(db.rpc("start_quiz", { p_key: key, p_quiz: quizId })).then(unwrap)),
    submitQuiz: (key, quizId, answers) => withTimeout(Promise.resolve(db.rpc("submit_quiz", { p_key: key, p_quiz: quizId, p_answers: answers })).then(unwrap)),
    /* Saves the answers of an open attempt. Resolves to the newest revision stored, or null when the attempt is closed. */
    saveQuizDraft: (key, quizId, answers, rev) => withTimeout(Promise.resolve(db.rpc("save_quiz_answers", { p_key: key, p_quiz: quizId, p_answers: answers, p_rev: rev })).then(unwrap), 10000),
    reviewQuiz: (key, quizId) => withTimeout(Promise.resolve(db.rpc("quiz_review", { p_key: key, p_quiz: quizId })).then(unwrap)),
    quizEvent: (key, quizId, type) => Promise.resolve(db.rpc("log_quiz_event", { p_key: key, p_quiz: quizId, p_type: type })).then(unwrap).catch(() => null),

    refresh: (key) =>
      withTimeout(
        (async () => {
          const { meta, sections } = await fetchPublic();
          const record = await fetchRecord(key);
          return { key, meta, record, section: sections[record.sec] || null };
        })()
      ),
  };
}

/* ---------------------------- teacher side ---------------------------- */

/* `reload` sources join several tables, so a realtime event cannot be patched into the copy in memory: the rows it names are
   read again instead (`scope` is the column that names them), or the whole table when the event does not say. `also` lists
   other tables whose changes matter too. */
const enrollmentSelect = "*, students(name, email)";
const nameOf = (r) => (r.students && r.students.name) || "";
const SOURCES = {
  meta: { table: "meta", pk: "id", shape: (rows) => toMeta([...rows.values()][0]) },
  // the owner (an instructor's user id) rides along so the screens can show only the signed-in instructor's sections
  sections: {
    table: "sections", select: SECTION_SELECT, also: ["subjects"], reload: true, pk: "id", scope: "id",
    shape: (rows) => Object.fromEntries([...rows.values()].map((r) => [r.id, { ...toSection(r), owner: r.owner || null }])),
  },
  roster: {
    table: "enrollments", select: enrollmentSelect, also: ["students"], reload: true, pk: "login_id", scope: "login_id",
    shape: (rows) => Object.fromEntries([...rows.values()].map((r) => [r.login_id, { name: nameOf(r), sec: r.sec, pin: r.pin, key: r.key, email: (r.students && r.students.email) || "", emailed: ms(r.emailed) }])),
  },
  records: {
    table: "enrollments", select: enrollmentSelect, also: ["students"], reload: true, pk: "key", scope: "key",
    shape: (rows) => Object.fromEntries([...rows.values()].map((r) => [r.key, { id: r.login_id, name: nameOf(r), sec: r.sec, s: r.scores || {}, updated: ms(r.updated), ack: ms(r.acknowledged) }])),
  },
};

SOURCES.quizzes = {
  table: "quizzes", pk: "id",
  shape: (rows) => Object.fromEntries([...rows.values()].map((r) => [r.id, {
    sec: r.sec, title: r.title, itemKey: r.item_key || "", itemMax: r.item_max == null ? null : Number(r.item_max), questions: r.questions || [],
    published: Boolean(r.published), timeLimit: r.time_limit, shuffle: r.shuffle !== false, lockdown: r.lockdown !== false,
    maxViolations: r.max_violations || 3, showAnswers: Boolean(r.show_answers), hasShowAnswers: "show_answers" in r, updated: ms(r.updated),
  }])),
};
SOURCES.attempts = {
  table: "quiz_attempts", select: "*, enrollments(login_id, students(name))", reload: true, pk: ["quiz_id", "key"], scope: "quiz_id",
  shape: (rows) => Object.fromEntries([...rows.values()].map((r) => [r.quiz_id + "|" + r.key, {
    quizId: r.quiz_id, key: r.key, id: (r.enrollments && r.enrollments.login_id) || "", name: (r.enrollments && r.enrollments.students && r.enrollments.students.name) || "", started: ms(r.started), submitted: ms(r.submitted),
    points: r.points == null ? null : Number(r.points), total: r.total == null ? null : Number(r.total),
    violations: r.violations || 0, events: r.events || [], late: Boolean(r.late), answers: r.answers || null,
  }])),
};

const POLL_MS = 30000;
const REFRESH_MS = 200;      // events that arrive within this time are one read
const MAX_SCOPED = 50;       // more changed rows than this and the whole table is read instead

/* Calls onValueCb with the whole table now and again whenever it changes. Realtime events patch the copy in memory. For tables
   joined with others, only the rows an event names are read again (never the whole table for one student's change), and events
   arriving close together share one read. The reads run one at a time, so a late answer cannot overwrite a newer one. A slow
   refresh is a safety net in case realtime is off or the connection drops; it is skipped while the page is in the background.
   Returns a function that stops listening. */
export function listen(db, path, onValueCb, onError) {
  const src = SOURCES[path];
  let rows = new Map();
  let alive = true;
  let timer = null;
  let running = false;
  let full = true;                 // the first read is of the whole table
  let pending = new Set();         // values of src.scope whose rows must be read again
  const pkOf = (r) => (Array.isArray(src.pk) ? src.pk.map((c) => r[c]).join("|") : r[src.pk]);
  const emit = () => alive && onValueCb(src.shape(rows));

  const readAll = async () => {
    const { data, error } = await db.from(src.table).select(src.select || "*");
    if (error) throw error;
    rows = new Map(data.map((r) => [pkOf(r), r]));
  };
  const readScoped = async (values) => {
    const { data, error } = await db.from(src.table).select(src.select || "*").in(src.scope, values);
    if (error) throw error;
    const gone = new Set(values);
    for (const [k, r] of rows) if (gone.has(r[src.scope])) rows.delete(k);
    for (const r of data) rows.set(pkOf(r), r);
  };

  const flush = async () => {
    if (running) return;           // the loop below picks up what arrived meanwhile
    running = true;
    try {
      while (alive && (full || pending.size)) {
        const values = [...pending];
        pending = new Set();
        try {
          if (full || values.length > MAX_SCOPED) { full = false; await readAll(); }
          else await readScoped(values);
        } catch (error) {
          full = true;             // whatever was lost is picked up by the next refresh
          if (alive && onError) onError(error);
          break;
        }
        emit();
      }
    } finally { running = false; }
  };
  const soon = () => { if (!timer && alive) timer = setTimeout(() => { timer = null; flush(); }, REFRESH_MS); };   // not reset by later events, so a steady stream still gets read
  const changed = (row) => {
    const v = row && src.scope ? row[src.scope] : undefined;
    if (v === undefined || v === null) full = true; else pending.add(v);
    soon();
  };

  let channel = db.channel("rt-" + path + "-" + Math.random().toString(36).slice(2));
  channel = channel.on("postgres_changes", { event: "*", schema: "public", table: src.table }, (p) => {
    if (src.reload) return changed(p.eventType === "DELETE" ? p.old : p.new);
    if (p.eventType === "DELETE") rows.delete(pkOf(p.old));
    else rows.set(pkOf(p.new), p.new);
    emit();
  });
  (src.also || []).forEach((table) => { channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => { full = true; soon(); }); });
  channel.subscribe((status) => { if (status === "SUBSCRIBED") { full = true; soon(); } });

  flush();
  const poll = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    full = true;
    flush();
  }, POLL_MS);
  return () => {
    alive = false;
    clearInterval(poll);
    clearTimeout(timer);
    db.removeChannel(channel);
  };
}

export async function isTeacher(db, user) {
  const row = unwrap(await withTimeout(db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle(), 15000));
  return Boolean(row);
}

export async function saveScore(db, key, itemKey, value) {
  unwrap(await db.rpc("set_score", { p_key: key, p_item: itemKey, p_value: value === undefined ? null : value }));
}

export async function ensureSalt(db, meta) {
  if (meta && meta.salt) return meta.salt;
  const salt = makeSalt();
  unwrap(await db.from("meta").upsert({ id: 1, salt }));
  return salt;
}

export async function saveMeta(db, { title, term, note }) {
  unwrap(await db.from("meta").upsert({ id: 1, title: title || "", term: term || "", note: note || "", updated: new Date().toISOString() }));
}

/* The fields the save_sections function stores (the section's own columns, its subject and its grading scheme). */
const sectionRow = (id, section) => {
  const { count, owner, ...rest } = section; // eslint-disable-line no-unused-vars
  return clean({ id, ...rest });
};

export async function saveSection(db, id, section) {
  unwrap(await db.rpc("save_sections", { p_rows: [sectionRow(id, section)] }));
}

/* Settings the teacher edited in the app win over what the workbook says. */
export function mergeSection(existing, incoming) {
  if (!existing) return incoming;
  const exCats = new Map(((existing.scheme && existing.scheme.categories) || []).map((c) => [c.id, c]));
  return {
    ...incoming,
    name: existing.name || incoming.name,
    headings: existing.headings && existing.headings.length ? existing.headings : incoming.headings,
    subject: {
      code: (existing.subject && existing.subject.code) || incoming.subject.code,
      desc: (existing.subject && existing.subject.desc) || incoming.subject.desc,
    },
    term: existing.term || incoming.term,
    instructor: existing.instructor || incoming.instructor,
    roomTime: existing.roomTime || incoming.roomTime,
    scheme: {
      ...incoming.scheme,
      passEquiv: existing.scheme && existing.scheme.passEquiv != null ? existing.scheme.passEquiv : incoming.scheme.passEquiv,
      holdFinal: existing.scheme && existing.scheme.holdFinal != null ? existing.scheme.holdFinal : incoming.scheme.holdFinal,
      scale: (existing.scheme && existing.scheme.scale) || incoming.scheme.scale,
      scaleNote: (existing.scheme && existing.scheme.scaleNote) || incoming.scheme.scaleNote,
      categories: incoming.scheme.categories.map((c) => {
        const e = exCats.get(c.id);
        if (!e) return c;
        const exItems = new Map((e.items || []).map((i) => [i.k, i]));
        return {
          ...c,
          title: e.title,
          weight: e.weight,
          items: c.items.map((i) => {
            const ei = exItems.get(i.k);
            return ei ? { ...i, label: ei.label, max: ei.max } : i;
          }),
        };
      }),
    },
  };
}

const slugId = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/* A new section gets the columns of the BulSU class record template (the "Lecture" sheet): Activities 1-6, Quizzes 1-4,
   Project, Attendance, and a Midterm and a Final exam, each out of 100. The weights are 20 / 20 / 20 / 10 / 30 (the term exam's
   30 is split 15 + 15, as the importer does), and the grade stays "pending" until the final exam is recorded.
   Edit the columns of a section in Settings. */
export function blankScheme() {
  const cat = (id, title, weight, labels) => ({ id, title, weight, items: labels.map((label, i) => ({ k: id + (i + 1), label, max: 100 })) });
  const numbered = (word, n) => Array.from({ length: n }, (_, i) => word + " " + (i + 1));
  return {
    categories: [
      cat("activities", "Activities", 20, numbered("Activity", 6)),
      cat("quizzes", "Quizzes", 20, numbered("Quiz", 4)),
      cat("project", "Project", 20, ["Project"]),
      cat("attendance", "Attendance", 10, ["Attendance"]),
      cat("midterm", "Midterm Exam", 15, ["Midterm Exam"]),
      cat("final", "Final Exam", 15, ["Final Exam"]),
    ],
    scale: DEFAULT_SCALE,
    scaleNote: DEFAULT_SCALE_NOTE,
    passEquiv: 3,
    finalCategory: "final",
    holdFinal: true,
  };
}

/* sections: the instructor's own sections; taken: ids that exist but belong to other instructors (ids are global) */
export async function addSection(db, sections, name, term, taken) {
  const title = String(name || "").trim();
  const sem = String(term || "").trim() || LEGACY_TERM;
  if (!title) throw new Error("Enter a section name.");
  if (Object.values(sections || {}).some((x) => (x.name || "").toLowerCase() === title.toLowerCase() && termOf(x) === sem)) throw new Error("A section with that name already exists in " + sem + ".");
  const base = slugId(sem + " " + title) || "section";
  let id = base, n = 2;
  while ((sections || {})[id] || (taken && taken.has(id))) id = base + "-" + n++;
  await saveSection(db, id, { name: title, term: sem, headings: [], subject: { code: "", desc: "" }, instructor: "", roomTime: "", scheme: blankScheme() });
  return id;
}

/* ---- quizzes (instructor) ---- */
export async function saveQuiz(db, id, quiz) {
  unwrap(await db.from("quizzes").upsert({
    id, sec: quiz.sec, title: String(quiz.title).trim(), item_key: quiz.itemKey || null, item_max: quiz.itemKey ? quiz.itemMax : null,
    questions: clean(quiz.questions), published: Boolean(quiz.published),
    time_limit: quiz.timeLimit ? Number(quiz.timeLimit) : null, shuffle: quiz.shuffle !== false, lockdown: quiz.lockdown !== false,
    max_violations: Number(quiz.maxViolations) || 3,
    // sent only when it is on (or the database already has the column), so a database that has not had the latest schema.sql run still saves quizzes
    ...(quiz.showAnswers || quiz.hasShowAnswers ? { show_answers: Boolean(quiz.showAnswers) } : {}), updated: new Date().toISOString(),
  }));
}
export async function deleteQuiz(db, id) { unwrap(await db.from("quizzes").delete().eq("id", id)); }
/* Removes one student's attempt (and the score it wrote) so they can take the quiz again. */
export async function resetQuizAttempt(db, quizId, key) { unwrap(await db.rpc("reset_quiz_attempt", { p_quiz: quizId, p_key: key })); }

/* Removes the section and every student in it, with their scores. Returns how many students went. */
export async function deleteSection(db, id) {
  return unwrap(await db.rpc("delete_section", { p_id: id }));
}

/* Item keys are never reused, so a deleted item's old scores cannot reappear under a new item. */
export const newItemKey = (catId) => catId + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const newCategoryId = (title) => (slugId(title) || "cat") + "_" + Date.now().toString(36);

/* Which roster row a student number in a section uses. The same student in a second section gets a tagged row
   (see keys.js) and keeps the PIN they already have. rowsTaken: ids already used earlier in the same import. */
export function resolveRow(roster, no, sec, rowsTaken) {
  const n = safeId(no);
  const same = Object.entries(roster || {}).find(([id, r]) => studentNo(id) === n && r.sec === sec);
  if (same) return { id: same[0], existing: same[1] };
  const sibling = Object.entries(roster || {}).find(([id]) => studentNo(id) === n);
  const id = (rowsTaken && rowsTaken.has(n)) || sibling ? taggedRowId(n, sec) : n;
  return { id, existing: null, pin: sibling ? sibling[1].pin : null };
}

/* Row ids (see keys.js) that already belong to another instructor's section. The same student can be taught by two instructors:
   the student's number and name are shared, but the second instructor's enrollment gets its own row id, PIN and scores. */
export async function takenLoginIds(db, ids) {
  if (!ids.length) return new Set();
  return new Set(unwrap(await db.rpc("taken_login_ids", { p_ids: ids })) || []);
}

export async function addStudent(db, meta, { id, name, sec }, roster) {
  const no = safeId(id);
  if (!no || !name.trim()) throw new Error("Enter a student number and a name.");
  const row = resolveRow(roster, no, sec);
  if (row.existing) throw new Error("Student " + no + " is already in this section.");
  const rowId = (await takenLoginIds(db, [row.id])).has(row.id) ? taggedRowId(no, sec) : row.id;   // already enrolled by another instructor
  const salt = await ensureSalt(db, meta);
  const pin = row.pin || makePin();
  const key = await recordKey(salt, rowId, pin);
  unwrap(await db.rpc("upsert_students", { p_rows: [{ id: rowId, name: name.trim(), sec, pin, key }] }));
  return { id: rowId, no, pin };
}

export async function removeStudent(db, id, key) {
  unwrap(await db.rpc("delete_students", { p_rows: [{ id, key }] }));
}

/* list: [{ id, key }]. Removes the students and all of their scores. */
export async function removeStudents(db, list) {
  for (let i = 0; i < list.length; i += 200) unwrap(await db.rpc("delete_students", { p_rows: list.slice(i, i + 200) }));
  return list.length;
}

/* Blanks every score in a section but keeps its students and their PINs. Returns how many students. */
export async function clearSectionScores(db, secId, roster) {
  const rows = Object.entries(roster || {})
    .filter(([, r]) => r.sec === secId)
    .map(([id, r]) => ({ id, name: r.name, sec: r.sec, pin: r.pin, key: r.key, s: {} }));
  unwrap(await db.rpc("clear_quiz_attempts", { p_sec: secId }));   // so students can retake the quizzes whose scores were cleared
  for (let i = 0; i < rows.length; i += 200) unwrap(await db.rpc("upsert_students", { p_rows: rows.slice(i, i + 200) }));
  return rows.length;
}

/* list: [{ id, email }]. An empty email clears it; changing an email makes the student "not emailed yet". */
export async function saveEmails(db, list) {
  for (let i = 0; i < list.length; i += 200) unwrap(await db.rpc("set_student_emails", { p_rows: list.slice(i, i + 200) }));
  return list.length;
}

/* ids: student numbers whose PIN has already been emailed (for example by the old Gmail mail merge) */
export async function markEmailed(db, ids) {
  for (let i = 0; i < ids.length; i += 200) unwrap(await db.rpc("mark_emailed", { p_ids: ids.slice(i, i + 200) }));
  return ids.length;
}

/* messages: [{ id, to, subject, text, html }], at most 25 per call. Sends through the send-pins Edge Function,
   which checks that the caller is an instructor. Returns [{ id, ok, error? }]. With test = true nothing is
   marked as emailed and the function adds [TEST] to the subject. */
export async function sendPinEmails(db, messages, { sender, replyTo, test } = {}) {
  const { data, error } = await db.functions.invoke("send-pins", { body: { messages, sender, replyTo, test: Boolean(test) } });
  if (error) {
    let detail = "";
    try { detail = (await error.context.json()).error || ""; } catch { /* no body */ }
    throw new Error(detail || error.message || "Could not reach the email service.");
  }
  if (data && data.error) throw new Error(data.error);
  return (data && data.results) || [];
}

export async function resetPin(db, meta, id, entry) {
  const salt = await ensureSalt(db, meta);
  const pin = makePin();
  const key = await recordKey(salt, id, pin);
  unwrap(await db.rpc("reset_pin", { p_id: id, p_old_key: entry.key, p_new_key: key, p_pin: pin }));
  return pin;
}

/* Writes imported sections and students. Students already in the roster keep their PIN. */
export async function importData(db, parsedIn, { meta, sections, roster, details, term, taken, removeMissing, onProgress }) {
  const parsed = scopeToTerm(parsedIn, term, sections, taken);   // each semester keeps its own sections, students' scores and PINs
  const salt = (meta && meta.salt) || makeSalt();
  const rosterNow = roster || {};
  const now = new Date().toISOString();

  unwrap(await db.from("meta").upsert({ id: 1, salt, title: details.title || "", term: details.term || "", note: details.note || "", updated: now }));

  const sectionRows = parsed.sections.map((sec) => sectionRow(sec.id, mergeSection((sections || {})[sec.id], sec)));
  if (sectionRows.length) unwrap(await db.rpc("save_sections", { p_rows: sectionRows }));

  let created = 0, kept = 0;
  const seen = new Set();
  const rows = [];
  const live = { ...rosterNow };   // roster plus the rows made so far in this import
  const takenNo = new Set();       // student numbers already placed in this import (the next section's row is tagged)
  const foreign = await takenLoginIds(db, [...new Set(parsed.students.map((st) => safeId(st.id)))]);   // plain row ids another instructor already uses
  for (let i = 0; i < parsed.students.length; i++) {
    const st = parsed.students[i];
    let r = resolveRow(live, st.id, st.sec, takenNo);
    if (!r.existing && foreign.has(r.id)) r = { ...r, id: taggedRowId(safeId(st.id), st.sec) };   // same student, another instructor's section
    let pin, key;
    if (r.existing && r.existing.key && r.existing.pin) {
      pin = r.existing.pin;
      key = r.existing.key;
      kept++;
    } else {
      pin = r.pin || makePin();
      key = await recordKey(salt, r.id, pin);
      created++;
    }
    seen.add(r.id);
    takenNo.add(safeId(st.id));
    live[r.id] = { name: st.name, sec: st.sec, pin, key };
    rows.push(clean({ id: r.id, name: st.name, sec: st.sec, pin, key, s: st.s || {} }));
    if (onProgress) onProgress(i + 1, parsed.students.length);
  }

  // write in chunks so very large classes stay under request size limits
  for (let i = 0; i < rows.length; i += 200) {
    unwrap(await db.rpc("upsert_students", { p_rows: rows.slice(i, i + 200) }));
  }

  let removed = 0;
  if (removeMissing) {
    // only this semester's students can be "missing"; other semesters are never touched
    const inTerm = (secId) => parsed.sections.some((x) => x.id === secId) || (sections && sections[secId] && termOf(sections[secId]) === parsed.sections[0].term);
    const gone = Object.entries(rosterNow).filter(([id, r]) => !seen.has(id) && inTerm(r.sec)).map(([id, ex]) => ({ id, key: ex.key }));
    for (let i = 0; i < gone.length; i += 200) unwrap(await db.rpc("delete_students", { p_rows: gone.slice(i, i + 200) }));
    removed = gone.length;
  }

  return { created, kept, removed, total: parsed.students.length };
}

export { normId, safeId };
