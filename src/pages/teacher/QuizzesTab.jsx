import React, { useEffect, useRef, useState } from "react";
import Icon from "../../Icon.jsx";
import QuizDashboard from "./QuizDashboard.jsx";
import { SectionPicker, useSectionPicker } from "../../lib/sectionPicker.jsx";
import { QUIZ_TEMPLATE_ROWS, blankQuestion, blankQuiz, newQuizId, parseQuizRows, questionStats, quizProblems, reviewAttempt, totalPoints } from "../../lib/quiz.js";
import { deleteQuiz, resetQuizAttempt, saveQuiz } from "../../lib/db.js";
import { studentNo } from "../../lib/keys.js";
import { csvCell, downloadText, fmtNum } from "../../lib/util.js";
import { orderedCategories } from "../../lib/grading.js";
import { sheetsFromWorkbook } from "../../lib/importer.js";
import { parseQuizDocx } from "../../lib/quizdoc.js";

const EVENT_LABEL = { "left-page": "left the page", copy: "copied", cut: "cut", paste: "pasted", "screenshot-key": "pressed PrintScreen" };
const when = (t) => (t ? new Date(t).toLocaleString() : "");

function QuestionEditor({ q, n, onChange, onRemove, onMove }) {
  const set = (patch) => onChange({ ...q, ...patch });
  const setType = (type) => onChange({ ...blankQuestion(type), id: q.id, text: q.text, points: q.points });
  return (
    <div className="qedit">
      <div className="row">
        <strong>Question {n + 1}</strong>
        <select aria-label={"Type of question " + (n + 1)} value={q.type} onChange={(e) => setType(e.target.value)}>
          <option value="mc">Multiple choice</option>
          <option value="tf">True or false</option>
        </select>
        <label className="inline">Points <input className="short" type="number" min="0" step="0.5" value={q.points} onChange={(e) => set({ points: Number(e.target.value) })} /></label>
        <button type="button" className="btn small" aria-label={"Move question " + (n + 1) + " up"} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="btn small" aria-label={"Move question " + (n + 1) + " down"} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="btn small danger" aria-label={"Remove question " + (n + 1)} onClick={onRemove}><Icon name="trash" /></button>
      </div>
      <label>Question<textarea rows={2} value={q.text} onChange={(e) => set({ text: e.target.value })} /></label>
      {q.type === "tf" ? (
        <div className="row">
          {[[true, "True"], [false, "False"]].map(([v, label]) => (
            <label className="inline" key={label}><input type="radio" name={"ans-" + q.id} checked={q.answer === v} onChange={() => set({ answer: v })} /> {label} is correct</label>
          ))}
        </div>
      ) : (
        <>
          {q.choices.map((c, i) => (
            <div className="row" key={i} style={{ marginTop: 6 }}>
              <input type="radio" name={"ans-" + q.id} aria-label={"Choice " + (i + 1) + " is correct"} checked={q.answer === i} onChange={() => set({ answer: i })} />
              <input aria-label={"Choice " + (i + 1) + " of question " + (n + 1)} value={c} style={{ flex: 1 }} onChange={(e) => set({ choices: q.choices.map((x, j) => (j === i ? e.target.value : x)) })} />
              {q.choices.length > 2 && (
                <button type="button" className="btn small danger" aria-label={"Remove choice " + (i + 1)}
                  onClick={() => set({ choices: q.choices.filter((_, j) => j !== i), answer: q.answer === i ? 0 : q.answer > i ? q.answer - 1 : q.answer })}><Icon name="close" /></button>
              )}
            </div>
          ))}
          {q.choices.length < 8 && <p><button type="button" className="btn small" onClick={() => set({ choices: [...q.choices, ""] })}><Icon name="plus" /> Choice</button></p>}
          <p className="muted small">Select the round button next to the correct choice.</p>
        </>
      )}
    </div>
  );
}

