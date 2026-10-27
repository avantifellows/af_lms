import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetResolvedPermission,
  mockGetFeatureAccess,
  mockQuery,
  mockWithTransaction,
  mockRedirect,
  mockNotFound,
  mockRefresh,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetResolvedPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockQuery: vi.fn(),
  mockWithTransaction: vi.fn(),
  mockRefresh: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getResolvedPermission: mockGetResolvedPermission,
  getFeatureAccess: mockGetFeatureAccess,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery, withTransaction: mockWithTransaction }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { NextRequest } from "next/server";

import { POST as postConcernEvent } from "@/app/api/visit-concerns/[id]/events/route";
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

  describe("with the real permission matrix", () => {
    // Visits access comes from the real matrix, so flipping a role's `visits` access (or its
    // read_only downgrade) changes the page and the events API together.
    async function withRealMatrix(permission: Record<string, unknown>) {
      const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
      mockGetFeatureAccess.mockImplementation(actual.getFeatureAccess);
      mockGetServerSession.mockResolvedValue({ user: { email: permission.email } });
      mockGetResolvedPermission.mockResolvedValue(permission);
    }

    // One open and one resolved concern, each mentioned by the School's one completed Visit.
    function setupConcerns() {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("lms_visit_concern_events")) return Promise.resolve([]);
        if (sql.includes("lms_visit_concern_mentions m") && sql.includes("centres")) {
          return Promise.resolve([{ id: "9004801", school_code: "SC001" }]);
        }
        if (sql.includes("lms_visit_concern_mentions")) {
          return Promise.resolve([
            { id: "9004801", kind: "concern", text: "Lab equipment missing", status: "open", visit_id: "1" },
            { id: "9004804", kind: "concern", text: "Water cooler broken", status: "resolved", visit_id: "1" },
          ]);
        }
        if (sql.includes("centre_positions")) return Promise.resolve([]);
        if (sql.includes("lms_pm_school_visits")) {
          return Promise.resolve([
            { id: "1", visit_date: "2026-09-15", status: "completed", pm_email: "pm@avantifellows.org", pm_name: "PM" },
          ]);
        }
        return Promise.resolve([{ code: "SC001", name: "Test School", region: "Bhopal" }]);
      });
      // The locked concern is open, so a resolve goes through.
      mockWithTransaction.mockImplementation((fn: (client: unknown) => unknown) =>
        fn({ query: vi.fn(async () => ({ rows: [{ kind: "concern", status: "open" }] })) })
      );
    }

    function resolveViaApi() {
      return postConcernEvent(
        new NextRequest("http://localhost/api/visit-concerns/9004801/events", {
          method: "POST",
          body: JSON.stringify({ action: "resolve", body: "Lab kits delivered" }),
        }),
        { params: Promise.resolve({ id: "9004801" }) }
      );
    }

    it("visits edit: the page shows Resolve, Comment and Reopen, and the API takes the resolve", async () => {
      await withRealMatrix(adminPermission);
      setupConcerns();

      render(await renderPage());

      expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
      expect((await resolveViaApi()).status).toBe(201);
    });

    it("visits view only (read_only): the page shows the concerns and history but no controls, and the API refuses", async () => {
      await withRealMatrix({ ...adminPermission, read_only: true });
      setupConcerns();

      render(await renderPage());

      expect(within(screen.getByRole("region", { name: /Needs attention/ })).getByText("Lab equipment missing")).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: /Resolved concerns/ })).getByText("Water cooler broken")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
      expect((await resolveViaApi()).status).toBe(403);
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it("no visits access: the page redirects and the API refuses", async () => {
      await withRealMatrix(teacherPermission);
      setupConcerns();

      await expect(renderPage()).rejects.toThrow("REDIRECT:/dashboard");
      expect((await resolveViaApi()).status).toBe(403);
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });
  });
});
