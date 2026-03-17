import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    getUserPermission: mockGetUserPermission,
    getFeatureAccess: mockGetFeatureAccess,
  };
});
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
vi.mock("@/components/visits/CompleteVisitButton", () => ({
  __esModule: true,
  default: ({ visitId }: { visitId: number }) => (
    <button type="button" data-testid="complete-visit-button" data-visit-id={visitId}>
      Complete Visit
    </button>
  ),
}));

import VisitDetailPage from "./page";

const pmSession = { user: { email: "pm@avantifellows.org" } };
const passcodeSession = { user: {}, isPasscodeUser: true, schoolCode: "70705" };
const pmPermission = {
  level: 1,
  role: "program_manager",
  email: "pm@avantifellows.org",
  school_codes: ["SC001"],
  regions: null,
  program_ids: [1],
  read_only: false,
};
const adminSession = { user: { email: "admin@avantifellows.org" } };
const adminPermission = {
  level: 2,
  role: "admin",
  email: "admin@avantifellows.org",
  school_codes: null,
  regions: ["North"],
  program_ids: [1],
  read_only: false,
};

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

function makeVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    school_code: "SC001",
    school_region: "North",
    pm_email: "pm@avantifellows.org",
    visit_date: "2026-02-10",
    status: "in_progress",
    completed_at: null,
    inserted_at: "2026-02-10T10:00:00Z",
    updated_at: "2026-02-10T10:00:00Z",
    school_name: "Test School",
    ...overrides,
  };
}

function makeActions() {
  return [
    {
      id: 101,
      visit_id: 1,
      action_type: "principal_meeting",
      status: "pending",
      started_at: null,
      ended_at: null,
      inserted_at: "2026-02-10T11:00:00Z",
      updated_at: "2026-02-10T11:00:00Z",
    },
    {
      id: 102,
      visit_id: 1,
      action_type: "classroom_observation",
      status: "completed",
      started_at: "2026-02-10T11:30:00Z",
      ended_at: "2026-02-10T11:50:00Z",
      inserted_at: "2026-02-10T11:20:00Z",
      updated_at: "2026-02-10T11:50:00Z",
    },
  ];
}

function pageProps(id = "1") {
  return { params: Promise.resolve({ id }) };
}

describe("VisitDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(VisitDetailPage(pageProps())).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user cannot view visits", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });

    await expect(VisitDetailPage(pageProps())).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("redirects passcode users to their school page", async () => {
    mockGetServerSession.mockResolvedValue(passcodeSession);

    await expect(VisitDetailPage(pageProps())).rejects.toThrow("REDIRECT:/school/70705");
    expect(mockRedirect).toHaveBeenCalledWith("/school/70705");
    expect(mockGetUserPermission).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("renders not found when visit query returns empty", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValue([]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Visit not found.")).toBeInTheDocument();
  });

  it("shows access denied when PM is not owner", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValueOnce([
      makeVisit({ pm_email: "other-pm@avantifellows.org" }),
    ]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("You do not have access to this visit.")).toBeInTheDocument();
  });

  it("allows admin to view non-owner visit", async () => {
    setupAdminAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit({ pm_email: "other-pm@avantifellows.org" })])
      .mockResolvedValueOnce(makeActions());

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Test School")).toBeInTheDocument();
    expect(screen.getByText("Action Points")).toBeInTheDocument();
  });

  it("renders action cards and progress", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce(makeActions());

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Action Points")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 action points completed")).toBeInTheDocument();
    expect(screen.getByText("Principal Meeting")).toBeInTheDocument();
    expect(screen.getByText("Classroom Observation")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByTestId("complete-visit-button")).toHaveAttribute("data-visit-id", "1");
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Visit" })).not.toBeInTheDocument();
  });

  it("renders empty action state", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([]);

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("No action points added yet.")).toBeInTheDocument();
    expect(screen.getByText("0 of 0 action points completed")).toBeInTheDocument();
  });

  it("hides write UI when visit is completed", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([
        makeVisit({
          status: "completed",
          completed_at: "2026-02-10T12:00:00Z",
        }),
      ])
      .mockResolvedValueOnce(makeActions());

    const jsx = await VisitDetailPage(pageProps());
    render(jsx);

    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getByText("This visit is completed and read-only.")).toBeInTheDocument();
    expect(screen.queryByTestId("complete-visit-button")).not.toBeInTheDocument();
  });

  it("queries visit and actions without selecting visit.data", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([]);

    await VisitDetailPage(pageProps("42"));

    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [visitSql, visitParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(visitSql).toContain("FROM lms_pm_school_visits v");
    expect(visitSql).toContain("v.id = $1");
    expect(visitSql).not.toContain("v.data");
    expect(visitParams).toEqual(["42"]);

    const [actionsSql, actionsParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(actionsSql).toContain("FROM lms_pm_school_visit_actions");
    expect(actionsSql).toContain("deleted_at IS NULL");
    expect(actionsSql).toContain("ORDER BY inserted_at ASC, id ASC");
    expect(actionsParams).toEqual(["42"]);
  });
});
