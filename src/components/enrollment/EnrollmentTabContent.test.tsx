import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PROGRAM_IDS } from "@/lib/constants";
import {
  APPROVED_REGISTRATION_MODE,
  PHONE_REGISTRATION_MODE,
} from "@/lib/registration-mode";
import EnrollmentTabContent from "./EnrollmentTabContent";
import type { Student } from "@/components/StudentTable";
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
  default: (props: {
    canEdit?: boolean;
    canEditStudent?: boolean;
    selectedGrade?: string;
    selectedStream?: string;
    searchQuery?: string;
    openFlagStudentIds?: Set<string>;
    onOpenInterventionFlag?: unknown;
  }) => (
    <div
      data-testid="student-table"
      data-flags-shown={String(Boolean(props.openFlagStudentIds || props.onOpenInterventionFlag))}
      data-can-edit={String(props.canEdit)}
      data-can-edit-student={String(props.canEditStudent)}
      data-grade={props.selectedGrade}
      data-stream={props.selectedStream}
      data-search={props.searchQuery ?? ""}
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
  registrationMode: APPROVED_REGISTRATION_MODE,
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

  it("explains Phone-mode Student ID and Portal login after creation", async () => {
    createdResult.studentId = "6876543210";
    createdResult.penNumber = null;
    const user = userEvent.setup();
    render(<EnrollmentTabContent {...baseProps} registrationMode={PHONE_REGISTRATION_MODE} />);

    await user.click(screen.getByRole("button", { name: "Add Student" }));
    await user.click(screen.getByRole("button", { name: "mock add modal" }));

    expect(screen.getByText(/Parent phone number is the Student ID\./)).toBeInTheDocument();
    expect(screen.getByText(
      /Portal login remains Student ID \+ Date of Birth; enter the phone number as the Student ID\./,
    )).toBeInTheDocument();
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
    await user.selectOptions(screen.getByLabelText("Filter by Exam Preparing For:"), "engineering");

    expect(screen.getByTestId("student-table")).toHaveAttribute("data-grade", "11");
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-stream", "engineering");
    expect(screen.getByText("Showing 1 of 2 students")).toBeInTheDocument();
  });

  it("offers a No stream option and groups streams ignoring case and whitespace", async () => {
    const user = userEvent.setup();
    render(
      <EnrollmentTabContent
        {...baseProps}
        activeStudents={[
          { grade: 11, stream: "Engineering", student_program_ids: [64] },
          { grade: 11, stream: " engineering ", student_program_ids: [64] },
          { grade: 12, stream: "ENGINEERING", student_program_ids: [64] },
          { grade: 12, stream: "medical", student_program_ids: [64] },
          { grade: 11, stream: null, student_program_ids: [64] },
          { grade: 11, stream: "", student_program_ids: [64] },
          { grade: 12, stream: "   ", student_program_ids: [64] },
        ] as never}
      />,
    );

    const streamFilter = screen.getByLabelText("Filter by Exam Preparing For:");
    expect(
      [...streamFilter.querySelectorAll("option")].map((option) => [option.value, option.textContent]),
    ).toEqual([
      ["all", "All Streams (7)"],
      ["engineering", "Engineering (3)"],
      ["medical", "Medical (1)"],
      ["__none__", "No stream (3)"],
    ]);
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("7");

    await user.selectOptions(streamFilter, "__none__");
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-stream", "__none__");
    expect(screen.getByText("Showing 3 of 7 students")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("3");

    await user.selectOptions(streamFilter, "engineering");
    expect(screen.getByText("Showing 3 of 7 students")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("3");

    await user.selectOptions(screen.getByLabelText("Filter by Grade:"), "11");
    expect(screen.getByText("Showing 2 of 7 students")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("2");
  });

  it("labels the NVS stream filter Exam Preparing For with formatted options", () => {
    render(
      <EnrollmentTabContent
        {...baseProps}
        activeStudents={[
          { grade: 11, stream: "engineering", student_program_ids: [64] },
          { grade: 11, stream: " clat ", student_program_ids: [64] },
          { grade: 12, stream: "nda", student_program_ids: [64] },
          { grade: 12, stream: "Engineering", student_program_ids: [64] },
          { grade: 12, stream: null, student_program_ids: [64] },
        ] as never}
      />,
    );

    expect(screen.queryByLabelText("Filter by Stream:")).not.toBeInTheDocument();
    const filter = screen.getByLabelText("Filter by Exam Preparing For:");
    expect([...filter.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Streams (5)",
      "CLAT (1)",
      "Engineering (2)",
      "NDA (1)",
      "No stream (1)",
    ]);
  });

  it("keeps the Stream label and raw option labels for other programs", () => {
    render(
      <EnrollmentTabContent
        {...baseProps}
        programs={[program(PROGRAM_IDS.COE, "JNV CoE")]}
        userProgramIds={[PROGRAM_IDS.COE]}
        activeStudents={[
          { grade: 11, stream: " clat ", program_id: PROGRAM_IDS.COE, student_program_ids: [PROGRAM_IDS.COE] },
          { grade: 11, stream: "nda", program_id: PROGRAM_IDS.COE, student_program_ids: [PROGRAM_IDS.COE] },
        ] as never}
      />,
    );

    expect(screen.queryByLabelText("Filter by Exam Preparing For:")).not.toBeInTheDocument();
    const filter = screen.getByLabelText("Filter by Stream:");
    expect([...filter.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Streams (2)",
      "clat (1)",
      "nda (1)",
    ]);
  });

  it("hides the No stream option when every student has a stream", () => {
    render(
      <EnrollmentTabContent
        {...baseProps}
        activeStudents={[{ grade: 11, stream: "medical", student_program_ids: [64] }] as never}
      />,
    );

    expect(screen.queryByRole("option", { name: /No stream/ })).not.toBeInTheDocument();
  });

  it("carries the No stream sentinel into the Download List URL", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const user = userEvent.setup();
    render(
      <EnrollmentTabContent
        {...baseProps}
        activeStudents={[
          { grade: 11, stream: " ", student_program_ids: [64] },
          { grade: 11, stream: "medical", student_program_ids: [64] },
        ] as never}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Filter by Exam Preparing For:"), "__none__");
    await user.click(screen.getByRole("button", { name: "Download List" }));

    expect(assign).toHaveBeenCalledWith("/api/school/12345678901/students/export?stream=__none__");
    vi.unstubAllGlobals();
  });

  it("shows the roster search only for NVS and passes the query to the table", async () => {
    const user = userEvent.setup();
    render(
      <EnrollmentTabContent
        {...baseProps}
        programs={[program(PROGRAM_IDS.NVS, "JNV NVS"), program(PROGRAM_IDS.COE, "JNV CoE")]}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "Search students" }), "riya");
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-search", "riya");

    await user.click(screen.getByRole("button", { name: "JNV CoE" }));
    expect(screen.queryByRole("searchbox", { name: "Search students" })).not.toBeInTheDocument();
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-search", "");

    await user.click(screen.getByRole("button", { name: "JNV NVS" }));
    expect(screen.getByRole("searchbox", { name: "Search students" })).toHaveValue("");
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-search", "");
  });

  it("counts the roster search in Showing X of Y but not in card counts or Download List", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const user = userEvent.setup();
    render(
      <EnrollmentTabContent
        {...baseProps}
        activeStudents={[
          { first_name: "Riya", last_name: "Verma", student_id: "2028001", grade: 11, stream: "engineering", student_program_ids: [64] },
          { first_name: "Kabir", last_name: "Rao", student_id: "2028002", grade: 11, stream: "engineering", student_program_ids: [64] },
          { first_name: "Meera", last_name: "Iyer", student_id: "2028003", grade: 12, stream: null, student_program_ids: [64] },
        ] as never}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Filter by Grade:"), "11");
    await user.type(screen.getByRole("searchbox", { name: "Search students" }), " RIYA ");

    expect(screen.getByText("Showing 1 of 3 students")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("2");

    await user.click(screen.getByRole("button", { name: "Download List" }));
    expect(assign).toHaveBeenCalledWith("/api/school/12345678901/students/export?grade=11");
    vi.unstubAllGlobals();
  });

  it("counts flagged students within the grade and stream filters", async () => {
    const student = (id: string, stream: string) =>
      ({
        group_user_id: `gu-${id}`,
        student_pk_id: id,
        grade: 11,
        stream,
        program_id: PROGRAM_IDS.COE,
        student_program_ids: [PROGRAM_IDS.COE],
      }) as unknown as Student;
    const flag = (studentPkId: string) => ({
      id: Number(studentPkId),
      student_pk_id: studentPkId,
      status: "open",
      raised_by_email: "t@x",
      inserted_at: "2026-09-25T05:00:00Z",
      resolved_at: null,
      updates: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes("intervention-flags") ? { flags: [flag("1"), flag("3")] } : { consent: {} },
      })),
    );
    const user = userEvent.setup();
    render(
      <EnrollmentTabContent
        {...baseProps}
        programs={[program(PROGRAM_IDS.COE, "JNV CoE")]}
        userProgramIds={[PROGRAM_IDS.COE]}
        activeStudents={[student("1", "medical"), student("2", "medical"), student("3", "engineering")]}
      />,
    );

    expect(await screen.findByLabelText("Needs intervention only (2)")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by Stream:"), "medical");
    expect(screen.getByLabelText("Needs intervention only (1)")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Needs intervention only (1)"));
    expect(screen.getByText("Showing 1 of 3 students")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("hides Intervention Flags and skips the flags fetch while the NVS card is selected", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("intervention-flags")
          ? {
              flags: [
                {
                  id: 1,
                  student_pk_id: "1",
                  status: "open",
                  raised_by_email: "t@x",
                  inserted_at: "2026-09-25T05:00:00Z",
                  resolved_at: null,
                  updates: [],
                },
              ],
            }
          : { consent: {} },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const flagsCalls = () =>
      fetchMock.mock.calls.filter(([url]) => url.includes("intervention-flags"));
    const user = userEvent.setup();
    render(
      <EnrollmentTabContent
        {...baseProps}
        programs={[program(PROGRAM_IDS.NVS, "JNV NVS"), program(PROGRAM_IDS.COE, "JNV CoE")]}
        userProgramIds={[PROGRAM_IDS.NVS, PROGRAM_IDS.COE]}
      />,
    );

    // Let the consent fetch settle so any flags fetch would have fired too.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(flagsCalls()).toHaveLength(0);
    expect(screen.queryByLabelText(/Needs intervention only/)).not.toBeInTheDocument();
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-flags-shown", "false");

    await user.click(screen.getByRole("button", { name: "JNV CoE" }));

    expect(await screen.findByLabelText("Needs intervention only (0)")).toBeInTheDocument();
    expect(flagsCalls()).toHaveLength(1);
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-flags-shown", "true");
    vi.unstubAllGlobals();
  });

  it("keeps Intervention Flags hidden for passcode users in non-NVS programs", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(
      async () => ({ ok: true, json: async () => ({ consent: {} }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <EnrollmentTabContent
        {...baseProps}
        isPasscodeUser
        programs={[program(PROGRAM_IDS.COE, "JNV CoE")]}
        userProgramIds={[PROGRAM_IDS.COE]}
      />,
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes("intervention-flags")),
    ).toHaveLength(0);
    expect(screen.queryByLabelText(/Needs intervention only/)).not.toBeInTheDocument();
    expect(screen.getByTestId("student-table")).toHaveAttribute("data-flags-shown", "false");
    vi.unstubAllGlobals();
  });
});
