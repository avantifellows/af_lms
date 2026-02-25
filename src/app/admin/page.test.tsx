import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const { mockGetServerSession, mockIsAdmin, mockRedirect } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({ isAdmin: mockIsAdmin }));
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

  it("redirects to /dashboard when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(false);

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
  });

  it("displays user email and navigation links", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);

    const jsx = await AdminPage();
    render(jsx);

    expect(screen.getByText("admin@avantifellows.org")).toBeInTheDocument();
    expect(screen.getByText("Back to Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();

    expect(
      screen.getByText("Back to Dashboard").closest("a")
    ).toHaveAttribute("href", "/dashboard");
    expect(screen.getByText("Sign out").closest("a")).toHaveAttribute(
      "href",
      "/api/auth/signout"
    );
  });
});
