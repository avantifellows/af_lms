import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import IndividualStudentDiscussionForm from "./IndividualStudentDiscussionForm";
import {
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG,
  type IndividualStudentEntry,
} from "@/lib/individual-student-discussion";

const MOCK_STUDENTS = [
  { id: 1, full_name: "Alice Student", student_id: "STU001", grade: 11 },
  { id: 2, full_name: "Bob Learner", student_id: "STU002", grade: 11 },
  { id: 3, full_name: "Carol Pupil", student_id: "STU003", grade: 11 },
];

let mockFetch: ReturnType<typeof vi.fn>;

function mockFetchStudents(students = MOCK_STUDENTS) {
  mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ students }),
  });
  vi.stubGlobal("fetch", mockFetch);
}

function mockFetchStudentsError() {
  mockFetch = vi.fn().mockResolvedValue({
    ok: false,
    json: () => Promise.resolve({ error: "Failed" }),
  });
  vi.stubGlobal("fetch", mockFetch);
}

interface HarnessProps {
  disabled?: boolean;
  initialData?: Record<string, unknown>;
  schoolCode?: string;
}

function Harness({ disabled = false, initialData = {}, schoolCode = "12345" }: HarnessProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);

  return (
    <IndividualStudentDiscussionForm
      data={data}
      setData={setData}
      disabled={disabled}
      schoolCode={schoolCode}
    />
  );
}

function buildStudentEntry(
  id: number,
  name: string,
  grade: number = 11,
  answerAll = false
): IndividualStudentEntry {
  const questions: Record<string, { answer: boolean | null; remark?: string }> = {};
  if (answerAll) {
    for (const key of INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: true };
    }
  }
  return { id, name, grade, questions };
}

async function selectGrade(user: ReturnType<typeof userEvent.setup>, grade: string = "11") {
  await user.selectOptions(screen.getByTestId("student-grade-filter"), grade);
}

/** Focus the search input to open the dropdown listbox */
async function openStudentSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("add-student-select"));
}

/** Select a student by clicking their option in the searchable dropdown */
async function selectStudentOption(user: ReturnType<typeof userEvent.setup>, studentId: number) {
  const option = screen.getByTestId(`student-option-${studentId}`);
  await user.click(option);
}

