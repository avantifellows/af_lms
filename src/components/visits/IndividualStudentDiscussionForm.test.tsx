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

async function openMultiSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("multi-select-student-trigger"));
  await waitFor(() => {
    expect(screen.getByTestId("multi-select-student-panel")).toBeInTheDocument();
  });
}

async function checkStudent(user: ReturnType<typeof userEvent.setup>, studentId: number) {
  await user.click(screen.getByTestId(`student-checkbox-${studentId}`));
}

async function clickAddSelected(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("add-selected-students"));
}

async function checkAllStudents(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("select-all-students"));
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
      expect(screen.queryByTestId("multi-select-student-trigger")).not.toBeInTheDocument();
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

    it("renders multi-select student dropdown after successful fetch", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");

      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("multi-select-student-trigger"));

      const panel = screen.getByTestId("multi-select-student-panel");
      expect(within(panel).getByTestId("select-all-students")).toBeInTheDocument();
      expect(within(panel).getByTestId("multi-select-student-search")).toBeInTheDocument();
      expect(within(panel).getByTestId("student-checkbox-1")).toBeInTheDocument();
      expect(within(panel).getByTestId("student-checkbox-2")).toBeInTheDocument();
      expect(within(panel).getByTestId("student-checkbox-3")).toBeInTheDocument();
      expect(within(panel).getByTestId("add-selected-students")).toHaveTextContent(
        "Add Selected (0)"
      );
    });
  });

  describe("multi-select dropdown", () => {
    it("toggles an individual student checkbox", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      const checkbox = screen.getByTestId("student-checkbox-1");

      await user.click(checkbox);
      expect(checkbox).toBeChecked();
      expect(screen.getByTestId("add-selected-students")).toHaveTextContent("Add Selected (1)");

      await user.click(checkbox);
      expect(checkbox).not.toBeChecked();
      expect(screen.getByTestId("add-selected-students")).toBeDisabled();
    });

    it("supports checking multiple student rows before adding", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await checkStudent(user, 1);
      await checkStudent(user, 2);

      expect(screen.getByTestId("student-checkbox-1")).toBeChecked();
      expect(screen.getByTestId("student-checkbox-2")).toBeChecked();
      expect(screen.getByTestId("add-selected-students")).toHaveTextContent("Add Selected (2)");
    });

    it("select all checks all visible students when some are unchecked", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await checkStudent(user, 1);
      await checkAllStudents(user);

      expect(screen.getByTestId("student-checkbox-1")).toBeChecked();
      expect(screen.getByTestId("student-checkbox-2")).toBeChecked();
      expect(screen.getByTestId("student-checkbox-3")).toBeChecked();
      expect(screen.getByTestId("select-all-students")).toHaveTextContent("Deselect All");
    });

    it("select all unchecks visible students when all visible are checked", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await checkAllStudents(user);
      await checkAllStudents(user);

      expect(screen.getByTestId("student-checkbox-1")).not.toBeChecked();
      expect(screen.getByTestId("student-checkbox-2")).not.toBeChecked();
      expect(screen.getByTestId("student-checkbox-3")).not.toBeChecked();
      expect(screen.getByTestId("add-selected-students")).toBeDisabled();
    });

    it("select all is disabled when the search has no matches", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await user.type(screen.getByTestId("multi-select-student-search"), "zzzzz");

      expect(screen.getByText("No matches")).toBeInTheDocument();
      expect(screen.getByTestId("select-all-students")).toBeDisabled();
      expect(screen.getByTestId("add-selected-students")).toBeDisabled();
    });

    it("select all only affects visible students", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await user.type(screen.getByTestId("multi-select-student-search"), "alice");
      await checkStudent(user, 1);
      await user.clear(screen.getByTestId("multi-select-student-search"));
      await user.type(screen.getByTestId("multi-select-student-search"), "bob");
      await checkAllStudents(user);
      expect(screen.getByTestId("student-checkbox-2")).toBeChecked();

      await user.clear(screen.getByTestId("multi-select-student-search"));
      expect(screen.getByTestId("student-checkbox-1")).toBeChecked();
      expect(screen.getByTestId("student-checkbox-2")).toBeChecked();
      expect(screen.getByTestId("student-checkbox-3")).not.toBeChecked();
    });

    it("filters students by name and student_id", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      const search = screen.getByTestId("multi-select-student-search");

      await user.type(search, "alice");
      expect(screen.getByText("Alice Student")).toBeInTheDocument();
      expect(screen.queryByText("Bob Learner")).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "STU002");
      expect(screen.queryByText("Alice Student")).not.toBeInTheDocument();
      expect(screen.getByText("Bob Learner")).toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "bob learn");
      expect(screen.getByText("Bob Learner")).toBeInTheDocument();
      expect(screen.queryByText("Carol Pupil")).not.toBeInTheDocument();
    });

    it("keeps checked state across search queries and adds all checked students", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      const search = screen.getByTestId("multi-select-student-search");
      await user.type(search, "alice");
      await checkStudent(user, 1);
      await user.clear(search);
      await user.type(search, "bob");
      await checkStudent(user, 2);
      await clickAddSelected(user);

      expect(screen.getByTestId("student-section-1")).toBeInTheDocument();
      expect(screen.getByTestId("student-section-2")).toBeInTheDocument();
      expect(screen.queryByTestId("multi-select-student-panel")).not.toBeInTheDocument();
      expect(screen.getByTestId("multi-select-student-trigger")).toHaveFocus();
    });

    it("closes on Escape, clears checked state and query, and returns focus", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await checkStudent(user, 1);
      await user.type(screen.getByTestId("multi-select-student-search"), "alice");
      await user.keyboard("{Escape}");

      expect(screen.queryByTestId("multi-select-student-panel")).not.toBeInTheDocument();
      expect(screen.getByTestId("multi-select-student-trigger")).toHaveFocus();

      await openMultiSelect(user);
      expect(screen.getByTestId("multi-select-student-search")).toHaveValue("");
      expect(screen.getByTestId("student-checkbox-1")).not.toBeChecked();
    });

    it("outside click closes the dropdown but preserves checked state", async () => {
      const user = userEvent.setup();
      render(
        <div>
          <button type="button">Outside</button>
          <Harness />
        </div>
      );

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await checkStudent(user, 1);
      await user.click(screen.getByRole("button", { name: "Outside" }));

      expect(screen.queryByTestId("multi-select-student-panel")).not.toBeInTheDocument();

      await openMultiSelect(user);
      expect(screen.getByTestId("student-checkbox-1")).toBeChecked();
    });

    it("grade change clears pending checked state through remount", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });
      await openMultiSelect(user);
      await checkStudent(user, 1);

      await selectGrade(user, "12");
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/pm/students?school_code=12345&grade=12"
        );
      });
      await openMultiSelect(user);
      expect(screen.getByTestId("student-checkbox-1")).not.toBeChecked();
    });

    it("Enter in search adds checked students and is a no-op with no checked students", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      const search = screen.getByTestId("multi-select-student-search");
      await user.click(search);
      await user.keyboard("{Enter}");
      expect(screen.queryByTestId("student-section-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("multi-select-student-panel")).toBeInTheDocument();

      await checkStudent(user, 1);
      await user.click(search);
      await user.keyboard("{Enter}");
      expect(screen.getByTestId("student-section-1")).toBeInTheDocument();
    });

    it("updates aria-expanded as the dropdown opens and closes", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      const trigger = screen.getByTestId("multi-select-student-trigger");
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      await openMultiSelect(user);
      expect(trigger).toHaveAttribute("aria-expanded", "true");

      await user.keyboard("{Escape}");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("add student + sections", () => {
    it("adding one checked student creates a new expanded section", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await checkStudent(user, 1);
      await clickAddSelected(user);

      expect(screen.getByTestId("student-section-1")).toBeInTheDocument();
      // Section should be expanded — question radios visible
      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];
      expect(screen.getByTestId(`student-1-${firstKey}-yes`)).toBeInTheDocument();
    });

    it("batch-added students render as collapsed sections", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await checkStudent(user, 1);
      await checkStudent(user, 2);
      await checkStudent(user, 3);
      await clickAddSelected(user);

      await waitFor(() => {
        expect(screen.getByTestId("student-section-1")).toBeInTheDocument();
        expect(screen.getByTestId("student-section-2")).toBeInTheDocument();
        expect(screen.getByTestId("student-section-3")).toBeInTheDocument();
      });
      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];
      expect(screen.queryByTestId(`student-1-${firstKey}-yes`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`student-2-${firstKey}-yes`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`student-3-${firstKey}-yes`)).not.toBeInTheDocument();
    });

    it("batch add leaves existing expanded sections open", async () => {
      const user = userEvent.setup();
      render(<Harness initialData={{ students: [buildStudentEntry(99, "Existing Student")] }} />);

      await user.click(screen.getByTestId("student-header-99"));
      const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];
      expect(screen.getByTestId(`student-99-${firstKey}-yes`)).toBeInTheDocument();

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });
      await openMultiSelect(user);
      await checkStudent(user, 1);
      await checkStudent(user, 2);
      await clickAddSelected(user);

      expect(screen.getByTestId(`student-99-${firstKey}-yes`)).toBeInTheDocument();
      expect(screen.queryByTestId(`student-1-${firstKey}-yes`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`student-2-${firstKey}-yes`)).not.toBeInTheDocument();
    });

    it("added students are removed from the dropdown", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await checkStudent(user, 1);
      await clickAddSelected(user);

      await openMultiSelect(user);
      const panel = screen.getByTestId("multi-select-student-panel");
      expect(within(panel).queryByText("Alice Student")).not.toBeInTheDocument();
      expect(within(panel).getByText("Bob Learner")).toBeInTheDocument();
    });

    it("resets search, checked state, and focus after adding selected students", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      await user.type(screen.getByTestId("multi-select-student-search"), "alice");
      await checkStudent(user, 1);
      await clickAddSelected(user);

      expect(screen.queryByTestId("multi-select-student-panel")).not.toBeInTheDocument();
      expect(screen.getByTestId("multi-select-student-trigger")).toHaveFocus();

      await openMultiSelect(user);
      expect(screen.getByTestId("multi-select-student-search")).toHaveValue("");
      expect(screen.getByTestId("student-checkbox-2")).not.toBeChecked();
      expect(screen.getByTestId("add-selected-students")).toHaveTextContent("Add Selected (0)");
    });

    it("filters duplicate IDs when adding selected students", async () => {
      const user = userEvent.setup();
      render(<Harness initialData={{ students: [buildStudentEntry(1, "Alice Student")] }} />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      await openMultiSelect(user);
      expect(screen.queryByTestId("student-checkbox-1")).not.toBeInTheDocument();
      await checkStudent(user, 2);
      await clickAddSelected(user);

      expect(screen.getByTestId("student-section-1")).toBeInTheDocument();
      expect(screen.getByTestId("student-section-2")).toBeInTheDocument();
      expect(screen.queryAllByTestId("student-section-1")).toHaveLength(1);
    });

    it("does not render the dropdown when the selected grade returns no students", async () => {
      mockFetchStudents([]);
      const user = userEvent.setup();
      render(<Harness />);

      await selectGrade(user, "11");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("multi-select-student-trigger")).not.toBeInTheDocument();
    });

    it("can add students from multiple grades to the same action", async () => {
      const user = userEvent.setup();
      const grade11 = [{ id: 1, full_name: "Alice Student", student_id: "STU001", grade: 11 }];
      const grade12 = [{ id: 4, full_name: "Dev Student", student_id: "STU004", grade: 12 }];
      mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ students: grade11 }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ students: grade12 }) });
      vi.stubGlobal("fetch", mockFetch);
      render(<Harness />);

      await selectGrade(user, "11");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });
      await openMultiSelect(user);
      await checkStudent(user, 1);
      await clickAddSelected(user);

      await selectGrade(user, "12");
      await waitFor(() => {
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });
      await openMultiSelect(user);
      await checkStudent(user, 4);
      await clickAddSelected(user);

      expect(screen.getByTestId("student-section-1")).toBeInTheDocument();
      expect(screen.getByTestId("student-grade-badge-1")).toHaveTextContent("Grade 11");
      expect(screen.getByTestId("student-section-4")).toBeInTheDocument();
      expect(screen.getByTestId("student-grade-badge-4")).toHaveTextContent("Grade 12");
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
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
      });

      // Open dropdown — Alice should NOT be listed (she's recorded)
      await openMultiSelect(user);
      const panel = screen.getByTestId("multi-select-student-panel");
      expect(within(panel).queryByText("Alice Student")).not.toBeInTheDocument();

      // Close dropdown, remove Alice
      await user.keyboard("{Escape}");
      await user.click(screen.getByTestId("student-header-1"));
      await user.click(screen.getByTestId("remove-student-1"));

      // Re-open dropdown — Alice should be back
      await openMultiSelect(user);
      const panelAfter = screen.getByTestId("multi-select-student-panel");
      expect(within(panelAfter).getByText("Alice Student")).toBeInTheDocument();
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
      expect(screen.queryByTestId("multi-select-student-trigger")).not.toBeInTheDocument();
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
        expect(screen.getByTestId("multi-select-student-trigger")).toBeInTheDocument();
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
