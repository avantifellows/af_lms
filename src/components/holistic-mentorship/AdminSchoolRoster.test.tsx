import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import AdminSchoolRoster from "./AdminSchoolRoster";

const students = [
  {
    studentId: 41,
    name: "Asha Rao",
    externalStudentId: "S41",
    grade: 11,
    activePhaseId: 73,
    activeNotesState: null,
    ownership: { mappingId: 8, mentorUserId: 9, mentorName: "Anita Mentor" },
  },
  {
    studentId: 42,
    name: "Ravi Shah",
    externalStudentId: "S42",
    grade: 12,
    activePhaseId: 74,
    activeNotesState: null,
    ownership: null,
  },
];

describe("AdminSchoolRoster", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows read-only School coverage and links assigned Students back to the School source", () => {
    render(<AdminSchoolRoster students={students} schoolCode="SCH001" />);

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Anita Mentor")).toBeInTheDocument();
    const table = within(screen.getByRole("region", { name: "School mentorship coverage" }));
    expect(table.getByText("Pending")).toBeInTheDocument();
    expect(table.queryByText("Draft saved")).not.toBeInTheDocument();
    expect(table.getByText("Unassigned")).toBeInTheDocument();
    expect(table.getByText("Not assigned")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Asha Rao" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027&program_id=1&source=school"
    );
    expect(screen.queryByRole("link", { name: "Open Ravi Shah" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View tutorial" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/tutorial",
    );
  });

  it("filters by assignment without changing the summary", () => {
    render(<AdminSchoolRoster students={students} schoolCode="SCH001" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Assignment" }), {
      target: { value: "unassigned" },
    });

    expect(screen.getByText("Ravi Shah")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 2 Students");
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("requires a Mentor and audit reason before assigning an unassigned Student", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, changed: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AdminSchoolRoster
      students={students}
      schoolCode="SCH001"
      programId={78}
      role="holistic_mentorship_admin"
      mentors={[{ userId: 27, name: "Nila Mentor", email: "nila@example.com" }]}
    />);

    expect(screen.queryByRole("button", { name: "Assign Asha Rao" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Assign Ravi Shah" }));

    const dialog = screen.getByRole("dialog", { name: "Assign Mentor to Ravi Shah" });
    const submit = within(dialog).getByRole("button", { name: "Assign Mentor" });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Mentor" }), "27");
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Audit reason" }), "  Student request  ");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(fetchMock).toHaveBeenCalledWith("/api/holistic-mentorship/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school_code: "SCH001",
        program_id: 78,
        academic_year: "2026-2027",
        student_id: 42,
        mentor_user_id: 27,
        expected_mapping_id: null,
        confirmed: true,
        reason: "Student request",
      }),
    });
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("requires an audit reason before removing an assigned Student Mapping", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, changed: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AdminSchoolRoster
      students={students}
      schoolCode="SCH001"
      programId={78}
      role="admin"
    />);

    await user.click(screen.getByRole("button", { name: "Remove Mentor from Asha Rao" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Mentor from Asha Rao" });
    const submit = within(dialog).getByRole("button", { name: "Remove Mentor" });
    expect(submit).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Removal reason" }),
      "  Mentor left the programme  ",
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(fetchMock).toHaveBeenCalledWith("/api/holistic-mentorship/mappings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school_code: "SCH001",
        program_id: 78,
        academic_year: "2026-2027",
        student_id: 41,
        expected_mapping_id: 8,
        confirmed: true,
        reason: "Mentor left the programme",
      }),
    });
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it.each(["admin", "holistic_mentorship_admin"])(
    "shows current-year Mapping controls for %s",
    (role) => {
      render(<AdminSchoolRoster students={students} schoolCode="SCH001" role={role} />);
      expect(screen.getByRole("button", { name: "Assign Ravi Shah" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Remove Mentor from Asha Rao" })).toBeEnabled();
    },
  );

  it("keeps Admin Mapping controls visible but disabled under read-only", () => {
    render(<AdminSchoolRoster students={students} schoolCode="SCH001" role="admin" canEdit={false} />);
    expect(screen.getByRole("button", { name: "Assign Ravi Shah" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Mentor from Asha Rao" })).toBeDisabled();
  });

  it.each([
    ["teacher", "2026-2027"],
    ["program_manager", "2026-2027"],
    ["program_admin", "2026-2027"],
    ["admin", "2025-2026"],
    ["holistic_mentorship_admin", "2025-2026"],
  ])("hides Mapping controls for role %s in Academic Year %s", (role, academicYear) => {
    render(<AdminSchoolRoster students={students} schoolCode="SCH001"
      role={role} academicYear={academicYear} />);
    expect(screen.queryByRole("button", { name: "Assign Ravi Shah" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Mentor from Asha Rao" })).not.toBeInTheDocument();
  });
});
