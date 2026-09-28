import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getResolvedPermission: vi.fn(),
  canAccessCentreSync: vi.fn(),
  canAccessSchool: vi.fn(),
}));
vi.mock("@/lib/usage-events", () => ({ recordUsageEvent: vi.fn() }));

import { getServerSession } from "next-auth";
import { canAccessCentreSync, canAccessSchool } from "@/lib/permissions";
import { recordUsageEvent } from "@/lib/usage-events";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockCentre = vi.mocked(canAccessCentreSync);
const mockSchool = vi.mocked(canAccessSchool);
const mockRecord = vi.mocked(recordUsageEvent);

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/usage/tab-view", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/usage/tab-view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSession.mockResolvedValue({ user: { email: "pm@avantifellows.org" } } as never);
  });

  it("401s without a session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ tab: "performance", schoolCode: "59525" })).status).toBe(401);
  });

  it("400s on a malformed tab id", async () => {
    expect((await post({ tab: "Perf View!", schoolCode: "59525" })).status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("403s when the viewer cannot see the school", async () => {
    mockSchool.mockResolvedValue(false);
    expect((await post({ tab: "performance", schoolCode: "59525" })).status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("records a school tab view", async () => {
    mockSchool.mockResolvedValue(true);

    expect((await post({ tab: "performance", schoolCode: "59525" })).status).toBe(204);
    expect(mockRecord).toHaveBeenCalledWith({
      event: "tab_viewed",
      email: "pm@avantifellows.org",
      role: null,
      schoolCode: "59525",
      centreId: null,
      detail: "performance",
    });
  });

  it("accepts centre-seat access for a centre page", async () => {
    mockCentre.mockReturnValue(true);

    expect((await post({ tab: "curriculum", schoolCode: "59525", centreId: 12 })).status).toBe(204);
    expect(mockSchool).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ centreId: 12 }));
  });

  it("limits passcode users to their own school", async () => {
    mockSession.mockResolvedValue({
      user: { email: "passcode-59525@school.local" },
      isPasscodeUser: true,
      schoolCode: "59525",
    } as never);

    expect((await post({ tab: "enrollment", schoolCode: "74009" })).status).toBe(403);
    expect((await post({ tab: "enrollment", schoolCode: "59525" })).status).toBe(204);
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ role: "passcode" }));
  });
});
