import React, { Suspense, lazy } from "react";
import Icon from "./Icon.jsx";
import StudentPortal from "./pages/StudentPortal.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { isConfigured } from "./supabase.js";

const TeacherApp = lazy(() => import("./pages/teacher/TeacherApp.jsx"));

function NotConfigured() {
  return (
    <main className="shell narrow">
      <div className="card">
        <h1><Icon name="alert" size={22} /> The database is not set up yet</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env</code> and fill in your Supabase project URL and anon key,
          then rebuild. See the README for the steps.
        </p>
      </div>
    </main>
  );
}

function Page() {
  if (!isConfigured) return <NotConfigured />;
  const isTeacher = window.location.pathname.replace(/\/+$/, "").startsWith("/teacher");
  if (isTeacher) {
    return (
      <Suspense fallback={<main className="shell narrow"><p className="muted">Loading…</p></main>}>
        <TeacherApp />
      </Suspense>
    );
  }
  return <StudentPortal />;
}

export default function App() {
  return (
    <>
      <ThemeToggle />
      <Page />
    </>
  );
}
