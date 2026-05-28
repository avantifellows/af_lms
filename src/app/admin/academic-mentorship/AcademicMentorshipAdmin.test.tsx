import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(screen.queryByRole("button", { name: "Add Mapping" })).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("shows add mapping controls and the Actions column for edit users", () => {
    render(
      <AcademicMentorshipAdmin
        schools={schools}
        canView={true}
        canEdit={true}
        role="admin"
      />
    );

    expect(screen.getByLabelText("Mutation controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Mapping" })).toBeInTheDocument();
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

  it("adds a mapping, refreshes the table, and clears the inline form", async () => {
    let created = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/academic-mentorship?")) {
        return {
          ok: true,
          json: async () => ({
            mappings: created
              ? [
                  {
                    id: 99,
                    mentor_name: "Mentor One",
                    mentee_name: "Available Student",
                    mentee_grade: 12,
                    mentee_student_id: "STU-002",
                    created_by: "admin@avantifellows.org",
                    inserted_at: "2026-05-01T08:30:00Z",
                  },
                ]
              : [],
          }),
        };
      }
      if (url.startsWith("/api/academic-mentorship/eligible-mentors?")) {
        return {
          ok: true,
          json: async () => ({
            mentors: [
              { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
            ],
          }),
        };
      }
      if (url.startsWith("/api/academic-mentorship/unassigned-mentees?")) {
        return {
          ok: true,
          json: async () => ({
            students: [
              { id: 1002, name: "Available Student", grade: 12, student_id: "STU-002" },
            ],
          }),
        };
      }
      if (url === "/api/academic-mentorship" && init?.method === "POST") {
        created = true;
        return {
          ok: true,
          json: async () => ({ mapping: { id: 99 } }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
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

    await userEvent.selectOptions(screen.getByLabelText("School"), "SCH001");
    await screen.findByText("No mappings found");

    await userEvent.click(screen.getByRole("button", { name: "Add Mapping" }));
    await userEvent.selectOptions(await screen.findByLabelText("Mentor"), "mentor@avantifellows.org");
    await userEvent.selectOptions(screen.getByLabelText("Mentee"), "1002");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/academic-mentorship",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            school_code: "SCH001",
            mentor_email: "mentor@avantifellows.org",
            mentee_user_id: 1002,
            academic_year: "2026-2027",
          }),
        })
      );
    });
    expect(await screen.findByText("Mapping added")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mentor")).not.toBeInTheDocument();
    expect(await screen.findByText("Available Student")).toBeInTheDocument();
    expect(screen.getByText("Mentor One")).toBeInTheDocument();
  });

  it("shows the API duplicate-assignment error inline", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/academic-mentorship?")) {
        return { ok: true, json: async () => ({ mappings: [] }) };
      }
      if (url.startsWith("/api/academic-mentorship/eligible-mentors?")) {
        return {
          ok: true,
          json: async () => ({
            mentors: [
              { id: 21, email: "mentor@avantifellows.org", full_name: "Mentor One" },
            ],
          }),
        };
      }
      if (url.startsWith("/api/academic-mentorship/unassigned-mentees?")) {
        return {
          ok: true,
          json: async () => ({
            students: [
              { id: 1002, name: "Available Student", grade: 12, student_id: "STU-002" },
            ],
          }),
        };
      }
      if (url === "/api/academic-mentorship" && init?.method === "POST") {
        return {
          ok: false,
          json: async () => ({
            error: "This student already has an active mentor for this academic year",
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
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

    await userEvent.selectOptions(screen.getByLabelText("School"), "SCH001");
    await screen.findByText("No mappings found");
    await userEvent.click(screen.getByRole("button", { name: "Add Mapping" }));
    await userEvent.selectOptions(await screen.findByLabelText("Mentor"), "mentor@avantifellows.org");
    await userEvent.selectOptions(screen.getByLabelText("Mentee"), "1002");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("This student already has an active mentor for this academic year")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Mentor")).toBeInTheDocument();
  });
});
