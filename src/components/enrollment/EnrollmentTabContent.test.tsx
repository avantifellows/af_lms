import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PROGRAM_IDS } from "@/lib/constants";
import EnrollmentTabContent from "./EnrollmentTabContent";
import type { ProgramStats } from "@/lib/enrollment-stats";

const { mockRefresh, createdResult } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  createdResult: { studentId: "202812345678" as string | null, penNumber: "12345678901" as string | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("@/components/StudentTable", () => ({
  __esModule: true,
  default: (props: { canEdit?: boolean; canEditStudent?: boolean; selectedGrade?: string; selectedStream?: string }) => (
    <div
      data-testid="student-table"
      data-can-edit={String(props.canEdit)}
      data-can-edit-student={String(props.canEditStudent)}
      data-grade={props.selectedGrade}
      data-stream={props.selectedStream}
    />
  ),
}));

vi.mock("./AddStudentModal", () => ({
  __esModule: true,
  default: ({ open, onCreated }: { open: boolean; onCreated: (studentId: string | null, penNumber: string | null) => void }) =>
    open ? <button onClick={() => onCreated(createdResult.studentId, createdResult.penNumber)}>mock add modal</button> : null,
}));

vi.mock("./BulkStudentUploadModal", () => ({
  __esModule: true,
  default: ({ open, onUploaded }: { open: boolean; onUploaded: () => void }) =>
    open ? <button onClick={onUploaded}>mock bulk modal</button> : null,
}));

function program(id: number, label: string): ProgramStats {
  return {
    id,
    label,
    total: 0,
    byGrade: [],
    byGender: [],
    byCategory: [],
  };
}

const baseProps = {
  programs: [program(PROGRAM_IDS.NVS, "JNV NVS")],
  activeStudents: [],
  dropoutStudents: [],
  canEdit: true,
  canEditStudent: true,
  canAddStudent: true,
  userProgramIds: [PROGRAM_IDS.NVS],
  isPasscodeUser: false,
  isAdmin: false,
  grades: [],
  batches: [],
  nvsStreams: [],
  schoolUdise: "12345678901",
  schoolCode: "JNV001",
};

describe("EnrollmentTabContent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createdResult.studentId = "202812345678";
    createdResult.penNumber = "12345678901";
  });

  it("shows the Student ID-only login instructions", async () => {
    createdResult.penNumber = null;
    const user = userEvent.setup();
    render(<EnrollmentTabContent {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Add Student" }));
    await user.click(screen.getByRole("button", { name: "mock add modal" }));

    expect(screen.getByText("Student successfully added with 202812345678")).toBeInTheDocument();
    expect(screen.getByText("Student can login using their Student ID + DoB")).toBeInTheDocument();
  });

  it("shows the PEN-only login instructions without a generated Student ID", async () => {
    createdResult.studentId = null;
    const user = userEvent.setup();
    render(<EnrollmentTabContent {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Add Student" }));
    await user.click(screen.getByRole("button", { name: "mock add modal" }));

    expect(screen.getByText("Student successfully added")).toBeInTheDocument();
    expect(screen.getByText("Student can login using their PEN + DoB")).toBeInTheDocument();
  });

  it("shows the Add Student entry only for the selected NVS program and refreshes after create", async () => {
    const user = userEvent.setup();
    render(<EnrollmentTabContent {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Add Student" }));
    await user.click(screen.getByRole("button", { name: "mock add modal" }));

    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.getByText("Student successfully added with 202812345678")).toBeInTheDocument();
    expect(screen.getByText("Student can login using either Student ID or PEN + DoB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add another student" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "mock add modal" })).not.toBeInTheDocument();
  });

  it("shows the Bulk Upload entry only for the selected NVS program and refreshes after upload", async () => {
    const user = userEvent.setup();
    render(<EnrollmentTabContent {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await user.click(screen.getByRole("button", { name: "mock bulk modal" }));

    expect(mockRefresh).toHaveBeenCalled();
  });

  it("hides Add Student when the shared gate denies or a non-NVS program is selected", () => {
    const { rerender } = render(
      <EnrollmentTabContent {...baseProps} canAddStudent={false} />,
    );
    expect(screen.queryByRole("button", { name: "Add Student" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulk Upload" })).not.toBeInTheDocument();

    rerender(
      <EnrollmentTabContent
        {...baseProps}
        programs={[program(PROGRAM_IDS.COE, "JNV CoE")]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add Student" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulk Upload" })).not.toBeInTheDocument();
  });

  it("passes the existing-student edit gate separately from the dropout flag", () => {
    render(
      <EnrollmentTabContent
        {...baseProps}
        canEdit={true}
        canEditStudent={false}
      />,
    );

    const table = screen.getByTestId("student-table");
    expect(table).toHaveAttribute("data-can-edit", "true");
    expect(table).toHaveAttribute("data-can-edit-student", "false");
  });

  it("applies grade and stream filters together", async () => {
    const user = userEvent.setup();
    render(
      <EnrollmentTabContent
        {...baseProps}
        activeStudents={[
          { grade: 11, stream: "engineering", student_program_ids: [64] },
          { grade: 12, stream: "medical", student_program_ids: [64] },
        ] as never}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Filter by Grade:"), "11");
    await user.selectOptions(screen.getByLabelText("Filter by Stream:"), "engineering");

    expect(screen.getByTestId("student-table")).toHaveAttribute("data-grade", "11");
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-stream", "engineering");
    expect(screen.getByText("Showing 1 of 2 students")).toBeInTheDocument();
  });
});
