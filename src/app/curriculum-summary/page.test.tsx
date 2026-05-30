import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetFeatureAccess,
  mockGetProgramContextSync,
  mockCheckCurriculumSchema,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockGetProgramContextSync: vi.fn(),
  mockCheckCurriculumSchema: vi.fn(),
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
vi.mock("@/lib/curriculum-schema", () => ({
  checkCurriculumSchema: mockCheckCurriculumSchema,
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
const schemaReady = { ok: true };
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
    mockCheckCurriculumSchema.mockResolvedValue({
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
      mockCheckCurriculumSchema.mockResolvedValue(schemaReady);

      const jsx = await CurriculumSummaryPage({
        searchParams: defaultSearchParams,
      });
      render(jsx);

      expect(
        screen.getByRole("heading", { level: 1, name: "Curriculum Summary" })
      ).toBeInTheDocument();
      expect(screen.getByText("Read only")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    }
  );
});
