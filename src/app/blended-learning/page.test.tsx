import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetBlendedLearningAccess,
  mockListMentees,
  mockListMentorCards,
  mockCountNewFlags,
  mockListFlags,
  mockReadFlagsCutoff,
  mockRedirect,
  mockPush,
  mockLoadDashboardChrome,
} = vi.hoisted(() => ({
  mockLoadDashboardChrome: vi.fn(),
  mockPush: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockGetBlendedLearningAccess: vi.fn(),
  mockListMentees: vi.fn(),
  mockListMentorCards: vi.fn(),
  mockCountNewFlags: vi.fn(),
  mockListFlags: vi.fn(),
  mockReadFlagsCutoff: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/blended-learning",
}));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: mockGetBlendedLearningAccess,
}));
vi.mock("@/lib/blended-learning-mentees", () => ({
  listMentees: mockListMentees,
  listMentorCards: mockListMentorCards,
}));
vi.mock("@/lib/blended-learning-flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-flags")>()),
  countNewFlags: mockCountNewFlags,
  listFlags: mockListFlags,
  listFlagMentors: async () => [],
  readFlagsCutoff: mockReadFlagsCutoff,
}));
vi.mock("@/lib/curriculum-date-helpers", () => ({ getTodayIST: () => "2026-10-22" }));
vi.mock("@/lib/dashboard-chrome", () => ({ loadDashboardChrome: mockLoadDashboardChrome }));

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
    mockCountNewFlags.mockResolvedValue(0);
    mockLoadDashboardChrome.mockResolvedValue(null);
    mockListFlags.mockResolvedValue({ flags: [], nextCursor: null, newCount: 0 });
    mockReadFlagsCutoff.mockResolvedValue({ lastSeenAt: "2026-10-21T09:30:00" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    // The header names the app as plain text; the page's only H1 is its own.
    expect(screen.getByRole("banner")).toHaveTextContent("Blended Learning");
    expect(screen.queryByRole("heading", { name: "Blended Learning" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Mentor")).toBeInTheDocument();
    expect(screen.getByText("faizan@avantifellows.org")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
  });

  it("shows a Mentor their own Student list for today's IST date, grouped, under a Students heading", async () => {
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
    expect(screen.getByRole("heading", { level: 1, name: "Students" })).toBeInTheDocument();
    expect(screen.getByText("1 student · 2026-2027")).toBeInTheDocument();
    expect(screen.getByRole("rowgroup", { name: "Talk to first" })).toHaveTextContent("Ira Attempt");
    expect(screen.getByRole("region", { name: "Talk to first" })).toHaveTextContent("Ira Attempt");
    // A group with no Students is left out.
    expect(screen.queryByRole("rowgroup", { name: "Everyone else" })).not.toBeInTheDocument();
  });

  it("tells a Mentor with no Students that none are mapped to them", async () => {
    signedInAs("faizan@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(MENTOR);

    render(await BlendedLearningPage());

    expect(screen.getByRole("heading", { level: 1, name: "Students" })).toBeInTheDocument();
    expect(screen.getByText("No students are mapped to you for 2026-2027.")).toBeInTheDocument();
  });

  it("does not read a Student list for a Blended Learning Admin", async () => {
    signedInAs("juned@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);

    render(await BlendedLearningPage());

    expect(mockListMentees).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Students" })).not.toBeInTheDocument();
  });

  it("shows a Blended Learning Admin the Mentors tab with a card per Mentor", async () => {
    signedInAs("juned@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);
    mockListMentorCards.mockResolvedValue([{
      mentorUserId: 9001, name: "Faizan", assigned: 30, grade12: 18, grade13: 12, talkedLast7: 9, notSpoken30Plus: 4,
    }]);

    render(await BlendedLearningPage());

    expect(mockListMentorCards).toHaveBeenCalledWith(BLENDED_ADMIN, "2026-10-22");
    expect(screen.getByRole("heading", { level: 1, name: "Mentors" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mentors" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Faizan/ })).toHaveAttribute("href", "/blended-learning/mentors/9001");
  });

  it("shows a Blended Learning Admin the Flags tab without reading Mentor cards", async () => {
    signedInAs("juned@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);

    render(await BlendedLearningPage({ searchParams: Promise.resolve({ tab: "flags" }) }));

    expect(mockListMentorCards).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Flags" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Flags" })).toHaveAttribute("aria-current", "page");
  });

  describe("a visit to the Flags tab (QA-12)", () => {
    const FLAG = {
      id: 7, recipient: "maths", comment: "Needs help with calculus", isNew: true, inScope: true,
      conversationId: 70, occurredOn: "2026-10-20", hasNotes: false, mentorUserId: 9001, mentorName: "Faizan",
      studentId: 501, name: "Ira Attempt", grade: 12, programName: "STP Voucher Delhi", gender: "Female",
      phone: null, whatsappPhone: null, profileDocUrl: null, screenerUrl: null,
    };

    function seenPosts() {
      return vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/blended-learning/flags/seen");
    }

    it("entering the tab takes the visit's cutoff from the last visit and records the visit", async () => {
      signedInAs("juned@avantifellows.org");
      mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);
      mockListFlags.mockResolvedValue({ flags: [FLAG], nextCursor: 7, newCount: 4 });

      render(await BlendedLearningPage({ searchParams: Promise.resolve({ tab: "flags" }) }));

      expect(mockReadFlagsCutoff).toHaveBeenCalledWith(BLENDED_ADMIN);
      expect(mockListFlags).toHaveBeenCalledWith(
        BLENDED_ADMIN,
        { mentorUserId: null, recipient: null, cursor: null },
        { lastSeenAt: "2026-10-21T09:30:00" }
      );
      expect(screen.getByRole("link", { name: /Flags/ })).toHaveTextContent("4 new");
      expect(seenPosts()).toHaveLength(1);
      // Filters and pages carry the visit's cutoff.
      await userEvent.selectOptions(screen.getByLabelText("Flag Recipient"), "maths");
      expect(mockPush).toHaveBeenCalledWith("/blended-learning?tab=flags&since=2026-10-21T09%3A30%3A00&recipient=maths", {
        scroll: false,
      });
      expect(screen.getByRole("link", { name: "Older flags" })).toHaveAttribute(
        "href",
        "/blended-learning?tab=flags&since=2026-10-21T09%3A30%3A00&cursor=7"
      );
    });

    it("a filter or page change in the same visit keeps its cutoff and records nothing", async () => {
      signedInAs("juned@avantifellows.org");
      mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);
      mockListFlags.mockResolvedValue({ flags: [FLAG], nextCursor: null, newCount: 4 });

      render(
        await BlendedLearningPage({
          searchParams: Promise.resolve({ tab: "flags", mentor: "9001", cursor: "12", since: "2026-10-21T09:30:00" }),
        })
      );

      expect(mockReadFlagsCutoff).not.toHaveBeenCalled();
      expect(mockListFlags).toHaveBeenCalledWith(
        BLENDED_ADMIN,
        { mentorUserId: 9001, recipient: null, cursor: 12 },
        { lastSeenAt: "2026-10-21T09:30:00" }
      );
      expect(screen.getByRole("link", { name: /Flags/ })).toHaveTextContent("4 new");
      expect(screen.getByText("New", { exact: true })).toBeInTheDocument();
      expect(seenPosts()).toHaveLength(0);
      expect(screen.getByRole("link", { name: "Newest flags" })).toHaveAttribute(
        "href",
        "/blended-learning?tab=flags&since=2026-10-21T09%3A30%3A00&mentor=9001"
      );
    });

    it("a first visit carries \"never\", so every flag stays New", async () => {
      signedInAs("juned@avantifellows.org");
      mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);

      render(await BlendedLearningPage({ searchParams: Promise.resolve({ tab: "flags", since: "never" }) }));

      expect(mockReadFlagsCutoff).not.toHaveBeenCalled();
      expect(mockListFlags).toHaveBeenCalledWith(BLENDED_ADMIN, expect.anything(), { lastSeenAt: null });
      expect(seenPosts()).toHaveLength(0);
    });

    it("a malformed cutoff starts a new visit", async () => {
      signedInAs("juned@avantifellows.org");
      mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);

      render(await BlendedLearningPage({ searchParams: Promise.resolve({ tab: "flags", since: "2026-02-30T00:00:00" }) }));

      expect(mockReadFlagsCutoff).toHaveBeenCalled();
      expect(seenPosts()).toHaveLength(1);
    });
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

  it("shows an LMS admin the section inside the dashboard, Blended Learning tab selected", async () => {
    const access = { ...BLENDED_ADMIN, role: "admin", actorEmail: "admin@avantifellows.org" };
    signedInAs("admin@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(access);
    mockLoadDashboardChrome.mockResolvedValue({
      email: "admin@avantifellows.org",
      permission: { email: "admin@avantifellows.org", level: 3, role: "admin" },
      totalCount: 0,
      features: { hasPMAccess: true, canViewVisitSummary: true, showCurriculumSummary: false, canViewHolisticAdmin: false },
      view: "centres",
      showViews: true,
    });

    render(await BlendedLearningPage());

    expect(mockLoadDashboardChrome).toHaveBeenCalledWith(access);
    // The dashboard's header, not the section's own.
    const banner = screen.getByRole("banner");
    expect(banner).toHaveTextContent("Admin access");
    expect(within(banner).getByRole("link", { name: "Visit Summary" })).toHaveAttribute("href", "/school-visit-summary");
    expect(screen.queryByText("Blended Learning Admin")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to dashboard" })).not.toBeInTheDocument();
    // The dashboard's tab strip, Blended Learning selected; the others go back to their views.
    const tab = screen.getByRole("link", { name: "Blended Learning" });
    expect(tab).toHaveAttribute("aria-current", "page");
    expect([...tab.parentElement!.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Physical Centres", "/dashboard?view=centres"],
      ["JNV NVS Schools", "/dashboard?view=jnv-nvs"],
      ["Blended Learning", "/blended-learning"],
    ]);
    expect(screen.getByRole("navigation", { name: "Admin views" })).toBeInTheDocument();
  });

  it("gives the Blended Learning roles the section's own header, with no dashboard", async () => {
    signedInAs("juned@avantifellows.org");
    mockGetBlendedLearningAccess.mockResolvedValue(BLENDED_ADMIN);

    render(await BlendedLearningPage());

    expect(screen.getByText("Blended Learning Admin")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Physical Centres" })).not.toBeInTheDocument();
  });
});
