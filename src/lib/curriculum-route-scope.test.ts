import { describe, expect, it } from "vitest";

import { parseCurriculumRouteScope } from "./curriculum-route-scope";

describe("parseCurriculumRouteScope", () => {
  it("normalizes a complete route scope", () => {
    expect(
      parseCurriculumRouteScope({
        school_code: " LMS75 ",
        program_id: "1",
        exam_track: " jee_main ",
        grade: 11,
        subject: " Physics ",
      })
    ).toEqual({
      ok: true,
      value: {
        schoolCode: "LMS75",
        programId: 1,
        examTrack: "jee_main",
        grade: 11,
        subject: "Physics",
      },
    });
  });

  it("rejects missing and non-numeric values", () => {
    expect(parseCurriculumRouteScope({})).toEqual({
      ok: false,
      error: "school_code, program_id, exam_track, grade, and subject are required",
    });
    expect(
      parseCurriculumRouteScope({
        school_code: "LMS75",
        program_id: null,
        exam_track: "jee_main",
        grade: "not-a-grade",
        subject: "Physics",
      }).ok
    ).toBe(false);
  });
});
