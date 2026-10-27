import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  usePathname: () => "/school-visit-summary",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
  getResolvedPermission: mockGetUserPermission,
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

const summaryVisit: {
  id: number; school_code: string; school_name: string; pm_email: string;
  pm_name: string | null; visit_date: string; status: string;
  inserted_at: string; completed_at: string | null;
  start_lat: number; start_lng: number; start_accuracy: number;
  end_lat: null; end_lng: null; end_accuracy: null;
} = {
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
  schoolOptions = [{ code: "SC001", name: "Test School" }],
  pmOptions = [{ email: "pm@avantifellows.org", name: "Program Manager" }],
  regionOptions = [{ region: "Bhopal" }],
}: {
  stats?: typeof aggregateStats | typeof emptyAggregateStats;
  visits?: Array<typeof summaryVisit>;
  actions?: Array<{ visit_id: number; action_type: string; status: string }>;
  schoolOptions?: Array<{ code: string; name: string }>;
  pmOptions?: Array<{ email: string; name: string | null }>;
  regionOptions?: Array<{ region: string | null }>;
} = {}) {
  mockQuery
    .mockResolvedValueOnce([stats])
    .mockResolvedValueOnce(visits)
    .mockResolvedValueOnce(schoolOptions)
    .mockResolvedValueOnce(pmOptions)
    .mockResolvedValueOnce(regionOptions)
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

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) })).rejects.toThrow("REDIRECT:/");
      expect(mockRedirect).toHaveBeenCalledWith("/");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("redirects PM users to /visits and teachers to /dashboard", async () => {
      setupAuth(programManagerPermission, { user: { email: "pm@avantifellows.org" } });

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) })).rejects.toThrow("REDIRECT:/visits");
      expect(mockRedirect).toHaveBeenCalledWith("/visits");

      vi.clearAllMocks();
      setupAuth(teacherPermission, { user: { email: "teacher@avantifellows.org" } });

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) })).rejects.toThrow("REDIRECT:/dashboard");
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    });

    it("redirects NVS-only program_admin users when visits feature access is blocked", async () => {
      setupAuth(programAdminPermission, { user: { email: "program-admin@avantifellows.org" } });
      mockGetFeatureAccess.mockReturnValue({ access: "none", canView: false, canEdit: false });

      await expect(SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) })).rejects.toThrow("REDIRECT:/dashboard");
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("scope", () => {
    it("lets a PM with visit-manager seats in, scoped to only those Centres' Schools", async () => {
      setupAuth(
        {
          ...programManagerPermission,
          scope: {
            schools: new Set(["SC001", "SC002", "SC003"]),
            centres: new Set([1, 2, 3]),
            programs: new Set([1]),
            visitManagedSchools: new Set(["SC001", "SC002"]),
          },
        },
        { user: { email: "pm@avantifellows.org" } }
      );
      setupSummaryQueries({ stats: emptyAggregateStats, visits: [], actions: [] });

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });

      expect(mockRedirect).not.toHaveBeenCalled();
      for (const [sql, params] of mockQuery.mock.calls as [string, unknown[]][]) {
        if (!sql.includes("lms_pm_school_visits v")) continue;
        expect(sql).toContain("v.school_code = ANY(");
        expect(sql).not.toContain("pm_email) = $");
        expect(params).toContainEqual(["SC001", "SC002"]);
      }
    });

    it("shows only Visits at Schools with an active physical Centre in the list, stats and options", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ tab: "visits", schools: "SC001", pms: "pm@example.org" }),
      });

      const visitQueries = (mockQuery.mock.calls as [string, unknown[]][])
        .map(([sql]) => sql)
        .filter((sql) => sql.includes("FROM lms_pm_school_visits v"));
      expect(visitQueries).toHaveLength(5);
      for (const sql of visitQueries) {
        expect(sql).toMatch(/EXISTS \(\s*SELECT 1\s+FROM school \w+\s+JOIN centres \w+/);
        expect(sql).toMatch(/\w+\.is_physical AND \w+\.is_active/);
      }
    });

    it("applies level 2 program_admin region scope with explicit visit columns", async () => {
      setupAuth(programAdminPermission, { user: { email: "program-admin@avantifellows.org" } });
      setupSummaryQueries({ stats: emptyAggregateStats, visits: [], actions: [] });

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("LEFT JOIN school s ON s.code = v.school_code");
      expect(sql).toContain("v.deleted_at IS NULL");
      expect(sql).toContain("COALESCE(s.region, '') = ANY($3)");
      expect(params).toEqual([
        expect.any(Array),
        6,
        ["AHMEDABAD"],
      ]);
    });

    it("applies level 1 program_admin school-code scope with explicit visit columns", async () => {
      setupAuth(schoolScopedProgramAdminPermission, { user: { email: "program-admin@avantifellows.org" } });
      setupSummaryQueries({ stats: emptyAggregateStats, visits: [], actions: [] });

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("v.school_code = ANY($3)");
      expect(params).toEqual([
        expect.any(Array),
        6,
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
        if (sql.includes("SELECT DISTINCT")) {
          return Promise.resolve([]);
        }
        return Promise.resolve(summaryActionRows);
      });

      const pagePromise = SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });

      await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(5));
      expect(mockQuery.mock.calls[0][0]).toContain("WITH action_completion");
      expect(mockQuery.mock.calls[1][0]).toContain("LIMIT");

      resolveStats([aggregateStats]);
      resolveVisits([summaryVisit]);
      await pagePromise;

      expect(mockQuery.mock.calls[5][0]).toContain("WHERE visit_id = ANY($1)");
      expect(mockQuery.mock.calls[5][0]).toContain("deleted_at IS NULL");
    });

    it("uses known action types and numeric division in the aggregate stats query", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("COUNT(DISTINCT LOWER(v.pm_email))");
      expect(sql).toContain("::numeric");
      expect(sql).toContain("a.action_type = ANY($1");
      expect(sql).toContain("COUNT(*) * $2");
      expect(params[0]).toEqual(expect.arrayContaining([
        "classroom_observation",
        "af_team_interaction",
      ]));
      expect(params[0]).not.toContain("school_staff_interaction");
      expect(params[1]).toBe(6);
    });
  });

  describe("filters", () => {
    it("applies the status filter to aggregate stats and paginated visits", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ tab: "visits", status: "completed" }),
      });

      const [statsSql, statsParams] = mockQuery.mock.calls[0];
      const [visitsSql, visitsParams] = mockQuery.mock.calls[1];
      expect(statsSql).toContain("v.status = $3");
      expect(statsParams).toEqual([
        expect.any(Array),
        6,
        "completed",
      ]);
      expect(visitsSql).toContain("v.status = $1");
      expect(visitsParams).toEqual(["completed", 20, 0]);
    });

    it("parses multi-select schools and PMs plus inclusive manual date filters", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({
          tab: "visits",
          schools: "SC001,,SC002",
          pms: "PM@Example.org, other@example.org",
          from: "2026-05-01",
          to: "2026-05-31",
        }),
      });

      const [visitsSql, visitsParams] = mockQuery.mock.calls[1];
      expect(visitsSql).toContain("v.school_code = ANY($1)");
      expect(visitsSql).toContain("LOWER(v.pm_email) = ANY($2)");
      expect(visitsSql).toContain("v.visit_date >= $3");
      expect(visitsSql).toContain("v.visit_date <= $4");
      expect(visitsParams).toEqual([
        ["SC001", "SC002"],
        ["pm@example.org", "other@example.org"],
        "2026-05-01",
        "2026-05-31",
        20,
        0,
      ]);
    });

    it("uses date presets instead of manual dates and re-anchors them to today in IST", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-21T20:00:00.000Z"));
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({
          tab: "visits",
          preset: "7d",
          from: "2026-01-01",
          to: "2026-01-31",
        }),
      });

      const [visitsSql, visitsParams] = mockQuery.mock.calls[1];
      expect(visitsSql).toContain("v.visit_date >= $1");
      expect(visitsSql).toContain("v.visit_date <= $2");
      expect(visitsParams).toEqual(["2026-05-16", "2026-05-22", 20, 0]);
    });

    it("handles from dates after to dates as an empty result predicate", async () => {
      setupAuth();
      setupSummaryQueries({ stats: emptyAggregateStats, visits: [], actions: [] });

      const jsx = await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ tab: "visits", from: "2026-06-01", to: "2026-05-01" }),
      });
      render(jsx);

      const [visitsSql] = mockQuery.mock.calls[1];
      expect(visitsSql).toContain("1 = 0");
      expect(screen.getByText("No visits match your filters")).toBeInTheDocument();
    });

    it("queries cascading school and PM dropdown options excluding only their own filter", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({
          tab: "visits",
          schools: "SC001",
          pms: "pm@example.org",
          status: "completed",
        }),
      });

      const schoolOptionsCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes("SELECT DISTINCT v.school_code"));
      const pmOptionsCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes("SELECT DISTINCT LOWER(v.pm_email)"));

      expect(schoolOptionsCall).toBeDefined();
      expect(schoolOptionsCall?.[0]).not.toContain("v.school_code = ANY");
      expect(schoolOptionsCall?.[0]).toContain("LOWER(v.pm_email) = ANY");
      expect(schoolOptionsCall?.[0]).toContain("v.status = $2");
      expect(schoolOptionsCall?.[1]).toEqual([["pm@example.org"], "completed"]);

      expect(pmOptionsCall).toBeDefined();
      expect(pmOptionsCall?.[0]).toContain("v.school_code = ANY");
      expect(pmOptionsCall?.[0]).not.toContain("LOWER(v.pm_email) = ANY");
      expect(pmOptionsCall?.[0]).toContain("v.status = $2");
      expect(pmOptionsCall?.[1]).toEqual([["SC001"], "completed"]);
    });

    it("filters action-completion buckets with known action types and includes zero-action visits for none", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ tab: "visits", bucket: "none" }),
      });

      const [visitsSql, visitsParams] = mockQuery.mock.calls[1];
      expect(visitsSql).toContain("LEFT JOIN (");
      expect(visitsSql).toContain("COUNT(DISTINCT action_type) FILTER (WHERE action_type = ANY($1::text[])) AS touched_types");
      expect(visitsSql).toContain("COUNT(DISTINCT CASE WHEN status = 'completed' AND action_type = ANY($1::text[]) THEN action_type END) AS completed_types");
      expect(visitsSql).toContain("COALESCE(action_agg.touched_types, 0) = 0");
      expect(visitsParams).toEqual([
        expect.arrayContaining(["classroom_observation", "af_team_interaction"]),
        20,
        0,
      ]);
      expect(visitsParams[0]).not.toContain("school_staff_interaction");
    });
  });

  describe("sorting", () => {
    it("uses the default visit date descending sort", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });

      const [sql] = mockQuery.mock.calls[1];
      expect(sql).toContain("ORDER BY v.visit_date DESC, v.id DESC");
    });

    it("sorts completed_at ascending with NULLS LAST", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ tab: "visits", sort: "completed_at", dir: "asc" }),
      });

      const [sql] = mockQuery.mock.calls[1];
      expect(sql).toContain("ORDER BY v.completed_at ASC NULLS LAST, v.id DESC");
    });

    it("renders active sort headers as direction toggles", async () => {
      setupAuth();
      setupSummaryQueries();

      const jsx = await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ tab: "visits", sort: "school_name", dir: "asc" }),
      });
      render(jsx);

      const schoolSortLink = screen
        .getAllByRole("link", { name: /school/i })
        .find((link) => link.getAttribute("href")?.includes("sort=school_name"));

      expect(schoolSortLink).toHaveAttribute(
        "href",
        "/school-visit-summary?tab=visits&sort=school_name&dir=desc"
      );
    });

    it("preserves active filters when building sort links", async () => {
      setupAuth();
      setupSummaryQueries({ stats: { ...aggregateStats, total_visits: "25" } });

      const jsx = await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ tab: "visits", status: "completed", schools: "SC001", sort: "school_name", dir: "asc", page: "2" }),
      });
      render(jsx);

      const schoolSortLink = screen
        .getAllByRole("link", { name: /school/i })
        .find((link) => link.getAttribute("href")?.includes("sort=school_name"));

      expect(schoolSortLink).toHaveAttribute(
        "href",
        "/school-visit-summary?tab=visits&status=completed&schools=SC001&sort=school_name&dir=desc"
      );
    });

    it("rejects SQL injection in sort params by falling back to the safe default", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({ tab: "visits", sort: "visit_date; DROP TABLE school", dir: "asc; DROP" }),
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
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([summaryVisit])
        .mockResolvedValueOnce(summaryActionRows);

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits", page: "999" }) });
      render(jsx);

      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
      expect(mockQuery.mock.calls[1][1]).toEqual([20, 19960]);
      expect(mockQuery.mock.calls[5][1]).toEqual([20, 20]);
    });
  });

  describe("rendering", () => {
    it("renders a paginated visit summary table for admin users", async () => {
      setupAuth();
      setupSummaryQueries();

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });
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
      expect(screen.getAllByText("17%").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Classroom Observation: completed").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("AF Team Interaction: pending").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Principal Interaction: in progress").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("1/6 required complete").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByRole("link", { name: "View visit" })[0]).toHaveAttribute(
        "href",
        "/school-visit-summary/101"
      );
    });

    it("offers the Regions in view, including Schools with no region", async () => {
      setupAuth();
      setupSummaryQueries({ regionOptions: [{ region: "Bhopal" }, { region: null }] });

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits", regions: "__none__" }) });
      render(jsx);

      const region = screen.getByRole("group", { name: "Region" });
      expect(within(region).getByRole("button")).toHaveTextContent("No region (non-JNV)");

      fireEvent.click(within(region).getByRole("button"));
      expect(within(region).getByRole("checkbox", { name: "No region (non-JNV)" })).toBeChecked();
      expect(within(region).getByRole("checkbox", { name: "Bhopal" })).not.toBeChecked();
    });

    it("renders empty state when no visits match", async () => {
      setupAuth();
      setupSummaryQueries({ stats: emptyAggregateStats, visits: [], actions: [] });

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });
      render(jsx);

      expect(screen.getByText("No visits match your filters")).toBeInTheDocument();
      expect(screen.getByText("Avg Completion")).toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("falls back to PM email and computes in-progress duration from current time", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-10T07:45:00Z"));
      setupAuth();
      setupSummaryQueries({ visits: [inProgressVisit], actions: [] });

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });
      render(jsx);

      expect(screen.getAllByText("fallback@avantifellows.org").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("3h 45m").length).toBeGreaterThanOrEqual(1);
    });

    it("renders the read-only summary without edit/delete/start/end controls", async () => {
      setupAuth();
      setupSummaryQueries();

      const jsx = await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits" }) });
      render(jsx);

      expect(screen.queryByText("Delete")).not.toBeInTheDocument();
      expect(screen.queryByText("Start")).not.toBeInTheDocument();
      expect(screen.queryByText("End")).not.toBeInTheDocument();
      expect(screen.queryByText("Continue")).not.toBeInTheDocument();
    });
  });
  describe("School-wise tab", () => {
    const schoolRows = [
      { school_code: "SC001", school_name: "Test School", region: "Bhopal", visits: "3", last_visit_date: "2026-10-20" },
      { school_code: "SC002", school_name: "Other School", region: null, visits: "1", last_visit_date: "2026-08-01" },
    ];

    function setupSchoolWiseQueries(rows: Array<Record<string, unknown>> = schoolRows) {
      mockQuery.mockImplementation((sql: string) => Promise.resolve(sql.includes("SELECT DISTINCT") ? [] : rows));
    }

    function tabLink(name: string) {
      return within(screen.getByRole("navigation", { name: "Visit Summary views" })).getByRole("link", { name });
    }

    function schoolWiseTable() {
      return screen.getByRole("table", { name: "Schools with visits" });
    }

    it("is the default tab: one row per School with its Visits and Last visit", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-27T06:00:00Z"));
      setupAuth();
      setupSchoolWiseQueries();

      render(await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) }));

      expect(tabLink("School-wise")).toHaveAttribute("aria-current", "page");
      expect(tabLink("Visits")).not.toHaveAttribute("aria-current");
      const rows = within(schoolWiseTable()).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("Test School");
      expect(rows[0]).toHaveTextContent("(Bhopal)");
      expect(rows[0]).toHaveTextContent("3");
      expect(rows[0]).toHaveTextContent("20 Oct 2026");
      expect(rows[1]).toHaveTextContent("Other School");
      expect(rows[1]).toHaveTextContent("01 Aug 2026");
      expect(screen.queryByText("Total Visits")).not.toBeInTheDocument();
      expect(screen.queryByText("Avg Completion")).not.toBeInTheDocument();
    });

    it("flags a last visit only when it is more than 45 days before today in IST", async () => {
      // 26 Oct 2026 20:00 UTC is already 27 Oct in IST, so 45 days back is 12 Sep 2026.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-26T20:00:00Z"));
      setupAuth();
      setupSchoolWiseQueries([
        { school_code: "SC001", school_name: "Exactly 45 Days", region: null, visits: "1", last_visit_date: "2026-09-12" },
        { school_code: "SC002", school_name: "Exactly 46 Days", region: null, visits: "1", last_visit_date: "2026-09-11" },
      ]);

      render(await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) }));

      const [fortyFive, fortySix] = within(schoolWiseTable()).getAllByRole("row").slice(1);
      expect(within(fortyFive).queryByText("Stale")).not.toBeInTheDocument();
      expect(within(fortySix).getByText("Stale")).toBeInTheDocument();
    });

    it("counts Schools and their Visits in the stat cards", async () => {
      setupAuth();
      setupSchoolWiseQueries();

      render(await SchoolVisitSummaryPage({ searchParams: Promise.resolve({}) }));

      expect(screen.getByText("Schools", { selector: "span" }).nextElementSibling).toHaveTextContent("2");
      expect(screen.getByText("Visits", { selector: "span" }).nextElementSibling).toHaveTextContent("4");
      expect(screen.getByText("2 schools found")).toBeInTheDocument();
    });

    it("switches tabs keeping every filter and dropping sort, dir and page", async () => {
      setupAuth();
      setupSchoolWiseQueries();

      render(await SchoolVisitSummaryPage({
        searchParams: Promise.resolve({
          regions: "Bhopal",
          schools: "SC001",
          pms: "pm@example.org",
          status: "completed",
          bucket: "partial",
          preset: "30d",
          from: "2026-09-01",
          to: "2026-09-30",
          sort: "visits",
          dir: "asc",
          page: "2",
        }),
      }));

      const filters = "regions=Bhopal&schools=SC001&pms=pm%40example.org&status=completed&bucket=partial&preset=30d&from=2026-09-01&to=2026-09-30";
      expect(tabLink("Visits")).toHaveAttribute("href", `/school-visit-summary?tab=visits&${filters}`);
      expect(tabLink("School-wise")).toHaveAttribute("href", `/school-visit-summary?tab=schools&${filters}`);
    });

    it("shows the Visits tab, its stat cards and pagination for tab=visits", async () => {
      setupAuth();
      setupSummaryQueries({ stats: { ...aggregateStats, total_visits: "25" } });

      render(await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits", status: "completed" }) }));

      expect(tabLink("Visits")).toHaveAttribute("aria-current", "page");
      expect(tabLink("School-wise")).toHaveAttribute("href", "/school-visit-summary?tab=schools&status=completed");
      expect(screen.getByText("Total Visits")).toBeInTheDocument();
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
      expect(screen.queryByRole("table", { name: "Schools with visits" })).not.toBeInTheDocument();
    });

    it("sorts by school name ascending by default and toggles header sort direction", async () => {
      setupAuth();
      setupSchoolWiseQueries();

      render(await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ status: "completed" }) }));

      const [rowsSql] = mockQuery.mock.calls.find(([sql]) => String(sql).includes("GROUP BY v.school_code"))!;
      expect(rowsSql).toContain("ORDER BY school_name ASC, school_code ASC");
      const header = within(schoolWiseTable());
      expect(header.getByRole("link", { name: /School \(region\)/ })).toHaveAttribute(
        "href",
        "/school-visit-summary?status=completed&sort=school_name&dir=desc"
      );
      expect(header.getByRole("link", { name: "Visits" })).toHaveAttribute(
        "href",
        "/school-visit-summary?status=completed&sort=visits&dir=desc"
      );
      expect(header.getByRole("link", { name: "Last visit" })).toHaveAttribute(
        "href",
        "/school-visit-summary?status=completed&sort=last_visit&dir=desc"
      );
    });

    it("sorts by last visit ascending, breaking ties by school name, and links back to descending", async () => {
      setupAuth();
      setupSchoolWiseQueries();

      render(await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "schools", sort: "last_visit", dir: "asc" }) }));

      const [rowsSql] = mockQuery.mock.calls.find(([sql]) => String(sql).includes("GROUP BY v.school_code"))!;
      expect(rowsSql).toContain("ORDER BY last_visit_date ASC, school_name ASC, school_code ASC");
      expect(within(schoolWiseTable()).getByRole("link", { name: /Last visit/ })).toHaveAttribute(
        "href",
        "/school-visit-summary?tab=schools&sort=last_visit&dir=desc"
      );
    });

    it("ignores a Visits-tab sort on the School-wise tab", async () => {
      setupAuth();
      setupSchoolWiseQueries();

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ sort: "completed_at", dir: "sideways" }) });

      const [rowsSql] = mockQuery.mock.calls.find(([sql]) => String(sql).includes("GROUP BY v.school_code"))!;
      expect(rowsSql).toContain("ORDER BY school_name ASC, school_code ASC");
      expect(rowsSql).not.toContain("completed_at");
    });

    it("ignores a School-wise sort on the Visits tab", async () => {
      setupAuth();
      setupSummaryQueries();

      await SchoolVisitSummaryPage({ searchParams: Promise.resolve({ tab: "visits", sort: "last_visit", dir: "asc" }) });

      const [visitsSql] = mockQuery.mock.calls[1];
      expect(visitsSql).toContain("ORDER BY v.visit_date ASC, v.id DESC");
    });
  });
});
