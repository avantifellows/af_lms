import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StudentResultsTable from "./StudentResultsTable";
import type { StudentDeepDiveRow, StudentQuestionRow } from "@/types/quiz";

const STUDENTS: StudentDeepDiveRow[] = [
  {
    student_name: "Asha Rao",
    enrollment_user_id: "368592",
    gender: "F",
    category: "OBC",
    academic_level: "Not Qualified",
    qualification_status: "Not Qualified",
    marks_scored: 40,
    max_marks: 100,
    percentage: 40,
    accuracy: 50,
    attempt_rate: 60,
    has_quiz_ended: true,
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

  it("badges a student who never submitted the test", () => {
    render(
      <StudentResultsTable
        {...props}
        students={[{ ...STUDENTS[0], has_quiz_ended: false }]}
      />
    );
    expect(screen.getByText("Test Incomplete")).toBeInTheDocument();
  });

  it("does not let an unsubmitted student consume a rank position", () => {
    render(
      <StudentResultsTable
        {...props}
        students={[
          { ...STUDENTS[0], student_name: "Top Scorer", percentage: 90, has_quiz_ended: true },
          { ...STUDENTS[0], student_name: "Walked Out", percentage: 4, has_quiz_ended: false },
          { ...STUDENTS[0], student_name: "Second", percentage: 50, has_quiz_ended: true },
        ]}
      />
    );
    const rowFor = (name: string) =>
      screen.getByText(name).closest("tr") as HTMLElement;
    expect(rowFor("Top Scorer").textContent).toContain("01");
    expect(rowFor("Second").textContent).toContain("02");
    // Not "03" — ranking a non-participant misstates the "of N" a teacher reads.
    expect(rowFor("Walked Out").textContent).toContain("—");
  });

  it("sorts unsubmitted attempts below submitted ones on an equal score", () => {
    // A genuine 0% (negative marking, submitted) must outrank a 0% walkout,
    // otherwise the ranked column reads out of order.
    render(
      <StudentResultsTable
        {...props}
        students={[
          { ...STUDENTS[0], student_name: "Walked Out", percentage: 0, has_quiz_ended: false },
          { ...STUDENTS[0], student_name: "Scored Zero", percentage: 0, has_quiz_ended: true },
        ]}
      />
    );
    const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent || "");
    const iZero = names.findIndex((t) => t.includes("Scored Zero"));
    const iOut = names.findIndex((t) => t.includes("Walked Out"));
    expect(iZero).toBeLessThan(iOut);
  });

  it("shows no badge when submission status is unknown", () => {
    // Report docs written before etl-next carried the flag have no value at all.
    // Treating that as unsubmitted would badge every historical test.
    render(
      <StudentResultsTable
        {...props}
        students={[{ ...STUDENTS[0], has_quiz_ended: null }]}
      />
    );
    expect(screen.queryByText("Test Incomplete")).not.toBeInTheDocument();
  });

  it("shows no badge for a submitted attempt", () => {
    render(<StudentResultsTable {...props} />);
    expect(screen.queryByText("Test Incomplete")).not.toBeInTheDocument();
  });

  it("renders the student's social category as a chip", () => {
    render(<StudentResultsTable {...props} />);
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("OBC")).toBeInTheDocument();
  });

  it("renders an em-dash for a student with no recorded category", () => {
    render(
      <StudentResultsTable
        {...props}
        students={[{ ...STUDENTS[0], category: null }]}
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shortens the long AL values so they fit a table cell", () => {
    render(<StudentResultsTable {...props} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    // "Not Qualified" -> "NQ"; the raw value must not leak into the cell.
    expect(screen.getByText("NQ")).toBeInTheDocument();
    expect(screen.queryByText("Not Qualified")).not.toBeInTheDocument();
  });

  it("renders M1/B1-style ALs verbatim", () => {
    render(
      <StudentResultsTable
        {...props}
        students={[{ ...STUDENTS[0], academic_level: "M1" }]}
      />
    );
    expect(screen.getByText("M1")).toBeInTheDocument();
  });

  it("shows NA for a test with no AL (e.g. a chapter test)", () => {
    render(
      <StudentResultsTable
        {...props}
        students={[{ ...STUDENTS[0], academic_level: null }]}
      />
    );
    expect(screen.getByText("NA")).toBeInTheDocument();
  });

  it("flags on-track / off-track from qualification_status (#28 item 2)", () => {
    render(
      <StudentResultsTable
        {...props}
        students={[{ ...STUDENTS[0], qualification_status: "Qualified" }]}
      />
    );
    expect(screen.getByText("On Track")).toBeInTheDocument();
    expect(screen.getByText("On track")).toBeInTheDocument();
  });

  it("shows Off track for a Not Qualified student", () => {
    render(<StudentResultsTable {...props} />);
    expect(screen.getByText("Off track")).toBeInTheDocument();
  });

  it("shows NA rather than guessing when qualification_status is absent", () => {
    render(
      <StudentResultsTable
        {...props}
        students={[{ ...STUDENTS[0], qualification_status: null }]}
      />
    );
    expect(screen.getByText("NA")).toBeInTheDocument();
    expect(screen.queryByText("On track")).not.toBeInTheDocument();
    expect(screen.queryByText("Off track")).not.toBeInTheDocument();
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
