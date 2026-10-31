/* All reads and writes to the Supabase (Postgres) database. The tables and the access rules are in
   supabase/schema.sql.

   Data layout
     meta                 page title, term, note, secret salt          (anyone can read)
     sections/<id>        section details + grading scheme             (anyone can read)
     records/<key>        one student's scores; <key> comes from student number + PIN
                          (a student can fetch ONE record if they know the key; nobody can list them)
     roster/<studentId>   name, section, PIN and key                   (instructors only)
     admins               user ids of instructor accounts              (added by hand in the SQL editor)

   The screens work with plain objects shaped like this (maps keyed by id), so each table's rows are
   converted on the way in. Times are milliseconds since 1970. */

import { recordKey, makePin, makeSalt, safeId, normId } from "./keys.js";
import { DEFAULT_SCALE, DEFAULT_SCALE_NOTE } from "./grading.js";

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
const toSections = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r.data]));

/* ---------------------------- student side ---------------------------- */

export function createStudentApi(db) {
  const fetchPublic = async () => {
    const [m, s] = await Promise.all([
      db.from("meta").select("*").eq("id", 1).maybeSingle(),
      db.from("sections").select("id, data"),
    ]);
    return { meta: toMeta(unwrap(m)), sections: toSections(unwrap(s)) };
  };

  const fetchRecord = async (key) => {
    const record = unwrap(await db.rpc("get_record", { p_key: key }));
    if (!record) throw Object.assign(new Error("no match"), { code: "nomatch" });
    return record;
  };

  return {
    loadMeta: () => withTimeout(fetchPublic().then((x) => x.meta)),

    login: (idInput, pinInput) =>
      withTimeout(
        (async () => {
          const { meta, sections } = await fetchPublic();
          if (!meta || !meta.salt) throw Object.assign(new Error("not published"), { code: "notpublished" });
          const key = await recordKey(meta.salt, idInput, pinInput);
          const record = await fetchRecord(key);
          return { key, meta, record, section: sections[record.sec] || null };
        })()
      ),

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

const SOURCES = {
  meta: { table: "meta", pk: "id", shape: (rows) => toMeta([...rows.values()][0]) },
  sections: { table: "sections", pk: "id", shape: (rows) => toSections([...rows.values()]) },
  roster: {
    table: "roster", pk: "student_id",
    shape: (rows) => Object.fromEntries([...rows.values()].map((r) => [r.student_id, { name: r.name, sec: r.sec, pin: r.pin, key: r.key }])),
  },
  records: {
    table: "records", pk: "key",
    shape: (rows) => Object.fromEntries([...rows.values()].map((r) => [r.key, { id: r.student_id, name: r.name, sec: r.sec, s: r.s || {}, updated: ms(r.updated) }])),
  },
};

const POLL_MS = 30000;

/* Calls onValueCb with the whole table now and again whenever it changes. Realtime events patch the
   copy in memory; a slow refresh is a safety net in case realtime is off or the connection drops.
   Returns a function that stops listening. */
export function listen(db, path, onValueCb, onError) {
  const src = SOURCES[path];
  let rows = new Map();
  let alive = true;
  const emit = () => alive && onValueCb(src.shape(rows));

  const load = async () => {
    const { data, error } = await db.from(src.table).select("*");
    if (!alive) return;
    if (error) return onError && onError(error);
    rows = new Map(data.map((r) => [r[src.pk], r]));
    emit();
  };

  const channel = db
    .channel("rt-" + path + "-" + Math.random().toString(36).slice(2))
    .on("postgres_changes", { event: "*", schema: "public", table: src.table }, (p) => {
      if (p.eventType === "DELETE") rows.delete(p.old[src.pk]);
      else rows.set(p.new[src.pk], p.new);
      emit();
    })
    .subscribe((status) => { if (status === "SUBSCRIBED") load(); });

  load();
  const timer = setInterval(load, POLL_MS);
  return () => {
    alive = false;
    clearInterval(timer);
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

export async function saveSection(db, id, section) {
  const { count, ...rest } = section; // eslint-disable-line no-unused-vars
  unwrap(await db.from("sections").upsert({ id, data: clean(rest), updated: new Date().toISOString() }));
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

/* A new section starts with the usual lecture weights and one item per category; edit them in Settings. */
export function blankScheme() {
  const cat = (id, title, weight, label, max) => ({ id, title, weight, items: [{ k: id + "1", label, max }] });
  return {
    categories: [
      cat("exams", "Term Examinations", 30, "Exam", 100),
      cat("attendance", "Attendance / Participation", 10, "Attendance", 100),
      cat("activities", "Activities", 20, "Activity 1", 100),
      cat("project", "Project", 20, "Project", 100),
      cat("quizzes", "Quizzes", 20, "Quiz 1", 100),
    ],
    scale: DEFAULT_SCALE,
    scaleNote: DEFAULT_SCALE_NOTE,
    passEquiv: 3,
    finalCategory: null,
    holdFinal: false,
  };
}

export async function addSection(db, sections, name) {
  const title = String(name || "").trim();
  if (!title) throw new Error("Enter a section name.");
  if (Object.values(sections || {}).some((x) => (x.name || "").toLowerCase() === title.toLowerCase())) throw new Error("A section with that name already exists.");
  const base = slugId(title) || "section";
  let id = base, n = 2;
  while ((sections || {})[id]) id = base + "-" + n++;
  await saveSection(db, id, { name: title, headings: [], subject: { code: "", desc: "" }, instructor: "", roomTime: "", scheme: blankScheme() });
  return id;
}

/* Removes the section and every student in it, with their scores. Returns how many students went. */
export async function deleteSection(db, id) {
  return unwrap(await db.rpc("delete_section", { p_id: id }));
}

/* Item keys are never reused, so a deleted item's old scores cannot reappear under a new item. */
export const newItemKey = (catId) => catId + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const newCategoryId = (title) => (slugId(title) || "cat") + "_" + Date.now().toString(36);

export async function addStudent(db, meta, { id, name, sec }) {
  const sid = safeId(id);
  if (!sid || !name.trim()) throw new Error("Enter a student number and a name.");
  const salt = await ensureSalt(db, meta);
  const pin = makePin();
  const key = await recordKey(salt, sid, pin);
  unwrap(await db.rpc("upsert_students", { p_rows: [{ id: sid, name: name.trim(), sec, pin, key }] }));
  return { id: sid, pin };
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
  for (let i = 0; i < rows.length; i += 200) unwrap(await db.rpc("upsert_students", { p_rows: rows.slice(i, i + 200) }));
  return rows.length;
}

export async function resetPin(db, meta, id, entry) {
  const salt = await ensureSalt(db, meta);
  const pin = makePin();
  const key = await recordKey(salt, id, pin);
  unwrap(await db.rpc("reset_pin", { p_id: id, p_old_key: entry.key, p_new_key: key, p_pin: pin }));
  return pin;
}

/* Writes imported sections and students. Students already in the roster keep their PIN. */
export async function importData(db, parsed, { meta, sections, roster, details, removeMissing, onProgress }) {
  const salt = (meta && meta.salt) || makeSalt();
  const rosterNow = roster || {};
  const now = new Date().toISOString();

  unwrap(await db.from("meta").upsert({ id: 1, salt, title: details.title || "", term: details.term || "", note: details.note || "", updated: now }));

  const sectionRows = parsed.sections.map((sec) => {
    const merged = mergeSection((sections || {})[sec.id], sec);
    const { count, ...rest } = merged; // eslint-disable-line no-unused-vars
    return { id: sec.id, data: clean(rest), updated: now };
  });
  if (sectionRows.length) unwrap(await db.from("sections").upsert(sectionRows));

  let created = 0, kept = 0;
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < parsed.students.length; i++) {
    const st = parsed.students[i];
    seen.add(st.id);
    const ex = rosterNow[st.id];
    let pin, key;
    if (ex && ex.key && ex.pin) {
      pin = ex.pin;
      key = ex.key;
      kept++;
    } else {
      pin = makePin();
      key = await recordKey(salt, st.id, pin);
      created++;
    }
    rows.push(clean({ id: st.id, name: st.name, sec: st.sec, pin, key, s: st.s || {} }));
    if (onProgress) onProgress(i + 1, parsed.students.length);
  }

  // write in chunks so very large classes stay under request size limits
  for (let i = 0; i < rows.length; i += 200) {
    unwrap(await db.rpc("upsert_students", { p_rows: rows.slice(i, i + 200) }));
  }

  let removed = 0;
  if (removeMissing) {
    const gone = Object.entries(rosterNow).filter(([id]) => !seen.has(id)).map(([id, ex]) => ({ id, key: ex.key }));
    for (let i = 0; i < gone.length; i += 200) unwrap(await db.rpc("delete_students", { p_rows: gone.slice(i, i + 200) }));
    removed = gone.length;
  }

  return { created, kept, removed, total: parsed.students.length };
}

export { normId, safeId };
