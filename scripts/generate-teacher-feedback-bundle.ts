/**
 * Regenerate the sessionCreator Teacher Feedback form bundle from this repo's
 * form config.
 *
 *   npm run teacher-feedback:bundle
 *
 * Writes `src/lib/generated/teacher_feedback_form.py`. That file is committed and
 * pinned by a unit test, so CI fails if the form config changes without a
 * regeneration. Copy it to
 * `etl-data-flow/flows/sessionCreator/teacher_feedback_form.py` and deploy the
 * Lambda for students to see the change.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { renderFormBundlePython } from "../src/lib/teacher-feedback-form-bundle";

const OUT_PATH = join(
  __dirname,
  "..",
  "src",
  "lib",
  "generated",
  "teacher_feedback_form.py"
);

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, renderFormBundlePython(), "utf8");

console.log(`Wrote ${OUT_PATH}`);
console.log(
  "Next: copy it to etl-data-flow/flows/sessionCreator/teacher_feedback_form.py " +
    "and deploy sessionCreator."
);
