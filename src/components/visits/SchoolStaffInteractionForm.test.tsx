import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import SchoolStaffInteractionForm from "./SchoolStaffInteractionForm";
import { SCHOOL_STAFF_INTERACTION_CONFIG } from "@/lib/school-staff-interaction";

interface HarnessProps {
  disabled?: boolean;
  initialData?: Record<string, unknown>;
}

function Harness({ disabled = false, initialData = {} }: HarnessProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);

  return (
    <SchoolStaffInteractionForm
      data={data}
      setData={setData}
      disabled={disabled}
    />
  );
}

function buildCompleteData(answer: boolean = true): Record<string, unknown> {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer };
  }
  return { questions };
}

describe("SchoolStaffInteractionForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders all 1 section", () => {
      render(<Harness />);

      for (const section of SCHOOL_STAFF_INTERACTION_CONFIG.sections) {
        expect(screen.getByText(section.title)).toBeInTheDocument();
      }
    });

    it("renders all 2 questions with Yes/No radios", () => {
      render(<Harness />);

      for (const key of SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys) {
        expect(screen.getByTestId(`school-staff-interaction-${key}-yes`)).toBeInTheDocument();
        expect(screen.getByTestId(`school-staff-interaction-${key}-no`)).toBeInTheDocument();
      }
    });

    it("renders question labels", () => {
      render(<Harness />);

      for (const section of SCHOOL_STAFF_INTERACTION_CONFIG.sections) {
        for (const question of section.questions) {
          expect(screen.getAllByText(question.label).length).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it("shows progress as '0/2' when no questions answered", () => {
      render(<Harness />);

      const progress = screen.getByTestId("school-staff-interaction-progress");
      expect(progress).toHaveTextContent("Answered: 0/2");
    });

    it("sets data-testid on root element", () => {
      render(<Harness />);

      expect(screen.getByTestId("action-renderer-school_staff_interaction")).toBeInTheDocument();
    });

    it("does not render any teacher or student related UI", () => {
      render(<Harness />);

      expect(screen.queryByText(/teachers/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/students/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/select all/i)).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("clicking Yes radio checks it and updates progress", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const yesRadio = screen.getByTestId("school-staff-interaction-gc_staff_concern-yes");
      await user.click(yesRadio);

      expect(yesRadio).toBeChecked();
      expect(screen.getByTestId("school-staff-interaction-gc_staff_concern-no")).not.toBeChecked();

      const progress = screen.getByTestId("school-staff-interaction-progress");
      expect(progress).toHaveTextContent("Answered: 1/2");
    });

    it("clicking No radio checks it", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const noRadio = screen.getByTestId("school-staff-interaction-gc_staff_concern-no");
      await user.click(noRadio);

      expect(noRadio).toBeChecked();
      expect(screen.getByTestId("school-staff-interaction-gc_staff_concern-yes")).not.toBeChecked();
    });

    it("Add remark toggle reveals remark textarea", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      expect(screen.queryByTestId("school-staff-interaction-gc_staff_concern-remark")).not.toBeInTheDocument();

      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      expect(screen.getByTestId("school-staff-interaction-gc_staff_concern-remark")).toBeInTheDocument();
    });

    it("typing in remark textarea updates the value", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      const textarea = screen.getByTestId("school-staff-interaction-gc_staff_concern-remark") as HTMLTextAreaElement;
      await user.type(textarea, "Test remark");

      expect(textarea.value).toBe("Test remark");
    });

    it("answering all 2 questions shows progress as 2/2", async () => {
      render(<Harness initialData={buildCompleteData()} />);

      const progress = screen.getByTestId("school-staff-interaction-progress");
      expect(progress).toHaveTextContent("Answered: 2/2");
    });

    it("shows existing remark without clicking Add remark", () => {
      render(
        <Harness
          initialData={{
            questions: {
              gc_staff_concern: { answer: true, remark: "Existing note" },
            },
          }}
        />
      );

      const textarea = screen.getByTestId("school-staff-interaction-gc_staff_concern-remark") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Existing note");
    });
  });

  describe("disabled / read-only mode", () => {
    it("radio buttons are disabled", () => {
      render(<Harness disabled initialData={buildCompleteData()} />);

      for (const key of SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys) {
        expect(screen.getByTestId(`school-staff-interaction-${key}-yes`)).toBeDisabled();
        expect(screen.getByTestId(`school-staff-interaction-${key}-no`)).toBeDisabled();
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
            questions: {
              gc_staff_concern: { answer: true, remark: "Some note" },
            },
          }}
        />
      );

      const textarea = screen.getByTestId("school-staff-interaction-gc_staff_concern-remark") as HTMLTextAreaElement;
      expect(textarea).toBeDisabled();
    });
  });
});
