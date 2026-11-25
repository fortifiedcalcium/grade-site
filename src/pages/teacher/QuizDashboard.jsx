import React, { useEffect, useState } from "react";
import Icon from "../../Icon.jsx";
import { buildDashboard } from "../../lib/quizDashboard.js";
import { fmtClock } from "../../lib/quiz.js";

const pct = (v) => (v == null ? "—" : Math.round(v) + "%");

/* A thin single-colour bar with its value written beside it (the number carries the meaning, the bar helps compare). */
function Meter({ value, text }) {
  return (
    <span className="meter">
      <span className="meter-track" aria-hidden="true"><span style={{ width: Math.max(0, Math.min(100, value || 0)) + "%" }} /></span>
      <span className="meter-text">{text}</span>
    </span>
  );
}

/* Icons are decoration beside a text label, never the only way to tell what something is. */
const REASON_ICON = { warning: "flag", late: "clock", unsubmitted: "hourglass" };
const Th = ({ icon, children, num }) => <th className={num ? "num" : undefined}><Icon name={icon} size={14} /> {children}</th>;

function Tile({ icon, tone, label, value, note }) {
  return (
    <div className="stat-tile">
      <span className={"stat-icon " + tone}><Icon name={icon} size={22} /></span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </div>
  );
}

export default function QuizDashboard({ quizzes, attempts, students, onOpenQuiz }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);   // keeps "time left" moving between database updates
    return () => clearInterval(t);
  }, []);
  // a submit or a new attempt arrives with new data: measure it against the current time
  useEffect(() => { setNow(Date.now()); }, [attempts, quizzes]);
  const d = buildDashboard({ quizzes, attempts, students, now });
  const t = d.totals;
  const open = (id, title) => <button type="button" className="linklike" onClick={() => onOpenQuiz(id)}>{title || "Untitled quiz"}</button>;

  if (!quizzes.length) return <section className="card"><p><Icon name="quiz" size={20} /> No quizzes in this section yet. Press "New quiz" to build one; its results will show up here.</p></section>;

  return (
    <div aria-label="Quiz dashboard" role="region">
      <div className="stat-grid">
        <Tile icon="quiz" tone="t-quiz" label="Published quizzes" value={t.published} note={t.drafts ? t.drafts + " draft" + (t.drafts === 1 ? "" : "s") : "no drafts"} />
        <Tile icon="done" tone="t-done" label="Completion" value={pct(t.completion)} note={t.expected ? t.submitted + " of " + t.expected + " submissions" : "nothing to submit yet"} />
        <Tile icon="star" tone="t-score" label="Average score" value={pct(t.average)} note={t.average == null ? "no on-time submissions yet" : "on-time submissions"} />
        <Tile icon="play" tone="t-live" label="Taking a quiz now" value={t.inProgress} note={t.students + " student" + (t.students === 1 ? "" : "s") + " in this section"} />
        <Tile icon="flag" tone="t-review" label="To review" value={t.toReview} note="warnings, late or unsubmitted" />
      </div>

      {d.live.length > 0 && (
        <section className="card flush" aria-label="In progress now">
          <h2 className="card-title"><Icon name="play" size={20} /> In progress now</h2>
          <div className="scroll">
            <table className="grid">
              <thead><tr><Th icon="user">Student</Th><Th icon="quiz">Quiz</Th><Th icon="clock" num>Time left</Th><Th icon="flag" num>Warnings</Th></tr></thead>
              <tbody>
                {d.live.map((a) => (
                  <tr key={a.quizId + a.key}>
                    <td>{a.name}</td><td>{open(a.quizId, a.quiz)}</td>
                    <td className="num">{a.leftMs == null ? "no limit" : fmtClock(a.leftMs)}</td>
                    <td className="num">{a.violations}{a.limit ? " / " + a.limit : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card flush" aria-label="Quizzes at a glance">
        <h2 className="card-title"><Icon name="summary" size={20} /> Quizzes at a glance</h2>
        <div className="scroll">
          <table className="grid">
            <thead><tr><Th icon="quiz">Quiz</Th><Th icon="done">Submitted</Th><Th icon="play" num>In progress</Th><Th icon="hourglass">Not started</Th><Th icon="star">Average score</Th><Th icon="trend" num>Lowest – highest</Th><Th icon="flag" num>With warnings</Th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td>{open(r.id, r.title)} <span className="tag"><Icon name={r.published ? "eye" : "note"} size={13} /> {r.published ? "Published" : "Draft"}</span></td>
                  {/* students cannot see a draft, so nobody is "missing" from it */}
                  <td>{!r.published && !r.submitted ? "—" : <Meter value={r.expected ? (r.submitted / r.expected) * 100 : 0} text={r.submitted + " / " + r.expected} />}</td>
                  <td className="num">{r.inProgress}</td>
                  <td>
                    {!r.published ? "—" : r.notStarted.length === 0 ? "0" : (
                      <details><summary>{r.notStarted.length} student{r.notStarted.length === 1 ? "" : "s"}</summary><ul className="names">{r.notStarted.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
                    )}
                  </td>
                  <td>{r.average == null ? "—" : <Meter value={r.average} text={pct(r.average)} />}</td>
                  <td className="num">{r.average == null ? "—" : pct(r.lowest) + " – " + pct(r.highest)}</td>
                  <td className="num">{r.flagged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card flush" aria-label="Hardest questions">
        <h2 className="card-title"><Icon name="alert" size={20} /> Hardest questions</h2>
        {d.hardest.length === 0 ? <p className="muted small card-note">Appears after the first on-time submission.</p> : (
          <>
            <p className="muted small card-note">The five questions the fewest students got right. A blank answer counts as not right.</p>
            <div className="scroll">
              <table className="grid">
                <thead><tr><Th icon="quiz">Quiz</Th><th className="num">#</th><Th icon="note">Question</Th><Th icon="check">Answered correctly</Th></tr></thead>
                <tbody>
                  {d.hardest.map((h) => (
                    <tr key={h.quizId + h.number}>
                      <td>{open(h.quizId, h.quiz)}</td><td className="num">{h.number}</td><td>{h.text}</td>
                      <td><Meter value={h.pct} text={h.pct + "% (" + h.right + " / " + h.taken + ")"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card flush" aria-label="To review">
        <h2 className="card-title"><Icon name="flag" size={20} /> To review</h2>
        {d.review.length === 0 ? <p className="muted small card-note">Nothing to review: no warnings, late or unsubmitted attempts.</p> : (
          <>
            <p className="muted small card-note">A warning is not proof of cheating: a call or a locked screen adds one too. Open the quiz to see the times.</p>
            <div className="scroll">
              <table className="grid">
                <thead><tr><Th icon="user">Student</Th><Th icon="quiz">Quiz</Th><Th icon="info">What happened</Th></tr></thead>
                <tbody>
                  {d.review.map((a) => (
                    <tr key={a.quizId + a.key}>
                      <td>{a.serious && <Icon name="alert" label="Check first" />} {a.name}</td><td>{open(a.quizId, a.quiz)}</td>
                      <td>{a.reasons.map((reason, i) => <span className="reason" key={reason}><Icon name={REASON_ICON[a.kinds[i]]} size={14} /> {reason}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
