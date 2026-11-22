import React, { useState } from "react";
import Icon from "../../Icon.jsx";
import { termOf, termsOf, LEGACY_TERM } from "../../lib/terms.js";
import TermSelect from "../../lib/TermSelect.jsx";
import { codeOf, recalledTerm, rememberTerm } from "../../lib/sectionPicker.jsx";
import { addSection, clearSectionScores, deleteSection, newCategoryId, newItemKey, saveMeta, saveSection } from "../../lib/db.js";

const ALL = "__all";
const NO_CODE = "__none";

function SectionEditor({ db, id, section, roster, terms }) {
  const [s, setS] = useState(() => JSON.parse(JSON.stringify(section)));
  const [msg, setMsg] = useState("");
  const setCat = (ci, patch) => setS({ ...s, scheme: { ...s.scheme, categories: s.scheme.categories.map((c, i) => (i === ci ? { ...c, ...patch } : c)) } });
  const setItem = (ci, ii, patch) => setCat(ci, { items: s.scheme.categories[ci].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });
  const addItem = (ci) => {
    const c = s.scheme.categories[ci];
    const n = (c.items || []).length + 1;
    setCat(ci, { items: [...(c.items || []), { k: newItemKey(c.id), label: c.title + " " + n, max: 100 }] });
  };
  const removeItem = (ci, ii) => {
    const it = s.scheme.categories[ci].items[ii];
    if (window.confirm('Remove "' + it.label + '"? Its scores will no longer count.')) setCat(ci, { items: s.scheme.categories[ci].items.filter((_, i) => i !== ii) });
  };
  const addCategory = () => {
    const title = "New category";
    const id = newCategoryId(title);
    setS({ ...s, scheme: { ...s.scheme, categories: [...s.scheme.categories, { id, title, weight: 0, items: [{ k: newItemKey(id), label: "Item 1", max: 100 }] }] } });
  };
  const removeCategory = (ci) => {
    const c = s.scheme.categories[ci];
    if (!window.confirm('Remove the category "' + c.title + '" and all of its items?')) return;
    setS({ ...s, scheme: { ...s.scheme, categories: s.scheme.categories.filter((_, i) => i !== ci), finalCategory: s.scheme.finalCategory === c.id ? null : s.scheme.finalCategory, holdFinal: s.scheme.finalCategory === c.id ? false : s.scheme.holdFinal } });
  };
  const students = Object.values(roster || {}).filter((r) => r.sec === id).length;
  const [deleted, setDeleted] = useState(false);
  const removeSection = async () => {
    const ok = window.confirm('Delete the section "' + s.name + '"' + (students ? " and its " + students + " student" + (students === 1 ? "" : "s") + ", with all scores" : "") + "? This cannot be undone.");
    if (!ok) return;
    try { await deleteSection(db, id); setDeleted(true); } catch (e) { setMsg("Not deleted: " + e.message); }
  };
  const clearScores = async () => {
    if (!students) return setMsg("This section has no students.");
    if (!window.confirm('Clear ALL scores for the ' + students + ' student' + (students === 1 ? "" : "s") + ' in "' + s.name + '"? Students and PINs stay. This cannot be undone.')) return;
    try { await clearSectionScores(db, id, roster); setMsg("Cleared the scores of " + students + " student" + (students === 1 ? "" : "s") + "."); } catch (e) { setMsg("Not cleared: " + e.message); }
  };
  if (deleted) return null;
  const total = s.scheme.categories.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  const save = async () => {
    setMsg("");
    try { await saveSection(db, id, s); setMsg("Saved."); } catch (e) { setMsg("Not saved: " + e.message); }
  };
  return (
    <details className="card">
      <summary><strong>{s.name}</strong> {codeOf(section) && <span className="tag">{codeOf(section)}</span>} <span className="tag">{termOf(s)}</span></summary>
      <div className="form-grid">
        <label><Icon name="calendar" /> Semester<TermSelect value={s.term == null ? termOf(s) : s.term} known={terms} onChange={(v) => setS({ ...s, term: v })} /></label>
        <label><Icon name="book" /> Subject code<input value={s.subject.code || ""} onChange={(e) => setS({ ...s, subject: { ...s.subject, code: e.target.value } })} /></label>
        <label><Icon name="book" /> Subject description<input value={s.subject.desc || ""} onChange={(e) => setS({ ...s, subject: { ...s.subject, desc: e.target.value } })} /></label>
        <label><Icon name="user" /> Instructor<input value={s.instructor || ""} onChange={(e) => setS({ ...s, instructor: e.target.value })} /></label>
        <label><Icon name="clock" /> Room / time<input value={s.roomTime || ""} onChange={(e) => setS({ ...s, roomTime: e.target.value })} /></label>
        <label><Icon name="check" /> Passing equivalent (at or below)<input type="number" step="0.25" value={s.scheme.passEquiv} onChange={(e) => setS({ ...s, scheme: { ...s.scheme, passEquiv: Number(e.target.value) } })} /></label>
        <label className="inline"><input type="checkbox" checked={!!s.scheme.holdFinal} onChange={(e) => setS({ ...s, scheme: { ...s.scheme, holdFinal: e.target.checked } })} /> Show "pending" until the final exam is recorded</label>
      </div>
      <div className="scroll">
      <table className="grid">
        <thead><tr><th>Category</th><th className="num">Weight %</th><th>Items (max score)</th><th><span className="sr-only">Remove category</span></th></tr></thead>
        <tbody>
          {s.scheme.categories.map((c, ci) => (
            <tr key={c.id}>
              <td><input value={c.title} onChange={(e) => setCat(ci, { title: e.target.value })} /></td>
              <td className="num"><input className="short" type="number" value={c.weight} onChange={(e) => setCat(ci, { weight: Number(e.target.value) })} /></td>
              <td>
                {(c.items || []).map((it, ii) => (
                  <span className="chip" key={it.k}>
                    <input className="lbl" aria-label={"Label of " + it.label} value={it.label} onChange={(e) => setItem(ci, ii, { label: e.target.value })} />
                    <input className="short" aria-label={"Maximum score of " + it.label} type="number" value={it.max} onChange={(e) => setItem(ci, ii, { max: Number(e.target.value) })} />
                    <button type="button" className="btn small danger" aria-label={"Remove " + it.label} onClick={() => removeItem(ci, ii)}><Icon name="close" /></button>
                  </span>
                ))}
                <button type="button" className="btn small" onClick={() => addItem(ci)}><Icon name="plus" /> Item</button>
              </td>
              <td><button type="button" className="btn small danger" onClick={() => removeCategory(ci)}><Icon name="trash" /> Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p><button type="button" className="btn small" onClick={addCategory}><Icon name="plus" /> Add category</button></p>
      {total !== 100 && <p className="error" role="alert"><Icon name="alert" /> Weights add up to {total}%, not 100%.</p>}
      <p className="muted small">Changing a maximum score or weight changes every student's computed grade immediately.</p>
      <div className="row">
        <button className="btn primary" onClick={save}><Icon name="save" /> Save {s.name}</button>
        <button type="button" className="btn danger" onClick={clearScores}><Icon name="trash" /> Clear all scores</button>
        <button type="button" className="btn danger" onClick={removeSection}><Icon name="trash" /> Delete section</button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </details>
  );
}

export default function SettingsTab({ db, meta, sections, roster, takenIds }) {
  const [m, setM] = useState({ title: meta.title || "", term: meta.term || "", note: meta.note || "" });
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [secMsg, setSecMsg] = useState("");
  const terms = termsOf(sections);
  const [newTerm, setNewTerm] = useState(() => terms[0] || LEGACY_TERM);
  const untagged = Object.entries(sections).filter(([, x]) => !String(x.term || "").trim());
  const [tagMsg, setTagMsg] = useState("");
  // which semester's sections are listed below ("" = every semester); starts on the newest, or the one picked on another tab
  const [showTermPick, setShowTerm] = useState(() => (terms.includes(recalledTerm()) ? recalledTerm() : terms[0] || ""));
  const showTerm = showTermPick === ALL || terms.includes(showTermPick) ? showTermPick : terms[0] || ALL;
  const pickShown = (t) => { setShowTerm(t); setSubjPick(""); setSecPick(""); if (t !== ALL) rememberTerm(t); };
  // semester -> subject -> section: each choice narrows the next one
  const byName = (a, b) => String(sections[a].name || a).localeCompare(String(sections[b].name || b), undefined, { numeric: true });
  const inTerm = Object.keys(sections).filter((id) => showTerm === ALL || termOf(sections[id]) === showTerm).sort(byName);
  const subjectKey = (id) => codeOf(sections[id]) || NO_CODE;
  const subjects = [...new Set(inTerm.map(subjectKey))].sort((a, b) => (a === NO_CODE) - (b === NO_CODE) || a.localeCompare(b, undefined, { numeric: true }));
  const subjDesc = (code) => { const id = inTerm.find((i) => subjectKey(i) === code); return (id && sections[id].subject && sections[id].subject.desc) || ""; };
  const subjName = (code) => (code === NO_CODE ? "No subject code" : subjDesc(code) ? code + " – " + subjDesc(code) : code);
  const [subjPick, setSubjPick] = useState("");   // "" = every subject of the semester
  const subject = subjects.includes(subjPick) ? subjPick : "";
  const inSubject = inTerm.filter((id) => !subject || subjectKey(id) === subject);
  const [secPick, setSecPick] = useState("");   // "" = every section of the subject
  const oneSection = inSubject.includes(secPick) ? secPick : "";
  const shownIds = oneSection ? [oneSection] : inSubject;
  const groups = subjects.map((code) => [code, shownIds.filter((id) => subjectKey(id) === code)]).filter(([, ids]) => ids.length);
  const tagAll = async () => {
    setTagMsg("");
    try {
      for (const [sid, x] of untagged) await saveSection(db, sid, { ...x, term: LEGACY_TERM });
      setTagMsg("Saved " + LEGACY_TERM + " on " + untagged.length + " section" + (untagged.length === 1 ? "" : "s") + ".");
    } catch (err) { setTagMsg("Not saved: " + err.message); }
  };
  const save = async (e) => {
    e.preventDefault();
    try { await saveMeta(db, m); setMsg("Saved."); } catch (err) { setMsg("Not saved: " + err.message); }
  };
  const createSection = async (e) => {
    e.preventDefault();
    setSecMsg("");
    try { await addSection(db, sections, newName, newTerm, takenIds); setNewName(""); pickShown(newTerm.trim()); setSecMsg("Section added. Open it below to set its grading scheme."); } catch (err) { setSecMsg(err.message); }
  };
  return (
    <>
      <form className="card" onSubmit={save}>
        <h2><Icon name="settings" /> Page details</h2>
        <div className="form-grid">
          <label><Icon name="tag" /> Title<input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} /></label>
          <label><Icon name="calendar" /> Term shown to students<TermSelect value={m.term} blank="None" known={terms} onChange={(v) => setM({ ...m, term: v })} /></label>
          <label className="span2"><Icon name="note" /> Note shown to students<input value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} /></label>
        </div>
        <button className="btn primary"><Icon name="save" /> Save</button> {msg && <span className="small">{msg}</span>}
      </form>
      <h2><Icon name="calendar" /> Semesters</h2>
      <div className="card">
        <p className="muted small">Every section belongs to one semester, and the Grades and Students screens show one semester at a time. New sections and imports go to the semester you choose, so earlier semesters are never overwritten.</p>
        <table className="grid">
          <thead><tr><th>Semester</th><th className="num">Sections</th><th className="num">Students</th></tr></thead>
          <tbody>
            {terms.map((t) => {
              const ids = Object.keys(sections).filter((i) => termOf(sections[i]) === t);
              return <tr key={t}><td>{t}</td><td className="num">{ids.length}</td><td className="num">{Object.values(roster).filter((r) => ids.includes(r.sec)).length}</td></tr>;
            })}
          </tbody>
        </table>
        {untagged.length > 0 && (
          <p className="row">
            <span className="small">{untagged.length} section{untagged.length === 1 ? "" : "s"} saved before semesters existed {untagged.length === 1 ? "is" : "are"} filed under {LEGACY_TERM}.</span>
            <button type="button" className="btn small" onClick={tagAll}><Icon name="save" /> Save that on {untagged.length === 1 ? "it" : "them"}</button>
            {tagMsg && <span className="small" role="status">{tagMsg}</span>}
          </p>
        )}
      </div>
      <h2><Icon name="users" /> Sections</h2>
      <form className="card row" onSubmit={createSection}>
        <strong>Add a section</strong>
        <TermSelect label="Semester of the new section" value={newTerm} known={terms} onChange={setNewTerm} />
        <input aria-label="New section name" placeholder="Section name, e.g. BSIT 3-A" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn primary"><Icon name="plus" /> Add section</button>
        {secMsg && <span className="small" role="status">{secMsg}</span>}
      </form>
      {Object.keys(sections).length === 0 && <p className="muted">No sections yet. Add one above or import a class record.</p>}
      {Object.keys(sections).length > 0 && (
        <div className="row toolbar">
          <label className="inline"><Icon name="calendar" /> Show sections of
            <select value={showTerm} onChange={(e) => pickShown(e.target.value)} aria-label="Show sections of semester">
              {terms.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value={ALL}>All semesters</option>
            </select>
          </label>
          <label className="inline"><Icon name="book" /> Subject
            <select value={subject} onChange={(e) => { setSubjPick(e.target.value); setSecPick(""); }} aria-label="Show subject">
              <option value="">{"All subjects (" + subjects.length + ")"}</option>
              {subjects.map((c) => <option key={c} value={c}>{subjName(c)}</option>)}
            </select>
          </label>
          <label className="inline"><Icon name="users" /> Section
            <select value={oneSection} onChange={(e) => setSecPick(e.target.value)} aria-label="Show section">
              <option value="">{"All sections (" + inSubject.length + ")"}</option>
              {inSubject.map((id) => <option key={id} value={id}>{sections[id].name || id}</option>)}
            </select>
          </label>
          <span className="muted small">Showing {shownIds.length} of {Object.keys(sections).length} section{Object.keys(sections).length === 1 ? "" : "s"}</span>
        </div>
      )}
      {groups.map(([code, ids]) => (
        <section key={code} aria-label={subjName(code)}>
          <h3 className="subject-head"><Icon name="book" /> {subjName(code)} <span className="muted small">· {ids.length} section{ids.length === 1 ? "" : "s"}{showTerm === ALL ? "" : " in " + showTerm}</span></h3>
          {ids.map((id) => <SectionEditor key={id} db={db} id={id} section={sections[id]} roster={roster} terms={terms} />)}
        </section>
      ))}
    </>
  );
}
