import { StrictMode, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ClassroomObservationForm from "./ClassroomObservationForm";
import { CURRENT_RUBRIC_VERSION } from "@/lib/classroom-observation-rubric";

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

function Harness({ disabled = false, initialData = {}, schoolCode = "SCH001" }: HarnessProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);

  return (
    <ClassroomObservationForm
      data={data}
      setData={setData}
      disabled={disabled}
      schoolCode={schoolCode}
    />
  );
}

/** Initial data with teacher + grade already set so rubric is visible */
function withTeacherAndGrade(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rubric_version: CURRENT_RUBRIC_VERSION,
    teacher_id: 1,
    teacher_name: "Alice Teacher",
    grade: "10",
    ...extra,
  };
}

describe("ClassroomObservationForm", () => {
  beforeEach(() => {
    mockFetchTeachers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stamps missing rubric_version via idempotent updater in strict mode", async () => {
    const setData = vi.fn();

    render(
      <StrictMode>
        <ClassroomObservationForm data={{}} setData={setData} disabled={false} schoolCode="SCH001" />
      </StrictMode>
    );

    await waitFor(() => {
      expect(setData).toHaveBeenCalled();
    });

    const firstUpdater = setData.mock.calls[0]?.[0] as
      | ((value: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(typeof firstUpdater).toBe("function");

    const empty = {};
    const once = firstUpdater?.(empty) ?? {};
    const twice = firstUpdater?.(once) ?? {};
    const alreadyVersioned = { rubric_version: CURRENT_RUBRIC_VERSION };

    expect(once).toEqual({ rubric_version: CURRENT_RUBRIC_VERSION });
    expect(twice).toEqual(once);
    expect(firstUpdater?.(alreadyVersioned)).toBe(alreadyVersioned);
  });

  describe("teacher dropdown", () => {
    it("shows loading state while fetching teachers", () => {
      // Use a never-resolving promise to keep loading state
      vi.stubGlobal(
        "fetch",
        vi.fn().mockReturnValue(new Promise(() => {}))
      );

      render(<Harness />);

      expect(screen.getByTestId("teacher-loading")).toHaveTextContent("Loading teachers...");
    });

    it("shows teacher dropdown after loading", async () => {
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-select")).toBeInTheDocument();
      });

      const select = screen.getByTestId("teacher-select") as HTMLSelectElement;
      // 3 teachers + placeholder option
      expect(select.options).toHaveLength(4);
      expect(select.options[1].textContent).toBe("Alice Teacher");
      expect(select.options[2].textContent).toBe("Bob Instructor");
      // Teacher with null full_name falls back to email
      expect(select.options[3].textContent).toBe("noname@school.com");
    });

    it("shows error state when fetch fails", async () => {
      mockFetchTeachersError();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-error")).toHaveTextContent("Failed to load teachers");
      });
    });

    it("fetches teachers with correct school_code", async () => {
      render(<Harness schoolCode="MY_SCHOOL" />);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-select")).toBeInTheDocument();
      });

      expect(fetch).toHaveBeenCalledWith("/api/pm/teachers?school_code=MY_SCHOOL");
    });

    it("pre-selects existing teacher_id from data", async () => {
      render(
        <Harness
          initialData={{
            teacher_id: 2,
            teacher_name: "Bob Instructor",
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-select")).toBeInTheDocument();
      });

      const select = screen.getByTestId("teacher-select") as HTMLSelectElement;
      expect(select.value).toBe("2");
    });

    it("shows teacher name as non-editable when teacher_id is not in list (removed teacher)", async () => {
      render(
        <Harness
          initialData={{
            teacher_id: 999,
            teacher_name: "Removed Teacher",
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("teacher-removed-display")).toBeInTheDocument();
      });

      expect(screen.getByTestId("teacher-removed-display")).toHaveTextContent(
        "Removed Teacher (no longer at this school)"
      );
    });

    it("shows empty state when no teachers found", async () => {
      mockFetchTeachers([]);
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-select")).toBeInTheDocument();
      });

      const select = screen.getByTestId("teacher-select") as HTMLSelectElement;
      expect(select.options).toHaveLength(1);
      expect(select.options[0].textContent).toBe("No teachers found");
    });

    it("shows teacher name as text when disabled", () => {
      render(
        <Harness
          disabled
          initialData={{
            teacher_id: 1,
            teacher_name: "Alice Teacher",
            grade: "10",
            rubric_version: CURRENT_RUBRIC_VERSION,
          }}
        />
      );

      expect(screen.getByTestId("teacher-display")).toHaveTextContent("Alice Teacher");
      expect(screen.queryByTestId("teacher-select")).not.toBeInTheDocument();
    });
  });

  describe("grade dropdown", () => {
    it("is hidden when no teacher is selected", async () => {
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-select")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("grade-selection")).not.toBeInTheDocument();
      expect(screen.getByTestId("select-teacher-prompt")).toHaveTextContent(
        "Select a teacher to begin the observation."
      );
    });

    it("appears after teacher is selected", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-select")).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId("teacher-select"), "1");

      expect(screen.getByTestId("grade-selection")).toBeInTheDocument();
      expect(screen.getByTestId("grade-select")).toBeInTheDocument();
      expect(screen.getByTestId("select-grade-prompt")).toHaveTextContent(
        "Select a grade to continue."
      );
    });

    it("pre-selects existing grade from data", async () => {
      render(
        <Harness
          initialData={{
            teacher_id: 1,
            teacher_name: "Alice Teacher",
            grade: "11",
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("grade-select")).toBeInTheDocument();
      });

      const select = screen.getByTestId("grade-select") as HTMLSelectElement;
      expect(select.value).toBe("11");
    });

    it("has options for Grade 10, 11, 12", async () => {
      render(
        <Harness
          initialData={{ teacher_id: 1, teacher_name: "Alice Teacher" }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("grade-select")).toBeInTheDocument();
      });

      const select = screen.getByTestId("grade-select") as HTMLSelectElement;
      // placeholder + 3 grades
      expect(select.options).toHaveLength(4);
      expect(select.options[1].textContent).toBe("Grade 10");
      expect(select.options[2].textContent).toBe("Grade 11");
      expect(select.options[3].textContent).toBe("Grade 12");
    });

    it("shows grade as text when disabled", () => {
      render(
        <Harness
          disabled
          initialData={{
            teacher_id: 1,
            teacher_name: "Alice Teacher",
            grade: "12",
            rubric_version: CURRENT_RUBRIC_VERSION,
          }}
        />
      );

      expect(screen.getByTestId("grade-display")).toHaveTextContent("Grade 12");
      expect(screen.queryByTestId("grade-select")).not.toBeInTheDocument();
    });
  });

  describe("rubric gating", () => {
    it("hides rubric when only teacher is selected (no grade)", async () => {
      render(
        <Harness
          initialData={{
            rubric_version: CURRENT_RUBRIC_VERSION,
            teacher_id: 1,
            teacher_name: "Alice Teacher",
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("grade-select")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("rubric-score-summary")).not.toBeInTheDocument();
      expect(screen.queryAllByTestId(/rubric-param-/)).toHaveLength(0);
    });

    it("shows rubric when both teacher and grade are selected", async () => {
      render(<Harness initialData={withTeacherAndGrade()} />);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-select")).toBeInTheDocument();
      });

      expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 0/45");
      expect(screen.getAllByTestId(/rubric-param-/)).toHaveLength(19);
    });

    it("shows rubric after selecting teacher and grade interactively", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-select")).toBeInTheDocument();
      });

      // No rubric yet
      expect(screen.queryByTestId("rubric-score-summary")).not.toBeInTheDocument();

      // Select teacher
      await user.selectOptions(screen.getByTestId("teacher-select"), "1");
      expect(screen.queryByTestId("rubric-score-summary")).not.toBeInTheDocument();

      // Select grade
      await user.selectOptions(screen.getByTestId("grade-select"), "10");
      expect(screen.getByTestId("rubric-score-summary")).toBeInTheDocument();
      expect(screen.getAllByTestId(/rubric-param-/)).toHaveLength(19);
    });
  });

  describe("rubric behavior (with teacher + grade set)", () => {
    it("renders all 19 rubric cards with score summary and session summaries", async () => {
      render(<Harness initialData={withTeacherAndGrade()} />);

      await waitFor(() => {
        expect(screen.getByTestId("rubric-score-summary")).toBeInTheDocument();
      });

      expect(screen.getAllByTestId(/rubric-param-/)).toHaveLength(19);
      expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 0/45");
      expect(screen.getByTestId("rubric-answered-summary")).toHaveTextContent("Answered: 0/19");

      expect(screen.getByLabelText("Observer Summary (Strengths)")).toBeInTheDocument();
      expect(screen.getByLabelText("Observer Summary (Points of Improvement)")).toBeInTheDocument();
    });

    it("respects disabled prop for rubric controls and summaries", () => {
      render(
        <Harness
          disabled
          initialData={withTeacherAndGrade({
            observer_summary_strengths: "existing",
          })}
        />
      );

      const firstCard = screen.getByTestId("rubric-param-teacher_on_time");
      expect(within(firstCard).getByRole("radio", { name: /yes/i })).toBeDisabled();
      expect(within(firstCard).getByRole("button", { name: "Add remarks" })).toBeDisabled();
      expect(screen.getByLabelText("Observer Summary (Strengths)")).toBeDisabled();
    });

    it("updates live score/answered counts from valid selected scores only", async () => {
      const user = userEvent.setup();

      render(
        <Harness
          initialData={withTeacherAndGrade({
            params: {
              time_management: { score: 0 },
            },
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("rubric-score-summary")).toBeInTheDocument();
      });

      expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 0/45");
      expect(screen.getByTestId("rubric-answered-summary")).toHaveTextContent("Answered: 0/19");

      const teacherOnTimeCard = screen.getByTestId("rubric-param-teacher_on_time");
      await user.click(within(teacherOnTimeCard).getByRole("radio", { name: /yes/i }));

      const recallCard = screen.getByTestId("rubric-param-recall_test");
      await user.click(within(recallCard).getByRole("radio", { name: /student interaction within time/i }));

      expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 3/45");
      expect(screen.getByTestId("rubric-answered-summary")).toHaveTextContent("Answered: 2/19");

      await user.type(screen.getByLabelText("Observer Summary (Strengths)"), "Good pace");
      await user.type(screen.getByLabelText("Observer Summary (Points of Improvement)"), "Board clarity");

      expect(screen.getByTestId("rubric-score-summary")).toHaveTextContent("Score: 3/45");
      expect(screen.getByTestId("rubric-answered-summary")).toHaveTextContent("Answered: 2/19");
    });

    it("keeps remarks visible after reveal even when cleared", async () => {
      const user = userEvent.setup();

      render(<Harness initialData={withTeacherAndGrade()} />);

      await waitFor(() => {
        expect(screen.getByTestId("rubric-score-summary")).toBeInTheDocument();
      });

      const firstCard = screen.getByTestId("rubric-param-teacher_on_time");

      expect(within(firstCard).queryByLabelText("Remarks")).not.toBeInTheDocument();

      await user.click(within(firstCard).getByRole("button", { name: "Add remarks" }));

      const remarks = within(firstCard).getByLabelText("Remarks");
      await user.type(remarks, "Observed clear instructions");
      await user.clear(remarks);

      expect(within(firstCard).getByLabelText("Remarks")).toBeInTheDocument();
      expect(within(firstCard).queryByRole("button", { name: "Add remarks" })).not.toBeInTheDocument();
    });

    it("shows remarks textarea by default when remarks already exist", async () => {
      render(
        <Harness
          initialData={withTeacherAndGrade({
            params: {
              teacher_on_time: { score: 1, remarks: "Already filled" },
            },
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("rubric-score-summary")).toBeInTheDocument();
      });

      const firstCard = screen.getByTestId("rubric-param-teacher_on_time");
      expect(within(firstCard).getByLabelText("Remarks")).toBeInTheDocument();
      expect(within(firstCard).queryByRole("button", { name: "Add remarks" })).not.toBeInTheDocument();
    });
  });
});
