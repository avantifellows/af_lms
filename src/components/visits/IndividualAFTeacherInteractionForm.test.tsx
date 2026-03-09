import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import IndividualAFTeacherInteractionForm from "./IndividualAFTeacherInteractionForm";
import {
  INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG,
  type IndividualTeacherEntry,
} from "@/lib/individual-af-teacher-interaction";

const MOCK_TEACHERS = [
  { id: 1, email: "alice@school.com", full_name: "Alice Teacher" },
  { id: 2, email: "bob@school.com", full_name: "Bob Instructor" },
  { id: 3, email: "carol@school.com", full_name: "Carol Smith" },
];

function mockFetchTeachers(teachers = MOCK_TEACHERS) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ teachers }),
    })
  );
}

function mockFetchTeachersError() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Failed" }),
    })
  );
}

interface HarnessProps {
  disabled?: boolean;
  initialData?: Record<string, unknown>;
  schoolCode?: string;
}

function Harness({ disabled = false, initialData = {}, schoolCode = "12345" }: HarnessProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);

  return (
    <IndividualAFTeacherInteractionForm
      data={data}
      setData={setData}
      disabled={disabled}
      schoolCode={schoolCode}
    />
  );
}

function buildTeacherEntry(
  id: number,
  name: string,
  attendance: "present" | "on_leave" | "absent" = "present",
  answerAll = false
): IndividualTeacherEntry {
  const questions: Record<string, { answer: boolean | null; remark?: string }> = {};
  if (answerAll && attendance === "present") {
    for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: true };
    }
  }
  return { id, name, attendance, questions };
}

