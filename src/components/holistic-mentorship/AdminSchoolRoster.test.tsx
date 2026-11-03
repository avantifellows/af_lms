import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

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

const coverageStudents = [
  {
    studentId: 41,
    name: "Asha Rao",
    externalStudentId: "S41",
    grade: 11,
    activePhaseId: 73,
    activeNotesState: "submitted" as const,
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
  {
    studentId: 43,
    name: "Meera Das",
    externalStudentId: "S43",
    grade: 11,
    activePhaseId: null,
    activeNotesState: null,
    ownership: { mappingId: 10, mentorUserId: 9, mentorName: "Anita Mentor" },
  },
  {
    studentId: 44,
    name: "Kabir Singh",
    externalStudentId: "S44",
    grade: 12,
    activePhaseId: 75,
    activeNotesState: "submitted" as const,
    ownership: { mappingId: 11, mentorUserId: 10, mentorName: "Nila Mentor" },
  },
  {
    studentId: 45,
    name: "Nisha Patel",
    externalStudentId: "S45",
    grade: 11,
    activePhaseId: 76,
    activeNotesState: null,
    ownership: { mappingId: 12, mentorUserId: 10, mentorName: "Nila Mentor" },
  },
  {
    studentId: 46,
    name: "Ishaan Kumar",
    externalStudentId: "S46",
    grade: 12,
    activePhaseId: null,
    activeNotesState: null,
    ownership: null,
  },
];

const wholeSchoolSummary = {
  eligible: 6,
  assigned: 4,
  unassigned: 2,
  activeMentors: 2,
  coveragePercentage: 66.7,
  completed: 2,
  pending: 2,
  noActivePhase: 2,
};

function expectSummaryMetrics(expected: typeof wholeSchoolSummary) {
  const summary = within(screen.getByRole("region", { name: "Assignment Coverage summary" }));
  const metrics = [
    ["Eligible Students", expected.eligible],
    ["Assigned", expected.assigned],
    ["Unassigned", expected.unassigned],
    ["Active Mentors", expected.activeMentors],
    ["Coverage", `${expected.coveragePercentage.toFixed(1)}%`],
    ["Completed", expected.completed],
    ["Pending", expected.pending],
    ["No active phase", expected.noActivePhase],
  ] as const;
  for (const [label, value] of metrics) {
    expect(summary.getByText(label).previousSibling).toHaveTextContent(String(value));
  }
}

describe("AdminSchoolRoster", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("keeps the progress origin when opening a student from a School", () => {
    render(<AdminSchoolRoster schoolCode="SCH001" programId={94} students={students}
      fromHolisticProgress canEdit={false} />);
    expect(screen.getByRole("link", { name: "Open Asha Rao" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027&program_id=94&source=school-progress",
    );
  });

  it("shows read-only School coverage and links assigned and unassigned Students to detail", () => {
    render(<AdminSchoolRoster students={students} schoolCode="SCH001" />);

    expect(screen.getByText("50.0%")).toBeInTheDocument();
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

  it("uses the complete server-provided Assignment Coverage summary without filters", () => {
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
    expect(summary.getByText("No active phase").previousSibling).toHaveTextContent("1");
    expect(screen.queryByRole("button", { name: /Assign|Remove Mentor/ })).not.toBeInTheDocument();
  });

  it("derives every summary metric from grade-filtered rows", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), {
      target: { value: "12" },
    });

    expect(screen.getByText("Ravi Shah")).toBeInTheDocument();
    expect(screen.getByText("Kabir Singh")).toBeInTheDocument();
    expect(screen.getByText("Ishaan Kumar")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 3 of 6 Students");
    expectSummaryMetrics({
      eligible: 3,
      assigned: 1,
      unassigned: 2,
      activeMentors: 1,
      coveragePercentage: 33.3,
      completed: 1,
      pending: 1,
      noActivePhase: 1,
    });
  });

  it("keeps the whole-school summary when only the assignment filter is active", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Assignment" }), {
      target: { value: "unassigned" },
    });

    expect(screen.getByText("Ravi Shah")).toBeInTheDocument();
    expect(screen.getByText("Ishaan Kumar")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expectSummaryMetrics(wholeSchoolSummary);
  });

  it("derives every summary metric from search-filtered rows", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), {
      target: { value: "S44" },
    });

    expect(screen.getByText("Kabir Singh")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expectSummaryMetrics({
      eligible: 1,
      assigned: 1,
      unassigned: 0,
      activeMentors: 1,
      coveragePercentage: 100,
      completed: 1,
      pending: 0,
      noActivePhase: 0,
    });
  });

  it("returns zero for every summary metric when no rows match", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), {
      target: { value: "no-such-student" },
    });

    expect(screen.getByText("No Students match")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 of 6 Students");
    expectSummaryMetrics({
      eligible: 0,
      assigned: 0,
      unassigned: 0,
      activeMentors: 0,
      coveragePercentage: 0,
      completed: 0,
      pending: 0,
      noActivePhase: 0,
    });
  });

  it("derives summary from search and grade while the table also applies assignment", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Assignment" }), {
      target: { value: "assigned" },
    });

    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expect(screen.getByText("Kabir Singh")).toBeInTheDocument();
    expect(screen.queryByText("Ravi Shah")).not.toBeInTheDocument();
    expect(screen.queryByText("Ishaan Kumar")).not.toBeInTheDocument();
    expectSummaryMetrics({
      eligible: 3,
      assigned: 1,
      unassigned: 2,
      activeMentors: 1,
      coveragePercentage: 33.3,
      completed: 1,
      pending: 1,
      noActivePhase: 1,
    });
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
  it("lists every current Mentor from the roster rows with counts, even without the editor Mentor list", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" role="program_manager"
      canEdit={false} summary={wholeSchoolSummary} />);

    const mentor = screen.getByRole("combobox", { name: "Filter by Mentor" });
    expect(within(mentor).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All Mentors",
      "Anita Mentor (2)",
      "Nila Mentor (2)",
    ]);
    expect(mentor).toHaveValue("");
  });

  it("sorts Mentors by name and tells apart Mentors who share a name", () => {
    const rows = [
      { ...coverageStudents[0], ownership: { mappingId: 1, mentorUserId: 30, mentorName: "priya shah" } },
      { ...coverageStudents[2], ownership: { mappingId: 2, mentorUserId: 31, mentorName: "Priya Shah" } },
      { ...coverageStudents[3], ownership: { mappingId: 3, mentorUserId: 31, mentorName: "Priya Shah" } },
      { ...coverageStudents[4], ownership: { mappingId: 4, mentorUserId: 32, mentorName: "Anil Kumar" } },
    ];
    render(<AdminSchoolRoster students={rows} schoolCode="SCH001"
      mentors={[{ userId: 31, name: "Priya Shah", email: "priya.s@example.com" }]} />);

    const mentor = screen.getByRole("combobox", { name: "Filter by Mentor" });
    expect(within(mentor).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All Mentors",
      "Anil Kumar (1)",
      "priya shah (1) · ID 30",
      "Priya Shah (2) · priya.s@example.com",
    ]);
    expect(mentor).toHaveAttribute("title", "All Mentors");
    fireEvent.change(mentor, { target: { value: "31" } });
    expect(mentor).toHaveAttribute("title", "Priya Shah (2) · priya.s@example.com");
  });

  it("filters by Mentor without changing the summary cards", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Mentor" }), { target: { value: "10" } });

    expect(screen.getByText("Kabir Singh")).toBeInTheDocument();
    expect(screen.getByText("Nisha Patel")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.queryByText("Ravi Shah")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expectSummaryMetrics(wholeSchoolSummary);
  });

  it("filters by Progress to match the badge, including unassigned Students with an active Phase", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);
    const progressFilter = screen.getByRole("combobox", { name: "Filter by Progress" });
    expect(within(progressFilter).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All Progress", "Completed", "Pending", "No active phase",
    ]);

    fireEvent.change(progressFilter, { target: { value: "pending" } });
    const table = within(screen.getByRole("region", { name: "School mentorship coverage" }));
    expect(table.getAllByRole("row").slice(1).map((row) => within(row).getByText(/^Pending$/))).toHaveLength(2);
    expect(table.getByText("Ravi Shah")).toBeInTheDocument();
    expect(table.getByText("Nisha Patel")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expectSummaryMetrics(wholeSchoolSummary);

    fireEvent.change(progressFilter, { target: { value: "none" } });
    expect(screen.getByText("Meera Das")).toBeInTheDocument();
    expect(screen.getByText("Ishaan Kumar")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");

    fireEvent.change(progressFilter, { target: { value: "completed" } });
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Kabir Singh")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expectSummaryMetrics(wholeSchoolSummary);
  });

  it("combines every filter while only Search and Grade narrow the summary", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "11" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Mentor" }), { target: { value: "9" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), { target: { value: "none" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Assignment" }), { target: { value: "assigned" } });

    expect(screen.getByText("Meera Das")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expectSummaryMetrics({
      eligible: 3,
      assigned: 3,
      unassigned: 0,
      activeMentors: 2,
      coveragePercentage: 100,
      completed: 1,
      pending: 1,
      noActivePhase: 1,
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), { target: { value: "Asha" } });
    expect(screen.getByText("No Students match")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 of 6 Students");
  });

  it("disables Unassigned while a Mentor is selected and resets it when a Mentor is chosen", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);
    const assignment = screen.getByRole("combobox", { name: "Filter by Assignment" });
    const mentor = screen.getByRole("combobox", { name: "Filter by Mentor" });
    const unassigned = within(assignment).getByRole("option", { name: /^Unassigned/ });

    fireEvent.change(assignment, { target: { value: "unassigned" } });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expect(unassigned).toBeEnabled();

    fireEvent.change(mentor, { target: { value: "9" } });
    expect(assignment).toHaveValue("all");
    expect(unassigned).toBeDisabled();
    expect(unassigned).toHaveTextContent("Unassigned (clear Mentor first)");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Meera Das")).toBeInTheDocument();

    fireEvent.change(mentor, { target: { value: "" } });
    expect(unassigned).toBeEnabled();
    expect(unassigned).toHaveTextContent(/^Unassigned$/);
    expect(assignment).toHaveValue("all");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");
  });

  it("shows a visible Showing count as a live status", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Showing 6 of 6 Students");
    expect(status).not.toHaveClass("sr-only");
    expect(within(status).getAllByText("6")).toHaveLength(2);
    for (const count of within(status).getAllByText("6")) expect(count).toHaveClass("font-mono");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("restores every filter from the URL", () => {
    window.history.replaceState(null, "",
      "/school/SCH001?tab=holistic_mentorship&program_id=1&hm_search=Kabir&hm_grade=12&hm_mentor=10" +
      "&hm_progress=completed&hm_assignment=assigned");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    expect(screen.getByRole("textbox", { name: "Search Students" })).toHaveValue("Kabir");
    expect(screen.getByRole("combobox", { name: "Filter by Grade" })).toHaveValue("12");
    expect(screen.getByRole("combobox", { name: "Filter by Mentor" })).toHaveValue("10");
    expect(screen.getByRole("combobox", { name: "Filter by Progress" })).toHaveValue("completed");
    expect(screen.getByRole("combobox", { name: "Filter by Assignment" })).toHaveValue("assigned");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expect(screen.getByRole("link", { name: "Open Kabir Singh" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/44/phases/75?school_code=SCH001&academic_year=2026-2027&program_id=1" +
        "&source=school&hm_search=Kabir&hm_grade=12&hm_mentor=10&hm_progress=completed&hm_assignment=assigned",
    );
  });

  it.each([
    "hm_grade=13&hm_progress=started&hm_assignment=nobody&hm_mentor=abc",
    "hm_mentor=999",
    "hm_mentor=-9&hm_grade=&hm_progress=",
  ])("falls back to defaults for invalid URL filters (%s)", (query) => {
    window.history.replaceState(null, "", `/school/SCH001?tab=holistic_mentorship&${query}`);
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    expect(screen.getByRole("combobox", { name: "Filter by Grade" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Filter by Mentor" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Filter by Progress" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Filter by Assignment" })).toHaveValue("all");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");
  });

  it("drops a URL Unassigned filter that conflicts with a URL Mentor", async () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship&hm_mentor=9&hm_assignment=unassigned");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    expect(screen.getByRole("combobox", { name: "Filter by Mentor" })).toHaveValue("9");
    expect(screen.getByRole("combobox", { name: "Filter by Assignment" })).toHaveValue("all");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    await waitFor(() => expect(window.location.search).toBe("?tab=holistic_mentorship&hm_mentor=9"));
  });

  it("writes filters to the URL in place, keeping other params and omitting defaults", async () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship&program_id=78&grade=9#coverage");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" programId={78} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "12" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), { target: { value: "pending" } });
    await waitFor(() => expect(window.location.search)
      .toBe("?tab=holistic_mentorship&program_id=78&grade=9&hm_grade=12&hm_progress=pending"));
    expect(window.location.pathname).toBe("/school/SCH001");
    expect(window.location.hash).toBe("#coverage");
    expect(replaceState).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), { target: { value: "" } });
    await waitFor(() => expect(window.location.search).toBe("?tab=holistic_mentorship&program_id=78&grade=9"));
    expect(pushState).not.toHaveBeenCalled();
  });

  it("writes search once typing pauses, and at once when a Student is opened", async () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship");
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);
    const search = screen.getByRole("textbox", { name: "Search Students" });

    for (const value of ["N", "Ni", "Nis"]) fireEvent.change(search, { target: { value } });
    expect(window.location.search).toBe("?tab=holistic_mentorship");
    await waitFor(() => expect(window.location.search).toBe("?tab=holistic_mentorship&hm_search=Nis"));
    expect(replaceState).toHaveBeenCalledTimes(1);

    fireEvent.change(search, { target: { value: "Nisha" } });
    const open = screen.getByRole("link", { name: "Open Nisha Patel" });
    open.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(open);
    expect(window.location.search).toBe("?tab=holistic_mentorship&hm_search=Nisha");
  });

  it("carries the filters and Centre into the Student link", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" centreId={30} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "12" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Assignment" }), {
      target: { value: "unassigned" },
    });

    expect(screen.getByRole("link", { name: "Open Ravi Shah" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/42/phases/74?school_code=SCH001&academic_year=2026-2027&program_id=1" +
        "&source=school&centre_id=30&hm_grade=12&hm_assignment=unassigned",
    );
  });

  it("falls back to All Mentors when the selected Mentor leaves the roster", () => {
    window.history.replaceState(null, "", "/school/SCH001?hm_mentor=10");
    const { rerender } = render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");

    rerender(<AdminSchoolRoster schoolCode="SCH001" students={coverageStudents.map((student) =>
      student.ownership?.mentorUserId === 10 ? { ...student, ownership: null } : student)} />);

    expect(screen.getByRole("combobox", { name: "Filter by Mentor" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");

    // Assigned again later: the dropped filter stays forgotten.
    rerender(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);
    expect(screen.getByRole("combobox", { name: "Filter by Mentor" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");
  });
});
