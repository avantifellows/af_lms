import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetFeatureAccess,
  mockGetProgramContextSync,
  mockGetCurriculumSummary,
  mockNormalizeFilters,
  mockNormalizeSort,
  mockNormalizePage,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockGetProgramContextSync: vi.fn(),
  mockGetCurriculumSummary: vi.fn(),
  mockNormalizeFilters: vi.fn(),
  mockNormalizeSort: vi.fn(),
  mockNormalizePage: vi.fn(),
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
  getProgramContextSync: mockGetProgramContextSync,
}));
vi.mock("@/lib/curriculum-summary", () => ({
  getCurriculumSummary: mockGetCurriculumSummary,
  normalizeCurriculumSummarySearchParams: mockNormalizeFilters,
  normalizeCurriculumSummarySort: mockNormalizeSort,
  normalizeCurriculumSummaryPage: mockNormalizePage,
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import CurriculumSummaryPage from "./page";

const defaultSearchParams = Promise.resolve({});
const pmSession = { user: { email: "pm@avantifellows.org" } };
const pmPermission = {
  email: "pm@avantifellows.org",
  level: 3,
  role: "program_manager",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
};
const teacherPermission = {
  ...pmPermission,
  email: "teacher@avantifellows.org",
  role: "teacher",
};
const defaultFilters = {
  schools: [],
  programs: [],
  grades: [],
  subjects: [],
  examTracks: [],
  regions: [],
  states: [],
  districts: [],
  preset: "current_academic_year",
  from: "2026-04-01",
  to: "2026-05-30",
  flagged: false,
  forceEmpty: false,
};
const emptySummaryResult = {
  ok: true,
  activeFilters: defaultFilters,
  filterOptions: {
    schools: [],
    programs: [],
    grades: [],
    subjects: [],
    examTracks: [],
    regions: [],
    states: [],
    districts: [],
  },
  rows: [],
  stats: {
    totalRows: 0,
    flaggedRows: 0,
    avgCompletionPercent: null,
    avgPrescribedPercent: null,
    actualMinutes: 0,
    prescribedMinutes: 0,
  },
  totalRowCount: 0,
  currentPage: 1,
  totalPages: 0,
  sort: "school",
  dir: "asc",
};
const coeNodalProgramContext = {
  hasAccess: true,
  programIds: [1, 2],
  isNVSOnly: false,
  hasCoEOrNodal: true,
};

describe("CurriculumSummaryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
    mockNormalizeFilters.mockReturnValue(defaultFilters);
    mockNormalizeSort.mockReturnValue({ sort: "school", dir: "asc" });
    mockNormalizePage.mockReturnValue(1);
    mockGetCurriculumSummary.mockResolvedValue(emptySummaryResult);
  });

  it("redirects unauthenticated users to /", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(
      CurriculumSummaryPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects passcode users to their school page", async () => {
    mockGetServerSession.mockResolvedValue({
      user: {},
      isPasscodeUser: true,
      schoolCode: "70705",
    });

    await expect(
      CurriculumSummaryPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/school/70705");
    expect(mockRedirect).toHaveBeenCalledWith("/school/70705");
  });

  it("redirects Google users without permissions to /dashboard", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(null);

    await expect(
      CurriculumSummaryPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects users without Curriculum access to /dashboard", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "none",
      canView: false,
      canEdit: false,
    });

    await expect(
      CurriculumSummaryPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects teachers even when they have Curriculum access", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "teacher@avantifellows.org" },
    });
    mockGetUserPermission.mockResolvedValue(teacherPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });

    await expect(
      CurriculumSummaryPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects NVS-only users even when the role is otherwise eligible", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue({
      ...pmPermission,
      program_ids: [64],
    });
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [64],
      isNVSOnly: true,
      hasCoEOrNodal: false,
    });

    await expect(
      CurriculumSummaryPage({ searchParams: defaultSearchParams })
    ).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders schema-unavailable status and details for eligible users", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetProgramContextSync.mockReturnValue(coeNodalProgramContext);
    mockGetCurriculumSummary.mockResolvedValue({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: [
        "lms_curriculum_logs.log_date",
        "lms_curriculum_logs.deleted_at",
      ],
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    expect(
      screen.getByRole("heading", { name: "LMS curriculum schema unavailable" })
    ).toBeInTheDocument();
    expect(screen.getByText("lms_curriculum_logs.log_date")).toBeInTheDocument();
    expect(screen.getByText("lms_curriculum_logs.deleted_at")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["program_manager", "program_admin", "admin"])(
    "renders the read-only shell for eligible %s users",
    async (role) => {
      mockGetServerSession.mockResolvedValue(pmSession);
      mockGetUserPermission.mockResolvedValue({
        ...pmPermission,
        role,
      });
      mockGetFeatureAccess.mockReturnValue({
        access: "view",
        canView: true,
        canEdit: false,
      });
      mockGetProgramContextSync.mockReturnValue(coeNodalProgramContext);
      mockGetCurriculumSummary.mockResolvedValue(emptySummaryResult);

      const jsx = await CurriculumSummaryPage({
        searchParams: defaultSearchParams,
      });
      render(jsx);

      expect(
        screen.getByRole("heading", { level: 1, name: "Curriculum Summary" })
      ).toBeInTheDocument();
      expect(screen.getByText("Read only")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Apply filters" })
      ).toBeInTheDocument();
    }
  );

  it("renders expected Curriculum Summary row grain from the helper result", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetProgramContextSync.mockReturnValue(coeNodalProgramContext);
    mockGetCurriculumSummary.mockResolvedValue({
      ...emptySummaryResult,
      filterOptions: {
        ...emptySummaryResult.filterOptions,
        schools: [{ code: "70705", name: "JNV Bhavnagar" }],
        programs: [{ id: 1, name: "JNV CoE" }],
        grades: [11],
        subjects: [{ id: 4, name: "Physics" }],
        examTracks: ["jee_main"],
      },
      rows: [
        {
          rowKey: "70705:1:11:4:jee_main",
          schoolCode: "70705",
          schoolName: "JNV Bhavnagar",
          region: "West",
          state: "Gujarat",
          district: "Bhavnagar",
          programId: 1,
          programName: "JNV CoE",
          grade: 11,
          subjectId: 4,
          subjectName: "Physics",
          examTrack: "jee_main",
          completedChapters: 1,
          totalConfiguredChapters: 2,
          prescribedChapters: 2,
          actualMinutes: 90,
          prescribedMinutes: 210,
          deltaPercent: -57.14285714285714,
          flagged: true,
          flagReasons: ["under_prescribed_hours", "completion_below_prescribed_coverage"],
        },
      ],
      stats: {
        totalRows: 2,
        flaggedRows: 1,
        avgCompletionPercent: 33.33333333333333,
        avgPrescribedPercent: 83.33333333333334,
        actualMinutes: 90,
        prescribedMinutes: 360,
      },
      totalRowCount: 1,
      totalPages: 1,
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: Promise.resolve({ schools: "70705" }),
    });
    render(jsx);

    expect(screen.getByText("Current academic year: 2026-04-01 to 2026-05-30")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Exam Track" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "JNV Bhavnagar 70705" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "JNV CoE" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "11" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Physics" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "JEE Main" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1/2 (50%)" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2/2 (100%)" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "-57.1%" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1h 30m / 3h 30m" })).toBeInTheDocument();
    expect(screen.getByText("Under prescribed hours")).toBeInTheDocument();
    expect(screen.getByText("Completion below prescribed coverage")).toBeInTheDocument();
    expect(
      screen.getByText(/Top-level Actual Hours use raw LMS Curriculum Log duration/)
    ).toBeInTheDocument();
    expect(screen.getByText("Total Rows")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Flagged Rows")).toBeInTheDocument();
    expect(screen.getByText("33.3%")).toBeInTheDocument();
    expect(screen.getByText("83.3%")).toBeInTheDocument();
  });

  it("renders sortable headers that preserve filters and reset pagination", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetProgramContextSync.mockReturnValue(coeNodalProgramContext);
    mockNormalizeSort.mockReturnValue({ sort: "school", dir: "asc" });
    mockGetCurriculumSummary.mockResolvedValue({
      ...emptySummaryResult,
      rows: [
        {
          rowKey: "70705:1:11:4:jee_main",
          schoolCode: "70705",
          schoolName: "JNV Bhavnagar",
          region: "West",
          state: "Gujarat",
          district: "Bhavnagar",
          programId: 1,
          programName: "JNV CoE",
          grade: 11,
          subjectId: 4,
          subjectName: "Physics",
          examTrack: "jee_main",
          completedChapters: 1,
          totalConfiguredChapters: 2,
          prescribedChapters: 2,
          actualMinutes: 90,
          prescribedMinutes: 210,
          deltaPercent: -57.14285714285714,
          flagged: true,
          flagReasons: ["under_prescribed_hours"],
        },
      ],
      totalRowCount: 1,
      totalPages: 1,
      sort: "school",
      dir: "asc",
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: Promise.resolve({
        schools: "70705",
        flagged: "true",
        sort: "school",
        dir: "asc",
        page: "3",
      }),
    });
    render(jsx);

    expect(screen.getByRole("link", { name: "School ↑" })).toHaveAttribute(
      "href",
      "/curriculum-summary?schools=70705&flagged=true&sort=school&dir=desc"
    );
    expect(screen.getByRole("link", { name: "Delta %" })).toHaveAttribute(
      "href",
      "/curriculum-summary?schools=70705&flagged=true&sort=delta&dir=asc"
    );
    expect(screen.getByRole("link", { name: "Flagged" })).toHaveAttribute(
      "href",
      "/curriculum-summary?schools=70705&flagged=true&sort=flagged&dir=desc"
    );
  });

  it("renders pagination links that preserve active filters and sorting", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetProgramContextSync.mockReturnValue(coeNodalProgramContext);
    mockNormalizeSort.mockReturnValue({ sort: "delta", dir: "asc" });
    mockGetCurriculumSummary.mockResolvedValue({
      ...emptySummaryResult,
      rows: [
        {
          rowKey: "70705:1:11:4:jee_main",
          schoolCode: "70705",
          schoolName: "JNV Bhavnagar",
          region: "West",
          state: "Gujarat",
          district: "Bhavnagar",
          programId: 1,
          programName: "JNV CoE",
          grade: 11,
          subjectId: 4,
          subjectName: "Physics",
          examTrack: "jee_main",
          completedChapters: 1,
          totalConfiguredChapters: 2,
          prescribedChapters: 2,
          actualMinutes: 90,
          prescribedMinutes: 210,
          deltaPercent: -57.14285714285714,
          flagged: true,
          flagReasons: ["under_prescribed_hours"],
        },
      ],
      totalRowCount: 30,
      currentPage: 2,
      totalPages: 3,
      sort: "delta",
      dir: "asc",
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: Promise.resolve({
        schools: "70705",
        sort: "delta",
        dir: "asc",
        page: "2",
      }),
    });
    render(jsx);

    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/curriculum-summary?schools=70705&sort=delta&dir=asc&page=1"
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/curriculum-summary?schools=70705&sort=delta&dir=asc&page=3"
    );
  });

  it("renders a narrow-filters state when the row-count guard trips", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetProgramContextSync.mockReturnValue(coeNodalProgramContext);
    mockGetCurriculumSummary.mockResolvedValue({
      ...emptySummaryResult,
      rowCountGuardTripped: true,
      estimatedRowCount: 10001,
      rows: [],
      totalRowCount: 0,
      totalPages: 0,
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    expect(
      screen.getByText("Narrow filters to load Curriculum Summary")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/More than 10,000 expected Curriculum Summary rows/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No Curriculum Summary rows match the selected filters.")
    ).not.toBeInTheDocument();
  });

  it("renders the dense filters inside a disclosure control", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetProgramContextSync.mockReturnValue(coeNodalProgramContext);
    mockGetCurriculumSummary.mockResolvedValue(emptySummaryResult);

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByLabelText("Schools")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply filters" })
    ).toBeInTheDocument();
  });
});
