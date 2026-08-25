import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
  useRouter: () => ({ refresh: mockRouterRefresh }),
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
vi.mock("@/lib/dashboard-groupings", () => ({
  getCentreWithSchool: mockGetCentreWithSchool,
}));
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

// Child components are stubs — this suite is about which tabs RosterPage builds
// for a centre scope, not how each tab renders.
vi.mock("@/components/PageHeader", () => ({
  __esModule: true,
  default: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div data-testid="page-header" data-title={title} data-subtitle={subtitle || ""}>
      PageHeader
    </div>
  ),
}));
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
  default: () => <div data-testid="enrollment-tab-content">EnrollmentTabContent</div>,
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
    isPasscodeUser: false,
    schoolCode: undefined,
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
