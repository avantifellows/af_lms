import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PROGRAM_IDS } from "@/lib/constants";

// ---- mocks (hoisted) ----

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetProgramContextSync,
  mockGetFeatureAccess,
  mockGetAccessibleSchoolCodes,
  mockQuery,
  mockRedirect,
  mockRequireHolisticAccess,
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
  mockRequireHolisticAccess: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
  getResolvedPermission: mockGetUserPermission,
  getProgramContextSync: mockGetProgramContextSync,
  getFeatureAccess: mockGetFeatureAccess,
  getAccessibleSchoolCodes: mockGetAccessibleSchoolCodes,
  // Real logic (cheap, pure): seated ⇔ a non-empty centre-seat Set on the scope.
  isCentreSeated: (p: { scope?: { centres?: unknown } } | null) =>
    p?.scope?.centres instanceof Set && p.scope.centres.size > 0,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/holistic-mentorship", () => ({
  requireHolisticMentorshipAccess: mockRequireHolisticAccess,
}));
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
  default: ({ defaultValue, placeholder }: { defaultValue?: string; placeholder?: string }) => (
    <div
      data-testid="school-search"
      data-default-value={defaultValue || ""}
      data-placeholder={placeholder || ""}
    >
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

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 4,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2, 64],
};

const programAdminSession = {
  user: { email: "program-admin@avantifellows.org" },
};

const programAdminPermission = {
  email: "program-admin@avantifellows.org",
  level: 2,
  role: "program_admin",
  school_codes: null,
  regions: ["West"],
  program_ids: [1, 2],
};

