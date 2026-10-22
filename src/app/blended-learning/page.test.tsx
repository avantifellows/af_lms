import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockGetBlendedLearningAccess, mockRedirect } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetBlendedLearningAccess: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: mockGetBlendedLearningAccess,
}));

import BlendedLearningPage from "./page";

const MENTOR = {
  kind: "mentor",
  role: "blended_mentor",
  readOnly: false,
  actorEmail: "faizan@avantifellows.org",
  actorUserId: 9001,
  mentorUserId: 9001,
};
const BLENDED_ADMIN = {
  kind: "admin",
  role: "blended_admin",
  readOnly: false,
  actorEmail: "juned@avantifellows.org",
  actorUserId: 12,
};

function signedInAs(email: string) {
  mockGetServerSession.mockResolvedValue({ user: { email } });
}

describe("BlendedLearningPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a signed-out visitor to sign-in", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(BlendedLearningPage()).rejects.toThrow("REDIRECT:/");
  });

  it("sends a role without Blended Learning access back to the dashboard", async () => {
    signedInAs("teacher@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(null);
    await expect(BlendedLearningPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockGetBlendedLearningAccess).toHaveBeenCalledWith("teacher@avantifellows.org");
  });

  it("shows a Mentor their landing page with no way back to the dashboard", async () => {
    signedInAs("faizan@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(MENTOR);

    render(await BlendedLearningPage());

    expect(screen.getByRole("heading", { name: "Blended Learning" })).toBeInTheDocument();
    expect(screen.getByText("Mentor")).toBeInTheDocument();
    expect(screen.getByText("faizan@avantifellows.org")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
  });

  it("labels a read-only Blended Learning Admin as read only", async () => {
    signedInAs("shalinijha@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue({
      ...BLENDED_ADMIN,
      actorEmail: "shalinijha@avantifellows.org",
      readOnly: true,
    });

    render(await BlendedLearningPage());

    expect(screen.getByText("Blended Learning Admin · Read only")).toBeInTheDocument();
  });

  it("gives an LMS admin a link back to the dashboard", async () => {
    signedInAs("admin@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue({
      ...BLENDED_ADMIN,
      role: "admin",
      actorEmail: "admin@avantifellows.org",
    });

    render(await BlendedLearningPage());

    expect(screen.getByText("Blended Learning Admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard");
  });
});
