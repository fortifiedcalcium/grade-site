import React, { useMemo, useState } from "react";
import { computeGrade, isNum } from "../../lib/grading.js";
import { addStudent, clearSectionScores, removeStudent, removeStudents, saveScore } from "../../lib/db.js";
import { useSelection } from "../../lib/useSelection.js";
import { buildStats, filterAndSort, namesText, SORT_OPTIONS, STATUS_OPTIONS } from "../../lib/stats.js";
import { buildReport, FORMATS } from "../../lib/report.js";
import { downloadBlob, loadAssets, makeReportFile } from "../../lib/exporters.js";
import { parseScoreInput, fmt2, fmtNum } from "../../lib/util.js";

function ScoreCell({ value, max, onCommit }) {
  const shown = value == null ? "" : String(value);
  const [text, setText] = useState(shown);
  const [state, setState] = useState("");
  const [prev, setPrev] = useState(shown);
  if (shown !== prev) { // database changed (e.g. another device): show it
    setPrev(shown);
    setText(shown);
  }
  const over = isNum(parseScoreInput(text)) && parseScoreInput(text) > max;
  const commit = async () => {
    if (text.trim() === shown) return;
    const v = parseScoreInput(text);
    setState("saving");
    try {
      await onCommit(v);
      setState("");
    } catch (e) {
      setState("error");
    }
  };
  return (
    <input
      className={"cell" + (over ? " over" : "") + (state === "error" ? " err" : "") + (state === "saving" ? " saving" : "")}
      value={text}
      inputMode="decimal"
      title={over ? "Higher than the maximum of " + max : state === "error" ? "Not saved – try again" : ""}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(shown); e.currentTarget.blur(); } }}
    />
  );
}

