import { describe, expect, it } from "vitest";

import { outcomeMessage } from "./ai-test-insights-outcomes";

// The message for each outcome code, copied by hand from the PRD (#550,
// "10. AI Summary card behaviour").
describe("outcomeMessage", () => {
  it.each([
    ["missing_category_for_cutoff", "This student has no category on record. Add it in Edit Student, then try again."],
    ["unsupported_stream", "AI Summaries are available for JEE students only."],
    ["no_usable_overall_stats", "The newest ticked test has no usable scores for this student. Choose other tests."],
    ["no_candidate_tests", "The newest ticked test has no usable scores for this student. Choose other tests."],
    ["outside_current_active_scope", "This student is not in a current batch of this program."],
    ["program_unavailable", "This student's program does not match their test records."],
    ["program_mismatch", "This student's program does not match their test records."],
    ["missing_external_student_id", "This student has no Student ID on record."],
    ["timed_out", "The AI Summary took too long and was stopped."],
    ["interrupted", "The run was interrupted."],
  ])("%s reads: %s", (code, message) => {
    expect(outcomeMessage(code)).toBe(message);
  });

  it.each([["pipeline_error"], ["enqueue_rejected"], [""], [null]])(
    "any other code (%j) reads as the general message",
    (code) => {
      expect(outcomeMessage(code)).toBe("Something went wrong while writing the AI Summary.");
    },
  );

  it("does not read a code from the object's prototype as a known code", () => {
    expect(outcomeMessage("toString")).toBe("Something went wrong while writing the AI Summary.");
  });
});
