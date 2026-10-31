import React, { useState } from "react";
import { addSection, deleteSection, newCategoryId, newItemKey, saveMeta, saveSection } from "../../lib/db.js";

function SectionEditor({ db, id, section, roster }) {
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
  if (deleted) return null;
  const total = s.scheme.categories.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  const save = async () => {
    setMsg("");
    try { await saveSection(db, id, s); setMsg("Saved."); } catch (e) { setMsg("Not saved: " + e.message); }
  };
  return (
    <details className="card">
      <summary><strong>{s.name}</strong></summary>
      <div className="form-grid">
        <label>Subject code<input value={s.subject.code || ""} onChange={(e) => setS({ ...s, subject: { ...s.subject, code: e.target.value } })} /></label>
        <label>Subject description<input value={s.subject.desc || ""} onChange={(e) => setS({ ...s, subject: { ...s.subject, desc: e.target.value } })} /></label>
        <label>Instructor<input value={s.instructor || ""} onChange={(e) => setS({ ...s, instructor: e.target.value })} /></label>
        <label>Room / time<input value={s.roomTime || ""} onChange={(e) => setS({ ...s, roomTime: e.target.value })} /></label>
        <label>Passing equivalent (at or below)<input type="number" step="0.25" value={s.scheme.passEquiv} onChange={(e) => setS({ ...s, scheme: { ...s.scheme, passEquiv: Number(e.target.value) } })} /></label>
        <label className="inline"><input type="checkbox" checked={!!s.scheme.holdFinal} onChange={(e) => setS({ ...s, scheme: { ...s.scheme, holdFinal: e.target.checked } })} /> Show "pending" until the final exam is recorded</label>
      </div>
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
                    <button type="button" className="btn small danger" aria-label={"Remove " + it.label} onClick={() => removeItem(ci, ii)}>✕</button>
                  </span>
                ))}
                <button type="button" className="btn small" onClick={() => addItem(ci)}>+ Item</button>
              </td>
              <td><button type="button" className="btn small danger" onClick={() => removeCategory(ci)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><button type="button" className="btn small" onClick={addCategory}>+ Add category</button></p>
      {total !== 100 && <p className="error">Weights add up to {total}%, not 100%.</p>}
      <p className="muted small">Changing a maximum score or weight changes every student's computed grade immediately.</p>
      <div className="row">
        <button className="btn primary" onClick={save}>Save {s.name}</button>
        <button type="button" className="btn danger" onClick={removeSection}>Delete section</button>
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
  const save = async (e) => {
    e.preventDefault();
    try { await saveMeta(db, m); setMsg("Saved."); } catch (err) { setMsg("Not saved: " + err.message); }
  };
  const createSection = async (e) => {
    e.preventDefault();
    setSecMsg("");
    try { await addSection(db, sections, newName); setNewName(""); setSecMsg("Section added. Open it below to set its grading scheme."); } catch (err) { setSecMsg(err.message); }
  };
  return (
    <>
      <form className="card" onSubmit={save}>
        <h2>Page details</h2>
        <div className="form-grid">
          <label>Title<input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} /></label>
          <label>Term<input value={m.term} onChange={(e) => setM({ ...m, term: e.target.value })} /></label>
          <label className="span2">Note shown to students<input value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} /></label>
        </div>
        <button className="btn primary">Save</button> {msg && <span className="small">{msg}</span>}
      </form>
      <h2>Sections</h2>
      <form className="card row" onSubmit={createSection}>
        <strong>Add a section</strong>
        <input aria-label="New section name" placeholder="Section name, e.g. BSIT 3-A" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn primary">Add section</button>
        {secMsg && <span className="small" role="status">{secMsg}</span>}
      </form>
      {Object.keys(sections).length === 0 && <p className="muted">No sections yet. Add one above or import a class record.</p>}
      {Object.entries(sections).map(([id, sec]) => <SectionEditor key={id} db={db} id={id} section={sec} roster={roster} />)}
    </>
  );
}
