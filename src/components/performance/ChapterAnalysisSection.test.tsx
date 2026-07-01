import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ChapterAnalysisSection from "./ChapterAnalysisSection";
import type { ChapterAnalysisRow, TestQuestionLevelRow } from "@/types/quiz";

const CHAPTERS: ChapterAnalysisRow[] = [
  {
    subject: "Physics",
    chapter_name: "Kinematics",
    chapter_id: "chap-kin",
    priority: "High",
    avg_score: 65,
    avg_marks: 13,
    max_marks: 20,
    accuracy: 70,
    attempt_rate: 80,
    questions: 5,
    avg_time: 45,
  },
  {
    subject: "Physics",
    chapter_name: "Dynamics",
    chapter_id: "chap-dyn",
    priority: null,
    avg_score: 50,
    avg_marks: 8,
    max_marks: 16,
    accuracy: 60,
    attempt_rate: 75,
    questions: 4,
    avg_time: 50,
  },
];

const QUESTIONS: TestQuestionLevelRow[] = [
  {
    subject: "Physics",
    chapter_name: "Kinematics",
    chapter_id: "chap-kin",
    question_id: "q1",
    // position_index is the 0-based source index; it renders as Q{index + 1}.
    position_index: 0,
    total_students: 10,
    attempted: 8,
    correct: 6,
    wrong: 2,
    skipped: 2,
    attempt_rate: 80,
    accuracy: 75,
  },
  {
    subject: "Physics",
    chapter_name: "Kinematics",
    chapter_id: "chap-kin",
    question_id: "q2",
    position_index: 1,
    total_students: 10,
    attempted: 5,
    correct: 1,
    wrong: 4,
    skipped: 5,
    attempt_rate: 50,
    accuracy: 20,
  },
  {
    subject: "Physics",
    chapter_name: "Dynamics",
    chapter_id: "chap-dyn",
    question_id: "q3",
    position_index: 2,
    total_students: 10,
    attempted: 9,
    correct: 8,
    wrong: 1,
    skipped: 1,
    attempt_rate: 90,
    accuracy: 89,
  },
];

