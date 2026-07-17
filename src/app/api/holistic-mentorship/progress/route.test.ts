import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({ requireHolisticMentorshipAccess: vi.fn() }));
vi.mock("@/lib/holistic-progress", () => ({
  DEFAULT_HOLISTIC_PROGRESS_SORT: "school",
  listHolisticProgress: vi.fn(),
  getHolisticProgressOptions: vi.fn(),
  getHolisticProgressAcademicYears: vi.fn(),
  formatHolisticProgressCsv: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { GET } from "./route";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import {
  formatHolisticProgressCsv,
  getHolisticProgressAcademicYears,
  getHolisticProgressOptions,
  listHolisticProgress,
} from "@/lib/holistic-progress";

const mockSession = vi.mocked(getServerSession);
const mockAccess = vi.mocked(requireHolisticMentorshipAccess);
const mockList = vi.mocked(listHolisticProgress);
const mockOptions = vi.mocked(getHolisticProgressOptions);
const mockAcademicYears = vi.mocked(getHolisticProgressAcademicYears);
const mockCsv = vi.mocked(formatHolisticProgressCsv);

describe("Holistic progress API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    mockAccess.mockResolvedValue({ ok: true, email: "admin@example.com", canEdit: true, permission: { role: "admin" } } as never);
    mockList.mockResolvedValue({ rows: [], counts: { totalMapped: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 } });
    mockOptions.mockResolvedValue({ schools: [], mentors: [], phases: [] });
    mockAcademicYears.mockResolvedValue(["2026-2027", "2025-2026"]);
  });

  it.each([
    "sort=sql", "sort=", "direction=sideways", "direction=", "format=", "progress=unknown", "grade=10", "phase_id=0",
    "mentor_user_id=-1", "page=0", "school_code=bad%20code", `search=${"x".repeat(101)}`,
  ])("rejects non-allowlisted filter %s without querying progress", async (filter) => {
    const response = await GET(new Request(`http://localhost/api/holistic-mentorship/progress?academic_year=2026-2027&${filter}`) as never);

    expect(response.status).toBe(422);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("rejects an unknown response format", async () => {
    const response = await GET(new Request("http://localhost/api/holistic-mentorship/progress?academic_year=2026-2027&format=xlsx") as never);
    expect(response.status).toBe(422);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("returns current results, selectors, and a refresh timestamp", async () => {
    const response = await GET(new Request("http://localhost/api/holistic-mentorship/progress?academic_year=2026-2027&page=1") as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      rows: [],
      options: { schools: [], mentors: [], phases: [] },
      academicYears: ["2026-2027", "2025-2026"],
    });
    expect(body.refreshedAt).toEqual(expect.any(String));
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ sort: "school", page: 1 }));
  });

  it("exports all matching rows with the same filters and sort", async () => {
    mockCsv.mockReturnValue("Academic Year\r\n2026-2027");
    const response = await GET(new Request("http://localhost/api/holistic-mentorship/progress?academic_year=2026-2027&format=csv&direction=desc") as never);

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ direction: "desc" }), { all: true });
    expect(mockOptions).not.toHaveBeenCalled();
    expect(mockAcademicYears).not.toHaveBeenCalled();
  });

  it("returns policy denial before reading progress", async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

    const response = await GET(new Request("http://localhost/api/holistic-mentorship/progress?academic_year=2026-2027") as never);

    expect(response.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });
});
