import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChapterTestReport from "./ChapterTestReport";
import type { ChapterTestReportData, QuestionStat } from "@/types/question-analytics";

vi.mock("./QuestionContentView", () => ({
  default: ({ sessionQuery, cmsQuestionId }: { sessionQuery: string; cmsQuestionId: number }) => (
    <div>content {sessionQuery}/{cmsQuestionId}</div>
  ),
}));

function q(overrides: Partial<QuestionStat>): QuestionStat {
  return {
    question_id: "q", cms_question_id: null, position: 0, difficulty: "easy", subject: "Physics",
    topics: [], responses: 48, attempted: 0, correct: 0, incorrect: 0, skipped: 48,
    avg_time_seconds: 120, ...overrides,
  };
}

const REPORT: ChapterTestReportData = {
  test: {
    session_id: "s1", test_name: "12P24 - Wave Optics - JEE Main", test_format: "chapter_test",
    start_date: "2026-10-14", test_grade: 12, exam: "JEE Mains", subject: "Physics", cms_test_id: "9330",
    chapter_code: "12P24", chapter_name: "Wave Optics", priority: "Medium", duration_minutes: 60,
    total_questions: 25, max_marks: 100,
  },
  overview: { students: 48, avg_attempt_rate: 45.8, avg_accuracy: 63.1, avg_score: 25.2, enrolled: 53, avg_time_minutes: 58 },
  gender: [
    { gender: "male", students: 29, avg_attempt_rate: 47.3, avg_accuracy: 56.6, avg_score: 22.5 },
    { gender: "female", students: 19, avg_attempt_rate: 43.6, avg_accuracy: 73.2, avg_score: 29.4 },
  ],
  questions: [
    q({ question_id: "a", cms_question_id: 9248, position: 0, topics: ["Interference"], attempted: 47, correct: 43, incorrect: 4, skipped: 1 }),
    q({ question_id: "b", cms_question_id: 9250, position: 1, difficulty: "medium", topics: ["Huygen's Wave Theory"], attempted: 10, correct: 5, incorrect: 5, skipped: 38 }),
    q({ question_id: "c", cms_question_id: 9253, position: 19, difficulty: "easy", topics: ["Wavefronts"], attempted: 12, correct: 6, incorrect: 6, skipped: 36 }),
  ],
  comparison: [
    { school: "JNV Kohima", udise: "1307", program: "JNV CoE", students: 9, avg_attempt_rate: 49.3, avg_accuracy: 61.5, avg_score: 26, is_this_school: false },
    { school: "EMRS Bhopal", udise: "2332", program: "EMRS CoE", students: 48, avg_attempt_rate: 45.8, avg_accuracy: 63.1, avg_score: 25.2, is_this_school: true },
  ],
};

function mockFetch(response: { ok: boolean; body: unknown }) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: response.ok, json: () => Promise.resolve(response.body) })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A SectionCard's whole panel, found by its title. */
async function section(title: string): Promise<HTMLElement> {
  return (await screen.findByText(title)).parentElement!.parentElement!;
}

