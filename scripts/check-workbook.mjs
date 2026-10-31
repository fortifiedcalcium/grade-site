/* Checks a class record before you import it:
   npm run check-workbook -- "path/to/Class Record.xlsx"
   It reads every section and compares the final grade this app calculates with the one saved in your file. */
import fs from "node:fs";
import * as XLSX from "xlsx";
import { sheetsFromWorkbook, parseClassRecord } from "../src/lib/importer.js";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: npm run check-workbook -- "path/to/Class Record.xlsx"');
  process.exit(1);
}
const res = parseClassRecord(sheetsFromWorkbook(XLSX, fs.readFileSync(file), "buffer"));

res.notes.forEach((n) => console.log("Note:", n));
res.errors.forEach((e) => console.error("Error:", e));
if (res.errors.length) process.exit(1);

console.log("\nSections:");
res.sections.forEach((s) => {
  const cats = s.scheme.categories.map((c) => c.title + " " + c.weight + "%").join(", ");
  console.log("  " + s.name.padEnd(8) + String(s.count).padStart(4) + " students   " + cats);
});
console.log("Total students:", res.students.length);
res.warnings.forEach((w) => console.warn("Warning:", w));

if (res.mismatches.length) {
  console.log("\nFinal grade differs from your file for " + res.mismatches.length + " student(s):");
  res.mismatches.slice(0, 20).forEach((m) => console.log("  " + m.id + "  " + m.section + "  file " + m.sheet + "  app " + m.app));
} else {
  console.log("\nCalculated final grades match your file for all " + res.students.length + " students.");
}
