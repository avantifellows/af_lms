import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  checkCurriculumConfigManagementSchema,
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

  it("checks log date and soft-delete columns required by Curriculum Summary", async () => {
    mockQuery.mockResolvedValue([]);

    await checkCurriculumSchema();

    const [, params] = mockQuery.mock.calls[0] as [string, string[]];
    expect(params).toEqual(
      expect.arrayContaining([
        "lms_curriculum_logs",
        "log_date",
        "deleted_at",
      ])
    );
  });

  it("checks config-management id and audit columns separately", async () => {
    mockQuery.mockResolvedValue([
      { table_name: "lms_chapter_exam_configs", column_name: "id" },
      {
        table_name: "lms_chapter_exam_configs",
        column_name: "updated_by_email",
      },
    ]);

    await expect(checkCurriculumConfigManagementSchema()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: [
        "lms_chapter_exam_configs.id",
        "lms_chapter_exam_configs.updated_by_email",
      ],
    });
  });

  it("checks the config-management chapter and exam track uniqueness contract", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          detail: "lms_chapter_exam_configs.chapter_id_exam_track_unique",
        },
      ]);

    await expect(checkCurriculumConfigManagementSchema()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.chapter_id_exam_track_unique"],
    });
  });

  it("returns ready when config-management columns and unique index are present", async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(checkCurriculumConfigManagementSchema()).resolves.toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("does not require config-management audit columns for existing Curriculum Summary checks", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await expect(checkCurriculumSchema()).resolves.toEqual({ ok: true });

    const [, params] = mockQuery.mock.calls[0] as [string, string[]];
    expect(params).not.toEqual(
      expect.arrayContaining([
        "id",
        "inserted_by_email",
        "updated_by_email",
        "inserted_at",
        "updated_at",
      ])
    );
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

  it("does not permanently cache unavailable schema results", async () => {
    mockQuery
      .mockResolvedValueOnce([
        { table_name: "lms_chapter_exam_configs", column_name: "exam_track" },
      ])
      .mockResolvedValueOnce([]);

    await expect(checkCurriculumSchema()).resolves.toMatchObject({ ok: false });
    await expect(checkCurriculumSchema()).resolves.toEqual({ ok: true });

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("retries after a transient preflight query failure", async () => {
    mockQuery
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce([]);

    await expect(checkCurriculumSchema()).rejects.toThrow("connection reset");
    await expect(checkCurriculumSchema()).resolves.toEqual({ ok: true });

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
