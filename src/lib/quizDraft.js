/* Keeps the answers of a quiz in progress safe: a copy on the device (instant, works without signal) and a copy in the
   database (survives a change of device). Each change gets a higher revision number; on resume the newer copy wins. */

/* The device copy is filed under a short fingerprint of the student's secret key, never the key itself, so students sharing a
   computer cannot see each other's answers and nothing stored can be used to open anyone's record. */
function fingerprint(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* `started` is when this attempt began, so the copy of an earlier attempt is never restored into a retake. */
export const draftName = (key, quizId, started) => "quiz-draft:" + fingerprint(key + "|" + quizId) + ":" + (started || 0);

export function readDraft(name) {
  try {
    const d = JSON.parse(window.localStorage.getItem(name));
    return d && typeof d.answers === "object" && Number.isFinite(d.rev) ? d : null;
  } catch { return null; }
}

/* Returns false when the browser will not store anything (private window, storage blocked or full). */
export function writeDraft(name, answers, rev) {
  try { window.localStorage.setItem(name, JSON.stringify({ answers, rev })); return true; } catch { return false; }
}

export function removeDraft(name) {
  try { window.localStorage.removeItem(name); } catch { /* storage blocked */ }
}

/* Only answers that still fit the quiz are restored: a known question, with a choice it offers or true/false. */
export function usableAnswers(questions, answers) {
  const out = {};
  (questions || []).forEach((q) => {
    const v = answers ? answers[q.id] : undefined;
    if (q.type === "tf" ? typeof v === "boolean" : Number.isInteger(v) && v >= 0 && v < (q.choices || []).length) out[q.id] = v;
  });
  return out;
}

/* The newer of the two copies (higher revision), cleaned. */
export function restoreDraft(session, local) {
  const server = { answers: session.draft || {}, rev: Number(session.draftRev) || 0 };
  const best = local && local.rev > server.rev ? local : server;
  return { answers: usableAnswers(session.questions, best.answers), rev: best.rev, serverRev: server.rev };
}
