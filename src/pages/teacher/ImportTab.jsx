import React, { useState } from "react";
import Icon from "../../Icon.jsx";
import { sheetsFromWorkbook, parseClassRecord } from "../../lib/importer.js";
import { importData } from "../../lib/db.js";

export default function ImportTab({ db, meta, sections, roster }) {
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState("");
  const [details, setDetails] = useState({ title: meta.title || "", term: meta.term || "", note: meta.note || "" });
  const [removeMissing, setRemoveMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setError(""); setResult(null); setParsed(null); setFileName(f.name);
    try {
      const XLSX = await import("xlsx");
      const res = parseClassRecord(sheetsFromWorkbook(XLSX, await f.arrayBuffer(), "array"));
      if (res.errors.length) { setError(res.errors.join(" ")); return; }
      setParsed(res);
      setDetails((d) => ({ title: d.title || res.title || "", term: d.term || res.term || "", note: d.note }));
    } catch (err) {
      setError("Could not read that file. Use the .xlsx class record.");
    }
  };

  const run = async () => {
    setBusy(true); setError(""); setProgress(0);
    try {
      setResult(await importData(db, parsed, { meta, sections, roster, details, removeMissing, onProgress: setProgress }));
      setParsed(null);
    } catch (err) {
      setError("Import failed: " + (err.message || "unknown error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2><Icon name="import" /> Import class record (.xlsx)</h2>
        <p className="muted">
          Reads every visible sheet of your class record. Scores in the file replace the scores in the database for the same students.
          Existing students keep their PINs; new students get a new PIN.
        </p>
        <input type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={onFile} disabled={busy} />
        {error && <p className="error" role="alert"><Icon name="alert" /> {error}</p>}
      </div>

      {parsed && (
        <div className="card">
          <h2><Icon name="check" /> Ready to import: {fileName}</h2>
          <div className="scroll">
          <table className="grid">
            <thead><tr><th>Section</th><th className="num">Students</th><th>Categories</th></tr></thead>
            <tbody>
              {parsed.sections.map((s) => (
                <tr key={s.id}><td>{s.name}</td><td className="num">{s.count}</td><td>{s.scheme.categories.map((c) => c.title + " " + c.weight + "%").join(", ")}</td></tr>
              ))}
            </tbody>
          </table>
          </div>
          {parsed.notes.map((n, i) => <p key={"n" + i} className="muted small">{n}</p>)}
          {parsed.warnings.length > 0 && (
            <details open>
              <summary>{parsed.warnings.length} warning(s)</summary>
              <ul>{parsed.warnings.map((w, i) => <li key={i} className="small">{w}</li>)}</ul>
            </details>
          )}
          {parsed.mismatches.length > 0 && (
            <details open>
              <summary>Final grade differs from your file for {parsed.mismatches.length} student(s)</summary>
              <p className="muted small">The app recomputes grades from the raw scores. Check these rows in your spreadsheet, the formula may be off.</p>
              <ul>{parsed.mismatches.map((m, i) => <li key={i} className="small">{m.id} ({m.section}): file {m.sheet}, app {m.app}</li>)}</ul>
            </details>
          )}
          <div className="form-grid">
            <label><Icon name="tag" /> Page title<input value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} /></label>
            <label><Icon name="calendar" /> Term<input value={details.term} onChange={(e) => setDetails({ ...details, term: e.target.value })} /></label>
            <label className="span2"><Icon name="note" /> Note shown to students<input value={details.note} onChange={(e) => setDetails({ ...details, note: e.target.value })} /></label>
          </div>
          <label className="inline"><input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} /> Delete students that are in the database but not in this file</label>
          <p><button className="btn primary" onClick={run} disabled={busy}><Icon name="import" /> {busy ? "Importing… " + progress + "/" + parsed.students.length : "Import " + parsed.students.length + " students"}</button></p>
        </div>
      )}

      {result && (
        <div className="banner info">
          Imported {result.total} students ({result.created} new with new PINs, {result.kept} kept their PIN{result.removed ? ", " + result.removed + " removed" : ""}).
          Open "Students & PINs" to hand out PINs.
        </div>
      )}
    </>
  );
}
