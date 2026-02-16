import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetFeatureAccess,
  mockQuery,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockQuery: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
  getFeatureAccess: mockGetFeatureAccess,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/visits/EndVisitButton", () => ({
  __esModule: true,
  default: ({ visitId, alreadyEnded }: { visitId: number; alreadyEnded: boolean }) => (
    <div data-testid="end-visit-button" data-visit-id={visitId} data-already-ended={String(alreadyEnded)}>
      EndVisitButton
    </div>
  ),
}));

import VisitDetailPage from "./page";

// ---- helpers ----

const pmSession = { user: { email: "pm@avantifellows.org" } };
const pmPermission = { level: 3, role: "pm" };
const adminSession = { user: { email: "admin@avantifellows.org" } };
const adminPermission = { level: 4, role: "admin" };

function setupPmAuth() {
  mockGetServerSession.mockResolvedValue(pmSession);
  mockGetUserPermission.mockResolvedValue(pmPermission);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
}

function setupAdminAuth() {
  mockGetServerSession.mockResolvedValue(adminSession);
  mockGetUserPermission.mockResolvedValue(adminPermission);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
}

const emptyData = {
  principalMeeting: null,
  leadershipMeetings: null,
  classroomObservations: [],
  studentDiscussions: { groupDiscussions: [], individualDiscussions: [] },
  staffMeetings: { individualMeetings: [], teamMeeting: null },
  teacherFeedback: [],
  issueLog: [],
};

const fullData = {
  principalMeeting: { notes: "done" },
  leadershipMeetings: { notes: "done" },
  classroomObservations: [{ grade: 11 }],
  studentDiscussions: {
    groupDiscussions: [{ topic: "math" }],
    individualDiscussions: [],
  },
  staffMeetings: {
    individualMeetings: [],
    teamMeeting: { notes: "done" },
  },
  teacherFeedback: [{ teacher: "T1" }],
  issueLog: [],
};

function makeVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    school_code: "SC001",
    pm_email: "pm@avantifellows.org",
    visit_date: "2026-02-10",
    status: "in_progress",
    data: emptyData,
    inserted_at: "2026-02-10T10:00:00Z",
    updated_at: "2026-02-10T10:00:00Z",
    ended_at: null,
    school_name: "Test School",
    ...overrides,
  };
}

function pageProps(id = "1") {
  return { params: Promise.resolve({ id }) };
}

// ---- tests ----

