import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// ---- mocks (hoisted) ----

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetProgramContextSync,
  mockGetFeatureAccess,
  mockQuery,
  mockRedirect,
  mockNotFound,
  mockProcessStudents,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetProgramContextSync: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockQuery: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  mockProcessStudents: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
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
vi.mock("@/lib/school-student-list-data-issues", () => ({
  processStudents: mockProcessStudents,
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
vi.mock("@/components/StudentTable", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="student-table" data-props={JSON.stringify(props)}>
      StudentTable
    </div>
  ),
  Grade: {},
}));

vi.mock("@/components/PageHeader", () => ({
  __esModule: true,
  default: ({
    title,
    subtitle,
    backHref,
    userEmail,
  }: {
    title: string;
    subtitle?: string;
    backHref?: string;
    userEmail?: string;
  }) => (
    <div
      data-testid="page-header"
      data-title={title}
      data-subtitle={subtitle || ""}
      data-back-href={backHref || ""}
      data-user-email={userEmail || ""}
    >
      PageHeader
    </div>
  ),
}));

vi.mock("@/components/StatCard", () => ({
  __esModule: true,
  default: ({
    label,
    value,
    size,
  }: {
    label: string;
    value: string | number;
    size?: string;
  }) => (
    <div data-testid={`stat-card-${label}`} data-size={size || "md"}>
      {label}: {value}
    </div>
  ),
}));

