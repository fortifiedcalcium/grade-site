import React, { useState } from "react";
import Icon from "../Icon.jsx";
import { termOf, termsOf } from "./terms.js";

/* Semester + Subject filter + Section menu for the instructor screens. Choosing a subject code narrows the Section menu to
   that subject's sections, so grades are viewed per subject and section. The subject choice is remembered for the
   browser tab, so Grades and Students & PINs stay in step. */

const KEY = "subject-filter";
const NONE = "__none";
const TKEY = "term-filter";
const readT = () => { try { return window.sessionStorage.getItem(TKEY) || ""; } catch { return ""; } };
const writeT = (v) => { try { window.sessionStorage.setItem(TKEY, v); } catch { /* storage blocked */ } };
export const rememberTerm = writeT;
const read = () => { try { return window.sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
const write = (v) => { try { window.sessionStorage.setItem(KEY, v); } catch { /* storage blocked */ } };

export const codeOf = (sec) => String((sec && sec.subject && sec.subject.code) || "").trim();

export function useSectionPicker(sections) {
  const everyId = Object.keys(sections);
  const [termChoice, setTermChoiceState] = useState(readT);
  const terms = termsOf(sections);
  // the newest semester is shown until another one is picked; a remembered one that is gone falls back to it
  const term = terms.includes(termChoice) ? termChoice : terms[0] || "";
  const allIds = everyId.filter((id) => termOf(sections[id]) === term);
  const [subject, setSubjectState] = useState(read);
  const [secId, setSecId] = useState("");

  const codes = [...new Set(allIds.map((id) => codeOf(sections[id])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const hasNone = allIds.some((id) => !codeOf(sections[id]));
  // a remembered subject that no longer exists falls back to "all"
  const subj = subject === NONE ? (hasNone ? NONE : "") : codes.includes(subject) ? subject : "";
  const visibleIds = allIds.filter((id) => !subj || (subj === NONE ? !codeOf(sections[id]) : codeOf(sections[id]) === subj));
  const activeId = visibleIds.includes(secId) ? secId : visibleIds[0] || "";

  const descOf = (code) => {
    const id = allIds.find((i) => codeOf(sections[i]) === code);
    return (id && sections[id].subject && sections[id].subject.desc) || "";
  };
  return {
    term, terms, showTerm: terms.length > 1, setTerm: (v) => { setTermChoiceState(v); writeT(v); },
    allIds, visibleIds, activeId, setSecId,
    subject: subj, codes, hasNone, descOf, showSubject: codes.length > 0 && (codes.length > 1 || hasNone),
    setSubject: (v) => { setSubjectState(v); write(v); },
  };
}

export function SectionPicker({ picker, sections }) {
  const { showTerm, term, setTerm, terms, showSubject, subject, setSubject, codes, hasNone, descOf, visibleIds, activeId, setSecId } = picker;
  return (
    <>
      {showTerm && (
        <label className="inline"><Icon name="calendar" /> Semester
          <select value={term} onChange={(e) => setTerm(e.target.value)}>
            {terms.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      )}
      {showSubject && (
        <label className="inline"><Icon name="book" /> Subject
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All subjects</option>
            {codes.map((c) => <option key={c} value={c}>{descOf(c) ? c + " – " + descOf(c) : c}</option>)}
            {hasNone && <option value={NONE}>No subject code</option>}
          </select>
        </label>
      )}
      <label className="inline"><Icon name="users" /> Section
        <select value={activeId} onChange={(e) => setSecId(e.target.value)}>
          {visibleIds.map((id) => <option key={id} value={id}>{sections[id].name}</option>)}
        </select>
      </label>
    </>
  );
}
