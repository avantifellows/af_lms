import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("shows read-only School coverage and links assigned and unassigned Students to detail", () => {
    render(<AdminSchoolRoster students={students} schoolCode="SCH001" />);

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Anita Mentor")).toBeInTheDocument();
    const table = within(screen.getByRole("region", { name: "School mentorship coverage" }));
    expect(table.getAllByText("Pending")).toHaveLength(2);
    expect(table.queryByText("Draft saved")).not.toBeInTheDocument();
    expect(table.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Asha Rao" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027&program_id=1&source=school"
    );
    expect(screen.getByRole("link", { name: "Open Ravi Shah" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/42/phases/74?school_code=SCH001&academic_year=2026-2027&program_id=1&source=school"
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View tutorial" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/tutorial",
    );
  });

  it("renders the complete server-provided Assignment Coverage summary for a Program Manager", () => {
    render(<AdminSchoolRoster
      students={[
        ...students,
        {
          studentId: 43,
          name: "Meera Das",
          externalStudentId: "S43",
          grade: 11,
          activePhaseId: 73,
          activeNotesState: "submitted",
          ownership: null,
        },
      ]}
      schoolCode="SCH001"
      role="program_manager"
      canEdit={false}
      summary={{
        eligible: 3,
        assigned: 1,
        unassigned: 2,
        activeMentors: 1,
        coveragePercentage: 33.3,
        completed: 1,
        pending: 1,
        noActivePhase: 1,
      }}
    />);

    const summary = within(screen.getByRole("region", { name: "Assignment Coverage summary" }));
    expect(summary.getByText("Eligible Students").previousSibling).toHaveTextContent("3");
    expect(summary.getByText("Assigned").previousSibling).toHaveTextContent("1");
    expect(summary.getByText("Unassigned").previousSibling).toHaveTextContent("2");
    expect(summary.getByText("Active Mentors").previousSibling).toHaveTextContent("1");
    expect(summary.getByText("Coverage").previousSibling).toHaveTextContent("33.3%");
    expect(summary.getByText("Completed").previousSibling).toHaveTextContent("1");
    expect(summary.getByText("Pending").previousSibling).toHaveTextContent("1");
    expect(summary.getByText("No active Phase").previousSibling).toHaveTextContent("1");
    expect(screen.queryByRole("button", { name: /Assign|Remove Mentor/ })).not.toBeInTheDocument();
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

  it("requires a replacement Mentor and audit reason before reassigning a current Mapping", async () => {
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
      mentors={[
        { userId: 9, name: "Anita Mentor", email: "anita@example.com" },
        { userId: 27, name: "Nila Mentor", email: "nila@example.com" },
      ]}
    />);

    await user.click(screen.getByRole("button", { name: "Reassign Mentor for Asha Rao" }));
    const dialog = screen.getByRole("dialog", { name: "Reassign Mentor for Asha Rao" });
    const mentor = within(dialog).getByRole("combobox", { name: "Replacement Mentor" });
    expect(within(mentor).queryByRole("option", { name: /Anita Mentor/ })).not.toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Reassign Mentor" });
    expect(submit).toBeDisabled();
    await user.selectOptions(mentor, "27");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Reassignment reason" }),
      "  Mentor handover requested  ",
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(fetchMock).toHaveBeenCalledWith("/api/holistic-mentorship/mappings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school_code: "SCH001",
        program_id: 78,
        academic_year: "2026-2027",
        student_id: 41,
        mentor_user_id: 27,
        expected_mapping_id: 8,
        confirmed: true,
        reason: "Mentor handover requested",
      }),
    });
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("uses each refreshed Mapping ID across assign, reassign, and immediate remove", async () => {
    const afterAssign = students.map((student) => student.studentId === 42
      ? { ...student, ownership: { mappingId: 81, mentorUserId: 27, mentorName: "Nila Mentor" } }
      : student);
    const afterReassign = afterAssign.map((student) => student.studentId === 42
      ? { ...student, ownership: { mappingId: 82, mentorUserId: 28, mentorName: "Meera Mentor" } }
      : student);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, changed: 1 }))
      .mockResolvedValueOnce(Response.json({ ok: true, changed: 1 }))
      .mockResolvedValueOnce(Response.json({ ok: true, changed: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const rosterProps = {
      schoolCode: "SCH001",
      programId: 78,
      role: "admin",
      mentors: [
        { userId: 27, name: "Nila Mentor", email: "nila@example.com" },
        { userId: 28, name: "Meera Mentor", email: "meera@example.com" },
      ],
    };
    const { rerender } = render(<AdminSchoolRoster
      students={students}
      {...rosterProps}
    />);

    await user.click(screen.getByRole("button", { name: "Assign Ravi Shah" }));
    let dialog = screen.getByRole("dialog", { name: "Assign Mentor to Ravi Shah" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Mentor" }), "27");
    await user.type(within(dialog).getByRole("textbox", { name: "Audit reason" }), "Student request");
    await user.click(within(dialog).getByRole("button", { name: "Assign Mentor" }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    rerender(<AdminSchoolRoster students={afterAssign} {...rosterProps} />);
    await user.click(screen.getByRole("button", { name: "Reassign Mentor for Ravi Shah" }));
    dialog = screen.getByRole("dialog", { name: "Reassign Mentor for Ravi Shah" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Replacement Mentor" }), "28");
    await user.type(within(dialog).getByRole("textbox", { name: "Reassignment reason" }), "Mentor handover");
    await user.click(within(dialog).getByRole("button", { name: "Reassign Mentor" }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Remove Mentor from Ravi Shah" })).toBeDisabled();
    rerender(<AdminSchoolRoster students={afterReassign} {...rosterProps} />);
    await user.click(await screen.findByRole("button", { name: "Remove Mentor from Ravi Shah" }));
    dialog = screen.getByRole("dialog", { name: "Remove Mentor from Ravi Shah" });
    await user.type(within(dialog).getByRole("textbox", { name: "Removal reason" }), "Mapping no longer needed");
    await user.click(within(dialog).getByRole("button", { name: "Remove Mentor" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/holistic-mentorship/mappings", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"expected_mapping_id":null'),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/holistic-mentorship/mappings", expect.objectContaining({
      method: "PATCH",
      body: expect.stringContaining('"expected_mapping_id":81'),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/holistic-mentorship/mappings", expect.objectContaining({
      method: "DELETE",
      body: expect.stringContaining('"expected_mapping_id":82'),
    }));
  });

  it.each(["admin", "holistic_mentorship_admin"])(
    "shows current-year Mapping controls for %s",
    (role) => {
      render(<AdminSchoolRoster students={students} schoolCode="SCH001" role={role} />);
      expect(screen.getByRole("button", { name: "Assign Ravi Shah" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Reassign Mentor for Asha Rao" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Remove Mentor from Asha Rao" })).toBeEnabled();
    },
  );

  it("keeps Admin Mapping controls visible but disabled under read-only", () => {
    render(<AdminSchoolRoster students={students} schoolCode="SCH001" role="admin" canEdit={false} />);
    expect(screen.getByRole("button", { name: "Assign Ravi Shah" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reassign Mentor for Asha Rao" })).toBeDisabled();
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
    expect(screen.queryByRole("button", { name: "Reassign Mentor for Asha Rao" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Mentor from Asha Rao" })).not.toBeInTheDocument();
  });
});
