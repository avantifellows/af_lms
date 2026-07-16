import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccess, mockDetail, mockSession } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockDetail: vi.fn(),
  mockSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({ requireHolisticMentorshipAccess: mockAccess }));
vi.mock("@/lib/holistic-student-phase", () => ({ getHolisticStudentPhase: mockDetail }));

import { GET } from "./route";

const context = { params: Promise.resolve({ studentId: "41", phaseId: "73" }) };

describe("Holistic Student Phase API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { email: "mentor@example.com" } });
  });

  it("re-authorizes the current Mentor Mapping before reading a stable Phase", async () => {
    mockAccess.mockResolvedValue({
      ok: true,
      actorUserId: 9,
      permission: { role: "teacher" },
      school: { id: 4 },
    });
    mockDetail.mockResolvedValue({ student: { id: 41 }, selectedPhase: { phaseId: 73 } });

    const response = await GET(
      new Request("http://localhost/api/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027") as never,
      context
    );

    expect(response.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "mentor@example.com" } },
      "mapped_student_read",
      { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027" }
    );
    expect(mockDetail).toHaveBeenCalledWith({
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      role: "teacher",
    });
  });

  it("does not read protected Phase data after a stale bookmark loses access", async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 404, error: "Not found" });

    const response = await GET(
      new Request("http://localhost/api/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027") as never,
      context
    );

    expect(response.status).toBe(404);
    expect(mockDetail).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong Mentor", 404],
    ["former Mentor", 403],
    ["denied role", 403],
  ] as const)("blocks a %s before reading protected Phase data", async (_actor, status) => {
    mockAccess.mockResolvedValue({
      ok: false,
      status,
      error: status === 404 ? "Not found" : "Forbidden",
    });

    const response = await GET(
      new Request("http://localhost/api/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027") as never,
      context
    );

    expect(response.status).toBe(status);
    expect(mockDetail).not.toHaveBeenCalled();
  });
});
