// fallow-ignore-file code-duplication
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  mockGetServerSession,
  mockRedirect,
  mockRequireAcademicMentorshipAccess,
  mockListAccessibleAcademicMentorshipSchools,
  mockGetAcademicMentorshipAcademicYears,
  mockListAcademicMentorshipMappings,
  mockListAcademicMentorshipProgramSchoolLinks,
  mockListAcademicMentorshipProgramsForSchools,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockRequireAcademicMentorshipAccess: vi.fn(),
  mockListAccessibleAcademicMentorshipSchools: vi.fn(),
  mockGetAcademicMentorshipAcademicYears: vi.fn(),
  mockListAcademicMentorshipMappings: vi.fn(),
  mockListAcademicMentorshipProgramSchoolLinks: vi.fn(),
  mockListAcademicMentorshipProgramsForSchools: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/academic-mentorship", () => ({
  requireAcademicMentorshipAccess: mockRequireAcademicMentorshipAccess,
  listAccessibleAcademicMentorshipSchools: mockListAccessibleAcademicMentorshipSchools,
  getAcademicMentorshipAcademicYears: mockGetAcademicMentorshipAcademicYears,
  listAcademicMentorshipMappings: mockListAcademicMentorshipMappings,
  listAcademicMentorshipProgramSchoolLinks: mockListAcademicMentorshipProgramSchoolLinks,
  listAcademicMentorshipProgramsForSchools: mockListAcademicMentorshipProgramsForSchools,
  isValidAcademicYear: (value: string) => /^\d{4}-\d{4}$/.test(value),
  isAcademicMentorshipEditableYear: (value: string) => value === "2026-2027",
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import AcademicMentorshipPage from "./page";

const session = { user: { email: "pa@avantifellows.org" } };
const access = {
  ok: true,
  email: "pa@avantifellows.org",
  permission: {
    email: "pa@avantifellows.org",
    level: 3,
    role: "program_admin",
    school_codes: null,
    regions: null,
    program_ids: [64],
    read_only: false,
  },
  canEdit: true,
};

describe("AcademicMentorshipPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(session);
    mockRequireAcademicMentorshipAccess.mockResolvedValue(access);
    mockGetAcademicMentorshipAcademicYears.mockReturnValue([
      "2026-2027",
      "2025-2026",
      "2024-2025",
    ]);
    mockListAcademicMentorshipMappings.mockResolvedValue([]);
    mockListAcademicMentorshipProgramsForSchools.mockResolvedValue([
      { id: 64, name: "JNV NVS" },
    ]);
    mockListAcademicMentorshipProgramSchoolLinks.mockResolvedValue([
      { programId: 64, schoolId: 20 },
      { programId: 64, schoolId: 21 },
    ]);
  });

  it("auto-selects the only accessible School and current academic year into the URL", async () => {
    mockListAccessibleAcademicMentorshipSchools.mockResolvedValue([
      { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
    ]);

    await expect(
      AcademicMentorshipPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow(
      "REDIRECT:/admin/academic-mentorship?school_code=SCH001&academic_year=2026-2027"
    );
  });

  it("renders selectors and grouped active mappings for the selected School/year", async () => {
    mockRequireAcademicMentorshipAccess
      .mockResolvedValueOnce(access)
      .mockResolvedValueOnce({
        ...access,
        school: { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      });
    mockListAccessibleAcademicMentorshipSchools.mockResolvedValue([
      { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      { id: 21, code: "SCH002", name: "Second School", region: "West" },
    ]);
    mockListAcademicMentorshipMappings.mockResolvedValue([
      {
        mentor: { userId: 101, name: "Anita Mentor", email: "anita@avantifellows.org" },
        menteeCount: 1,
        mappings: [
          {
            id: 1,
            mentee: {
              studentPkId: 201,
              name: "Meena Student",
              studentId: "STU001",
              grade: 11,
              programId: 64,
            },
            assignedDate: "2026-07-01",
            endedDate: null,
            status: "active",
          },
        ],
      },
    ]);

    const jsx = await AcademicMentorshipPage({
      searchParams: Promise.resolve({
        school_code: "SCH001",
        academic_year: "2026-2027",
      }),
    });
    render(jsx);

    expect(screen.getByLabelText("Program")).toHaveValue("");
    expect(screen.getByLabelText("School")).toHaveValue("SCH001");
    expect(screen.getByLabelText("Academic year")).toHaveValue("2026-2027");
    expect(screen.getByText("2025-2026")).toBeInTheDocument();
    expect(screen.getByText("Anita Mentor")).toBeInTheDocument();
    expect(screen.getByText("1 mentee")).toBeInTheDocument();
    expect(screen.getByText("Meena Student")).toBeInTheDocument();
    expect(screen.getByText("STU001")).toBeInTheDocument();
    expect(screen.getByText("Grade 11")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Edit access")).toBeInTheDocument();
    expect(screen.getByText("Show history").closest("a")).toHaveAttribute(
      "href",
      "/admin/academic-mentorship?school_code=SCH001&academic_year=2026-2027&include_history=true"
    );
    expect(mockListAcademicMentorshipMappings).toHaveBeenCalledWith({
      schoolId: 20,
      academicYear: "2026-2027",
      includeHistory: false,
      programId: null,
    });
    expect(mockListAccessibleAcademicMentorshipSchools).not.toHaveBeenCalled();
    expect(mockListAcademicMentorshipProgramsForSchools).toHaveBeenCalledWith(
      [20],
      "2026-2027"
    );
    expect(mockListAcademicMentorshipProgramSchoolLinks).toHaveBeenCalledWith(
      [20],
      "2026-2027"
    );
  });

  it("clears a School that is not available under the selected Program", async () => {
    mockRequireAcademicMentorshipAccess
      .mockResolvedValueOnce(access)
      .mockResolvedValueOnce({
        ...access,
        school: { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      });
    mockListAcademicMentorshipProgramSchoolLinks.mockResolvedValue([
      { programId: 64, schoolId: 21 },
    ]);

    await expect(
      AcademicMentorshipPage({
        searchParams: Promise.resolve({
          program_id: "64",
          school_code: "SCH001",
          academic_year: "2026-2027",
        }),
      })
    ).rejects.toThrow(
      "REDIRECT:/admin/academic-mentorship?academic_year=2026-2027&program_id=64"
    );
  });
});
