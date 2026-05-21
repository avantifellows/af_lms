import { render, screen, waitFor } from "@testing-library/react";
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

const aggregateStats = {
  total_visits: "1",
  in_progress_count: "0",
  completed_count: "1",
  unique_schools: "1",
  unique_pms: "1",
  avg_action_completion: "42.857142",
};

const emptyAggregateStats = {
  total_visits: "0",
  in_progress_count: "0",
  completed_count: "0",
  unique_schools: "0",
  unique_pms: "0",
  avg_action_completion: null,
};

const summaryActionRows = [
  { visit_id: 101, action_type: "classroom_observation", status: "completed" },
  { visit_id: 101, action_type: "classroom_observation", status: "pending" },
  { visit_id: 101, action_type: "af_team_interaction", status: "pending" },
  { visit_id: 101, action_type: "principal_interaction", status: "in_progress" },
];

function setupAuth(permission = adminPermission, session = adminSession) {
  mockGetServerSession.mockResolvedValue(session);
  mockGetUserPermission.mockResolvedValue(permission);
  mockGetFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

function setupSummaryQueries({
  stats = aggregateStats,
  visits = [summaryVisit],
  actions = summaryActionRows,
}: {
  stats?: typeof aggregateStats | typeof emptyAggregateStats;
  visits?: Array<typeof summaryVisit>;
  actions?: Array<{ visit_id: number; action_type: string; status: string }>;
} = {}) {
  mockQuery
    .mockResolvedValueOnce([stats])
    .mockResolvedValueOnce(visits)
    .mockResolvedValueOnce(actions);
}

describe("SchoolVisitSummaryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
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
      setupSummaryQueries({ stats: emptyAggregateStats, visits: [], actions: [] });

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("LEFT JOIN school s ON s.code = v.school_code");
      expect(sql).toContain("v.deleted_at IS NULL");
      expect(sql).toContain("COALESCE(s.region, '') = ANY($3)");
      expect(params).toEqual([
        expect.any(Array),
        7,
        ["AHMEDABAD"],
      ]);
    });

    it("applies level 1 program_admin school-code scope with explicit visit columns", async () => {
      setupAuth(schoolScopedProgramAdminPermission, { user: { email: "program-admin@avantifellows.org" } });
      setupSummaryQueries({ stats: emptyAggregateStats, visits: [], actions: [] });

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("v.school_code = ANY($3)");
      expect(params).toEqual([
        expect.any(Array),
        7,
        ["SC001"],
      ]);
    });
  });

  describe("summary queries", () => {
    it("dispatches aggregate and paginated queries before awaiting either result", async () => {
      setupAuth();
      let resolveStats: (value: unknown) => void = () => {};
      let resolveVisits: (value: unknown) => void = () => {};
      const statsPromise = new Promise((resolve) => {
        resolveStats = resolve;
      });
      const visitsPromise = new Promise((resolve) => {
        resolveVisits = resolve;
      });

      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("WITH action_completion") || sql.includes("COUNT(*) AS total")) {
          return statsPromise;
        }
        if (sql.includes("LIMIT")) {
          return visitsPromise;
        }
        return Promise.resolve(summaryActionRows);
      });

      const pagePromise = SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });

      await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2));
      expect(mockQuery.mock.calls[0][0]).toContain("WITH action_completion");
      expect(mockQuery.mock.calls[1][0]).toContain("LIMIT");

      resolveStats([aggregateStats]);
      resolveVisits([summaryVisit]);
      await pagePromise;

      expect(mockQuery.mock.calls[2][0]).toContain("WHERE visit_id = ANY($1)");
      expect(mockQuery.mock.calls[2][0]).toContain("deleted_at IS NULL");
    });

    it("uses known action types and numeric division in the aggregate stats query", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("COUNT(DISTINCT LOWER(v.pm_email))");
      expect(sql).toContain("::numeric");
      expect(sql).toContain("a.action_type = ANY($1");
      expect(sql).toContain("COUNT(*) * $2");
      expect(params[0]).toEqual(expect.arrayContaining([
        "classroom_observation",
        "af_team_interaction",
        "school_staff_interaction",
      ]));
      expect(params[1]).toBe(7);
    });
  });

  describe("sorting", () => {
    it("uses the default visit date descending sort", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });

      const [sql] = mockQuery.mock.calls[1];
      expect(sql).toContain("ORDER BY v.visit_date DESC, v.id DESC");
    });

    it("sorts completed_at ascending with NULLS LAST", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ sort: "completed_at", dir: "asc" }),
      });

      const [sql] = mockQuery.mock.calls[1];
      expect(sql).toContain("ORDER BY v.completed_at ASC NULLS LAST, v.id DESC");
    });

    it("renders active sort headers as direction toggles", async () => {
      setupAuth();
      setupSummaryQueries();

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
      setupSummaryQueries();

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
        .mockResolvedValueOnce([{ ...aggregateStats, total_visits: "25" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([summaryVisit])
        .mockResolvedValueOnce(summaryActionRows);

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ page: "999" }) });
      render(jsx);

      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
      expect(mockQuery.mock.calls[1][1]).toEqual([20, 19960]);
      expect(mockQuery.mock.calls[2][1]).toEqual([20, 20]);
    });
  });

  describe("rendering", () => {
    it("renders a paginated visit summary table for admin users", async () => {
      setupAuth();
      setupSummaryQueries();

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });
      render(jsx);

      expect(screen.getByRole("heading", { name: "School Visit Summary" })).toBeInTheDocument();
      expect(screen.getAllByText("Test School (SC001)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Program Manager").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("2h 30m").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Total Visits")).toBeInTheDocument();
      expect(screen.getByText("Avg Completion")).toBeInTheDocument();
      expect(screen.getByText("43%")).toBeInTheDocument();
      expect(screen.getByText("4 total, 1 completed")).toBeInTheDocument();
      expect(screen.getByText("14%")).toBeInTheDocument();
      expect(screen.getByText("1/7 complete, 2/7 in-progress, 4/7 not started")).toBeInTheDocument();
      expect(screen.getAllByText("1/7 complete").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByRole("link", { name: "View visit" })[0]).toHaveAttribute(
        "href",
        "/school-visit-summary/101"
      );
    });

    it("renders empty state when no visits match", async () => {
      setupAuth();
      setupSummaryQueries({ stats: emptyAggregateStats, visits: [], actions: [] });

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });
      render(jsx);

      expect(screen.getByText("No visits found")).toBeInTheDocument();
      expect(screen.getByText("Avg Completion")).toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("falls back to PM email and computes in-progress duration from current time", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-10T07:45:00Z"));
      setupAuth();
      setupSummaryQueries({ visits: [inProgressVisit], actions: [] });

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });
      render(jsx);

      expect(screen.getAllByText("fallback@avantifellows.org").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("3h 45m").length).toBeGreaterThanOrEqual(1);
    });

    it("renders the read-only summary without edit/delete/start/end controls", async () => {
      setupAuth();
      setupSummaryQueries();

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) });
      render(jsx);

      expect(screen.queryByText("Delete")).not.toBeInTheDocument();
      expect(screen.queryByText("Start")).not.toBeInTheDocument();
      expect(screen.queryByText("End")).not.toBeInTheDocument();
      expect(screen.queryByText("Continue")).not.toBeInTheDocument();
    });
  });
});