describe("ChapterTestReport", () => {
  it("asks for the session's report with program and stream", async () => {
    const fetchMock = mockFetch({ ok: true, body: REPORT });
    render(<ChapterTestReport schoolUdise="2332" grade={12} sessionId="s1" program="EMRS CoE" stream="engineering" />);
    await screen.findByText("Insights");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quiz-analytics/2332/chapter-test-report?grade=12&sessionId=s1&program=EMRS+CoE&stream=engineering",
      expect.anything()
    );
  });

  it("shows the header, the overview and every section", async () => {
    mockFetch({ ok: true, body: REPORT });
    const onDataLoaded = vi.fn();
    render(
      <ChapterTestReport
        schoolUdise="2332" grade={12} sessionId="s1"
        onDataLoaded={onDataLoaded}
        afterOverview={<div>combined reports</div>}
        studentResults={<div>student results</div>}
      />
    );

    expect(await screen.findByText("Medium priority")).toBeInTheDocument();
    expect(onDataLoaded).toHaveBeenCalledWith("12P24 - Wave Optics - JEE Main");
    expect(
      screen.getByText("Chapter Test · Physics · October 14, 2026 · 48 of 53 students appeared (91%)")
    ).toBeInTheDocument();
    expect(screen.getByText("Question Paper (PDF)")).toHaveAttribute(
      "href", "/api/quiz-analytics/2332/test-pdf?grade=12&sessionId=s1&type=questions"
    );
    expect(screen.getByText("Avg Attempt Rate").parentElement).toHaveTextContent("45.8% (~11 of 25 Qs)");
    expect(screen.getByText("Avg Score").parentElement).toHaveTextContent("25.2% (25.2 of 100)");
    expect(screen.getByText("Avg Time Taken").parentElement).toHaveTextContent("58 of 60 min");

    for (const title of ["Insights", "Question Breakdown", "Question Rankings", "Gender Split", "Comparison with Other Centres"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText("combined reports")).toBeInTheDocument();
    expect(screen.getByText("student results")).toBeInTheDocument();
  });

  it("flags an easy question most of the class skipped", async () => {
    mockFetch({ ok: true, body: REPORT });
    render(<ChapterTestReport schoolUdise="2332" grade={12} sessionId="s1" />);
    expect(await screen.findByText(/Q20 is labelled Easy, but 75% skipped it/)).toBeInTheDocument();
  });

  it("lists girls before boys and marks this centre in the comparison", async () => {
    mockFetch({ ok: true, body: REPORT });
    render(<ChapterTestReport schoolUdise="2332" grade={12} sessionId="s1" />);
    const gender = await section("Gender Split");
    const rows = within(gender).getAllByRole("row").slice(1).map((r) => r.firstChild?.textContent);
    expect(rows).toEqual(["Girls", "Boys"]);
    expect(screen.getByText("This centre").closest("tr")).toHaveTextContent("EMRS Bhopal");
  });

  it("opens a question from the breakdown, by difficulty tab", async () => {
    mockFetch({ ok: true, body: REPORT });
    const user = userEvent.setup();
    render(<ChapterTestReport schoolUdise="2332" grade={12} sessionId="s1" />);
    const breakdown = await section("Question Breakdown");

    expect(within(breakdown).getByRole("button", { name: "Easy (2)" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(breakdown).getByRole("button", { name: /Q1$/ }));
    expect(within(breakdown).getByText("content grade=12&sessionId=s1/9248")).toBeInTheDocument();
    expect(within(breakdown).getByText("Interference")).toBeInTheDocument();

    await user.click(within(breakdown).getByRole("button", { name: "Medium (1)" }));
    expect(within(breakdown).getByRole("button", { name: /Q2$/ })).toBeInTheDocument();
    expect(within(breakdown).queryByRole("button", { name: /Q1$/ })).not.toBeInTheDocument();
  });

  it("hands a combined chapter test or homework to the general report", async () => {
    mockFetch({ ok: true, body: { ...REPORT, test: { ...REPORT.test, test_format: "combined_chapter_test" } } });
    render(<ChapterTestReport schoolUdise="2332" grade={12} sessionId="s1" fallback={<div>general report</div>} />);
    expect(await screen.findByText("general report")).toBeInTheDocument();
    expect(screen.queryByText("Insights")).not.toBeInTheDocument();
  });

  it("shows no question text or PDFs for an old-CMS test", async () => {
    mockFetch({ ok: true, body: { ...REPORT, test: { ...REPORT.test, cms_test_id: "64abcdef" } } });
    const user = userEvent.setup();
    render(<ChapterTestReport schoolUdise="2332" grade={12} sessionId="s1" />);
    const breakdown = await section("Question Breakdown");
    expect(screen.queryByText("Question Paper (PDF)")).not.toBeInTheDocument();
    await user.click(within(breakdown).getByRole("button", { name: /Q1$/ }));
    expect(within(breakdown).getByText(/available for new-CMS tests only/)).toBeInTheDocument();
  });

  it("shows the error and still the student results when the report fails", async () => {
    mockFetch({ ok: false, body: { error: "No results available for this test yet." } });
    render(<ChapterTestReport schoolUdise="2332" grade={12} sessionId="s1" studentResults={<div>student results</div>} />);
    expect(await screen.findByText("No results available for this test yet.")).toBeInTheDocument();
    expect(screen.getByText("student results")).toBeInTheDocument();
  });
});
