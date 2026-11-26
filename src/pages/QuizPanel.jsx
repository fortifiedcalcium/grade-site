import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon.jsx";
import Busy from "../Busy.jsx";
import { answerLabel, fmtClock, presentQuestions } from "../lib/quiz.js";
import { fmtNum } from "../lib/util.js";
import { draftName, readDraft, removeDraft, restoreDraft, writeDraft } from "../lib/quizDraft.js";

const ERR = {
  timeout: "The connection timed out. Check your internet and try again.",
  P0001: "You already submitted this quiz.",
  P0002: "This quiz is not available.",
};
const errText = (e) => ERR[e && e.code] || ERR[e && e.message] || "Something went wrong. Please try again.";

/* The anti-cheat rules in plain words. Keep these in step with what QuizRun really records (report() below): a rule listed
   here that the page cannot notice, or the other way round, would mislead students. */
function QuizRules({ maxViolations, open }) {
  return (
    <details className="quiz-rules" open={open}>
      <summary><Icon name="lock" /> What counts as cheating (read before you start)</summary>
      <p className="small">Each of these is <strong>1 warning</strong>:</p>
      <ul className="small">
        <li>Switching to another browser tab or window.</li>
        <li>Opening another app, such as Messenger, Google, notes, the camera or an AI chatbot.</li>
        <li>Minimizing the browser, going to your phone's home screen, or switching between apps.</li>
        <li>Clicking outside the quiz page, such as the address bar, a second monitor, or the other side of a split screen.</li>
        <li>Locking your phone, or letting the screen turn off.</li>
        <li>Answering a call, or tapping a notification that takes you out of the quiz.</li>
        <li>Copying, cutting or pasting text, for example from your phone's press-and-hold menu.</li>
        <li>Pressing the Print Screen key.</li>
      </ul>
      <p className="small">Blocked, but not counted: selecting text, right-clicking, and keyboard shortcuts such as Ctrl or Cmd + C, V, X, A, P, S or U.</p>
      <p className="small">
        After <strong>{maxViolations} warning{maxViolations === 1 ? "" : "s"}</strong> your quiz is submitted automatically with the answers you have so far.
        Things that happen within 1.5 seconds of each other count once. Your instructor sees each warning and the time it happened.
        Closing or reloading the page does not stop the timer or clear your warnings. Your answers are saved as you go: if the
        page closes, sign in again and press Resume quiz. If your submit arrives after the time limit, only the answers that were
        saved online in time are graded: answers shown as "Saved on this device only" do not count.
      </p>
      <p className="small"><strong>Before you start:</strong> turn on Do Not Disturb, close other apps and tabs, charge your device, and keep your screen from turning off by itself.</p>
    </details>
  );
}

/* One attempt in progress. Anti-cheat: the server owns the clock and the scoring; this page only shuffles, watches and reports.
   Leaving the tab or window, copying, pasting and the right-click menu are logged (and counted against the quiz's limit when
   it has lockdown on). Reaching the limit, or running out of time, submits what is answered so far. */
