/* All reads and writes to Firebase Realtime Database.

   Data layout
     meta                 page title, term, note, secret salt          (anyone can read)
     sections/<id>        section details + grading scheme             (anyone can read)
     records/<key>        one student's scores; <key> comes from student number + PIN
                          (anyone can read ONE record if they know the key, nobody can list them)
     roster/<studentId>   name, section, PIN and key                   (teacher only)
     admins/<uid>         true for teacher accounts                    (set by hand in the Firebase console) */

import { ref, get, set, update, remove, onValue, goOnline, goOffline, serverTimestamp } from "firebase/database";
import { recordKey, makePin, makeSalt, safeId, normId } from "./keys.js";
import { DEFAULT_SCALE, DEFAULT_SCALE_NOTE } from "./grading.js";

const clean = (obj) => JSON.parse(JSON.stringify(obj)); // drops undefined, which Firebase rejects

export function withTimeout(promise, ms = 20000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/* ---------------------------- student side ---------------------------- */

export function createStudentApi(db) {
  // Students only need a connection while they fetch. Closing it keeps well below Firebase's
  // free limit of 100 simultaneous connections when a whole class opens the page at once.
  const online = async (fn) => {
    goOnline(db);
    try {
      return await withTimeout(fn());
    } finally {
      goOffline(db);
    }
  };

  const fetchPublic = async () => {
    const [m, s] = await Promise.all([get(ref(db, "meta")), get(ref(db, "sections"))]);
    return { meta: m.val() || null, sections: s.val() || {} };
  };

  return {
    loadMeta: () => online(async () => (await get(ref(db, "meta"))).val() || null),

    login: (idInput, pinInput) =>
      online(async () => {
        const { meta, sections } = await fetchPublic();
        if (!meta || !meta.salt) throw Object.assign(new Error("not published"), { code: "notpublished" });
        const key = await recordKey(meta.salt, idInput, pinInput);
        const snap = await get(ref(db, "records/" + key));
        if (!snap.exists()) throw Object.assign(new Error("no match"), { code: "nomatch" });
        const record = snap.val();
        return { key, meta, record, section: sections[record.sec] || null };
      }),

    refresh: (key) =>
      online(async () => {
        const { meta, sections } = await fetchPublic();
        const snap = await get(ref(db, "records/" + key));
        if (!snap.exists()) throw Object.assign(new Error("no match"), { code: "nomatch" });
        const record = snap.val();
        return { key, meta, record, section: sections[record.sec] || null };
      }),
  };
}

/* ---------------------------- teacher side ---------------------------- */

export function listen(db, path, onValueCb, onError) {
  return onValue(ref(db, path), (s) => onValueCb(s.val()), onError);
}

/* Checks admins/<uid> two ways at once and uses whichever answers first: the live connection, and a plain
   HTTPS request with the user's ID token (same rules, no websocket needed). A blocked or slow websocket
   therefore cannot leave the page waiting. Throws only if both fail, so the page can show a retry. */
export function isTeacher(db, user) {
  const viaSdk = async () => {
    try {
      return (await get(ref(db, "admins/" + user.uid))).val() === true;
    } catch (e) {
      if (/permission[_ ]denied/i.test(String(e && e.code) + " " + (e && e.message))) return false;
      throw e;
    }
  };
  const viaHttp = async () => {
    const token = await user.getIdToken();
    const base = db.app.options.databaseURL.replace(/\/+$/, "");
    const res = await fetch(base + "/admins/" + encodeURIComponent(user.uid) + ".json?auth=" + encodeURIComponent(token));
    if (res.status === 401 || res.status === 403) return false;
    if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { code: "http" + res.status });
    return (await res.json()) === true;
  };
  return withTimeout(
    Promise.any([viaSdk(), viaHttp()]).catch((agg) => { throw (agg && agg.errors && agg.errors[agg.errors.length - 1]) || agg; }),
    15000
  );
}

