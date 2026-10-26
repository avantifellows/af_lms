import { describe, expect, it } from "vitest";

import { createFakeDb } from "./__test-utils__/fake-db";
import type { Db } from "./curriculum-plans";
import { loadTracksWithContent } from "./curriculum-eligible-centres";

// In-syllabus LMS Chapter Exam Configs by Grade (id → number) and Exam Track.
const GRADE_NUMBER_BY_ID: Record<number, number> = { 3: 11, 4: 12 };
const CONFIGS = [
  { gradeId: 3, examTrack: "jee_main" },
  { gradeId: 3, examTrack: "neet" },
  { gradeId: 4, examTrack: "jee_main" },
];

// Stands in for the database: applies the loader's Grade filter to CONFIGS.
function contentDb(): Db {
  const fake = createFakeDb([
    [
      "FROM lms_chapter_exam_configs cfg",
      ([gradeIds, gradeNumbers]) =>
        CONFIGS.filter(
          ({ gradeId }) =>
            (gradeIds === null || (gradeIds as number[]).includes(gradeId)) &&
            (gradeNumbers === null ||
              (gradeNumbers as number[]).includes(GRADE_NUMBER_BY_ID[gradeId]))
        ).map(({ gradeId, examTrack }) => ({
          grade: String(GRADE_NUMBER_BY_ID[gradeId]),
          exam_track: examTrack,
        })),
    ],
  ]);
  return fake.query as unknown as Db;
}

describe("loadTracksWithContent", () => {
  it("groups the tracks with content by Grade number for the Grades asked for", async () => {
    await expect(loadTracksWithContent(contentDb(), { gradeNumbers: [11, 12] })).resolves.toEqual(
      new Map([
        [11, ["jee_main", "neet"]],
        [12, ["jee_main"]],
      ])
    );
  });

  it("matches a plan's Grade by id and leaves other Grades out", async () => {
    await expect(loadTracksWithContent(contentDb(), { gradeIds: [4] })).resolves.toEqual(
      new Map([[12, ["jee_main"]]])
    );
  });

  it("is empty when the Grade has no in-syllabus content", async () => {
    await expect(loadTracksWithContent(contentDb(), { gradeNumbers: [9] })).resolves.toEqual(new Map());
  });
});
