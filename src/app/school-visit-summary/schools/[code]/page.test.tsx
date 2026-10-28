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
  mockGetStudentAcademicLevelCounts,
} = vi.hoisted(() => ({
  mockGetStudentAcademicLevelCounts: vi.fn(),
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
// BigQuery is the external boundary; only its query function is replaced.
vi.mock("@/lib/bigquery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bigquery")>()),
  getStudentAcademicLevelCounts: mockGetStudentAcademicLevelCounts,
}));
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

// The count in an academic-level card's Now cell.
function cellCount(card: ReturnType<typeof within>, label: string): string | null | undefined {
  return card.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
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
    mockGetStudentAcademicLevelCounts.mockReset();
    mockGetStudentAcademicLevelCounts.mockResolvedValue([]);
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

      expect(screen.getByRole("heading", { level: 1, name: "Test School" })).toBeInTheDocument();
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

  describe("academic-level cards", () => {
    const coeCentre = { id: "101", name: "JNV Bhopal CoE", type_code: "coe", program_id: 1 };

    function setupSchool(centres: Array<Record<string, unknown>> = [coeCentre]) {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("centre_positions")) return Promise.resolve([]);
        if (sql.includes("lms_pm_school_visits")) return Promise.resolve([]);
        if (sql.includes("c.program_id")) return Promise.resolve(centres);
        return Promise.resolve([{ code: "SC001", name: "Test School", region: "Bhopal", udise_code: "23010100101" }]);
      });
    }

    it("shows one card per Centre, grade and stream with Now counts and NA adding up to the total", async () => {
      setupAuth();
      setupSchool();
      // Grade 11 at the CoE: engineering + pcm → JEE, medical + pcb → NEET; CA has no card.
      mockGetStudentAcademicLevelCounts.mockResolvedValue([
        { grade: 11, stream: "engineering", academicLevel: "M1", students: 12 },
        { grade: 11, stream: "Engineering", academicLevel: "M2", students: 5 },
        { grade: 11, stream: "PCM", academicLevel: "M3", students: 3 },
        { grade: 11, stream: "engineering", academicLevel: null, students: 4 },
        { grade: 11, stream: "medical", academicLevel: "B1", students: 6 },
        { grade: 11, stream: "pcb", academicLevel: null, students: 2 },
        { grade: 11, stream: "ca", academicLevel: "M1", students: 1 },
      ]);

      render(await renderPage());

      const cards = within(screen.getByRole("list", { name: "Academic level" })).getAllByRole("listitem");
      expect(cards).toHaveLength(2);

      const jee = within(screen.getByRole("link", { name: /^CoE ?G11 JEE/ }));
      expect(jee.getByText("24 students")).toBeInTheDocument();
      expect(cellCount(jee, "M1")).toBe("12");
      expect(cellCount(jee, "M2")).toBe("5");
      expect(cellCount(jee, "M3")).toBe("3");
      expect(cellCount(jee, "NA")).toBe("4");
      expect(jee.getByText("NA").parentElement).toHaveAttribute("title", "No AL-bearing test yet");

      const neet = within(screen.getByRole("link", { name: /^CoE ?G11 NEET/ }));
      expect(neet.getByText("8 students")).toBeInTheDocument();
      expect(cellCount(neet, "B1")).toBe("6");
      expect(cellCount(neet, "NA")).toBe("2");
      expect(mockGetStudentAcademicLevelCounts).toHaveBeenCalledWith("23010100101", "JNV CoE", [11, 12]);
    });

    it("opens the Centre's cumulative report for the grade in the same tab, without a stream", async () => {
      setupAuth();
      setupSchool();
      mockGetStudentAcademicLevelCounts.mockResolvedValue([
        { grade: 12, stream: "medical", academicLevel: "B2", students: 7 },
      ]);

      render(await renderPage());

      const card = screen.getByRole("link", { name: /^CoE ?G12 NEET/ });
      expect(card).toHaveAttribute("href", "/centre/101?tab=performance&grade=12&view=cumulative");
      expect(card).not.toHaveAttribute("target");
    });

    it("counts PCMB students under JEE", async () => {
      setupAuth();
      setupSchool();
      mockGetStudentAcademicLevelCounts.mockResolvedValue([
        { grade: 11, stream: "PCMB", academicLevel: "M3", students: 2 },
        { grade: 11, stream: "engineering", academicLevel: "M3", students: 1 },
      ]);

      render(await renderPage());

      const jee = within(screen.getByRole("link", { name: /^CoE ?G11 JEE/ }));
      expect(jee.getByText("3 students")).toBeInTheDocument();
      expect(cellCount(jee, "M3")).toBe("3");
    });

    it("never queries an NVS Centre, and keeps CoE and Nodal cards apart", async () => {
      setupAuth();
      setupSchool([
        coeCentre,
        { id: "102", name: "JNV Bhopal Nodal", type_code: "nodal", program_id: 2 },
        { id: "103", name: "JNV Bhopal NVS", type_code: "coe", program_id: 64 },
      ]);
      mockGetStudentAcademicLevelCounts.mockImplementation(async (_udise: string, program: string) =>
        program === "JNV CoE"
          ? [{ grade: 11, stream: "engineering", academicLevel: "M1", students: 10 }]
          : [{ grade: 11, stream: "engineering", academicLevel: "M2", students: 4 }]
      );

      render(await renderPage());

      expect(mockGetStudentAcademicLevelCounts.mock.calls.map((call) => call[1])).toEqual(["JNV CoE", "JNV Nodal"]);
      const cards = within(screen.getByRole("list", { name: "Academic level" })).getAllByRole("link");
      expect(cards.map((card) => card.getAttribute("href"))).toEqual([
        "/centre/101?tab=performance&grade=11&view=cumulative",
        "/centre/102?tab=performance&grade=11&view=cumulative",
      ]);
      expect(cellCount(within(cards[0]), "M1")).toBe("10");
      expect(cards[1]).toHaveTextContent(/^NodalG11 JEE/);
      expect(cellCount(within(cards[1]), "M2")).toBe("4");
    });

    it("omits the cards, without querying BigQuery, for a viewer who can't see the School's Performance", async () => {
      setupAuth();
      setupSchool();
      mockGetFeatureAccess.mockImplementation((_permission: unknown, feature: string) =>
        feature === "performance"
          ? { access: "none", canView: false, canEdit: false }
          : { access: "edit", canView: true, canEdit: true }
      );

      render(await renderPage());

      expect(screen.getByRole("heading", { level: 1, name: "Test School" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Academic level" })).not.toBeInTheDocument();
      expect(mockGetStudentAcademicLevelCounts).not.toHaveBeenCalled();
    });

    it("omits the cards for a viewer outside the School's access scope", async () => {
      // Sees the School on the Visit Summary through a PM seat that isn't in its School scope.
      setupAuth({
        email: "pm@avantifellows.org",
        level: 1,
        role: "program_manager",
        school_codes: [],
        read_only: false,
        program_ids: [1],
        scope: { schools: new Set<string>(), centres: new Set<number>(), programs: new Set<number>(), visitManagedSchools: new Set(["SC001"]) },
      });
      setupSchool();

      render(await renderPage());

      expect(screen.getByRole("heading", { level: 1, name: "Test School" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Academic level" })).not.toBeInTheDocument();
      expect(mockGetStudentAcademicLevelCounts).not.toHaveBeenCalled();
    });

    it("shows \"Academic levels unavailable\" when BigQuery fails, and the rest of the page still renders", async () => {
      setupAuth();
      setupSchool();
      mockGetStudentAcademicLevelCounts.mockRejectedValue(new Error("BigQuery down"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      render(await renderPage());

      expect(screen.getByText("Academic levels unavailable")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Academic level" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Teachers" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Back to School-wise/ })).toBeInTheDocument();
    });
  });

  describe("intervention flags", () => {
    // One open Nodal flag with a follow-up; the School's resolved and NVS flags never become rows.
    const openFlag = {
      id: 9004755,
      status: "open",
      student_name: "Asha Verma",
      grade: 11,
      centre_id: "102",
      centre_type_code: "nodal",
      raised_by_email: "pm@avantifellows.org",
      raised_by_name: "Priya PM",
      inserted_at: "2026-10-06T06:00:00.000Z",
      update_count: 2,
    };

    function setupSchool() {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes("lms_student_intervention_flags")) return Promise.resolve([openFlag]);
        if (sql.includes("centre_positions")) return Promise.resolve([]);
        if (sql.includes("lms_pm_school_visits")) return Promise.resolve([]);
        if (sql.includes("c.program_id")) return Promise.resolve([]);
        return Promise.resolve([{ code: "SC001", name: "Test School", region: "Bhopal", af_school_category: "JNV" }]);
      });
    }

    function flagQueries() {
      return mockQuery.mock.calls.filter(([sql]) => String(sql).includes("lms_student_intervention_flags"));
    }

    it("shows the open flags to a viewer who may see the School's flags", async () => {
      setupAuth();
      setupSchool();

      render(await renderPage());

      const section = screen.getByRole("region", { name: /Intervention flags/ });
      expect(within(section).getByRole("link", { name: "Notes in LMS for A. V." })).toHaveAttribute(
        "href",
        "/school/SC001?tab=enrollment&flag=9004755"
      );
    });

    it("omits the section, without reading flags, for a viewer without Student view access", async () => {
      setupAuth();
      setupSchool();
      mockGetFeatureAccess.mockImplementation((_permission: unknown, feature: string) =>
        feature === "students"
          ? { access: "none", canView: false, canEdit: false }
          : { access: "edit", canView: true, canEdit: true }
      );

      render(await renderPage());

      expect(screen.getByRole("heading", { level: 1, name: "Test School" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: /Needs attention/ })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /Intervention flags/ })).not.toBeInTheDocument();
      expect(flagQueries()).toHaveLength(0);
    });

    it("omits the section for a viewer outside the School's access scope", async () => {
      // Sees the School on the Visit Summary through a PM seat that isn't in its School scope.
      setupAuth({
        email: "pm@avantifellows.org",
        level: 1,
        role: "program_manager",
        school_codes: [],
        read_only: false,
        program_ids: [1],
        scope: { schools: new Set<string>(), centres: new Set<number>(), programs: new Set<number>(), visitManagedSchools: new Set(["SC001"]) },
      });
      setupSchool();

      render(await renderPage());

      expect(screen.getByRole("heading", { level: 1, name: "Test School" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /Intervention flags/ })).not.toBeInTheDocument();
      expect(flagQueries()).toHaveLength(0);
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

    it("heads the page with the School, its Visits in view and the concern counts of the sections below", async () => {
      await withRealMatrix(adminPermission);
      setupConcerns();

      render(await renderPage("SC001", { preset: "30d" }));

      expect(screen.getByRole("heading", { level: 1, name: "Test School" })).toBeInTheDocument();
      expect(screen.getByText("SC001 · Bhopal · 1 visit · last 15 Sep 2026")).toBeInTheDocument();
      expect(within(screen.getByRole("list", { name: "Concern counts" })).getAllByRole("listitem").map((chip) => chip.textContent)).toEqual([
        "1 open concern",
        "0 recurring",
        "0 highlights",
        "1 resolved",
      ]);
      expect(screen.getByRole("region", { name: "Needs attention" })).toHaveTextContent("1 open");
    });

    it("links each Visit-wise note to its Visit, which comes Back to this School page and its filters", async () => {
      await withRealMatrix(adminPermission);
      setupConcerns();

      render(await renderPage("SC001", { preset: "30d", sort: "visits" }));

      const link = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.startsWith("/school-visit-summary/1?"));
      const href = new URL(link!.getAttribute("href")!, "http://localhost");
      expect(href.pathname).toBe("/school-visit-summary/1");
      expect(href.searchParams.get("back")).toBe("/school-visit-summary/schools/SC001?preset=30d&sort=visits");
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
