import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetFeatureAccess,
  mockGetAccessibleSchoolCodes,
  mockQuery,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
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
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
  getFeatureAccess: mockGetFeatureAccess,
  getAccessibleSchoolCodes: mockGetAccessibleSchoolCodes,
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./AcademicMentorshipAdmin", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="academic-mentorship-admin" data-props={JSON.stringify(props)} />
  ),
}));

import AcademicMentorshipAdminPage from "./page";

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

const adminPermission = {
  id: 1,
  email: "admin@avantifellows.org",
  full_name: "Admin User",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1],
  read_only: false,
};

describe("AcademicMentorshipAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders for an admin and resolves all JNV schools server-side", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mockGetAccessibleSchoolCodes.mockResolvedValue("all");
    mockQuery.mockResolvedValue([
      { code: "SCH001", name: "JNV Bhopal" },
      { code: "SCH002", name: "JNV Jaipur" },
    ]);

    const jsx = await AcademicMentorshipAdminPage();
    render(jsx);

    expect(screen.getByText("Academic Mentorship")).toBeInTheDocument();
    const shell = screen.getByTestId("academic-mentorship-admin");
    expect(JSON.parse(shell.getAttribute("data-props")!)).toEqual({
      schools: [
        { code: "SCH001", name: "JNV Bhopal" },
        { code: "SCH002", name: "JNV Jaipur" },
      ],
      canView: true,
      canEdit: true,
      role: "admin",
    });
    expect(mockGetAccessibleSchoolCodes).toHaveBeenCalledWith(
      "admin@avantifellows.org",
      adminPermission
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE af_school_category = 'JNV'")
    );
  });

  it("redirects users without academic mentorship view access", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "teacher@avantifellows.org" },
    });
    mockGetUserPermission.mockResolvedValue({
      ...adminPermission,
      email: "teacher@avantifellows.org",
      role: "teacher",
    });
    mockGetFeatureAccess.mockReturnValue({
      access: "none",
      canView: false,
      canEdit: false,
    });

    await expect(AcademicMentorshipAdminPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("renders for a read-only program_admin and resolves scoped schools server-side", async () => {
    const permission = {
      ...adminPermission,
      email: "program.admin@avantifellows.org",
      role: "program_admin",
      level: 2,
      regions: ["North"],
      read_only: true,
    };
    mockGetServerSession.mockResolvedValue({
      user: { email: "program.admin@avantifellows.org" },
    });
    mockGetUserPermission.mockResolvedValue(permission);
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });
    mockGetAccessibleSchoolCodes.mockResolvedValue(["SCH010", "SCH011"]);
    mockQuery.mockResolvedValue([{ code: "SCH010", name: "JNV Ajmer" }]);

    const jsx = await AcademicMentorshipAdminPage();
    render(jsx);

    const shell = screen.getByTestId("academic-mentorship-admin");
    expect(JSON.parse(shell.getAttribute("data-props")!)).toEqual({
      schools: [{ code: "SCH010", name: "JNV Ajmer" }],
      canView: true,
      canEdit: false,
      role: "program_admin",
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE code = ANY($1)"),
      [["SCH010", "SCH011"]]
    );
  });

  it("redirects passcode users because they have no academic mentorship view permission", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "school-passcode" } });
    mockGetUserPermission.mockResolvedValue(null);
    mockGetFeatureAccess.mockReturnValue({
      access: "none",
      canView: false,
      canEdit: false,
    });

    await expect(AcademicMentorshipAdminPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockGetAccessibleSchoolCodes).not.toHaveBeenCalled();
  });
});
