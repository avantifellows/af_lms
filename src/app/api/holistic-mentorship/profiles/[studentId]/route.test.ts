import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({ requireHolisticMentorshipAccess: vi.fn() }));
vi.mock("@/lib/holistic-profiles", () => ({
  getHolisticProfileAdmin: vi.fn(), requestHolisticProfileRegeneration: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { GET, POST } from "./route";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import { getHolisticProfileAdmin, requestHolisticProfileRegeneration } from "@/lib/holistic-profiles";

const mockSession = vi.mocked(getServerSession);
const mockAccess = vi.mocked(requireHolisticMentorshipAccess);

describe("Holistic Profile admin API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    mockAccess.mockResolvedValue({ ok: true, email: "admin@example.com", canEdit: true, permission: { role: "admin" } } as never);
  });

  it("returns only stored Active-configuration summaries and regeneration status", async () => {
    vi.mocked(getHolisticProfileAdmin).mockResolvedValue({
      summaries: [{ position: 1, title: "Strengths", summary: "Works with peers" }],
      regeneration: { requestKey: "key", state: "running", requestedAt: "2026-07-17", errorCode: null },
    });
    const response = await GET(
      new Request("http://localhost/api/holistic-mentorship/profiles/41?academic_year=2026-2027") as never,
      { params: Promise.resolve({ studentId: "41" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ summaries: [{ title: "Strengths" }], regeneration: { state: "running" } });
  });

  it("requires an opaque idempotency key and the regeneration action policy", async () => {
    vi.mocked(requestHolisticProfileRegeneration).mockResolvedValue({ ok: true, requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "queued" });
    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/profiles/41", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_key: "d16e7d82-dc60-4b79-a064-9ed80badc119", force: true }),
      }) as never,
      { params: Promise.resolve({ studentId: "41" }) }
    );

    expect(response.status).toBe(202);
    expect(mockAccess).toHaveBeenCalledWith(expect.anything(), "profile_regenerate");
    expect(requestHolisticProfileRegeneration).toHaveBeenCalledWith(expect.objectContaining({ email: "admin@example.com", studentId: 41 }));
  });
});
