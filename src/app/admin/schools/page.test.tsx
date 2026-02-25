import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const { mockGetServerSession, mockIsAdmin, mockRedirect, mockQuery } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockIsAdmin: vi.fn(),
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    mockQuery: vi.fn(),
  }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({ isAdmin: mockIsAdmin }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
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
vi.mock("./SchoolList", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="school-list" data-props={JSON.stringify(props)} />
  ),
}));

import SchoolsPage from "./page";

// ---- helpers ----

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

const mockSchools = [
  { id: 1, code: "SCH001", name: "JNV Jaipur", region: "Rajasthan", program_ids: [64] },
  { id: 2, code: "SCH002", name: "JNV Delhi", region: "Delhi", program_ids: null },
];

// ---- tests ----

describe("SchoolsPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(SchoolsPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(SchoolsPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(false);

    await expect(SchoolsPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockIsAdmin).toHaveBeenCalledWith("admin@avantifellows.org");
  });

  it("queries JNV schools and renders SchoolList for admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue(mockSchools);

    const jsx = await SchoolsPage();
    render(jsx);

    // Header
    expect(screen.getByText("School Programs")).toBeInTheDocument();
    expect(screen.getByText("2 JNV schools")).toBeInTheDocument();
    expect(screen.getByText("admin@avantifellows.org")).toBeInTheDocument();

    // Navigation
    expect(screen.getByText("Sign out").closest("a")).toHaveAttribute(
      "href",
      "/api/auth/signout"
    );

    // SchoolList receives correct props
    const schoolList = screen.getByTestId("school-list");
    const props = JSON.parse(schoolList.getAttribute("data-props")!);
    expect(props.initialSchools).toEqual(mockSchools);

    // Verify query was called with JNV filter
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("af_school_category = 'JNV'");
    expect(sql).toContain("ORDER BY name");
  });

  it("renders with empty schools array", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery.mockResolvedValue([]);

    const jsx = await SchoolsPage();
    render(jsx);

    expect(screen.getByText("0 JNV schools")).toBeInTheDocument();

    const schoolList = screen.getByTestId("school-list");
    const props = JSON.parse(schoolList.getAttribute("data-props")!);
    expect(props.initialSchools).toEqual([]);
  });
});
