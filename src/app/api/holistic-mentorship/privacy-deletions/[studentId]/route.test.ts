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

  it("rejects an approved global Admin deletion without erasing content", async () => {
    mockWritableAdmin();

    const response = await POST(new Request("http://localhost/api/holistic-mentorship/privacy-deletions/41", {
      method: "POST",
      body: JSON.stringify({ approved: true, reason: "AF-approved erasure request 2026-07" }),
    }), { params: Promise.resolve({ studentId: "41" }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mockAccess).toHaveBeenCalledWith(expect.anything(), "privacy_delete");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it.each([
    ["global Admin", { user: { email: "admin@af.org" } }],
    ["Holistic Mentorship Admin", { user: { email: "holistic-admin@af.org" } }],
    ["Teacher", { user: { email: "teacher@af.org" } }],
    ["Program Manager", { user: { email: "pm@af.org" } }],
    ["Program Admin", { user: { email: "program-admin@af.org" } }],
    ["passcode user", { user: { email: "passcode@school.org" }, isPasscodeUser: true }],
  ])("rejects %s before validating or deleting content", async (_label, session) => {
    mockSession.mockResolvedValue(session);
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

    const response = await POST(new Request(
      "http://localhost/api/holistic-mentorship/privacy-deletions/not-a-student",
      { method: "POST", body: "not-json" }
    ), { params: Promise.resolve({ studentId: "not-a-student" }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
