import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockGetResolvedPermission, mockGetChapterTimeline } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetResolvedPermission: vi.fn(),
  mockGetChapterTimeline: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getResolvedPermission: mockGetResolvedPermission,
}));
vi.mock("@/lib/curriculum-summary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/curriculum-summary")>()),
  getChapterTimeline: mockGetChapterTimeline,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import type { ChapterTimeline, ChapterTimelineChapter } from "@/lib/curriculum-summary";
import ChapterTimelinePage from "./page";

const PM = {
  email: "pm@avantifellows.org",
  level: 2,
  role: "program_manager",
  regions: ["NORTH"],
  program_ids: [1, 2],
  read_only: false,
};
const ADMIN = { ...PM, role: "admin", level: 3 };
const AS_OF = "2026-08-15";

function chapter(overrides: Partial<ChapterTimelineChapter>): ChapterTimelineChapter {
  return {
    chapterId: 1,
    code: "P1",
    name: "Motion",
    subject: "Physics",
    dueDate: "2026-06-30",
    completedOn: "2026-06-28",
    status: { kind: "done" },
    testStatus: { kind: "conducted", conductedOn: "2026-07-02" },
    taughtMinutes: 90,
    prescribedMinutes: 120,
    cancellations: 1,
    doubtSolvingMinutes: 0,
    ...overrides,
  };
}

const CHAPTERS: ChapterTimelineChapter[] = [
  chapter({}),
  chapter({
    chapterId: 2,
    name: "Bonding",
    subject: "Chemistry",
    dueDate: "2026-07-15",
    completedOn: "2026-07-20",
    status: { kind: "done_late", days: 5 },
    testStatus: { kind: "overdue" },
  }),
  chapter({
    chapterId: 3,
    name: "Cells",
    subject: "Biology",
    dueDate: "2026-08-14",
    completedOn: null,
    status: { kind: "overdue", days: 1 },
    testStatus: { kind: "scheduled" },
  }),
  chapter({
    chapterId: 4,
    name: "Genetics",
    subject: "Biology",
    dueDate: "2026-09-01",
    completedOn: null,
    status: { kind: "not_due" },
    testStatus: { kind: "not_due" },
    taughtMinutes: 0,
  }),
  chapter({
    chapterId: 5,
    name: "Ecology",
    subject: "Biology",
    dueDate: null,
    completedOn: null,
    status: { kind: "not_in_plan" },
    testStatus: { kind: "not_due" },
  }),
];

function timeline(overrides: Partial<ChapterTimeline> = {}, row: Partial<ChapterTimeline["row"]> = {}): ChapterTimeline {
  return {
    grade: 11,
    grades: [11],
    asOf: AS_OF,
    hoursWindow: "ay",
    row: {
      centreId: 7,
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
      subjects: null,
      behind: 2,
      testsOverdue: 1,
      testsConducted: null,
      ...row,
    },
    subjects: [
      { subject: "Physics", progress: { due: 1, done: 1, behind: 0, tone: "green", label: "On track" } },
      { subject: "Chemistry", progress: { due: 1, done: 1, behind: 0, tone: "green", label: "On track" } },
      { subject: "Biology", progress: { due: 1, done: 0, behind: 1, tone: "amber", label: "1 behind" } },
    ],
    chapters: CHAPTERS,
    header: {
      due: 3,
      done: 2,
      syllabusDone: 2,
      syllabusTotal: 5,
      testsOverdue: 1,
      taughtMinutes: 450,
      prescribedMinutes: 600,
      cancellations: 5,
      doubtSolvingMinutes: 45,
    },
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string | string[]> = {}, id = "7") {
  render(
    await ChapterTimelinePage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({ grade: "11", as_of: AS_OF, ...searchParams }),
    })
  );
}

const timelineRow = (name: string) =>
  document.querySelector(`[data-timeline-row][data-chapter="${name}"]`) as HTMLElement;

beforeEach(() => {
  vi.resetAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: PM.email } });
  mockGetResolvedPermission.mockResolvedValue(PM);
  mockGetChapterTimeline.mockResolvedValue({ ok: true, timeline: timeline() });
});

describe("Chapter timeline page access", () => {
  it("sends a signed-out visitor to the sign-in page", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });
    await expect(renderPage()).rejects.toThrow("REDIRECT:/");
  });

  it("uses the Summary's gate", async () => {
    mockGetResolvedPermission.mockResolvedValue({ ...PM, role: "teacher" });
    await expect(renderPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockGetChapterTimeline).not.toHaveBeenCalled();
  });

  it("is not found for a Centre outside the user's rows", async () => {
    mockGetChapterTimeline.mockResolvedValue({ ok: false, status: 404 });
    await expect(renderPage({}, "99")).rejects.toThrow("NOT_FOUND");
  });
});

