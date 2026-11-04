import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, use, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockRefresh, mockSearchParams, mockPathname } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockSearchParams: vi.fn(() => new URLSearchParams(window.location.search)),
  mockPathname: vi.fn(() => window.location.pathname),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
  useSearchParams: mockSearchParams,
  usePathname: mockPathname,
}));

import SchoolTabs from "@/components/SchoolTabs";
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
  // Progress counts cover assigned Students only: 2 + 1 + 1 = 4 Assigned.
  completed: 2,
  pending: 1,
  noActivePhase: 1,
};

// A server summary no derivation from `coverageStudents` can produce, so a
// test can tell which one is on screen.
const serverOnlySummary = {
  eligible: 99,
  assigned: 50,
  unassigned: 49,
  activeMentors: 7,
  coveragePercentage: 50.5,
  completed: 11,
  pending: 22,
  noActivePhase: 33,
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
    // Unmount first: the roster writes pending filters to the URL on unmount.
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockSearchParams.mockImplementation(() => new URLSearchParams(window.location.search));
    mockPathname.mockImplementation(() => window.location.pathname);
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
    expect(table.getAllByText("Pending")).toHaveLength(1);
    expect(table.queryByText("Draft saved")).not.toBeInTheDocument();
    // Ravi has no Mentor: "Unassigned" in both the Mentor and Progress columns.
    const raviCells = within(table.getByText("Ravi Shah").closest("tr")!).getAllByRole("cell");
    expect(raviCells[2]).toHaveTextContent("Unassigned");
    expect(raviCells[3]).toHaveTextContent("Unassigned");
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
    expectSummaryMetrics({ eligible: 3, assigned: 1, unassigned: 2, activeMentors: 1, coveragePercentage: 33.3, completed: 1, pending: 0, noActivePhase: 0 });
  });

  it("derives every summary metric from Unassigned rows", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), {
      target: { value: "unassigned" },
    });

    expect(screen.getByText("Ravi Shah")).toBeInTheDocument();
    expect(screen.getByText("Ishaan Kumar")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expectSummaryMetrics({ eligible: 2, assigned: 0, unassigned: 2, activeMentors: 0, coveragePercentage: 0, completed: 0, pending: 0, noActivePhase: 0 });
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

  it("derives the summary from search, grade and All Assigned together", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), {
      target: { value: "assigned" },
    });

    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expect(screen.getByText("Kabir Singh")).toBeInTheDocument();
    expect(screen.queryByText("Ravi Shah")).not.toBeInTheDocument();
    expect(screen.queryByText("Ishaan Kumar")).not.toBeInTheDocument();
    expectSummaryMetrics({ eligible: 1, assigned: 1, unassigned: 0, activeMentors: 1, coveragePercentage: 100, completed: 1, pending: 0, noActivePhase: 0 });
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

  it("filters by Mentor and derives the summary cards from that Mentor's Students", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Mentor" }), { target: { value: "10" } });

    expect(screen.getByText("Kabir Singh")).toBeInTheDocument();
    expect(screen.getByText("Nisha Patel")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.queryByText("Ravi Shah")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expectSummaryMetrics({ eligible: 2, assigned: 2, unassigned: 0, activeMentors: 1, coveragePercentage: 100, completed: 1, pending: 1, noActivePhase: 0 });
  });

  it("offers Students & Progress's Progress options, in its order, without Skipped", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);
    const progressFilter = screen.getByRole("combobox", { name: "Filter by Progress" });

    expect(within(progressFilter).getAllByRole("option").map((option) => [option.getAttribute("value"),
      option.textContent])).toEqual([
      ["", "All Students"],
      ["assigned", "All Assigned"],
      ["pending", "Pending"],
      ["completed", "Completed"],
      ["no_active_phase", "No active phase"],
      ["unassigned", "Unassigned"],
    ]);
    expect(progressFilter).toHaveValue("");
    expect(screen.queryByRole("combobox", { name: "Filter by Assignment" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox").map((control) => control.getAttribute("aria-label"))).toEqual([
      "Filter by Grade", "Filter by Mentor", "Filter by Progress",
    ]);
  });

  it("filters by Progress like Students & Progress: an unassigned Student is Unassigned, never Pending", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);
    const progressFilter = screen.getByRole("combobox", { name: "Filter by Progress" });
    const table = () => within(screen.getByRole("region", { name: "School mentorship coverage" }));

    // Pending, Completed and No active phase are assigned Students only.
    fireEvent.change(progressFilter, { target: { value: "pending" } });
    expect(table().getByText("Nisha Patel")).toBeInTheDocument();
    expect(table().queryByText("Ravi Shah")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expectSummaryMetrics({ eligible: 1, assigned: 1, unassigned: 0, activeMentors: 1, coveragePercentage: 100, completed: 0, pending: 1, noActivePhase: 0 });

    fireEvent.change(progressFilter, { target: { value: "no_active_phase" } });
    expect(table().getByText("Meera Das")).toBeInTheDocument();
    expect(table().queryByText("Ishaan Kumar")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expectSummaryMetrics({ eligible: 1, assigned: 1, unassigned: 0, activeMentors: 1, coveragePercentage: 100, completed: 0, pending: 0, noActivePhase: 1 });

    fireEvent.change(progressFilter, { target: { value: "completed" } });
    expect(table().getByText("Asha Rao")).toBeInTheDocument();
    expect(table().getByText("Kabir Singh")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expectSummaryMetrics({ eligible: 2, assigned: 2, unassigned: 0, activeMentors: 2, coveragePercentage: 100, completed: 2, pending: 0, noActivePhase: 0 });

    // Unassigned is every Student without a Mentor, whatever their Phase.
    fireEvent.change(progressFilter, { target: { value: "unassigned" } });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    for (const name of ["Ravi Shah", "Ishaan Kumar"]) {
      const cells = within(table().getByText(name).closest("tr")!).getAllByRole("cell");
      expect(cells[3]).toHaveTextContent(/^Unassigned$/);
    }
    expectSummaryMetrics({ eligible: 2, assigned: 0, unassigned: 2, activeMentors: 0, coveragePercentage: 0, completed: 0, pending: 0, noActivePhase: 0 });

    fireEvent.change(progressFilter, { target: { value: "assigned" } });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 4 of 6 Students");
    expect(table().queryByText("Ravi Shah")).not.toBeInTheDocument();
    expectSummaryMetrics({ eligible: 4, assigned: 4, unassigned: 0, activeMentors: 2, coveragePercentage: 100, completed: 2, pending: 1, noActivePhase: 1 });
  });

  it("combines every filter, with the summary always describing the rows shown", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={serverOnlySummary} />);
    expectSummaryMetrics(serverOnlySummary);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "11" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Mentor" }), { target: { value: "9" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), {
      target: { value: "no_active_phase" },
    });

    expect(screen.getByText("Meera Das")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expectSummaryMetrics({ eligible: 1, assigned: 1, unassigned: 0, activeMentors: 1, coveragePercentage: 100, completed: 0, pending: 0, noActivePhase: 1 });

    const search = screen.getByRole("textbox", { name: "Search Students" });
    fireEvent.change(search, { target: { value: "Asha" } });
    expect(screen.getByText("No Students match")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 of 6 Students");
    expectSummaryMetrics({ eligible: 0, assigned: 0, unassigned: 0, activeMentors: 0, coveragePercentage: 0, completed: 0, pending: 0, noActivePhase: 0 });

    // Back to no filters (a spaces-only search filters nothing): the server summary.
    fireEvent.change(search, { target: { value: "   " } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Mentor" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), { target: { value: "" } });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");
    expectSummaryMetrics(serverOnlySummary);
  });

  it("switches to derived numbers once a filter is active, even one matching every row", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={serverOnlySummary} />);
    expectSummaryMetrics(serverOnlySummary);

    // Every Student ID starts with "S4", so all six rows still show.
    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), { target: { value: "S4" } });

    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");
    expectSummaryMetrics(wholeSchoolSummary);
  });

  it("rounds derived Coverage half-way values like the server (201 of 400 is 50.3%)", () => {
    const rows = Array.from({ length: 400 }, (_, index) => ({
      ...coverageStudents[1],
      studentId: 1000 + index,
      name: `Student ${index}`,
      externalStudentId: `X${index}`,
      ownership: index < 201 ? { mappingId: 5000 + index, mentorUserId: 9, mentorName: "Anita Mentor" } : null,
    }));
    render(<AdminSchoolRoster students={rows} schoolCode="SCH001" />);

    const summary = within(screen.getByRole("region", { name: "Assignment Coverage summary" }));
    expect(summary.getByText("Coverage").previousSibling).toHaveTextContent("50.3%");
    expect(summary.getByText("Assigned").previousSibling).toHaveTextContent("201");
  });

  it("disables Unassigned while a Mentor is selected and resets it when a Mentor is chosen", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);
    const progressFilter = screen.getByRole("combobox", { name: "Filter by Progress" });
    const mentor = screen.getByRole("combobox", { name: "Filter by Mentor" });
    const unassigned = within(progressFilter).getByRole("option", { name: /^Unassigned/ });

    fireEvent.change(progressFilter, { target: { value: "unassigned" } });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expect(unassigned).toBeEnabled();

    fireEvent.change(mentor, { target: { value: "9" } });
    expect(progressFilter).toHaveValue("");
    expect(unassigned).toBeDisabled();
    expect(unassigned).toHaveTextContent("Unassigned (clear Mentor first)");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Meera Das")).toBeInTheDocument();

    fireEvent.change(mentor, { target: { value: "" } });
    expect(unassigned).toBeEnabled();
    expect(unassigned).toHaveTextContent(/^Unassigned$/);
    expect(progressFilter).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");

    // All Assigned with a Mentor is fine.
    fireEvent.change(mentor, { target: { value: "10" } });
    fireEvent.change(progressFilter, { target: { value: "assigned" } });
    expect(progressFilter).toHaveValue("assigned");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
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
      "&hm_progress=completed");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    expect(screen.getByRole("textbox", { name: "Search Students" })).toHaveValue("Kabir");
    expect(screen.getByRole("combobox", { name: "Filter by Grade" })).toHaveValue("12");
    expect(screen.getByRole("combobox", { name: "Filter by Mentor" })).toHaveValue("10");
    expect(screen.getByRole("combobox", { name: "Filter by Progress" })).toHaveValue("completed");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 6 Students");
    expect(screen.getByRole("link", { name: "Open Kabir Singh" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/44/phases/75?school_code=SCH001&academic_year=2026-2027&program_id=1" +
        "&source=school&hm_search=Kabir&hm_grade=12&hm_mentor=10&hm_progress=completed",
    );
  });

  it.each([
    ["assigned", 4], ["pending", 1], ["completed", 2], ["no_active_phase", 1], ["unassigned", 2],
  ])("restores hm_progress=%s from the URL", (value, count) => {
    window.history.replaceState(null, "", `/school/SCH001?hm_progress=${value}`);
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);

    expect(screen.getByRole("combobox", { name: "Filter by Progress" })).toHaveValue(value);
    expect(screen.getByRole("status")).toHaveTextContent(`Showing ${count} of 6 Students`);
  });

  it.each([
    "hm_grade=13&hm_progress=started&hm_mentor=abc",
    "hm_mentor=999",
    "hm_mentor=-9&hm_grade=&hm_progress=",
    "hm_progress=none",
    "hm_progress=skipped",
    "hm_assignment=unassigned",
  ])("falls back to defaults for invalid URL filters (%s)", (query) => {
    window.history.replaceState(null, "", `/school/SCH001?tab=holistic_mentorship&${query}`);
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={serverOnlySummary} />);

    expect(screen.getByRole("combobox", { name: "Filter by Grade" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Filter by Mentor" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Filter by Progress" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");
    expectSummaryMetrics(serverOnlySummary);
  });

  it("drops a URL Unassigned filter that conflicts with a URL Mentor", async () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship&hm_mentor=9&hm_progress=unassigned");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" summary={wholeSchoolSummary} />);

    expect(screen.getByRole("combobox", { name: "Filter by Mentor" })).toHaveValue("9");
    expect(screen.getByRole("combobox", { name: "Filter by Progress" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 6 Students");
    await waitFor(() => expect(window.location.search).toBe("?tab=holistic_mentorship&hm_mentor=9"));
  });

  it("writes filters to the URL in place, keeping other params and omitting defaults", async () => {
    // A retired hm_assignment is dropped on the first write.
    window.history.replaceState(null, "",
      "/school/SCH001?tab=holistic_mentorship&program_id=78&grade=9&hm_assignment=assigned#coverage");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" programId={78} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "12" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), { target: { value: "pending" } });
    await waitFor(() => expect(window.location.search)
      .toBe("?tab=holistic_mentorship&program_id=78&grade=9&hm_grade=12&hm_progress=pending"));
    expect(window.location.pathname).toBe("/school/SCH001");
    expect(window.location.hash).toBe("#coverage");
    // One write per pick; the delayed write that follows finds nothing to change.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(replaceState).toHaveBeenCalledTimes(2);

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

  it("writes a dropdown pick at once; only typing waits for a pause", () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "12" } });
    expect(window.location.search).toBe("?tab=holistic_mentorship&hm_grade=12");

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), { target: { value: "pending" } });
    expect(window.location.search).toBe("?tab=holistic_mentorship&hm_grade=12&hm_progress=pending");
  });

  it("holds URL writes while a roster refresh is in flight, then writes the latest filters", async () => {
    // Next treats history.replaceState as a "restore" that discards a pending
    // router.refresh(). Model a real refresh: a transition that stays pending
    // until the refreshed roster (here, a held promise) lands.
    let land = () => {};
    const landed = new Promise<void>((resolve) => { land = resolve; });
    const refresh = { start: () => {} };
    function RefreshingRoster() {
      const [refreshing, setRefreshing] = useState(false);
      useEffect(() => {
        refresh.start = () => setRefreshing(true);
      }, []);
      return <>
        <AdminSchoolRoster students={students} schoolCode="SCH001" programId={78} role="holistic_mentorship_admin"
          mentors={[
            { userId: 9, name: "Anita Mentor", email: "anita@example.com" },
            { userId: 27, name: "Nila Mentor", email: "nila@example.com" },
          ]} />
        {refreshing && <AwaitRefresh promise={landed} />}
      </>;
    }
    function AwaitRefresh({ promise }: { promise: Promise<void> }) {
      use(promise);
      return null;
    }
    mockRefresh.mockImplementation(() => refresh.start());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, changed: 1 }) }));
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship");
    const user = userEvent.setup();
    render(<Suspense fallback={null}><RefreshingRoster /></Suspense>);

    await user.click(screen.getByRole("button", { name: "Reassign Mentor for Asha Rao" }));
    const dialog = screen.getByRole("dialog", { name: "Reassign Mentor for Asha Rao" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Replacement Mentor" }), "27");
    await user.type(within(dialog).getByRole("textbox", { name: "Reassignment reason" }), "Mentor handover");
    await user.click(within(dialog).getByRole("button", { name: "Reassign Mentor" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce());
    const replaceState = vi.spyOn(window.history, "replaceState");

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "12" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), { target: { value: "Ravi" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?tab=holistic_mentorship");

    land();
    await waitFor(() => expect(window.location.search).toBe("?tab=holistic_mentorship&hm_search=Ravi&hm_grade=12"));
  });

  it("carries the filters and Centre into the Student link", () => {
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" centreId={30} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Grade" }), { target: { value: "12" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Progress" }), {
      target: { value: "unassigned" },
    });

    expect(screen.getByRole("link", { name: "Open Ravi Shah" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/42/phases/74?school_code=SCH001&academic_year=2026-2027&program_id=1" +
        "&source=school&centre_id=30&hm_grade=12&hm_progress=unassigned",
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
  it("keeps a just-typed search across a School tab switch and back", async () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship&program_id=1");
    // Next updates useSearchParams after replaceState in a transition; model the
    // worst case, a snapshot that never catches up.
    const snapshot = new URLSearchParams(window.location.search);
    mockSearchParams.mockImplementation(() => snapshot);
    const user = userEvent.setup();
    render(<SchoolTabs defaultTab="enrollment" tabs={[
      { id: "enrollment", label: "Enrollment", content: <div>Enrollment Content</div> },
      { id: "holistic_mentorship", label: "Holistic Mentorship",
        content: <AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" /> },
    ]} />);

    await user.type(screen.getByRole("textbox", { name: "Search Students" }), "kes");
    await user.click(screen.getByRole("tab", { name: "Enrollment" }));
    expect(screen.getByText("Enrollment Content")).toBeInTheDocument();
    expect(window.location.search).toBe("?program_id=1&hm_search=kes");

    await user.click(screen.getByRole("tab", { name: "Holistic Mentorship" }));
    expect(screen.getByRole("textbox", { name: "Search Students" })).toHaveValue("kes");
    expect(window.location.search).toBe("?program_id=1&hm_search=kes&tab=holistic_mentorship");
  });

  it("writes the search when the search box loses focus", () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);
    const search = screen.getByRole("textbox", { name: "Search Students" });

    fireEvent.change(search, { target: { value: "Ravi  Shah" } });
    fireEvent.blur(search);

    expect(window.location.search).toBe("?tab=holistic_mentorship&hm_search=Ravi++Shah");
  });

  it("does not write a blank search and limits search to what the URL keeps", async () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship&hm_search=Asha");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);
    const search = screen.getByRole("textbox", { name: "Search Students" });
    expect(search).toHaveAttribute("maxLength", "100");

    fireEvent.change(search, { target: { value: "   " } });
    fireEvent.blur(search);

    expect(window.location.search).toBe("?tab=holistic_mentorship");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");
  });

  it("does not write to the URL on unmount once the page has changed", () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship");
    const { unmount } = render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), { target: { value: "Asha" } });

    window.history.pushState(null, "", "/holistic-mentorship/students/41/phases/73?source=school");
    unmount();

    expect(window.location.search).toBe("?source=school");
  });
  it("opens another Centre with its own URL filters, not the previous Centre's", async () => {
    window.history.replaceState(null, "", "/centre/8?tab=holistic_mentorship&hm_search=Kabir&hm_grade=12");
    const { rerender } = render(<AdminSchoolRoster key="8" students={coverageStudents} schoolCode="SCH001"
      centreId={8} />);
    expect(screen.getByRole("textbox", { name: "Search Students" })).toHaveValue("Kabir");

    // The Centre switcher's push: the router already names Centre 9 while it
    // renders, but the browser URL is still Centre 8's until after the commit.
    mockPathname.mockImplementation(() => "/centre/9");
    mockSearchParams.mockImplementation(() => new URLSearchParams("tab=holistic_mentorship"));
    rerender(<AdminSchoolRoster key="9" students={coverageStudents} schoolCode="SCH001" centreId={9} />);
    window.history.pushState(null, "", "/centre/9?tab=holistic_mentorship");

    expect(screen.getByRole("textbox", { name: "Search Students" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Filter by Grade" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 6 of 6 Students");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(window.location.search).toBe("?tab=holistic_mentorship");
  });

  it("does not carry one Program's filters through Back to the Program choice", () => {
    window.history.replaceState(null, "", "/school/SCH001?tab=holistic_mentorship&program_id=1");
    const { unmount } = render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" programId={1} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Students" }), { target: { value: "Asha" } });

    // Browser Back: the URL changes first, then the choice screen replaces the roster.
    window.history.pushState(null, "", "/school/SCH001?tab=holistic_mentorship");
    unmount();
    expect(window.location.search).toBe("?tab=holistic_mentorship");

    // Picking Program 78 opens its roster without Program 1's search.
    window.history.pushState(null, "", "/school/SCH001?tab=holistic_mentorship&program_id=78");
    render(<AdminSchoolRoster students={coverageStudents} schoolCode="SCH001" programId={78} />);
    expect(screen.getByRole("textbox", { name: "Search Students" })).toHaveValue("");
  });
});
