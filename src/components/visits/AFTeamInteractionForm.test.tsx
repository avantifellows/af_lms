import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AFTeamInteractionForm from "./AFTeamInteractionForm";
import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction";

const MOCK_TEACHERS = [
  { id: 1, email: "alice@school.com", full_name: "Alice Teacher" },
  { id: 2, email: "bob@school.com", full_name: "Bob Instructor" },
  { id: 3, email: "noname@school.com", full_name: null },
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
    <AFTeamInteractionForm
      data={data}
      setData={setData}
      disabled={disabled}
      schoolCode={schoolCode}
    />
  );
}

/** Build a complete data payload with all 9 answers */
function buildCompleteData(
  teachers: Array<{ id: number; name: string }> = [{ id: 1, name: "Alice Teacher" }],
  answer: boolean = true
): Record<string, unknown> {
  const questions: Record<string, { answer: boolean; remark?: string }> = {};
  for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer };
  }
  return { teachers, questions };
}

describe("AFTeamInteractionForm", () => {
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

    it("shows loading state while fetching", () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockReturnValue(new Promise(() => {}))
      );

      render(<Harness />);

      expect(screen.getByTestId("af-team-teacher-loading")).toHaveTextContent("Loading teachers...");
    });

    it("shows error state on fetch failure", async () => {
      mockFetchTeachersError();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("af-team-teacher-error")).toHaveTextContent("Failed to load teachers");
      });
    });

    it("renders teacher checkboxes after successful fetch", async () => {
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("af-team-teacher-1")).toBeInTheDocument();
      });

      expect(screen.getByTestId("af-team-teacher-1")).toBeInTheDocument();
      expect(screen.getByTestId("af-team-teacher-2")).toBeInTheDocument();
      expect(screen.getByTestId("af-team-teacher-3")).toBeInTheDocument();
    });
  });

  describe("teacher interaction", () => {
    it("toggling a teacher checkbox ON adds teacher to data", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("af-team-teacher-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("af-team-teacher-1"));

      // After clicking, teacher should be checked
      expect(screen.getByTestId("af-team-teacher-1")).toBeChecked();
    });

    it("toggling a teacher checkbox OFF removes teacher from data", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [{ id: 1, name: "Alice Teacher" }] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-teacher-1")).toBeInTheDocument();
      });

      // Should be checked initially
      expect(screen.getByTestId("af-team-teacher-1")).toBeChecked();

      await user.click(screen.getByTestId("af-team-teacher-1"));

      expect(screen.getByTestId("af-team-teacher-1")).not.toBeChecked();
    });

    it("uses fresh display name from API when toggling teacher ON", async () => {
      const user = userEvent.setup();
      // Fetch returns teacher with specific name
      mockFetchTeachers([
        { id: 1, email: "alice@school.com", full_name: "Alice Updated" },
      ]);

      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("af-team-teacher-1")).toBeInTheDocument();
      });

      // The label should show the API name
      expect(screen.getByText("Alice Updated")).toBeInTheDocument();

      await user.click(screen.getByTestId("af-team-teacher-1"));

      // After toggle, the progress bar should show Teachers: 1
      const progress = screen.getByTestId("af-team-progress");
      expect(progress).toHaveTextContent("Teachers: 1");
    });

    it("handles teacher with null full_name — checkbox label shows email", async () => {
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("af-team-teacher-3")).toBeInTheDocument();
      });

      // Teacher 3 has null full_name, should fall back to email
      expect(screen.getByText("noname@school.com")).toBeInTheDocument();
    });

    it("Select All selects all fetched teachers", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("af-team-select-all")).toBeInTheDocument();
      });

      expect(screen.getByTestId("af-team-select-all")).toHaveTextContent("Select All");

      await user.click(screen.getByTestId("af-team-select-all"));

      expect(screen.getByTestId("af-team-teacher-1")).toBeChecked();
      expect(screen.getByTestId("af-team-teacher-2")).toBeChecked();
      expect(screen.getByTestId("af-team-teacher-3")).toBeChecked();

      // Button should now say "Deselect All"
      expect(screen.getByTestId("af-team-select-all")).toHaveTextContent("Deselect All");
    });

    it("Deselect All clears all fetched teachers", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{
            teachers: [
              { id: 1, name: "Alice Teacher" },
              { id: 2, name: "Bob Instructor" },
              { id: 3, name: "noname@school.com" },
            ],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-select-all")).toHaveTextContent("Deselect All");
      });

      await user.click(screen.getByTestId("af-team-select-all"));

      expect(screen.getByTestId("af-team-teacher-1")).not.toBeChecked();
      expect(screen.getByTestId("af-team-teacher-2")).not.toBeChecked();
      expect(screen.getByTestId("af-team-teacher-3")).not.toBeChecked();

      expect(screen.getByTestId("af-team-select-all")).toHaveTextContent("Select All");
    });
  });

  describe("gating", () => {
    it("shows gating message when no teachers selected and no answers", async () => {
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("af-team-teacher-1")).toBeInTheDocument();
      });

      expect(screen.getByTestId("af-team-select-teacher-prompt")).toHaveTextContent(
        "Select at least one teacher to begin."
      );

      // Questions should not be visible
      expect(screen.queryByTestId("af-team-progress")).not.toBeInTheDocument();
    });

    it("shows questions when existing answers present (even without teachers)", async () => {
      render(
        <Harness
          initialData={{
            teachers: [],
            questions: { op_class_duration: { answer: true } },
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-teacher-1")).toBeInTheDocument();
      });

      // Gating message should NOT be shown
      expect(screen.queryByTestId("af-team-select-teacher-prompt")).not.toBeInTheDocument();

      // Progress bar and questions should be visible
      expect(screen.getByTestId("af-team-progress")).toBeInTheDocument();
    });
  });

  describe("question interaction", () => {
    it("shows all 4 sections and 9 questions after teacher selection", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("af-team-select-all")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("af-team-select-all"));

      // All 4 section headers
      for (const section of AF_TEAM_INTERACTION_CONFIG.sections) {
        expect(screen.getByText(section.title)).toBeInTheDocument();
      }

      // All 9 Yes/No radio pairs
      for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
        expect(screen.getByTestId(`af-team-${key}-yes`)).toBeInTheDocument();
        expect(screen.getByTestId(`af-team-${key}-no`)).toBeInTheDocument();
      }
    });

    it("clicking Yes radio checks it", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [{ id: 1, name: "Alice Teacher" }] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-op_class_duration-yes")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("af-team-op_class_duration-yes"));

      expect(screen.getByTestId("af-team-op_class_duration-yes")).toBeChecked();
      expect(screen.getByTestId("af-team-op_class_duration-no")).not.toBeChecked();
    });

    it("Add remark toggle reveals remark textarea", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [{ id: 1, name: "Alice Teacher" }] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-op_class_duration-yes")).toBeInTheDocument();
      });

      // No remark textarea yet
      expect(screen.queryByTestId("af-team-op_class_duration-remark")).not.toBeInTheDocument();

      // Find and click "Add remark" button (first one)
      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      expect(screen.getByTestId("af-team-op_class_duration-remark")).toBeInTheDocument();
    });

    it("typing in remark textarea updates the value", async () => {
      const user = userEvent.setup();
      render(
        <Harness
          initialData={{ teachers: [{ id: 1, name: "Alice Teacher" }] }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-op_class_duration-yes")).toBeInTheDocument();
      });

      // Reveal remark
      const addRemarkButtons = screen.getAllByText("Add remark");
      await user.click(addRemarkButtons[0]);

      const textarea = screen.getByTestId("af-team-op_class_duration-remark") as HTMLTextAreaElement;
      await user.type(textarea, "Test remark");

      expect(textarea.value).toBe("Test remark");
    });
  });

  describe("progress bar", () => {
    it("shows correct teacher count and answered count", async () => {
      const questions: Record<string, { answer: boolean | null }> = {};
      const keys = AF_TEAM_INTERACTION_CONFIG.allQuestionKeys;
      // Answer 5 out of 9
      for (let i = 0; i < 5; i++) {
        questions[keys[i]] = { answer: true };
      }

      render(
        <Harness
          initialData={{
            teachers: [
              { id: 1, name: "Alice Teacher" },
              { id: 2, name: "Bob Instructor" },
            ],
            questions,
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-progress")).toBeInTheDocument();
      });

      const progress = screen.getByTestId("af-team-progress");
      expect(progress).toHaveTextContent("Teachers: 2");
      expect(progress).toHaveTextContent("Answered: 5/9");
    });
  });

  describe("disabled / read-only mode", () => {
    it("shows stored teacher names as static text (no checkboxes)", async () => {
      render(
        <Harness
          disabled
          initialData={{
            teachers: [
              { id: 1, name: "Alice Teacher" },
              { id: 2, name: "Bob Instructor" },
            ],
            questions: {},
          }}
        />
      );

      // Wait for teacher fetch to complete (still runs even when disabled)
      await waitFor(() => {
        expect(screen.getByText("Alice Teacher")).toBeInTheDocument();
      });

      expect(screen.getByText("Bob Instructor")).toBeInTheDocument();

      // No checkboxes should be rendered
      expect(screen.queryByTestId("af-team-teacher-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("af-team-teacher-2")).not.toBeInTheDocument();
    });

    it("radio buttons are disabled", async () => {
      render(
        <Harness
          disabled
          initialData={buildCompleteData()}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-op_class_duration-yes")).toBeInTheDocument();
      });

      for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
        expect(screen.getByTestId(`af-team-${key}-yes`)).toBeDisabled();
        expect(screen.getByTestId(`af-team-${key}-no`)).toBeDisabled();
      }
    });

    it("no Select All button and no Add remark toggles in disabled mode", async () => {
      render(
        <Harness
          disabled
          initialData={buildCompleteData()}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-op_class_duration-yes")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("af-team-select-all")).not.toBeInTheDocument();
      expect(screen.queryByText("Add remark")).not.toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("shows removed teachers with '(no longer at this school)' label", async () => {
      // Teacher ID 999 is not in the fetched list
      render(
        <Harness
          initialData={{
            teachers: [
              { id: 999, name: "Removed Person" },
              { id: 1, name: "Alice Teacher" },
            ],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-removed-teacher-999")).toBeInTheDocument();
      });

      expect(screen.getByTestId("af-team-removed-teacher-999")).toHaveTextContent(
        "Removed Person (no longer at this school)"
      );
    });

    it("falls back to 'Teacher #ID' for removed teacher with empty name", async () => {
      render(
        <Harness
          initialData={{
            teachers: [
              { id: 888, name: "" },
            ],
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("af-team-removed-teacher-888")).toBeInTheDocument();
      });

      expect(screen.getByTestId("af-team-removed-teacher-888")).toHaveTextContent(
        "Teacher #888 (no longer at this school)"
      );
    });
  });
});
