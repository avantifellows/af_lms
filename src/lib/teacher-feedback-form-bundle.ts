/**
 * Generates sessionCreator's `teacher_feedback_form.py` from `FEEDBACK_QUESTIONS`,
 * so the two copies of the form can't diverge silently: `npm run
 * teacher-feedback:bundle` rewrites it and a unit test pins the output.
 *
 * Rows are shaped for sessionCreator's `CSVFormQuestion` parser (Theme, Baseline
 * Questions, Question Type, Options, Summary).
 */

import { FEEDBACK_QUESTIONS, FEEDBACK_FORM_VERSION } from "./teacher-feedback-form";

export interface FormBundleRow {
  Theme: string;
  "Baseline Questions": string;
  "Question Type": "single-choice" | "subjective";
  /** Newline-separated option texts; empty for subjective questions. */
  Options: string;
  /** "yes" marks an open-ended question (sessionCreator maps it to priority high). */
  Summary: "yes" | "no";
}

/** The theme sessionCreator groups open-ended questions under. */
const OPEN_THEME = "Open Feedback";

/** The form as sessionCreator rows, in exact form order. */
export function buildFormBundleRows(): FormBundleRow[] {
  return FEEDBACK_QUESTIONS.map((q) =>
    q.kind === "scored"
      ? {
          Theme: q.parameter,
          "Baseline Questions": q.text,
          "Question Type": "single-choice" as const,
          Options: q.options.map((o) => o.text).join("\n"),
          Summary: "no" as const,
        }
      : {
          Theme: OPEN_THEME,
          "Baseline Questions": q.text,
          "Question Type": "subjective" as const,
          Options: "",
          Summary: "yes" as const,
        }
  );
}

/**
 * sessionCreator emits one question set per theme in first-appearance order, so a
 * split theme silently reorders the form students see.
 */
export function assertContiguousThemes(rows: FormBundleRow[]): void {
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const row of rows) {
    if (row.Theme !== previous) {
      if (seen.has(row.Theme)) {
        throw new Error(
          `Theme "${row.Theme}" is split: it appears, is interrupted, then ` +
            `reappears. sessionCreator groups rows by theme, so this reorders ` +
            `the form. Move the theme's questions together.`
        );
      }
      seen.add(row.Theme);
      previous = row.Theme;
    }
  }
}

/** Python string literal with double quotes, matching the committed file's style. */
function pythonString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

const COLUMNS: (keyof FormBundleRow)[] = [
  "Theme",
  "Baseline Questions",
  "Question Type",
  "Options",
  "Summary",
];

/** Deterministic render, so a test can compare it to the committed snapshot. */
export function renderFormBundlePython(): string {
  const rows = buildFormBundleRows();
  assertContiguousThemes(rows);

  const body = rows
    .map((row) => {
      const fields = COLUMNS.map(
        (col) => `        ${pythonString(col)}: ${pythonString(row[col])}`
      ).join(",\n");
      return `    {\n${fields}\n    }`;
    })
    .join(",\n");

  return `# AUTO-GENERATED — DO NOT EDIT BY HAND.
#
# Generated from af_lms src/lib/teacher-feedback-form.ts (version ${FEEDBACK_FORM_VERSION})
# by \`npm run teacher-feedback:bundle\`. Copy this file to
# etl-data-flow/flows/sessionCreator/teacher_feedback_form.py.
#
# The Teacher Feedback (V${FEEDBACK_FORM_VERSION.replace(/^v/, "")}) student form, bundled so sessionCreator can build the
# quiz without a CMS link or Google Sheet.
#
# Question and option ORDER here is the order students see. The af_lms report
# matches responses by question text and option label rather than by position, so
# reordering no longer misattributes scores — but renaming a question or an
# option makes older responses unrecognisable to the report, so treat the text as
# the identifier it is.
#
# af_lms pins this file's contents in a unit test, so editing the form there
# without regenerating this file fails CI.

TEACHER_FEEDBACK_FORM_VERSION = ${pythonString(FEEDBACK_FORM_VERSION)}

# Rows shaped for CSVFormQuestion (columns: Theme, Baseline Questions, Question Type, Options, Summary).
TEACHER_FEEDBACK_FORM_ROWS = [
${body}
]
`;
}
