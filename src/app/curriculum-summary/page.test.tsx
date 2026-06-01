import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  mockNormalizePageSize,
  mockRedirect,
  mockRouterPush,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockGetProgramContextSync: vi.fn(),
  mockGetCurriculumSummary: vi.fn(),
  mockNormalizeFilters: vi.fn(),
  mockNormalizeSort: vi.fn(),
  mockNormalizePage: vi.fn(),
  mockNormalizePageSize: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockRouterPush: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: mockRouterPush }),
}));
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
  normalizeCurriculumSummaryPageSize: mockNormalizePageSize,
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
  chapterRowsByParentKey: {},
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
    mockNormalizePageSize.mockReturnValue(20);
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
      expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue(
        "20"
      );
      expect(mockGetCurriculumSummary).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 20 })
      );
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
    expect(screen.getByText("JNV Bhavnagar")).toBeInTheDocument();
    expect(screen.getByText("70705")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "JNV CoE" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "11" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Physics" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "JEE Main" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1/2 (50%)" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2/2 (100%)" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "-57.1%" })).toBeInTheDocument();
    expect(screen.getByText("1h 30m / 3h 30m")).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "42.9%" })
    ).toHaveAttribute("aria-valuetext", "42.9%");
    expect(
      screen.getByRole("img", { name: "Time flag: Under prescribed hours" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Coverage flag: Completion below prescribed coverage",
      })
    ).toBeInTheDocument();
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

  it("keeps chapter expansion collapsed by default and expands it on demand", async () => {
    const user = userEvent.setup();
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
          prescribedChapters: 1,
          actualMinutes: 120,
          prescribedMinutes: 90,
          deltaPercent: 33.33333333333333,
          flagged: true,
          flagReasons: ["over_prescribed_hours"],
        },
      ],
      chapterRowsByParentKey: {
        "70705:1:11:4:jee_main": [
          {
            parentRowKey: "70705:1:11:4:jee_main",
            chapterId: 44,
            chapterCode: "11P1",
            chapterName: "Kinematics",
            coverageSequence: 1,
            completedCount: 1,
            prescribedCount: 1,
            actualMinutes: 95,
            prescribedMinutes: 90,
            deltaPercent: 5.555555555555555,
            flagged: false,
            flagReasons: [],
          },
          {
            parentRowKey: "70705:1:11:4:jee_main",
            chapterId: 45,
            chapterCode: "11P2",
            chapterName: "Vectors",
            coverageSequence: 2,
            completedCount: 0,
            prescribedCount: 0,
            actualMinutes: 25,
            prescribedMinutes: 0,
            deltaPercent: null,
            flagged: true,
            flagReasons: ["actual_time_on_zero_prescribed_minutes"],
          },
        ],
      },
      totalRowCount: 1,
      totalPages: 1,
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    expect(
      screen.getByRole("button", {
        name: "Show chapters for JNV Bhavnagar 70705 JNV CoE Grade 11 Physics JEE Main",
      })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Chapter expansion")).not.toBeInTheDocument();
    expect(screen.queryByText("Kinematics")).not.toBeInTheDocument();
    expect(screen.queryByText("Vectors")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Show chapters for JNV Bhavnagar 70705 JNV CoE Grade 11 Physics JEE Main",
      })
    );

    expect(
      screen.getByRole("button", {
        name: "Hide chapters for JNV Bhavnagar 70705 JNV CoE Grade 11 Physics JEE Main",
      })
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Chapter expansion")).toBeInTheDocument();
    expect(
      screen.getByText(/Chapter Actual Hours use allocated rounded minutes/)
    ).toBeInTheDocument();
    expect(screen.getByText("Kinematics")).toBeInTheDocument();
    expect(screen.getByText("11P1")).toBeInTheDocument();
    expect(screen.getByText("Vectors")).toBeInTheDocument();
    expect(screen.getByText("11P2")).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "1/1" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("cell", { name: "0/1" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("25m / 0h")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "—",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Time flag: Actual time on zero prescribed minutes",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Actual time on zero prescribed minutes")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save|edit|delete/i })).not.toBeInTheDocument();
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

  it("lets users change rows per page while preserving filters and resetting pagination", async () => {
    const user = userEvent.setup();
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetUserPermission.mockResolvedValue(pmPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetProgramContextSync.mockReturnValue(coeNodalProgramContext);
    mockNormalizePageSize.mockReturnValue(50);
    mockGetCurriculumSummary.mockResolvedValue({
      ...emptySummaryResult,
      totalRowCount: 125,
      currentPage: 3,
      totalPages: 3,
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: Promise.resolve({
        schools: "70705",
        sort: "delta",
        dir: "asc",
        page: "3",
        limit: "50",
      }),
    });
    render(jsx);

    expect(mockNormalizePageSize).toHaveBeenCalledWith("50");
    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50 })
    );

    const pageSizeSelect = screen.getByRole("combobox", {
      name: "Rows per page",
    });
    expect(pageSizeSelect).toHaveValue("50");

    await user.selectOptions(pageSizeSelect, "20");

    expect(mockRouterPush).toHaveBeenCalledWith(
      "/curriculum-summary?schools=70705&sort=delta&dir=asc"
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
    expect(screen.getByLabelText("Programs")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply filters" })
    ).toBeInTheDocument();
  });

  it("renders preselected schools from URL filters as removable chips", async () => {
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
      activeFilters: {
        ...defaultFilters,
        schools: ["70705"],
      },
      filterOptions: {
        ...emptySummaryResult.filterOptions,
        schools: [
          {
            code: "70705",
            name: "JNV Bhavnagar",
            region: "West",
            state: "Gujarat",
            district: "Bhavnagar",
          },
        ],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: Promise.resolve({ schools: "70705" }),
    });
    render(jsx);

    expect(screen.getByText("JNV Bhavnagar (70705)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove JNV Bhavnagar (70705)" })
    ).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="schools"]')?.value).toBe(
      "70705"
    );
  });

  it("lets users search schools by name or code and keeps the schools query value comma-separated", async () => {
    const user = userEvent.setup();
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
        schools: [
          {
            code: "70705",
            name: "JNV Bhavnagar",
            region: "West",
            state: "Gujarat",
            district: "Bhavnagar",
          },
          {
            code: "64037",
            name: "JNV Agra",
            region: "North",
            state: "Uttar Pradesh",
            district: "Agra",
          },
        ],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    const input = screen.getByRole("combobox", { name: "Schools" });
    await user.type(input, "agra");

    expect(screen.getByRole("option", { name: "JNV Agra (64037)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /JNV Bhavnagar/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "JNV Agra (64037)" }));
    expect(document.querySelector<HTMLInputElement>('input[name="schools"]')?.value).toBe(
      "64037"
    );

    await user.type(input, "70705");
    await user.click(screen.getByRole("option", { name: "JNV Bhavnagar (70705)" }));

    expect(screen.getByText("JNV Agra (64037)")).toBeInTheDocument();
    expect(screen.getByText("JNV Bhavnagar (70705)")).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="schools"]')?.value).toBe(
      "64037,70705"
    );
  });

  it("lets users search programs by name or id and keeps the programs query value comma-separated", async () => {
    const user = userEvent.setup();
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
      activeFilters: {
        ...defaultFilters,
        programs: [1],
      },
      filterOptions: {
        ...emptySummaryResult.filterOptions,
        programs: [
          { id: 1, name: "JNV CoE" },
          { id: 2, name: "JNV Nodal" },
        ],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: Promise.resolve({ programs: "1" }),
    });
    render(jsx);

    expect(screen.getByText("JNV CoE (1)")).toBeInTheDocument();

    const input = screen.getByRole("combobox", { name: "Programs" });
    await user.type(input, "nodal");

    expect(screen.getByRole("option", { name: "JNV Nodal (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /JNV CoE/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "JNV Nodal (2)" }));

    expect(screen.getByText("JNV CoE (1)")).toBeInTheDocument();
    expect(screen.getByText("JNV Nodal (2)")).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="programs"]')?.value).toBe(
      "1,2"
    );
  });

  it("lets users search grades, subjects, and exam tracks as multi-select filters", async () => {
    const user = userEvent.setup();
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
        grades: [11, 12],
        subjects: [
          { id: 4, name: "Physics" },
          { id: 5, name: "Chemistry" },
        ],
        examTracks: ["jee_main", "jee_advanced", "neet"],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    await user.type(screen.getByRole("combobox", { name: "Grades" }), "12");
    await user.click(screen.getByRole("option", { name: "Grade 12" }));
    expect(document.querySelector<HTMLInputElement>('input[name="grades"]')?.value).toBe(
      "12"
    );

    await user.type(screen.getByRole("combobox", { name: "Subjects" }), "chem");
    await user.click(screen.getByRole("option", { name: "Chemistry (5)" }));
    expect(document.querySelector<HTMLInputElement>('input[name="subjects"]')?.value).toBe(
      "5"
    );

    await user.type(screen.getByRole("combobox", { name: "Exam Track" }), "advanced");
    await user.click(screen.getByRole("option", { name: "JEE Advanced" }));
    expect(
      document.querySelector<HTMLInputElement>('input[name="exam_tracks"]')?.value
    ).toBe("jee_advanced");
  });

  it("lets users search geography filters when no schools are selected", async () => {
    const user = userEvent.setup();
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
        regions: ["Bhopal", "Jaipur"],
        states: ["Gujarat", "Uttar Pradesh"],
        districts: ["Agra", "Bhavnagar"],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    await user.type(screen.getByRole("combobox", { name: "Regions" }), "jai");
    await user.click(screen.getByRole("option", { name: "Jaipur" }));
    expect(document.querySelector<HTMLInputElement>('input[name="regions"]')?.value).toBe(
      "Jaipur"
    );

    await user.type(screen.getByRole("combobox", { name: "States" }), "uttar");
    await user.click(screen.getByRole("option", { name: "Uttar Pradesh" }));
    expect(document.querySelector<HTMLInputElement>('input[name="states"]')?.value).toBe(
      "Uttar Pradesh"
    );

    await user.type(screen.getByRole("combobox", { name: "Districts" }), "agra");
    await user.click(screen.getByRole("option", { name: "Agra" }));
    expect(document.querySelector<HTMLInputElement>('input[name="districts"]')?.value).toBe(
      "Agra"
    );
  });

  it("derives read-only geography filters from selected schools", async () => {
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
      activeFilters: {
        ...defaultFilters,
        schools: ["70705", "64037"],
      },
      filterOptions: {
        ...emptySummaryResult.filterOptions,
        schools: [
          {
            code: "70705",
            name: "JNV Bhavnagar",
            region: "West",
            state: "Gujarat",
            district: "Bhavnagar",
          },
          {
            code: "64037",
            name: "JNV Agra",
            region: "North",
            state: "Uttar Pradesh",
            district: "Agra",
          },
        ],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: Promise.resolve({ schools: "70705,64037" }),
    });
    render(jsx);

    expect(screen.getByText("West")).toBeInTheDocument();
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("Gujarat")).toBeInTheDocument();
    expect(screen.getByText("Uttar Pradesh")).toBeInTheDocument();
    expect(screen.getByText("Bhavnagar")).toBeInTheDocument();
    expect(screen.getByText("Agra")).toBeInTheDocument();
    expect(screen.getAllByText("Derived from selected schools")).toHaveLength(3);
    expect(screen.queryByRole("combobox", { name: "Regions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "States" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Districts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove West/ })).not.toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="regions"]')?.value).toBe(
      "North,West"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="states"]')?.value).toBe(
      "Gujarat,Uttar Pradesh"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="districts"]')?.value).toBe(
      "Agra,Bhavnagar"
    );
  });

  it("auto-fills read-only geography filters immediately after schools are selected", async () => {
    const user = userEvent.setup();
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
        schools: [
          {
            code: "64037",
            name: "JNV Agra",
            region: "North",
            state: "Uttar Pradesh",
            district: "Agra",
          },
        ],
        regions: ["North", "West"],
        states: ["Gujarat", "Uttar Pradesh"],
        districts: ["Agra", "Bhavnagar"],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    expect(screen.getByRole("combobox", { name: "Regions" })).toBeInTheDocument();

    await user.type(screen.getByRole("combobox", { name: "Schools" }), "agra");
    await user.click(screen.getByRole("option", { name: "JNV Agra (64037)" }));

    expect(screen.queryByRole("combobox", { name: "Regions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "States" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Districts" })).not.toBeInTheDocument();
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("Uttar Pradesh")).toBeInTheDocument();
    expect(screen.getByText("Agra")).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="schools"]')?.value).toBe(
      "64037"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="regions"]')?.value).toBe(
      "North"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="states"]')?.value).toBe(
      "Uttar Pradesh"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="districts"]')?.value).toBe(
      "Agra"
    );
  });

  it("auto-selects the first program, grade, subject, and exam track when a school is selected", async () => {
    const user = userEvent.setup();
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
        schools: [
          {
            code: "64037",
            name: "JNV Agra",
            region: "North",
            state: "Uttar Pradesh",
            district: "Agra",
          },
        ],
        programs: [
          { id: 1, name: "JNV CoE" },
          { id: 2, name: "JNV Nodal" },
        ],
        grades: [11, 12],
        subjects: [
          { id: 4, name: "Physics" },
          { id: 5, name: "Chemistry" },
        ],
        examTracks: ["jee_main", "neet"],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: defaultSearchParams,
    });
    render(jsx);

    await user.type(screen.getByRole("combobox", { name: "Schools" }), "agra");
    await user.click(screen.getByRole("option", { name: "JNV Agra (64037)" }));

    expect(screen.getByText("JNV CoE (1)")).toBeInTheDocument();
    expect(screen.getByText("Grade 11")).toBeInTheDocument();
    expect(screen.getByText("Physics (4)")).toBeInTheDocument();
    expect(screen.getByText("JEE Main")).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="programs"]')?.value).toBe(
      "1"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="grades"]')?.value).toBe(
      "11"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="subjects"]')?.value).toBe(
      "4"
    );
    expect(
      document.querySelector<HTMLInputElement>('input[name="exam_tracks"]')?.value
    ).toBe("jee_main");
  });

  it("does not override existing primary filter choices when a school is selected", async () => {
    const user = userEvent.setup();
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
      activeFilters: {
        ...defaultFilters,
        programs: [2],
        grades: [12],
        subjects: [5],
        examTracks: ["neet"],
      },
      filterOptions: {
        ...emptySummaryResult.filterOptions,
        schools: [
          {
            code: "64037",
            name: "JNV Agra",
            region: "North",
            state: "Uttar Pradesh",
            district: "Agra",
          },
        ],
        programs: [
          { id: 1, name: "JNV CoE" },
          { id: 2, name: "JNV Nodal" },
        ],
        grades: [11, 12],
        subjects: [
          { id: 4, name: "Physics" },
          { id: 5, name: "Chemistry" },
        ],
        examTracks: ["jee_main", "neet"],
      },
    });

    const jsx = await CurriculumSummaryPage({
      searchParams: Promise.resolve({
        programs: "2",
        grades: "12",
        subjects: "5",
        exam_tracks: "neet",
      }),
    });
    render(jsx);

    await user.type(screen.getByRole("combobox", { name: "Schools" }), "agra");
    await user.click(screen.getByRole("option", { name: "JNV Agra (64037)" }));

    expect(document.querySelector<HTMLInputElement>('input[name="programs"]')?.value).toBe(
      "2"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="grades"]')?.value).toBe(
      "12"
    );
    expect(document.querySelector<HTMLInputElement>('input[name="subjects"]')?.value).toBe(
      "5"
    );
    expect(
      document.querySelector<HTMLInputElement>('input[name="exam_tracks"]')?.value
    ).toBe("neet");
  });
});
