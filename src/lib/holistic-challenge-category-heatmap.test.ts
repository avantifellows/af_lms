import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./holistic-progress", async (importOriginal) => ({
  ...await importOriginal<typeof import("./holistic-progress")>(),
  getHolisticProgressAcademicYears: vi.fn(),
}));

import { query } from "./db";
import { getHolisticChallengeCategoryHeatmap } from "./holistic-challenge-category-heatmap";
import { getHolisticProgressAcademicYears } from "./holistic-progress";
import type { UserPermission } from "./permissions";

const mockQuery = vi.mocked(query);
const mockAcademicYears = vi.mocked(getHolisticProgressAcademicYears);

const admin: UserPermission = { email: "admin@example.com", level: 3, role: "admin" };
const programManager: UserPermission = {
  email: "pm@example.com", level: 1, role: "program_manager", school_codes: ["SCH001"],
};

const phaseRows = [
  { id: "70", position: 1, title: "Kick-off", state: "locked" },
  { id: "71", position: 2, title: "Check-in", state: "open" },
  { id: "72", position: 3, title: "Review", state: "open" },
  { id: "73", position: 4, title: "Wrap-up", state: "locked" },
];

// Total rows (no School), School rows, and a hidden School, in database order.
const gridRows = [
  { row_kind: "total", school_code: null, school_name: null, category_code: null, students: "5" },
  { row_kind: "total", school_code: null, school_name: null, category_code: "academic.exam_related", students: "3" },
  { row_kind: "total", school_code: null, school_name: null, category_code: "retired.category", students: "9" },
  { row_kind: "school", school_code: "SCH002", school_name: "Beta School", category_code: null, students: 2 },
  { row_kind: "school", school_code: "SCH002", school_name: "Beta School", category_code: "non_academic.financial", students: 1 },
  { row_kind: "school", school_code: "SCH003", school_name: "Alpha School", category_code: null, students: "2" },
  { row_kind: "school", school_code: "SCH001", school_name: "Alpha School", category_code: "academic.exam_related", students: "1" },
  { row_kind: "school", school_code: "SCH009", school_name: null, category_code: null, students: "1" },
  { row_kind: "hidden", school_code: "SCH004", school_name: "Delta School", category_code: null, students: 0 },
  { row_kind: "hidden", school_code: "SCH005", school_name: "Echo School", category_code: null, students: 0 },
];

const filters = (overrides: Partial<Parameters<typeof getHolisticChallengeCategoryHeatmap>[0]> = {}) => ({
  programIds: [1],
  allPrograms: false,
  academicYear: "2026-2027",
  grade: 11 as const,
  phaseId: null,
  ...overrides,
});

const gridCall = () => mockQuery.mock.calls.find(([sql]) => sql.includes("WITH heatmap_phases"));

describe("getHolisticChallengeCategoryHeatmap", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string) =>
      (sql.includes("WITH heatmap_phases") ? gridRows : phaseRows) as never);
    mockAcademicYears.mockReset();
    mockAcademicYears.mockResolvedValue(["2025-2026"]);
  });

  it("builds the All Schools row, Schools by name then code, and the hidden School count", async () => {
    const heatmap = await getHolisticChallengeCategoryHeatmap(filters(), admin);

    expect(heatmap?.total.studentCount).toBe(5);
    expect(heatmap?.total.counts["academic.exam_related"]).toBe(3);
    expect(heatmap?.total.counts["academic.subject_concept"]).toBe(0);
    expect(heatmap?.total.counts).not.toHaveProperty("retired.category");
    expect(heatmap?.schools.map(({ code, name, studentCount }) => [code, name, studentCount])).toEqual([
      ["SCH001", "Alpha School", 0],
      ["SCH003", "Alpha School", 2],
      ["SCH002", "Beta School", 2],
      ["SCH009", "SCH009", 1],
    ]);
    expect(heatmap?.schools[0].counts["academic.exam_related"]).toBe(1);
    expect(heatmap?.schools[2].counts["non_academic.financial"]).toBe(1);
    expect(heatmap?.hiddenSchoolCount).toBe(2);
  });

  it("lists the Grade's Phases in Plan order and defaults to the latest Open Phase", async () => {
    const heatmap = await getHolisticChallengeCategoryHeatmap(filters(), admin);

    expect(heatmap).toMatchObject({
      programIds: [1], academicYear: "2026-2027", grade: 11, phaseId: null, defaultPhaseId: 72,
    });
    expect(heatmap?.phases).toEqual([
      { id: 70, number: 1, title: "Kick-off", state: "locked" },
      { id: 71, number: 2, title: "Check-in", state: "open" },
      { id: 72, number: 3, title: "Review", state: "open" },
      { id: 73, number: 4, title: "Wrap-up", state: "locked" },
    ]);
    expect(mockQuery.mock.calls[0][1]).toEqual([1, "2026-2027", 11]);
  });

  it("defaults to All Phases when the Grade has no Open Phase", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      (sql.includes("WITH heatmap_phases") ? [] : [phaseRows[0]]) as never);

    const heatmap = await getHolisticChallengeCategoryHeatmap(filters({ grade: 12 }), admin);

    expect(heatmap?.defaultPhaseId).toBeNull();
    expect(heatmap?.total).toEqual(expect.objectContaining({ studentCount: 0 }));
    expect(heatmap?.schools).toEqual([]);
    expect(heatmap?.hiddenSchoolCount).toBe(0);
  });

  it("passes a selected Phase of the Plan through to the aggregation without a School scope for Admins", async () => {
    const heatmap = await getHolisticChallengeCategoryHeatmap(filters({ phaseId: 71 }), admin);

    expect(heatmap?.phaseId).toBe(71);
    const [sql, params] = gridCall()!;
    expect(params).toEqual([[1], "2026-2027", 11, 71]);
    expect(sql).not.toContain("mapping_school.code = ANY");
  });

  it("rejects a Phase outside the Program's Plan without running the aggregation", async () => {
    await expect(getHolisticChallengeCategoryHeatmap(filters({ phaseId: 99 }), admin)).resolves.toBeNull();
    expect(gridCall()).toBeUndefined();
  });

  it("skips Phases for All Programs and scopes a PM to their Schools", async () => {
    mockAcademicYears.mockImplementation(async (programId) =>
      (programId === 1 ? ["2025-2026"] : ["2024-2025", "2025-2026"]));

    const heatmap = await getHolisticChallengeCategoryHeatmap(
      filters({ programIds: [1, 2], allPrograms: true }), programManager);

    expect(heatmap).toMatchObject({ programIds: [1, 2], phases: [], defaultPhaseId: null });
    expect(heatmap?.academicYears).toEqual(["2026-2027", "2025-2026", "2024-2025"]);
    expect(mockAcademicYears).toHaveBeenCalledWith(2, programManager);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = gridCall()!;
    expect(sql).toContain("AND mapping_school.code = ANY($5::text[])");
    expect(params).toEqual([[1, 2], "2026-2027", 11, null, ["SCH001"]]);
  });

  it("rejects any Phase for All Programs", async () => {
    await expect(getHolisticChallengeCategoryHeatmap(
      filters({ programIds: [1, 2], allPrograms: true, phaseId: 71 }), admin)).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
