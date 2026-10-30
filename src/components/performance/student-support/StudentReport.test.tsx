import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type JsonReply, stubJsonFetch } from "./__test-utils__/json-fetch";
import StudentReport from "./StudentReport";
import type { ChapterRow, StudentReportData, TestHistoryRow, TopicRow } from "@/types/student-support";

function topic(over: Partial<TopicRow>): TopicRow {
  return { code: "t", name: "T", n: 4, attempt: 100, accuracy: 50, score: 50, flag: null, ...over };
}

function chapter(over: Partial<ChapterRow>): ChapterRow {
  return {
    key: "k", code: null, name: "Ch", priority: "High", n: 8, attempt: 75, accuracy: 50, score: 60,
    tests: 2, flag: null, pyq: [], topics: [], ...over,
  };
}

function test(over: Partial<TestHistoryRow>): TestHistoryRow {
  return {
    sessionId: "s", name: "FT", date: "2026-07-01", exam: "JEE Main", absent: false, level: "M2",
    rank: null, takers: null, change: null, subjects: [],
    overall: { marks: 90, max: 300, pct: 30, correct: 25, wrong: 10, partial: 0, skipped: 40 },
    ...over,
  };
}

const REPORT: StudentReportData = {
  student: {
    uid: "1", studentId: "S1", name: "Asha", gender: "Female", category: null, examStream: "engineering",
    predicted: "M1", predictedPct: null, mode: "M2", status: "Sliding", last3: [], latestPct: null,
    toNext: { kind: "none" }, results: {},
  },
  chapters: [
    {
      exam: "JEE Main",
      subjects: [
        {
          subject: "Physics", passMark: 35, answers: 24, attempt: 75, accuracy: null,
          chapters: [
            chapter({
              key: "p1", code: "12P01", name: "Electrostatics", flag: "C", score: 25,
              pyq: ["https://pyq/1", "https://pyq/2"],
              topics: [
                topic({ code: "JM-1", name: "Coulomb's law", score: 0, flag: "C" }),
                topic({ code: "JM-2", name: "Field lines", score: 80 }),
                topic({ code: "JM-3", name: "Potential", score: 90 }),
              ],
            }),
            chapter({
              key: "p2", code: "12P02", name: "Optics", priority: "Medium", score: 60,
              pyq: ["https://pyq/3"], topics: [topic({ code: "JM-4", name: "Lenses" })],
            }),
            chapter({ key: "p3", code: "12P03", name: "Waves", flag: "S", score: 10, attempt: null }),
          ],
        },
        { subject: "Chemistry", passMark: 35, answers: 4, attempt: 50, accuracy: 50, chapters: [chapter({ key: "c1", name: "Moles", priority: "Low" })] },
      ],
    },
    {
      exam: "NEET",
      subjects: [
        { subject: "Biology", passMark: 75, answers: 8, attempt: 80, accuracy: 70, chapters: [chapter({ key: "b1", name: "Cells", flag: "C", score: 40 })] },
      ],
    },
  ],
  tests: [
    test({
      sessionId: "b", name: "FT B", date: "2026-08-01", change: 10, rank: 3, takers: 40,
      overall: { marks: 120, max: 300, pct: 40, correct: 30, wrong: 12, partial: 0, skipped: 30 },
      subjects: [{ subject: "Maths", marks: 50, max: 100, pct: 50, correct: 12, wrong: 4, partial: 2, skipped: 9 }],
    }),
    test({ sessionId: "c", name: "FT C", date: "2026-07-15", absent: true, overall: null, level: null }),
    test({ sessionId: "a", name: "FT A", date: "2026-07-01", change: -5 }),
    test({ sessionId: "n", name: "NEET FT", exam: "NEET", overall: { marks: null, max: null, pct: 55, correct: null, wrong: null, partial: null, skipped: null } }),
  ],
};

const mockFetch = (reply: JsonReply) => stubJsonFetch(() => reply);

function renderReport() {
  const onBack = vi.fn();
  render(<StudentReport schoolUdise="70705" grade={12} program="JNV CoE" uid="1" onBack={onBack} />);
  return onBack;
}

/** A collapsible section's body, by its title. */
const section = (title: string | RegExp) => within(screen.getByText(title).closest("details")!);