/* How the class did on each question: how many got it right and how many picked each choice (the right one is marked). */
function QuestionSummary({ quiz, attempts }) {
  const stats = questionStats(quiz, attempts);
  const taken = stats.length ? stats[0].taken : 0;
  if (!taken) return <p className="muted small">The question summary appears once a student has submitted.</p>;
  return (
    <div className="scroll">
      <table className="grid">
        <thead><tr><th>#</th><th>Question</th><th className="num">Correct</th><th className="num">Wrong</th><th className="num">No answer</th><th className="num">% correct</th><th>Choices picked</th></tr></thead>
        <tbody>
          {stats.map((st, n) => (
            <tr key={st.q.id}>
              <td>{n + 1}</td>
              <td>{st.q.text}</td>
              <td className="num">{st.right}</td><td className="num">{st.wrong}</td><td className="num">{st.blank}</td>
              <td className={"num " + (st.pct >= 75 ? "ok" : st.pct < 50 ? "bad" : "")}>{st.pct}%</td>
              <td className="small">{st.choices.map((c) => <span key={c.label} className={"pick " + (c.correct ? "ok" : "")}>{c.correct ? "✓ " : ""}{c.label}: {c.count}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* One student's answers next to the right ones. */
function AttemptDetail({ quiz, attempt }) {
  const rows = reviewAttempt(quiz, attempt.answers);
  return (
    <div>
      {attempt.late && <p className="muted small">The submit arrived after the time limit. It is graded only on the answers the server saved in time, shown here.</p>}
      {rows.map((r, n) => (
        <div className={"review-item " + (r.right ? "right" : "wrong")} key={r.q.id}>
          <p><strong>{n + 1}.</strong> {r.q.text} <span className={r.right ? "ok" : "bad"}>{r.right ? "Correct" : r.yours ? "Wrong" : "No answer"}</span></p>
          <p className="small">Answered: <strong>{r.yours || "none"}</strong>{!r.right && <> · Correct: <strong>{r.correct}</strong></>}</p>
        </div>
      ))}
    </div>
  );
}

function Results({ db, quiz, quizId, students, attempts }) {
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(null);   // key of the student whose answers are shown
  const byKey = Object.fromEntries(attempts.map((a) => [a.key, a]));
  const rows = students.map(([key, r]) => ({ key, r, a: byKey[key] }));
  const reset = async (key, name) => {
    if (!window.confirm("Let " + name + " take this quiz again? Their attempt" + (quiz.itemKey ? " and the score it recorded" : "") + " will be removed.")) return;
    try { await resetQuizAttempt(db, quizId, key); setMsg(name + " can retake the quiz."); } catch (e) { setMsg("Not reset: " + e.message); }
  };
  const flagged = attempts.filter((a) => a.violations > 0).length;
  return (
    <>
      <p className="muted small">
        {attempts.filter((a) => a.submitted).length} submitted, {attempts.filter((a) => !a.submitted).length} in progress, {students.length - attempts.length} not started
        {flagged > 0 && <> · <strong>{flagged}</strong> with anti-cheat warnings</>}.
      </p>
      <h3 style={{ margin: "12px 0 6px" }}><Icon name="summary" /> Question summary</h3>
      <QuestionSummary quiz={quiz} attempts={attempts} />
      <h3 style={{ margin: "16px 0 6px" }}><Icon name="users" /> Students</h3>
      <div className="scroll">
        <table className="grid">
          <thead><tr><th>Student</th><th>Status</th><th className="num">Score</th><th className="num">Warnings</th><th>What was recorded</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map(({ key, r, a }) => (
              <React.Fragment key={key}>
              <tr>
                <td>{r.name} <span className="muted small">{studentNo(a ? a.id : key)}</span></td>
                <td>{!a ? "Not started" : a.submitted ? (a.late ? "Late" : "Submitted") : "In progress"}</td>
                <td className="num">{a && a.submitted ? fmtNum(a.points) + " / " + fmtNum(a.total) : "–"}</td>
                <td className={"num" + (a && a.violations >= quiz.maxViolations && quiz.lockdown ? " bad" : "")}>{a ? a.violations : "–"}</td>
                <td className="small">{a && a.events.length ? a.events.map((e) => (EVENT_LABEL[e.type] || e.type) + " " + new Date(e.t).toLocaleTimeString()).join(", ") : ""}{a && a.submitted ? <span className="muted"> · submitted {when(a.submitted)}</span> : null}</td>
                <td className="right"><span className="actions">
                  {a && a.submitted && a.answers && <button type="button" className="btn small" onClick={() => setOpen(open === key ? null : key)}><Icon name="eye" /> {open === key ? "Hide answers" : "Answers"}</button>}
                  {a && <button type="button" className="btn small" onClick={() => reset(key, r.name)}><Icon name="refresh" /> Allow retake</button>}
                </span></td>
              </tr>
              {open === key && a && <tr><td colSpan={6}><AttemptDetail quiz={quiz} attempt={a} /></td></tr>}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
    </>
  );
}

function QuizEditor({ db, id, initial, section, roster, records, attempts, isNew, onDone }) {
  const [quiz, setQuiz] = useState(() => JSON.parse(JSON.stringify(initial)));
  const [msg, setMsg] = useState("");
  const [importMsg, setImportMsg] = useState({ ok: true, text: "" });
  const fileRef = useRef(null);
  const items = orderedCategories(section && section.scheme).flatMap((c) => (c.items || []).map((i) => ({ ...i, cat: c.title })));
  const set = (patch) => setQuiz({ ...quiz, ...patch });
  const setQ = (i, q) => set({ questions: quiz.questions.map((x, j) => (j === i ? q : x)) });
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= quiz.questions.length) return;
    const qs = quiz.questions.slice();
    [qs[i], qs[j]] = [qs[j], qs[i]];
    set({ questions: qs });
  };
  const pickItem = (k) => set({ itemKey: k, itemMax: k ? (items.find((i) => i.k === k) || {}).max ?? null : null });
  const students = Object.entries(records).filter(([, r]) => r.sec === quiz.sec).map(([key, r]) => [key, r]).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const taken = attempts.length;
  /* Questions and answers from a .xlsx or .csv file are added after the questions already in the quiz. */
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      let parsed;
      if (/\.docx$/i.test(f.name)) {
        parsed = await parseQuizDocx(await f.arrayBuffer());
      } else {
        const XLSX = await import("xlsx");
        const sheet = sheetsFromWorkbook(XLSX, await f.arrayBuffer(), "array").find((x) => !x.hidden);
        parsed = parseQuizRows(sheet ? sheet.aoa : []);
      }
      const { questions, errors } = parsed;
      if (!questions.length) return setImportMsg({ ok: false, text: errors.join(" ") });
      const kept = quiz.questions.filter((q) => String(q.text || "").trim());   // drops the empty starter question
      set({ questions: [...kept, ...questions] });
      setImportMsg({ ok: !errors.length, text: "Added " + questions.length + " question" + (questions.length === 1 ? "" : "s") + " from " + f.name + ". Review them, then Save." + (errors.length ? " Skipped: " + errors.join(" ") : "") });
    } catch (err) {
      setImportMsg({ ok: false, text: "Could not read that file. Use a Word (.docx), .xlsx or .csv file." });
    }
  };
  const template = () => downloadText("quiz-template.csv", QUIZ_TEMPLATE_ROWS.map((r) => r.map(csvCell).join(",")).join("\n"));
  const save = async (publish) => {
    const next = { ...quiz, published: publish == null ? quiz.published : publish };
    const problems = quizProblems(next);
    if (problems.length) return setMsg(problems.join(" "));
    try {
      await saveQuiz(db, id, next);
      setQuiz(next);
      setMsg(next.published ? "Saved. Students can see this quiz." : "Saved as a draft. Students cannot see it yet.");
      if (isNew) onDone();
    } catch (e) { setMsg(/show_answers/.test(e.message || "") ? "Not saved: the database needs the latest supabase/schema.sql (run it in the Supabase SQL Editor), or turn off \"Let students review their answers\"." : "Not saved: " + e.message); }
  };
  const remove = async () => {
    if (!window.confirm('Delete the quiz "' + (quiz.title || "untitled") + '"' + (taken ? " and the " + taken + " attempt" + (taken === 1 ? "" : "s") + " recorded for it" : "") + "? Scores already in the grades stay. This cannot be undone.")) return;
    try { await deleteQuiz(db, id); onDone(); } catch (e) { setMsg("Not deleted: " + e.message); }
  };
  return (
    <details className="card" id={"quiz-" + id} open={isNew || undefined}>
      <summary><strong>{quiz.title || "New quiz"}</strong> <span className="tag">{quiz.published ? "Published" : "Draft"}</span> <span className="muted small">{quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"} · {fmtNum(totalPoints(quiz.questions))} pts{taken ? " · " + taken + " attempt" + (taken === 1 ? "" : "s") : ""}</span></summary>
      <div className="form-grid">
        <label className="span2"><Icon name="tag" /> Title<input value={quiz.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Quiz 1: Arrays" /></label>
        <label><Icon name="grades" /> Record the score in
          <select value={quiz.itemKey || ""} onChange={(e) => pickItem(e.target.value)}>
            <option value="">Do not record in grades</option>
            {items.map((i) => <option key={i.k} value={i.k}>{i.cat} – {i.label} (max {fmtNum(i.max)})</option>)}
          </select>
        </label>
        <label><Icon name="clock" /> Time limit (minutes, empty = none)<input type="number" min="1" max="600" value={quiz.timeLimit || ""} onChange={(e) => set({ timeLimit: e.target.value ? Number(e.target.value) : null })} /></label>
      </div>
      <fieldset className="card" style={{ margin: "0 0 12px" }}>
        <legend><strong><Icon name="lock" /> Anti-cheat</strong></legend>
        <label className="inline"><input type="checkbox" checked={quiz.shuffle} onChange={(e) => set({ shuffle: e.target.checked })} /> Shuffle questions and choices for each student</label>
        <label className="inline"><input type="checkbox" checked={quiz.lockdown} onChange={(e) => set({ lockdown: e.target.checked })} /> Record leaving the page, copying and pasting, and block them</label>
        {quiz.lockdown && <label className="inline">Auto-submit after <input className="short" type="number" min="1" max="20" value={quiz.maxViolations} onChange={(e) => set({ maxViolations: Math.max(1, Number(e.target.value) || 1) })} /> warnings</label>}
        <label className="inline"><input type="checkbox" checked={!!quiz.showAnswers} onChange={(e) => set({ showAnswers: e.target.checked })} /> Let students review their answers and the correct answers after they submit</label>
        <p className="muted small">The time limit and the scoring are enforced on the server and every student gets one attempt. Warnings are what the browser can notice, so they are evidence for you to judge, not proof: a student can still use a second device.</p>
      </fieldset>
      {quiz.questions.map((q, i) => (
        <QuestionEditor key={q.id} q={q} n={i} onChange={(nq) => setQ(i, nq)} onMove={(d) => move(i, d)}
          onRemove={() => set({ questions: quiz.questions.filter((_, j) => j !== i) })} />
      ))}
      <p className="row">
        <button type="button" className="btn small" onClick={() => set({ questions: [...quiz.questions, blankQuestion("mc")] })}><Icon name="plus" /> Multiple choice</button>
        <button type="button" className="btn small" onClick={() => set({ questions: [...quiz.questions, blankQuestion("tf")] })}><Icon name="plus" /> True / false</button>
        <button type="button" className="btn small" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="import" /> Import questions</button>
        <button type="button" className="btn small" onClick={template}><Icon name="download" /> Template</button>
        <input ref={fileRef} type="file" accept=".docx,.xlsx,.xls,.csv" aria-label="Import questions file" onChange={onFile} hidden />
      </p>
      <p className="muted small">Import from a <strong>Word file (.docx)</strong>: numbered questions with A., B., C., D. choices, then an "Answer Key" table (No. and Answer columns). Or use a spreadsheet (.xlsx or .csv) with the columns Question, Type (optional), A, B, C, D…, Answer and Points (optional); the template shows the layout.</p>
      {importMsg.text && <p className={importMsg.ok ? "banner info" : "banner"} role="status"><Icon name={importMsg.ok ? "info" : "alert"} /> {importMsg.text}</p>}
      {taken > 0 && <p className="banner info"><Icon name="info" /> {taken} student{taken === 1 ? " has" : "s have"} already started this quiz. Changing questions now affects how later attempts are scored; allow retakes if you change the answers.</p>}
      {quiz.itemKey && quiz.itemMax != null && <p className="muted small">The score is scaled to the item's maximum of {fmtNum(quiz.itemMax)} (a student with 8 of 10 points gets {fmtNum(Math.round(0.8 * quiz.itemMax * 100) / 100)}).</p>}
      <div className="row">
        <button type="button" className="btn primary" onClick={() => save(null)}><Icon name="save" /> Save</button>
        <button type="button" className="btn" onClick={() => save(!quiz.published)}><Icon name={quiz.published ? "eye" : "upload"} /> {quiz.published ? "Unpublish" : "Save & publish"}</button>
        <button type="button" className="btn danger" onClick={remove}><Icon name="trash" /> Delete quiz</button>
        {msg && <span className="small" role="status">{msg}</span>}
      </div>
      {!isNew && (
        <>
          <h2 style={{ marginTop: 16 }}><Icon name="users" /> Results</h2>
          <Results db={db} quiz={quiz} quizId={id} students={students} attempts={attempts} />
        </>
      )}
    </details>
  );
}

export default function QuizzesTab({ db, sections, quizzes, attempts, records }) {
  const picker = useSectionPicker(sections);
  const secId = picker.activeId;
  const [draft, setDraft] = useState(null);
  const [view, setView] = useState("dashboard");
  const [jump, setJump] = useState(null);   // a quiz picked on the dashboard: show it opened in the manage view
  useEffect(() => {
    if (view !== "manage" || !jump) return;
    const el = document.getElementById("quiz-" + jump);
    if (el) { el.open = true; if (el.scrollIntoView) el.scrollIntoView({ block: "start" }); }
    setJump(null);
  }, [view, jump]);
  const students = Object.entries(records || {}).filter(([, r]) => r.sec === secId);
  const list = Object.entries(quizzes || {}).filter(([, q]) => q.sec === secId).sort((a, b) => (a[1].updated || 0) - (b[1].updated || 0));
  const attemptsOf = (qid) => Object.values(attempts || {}).filter((a) => a.quizId === qid);
  return (
    <>
      <div className="row toolbar">
        <SectionPicker picker={picker} sections={sections} />
        <button type="button" className="btn primary" disabled={!secId || !!draft} onClick={() => { setDraft({ id: newQuizId(), quiz: blankQuiz(secId) }); setView("manage"); }}><Icon name="plus" /> New quiz</button>
      </div>
      <div className="viewswitch" role="group" aria-label="Quiz view">
        <button type="button" className={view === "dashboard" ? "on" : ""} aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}><Icon name="summary" /> Dashboard</button>
        <button type="button" className={view === "manage" ? "on" : ""} aria-pressed={view === "manage"} onClick={() => setView("manage")}><Icon name="quiz" /> Manage quizzes ({list.length})</button>
      </div>
      {Object.keys(sections).length === 0 && <p className="muted">No sections yet. Add one in Settings first.</p>}
      {view === "dashboard" && secId && <QuizDashboard key={secId} quizzes={list} attempts={attempts} students={students} onOpenQuiz={(id) => { setView("manage"); setJump(id); }} />}
      {/* kept on the page while hidden, so switching views never throws away unsaved edits */}
      <div hidden={view !== "manage"}>
        {draft && draft.quiz.sec === secId && (
          <QuizEditor key={draft.id} db={db} id={draft.id} initial={draft.quiz} section={sections[secId]} roster={{}} records={records} attempts={[]} isNew onDone={() => setDraft(null)} />
        )}
        {secId && list.length === 0 && !draft && <p className="muted">No quizzes in this section yet. Press "New quiz" to build one.</p>}
        {list.map(([id, q]) => (
          <QuizEditor key={id} db={db} id={id} initial={q} section={sections[secId]} roster={{}} records={records} attempts={attemptsOf(id)} onDone={() => {}} />
        ))}
      </div>
    </>
  );
}