vi.mock("@/components/SchoolTabs", () => ({
  __esModule: true,
  default: ({
    tabs,
    defaultTab,
  }: {
    tabs: { id: string; label: string; content: React.ReactNode }[];
    defaultTab?: string;
  }) => (
    <div data-testid="school-tabs" data-default-tab={defaultTab || ""}>
      {tabs.map((tab) => (
        <div key={tab.id} data-testid={`tab-${tab.id}`}>
          {tab.label}
          <div data-testid={`tab-content-${tab.id}`}>{tab.content}</div>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/curriculum/CurriculumTab", () => ({
  __esModule: true,
  default: ({
    schoolCode,
    schoolName,
    canEdit,
  }: {
    schoolCode: string;
    schoolName: string;
    canEdit: boolean;
  }) => (
    <div
      data-testid="curriculum-tab"
      data-school-code={schoolCode}
      data-school-name={schoolName}
      data-can-edit={String(canEdit)}
    >
      CurriculumTab
    </div>
  ),
}));

vi.mock("@/components/PerformanceTab", () => ({
  __esModule: true,
  default: ({ schoolUdise }: { schoolUdise: string }) => (
    <div data-testid="performance-tab" data-school-udise={schoolUdise}>
      PerformanceTab
    </div>
  ),
}));

vi.mock("@/components/quiz-sessions/QuizSessionsTab", () => ({
  __esModule: true,
  default: ({ schoolId, canEdit }: { schoolId: string; canEdit?: boolean }) => (
    <div
      data-testid="quiz-sessions-tab"
      data-school-id={schoolId}
      data-can-edit={String(canEdit)}
    >
      QuizSessionsTab
    </div>
  ),
}));

vi.mock("@/components/VisitsTab", () => ({
  __esModule: true,
  default: ({ schoolCode }: { schoolCode: string }) => (
    <div data-testid="visits-tab" data-school-code={schoolCode}>
      VisitsTab
    </div>
  ),
}));

vi.mock("@/components/EditStudentModal", () => ({
  __esModule: true,
  default: () => null,
  Batch: {},
}));

import SchoolPage from "./page";

// ---- helpers ----

const makeSchool = (overrides = {}) => ({
  id: "school-1",
  name: "JNV Bhavnagar",
  code: "70705",
  udise_code: "24120100101",
  district: "Bhavnagar",
  state: "Gujarat",
  region: "West",
  ...overrides,
});

const makeStudent = (overrides = {}) => ({
  group_user_id: "gu-1",
  user_id: "u-1",
  student_pk_id: "sp-1",
  first_name: "Aarav",
  last_name: "Sharma",
  phone: "9876543210",
  email: null,
  date_of_birth: null,
  student_id: "S001",
  apaar_id: null,
  category: "General",
  stream: "Science",
  gender: "male",
  program_name: "JNV NVS",
  program_id: 64,
  grade: 11,
  grade_id: "g-11",
  status: "active",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makePermission = (overrides = {}) => ({
  email: "user@avantifellows.org",
  level: 3 as const,
  role: "admin" as const,
  school_codes: null,
  regions: null,
  program_ids: [1, 64],
  read_only: false,
  ...overrides,
});

const googleSession = (overrides = {}) => ({
  user: { email: "user@avantifellows.org" },
  isPasscodeUser: false,
  schoolCode: undefined,
  ...overrides,
});

const passcodeSession = (schoolCode: string) => ({
  user: {},
  isPasscodeUser: true,
  schoolCode,
});

const featureAccess = (canView: boolean, canEdit: boolean) => ({
  access: canEdit ? "edit" : canView ? "view" : "none",
  canView,
  canEdit,
});

// Default setup: admin Google user with full access
function setupAdminDefaults(schoolOverrides = {}) {
  const school = makeSchool(schoolOverrides);
  const permission = makePermission();

  mockGetServerSession.mockResolvedValue(googleSession());
  // Query 1: getSchoolByCode, Query 2: getStudents, Query 3: getGrades, Query 4: getBatchesWithMetadata
  mockQuery
    .mockResolvedValueOnce([school]) // getSchoolByCode
    .mockResolvedValueOnce([]) // getStudents
    .mockResolvedValueOnce([]) // getGrades
    .mockResolvedValueOnce([]); // getBatchesWithMetadata
  mockGetUserPermission.mockResolvedValue(permission);
  mockGetProgramContextSync.mockReturnValue({
    hasAccess: true,
    programIds: [1, 64],
    isNVSOnly: false,
    hasCoEOrNodal: true,
  });
  mockGetFeatureAccess.mockReturnValue(featureAccess(true, true));
  mockProcessStudents.mockResolvedValue({ students: [], issues: [] });

  return { school, permission };
}

const renderPage = async (udise = "24120100101") => {
  const jsx = await SchoolPage({
    params: Promise.resolve({ udise }),
  });
  return render(jsx);
};

// ---- tests ----

describe("SchoolPage (server component)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-establish sentinel implementations after reset
    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
    mockNotFound.mockImplementation(() => {
      throw new Error("NOT_FOUND");
    });
    // EnrollmentTabContent fetches grade-11 consent status on mount; stub it so
    // the post-render state update doesn't trigger act() warnings here.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ consent: {} }),
      }),
    );
  });

  // --- Auth redirects ---

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    mockQuery.mockResolvedValueOnce([makeSchool()]);

    await expect(
      SchoolPage({ params: Promise.resolve({ udise: "24120100101" }) })
    ).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("calls notFound when school is not found", async () => {
    mockGetServerSession.mockResolvedValue(googleSession());
    mockQuery.mockResolvedValueOnce([]); // no school

    await expect(
      SchoolPage({ params: Promise.resolve({ udise: "99999999999" }) })
    ).rejects.toThrow("NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  // --- Passcode user access ---

  it("renders access denied for passcode user accessing wrong school", async () => {
    mockGetServerSession.mockResolvedValue(passcodeSession("12345"));
    mockQuery.mockResolvedValueOnce([makeSchool({ code: "70705" })]);

    const jsx = await SchoolPage({
      params: Promise.resolve({ udise: "24120100101" }),
    });
    render(jsx);

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your passcode only grants access to a different school."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Return to login")).toBeInTheDocument();
    expect(screen.getByText("Return to login").closest("a")).toHaveAttribute(
      "href",
      "/"
    );
  });

  it("renders page for passcode user accessing own school", async () => {
    const school = makeSchool({ code: "70705" });
    mockGetServerSession.mockResolvedValue(passcodeSession("70705"));
    mockQuery
      .mockResolvedValueOnce([school]) // getSchoolByCode
      .mockResolvedValueOnce([]) // getStudents
      .mockResolvedValueOnce([]) // getGrades
      .mockResolvedValueOnce([]); // getBatchesWithMetadata
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [],
      isNVSOnly: false,
      hasCoEOrNodal: false,
    });
    // Passcode user: students = edit, rest = none
    mockGetFeatureAccess.mockImplementation(
      (
        _perm: unknown,
        feature: string,
        opts?: { isPasscodeUser?: boolean }
      ) => {
        if (opts?.isPasscodeUser && feature === "students") {
          return featureAccess(true, true);
        }
        return featureAccess(false, false);
      }
    );
    mockProcessStudents.mockResolvedValue({ students: [], issues: [] });

    const jsx = await SchoolPage({
      params: Promise.resolve({ udise: "24120100101" }),
    });
    render(jsx);

    // PageHeader should show school name and passcode email
    const header = screen.getByTestId("page-header");
    expect(header).toHaveAttribute("data-title", "JNV Bhavnagar");
    expect(header).toHaveAttribute("data-user-email", "School 70705");
    // No back href for passcode user (single school)
    expect(header).toHaveAttribute("data-back-href", "");
    // Only enrollment tab should be visible (passcode user gets none for other features)
    expect(screen.getByTestId("tab-enrollment")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-curriculum")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-visits")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Curriculum Summary" })
    ).not.toBeInTheDocument();
  });

  // --- Google user permission checks ---

  it("renders access denied for Google user with no permission", async () => {
    mockGetServerSession.mockResolvedValue(googleSession());
    mockQuery.mockResolvedValueOnce([makeSchool()]);
    mockGetUserPermission.mockResolvedValue(null);

    const jsx = await SchoolPage({
      params: Promise.resolve({ udise: "24120100101" }),
    });
    render(jsx);

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(
      screen.getByText(
        /You don.t have permission to view this school/
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Return to dashboard")).toBeInTheDocument();
    expect(
      screen.getByText("Return to dashboard").closest("a")
    ).toHaveAttribute("href", "/dashboard");
  });

  it("renders access denied for level 2 user with non-matching region", async () => {
    mockGetServerSession.mockResolvedValue(googleSession());
    mockQuery.mockResolvedValueOnce([makeSchool({ region: "West" })]);
    mockGetUserPermission.mockResolvedValue(
      makePermission({ level: 2, role: "program_manager", regions: ["East"] })
    );

    const jsx = await SchoolPage({
      params: Promise.resolve({ udise: "24120100101" }),
    });
    render(jsx);

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(
      screen.getByText(/You don.t have permission to view this school/)
    ).toBeInTheDocument();
  });

  it("renders access denied for level 1 user with non-matching school code", async () => {
    mockGetServerSession.mockResolvedValue(googleSession());
    mockQuery.mockResolvedValueOnce([makeSchool({ code: "70705" })]);
    mockGetUserPermission.mockResolvedValue(
      makePermission({
        level: 1,
        role: "teacher",
        school_codes: ["11111"],
      })
    );

    const jsx = await SchoolPage({
      params: Promise.resolve({ udise: "24120100101" }),
    });
    render(jsx);

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("renders page for level 2 user with matching region", async () => {
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({
        level: 2,
        role: "program_manager",
        regions: ["West"],
      })
    );

    await renderPage();

    expect(screen.getByTestId("page-header")).toBeInTheDocument();
    expect(screen.getByTestId("school-tabs")).toBeInTheDocument();
  });

  it("renders page for level 1 user with matching school code", async () => {
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({
        level: 1,
        role: "teacher",
        school_codes: ["70705"],
      })
    );

    await renderPage();

    expect(screen.getByTestId("page-header")).toBeInTheDocument();
  });

  it("renders page for level 3 user (all schools)", async () => {
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({ level: 3, role: "program_admin" })
    );

    await renderPage();

    expect(screen.getByTestId("page-header")).toBeInTheDocument();
  });

  // --- No program access ---

  it("renders no program access message when programContext.hasAccess is false", async () => {
    mockGetServerSession.mockResolvedValue(googleSession());
    mockQuery.mockResolvedValueOnce([makeSchool()]);
    mockGetUserPermission.mockResolvedValue(
      makePermission({ program_ids: [] })
    );
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: false,
      programIds: [],
      isNVSOnly: false,
      hasCoEOrNodal: false,
    });

    const jsx = await SchoolPage({
      params: Promise.resolve({ udise: "24120100101" }),
    });
    render(jsx);

    expect(screen.getByText("No Program Access")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You are not assigned to any programs. Please contact an administrator."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Return to dashboard").closest("a")
    ).toHaveAttribute("href", "/dashboard");
  });

  // --- Page rendering ---

  it("renders PageHeader with correct subtitle including UDISE code", async () => {
    setupAdminDefaults({
      district: "Bhavnagar",
      state: "Gujarat",
      code: "70705",
      udise_code: "24120100101",
    });

    await renderPage();

    const header = screen.getByTestId("page-header");
    expect(header).toHaveAttribute("data-title", "JNV Bhavnagar");
    expect(header).toHaveAttribute(
      "data-subtitle",
      "Bhavnagar, Gujarat | Code: 70705 | UDISE: 24120100101"
    );
  });

  it("renders subtitle without UDISE when udise_code is null", async () => {
    setupAdminDefaults({ udise_code: null });

    await renderPage();

    const header = screen.getByTestId("page-header");
    expect(header.getAttribute("data-subtitle")).not.toContain("UDISE");
    expect(header).toHaveAttribute(
      "data-subtitle",
      "Bhavnagar, Gujarat | Code: 70705"
    );
  });

  it("renders backHref=/dashboard for level 4 admin (multi-school)", async () => {
    setupAdminDefaults();

    await renderPage();

    const header = screen.getByTestId("page-header");
    expect(header).toHaveAttribute("data-back-href", "/dashboard");
  });

  it("renders no backHref for level 1 user with single school code", async () => {
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({
        level: 1,
        role: "teacher",
        school_codes: ["70705"],
      })
    );

    await renderPage();

    const header = screen.getByTestId("page-header");
    expect(header).toHaveAttribute("data-back-href", "");
  });

  it("does not show Curriculum Summary top-level link for eligible one-school users", async () => {
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({
        level: 1,
        role: "program_manager",
        school_codes: ["70705"],
        program_ids: [1],
      })
    );
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [1],
      isNVSOnly: false,
      hasCoEOrNodal: true,
    });

    await renderPage();

    expect(
      screen.queryByRole("link", { name: "Curriculum Summary" })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("page-header")).not.toHaveTextContent(
      "Curriculum Summary"
    );
  });

  it("renders backHref for level 1 user with multiple school codes", async () => {
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({
        level: 1,
        role: "teacher",
        school_codes: ["70705", "12345"],
      })
    );

    await renderPage();

    const header = screen.getByTestId("page-header");
    expect(header).toHaveAttribute("data-back-href", "/dashboard");
  });

  it("renders Google user email in PageHeader", async () => {
    setupAdminDefaults();

    await renderPage();

    const header = screen.getByTestId("page-header");
    expect(header).toHaveAttribute(
      "data-user-email",
      "user@avantifellows.org"
    );
  });

  // --- Tab visibility ---

  it("renders all tabs when user has full feature access", async () => {
    setupAdminDefaults();

    await renderPage();

    expect(screen.getByTestId("tab-enrollment")).toBeInTheDocument();
    expect(screen.getByTestId("tab-curriculum")).toBeInTheDocument();
    expect(screen.getByTestId("tab-performance")).toBeInTheDocument();
    expect(screen.getByTestId("tab-quiz_sessions")).toBeInTheDocument();
    expect(screen.getByTestId("tab-mentorship")).toBeInTheDocument();
    expect(screen.getByTestId("tab-visits")).toBeInTheDocument();
  });

  it("shows only enrollment tab when other features have no access", async () => {
    setupAdminDefaults();
    mockGetFeatureAccess.mockImplementation(
      (_perm: unknown, feature: string) => {
        if (feature === "students") return featureAccess(true, true);
        return featureAccess(false, false);
      }
    );

    await renderPage();

    expect(screen.getByTestId("tab-enrollment")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-curriculum")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-performance")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-mentorship")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-visits")).not.toBeInTheDocument();
  });

  it("passes correct defaultTab to SchoolTabs", async () => {
    setupAdminDefaults();

    await renderPage();

    expect(screen.getByTestId("school-tabs")).toHaveAttribute(
      "data-default-tab",
      "enrollment"
    );
  });

  // --- CurriculumTab props ---

  it("passes correct props to CurriculumTab", async () => {
    setupAdminDefaults();
    // Set curriculum canEdit specifically
    mockGetFeatureAccess.mockImplementation(
      (_perm: unknown, feature: string) => {
        if (feature === "curriculum") return featureAccess(true, false); // view only
        return featureAccess(true, true);
      }
    );

    await renderPage();

    const currTab = screen.getByTestId("curriculum-tab");
    expect(currTab).toHaveAttribute("data-school-code", "70705");
    expect(currTab).toHaveAttribute("data-school-name", "JNV Bhavnagar");
    expect(currTab).toHaveAttribute("data-can-edit", "false");
  });

  // --- PerformanceTab props ---

  it("passes udise_code to PerformanceTab", async () => {
    setupAdminDefaults({ udise_code: "24120100101" });

    await renderPage();

    expect(screen.getByTestId("performance-tab")).toHaveAttribute(
      "data-school-udise",
      "24120100101"
    );
  });

  it("passes school code to PerformanceTab when udise_code is null", async () => {
    setupAdminDefaults({ udise_code: null, code: "70705" });

    await renderPage();

    expect(screen.getByTestId("performance-tab")).toHaveAttribute(
      "data-school-udise",
      "70705"
    );
  });

  // --- QuizSessionsTab props ---

  it("passes school id to QuizSessionsTab", async () => {
    setupAdminDefaults({ id: "school-42" });

    await renderPage();

    expect(screen.getByTestId("quiz-sessions-tab")).toHaveAttribute(
      "data-school-id",
      "school-42"
    );
    expect(screen.getByTestId("quiz-sessions-tab")).toHaveAttribute(
      "data-can-edit",
      "true"
    );
  });

  it("passes view-only access to QuizSessionsTab", async () => {
    setupAdminDefaults({ id: "school-42" });
    mockGetFeatureAccess.mockImplementation(
      (_perm: unknown, feature: string) => {
        if (feature === "quiz_sessions") return featureAccess(true, false);
        return featureAccess(true, true);
      }
    );

    await renderPage();

    expect(screen.getByTestId("quiz-sessions-tab")).toHaveAttribute(
      "data-school-id",
      "school-42"
    );
    expect(screen.getByTestId("quiz-sessions-tab")).toHaveAttribute(
      "data-can-edit",
      "false"
    );
  });

  it("hides QuizSessionsTab when quiz session access is none", async () => {
    setupAdminDefaults();
    mockGetFeatureAccess.mockImplementation(
      (_perm: unknown, feature: string) => {
        if (feature === "quiz_sessions") return featureAccess(false, false);
        return featureAccess(true, true);
      }
    );

    await renderPage();

    expect(screen.queryByTestId("tab-quiz_sessions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quiz-sessions-tab")).not.toBeInTheDocument();
  });

  // --- VisitsTab props ---

  it("passes school code to VisitsTab", async () => {
    setupAdminDefaults();

    await renderPage();

    expect(screen.getByTestId("visits-tab")).toHaveAttribute(
      "data-school-code",
      "70705"
    );
  });

  // --- Student data ---

  it("renders selected-program student stats with grade breakdown", async () => {
    const students = [
      makeStudent({ group_user_id: "gu-1", user_id: "u-1", grade: 11, program_id: 64, status: "active" }),
      makeStudent({ group_user_id: "gu-2", user_id: "u-2", grade: 11, program_id: 64, status: "active" }),
      makeStudent({ group_user_id: "gu-3", user_id: "u-3", grade: 12, program_id: 64, status: "active" }),
    ];

    setupAdminDefaults();
    mockProcessStudents.mockResolvedValue({ students, issues: [] });

    await renderPage();

    // Only NVS has students; its card is selected by default.
    expect(screen.getByText("JNV NVS Students")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("3");
    // Grade pills (scoped to the stats card — the admission card also lists grades)
    const statsCard = screen.getByTestId("enrollment-stats-header")
      .parentElement as HTMLElement;
    expect(within(statsCard).getByText("Grade 11")).toBeInTheDocument();
    expect(within(statsCard).getByText("Grade 12")).toBeInTheDocument();
  });

  it("excludes dropout students from program counts", async () => {
    const students = [
      makeStudent({ group_user_id: "gu-1", user_id: "u-1", grade: 11, program_id: 64, status: "active" }),
      makeStudent({ group_user_id: "gu-2", user_id: "u-2", grade: 11, program_id: 64, status: "dropout" }),
    ];

    setupAdminDefaults();
    mockProcessStudents.mockResolvedValue({ students, issues: [] });

    await renderPage();

    expect(screen.getByText("JNV NVS Students")).toBeInTheDocument();
    // 1 active NVS student
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("1");
  });

  it("renders one program's stats at a time when multiple programs are present", async () => {
    const students = [
      makeStudent({ group_user_id: "gu-1", user_id: "u-1", grade: 11, program_id: 64, status: "active" }),
      makeStudent({ group_user_id: "gu-2", user_id: "u-2", grade: 11, program_id: 1, status: "active" }),
    ];

    setupAdminDefaults();
    mockProcessStudents.mockResolvedValue({ students, issues: [] });

    await renderPage();

    // CoE comes first in PROGRAM_IDS_ORDERED — its card is the default view
    // and the count excludes the NVS student.
    expect(screen.getByText("JNV CoE Students")).toBeInTheDocument();
    expect(screen.queryByText("JNV NVS Students")).not.toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("1");
    // The tab buttons for both programs are present.
    expect(screen.getByRole("button", { name: "JNV CoE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JNV NVS" })).toBeInTheDocument();

    // Switching to NVS shows the NVS count (1) — confirms cross-program exclusion.
    fireEvent.click(screen.getByRole("button", { name: "JNV NVS" }));
    expect(screen.getByText("JNV NVS Students")).toBeInTheDocument();
    expect(screen.queryByText("JNV CoE Students")).not.toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("1");
  });

  it("handles students with null grade in program counts", async () => {
    const students = [
      makeStudent({ group_user_id: "gu-1", user_id: "u-1", grade: null, program_id: 64, status: "active" }),
      makeStudent({ group_user_id: "gu-2", user_id: "u-2", grade: 11, program_id: 64, status: "active" }),
    ];

    setupAdminDefaults();
    mockProcessStudents.mockResolvedValue({ students, issues: [] });

    await renderPage();

    // Total counts both NVS students; grade pill only appears for grade 11.
    expect(screen.getByText("JNV NVS Students")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("2");
    const statsCard = screen.getByTestId("enrollment-stats-header")
      .parentElement as HTMLElement;
    expect(within(statsCard).getByText("Grade 11")).toBeInTheDocument();
    expect(within(statsCard).queryByText("Grade null")).not.toBeInTheDocument();
  });

  // --- StudentTable props ---

  it("passes correct props to StudentTable", async () => {
    const activeStudent = makeStudent({ status: "active" });
    const dropoutStudent = makeStudent({
      group_user_id: "gu-d",
      user_id: "u-d",
      status: "dropout",
    });

    setupAdminDefaults();
    mockProcessStudents.mockResolvedValue({
      students: [activeStudent, dropoutStudent],
      issues: [],
    });

    const permission = makePermission({ program_ids: [1, 64], role: "admin" });
    mockGetUserPermission.mockResolvedValue(permission);
    mockGetFeatureAccess.mockImplementation(
      (_perm: unknown, feature: string) => {
        if (feature === "students") return featureAccess(true, true);
        return featureAccess(true, true);
      }
    );

    await renderPage();

    const table = screen.getByTestId("student-table");
    const props = JSON.parse(table.getAttribute("data-props") || "{}");
    expect(props.students).toHaveLength(1); // only active
    expect(props.students[0].status).toBe("active");
    expect(props.dropoutStudents).toHaveLength(1);
    expect(props.dropoutStudents[0].status).toBe("dropout");
    expect(props.canEdit).toBe(true);
    expect(props.isAdmin).toBe(true);
    expect(props.isPasscodeUser).toBe(false);
  });

  it("passes effective program-context ids as userProgramIds to StudentTable", async () => {
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({ program_ids: [1, 2, 64] })
    );
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [1, 2, 64],
      isNVSOnly: false,
      hasCoEOrNodal: true,
    });

    await renderPage();

    const table = screen.getByTestId("student-table");
    const props = JSON.parse(table.getAttribute("data-props") || "{}");
    expect(props.userProgramIds).toEqual([1, 2, 64]);
  });

  it("passes seat-derived programs as userProgramIds when explicit program_ids is empty", async () => {
    // The seated-teacher case (pritamps@): explicit program_ids empty, but the
    // resolved program context includes the seat's program — that effective set
    // must reach StudentTable so the seated user can see/edit those students.
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({ role: "teacher", program_ids: [] })
    );
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [2], // derived purely from the centre seat
      isNVSOnly: false,
      hasCoEOrNodal: true,
    });

    await renderPage();

    const table = screen.getByTestId("student-table");
    const props = JSON.parse(table.getAttribute("data-props") || "{}");
    expect(props.userProgramIds).toEqual([2]);
  });

  it("passes null userProgramIds for passcode user", async () => {
    const school = makeSchool({ code: "70705" });
    mockGetServerSession.mockResolvedValue(passcodeSession("70705"));
    mockQuery
      .mockResolvedValueOnce([school])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [],
      isNVSOnly: false,
      hasCoEOrNodal: false,
    });
    mockGetFeatureAccess.mockReturnValue(featureAccess(true, true));
    mockProcessStudents.mockResolvedValue({ students: [], issues: [] });

    await renderPage();

    const table = screen.getByTestId("student-table");
    const props = JSON.parse(table.getAttribute("data-props") || "{}");
    expect(props.userProgramIds).toBeNull();
    expect(props.isPasscodeUser).toBe(true);
    expect(props.isAdmin).toBe(false);
  });

  // --- Data issues banner ---

  it("renders data issues banner when issues exist", async () => {
    setupAdminDefaults();
    mockProcessStudents.mockResolvedValue({
      students: [],
      issues: [
        {
          type: "duplicate_grade",
          studentName: "Aarav Sharma",
          groupUserId: "gu-1",
          details: "Enrolled in grade 11 twice",
        },
        {
          type: "multiple_schools",
          studentName: "Priya Singh",
          groupUserId: "gu-2",
          details: "Found in 2 schools",
        },
      ],
    });

    await renderPage();

    expect(screen.getByText(/2 data issues found/)).toBeInTheDocument();
    expect(screen.getByText(/Aarav Sharma/)).toBeInTheDocument();
    expect(screen.getByText(/Enrolled in grade 11 twice/)).toBeInTheDocument();
    expect(screen.getByText(/Priya Singh/)).toBeInTheDocument();
    expect(screen.getByText(/Found in 2 schools/)).toBeInTheDocument();
  });

  it("shows singular 'issue' text for single data issue", async () => {
    setupAdminDefaults();
    mockProcessStudents.mockResolvedValue({
      students: [],
      issues: [
        {
          type: "duplicate_grade",
          studentName: "Test Student",
          groupUserId: "gu-1",
          details: "Some issue",
        },
      ],
    });

    await renderPage();

    expect(screen.getByText(/1 data issue found/)).toBeInTheDocument();
  });

  it("does not render data issues banner when no issues", async () => {
    setupAdminDefaults();

    await renderPage();

    expect(screen.queryByText(/data issue/)).not.toBeInTheDocument();
  });

  // --- NVS streams from batches ---

  it("passes distinct NVS streams to StudentTable", async () => {
    setupAdminDefaults();
    // getBatchesWithMetadata returns batches with metadata
    mockQuery
      .mockReset()
      .mockResolvedValueOnce([makeSchool()]) // getSchoolByCode
      .mockResolvedValueOnce([]) // getStudents
      .mockResolvedValueOnce([]) // getGrades
      .mockResolvedValueOnce([
        {
          id: 1,
          name: "Batch A",
          batch_id: "b-1",
          program_id: 64,
          metadata: { stream: "Science", grade: 11 },
          group_id: "g-1",
        },
        {
          id: 2,
          name: "Batch B",
          batch_id: "b-2",
          program_id: 64,
          metadata: { stream: "Humanities", grade: 11 },
          group_id: "g-2",
        },
        {
          id: 3,
          name: "Batch C",
          batch_id: "b-3",
          program_id: 64,
          metadata: { stream: "Science", grade: 12 },
          group_id: "g-3",
        },
      ]);

    await renderPage();

    const table = screen.getByTestId("student-table");
    const props = JSON.parse(table.getAttribute("data-props") || "{}");
    expect(props.nvsStreams).toEqual(["Humanities", "Science"]); // sorted
  });

  it("handles batches with null metadata stream", async () => {
    setupAdminDefaults();
    mockQuery
      .mockReset()
      .mockResolvedValueOnce([makeSchool()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 1,
          name: "Batch A",
          batch_id: "b-1",
          program_id: 64,
          metadata: { grade: 11 },
          group_id: "g-1",
        },
        {
          id: 2,
          name: "Batch B",
          batch_id: "b-2",
          program_id: 64,
          metadata: null,
          group_id: "g-2",
        },
      ]);

    await renderPage();

    const table = screen.getByTestId("student-table");
    const props = JSON.parse(table.getAttribute("data-props") || "{}");
    expect(props.nvsStreams).toEqual([]); // no stream defined
  });

  // --- hasMultipleSchools edge cases ---

  it("sets hasMultipleSchools=true for level 2 user", async () => {
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({ level: 2, role: "program_manager", regions: ["West"] })
    );

    await renderPage();

    const header = screen.getByTestId("page-header");
    expect(header).toHaveAttribute("data-back-href", "/dashboard");
  });

  it("sets hasMultipleSchools based on school_codes !== null condition", async () => {
    // Level 1, school_codes includes the school code (so access is granted)
    // but only 1 school code (so hasMultipleSchools = false based on length)
    // hasMultipleSchools = level >= 2 || (school_codes !== null && (school_codes?.length ?? 0) > 1)
    // For level 1, single code: false || (true && false) = false
    setupAdminDefaults();
    mockGetUserPermission.mockResolvedValue(
      makePermission({ level: 1, role: "teacher", school_codes: ["70705"] })
    );

    await renderPage();

    const header = screen.getByTestId("page-header");
    expect(header).toHaveAttribute("data-back-href", "");
  });

  // --- Query verification ---

  it("queries school by udise_code parameter", async () => {
    setupAdminDefaults();

    await renderPage("12345678901");

    // First query is getSchoolByCode
    const firstCall = mockQuery.mock.calls[0];
    expect(firstCall[0]).toContain("s.udise_code = $1 OR s.code = $1");
    // Visible schools = JNV OR linked to an active centre (centre rollout).
    expect(firstCall[0]).toContain("af_school_category = 'JNV'");
    expect(firstCall[0]).toContain("FROM centres c WHERE c.school_id = s.id AND c.is_active");
    expect(firstCall[1]).toEqual(["12345678901"]);
  });

  it("queries students with school id", async () => {
    setupAdminDefaults({ id: "school-42" });

    await renderPage();

    // Second query call is getStudents (after getSchoolByCode, but parallel with getGrades + getBatches)
    // getStudents query contains school id
    const studentQuery = mockQuery.mock.calls.find(
      (call: string[]) =>
        typeof call[0] === "string" && call[0].includes("group_user gu")
    );
    expect(studentQuery).toBeDefined();
    expect(studentQuery![1]).toEqual(["school-42", "2026-2027"]);
  });

  it("queries batches with PROGRAM_IDS.NVS", async () => {
    setupAdminDefaults();

    await renderPage();

    const batchQuery = mockQuery.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any[]) =>
        typeof call[0] === "string" && call[0].includes("FROM batch b")
    );
    expect(batchQuery).toBeDefined();
    expect(batchQuery![1]).toEqual([64]); // PROGRAM_IDS.NVS
  });

  // --- Mentorship tab content ---

  it("renders mentorship tab with coming soon message", async () => {
    setupAdminDefaults();

    await renderPage();

    expect(screen.getByTestId("tab-mentorship")).toBeInTheDocument();
    expect(
      screen.getByText("Mentorship data coming soon.")
    ).toBeInTheDocument();
  });

  // --- level 2 region check with null school region ---

  it("denies access for level 2 user when school region is null", async () => {
    mockGetServerSession.mockResolvedValue(googleSession());
    mockQuery.mockResolvedValueOnce([makeSchool({ region: null })]);
    mockGetUserPermission.mockResolvedValue(
      makePermission({ level: 2, role: "program_manager", regions: ["West"] })
    );

    const jsx = await SchoolPage({
      params: Promise.resolve({ udise: "24120100101" }),
    });
    render(jsx);

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  // --- Passcode user skips program context check ---

  it("does not show no-program-access for passcode user even with hasAccess=false", async () => {
    const school = makeSchool({ code: "70705" });
    mockGetServerSession.mockResolvedValue(passcodeSession("70705"));
    mockQuery
      .mockResolvedValueOnce([school])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: false,
      programIds: [],
      isNVSOnly: false,
      hasCoEOrNodal: false,
    });
    mockGetFeatureAccess.mockReturnValue(featureAccess(true, true));
    mockProcessStudents.mockResolvedValue({ students: [], issues: [] });

    const jsx = await SchoolPage({
      params: Promise.resolve({ udise: "24120100101" }),
    });
    render(jsx);

    // Passcode user should NOT see the "No Program Access" message
    // because the check is gated by `!isPasscodeUser`
    expect(screen.queryByText("No Program Access")).not.toBeInTheDocument();
    expect(screen.getByTestId("page-header")).toBeInTheDocument();
  });

  // --- Empty students ---

  it("renders with empty student list", async () => {
    setupAdminDefaults();

    await renderPage();

    // No students → no programs visible → no program cards rendered.
    expect(screen.queryByText("JNV CoE Students")).not.toBeInTheDocument();
    expect(screen.queryByText("JNV Nodal Students")).not.toBeInTheDocument();
    expect(screen.queryByText("JNV NVS Students")).not.toBeInTheDocument();

    expect(screen.getByTestId("student-table")).toBeInTheDocument();
    const table = screen.getByTestId("student-table");
    const props = JSON.parse(table.getAttribute("data-props") || "{}");
    expect(props.students).toHaveLength(0);
    expect(props.dropoutStudents).toHaveLength(0);
  });
});
