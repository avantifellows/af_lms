import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const {
  mockGetServerSession,
  mockIsAdmin,
  mockGetUserPermission,
  mockGetFeatureAccess,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({
  isAdmin: mockIsAdmin,
  getUserPermission: mockGetUserPermission,
  getFeatureAccess: mockGetFeatureAccess,
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

// ---- tests ----

describe("AdminPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockIsAdmin).not.toHaveBeenCalled();
    expect(mockGetUserPermission).not.toHaveBeenCalled();
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(false);
    mockGetFeatureAccess.mockReturnValue({
      access: "none",
      canView: false,
      canEdit: false,
    });

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockIsAdmin).toHaveBeenCalledWith("admin@avantifellows.org");
  });

  it("renders admin links when user is admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);

    const jsx = await AdminPage();
    render(jsx);

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("User Management")).toBeInTheDocument();
    expect(screen.getByText("Batch Metadata")).toBeInTheDocument();
    expect(screen.getByText("School Programs")).toBeInTheDocument();
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
    expect(screen.getByText("Academic Mentorship").closest("a")).toHaveAttribute(
      "href",
      "/admin/academic-mentorship"
    );
  });

  it("renders only the academic mentorship card for a non-admin with view access", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "program.admin@avantifellows.org" },
    });
    mockIsAdmin.mockResolvedValue(false);
    mockGetUserPermission.mockResolvedValue({
      ...adminPermission,
      email: "program.admin@avantifellows.org",
      role: "program_admin",
      read_only: true,
    });
    mockGetFeatureAccess.mockReturnValue({
      access: "view",
      canView: true,
      canEdit: false,
    });

    const jsx = await AdminPage();
    render(jsx);

    expect(screen.getByText("Academic Mentorship")).toBeInTheDocument();
    expect(screen.getByText("Manage mentor-mentee mappings")).toBeInTheDocument();
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.queryByText("Batch Metadata")).not.toBeInTheDocument();
    expect(screen.queryByText("School Programs")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage users and permissions")).not.toBeInTheDocument();
  });

  it("displays user email and navigation links", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);

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
