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
  default: () => <div data-testid="student-table" />,
}));

vi.mock("./AddStudentModal", () => ({
  __esModule: true,
  default: ({ open, onCreated }: { open: boolean; onCreated: () => void }) =>
    open ? <button onClick={onCreated}>mock add modal</button> : null,
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
  });

  it("hides Add Student when the shared gate denies or a non-NVS program is selected", () => {
    const { rerender } = render(
      <EnrollmentTabContent {...baseProps} canAddStudent={false} />,
    );
    expect(screen.queryByRole("button", { name: "Add Student" })).not.toBeInTheDocument();

    rerender(
      <EnrollmentTabContent
        {...baseProps}
        programs={[program(PROGRAM_IDS.COE, "JNV CoE")]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add Student" })).not.toBeInTheDocument();
  });
});
