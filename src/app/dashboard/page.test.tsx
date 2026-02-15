import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetProgramContextSync,
  mockGetFeatureAccess,
  mockGetAccessibleSchoolCodes,
  mockQuery,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetProgramContextSync: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockGetAccessibleSchoolCodes: vi.fn(),
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
  getProgramContextSync: mockGetProgramContextSync,
  getFeatureAccess: mockGetFeatureAccess,
  getAccessibleSchoolCodes: mockGetAccessibleSchoolCodes,
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

// Mock child components as stubs
vi.mock("@/components/SchoolSearch", () => ({
  __esModule: true,
  default: ({ defaultValue }: { defaultValue?: string }) => (
    <div data-testid="school-search" data-default-value={defaultValue || ""}>
      SchoolSearch
    </div>
  ),
}));

vi.mock("@/components/StudentSearch", () => ({
  __esModule: true,
  default: () => <div data-testid="student-search">StudentSearch</div>,
}));

vi.mock("@/components/SchoolCard", () => ({
  __esModule: true,
  default: ({
    school,
    href,
    showStudentCount,
    showGradeBreakdown,
    showRegion,
    actions,
  }: {
    school: { id: string; code: string; name: string };
    href: string;
    showStudentCount?: boolean;
    showGradeBreakdown?: boolean;
    showRegion?: boolean;
    actions?: React.ReactNode;
  }) => (
    <div
      data-testid={`school-card-${school.code}`}
      data-href={href}
      data-show-student-count={String(!!showStudentCount)}
      data-show-grade-breakdown={String(!!showGradeBreakdown)}
      data-show-region={String(!!showRegion)}
    >
      {school.name}
      {actions && <div data-testid="school-card-actions">{actions}</div>}
    </div>
  ),
  School: {},
  GradeCount: {},
}));

vi.mock("@/components/Pagination", () => ({
  __esModule: true,
  default: ({
    currentPage,
    totalPages,
    basePath,
    searchParams,
  }: {
    currentPage: number;
    totalPages: number;
    basePath: string;
    searchParams?: Record<string, string>;
  }) => (
    <div
      data-testid="pagination"
      data-current-page={currentPage}
      data-total-pages={totalPages}
      data-base-path={basePath}
      data-search-params={JSON.stringify(searchParams || {})}
    >
      Pagination
    </div>
  ),
}));

import DashboardPage from "./page";

// ---- helpers ----

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

const pmSession = {
  user: { email: "pm@avantifellows.org" },
};

const teacherSession = {
  user: { email: "teacher@avantifellows.org" },
};

const passcodeSession = {
  user: { email: "passcode@school.org" },
  isPasscodeUser: true,
  schoolCode: "70705",
};

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 4,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2, 64],
};

const pmPermission = {
  email: "pm@avantifellows.org",
  level: 3,
  role: "program_manager",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
};

const teacherPermission = {
  email: "teacher@avantifellows.org",
  level: 1,
  role: "teacher",
  school_codes: ["SC001", "SC002"],
  regions: null,
  program_ids: [64],
};

const singleSchoolPermission = {
  email: "teacher@avantifellows.org",
  level: 1,
  role: "teacher",
  school_codes: ["SC001"],
  regions: null,
  program_ids: [64],
};

const regionPermission = {
  email: "pm@avantifellows.org",
  level: 2,
  role: "program_manager",
  school_codes: null,
  regions: ["North", "South"],
  program_ids: [1, 2],
};

const makeSchool = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  code: "SC001",
  name: "JNV Bhavnagar",
  district: "Bhavnagar",
  state: "Gujarat",
  region: "West",
  ...overrides,
});

const defaultProgramContext = {
  hasAccess: true,
  programIds: [1, 2],
  isNVSOnly: false,
  hasCoEOrNodal: true,
};

const noProgramContext = {
  hasAccess: false,
  programIds: [],
  isNVSOnly: false,
  hasCoEOrNodal: false,
};

