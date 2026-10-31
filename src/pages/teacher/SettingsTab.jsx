import React, { useState } from "react";
import { saveMeta, saveSection } from "../../lib/db.js";

function SectionEditor({ db, id, section }) {
  const [s, setS] = useState(() => JSON.parse(JSON.stringify(section)));
  const [msg, setMsg] = useState("");
  const setCat = (ci, patch) => setS({ ...s, scheme: { ...s.scheme, categories: s.scheme.categories.map((c, i) => (i === ci ? { ...c, ...patch } : c)) } });
  const setItem = (ci, ii, patch) => setCat(ci, { items: s.scheme.categories[ci].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });
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
        <thead><tr><th>Category</th><th className="num">Weight %</th><th>Items (max score)</th></tr></thead>
        <tbody>
          {s.scheme.categories.map((c, ci) => (
            <tr key={c.id}>
              <td><input value={c.title} onChange={(e) => setCat(ci, { title: e.target.value })} /></td>
              <td className="num"><input className="short" type="number" value={c.weight} onChange={(e) => setCat(ci, { weight: Number(e.target.value) })} /></td>
              <td>
                {(c.items || []).map((it, ii) => (
                  <span className="chip" key={it.k}>
                    <input className="lbl" value={it.label} onChange={(e) => setItem(ci, ii, { label: e.target.value })} />
                    <input className="short" type="number" value={it.max} onChange={(e) => setItem(ci, ii, { max: Number(e.target.value) })} />
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {total !== 100 && <p className="error">Weights add up to {total}%, not 100%.</p>}
      <p className="muted small">Changing a maximum score or weight changes every student's computed grade immediately.</p>
      <button className="btn primary" onClick={save}>Save {s.name}</button> {msg && <span className="small">{msg}</span>}
    </details>
  );
}

export default function SettingsTab({ db, meta, sections }) {
  const [m, setM] = useState({ title: meta.title || "", term: meta.term || "", note: meta.note || "" });
  const [msg, setMsg] = useState("");
  const save = async (e) => {
    e.preventDefault();
    try { await saveMeta(db, m); setMsg("Saved."); } catch (err) { setMsg("Not saved: " + err.message); }
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
      {Object.keys(sections).length === 0 && <p className="muted">Import a class record first.</p>}
      {Object.entries(sections).map(([id, sec]) => <SectionEditor key={id} db={db} id={id} section={sec} />)}
    </>
  );
}
