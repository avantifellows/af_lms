import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AdminSchoolRoster from "./AdminSchoolRoster";

const students = [
  {
    studentId: 41,
    name: "Asha Rao",
    externalStudentId: "S41",
    grade: 11,
    activePhaseId: 73,
    activeNotesState: "draft" as const,
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
  it("shows read-only School coverage and links assigned Students back to the School source", () => {
    render(<AdminSchoolRoster students={students} schoolCode="SCH001" />);

    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Anita Mentor")).toBeInTheDocument();
    const table = within(screen.getByRole("region", { name: "School mentorship coverage" }));
    expect(table.getByText("Unassigned")).toBeInTheDocument();
    expect(table.getByText("Not assigned")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Asha Rao" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/73?school_code=SCH001&academic_year=2026-2027&source=school"
    );
    expect(screen.queryByRole("link", { name: "Open Ravi Shah" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
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
});
