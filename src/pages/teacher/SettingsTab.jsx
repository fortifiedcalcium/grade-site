import React, { useState } from "react";
import Icon from "../../Icon.jsx";
import { termOf, termsOf, LEGACY_TERM } from "../../lib/terms.js";
import { addSection, clearSectionScores, deleteSection, newCategoryId, newItemKey, saveMeta, saveSection } from "../../lib/db.js";

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
      <summary><strong>{s.name}</strong> <span className="tag">{termOf(s)}</span></summary>
      <div className="form-grid">
        <label><Icon name="calendar" /> Semester<input list="terms-list" value={s.term == null ? termOf(s) : s.term} onChange={(e) => setS({ ...s, term: e.target.value })} /></label>
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

export default function SettingsTab({ db, meta, sections, roster }) {
  const [m, setM] = useState({ title: meta.title || "", term: meta.term || "", note: meta.note || "" });
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [secMsg, setSecMsg] = useState("");
  const terms = termsOf(sections);
  const [newTerm, setNewTerm] = useState(() => terms[0] || LEGACY_TERM);
  const untagged = Object.entries(sections).filter(([, x]) => !String(x.term || "").trim());
  const [tagMsg, setTagMsg] = useState("");
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
    try { await addSection(db, sections, newName, newTerm); setNewName(""); setSecMsg("Section added. Open it below to set its grading scheme."); } catch (err) { setSecMsg(err.message); }
  };
  return (
    <>
      <form className="card" onSubmit={save}>
        <h2><Icon name="settings" /> Page details</h2>
        <div className="form-grid">
          <label><Icon name="tag" /> Title<input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} /></label>
          <label><Icon name="calendar" /> Term<input value={m.term} onChange={(e) => setM({ ...m, term: e.target.value })} /></label>
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
        <input aria-label="Semester of the new section" list="terms-list" placeholder="Semester, e.g. 2026-2027 2nd Semester" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} />
        <datalist id="terms-list">{terms.map((t) => <option key={t} value={t} />)}</datalist>
        <input aria-label="New section name" placeholder="Section name, e.g. BSIT 3-A" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn primary"><Icon name="plus" /> Add section</button>
        {secMsg && <span className="small" role="status">{secMsg}</span>}
      </form>
      {Object.keys(sections).length === 0 && <p className="muted">No sections yet. Add one above or import a class record.</p>}
      {Object.entries(sections).map(([id, sec]) => <SectionEditor key={id} db={db} id={id} section={sec} roster={roster} terms={terms} />)}
    </>
  );
}
