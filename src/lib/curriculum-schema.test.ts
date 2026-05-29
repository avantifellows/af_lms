import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  checkCurriculumSchema,
  resetCurriculumSchemaCheckForTests,
} from "./curriculum-schema";

const mockQuery = vi.mocked(query);

describe("curriculum schema preflight", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCurriculumSchemaCheckForTests();
  });

  it("returns ready when all required LMS curriculum columns are present", async () => {
    mockQuery.mockResolvedValue([]);

    await expect(checkCurriculumSchema()).resolves.toEqual({ ok: true });
  });

  it("returns unavailable details when a required table or column is missing", async () => {
    mockQuery.mockResolvedValue([
      { table_name: "lms_chapter_exam_configs", column_name: "exam_track" },
    ]);

    await expect(checkCurriculumSchema()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.exam_track"],
    });
  });

  it("caches the preflight result until tests reset it", async () => {
    mockQuery.mockResolvedValue([]);

    await checkCurriculumSchema();
    await checkCurriculumSchema();

    expect(mockQuery).toHaveBeenCalledTimes(1);

    resetCurriculumSchemaCheckForTests();
    await checkCurriculumSchema();

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
