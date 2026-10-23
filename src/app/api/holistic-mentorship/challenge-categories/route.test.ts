import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/permissions")>(),
  getResolvedPermission: vi.fn(),
}));
vi.mock("@/lib/holistic-challenge-category-heatmap", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/holistic-challenge-category-heatmap")>(),
  getHolisticChallengeCategoryHeatmap: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { GET } from "./route";
import { query } from "@/lib/db";
import { getHolisticChallengeCategoryHeatmap } from "@/lib/holistic-challenge-category-heatmap";
import { getResolvedPermission, type UserPermission } from "@/lib/permissions";
import type { ChallengeCategoryCounts } from "@/types/holistic-challenge-category-heatmap";

const mockSession = vi.mocked(getServerSession);
const mockPermission = vi.mocked(getResolvedPermission);
const mockQuery = vi.mocked(query);
const mockHeatmap = vi.mocked(getHolisticChallengeCategoryHeatmap);

const admin: UserPermission = { email: "admin@example.com", level: 3, role: "admin" };
const heatmap = {
  programIds: [1],
  academicYear: "2026-2027",
  grade: 11 as const,
  phaseId: null,
  phases: [],
  defaultPhaseId: null,
  academicYears: ["2026-2027"],
  total: { studentCount: 0, counts: {} as never },
  schools: [],
  hiddenSchoolCount: 0,
};

function get(search: string) {
  return GET(new Request(`http://localhost/api/holistic-mentorship/challenge-categories?${search}`));
}

describe("Challenge Category Heatmap API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    mockPermission.mockResolvedValue(admin);
    mockQuery.mockResolvedValue([]);
    mockHeatmap.mockResolvedValue(heatmap);
  });

  it("returns the heatmap for one Program, year, Grade and All Phases", async () => {
    const response = await get("program_id=1&academic_year=2026-2027&grade=11");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(heatmap);
    expect(mockHeatmap).toHaveBeenCalledWith(
      { programIds: [1], allPrograms: false, academicYear: "2026-2027", grade: 11, phaseId: null },
      admin,
    );
  });

  it("passes a selected Phase through", async () => {
    await get("program_id=78&academic_year=2025-2026&grade=12&phase_id=42");

    expect(mockHeatmap).toHaveBeenCalledWith(
      { programIds: [78], allPrograms: false, academicYear: "2025-2026", grade: 12, phaseId: 42 },
      admin,
    );
  });

  it.each([
    ["a missing Grade", "program_id=1&academic_year=2026-2027"],
    ["an empty Grade", "program_id=1&academic_year=2026-2027&grade="],
    ["an invalid Grade", "program_id=1&academic_year=2026-2027&grade=10"],
    ["a non-canonical Grade", "program_id=1&academic_year=2026-2027&grade=11.0"],
    ["a non-Holistic Program", "program_id=64&academic_year=2026-2027&grade=11"],
    ["a missing Program", "academic_year=2026-2027&grade=11"],
    ["an invalid Academic Year", "program_id=1&academic_year=2026&grade=11"],
    ["an invalid Phase", "program_id=1&academic_year=2026-2027&grade=11&phase_id=0"],
    ["a Phase with All Programs", "program_id=all&academic_year=2026-2027&grade=11&phase_id=42"],
    ["an upper-case All Programs", "program_id=ALL&academic_year=2026-2027&grade=11"],
  ])("returns 422 for %s before authorization or any read", async (_, search) => {
    const response = await get(search);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Invalid Challenge Category Heatmap filters" });
    expect(mockPermission).not.toHaveBeenCalled();
    expect(mockHeatmap).not.toHaveBeenCalled();
  });

  it("resolves All Programs to every Holistic Program for an Admin", async () => {
    const response = await get("program_id=all&academic_year=2026-2027&grade=11");

    expect(response.status).toBe(200);
    expect(mockHeatmap).toHaveBeenCalledWith(
      { programIds: [1, 74, 94, 78, 88, 99], allPrograms: true, academicYear: "2026-2027", grade: 11, phaseId: null },
      admin,
    );
  });

  it("resolves All Programs to only a Program Manager's scoped Programs with active Centres", async () => {
    const pm: UserPermission = {
      email: "pm@example.com", level: 1, role: "program_manager", school_codes: ["SCH001"], program_ids: [1, 74, 78],
    };
    mockPermission.mockResolvedValue(pm);
    mockQuery.mockResolvedValue([{ program_id: "78" }, { program_id: "1" }]);

    const response = await get("program_id=all&academic_year=2026-2027&grade=12");

    expect(response.status).toBe(200);
    expect(mockHeatmap).toHaveBeenCalledWith(
      { programIds: [1, 78], allPrograms: true, academicYear: "2026-2027", grade: 12, phaseId: null },
      pm,
    );
  });

  it("denies All Programs to a Program Manager with no Holistic Program", async () => {
    mockPermission.mockResolvedValue({
      email: "pm@example.com", level: 1, role: "program_manager", school_codes: ["SCH001"], program_ids: [64],
    });

    const response = await get("program_id=all&academic_year=2026-2027&grade=11");

    expect(response.status).toBe(403);
    expect(mockHeatmap).not.toHaveBeenCalled();
  });

  it("denies All Programs to a Teacher", async () => {
    mockPermission.mockResolvedValue({
      email: "teacher@example.com", level: 1, role: "teacher", school_codes: ["SCH001"], program_ids: [1, 78],
    });

    const response = await get("program_id=all&academic_year=2026-2027&grade=11");

    expect(response.status).toBe(403);
    expect(mockHeatmap).not.toHaveBeenCalled();
  });

  it("returns 422 for a Phase outside that Program's Plan for the year and Grade", async () => {
    mockHeatmap.mockResolvedValue(null);

    const response = await get("program_id=1&academic_year=2026-2027&grade=11&phase_id=999");

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Invalid Challenge Category Heatmap filters" });
  });

  it("denies a Teacher", async () => {
    mockPermission.mockResolvedValue({
      email: "teacher@example.com", level: 1, role: "teacher", school_codes: ["SCH001"], program_ids: [1],
    });

    const response = await get("program_id=1&academic_year=2026-2027&grade=11");

    expect(response.status).toBe(403);
    expect(mockHeatmap).not.toHaveBeenCalled();
  });

  it("denies a Program Manager a Program outside their scope", async () => {
    mockPermission.mockResolvedValue({
      email: "pm@example.com", level: 1, role: "program_manager", school_codes: ["SCH001"], program_ids: [78],
    });

    const response = await get("program_id=1&academic_year=2026-2027&grade=11");

    expect(response.status).toBe(403);
    expect(mockHeatmap).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    mockSession.mockResolvedValue(null);

    const response = await get("program_id=1&academic_year=2026-2027&grade=11");

    expect(response.status).toBe(401);
    expect(mockHeatmap).not.toHaveBeenCalled();
  });

  describe("CSV download", () => {
    const zero = Object.fromEntries([
      "academic.subject_concept", "academic.backlogs_workload", "academic.exam_related",
      "academic.test_preparation", "academic.other", "academic.no_major_issue",
      "non_academic.time_management", "non_academic.confidence_motivation", "non_academic.adjustment",
      "non_academic.wellness", "non_academic.emotional_social", "non_academic.career_uncertainty",
      "non_academic.financial", "non_academic.communication_language", "non_academic.other",
      "non_academic.no_major_issue",
    ].map((code) => [code, 0])) as ChallengeCategoryCounts;
    const categorized = {
      ...heatmap,
      phaseId: 42,
      phases: [
        { id: 41, number: 1, title: "Settling in", state: "locked" as const },
        { id: 42, number: 2, title: "Mid-term check", state: "open" as const },
      ],
      total: {
        studentCount: 3,
        counts: { ...zero, "academic.exam_related": 2, "academic.backlogs_workload": 1, "non_academic.wellness": 3 },
      },
      schools: [
        {
          id: 1, code: "SCH001", name: "=HYPERLINK(\"x\")", studentCount: 2,
          counts: { ...zero, "academic.exam_related": 2, "non_academic.wellness": 2 },
        },
        {
          id: 2, code: "SCH002", name: "Beta School", studentCount: 1,
          counts: { ...zero, "academic.backlogs_workload": 1, "non_academic.wellness": 1 },
        },
      ],
      hiddenSchoolCount: 4,
    };
    const header = [
      "School", "UDISE Code", "Students (n)",
      "Academic - Subject/concept issues (count)", "Academic - Subject/concept issues (%)",
      "\"Academic - Backlogs, revision & workload (count)\"", "\"Academic - Backlogs, revision & workload (%)\"",
      "Academic - Exam/Test related issues (count)", "Academic - Exam/Test related issues (%)",
      "Academic - Test performance & preparation (count)", "Academic - Test performance & preparation (%)",
      "Academic - Other (count)", "Academic - Other (%)",
      "Academic - No major issue reported (count)", "Academic - No major issue reported (%)",
      "Non-academic - Time management & distractions (count)", "Non-academic - Time management & distractions (%)",
      "Non-academic - Low confidence/motivation (count)", "Non-academic - Low confidence/motivation (%)",
      "Non-academic - Adjustment difficulties (count)", "Non-academic - Adjustment difficulties (%)",
      "\"Non-academic - Wellness (health, sleep etc.) (count)\"", "\"Non-academic - Wellness (health, sleep etc.) (%)\"",
      "Non-academic - Emotional & social stress (count)", "Non-academic - Emotional & social stress (%)",
      "Non-academic - Career uncertainty (count)", "Non-academic - Career uncertainty (%)",
      "Non-academic - Financial challenges (count)", "Non-academic - Financial challenges (%)",
      "Non-academic - Communication & language (count)", "Non-academic - Communication & language (%)",
      "Non-academic - Other (count)", "Non-academic - Other (%)",
      "Non-academic - No major issue reported (count)", "Non-academic - No major issue reported (%)",
    ].join(",");

    it("downloads All Schools then each visible School with a count and % per Category", async () => {
      mockHeatmap.mockResolvedValue(categorized);

      const response = await get("program_id=1&academic_year=2026-2027&grade=11&phase_id=42&format=csv");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect((await response.text()).split("\r\n")).toEqual([
        header,
        // 1 of 3 -> 33.3, 2 of 3 -> 66.7, 3 of 3 -> 100.0
        "All Schools,,3,0,0.0,1,33.3,2,66.7,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,3,100.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0",
        "\"'=HYPERLINK(\"\"x\"\")\",SCH001,2,0,0.0,0,0.0,2,100.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,2,100.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0",
        "Beta School,SCH002,1,0,0.0,1,100.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,1,100.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0",
      ]);
    });

    it.each([
      ["an unknown format", "program_id=1&academic_year=2026-2027&grade=11&format=xlsx"],
      ["an empty format", "program_id=1&academic_year=2026-2027&grade=11&format="],
      ["a CSV with a missing Grade", "program_id=1&academic_year=2026-2027&format=csv"],
      ["a CSV for All Programs with a Phase", "program_id=all&academic_year=2026-2027&grade=11&phase_id=42&format=csv"],
    ])("returns 422 for %s before authorization or any read", async (_, search) => {
      const response = await get(search);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "Invalid Challenge Category Heatmap filters" });
      expect(mockPermission).not.toHaveBeenCalled();
      expect(mockHeatmap).not.toHaveBeenCalled();
    });

    it("returns 422 for a CSV of a Phase outside that Program's Plan", async () => {
      mockHeatmap.mockResolvedValue(null);

      const response = await get("program_id=1&academic_year=2026-2027&grade=11&phase_id=999&format=csv");

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "Invalid Challenge Category Heatmap filters" });
    });

    it.each<[string, UserPermission]>([
      ["a Teacher", { email: "teacher@example.com", level: 1, role: "teacher", school_codes: ["SCH001"], program_ids: [1] }],
      ["a Program Manager outside the Program", {
        email: "pm@example.com", level: 1, role: "program_manager", school_codes: ["SCH001"], program_ids: [78],
      }],
    ])("denies the CSV to %s", async (_, permission) => {
      mockPermission.mockResolvedValue(permission);

      const response = await get("program_id=1&academic_year=2026-2027&grade=11&format=csv");

      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Type")).not.toContain("text/csv");
      expect(mockHeatmap).not.toHaveBeenCalled();
    });

    it.each([
      ["one Program and a Phase", "program_id=1&academic_year=2026-2027&grade=11&phase_id=42",
        { ...categorized }, "challenge-categories-2026-2027-grade-11-program-1-phase-2.csv"],
      ["one Program and All Phases", "program_id=78&academic_year=2025-2026&grade=12",
        { ...categorized, programIds: [78], academicYear: "2025-2026", grade: 12 as const, phaseId: null },
        "challenge-categories-2025-2026-grade-12-program-78-all-phases.csv"],
      ["All Programs", "program_id=all&academic_year=2026-2027&grade=12",
        { ...categorized, programIds: [1, 74, 94, 78, 88, 99], grade: 12 as const, phaseId: null, phases: [] },
        "challenge-categories-2026-2027-grade-12-all-programs-all-phases.csv"],
    ])("names the file for %s", async (_, search, result, filename) => {
      mockHeatmap.mockResolvedValue(result);

      const response = await get(`${search}&format=csv`);

      expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${filename}"`);
    });
  });

  it("returns a safe JSON error without database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHeatmap.mockRejectedValue(Object.assign(new Error("private database details"), { code: "42P01" }));
    try {
      const response = await get("program_id=1&academic_year=2026-2027&grade=11");

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Unable to load Challenge Categories. Please try again." });
      expect(log).toHaveBeenCalledWith("Failed to load Challenge Category Heatmap", { code: "42P01" });
    } finally {
      log.mockRestore();
    }
  });
});
