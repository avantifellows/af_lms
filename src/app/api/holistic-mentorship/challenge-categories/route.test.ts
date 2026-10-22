import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/permissions")>(),
  getResolvedPermission: vi.fn(),
}));
vi.mock("@/lib/holistic-challenge-category-heatmap", () => ({
  getHolisticChallengeCategoryHeatmap: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { GET } from "./route";
import { query } from "@/lib/db";
import { getHolisticChallengeCategoryHeatmap } from "@/lib/holistic-challenge-category-heatmap";
import { getResolvedPermission, type UserPermission } from "@/lib/permissions";

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
