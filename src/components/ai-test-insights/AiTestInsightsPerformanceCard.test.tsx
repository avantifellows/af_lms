import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiTestInsightsPerformanceCard from "./AiTestInsightsPerformanceCard";
import type { StudentReportData } from "@/types/student-support";

// A Student Report written by hand: three tests, one missed, one a Part test.
const REPORT: StudentReportData = {
  student: {
    uid: "5005", studentId: "STU1005", name: "Esha Ekka", gender: "Female", category: "ST", stream: "engineering",
    examStream: "engineering", predicted: "M1", mode: "M2", status: "Improving", latestAl: null,
    toNext: { kind: "none" }, change: null, latestPct: 45, results: {},
    trend: { points: [30, 38, 45], direction: "Improving", slope: 7.5, recent: 3 },
  },
  chapters: [
    {
      exam: "JEE Main",
      subjects: [{ subject: "Physics", passMark: 35, answers: 24, attempt: 75, accuracy: 50, chapters: [] }],
    },
  ],
  tests: [
    {
      sessionId: "s3", name: "Major Test 2", date: "2026-10-12", exam: "JEE Main", absent: false, retest: false,
      level: "M2", rank: 4, takers: 38, change: 7,
      overall: { marks: 135, max: 300, pct: 45, correct: 36, wrong: 9, partial: 0, skipped: 30 },
      subjects: [
        { subject: "Physics", marks: 40, max: 100, pct: 40, correct: 11, wrong: 4, partial: 0, skipped: 10 },
        { subject: "Chemistry", marks: 52, max: 100, pct: 52, correct: 13, wrong: 0, partial: 0, skipped: 12 },
      ],
    },
    {
      sessionId: "s2", name: "Part Test 3", date: "2026-09-20", exam: "JEE Main", absent: true, retest: false,
      level: null, rank: null, takers: null, change: null, overall: null, subjects: [],
    },
    {
      sessionId: "s1", name: "Major Test 1", date: "2026-08-10", exam: "JEE Main", absent: false, retest: false,
      level: "M3", rank: 9, takers: 40, change: null,
      overall: { marks: 114, max: 300, pct: 38, correct: 30, wrong: 6, partial: 0, skipped: 39 },
      subjects: [],
    },
  ],
};

type Reply = { status: number; body: unknown };

/** Stubs fetch, answering each call with the next reply (the last repeats). */
function stubFetch(...replies: Reply[]) {
  let call = 0;
  const fetchMock = vi.fn(() => {
    const reply = replies[Math.min(call++, replies.length - 1)];
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard() {
  render(<AiTestInsightsPerformanceCard schoolUdise="29000000001" grade={11} program="JNV Nodal" uid="5005" />);
  return screen.getByRole("region", { name: "Performance" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiTestInsightsPerformanceCard", () => {
  it("asks the Student Report endpoint for the Student's School, Grade, Program and user id", async () => {
    const fetchMock = stubFetch({ status: 200, body: REPORT });
    const card = renderCard();
    await within(card).findByRole("table");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]), "http://localhost");
    expect(url.pathname).toBe("/api/quiz-analytics/29000000001/student-report");
    expect(Object.fromEntries(url.searchParams)).toEqual({ grade: "11", program: "JNV Nodal", student: "5005" });
  });

  it("draws the score graph and the per-test table, Part and missed tests included", async () => {
    stubFetch({ status: 200, body: REPORT });
    const card = renderCard();

    expect(await within(card).findByRole("img", { name: "Score trend: Improving over the last 3 tests" })).toBeInTheDocument();
    const rows = within(within(card).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("2026-10-12 · Major Test 2"),
      expect.stringContaining("2026-09-20 · Part Test 3AB"),
      expect.stringContaining("2026-08-10 · Major Test 1"),
    ]);
    expect(within(card).getByText("2 of 3 tests sat · average 41.5%")).toBeInTheDocument();
  });

  it("leaves out the chapter sections and the predicted-level header", async () => {
    stubFetch({ status: 200, body: REPORT });
    const card = renderCard();
    await within(card).findByRole("table");

    expect(within(card).queryByText(/Focus chapters/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/chapter competency map/)).not.toBeInTheDocument();
    expect(within(card).queryByText("Predicted")).not.toBeInTheDocument();
    expect(within(card).queryByText("Esha Ekka")).not.toBeInTheDocument();
  });

  it("expands a test to its subject rows", async () => {
    stubFetch({ status: 200, body: REPORT });
    const card = renderCard();
    const test = await within(card).findByRole("button", { name: /Major Test 2/ });
    expect(within(card).queryByText("Physics")).not.toBeInTheDocument();

    await userEvent.click(test);

    expect(test).toHaveAttribute("aria-expanded", "true");
    expect(within(card).getByText("Physics")).toBeInTheDocument();
    expect(within(card).getByText("Chemistry")).toBeInTheDocument();
  });

  it('shows "No test results yet" when the endpoint does not find the Student', async () => {
    stubFetch({ status: 404, body: { error: "Student not found in this grade" } });
    const card = renderCard();

    expect(await within(card).findByText("No test results yet")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it('shows "No test results yet" without asking when the Program has no label', async () => {
    const fetchMock = stubFetch({ status: 200, body: REPORT });
    render(<AiTestInsightsPerformanceCard schoolUdise="29000000001" grade={11} program={null} uid="5005" />);

    expect(screen.getByText("No test results yet")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an error panel on a failure, and Retry loads the report", async () => {
    const fetchMock = stubFetch(
      { status: 500, body: { error: "Failed to fetch the student report" } },
      { status: 200, body: REPORT },
    );
    const card = renderCard();

    expect(await within(card).findByRole("alert")).toHaveTextContent("Test results could not be loaded");
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Retry" }));

    expect(await within(card).findByRole("table")).toBeInTheDocument();
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the error panel when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const card = renderCard();

    expect(await within(card).findByRole("alert")).toHaveTextContent("Test results could not be loaded");
    expect(within(card).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
