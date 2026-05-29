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
vi.mock("./UserList", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="user-list" data-props={JSON.stringify(props)} />
  ),
}));

import UsersPage from "./page";

// ---- helpers ----

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

const mockUsers = [
  {
    id: 1,
    email: "admin@avantifellows.org",
    level: 4,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: [64],
    read_only: false,
  },
  {
    id: 2,
    email: "pm@avantifellows.org",
    level: 3,
    role: "pm",
    school_codes: null,
    regions: ["Rajasthan"],
    program_ids: [64],
    read_only: false,
  },
];

const mockRegions = [
  { region: "Delhi", school_count: "5" },
  { region: "Rajasthan", school_count: "12" },
];

const mockSchoolNames = [
  { code: "70705", name: "JNV Bhavnagar" },
  { code: "14042", name: "JNV Mumbai" },
];

// ---- tests ----

describe("UsersPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(UsersPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(UsersPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(false);

    await expect(UsersPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockIsAdmin).toHaveBeenCalledWith("admin@avantifellows.org");
  });

  it("fetches users, regions, and school names and renders UserList for admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    // query is called three times: users, regions, schools
    mockQuery
      .mockResolvedValueOnce(mockUsers)
      .mockResolvedValueOnce(mockRegions)
      .mockResolvedValueOnce(mockSchoolNames);

    const jsx = await UsersPage();
    render(jsx);

    // Header
    expect(screen.getByText("User Management")).toBeInTheDocument();
    expect(screen.getByText("2 users")).toBeInTheDocument();
    expect(screen.getByText("admin@avantifellows.org")).toBeInTheDocument();

    // Navigation
    expect(screen.getByText("Sign out").closest("a")).toHaveAttribute(
      "href",
      "/api/auth/signout"
    );

    // UserList receives correct props
    const userList = screen.getByTestId("user-list");
    const props = JSON.parse(userList.getAttribute("data-props")!);
    expect(props.initialUsers).toEqual(mockUsers);
    expect(props.regions).toEqual(["Delhi", "Rajasthan"]);
    expect(props.schoolCodeToName).toEqual({
      "70705": "JNV Bhavnagar",
      "14042": "JNV Mumbai",
    });
    expect(props.currentUserEmail).toBe("admin@avantifellows.org");

    // Verify all three queries were called
    expect(mockQuery).toHaveBeenCalledTimes(3);
    // Users query
    const usersSql = mockQuery.mock.calls[0][0];
    expect(usersSql).toContain("user_permission");
    expect(usersSql).toContain("ORDER BY level DESC");
    // Regions query
    const regionsSql = mockQuery.mock.calls[1][0];
    expect(regionsSql).toContain("af_school_category = 'JNV'");
    expect(regionsSql).toContain("GROUP BY region");
    // Schools query
    const schoolsSql = mockQuery.mock.calls[2][0];
    expect(schoolsSql).toContain("SELECT code, name FROM school");
    expect(schoolsSql).toContain("af_school_category = 'JNV'");
  });

  it("renders with empty users, regions, and schools", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const jsx = await UsersPage();
    render(jsx);

    expect(screen.getByText("0 users")).toBeInTheDocument();

    const userList = screen.getByTestId("user-list");
    const props = JSON.parse(userList.getAttribute("data-props")!);
    expect(props.initialUsers).toEqual([]);
    expect(props.regions).toEqual([]);
    expect(props.schoolCodeToName).toEqual({});
    expect(props.currentUserEmail).toBe("admin@avantifellows.org");
  });
});
