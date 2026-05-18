import { act, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import IndividualStudentDiscussionForm from "./IndividualStudentDiscussionForm";
import {
  INDIVIDUAL_STUDENT_DISCUSSION_CONFIG,
  type IndividualStudentDiscussionEntry,
} from "@/lib/individual-student-discussion";

const MOCK_STUDENTS = [
  { id: 1, full_name: "Alice Student", student_id: "STU001", grade: 11 },
  { id: 2, full_name: "Bob Learner", student_id: "STU002", grade: 11 },
  { id: 3, full_name: "Carol Pupil", student_id: "STU003", grade: 11 },
  { id: 4, full_name: "Dev Student", student_id: "STU004", grade: 11 },
  { id: 5, full_name: "Esha Student", student_id: "STU005", grade: 11 },
  { id: 6, full_name: "Farah Student", student_id: "STU006", grade: 11 },
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
  onSetData?: (next: Record<string, unknown>) => void;
}

function Harness({
  disabled = false,
  initialData = {},
  schoolCode = "12345",
  onSetData,
}: HarnessProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);

  return (
    <IndividualStudentDiscussionForm
      data={data}
      setData={(updater) => {
        setData((current) => {
          const next =
            typeof updater === "function"
              ? (updater as (value: Record<string, unknown>) => Record<string, unknown>)(current)
              : updater;
          onSetData?.(next);
          return next;
        });
      }}
      disabled={disabled}
      schoolCode={schoolCode}
    />
  );
}

function buildQuestions(answerAll = false) {
  const questions: Record<string, { answer: boolean | null; remark?: string }> = {};
  if (answerAll) {
    for (const key of INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: true };
    }
  }
  return questions;
}

function buildEntry(
  id: string,
  students: { id: number; name: string }[],
  answerAll = false
): IndividualStudentDiscussionEntry {
  return {
    id,
    grade: 11,
    students,
    questions: buildQuestions(answerAll),
  };
}

async function selectGrade(user: ReturnType<typeof userEvent.setup>, grade = "11") {
  await user.selectOptions(screen.getByTestId("student-grade-filter"), grade);
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("add-student-select"));
}

async function waitForPicker() {
  await waitFor(() => {
    expect(screen.getByTestId("add-student-select")).toBeInTheDocument();
  });
}

function deferredFetch(students: typeof MOCK_STUDENTS) {
  let resolve!: (value: { ok: true; json: () => Promise<{ students: typeof MOCK_STUDENTS }> }) => void;
  const promise = new Promise<{ ok: true; json: () => Promise<{ students: typeof MOCK_STUDENTS }> }>(
    (res) => {
      resolve = res;
    }
  );
  return {
    promise,
    resolve: () =>
      resolve({
        ok: true,
        json: () => Promise.resolve({ students }),
      }),
  };
}

