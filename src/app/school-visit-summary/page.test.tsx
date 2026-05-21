import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetFeatureAccess,
  mockQuery,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockQuery: vi.fn(),
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
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} className={className} {...props}>{children}</a>,
}));
vi.mock("@/components/visits/GpsMapLink", () => ({
  __esModule: true,
  default: ({ lat, lng }: { lat: number | string | null; lng: number | string | null }) => (
    lat !== null && lng !== null ? <a href={`https://maps.google.com/?q=${lat},${lng}`}>GPS</a> : null
  ),
}));

import SchoolVisitSummaryPage from "./page";

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  read_only: false,
  program_ids: [1],
};

const programAdminPermission = {
  email: "program-admin@avantifellows.org",
  level: 2,
  role: "program_admin",
  read_only: true,
  regions: ["AHMEDABAD"],
  program_ids: [1],
};

const schoolScopedProgramAdminPermission = {
  email: "program-admin@avantifellows.org",
  level: 1,
  role: "program_admin",
  read_only: true,
  school_codes: ["SC001"],
  program_ids: [1],
};

const programManagerPermission = {
  email: "pm@avantifellows.org",
  level: 3,
  role: "program_manager",
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

const summaryVisit = {
  id: 101,
  school_code: "SC001",
  school_name: "Test School",
  pm_email: "pm@avantifellows.org",
  pm_name: "Program Manager",
  visit_date: "2026-02-10",
  status: "completed",
  inserted_at: "2026-02-10T04:00:00Z",
  completed_at: "2026-02-10T06:30:00Z",
  start_lat: 12.9716,
  start_lng: 77.5946,
  start_accuracy: 8,
  end_lat: null,
  end_lng: null,
  end_accuracy: null,
};

const inProgressVisit = {
  ...summaryVisit,
  id: 102,
  school_code: "SC002",
  school_name: "Fallback School",
  pm_email: "fallback@avantifellows.org",
  pm_name: null,
  status: "in_progress",
  inserted_at: "2026-02-10T04:00:00Z",
  completed_at: null,
};

function setupAuth(permission = adminPermission, session = adminSession) {
  mockGetServerSession.mockResolvedValue(session);
  mockGetUserPermission.mockResolvedValue(permission);
  mockGetFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

describe("SchoolVisitSummaryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("auth/access", () => {
    it("redirects unauthenticated users to /", async () => {
      mockGetServerSession.mockResolvedValue(null);

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/");
      expect(mockRedirect).toHaveBeenCalledWith("/");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("redirects passcode users to their school page or dashboard", async () => {
      mockGetServerSession.mockResolvedValue({ user: {}, isPasscodeUser: true, schoolCode: "70705" });

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/school/70705");
      expect(mockRedirect).toHaveBeenCalledWith("/school/70705");

      vi.clearAllMocks();
      mockGetServerSession.mockResolvedValue({ user: {}, isPasscodeUser: true });

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    });

    it("redirects PM users to /visits and teachers to /dashboard", async () => {
      setupAuth(programManagerPermission, { user: { email: "pm@avantifellows.org" } });

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/visits");
      expect(mockRedirect).toHaveBeenCalledWith("/visits");

      vi.clearAllMocks();
      setupAuth(teacherPermission, { user: { email: "teacher@avantifellows.org" } });

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    });

    it("redirects NVS-only program_admin users when visits feature access is blocked", async () => {
      setupAuth(programAdminPermission, { user: { email: "program-admin@avantifellows.org" } });
      mockGetFeatureAccess.mockReturnValue({ access: "none", canView: false, canEdit: false });

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("scope", () => {
    it("applies level 2 program_admin region scope with explicit visit columns", async () => {
      setupAuth(programAdminPermission, { user: { email: "program-admin@avantifellows.org" } });
      mockQuery
        .mockResolvedValueOnce([{ total: "0" }]);

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("LEFT JOIN school s ON s.code = v.school_code");
      expect(sql).toContain("v.deleted_at IS NULL");
      expect(sql).toContain("COALESCE(s.region, '') = ANY($1)");
      expect(params).toEqual([["AHMEDABAD"]]);
    });

    it("applies level 1 program_admin school-code scope with explicit visit columns", async () => {
      setupAuth(schoolScopedProgramAdminPermission, { user: { email: "program-admin@avantifellows.org" } });
      mockQuery.mockResolvedValueOnce([{ total: "0" }]);

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("v.school_code = ANY($1)");
      expect(params).toEqual([["SC001"]]);
    });
  });

  describe("sorting", () => {
    it("uses the default visit date descending sort", async () => {
      setupAuth();
      mockQuery
        .mockResolvedValueOnce([{ total: "1" }])
        .mockResolvedValueOnce([summaryVisit]);

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });

      const [sql] = mockQuery.mock.calls[1];
      expect(sql).toContain("ORDER BY v.visit_date DESC, v.id DESC");
    });

    it("sorts completed_at ascending with NULLS LAST", async () => {
      setupAuth();
      mockQuery
        .mockResolvedValueOnce([{ total: "1" }])
        .mockResolvedValueOnce([summaryVisit]);

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ sort: "completed_at", dir: "asc" }),
      });

      const [sql] = mockQuery.mock.calls[1];
      expect(sql).toContain("ORDER BY v.completed_at ASC NULLS LAST, v.id DESC");
    });

    it("renders active sort headers as direction toggles", async () => {
      setupAuth();
      mockQuery
        .mockResolvedValueOnce([{ total: "1" }])
        .mockResolvedValueOnce([summaryVisit]);

      const jsx = await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ sort: "school_name", dir: "asc" }),
      });
      render(jsx);

      const schoolSortLink = screen
        .getAllByRole("link", { name: /school/i })
        .find((link) => link.getAttribute("href")?.includes("sort=school_name"));

      expect(schoolSortLink).toHaveAttribute(
        "href",
        "/school-visit-summary?sort=school_name&dir=desc"
      );
    });

    it("rejects SQL injection in sort params by falling back to the safe default", async () => {
      setupAuth();
      mockQuery
        .mockResolvedValueOnce([{ total: "1" }])
        .mockResolvedValueOnce([summaryVisit]);

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ sort: "visit_date; DROP TABLE school", dir: "asc; DROP" }),
      });

      const [sql] = mockQuery.mock.calls[1];
      expect(sql).toContain("ORDER BY v.visit_date DESC, v.id DESC");
      expect(sql).not.toContain("DROP TABLE");
    });
  });

  describe("pagination", () => {
    it("uses 20 rows per page and clamps out-of-range pages", async () => {
      setupAuth();
      mockQuery
        .mockResolvedValueOnce([{ total: "25" }])
        .mockResolvedValueOnce([summaryVisit]);

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ page: "999" }) });
      render(jsx);

      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
      const [, params] = mockQuery.mock.calls[1];
      expect(params).toEqual([20, 20]);
    });
  });

  describe("rendering", () => {
    it("renders a paginated visit summary table for admin users", async () => {
      setupAuth();
      mockQuery
        .mockResolvedValueOnce([{ total: "1" }])
        .mockResolvedValueOnce([summaryVisit]);

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });
      render(jsx);

      expect(screen.getByRole("heading", { name: "School Visit Summary" })).toBeInTheDocument();
      expect(screen.getAllByText("Test School (SC001)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Program Manager").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("2h 30m").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByRole("link", { name: "View visit" })[0]).toHaveAttribute(
        "href",
        "/school-visit-summary/101"
      );
    });

    it("renders empty state when no visits match", async () => {
      setupAuth();
      mockQuery.mockResolvedValueOnce([{ total: "0" }]);

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });
      render(jsx);

      expect(screen.getByText("No visits found")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("falls back to PM email and computes in-progress duration from current time", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-10T07:45:00Z"));
      setupAuth();
      mockQuery
        .mockResolvedValueOnce([{ total: "1" }])
        .mockResolvedValueOnce([inProgressVisit]);

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });
      render(jsx);

      expect(screen.getAllByText("fallback@avantifellows.org").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("3h 45m").length).toBeGreaterThanOrEqual(1);
    });

    it("renders the read-only summary without edit/delete/start/end controls", async () => {
      setupAuth();
      mockQuery
        .mockResolvedValueOnce([{ total: "1" }])
        .mockResolvedValueOnce([summaryVisit]);

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });
      render(jsx);

      expect(screen.queryByText("Delete")).not.toBeInTheDocument();
      expect(screen.queryByText("Start")).not.toBeInTheDocument();
      expect(screen.queryByText("End")).not.toBeInTheDocument();
      expect(screen.queryByText("Continue")).not.toBeInTheDocument();
    });
  });
});