export default function GradesTab({ db, meta, sections, roster, records, goImport }) {
  const secIds = Object.keys(sections);
  const [secId, setSecId] = useState(secIds[0] || "");
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ id: "", name: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState("xlsx");
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("name");
  const [show, setShow] = useState("both");
  const [hiddenCats, setHiddenCats] = useState([]);
  const [showFinal, setShowFinal] = useState(true);
  const sec = sections[secId] || sections[secIds[0]];
  const activeId = sections[secId] ? secId : secIds[0];

  const graded = useMemo(() => {
    if (!sec) return [];
    return Object.entries(roster)
      .filter(([, r]) => r.sec === activeId)
      .filter(([id, r]) => !q || (id + " " + r.name).toLowerCase().includes(q.toLowerCase()))
      .map(([id, r]) => {
        const s = (records[r.key] && records[r.key].s) || {};
        return { id, name: r.name, key: r.key, s, g: computeGrade(sec.scheme, s) };
      });
  }, [roster, records, activeId, q, sec]);
  const rows = useMemo(() => filterAndSort(graded, status, sort), [graded, status, sort]);

  const sel = useSelection(rows.map((r) => r.id));

  if (!secIds.length) {
    return (
      <div className="card">
        <p>No sections yet. Import your class record, or add a section under Settings.</p>
        <button className="btn primary" onClick={goImport}>Go to Import</button>
      </div>
    );
  }

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
      setMsg("Added " + r.id + ". PIN: " + r.pin + " (also under Students & PINs)");
    });
  };
  const removeSelected = () => {
    const list = rows.filter((r) => sel.has(r.id)).map((r) => ({ id: r.id, key: r.key }));
    if (!list.length) return;
    if (!window.confirm("Delete " + list.length + " selected student" + (list.length === 1 ? "" : "s") + " and all of their scores? This cannot be undone.")) return;
    guard(async () => { await removeStudents(db, list); sel.clear(); setMsg("Deleted " + list.length + " student" + (list.length === 1 ? "" : "s") + "."); });
  };
  const clearScores = () => {
    const n = Object.values(roster).filter((r) => r.sec === activeId).length;
    if (!n) return setMsg("This section has no students.");
    if (!window.confirm('Clear ALL scores for the ' + n + ' student' + (n === 1 ? "" : "s") + ' in "' + sec.name + '"? Students and PINs stay. This cannot be undone.')) return;
    guard(async () => { await clearSectionScores(db, activeId, roster); setMsg("Cleared the scores of " + n + " student" + (n === 1 ? "" : "s") + "."); });
  };
  const remove = (r) => window.confirm("Delete " + r.name + " and all of their scores?") && guard(() => removeStudent(db, r.id, r.key));

  const allCats = sec.scheme.categories;
  const cats = allCats.filter((c) => !hiddenCats.includes(c.id));
  const items = cats.flatMap((c) => (c.items || []).map((i) => ({ ...i, cat: c.id })));
  const showStudents = show !== "stats";
  const showStats = show !== "students";
  const stats = buildStats(sec, rows, cats.map((c) => c.id));
  const statCells = [["Highest", "max"], ["Lowest", "min"], ["Average", "avg"]];
  const fmtStat = (v) => (isNum(v) ? fmt2(v) : "—");
  const toggleCat = (id) => setHiddenCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /* one line describing what is filtered, printed on the exports */
  const filterNote = [
    status !== "all" && "Status: " + STATUS_OPTIONS.find(([id]) => id === status)[1],
    q && 'Search: "' + q + '"',
    (hiddenCats.some((id) => allCats.some((c) => c.id === id)) || !showFinal) && "Columns: " + [...cats.map((c) => c.title), ...(showFinal ? ["Final grade"] : [])].join(", "),
    sort !== "name" && "Sorted by: " + SORT_OPTIONS.find(([id]) => id === sort)[1],
    show !== "both" && (show === "stats" ? "Statistics only" : "Students only"),
  ].filter(Boolean).join("  ·  ");

  const exportReport = async () => {
    setExporting(true);
    setMsg("");
    try {
      const report = buildReport({ sec, meta, students: rows.map((r) => ({ id: r.id, name: r.name, s: r.s })), view: { hiddenCats, showFinal, show, filterNote } });
      const assets = format === "csv" ? null : await loadAssets();
      const { blob, filename } = await makeReportFile(format, report, assets);
      downloadBlob(blob, filename);
      setMsg("Exported " + filename + " (" + rows.length + " student" + (rows.length === 1 ? "" : "s") + ").");
    } catch (e) {
      console.error("Export failed:", e);
      setMsg("Could not export: " + (e.message || "unknown error"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="row toolbar">
        <label className="inline">Section
          <select value={activeId} onChange={(e) => setSecId(e.target.value)}>
            {secIds.map((id) => <option key={id} value={id}>{sections[id].name}</option>)}
          </select>
        </label>
        <input className="search" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{rows.length === graded.length ? rows.length : rows.length + " of " + graded.length} students · changes save automatically and appear on students' screens when they refresh</span>
        <label className="inline">Export as
          <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Export format">
            {FORMATS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <button className="btn" disabled={exporting || !rows.length} onClick={exportReport}>{exporting ? "Exporting…" : "Export"}</button>
        <button className="btn danger" disabled={busy} onClick={clearScores}>Clear all scores</button>
        {sel.selected.length > 0 && (
          <>
            <button className="btn danger" disabled={busy} onClick={removeSelected}>Delete selected ({sel.selected.length})</button>
            <button className="btn ghost" onClick={sel.clear}>Clear selection</button>
          </>
        )}
      </div>
      <div className="row toolbar filters">
        <label className="inline">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="inline">Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="inline">View
          <select value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="both">Students and statistics</option>
            <option value="students">Students only</option>
            <option value="stats">Statistics only</option>
          </select>
        </label>
        <fieldset className="colpick">
          <legend>Columns</legend>
          {allCats.map((c) => (
            <label className="inline" key={c.id}><input type="checkbox" checked={!hiddenCats.includes(c.id)} onChange={() => toggleCat(c.id)} /> {c.title}</label>
          ))}
          <label className="inline"><input type="checkbox" checked={showFinal} onChange={(e) => setShowFinal(e.target.checked)} /> Final grade</label>
          <button type="button" className="btn small" onClick={() => { setHiddenCats([]); setShowFinal(true); }}>Show all</button>
        </fieldset>
      </div>
      <div className="card flush">
        <div className="scroll tall">
          <table className="grid sheet">
            <thead>
              <tr>
                <th rowSpan={2} className="stick l1">
                  <label className="inline"><input type="checkbox" aria-label="Select all students" checked={sel.allOn} onChange={(e) => sel.setAll(e.target.checked)} /> No.</label>
                </th>
                <th rowSpan={2} className="stick l2">Name</th>
                {cats.map((c) => <th key={c.id} colSpan={(c.items || []).length} className="grp">{c.title} ({fmtNum(c.weight)}%)</th>)}
                {showFinal && <><th rowSpan={2} className="num">Final</th><th rowSpan={2} className="num">Eq.</th><th rowSpan={2}>Remarks</th></>}
                <th rowSpan={2}><span className="sr-only">Delete</span></th>
              </tr>
              <tr>
                {cats.flatMap((c) => (c.items || []).map((i) => <th key={i.k} className="num sub" title={i.label}>{i.label}<br /><span className="muted">/{fmtNum(i.max)}</span></th>))}
              </tr>
            </thead>
            <tbody>
              {showStudents && rows.map((r) => {
                const g = r.g;
                return (
                  <tr key={r.id}>
                    <td className="stick l1">
                      <label className="inline"><input type="checkbox" aria-label={"Select " + r.name} checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /> {r.id}</label>
                    </td>
                    <td className="stick l2">{r.name}</td>
                    {items.map((i) => (
                      <td key={i.k} className="num">
                        <ScoreCell value={r.s[i.k]} max={i.max} onCommit={(v) => saveScore(db, r.key, i.k, v)} />
                      </td>
                    ))}
                    {showFinal && (
                      <>
                        <td className="num"><strong>{g.pending ? "—" : fmt2(g.total)}</strong></td>
                        <td className="num">{g.pending ? "—" : g.equiv.toFixed(2)}</td>
                        <td className={g.pending ? "muted" : g.remarks === "Passed" ? "ok" : "bad"}>{g.pending ? "Pending" : g.remarks}</td>
                      </>
                    )}
                    <td><button className="btn small danger" disabled={busy} aria-label={"Delete " + r.name} onClick={() => remove(r)}>Delete</button></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={items.length + (showFinal ? 3 : 0) + 3} className="muted">No students found.</td></tr>}
            </tbody>
            {showStats && rows.length > 0 && (
              <tfoot>
                {statCells.map(([label, pick]) => (
                  <tr key={pick} className="stat">
                    <th className="stick l1">{label}</th>
                    <th className="stick l2"></th>
                    {items.map((i) => <td key={i.k} className="num">{fmtStat(stats.items[i.k][pick])}</td>)}
                    {showFinal && (
                      <>
                        <td className="num">{fmtStat(stats.final[pick])}</td>
                        <td className="num">{pick === "avg" ? fmtStat(stats.equiv.avg) : "—"}</td>
                        <td></td>
                      </>
                    )}
                    <td></td>
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {showStats && rows.length > 0 && (
        <section className="card flush" aria-label="Statistics by component">
          <h2 className="card-title">Statistics</h2>
          <p className="muted small card-note">Points earned out of each component's weight, for the {rows.length} student{rows.length === 1 ? "" : "s"} shown. Blank scores are not counted. "Average scored by" is the student whose points are closest to the average.</p>
          <div className="scroll">
            <table className="grid">
              <thead><tr><th>Component</th><th className="num">Weight</th><th className="num">Counted</th><th className="num">Highest</th><th className="num">Lowest</th><th className="num">Average</th><th>Highest scored by</th><th>Lowest scored by</th><th>Average scored by</th></tr></thead>
              <tbody>
                {stats.cats.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td><td className="num">{fmtNum(c.weight)}%</td><td className="num">{c.n}</td>
                    <td className="num">{fmtStat(c.max)}</td><td className="num">{fmtStat(c.min)}</td><td className="num">{fmtStat(c.avg)}</td>
                    <td>{namesText(c.highest)}</td><td>{namesText(c.lowest)}</td><td>{namesText(c.closest)}</td>
                  </tr>
                ))}
                {showFinal && (
                  <tr className="hl">
                    <td>Final grade</td><td className="num">{fmtNum(allCats.reduce((a, c) => a + (isNum(c.weight) ? c.weight : 0), 0))}%</td><td className="num">{stats.final.n}</td>
                    <td className="num">{fmtStat(stats.final.max)}</td><td className="num">{fmtStat(stats.final.min)}</td><td className="num">{fmtStat(stats.final.avg)}</td>
                    <td>{namesText(stats.final.highest)}</td><td>{namesText(stats.final.lowest)}</td><td>{namesText(stats.final.closest)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {msg && <div className="banner info" role="status">{msg}</div>}
      <form className="card row noprint" onSubmit={add}>
        <strong>Add a student to this section</strong>
        <input aria-label="Student number" placeholder="Student number" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
        <input aria-label="Full name" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <button className="btn primary" disabled={busy}>Add</button>
      </form>
      <p className="muted small">Leave a cell empty for no score (counts as 0). Text such as INC or DRP is shown to the student but counts as 0.</p>
    </>
  );
}
