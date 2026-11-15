/* Semesters ("terms"). Every section belongs to one term, stored in the section's data as `term`
   (for example "2026-2027 1st Semester"). Sections saved before terms existed have no `term`; they count as the
   LEGACY_TERM, so the data already in the database is filed under 2026-2027 1st Semester without a migration.

   A new semester gets its own sections. When the same sheet name is imported again for another term, the
   section id is prefixed with the term so last semester's section, students' scores and PINs are never overwritten. */

export const LEGACY_TERM = "2026-2027 1st Semester";

export const termOf = (sec) => String((sec && sec.term) || "").trim() || LEGACY_TERM;

export const termSlug = (term) => String(term || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

/* Newest first: by the first year in the name, then by the semester number ("Summer" counts as last). */
const rank = (t) => {
  const year = Number((/(\d{4})/.exec(t) || [])[1]) || 0;
  const sem = /summer|mid\s*year/i.test(t) ? 3 : Number((/(\d)(?:st|nd|rd|th)/i.exec(t) || [])[1]) || 0;
  return year * 10 + sem;
};
export const compareTerms = (a, b) => rank(b) - rank(a) || a.localeCompare(b);

/* All terms in use, newest first. `extra` lets a caller add one that has no section yet. */
export const termsOf = (sections, extra = []) =>
  [...new Set([...Object.values(sections || {}).map(termOf), ...extra.filter(Boolean)])].sort(compareTerms);

/* Gives the imported sections a term and keeps them apart from other terms' sections.
   A section id that already exists in the same term is reused (re-import = update); one that exists in another
   term gets a term prefix. Students follow their section's new id. Returns a new parsed object. */
export function scopeToTerm(parsed, term, existing) {
  const t = String(term || "").trim() || LEGACY_TERM;
  const ex = existing || {};
  const used = new Set();
  const idMap = new Map();
  const sections = parsed.sections.map((s) => {
    let id = s.id;
    if (ex[id] && termOf(ex[id]) !== t) {
      const base = termSlug(t) + "--" + s.id;
      id = base;
      let n = 2;
      while (used.has(id) || (ex[id] && termOf(ex[id]) !== t)) id = base + "-" + n++;
    }
    used.add(id);
    idMap.set(s.id, id);
    return { ...s, id, term: t };
  });
  return { ...parsed, sections, students: parsed.students.map((st) => ({ ...st, sec: idMap.get(st.sec) || st.sec })) };
}
