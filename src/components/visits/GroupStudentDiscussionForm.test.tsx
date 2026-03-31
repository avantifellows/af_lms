import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import GroupStudentDiscussionForm from "./GroupStudentDiscussionForm";
import { GROUP_STUDENT_DISCUSSION_CONFIG } from "@/lib/group-student-discussion";

interface HarnessProps {
  disabled?: boolean;
  initialData?: Record<string, unknown>;
}

function Harness({ disabled = false, initialData = {} }: HarnessProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);

  return (
    <GroupStudentDiscussionForm
      data={data}
      setData={setData}
      disabled={disabled}
    />
  );
}

function buildCompleteData(
  grade: number = 11,
  answer: boolean = true
): Record<string, unknown> {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
    questions[key] = { answer };
  }
  return { grade, questions };
}

describe("GroupStudentDiscussionForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders grade dropdown with options 11 and 12", () => {
      render(<Harness />);

      const select = screen.getByTestId(
        "group-student-grade-select"
      ) as HTMLSelectElement;
      expect(select).toBeInTheDocument();

      const options = select.querySelectorAll("option");
      // placeholder + 11 + 12
      expect(options).toHaveLength(3);
      expect(options[1]).toHaveTextContent("11");
      expect(options[2]).toHaveTextContent("12");
    });

    it("hides questions and progress before grade selection", () => {
      render(<Harness />);

      expect(
        screen.queryByTestId("group-student-discussion-progress")
      ).not.toBeInTheDocument();

      for (const section of GROUP_STUDENT_DISCUSSION_CONFIG.sections) {
        expect(screen.queryByText(section.title, { exact: false })).not.toBeInTheDocument();
      }

      for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
        expect(
          screen.queryByTestId(`group-student-${key}-yes`)
        ).not.toBeInTheDocument();
      }
    });

    it("shows questions and progress after grade selection", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.selectOptions(
        screen.getByTestId("group-student-grade-select"),
        "11"
      );

      expect(
        screen.getByTestId("group-student-discussion-progress")
      ).toBeInTheDocument();

      for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
        expect(
          screen.getByTestId(`group-student-${key}-yes`)
        ).toBeInTheDocument();
        expect(
          screen.getByTestId(`group-student-${key}-no`)
        ).toBeInTheDocument();
      }
    });

    it("renders section title with selected grade number", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.selectOptions(
        screen.getByTestId("group-student-grade-select"),
        "12"
      );

      expect(screen.getByText("General Check Grade 12")).toBeInTheDocument();
    });

    it("shows progress as '0/4' when grade selected but no questions answered", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.selectOptions(
        screen.getByTestId("group-student-grade-select"),
        "11"
      );

      const progress = screen.getByTestId(
        "group-student-discussion-progress"
      );
      expect(progress).toHaveTextContent("Answered: 0/4");
    });

    it("sets data-testid on root element", () => {
      render(<Harness />);

      expect(
        screen.getByTestId("action-renderer-group_student_discussion")
      ).toBeInTheDocument();
    });

    it("renders question labels after grade selected", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.selectOptions(
        screen.getByTestId("group-student-grade-select"),
        "11"
      );

      for (const section of GROUP_STUDENT_DISCUSSION_CONFIG.sections) {
        for (const question of section.questions) {
          expect(
            screen.getAllByText(question.label).length
          ).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it("shows questions when initialData has existing answers (no grade selected)", () => {
      render(
        <Harness
          initialData={{
            questions: {
              gc_interacted: { answer: true },
            },
          }}
        />
      );

      // Should show questions because hasQuestionAnswers is true
      expect(
        screen.getByTestId("group-student-discussion-progress")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("group-student-gc_interacted-yes")
      ).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("clicking Yes radio checks it and updates progress", async () => {
      const user = userEvent.setup();
      render(<Harness initialData={{ grade: 11 }} />);

      const yesRadio = screen.getByTestId("group-student-gc_interacted-yes");
      await user.click(yesRadio);

      expect(yesRadio).toBeChecked();
      expect(
        screen.getByTestId("group-student-gc_interacted-no")
      ).not.toBeChecked();

      const progress = screen.getByTestId(
        "group-student-discussion-progress"
      );
      expect(progress).toHaveTextContent("Answered: 1/4");
    });

    it("clicking No radio checks it", async () => {
      const user = userEvent.setup();
      render(<Harness initialData={{ grade: 11 }} />);

      const noRadio = screen.getByTestId("group-student-gc_interacted-no");
      await user.click(noRadio);

      expect(noRadio).toBeChecked();
      expect(
        screen.getByTestId("group-student-gc_interacted-yes")
      ).not.toBeChecked();
    });

    it("switching from Yes to No updates the radio state", async () => {
      const user = userEvent.setup();
      render(<Harness initialData={{ grade: 11 }} />);

      await user.click(screen.getByTestId("group-student-gc_interacted-yes"));
      expect(
        screen.getByTestId("group-student-gc_interacted-yes")
      ).toBeChecked();

      await user.click(screen.getByTestId("group-student-gc_interacted-no"));
      expect(
        screen.getByTestId("group-student-gc_interacted-no")
      ).toBeChecked();
      expect(
        screen.getByTestId("group-student-gc_interacted-yes")
      ).not.toBeChecked();
    });

    it("Add remark toggle reveals remark textarea", async () => {
      const user = userEvent.setup();
      render(<Harness initialData={{ grade: 11 }} />);

      expect(
        screen.queryByTestId("group-student-gc_interacted-remark")
      ).not.toBeInTheDocument();

      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      expect(
        screen.getByTestId("group-student-gc_interacted-remark")
      ).toBeInTheDocument();
    });

    it("typing in remark textarea updates the value", async () => {
      const user = userEvent.setup();
      render(<Harness initialData={{ grade: 11 }} />);

      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      const textarea = screen.getByTestId(
        "group-student-gc_interacted-remark"
      ) as HTMLTextAreaElement;
      await user.type(textarea, "Test remark");

      expect(textarea.value).toBe("Test remark");
    });

    it("answering all 4 questions shows progress as 4/4", () => {
      render(<Harness initialData={buildCompleteData()} />);

      const progress = screen.getByTestId(
        "group-student-discussion-progress"
      );
      expect(progress).toHaveTextContent("Answered: 4/4");
    });

    it("shows existing remark without clicking Add remark", () => {
      render(
        <Harness
          initialData={{
            grade: 11,
            questions: {
              gc_interacted: { answer: true, remark: "Existing note" },
            },
          }}
        />
      );

      const textarea = screen.getByTestId(
        "group-student-gc_interacted-remark"
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe("Existing note");
    });
  });

  describe("disabled / read-only mode", () => {
    it("grade dropdown is disabled", () => {
      render(<Harness disabled initialData={buildCompleteData()} />);

      expect(
        screen.getByTestId("group-student-grade-select")
      ).toBeDisabled();
    });

    it("radio buttons are disabled", () => {
      render(<Harness disabled initialData={buildCompleteData()} />);

      for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
        expect(
          screen.getByTestId(`group-student-${key}-yes`)
        ).toBeDisabled();
        expect(
          screen.getByTestId(`group-student-${key}-no`)
        ).toBeDisabled();
      }
    });

    it("no Add remark toggles in disabled mode", () => {
      render(<Harness disabled initialData={buildCompleteData()} />);

      expect(screen.queryByText("Add remark")).not.toBeInTheDocument();
    });

    it("remark textareas are disabled when form is disabled", () => {
      render(
        <Harness
          disabled
          initialData={{
            grade: 11,
            questions: {
              gc_interacted: { answer: true, remark: "Some note" },
            },
          }}
        />
      );

      const textarea = screen.getByTestId(
        "group-student-gc_interacted-remark"
      ) as HTMLTextAreaElement;
      expect(textarea).toBeDisabled();
    });
  });
});
