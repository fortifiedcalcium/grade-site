import React, { useMemo, useState } from "react";
import { addStudent, removeStudent, removeStudents, resetPin } from "../../lib/db.js";
import { useSelection } from "../../lib/useSelection.js";
import { csvCell, downloadText } from "../../lib/util.js";

export default function PinsTab({ db, meta, sections, roster }) {
  const secIds = Object.keys(sections);
  const [secId, setSecId] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: "", name: "" });
  const activeId = sections[secId] ? secId : secIds[0] || "";

  const rows = useMemo(
    () =>
      Object.entries(roster)
        .filter(([, r]) => r.sec === activeId)
        .filter(([id, r]) => !q || (id + " " + r.name).toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a[1].name.localeCompare(b[1].name)),
    [roster, activeId, q]
  );

  const sel = useSelection(rows.map(([id]) => id));
  const removeSelected = () => {
    const list = rows.filter(([id]) => sel.has(id)).map(([id, r]) => ({ id, key: r.key }));
    if (!list.length) return;
    if (!window.confirm("Delete " + list.length + " selected student" + (list.length === 1 ? "" : "s") + " and all of their scores? This cannot be undone.")) return;
    guard(async () => { await removeStudents(db, list); sel.clear(); setMsg("Deleted " + list.length + " student" + (list.length === 1 ? "" : "s") + "."); });
  };

  const guard = async (fn) => {
    setBusy(true);
    setMsg("");
    try { await fn(); } catch (e) { setMsg(e.message || "Something went wrong."); } finally { setBusy(false); }
  };

  const add = (e) => {
    e.preventDefault();
    guard(async () => {
      const r = await addStudent(db, meta, { id: form.id, name: form.name, sec: activeId });
      setForm({ id: "", name: "" });
      setMsg("Added " + r.id + ". PIN: " + r.pin);
    });
  };

  const exportCsv = () => {
    const lines = [["Student no.", "Name", "Section", "PIN"].join(",")];
    rows.forEach(([id, r]) => lines.push([id, r.name, sections[r.sec] ? sections[r.sec].name : r.sec, r.pin].map(csvCell).join(",")));
    downloadText("pins-" + (sections[activeId] ? sections[activeId].name : "section") + ".csv", lines.join("\n"));
  };

  if (!secIds.length) return <div className="card"><p>No sections yet. Import your class record or add a section under Settings first.</p></div>;

  return (
    <>
      <div className="row toolbar">
        <label className="inline">Section
          <select value={activeId} onChange={(e) => setSecId(e.target.value)}>
            {secIds.map((id) => <option key={id} value={id}>{sections[id].name}</option>)}
          </select>
        </label>
        <input className="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show PINs</label>
        <button className="btn" onClick={exportCsv}>Download PIN list</button>
        <button className="btn" onClick={() => window.print()}>Print</button>
        {sel.selected.length > 0 && (
          <>
            <button className="btn danger" disabled={busy} onClick={removeSelected}>Delete selected ({sel.selected.length})</button>
            <button className="btn ghost" onClick={sel.clear}>Clear selection</button>
          </>
        )}
      </div>
      {msg && <div className="banner info">{msg}</div>}
      <div className="card flush">
        <div className="scroll tall">
          <table className="grid">
            <thead><tr><th className="noprint"><input type="checkbox" aria-label="Select all students" checked={sel.allOn} onChange={(e) => sel.setAll(e.target.checked)} /></th><th>Student no.</th><th>Name</th><th>PIN</th><th className="noprint"></th></tr></thead>
            <tbody>
              {rows.map(([id, r]) => (
                <tr key={id}>
                  <td className="noprint"><input type="checkbox" aria-label={"Select " + r.name} checked={sel.has(id)} onChange={() => sel.toggle(id)} /></td>
                  <td>{id}</td>
                  <td>{r.name}</td>
                  <td className="mono">{show ? r.pin : "••••••"}</td>
                  <td className="noprint right"><div className="actions">
                    <button className="btn small" disabled={busy} onClick={() => window.confirm("Make a new PIN for " + r.name + "? The old PIN will stop working.") && guard(async () => { const p = await resetPin(db, meta, id, r); setMsg("New PIN for " + id + ": " + p); })}>Reset PIN</button>
                    <button className="btn small danger" disabled={busy} onClick={() => window.confirm("Delete " + r.name + " and all of their scores?") && guard(() => removeStudent(db, id, r.key))}>Delete</button></div></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="muted">No students.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <form className="card row noprint" onSubmit={add}>
        <strong>Add a student to this section</strong>
        <input placeholder="Student number" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
        <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <button className="btn primary" disabled={busy}>Add</button>
      </form>
      <p className="muted small noprint">Give each student their own PIN privately. Treat the PIN list like a grade sheet: it is personal data.</p>
    </>
  );
}
