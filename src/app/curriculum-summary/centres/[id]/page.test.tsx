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

// PCM: Motion and Bonding, both due and done. PCB: Cells is due and open too.
const PCM_ON_TRACK = { due: 2, done: 2, behind: 0, tone: "green", label: "On track" } as const;
const PCB_BEHIND = { due: 3, done: 2, behind: 1, tone: "amber", label: "1 behind" } as const;

type GroupStatus = ChapterTimeline["header"]["subjectGroups"][number];

function withGroups(subjectGroups: GroupStatus[], row: Partial<ChapterTimeline["row"]> = {}): ChapterTimeline {
  const base = timeline({}, row);
  return { ...base, header: { ...base.header, subjectGroups } };
}

const groupCard = (group: string) => screen.getByTestId(`timeline-${group.toLowerCase()}-status`);

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
      subjectGroups: null,
      testsOverdue: 1,
      testsOverdueBySubject: { Physics: 0, Chemistry: 1, Maths: 0, Biology: 0 },
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
      subjectGroups: [
        { group: "PCM", progress: PCM_ON_TRACK, syllabusDone: 2, syllabusTotal: 2 },
        { group: "PCB", progress: PCB_BEHIND, syllabusDone: 2, syllabusTotal: 5 },
      ],
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

// Chapter names in table order, with "AS OF" for the As of line.
const tableOrder = () =>
  [...document.querySelectorAll("[data-timeline-row], [data-as-of-marker]")].map((element) =>
    element.hasAttribute("data-as-of-marker") ? "AS OF" : element.getAttribute("data-chapter")
  );

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
    expect(screen.getByTestId("timeline-tests-overdue")).toHaveTextContent("1");
    expect(screen.getByTestId("timeline-hours")).toHaveTextContent(/^7h 30m$/);
    expect(screen.getByTestId("timeline-prescribed")).toHaveTextContent(/^of 10h prescribed$/);
    expect(screen.getByText("Hours taught · This AY")).toBeInTheDocument();
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

  it("shows PCM and PCB syllabus status cards for a shared class, all six cards on one row", async () => {
    await renderPage();

    const pcm = groupCard("PCM");
    expect(pcm).toHaveTextContent("PCM syllabus status");
    expect(pcm.querySelector("[data-status-label]")).toHaveTextContent("On track");
    expect(pcm.querySelector("[data-status-label]")).toHaveAttribute("data-tone", "green");
    expect(pcm.querySelector("[data-status-label]")).toHaveClass("bg-green-100", "text-green-800", "text-xl", "whitespace-nowrap");
    expect(pcm.querySelector("[data-due-done]")).toHaveTextContent(/^2\/2 due done$/);
    expect(pcm.querySelector("[data-syllabus-done]")).toHaveTextContent(/^2\/2 syllabus done$/);

    const pcb = groupCard("PCB");
    expect(pcb.querySelector("[data-status-label]")).toHaveTextContent("1 behind");
    expect(pcb.querySelector("[data-status-label]")).toHaveClass("bg-warning-bg", "text-warning-text");
    expect(pcb.querySelector("[data-due-done]")).toHaveTextContent(/^2\/3 due done$/);
    expect(pcb.querySelector("[data-syllabus-done]")).toHaveTextContent(/^2\/5 syllabus done$/);

    // The cards replace Due done and Syllabus done; PCM and PCB lead the one row of six.
    expect(screen.queryByText("Due done")).not.toBeInTheDocument();
    expect(screen.queryByText("Syllabus done")).not.toBeInTheDocument();
    const grid = pcm.parentElement as HTMLElement;
    expect(grid).toHaveClass("xl:grid-cols-6");
    expect([...grid.children].map((card) => card.querySelector("span")?.textContent)).toEqual([
      "PCM syllabus status",
      "PCB syllabus status",
      "Tests overdue",
      "Hours taught · This AY",
      "Classes cancelled",
      "Doubt solving",
    ]);
  });

  it("gives screen readers one phrase per card, singular where it is one Chapter", async () => {
    mockGetChapterTimeline.mockResolvedValue({
      ok: true,
      timeline: withGroups([
        {
          group: "PCM",
          progress: { due: 1, done: 0, behind: 1, tone: "amber", label: "1 behind" },
          syllabusDone: 0,
          syllabusTotal: 1,
        },
        { group: "PCB", progress: PCB_BEHIND, syllabusDone: 2, syllabusTotal: 5 },
      ]),
    });
    await renderPage();

    expect(within(groupCard("PCM")).getByText(/^PCM syllabus status:/)).toHaveTextContent(
      "PCM syllabus status: 1 behind, 0 of 1 due chapter done, 0 of 1 chapter in the syllabus done"
    );
    expect(within(groupCard("PCB")).getByText(/^PCB syllabus status:/)).toHaveTextContent(
      "PCB syllabus status: 1 behind, 2 of 3 due chapters done, 2 of 5 chapters in the syllabus done"
    );
    // The visible fragments are hidden from screen readers.
    expect(groupCard("PCB").querySelector("[data-status-label]")?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it.each([
    ["JEE Main", "PCM", { due: 4, done: 0, behind: 4, tone: "red", label: "4 behind" } as const, "bg-danger-bg"],
    ["NEET", "PCB", PCB_BEHIND, "bg-warning-bg"],
  ])("shows only the %s class's %s card, five cards on one row", async (tracksLabel, group, progress, toneClass) => {
    mockGetChapterTimeline.mockResolvedValue({
      ok: true,
      timeline: withGroups([{ group: group as "PCM" | "PCB", progress, syllabusDone: 1, syllabusTotal: 30 }], {
        tracksLabel,
      }),
    });
    await renderPage();

    const other = group === "PCM" ? "PCB" : "PCM";
    expect(screen.queryByTestId(`timeline-${other.toLowerCase()}-status`)).not.toBeInTheDocument();
    const card = groupCard(group);
    expect(card.querySelector("[data-status-label]")).toHaveTextContent(progress.label);
    expect(card.querySelector("[data-status-label]")).toHaveClass(toneClass);
    expect(card.querySelector("[data-syllabus-done]")).toHaveTextContent(/^1\/30 syllabus done$/);
    expect(card.parentElement).toHaveClass("xl:grid-cols-5");
    expect(card.parentElement?.children).toHaveLength(5);
  });

  it("shows only the syllabus line under a muted No Active plan without an Active plan", async () => {
    mockGetChapterTimeline.mockResolvedValue({
      ok: true,
      timeline: withGroups(
        [
          { group: "PCM", progress: null, syllabusDone: 12, syllabusTotal: 30 },
          { group: "PCB", progress: null, syllabusDone: 1, syllabusTotal: 1 },
        ],
        { kind: "no_plan", plan: null }
      ),
    });
    await renderPage();

    const pcm = groupCard("PCM");
    expect(pcm.querySelector("[data-status-label]")).toHaveTextContent("No Active plan");
    expect(pcm.querySelector("[data-status-label]")).toHaveClass("text-text-muted");
    expect(pcm.querySelector("[data-tone]")).toBeNull();
    expect(pcm.querySelector("[data-due-done]")).toBeNull();
    expect(pcm.querySelector("[data-syllabus-done]")).toHaveTextContent(/^12\/30 syllabus done$/);
    expect(within(pcm).getByText(/^PCM syllabus status:/)).toHaveTextContent(
      "PCM syllabus status: no Active plan, 12 of 30 chapters in the syllabus done"
    );
    expect(within(groupCard("PCB")).getByText(/^PCB syllabus status:/)).toHaveTextContent(
      "PCB syllabus status: no Active plan, 1 of 1 chapter in the syllabus done"
    );
  });

  it("puts the as-of marker after the Chapters due by as-of", async () => {
    await renderPage();

    expect(tableOrder()).toEqual(["Motion", "Bonding", "Cells", "AS OF", "Genetics", "Ecology"]);
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

  it("draws the selected tab's badge on the card colour so it reads against the accent tab", async () => {
    mockGetChapterTimeline.mockResolvedValue({
      ok: true,
      timeline: timeline({
        subjects: [
          { subject: "Physics", progress: { due: 1, done: 1, behind: 0, tone: "green", label: "On track" } },
          { subject: "Chemistry", progress: { due: 2, done: 0, behind: 2, tone: "amber", label: "2 behind" } },
          { subject: "Biology", progress: { due: 3, done: 0, behind: 3, tone: "red", label: "3 behind" } },
        ],
      }),
    });

    const badgeClasses = async (subject: string) => {
      document.body.innerHTML = "";
      await renderPage({ subject });
      return document.querySelector(`[data-subject-tab="${subject}"] [data-tab-progress]`)?.className ?? "";
    };

    const selectedRed = await badgeClasses("Biology");
    expect(selectedRed).toContain("bg-bg-card");
    expect(selectedRed).toContain("text-danger");
    expect(selectedRed).not.toContain("bg-danger-bg");
    expect(await badgeClasses("Chemistry")).toMatch(/bg-bg-card.*text-warning-text|text-warning-text.*bg-bg-card/);
    expect(await badgeClasses("Physics")).toMatch(/bg-bg-card.*text-success|text-success.*bg-bg-card/);

    // Tabs that aren't selected keep the tinted tone badge.
    const unselected = document.querySelector('[data-subject-tab="Biology"] [data-tab-progress]');
    expect(unselected).toHaveClass("bg-danger-bg", "text-danger");
    expect(unselected).not.toHaveClass("bg-bg-card");
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
    expect(screen.getByTestId("timeline-tests-overdue")).toHaveTextContent("—");
  });

  it("lists the columns in order with Status and Chapter test centred and never wrapping", async () => {
    await renderPage();

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Chapter",
      "Subject",
      "Due",
      "Completed",
      "Status",
      "Chapter test",
      "Hours",
      "Prescribed",
      "Cancelled",
      "Doubt solving",
    ]);
    const cells = [...timelineRow("Motion").querySelectorAll("td")].map((cell) => cell.textContent);
    expect(cells).toEqual([
      "P1 Motion",
      "Physics",
      "30 Jun 2026",
      "28 Jun 2026",
      "Done",
      "Conducted 2 Jul 2026",
      "1h 30m",
      "2h",
      "1",
      "0h",
    ]);
    for (const selector of ["[data-status]", "[data-test-status]"]) {
      expect(timelineRow("Bonding").querySelector(selector)).toHaveClass("whitespace-nowrap", "text-center");
    }
    expect(screen.getByRole("columnheader", { name: "Status" })).toHaveClass("text-center");
    expect(timelineRow("Motion").querySelector("[data-hours]")).toHaveClass("font-mono", "text-center", "whitespace-nowrap");
  });

  it("shows Status and Chapter test as coloured tags with the same text", async () => {
    await renderPage();

    // [Chapter, Status text, its variant, Chapter test text, its variant]; Not in plan is muted text.
    const expected: [string, string, string | null, string, string][] = [
      ["Motion", "Done", "success", "Conducted 2 Jul 2026", "success"],
      ["Bonding", "Done 5 days late", "warning", "Overdue", "danger"],
      ["Cells", "Overdue 1 day", "danger", "Scheduled", "info"],
      ["Genetics", "Not due", "default", "Not due", "default"],
      ["Ecology", "Not in plan", null, "Not due", "default"],
    ];
    for (const [name, status, statusVariant, test, testVariant] of expected) {
      const statusCell = timelineRow(name).querySelector("[data-status]") as HTMLElement;
      expect(statusCell).toHaveTextContent(new RegExp(`^${status}$`));
      if (statusVariant) {
        expect(statusCell.querySelector("[data-variant]")).toHaveAttribute("data-variant", statusVariant);
      } else {
        expect(statusCell.querySelector("[data-variant]")).toBeNull();
        expect(within(statusCell).getByText(status)).toHaveClass("text-text-muted");
      }
      const testCell = timelineRow(name).querySelector("[data-test-status]") as HTMLElement;
      expect(testCell).toHaveTextContent(new RegExp(`^${test}$`));
      expect(testCell.querySelector("[data-variant]")).toHaveAttribute("data-variant", testVariant);
      expect(testCell.querySelector("[data-variant]")).toHaveClass("whitespace-nowrap", "rounded-full");
    }
    expect(timelineRow("Cells").querySelector("[data-status] [data-variant]")).toHaveClass("bg-danger-bg", "text-danger");
    expect(timelineRow("Cells").querySelector("[data-test-status] [data-variant]")).toHaveClass("bg-info-bg", "text-info");
  });

  it("prefixes each Chapter's name with its code, as the Plan editor does", async () => {
    await renderPage();

    const label = timelineRow("Motion").querySelector("[data-chapter-label]") as HTMLElement;
    expect(label.querySelector("[data-chapter-code]")).toHaveTextContent("P1");
    expect(label.querySelector("[data-chapter-code]")).toHaveClass("font-mono", "text-xs", "text-text-muted");
    expect(within(label).getByText("Motion")).toHaveClass("font-bold");
    expect(label.querySelector("[title]")).toHaveAttribute("title", "P1 Motion");
  });

  it("links every header to its first-click sort, keeping Grade, as-of, window and subject", async () => {
    mockGetChapterTimeline.mockResolvedValue({ ok: true, timeline: timeline({ hoursWindow: "7d" }) });
    await renderPage({ hours: "7d", subject: "Biology" });

    const base = "/curriculum-summary/centres/7?grade=11&as_of=2026-08-15&hours=7d&subject=Biology";
    const expected: [string, string][] = [
      ["Chapter", "sort=chapter&dir=asc"],
      ["Subject", "sort=subject&dir=asc"],
      ["Due", "sort=due&dir=asc"],
      ["Completed", "sort=completed&dir=asc"],
      ["Status", "sort=status&dir=desc"],
      ["Chapter test", "sort=test&dir=desc"],
      ["Hours", "sort=hours&dir=desc"],
      ["Prescribed", "sort=prescribed&dir=desc"],
      ["Cancelled", "sort=cancelled&dir=desc"],
      ["Doubt solving", "sort=doubt_solving&dir=desc"],
    ];
    for (const [label, sort] of expected) {
      const header = screen.getByRole("columnheader", { name: label });
      expect(header).not.toHaveAttribute("aria-sort");
      expect(within(header).getByRole("link")).toHaveAttribute("href", `${base}&${sort}`);
    }
  });

  it("sorts by the URL's column, marks it with aria-sort and an arrow, and its link reverses it", async () => {
    await renderPage({ sort: "status", dir: "desc" });

    const header = screen.getByRole("columnheader", { name: /Status/ });
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(header).toHaveTextContent("Status▼");
    expect(within(header).getByRole("link")).toHaveAttribute(
      "href",
      "/curriculum-summary/centres/7?grade=11&as_of=2026-08-15&sort=status&dir=asc"
    );
    // Worst first within each side of the As of line; Not in plan last.
    expect(tableOrder()).toEqual(["Cells", "Bonding", "Motion", "AS OF", "Genetics", "Ecology"]);

    document.body.innerHTML = "";
    await renderPage({ sort: "status", dir: "asc" });
    expect(screen.getByRole("columnheader", { name: /Status/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: /Status/ })).toHaveTextContent("Status▲");
    expect(tableOrder()).toEqual(["Motion", "Bonding", "Cells", "AS OF", "Genetics", "Ecology"]);
  });

  it("keeps the sort in subject tabs, window and Grade links and the As of form", async () => {
    mockGetChapterTimeline.mockResolvedValue({ ok: true, timeline: timeline({ grades: [11, 12] }) });
    await renderPage({ sort: "test", dir: "asc", subject: "Biology" });

    // Biology only, best Chapter Test first on each side of the As of line.
    expect(tableOrder()).toEqual(["Cells", "AS OF", "Genetics", "Ecology"]);
    const tabs = screen.getByRole("navigation", { name: "Subject" });
    expect(within(tabs).getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/curriculum-summary/centres/7?grade=11&as_of=2026-08-15&sort=test&dir=asc"
    );
    const windows = screen.getByRole("navigation", { name: "Hours window" });
    expect(within(windows).getByRole("link", { name: "Last 30 days" })).toHaveAttribute(
      "href",
      "/curriculum-summary/centres/7?grade=11&as_of=2026-08-15&hours=30d&subject=Biology&sort=test&dir=asc"
    );
    expect(screen.getByRole("link", { name: "Grade 12" })).toHaveAttribute(
      "href",
      "/curriculum-summary/centres/7?grade=12&as_of=2026-08-15&sort=test&dir=asc"
    );
    expect(document.querySelector('input[type="hidden"][name="sort"]')).toHaveValue("test");
    expect(document.querySelector('input[type="hidden"][name="dir"]')).toHaveValue("asc");
  });

  it("ignores an unknown sort column and falls back to the first click for an unknown direction", async () => {
    await renderPage({ sort: "centre", dir: "asc" });
    expect(tableOrder()).toEqual(["Motion", "Bonding", "Cells", "AS OF", "Genetics", "Ecology"]);
    expect(document.querySelector("[aria-sort]")).toBeNull();
    expect(document.querySelector('input[type="hidden"][name="sort"]')).toBeNull();

    document.body.innerHTML = "";
    await renderPage({ sort: "hours", dir: "up" });
    expect(screen.getByRole("columnheader", { name: /Hours/ })).toHaveAttribute("aria-sort", "descending");
    // Genetics has no hours; the rest tie at 1h 30m and keep the default order.
    expect(tableOrder()).toEqual(["Motion", "Bonding", "Cells", "AS OF", "Ecology", "Genetics"]);
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
    expect(screen.queryByTestId("timeline-pcm-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-tests-overdue")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Grade" })).toBeInTheDocument();
  });
});
