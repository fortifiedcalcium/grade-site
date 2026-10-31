export const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
export const fmt2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

export function fmtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch (e) {
    return "";
  }
}

export function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* A cell the teacher typed: empty = no score, a number = score, anything else (INC, DRP) is kept as text. */
export function parseScoreInput(raw) {
  const t = String(raw == null ? "" : raw).trim();
  if (t === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.slice(0, 20);
}
