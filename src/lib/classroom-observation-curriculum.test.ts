import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  CLASSROOM_OBSERVATION_CURRICULUM_IDS,
  getClassroomObservationCurriculumOptions,
  isClassroomObservationGrade,
} from "./classroom-observation-curriculum";

const mockQuery = vi.mocked(query);

describe("classroom-observation-curriculum", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses only the supported classroom observation curricula", () => {
    expect(CLASSROOM_OBSERVATION_CURRICULUM_IDS).toEqual([1, 2, 9]);
  });

  it("accepts only grades 10, 11, and 12", () => {
    expect(isClassroomObservationGrade(10)).toBe(true);
    expect(isClassroomObservationGrade(11)).toBe(true);
    expect(isClassroomObservationGrade(12)).toBe(true);
    expect(isClassroomObservationGrade(9)).toBe(false);
  });

  it("maps curricula, active chapters, and active topics", async () => {
    mockQuery
      .mockResolvedValueOnce([
        { id: "1", name: "JEE Mains", code: "JMNS" },
        { id: "2", name: "NEET", code: "NEET" },
      ] as never)
      .mockResolvedValueOnce([
        {
          chapter_id: "44",
          chapter_code: "11P1",
          chapter_name: [{ lang_code: "en", chapter: "Units and Measurement" }],
          grade: "11",
          subject_id: "4",
          subject_name: [{ lang_code: "en", subject: "Physics" }],
          curriculum_id: "1",
          topic_count: "2",
        },
        {
          chapter_id: "45",
          chapter_code: "11M1",
          chapter_name: [{ lang_code: "en", chapter: "Sets" }],
          grade: "11",
          subject_id: "1",
          subject_name: [{ lang_code: "en", subject: "Mathematics" }],
          curriculum_id: "9",
          topic_count: "0",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          topic_id: "101",
          topic_code: "11P1.1",
          topic_name: [{ lang_code: "en", topic: "Physical Quantities" }],
          chapter_id: "44",
          curriculum_id: "1",
        },
      ] as never);

    const result = await getClassroomObservationCurriculumOptions({ grade: 11 });

    expect(result.curricula).toEqual([
      { id: 1, name: "JEE Mains", code: "JMNS" },
      { id: 2, name: "NEET", code: "NEET" },
    ]);
    expect(result.chapters).toEqual([
      {
        id: 44,
        code: "11P1",
        name: "Units and Measurement",
        grade: 11,
        subjectId: 4,
        subjectName: "Physics",
        curriculumId: 1,
        topicCount: 2,
      },
      {
        id: 45,
        code: "11M1",
        name: "Sets",
        grade: 11,
        subjectId: 1,
        subjectName: "Maths",
        curriculumId: 9,
        topicCount: 0,
      },
    ]);
    expect(result.topics).toEqual([
      {
        id: 101,
        code: "11P1.1",
        name: "Physical Quantities",
        chapterId: 44,
        curriculumId: 1,
      },
    ]);
  });

  it("filters archived CMS chapters and topics in SQL", async () => {
    mockQuery
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    await getClassroomObservationCurriculumOptions({ grade: 12 });

    const chapterSql = mockQuery.mock.calls[1]?.[0] as string;
    const topicSql = mockQuery.mock.calls[2]?.[0] as string;

    expect(chapterSql).toContain("ch.cms_status_id IS NULL");
    expect(chapterSql).toContain("t.cms_status_id IS NULL");
    expect(topicSql).toContain("ch.cms_status_id IS NULL");
    expect(topicSql).toContain("t.cms_status_id IS NULL");
  });
});
