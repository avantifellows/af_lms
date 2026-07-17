import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockAccess, mockRoster, mockAssign, mockRemove } = vi.hoisted(
  () => ({
    mockSession: vi.fn(),
    mockAccess: vi.fn(),
    mockRoster: vi.fn(),
    mockAssign: vi.fn(),
    mockRemove: vi.fn(),
  })
);

vi.mock("next-auth", () => ({ getServerSession: mockSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({
  requireHolisticMentorshipAccess: mockAccess,
}));
vi.mock("@/lib/holistic-mappings", () => ({
  listHolisticAssignmentRoster: mockRoster,
  assignHolisticMentees: mockAssign,
  removeHolisticMentees: mockRemove,
}));

import { DELETE, GET, POST } from "./route";

describe("Holistic Mentorship Mapping API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { email: "teacher@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      actorUserId: 9,
      school: { id: 4, code: "SCH001" },
    });
  });

  it("returns the eligible roster even when the Teacher has zero Mappings", async () => {
    mockRoster.mockResolvedValue([]);

    const response = await GET(
      new Request(
        "http://localhost/api/holistic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027&grade=11&search=asha"
      ) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ students: [], actorUserId: 9 });
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "teacher@example.com" } },
      "roster_view",
      { schoolCode: "SCH001" }
    );
    expect(mockRoster).toHaveBeenCalledWith({
      schoolId: 4,
      academicYear: "2026-2027",
      grade: 11,
      search: "asha",
    });
  });

  it("validates and applies an atomic claim or confirmed takeover selection", async () => {
    mockAssign.mockResolvedValue({ ok: true, changed: 2 });
    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          takeover_confirmed: true,
          selections: [
            { student_id: 41, expected_mapping_id: null },
            { student_id: 42, expected_mapping_id: 74 },
          ],
        }),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "teacher@example.com" } },
      "mapping_mutation",
      { schoolCode: "SCH001" }
    );
    expect(mockAssign).toHaveBeenCalledWith({
      actorUserId: 9,
      schoolId: 4,
      academicYear: "2026-2027",
      takeoverConfirmed: true,
      selections: [
        { studentId: 41, expectedMappingId: null },
        { studentId: 42, expectedMappingId: 74 },
      ],
    });
  });

  it("requires confirmation and current Mapping revisions for removal", async () => {
    mockRemove.mockResolvedValue({ ok: true, changed: 1 });
    const response = await DELETE(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          confirmed: true,
          mappings: [{ student_id: 41, expected_mapping_id: 73 }],
        }),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith({
      actorUserId: 9,
      schoolId: 4,
      academicYear: "2026-2027",
      confirmed: true,
      mappings: [{ studentId: 41, expectedMappingId: 73 }],
    });
  });

  it.each([
    ["GET", "http://localhost/api/holistic-mentorship/mappings?school_code=SCH001&academic_year=2025-2026"],
    ["POST", "http://localhost/api/holistic-mentorship/mappings"],
    ["DELETE", "http://localhost/api/holistic-mentorship/mappings"],
  ])("rejects non-current Academic Years for %s before authorization", async (method, url) => {
    const body = method === "POST"
      ? {
          school_code: "SCH001",
          academic_year: "2025-2026",
          takeover_confirmed: false,
          selections: [{ student_id: 41, expected_mapping_id: null }],
        }
      : method === "DELETE"
        ? {
            school_code: "SCH001",
            academic_year: "2025-2026",
            confirmed: true,
            mappings: [{ student_id: 41, expected_mapping_id: 73 }],
          }
        : undefined;
    const request = new Request(url, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const response = method === "GET"
      ? await GET(request as never)
      : method === "POST"
        ? await POST(request as never)
        : await DELETE(request as never);

    expect(response.status).toBe(400);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockRoster).not.toHaveBeenCalled();
    expect(mockAssign).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
