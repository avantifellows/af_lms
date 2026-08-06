import { describe, expect, it } from "vitest";

import { EXAM_TRACKS } from "./exam-tracks";
import { getSubjectExamTrackCompatibilityError } from "./curriculum-subject-track";
import type { SubjectName } from "@/types/curriculum";

describe("getSubjectExamTrackCompatibilityError", () => {
  it("covers the full Curriculum Subject and Exam Track matrix", () => {
    const expected: Record<SubjectName, Array<string | null>> = {
      Physics: [null, null, null],
      Chemistry: [null, null, null],
      Maths: [null, null, "Maths is not valid with NEET"],
      Biology: [
        "Biology is not valid with JEE Main",
        "Biology is not valid with JEE Advanced",
        null,
      ],
    };

    for (const [subject, errors] of Object.entries(expected)) {
      expect(
        EXAM_TRACKS.map((examTrack) =>
          getSubjectExamTrackCompatibilityError(subject as SubjectName, examTrack)
        )
      ).toEqual(errors);
    }
  });
});
