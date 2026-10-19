import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockGetResolvedPermission, mockGetCurriculumSummary, mockPush } = vi.hoisted(
  () => ({
    mockGetServerSession: vi.fn(),
    mockGetResolvedPermission: vi.fn(),
    mockGetCurriculumSummary: vi.fn(),
    mockPush: vi.fn(),
  })
);

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getResolvedPermission: mockGetResolvedPermission,
}));
vi.mock("@/lib/curriculum-summary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/curriculum-summary")>()),
  getCurriculumSummary: mockGetCurriculumSummary,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

import type { CurriculumSummaryResult, CurriculumSummaryRow } from "@/lib/curriculum-summary";
import CurriculumSummaryPage from "./page";

const PM = {
  email: "pm@avantifellows.org",
  level: 2,
  role: "program_manager",
  regions: ["NORTH"],
  program_ids: [1, 2],
  read_only: false,
};
const ADMIN = { ...PM, email: "admin@avantifellows.org", level: 3, role: "admin" };

function row(overrides: Partial<CurriculumSummaryRow>): CurriculumSummaryRow {
  return {
    centreId: 1,
    centreName: "Anand Shared",
    schoolCode: "SC1",
    schoolName: "JNV Anand",
    region: "NORTH",
    programId: 2,
    programName: "JNV Nodal",
    tracksLabel: "JEE Main + NEET",
    kind: "plan",
    explanation: null,
    plan: { id: 900, title: "G11 Plan", closed: false },
    subjects: {
      Physics: { due: 2, done: 1, behind: 1, tone: "amber", label: "1 behind" },
      Chemistry: { due: 1, done: 1, behind: 0, tone: "green", label: "On track" },
      Maths: null,
      Biology: { due: 4, done: 0, behind: 4, tone: "red", label: "4 behind" },
    },
    subjectGroups: {
      // PCM = Physics + Chemistry; PCB = Physics + Chemistry + Biology.
      PCM: { due: 3, done: 2, behind: 1, tone: "amber", label: "1 behind" },
      PCB: { due: 7, done: 2, behind: 5, tone: "red", label: "5 behind" },
    },
    testsOverdue: 2,
    testsConducted: null,
    ...overrides,
  };
}

function summary(overrides: Partial<Extract<CurriculumSummaryResult, { ok: true }>> = {}): CurriculumSummaryResult {
  return {
    ok: true,
    header: { centresOnPlan: 1, centresTotal: 3, chaptersBehind: { PCM: 1, PCB: 5 }, testsOverdue: 2 },
    regionOptions: ["NORTH", "SOUTH"],
    rows: [
      row({}),
      row({
        centreId: 2,
        centreName: "Bhuj Closed",
        region: null,
        tracksLabel: "JEE Main",
        plan: { id: 901, title: "Old Plan", closed: true },
        subjectGroups: { PCM: { due: 2, done: 2, behind: 0, tone: "green", label: "On track" }, PCB: null },
      }),
      row({
        centreId: 3,
        centreName: "Surat",
        kind: "no_plan",
        plan: null,
        subjects: null,
        subjectGroups: null,
        testsOverdue: 0,
        testsConducted: 1,
      }),
      row({
        centreId: 4,
        centreName: "Vapi",
        kind: "setup_error",
        explanation: "Fix tracks in Centre Management",
        plan: null,
        subjects: null,
        subjectGroups: null,
      }),
    ],
    pagination: { page: 2, pageSize: 50, totalRows: 120, totalPages: 3 },
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string | string[]> = {}) {
  render(await CurriculumSummaryPage({ searchParams: Promise.resolve(searchParams) }));
}

const summaryRow = (centre: string) =>
  document.querySelector(`[data-summary-row][data-centre="${centre}"]`) as HTMLElement;

beforeEach(() => {
  vi.resetAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: PM.email } });
  mockGetResolvedPermission.mockResolvedValue(PM);
  mockGetCurriculumSummary.mockResolvedValue(summary());
});

describe("Curriculum Summary page access", () => {
  it("sends a signed-out visitor to the sign-in page", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("REDIRECT:/");
  });

  it.each([
    ["no permission row", null],
    ["a teacher", { ...PM, role: "teacher" }],
    ["a PM with only JNV NVS", { ...PM, program_ids: [64] }],
    ["a PMU Manager", { ...PM, role: "pmu_manager" }],
  ])("sends %s to the dashboard", async (_name, permission) => {
    mockGetResolvedPermission.mockResolvedValue(permission);
    await expect(renderPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockGetCurriculumSummary).not.toHaveBeenCalled();
  });
});

