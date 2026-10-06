import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { getSession, runAsMcpCaller } from "./session";

const mockSession = vi.mocked(getServerSession);

describe("getSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is the NextAuth session outside an MCP call", async () => {
    const cookieSession = { user: { email: "browser@avantifellows.org" }, expires: "2099-01-01" };
    mockSession.mockResolvedValue(cookieSession);
    expect(await getSession()).toBe(cookieSession);
  });

  it("is the MCP caller inside runAsMcpCaller, without reading the request", async () => {
    mockSession.mockResolvedValue({ user: { email: "outer@avantifellows.org" }, expires: "2099-01-01" });
    const session = await runAsMcpCaller("caller@avantifellows.org", async () => {
      await Promise.resolve();
      return getSession();
    });
    expect(session?.user?.email).toBe("caller@avantifellows.org");
    expect(session?.isPasscodeUser).toBeUndefined();
    expect(mockSession).not.toHaveBeenCalled();
  });
});