const defaultProps = {
  chapters: CHAPTERS,
  schoolUdise: "1234",
  grade: 11,
  sessionId: "sess-1",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ questions: QUESTIONS }),
      })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChapterAnalysisSection", () => {
  it("does not fetch question data before any chapter is expanded", () => {
    render(<ChapterAnalysisSection {...defaultProps} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders the chapter priority tag, with an em-dash for untagged chapters", () => {
    render(<ChapterAnalysisSection {...defaultProps} />);
    // Kinematics is High; Dynamics has no tag (null) -> em-dash.
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("fetches question data on first chapter expand and renders only that chapter's questions", async () => {
    render(<ChapterAnalysisSection {...defaultProps} />);

    // The first subject is open by default, so its chapter rows are rendered.
    fireEvent.click(screen.getByText("Kinematics"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    // Q1 + Q2 (both in Kinematics) appear; Q3 (Dynamics) does not.
    await screen.findByText("Q1");
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.queryByText("Q3")).not.toBeInTheDocument();
  });

  it("does not re-fetch when a second chapter is expanded (uses cache)", async () => {
    render(<ChapterAnalysisSection {...defaultProps} />);

    fireEvent.click(screen.getByText("Kinematics"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Dynamics"));
    // Q3 appears under Dynamics
    await screen.findByText("Q3");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends program and stream as query params when provided", async () => {
    render(
      <ChapterAnalysisSection
        {...defaultProps}
        program="JNV CoE"
        stream="pcm"
      />
    );
    fireEvent.click(screen.getByText("Kinematics"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("grade=11");
    expect(url).toContain("sessionId=sess-1");
    expect(url).toContain("program=JNV%20CoE");
    expect(url).toContain("stream=pcm");
  });

  it("renders an error message when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "BQ outage" }),
        })
      )
    );
    render(<ChapterAnalysisSection {...defaultProps} />);
    fireEvent.click(screen.getByText("Kinematics"));
    await screen.findByText("BQ outage");
  });

  it("renders 'No question-level data' when the chapter has none after fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ questions: [] }),
        })
      )
    );
    render(<ChapterAnalysisSection {...defaultProps} />);
    fireEvent.click(screen.getByText("Kinematics"));
    await screen.findByText("No question-level data for this chapter.");
  });

  it("shows attempt rate, accuracy, correct, wrong, skipped per question", async () => {
    render(<ChapterAnalysisSection {...defaultProps} />);
    fireEvent.click(screen.getByText("Kinematics"));
    const q1Row = (await screen.findByText("Q1")).closest("tr");
    expect(q1Row).not.toBeNull();
    const inRow = within(q1Row as HTMLElement);
    expect(inRow.getByText("80%")).toBeInTheDocument(); // attempt rate
    expect(inRow.getByText("75%")).toBeInTheDocument(); // accuracy
    expect(inRow.getByText("6")).toBeInTheDocument(); // correct
    // wrong and skipped are both "2" — there should be two such cells
    expect(inRow.getAllByText("2")).toHaveLength(2);
  });

  it("joins on chapter_id even when chapter_name strings differ between sources", async () => {
    // DynamoDB-side row has the chapter code prefix; BQ-side question rows
    // come back without the prefix. chapter_id is the same, so they join.
    const prefixedChapters: ChapterAnalysisRow[] = [
      {
        subject: "Chemistry",
        chapter_name: "11C3 - Periodic Table",
        chapter_id: "chap-periodic",
        priority: "Medium",
        avg_score: 0,
        avg_marks: 0,
        max_marks: 4,
        accuracy: 4,
        attempt_rate: 37,
        questions: 1,
        avg_time: null,
      },
    ];
    const plainQuestions: TestQuestionLevelRow[] = [
      {
        subject: "Chemistry",
        chapter_name: "Periodic Table",
        chapter_id: "chap-periodic",
        question_id: "qX",
        position_index: 6,
        total_students: 24,
        attempted: 9,
        correct: 0,
        wrong: 9,
        skipped: 15,
        attempt_rate: 38,
        accuracy: 0,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ questions: plainQuestions }),
        })
      )
    );

    render(<ChapterAnalysisSection {...defaultProps} chapters={prefixedChapters} />);
    // Subject opens by default since the first subject is Chemistry here.
    fireEvent.click(screen.getByText("11C3 - Periodic Table"));
    await screen.findByText("Q7");
    expect(
      screen.queryByText("No question-level data for this chapter.")
    ).not.toBeInTheDocument();
  });

  it("displays a 0-based position_index as a 1-based question number (Q0 -> Q1)", async () => {
    const zeroIndexed: TestQuestionLevelRow[] = [
      { ...QUESTIONS[0], question_id: "qZero", position_index: 0 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ questions: zeroIndexed }),
        })
      )
    );
    render(<ChapterAnalysisSection {...defaultProps} />);
    fireEvent.click(screen.getByText("Kinematics"));
    // The off-by-one fix: index 0 must render as "Q1", never "Q0".
    await screen.findByText("Q1");
    expect(screen.queryByText("Q0")).not.toBeInTheDocument();
  });

  it("falls back to the 1-based row position when position_index is null", async () => {
    const nullIndexed: TestQuestionLevelRow[] = [
      { ...QUESTIONS[0], question_id: "qNull", position_index: null },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ questions: nullIndexed }),
        })
      )
    );
    render(<ChapterAnalysisSection {...defaultProps} />);
    fireEvent.click(screen.getByText("Kinematics"));
    // Single question, row index 0 -> idx + 1 -> "Q1".
    await screen.findByText("Q1");
  });

  it("renders 'No chapter-level data' when chapters array is empty", () => {
    render(<ChapterAnalysisSection {...defaultProps} chapters={[]} />);
    expect(
      screen.getByText("No chapter-level data available for this test.")
    ).toBeInTheDocument();
  });
});
