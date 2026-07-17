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

describe("POST /api/holistic-mentorship/privacy-deletions/:studentId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("executes an approved global Admin deletion and returns the source-coordination notice", async () => {
    mockSession.mockResolvedValue({ user: { email: "admin@af.org" } });
    mockAccess.mockResolvedValue({
      ok: true,
      email: "admin@af.org",
      permission: { role: "admin", level: 3, regions: [], school_codes: [] },
      canEdit: true,
    });
    mockDelete.mockResolvedValue({ ok: true, profilesErased: 1, notesErased: 2 });

    const response = await POST(new Request("http://localhost/api/holistic-mentorship/privacy-deletions/41", {
      method: "POST",
      body: JSON.stringify({ approved: true, reason: "AF-approved erasure request 2026-07" }),
    }), { params: Promise.resolve({ studentId: "41" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      profilesErased: 1,
      notesErased: 2,
      sourceDeletionCoordination: "Quiz/BigQuery source deletion requires separate coordination.",
    });
    expect(mockAccess).toHaveBeenCalledWith(expect.anything(), "privacy_delete");
    expect(mockDelete).toHaveBeenCalledWith({
      email: "admin@af.org",
      studentId: 41,
      reason: "AF-approved erasure request 2026-07",
    });
  });
});
