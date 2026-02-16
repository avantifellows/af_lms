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
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
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

import VisitsListPage from "./page";

// ---- helpers ----

const pmSession = {
  user: { email: "pm@avantifellows.org" },
};

const pmPermission = { level: 3, role: "pm" };

function setupAuth() {
  mockGetServerSession.mockResolvedValue(pmSession);
  mockGetUserPermission.mockResolvedValue(pmPermission);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
}

const inProgressVisit = {
  id: 1,
  school_code: "SC001",
  school_name: "Test School A",
  visit_date: "2026-02-10",
  status: "in_progress",
  inserted_at: "2026-02-10T10:00:00Z",
};

const completedVisit = {
  id: 2,
  school_code: "SC002",
  school_name: "Test School B",
  visit_date: "2026-02-08",
  status: "completed",
  inserted_at: "2026-02-08T09:00:00Z",
};

const visitNoName = {
  id: 3,
  school_code: "SC003",
  school_name: null,
  visit_date: "2026-02-05",
  status: "in_progress",
  inserted_at: "2026-02-05T08:00:00Z",
};

// ---- tests ----

describe("VisitsListPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(VisitsListPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockGetUserPermission).not.toHaveBeenCalled();
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(VisitsListPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user cannot view visits", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });

    await expect(VisitsListPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockGetFeatureAccess).toHaveBeenCalledWith(pmPermission, "visits");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("renders in-progress visits with Continue links", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([inProgressVisit]);

    const jsx = await VisitsListPage();
    render(jsx);

    expect(screen.getByText("All Visits")).toBeInTheDocument();
    expect(screen.getByText("1 total (1 in progress)")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Test School A")).toBeInTheDocument();
    expect(screen.getByText("Code: SC001")).toBeInTheDocument();

    const continueLink = screen.getByText("Continue");
    expect(continueLink.closest("a")).toHaveAttribute("href", "/visits/1");
  });

  it("renders completed visits with View links", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([completedVisit]);

    const jsx = await VisitsListPage();
    render(jsx);

    expect(screen.getByText("1 total (0 in progress)")).toBeInTheDocument();
    // "Completed" appears as both section heading and table column header
    expect(screen.getByRole("heading", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByText("Test School B")).toBeInTheDocument();
    expect(screen.getByText("Code: SC002")).toBeInTheDocument();

    const viewLink = screen.getByText("View");
    expect(viewLink.closest("a")).toHaveAttribute("href", "/visits/2");

    // In Progress section should not render
    expect(screen.queryByText("In Progress")).not.toBeInTheDocument();
  });

  it("renders both in-progress and completed sections", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([inProgressVisit, completedVisit]);

    const jsx = await VisitsListPage();
    render(jsx);

    expect(screen.getByText("2 total (1 in progress)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByText("Test School A")).toBeInTheDocument();
    expect(screen.getByText("Test School B")).toBeInTheDocument();
    expect(screen.getByText("Continue")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
  });

  it("renders empty state when no visits exist", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([]);

    const jsx = await VisitsListPage();
    render(jsx);

    expect(screen.getByText("0 total (0 in progress)")).toBeInTheDocument();
    expect(screen.getByText("No visits recorded yet.")).toBeInTheDocument();

    const dashboardLink = screen.getByText("Go to dashboard to start a visit");
    expect(dashboardLink.closest("a")).toHaveAttribute("href", "/dashboard");

    // Sections should not render
    expect(screen.queryByText("In Progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("falls back to school_code when school_name is missing", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([visitNoName]);

    const jsx = await VisitsListPage();
    render(jsx);

    // school_name is null, so should show school_code as the main display
    const cells = screen.getAllByText("SC003");
    // One in the main display (fallback), one in "Code: SC003"
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Code: SC003")).toBeInTheDocument();
  });

  it("queries visits for the logged-in user's email", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([]);

    await VisitsListPage();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("lms_pm_school_visits");
    expect(sql).toContain("pm_email = $1");
    expect(params).toEqual(["pm@avantifellows.org"]);
  });
});
