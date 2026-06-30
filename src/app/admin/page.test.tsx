import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const { mockGetServerSession, mockIsAdmin, mockRedirect, mockRequireAcademicMentorshipAccess } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockRequireAcademicMentorshipAccess: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({ isAdmin: mockIsAdmin }));
vi.mock("@/lib/academic-mentorship", () => ({
  requireAcademicMentorshipAccess: mockRequireAcademicMentorshipAccess,
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

import AdminPage from "./page";

// ---- helpers ----

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

const academicAccess = (role: "admin" | "program_admin") => ({
  ok: true,
  email: `${role}@avantifellows.org`,
  permission: {
    email: `${role}@avantifellows.org`,
    level: 3,
    role,
    school_codes: null,
    regions: null,
    program_ids: [64],
    read_only: false,
  },
  canEdit: true,
});

// ---- tests ----

describe("AdminPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAcademicMentorshipAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user lacks Academic Mentorship admin access", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(false);

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockRequireAcademicMentorshipAccess).toHaveBeenCalledWith(adminSession, "view");
  });

  it("renders admin links when user is admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockRequireAcademicMentorshipAccess.mockResolvedValue(academicAccess("admin"));

    const jsx = await AdminPage();
    render(jsx);

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("User Management")).toBeInTheDocument();
    expect(screen.getByText("Batch Metadata")).toBeInTheDocument();
    expect(screen.getByText("School Programs")).toBeInTheDocument();
    expect(screen.getByText("Centre Management")).toBeInTheDocument();
    expect(screen.getByText("Centre Option Configuration")).toBeInTheDocument();
    expect(screen.getByText("Academic Mentorship")).toBeInTheDocument();

    // verify links
    expect(screen.getByText("User Management").closest("a")).toHaveAttribute(
      "href",
      "/admin/users"
    );
    expect(screen.getByText("Batch Metadata").closest("a")).toHaveAttribute(
      "href",
      "/admin/batches"
    );
    expect(screen.getByText("School Programs").closest("a")).toHaveAttribute(
      "href",
      "/admin/schools"
    );
    expect(screen.getByText("Centre Management").closest("a")).toHaveAttribute(
      "href",
      "/admin/centres"
    );
    expect(screen.getByText("Centre Option Configuration").closest("a")).toHaveAttribute(
      "href",
      "/admin/centres/config"
    );
    expect(screen.getByText("Academic Mentorship").closest("a")).toHaveAttribute(
      "href",
      "/admin/academic-mentorship"
    );
  });

  it("lets program_admin users enter for Academic Mentorship only", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "program_admin@avantifellows.org" } });
    mockIsAdmin.mockResolvedValue(false);
    mockRequireAcademicMentorshipAccess.mockResolvedValue(academicAccess("program_admin"));

    const jsx = await AdminPage();
    render(jsx);

    expect(screen.getByText("Academic Mentorship")).toBeInTheDocument();
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.queryByText("Batch Metadata")).not.toBeInTheDocument();
    expect(screen.queryByText("School Programs")).not.toBeInTheDocument();
    expect(screen.queryByText("Centre Management")).not.toBeInTheDocument();
    expect(screen.queryByText("Centre Option Configuration")).not.toBeInTheDocument();
  });

  it("displays user email and navigation links", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockRequireAcademicMentorshipAccess.mockResolvedValue(academicAccess("admin"));

    const jsx = await AdminPage();
    render(jsx);

    expect(screen.getByText("admin@avantifellows.org")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();

    expect(
      screen.getByText("Dashboard").closest("a")
    ).toHaveAttribute("href", "/dashboard");
    expect(screen.getByText("Sign out").closest("a")).toHaveAttribute(
      "href",
      "/api/auth/signout"
    );
  });
});