describe("Chapter timeline page", () => {
  it("reads Grade, as-of and hours window, and falls back to This AY", async () => {
    await renderPage({ grade: "12", hours: "30d" });
    expect(mockGetChapterTimeline).toHaveBeenCalledWith(PM, 7, { grade: 12, asOf: AS_OF, hoursWindow: "30d" });

    await renderPage({ hours: ["weekly"] });
    expect(mockGetChapterTimeline).toHaveBeenLastCalledWith(PM, 7, { grade: 11, asOf: AS_OF, hoursWindow: "ay" });
  });

  it("shows the schema-unavailable card", async () => {
    mockGetChapterTimeline.mockResolvedValue({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_curriculum_plans.id"],
    });

    await renderPage();

    expect(screen.getByText("Schema unavailable")).toBeInTheDocument();
    expect(screen.getByText("lms_curriculum_plans.id")).toBeInTheDocument();
    expect(screen.getByText("Chapter timeline")).toBeInTheDocument();
  });

  it("shows the class, header numbers and every Chapter's statuses", async () => {
    await renderPage();

    expect(screen.getByText("Anand Shared")).toBeInTheDocument();
    expect(screen.getByText("JNV Anand · JNV Nodal · JEE Main + NEET · Grade 11")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-due-done")).toHaveTextContent("2/3");
    expect(screen.getByTestId("timeline-syllabus-done")).toHaveTextContent("2/5");
    expect(screen.getByTestId("timeline-tests-overdue")).toHaveTextContent("1");
    expect(screen.getByTestId("timeline-hours")).toHaveTextContent("7h 30m / 10h");
    expect(screen.getByText("Hours vs prescribed · This AY")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-cancellations")).toHaveTextContent("5");
    expect(screen.getByTestId("timeline-doubt-solving")).toHaveTextContent("45m");

    const expected: [string, string, string, string][] = [
      ["Motion", "Done", "28 Jun 2026", "Conducted 2 Jul 2026"],
      ["Bonding", "Done 5 days late", "20 Jul 2026", "Overdue"],
      ["Cells", "Overdue 1 day", "—", "Scheduled"],
      ["Genetics", "Not due", "—", "Not due"],
      ["Ecology", "Not in plan", "—", "Not due"],
    ];
    for (const [name, status, completedOn, testStatus] of expected) {
      const tableRow = timelineRow(name);
      expect(tableRow.querySelector("[data-status]")).toHaveTextContent(status);
      expect(tableRow.querySelector("[data-completed-on]")).toHaveTextContent(completedOn);
      expect(tableRow.querySelector("[data-test-status]")).toHaveTextContent(testStatus);
    }
    expect(timelineRow("Motion").querySelector("[data-hours]")).toHaveTextContent("1h 30m");
    expect(timelineRow("Motion").querySelector("[data-prescribed]")).toHaveTextContent("2h");
    expect(timelineRow("Motion").querySelector("[data-cancellations]")).toHaveTextContent("1");
    expect(timelineRow("Motion").querySelector("[data-doubt-solving]")).toHaveTextContent("0h");
    expect(timelineRow("Genetics").querySelector("[data-hours]")).toHaveTextContent("0h");
    expect(timelineRow("Ecology")).toHaveTextContent("—");
  });

  it("puts the as-of marker after the Chapters due by as-of", async () => {
    await renderPage();

    const order = [...document.querySelectorAll("[data-timeline-row], [data-as-of-marker]")].map((element) =>
      element.hasAttribute("data-as-of-marker") ? "AS OF" : element.getAttribute("data-chapter")
    );
    expect(order).toEqual(["Motion", "Bonding", "Cells", "AS OF", "Genetics", "Ecology"]);
    expect(document.querySelector("[data-as-of-marker]")).toHaveTextContent("As of 15 Aug 2026");
  });

  it("puts the marker last when every Chapter is due, and leaves it out without plan dates", async () => {
    mockGetChapterTimeline.mockResolvedValue({ ok: true, timeline: timeline({ chapters: CHAPTERS.slice(0, 2) }) });
    await renderPage();
    const last = document.querySelector("tbody")?.lastElementChild;
    expect(last).toHaveAttribute("data-as-of-marker");

    document.body.innerHTML = "";
    mockGetChapterTimeline.mockResolvedValue({
      ok: true,
      timeline: timeline({ chapters: [CHAPTERS[4]] }, { kind: "no_plan", plan: null }),
    });
    await renderPage();
    expect(document.querySelector("[data-as-of-marker]")).toBeNull();
  });

  it("filters to a subject tab and keeps the window and subject in every link", async () => {
    mockGetChapterTimeline.mockResolvedValue({ ok: true, timeline: timeline({ hoursWindow: "7d" }) });

    await renderPage({ subject: "Biology", hours: "7d" });

    expect(document.querySelectorAll("[data-timeline-row]")).toHaveLength(3);
    const tabs = screen.getByRole("navigation", { name: "Subject" });
    expect(within(tabs).getByRole("link", { name: /Biology/ })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/curriculum-summary/centres/7?grade=11&as_of=2026-08-15&hours=7d"
    );
    expect(document.querySelector('[data-subject-tab="Biology"] [data-tab-progress]')).toHaveTextContent(
      "1 behind · 0/1"
    );
    const windows = screen.getByRole("navigation", { name: "Hours window" });
    expect(within(windows).getByRole("link", { name: "This AY" })).toHaveAttribute(
      "href",
      "/curriculum-summary/centres/7?grade=11&as_of=2026-08-15&subject=Biology"
    );
    expect(within(windows).getByRole("link", { name: "Last 7 days" })).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('input[type="hidden"][name="hours"]')).toHaveValue("7d");
    expect(document.querySelector('input[type="hidden"][name="subject"]')).toHaveValue("Biology");
  });

  it("ignores an unknown subject", async () => {
    await renderPage({ subject: "Astronomy" });

    expect(document.querySelectorAll("[data-timeline-row]")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('input[type="hidden"][name="subject"]')).toBeNull();
    expect(document.querySelector('input[type="hidden"][name="hours"]')).toBeNull();
  });

  it("links only the Grades the Centre has a class for", async () => {
    await renderPage();

    const grades = screen.getByRole("navigation", { name: "Grade" });
    expect(within(grades).getByRole("link", { name: "Grade 11" })).toHaveAttribute("aria-current", "page");
    expect(within(grades).queryByRole("link", { name: "Grade 12" })).not.toBeInTheDocument();
    expect(within(grades).getByText("Grade 12")).toHaveAttribute("aria-disabled", "true");

    document.body.innerHTML = "";
    mockGetChapterTimeline.mockResolvedValue({ ok: true, timeline: timeline({ grades: [11, 12] }) });
    await renderPage();
    expect(screen.getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary/centres/7?grade=12&as_of=2026-08-15"
    );
  });

  it("shows the plan name to everyone and links it for Admins only", async () => {
    await renderPage();
    expect(document.querySelector("[data-timeline-plan]")).toHaveTextContent("G11 Plan");
    expect(screen.queryByRole("link", { name: "G11 Plan" })).not.toBeInTheDocument();

    document.body.innerHTML = "";
    mockGetResolvedPermission.mockResolvedValue(ADMIN);
    mockGetChapterTimeline.mockResolvedValue({
      ok: true,
      timeline: timeline({}, { plan: { id: 900, title: "G11 Plan", closed: true } }),
    });
    await renderPage();
    expect(screen.getByRole("link", { name: "G11 Plan" })).toHaveAttribute("href", "/curriculum-summary/plans/900");
    expect(document.querySelector("[data-timeline-plan-closed]")).toHaveTextContent("Closed");
  });

  it("shows No plan with dashes for plan-only header numbers", async () => {
    mockGetChapterTimeline.mockResolvedValue({
      ok: true,
      timeline: timeline({}, { kind: "no_plan", plan: null }),
    });

    await renderPage();

    expect(document.querySelector("[data-timeline-plan]")).toHaveTextContent("No plan");
    expect(screen.getByTestId("timeline-due-done")).toHaveTextContent("—");
    expect(screen.getByTestId("timeline-tests-overdue")).toHaveTextContent("—");
  });

  it("shows the Summary's message instead of metrics for a class it can't measure", async () => {
    mockGetChapterTimeline.mockResolvedValue({
      ok: true,
      timeline: timeline(
        { chapters: [], subjects: [] },
        { kind: "setup_error", explanation: "Fix tracks in Centre Management", plan: null }
      ),
    });

    await renderPage({ subject: "Biology" });

    expect(screen.getByTestId("timeline-explanation")).toHaveTextContent("Fix tracks in Centre Management");
    expect(document.querySelector("[data-timeline-row]")).toBeNull();
    expect(screen.queryByTestId("timeline-due-done")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Grade" })).toBeInTheDocument();
  });
});
