import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetBlendedLearningAccess,
  mockListMentees,
  mockListMentorCards,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetBlendedLearningAccess: vi.fn(),
  mockListMentees: vi.fn(),
  mockListMentorCards: vi.fn(),
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
vi.mock("@/lib/blended-learning-mentees", () => ({
  listMentees: mockListMentees,
  listMentorCards: mockListMentorCards,
}));
vi.mock("@/lib/curriculum-date-helpers", () => ({ getTodayIST: () => "2026-10-22" }));

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
    mockListMentees.mockResolvedValue({ talkToFirst: [], everyoneElse: [] });
    mockListMentorCards.mockResolvedValue([]);
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

  it("shows a Mentor their own Mentee list for today's IST date, grouped", async () => {
    signedInAs("faizan@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(MENTOR);
    mockListMentees.mockResolvedValue({
      talkToFirst: [{
        studentId: 501, name: "Ira Attempt", gender: "Female", grade: 12, programId: 80,
        programName: "STP Voucher Delhi", lastContact: "2026-10-12", lastContactSource: "conversation",
        latestEntryKind: "attempt", openDraftState: null, reasons: ["attempt"], daysSince: 10,
      }],
      everyoneElse: [],
    });

    render(await BlendedLearningPage());

    expect(mockListMentees).toHaveBeenCalledWith({ access: MENTOR, today: "2026-10-22" });
    expect(screen.getByRole("region", { name: "Talk to First" })).toHaveTextContent("Ira Attempt");
    expect(screen.getByRole("region", { name: "Everyone else" })).toBeInTheDocument();
  });

  it("does not read a Mentee list for a Blended Learning Admin", async () => {
    signedInAs("juned@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);

    render(await BlendedLearningPage());

    expect(mockListMentees).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Talk to First" })).not.toBeInTheDocument();
  });

  it("shows a Blended Learning Admin the Mentors tab with a card per Mentor", async () => {
    signedInAs("juned@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);
    mockListMentorCards.mockResolvedValue([{
      mentorUserId: 9001, name: "Faizan", assigned: 30, grade12: 18, grade13: 12, talkedLast7: 9, notSpoken30Plus: 4,
    }]);

    render(await BlendedLearningPage());

    expect(mockListMentorCards).toHaveBeenCalledWith(BLENDED_ADMIN, "2026-10-22");
    expect(screen.getByRole("link", { name: "Mentors" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Faizan/ })).toHaveAttribute("href", "/blended-learning/mentors/9001");
  });

  it("shows a Blended Learning Admin the Flags tab without reading Mentor cards", async () => {
    signedInAs("juned@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);

    render(await BlendedLearningPage({ searchParams: Promise.resolve({ tab: "flags" }) }));

    expect(mockListMentorCards).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Flags" })).toHaveAttribute("aria-current", "page");
  });

  it("never reads Mentor cards for a Mentor", async () => {
    signedInAs("faizan@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(MENTOR);

    render(await BlendedLearningPage());

    expect(mockListMentorCards).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation", { name: "Admin views" })).not.toBeInTheDocument();
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
