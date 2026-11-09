import React, { useMemo, useRef, useState } from "react";
import Icon from "../../Icon.jsx";
import { addStudent, removeStudent, removeStudents, resetPin, saveEmails, markEmailed } from "../../lib/db.js";
import { useSelection } from "../../lib/useSelection.js";
import { csvCell, downloadText } from "../../lib/util.js";
import { buildMailMergeRows, mailMergeCsv } from "../../lib/mailmerge.js";
import { isValidEmail, parseEmailCsv } from "../../lib/emailpins.js";
import { studentNo, safeId } from "../../lib/keys.js";
import EmailPanel from "./EmailPanel.jsx";
import { SectionPicker, useSectionPicker } from "../../lib/sectionPicker.jsx";

export default function PinsTab({ db, meta, sections, roster, user }) {
  const picker = useSectionPicker(sections);
  const secIds = picker.allIds;
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const fileRef = useRef(null);
  const [form, setForm] = useState({ id: "", name: "" });
  const activeId = picker.activeId;

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
      const r = await addStudent(db, meta, { id: form.id, name: form.name, sec: activeId }, roster);
      setForm({ id: "", name: "" });
      setMsg("Added " + r.no + ". PIN: " + r.pin);
    });
  };

  const changeEmail = (id, r, value) => {
    const v = value.trim();
    if (v === (r.email || "")) return;
    if (v && !isValidEmail(v)) { setMsg("\"" + v + "\" is not a valid email address."); return; }
    guard(async () => { await saveEmails(db, [{ id, email: v }]); });
  };

  /* A CSV with "Student no." and "Email" columns; rows whose Status starts with "Sent" are marked as already emailed */
  const importEmails = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    guard(async () => {
      const rows = parseEmailCsv(await file.text());
      // a student in several sections has one roster row per section; the email applies to all of them
      const rowIds = (no) => Object.keys(roster).filter((id) => studentNo(id) === safeId(no));
      const good = rows.filter((r) => rowIds(r.id).length && isValidEmail(r.email)).flatMap((r) => rowIds(r.id).map((id) => ({ ...r, id })));
      const bad = rows.length - rows.filter((r) => rowIds(r.id).length && isValidEmail(r.email)).length;
      if (!good.length) throw new Error("No usable rows. The file needs a 'Student no.' column and an 'Email' column.");
      await saveEmails(db, good.map((r) => ({ id: r.id, email: r.email })));
      const sent = good.filter((r) => r.sent).map((r) => r.id);
      if (sent.length) await markEmailed(db, sent);
      setMsg("Saved " + good.length + " email" + (good.length === 1 ? "" : "s") + (sent.length ? "; " + sent.length + " marked as already emailed" : "") + (bad ? "; ignored " + bad + " row" + (bad === 1 ? "" : "s") + " (unknown student number or invalid email)." : "."));
    });
  };

  const exportCsv = () => {
    const lines = [["Student no.", "Name", "Section", "PIN"].join(",")];
    rows.forEach(([id, r]) => lines.push([studentNo(id), r.name, sections[r.sec] ? sections[r.sec].name : r.sec, r.pin].map(csvCell).join(",")));
    downloadText("pins-" + (sections[activeId] ? sections[activeId].name : "section") + ".csv", lines.join("\n"));
  };

  const exportMailMerge = () => {
    const list = buildMailMergeRows(roster, sections, window.location.origin);
    downloadText("pin-mail-merge.csv", mailMergeCsv(list));
    setMsg("Downloaded pin-mail-merge.csv with " + list.length + " students from all sections. Add their emails, then follow mailmerge/README.md to send the PINs from Gmail.");
  };

  if (!secIds.length) return <div className="card"><p>No sections yet. Import your class record or add a section under Settings first.</p></div>;

  return (
    <>
      <div className="row toolbar">
        <SectionPicker picker={picker} sections={sections} />
        <input className="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show PINs</label>
        <button className="btn" onClick={exportCsv}><Icon name="download" /> Download PIN list</button>
        <button className="btn" onClick={() => window.print()}><Icon name="print" /> Print</button>
        <button className="btn primary" onClick={() => setEmailing((x) => !x)}><Icon name="mail" /> Email PINs</button>
        <button className="btn" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} title="Fill in student emails from a CSV with Student no. and Email columns"><Icon name="upload" /> Import emails (CSV)</button>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" hidden onChange={importEmails} aria-label="Email CSV file" />
        <button className="btn" onClick={exportMailMerge} title="All sections, ready for the Gmail mail merge"><Icon name="mail" /> Mail merge file</button>
        {sel.selected.length > 0 && (
          <>
            <button className="btn danger" disabled={busy} onClick={removeSelected}><Icon name="trash" /> Delete selected ({sel.selected.length})</button>
            <button className="btn ghost" onClick={sel.clear}><Icon name="close" /> Clear selection</button>
          </>
        )}
      </div>
      {msg && <div className="banner info" role="status"><Icon name="info" /> {msg}</div>}
      {emailing && <EmailPanel db={db} user={user} roster={roster} sections={sections} activeId={activeId} selectedIds={sel.selected} onClose={() => setEmailing(false)} />}
      <div className="card flush">
        <div className="scroll tall">
          <table className="grid">
            <thead><tr><th className="noprint"><input type="checkbox" aria-label="Select all students" checked={sel.allOn} onChange={(e) => sel.setAll(e.target.checked)} /></th><th>Student no.</th><th>Name</th><th>Email</th><th>PIN</th><th className="noprint"></th></tr></thead>
            <tbody>
              {rows.map(([id, r]) => (
                <tr key={id}>
                  <td className="noprint"><input type="checkbox" aria-label={"Select " + r.name} checked={sel.has(id)} onChange={() => sel.toggle(id)} /></td>
                  <td>{studentNo(id)}</td>
                  <td>{r.name}</td>
                  <td className="noprint"><input type="email" aria-label={"Email of " + r.name} defaultValue={r.email || ""} key={id + (r.email || "")} placeholder="name@example.com" onBlur={(e) => changeEmail(id, r, e.target.value)} />
                    {r.emailed ? <div className="muted small">PIN emailed {new Date(r.emailed).toLocaleDateString()}</div> : null}</td>
                  <td className="mono">{show ? r.pin : "••••••"}</td>
                  <td className="noprint right"><div className="actions">
                    <button className="btn small" disabled={busy} onClick={() => window.confirm("Make a new PIN for " + r.name + "? The old PIN will stop working.") && guard(async () => { const p = await resetPin(db, meta, id, r); setMsg("New PIN for " + studentNo(id) + ": " + p); })}><Icon name="key" /> Reset PIN</button>
                    <button className="btn small danger" disabled={busy} onClick={() => window.confirm("Delete " + r.name + " and all of their scores?") && guard(() => removeStudent(db, id, r.key))}><Icon name="trash" /> Delete</button></div></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="muted">No students.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <form className="card row noprint" onSubmit={add}>
        <strong>Add a student to this section</strong>
        <input placeholder="Student number" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
        <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <button className="btn primary" disabled={busy}><Icon name="plus" /> Add</button>
      </form>
      <p className="muted small noprint">Give each student their own PIN privately. Treat the PIN list like a grade sheet: it is personal data.</p>
    </>
  );
}
