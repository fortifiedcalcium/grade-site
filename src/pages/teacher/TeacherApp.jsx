import React, { useEffect, useState } from "react";
import { getAuth, getDb } from "../../supabase.js";
import { isTeacher, listen } from "../../lib/db.js";
import { describeAuthError } from "../../lib/authErrors.js";
import GradesTab from "./GradesTab.jsx";
import PinsTab from "./PinsTab.jsx";
import ImportTab from "./ImportTab.jsx";
import SettingsTab from "./SettingsTab.jsx";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState("");
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (register && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const creds = { email: email.trim(), password };
      const { data, error: err } = register ? await getAuth().signUp(creds) : await getAuth().signInWithPassword(creds);
      if (err) throw err;
      if (register) {
        // With email confirmation on, Supabase answers an existing address with a user that has no identities
        if (data.user && data.user.identities && data.user.identities.length === 0) throw Object.assign(new Error("exists"), { code: "user_already_exists" });
        if (!data.session) {
          setNotice("Account created. Check your email for the confirmation link, then sign in.");
          setRegister(false);
          setPassword("");
          setConfirm("");
        }
      }
    } catch (err) {
      console.error("Sign in failed:", err);
      setError(describeAuthError(err, register));
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
        {notice && <p className="banner info" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? (register ? "Creating…" : "Signing in…") : (register ? "Create account" : "Sign in")}</button>
        <p className="small">
          <a href="#" onClick={(e) => { e.preventDefault(); setRegister(!register); setError(""); setNotice(""); }}>{register ? "Have an account? Sign in" : "Need an account? Register"}</a>
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
        <p>This account is signed in but is not marked as an instructor. In Supabase, open the SQL Editor and run:</p>
        <pre className="code">{`insert into public.admins (user_id)\nvalues ('${user.id}');`}</pre>
        <p className="muted small">Then reload this page.</p>
        <button className="btn" onClick={() => getAuth().signOut()}>Sign out</button>
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
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(t);
  }, [loading]);
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
          <button className="btn ghost" onClick={() => getAuth().signOut()}>Sign out</button>
        </div>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {error && <div className="banner">{error}</div>}
      {loading ? (
        <p className="muted">Loading data…{slow && " This is taking longer than usual. Check your connection, then reload the page."}</p>
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
  const [checkError, setCheckError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const { data } = getAuth().onAuthStateChange((_event, session) => {
      const next = session ? session.user : null;
      // Supabase re-announces the same session (token refresh, tab focus); only a different person matters.
      setUser((prev) => (prev && next && prev.id === next.id ? prev : next));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = user ? user.id : null;
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setAdmin(undefined);
    setCheckError("");
    isTeacher(getDb(), user)
      .then((v) => alive && setAdmin(v))
      .catch((err) => {
        console.error("Access check failed:", err);
        if (alive) setCheckError(err && err.code === "timeout" ? "The database did not answer in time." : "Could not reach the database (" + ((err && (err.code || err.message)) || "unknown error") + ").");
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, attempt]);

  if (user === undefined) return <main className="shell narrow"><p className="muted">Loading…</p></main>;
  if (!user) return <SignIn />;
  if (checkError) {
    return (
      <main className="shell narrow">
        <div className="card">
          <h1>Can't check access</h1>
          <p className="error" role="alert">{checkError}</p>
          <p className="muted small">Check your internet connection, then try again.</p>
          <div className="row">
            <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            <button className="btn" onClick={() => getAuth().signOut()}>Sign out</button>
          </div>
        </div>
      </main>
    );
  }
  if (admin === undefined) return <main className="shell narrow"><p className="muted">Checking access…</p></main>;
  if (!admin) return <NotAdmin user={user} />;
  return <Dashboard user={user} />;
}
