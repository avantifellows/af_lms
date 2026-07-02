// fallow-ignore-file code-duplication
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const { mockGetServerSession, mockRequireAdmin, mockRedirect } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/admin-guard", () => ({ requireAdmin: mockRequireAdmin }));
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

// ---- tests ----

describe("AdminPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({
      ok: true,
      email: "admin@avantifellows.org",
      permission: { role: "admin" },
    });
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    mockRequireAdmin.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockRequireAdmin).toHaveBeenCalledWith(null);
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });
    mockRequireAdmin.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockRequireAdmin.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockRequireAdmin).toHaveBeenCalledWith(adminSession);
  });

  it("renders admin links when user is admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);

    const jsx = await AdminPage();
    render(jsx);

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("User Management")).toBeInTheDocument();
    expect(screen.getByText("Batch Metadata")).toBeInTheDocument();
    expect(screen.getByText("School Programs")).toBeInTheDocument();
    expect(screen.getByText("Centre Management")).toBeInTheDocument();
    expect(screen.getByText("Centre Option Configuration")).toBeInTheDocument();
    expect(screen.queryByText("Academic Mentorship")).not.toBeInTheDocument();

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
  });

  it("does not let program_admin users enter through /admin", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "program_admin@avantifellows.org" } });
    mockRequireAdmin.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });

    await expect(AdminPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("displays user email and navigation links", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);

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
