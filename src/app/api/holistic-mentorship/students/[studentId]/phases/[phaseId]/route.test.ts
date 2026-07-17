import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccess, mockDetail, mockSave, mockSession } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockDetail: vi.fn(),
  mockSave: vi.fn(),
  mockSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({ requireHolisticMentorshipAccess: mockAccess }));
vi.mock("@/lib/holistic-student-phase", () => ({ getHolisticStudentPhase: mockDetail }));
vi.mock("@/lib/holistic-notes", () => ({ saveHolisticNotes: mockSave }));

import { GET, PATCH } from "./route";

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
      canEdit: false,
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
      canEdit: false,
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

  it("saves a draft through the current-Mentor policy", async () => {
    mockAccess.mockResolvedValue({
      ok: true,
      actorUserId: 9,
      permission: { role: "teacher" },
      school: { id: 4 },
    });
    mockSave.mockResolvedValue({ ok: true, changed: true, revision: 3 });

    const response = await PATCH(new Request(
      "http://localhost/api/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027",
      {
        method: "PATCH",
        body: JSON.stringify({
          action: "draft",
          expected_revision: 2,
          answers: [{ question_id: 91, answer: "A weekly plan" }],
        }),
      }
    ) as never, context);

    expect(response.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "mentor@example.com" } },
      "notes_draft",
      { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027" }
    );
    expect(mockSave).toHaveBeenCalledWith({
      mode: "draft",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      expectedRevision: 2,
      answers: [{ questionId: 91, answer: "A weekly plan" }],
      expectedMappingId: undefined,
      expectedPhaseRevision: undefined,
      confirmed: false,
    });
  });

  it("returns 401 before parsing Notes for an unauthenticated request", async () => {
    mockSession.mockResolvedValue(null);

    const response = await PATCH(new Request(
      "http://localhost/api/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027",
      { method: "PATCH", body: "invalid" }
    ) as never, context);

    expect(response.status).toBe(401);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it.each([403, 404] as const)("returns policy status %i before mutating Notes", async (status) => {
    mockAccess.mockResolvedValue({ ok: false, status, error: status === 403 ? "Forbidden" : "Not found" });

    const response = await PATCH(new Request(
      "http://localhost/api/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027",
      { method: "PATCH", body: JSON.stringify({ action: "draft", expected_revision: 0, answers: [] }) }
    ) as never, context);

    expect(response.status).toBe(status);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("returns safe revision metadata for a stale Notes write", async () => {
    mockAccess.mockResolvedValue({ ok: true, actorUserId: 9, school: { id: 4 } });
    mockSave.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Notes changed; reload the latest version",
      currentRevision: 3,
    });

    const response = await PATCH(new Request(
      "http://localhost/api/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027",
      { method: "PATCH", body: JSON.stringify({ action: "draft", expected_revision: 2, answers: [] }) }
    ) as never, context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Notes changed; reload the latest version",
      currentRevision: 3,
    });
  });

  it("rejects Submit without all current revision tokens and confirmation", async () => {
    mockAccess.mockResolvedValue({ ok: true, actorUserId: 9, school: { id: 4 } });
    const response = await PATCH(new Request(
      "http://localhost/api/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027",
      { method: "PATCH", body: JSON.stringify({ action: "submit", expected_revision: 2, answers: [] }) }
    ) as never, context);

    expect(response.status).toBe(422);
    expect(mockAccess).toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