// setupAdmin: admin (level 4) has hasPMAccess=true via getFeatureAccess
// Query order when schools present: schools, count, gradeCounts, visits, openIssues
// Query order when no schools (empty IDs → getSchoolGradeCounts returns early): schools, count, visits, openIssues
function setupAdmin(schools: unknown[] = [], totalCount = 0) {
  mockGetServerSession.mockResolvedValue(adminSession);
  mockGetUserPermission.mockResolvedValue(adminPermission);
  mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
  mockGetAccessibleSchoolCodes.mockResolvedValue("all");

  const hasSchools = schools.length > 0;
  mockQuery.mockResolvedValueOnce(schools); // schools query
  mockQuery.mockResolvedValueOnce([{ total: String(totalCount) }]); // count query
  if (hasSchools) {
    mockQuery.mockResolvedValueOnce([]); // getSchoolGradeCounts
  }
  // Promise.all: [gradeCounts(returns early if empty), getRecentVisits, getOpenIssuesCount]
  mockQuery.mockResolvedValueOnce([]); // getRecentVisits
  mockQuery.mockResolvedValueOnce([{ count: "0" }]); // getOpenIssuesCount
}

function setupPM(
  schools: unknown[] = [],
  totalCount = 0,
  visits: unknown[] = [],
  openIssues = 0,
) {
  mockGetServerSession.mockResolvedValue(pmSession);
  mockGetUserPermission.mockResolvedValue(pmPermission);
  mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
  mockGetAccessibleSchoolCodes.mockResolvedValue("all");

  const hasSchools = schools.length > 0;
  mockQuery.mockResolvedValueOnce(schools); // schools query
  mockQuery.mockResolvedValueOnce([{ total: String(totalCount) }]); // count query
  if (hasSchools) {
    mockQuery.mockResolvedValueOnce([]); // getSchoolGradeCounts
  }
  mockQuery.mockResolvedValueOnce(visits); // getRecentVisits
  mockQuery.mockResolvedValueOnce([{ count: String(openIssues) }]); // getOpenIssuesCount
}

function setupTeacher(
  schools: unknown[] = [],
  totalCount = 0,
  codes: string[] | "all" = ["SC001", "SC002"],
) {
  mockGetServerSession.mockResolvedValue(teacherSession);
  mockGetUserPermission.mockResolvedValue(teacherPermission);
  mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
  mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
  mockGetAccessibleSchoolCodes.mockResolvedValue(codes);

  const hasSchools = schools.length > 0;
  mockQuery.mockResolvedValueOnce(schools); // schools query
  mockQuery.mockResolvedValueOnce([{ total: String(totalCount) }]); // count query
  if (hasSchools) {
    mockQuery.mockResolvedValueOnce([]); // getSchoolGradeCounts
  }
  // No PM queries since hasPMAccess=false
}

const defaultSearchParams = Promise.resolve({});

// ---- tests ----