describe("IndividualAFTeacherInteractionForm", () => {
  beforeEach(() => {
    mockFetchTeachers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("teacher fetch", () => {
    it("fetches teachers on mount with correct school_code param", async () => {
      render(<Harness schoolCode="SCH999" />);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/pm/teachers?school_code=SCH999");
      });
    });

    it("shows error state on fetch failure", async () => {
      mockFetchTeachersError();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("individual-teacher-error")).toHaveTextContent(
          "Failed to load teachers"
        );
      });
    });

    it("renders Add Teacher dropdown after successful fetch", async () => {
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("add-teacher-select")).toBeInTheDocument();
      });

      // All 3 teachers should appear as options
      const select = screen.getByTestId("add-teacher-select") as HTMLSelectElement;
      expect(within(select).getByText("Alice Teacher")).toBeInTheDocument();
      expect(within(select).getByText("Bob Instructor")).toBeInTheDocument();
      expect(within(select).getByText("Carol Smith")).toBeInTheDocument();
    });
  });

  describe("add teacher + sections", () => {
    it("selecting teacher from dropdown creates new expanded section", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("add-teacher-select")).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId("add-teacher-select"), "1");

      // Section should exist and be expanded (attendance radios visible)
      expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      expect(screen.getByTestId("teacher-1-attendance-present")).toBeInTheDocument();
    });

    it("added teacher is removed from the dropdown", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("add-teacher-select")).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId("add-teacher-select"), "1");

      const select = screen.getByTestId("add-teacher-select") as HTMLSelectElement;
      expect(within(select).queryByText("Alice Teacher")).not.toBeInTheDocument();
      expect(within(select).getByText("Bob Instructor")).toBeInTheDocument();
    });

    it("section shows attendance radios with present selected by default", async () => {
      render(
        <Harness
          initialData={{ teachers: [buildTeacherEntry(1, "Alice Teacher")] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("add-teacher-select")).toBeInTheDocument();
      });

      // Expand the section
      const user = userEvent.setup();
      await user.click(screen.getByTestId("teacher-header-1"));

      expect(screen.getByTestId("teacher-1-attendance-present")).toBeChecked();
      expect(screen.getByTestId("teacher-1-attendance-on_leave")).not.toBeChecked();
      expect(screen.getByTestId("teacher-1-attendance-absent")).not.toBeChecked();
    });

    it("on_leave teacher shows no questions", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [buildTeacherEntry(1, "Alice Teacher", "on_leave")] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("teacher-header-1"));

      // Attendance radios should be visible
      expect(screen.getByTestId("teacher-1-attendance-on_leave")).toBeChecked();

      // No question radios
      const firstKey = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys[0];
      expect(screen.queryByTestId(`teacher-1-${firstKey}-yes`)).not.toBeInTheDocument();
    });

    it("present teacher shows all 13 questions", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [buildTeacherEntry(1, "Alice Teacher", "present")] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("teacher-header-1"));

      // All 13 question Yes/No radios
      for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
        expect(screen.getByTestId(`teacher-1-${key}-yes`)).toBeInTheDocument();
        expect(screen.getByTestId(`teacher-1-${key}-no`)).toBeInTheDocument();
      }

      // All 5 section titles
      for (const section of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.sections) {
        expect(screen.getByText(section.title)).toBeInTheDocument();
      }
    });

    it("shows 'All teachers recorded' message when all fetched teachers are in data", async () => {
      render(
        <Harness
          initialData={{
            teachers: [
              buildTeacherEntry(1, "Alice Teacher"),
              buildTeacherEntry(2, "Bob Instructor"),
              buildTeacherEntry(3, "Carol Smith"),
            ],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("all-teachers-recorded")).toBeInTheDocument();
      });

      expect(screen.getByTestId("all-teachers-recorded")).toHaveTextContent(
        "All teachers recorded"
      );

      // Dropdown should NOT be shown
      expect(screen.queryByTestId("add-teacher-select")).not.toBeInTheDocument();
    });
  });

  describe("collapsible behavior", () => {
    it("clicking header toggles expand/collapse", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [buildTeacherEntry(1, "Alice Teacher")] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      // Initially collapsed (no attendance radios)
      expect(screen.queryByTestId("teacher-1-attendance-present")).not.toBeInTheDocument();

      // Click to expand
      await user.click(screen.getByTestId("teacher-header-1"));
      expect(screen.getByTestId("teacher-1-attendance-present")).toBeInTheDocument();

      // Click to collapse
      await user.click(screen.getByTestId("teacher-header-1"));
      expect(screen.queryByTestId("teacher-1-attendance-present")).not.toBeInTheDocument();
    });

    it("multiple sections can be open simultaneously", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            teachers: [
              buildTeacherEntry(1, "Alice Teacher"),
              buildTeacherEntry(2, "Bob Instructor"),
            ],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      // Expand both sections
      await user.click(screen.getByTestId("teacher-header-1"));
      await user.click(screen.getByTestId("teacher-header-2"));

      expect(screen.getByTestId("teacher-1-attendance-present")).toBeInTheDocument();
      expect(screen.getByTestId("teacher-2-attendance-present")).toBeInTheDocument();
    });

    it("collapsing preserves data", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            teachers: [buildTeacherEntry(1, "Alice Teacher", "present", true)],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      // Expand, verify data, collapse, re-expand, verify again
      await user.click(screen.getByTestId("teacher-header-1"));
      const firstKey = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys[0];
      expect(screen.getByTestId(`teacher-1-${firstKey}-yes`)).toBeChecked();

      await user.click(screen.getByTestId("teacher-header-1"));
      await user.click(screen.getByTestId("teacher-header-1"));

      expect(screen.getByTestId(`teacher-1-${firstKey}-yes`)).toBeChecked();
    });

    it("collapsed header shows name, badge, and question progress", async () => {
      render(
        <Harness
          initialData={{
            teachers: [buildTeacherEntry(1, "Alice Teacher", "present", true)],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      // Collapsed: should see name, badge, and progress in header
      expect(screen.getByTestId("teacher-header-1")).toHaveTextContent("Alice Teacher");
      expect(screen.getByTestId("teacher-badge-1")).toHaveTextContent("Present");
      expect(screen.getByTestId("teacher-progress-1")).toHaveTextContent("13/13");
    });
  });

  describe("editing + removing", () => {
    it("changing attendance present→absent clears questions", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            teachers: [buildTeacherEntry(1, "Alice Teacher", "present", true)],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      // Expand
      await user.click(screen.getByTestId("teacher-header-1"));

      // Verify questions are visible
      const firstKey = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys[0];
      expect(screen.getByTestId(`teacher-1-${firstKey}-yes`)).toBeInTheDocument();

      // Change to absent
      await user.click(screen.getByTestId("teacher-1-attendance-absent"));

      // Questions should be hidden
      expect(screen.queryByTestId(`teacher-1-${firstKey}-yes`)).not.toBeInTheDocument();
      expect(screen.getByTestId("teacher-badge-1")).toHaveTextContent("Absent");
    });

    it("changing present→absent→present shows empty questions", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            teachers: [buildTeacherEntry(1, "Alice Teacher", "present", true)],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("teacher-header-1"));

      // Switch absent → clears questions
      await user.click(screen.getByTestId("teacher-1-attendance-absent"));
      // Switch back present → questions restored but empty
      await user.click(screen.getByTestId("teacher-1-attendance-present"));

      const firstKey = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys[0];
      expect(screen.getByTestId(`teacher-1-${firstKey}-yes`)).not.toBeChecked();
      expect(screen.getByTestId(`teacher-1-${firstKey}-no`)).not.toBeChecked();

      // Progress should show 0/13
      expect(screen.getByTestId("teacher-progress-1")).toHaveTextContent("0/13");
    });

    it("answer change updates data via setData", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [buildTeacherEntry(1, "Alice Teacher")] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("teacher-header-1"));

      const firstKey = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys[0];
      await user.click(screen.getByTestId(`teacher-1-${firstKey}-yes`));

      expect(screen.getByTestId(`teacher-1-${firstKey}-yes`)).toBeChecked();
      expect(screen.getByTestId("teacher-progress-1")).toHaveTextContent("1/13");
    });

    it("remove button removes teacher entry", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            teachers: [
              buildTeacherEntry(1, "Alice Teacher"),
              buildTeacherEntry(2, "Bob Instructor"),
            ],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      // Expand to access remove button
      await user.click(screen.getByTestId("teacher-header-1"));
      await user.click(screen.getByTestId("remove-teacher-1"));

      // Section gone
      expect(screen.queryByTestId("teacher-section-1")).not.toBeInTheDocument();
      // Other section still exists
      expect(screen.getByTestId("teacher-section-2")).toBeInTheDocument();
    });

    it("removed teacher reappears in dropdown", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            teachers: [
              buildTeacherEntry(1, "Alice Teacher"),
              buildTeacherEntry(2, "Bob Instructor"),
            ],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("add-teacher-select")).toBeInTheDocument();
      });

      // Alice should NOT be in dropdown initially (she's recorded)
      const select = screen.getByTestId("add-teacher-select") as HTMLSelectElement;
      expect(within(select).queryByText("Alice Teacher")).not.toBeInTheDocument();

      // Remove Alice
      await user.click(screen.getByTestId("teacher-header-1"));
      await user.click(screen.getByTestId("remove-teacher-1"));

      // Alice should now be back in dropdown
      const selectAfter = screen.getByTestId("add-teacher-select") as HTMLSelectElement;
      expect(within(selectAfter).getByText("Alice Teacher")).toBeInTheDocument();
    });
  });

  describe("progress bar", () => {
    it("shows correct recorded/total count and attendance breakdown", async () => {
      render(
        <Harness
          initialData={{
            teachers: [
              buildTeacherEntry(1, "Alice Teacher", "present"),
              buildTeacherEntry(2, "Bob Instructor", "on_leave"),
              buildTeacherEntry(3, "Carol Smith", "absent"),
            ],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("individual-teacher-progress")).toBeInTheDocument();
      });

      const progress = screen.getByTestId("individual-teacher-progress");
      expect(progress).toHaveTextContent("Recorded: 3/3 teachers");
      expect(progress).toHaveTextContent("1 present, 1 on leave, 1 absent");
    });
  });

  describe("disabled / read-only mode", () => {
    it("sections are collapsed by default and expandable to static text", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          disabled
          initialData={{
            teachers: [buildTeacherEntry(1, "Alice Teacher", "present", true)],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      // Collapsed by default — no radios or question content visible
      const firstKey = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys[0];
      expect(screen.queryByTestId(`teacher-1-${firstKey}-yes`)).not.toBeInTheDocument();

      // Expand — shows static text, not radios
      await user.click(screen.getByTestId("teacher-header-1"));

      // Should show "Attendance:" label as static text (not radios)
      expect(screen.getByText("Attendance:")).toBeInTheDocument();

      // Should NOT have attendance radio inputs
      expect(screen.queryByTestId("teacher-1-attendance-present")).not.toBeInTheDocument();

      // Question answers should show as static text
      const questionLabel = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.sections[0].questions[0].label;
      expect(screen.getByText(questionLabel)).toBeInTheDocument();
    });

    it("no add/remove controls in disabled mode", async () => {
      render(
        <Harness
          disabled
          initialData={{
            teachers: [buildTeacherEntry(1, "Alice Teacher", "present", true)],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      // No add teacher dropdown
      expect(screen.queryByTestId("add-teacher-select")).not.toBeInTheDocument();

      // No remove button (even when expanded)
      expect(screen.queryByTestId("remove-teacher-1")).not.toBeInTheDocument();
    });

    it("expanded disabled section shows Yes/No text for answers", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          disabled
          initialData={{
            teachers: [buildTeacherEntry(1, "Alice Teacher", "present", true)],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("teacher-header-1"));

      // Should display "Yes" for answered questions (all answered true)
      const yesTexts = screen.getAllByText("Yes");
      expect(yesTexts.length).toBe(13);
    });
  });

  describe("edge cases", () => {
    it("teacher in data but not in fetched list still shows with name from data", async () => {
      render(
        <Harness
          initialData={{
            teachers: [buildTeacherEntry(999, "Unknown Teacher")],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("add-teacher-select")).toBeInTheDocument();
      });

      // Section shows with the name from data
      expect(screen.getByTestId("teacher-section-999")).toBeInTheDocument();
      expect(screen.getByTestId("teacher-header-999")).toHaveTextContent("Unknown Teacher");
    });

    it("empty/null data shows empty state with Add Teacher dropdown", async () => {
      render(<Harness initialData={{}} />);

      await waitFor(() => {
        expect(screen.getByTestId("add-teacher-select")).toBeInTheDocument();
      });

      // No teacher sections
      expect(screen.queryByTestId(/^teacher-section-/)).not.toBeInTheDocument();

      // Progress bar shows 0/3
      expect(screen.getByTestId("individual-teacher-progress")).toHaveTextContent(
        "Recorded: 0/3 teachers"
      );
    });
  });

  describe("remark interaction", () => {
    it("Add remark toggle reveals remark textarea and typing updates value", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [buildTeacherEntry(1, "Alice Teacher")] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-section-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("teacher-header-1"));

      const firstKey = INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys[0];

      // No remark textarea yet
      expect(screen.queryByTestId(`teacher-1-${firstKey}-remark`)).not.toBeInTheDocument();

      // Click "Add remark"
      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      const textarea = screen.getByTestId(`teacher-1-${firstKey}-remark`) as HTMLTextAreaElement;
      await user.type(textarea, "Test remark");

      expect(textarea.value).toBe("Test remark");
    });
  });
});