export function saveScore(db, key, itemKey, value) {
  return update(ref(db), {
    ["records/" + key + "/s/" + itemKey]: value === undefined ? null : value,
    ["records/" + key + "/updated"]: serverTimestamp(),
  });
}

export async function ensureSalt(db, meta) {
  if (meta && meta.salt) return meta.salt;
  const salt = makeSalt();
  await update(ref(db, "meta"), { salt });
  return salt;
}

export function saveMeta(db, { title, term, note }) {
  return update(ref(db, "meta"), { title: title || "", term: term || "", note: note || "", updated: serverTimestamp() });
}

export function saveSection(db, id, section) {
  const { count, ...rest } = section; // eslint-disable-line no-unused-vars
  return set(ref(db, "sections/" + id), clean(rest));
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
  await set(ref(db, "sections/" + id), clean({ name: title, headings: [], subject: { code: "", desc: "" }, instructor: "", roomTime: "", scheme: blankScheme() }));
  return id;
}

/* Removes the section and every student in it, with their scores. */
export async function deleteSection(db, id, roster) {
  const updates = { ["sections/" + id]: null };
  let count = 0;
  Object.entries(roster || {}).forEach(([sid, r]) => {
    if (r.sec !== id) return;
    updates["roster/" + sid] = null;
    if (r.key) updates["records/" + r.key] = null;
    count++;
  });
  await update(ref(db), updates);
  return count;
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
  await update(ref(db), {
    ["records/" + key]: { id: sid, name: name.trim(), sec, updated: serverTimestamp() },
    ["roster/" + sid]: { name: name.trim(), sec, pin, key },
  });
  return { id: sid, pin };
}

export async function removeStudent(db, id, key) {
  await update(ref(db), { ["records/" + key]: null, ["roster/" + id]: null });
}

export async function resetPin(db, meta, id, entry) {
  const salt = await ensureSalt(db, meta);
  const pin = makePin();
  const key = await recordKey(salt, id, pin);
  const old = await get(ref(db, "records/" + entry.key));
  const rec = old.val() || { id, name: entry.name, sec: entry.sec };
  await update(ref(db), {
    ["records/" + entry.key]: null,
    ["records/" + key]: { ...rec, updated: serverTimestamp() },
    ["roster/" + id + "/pin"]: pin,
    ["roster/" + id + "/key"]: key,
  });
  return pin;
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

/* Writes imported sections and students. Students already in the roster keep their PIN. */
export async function importData(db, parsed, { meta, sections, roster, details, removeMissing, onProgress }) {
  const salt = (meta && meta.salt) || makeSalt();
  const rosterNow = roster || {};
  const updates = {
    "meta/salt": salt,
    "meta/title": details.title || "",
    "meta/term": details.term || "",
    "meta/note": details.note || "",
    "meta/updated": serverTimestamp(),
  };
  parsed.sections.forEach((sec) => {
    const merged = mergeSection((sections || {})[sec.id], sec);
    const { count, ...rest } = merged; // eslint-disable-line no-unused-vars
    updates["sections/" + sec.id] = clean(rest);
  });

  let created = 0, kept = 0;
  const seen = new Set();
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
    updates["records/" + key] = clean({ id: st.id, name: st.name, sec: st.sec, s: st.s, updated: serverTimestamp() });
    updates["roster/" + st.id] = { name: st.name, sec: st.sec, pin, key };
    if (onProgress) onProgress(i + 1, parsed.students.length);
  }

  let removed = 0;
  if (removeMissing) {
    Object.entries(rosterNow).forEach(([id, ex]) => {
      if (!seen.has(id)) {
        updates["records/" + ex.key] = null;
        updates["roster/" + id] = null;
        removed++;
      }
    });
  }

  // write in chunks so very large classes stay under Firebase's request size limits
  const entries = Object.entries(updates);
  for (let i = 0; i < entries.length; i += 300) {
    await update(ref(db), Object.fromEntries(entries.slice(i, i + 300)));
  }
  return { created, kept, removed, total: parsed.students.length };
}

export { normId, safeId, remove };
