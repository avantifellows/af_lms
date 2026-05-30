import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserPermission } from "./permissions";

const { mockQuery, mockCheckCurriculumSchema } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCheckCurriculumSchema: vi.fn(),
}));

vi.mock("./db", () => ({ query: mockQuery }));
vi.mock("./curriculum-schema", () => ({
  checkCurriculumSchema: mockCheckCurriculumSchema,
}));

import {
  getCurriculumSummary,
  normalizeCurriculumSummarySearchParams,
} from "./curriculum-summary";

const pmPermission: UserPermission = {
  email: "pm@avantifellows.org",
  level: 3,
  role: "program_manager",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
};

describe("curriculum summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCurriculumSchema.mockResolvedValue({ ok: true });
  });

  it("returns scoped expected rows and filter options with zero placeholder metrics", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [
            {
              code: "70705",
              name: "JNV Bhavnagar",
              region: "West",
              state: "Gujarat",
              district: "Bhavnagar",
            },
          ],
          programs: [{ id: 1, name: "JNV CoE" }],
          grades: [11],
          subjects: [{ id: 4, name: "Physics" }],
          exam_tracks: ["jee_main"],
          regions: ["West"],
          states: ["Gujarat"],
          districts: ["Bhavnagar"],
        },
      ])
      .mockResolvedValueOnce([
        {
          total_count: 1,
          school_code: "70705",
          school_name: "JNV Bhavnagar",
          region: "West",
          state: "Gujarat",
          district: "Bhavnagar",
          program_id: 1,
          program_name: "JNV CoE",
          grade: 11,
          subject_id: 4,
          subject_name: "Physics",
          exam_track: "jee_main",
        },
      ]);

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams({}, "2026-05-30"),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      totalRowCount: 1,
      currentPage: 1,
      totalPages: 1,
      filterOptions: {
        schools: [{ code: "70705", name: "JNV Bhavnagar" }],
        programs: [{ id: 1, name: "JNV CoE" }],
        grades: [11],
        subjects: [{ id: 4, name: "Physics" }],
        examTracks: ["jee_main"],
        regions: ["West"],
        states: ["Gujarat"],
        districts: ["Bhavnagar"],
      },
      rows: [
        {
          rowKey: "70705:1:11:4:jee_main",
          schoolCode: "70705",
          schoolName: "JNV Bhavnagar",
          programId: 1,
          programName: "JNV CoE",
          grade: 11,
          subjectId: 4,
          subjectName: "Physics",
          examTrack: "jee_main",
          completedChapters: 0,
          totalConfiguredChapters: 0,
          prescribedChapters: 0,
          actualMinutes: 0,
          prescribedMinutes: 0,
          deltaPercent: null,
          flagged: false,
          flagReasons: [],
        },
      ],
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed list and date filters while preserving well-formed values", () => {
    const filters = normalizeCurriculumSummarySearchParams(
      {
        schools: "70705,bad code",
        programs: "1,abc,999",
        grades: "11,nope",
        subjects: "4,-1",
        exam_tracks: "jee_main,stream",
        from: "2026-02-31",
        to: "2026-05-15",
        flagged: "true",
      },
      "2026-05-30"
    );

    expect(filters).toMatchObject({
      schools: ["70705"],
      programs: [1, 999],
      grades: [11],
      subjects: [4],
      examTracks: ["jee_main"],
      preset: "custom",
      from: undefined,
      to: "2026-05-15",
      flagged: true,
      forceEmpty: false,
    });
  });

  it("keeps geography filter options independent from expected-row filters", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          schools: [],
          programs: [],
          grades: [],
          subjects: [],
          exam_tracks: [],
          regions: ["West"],
          states: ["Gujarat"],
          districts: ["Bhavnagar"],
        },
      ])
      .mockResolvedValueOnce([]);

    await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: {
        ...normalizeCurriculumSummarySearchParams(
          { schools: "OUT_OF_SCOPE" },
          "2026-05-30"
        ),
      },
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(String(mockQuery.mock.calls[0][0])).toContain(
      "LEFT JOIN filtered_rows ON true"
    );
  });

  it("defaults to the current academic year using the injected IST date", () => {
    expect(
      normalizeCurriculumSummarySearchParams({}, "2026-05-30")
    ).toMatchObject({
      preset: "current_academic_year",
      from: "2026-04-01",
      to: "2026-05-30",
    });

    expect(
      normalizeCurriculumSummarySearchParams({}, "2026-02-15")
    ).toMatchObject({
      preset: "current_academic_year",
      from: "2025-04-01",
      to: "2026-02-15",
    });
  });

  it("preserves an invalid custom range and skips the expected-row query", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        schools: [],
        programs: [],
        grades: [],
        subjects: [],
        exam_tracks: [],
        regions: [],
        states: [],
        districts: [],
      },
    ]);

    const result = await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams(
        { from: "2026-05-30", to: "2026-04-01" },
        "2026-05-30"
      ),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    expect(result).toMatchObject({
      ok: true,
      activeFilters: {
        preset: "custom",
        from: "2026-05-30",
        to: "2026-04-01",
        forceEmpty: true,
      },
      rows: [],
      totalRowCount: 0,
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("uses bulk expected-row SQL without active-student or activity-log dependencies", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        schools: [],
        programs: [],
        grades: [],
        subjects: [],
        exam_tracks: [],
        regions: [],
        states: [],
        districts: [],
      },
    ]).mockResolvedValueOnce([]);

    await getCurriculumSummary({
      actorEmail: "pm@avantifellows.org",
      permission: pmPermission,
      filters: normalizeCurriculumSummarySearchParams(
        { from: "2026-05-01", to: "2026-05-30" },
        "2026-05-30"
      ),
      sort: "school",
      dir: "asc",
      page: 1,
      pageSize: 10,
      todayIstDate: "2026-05-30",
    });

    const combinedSql = mockQuery.mock.calls
      .map(([sql]) => String(sql).toLowerCase())
      .join("\n");
    expect(combinedSql).toContain("cross join configured_rows");
    expect(combinedSql).toContain("coalesce(ss.program_ids, array[]::int[])");
    expect(combinedSql).not.toContain("group_user");
    expect(combinedSql).not.toContain("student");
    expect(combinedSql).not.toContain("lms_curriculum_logs");
    expect(combinedSql).not.toContain("log_date");
  });
});
