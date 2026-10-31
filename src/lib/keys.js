/* Student numbers, PINs and the secret record key.

   Each student's record lives at records/<key>, where <key> is derived from the student number and PIN
   with a slow hash. The database rules let anyone read a single record if they know its key, but nobody
   can list the records. So the PIN is what unlocks a record, and it is never stored in the public data. */

const te = new TextEncoder();
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I
export const KEY_ITERATIONS = 100000;

export const normId = (s) => String(s == null ? "" : s).trim().toUpperCase().replace(/\s+/g, "");
export const normPin = normId;
/* Firebase paths cannot contain . $ # [ ] / */
export const safeId = (id) => normId(id).replace(/[.$#[\]/]/g, "-");

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export function makePin(len = 6) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHA[b % 32]).join(""); // 256 is a multiple of 32, so no bias
}

export function makeSalt() {
  return hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export async function recordKey(salt, studentId, pin) {
  const base = await globalThis.crypto.subtle.importKey("raw", te.encode(normPin(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: te.encode(salt + "|" + safeId(studentId)), iterations: KEY_ITERATIONS, hash: "SHA-256" },
    base,
    128
  );
  return hex(bits);
}
