import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/holistic-mentorship", () => ({ requireHolisticMentorshipAccess: vi.fn() }));
vi.mock("@/lib/holistic-privacy", () => ({ deleteHolisticStudentContent: vi.fn() }));

import { getServerSession } from "next-auth";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { deleteHolisticStudentContent } from "@/lib/holistic-privacy";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockAccess = vi.mocked(requireHolisticMentorshipAccess);
const mockDelete = vi.mocked(deleteHolisticStudentContent);

function mockWritableAdmin() {
  mockSession.mockResolvedValue({ user: { email: "admin@af.org" } });
  mockAccess.mockResolvedValue({
    ok: true,
    email: "admin@af.org",
    permission: { role: "admin", level: 3, regions: [], school_codes: [] },
    canEdit: true,
    actorUserId: 9,
  });
}

describe("POST /api/holistic-mentorship/privacy-deletions/:studentId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("executes an approved global Admin deletion and returns the source-coordination notice", async () => {
    mockWritableAdmin();
    mockDelete.mockResolvedValue({
      ok: true,
      profileSummariesErased: 5,
      postSessionAnswersErased: 2,
      historicalAnswersErased: 4,
    });

    const response = await POST(new Request("http://localhost/api/holistic-mentorship/privacy-deletions/41", {
      method: "POST",
      body: JSON.stringify({ approved: true, reason: "AF-approved erasure request 2026-07" }),
    }), { params: Promise.resolve({ studentId: "41" }) });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      ok: true,
      profileSummariesErased: 5,
      postSessionAnswersErased: 2,
      historicalAnswersErased: 4,
      sourceDeletionCoordination: "Quiz/BigQuery source deletion requires separate coordination.",
    });
    expect(JSON.stringify(payload)).not.toContain("AF-approved erasure request 2026-07");
    expect(JSON.stringify(payload)).not.toContain("admin@af.org");
    expect(mockAccess).toHaveBeenCalledWith(expect.anything(), "privacy_delete");
    expect(mockDelete).toHaveBeenCalledWith({
      actorUserId: 9,
      studentId: 41,
      reason: "AF-approved erasure request 2026-07",
    });
  });

  it("returns authorization denial before validating or deleting content", async () => {
    mockSession.mockResolvedValue({ user: { email: "teacher@af.org" } });
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

    const response = await POST(new Request(
      "http://localhost/api/holistic-mentorship/privacy-deletions/41",
      { method: "POST", body: JSON.stringify({ approved: true, reason: "Valid reason" }) }
    ), { params: Promise.resolve({ studentId: "41" }) });

    expect(response.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it.each([
    ["not-a-student", { approved: true, reason: "AF-approved erasure request" }],
    ["41", { approved: false, reason: "AF-approved erasure request" }],
    ["41", { approved: true, reason: "short" }],
    ["41", { approved: true, reason: "x".repeat(501) }],
  ])("rejects invalid approval input before deletion", async (studentId, body) => {
    mockWritableAdmin();

    const response = await POST(new Request(
      `http://localhost/api/holistic-mentorship/privacy-deletions/${studentId}`,
      { method: "POST", body: JSON.stringify(body) }
    ), { params: Promise.resolve({ studentId }) });

    expect(response.status).toBe(422);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns a scoped not-found result without protected details", async () => {
    mockWritableAdmin();
    mockDelete.mockResolvedValue({ ok: false, status: 404, error: "Student not found" });

    const response = await POST(new Request(
      "http://localhost/api/holistic-mentorship/privacy-deletions/999999",
      { method: "POST", body: JSON.stringify({
        approved: true,
        reason: "AF-approved erasure request",
      }) }
    ), { params: Promise.resolve({ studentId: "999999" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Student not found" });
  });
});
