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

const defaultSearchParams = Promise.resolve({});
const pmSession = {
  user: { email: "pm@avantifellows.org" },
};
const passcodeSession = {
  user: {},
  isPasscodeUser: true,
  schoolCode: "70705",
};

const programManagerPermission = {
  email: "pm@avantifellows.org",
  level: 3,
  role: "program_manager",
  read_only: false,
};

function setupAuth(permission = programManagerPermission) {
  mockGetServerSession.mockResolvedValue(pmSession);
  mockGetUserPermission.mockResolvedValue(permission);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
}

const inProgressVisit = {
  id: 1,
  school_code: "SC001",
  pm_email: "pm@avantifellows.org",
  school_name: "Test School A",
  visit_date: "2026-02-10",
  status: "in_progress",
  inserted_at: "2026-02-10T10:00:00Z",
  completed_at: null,
};

const completedVisit = {
  id: 2,
  school_code: "SC002",
  pm_email: "pm@avantifellows.org",
  school_name: "Test School B",
  visit_date: "2026-02-08",
  status: "completed",
  inserted_at: "2026-01-01T09:00:00Z",
  completed_at: "2026-02-09T11:00:00Z",
};

const visitNoName = {
  id: 3,
  school_code: "SC003",
  pm_email: "pm@avantifellows.org",
  school_name: null,
  visit_date: "2026-02-05",
  status: "in_progress",
  inserted_at: "2026-02-05T08:00:00Z",
  completed_at: null,
};

function formatISTDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

describe("VisitsListPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(VisitsListPage({ searchParams: defaultSearchParams })).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockGetUserPermission).not.toHaveBeenCalled();
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(VisitsListPage({ searchParams: defaultSearchParams })).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects passcode users to their school page", async () => {
    mockGetServerSession.mockResolvedValue(passcodeSession);

    await expect(VisitsListPage({ searchParams: defaultSearchParams })).rejects.toThrow("REDIRECT:/school/70705");
    expect(mockRedirect).toHaveBeenCalledWith("/school/70705");
    expect(mockGetUserPermission).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when permission is missing", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(null);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });

    await expect(VisitsListPage({ searchParams: defaultSearchParams })).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects to /dashboard when user cannot view visits", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(programManagerPermission);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });

    await expect(VisitsListPage({ searchParams: defaultSearchParams })).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockGetFeatureAccess).toHaveBeenCalledWith(programManagerPermission, "visits");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("renders in-progress visits with Continue links", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([inProgressVisit]);

    const jsx = await VisitsListPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("All Visits")).toBeInTheDocument();
    expect(screen.getByText("1 total (1 in progress)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    // Rendered in both mobile card and desktop table
    expect(screen.getAllByText("Test School A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Code: SC001").length).toBeGreaterThanOrEqual(1);

    const continueLinks = screen.getAllByText("Continue");
    expect(continueLinks[0].closest("a")).toHaveAttribute("href", "/visits/1");
  });

  it("renders completed visits with View links and uses completed_at timestamp", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([completedVisit]);

    const jsx = await VisitsListPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("1 total (0 in progress)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed" })).toBeInTheDocument();
    // Rendered in both mobile card and desktop table
    expect(screen.getAllByText("Test School B").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Code: SC002").length).toBeGreaterThanOrEqual(1);

    const completedDate = formatISTDate(completedVisit.completed_at);
    const insertedDate = formatISTDate(completedVisit.inserted_at);
    expect(screen.getAllByText(completedDate).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(insertedDate)).not.toBeInTheDocument();

    const viewLinks = screen.getAllByText("View");
    expect(viewLinks[0].closest("a")).toHaveAttribute("href", "/visits/2");
  });

  it("keeps visits list as a two-state UI with no ended state", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([inProgressVisit, completedVisit]);

    const jsx = await VisitsListPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByRole("heading", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed" })).toBeInTheDocument();
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Ended" })).not.toBeInTheDocument();
  });

  it("renders empty state when no visits exist", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([]);

    const jsx = await VisitsListPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("0 total (0 in progress)")).toBeInTheDocument();
    expect(screen.getByText("No visits recorded yet.")).toBeInTheDocument();

    const dashboardLink = screen.getByText("Go to dashboard to start a visit");
    expect(dashboardLink.closest("a")).toHaveAttribute("href", "/dashboard");

    expect(screen.queryByText("In Progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("falls back to school_code when school_name is missing", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([visitNoName]);

    const jsx = await VisitsListPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getAllByText("SC003").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Code: SC003").length).toBeGreaterThanOrEqual(1);
  });

  it("queries PM visits with role-safe pm filter", async () => {
    setupAuth();
    mockQuery.mockResolvedValue([]);

    await VisitsListPage({ searchParams: defaultSearchParams });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("LOWER(v.pm_email) = LOWER($1)");
    expect(params).toEqual(["pm@avantifellows.org"]);
  });

  it("shows scoped-role filters and maps admin filter query params", async () => {
    setupAuth({
      email: "admin@avantifellows.org",
      level: 3,
      role: "admin",
      read_only: false,
    });
    mockQuery.mockResolvedValue([completedVisit]);

    const jsx = await VisitsListPage({
      searchParams: Promise.resolve({
        school_code: "70705",
        status: "completed",
        pm_email: "pm2@avantifellows.org",
      }),
    });
    render(jsx);

    expect(screen.getByLabelText("School Code")).toHaveValue("70705");
    expect(screen.getByLabelText("Status")).toHaveValue("completed");
    expect(screen.getByLabelText("PM Email")).toHaveValue("pm2@avantifellows.org");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("LOWER(v.pm_email) = LOWER($1)");
    expect(sql).toContain("v.school_code = $2");
    expect(sql).toContain("v.status = $3");
    expect(params).toEqual(["pm2@avantifellows.org", "70705", "completed"]);
  });

  it("shows scoped filters for program_admin and applies mandatory filter params with scope", async () => {
    setupAuth({
      email: "program-admin@avantifellows.org",
      level: 2,
      role: "program_admin",
      regions: ["AHMEDABAD"],
      read_only: false,
    });
    mockQuery.mockResolvedValue([completedVisit]);

    const jsx = await VisitsListPage({
      searchParams: Promise.resolve({
        school_code: "70705",
        status: "completed",
        pm_email: "pm2@avantifellows.org",
      }),
    });
    render(jsx);

    expect(screen.getByLabelText("School Code")).toHaveValue("70705");
    expect(screen.getByLabelText("Status")).toHaveValue("completed");
    expect(screen.getByLabelText("PM Email")).toHaveValue("pm2@avantifellows.org");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("v.school_code = $2");
    expect(sql).toContain("v.status = $3");
    expect(sql).toContain("COALESCE(s.region, '') = ANY($4)");
    expect(params).toEqual(["pm2@avantifellows.org", "70705", "completed", ["AHMEDABAD"]]);
  });
});