describe("Curriculum Summary page", () => {
  it("shows the schema-unavailable card", async () => {
    mockGetCurriculumSummary.mockResolvedValue({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_curriculum_plans.id"],
    });

    await renderPage();

    expect(screen.getByText("Schema unavailable")).toBeInTheDocument();
    expect(screen.getByText("lms_curriculum_plans.id")).toBeInTheDocument();
    expect(screen.getByText(/cannot load until the LMS Curriculum/)).toBeInTheDocument();
  });

  it("passes the normalized filters and shows the header numbers", async () => {
    await renderPage({ grade: "12", as_of: "2026-08-15", regions: "NORTH", q: "anand", only_behind: "1", page: "2", limit: "50" });

    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(PM, {
      regions: ["NORTH"],
      schoolSearch: "anand",
      grade: 12,
      asOf: "2026-08-15",
      onlyBehind: true,
      sort: null,
      page: 2,
      pageSize: 50,
    });
    expect(screen.getByTestId("summary-centres-on-plan")).toHaveTextContent("1/3");
    expect(screen.getByText("PCM chapters behind")).toBeInTheDocument();
    expect(screen.getByTestId("summary-pcm-chapters-behind")).toHaveTextContent("1");
    expect(screen.getByText("PCB chapters behind")).toBeInTheDocument();
    expect(screen.getByTestId("summary-pcb-chapters-behind")).toHaveTextContent("5");
    expect(screen.queryByText("Chapters behind")).not.toBeInTheDocument();
    expect(screen.getByTestId("summary-tests-overdue")).toHaveTextContent("2");
    expect(screen.queryByRole("link", { name: "Plans" })).not.toBeInTheDocument();
  });

  it("shows each row kind: pills, Closed plan, No plan and the explanation", async () => {
    await renderPage({ as_of: "2026-08-15", grade: "11" });

    const plan = summaryRow("Anand Shared");
    expect(within(plan).getByRole("link", { name: "Anand Shared" })).toHaveAttribute(
      "href",
      "/curriculum-summary/centres/1?grade=11&as_of=2026-08-15"
    );
    // The Centre name alone: no School name line under it.
    expect(plan.querySelector("td")).toHaveTextContent(/^Anand Shared$/);
    expect(within(plan).queryByText("JNV Anand")).not.toBeInTheDocument();
    expect(plan.querySelector('[data-subject="Physics"]')).toHaveTextContent("1 behind · 1/2");
    expect(plan.querySelector('[data-subject="Physics"] [data-tone]')).toHaveAttribute("data-tone", "amber");
    expect(plan.querySelector('[data-subject="Maths"]')).toHaveTextContent("—");
    // Group cells read like the subject pills: Behind, then done/due.
    expect(plan.querySelector('[data-subject-group="PCM"]')).toHaveTextContent(/^1 behind · 2\/3$/);
    expect(plan.querySelector('[data-subject-group="PCM"] [data-tone]')).toHaveAttribute("data-tone", "amber");
    expect(plan.querySelector('[data-subject-group="PCB"]')).toHaveTextContent(/^5 behind · 2\/7$/);
    expect(plan.querySelector('[data-subject-group="PCB"] [data-tone]')).toHaveAttribute("data-tone", "red");
    expect(plan.querySelector("[data-tests-overdue]")).toHaveTextContent("2");
    expect(plan.querySelector("[data-plan]")).toHaveTextContent("G11 Plan");
    expect(plan.querySelector("[data-plan-closed]")).toBeNull();

    const closed = summaryRow("Bhuj Closed");
    expect(closed.querySelector("[data-plan-closed]")).toHaveTextContent("Closed");
    expect(closed.querySelector('[data-subject-group="PCM"]')).toHaveTextContent(/^On track · 2\/2$/);
    expect(closed.querySelector('[data-subject-group="PCM"] [data-tone]')).toHaveAttribute("data-tone", "green");
    // PCB doesn't apply to a JEE Main class.
    expect(closed.querySelector('[data-subject-group="PCB"]')).toHaveTextContent("—");
    expect(closed.querySelector('[data-subject-group="PCB"] [data-tone]')).toBeNull();

    const noPlan = summaryRow("Surat");
    expect(noPlan.querySelector("[data-tests-conducted]")).toHaveTextContent("1 conducted");
    expect(noPlan.querySelector("[data-plan]")).toHaveTextContent("No plan");
    expect(noPlan.querySelector("[data-subject-group]")).toBeNull();

    expect(summaryRow("Vapi").querySelector("[data-explanation]")).toHaveTextContent(
      "Fix tracks in Centre Management"
    );
    expect(summaryRow("Vapi").querySelector("[data-subject-group]")).toBeNull();
  });

  it("heads PCM Behind and PCB Behind columns and keeps every row as wide as the header", async () => {
    await renderPage();

    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual([
      "Centre",
      "Program",
      "Tracks",
      "Region",
      "Physics",
      "Chemistry",
      "Maths",
      "Biology",
      "PCM Behind",
      "PCB Behind",
      "Tests overdue",
      "Plan",
    ]);
    const width = (centre: string) =>
      [...summaryRow(centre).querySelectorAll("td")].reduce((sum, cell) => sum + cell.colSpan, 0);
    expect(["Anand Shared", "Bhuj Closed", "Surat", "Vapi"].map(width)).toEqual([12, 12, 12, 12]);
  });

  it("counts a No plan row without a conducted count as 0", async () => {
    mockGetCurriculumSummary.mockResolvedValue(
      summary({ rows: [row({ kind: "no_plan", plan: null, subjects: null, testsConducted: null })] })
    );

    await renderPage();

    expect(document.querySelector("[data-tests-conducted]")).toHaveTextContent("0 conducted");
  });

  it("keeps every filter in the Grade, pagination and page-size links", async () => {
    await renderPage({ grade: "11", as_of: "2026-08-15", regions: ["NORTH", "SOUTH"], q: "jnv", only_behind: "1", page: "2", limit: "50" });

    const grades = screen.getByRole("navigation", { name: "Grade" });
    expect(within(grades).getByRole("link", { name: "Grade 11" })).toHaveAttribute("aria-current", "page");
    expect(within(grades).getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary?regions=NORTH&regions=SOUTH&q=jnv&grade=12&as_of=2026-08-15&only_behind=1&limit=50"
    );
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/curriculum-summary?regions=NORTH&regions=SOUTH&q=jnv&grade=11&as_of=2026-08-15&only_behind=1&limit=50"
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/curriculum-summary?regions=NORTH&regions=SOUTH&q=jnv&grade=11&as_of=2026-08-15&only_behind=1&limit=50&page=3"
    );
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(document.querySelector('input[type="hidden"][name="limit"]')).toHaveValue("50");
    expect(screen.getByRole("checkbox", { name: "NORTH" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Only behind" })).toBeChecked();

    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "20" } });
    expect(mockPush).toHaveBeenCalledWith(
      "/curriculum-summary?regions=NORTH&regions=SOUTH&q=jnv&grade=11&as_of=2026-08-15&only_behind=1"
    );
  });

  it("links every column header to its first-click sort from page 1, without an arrow", async () => {
    await renderPage({ grade: "11", as_of: "2026-08-15", page: "2" });

    const header = (name: string) => screen.getByRole("columnheader", { name });
    const sortLink = (name: string) => within(header(name)).getByRole("link", { name });
    // Text columns start A–Z; the measured columns most behind (or overdue) first.
    const expected: [string, string, string][] = [
      ["Centre", "centre", "asc"],
      ["Program", "program", "asc"],
      ["Tracks", "tracks", "asc"],
      ["Region", "region", "asc"],
      ["Physics", "physics", "desc"],
      ["Chemistry", "chemistry", "desc"],
      ["Maths", "maths", "desc"],
      ["Biology", "biology", "desc"],
      ["PCM Behind", "pcm", "desc"],
      ["PCB Behind", "pcb", "desc"],
      ["Tests overdue", "tests_overdue", "desc"],
      ["Plan", "plan", "asc"],
    ];
    for (const [name, key, dir] of expected) {
      expect(sortLink(name)).toHaveAttribute("href", `/curriculum-summary?grade=11&as_of=2026-08-15&sort=${key}&dir=${dir}`);
      expect(header(name)).not.toHaveAttribute("aria-sort");
    }
    expect(screen.queryByText("▲")).not.toBeInTheDocument();
    expect(screen.queryByText("▼")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="hidden"][name="sort"]')).toBeNull();
    expect(document.querySelector('input[type="hidden"][name="dir"]')).toBeNull();
  });

  it("marks the sorted column, reverses it on the next click and keeps the sort in every link", async () => {
    await renderPage({
      grade: "11",
      as_of: "2026-08-15",
      regions: ["NORTH", "SOUTH"],
      q: "jnv",
      only_behind: "1",
      sort: "pcb",
      dir: "desc",
      page: "2",
      limit: "50",
    });

    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(PM, expect.objectContaining({ sort: { key: "pcb", dir: "desc" } }));
    const filters = "regions=NORTH&regions=SOUTH&q=jnv&grade=11&as_of=2026-08-15&only_behind=1";
    const pcb = screen.getByRole("columnheader", { name: "PCB Behind" });
    expect(pcb).toHaveAttribute("aria-sort", "descending");
    expect(within(pcb).getByText("▼")).toHaveAttribute("aria-hidden", "true");
    // Same column: the other direction, back on page 1, every filter and the page size kept.
    expect(within(pcb).getByRole("link", { name: "PCB Behind" })).toHaveAttribute(
      "href",
      `/curriculum-summary?${filters}&sort=pcb&dir=asc&limit=50`
    );
    const centre = screen.getByRole("columnheader", { name: "Centre" });
    expect(centre).not.toHaveAttribute("aria-sort");
    expect(within(centre).getByRole("link", { name: "Centre" })).toHaveAttribute(
      "href",
      `/curriculum-summary?${filters}&sort=centre&dir=asc&limit=50`
    );

    expect(screen.getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary?regions=NORTH&regions=SOUTH&q=jnv&grade=12&as_of=2026-08-15&only_behind=1&sort=pcb&dir=desc&limit=50"
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      `/curriculum-summary?${filters}&sort=pcb&dir=desc&limit=50&page=3`
    );
    // Apply carries the sort; changing the page size keeps it.
    expect(document.querySelector('input[type="hidden"][name="sort"]')).toHaveValue("pcb");
    expect(document.querySelector('input[type="hidden"][name="dir"]')).toHaveValue("desc");
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "20" } });
    expect(mockPush).toHaveBeenCalledWith(`/curriculum-summary?${filters}&sort=pcb&dir=desc`);
  });

  it("shows an ascending arrow and ignores an unknown sort", async () => {
    await renderPage({ as_of: "2026-08-15", sort: "centre", dir: "asc" });

    const centre = screen.getByRole("columnheader", { name: "Centre" });
    expect(centre).toHaveAttribute("aria-sort", "ascending");
    expect(within(centre).getByText("▲")).toBeInTheDocument();
    expect(within(centre).getByRole("link", { name: "Centre" })).toHaveAttribute(
      "href",
      "/curriculum-summary?grade=11&as_of=2026-08-15&sort=centre&dir=desc"
    );

    vi.mocked(mockGetCurriculumSummary).mockClear();
    await renderPage({ as_of: "2026-08-15", sort: "school", dir: "asc" });
    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(PM, expect.objectContaining({ sort: null }));
  });

  // QA-03: Back / Forward and the page-size select change the URL under a mounted page; the
  // filter controls must show the new URL, not what was last typed or ticked.
  it("re-renders the filter controls from the URL when it changes", async () => {
    const { rerender } = render(
      await CurriculumSummaryPage({
        searchParams: Promise.resolve({ as_of: "2026-08-15", regions: "NORTH", q: "jnv", only_behind: "1" }),
      })
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "SOUTH" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "School" }), { target: { value: "unapplied" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Only behind" }));

    rerender(await CurriculumSummaryPage({ searchParams: Promise.resolve({ as_of: "2026-08-10", regions: "SOUTH" }) }));

    expect(screen.getByRole("checkbox", { name: "NORTH" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SOUTH" })).toBeChecked();
    expect(screen.getByRole("searchbox", { name: "School" })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Only behind" })).not.toBeChecked();
    expect(screen.getByLabelText("As of")).toHaveValue("2026-08-10");

    // A page brought back from the back/forward cache drops edits that were never applied.
    fireEvent.change(screen.getByRole("searchbox", { name: "School" }), { target: { value: "unapplied" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "NORTH" }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(screen.getByRole("searchbox", { name: "School" })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "NORTH" })).not.toBeChecked();
  });

  it("disables paging past either end and drops defaults from links", async () => {
    mockGetCurriculumSummary.mockResolvedValue(
      summary({ pagination: { page: 1, pageSize: 20, totalRows: 1, totalPages: 1 }, regionOptions: [] })
    );

    await renderPage({ as_of: "2026-08-15" });

    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(document.querySelector('input[type="hidden"][name="limit"]')).toBeNull();
    expect(screen.getByText("No regions in scope")).toBeInTheDocument();
    expect(screen.getByText("All regions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary?grade=12&as_of=2026-08-15"
    );
  });

  it.each([
    [{}, "No Centres with Exam Tracks for Grade 11 are in your scope."],
    [{ q: "x" }, "No classes match these filters."],
    [{ regions: "NORTH" }, "No classes match these filters."],
    [{ only_behind: "1" }, "No classes match these filters."],
  ])("explains an empty list for %j", async (searchParams, message) => {
    mockGetCurriculumSummary.mockResolvedValue(
      summary({ rows: [], pagination: { page: 1, pageSize: 20, totalRows: 0, totalPages: 0 } })
    );

    await renderPage(searchParams);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("gives Admins the Plans and config links", async () => {
    mockGetResolvedPermission.mockResolvedValue(ADMIN);

    await renderPage();

    expect(screen.getByRole("link", { name: "Plans" })).toHaveAttribute("href", "/curriculum-summary/plans");
    expect(screen.getByRole("link", { name: "Manage config" })).toHaveAttribute(
      "href",
      "/curriculum-summary/config"
    );
  });
});
