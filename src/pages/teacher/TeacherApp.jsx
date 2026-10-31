import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { getAuthInstance, getDb } from "../../firebase.js";
import { goOnline } from "firebase/database";
import { isTeacher, listen } from "../../lib/db.js";
import GradesTab from "./GradesTab.jsx";
import PinsTab from "./PinsTab.jsx";
import ImportTab from "./ImportTab.jsx";
import SettingsTab from "./SettingsTab.jsx";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (register && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      if (register) await createUserWithEmailAndPassword(getAuthInstance(), email.trim(), password);
      else await signInWithEmailAndPassword(getAuthInstance(), email.trim(), password);
    } catch (err) {
      console.error("Sign in failed:", err);
      const code = err?.code || "";
      const reasons = {
        "auth/invalid-credential": "Wrong email or password, or this user doesn't exist in Firebase Authentication.",
        "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
        "auth/weak-password": "Password is too weak. Use at least 6 characters.",
        "auth/invalid-email": "That email address isn't valid.",
        "auth/user-disabled": "This account is disabled in Firebase Authentication.",
        "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
        "auth/network-request-failed": "Network error. Check your connection.",
        "auth/operation-not-allowed": "Email/Password sign-in isn't enabled. Enable it in Firebase console > Authentication > Sign-in method.",
        "auth/invalid-api-key": "The Firebase API key in .env is invalid.",
        "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The Firebase API key in .env is invalid.",
        "auth/configuration-not-found": "Authentication isn't set up for this Firebase project. Click Get started in Firebase console > Authentication.",
        "auth/unauthorized-domain": "This domain isn't authorized. Add it in Firebase console > Authentication > Settings > Authorized domains.",
      };
      setError(`${register ? "Registration" : "Sign in"} failed. ${reasons[code] || "Check your email and password."}${code ? ` (${code})` : ""}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="shell narrow">
      <form className="card login" onSubmit={submit}>
        <img className="logo" src="/bulsu-logo.png" alt="Bulacan State University" />
        <h1>{register ? "Create instructor account" : "Instructor sign in"}</h1>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={register ? "new-password" : "current-password"} /></label>
        {register && <label>Confirm password<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? (register ? "Creating…" : "Signing in…") : (register ? "Create account" : "Sign in")}</button>
        <p className="small">
          <a href="#" onClick={(e) => { e.preventDefault(); setRegister(!register); setError(""); }}>{register ? "Have an account? Sign in" : "Need an account? Register"}</a>
          {" · "}<a href="/">Student view</a>
        </p>
      </form>
    </main>
  );
}

function NotAdmin({ user }) {
  return (
    <main className="shell narrow">
      <div className="card">
        <h1>No access yet</h1>
        <p>This account is signed in but is not marked as an instructor. In the Firebase console, open Realtime Database and add:</p>
        <pre className="code">{`admins\n  ${user.uid}: true`}</pre>
        <p className="muted small">Then reload this page.</p>
        <button className="btn" onClick={() => signOut(getAuthInstance())}>Sign out</button>
      </div>
    </main>
  );
}

const TABS = [
  ["grades", "Grades"],
  ["pins", "Students & PINs"],
  ["import", "Import"],
  ["settings", "Settings"],
];

function Dashboard({ user }) {
  const db = getDb();
  const [tab, setTab] = useState("grades");
  const [meta, setMeta] = useState(undefined);
  const [sections, setSections] = useState(undefined);
  const [roster, setRoster] = useState(undefined);
  const [records, setRecords] = useState(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    goOnline(db);
    const onErr = () => setError("Lost access to the database. Check your connection or the rules.");
    const offs = [
      listen(db, "meta", setMeta, onErr),
      listen(db, "sections", setSections, onErr),
      listen(db, "roster", setRoster, onErr),
      listen(db, "records", setRecords, onErr),
    ];
    return () => offs.forEach((off) => off());
  }, [db]);

  const loading = [meta, sections, roster, records].some((x) => x === undefined);
  const ctx = { db, meta: meta || {}, sections: sections || {}, roster: roster || {}, records: records || {} };

  return (
    <main className="shell wide">
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="/bulsu-logo.png" alt="Bulacan State University" />
          <div>
            <h1>Grade Portal – Instructor</h1>
            <p className="muted small">{user.email}</p>
          </div>
        </div>
        <div className="row">
          <a className="btn ghost" href="/">Student view</a>
          <button className="btn ghost" onClick={() => signOut(getAuthInstance())}>Sign out</button>
        </div>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {error && <div className="banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading data…</p>
      ) : tab === "grades" ? (
        <GradesTab {...ctx} goImport={() => setTab("import")} />
      ) : tab === "pins" ? (
        <PinsTab {...ctx} />
      ) : tab === "import" ? (
        <ImportTab {...ctx} />
      ) : (
        <SettingsTab {...ctx} />
      )}
    </main>
  );
}

export default function TeacherApp() {
  const [user, setUser] = useState(undefined);
  const [admin, setAdmin] = useState(undefined);

  useEffect(() => onAuthStateChanged(getAuthInstance(), (u) => { setUser(u); setAdmin(undefined); }), []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    goOnline(getDb());
    isTeacher(getDb(), user.uid).then((v) => alive && setAdmin(v)).catch(() => alive && setAdmin(false));
    return () => { alive = false; };
  }, [user]);

  if (user === undefined) return <main className="shell narrow"><p className="muted">Loading…</p></main>;
  if (!user) return <SignIn />;
  if (admin === undefined) return <main className="shell narrow"><p className="muted">Checking access…</p></main>;
  if (!admin) return <NotAdmin user={user} />;
  return <Dashboard user={user} />;
}
