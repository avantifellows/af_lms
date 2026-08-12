import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  assertContiguousThemes,
  buildFormBundleRows,
  renderFormBundlePython,
  type FormBundleRow,
} from "./teacher-feedback-form-bundle";
import {
  FEEDBACK_QUESTIONS,
  OPEN_QUESTIONS,
  SCORED_QUESTIONS,
} from "./teacher-feedback-form";

const GENERATED_PATH = join(
  __dirname,
  "generated",
  "teacher_feedback_form.py"
);

describe("teacher feedback form bundle", () => {
  it("the committed Python bundle matches the current form config", () => {
    // The guard this file exists for. sessionCreator builds the student-facing
    // quiz from the committed Python bundle while this repo scores the responses,
    // so the two must describe the same form. If this fails, run:
    //     npm run teacher-feedback:bundle
    // then copy src/lib/generated/teacher_feedback_form.py to
    // etl-data-flow/flows/sessionCreator/ and deploy sessionCreator.
    const committed = readFileSync(GENERATED_PATH, "utf8");
    expect(renderFormBundlePython()).toBe(committed);
  });

  it("emits one row per form question, in form order", () => {
    const rows = buildFormBundleRows();
    expect(rows).toHaveLength(FEEDBACK_QUESTIONS.length);
    rows.forEach((row, i) => {
      expect(row["Baseline Questions"]).toBe(FEEDBACK_QUESTIONS[i].text);
    });
  });

  it("marks scored questions single-choice with newline-joined options", () => {
    const rows = buildFormBundleRows();
    const scoredRows = rows.filter((r) => r["Question Type"] === "single-choice");
    expect(scoredRows).toHaveLength(SCORED_QUESTIONS.length);
    scoredRows.forEach((row, i) => {
      const question = SCORED_QUESTIONS[i];
      expect(row.Options.split("\n")).toEqual(question.options.map((o) => o.text));
      expect(row.Summary).toBe("no");
    });
  });

  it("marks open questions subjective, optionless, and Summary=yes", () => {
    const rows = buildFormBundleRows();
    const openRows = rows.filter((r) => r["Question Type"] === "subjective");
    expect(openRows).toHaveLength(OPEN_QUESTIONS.length);
    for (const row of openRows) {
      expect(row.Options).toBe("");
      // sessionCreator reads Summary=yes as "open-ended" (priority high).
      expect(row.Summary).toBe("yes");
      expect(row.Theme).toBe("Open Feedback");
    }
  });

  it("keeps every theme contiguous", () => {
    // sessionCreator emits one question set per theme in first-appearance order,
    // so a split theme silently reorders the form students see.
    expect(() => assertContiguousThemes(buildFormBundleRows())).not.toThrow();
  });

  it("rejects a split theme", () => {
    const split: FormBundleRow[] = [
      { Theme: "Planning", "Baseline Questions": "a", "Question Type": "single-choice", Options: "x", Summary: "no" },
      { Theme: "Concept", "Baseline Questions": "b", "Question Type": "single-choice", Options: "x", Summary: "no" },
      { Theme: "Planning", "Baseline Questions": "c", "Question Type": "single-choice", Options: "x", Summary: "no" },
    ];
    expect(() => assertContiguousThemes(split)).toThrow(/split/i);
  });

  it("escapes newlines rather than emitting a broken literal", () => {
    // Options are newline-separated, so they MUST be escaped — an unescaped
    // newline inside a single-quoted Python string is a syntax error that would
    // only surface when the Lambda imports the module.
    const python = renderFormBundlePython();
    const optionLines = python
      .split("\n")
      .filter((l) => l.trimStart().startsWith('"Options"'));
    expect(optionLines.length).toBeGreaterThan(0);
    for (const line of optionLines) {
      expect(line).toMatch(/^\s+"Options": ".*",?$/);
    }
  });
});
