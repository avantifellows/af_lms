import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockRequireCurriculumConfigAdmin,
  mockNormalizeCurriculumConfigListParams,
  mockGetCurriculumConfigList,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireCurriculumConfigAdmin: vi.fn(),
  mockNormalizeCurriculumConfigListParams: vi.fn(),
  mockGetCurriculumConfigList: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/curriculum-config", () => ({
  requireCurriculumConfigAdmin: mockRequireCurriculumConfigAdmin,
  normalizeCurriculumConfigListParams: mockNormalizeCurriculumConfigListParams,
  getCurriculumConfigList: mockGetCurriculumConfigList,
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

import CurriculumConfigPage from "./page";

const adminSession = { user: { email: "admin@avantifellows.org" } };
const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
};
const defaultParams = {
  filters: {
    examTrack: "jee_main",
    grade: null,
    subject: null,
    search: "",
    syllabusStatus: "in_syllabus",
  },
  page: 1,
  limit: 50,
  sort: "curriculum",
  dir: "asc",
};
const listResult = {
  ok: true,
  activeFilters: defaultParams.filters,
  filterOptions: {
    grades: [11, 12],
    subjects: [{ id: 4, name: "Physics" }],
    examTracks: ["jee_main", "neet"],
    syllabusStatuses: ["in_syllabus", "out_of_syllabus", "all"],
  },
  rows: [
    {
      id: 42,
      chapterId: 7,
      chapterCode: "PHY-01",
      chapterName: "Motion",
      grade: 11,
      subjectId: 4,
      subjectName: "Physics",
      examTrack: "jee_main",
      isInSyllabus: true,
      syllabusStatus: "in_syllabus",
      prescribedMinutes: 90,
      prescribedHours: 1.5,
      prescribedHoursLabel: "1h 30m",
      coverageSequence: 2,
      updatedByEmail: "",
      updatedAt: "",
    },
  ],
  totalRowCount: 1,
  currentPage: 1,
  totalPages: 1,
  limit: 50,
  sort: "curriculum",
  dir: "asc",
};

describe("CurriculumConfigPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(adminSession);
    mockRequireCurriculumConfigAdmin.mockResolvedValue({
      ok: true,
      email: "admin@avantifellows.org",
      permission: adminPermission,
    });
    mockNormalizeCurriculumConfigListParams.mockReturnValue(defaultParams);
    mockGetCurriculumConfigList.mockResolvedValue(listResult);
  });

  it("uses the dedicated admin guard and renders default read-only config rows", async () => {
    const jsx = await CurriculumConfigPage({ searchParams: Promise.resolve({}) });
    render(jsx);

    expect(mockRequireCurriculumConfigAdmin).toHaveBeenCalledWith(adminSession);
    expect(
      screen.getByRole("heading", { level: 1, name: "Curriculum Config" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Exam Track")).toHaveValue("jee_main");
    expect(screen.getByLabelText("Grade")).toHaveValue("");
    expect(screen.getByLabelText("Subject")).toHaveValue("");
    expect(screen.getByLabelText("Syllabus status")).toHaveValue("in_syllabus");
    expect(screen.getByLabelText("Rows per page")).toHaveValue("50");
    expect(screen.getByText("PHY-01")).toBeInTheDocument();
    expect(screen.getByText("Motion")).toBeInTheDocument();
    expect(screen.getByText(/1h 30m/)).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.queryByLabelText("School")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Program")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("renders an empty table state", async () => {
    mockGetCurriculumConfigList.mockResolvedValue({
      ...listResult,
      rows: [],
      totalRowCount: 0,
      totalPages: 0,
    });

    const jsx = await CurriculumConfigPage({ searchParams: Promise.resolve({}) });
    render(jsx);

    expect(
      screen.getByText("No Curriculum Config rows match the selected filters.")
    ).toBeInTheDocument();
  });

  it("renders schema-unavailable details", async () => {
    mockGetCurriculumConfigList.mockResolvedValue({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });

    const jsx = await CurriculumConfigPage({ searchParams: Promise.resolve({}) });
    render(jsx);

    expect(
      screen.getByRole("heading", { name: "LMS curriculum schema unavailable" })
    ).toBeInTheDocument();
    expect(screen.getByText("lms_chapter_exam_configs.id")).toBeInTheDocument();
  });

  it("redirects non-admin users away from the config page", async () => {
    mockRequireCurriculumConfigAdmin.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    await expect(
      CurriculumConfigPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow("REDIRECT:/dashboard");
  });
});