const nvsOnlyProgramAdminPermission = {
  ...programAdminPermission,
  email: "nvs-only@avantifellows.org",
  program_ids: [64],
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

// Teacher fixtures hold only JNV NVS (64), so their context has no physical
// Program and their plain landing is JNV NVS Schools.
const nvsOnlyProgramContext = {
  hasAccess: true,
  programIds: [64],
  isNVSOnly: true,
  hasCoEOrNodal: false,
};

const noProgramContext = {
  hasAccess: false,
  programIds: [],
  isNVSOnly: false,
  hasCoEOrNodal: false,
};

// setupAdmin: admin (level 4) has hasPMAccess=true via getFeatureAccess
// Query order: schools, count, recent visits, visit total, then gradeCounts
// (skipped when there are no schools — getNvsGradeCounts returns early)
function setupAdmin(schools: unknown[] = [], totalCount = 0) {
  mockGetServerSession.mockResolvedValue(adminSession);
  mockGetUserPermission.mockResolvedValue(adminPermission);
  mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
  mockGetAccessibleSchoolCodes.mockResolvedValue("all");

  const hasSchools = schools.length > 0;
  mockQuery.mockResolvedValueOnce(schools); // schools query
  mockQuery.mockResolvedValueOnce([{ total: String(totalCount) }]); // count query
  mockQuery.mockResolvedValueOnce([]); // getRecentVisits
  mockQuery.mockResolvedValueOnce([{ total: "0" }]); // getOwnedVisitTotal
  if (hasSchools) {
    mockQuery.mockResolvedValueOnce([]); // getNvsGradeCounts
  }
}

function setupPM(
  schools: unknown[] = [],
  totalCount = 0,
  visits: unknown[] = [],
  visitTotal = visits.length,
) {
  mockGetServerSession.mockResolvedValue(pmSession);
  mockGetUserPermission.mockResolvedValue(pmPermission);
  mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
  mockGetAccessibleSchoolCodes.mockResolvedValue("all");

  const hasSchools = schools.length > 0;
  mockQuery.mockResolvedValueOnce(schools); // schools query
  mockQuery.mockResolvedValueOnce([{ total: String(totalCount) }]); // count query
  mockQuery.mockResolvedValueOnce(visits); // getRecentVisits
  mockQuery.mockResolvedValueOnce([{ total: String(visitTotal) }]); // getOwnedVisitTotal
  if (hasSchools) {
    mockQuery.mockResolvedValueOnce([]); // getNvsGradeCounts
  }
}

function setupTeacher(
  schools: unknown[] = [],
  totalCount = 0,
  codes: string[] | "all" = ["SC001", "SC002"],
) {
  mockGetServerSession.mockResolvedValue(teacherSession);
  mockGetUserPermission.mockResolvedValue(teacherPermission);
  mockGetProgramContextSync.mockReturnValue(nvsOnlyProgramContext);
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
// Admin/PM fixtures hold physical Programs and land on Centres, so their JNV
// NVS Schools tests choose the view explicitly.
const jnvSearchParams = Promise.resolve({ view: "jnv-nvs" });

// ---- tests ----

describe("DashboardPage (server component)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireHolisticAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });
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
    mockGetProgramContextSync.mockReturnValue(nvsOnlyProgramContext);
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
    mockGetProgramContextSync.mockReturnValue(nvsOnlyProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "0" }]); // count

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ q: "test" }),
    });
    render(jsx);

    expect(mockRedirect).not.toHaveBeenCalledWith("/school/SC001");
  });

  // --- Centre-seated redirect ---

  const seatedPermission = {
    email: "teacher@avantifellows.org",
    level: 1,
    role: "teacher",
    school_codes: ["SC001"],
    regions: null,
    program_ids: [1],
    scope: { schools: new Set(["SC001"]), centres: new Set([8]), programs: new Set([1]) },
  };

  it("redirects a single-seat centre-seated user straight to their centre page", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(seatedPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001"]);
    mockQuery.mockResolvedValueOnce([{ id: "8" }]); // getBrowsableCentreIds

    await expect(
      DashboardPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/centre/8");
    expect(mockRedirect).toHaveBeenCalledWith("/centre/8");
    // A seated user is never bounced to the whole-school roster page.
    expect(mockRedirect).not.toHaveBeenCalledWith("/school/SC001");
  });

  // Six teachers hold their only seat at a school-less centre (17, 29, 48).
  // /centre/[id] notFound()s for those, so shortcutting there made /dashboard
  // itself a 404 — they must land on the Centres tab instead.
  it("does NOT shortcut a single-seat user whose centre has no page", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(seatedPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001"]);
    mockQuery
      .mockResolvedValueOnce([]) // getBrowsableCentreIds: seat centre is school-less
      .mockResolvedValueOnce([]) // centre counts
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "0" }]); // count

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(mockRedirect).not.toHaveBeenCalledWith("/centre/8");
    expect(mockRedirect).not.toHaveBeenCalledWith("/school/SC001");
  });

  it("does NOT redirect a single-seat user to their centre when a tab is chosen", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(seatedPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001"]);
    // centres branch: getAccessibleCentresWithCounts (1) + getSchools (2)
    mockQuery
      .mockResolvedValueOnce([]) // centre counts
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "0" }]); // count

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ view: "centres" }),
    });
    render(jsx);

    expect(mockRedirect).not.toHaveBeenCalledWith("/centre/8");
  });

  // The JNV NVS tab is the whole-school scope and carries the school-wide student
  // search. A confined user has no NVS scope, so ?view=jnv-nvs must not be a way
  // in — the search API refuses them too, but the URL shouldn't look like an
  // option in the first place.
  it("pins a centre-seated user to Centres even when the URL asks for JNV NVS", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(seatedPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery.mockResolvedValue([]);

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ view: "jnv-nvs" }),
    });
    render(jsx);

    // Centres content, not the schools tab: the whole-school student search is
    // the leak, and it is absent. The search box present here is the centre one.
    expect(screen.queryByTestId("student-search")).not.toBeInTheDocument();
    expect(screen.getByTestId("school-search")).toHaveAttribute(
      "data-placeholder",
      "Search centres by name, school, or code..."
    );
    // And no tab strip offering a scope they cannot open.
    expect(screen.queryByText("JNV NVS Schools")).not.toBeInTheDocument();
  });

  it("filters the centres tab by the search term", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(seatedPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery
      .mockResolvedValueOnce([]) // centre counts
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "0" }]); // count

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ view: "centres", q: "shimoga" }),
    });
    render(jsx);

    const [centresSql, centresParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(centresSql).toContain("c.name ILIKE");
    expect(centresSql).toContain("sch.name ILIKE");
    expect(centresParams).toContain("%shimoga%");
    expect(screen.getByTestId("school-search")).toBeInTheDocument();
    expect(
      screen.getByText('No physical centres match "shimoga"')
    ).toBeInTheDocument();
  });

  // The header count is the user's scope, not a search result, and drives no
  // pagination on this tab — so the centre term must not narrow it.
  it("does not apply the centres search term to the header school count", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(seatedPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery
      .mockResolvedValueOnce([]) // centre counts
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "7" }]); // count

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ view: "centres", q: "shimoga" }),
    });
    render(jsx);

    const schoolCalls = mockQuery.mock.calls.slice(1);
    for (const [, params] of schoolCalls as [string, unknown[]][]) {
      expect(params).not.toContain("%shimoga%");
    }
  });

  // --- School visibility scope per tab ---

  // Only JNV schools have NVS-attributed students. Centre-linked non-JNV schools
  // (EMRS, RSMS, the Maharashtra coaching centres…) showed on this tab as
  // permanent 0-student cards; their home is the Centres tab.
  it("lists only JNV schools on the JNV NVS tab", async () => {
    setupPM();

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ view: "jnv-nvs" }),
    });
    render(jsx);

    const [listSql] = mockQuery.mock.calls[0] as [string];
    const [countSql] = mockQuery.mock.calls[1] as [string];
    for (const sql of [listSql, countSql]) {
      expect(sql).toContain("s.af_school_category = 'JNV'");
      expect(sql).not.toContain("FROM centres c WHERE c.school_id = s.id");
    }
  });

  // The header's scope count on the Centres tab still counts centre-linked
  // schools, so a Punjab CoE PM with no JNV school does not read "0 school(s)".
  it("keeps centre-linked schools in the header count on the Centres tab", async () => {
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(teacherPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery
      .mockResolvedValueOnce([]) // centre counts
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "2" }]); // count

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ view: "centres" }),
    });
    render(jsx);

    const schoolCalls = mockQuery.mock.calls.slice(1) as [string][];
    expect(schoolCalls).toHaveLength(2);
    for (const [sql] of schoolCalls) {
      expect(sql).toContain("FROM centres c WHERE c.school_id = s.id AND c.is_active");
    }
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

    expect(screen.getByText("All schools")).toBeInTheDocument();
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
      .mockResolvedValueOnce([{ total: "0" }]); // visit total

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(
      screen.getByText("Region: North, South")
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

  it("sends a Holistic Mentorship Admin directly to their only workspace", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "holistic@example.com" },
    });
    mockGetUserPermission.mockResolvedValue({
      email: "holistic@example.com",
      level: 3,
      role: "holistic_mentorship_admin",
      school_codes: null,
      regions: null,
      program_ids: [1],
    });
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockImplementation((_permission, feature) => ({
      canView: feature === "holistic_mentorship",
      canEdit: feature === "holistic_mentorship",
    }));
    await expect(
      DashboardPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/admin/holistic-mentorship");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // --- PM nav links ---

  it("shows Visit Summary nav for admin users with visit access", async () => {
    setupAdmin([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const summaryLink = screen.getByRole("link", { name: "Visit Summary" });
    expect(summaryLink).toHaveAttribute("href", "/school-visit-summary");
    expect(screen.queryByRole("link", { name: "Visits" })).not.toBeInTheDocument();
  });

  it("shows Visit Summary nav for program_admin users with visit access", async () => {
    mockGetServerSession.mockResolvedValue(programAdminSession);
    mockGetUserPermission.mockResolvedValue(programAdminPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery
      .mockResolvedValueOnce([]) // schools
      .mockResolvedValueOnce([{ total: "0" }]) // count
      .mockResolvedValueOnce([]) // visits
      .mockResolvedValueOnce([{ total: "0" }]); // visit total

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const summaryLink = screen.getByRole("link", { name: "Visit Summary" });
    expect(summaryLink).toHaveAttribute("href", "/school-visit-summary");
    expect(screen.queryByRole("link", { name: "Visits" })).not.toBeInTheDocument();
  });

  it("shows Holistic Mentorship navigation when the shared helper resolves non-empty PM scope", async () => {
    setupPM([], 0);
    mockRequireHolisticAccess.mockResolvedValue({
      ok: true,
      canEdit: false,
      programId: 1,
      programIds: [1],
      permission: pmPermission,
    });

    render(await DashboardPage({ searchParams: defaultSearchParams }));

    expect(screen.getByRole("link", { name: "Holistic Mentorship" })).toHaveAttribute(
      "href",
      "/admin/holistic-mentorship",
    );
    expect(mockRequireHolisticAccess).toHaveBeenCalledWith(
      pmSession,
      "program_read",
    );
  });

  it("does not show Visit Summary nav for NVS-only program_admin users", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "nvs-only@avantifellows.org" },
    });
    mockGetUserPermission.mockResolvedValue(nvsOnlyProgramAdminPermission);
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [64],
      isNVSOnly: true,
      hasCoEOrNodal: false,
    });
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: "0" }]);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByRole("link", { name: "Visit Summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Curriculum Summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Visits" })).not.toBeInTheDocument();
  });

  it("keeps Home in the PM nav and removes the Visits link", async () => {
    setupPM([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Visits" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Visit Summary" })).not.toBeInTheDocument();
  });

  it("shows Curriculum Summary nav for eligible PM users", async () => {
    setupPM([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    const curriculumSummaryLink = screen.getByRole("link", {
      name: "Curriculum Summary",
    });
    expect(curriculumSummaryLink).toHaveAttribute(
      "href",
      "/curriculum-summary"
    );
  });

  it("does not show Visits nav for non-PM users", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Visits")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Curriculum Summary" })).not.toBeInTheDocument();
  });

  // --- PM stats cards ---

  it("renders PM stats cards", async () => {
    const visits = [
      { id: 1, school_code: "SC001", visit_date: "2026-02-10", status: "completed", inserted_at: "2026-02-10T10:00:00Z" },
      { id: 2, school_code: "SC002", visit_date: "2026-02-08", status: "in_progress", inserted_at: "2026-02-08T09:00:00Z" },
      { id: 3, school_code: "SC003", visit_date: "2026-02-06", status: "completed", inserted_at: "2026-02-06T08:00:00Z" },
    ];
    setupPM([], 5, visits);

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
    render(jsx);

    expect(screen.getByText("Total Visits")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not render PM stats for non-PM users", async () => {
    setupTeacher([], 0);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Total Visits")).not.toBeInTheDocument();
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

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
    render(jsx);

    const card = screen.getByTestId("school-card-SC001");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("data-href", "/school/SC001");
    expect(card).toHaveAttribute("data-show-student-count", "true");
    expect(card).toHaveAttribute("data-show-grade-breakdown", "true");
  });

  it("keeps School card links clean for users with a single Holistic Program", async () => {
    const school = makeSchool();
    setupPM([school], 1);
    mockGetProgramContextSync.mockReturnValue({
      ...defaultProgramContext,
      programIds: [78],
    });
    mockGetUserPermission.mockResolvedValue({
      ...pmPermission,
      program_ids: [78],
    });

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
    render(jsx);

    expect(screen.getByTestId("school-card-SC001")).toHaveAttribute(
      "data-href",
      "/school/SC001",
    );
  });

  it("does not show Start Visit for non-PM users", async () => {
    const school = makeSchool();
    setupTeacher([school], 1);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByText("Start Visit")).not.toBeInTheDocument();
  });

  it("keeps the JNV NVS Schools heading hidden from non-PM users", async () => {
    setupTeacher([makeSchool()], 1);

    const jsx = await DashboardPage({ searchParams: defaultSearchParams });
    render(jsx);

    expect(screen.queryByRole("heading", { name: "JNV NVS Schools" })).not.toBeInTheDocument();
  });

  it("shows showRegion=true for PM users", async () => {
    const school = makeSchool();
    setupPM([school], 1);

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
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
      .mockResolvedValueOnce([]) // visits
      .mockResolvedValueOnce([{ total: "0" }]) // visit total
      .mockResolvedValueOnce([
        { school_id: "s1", grade: 9, count: "10" },
        { school_id: "s1", grade: 10, count: "15" },
      ]); // grade counts

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
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

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
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

  it("filters deleted visits from recent visits query", async () => {
    setupPM([], 0, []);

    await DashboardPage({ searchParams: jnvSearchParams });

    const [recentVisitsSql, recentVisitsParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(recentVisitsSql).toContain("FROM lms_pm_school_visits v");
    expect(recentVisitsSql).toContain("v.deleted_at IS NULL");
    expect(recentVisitsParams).toEqual(["pm@avantifellows.org", 5]);
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

  // --- Total Visits ---

  describe("Total Visits", () => {
    const isVisitTotalSql = (sql: string) =>
      sql.includes("lms_pm_school_visits") && /COUNT\(/i.test(sql);
    const isRecentVisitsSql = (sql: string) =>
      sql.includes("lms_pm_school_visits") && !/COUNT\(/i.test(sql);

    const fiveRecentVisits = [10, 11, 12, 13, 14].map((id, index) => ({
      id,
      school_code: `SC00${index}`,
      school_name: `School ${id}`,
      visit_date: `2026-02-1${index}`,
      status: index % 2 === 0 ? "completed" : "in_progress",
      inserted_at: `2026-02-1${index}T10:00:00Z`,
    }));

    // Routes db reads by SQL so the visit total can't be confused with the
    // school count or the Recent Visits rows.
    function routeQueries({ visitTotal, recentVisits = [] }: {
      visitTotal: string | Error;
      recentVisits?: unknown[];
    }) {
      mockQuery.mockImplementation(async (sql: string) => {
        if (isVisitTotalSql(sql)) {
          if (visitTotal instanceof Error) throw visitTotal;
          return [{ total: visitTotal }];
        }
        if (isRecentVisitsSql(sql)) return recentVisits;
        if (sql.includes("COUNT(DISTINCT s.id)")) return [{ total: "12" }];
        return [];
      });
    }

    function setupPMSession(email = "pm@avantifellows.org") {
      mockGetServerSession.mockResolvedValue({ user: { email } });
      mockGetUserPermission.mockResolvedValue({ ...pmPermission, email });
      mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
      mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
      mockGetAccessibleSchoolCodes.mockResolvedValue("all");
    }

    function totalVisitsValue() {
      return screen.getByText("Total Visits").nextElementSibling?.textContent;
    }

    function recentVisitRows() {
      const heading = screen.queryByText("Recent Visits");
      if (!heading) return [];
      return Array.from(
        heading.closest("div.mb-8")?.querySelectorAll("tbody tr") ?? []
      );
    }

    it("shows the exact owned total on JNV NVS Schools, separately from the five Recent Visits", async () => {
      setupPMSession();
      routeQueries({ visitTotal: "7", recentVisits: fiveRecentVisits });

      render(await DashboardPage({ searchParams: Promise.resolve({ view: "jnv-nvs" }) }));

      expect(totalVisitsValue()).toBe("7");
      expect(recentVisitRows()).toHaveLength(5);
    });

    it("shows the same exact total on Physical Centres without Recent Visits", async () => {
      setupPMSession();
      routeQueries({ visitTotal: "7", recentVisits: fiveRecentVisits });

      render(await DashboardPage({ searchParams: Promise.resolve({ view: "centres" }) }));

      expect(totalVisitsValue()).toBe("7");
      expect(screen.queryByText("Recent Visits")).not.toBeInTheDocument();
      expect(
        mockQuery.mock.calls.some(([sql]) => isRecentVisitsSql(String(sql)))
      ).toBe(false);
    });

    it.each([
      ["jnv-nvs", { view: "jnv-nvs", q: "bhav", page: "2" }],
      ["centres", { view: "centres", q: "shimoga" }],
    ])("keeps the total unchanged by search and pagination on %s", async (_view, params) => {
      setupPMSession();
      routeQueries({ visitTotal: "7", recentVisits: fiveRecentVisits });

      render(await DashboardPage({ searchParams: Promise.resolve(params) }));

      expect(totalVisitsValue()).toBe("7");
      const totalCalls = mockQuery.mock.calls.filter(([sql]) => isVisitTotalSql(String(sql)));
      expect(totalCalls).toHaveLength(1);
      expect(totalCalls[0][1]).toEqual(["pm@avantifellows.org"]);
    });

    it("matches owned Visits by the trimmed, case-folded authenticated email", async () => {
      setupPMSession(" PM@AvantiFellows.org ");
      routeQueries({ visitTotal: "7", recentVisits: fiveRecentVisits });

      render(await DashboardPage({ searchParams: Promise.resolve({ view: "jnv-nvs" }) }));

      const visitCalls = mockQuery.mock.calls.filter(([sql]) =>
        String(sql).includes("lms_pm_school_visits")
      ) as [string, unknown[]][];
      expect(visitCalls).toHaveLength(2);
      for (const [, params] of visitCalls) {
        expect(params[0]).toBe("pm@avantifellows.org");
      }
    });

    it.each(["jnv-nvs", "centres"])("displays a true zero on %s", async (view) => {
      setupPMSession();
      routeQueries({ visitTotal: "0" });

      render(await DashboardPage({ searchParams: Promise.resolve({ view }) }));

      expect(totalVisitsValue()).toBe("0");
    });

    it.each(["jnv-nvs", "centres"])("does not show a successful zero when the count read fails on %s", async (view) => {
      setupPMSession();
      routeQueries({ visitTotal: new Error("count failed") });

      await expect(
        DashboardPage({ searchParams: Promise.resolve({ view }) })
      ).rejects.toThrow("count failed");
    });

    it.each(["jnv-nvs", "centres"])("issues no Visit read when the PM-dashboard gate is off on %s", async (view) => {
      setupPMSession();
      mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
      routeQueries({ visitTotal: "7", recentVisits: fiveRecentVisits });

      render(await DashboardPage({ searchParams: Promise.resolve({ view }) }));

      expect(screen.queryByText("Total Visits")).not.toBeInTheDocument();
      expect(
        mockQuery.mock.calls.some(([sql]) => String(sql).includes("lms_pm_school_visits"))
      ).toBe(false);
    });
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
      searchParams: Promise.resolve({ view: "jnv-nvs", page: "2", q: "test" }),
    });
    render(jsx);

    const pagination = screen.getByTestId("pagination");
    expect(pagination).toHaveAttribute("data-current-page", "2");
    expect(pagination).toHaveAttribute("data-total-pages", "3"); // ceil(45/20) = 3
    expect(pagination).toHaveAttribute("data-base-path", "/dashboard");
    expect(pagination).toHaveAttribute(
      "data-search-params",
      JSON.stringify({ q: "test", view: "jnv-nvs" })
    );
  });

  it("passes only the JNV view to Pagination when no search", async () => {
    setupAdmin([], 0);

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
    render(jsx);

    const pagination = screen.getByTestId("pagination");
    expect(pagination).toHaveAttribute(
      "data-search-params",
      JSON.stringify({ view: "jnv-nvs" })
    );
  });

  it("clamps page to minimum of 1", async () => {
    setupAdmin([], 0);

    const jsx = await DashboardPage({
      searchParams: Promise.resolve({ view: "jnv-nvs", page: "-5" }),
    });
    render(jsx);

    const pagination = screen.getByTestId("pagination");
    expect(pagination).toHaveAttribute("data-current-page", "1");
  });

  // --- My Schools heading for PM ---

  it("renders 'My Schools' section heading for PM users", async () => {
    setupPM([], 0);

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
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

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
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

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard");
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
      searchParams: Promise.resolve({ view: "jnv-nvs", q: "bhav" }),
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

  it("excludes duplicate placeholder school rows (null udise with a udise-bearing namesake)", async () => {
    setupTeacher([], 0);

    await DashboardPage({ searchParams: defaultSearchParams });

    // Both the list query and the count query must carry the dedup guard so the
    // card list and the total stay in sync.
    const [listSql] = mockQuery.mock.calls[0];
    const [countSql] = mockQuery.mock.calls[1];
    for (const sql of [listSql, countSql]) {
      expect(sql).toContain("s.udise_code IS NULL");
      expect(sql).toContain("v2.udise_code IS NOT NULL");
      expect(sql).toContain("v2.name = s.name");
      // The namesake lookup must read the narrowed CTE, not the full school
      // table — the flat form cost ~3.5s on every dashboard load, search or not.
      expect(sql).toContain("FROM visible v2");
      expect(sql).not.toMatch(/FROM school s2/);
      // MATERIALIZED is load-bearing: without it PG inlines the CTE and the plan
      // collapses back to evaluating both predicates over all ~10.8k rows.
      expect(sql).toContain("WITH visible AS MATERIALIZED");
      expect(sql).toContain("FROM visible s");
    }
  });

  it("passes school IDs to getNvsGradeCounts", async () => {
    const school = makeSchool({ id: "s99" });
    mockGetServerSession.mockResolvedValue(teacherSession);
    mockGetUserPermission.mockResolvedValue(teacherPermission);
    mockGetProgramContextSync.mockReturnValue(defaultProgramContext);
    mockGetFeatureAccess.mockReturnValue({ canView: false, canEdit: false });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SC001", "SC002"]);
    mockQuery
      .mockResolvedValueOnce([school]) // schools query
      .mockResolvedValueOnce([{ total: "1" }]) // count query
      .mockResolvedValueOnce([]); // getNvsGradeCounts

    await DashboardPage({ searchParams: jnvSearchParams });

    // Third query call is getNvsGradeCounts (no PM queries for teacher). The
    // JNV-NVS tab counts only students whose single attributed program is NVS,
    // so the query filters on the attribution LATERAL, not the old cohort rule.
    const gradeCountsCall = mockQuery.mock.calls[2];
    const [sql, params] = gradeCountsCall;
    expect(sql).toContain("grade");
    expect(sql).toContain("er.academic_year = $2");
    expect(params[0]).toEqual(["s99"]);
    expect(params[1]).toBe("2026-2027");
    // NVS-attributed only: the LATERAL picks each student's single attributed
    // program and the WHERE keeps just the NVS ones ($3), keeping the tab
    // disjoint from the Physical Centres tab.
    expect(sql).toContain("att.program_id = $3");
    expect(sql).toContain("array_position");
    expect(params[2]).toBe(PROGRAM_IDS.NVS);
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

    const jsx = await DashboardPage({ searchParams: jnvSearchParams });
    render(jsx);

    // Empty codes => getSchools returns { schools: [], totalCount: 0 } immediately
    expect(screen.getByText("No schools found")).toBeInTheDocument();
    // No DB query should be made for schools (codes.length === 0 returns early)
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // --- PMU roles (JNV NVS only) ---

  describe("PMU roles", () => {
    const pmuManagerSession = { user: { email: "pmu-manager@avantifellows.org" } };
    const pmuGovtSession = { user: { email: "pmu-govt@avantifellows.org" } };
    const pmuManagerPermission = {
      email: "pmu-manager@avantifellows.org",
      level: 2,
      role: "pmu_manager",
      school_codes: null,
      regions: ["North"],
      program_ids: [64],
    };
    const pmuGovtPermission = {
      email: "pmu-govt@avantifellows.org",
      level: 1,
      role: "pmu_govt_school_user",
      school_codes: ["70705"],
      regions: null,
      program_ids: [64],
    };

    // PMU visibility comes from the real permission matrix, not a stub.
    async function withRealMatrix() {
      const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
      mockGetFeatureAccess.mockImplementation(actual.getFeatureAccess);
      mockGetProgramContextSync.mockImplementation(actual.getProgramContextSync);
    }

    async function setupPmuManager(codes: string[] | "all" = ["70705", "70706"]) {
      await withRealMatrix();
      mockGetServerSession.mockResolvedValue(pmuManagerSession);
      mockGetUserPermission.mockResolvedValue(pmuManagerPermission);
      mockGetAccessibleSchoolCodes.mockResolvedValue(codes);
      mockQuery
        .mockResolvedValueOnce([
          makeSchool({ id: "s1", code: "70705", name: "JNV Alpha" }),
          makeSchool({ id: "s2", code: "70706", name: "JNV Beta" }),
        ]) // schools
        .mockResolvedValueOnce([{ total: "2" }]) // count
        .mockResolvedValue([]); // NVS grade counts
    }

    it("redirects a PMU Govt School User to their School", async () => {
      await withRealMatrix();
      mockGetServerSession.mockResolvedValue(pmuGovtSession);
      mockGetUserPermission.mockResolvedValue(pmuGovtPermission);

      await expect(
        DashboardPage({ searchParams: defaultSearchParams })
      ).rejects.toThrow("REDIRECT:/school/70705");
    });

    it("redirects a PMU Govt School User to their School even with a view and a search", async () => {
      await withRealMatrix();
      mockGetServerSession.mockResolvedValue(pmuGovtSession);
      mockGetUserPermission.mockResolvedValue(pmuGovtPermission);

      await expect(
        DashboardPage({ searchParams: Promise.resolve({ view: "centres", q: "x" }) })
      ).rejects.toThrow("REDIRECT:/school/70705");
      expect(mockRedirect).toHaveBeenCalledTimes(1);
    });

    for (const [label, codes] of [
      ["no School code", []],
      ["two School codes", ["70705", "70706"]],
    ] as const) {
      it(`shows a PMU Govt School User with ${label} the no-access panel instead of redirecting`, async () => {
        await withRealMatrix();
        mockGetServerSession.mockResolvedValue(pmuGovtSession);
        mockGetUserPermission.mockResolvedValue({ ...pmuGovtPermission, school_codes: [...codes] });
        mockGetAccessibleSchoolCodes.mockResolvedValue([...codes]);
        mockQuery.mockResolvedValue([]);

        const jsx = await DashboardPage({ searchParams: defaultSearchParams });
        render(jsx);

        expect(mockRedirect).not.toHaveBeenCalled();
        expect(screen.getByText(/does not have access/)).toBeInTheDocument();
        expect(screen.queryByTestId("student-search")).not.toBeInTheDocument();
      });
    }

    it("shows a PMU Manager the JNV NVS Schools view with no Physical Centres tab", async () => {
      await setupPmuManager();

      const jsx = await DashboardPage({ searchParams: defaultSearchParams });
      render(jsx);

      expect(screen.getByTestId("school-card-70705")).toBeInTheDocument();
      expect(screen.getByTestId("student-search")).toBeInTheDocument();
      expect(screen.queryByText("Physical Centres")).not.toBeInTheDocument();
      expect(document.querySelector('a[href="/dashboard?view=centres"]')).toBeNull();
    });

    it("labels the PMU Manager's view with the JNV NVS Schools heading and no tab strip", async () => {
      await setupPmuManager();

      const jsx = await DashboardPage({ searchParams: defaultSearchParams });
      render(jsx);

      expect(screen.getByRole("heading", { name: "JNV NVS Schools" })).toBeInTheDocument();
      expect(document.querySelector('a[href="/dashboard?view=jnv-nvs"]')).toBeNull();
    });

    it("ignores ?view=centres for a PMU Manager", async () => {
      await setupPmuManager();

      const jsx = await DashboardPage({ searchParams: Promise.resolve({ view: "centres" }) });
      render(jsx);

      expect(screen.getByTestId("school-card-70706")).toBeInTheDocument();
      expect(screen.getByTestId("student-search")).toBeInTheDocument();
      expect(screen.queryByText("Physical Centres")).not.toBeInTheDocument();
      expect(screen.queryByText(/physical centres found/)).not.toBeInTheDocument();
    });

    it("redirects a PMU Manager with exactly one School to that School", async () => {
      await setupPmuManager(["70705"]);

      await expect(
        DashboardPage({ searchParams: defaultSearchParams })
      ).rejects.toThrow("REDIRECT:/school/70705");
    });

    it("hides recent visits, the PM nav, Visit Summary and Curriculum Summary from a PMU Manager", async () => {
      await setupPmuManager();

      const jsx = await DashboardPage({ searchParams: defaultSearchParams });
      render(jsx);

      expect(screen.queryByText("Recent Visits")).not.toBeInTheDocument();
      expect(screen.queryByText("Total Visits")).not.toBeInTheDocument();
      expect(screen.queryByText("Home")).not.toBeInTheDocument();
      expect(screen.queryByText("Visit Summary")).not.toBeInTheDocument();
      expect(screen.queryByText("Curriculum Summary")).not.toBeInTheDocument();
      expect(screen.queryByText("Start Visit")).not.toBeInTheDocument();
      // No recent-visits query is issued either.
      expect(
        mockQuery.mock.calls.some(([sql]) => String(sql).includes("lms_pm_school_visits"))
      ).toBe(false);
    });
  });
  // Landing view (#390): hard-pinned roles first, then an explicit valid view,
  // then the Program-context fallback — Physical Centres when the resolved
  // context has physical-centre Programs, JNV NVS Schools otherwise.
  describe("Landing view", () => {
    const physicalContext = { hasAccess: true, programIds: [1, 2], isNVSOnly: false, hasCoEOrNodal: true };
    const mixedContext = { hasAccess: true, programIds: [1, 2, 64], isNVSOnly: false, hasCoEOrNodal: true };
    const nvsOnlyContext = { hasAccess: true, programIds: [64], isNVSOnly: true, hasCoEOrNodal: false };

    // Answer by SQL shape so either view's query mix resolves.
    function routeQueries({
      schools = [] as unknown[],
      schoolTotal = "0",
      centres = [] as unknown[],
      browsableCentreIds = [] as string[],
    } = {}) {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("school_id IS NOT NULL")) return browsableCentreIds.map((id) => ({ id }));
        if (sql.includes("FROM centres c\n") || sql.includes("LEFT JOIN centre_students")) return centres;
        if (sql.includes("COUNT(DISTINCT s.id)")) return [{ total: schoolTotal }];
        if (sql.includes("COUNT(*) AS total")) return [{ total: "0" }];
        if (sql.includes("FROM visible s")) return schools;
        return [];
      });
    }

    function setupActor({
      session = pmSession,
      permission = pmPermission as Record<string, unknown>,
      context = physicalContext,
      codes = "all" as string[] | "all",
      pmAccess = true,
    } = {}) {
      mockGetServerSession.mockResolvedValue(session);
      mockGetUserPermission.mockResolvedValue(permission);
      mockGetProgramContextSync.mockReturnValue(context);
      mockGetFeatureAccess.mockReturnValue({ canView: pmAccess, canEdit: pmAccess });
      mockGetAccessibleSchoolCodes.mockResolvedValue(codes);
    }

    async function renderDashboard(params: Record<string, string>) {
      render(await DashboardPage({ searchParams: Promise.resolve(params) }));
    }

    function expectCentresView() {
      expect(screen.getByTestId("school-search")).toHaveAttribute(
        "data-placeholder",
        "Search centres by name, school, or code...",
      );
      expect(screen.queryByTestId("student-search")).not.toBeInTheDocument();
    }

    function expectJnvView() {
      expect(screen.getByTestId("student-search")).toBeInTheDocument();
      expect(screen.queryByText(/physical centres found/i)).not.toBeInTheDocument();
    }

    const centreRow = (id: string, name: string, schoolId: string | null, schoolCode: string | null) => ({
      id, name, program_name: "CoE", school_id: schoolId, school_code: schoolCode,
      school_name: schoolCode ? `School ${schoolCode}` : null, region: "West", grade: null, count: "0",
    });

    it.each([
      ["a physical-only PM", pmPermission, physicalContext, {}],
      ["a mixed-Program Admin", adminPermission, mixedContext, {}],
      ["a physical-only PM with an invalid view", pmPermission, physicalContext, { view: "bogus" }],
      ["a physical-only PM searching without a view", pmPermission, physicalContext, { q: "abc" }],
      ["a physical-only PM paging without a view", pmPermission, physicalContext, { page: "2" }],
      ["an NVS-only Program Admin asking for Centres", nvsOnlyProgramAdminPermission, nvsOnlyContext, { view: "centres" }],
    ] as const)("lands %s on Physical Centres", async (_label, permission, context, params) => {
      setupActor({ permission, context });
      routeQueries();

      await renderDashboard(params);

      expectCentresView();
      expect(screen.getByText("Physical Centres", { selector: "a" })).toHaveAttribute("href", "/dashboard?view=centres");
    });

    it.each([
      ["an NVS-only Program Admin", nvsOnlyProgramAdminPermission, nvsOnlyContext, {}],
      ["an NVS-only Program Admin with an invalid view", nvsOnlyProgramAdminPermission, nvsOnlyContext, { view: "bogus" }],
      ["an NVS-only Program Admin searching without a view", nvsOnlyProgramAdminPermission, nvsOnlyContext, { q: "abc" }],
      ["a physical-only PM choosing JNV NVS Schools", pmPermission, physicalContext, { view: "jnv-nvs" }],
      ["a mixed-Program Admin choosing JNV NVS Schools", adminPermission, mixedContext, { view: "jnv-nvs" }],
    ] as const)("lands %s on JNV NVS Schools", async (_label, permission, context, params) => {
      setupActor({ permission, context });
      routeQueries({ schools: [makeSchool()], schoolTotal: "1" });

      await renderDashboard(params);

      expectJnvView();
      expect(screen.getByTestId("school-card-SC001")).toHaveAttribute("data-href", "/school/SC001");
    });

    it("shows a seatless physical-Program user with one School their Physical Centres instead of redirecting", async () => {
      setupActor({ session: teacherSession, permission: { ...singleSchoolPermission, program_ids: [1] }, codes: ["SC001"], pmAccess: false });
      routeQueries({ centres: [centreRow("8", "Bhavnagar CoE", "s1", "SC001")] });

      await renderDashboard({});

      expect(mockRedirect).not.toHaveBeenCalled();
      expectCentresView();
      expect(screen.getByText("Bhavnagar CoE").closest("a")).toHaveAttribute("href", "/centre/8");
    });

    it("still sends a physical-Program user with one School to it when JNV NVS Schools is chosen", async () => {
      setupActor({ session: teacherSession, permission: { ...singleSchoolPermission, program_ids: [1] }, codes: ["SC001"], pmAccess: false });
      routeQueries();

      await expect(renderDashboard({ view: "jnv-nvs" })).rejects.toThrow("REDIRECT:/school/SC001");
    });

    it("still sends an NVS-only user with one School straight to it", async () => {
      setupActor({ session: teacherSession, permission: singleSchoolPermission, context: nvsOnlyContext, codes: ["SC001"], pmAccess: false });
      routeQueries();

      await expect(renderDashboard({})).rejects.toThrow("REDIRECT:/school/SC001");
    });

    it("does not send a one-School user to the School while searching JNV NVS Schools", async () => {
      setupActor({ session: teacherSession, permission: singleSchoolPermission, context: nvsOnlyContext, codes: ["SC001"], pmAccess: false });
      routeQueries();

      await renderDashboard({ view: "jnv-nvs", q: "x" });

      expect(mockRedirect).not.toHaveBeenCalled();
      expectJnvView();
    });

    describe("seated users", () => {
      const seated = (centres: number[]) => ({
        ...singleSchoolPermission,
        program_ids: [1],
        scope: { schools: new Set(["SC001"]), centres: new Set(centres), programs: new Set([1]) },
      });

      it("redirects on a plain landing when exactly one seat Centre is browsable", async () => {
        setupActor({ session: teacherSession, permission: seated([8, 17]), codes: ["SC001"], pmAccess: false });
        routeQueries({ browsableCentreIds: ["8"] });

        await expect(renderDashboard({})).rejects.toThrow("REDIRECT:/centre/8");
      });

      it("lists both Centres when two seat Centres are browsable", async () => {
        setupActor({ session: teacherSession, permission: seated([8, 9]), codes: ["SC001"], pmAccess: false });
        routeQueries({
          browsableCentreIds: ["8", "9"],
          centres: [centreRow("8", "Centre Eight", "s1", "SC001"), centreRow("9", "Centre Nine", "s1", "SC001")],
        });

        await renderDashboard({});

        expect(mockRedirect).not.toHaveBeenCalled();
        expectCentresView();
        expect(screen.getByText("Centre Eight").closest("a")).toHaveAttribute("href", "/centre/8");
        expect(screen.getByText("Centre Nine").closest("a")).toHaveAttribute("href", "/centre/9");
      });

      it("lists Centres when the only seat Centre is School-less", async () => {
        setupActor({ session: teacherSession, permission: seated([17]), codes: ["SC001"], pmAccess: false });
        routeQueries({ browsableCentreIds: [], centres: [centreRow("17", "City Centre", null, null)] });

        await renderDashboard({});

        expect(mockRedirect).not.toHaveBeenCalled();
        expectCentresView();
        expect(screen.getByText("City Centre")).toBeInTheDocument();
      });

      it.each([
        ["an invalid view", { view: "bogus" }],
        ["an explicit Centres view", { view: "centres" }],
        ["an explicit JNV view", { view: "jnv-nvs" }],
      ])("does not take the single-Centre shortcut with %s, and stays on Centres", async (_label, params) => {
        setupActor({ session: teacherSession, permission: seated([8]), codes: ["SC001"], pmAccess: false });
        routeQueries({ browsableCentreIds: ["8"], centres: [centreRow("8", "Centre Eight", "s1", "SC001")] });

        await renderDashboard(params);

        expect(mockRedirect).not.toHaveBeenCalled();
        expectCentresView();
        expect(screen.getByText("Centre Eight").closest("a")).toHaveAttribute("href", "/centre/8");
      });
    });

    describe("JNV pagination", () => {
      it.each([
        ["without search", { view: "jnv-nvs", page: "2" }, { view: "jnv-nvs" }],
        ["with search", { view: "jnv-nvs", page: "2", q: "bhav" }, { q: "bhav", view: "jnv-nvs" }],
        ["for an NVS-only user without a view", {}, { view: "jnv-nvs" }],
      ] as const)("keeps pages on JNV NVS Schools %s", async (_label, params, expected) => {
        const nvsOnly = Object.keys(params).length === 0;
        setupActor(nvsOnly
          ? { permission: nvsOnlyProgramAdminPermission, context: nvsOnlyContext }
          : {});
        routeQueries({ schools: [makeSchool()], schoolTotal: "45" });

        await renderDashboard(params);

        const searchParams = JSON.parse(screen.getByTestId("pagination").getAttribute("data-search-params")!);
        expect(searchParams).toEqual(expected);
      });
    });

    // #391: cards open their School or Centre; Visits start from the destination.
    describe("card actions", () => {
      it.each([
        ["a PM", pmPermission],
        ["an Admin", adminPermission],
      ] as const)("gives %s School cards on JNV NVS Schools without a Start Visit shortcut", async (_label, permission) => {
        setupActor({ permission, context: mixedContext });
        routeQueries({ schools: [makeSchool()], schoolTotal: "1" });

        await renderDashboard({ view: "jnv-nvs" });

        expect(screen.getByTestId("school-card-SC001")).toHaveAttribute("data-href", "/school/SC001");
        expect(screen.queryByTestId("school-card-actions")).not.toBeInTheDocument();
        expect(screen.queryByText("Start Visit")).not.toBeInTheDocument();
        expect(document.querySelector('a[href$="/visit/new"]')).toBeNull();
      });

      it.each([
        ["a PM", pmPermission],
        ["an Admin", adminPermission],
      ] as const)("gives %s Centre cards on Physical Centres without a Start Visit shortcut", async (_label, permission) => {
        setupActor({ permission, context: mixedContext });
        routeQueries({
          browsableCentreIds: ["8"],
          centres: [centreRow("8", "Centre Eight", "s1", "SC001"), centreRow("17", "City Centre", null, null)],
        });

        await renderDashboard({ view: "centres" });

        expect(screen.getByText("Centre Eight").closest("a")).toHaveAttribute("href", "/centre/8");
        expect(screen.getByText("City Centre").closest("a")).toBeNull();
        expect(screen.queryByText("Start Visit")).not.toBeInTheDocument();
        expect(document.querySelector('a[href$="/visit/new"]')).toBeNull();
      });
    });
  });
});
