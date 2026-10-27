import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetResolvedPermission,
  mockGetFeatureAccess,
  mockQuery,
  mockRedirect,
  mockNotFound,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetResolvedPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockQuery: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getResolvedPermission: mockGetResolvedPermission,
  getFeatureAccess: mockGetFeatureAccess,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import SchoolVisitSummarySchoolPage from "./page";

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  read_only: false,
  program_ids: [1],
};

const teacherPermission = {
  email: "teacher@avantifellows.org",
  level: 1,
  role: "teacher",
  school_codes: ["SC001"],
  read_only: false,
  program_ids: [1],
};

const unseatedPmPermission = {
  email: "pm@avantifellows.org",
  level: 3,
  role: "program_manager",
  read_only: false,
  program_ids: [1],
};

function setupAuth(permission: Record<string, unknown> = adminPermission) {
  mockGetServerSession.mockResolvedValue({ user: { email: permission.email } });
  mockGetResolvedPermission.mockResolvedValue(permission);
  mockGetFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

function renderPage(code = "SC001", searchParams: Record<string, string> = {}) {
  return SchoolVisitSummarySchoolPage({
    params: Promise.resolve({ code }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe("SchoolVisitSummarySchoolPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  describe("gate", () => {
    it("redirects users without visits access to /dashboard, like the list", async () => {
      setupAuth();
      mockGetFeatureAccess.mockReturnValue({ access: "none", canView: false, canEdit: false });

      await expect(renderPage()).rejects.toThrow("REDIRECT:/dashboard");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("redirects a PM without a visit-manager seat to /visits and a teacher to /dashboard, like the list", async () => {
      setupAuth(unseatedPmPermission);
      await expect(renderPage()).rejects.toThrow("REDIRECT:/visits");

      setupAuth(teacherPermission);
      await expect(renderPage()).rejects.toThrow("REDIRECT:/dashboard");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("is not found when the School is unknown, out of scope or has no active physical Centre", async () => {
      setupAuth();
      mockQuery.mockResolvedValue([]);

      await expect(renderPage("NVSONLY")).rejects.toThrow("NOT_FOUND");
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe("found School", () => {
    function setupSchool(teachers: Array<Record<string, unknown>> = []) {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("centre_positions")) return Promise.resolve(teachers);
        if (sql.includes("lms_pm_school_visits")) return Promise.resolve([]);
        return Promise.resolve([{ code: "SC001", name: "Test School", region: "Bhopal" }]);
      });
    }

    it("shows the School and a Back link to the same filtered School-wise table", async () => {
      setupAuth();
      setupSchool();

      render(await renderPage("SC001", {
        regions: "Bhopal",
        pms: "pm@avantifellows.org",
        preset: "30d",
        recurring: "1",
        sort: "visits",
        dir: "asc",
      }));

      expect(screen.getByRole("heading", { level: 1, name: "Test School (Bhopal)" })).toBeInTheDocument();
      const back = new URL(
        screen.getByRole("link", { name: /Back to School-wise/ }).getAttribute("href")!,
        "http://localhost"
      );
      expect(back.pathname).toBe("/school-visit-summary");
      expect(Object.fromEntries(back.searchParams)).toEqual({
        tab: "schools",
        regions: "Bhopal",
        pms: "pm@avantifellows.org",
        preset: "30d",
        recurring: "1",
        sort: "visits",
        dir: "asc",
      });
    });
  });
});