/** The chapter names in the competency map, in order. */
const mapChapters = () =>
  section("Detailed chapter competency map")
    .getAllByText(/^(Electrostatics|Optics|Waves|Moles|Cells)$/)
    .map((el) => el.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StudentReport", () => {
  it("asks for the student's report and goes back while loading", async () => {
    const fetchMock = mockFetch("pending");
    const onBack = renderReport();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quiz-analytics/70705/student-report?grade=12&program=JNV+CoE&student=1",
      expect.anything()
    );
    expect(screen.getByText("Loading the report…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "← Score journey" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows the server's error, with the way back", async () => {
    mockFetch({ ok: false, body: { error: "Student not found in this grade" } });
    renderReport();
    expect(await screen.findByText("Student not found in this grade")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Score journey" })).toBeInTheDocument();
  });

  it("heads the report with the student and counts flagged chapters per exam and subject", async () => {
    mockFetch({ ok: true, body: REPORT });
    renderReport();
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(screen.getByText("S1 · Female")).toBeInTheDocument();
    expect(screen.getByText("Sliding")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JEE Main (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "NEET (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Physics (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Chemistry (0)" })).toBeInTheDocument();
  });

  it("shows the flagged High-priority chapters as focus cards, with flagged topics and PYQs", async () => {
    mockFetch({ ok: true, body: REPORT });
    renderReport();
    await screen.findByText("Asha");
    const focus = section("Focus chapters · self-prep plan");
    expect(focus.getAllByText(/^(Electrostatics|Waves|Optics)$/).map((el) => el.textContent)).toEqual([
      "Electrostatics",
      "Waves",
    ]);
    expect(focus.getByText("C · Concept gap")).toBeInTheDocument();
    expect(focus.getByText("S · Skipping")).toBeInTheDocument();
    expect(focus.getByRole("listitem")).toHaveTextContent("Coulomb's law");
    expect(focus.getByRole("link", { name: "PYQ 2" })).toHaveAttribute("href", "https://pyq/2");

    await userEvent.click(screen.getByRole("button", { name: "Chemistry (0)" }));
    expect(screen.getByText("No High-priority chapters flagged in Chemistry.")).toBeInTheDocument();
  });

  it("maps chapters into needs work and on track, sortable, with their stats", async () => {
    mockFetch({ ok: true, body: REPORT });
    renderReport();
    await screen.findByText("Asha");
    const map = section("Detailed chapter competency map");
    expect(map.getByText("24 answers · attempt 75% · accuracy —% · pass mark 35%")).toBeInTheDocument();
    expect(map.getByText("Needs work · 2")).toBeInTheDocument();
    expect(map.getByText("On track · 1")).toBeInTheDocument();
    // Priority, then weakest.
    expect(mapChapters()).toEqual(["Waves", "Electrostatics", "Optics"]);
    expect(map.getByText(/8 answers · attempt —% · accuracy 50% · 2 tests/)).toBeInTheDocument();
    expect(map.getByRole("link", { name: "PYQ" })).toHaveAttribute("href", "https://pyq/3");

    await userEvent.click(map.getByRole("button", { name: "Chapter order" }));
    expect(mapChapters()).toEqual(["Electrostatics", "Waves", "Optics"]);
    await userEvent.click(map.getByRole("button", { name: "Weakest" }));
    expect(mapChapters()).toEqual(["Waves", "Electrostatics", "Optics"]);
  });

  it("shows a chapter's flagged topics, with the ones on track behind a toggle", async () => {
    mockFetch({ ok: true, body: REPORT });
    renderReport();
    await screen.findByText("Asha");
    const map = section("Detailed chapter competency map");
    expect(map.getByText("Coulomb's law")).toBeInTheDocument();
    expect(map.queryByText("Field lines")).not.toBeInTheDocument();
    // Waves has no topics, so no toggle.
    expect(map.getAllByRole("button", { name: /on track$/ }).map((b) => b.textContent)).toEqual([
      "Show 2 topics on track",
      "Show 1 topic on track",
    ]);

    await userEvent.click(map.getByRole("button", { name: "Show 2 topics on track" }));
    expect(map.getByText("Field lines")).toBeInTheDocument();
    expect(map.getByText("Potential")).toBeInTheDocument();
    await userEvent.click(map.getByRole("button", { name: "Hide 2 topics on track" }));
    expect(map.queryByText("Field lines")).not.toBeInTheDocument();
  });

  it("lists the exam's full tests, absences, change and rank, and opens a test's subjects", async () => {
    mockFetch({ ok: true, body: REPORT });
    renderReport();
    await screen.findByText("Asha");
    const history = section("Detailed full test scores · JEE Main");
    expect(history.getByText("2 of 3 tests sat · average 35%")).toBeInTheDocument();
    expect(history.queryByText(/NEET FT/)).not.toBeInTheDocument();
    expect(history.getByText("AB")).toBeInTheDocument();
    expect(history.getByText("+10")).toBeInTheDocument();
    expect(history.getByText("-5")).toHaveClass("text-danger");
    expect(history.getByText("3 / 40")).toBeInTheDocument();

    const testB = history.getByText(/FT B/).closest("tr")!;
    expect(history.queryByText("Maths")).not.toBeInTheDocument();
    await userEvent.click(testB);
    const maths = history.getByText("Maths").closest("tr")!;
    expect(within(maths).getByText("4 (+2 partial)")).toBeInTheDocument();
    expect(within(maths).getByText("50/100")).toBeInTheDocument();
    await userEvent.click(testB);
    expect(history.queryByText("Maths")).not.toBeInTheDocument();
  });

  it("switches exam, resetting the subject and the tests shown", async () => {
    mockFetch({ ok: true, body: REPORT });
    renderReport();
    await screen.findByText("Asha");
    await userEvent.click(screen.getByRole("button", { name: "Chemistry (0)" }));
    await userEvent.click(screen.getByRole("button", { name: "NEET (1)" }));

    expect(screen.getByRole("button", { name: "Biology (1)" })).toHaveAttribute("aria-pressed", "true");
    expect(mapChapters()).toEqual(["Cells"]);
    const history = section("Detailed full test scores · NEET");
    expect(history.getByText("1 of 1 tests sat · average 55%")).toBeInTheDocument();
    expect(history.getByText("—/—")).toBeInTheDocument();
  });

  it("shows every test, and no chapters, for a student without chapter data", async () => {
    mockFetch({ ok: true, body: { ...REPORT, chapters: [], tests: [test({ exam: null, name: "Old FT" })] } });
    renderReport();
    expect(await screen.findByText("No chapter data for this student yet.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Subject" })).not.toBeInTheDocument();
    expect(section("Detailed full test scores").getByText(/Old FT/)).toBeInTheDocument();
  });

  it("says so when there are no full tests", async () => {
    mockFetch({ ok: true, body: { ...REPORT, chapters: [REPORT.chapters[1]], tests: [] } });
    renderReport();
    expect(await screen.findByText("No full tests yet.")).toBeInTheDocument();
    // One exam: no exam switch.
    expect(screen.queryByRole("group", { name: "Exam" })).not.toBeInTheDocument();
  });
});