function QuizRun({ session, quizKey, api, onFinished }) {
  const { id, title, lockdown, maxViolations, shuffle } = session;
  const questions = useMemo(() => presentQuestions(session.questions, { shuffle, seed: quizKey + "|" + id }), [session, shuffle, quizKey, id]);
  // answers saved earlier (reload, closed browser, other device) come back: the newer of the device copy and the database copy
  const draft = draftName(quizKey, id, session.started);
  const [restored] = useState(() => restoreDraft(session, readDraft(draft)));
  const [answers, setAnswers] = useState(restored.answers);
  const [saveState, setSaveState] = useState(restored.rev > restored.serverRev ? "saving" : restored.rev ? "saved" : "");
  const deviceOk = useRef(true);
  const rev = useRef(restored.rev);               // goes up with every change
  const savedRev = useRef(restored.serverRev);    // the newest revision the database has
  const saveTimer = useRef(null);
  const saving = useRef(false);
  const [violations, setViolations] = useState(session.violations || 0);
  const [left, setLeft] = useState(session.remainingMs);
  const [notice, setNotice] = useState("");
  const [barOpen, setBarOpen] = useState(true);   // phones only: the floating panel can be hidden (see styles.css)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deadline = useRef(session.remainingMs == null ? null : Date.now() + session.remainingMs);
  const sent = useRef(false);
  const lastEvent = useRef(0);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // send the newest answers to the database: one request at a time, retried while the connection is down
  const sync = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (sent.current || saving.current || rev.current <= savedRev.current) return;
    if (!api.save) return setSaveState("device");
    saving.current = true;
    const sending = rev.current;
    let wait = null;
    try {
      const stored = await api.save(id, answersRef.current, sending);
      if (stored == null) setSaveState("device");               // the attempt is closed or its time is up
      else {
        if (stored > sending) rev.current = Math.max(rev.current, stored + 1);   // another device saved: this one is in use now
        else savedRev.current = sending;
        if (rev.current <= savedRev.current) setSaveState("saved");
        else wait = 800;
      }
    } catch {
      setSaveState("device");
      wait = 5000;
    }
    saving.current = false;
    if (wait != null && !sent.current) saveTimer.current = setTimeout(sync, wait);
  }, [api, id]);

  const saveSoon = useCallback((ms) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(sync, ms);
  }, [sync]);

  const choose = (questionId, value) => {
    const next = { ...answersRef.current, [questionId]: value };
    answersRef.current = next;
    setAnswers(next);
    rev.current += 1;
    deviceOk.current = writeDraft(draft, next, rev.current);   // first on the device, at once
    setSaveState("saving");
    saveSoon(800);
  };

  useEffect(() => {
    if (rev.current > savedRev.current) saveSoon(0);   // the device copy was ahead
    const now = () => { sync(); };
    const hidden = () => { if (document.visibilityState === "hidden") sync(); };   // leaving: do not wait
    window.addEventListener("online", now);
    window.addEventListener("pagehide", now);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(saveTimer.current);
      window.removeEventListener("online", now);
      window.removeEventListener("pagehide", now);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [sync, saveSoon]);

  const submit = useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    setError("");
    clearTimeout(saveTimer.current);
    try {
      const result = await api.submit(id, answersRef.current);
      removeDraft(draft);
      onFinished(result);
    } catch (e) {
      sent.current = false;
      setError(errText(e));
      setBusy(false);
      saveSoon(2000);
    }
  }, [api, id, onFinished, draft, saveSoon]);

  // the countdown comes from the server's remaining time, so a wrong clock on the student's device changes nothing
  useEffect(() => {
    if (deadline.current == null) return undefined;
    const tick = () => {
      const r = deadline.current - Date.now();
      setLeft(Math.max(0, r));
      if (r <= 0) submit();
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [submit]);

  const report = useCallback((type, message) => {
    if (!lockdown || sent.current) return;
    const now = Date.now();
    if (now - lastEvent.current < 1500) return;   // blur and visibilitychange fire together: count one
    lastEvent.current = now;
    setViolations((v) => v + 1);
    setNotice(message);
    setBarOpen(true);   // a new warning must be seen, even if the panel was hidden
    api.event(id, type);
  }, [api, id, lockdown]);

  useEffect(() => {
    if (lockdown && violations >= maxViolations) submit();
  }, [lockdown, violations, maxViolations, submit]);

  useEffect(() => {
    if (!lockdown) return undefined;
    const away = () => report("left-page", "You left the quiz page. This was recorded.");
    const onVis = () => { if (document.visibilityState === "hidden") away(); };
    const block = (type, message) => (e) => { e.preventDefault(); report(type, message); };
    const onCopy = block("copy", "Copying is not allowed during the quiz. This was recorded.");
    const onCut = block("cut", "Cutting is not allowed during the quiz. This was recorded.");
    const onPaste = block("paste", "Pasting is not allowed during the quiz. This was recorded.");
    const onMenu = (e) => e.preventDefault();
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && ["c", "x", "v", "a", "p", "s", "u"].includes(String(e.key).toLowerCase())) e.preventDefault();
      if (e.key === "PrintScreen") report("screenshot-key", "Screenshots are not allowed during the quiz. This was recorded.");
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", away);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onMenu);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", away);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onMenu);
      document.removeEventListener("keydown", onKey);
    };
  }, [lockdown, report]);

  useEffect(() => {
    const warn = (e) => { if (!sent.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // answers saved nowhere at all is too important to stay hidden
  const unsafe = saveState === "device" && !deviceOk.current;
  useEffect(() => { if (unsafe) setBarOpen(true); }, [unsafe]);

  const unanswered = questions.filter((q) => answers[q.id] === undefined).length;
  const clickSubmit = () => {
    if (unanswered && !window.confirm(unanswered + " question" + (unanswered === 1 ? " is" : "s are") + " unanswered. Submit anyway? You cannot change your answers afterwards.")) return;
    submit();
  };

  return (
    <div className={"quiz-run" + (lockdown ? " quiz-lock" : "") + (barOpen ? "" : " bar-closed")}>
      <section className="card quiz-bar" id="quiz-bar" role="status">
        <button type="button" className="btn small quiz-hide" onClick={() => setBarOpen(false)} aria-controls="quiz-bar" aria-expanded="true"><Icon name="close" /> Hide</button>
        <h2><Icon name="quiz" size={20} /> {title}</h2>
        <div className="row">
          {left != null && <strong className={"tag" + (left < 60000 ? " warn" : "")} aria-label="Time left">{fmtClock(left)}</strong>}
          {lockdown && <span className="small">Warnings: <strong>{violations}</strong> / {maxViolations}</span>}
          <span className="small">{questions.length - unanswered} / {questions.length} answered</span>
          {saveState && (
            <span className="small" aria-label="Autosave status">
              {saveState === "saved" ? "✓ Answers saved" : saveState === "saving" ? "Saving…"
                : deviceOk.current ? "Saved on this device only, not online yet" : "Answers are not being saved: do not close or reload this page"}
            </span>
          )}
        </div>
        {Object.keys(restored.answers).length > 0 && <p className="muted small">Your saved answers were restored. Check them before you submit.</p>}
        {lockdown && <p className="muted small">Stay on this page. Leaving it, copying or pasting is recorded and shown to your instructor; after {maxViolations} warnings the quiz is submitted automatically.</p>}
        {notice && <p className="banner" role="alert"><Icon name="alert" /> {notice}</p>}
      </section>
      {!barOpen && (
        <button type="button" className={"quiz-pill" + (left != null && left < 60000 ? " warn" : "")} onClick={() => setBarOpen(true)} aria-controls="quiz-bar" aria-expanded="false">
          {left != null && <span><Icon name="clock" /> <span className="sr-only">Time left </span>{fmtClock(left)}</span>}
          {lockdown && <span><Icon name="flag" /> <span className="sr-only">Warnings </span>{violations}/{maxViolations}</span>}
          <span><Icon name="check" /> <span className="sr-only">Answered </span>{questions.length - unanswered}/{questions.length}</span>
          {saveState === "device" && <span><Icon name="alert" /> Not saved online</span>}
          <span className="quiz-pill-show">Show</span>
        </button>
      )}
      {lockdown && <section className="card"><QuizRules maxViolations={maxViolations} /></section>}

      {questions.map((q, n) => (
        <section className="card" key={q.id}>
          <p><strong>{n + 1}.</strong> {q.text} <span className="muted small quiz-pts">({fmtNum(Number(q.points) || 1)} pt{Number(q.points) === 1 ? "" : "s"})</span></p>
          <div className="quiz-opts" role="radiogroup" aria-label={"Question " + (n + 1)}>
            {q.type === "tf"
              ? [[true, "True"], [false, "False"]].map(([v, label]) => (
                <label className="inline quiz-opt" key={label}>
                  <input type="radio" name={"q-" + q.id} checked={answers[q.id] === v} onChange={() => choose(q.id, v)} /> {label}
                </label>
              ))
              : q.options.map((o) => (
                <label className="inline quiz-opt" key={o.index}>
                  <input type="radio" name={"q-" + q.id} checked={answers[q.id] === o.index} onChange={() => choose(q.id, o.index)} /> {o.label}
                </label>
              ))}
          </div>
        </section>
      ))}
      {error && <p className="error" role="alert"><Icon name="alert" /> {error}</p>}
      <Busy show={busy} text="Submitting your quiz… Please do not close this page." />
      <p><button type="button" className="btn primary" onClick={clickSubmit} disabled={busy}><Icon name="check" /> {busy ? "Submitting…" : "Submit quiz"}</button></p>
    </div>
  );
}

/* What the student got right and wrong, with the correct answers. Shown only when the instructor allows it for the quiz. */
function Review({ review }) {
  const right = review.filter((r) => r.right).length;
  return (
    <section className="card" aria-label="Answer review">
      <h2><Icon name="check" size={20} /> Answer review</h2>
      <p className="muted small">{right} of {review.length} question{review.length === 1 ? "" : "s"} correct.</p>
      {review.map((r, n) => {
        const yours = answerLabel(r, r.yours);
        const correct = answerLabel(r, r.answer);
        return (
          <div className={"review-item " + (r.right ? "right" : "wrong")} key={r.id}>
            <p><strong>{n + 1}.</strong> {r.text} <span className={r.right ? "ok" : "bad"}>{r.right ? "Correct" : yours ? "Wrong" : "No answer"}</span></p>
            <p className="small">Your answer: <strong>{yours || "none"}</strong></p>
            {!r.right && <p className="small">Correct answer: <strong>{correct}</strong></p>}
          </div>
        );
      })}
    </section>
  );
}

export default function QuizPanel({ quizApi, quizKey, onSubmitted }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("Please wait…");
  const [review, setReview] = useState(null);   // { id, items } of the quiz whose answers are open

  const load = useCallback(async () => {
    try { setList(await quizApi.list()); setError(""); } catch (e) { setError(errText(e)); }
  }, [quizApi]);
  useEffect(() => { setList(null); setSession(null); setResult(null); load(); }, [load, quizKey]);

  const begin = async (q) => {
    const rules = [
      q.timeLimit && !q.started ? "You have " + q.timeLimit + " minute" + (q.timeLimit === 1 ? "" : "s") + ". The clock starts now and keeps running even if you close the page." : "",
      q.timeLimit && q.started ? "The clock has kept running since you started." : "",
      q.started ? "Your saved answers will be restored." : "Your answers are saved as you go.",
      q.timeLimit ? "If your submit arrives late, only answers saved online in time (\"Answers saved\") are graded." : "",
      q.lockdown ? "Leaving this page (another tab or app, home screen, screen lock), copying or pasting is recorded. After " + q.maxViolations + " warnings the quiz is submitted automatically. See \"What counts as cheating\" for the full list." : "",
      "You can submit only once.",
    ].filter(Boolean).join("\n\n");
    if (!window.confirm((q.started ? 'Resume "' : 'Start "') + q.title + '"?\n\n' + rules)) return;
    setBusyText(q.started ? "Resuming your quiz…" : "Starting your quiz…");
    setBusy(true);
    setError("");
    try { setSession(await quizApi.start(q.id)); } catch (e) { setError(errText(e)); load(); } finally { setBusy(false); }
  };

  const finished = useCallback((r) => {
    setResult({ ...r, title: session && session.title });
    setReview(r.review ? { id: session && session.id, items: r.review } : null);
    setSession(null);
    load();
    if (onSubmitted) onSubmitted();
  }, [session, load, onSubmitted]);

  const openReview = async (q) => {
    if (review && review.id === q.id) return setReview(null);
    setBusyText("Loading your answers…");
    setBusy(true);
    setError("");
    try { setReview({ id: q.id, items: (await quizApi.review(q.id)) || [] }); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  if (session) return <QuizRun session={session} quizKey={quizKey} api={quizApi} onFinished={finished} />;

  return (
    <>
      <Busy show={busy} text={busyText} />
      {result && (
        <section className="card" role="status">
          <h2><Icon name="check" size={20} /> Quiz submitted</h2>
          {result.late
            ? result.graded > 0
              ? <p className="bad">Your submit arrived after the time limit, so only the {result.graded} answer{result.graded === 1 ? "" : "s"} saved in time {result.graded === 1 ? "was" : "were"} graded: {fmtNum(Number(result.points))} / {fmtNum(Number(result.total))}.</p>
              : <p className="bad">Your submit arrived after the time limit{result.graded === 0 ? " and no answers were saved in time" : ""}, so this attempt scored 0.</p>
            : <p className="ok">{result.title ? result.title + ": " : ""}you scored {fmtNum(Number(result.points))} / {fmtNum(Number(result.total))}.</p>}
          <p className="muted small">The score is now in your grades.</p>
        </section>
      )}
      {error && <p className="error" role="alert"><Icon name="alert" /> {error}</p>}
      {list == null && !error && <p className="muted">Loading quizzes…</p>}
      {list && list.length === 0 && <section className="card"><p>There are no quizzes for your section right now.</p></section>}
      {(list || []).map((q) => (
        <section className="card" key={q.id}>
          <h2>{q.title}</h2>
          <p className="muted small">{q.count} question{q.count === 1 ? "" : "s"} · {fmtNum(Number(q.total))} points{q.timeLimit ? " · " + q.timeLimit + " min" : ""}</p>
          {q.submitted ? (
            <>
              <p className={q.late ? "bad" : "ok"}>{(q.late ? "Submitted late: " : "Done: ") + fmtNum(Number(q.points)) + " / " + fmtNum(Number(q.attemptTotal))}</p>
              {q.showAnswers && !q.late && <p><button type="button" className="btn small" disabled={busy} onClick={() => openReview(q)}><Icon name="eye" /> {review && review.id === q.id ? "Hide answers" : "Review answers"}</button></p>}
              {review && review.id === q.id && <Review review={review.items} />}
            </>
          ) : (
            <>
            {q.lockdown && <QuizRules maxViolations={q.maxViolations} open />}
            <button type="button" className="btn primary" disabled={busy} onClick={() => begin(q)}><Icon name="quiz" /> {q.started ? "Resume quiz" : "Start quiz"}</button>
            </>
          )}
        </section>
      ))}
    </>
  );
}
