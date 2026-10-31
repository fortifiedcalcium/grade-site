import React, { useMemo, useState } from "react";
import { getDb } from "../supabase.js";
import { createStudentApi } from "../lib/db.js";
import { computeGrade, hasValue, isNum, usableScale } from "../lib/grading.js";
import { fmt2, fmtNum, fmtDate } from "../lib/util.js";

const ERRORS = {
  nomatch: "We couldn't find a record with that student number and PIN. Check both and try again.",
  notpublished: "Grades have not been published yet. Please check back later.",
  timeout: "The connection timed out. Check your internet and try again.",
};

const TABS = [
  ["summary", "Summary"],
  ["scores", "Scores"],
  ["scale", "Grade scale"],
];

/* Same frame as the instructor page: header with the logo, tab bar, then cards and grid tables. */
function GradeView({ data, onRefresh, onLogout, busy }) {
  const { record, section, meta } = data;
  const [tab, setTab] = useState("summary");
  const view = useMemo(() => {
    if (!section || !section.scheme) return null;
    return { grade: computeGrade(section.scheme, record.s), scheme: section.scheme };
  }, [record, section]);

  return (
    <main className="shell wide">
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="/bulsu-logo.png" alt="Bulacan State University" />
          <div>
            <h1>{meta.title || "Student Grade Portal"}</h1>
            <p className="muted small">{[record.name, record.id].filter(Boolean).join(" · ")}{meta.term ? " · " + meta.term : ""}</p>
          </div>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
          <button className="btn ghost" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === "summary" && (
        <>
          <section className="card">
            <h2>{record.name}</h2>
            <dl className="facts">
              <div><dt>Student no.</dt><dd>{record.id}</dd></div>
              <div><dt>Section</dt><dd>{(section && section.name) || record.sec}</dd></div>
              {section && section.subject && (section.subject.code || section.subject.desc) && (
                <div><dt>Subject</dt><dd>{[section.subject.code, section.subject.desc].filter(Boolean).join(" – ")}</dd></div>
              )}
              {section && section.instructor && <div><dt>Instructor</dt><dd>{section.instructor}</dd></div>}
              {section && section.roomTime && <div><dt>Room / time</dt><dd>{section.roomTime}</dd></div>}
            </dl>
            {record.updated && <p className="muted small">Last updated {fmtDate(record.updated)}</p>}
          </section>

          {!view ? (
            <section className="card"><p>Your section's grading details are not available yet.</p></section>
          ) : (
            <>
              <section className="card summary">
                {view.grade.pending ? (
                  <div className="pending">Final grade pending – the final exam has not been recorded yet.</div>
                ) : (
                  <>
                    <div><span className="label">Final grade</span><strong className="big">{fmt2(view.grade.total)}</strong></div>
                    <div><span className="label">Equivalent</span><strong className="big">{view.grade.equiv.toFixed(2)}</strong></div>
                    <div>
                      <span className="label">Remarks</span>
                      <strong className={"big " + (view.grade.remarks === "Passed" ? "ok" : "bad")}>{view.grade.remarks}</strong>
                    </div>
                  </>
                )}
              </section>

              <section className="card flush">
                <div className="scroll">
                  <table className="grid">
                    <thead>
                      <tr><th>Component</th><th className="num">Weight</th><th className="num">Points earned</th></tr>
                    </thead>
                    <tbody>
                      {view.grade.cats.map((c) => (
                        <tr key={c.id}>
                          <td>{c.title}{c.entered < c.count && <span className="muted small"> ({c.entered}/{c.count} recorded)</span>}</td>
                          <td className="num">{fmtNum(c.weight)}%</td>
                          <td className="num">{fmt2(c.pts)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><th>Total</th><th className="num">{fmtNum(view.grade.cats.reduce((a, c) => a + c.weight, 0))}%</th><th className="num">{fmt2(view.grade.total)}</th></tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {tab === "scores" && (!view ? (
        <section className="card"><p>Your section's grading details are not available yet.</p></section>
      ) : (
        view.scheme.categories.map((c) => (
          <section className="card flush" key={c.id}>
            <div className="scroll">
              <table className="grid">
                <thead><tr><th>{c.title} ({fmtNum(c.weight)}%)</th><th className="num">Score</th><th className="num">Max</th></tr></thead>
                <tbody>
                  {(c.items || []).map((i) => {
                    const v = record.s && record.s[i.k];
                    return (
                      <tr key={i.k}>
                        <td>{i.label}</td>
                        <td className="num">{hasValue(v) ? (isNum(v) ? fmtNum(v) : v) : <span className="muted">–</span>}</td>
                        <td className="num">{fmtNum(i.max)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      ))}

      {tab === "scale" && (!view ? (
        <section className="card"><p>Your section's grading details are not available yet.</p></section>
      ) : (
        <section className="card flush">
          {view.scheme.scaleNote && <p className="muted small" style={{ padding: "10px 14px 0", margin: 0 }}>{view.scheme.scaleNote}</p>}
          <div className="scroll">
            <table className="grid">
              <thead><tr><th>Range</th><th className="num">Equivalent</th></tr></thead>
              <tbody>
                {[...usableScale(view.scheme.scale)].sort((a, b) => b.min - a.min).map((r) => (
                  <tr key={r.min} className={r.eq === view.grade.equiv && !view.grade.pending ? "hl" : ""}>
                    <td>{r.range}</td><td className="num">{r.eq.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {meta.note && <p className="muted small note">{meta.note}</p>}
    </main>
  );
}

export default function StudentPortal() {
  const api = useMemo(() => createStudentApi(getDb()), []);
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      setData(await fn());
    } catch (e) {
      setError(ERRORS[e.code] || "Something went wrong. Please try again.");
      if (e.code === "nomatch" && data) setData(null);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!id.trim() || !pin.trim()) return setError("Enter your student number and PIN.");
    run(() => api.login(id, pin));
  };

  const logout = () => {
    setData(null);
    setPin("");
    setError("");
  };

  if (data) {
    return (
      <>
        {error && <div className="banner">{error}</div>}
        <GradeView data={data} busy={busy} onRefresh={() => run(() => api.refresh(data.key))} onLogout={logout} />
      </>
    );
  }

  return (
    <main className="shell narrow">
      <form className="card login" onSubmit={submit}>
        <img className="logo" src="/bulsu-logo.png" alt="Bulacan State University" />
        <h1>Student Grade Portal</h1>
        <p className="muted">Enter your student number and the PIN your instructor gave you.</p>
        <label>
          Student number
          <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoCapitalize="characters" inputMode="text" placeholder="e.g. 2026-00001" />
        </label>
        <label>
          PIN
          <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" autoComplete="current-password" placeholder="6-character PIN" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Checking…" : "View my grades"}</button>
        <p className="muted small">Your grades are private. Do not share your PIN.</p>
        <p className="small"><a href="/teacher">Instructor sign in</a></p>
      </form>
    </main>
  );
}
