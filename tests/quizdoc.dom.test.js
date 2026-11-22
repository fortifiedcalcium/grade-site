// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseQuizDocx, parseQuizBlocks } from "../src/lib/quizdoc.js";

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (t, { num = false } = {}) => `<w:p>${num ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const tbl = (rows) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
const docx = async (body) => {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "arraybuffer" });
};

describe("quiz from a Word file", () => {
  it("reads automatic-numbered questions, A-D choices and an answer key table", async () => {
    const body = [
      p("Quiz: Lessons 9 and 10"), p("Directions: Choose the letter of the best answer."), p("Part 1: Accessibility"),
      p("____ What does WCAG stand for?", { num: true }), p("A. Web Color Guide", { num: true }), p("B. Web Content Accessibility Guidelines", { num: true }), p("C. World Content", { num: true }),
      p("____ Which is a screen reader?", { num: true }), p("A. A magnifier", { num: true }), p("B. Software that reads aloud", { num: true }),
      p("Answer Key"), tbl([["No.", "Answer", "Lesson"], ["1", "B", "9"], ["2", "B", "9"]]),
    ].join("");
    const { questions, errors } = await parseQuizDocx(await docx(body));
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ type: "mc", text: "What does WCAG stand for?", choices: ["Web Color Guide", "Web Content Accessibility Guidelines", "World Content"], answer: 1 });
    expect(questions[1].choices[questions[1].answer]).toBe("Software that reads aloud");
  });
  it("reads typed numbers, a Points column, true/false and a key typed as text", async () => {
    const body = [
      p("1.  What is an API?"), p("A.  A database"), p("B.  A set of rules"),
      p("2.  HTTP 404 means not found."),
      p("3.  Pick one"), p("A. x"), p("B. y"), p("Answer: A"),
      p("Answer Key"), p("1. B   2. True"),
    ].join("");
    const { questions, errors } = await parseQuizDocx(await docx(body));
    expect(errors).toEqual([]);
    expect(questions.map((q) => [q.type, q.answer])).toEqual([["mc", 1], ["tf", true], ["mc", 0]]);
    const t = parseQuizBlocks([{ type: "p", text: "1. Q" }, { type: "p", text: "A. a" }, { type: "p", text: "B. b" }, { type: "p", text: "Answer Key" }, { type: "table", rows: [["#", "Answer", "Points"], ["1", "A", "3"]] }]);
    expect(t.questions[0].points).toBe(3);
  });
  it("reports questions with no answer and files that are not quizzes", async () => {
    const body = [p("1. Q one"), p("A. a"), p("B. b"), p("2. Q two"), p("A. a"), p("B. b"), p("Answer Key"), tbl([["No.", "Answer"], ["1", "A"]])].join("");
    const res = await parseQuizDocx(await docx(body));
    expect(res.questions).toHaveLength(1);
    expect(res.errors).toEqual(["Question 2 has no answer in the answer key."]);
    expect((await parseQuizDocx(await docx(p("Just some notes")))).errors[0]).toMatch(/No questions found/);
    await expect(parseQuizDocx(new TextEncoder().encode("not a zip").buffer)).rejects.toBeTruthy();
  });
});
