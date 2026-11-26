import React, { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

/* A "please wait" box over the whole page while a request is running, so nobody wonders whether their tap did anything and
   nobody taps again. It appears only if the request takes more than `delay` ms (a quick one would just flash), and says so when
   it takes unusually long. It does not move the keyboard focus: the quiz page watches for the student leaving it. */
export default function Busy({ show, text = "Please wait…", delay = 250, slowAfter = 8000 }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!show) { setVisible(false); setSlow(false); return undefined; }
    const a = setTimeout(() => setVisible(true), delay);
    const b = setTimeout(() => setSlow(true), slowAfter);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [show, delay, slowAfter]);
  if (!show || !visible || typeof document === "undefined") return null;
  // drawn in <body>, so it covers the page wherever the component that asked for it sits (even inside a closed <details>)
  return createPortal(
    <div className="busy-overlay" role="alertdialog" aria-modal="true" aria-busy="true" aria-labelledby={id}>
      <div className="busy-box">
        <span className="spinner" aria-hidden="true" />
        <p id={id} className="busy-text">{text}</p>
        {slow && <p className="small busy-slow">This is taking longer than usual. Please keep this page open.</p>}
      </div>
    </div>,
    document.body
  );
}

/* const [working, run] = useBusy();  <Busy show={!!working} text={working || ""} />  await run("Saving…", () => save()) */
export function useBusy() {
  const [label, setLabel] = useState(null);
  const run = useCallback(async (text, fn) => {
    setLabel(text);
    try { return await fn(); } finally { setLabel(null); }
  }, []);
  return [label, run];
}
