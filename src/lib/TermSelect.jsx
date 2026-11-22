import React from "react";
import { termChoices } from "./terms.js";

/* A semester dropdown. The list is the terms already in use plus the school years around today, so nobody has to type
   "2026-2027 1st Semester" by hand. A value that is not in the list (older data) is kept as an option so it still shows. */
export default function TermSelect({ value, onChange, known = [], exclude = [], blank = "", label, ...rest }) {
  const options = termChoices([...known, value], { exclude: exclude.filter((t) => t !== value) });
  return (
    <select aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)} {...rest}>
      {blank && <option value="">{blank}</option>}
      {!blank && !value && <option value="" disabled>Choose a semester</option>}
      {options.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
