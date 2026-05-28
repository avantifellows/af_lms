import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/academic-year", () => ({
  getAcademicYearChoices: () => ["2026-2027", "2025-2026", "2024-2025"],
}));

import AcademicMentorshipAdmin from "./AcademicMentorshipAdmin";

const schools = [
  { code: "SCH001", name: "JNV Bhopal" },
  { code: "SCH002", name: "JNV Jaipur" },
];

describe("AcademicMentorshipAdmin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads mappings after a school is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        mappings: [
          {
            id: 10,
            mentor_name: "Anita Teacher",
            mentee_name: "Ravi Kumar",
            mentee_grade: 11,
            mentee_student_id: "STU-101",
            created_by: "admin@avantifellows.org",
            inserted_at: "2026-05-01T08:30:00Z",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AcademicMentorshipAdmin
        schools={schools}
        canView={true}
        canEdit={true}
        role="admin"
      />
    );

    expect(screen.getByText("Select a school to view mappings")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("School"), "SCH001");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/academic-mentorship?school_code=SCH001&academic_year=2026-2027",
        { cache: "no-store" }
      );
    });
    expect(await screen.findByText("Anita Teacher")).toBeInTheDocument();
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("STU-101")).toBeInTheDocument();
    expect(screen.getByText("admin@avantifellows.org")).toBeInTheDocument();
  });

  it("hides mutation placeholders and the Actions column for read-only users", () => {
    render(
      <AcademicMentorshipAdmin
        schools={schools}
        canView={true}
        canEdit={false}
        role="program_admin"
      />
    );

    expect(screen.getByLabelText("School")).toBeInTheDocument();
    expect(screen.getByLabelText("Academic Year")).toHaveValue("2026-2027");
    expect(screen.queryByLabelText("Mutation controls")).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("shows empty mutation placeholders and the Actions column for edit users", () => {
    render(
      <AcademicMentorshipAdmin
        schools={schools}
        canView={true}
        canEdit={true}
        role="admin"
      />
    );

    expect(screen.getByLabelText("Mutation controls")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("table-fixed");
  });

  it("shows empty state when the selected school has no mappings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ mappings: [] }),
      })
    );

    render(
      <AcademicMentorshipAdmin
        schools={schools}
        canView={true}
        canEdit={false}
        role="program_admin"
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("School"), "SCH002");

    expect(await screen.findByText("No mappings found")).toBeInTheDocument();
  });
});
