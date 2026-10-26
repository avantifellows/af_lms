import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockSession = vi.hoisted(() => vi.fn());
const mockPermission = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
);

vi.mock("next-auth", () => ({ getServerSession: mockSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getResolvedPermission: mockPermission }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import McpSetupPage from "./page";

describe("McpSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXTAUTH_URL", "https://lms.example.org");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends signed-out visitors to sign in, then back here", async () => {
    mockSession.mockResolvedValue(null);
    await expect(McpSetupPage()).rejects.toThrow("redirect:/?callbackUrl=/mcp");
  });

  it("tells a signed-in account without LMS access, without the instructions", async () => {
    mockSession.mockResolvedValue({ user: { email: "someone@gmail.com" } });
    mockPermission.mockResolvedValue(null);
    render(await McpSetupPage());
    expect(screen.getByText("No LMS access")).toBeInTheDocument();
    expect(screen.queryByLabelText("Connector address")).not.toBeInTheDocument();
  });

  it("shows LMS users this environment's connector address", async () => {
    mockSession.mockResolvedValue({ user: { email: "pm@avantifellows.org" } });
    mockPermission.mockResolvedValue({ role: "program_manager" });
    render(await McpSetupPage());
    expect(screen.getByLabelText("Connector address")).toHaveValue("https://lms.example.org/api/mcp");
    expect(screen.getByText(/claude mcp add --transport http avanti-lms https:\/\/lms.example.org\/api\/mcp/)).toBeInTheDocument();
  });
});
