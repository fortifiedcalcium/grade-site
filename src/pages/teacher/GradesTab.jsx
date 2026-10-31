import React, { useMemo, useState } from "react";
import { computeGrade, isNum } from "../../lib/grading.js";
import { saveScore } from "../../lib/db.js";
import { parseScoreInput, fmt2, fmtNum, csvCell, downloadText } from "../../lib/util.js";

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

export default function GradesTab({ db, sections, roster, records, goImport }) {
  const secIds = Object.keys(sections);
  const [secId, setSecId] = useState(secIds[0] || "");
  const [q, setQ] = useState("");
  const sec = sections[secId] || sections[secIds[0]];
  const activeId = sections[secId] ? secId : secIds[0];

  const rows = useMemo(() => {
    if (!sec) return [];
    return Object.entries(roster)
      .filter(([, r]) => r.sec === activeId)
      .filter(([id, r]) => !q || (id + " " + r.name).toLowerCase().includes(q.toLowerCase()))
      .map(([id, r]) => ({ id, name: r.name, key: r.key, s: (records[r.key] && records[r.key].s) || {} }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, records, activeId, q, sec]);

  if (!secIds.length) {
    return (
      <div className="card">
        <p>No sections yet. Import your class record to get started.</p>
        <button className="btn primary" onClick={goImport}>Go to Import</button>
      </div>
    );
  }

  const cats = sec.scheme.categories;
  const items = cats.flatMap((c) => (c.items || []).map((i) => ({ ...i, cat: c.id })));

  const exportCsv = () => {
    const head = ["Student no.", "Name", ...items.map((i) => cats.find((c) => c.id === i.cat).title + " " + i.label), "Final grade", "Equivalent", "Remarks"];
    const lines = [head.map(csvCell).join(",")];
    rows.forEach((r) => {
      const g = computeGrade(sec.scheme, r.s);
      lines.push([r.id, r.name, ...items.map((i) => (r.s[i.k] == null ? "" : r.s[i.k])), g.total, g.equiv.toFixed(2), g.remarks].map(csvCell).join(","));
    });
    downloadText((sec.name || "grades") + "-grades.csv", lines.join("\n"));
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
        <span className="muted small">{rows.length} students · changes save automatically and appear on students' screens when they refresh</span>
        <button className="btn" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="card flush">
        <div className="scroll tall">
          <table className="grid sheet">
            <thead>
              <tr>
                <th rowSpan={2} className="stick l1">No.</th>
                <th rowSpan={2} className="stick l2">Name</th>
                {cats.map((c) => <th key={c.id} colSpan={(c.items || []).length} className="grp">{c.title} ({fmtNum(c.weight)}%)</th>)}
                <th rowSpan={2} className="num">Final</th>
                <th rowSpan={2} className="num">Eq.</th>
                <th rowSpan={2}>Remarks</th>
              </tr>
              <tr>
                {cats.flatMap((c) => (c.items || []).map((i) => <th key={i.k} className="num sub" title={i.label}>{i.label}<br /><span className="muted">/{fmtNum(i.max)}</span></th>))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const g = computeGrade(sec.scheme, r.s);
                return (
                  <tr key={r.id}>
                    <td className="stick l1">{r.id}</td>
                    <td className="stick l2">{r.name}</td>
                    {items.map((i) => (
                      <td key={i.k} className="num">
                        <ScoreCell value={r.s[i.k]} max={i.max} onCommit={(v) => saveScore(db, r.key, i.k, v)} />
                      </td>
                    ))}
                    <td className="num"><strong>{g.pending ? "—" : fmt2(g.total)}</strong></td>
                    <td className="num">{g.pending ? "—" : g.equiv.toFixed(2)}</td>
                    <td className={g.pending ? "muted" : g.remarks === "Passed" ? "ok" : "bad"}>{g.pending ? "Pending" : g.remarks}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={items.length + 5} className="muted">No students found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted small">Leave a cell empty for no score (counts as 0). Text such as INC or DRP is shown to the student but counts as 0.</p>
    </>
  );
}