describe("IndividualStudentDiscussionForm", () => {
  beforeEach(() => {
    mockFetchStudents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("grade filter and student fetch", () => {
    it("renders grade filter dropdown with valid grades", () => {
      render(<Harness />);

      const gradeFilter = screen.getByTestId("student-grade-filter");
      expect(gradeFilter).toBeInTheDocument();
      expect(within(gradeFilter).getByText("11")).toBeInTheDocument();
      expect(within(gradeFilter).getByText("12")).toBeInTheDocument();
    });

    it("does not fetch students until a grade is selected", () => {
      render(<Harness />);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(screen.queryByTestId("add-student-select")).not.toBeInTheDocument();
    });

    it("fetches students with correct school_code and grade params when grade selected", async () => {
      const user = userEvent.setup();
      render(<Harness schoolCode="SCH999" />);

      await selectGrade(user, "11");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/pm/students?school_code=SCH999&grade=11"
        );
      });
    });

    it("re-fetches students when grade changes", async () => {
      const user = userEvent.setup();
      render(<Harness schoolCode="SCH999" />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/pm/students?school_code=SCH999&grade=11"
        );
      });

      await selectGrade(user, "12");
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/pm/students?school_code=SCH999&grade=12"
        );
      });
    });

    it("shows loading state during fetch", async () => {
      // Use a never-resolving fetch to keep loading state
      mockFetch = vi.fn().mockReturnValue(new Promise(() => {}));
      vi.stubGlobal("fetch", mockFetch);

      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");

      await waitFor(() => {
        expect(screen.getByTestId("individual-student-loading")).toHaveTextContent(
          "Loading students..."
        );
      });
    });

    it("shows error state on fetch failure", async () => {
      mockFetchStudentsError();
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");

      await waitFor(() => {
        expect(screen.getByTestId("individual-student-error")).toHaveTextContent(
          "Failed to load students"
        );
      });
    });

    it("renders searchable student input after successful fetch", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");

      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      // Focus to open dropdown
      await openStudentSearch(user);

      const listbox = screen.getByTestId("student-search-listbox");
      expect(within(listbox).getByText("Alice Student")).toBeInTheDocument();
      expect(within(listbox).getByText("Bob Learner")).toBeInTheDocument();
      expect(within(listbox).getByText("Carol Pupil")).toBeInTheDocument();
    });
  });

  describe("searchable dropdown", () => {
    it("filters students by name as user types", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      await user.type(screen.getByTestId("add-student-select"), "alice");

      const listbox = screen.getByTestId("student-search-listbox");
      expect(within(listbox).getByText("Alice Student")).toBeInTheDocument();
      expect(within(listbox).queryByText("Bob Learner")).not.toBeInTheDocument();
      expect(within(listbox).queryByText("Carol Pupil")).not.toBeInTheDocument();
    });

    it("filters students by student_id", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      await user.type(screen.getByTestId("add-student-select"), "STU002");

      const listbox = screen.getByTestId("student-search-listbox");
      expect(within(listbox).queryByText("Alice Student")).not.toBeInTheDocument();
      expect(within(listbox).getByText("Bob Learner")).toBeInTheDocument();
    });

    it("shows 'No matches' when filter returns empty", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      await user.type(screen.getByTestId("add-student-select"), "zzzzz");

      const listbox = screen.getByTestId("student-search-listbox");
      expect(within(listbox).getByText("No matches")).toBeInTheDocument();
    });

    it("supports multi-token fuzzy matching", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      // "bob learn" should match "Bob Learner"
      await user.type(screen.getByTestId("add-student-select"), "bob learn");

      const listbox = screen.getByTestId("student-search-listbox");
      expect(within(listbox).getByText("Bob Learner")).toBeInTheDocument();
      expect(within(listbox).queryByText("Alice Student")).not.toBeInTheDocument();
    });

    it("selects student via keyboard (arrow down + enter)", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      const input = screen.getByTestId("add-student-select");
      await user.click(input);
      await user.keyboard("{ArrowDown}{Enter}");

      expect(screen.getByTestId("student-section-1")).toBeInTheDocument();
    });

    it("closes dropdown on Escape", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      await openStudentSearch(user);
      expect(screen.getByTestId("student-search-listbox")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(screen.queryByTestId("student-search-listbox")).not.toBeInTheDocument();
    });

    it("clears input after selecting a student", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      await user.type(screen.getByTestId("add-student-select"), "alice");
      await user.click(screen.getByTestId("student-option-1"));

      expect(screen.getByTestId("add-student-select")).toHaveValue("");
    });
  });

  describe("add student + sections", () => {
    it("selecting student from dropdown creates new expanded section", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      await openStudentSearch(user);
      await selectStudentOption(user, 1);

      expect(screen.getByTestId("student-section-1")).toBeInTheDocument();
      // Section should be expanded — question radios visible
      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];
      expect(screen.getByTestId(`student-1-${firstKey}-yes`)).toBeInTheDocument();
    });

    it("added student is removed from the dropdown", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      await openStudentSearch(user);
      await selectStudentOption(user, 1);

      // Type a space to re-open the dropdown and show all remaining
      const input = screen.getByTestId("add-student-select");
      await user.click(input);
      await waitFor(() => {
        expect(screen.getByTestId("student-search-listbox")).toBeInTheDocument();
      });
      const listbox = screen.getByTestId("student-search-listbox");
      expect(within(listbox).queryByText("Alice Student")).not.toBeInTheDocument();
      expect(within(listbox).getByText("Bob Learner")).toBeInTheDocument();
    });

    it("section header shows name, grade badge, and question progress", async () => {
      render(
        <Harness
          initialData={{ students: [buildStudentEntry(1, "Alice Student", 11, true)] }}
        />
      );

      expect(screen.getByTestId("student-header-1")).toHaveTextContent("Alice Student");
      expect(screen.getByTestId("student-grade-badge-1")).toHaveTextContent("Grade 11");
      expect(screen.getByTestId("student-progress-1")).toHaveTextContent("2/2");
    });
  });

  describe("collapsible behavior", () => {
    it("clicking header toggles expand/collapse", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ students: [buildStudentEntry(1, "Alice Student")] }}
        />
      );

      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];

      // Initially collapsed
      expect(screen.queryByTestId(`student-1-${firstKey}-yes`)).not.toBeInTheDocument();

      // Click to expand
      await user.click(screen.getByTestId("student-header-1"));
      expect(screen.getByTestId(`student-1-${firstKey}-yes`)).toBeInTheDocument();

      // Click to collapse
      await user.click(screen.getByTestId("student-header-1"));
      expect(screen.queryByTestId(`student-1-${firstKey}-yes`)).not.toBeInTheDocument();
    });

    it("multiple sections can be open simultaneously", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            students: [
              buildStudentEntry(1, "Alice Student"),
              buildStudentEntry(2, "Bob Learner"),
            ],
          }}
        />
      );

      await user.click(screen.getByTestId("student-header-1"));
      await user.click(screen.getByTestId("student-header-2"));

      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];
      expect(screen.getByTestId(`student-1-${firstKey}-yes`)).toBeInTheDocument();
      expect(screen.getByTestId(`student-2-${firstKey}-yes`)).toBeInTheDocument();
    });

    it("collapsing preserves data", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            students: [buildStudentEntry(1, "Alice Student", 11, true)],
          }}
        />
      );

      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];

      // Expand, verify, collapse, re-expand, verify again
      await user.click(screen.getByTestId("student-header-1"));
      expect(screen.getByTestId(`student-1-${firstKey}-yes`)).toBeChecked();

      await user.click(screen.getByTestId("student-header-1"));
      await user.click(screen.getByTestId("student-header-1"));

      expect(screen.getByTestId(`student-1-${firstKey}-yes`)).toBeChecked();
    });
  });

  describe("editing + removing", () => {
    it("answer change updates data and progress", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ students: [buildStudentEntry(1, "Alice Student")] }}
        />
      );

      await user.click(screen.getByTestId("student-header-1"));

      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];
      await user.click(screen.getByTestId(`student-1-${firstKey}-yes`));

      expect(screen.getByTestId(`student-1-${firstKey}-yes`)).toBeChecked();
      expect(screen.getByTestId("student-progress-1")).toHaveTextContent("1/2");
    });

    it("remove button removes student entry", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            students: [
              buildStudentEntry(1, "Alice Student"),
              buildStudentEntry(2, "Bob Learner"),
            ],
          }}
        />
      );

      await user.click(screen.getByTestId("student-header-1"));
      await user.click(screen.getByTestId("remove-student-1"));

      expect(screen.queryByTestId("student-section-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("student-section-2")).toBeInTheDocument();
    });

    it("removed student reappears in dropdown", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            students: [
              buildStudentEntry(1, "Alice Student"),
              buildStudentEntry(2, "Bob Learner"),
            ],
          }}
        />
      );

      // Select grade to trigger fetch and show search input
      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      // Open dropdown — Alice should NOT be listed (she's recorded)
      await openStudentSearch(user);
      const listbox = screen.getByTestId("student-search-listbox");
      expect(within(listbox).queryByText("Alice Student")).not.toBeInTheDocument();

      // Close dropdown, remove Alice
      await user.keyboard("{Escape}");
      await user.click(screen.getByTestId("student-header-1"));
      await user.click(screen.getByTestId("remove-student-1"));

      // Re-open dropdown — Alice should be back
      await openStudentSearch(user);
      const listboxAfter = screen.getByTestId("student-search-listbox");
      expect(within(listboxAfter).getByText("Alice Student")).toBeInTheDocument();
    });
  });

  describe("progress bar", () => {
    it("shows student count when students are recorded", () => {
      render(
        <Harness
          initialData={{
            students: [
              buildStudentEntry(1, "Alice Student"),
              buildStudentEntry(2, "Bob Learner"),
            ],
          }}
        />
      );

      const progress = screen.getByTestId("individual-student-progress");
      expect(progress).toHaveTextContent("Students: 2");
    });

    it("does not show progress bar when no students recorded", () => {
      render(<Harness initialData={{}} />);

      expect(screen.queryByTestId("individual-student-progress")).not.toBeInTheDocument();
    });
  });

  describe("disabled / read-only mode", () => {
    it("no grade filter, add, or remove controls in disabled mode", () => {
      render(
        <Harness
          disabled
          initialData={{
            students: [buildStudentEntry(1, "Alice Student", 11, true)],
          }}
        />
      );

      expect(screen.queryByTestId("student-grade-filter")).not.toBeInTheDocument();
      expect(screen.queryByTestId("add-student-select")).not.toBeInTheDocument();
      expect(screen.queryByTestId("remove-student-1")).not.toBeInTheDocument();
    });

    it("sections are collapsed by default and expandable to static text", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          disabled
          initialData={{
            students: [buildStudentEntry(1, "Alice Student", 11, true)],
          }}
        />
      );

      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];

      // Collapsed — no radios visible
      expect(screen.queryByTestId(`student-1-${firstKey}-yes`)).not.toBeInTheDocument();

      // Expand — shows static text, not radios
      await user.click(screen.getByTestId("student-header-1"));

      // Should show question label
      const questionLabel = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.sections[0].questions[0].label;
      expect(screen.getByText(questionLabel)).toBeInTheDocument();

      // Should NOT have radio inputs
      expect(screen.queryByTestId(`student-1-${firstKey}-yes`)).not.toBeInTheDocument();

      // Should display "Yes" for answered questions (all true)
      const yesTexts = screen.getAllByText("Yes");
      expect(yesTexts.length).toBe(2);
    });
  });

  describe("remark interaction", () => {
    it("Add remark toggle reveals remark textarea and typing updates value", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ students: [buildStudentEntry(1, "Alice Student")] }}
        />
      );

      await user.click(screen.getByTestId("student-header-1"));

      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];

      // No remark textarea yet
      expect(screen.queryByTestId(`student-1-${firstKey}-remark`)).not.toBeInTheDocument();

      // Click "Add remark"
      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      const textarea = screen.getByTestId(`student-1-${firstKey}-remark`) as HTMLTextAreaElement;
      await user.type(textarea, "Test remark");

      expect(textarea.value).toBe("Test remark");
    });
  });

  describe("edge cases", () => {
    it("student in data but not in fetched list still shows with name from data", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            students: [buildStudentEntry(999, "Unknown Student", 11)],
          }}
        />
      );

      // Select grade to trigger fetch
      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
      });

      // Section shows with name from data
      expect(screen.getByTestId("student-section-999")).toBeInTheDocument();
      expect(screen.getByTestId("student-header-999")).toHaveTextContent("Unknown Student");
    });

    it("empty data shows no student sections and no progress bar", () => {
      render(<Harness initialData={{}} />);

      expect(screen.queryByTestId(/^student-section-/)).not.toBeInTheDocument();
      expect(screen.queryByTestId("individual-student-progress")).not.toBeInTheDocument();
    });
  });
});
