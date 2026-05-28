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

  it("opens an unassign confirmation dialog with the selected mentor and mentee names", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/academic-mentorship?")) {
        return {
          ok: true,
          json: async () => ({
            mappings: [
              {
                id: 10,
                mentor_id: 21,
                mentor_name: "Anita Teacher",
                mentee_name: "Ravi Kumar",
                mentee_grade: 11,
                mentee_student_id: "STU-101",
                created_by: "admin@avantifellows.org",
                inserted_at: "2026-05-01T08:30:00Z",
              },
            ],
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
    await screen.findByText("Ravi Kumar");
    await userEvent.click(screen.getByRole("button", { name: "Unassign Ravi Kumar" }));

    expect(screen.getByRole("dialog", { name: "Unassign mentee" })).toBeInTheDocument();
    expect(screen.getByText("Unassign Ravi Kumar from Anita Teacher?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Unassign" })).toBeInTheDocument();
  });

  it("opens a reassign modal with eligible mentors excluding the current mentor", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/academic-mentorship?")) {
        return {
          ok: true,
          json: async () => ({
            mappings: [
              {
                id: 10,
                mentor_id: 21,
                mentor_name: "Anita Teacher",
                mentee_name: "Ravi Kumar",
                mentee_grade: 11,
                mentee_student_id: "STU-101",
                created_by: "admin@avantifellows.org",
                inserted_at: "2026-05-01T08:30:00Z",
              },
            ],
          }),
        };
      }
      if (url.startsWith("/api/academic-mentorship/eligible-mentors?")) {
        return {
          ok: true,
          json: async () => ({
            mentors: [
              { id: 21, email: "anita@avantifellows.org", full_name: "Anita Teacher" },
              { id: 22, email: "new@avantifellows.org", full_name: "New Mentor" },
            ],
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
    await screen.findByText("Ravi Kumar");
    await userEvent.click(screen.getByRole("button", { name: "Reassign Ravi Kumar" }));

    expect(await screen.findByRole("dialog", { name: "Reassign mentee" })).toBeInTheDocument();
    expect(screen.getByLabelText("New mentor")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Anita Teacher" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "New Mentor" })).toBeInTheDocument();
  });

  it("unassigns a mentee and refreshes the mapping table", async () => {
    let unassigned = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/academic-mentorship?")) {
        return {
          ok: true,
          json: async () => ({
            mappings: unassigned
              ? []
              : [
                  {
                    id: 10,
                    mentor_id: 21,
                    mentor_name: "Anita Teacher",
                    mentee_name: "Ravi Kumar",
                    mentee_grade: 11,
                    mentee_student_id: "STU-101",
                    created_by: "admin@avantifellows.org",
                    inserted_at: "2026-05-01T08:30:00Z",
                  },
                ],
          }),
        };
      }
      if (url === "/api/academic-mentorship/10?school_code=SCH001" && init?.method === "DELETE") {
        unassigned = true;
        return { ok: true, json: async () => ({ mapping: { id: 10 } }) };
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
    await screen.findByText("Ravi Kumar");
    await userEvent.click(screen.getByRole("button", { name: "Unassign Ravi Kumar" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Unassign" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/academic-mentorship/10?school_code=SCH001",
        { method: "DELETE" }
      );
    });
    expect(await screen.findByText("Mentee unassigned")).toBeInTheDocument();
    expect(await screen.findByText("No mappings found")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Unassign mentee" })).not.toBeInTheDocument();
  });

  it("shows an unassign API error inside the confirmation dialog", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/academic-mentorship?")) {
        return {
          ok: true,
          json: async () => ({
            mappings: [
              {
                id: 10,
                mentor_id: 21,
                mentor_name: "Anita Teacher",
                mentee_name: "Ravi Kumar",
                mentee_grade: 11,
                mentee_student_id: "STU-101",
                created_by: "admin@avantifellows.org",
                inserted_at: "2026-05-01T08:30:00Z",
              },
            ],
          }),
        };
      }
      if (url === "/api/academic-mentorship/10?school_code=SCH001" && init?.method === "DELETE") {
        return {
          ok: false,
          json: async () => ({ error: "Mapping already unassigned" }),
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
    await screen.findByText("Ravi Kumar");
    await userEvent.click(screen.getByRole("button", { name: "Unassign Ravi Kumar" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Unassign" }));

    expect(await screen.findByText("Mapping already unassigned")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Unassign mentee" })).toBeInTheDocument();
  });

  it("reassigns a mentee and refreshes the mapping table", async () => {
    let reassigned = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/academic-mentorship?")) {
        return {
          ok: true,
          json: async () => ({
            mappings: [
              {
                id: reassigned ? 11 : 10,
                mentor_id: reassigned ? 22 : 21,
                mentor_name: reassigned ? "New Mentor" : "Anita Teacher",
                mentee_name: "Ravi Kumar",
                mentee_grade: 11,
                mentee_student_id: "STU-101",
                created_by: "admin@avantifellows.org",
                inserted_at: "2026-05-01T08:30:00Z",
              },
            ],
          }),
        };
      }
      if (url.startsWith("/api/academic-mentorship/eligible-mentors?")) {
        return {
          ok: true,
          json: async () => ({
            mentors: [
              { id: 21, email: "anita@avantifellows.org", full_name: "Anita Teacher" },
              { id: 22, email: "new@avantifellows.org", full_name: "New Mentor" },
            ],
          }),
        };
      }
      if (url === "/api/academic-mentorship/reassign" && init?.method === "POST") {
        reassigned = true;
        return { ok: true, json: async () => ({ mapping: { id: 11 } }) };
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
    await screen.findByText("Anita Teacher");
    await userEvent.click(screen.getByRole("button", { name: "Reassign Ravi Kumar" }));
    await userEvent.selectOptions(await screen.findByLabelText("New mentor"), "new@avantifellows.org");
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/academic-mentorship/reassign",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            school_code: "SCH001",
            old_mapping_id: 10,
            new_mentor_email: "new@avantifellows.org",
          }),
        })
      );
    });
    expect(await screen.findByText("Mapping reassigned")).toBeInTheDocument();
    expect(await screen.findByText("New Mentor")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Reassign mentee" })).not.toBeInTheDocument();
  });

  it("shows a reassign API conflict inside the modal", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/academic-mentorship?")) {
        return {
          ok: true,
          json: async () => ({
            mappings: [
              {
                id: 10,
                mentor_id: 21,
                mentor_name: "Anita Teacher",
                mentee_name: "Ravi Kumar",
                mentee_grade: 11,
                mentee_student_id: "STU-101",
                created_by: "admin@avantifellows.org",
                inserted_at: "2026-05-01T08:30:00Z",
              },
            ],
          }),
        };
      }
      if (url.startsWith("/api/academic-mentorship/eligible-mentors?")) {
        return {
          ok: true,
          json: async () => ({
            mentors: [
              { id: 21, email: "anita@avantifellows.org", full_name: "Anita Teacher" },
              { id: 22, email: "new@avantifellows.org", full_name: "New Mentor" },
            ],
          }),
        };
      }
      if (url === "/api/academic-mentorship/reassign" && init?.method === "POST") {
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
    await screen.findByText("Anita Teacher");
    await userEvent.click(screen.getByRole("button", { name: "Reassign Ravi Kumar" }));
    await userEvent.selectOptions(await screen.findByLabelText("New mentor"), "new@avantifellows.org");
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));

    expect(
      await screen.findByText("This student already has an active mentor for this academic year")
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Reassign mentee" })).toBeInTheDocument();
  });
});
