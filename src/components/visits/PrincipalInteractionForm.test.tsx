import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import PrincipalInteractionForm from "./PrincipalInteractionForm";
import { PRINCIPAL_INTERACTION_CONFIG } from "@/lib/principal-interaction";

interface HarnessProps {
  disabled?: boolean;
  initialData?: Record<string, unknown>;
}

function Harness({ disabled = false, initialData = {} }: HarnessProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);

  return (
    <PrincipalInteractionForm
      data={data}
      setData={setData}
      disabled={disabled}
    />
  );
}

function buildCompleteData(answer: boolean = true): Record<string, unknown> {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer };
  }
  return { questions };
}

describe("PrincipalInteractionForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders all 5 sections", () => {
      render(<Harness />);

      for (const section of PRINCIPAL_INTERACTION_CONFIG.sections) {
        expect(screen.getByText(section.title)).toBeInTheDocument();
      }
    });

    it("renders all 7 questions with Yes/No radios", () => {
      render(<Harness />);

      for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
        expect(screen.getByTestId(`principal-interaction-${key}-yes`)).toBeInTheDocument();
        expect(screen.getByTestId(`principal-interaction-${key}-no`)).toBeInTheDocument();
      }
    });

    it("renders question labels", () => {
      render(<Harness />);

      for (const section of PRINCIPAL_INTERACTION_CONFIG.sections) {
        for (const question of section.questions) {
          // Label appears in both <legend> (sr-only) and <p>, so use getAllByText
          expect(screen.getAllByText(question.label).length).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it("shows progress as '0/7' when no questions answered", () => {
      render(<Harness />);

      const progress = screen.getByTestId("principal-interaction-progress");
      expect(progress).toHaveTextContent("Answered: 0/7");
    });

    it("sets data-testid on root element", () => {
      render(<Harness />);

      expect(screen.getByTestId("action-renderer-principal_interaction")).toBeInTheDocument();
    });

    it("does not render any teacher-related UI", () => {
      render(<Harness />);

      expect(screen.queryByText(/teachers/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/select all/i)).not.toBeInTheDocument();
      expect(screen.queryByText("Loading teachers...")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("clicking Yes radio checks it and updates progress", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const yesRadio = screen.getByTestId("principal-interaction-oh_program_feedback-yes");
      await user.click(yesRadio);

      expect(yesRadio).toBeChecked();
      expect(screen.getByTestId("principal-interaction-oh_program_feedback-no")).not.toBeChecked();

      const progress = screen.getByTestId("principal-interaction-progress");
      expect(progress).toHaveTextContent("Answered: 1/7");
    });

    it("clicking No radio checks it", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const noRadio = screen.getByTestId("principal-interaction-oh_program_feedback-no");
      await user.click(noRadio);

      expect(noRadio).toBeChecked();
      expect(screen.getByTestId("principal-interaction-oh_program_feedback-yes")).not.toBeChecked();
    });

    it("switching from Yes to No updates the radio state", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(screen.getByTestId("principal-interaction-oh_program_feedback-yes"));
      expect(screen.getByTestId("principal-interaction-oh_program_feedback-yes")).toBeChecked();

      await user.click(screen.getByTestId("principal-interaction-oh_program_feedback-no"));
      expect(screen.getByTestId("principal-interaction-oh_program_feedback-no")).toBeChecked();
      expect(screen.getByTestId("principal-interaction-oh_program_feedback-yes")).not.toBeChecked();
    });

    it("Add remark toggle reveals remark textarea", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      expect(screen.queryByTestId("principal-interaction-oh_program_feedback-remark")).not.toBeInTheDocument();

      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      expect(screen.getByTestId("principal-interaction-oh_program_feedback-remark")).toBeInTheDocument();
    });

    it("typing in remark textarea updates the value", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      const textarea = screen.getByTestId("principal-interaction-oh_program_feedback-remark") as HTMLTextAreaElement;
      await user.type(textarea, "Test remark");

      expect(textarea.value).toBe("Test remark");
    });

    it("answering all 7 questions shows progress as 7/7", async () => {
      render(<Harness initialData={buildCompleteData()} />);

      const progress = screen.getByTestId("principal-interaction-progress");
      expect(progress).toHaveTextContent("Answered: 7/7");
    });

    it("shows existing remark without clicking Add remark", () => {
      render(
        <Harness
          initialData={{
            questions: {
              oh_program_feedback: { answer: true, remark: "Existing note" },
            },
          }}
        />
      );

      const textarea = screen.getByTestId("principal-interaction-oh_program_feedback-remark") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Existing note");
    });
  });

  describe("disabled / read-only mode", () => {
    it("radio buttons are disabled", () => {
      render(<Harness disabled initialData={buildCompleteData()} />);

      for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
        expect(screen.getByTestId(`principal-interaction-${key}-yes`)).toBeDisabled();
        expect(screen.getByTestId(`principal-interaction-${key}-no`)).toBeDisabled();
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
              oh_program_feedback: { answer: true, remark: "Some note" },
            },
          }}
        />
      );

      const textarea = screen.getByTestId("principal-interaction-oh_program_feedback-remark") as HTMLTextAreaElement;
      expect(textarea).toBeDisabled();
    });
  });
});
