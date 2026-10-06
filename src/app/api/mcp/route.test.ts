import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getResolvedPermission: vi.fn() }));

import { getServerSession } from "next-auth";
import { getResolvedPermission } from "@/lib/permissions";
import { POST } from "./route";
import { PM_SESSION } from "../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockPermission = vi.mocked(getResolvedPermission);

function rpc(method: string, params?: unknown) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function whoami() {
  const res = await POST(rpc("tools/call", { name: "whoami", arguments: {} }));
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.result.content[0].text as string;
}

describe("POST /api/mcp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the whoami tool", async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(rpc("tools/list"));
    const body = await res.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(["whoami"]);
  });

  it("whoami reports not signed in without a session", async () => {
    mockSession.mockResolvedValue(null);
    expect(await whoami()).toBe("Not signed in to the LMS.");
    expect(mockPermission).not.toHaveBeenCalled();
  });

  it("whoami treats passcode users as not signed in", async () => {
    mockSession.mockResolvedValue({ ...PM_SESSION, isPasscodeUser: true });
    expect(await whoami()).toBe("Not signed in to the LMS.");
  });

  it("whoami resolves the caller's LMS permission", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockPermission.mockResolvedValue({
      email: PM_SESSION.user.email,
      level: 2,
      role: "program_manager",
      read_only: false,
      scope: { schools: new Set(["S1", "S2"]), centres: new Set([7]) },
    } as never);
    const summary = JSON.parse(await whoami());
    expect(mockPermission).toHaveBeenCalledWith(PM_SESSION.user.email);
    expect(summary).toMatchObject({ role: "program_manager", schools: 2, centres: 1, read_only: false });
  });
});