describe("VisitDetailPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -- auth redirects --

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(VisitDetailPage(pageProps())).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(VisitDetailPage(pageProps())).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user cannot view visits", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });

    await expect(VisitDetailPage(pageProps())).rejects.toThrow(
      "REDIRECT:/dashboard"
    );
    expect(mockGetFeatureAccess).toHaveBeenCalledWith(pmPermission, "visits");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // -- visit not found --

  it("renders 'Visit not found' when query returns empty", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Visit not found.")).toBeInTheDocument();
  });

  // -- ownership check --

  it("shows 'no access' when PM is not the visit owner", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ pm_email: "other-pm@avantifellows.org" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(
      screen.getByText("You do not have access to this visit.")
    ).toBeInTheDocument();
    // Should not render visit sections
    expect(screen.queryByText("Visit Sections")).not.toBeInTheDocument();
  });

  it("admin can view any visit regardless of pm_email", async () => {
    setupAdminAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ pm_email: "other-pm@avantifellows.org" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.queryByText("You do not have access to this visit.")).not.toBeInTheDocument();
    expect(screen.getByText("Test School")).toBeInTheDocument();
    expect(screen.getByText("Visit Sections")).toBeInTheDocument();
  });

  // -- visit header rendering --

  it("renders visit header with school name and visit date", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([makeVisit()]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Test School")).toBeInTheDocument();
    // Visit date is formatted with toLocaleDateString
    expect(screen.getByText(/Visit on/)).toBeInTheDocument();
    expect(screen.getByText(/Started:/)).toBeInTheDocument();
  });

  it("falls back to school_code when school_name is absent", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ school_name: undefined }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    // school_code used as heading fallback
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("SC001");
  });

  // -- status badge --

  it("shows 'In Progress' badge for active visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "in_progress", ended_at: null }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("shows 'Ended' badge for ended but not completed visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "in_progress", ended_at: "2026-02-10T17:00:00Z" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  it("shows 'Completed' badge for completed visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "completed", ended_at: "2026-02-10T17:00:00Z" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  // -- sections and progress --

  it("renders all 6 visit sections with correct names and links", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([makeVisit()]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    const sectionNames = [
      "Principal Meeting",
      "Leadership Meetings",
      "Classroom Observations",
      "Student Discussions",
      "Staff Meetings",
      "Feedback & Issues",
    ];

    for (const name of sectionNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // Check section hrefs
    const links = screen.getAllByRole("link");
    const sectionLinks = links.filter((l) =>
      l.getAttribute("href")?.startsWith("/visits/1/")
    );
    expect(sectionLinks).toHaveLength(6);
  });

  it("shows 0 of 6 sections progress when data is empty", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([makeVisit({ data: emptyData })]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("0 of 6 sections")).toBeInTheDocument();
  });

  it("shows completed section count based on data", async () => {
    setupPmAuth();
    // fullData has: principalMeeting, leadershipMeetings, classroomObservations,
    // studentDiscussions (group), staffMeetings (team), teacherFeedback = 6 complete
    mockQuery.mockResolvedValue([makeVisit({ data: fullData })]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("6 of 6 sections")).toBeInTheDocument();
  });

  it("counts partial section completion correctly", async () => {
    setupPmAuth();
    const partialData = {
      ...emptyData,
      principalMeeting: { notes: "done" },
      classroomObservations: [{ grade: 11 }],
    };
    mockQuery.mockResolvedValue([makeVisit({ data: partialData })]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("2 of 6 sections")).toBeInTheDocument();
  });

  // -- section completion via different data paths --

  it("marks Student Discussions complete via individualDiscussions", async () => {
    setupPmAuth();
    const data = {
      ...emptyData,
      studentDiscussions: {
        groupDiscussions: [],
        individualDiscussions: [{ student: "S1" }],
      },
    };
    mockQuery.mockResolvedValue([makeVisit({ data })]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("1 of 6 sections")).toBeInTheDocument();
  });

  it("marks Feedback & Issues complete via issueLog only", async () => {
    setupPmAuth();
    const data = {
      ...emptyData,
      teacherFeedback: [],
      issueLog: [{ issue: "broken AC" }],
    };
    mockQuery.mockResolvedValue([makeVisit({ data })]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("1 of 6 sections")).toBeInTheDocument();
  });

  // -- EndVisitButton rendering --

  it("renders EndVisitButton for active (in-progress, not ended) visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "in_progress", ended_at: null }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    const btn = screen.getByTestId("end-visit-button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("data-visit-id", "1");
    expect(btn).toHaveAttribute("data-already-ended", "false");
    expect(
      screen.getByText(/end the visit to record your departure/)
    ).toBeInTheDocument();
  });

  it("does not render EndVisitButton for ended visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "in_progress", ended_at: "2026-02-10T17:00:00Z" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.queryByTestId("end-visit-button")).not.toBeInTheDocument();
  });

  it("does not render EndVisitButton for completed visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "completed", ended_at: "2026-02-10T17:00:00Z" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.queryByTestId("end-visit-button")).not.toBeInTheDocument();
  });

  // -- ended confirmation --

  it("shows ended confirmation message for ended but not completed visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "in_progress", ended_at: "2026-02-10T17:00:00Z" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(
      screen.getByText(/Visit ended on/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You can still update sections above/)
    ).toBeInTheDocument();
  });

  it("does not show ended confirmation for completed visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "completed", ended_at: "2026-02-10T17:00:00Z" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(
      screen.queryByText(/You can still update sections above/)
    ).not.toBeInTheDocument();
  });

  it("does not show ended confirmation for active visit", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ status: "in_progress", ended_at: null }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(
      screen.queryByText(/Visit ended on/)
    ).not.toBeInTheDocument();
  });

  // -- ended_at display in header --

  it("shows Ended timestamp in header when visit has ended_at", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([
      makeVisit({ ended_at: "2026-02-10T17:00:00Z" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText(/Ended:/)).toBeInTheDocument();
  });

  it("does not show Ended timestamp when visit has no ended_at", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([makeVisit({ ended_at: null })]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.queryByText(/Ended:/)).not.toBeInTheDocument();
  });

  // -- navigation --

  it("renders Back to Dashboard link", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([makeVisit()]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    const backLink = screen.getByText(/Back to Dashboard/);
    expect(backLink.closest("a")).toHaveAttribute("href", "/dashboard");
  });

  // -- query verification --

  it("queries visit by id parameter", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([makeVisit()]);

    await VisitDetailPage(pageProps("42"));

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("lms_pm_school_visits");
    expect(sql).toContain("v.id = $1");
    expect(params).toEqual(["42"]);
  });
});
