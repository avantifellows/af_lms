import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

import type {
  CurriculumSummaryQuery,
  CurriculumSummaryResult,
  CurriculumSummaryRow,
} from "@/lib/curriculum-summary";
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
    testsOverdue: 3,
    testsOverdueBySubject: { Physics: 1, Chemistry: 0, Maths: 0, Biology: 2 },
    testsConducted: null,
    ...overrides,
  };
}

const CENTRE_OPTIONS = [
  { id: 1, name: "Anand Shared" },
  { id: 2, name: "Bhuj Closed" },
  { id: 3, name: "Surat" },
  { id: 4, name: "Vapi" },
];

// Like the module: the requested Centre ids that are options, in option order.
const PROGRAM_OPTIONS = [
  { id: 1, name: "JNV CoE" },
  { id: 2, name: "JNV Nodal" },
];

function selectedPrograms(params: CurriculumSummaryQuery): number[] {
  return PROGRAM_OPTIONS.filter((option) => params.programIds.includes(option.id)).map((option) => option.id);
}

function selectedCentres(params: CurriculumSummaryQuery): number[] {
  return CENTRE_OPTIONS.filter((option) => params.centreIds.includes(option.id)).map((option) => option.id);
}

function summary(overrides: Partial<Extract<CurriculumSummaryResult, { ok: true }>> = {}): CurriculumSummaryResult {
  return {
    ok: true,
    regionOptions: ["NORTH", "SOUTH"],
    programOptions: PROGRAM_OPTIONS,
    centreOptions: CENTRE_OPTIONS,
    selectedProgramIds: [],
    selectedCentreIds: [],
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

// A pill cell: the pill alone (never wrapping), "done/due done" under it in small grey text, and
// one phrase for screen readers in place of both.
// One tag holds the pill label over "done/due done"; screen readers get the spoken phrase.
function expectProgress(cell: Element | null, pill: string, done: string, spoken: string) {
  const badge = cell?.querySelector("[data-tone]");
  expect(badge?.querySelector("[data-label]")).toHaveTextContent(new RegExp(`^${pill}$`));
  expect(badge?.querySelector("[data-done]")).toHaveTextContent(new RegExp(`^${done}$`));
  expect(badge).toHaveClass("flex-col", "whitespace-nowrap", "rounded-full");
  expect(badge).toHaveAttribute("aria-hidden", "true");
  expect(cell?.querySelector("[data-progress-text]")).toHaveTextContent(new RegExp(`^${spoken}$`));
}

const summaryRow = (centre: string) =>
  document.querySelector(`[data-summary-row][data-centre="${centre}"]`) as HTMLElement;

beforeEach(() => {
  vi.resetAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: PM.email } });
  mockGetResolvedPermission.mockResolvedValue(PM);
  mockGetCurriculumSummary.mockImplementation(async (_permission, params: CurriculumSummaryQuery) =>
    summary({ selectedProgramIds: selectedPrograms(params), selectedCentreIds: selectedCentres(params) })
  );
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

  it("passes the normalized filters and shows no header numbers", async () => {
    await renderPage({ grade: "12", as_of: "2026-08-15", regions: "NORTH", centres: "1", only_behind: "1", page: "2", limit: "50" });

    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(PM, {
      programIds: [],
      regions: ["NORTH"],
      centreIds: [1],
      grade: 12,
      asOf: "2026-08-15",
      onlyBehind: true,
      sort: null,
      page: 2,
      pageSize: 50,
    });
    // The header cards were removed (curriculum owner feedback).
    for (const label of ["Centres on plan", "PCM chapters behind", "PCB chapters behind", "Chapter tests overdue"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
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
    expectProgress(plan.querySelector('[data-subject="Physics"]'), "1 behind", "1/2 done", "1 behind, 1 of 2 due chapters done");
    expect(plan.querySelector('[data-subject="Physics"] [data-tone]')).toHaveAttribute("data-tone", "amber");
    expect(plan.querySelector('[data-subject="Maths"]')).toHaveTextContent("—");
    // Group cells read like the subject pills: Behind, then done/due.
    expectProgress(plan.querySelector('[data-subject-group="PCM"]'), "1 behind", "2/3 done", "1 behind, 2 of 3 due chapters done");
    expect(plan.querySelector('[data-subject-group="PCM"] [data-tone]')).toHaveAttribute("data-tone", "amber");
    expectProgress(plan.querySelector('[data-subject-group="PCB"]'), "5 behind", "2/7 done", "5 behind, 2 of 7 due chapters done");
    expect(plan.querySelector('[data-subject-group="PCB"] [data-tone]')).toHaveAttribute("data-tone", "red");
    // Tests overdue sit under their subject's tag only, and only when there are any.
    expect(plan.querySelector('[data-subject="Physics"] [data-tests-overdue]')).toHaveTextContent(/^1 test overdue$/);
    expect(plan.querySelector('[data-subject="Biology"] [data-tests-overdue]')).toHaveTextContent(/^2 tests overdue$/);
    expect(plan.querySelector('[data-subject="Biology"] [data-tests-overdue]')).toHaveClass("text-xs");
    expect(plan.querySelector('[data-subject="Chemistry"] [data-tests-overdue]')).toBeNull();
    expect(plan.querySelector("[data-subject-group] [data-tests-overdue]")).toBeNull();
    expect(plan.querySelector("[data-plan]")).toHaveTextContent("G11 Plan");
    expect(plan.querySelector("[data-plan-closed]")).toBeNull();

    const closed = summaryRow("Bhuj Closed");
    expect(closed.querySelector("[data-plan-closed]")).toHaveTextContent("Closed");
    expectProgress(closed.querySelector('[data-subject-group="PCM"]'), "On track", "2/2 done", "On track, 2 of 2 due chapters done");
    expect(closed.querySelector('[data-subject-group="PCM"] [data-tone]')).toHaveAttribute("data-tone", "green");
    // PCB doesn't apply to a JEE Main class.
    expect(closed.querySelector('[data-subject-group="PCB"]')).toHaveTextContent("—");
    expect(closed.querySelector('[data-subject-group="PCB"] [data-tone]')).toBeNull();

    const noPlan = summaryRow("Surat");
    expect(noPlan.querySelector("[data-not-measured]")).toHaveTextContent(
      /^Not measured without an Active plan · 1 test conducted$/
    );
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
      "Plan",
    ]);
    const width = (centre: string) =>
      [...summaryRow(centre).querySelectorAll("td")].reduce((sum, cell) => sum + cell.colSpan, 0);
    expect(["Anand Shared", "Bhuj Closed", "Surat", "Vapi"].map(width)).toEqual([11, 11, 11, 11]);
  });

  it("says chapter for a single due Chapter and keeps Program and track names on one line", async () => {
    mockGetCurriculumSummary.mockResolvedValue(
      summary({
        rows: [
          row({
            tracksLabel: "JEE Main + JEE Advanced",
            subjects: {
              Physics: { due: 1, done: 0, behind: 1, tone: "amber", label: "1 behind" },
              Chemistry: null,
              Maths: null,
              Biology: null,
            },
          }),
        ],
      })
    );

    await renderPage();

    const plan = summaryRow("Anand Shared");
    expectProgress(plan.querySelector('[data-subject="Physics"]'), "1 behind", "0/1 done", "1 behind, 0 of 1 due chapter done");
    const [, program, tracks] = plan.querySelectorAll("td");
    expect(program).toHaveClass("whitespace-nowrap");
    expect(tracks).toHaveTextContent(/^JEE Main \+ JEE Advanced$/);
    expect([...tracks.querySelectorAll(".whitespace-nowrap")].map((track) => track.textContent)).toEqual([
      "JEE Main",
      "JEE Advanced",
    ]);
  });

  it("makes the subject and PCM / PCB Behind columns wide and centred, and the others compact", async () => {
    await renderPage({ sort: "pcm", dir: "desc" });

    const header = (name: string) => screen.getByRole("columnheader", { name });
    for (const name of ["Physics", "Chemistry", "Maths", "Biology", "PCM Behind", "PCB Behind"]) {
      expect(header(name)).toHaveClass("w-[7.5rem]", "text-center");
    }
    // The sort link and aria-sort are unchanged by the layout.
    expect(header("PCM Behind")).toHaveAttribute("aria-sort", "descending");
    expect(within(header("PCM Behind")).getByRole("link", { name: "PCM Behind" })).toBeInTheDocument();
    for (const name of ["Program", "Tracks", "Region", "Plan"]) {
      expect(header(name)).toHaveClass("px-2", "text-left");
    }
    expect(header("Centre")).toHaveClass("px-4", "text-left");

    const plan = summaryRow("Anand Shared");
    expect(plan.querySelector('[data-subject="Physics"]')).toHaveClass("text-center");
    expect(plan.querySelector('[data-subject-group="PCB"]')).toHaveClass("text-center");
    expect(plan.querySelector("[data-plan]")).toHaveClass("text-xs");
    expect(within(plan).getByRole("link", { name: "Anand Shared" })).toHaveClass("max-w-[11rem]");
    // "Not measured" still spans the measured columns.
    expect(summaryRow("Surat").querySelector("td[colspan]")).toHaveAttribute("colspan", "6");
  });

  it("counts a No plan row without a conducted count as 0 tests", async () => {
    mockGetCurriculumSummary.mockResolvedValue(
      summary({ rows: [row({ kind: "no_plan", plan: null, subjects: null, testsConducted: null })] })
    );

    await renderPage();

    expect(document.querySelector("[data-not-measured]")).toHaveTextContent(
      /^Not measured without an Active plan · 0 tests conducted$/
    );
  });

  it("keeps every filter in the Grade, pagination and page-size links", async () => {
    await renderPage({ grade: "11", as_of: "2026-08-15", regions: ["NORTH", "SOUTH"], centres: ["2", "1"], only_behind: "1", page: "2", limit: "50" });

    const grades = screen.getByRole("navigation", { name: "Grade" });
    expect(within(grades).getByRole("link", { name: "Grade 11" })).toHaveAttribute("aria-current", "page");
    expect(within(grades).getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary?regions=NORTH&regions=SOUTH&centres=1&centres=2&grade=12&as_of=2026-08-15&only_behind=1&limit=50"
    );
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/curriculum-summary?regions=NORTH&regions=SOUTH&centres=1&centres=2&grade=11&as_of=2026-08-15&only_behind=1&limit=50"
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/curriculum-summary?regions=NORTH&regions=SOUTH&centres=1&centres=2&grade=11&as_of=2026-08-15&only_behind=1&limit=50&page=3"
    );
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(document.querySelector('input[type="hidden"][name="limit"]')).toHaveValue("50");
    expect(screen.getByRole("checkbox", { name: "NORTH" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Only behind" })).toBeChecked();

    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "20" } });
    expect(mockPush).toHaveBeenCalledWith(
      "/curriculum-summary?regions=NORTH&regions=SOUTH&centres=1&centres=2&grade=11&as_of=2026-08-15&only_behind=1"
    );
  });

  it("puts the How to read this page guide beside the title", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Curriculum Summary" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "How to read this page" }));
    const guide = screen.getByRole("dialog", { name: "How to read this page" });
    const items = within(guide).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Each row is one class (Centre + Grade), checked against its Active Curriculum Plan on the As of date.",
      "“3 behind · 4/6 done”: 6 chapters were due by the As of date. 4 are completed and 3 are not. Green = on track, amber = 1–2 behind, red = 3 or more behind.",
      "PCM / PCB Behind: chapters behind across Physics + Chemistry + Maths (PCM) or Physics + Chemistry + Biology (PCB). JEE classes show PCM, NEET classes show PCB, JEE + NEET classes show both.",
      "Tests overdue: a chapter’s test is overdue if no test was conducted within 7 days after its test date.",
      "“Not measured”: the class has no Active plan yet.",
      "Click a column name to sort. Click a Centre to see its chapters.",
    ]);
    expect([...guide.querySelectorAll("strong")].map((term) => term.textContent)).toEqual([
      "one class",
      "Active Curriculum Plan",
      "As of",
      "“3 behind · 4/6 done”",
      "PCM / PCB Behind",
      "Tests overdue",
      "“Not measured”",
    ]);
  });

  it("treats the removed Tests overdue sort as the default order", async () => {
    await renderPage({ sort: "tests_overdue", dir: "desc" });

    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(PM, expect.objectContaining({ sort: null }));
    expect(screen.queryByRole("columnheader", { name: /Tests overdue/ })).not.toBeInTheDocument();
    expect(document.querySelector("[aria-sort]")).toBeNull();
    expect(document.querySelector('input[type="hidden"][name="sort"]')).toBeNull();
  });

  it("links every column header to its first-click sort from page 1, without an arrow", async () => {
    await renderPage({ grade: "11", as_of: "2026-08-15", page: "2" });

    const header = (name: string) => screen.getByRole("columnheader", { name });
    const sortLink = (name: string) => within(header(name)).getByRole("link", { name });
    // Text columns start A–Z; the measured columns most behind first.
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
      centres: ["2", "1"],
      only_behind: "1",
      sort: "pcb",
      dir: "desc",
      page: "2",
      limit: "50",
    });

    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(PM, expect.objectContaining({ sort: { key: "pcb", dir: "desc" } }));
    const filters = "regions=NORTH&regions=SOUTH&centres=1&centres=2&grade=11&as_of=2026-08-15&only_behind=1";
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
      "/curriculum-summary?regions=NORTH&regions=SOUTH&centres=1&centres=2&grade=12&as_of=2026-08-15&only_behind=1&sort=pcb&dir=desc&limit=50"
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
        searchParams: Promise.resolve({ as_of: "2026-08-15", regions: "NORTH", centres: "1", only_behind: "1" }),
      })
    );
    const centreSearch = () => screen.getByRole("searchbox", { name: "Search centres" });
    // Options sit in a closed <details>; the search hides a non-matching option's label, which
    // also leaves its checkbox without an accessible name, so find it by Centre id.
    const optionHidden = (centreId: number) =>
      (document.querySelector(`input[name="centres"][value="${centreId}"]`)?.closest("label") as HTMLLabelElement)
        .hidden;
    fireEvent.click(screen.getByRole("checkbox", { name: "SOUTH" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "JNV Nodal" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bhuj Closed" }));
    fireEvent.change(centreSearch(), { target: { value: "vapi" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Only behind" }));

    rerender(
      await CurriculumSummaryPage({
        searchParams: Promise.resolve({ as_of: "2026-08-10", programs: "1", regions: "SOUTH" }),
      })
    );

    expect(screen.getByRole("checkbox", { name: "NORTH" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SOUTH" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "JNV CoE" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "JNV Nodal" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Anand Shared" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bhuj Closed" })).not.toBeChecked();
    expect(centreSearch()).toHaveValue("");
    expect(optionHidden(3)).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Only behind" })).not.toBeChecked();
    expect(screen.getByLabelText("As of")).toHaveValue("2026-08-10");

    // A page brought back from the back/forward cache drops edits that were never applied.
    fireEvent.change(centreSearch(), { target: { value: "vapi" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "NORTH" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Vapi" }));
    expect(optionHidden(3)).toBe(true);
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(screen.getByRole("checkbox", { name: "NORTH" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Vapi" })).not.toBeChecked();
    expect(centreSearch()).toHaveValue("");
    expect(optionHidden(3)).toBe(false);
  });

  it("picks Programs by id, before Region and Centre, and ignores ids that aren't options", async () => {
    await renderPage({ as_of: "2026-08-15", programs: ["2", "64"], regions: "NORTH", sort: "plan", dir: "asc" });

    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(PM, expect.objectContaining({ programIds: [2, 64] }));
    expect(screen.getByText("JNV Nodal", { selector: "summary span" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "JNV Nodal" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "JNV CoE" })).not.toBeChecked();
    // Grade, Program, Region, Centre.
    expect([...document.querySelectorAll("summary")].map((summary) => summary.firstChild?.textContent)).toEqual([
      "Program",
      "Region",
      "Centre",
    ]);
    // Program 64 isn't an option, so links carry only 2; the sort and Region stay.
    expect(screen.getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary?programs=2&regions=NORTH&grade=12&as_of=2026-08-15&sort=plan&dir=asc"
    );
    expect(within(screen.getByRole("columnheader", { name: "Centre" })).getByRole("link")).toHaveAttribute(
      "href",
      "/curriculum-summary?programs=2&regions=NORTH&grade=11&as_of=2026-08-15&sort=centre&dir=asc"
    );
  });

  it("picks Centres by id from the scoped options and ignores ids that aren't options", async () => {
    await renderPage({ as_of: "2026-08-15", centres: ["4", "99", "2"] });

    expect(mockGetCurriculumSummary).toHaveBeenCalledWith(PM, expect.objectContaining({ centreIds: [4, 99, 2] }));
    // The summary button names the applied Centres, A–Z; 99 is not an option, so it's dropped.
    expect(screen.getByText("Bhuj Closed, Vapi")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: /^(Anand Shared|Bhuj Closed|Surat|Vapi)$/ }).map((box) => [
      (box as HTMLInputElement).value,
      (box as HTMLInputElement).checked,
    ])).toEqual([
      ["1", false],
      ["2", true],
      ["3", false],
      ["4", true],
    ]);
    expect(screen.getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary?centres=2&centres=4&grade=12&as_of=2026-08-15"
    );
    expect(screen.queryByRole("searchbox", { name: "School" })).not.toBeInTheDocument();
  });

  it("disables paging past either end and drops defaults from links", async () => {
    mockGetCurriculumSummary.mockResolvedValue(
      summary({
        pagination: { page: 1, pageSize: 20, totalRows: 1, totalPages: 1 },
        programOptions: [],
        regionOptions: [],
        centreOptions: [],
      })
    );

    await renderPage({ as_of: "2026-08-15" });

    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(document.querySelector('input[type="hidden"][name="limit"]')).toBeNull();
    expect(screen.getByText("No programs in scope")).toBeInTheDocument();
    expect(screen.getByText("No regions in scope")).toBeInTheDocument();
    expect(screen.getByText("No centres in scope")).toBeInTheDocument();
    expect(screen.getByText("All programs")).toBeInTheDocument();
    expect(screen.getByText("All regions")).toBeInTheDocument();
    expect(screen.getByText("All centres")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary?grade=12&as_of=2026-08-15"
    );
  });

  it.each([
    [{}, "No Centres with Exam Tracks for Grade 11 are in your scope."],
    [{ programs: "1" }, "No classes match these filters."],
    [{ centres: "1" }, "No classes match these filters."],
    [{ regions: "NORTH" }, "No classes match these filters."],
    [{ only_behind: "1" }, "No classes match these filters."],
  ])("explains an empty list for %j", async (searchParams, message) => {
    mockGetCurriculumSummary.mockImplementation(async (_permission, params: CurriculumSummaryQuery) =>
      summary({
        rows: [],
        selectedProgramIds: selectedPrograms(params),
        selectedCentreIds: selectedCentres(params),
        pagination: { page: 1, pageSize: 20, totalRows: 0, totalPages: 0 },
      })
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
