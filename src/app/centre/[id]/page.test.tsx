import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- mocks (hoisted) ----

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetProgramContextSync,
  mockGetFeatureAccess,
  mockQuery,
  mockRedirect,
  mockNotFound,
  mockGetCentreWithSchool,
  mockGetCentreStudents,
  mockGetSchoolRoster,
  mockRouterRefresh,
  mockRouterPush,
  mockGetAcademicMentorshipActorUserId,
  mockListAcademicMentorshipMappings,
  mockListAcademicMentorshipTeacherMentees,
  mockListHolisticAssignmentRoster,
  mockRequireHolisticMentorshipAccess,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetProgramContextSync: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockQuery: vi.fn(),
  mockRouterRefresh: vi.fn(),
  mockRouterPush: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  mockGetCentreWithSchool: vi.fn(),
  mockGetCentreStudents: vi.fn(),
  mockGetSchoolRoster: vi.fn(),
  mockGetAcademicMentorshipActorUserId: vi.fn(),
  mockListAcademicMentorshipMappings: vi.fn(),
  mockListAcademicMentorshipTeacherMentees: vi.fn(),
  mockListHolisticAssignmentRoster: vi.fn(),
  mockRequireHolisticMentorshipAccess: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({ refresh: mockRouterRefresh, push: mockRouterPush }),
}));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    getUserPermission: mockGetUserPermission,
    getResolvedPermission: mockGetUserPermission,
    getProgramContextSync: mockGetProgramContextSync,
    getFeatureAccess: mockGetFeatureAccess,
  };
});
vi.mock("@/lib/db", () => ({ query: mockQuery }));
// Only the page lookup is mocked: the Centre switcher list query stays real so
// its SQL and params are asserted through mockQuery.
vi.mock("@/lib/dashboard-groupings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard-groupings")>();
  return { ...actual, getCentreWithSchool: mockGetCentreWithSchool };
});
vi.mock("@/lib/school-students", () => ({
  getCentreStudents: mockGetCentreStudents,
  getSchoolRoster: mockGetSchoolRoster,
}));
vi.mock("@/lib/academic-mentorship", () => ({
  getAcademicMentorshipActorUserId: mockGetAcademicMentorshipActorUserId,
  listAcademicMentorshipMappings: mockListAcademicMentorshipMappings,
  listAcademicMentorshipTeacherMentees: mockListAcademicMentorshipTeacherMentees,
}));
vi.mock("@/lib/holistic-mentorship", () => ({
  requireHolisticMentorshipAccess: mockRequireHolisticMentorshipAccess,
}));
vi.mock("@/lib/holistic-mappings", () => ({
  listHolisticAssignmentRoster: mockListHolisticAssignmentRoster,
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Tab bodies are stubs — this suite is about which tabs RosterPage builds for a
// centre scope, not how each tab renders. PageHeader is real so the Centre
// switcher's heading/popup boundary is observable.
vi.mock("@/components/SchoolTabs", () => ({
  __esModule: true,
  default: ({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) => (
    <div data-testid="school-tabs">
      {tabs.map((tab) => (
        <div key={tab.id} data-testid={`tab-${tab.id}`}>
          {tab.label}
          <div data-testid={`tab-content-${tab.id}`}>{tab.content}</div>
        </div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/enrollment/EnrollmentTabContent", () => ({
  __esModule: true,
  default: ({ programs }: { programs?: { id: number }[] }) => (
    <div
      data-testid="enrollment-tab-content"
      data-program-ids={(programs ?? []).map((p) => p.id).join(",")}
    >
      EnrollmentTabContent
    </div>
  ),
}));
vi.mock("@/components/curriculum/CurriculumTab", () => ({
  __esModule: true,
  default: ({ programId }: { programId?: number }) => (
    <div data-testid="curriculum-tab" data-program-id={String(programId)}>CurriculumTab</div>
  ),
}));
vi.mock("@/components/PerformanceTab", () => ({
  __esModule: true,
  default: ({ lockedProgram }: { lockedProgram?: string }) => (
    <div data-testid="performance-tab" data-locked-program={lockedProgram || ""}>PerformanceTab</div>
  ),
}));
vi.mock("@/components/quiz-sessions/QuizSessionsTab", () => ({
  __esModule: true,
  default: ({ programId }: { programId?: number }) => (
    <div data-testid="quiz-sessions-tab" data-program-id={String(programId)}>QuizSessionsTab</div>
  ),
}));
vi.mock("@/components/VisitsTab", () => ({
  __esModule: true,
  default: () => <div data-testid="visits-tab">VisitsTab</div>,
}));
vi.mock("@/components/holistic-mentorship/HolisticMentorshipWorkspace", () => ({
  __esModule: true,
  default: ({ schoolCode, canEdit }: { schoolCode: string; canEdit: boolean }) => (
    <div
      data-testid="holistic-workspace"
      data-school-code={schoolCode}
      data-can-edit={String(canEdit)}
    >
      HolisticMentorshipWorkspace
    </div>
  ),
}));
vi.mock("@/components/holistic-mentorship/AdminSchoolRoster", () => ({
  __esModule: true,
  default: ({ schoolCode }: { schoolCode: string }) => (
    <div data-testid="holistic-admin-roster" data-school-code={schoolCode}>
      AdminSchoolRoster
    </div>
  ),
}));
vi.mock("@/components/EditStudentModal", () => ({
  __esModule: true,
  default: () => null,
  Batch: {},
}));

import CentrePage from "./page";

// ---- helpers ----

const SCHOOL = {
  id: "20",
  name: "JNV Bhavnagar",
  code: "70705",
  udise_code: "24120100101",
  district: "Bhavnagar",
  state: "Gujarat",
  region: "West",
};

const makeCentre = (overrides = {}) => ({
  id: "8",
  name: "JNV Bhavnagar CoE",
  program_id: 1,
  program_name: "JNV CoE",
  school: SCHOOL,
  ...overrides,
});

const makePermission = (overrides = {}) => ({
  email: "teacher@avantifellows.org",
  level: 1 as const,
  role: "teacher" as const,
  school_codes: ["70705"],
  regions: null,
  program_ids: [1],
  read_only: false,
  // Seat-derived scope, as getResolvedPermission would populate it: the seat at
  // centre 8 is what grants this teacher access to its parent school.
  scope: {
    schools: new Set(["70705"]),
    centres: new Set([8]),
    programs: new Set([1]),
  },
  ...overrides,
});

const featureAccess = (canView: boolean, canEdit: boolean) => ({
  access: canEdit ? "edit" : canView ? "view" : "none",
  canView,
  canEdit,
});

// CentrePage returns <RosterPage/>, itself an async server component that RTL
// can't resolve — unwrap one level before rendering (mirrors the school suite).
async function resolveAsyncComponent(
  element: React.ReactElement,
): Promise<React.ReactElement> {
  const type = element.type;
  if (typeof type === "function") {
    return await (type as (p: unknown) => Promise<React.ReactElement>)(element.props);
  }
  return element;
}

const renderCentre = async (id = "8") =>
  render(await resolveAsyncComponent(await CentrePage({ params: Promise.resolve({ id }) })));

function setupCentre(centreOverrides = {}, permissionOverrides = {}) {
  const centre = makeCentre(centreOverrides);
  const permission = makePermission(permissionOverrides);
  mockGetServerSession.mockResolvedValue({
    user: { email: permission.email },
  });
  mockGetCentreWithSchool.mockResolvedValue(centre);
  mockGetUserPermission.mockResolvedValue(permission);
  mockGetProgramContextSync.mockReturnValue({
    hasAccess: true,
    programIds: permission.program_ids,
    isNVSOnly: false,
    hasCoEOrNodal: true,
  });
  mockGetFeatureAccess.mockReturnValue(featureAccess(true, true));
  mockGetCentreStudents.mockResolvedValue({ students: [], issues: [] });
  mockQuery.mockResolvedValue([]); // getGrades + getBatchesWithMetadata
  return { centre, permission };
}

// ---- tests ----

describe("CentrePage → RosterPage (centre scope)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
    mockNotFound.mockImplementation(() => {
      throw new Error("NOT_FOUND");
    });
    mockListAcademicMentorshipMappings.mockResolvedValue([]);
    mockListAcademicMentorshipTeacherMentees.mockResolvedValue([]);
    mockListHolisticAssignmentRoster.mockResolvedValue([]);
    mockGetAcademicMentorshipActorUserId.mockResolvedValue(101);
    mockRequireHolisticMentorshipAccess.mockResolvedValue({
      ok: true,
      email: "teacher@avantifellows.org",
      permission: makePermission(),
      canEdit: true,
      school: { id: 20, code: "70705", name: "JNV Bhavnagar", region: "West" },
    });
  });

  // The load-bearing case: ~150 CoE subject teachers hold centre seats, which
  // confines them off the school page. If holistic were school-page-only they
  // would have no route to their own workspace at all.
  it("shows the Holistic Mentorship tab to a centre-seated CoE teacher", async () => {
    setupCentre();

    await renderCentre();

    expect(screen.getByTestId("tab-holistic_mentorship")).toHaveTextContent(
      "Holistic Mentorship",
    );
    expect(screen.getByTestId("holistic-workspace")).toHaveAttribute(
      "data-school-code",
      "70705",
    );
    // programId is the CENTRE's program, so the confinement is enforced by the
    // access call itself rather than only by the tab-visibility gate above.
    expect(mockRequireHolisticMentorshipAccess).toHaveBeenCalledWith(
      expect.anything(),
      "roster_view",
      { schoolCode: "70705", programId: 1 },
    );
  });

  // A centre page shows only its own program's surfaces. Holistic is Program 1,
  // so a Nodal centre must not surface it even when the parent school has a CoE
  // centre too (which is what requireHolisticMentorshipAccess would allow).
  it("hides Holistic Mentorship on a non-CoE centre at a CoE school", async () => {
    setupCentre({ id: "11", program_id: 2, program_name: "JNV Nodal" }, {
      program_ids: [2],
      scope: {
        schools: new Set(["70705"]),
        centres: new Set([11]),
        programs: new Set([2]),
      },
    });

    await renderCentre("11");

    expect(screen.queryByTestId("tab-holistic_mentorship")).not.toBeInTheDocument();
    expect(mockRequireHolisticMentorshipAccess).not.toHaveBeenCalled();
  });

  it("hides Holistic Mentorship when the shared policy denies access", async () => {
    setupCentre();
    mockRequireHolisticMentorshipAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    await renderCentre();

    expect(screen.queryByTestId("tab-holistic_mentorship")).not.toBeInTheDocument();
  });

  // Centre 16 "Nagaland Foundation" is active, physical and school-linked, so its
  // page renders — but it has no program_id. Without a program to filter by, the
  // program-scoped tabs fall back to the school's own data, which at Kohima means
  // sibling centre 15 (JNV Kohima CoE, 82 students) showing under this name.
  it("refuses program-scoped tabs for a centre with no program", async () => {
    setupCentre(
      { id: "16", name: "Nagaland Foundation", program_id: null, program_name: null },
      {
        scope: {
          schools: new Set(["70705"]),
          centres: new Set([16]),
          programs: new Set([1]),
        },
      }
    );

    await renderCentre("16");

    for (const tab of ["curriculum", "performance", "quiz_sessions"]) {
      expect(screen.getByTestId(`tab-content-${tab}`)).toHaveTextContent(
        "No Program is assigned to this Centre."
      );
    }
    expect(screen.queryByTestId("curriculum-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("performance-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quiz-sessions-tab")).not.toBeInTheDocument();
    // The school-keyed tabs are unaffected — a visit covers the whole school.
    expect(screen.getByTestId("tab-content-visits")).toHaveTextContent("VisitsTab");
    // And the mentorship overview stays empty rather than showing the school's.
    expect(mockListAcademicMentorshipMappings).not.toHaveBeenCalled();
  });

  // /dashboard immediately shortcuts a single-seat user back to this page, so a
  // bare /dashboard back link was a loop.
  it("points the back link at the Centres tab, not the dashboard landing", async () => {
    setupCentre();

    await renderCentre("8");

    expect(document.querySelector('header a[href="/dashboard?view=centres"]')).not.toBeNull();
  });

  // programsWithStudents counts a program when any student in scope merely dropped
  // from it, and that reads the student's own audit history. On JNV Adilabad CoE
  // two members carried an old "dropped from Nodal" audit, so the centre page grew
  // a JNV Nodal card for students it never lists.
  it("does not show a sibling program's enrollment card on a centre page", async () => {
    // Both programs in the viewer's own scope, so only the centre filter can
    // remove the Nodal card — otherwise this would pass for the wrong reason.
    setupCentre({}, { program_ids: [1, 2] });
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [1, 2],
      isNVSOnly: false,
      hasCoEOrNodal: true,
    });
    mockGetCentreStudents.mockResolvedValue({
      students: [
        {
          user_id: "1",
          student_id: "S1",
          program_id: 1,
          student_program_ids: [1],
          // old audit from a spell in the school's Nodal centre
          dropout_program_ids: [2],
          status: "active",
        },
      ] as never,
      issues: [],
    });

    await renderCentre("8");

    expect(screen.getByTestId("enrollment-tab-content")).toHaveAttribute(
      "data-program-ids",
      "1"
    );
  });

  it("keeps program-scoped tabs for a centre that has a program", async () => {
    setupCentre();

    await renderCentre("8");

    expect(screen.getByTestId("curriculum-tab")).toHaveAttribute("data-program-id", "1");
    expect(screen.getByTestId("quiz-sessions-tab")).toHaveAttribute("data-program-id", "1");
    expect(screen.getByTestId("performance-tab")).toHaveAttribute(
      "data-locked-program",
      "JNV CoE"
    );
    expect(screen.queryByText("No Program is assigned to this Centre.")).not.toBeInTheDocument();
  });

  it("labels the academic mentorship tab 'Academic Mentorship'", async () => {
    setupCentre();

    await renderCentre();

    expect(screen.getByTestId("tab-mentorship")).toHaveTextContent(
      "Academic Mentorship",
    );
  });

  it.each(["pmu_manager", "pmu_govt_school_user"] as const)(
    "gives %s Access Denied on a Physical Centre page",
    async (role) => {
      setupCentre({ program_id: 64, program_name: "JNV NVS" }, {
        email: "pmu@avantifellows.org",
        role,
        program_ids: [64],
        scope: undefined,
      });

      await renderCentre();

      expect(screen.getByText("Access Denied")).toBeInTheDocument();
      expect(
        screen.getByText("You don't have permission to view this centre."),
      ).toBeInTheDocument();
      expect(mockGetCentreStudents).not.toHaveBeenCalled();
    },
  );

  it("sends the holistic-mentorship admin to their console instead of the centre", async () => {
    setupCentre({}, {
      email: "holistic@example.com",
      level: 3,
      role: "holistic_mentorship_admin",
      school_codes: null,
      scope: undefined,
    });

    await expect(renderCentre()).rejects.toThrow(
      "REDIRECT:/admin/holistic-mentorship",
    );
    expect(mockGetCentreStudents).not.toHaveBeenCalled();
  });
});

// ---- Centre switcher ----

// Rows the switcher list query returns, shaped as node-pg hands them back.
type SwitcherRow = {
  id: string;
  name: string;
  program_name: string | null;
  school_name: string;
  school_code: string;
};

const BHAVNAGAR_COE: SwitcherRow = {
  id: "8",
  name: "JNV Bhavnagar CoE",
  program_name: "JNV CoE",
  school_name: "JNV Bhavnagar",
  school_code: "70705",
};
const ADILABAD_NODAL: SwitcherRow = {
  id: "31",
  name: "JNV Adilabad",
  program_name: "JNV Nodal",
  school_name: "JNV Adilabad",
  school_code: "36001",
};
const ADILABAD_COE: SwitcherRow = {
  id: "30",
  name: "JNV Adilabad",
  program_name: "JNV CoE",
  school_name: "JNV Adilabad",
  school_code: "36001",
};
const NAGALAND: SwitcherRow = {
  id: "16",
  name: "Nagaland Foundation",
  program_name: null,
  school_name: "JNV Kohima",
  school_code: "13001",
};

// The list query is the only one that selects browsable centres joined to
// their School code.
const isSwitcherSql = (sql: string) =>
  sql.includes("FROM centres c") && sql.includes("c.school_id IS NOT NULL");

function switcherQueryCalls() {
  return mockQuery.mock.calls.filter(([sql]) => isSwitcherSql(String(sql)));
}

function stubSwitcherRows(rows: SwitcherRow[]) {
  mockQuery.mockImplementation(async (sql: string) => (isSwitcherSql(sql) ? rows : []));
}

function switcherTrigger() {
  return within(screen.getByRole("heading", { level: 1 })).queryByRole("button");
}

describe("CentrePage → Centre switcher", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
    mockNotFound.mockImplementation(() => {
      throw new Error("NOT_FOUND");
    });
    mockListAcademicMentorshipMappings.mockResolvedValue([]);
    mockListAcademicMentorshipTeacherMentees.mockResolvedValue([]);
    mockListHolisticAssignmentRoster.mockResolvedValue([]);
    mockGetAcademicMentorshipActorUserId.mockResolvedValue(101);
    mockRequireHolisticMentorshipAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });
  });

  it("turns the Centre title into a switcher button when another Centre is browsable", async () => {
    setupCentre();
    stubSwitcherRows([BHAVNAGAR_COE, ADILABAD_COE]);

    await renderCentre("8");

    const trigger = switcherTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveTextContent("JNV Bhavnagar CoE");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAccessibleDescription("Switch Centre");
  });

  it("keeps the plain title when the current Centre is the only browsable one", async () => {
    setupCentre();
    stubSwitcherRows([BHAVNAGAR_COE]);

    await renderCentre("8");

    expect(screen.getByRole("heading", { level: 1, name: "JNV Bhavnagar CoE" })).toBeInTheDocument();
    expect(switcherTrigger()).toBeNull();
  });

  // Mocked rows can't prove exclusion — the predicate in the SQL does. An
  // inactive or School-less Centre is never a row, so it never earns a switcher.
  it("lists only active, School-linked Centres", async () => {
    setupCentre();
    stubSwitcherRows([BHAVNAGAR_COE]);

    await renderCentre("8");

    const [[sql]] = switcherQueryCalls();
    expect(sql).toMatch(/WHERE c\.is_active AND c\.school_id IS NOT NULL/);
    expect(sql).not.toContain("centre_students");
  });

  it("scopes a seated user's list to their seat Centres", async () => {
    setupCentre({}, {
      scope: {
        schools: new Set(["70705", "36001"]),
        centres: new Set([8, 30]),
        programs: new Set([1]),
      },
    });
    stubSwitcherRows([BHAVNAGAR_COE, ADILABAD_COE]);

    await renderCentre("8");

    const [[sql, params]] = switcherQueryCalls();
    expect(sql).toContain("AND c.id = ANY($1)");
    expect(sql).not.toContain("sch.code = ANY");
    expect(params).toEqual([[8, 30]]);
  });

  it("scopes a seatless School-scoped user's list to their School codes", async () => {
    setupCentre({}, {
      email: "pm@avantifellows.org",
      role: "program_manager",
      school_codes: ["70705", "36001"],
      scope: {
        schools: new Set(["70705", "36001"]),
        centres: new Set(),
        programs: new Set(),
      },
    });
    stubSwitcherRows([BHAVNAGAR_COE, ADILABAD_COE]);

    await renderCentre("8");

    const [[sql, params]] = switcherQueryCalls();
    expect(sql).toContain("AND sch.code = ANY($1)");
    expect(sql).not.toContain("c.id = ANY");
    expect(params).toEqual([["70705", "36001"]]);
  });

  it("gives a global admin an unscoped list", async () => {
    setupCentre({}, {
      email: "admin@avantifellows.org",
      level: 3,
      role: "admin",
      school_codes: null,
      scope: { schools: "all", centres: "all", programs: "all" },
    });
    stubSwitcherRows([BHAVNAGAR_COE, ADILABAD_COE]);

    await renderCentre("8");

    const [[sql, params]] = switcherQueryCalls();
    expect(sql).not.toContain("= ANY(");
    expect(params).toEqual([]);
    expect(switcherTrigger()).not.toBeNull();
  });

  // A regional user reaches the page by region, but region expansion only
  // yields JNV School codes — at a non-JNV School that leaves an empty scope,
  // which must not become an unscoped query.
  it("runs no list query for an empty School scope", async () => {
    setupCentre({}, {
      email: "pm@avantifellows.org",
      role: "program_manager",
      level: 2,
      school_codes: null,
      regions: ["West"],
      scope: { schools: new Set(), centres: new Set(), programs: new Set() },
    });
    stubSwitcherRows([BHAVNAGAR_COE, ADILABAD_COE]);

    await renderCentre("8");

    expect(screen.getByTestId("enrollment-tab-content")).toBeInTheDocument();
    expect(switcherQueryCalls()).toHaveLength(0);
    expect(switcherTrigger()).toBeNull();
  });

  it.each(["pmu_manager", "pmu_govt_school_user"] as const)(
    "gives %s Access Denied without running the list query",
    async (role) => {
      setupCentre({ program_id: 64, program_name: "JNV NVS" }, {
        email: "pmu@avantifellows.org",
        role,
        program_ids: [64],
        scope: undefined,
      });
      stubSwitcherRows([BHAVNAGAR_COE, ADILABAD_COE]);

      await renderCentre();

      expect(screen.getByText("Access Denied")).toBeInTheDocument();
      expect(switcherQueryCalls()).toHaveLength(0);
    },
  );

  describe("when the list can't load", () => {
    const expectPlainPageAndSafeLog = (errorSpy: ReturnType<typeof vi.spyOn>) => {
      expect(screen.getByRole("heading", { level: 1, name: "JNV Bhavnagar CoE" })).toBeInTheDocument();
      expect(switcherTrigger()).toBeNull();
      expect(screen.getByTestId("enrollment-tab-content")).toBeInTheDocument();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("Centre switcher list unavailable");
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain("@avantifellows.org");
      expect(logged).not.toMatch(/\b(8|30|70705|36001)\b/);
    };

    it("renders the plain title and roster when the list query rejects", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      setupCentre();
      mockQuery.mockImplementation(async (sql: string) => {
        if (isSwitcherSql(sql)) throw new Error("query failed for centres 8, 30");
        return [];
      });

      await renderCentre("8");

      expectPlainPageAndSafeLog(errorSpy);
      errorSpy.mockRestore();
    });

    it("renders the plain title and roster when School-scope expansion rejects", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      setupCentre({}, {
        email: "pm@avantifellows.org",
        role: "program_manager",
        level: 2,
        school_codes: null,
        regions: ["West"],
        scope: { schools: new Set(), centres: new Set(), programs: new Set() },
      });
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("region = ANY")) throw new Error("region lookup failed for 70705");
        return isSwitcherSql(sql) ? [BHAVNAGAR_COE, ADILABAD_COE] : [];
      });

      await renderCentre("8");

      expectPlainPageAndSafeLog(errorSpy);
      expect(switcherQueryCalls()).toHaveLength(0);
      errorSpy.mockRestore();
    });
  });

  describe("popup", () => {
    // Same name, Program and School as NAGALAND but a lower id: the numeric id
    // is the last tiebreak ("9" sorts after "16" as a string).
    const NAGALAND_9: SwitcherRow = { ...NAGALAND, id: "9" };
    // Same name and Program as ADILABAD_COE at a School that sorts first.
    const ADILABAD_ANNEX: SwitcherRow = {
      id: "40",
      name: "JNV Adilabad",
      program_name: "JNV CoE",
      school_name: "Adilabad Annex",
      school_code: "36002",
    };

    async function openSwitcher() {
      setupCentre();
      stubSwitcherRows([NAGALAND, ADILABAD_NODAL, NAGALAND_9, BHAVNAGAR_COE, ADILABAD_COE, ADILABAD_ANNEX]);
      await renderCentre("8");
      const user = userEvent.setup();
      await user.click(switcherTrigger()!);
      return user;
    }

    it("opens a listbox beside the heading, never inside it", async () => {
      await openSwitcher();

      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toHaveAccessibleName("JNV Bhavnagar CoE");
      expect(switcherTrigger()).toHaveAttribute("aria-expanded", "true");
      const listbox = screen.getByRole("listbox", { name: "Centres" });
      expect(heading.contains(listbox)).toBe(false);
    });

    it("lists the current Centre first, then the rest by name, School, Program and id", async () => {
      await openSwitcher();

      const options = within(screen.getByRole("listbox")).getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        "JNV Bhavnagar CoE" + "Current" + "JNV CoE · JNV Bhavnagar (70705)",
        "JNV Adilabad" + "JNV CoE · Adilabad Annex (36002)",
        "JNV Adilabad" + "JNV CoE · JNV Adilabad (36001)",
        "JNV Adilabad" + "JNV Nodal · JNV Adilabad (36001)",
        "Nagaland Foundation" + "No Program · JNV Kohima (13001)",
        "Nagaland Foundation" + "No Program · JNV Kohima (13001)",
      ]);
      expect(options[0]).toHaveAttribute("aria-disabled", "true");
      expect(options[0]).toHaveAttribute("aria-selected", "true");
      expect(options[1]).not.toHaveAttribute("aria-disabled");
      expect(options[1]).toHaveAttribute("aria-selected", "false");
    });

    it("keeps the page's own Centre first even when the list omits it", async () => {
      setupCentre();
      stubSwitcherRows([ADILABAD_NODAL]);
      await renderCentre("8");
      await userEvent.setup().click(switcherTrigger()!);

      const options = within(screen.getByRole("listbox")).getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        "JNV Bhavnagar CoE" + "Current" + "JNV CoE · JNV Bhavnagar (70705)",
        "JNV Adilabad" + "JNV Nodal · JNV Adilabad (36001)",
      ]);
    });

    it("goes to another Centre's page when its option is clicked", async () => {
      const user = await openSwitcher();

      const options = within(screen.getByRole("listbox")).getAllByRole("option");
      await user.click(options[4]);

      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith("/centre/9");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("does nothing when the current Centre is clicked", async () => {
      const user = await openSwitcher();

      await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);

      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });
});
