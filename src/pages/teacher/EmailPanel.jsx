import React, { useMemo, useState } from "react";
import { markEmailed, sendPinEmails } from "../../lib/db.js";
import { DEFAULT_TEMPLATE, PLACEHOLDERS, MAX_BATCH, buildPlan, renderMessage, isValidEmail } from "../../lib/emailpins.js";

const KEY = "pin-email-template";
const loadTemplate = () => {
  try { return { ...DEFAULT_TEMPLATE, ...JSON.parse(window.localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULT_TEMPLATE }; }
};
const storeTemplate = (t) => { try { window.localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* storage blocked */ } };

/* Email PINs to students from the app. Sends through the send-pins Edge Function (see README). */
export default function EmailPanel({ db, user, roster, sections, activeId, selectedIds, onClose }) {
  const [t, setT] = useState(loadTemplate);
  const [scope, setScope] = useState(selectedIds.length ? "selected" : "section");
  const [onlyUnsent, setOnlyUnsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const set = (k) => (e) => setT((x) => { const n = { ...x, [k]: e.target.value }; storeTemplate(n); return n; });
  const link = window.location.origin;
  const me = (user && user.email) || "";

  const ids = useMemo(() => {
    const all = Object.entries(roster).sort((a, b) => (a[1].sec + a[1].name).localeCompare(b[1].sec + b[1].name)).map(([id]) => id);
    if (scope === "selected") return all.filter((id) => selectedIds.includes(id));
    if (scope === "section") return all.filter((id) => roster[id].sec === activeId);
    return all;
  }, [roster, scope, activeId, selectedIds]);

  const plan = useMemo(() => buildPlan({ roster, sections, ids, template: t, link, onlyUnsent }), [roster, sections, ids, t, link, onlyUnsent]);
  const noEmail = plan.skipped.filter((s) => s.reason === "no valid email").length;

  const run = async (fn) => { setBusy(true); setLog(""); try { await fn(); } catch (e) { setLog(e.message || "Something went wrong."); } finally { setBusy(false); } };
  const opts = { sender: t.sender, replyTo: t.replyTo };

  const sendTest = () => run(async () => {
    if (!isValidEmail(me)) throw new Error("Your account has no email address to send a test to.");
    const first = plan.ready[0] || (() => { const id = ids.find((i) => roster[i]); return id && renderMessage(t, id, roster[id], sections, link, me); })();
    if (!first) throw new Error("There is no student to build a test from.");
    const [res] = await sendPinEmails(db, [{ ...first, to: me }], { ...opts, test: true });
    setLog(res && res.ok ? "Test sent to " + me + " (labelled [TEST]; nobody is marked as emailed). Check your inbox and spam." : "Test failed: " + ((res && res.error) || "unknown error"));
  });

  const sendAll = () => run(async () => {
    if (plan.unknown.length) throw new Error("Unknown placeholder" + (plan.unknown.length > 1 ? "s" : "") + ": " + plan.unknown.map((n) => "{{" + n + "}}").join(", ") + ". Nothing was sent.");
    if (!plan.ready.length) throw new Error("Nobody to email. Add emails first, or untick 'only students not emailed yet'.");
    const names = plan.ready.slice(0, 8).map((m) => "  " + (roster[m.id] ? roster[m.id].name : m.id) + " <" + m.to + ">");
    const scopeName = scope === "selected" ? "the selected students" : scope === "section" ? "section " + ((sections[activeId] && sections[activeId].name) || activeId) : "all sections";
    const already = plan.skipped.filter((x) => x.reason === "already emailed").length;
    if (!window.confirm(
      "Email " + plan.ready.length + " student" + (plan.ready.length === 1 ? "" : "s") + " their PIN now?\n\n" +
      "Sending to: " + scopeName + (onlyUnsent ? "" : " (INCLUDING students already emailed)") + "\n" +
      names.join("\n") + (plan.ready.length > names.length ? "\n  ... and " + (plan.ready.length - names.length) + " more" : "") + "\n\n" +
      (onlyUnsent ? already + " already-emailed student" + (already === 1 ? " is" : "s are") + " skipped." : "Students who already got their PIN will get it again.")
    )) return;
    let ok = 0; const failed = [];
    for (let i = 0; i < plan.ready.length; i += MAX_BATCH) {
      setLog("Sending " + Math.min(i + MAX_BATCH, plan.ready.length) + " of " + plan.ready.length + "...");
      const results = await sendPinEmails(db, plan.ready.slice(i, i + MAX_BATCH), opts);
      results.forEach((r) => (r.ok ? ok++ : failed.push(r.id + ": " + r.error)));
    }
    setLog("Sent " + ok + " email" + (ok === 1 ? "" : "s") + "." + (failed.length ? " Failed (" + failed.length + "): " + failed.slice(0, 5).join("; ") + (failed.length > 5 ? "; ..." : "") : ""));
  });

  /* For students who were emailed some other way (the old mail merge, a manual email): stops Send PINs from emailing them again */
  const markAll = () => run(async () => {
    const list = plan.ready.map((m) => m.id);
    if (!list.length) throw new Error("Nobody to mark. Only students with a valid email who are not marked yet are counted.");
    if (!window.confirm("Mark " + list.length + " student" + (list.length === 1 ? "" : "s") + " as already emailed WITHOUT sending anything? Send PINs will then skip them.")) return;
    await markEmailed(db, list);
    setLog("Marked " + list.length + " student" + (list.length === 1 ? "" : "s") + " as already emailed. No email was sent.");
  });

  return (
    <div className="card noprint" role="region" aria-label="Email PINs">
      <div className="row"><strong>Email PINs to students</strong><button className="btn small ghost" onClick={onClose}>Close</button></div>
      <p className="muted small">Each student gets only their own PIN, sent from the site (replies go to {t.replyTo || me || "you"}). Type emails in the Email column, or use **Import emails (CSV)** in the toolbar above.</p>
      <div className="row">
        <label className="inline">Send to
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {selectedIds.length > 0 && <option value="selected">Selected students ({selectedIds.length})</option>}
            <option value="section">This section</option>
            <option value="all">All sections</option>
          </select>
        </label>
        <label className="inline"><input type="checkbox" checked={onlyUnsent} onChange={(e) => setOnlyUnsent(e.target.checked)} /> Only students not emailed yet</label>
      </div>
      <div className="row">
        <label className="inline">Sender name <input value={t.sender} onChange={set("sender")} /></label>
        <label className="inline">Reply-to <input value={t.replyTo} placeholder={me} onChange={set("replyTo")} /></label>
        <label className="inline">Email pattern <input value={t.pattern} placeholder="{id}@school.edu.ph" onChange={set("pattern")} title="Used only when a student has no email saved. {id} = student number in lowercase." /></label>
      </div>
      <label className="inline" style={{ display: "block", margin: "8px 0" }}>Subject
        <input style={{ width: "100%" }} value={t.subject} onChange={set("subject")} />
      </label>
      <label className="inline" style={{ display: "block" }}>Message
        <textarea style={{ width: "100%", minHeight: 190 }} value={t.body} onChange={set("body")} />
      </label>
      <p className="muted small">Placeholders: {PLACEHOLDERS.map((p) => "{{" + p + "}}").join("  ")}. Replace "Your instructor" with your name.</p>
      <p>
        <strong>{plan.ready.length}</strong> ready to send
        {plan.skipped.length > 0 && <> · {noEmail} without a valid email · {plan.skipped.length - noEmail} skipped</>}
        {plan.unknown.length > 0 && <span style={{ color: "var(--bad)" }}> · unknown placeholder: {plan.unknown.join(", ")}</span>}
      </p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={sendTest}>Send a test to me</button>
        <button className="btn" disabled={busy || !plan.ready.length} onClick={markAll} title="Use when these students already have their PIN from another email; sends nothing">Mark as already emailed</button>
        <button className="btn primary" disabled={busy || !plan.ready.length || plan.unknown.length > 0} onClick={sendAll}>Send PINs ({plan.ready.length})</button>
      </div>
      {log && <div className="banner info" style={{ marginTop: 10 }}>{log}</div>}
    </div>
  );
}
