/* The numbers behind the instructor's quiz dashboard, for one section. Plain functions, so they can be tested.

   quizzes: [[id, quiz]] of the section; attempts: every attempt (others are ignored); students: [[key, record]] of the section.
   Only published quizzes count towards completion and averages. A "late" attempt is graded only on the answers saved in
   time, so it is listed for review but left out of the averages and the question statistics. */
import { questionStats } from "./quiz.js";

const GRACE_MS = 30000;   // the server accepts a submit this long after the limit
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const percent = (a) => (a.total > 0 ? (a.points / a.total) * 100 : null);

export function buildDashboard({ quizzes, attempts, students, now = Date.now() }) {
  const names = new Map(students.map(([key, r]) => [key, r.name]));
  const all = Object.values(attempts || {}).filter((a) => names.has(a.key));
  const live = [], review = [], hardest = [];

  const rows = quizzes.map(([id, q]) => {
    const mine = all.filter((a) => a.quizId === id);
    const submitted = mine.filter((a) => a.submitted);
    const scores = submitted.filter((a) => !a.late).map(percent).filter((v) => v != null);
    let inProgress = 0, expired = 0, flagged = 0;

    mine.forEach((a) => {
      const ends = q.timeLimit && a.started ? a.started + q.timeLimit * 60000 : null;
      const open = !a.submitted;
      const over = open && ends != null && now > ends + GRACE_MS;
      if (over) expired++;
      else if (open) {
        inProgress++;
        live.push({ quizId: id, quiz: q.title, key: a.key, name: names.get(a.key), started: a.started, leftMs: ends == null ? null : Math.max(0, ends - now), violations: a.violations, limit: q.lockdown ? q.maxViolations : null });
      }
      const atLimit = q.lockdown && a.violations >= q.maxViolations;
      if (a.violations > 0) flagged++;
      const reasons = [
        a.violations > 0 && a.violations + " warning" + (a.violations === 1 ? "" : "s") + (atLimit ? " (reached the limit)" : ""),
        a.late && "submitted late: " + (a.points ?? 0) + " / " + (a.total ?? 0) + " from answers saved in time",
        over && "time ran out, never submitted",
      ].filter(Boolean);
      const kinds = [a.violations > 0 && "warning", a.late && "late", over && "unsubmitted"].filter(Boolean);   // same order as reasons
      if (reasons.length) review.push({ quizId: id, quiz: q.title, key: a.key, name: names.get(a.key), reasons, kinds, violations: a.violations, serious: Boolean(atLimit || a.late || over) });
    });

    questionStats(q, submitted).forEach((s, n) => {
      if (s.taken > 0) hardest.push({ quizId: id, quiz: q.title, number: n + 1, text: s.q.text, right: s.right, taken: s.taken, pct: s.pct });
    });

    const started = new Set(mine.map((a) => a.key));
    return {
      id, title: q.title, published: q.published,
      submitted: submitted.length, inProgress, expired, flagged, expected: students.length,
      notStarted: students.filter(([key]) => !started.has(key)).map(([, r]) => r.name).sort((a, b) => a.localeCompare(b)),
      average: mean(scores), highest: scores.length ? Math.max(...scores) : null, lowest: scores.length ? Math.min(...scores) : null,
      scores,
    };
  });

  const published = rows.filter((r) => r.published);
  const expected = published.reduce((a, r) => a + r.expected, 0);
  const done = published.reduce((a, r) => a + r.submitted, 0);
  return {
    totals: {
      published: published.length,
      drafts: rows.length - published.length,
      students: students.length,
      submitted: done,
      expected,
      completion: expected ? (done / expected) * 100 : null,
      average: mean(published.flatMap((r) => r.scores)),
      inProgress: live.length,
      toReview: review.length,
    },
    rows,
    live: live.sort((a, b) => (a.leftMs ?? Infinity) - (b.leftMs ?? Infinity) || a.name.localeCompare(b.name)),
    review: review.sort((a, b) => b.serious - a.serious || b.violations - a.violations || a.name.localeCompare(b.name)),
    hardest: hardest.sort((a, b) => a.pct - b.pct || b.taken - a.taken).slice(0, 5),
  };
}