describe("DashboardPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Auth redirects ---

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(
      DashboardPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(
      DashboardPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects passcode user to their school page", async () => {
    mockGetServerSession.mockResolvedValue(passcodeSession);

    await expect(
      DashboardPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/school/70705");
    expect(mockRedirect).toHaveBeenCalledWith("/school/70705");
  });

  // --- No permission ---

  it("renders 'no access' message when user has no permission", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(null);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText(/does not have access/)).toBeInTheDocument();
    expect(
      screen.getByText(/contact an administrator/)
    ).toBeInTheDocument();
  });

  // --- No program access ---

  it("renders 'no program' message when user has no program_ids", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue({
      ...pmPermission,
      program_ids: [],
    });
    mockGetProgramContextSync.mockReturnValue(noProgramContext);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(
      screen.getByText(/not assigned to any programs/)
    ).toBeInTheDocument();
  });

  // --- Single school redirect ---

  it("redirects single-school user to their school page (no search)", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(singleSchoolPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001"]);

    await expect(
      DashboardPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/school/SC001");
    expect(mockRedirect).toHaveBeenCalledWith("/school/SC001");
  });

  it("does NOT redirect single-school user when search is active", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(singleSchoolPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001"]);
    mockQuery
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "0" }]); // count

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ q: "test" }),
    });
    render(jsx);

    expect(mockRedirect).not.toHaveBeenCalledWith("/school/SC001");
  });

  // --- Permission level subtitle ---

  it("shows 'Admin access' for level 4", async () => {
    setupAdmin([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("Admin access")).toBeInTheDocument();
  });

  it("shows 'All schools access' for level 3", async () => {
    setupPM([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("All schools access")).toBeInTheDocument();
  });

  it("shows region access text for level 2", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(regionPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "0" }]) // count
      .mockResolvedValueOnce([]) // visits
      .mockResolvedValueOnce([{ count: "0" }]); // open issues

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(
      screen.getByText("Region access: North, South")
    ).toBeInTheDocument();
  });

  it("shows school count text for level 1", async () => {
    setupTeacher([], 3);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("3 school(s)")).toBeInTheDocument();
  });

  // --- Admin link ---

  it("shows Admin link for level 4 only", async () => {
    setupAdmin([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const adminLink = screen.getByText("Admin");
    expect(adminLink.closest("a")).toHaveAttribute("href", "/admin");
  });

  it("does not show Admin link for non-admin users", async () => {
    setupPM([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  // --- PM nav links ---

  it("shows Visits nav for PM users", async () => {
    setupPM([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const visitsLink = screen.getByText("Visits");
    expect(visitsLink.closest("a")).toHaveAttribute("href", "/visits");
  });

  it("does not show Visits nav for non-PM users", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Visits")).not.toBeInTheDocument();
  });

  // --- PM stats cards ---

  it("renders PM stats cards (Total Visits, Open Issues)", async () => {
    const visits = [
      { id: 1, school_code: "SC001", visit_date: "2026-02-10", status: "completed", inserted_at: "2026-02-10T10:00:00Z" },
      { id: 2, school_code: "SC002", visit_date: "2026-02-08", status: "in_progress", inserted_at: "2026-02-08T09:00:00Z" },
      { id: 3, school_code: "SC003", visit_date: "2026-02-06", status: "completed", inserted_at: "2026-02-06T08:00:00Z" },
    ];
    setupPM([], 5, visits, 7);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("Total Visits")).toBeInTheDocument();
    expect(screen.getByText("Open Issues")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument(); // openIssues
  });

  it("does not render PM stats for non-PM users", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Total Visits")).not.toBeInTheDocument();
    expect(screen.queryByText("Open Issues")).not.toBeInTheDocument();
  });

  // --- Search components ---

  it("renders StudentSearch and SchoolSearch components", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByTestId("student-search")).toBeInTheDocument();
    expect(screen.getByTestId("school-search")).toBeInTheDocument();
    expect(screen.getByText("Search Students")).toBeInTheDocument();
    expect(screen.getByText("Search Schools")).toBeInTheDocument();
  });

  it("passes searchQuery as defaultValue to SchoolSearch", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ q: "bhavnagar" }),
    });
    render(jsx);

    const searchComponent = screen.getByTestId("school-search");
    expect(searchComponent).toHaveAttribute(
      "data-default-value",
      "bhavnagar"
    );
  });

  // --- School cards ---

  it("renders school cards with correct props", async () => {
    const school = makeSchool();
    setupAdmin([school], 1);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const card = screen.getByTestId("school-card-SC001");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("data-href", "/school/SC001");
    expect(card).toHaveAttribute("data-show-student-count", "true");
    expect(card).toHaveAttribute("data-show-grade-breakdown", "true");
  });

  it("shows Start Visit action for PM users", async () => {
    const school = makeSchool();
    setupPM([school], 1);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const startVisitLink = screen.getByText("Start Visit");
    expect(startVisitLink.closest("a")).toHaveAttribute(
      "href",
      "/school/SC001/visit/new"
    );
  });

  it("does not show Start Visit for non-PM users", async () => {
    const school = makeSchool();
    setupTeacher([school], 1);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Start Visit")).not.toBeInTheDocument();
  });

  it("shows showRegion=true for PM users", async () => {
    const school = makeSchool();
    setupPM([school], 1);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const card = screen.getByTestId("school-card-SC001");
    expect(card).toHaveAttribute("data-show-region", "true");
  });

  it("shows showRegion=false for non-PM users", async () => {
    const school = makeSchool();
    setupTeacher([school], 1);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const card = screen.getByTestId("school-card-SC001");
    expect(card).toHaveAttribute("data-show-region", "false");
  });

  // --- Grade counts integration ---

  it("merges grade counts into school data", async () => {
    const school = makeSchool({ id: "s1", code: "SC001" });
    mockGetServerSession.mockResolvedValue(adminSession);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
    mockGetAccessibleSchoolCodes.mockResolvedValue("all");
    mockQuery
      .mockResolvedValueOnce([school]) // schools
      .mockResolvedValueOnce([{ total: "1" }]) // count
      .mockResolvedValueOnce([
        { school_id: "s1", grade: 9, count: "10" },
        { school_id: "s1", grade: 10, count: "15" },
      ]) // grade counts
      .mockResolvedValueOnce([]) // visits
      .mockResolvedValueOnce([{ count: "0" }]); // open issues

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByTestId("school-card-SC001")).toBeInTheDocument();
  });

  // --- Recent visits table ---

  it("renders recent visits table for PM users with visits", async () => {
    const visits = [
      {
        id: 10,
        school_code: "SC001",
        school_name: "JNV Bhavnagar",
        visit_date: "2026-02-10",
        status: "completed",
        inserted_at: "2026-02-10T10:00:00Z",
      },
      {
        id: 11,
        school_code: "SC002",
        school_name: null,
        visit_date: "2026-02-08",
        status: "in_progress",
        inserted_at: "2026-02-08T09:00:00Z",
      },
    ];
    setupPM([], 0, visits);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("Recent Visits")).toBeInTheDocument();
    const viewAllLink = screen.getByText("View all");
    expect(viewAllLink.closest("a")).toHaveAttribute("href", "/visits");

    // Completed visit
    expect(screen.getByText("JNV Bhavnagar")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();

    // In-progress visit with school_name fallback to school_code
    expect(screen.getByText("SC002")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Continue")).toBeInTheDocument();

    // Visit links
    const viewLink = screen.getByText("View");
    expect(viewLink.closest("a")).toHaveAttribute("href", "/visits/10");
    const continueLink = screen.getByText("Continue");
    expect(continueLink.closest("a")).toHaveAttribute("href", "/visits/11");
  });

  it("does not render recent visits when PM has no visits", async () => {
    setupPM([], 0, []);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Recent Visits")).not.toBeInTheDocument();
  });

  it("does not render recent visits for non-PM users", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Recent Visits")).not.toBeInTheDocument();
  });

  // --- Empty state ---

  it("renders empty state when no schools found (no search)", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByText("No schools found")).toBeInTheDocument();
  });

  it("renders search-specific empty state", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ q: "xyz" }),
    });
    render(jsx);

    expect(
      screen.getByText('No schools found matching "xyz"')
    ).toBeInTheDocument();
  });

  // --- Pagination ---

  it("renders Pagination with correct props", async () => {
    const schools = [makeSchool()];
    setupAdmin(schools, 45);

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ page: "2", q: "test" }),
    });
    render(jsx);

    const pagination = screen.getByTestId("pagination");
    expect(pagination).toHaveAttribute("data-current-page", "2");
    expect(pagination).toHaveAttribute("data-total-pages", "3"); // ceil(45/20) = 3
    expect(pagination).toHaveAttribute("data-base-path", "/dashboard");
    expect(pagination).toHaveAttribute(
      "data-search-params",
      JSON.stringify({ q: "test" })
    );
  });

  it("passes empty searchParams to Pagination when no search", async () => {
    setupAdmin([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const pagination = screen.getByTestId("pagination");
    expect(pagination).toHaveAttribute(
      "data-search-params",
      JSON.stringify({})
    );
  });

  it("clamps page to minimum of 1", async () => {
    setupAdmin([], 0);

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ page: "-5" }),
    });
    render(jsx);

    const pagination = screen.getByTestId("pagination");
    expect(pagination).toHaveAttribute("data-current-page", "1");
  });

  // --- My Schools heading for PM ---

  it("renders 'My Schools' section heading for PM users", async () => {
    setupPM([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    // "My Schools" appears as both stats card label and section heading
    const mySchoolsTexts = screen.getAllByText("My Schools");
    expect(mySchoolsTexts.length).toBeGreaterThanOrEqual(1);
  });

  // --- Multiple schools ---

  it("renders multiple school cards", async () => {
    const school1 = makeSchool({ id: "s1", code: "SC001", name: "School A" });
    const school2 = makeSchool({ id: "s2", code: "SC002", name: "School B" });
    setupAdmin([school1, school2], 2);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByTestId("school-card-SC001")).toBeInTheDocument();
    expect(screen.getByTestId("school-card-SC002")).toBeInTheDocument();
    expect(screen.getByText("School A")).toBeInTheDocument();
    expect(screen.getByText("School B")).toBeInTheDocument();
  });

  // --- Header elements ---

  it("renders header with user email and sign out link", async () => {
    setupAdmin([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(
      screen.getByRole("heading", { level: 1, name: "Schools" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("admin@avantifellows.org")
    ).toBeInTheDocument();
    const signOutLink = screen.getByText("Sign out");
    expect(signOutLink.closest("a")).toHaveAttribute(
      "href",
      "/api/auth/signout"
    );
  });

  // --- Query verification ---

  it("uses search pattern for school queries when searchQuery provided", async () => {
    setupAdmin([], 0);

    await DashboardPage({
      searchParams: Promise.resolve({ q: "bhav" }),
    });

    // First query should include ILIKE and search pattern
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ILIKE");
    expect(params[0]).toBe("%bhav%");
  });

  it("uses code filter for limited-code users", async () => {
    setupTeacher([], 0);

    await DashboardPage({ searchParams: defaultSearchParams });

    // First query should include ANY($1) for school codes
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ANY($1)");
    expect(params[0]).toEqual(["SC001", "SC002"]);
  });

  it("passes school IDs to getSchoolGradeCounts", async () => {
    const school = makeSchool({ id: "s99" });
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(teacherPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery
      .mockResolvedValueOnce([school]) // schools query
      .mockResolvedValueOnce([{ total: "1" }]) // count query
      .mockResolvedValueOnce([]); // getSchoolGradeCounts

    await DashboardPage({ searchParams: defaultSearchParams });

    // Third query call is getSchoolGradeCounts (no PM queries for teacher)
    const gradeCountsCall = mockQuery.mock.calls[2];
    const [sql, params] = gradeCountsCall;
    expect(sql).toContain("grade");
    expect(params[0]).toEqual(["s99"]);
  });

  it("skips grade count query when no schools found", async () => {
    setupTeacher([], 0);

    await DashboardPage({ searchParams: defaultSearchParams });

    // getSchoolGradeCounts returns early when schoolIds is empty — no query
    // Only 2 queries: schools + count
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  // --- Code filter with search ---

  it("uses both code filter and search for limited-code users with search", async () => {
    setupTeacher([], 0);

    await DashboardPage({
      searchParams: Promise.resolve({ q: "bhav" }),
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ANY($1)");
    expect(sql).toContain("ILIKE");
    expect(params[0]).toEqual(["SC001", "SC002"]);
    expect(params[1]).toBe("%bhav%");
  });

  // --- Empty school codes ---

  it("returns empty schools when user has no accessible codes", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue({
      ...teacherPermission,
      school_codes: [],
    });
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue([]);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    // Empty codes => getSchools returns { schools: [], totalCount: 0 } immediately
    expect(screen.getByText("No schools found")).toBeInTheDocument();
    // No DB query should be made for schools (codes.length === 0 returns early)
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
