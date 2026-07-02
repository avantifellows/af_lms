import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PROGRAM_IDS } from "@/lib/constants";
import EnrollmentTabContent from "./EnrollmentTabContent";
import type { ProgramStats } from "@/lib/enrollment-stats";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("@/components/StudentTable", () => ({
  __esModule: true,
  default: (props: { canEdit?: boolean; canEditStudent?: boolean }) => (
    <div
      data-testid="student-table"
      data-can-edit={String(props.canEdit)}
      data-can-edit-student={String(props.canEditStudent)}
    />
  ),
}));

vi.mock("./AddStudentModal", () => ({
  __esModule: true,
  default: ({ open, onCreated }: { open: boolean; onCreated: () => void }) =>
    open ? <button onClick={onCreated}>mock add modal</button> : null,
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
  });

  it("shows the Add Student entry only for the selected NVS program and refreshes after create", async () => {
    const user = userEvent.setup();
    render(<EnrollmentTabContent {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Add Student" }));
    await user.click(screen.getByRole("button", { name: "mock add modal" }));

    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Student added.");
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
});