describe("IndividualStudentDiscussionForm", () => {
  beforeEach(() => {
    mockFetchStudents();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "entry-1") });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the picker disabled until grade is selected and fetches students for the grade", async () => {
    const user = userEvent.setup();
    render(<Harness schoolCode="SCH999" />);

    expect(screen.getByTestId("add-student-select")).toBeDisabled();
    expect(screen.getByTestId("add-individual-student-entry")).toBeDisabled();
    expect(mockFetch).not.toHaveBeenCalled();

    await selectGrade(user, "11");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/pm/students?school_code=SCH999&grade=11");
    });
    expect(screen.getByTestId("add-student-select")).not.toBeDisabled();
  });

  it("shows loading and error states while fetching students", async () => {
    mockFetch = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", mockFetch);
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await selectGrade(user, "11");
    expect(screen.getByTestId("individual-student-loading")).toHaveTextContent("Loading students");

    unmount();
    mockFetchStudentsError();
    render(<Harness />);
    await selectGrade(user, "11");

    await waitFor(() => {
      expect(screen.getByTestId("individual-student-error")).toHaveTextContent(
        "Failed to load students"
      );
    });
  });

  it("filters the checkbox picker by name and student id with no-match messaging", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await selectGrade(user);
    await waitForPicker();
    await openPicker(user);

    expect(within(screen.getByTestId("student-search-listbox")).getByText("Alice Student")).toBeInTheDocument();
    await user.type(screen.getByTestId("add-student-select"), "bob learn");
    expect(within(screen.getByTestId("student-search-listbox")).getByText("Bob Learner")).toBeInTheDocument();
    expect(within(screen.getByTestId("student-search-listbox")).queryByText("Alice Student")).not.toBeInTheDocument();

    await user.clear(screen.getByTestId("add-student-select"));
    await user.type(screen.getByTestId("add-student-select"), "STU003");
    expect(within(screen.getByTestId("student-search-listbox")).getByText("Carol Pupil")).toBeInTheDocument();

    await user.clear(screen.getByTestId("add-student-select"));
    await user.type(screen.getByTestId("add-student-select"), "zzzzz");
    expect(within(screen.getByTestId("student-search-listbox")).getByText("No matches")).toBeInTheDocument();
  });

  it("shows no-students messaging when the selected grade has no available students", async () => {
    mockFetchStudents([]);
    const user = userEvent.setup();
    render(<Harness />);

    await selectGrade(user);
    await waitForPicker();
    await openPicker(user);

    expect(within(screen.getByTestId("student-search-listbox")).getByText("No students in this grade")).toBeInTheDocument();
  });

  it("creates a grouped entry from checked students with one entry-level question set", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await selectGrade(user);
    await waitForPicker();
    await openPicker(user);

    await user.click(screen.getByTestId("student-checkbox-1"));
    await user.click(screen.getByTestId("student-checkbox-2"));

    expect(screen.getByTestId("pending-student-chip-1")).toHaveTextContent("Alice Student");
    expect(screen.getByTestId("pending-student-chip-2")).toHaveTextContent("Bob Learner");

    await user.click(screen.getByTestId("add-individual-student-entry"));

    expect(screen.getByTestId("entry-section-entry-1")).toBeInTheDocument();
    expect(screen.getByTestId("entry-header-entry-1")).toHaveTextContent("Alice Student");
    expect(screen.getByTestId("entry-header-entry-1")).toHaveTextContent("Bob Learner");
    expect(screen.getByTestId("entry-grade-badge-entry-1")).toHaveTextContent("Grade 11");
    expect(screen.getByTestId("entry-progress-entry-1")).toHaveTextContent("0/2");
    expect(screen.getByTestId("individual-student-progress")).toHaveTextContent(
      "Entries: 1 | Students: 2"
    );

    const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];
    expect(screen.getByTestId(`entry-entry-1-${firstKey}-yes`)).toBeInTheDocument();
    expect(screen.queryByTestId(`student-1-${firstKey}-yes`)).not.toBeInTheDocument();
  });

  it("does not emit pending chip selections to setData until Add Entry is clicked", async () => {
    const user = userEvent.setup();
    const onSetData = vi.fn();
    render(<Harness onSetData={onSetData} />);

    await selectGrade(user);
    await waitForPicker();
    await openPicker(user);
    await user.click(screen.getByTestId("student-checkbox-1"));

    expect(screen.getByTestId("pending-student-chip-1")).toBeInTheDocument();
    expect(onSetData).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("add-individual-student-entry"));
    expect(onSetData).toHaveBeenCalledWith({
      entries: [
        {
          id: "entry-1",
          grade: 11,
          students: [{ id: 1, name: "Alice Student" }],
          questions: {},
        },
      ],
    });
  });

  it("keeps the grade selected after adding and clears pending chips when the grade changes", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await selectGrade(user, "11");
    await waitForPicker();
    await openPicker(user);
    await user.click(screen.getByTestId("student-checkbox-1"));
    await user.click(screen.getByTestId("add-individual-student-entry"));

    expect(screen.getByTestId("student-grade-filter")).toHaveValue("11");
    expect(screen.queryByTestId("pending-student-chip-1")).not.toBeInTheDocument();

    await openPicker(user);
    await user.click(screen.getByTestId("student-checkbox-2"));
    expect(screen.getByTestId("pending-student-chip-2")).toBeInTheDocument();

    await selectGrade(user, "12");
    expect(screen.queryByTestId("pending-student-chip-2")).not.toBeInTheDocument();
  });

  it("excludes pending and committed students from the picker, and chip removal releases pending students", async () => {
    const user = userEvent.setup();
    render(<Harness initialData={{ entries: [buildEntry("existing", [{ id: 1, name: "Alice Student" }])] }} />);

    await selectGrade(user);
    await waitForPicker();
    await openPicker(user);

    expect(within(screen.getByTestId("student-search-listbox")).queryByText("Alice Student")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("student-checkbox-2"));
    expect(within(screen.getByTestId("student-search-listbox")).queryByText("Bob Learner")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Bob Learner" }));
    await openPicker(user);
    expect(within(screen.getByTestId("student-search-listbox")).getByText("Bob Learner")).toBeInTheDocument();
  });

  it("deleting an entry releases its students back to the picker", async () => {
    const user = userEvent.setup();
    render(<Harness initialData={{ entries: [buildEntry("entry-1", [{ id: 1, name: "Alice Student" }])] }} />);

    await user.click(screen.getByTestId("entry-header-entry-1"));
    await user.click(screen.getByTestId("remove-entry-entry-1"));
    expect(screen.queryByTestId("entry-section-entry-1")).not.toBeInTheDocument();

    await selectGrade(user);
    await waitForPicker();
    await openPicker(user);
    expect(within(screen.getByTestId("student-search-listbox")).getByText("Alice Student")).toBeInTheDocument();
  });

  it("updates entry-level answers, remarks, and progress", async () => {
    const user = userEvent.setup();
    render(<Harness initialData={{ entries: [buildEntry("entry-1", [{ id: 1, name: "Alice Student" }])] }} />);

    await user.click(screen.getByTestId("entry-header-entry-1"));
    const firstKey = INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys[0];

    await user.click(screen.getByTestId(`entry-entry-1-${firstKey}-yes`));
    expect(screen.getByTestId("entry-progress-entry-1")).toHaveTextContent("1/2");

    await user.click(screen.getAllByText("Add remark")[0]);
    const textarea = screen.getByTestId(`entry-entry-1-${firstKey}-remark`);
    await user.type(textarea, "Needs support");
    expect(textarea).toHaveValue("Needs support");
  });

  it("renders stacked names with overflow count in the accordion header", () => {
    render(
      <Harness
        initialData={{
          entries: [
            buildEntry("entry-1", [
              { id: 1, name: "Alice" },
              { id: 2, name: "Bob" },
              { id: 3, name: "Carol" },
              { id: 4, name: "Dev" },
              { id: 5, name: "Esha" },
              { id: 6, name: "Farah" },
            ]),
          ],
        }}
      />
    );

    const names = screen.getByTestId("entry-student-names-entry-1");
    expect(names).toHaveTextContent("Alice");
    expect(names).toHaveTextContent("Esha");
    expect(names).toHaveTextContent("+1 more");
    expect(names).not.toHaveTextContent("Farah");
  });

  it("renders read-only grouped entries with one Q/A set and no edit controls", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        disabled
        initialData={{
          entries: [buildEntry("entry-1", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }], true)],
        }}
      />
    );

    expect(screen.queryByTestId("student-grade-filter")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-student-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-entry-entry-1")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("entry-header-entry-1"));

    expect(screen.getByTestId("entry-header-entry-1")).toHaveTextContent("Alice");
    expect(screen.getByTestId("entry-header-entry-1")).toHaveTextContent("Bob");
    expect(screen.queryByTestId("entry-entry-1-oh_teaching_concern-yes")).not.toBeInTheDocument();
    expect(screen.getAllByText("Yes")).toHaveLength(2);
  });

  it("ignores stale student fetch responses when grade changes quickly", async () => {
    const first = deferredFetch([{ id: 10, full_name: "Old Grade Student", student_id: "OLD", grade: 11 }]);
    const second = deferredFetch([{ id: 20, full_name: "New Grade Student", student_id: "NEW", grade: 12 }]);
    mockFetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", mockFetch);
    const user = userEvent.setup();
    render(<Harness />);

    await selectGrade(user, "11");
    await selectGrade(user, "12");

    await act(async () => {
      second.resolve();
      await second.promise;
    });
    await waitForPicker();
    await openPicker(user);
    expect(within(screen.getByTestId("student-search-listbox")).getByText("New Grade Student")).toBeInTheDocument();

    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(within(screen.getByTestId("student-search-listbox")).queryByText("Old Grade Student")).not.toBeInTheDocument();
  });

  it("shows no entries or progress for empty canonical data", () => {
    render(<Harness initialData={{ entries: [] }} />);

    expect(screen.queryByTestId("individual-student-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^entry-section-/)).not.toBeInTheDocument();
  });
});
