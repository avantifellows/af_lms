import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StudentResultsTable from "./StudentResultsTable";
import type { StudentDeepDiveRow, StudentQuestionRow } from "@/types/quiz";

const STUDENTS: StudentDeepDiveRow[] = [
  {
    student_name: "Asha Rao",
    enrollment_user_id: "368592",
    gender: "F",
    marks_scored: 40,
    max_marks: 100,
    percentage: 40,
    accuracy: 50,
    attempt_rate: 60,
    subject_scores: [
      {
        subject: "Physics",
        percentage: 40,
        marks_scored: 10,
        max_marks: 25,
        accuracy: 50,
        attempt_rate: 60,
        chapters: [
          {
            subject: "Physics",
            chapter_name: "Kinematics",
            chapter_id: "c-kin",
            marks_scored: 4,
            max_marks: 8,
            accuracy: 50,
            attempt_rate: 100,
            total_questions: 2,
          },
        ],
      },
    ],
  },
];

const QUESTIONS: StudentQuestionRow[] = [
  { enrollment_user_id: "368592", chapter_id: "c-kin", chapter_name: "Kinematics", question_id: "q1", position_index: 0, status: "correct" },
  { enrollment_user_id: "368592", chapter_id: "c-kin", chapter_name: "Kinematics", question_id: "q2", position_index: 1, status: "skipped" },
];

const props = {
  students: STUDENTS,
  schoolUdise: "1234",
  grade: 12,
  sessionId: "sess-1",
};

function mockFetchOk(questions: StudentQuestionRow[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ questions }),
      })
    )
  );
}

beforeEach(() => {
  mockFetchOk(QUESTIONS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StudentResultsTable", () => {
  it("renders student rows without fetching question detail upfront", () => {
    render(<StudentResultsTable {...props} />);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches question detail once on first student expand and drills down to question level (0-based index -> Q1)", async () => {
    render(<StudentResultsTable {...props} />);

    // Expand the student -> triggers the one-time fetch.
    fireEvent.click(screen.getByText("Asha Rao"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/api/quiz-analytics/1234/student-questions");
    expect(url).toContain("grade=12");
    expect(url).toContain("sessionId=sess-1");

    // Drill: subject -> chapter -> questions.
    fireEvent.click(screen.getByText("Physics"));
    fireEvent.click(await screen.findByText("Kinematics"));

    // position_index 0 renders as Q1 (off-by-one fix), 1 -> Q2.
    await screen.findByText("Q1");
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("does not re-fetch when the student is collapsed and re-expanded", async () => {
    render(<StudentResultsTable {...props} />);

    fireEvent.click(screen.getByText("Asha Rao"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Asha Rao")); // collapse
    fireEvent.click(screen.getByText("Asha Rao")); // re-expand

    // Still only the single initial fetch — data is cached.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows an error banner when the question fetch fails", async () => {
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
    render(<StudentResultsTable {...props} />);
    fireEvent.click(screen.getByText("Asha Rao"));
    await screen.findByText(/BQ outage/);
  });
});
