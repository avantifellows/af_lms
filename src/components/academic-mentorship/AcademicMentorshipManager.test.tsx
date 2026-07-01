import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AcademicMentorshipManager from "./AcademicMentorshipManager";

const activeGroup = {
  mentor: { userId: 101, name: "Anita Mentor", email: "anita@avantifellows.org" },
  menteeCount: 2,
  mappings: [
    {
      id: 7,
      mentee: {
        studentPkId: 201,
        name: "Meena Student",
        studentId: "STU001",
        grade: 11,
        programId: 64,
      },
      assignedDate: "2026-07-01",
      endedDate: null,
      status: "active" as const,
    },
    {
      id: 8,
      mentee: {
        studentPkId: 202,
        name: "Ravi Student",
        studentId: "STU002",
        grade: 12,
        programId: 64,
      },
      assignedDate: "2026-06-01",
      endedDate: "2026-06-30",
      status: "historical" as const,
    },
  ],
};

const baseProps = {
  schoolCode: "SCH001",
  academicYear: "2026-2027",
  programId: null,
  includeHistory: true,
  canUpload: true,
  initialGroups: [activeGroup],
};

describe("AcademicMentorshipManager", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides mutation controls in view-only mode and for historical rows", () => {
    render(<AcademicMentorshipManager {...baseProps} canEdit={false} canUpload={false} />);

    expect(screen.queryByRole("button", { name: "Add Mapping" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reassign" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.getByText("Meena Student")).toBeInTheDocument();
    expect(screen.getByText("Ravi Student")).toBeInTheDocument();
  });

  it("syncs displayed mappings when server props change", async () => {
    const nextGroup = {
      mentor: { userId: 102, name: "New Mentor", email: "new@avantifellows.org" },
      menteeCount: 1,
      mappings: [
        {
          id: 9,
          mentee: {
            studentPkId: 203,
            name: "Fresh Student",
            studentId: "STU003",
            grade: 11,
            programId: 64,
          },
          assignedDate: "2026-07-02",
          endedDate: null,
          status: "active" as const,
        },
      ],
    };
    const { rerender } = render(
      <AcademicMentorshipManager {...baseProps} canEdit={false} canUpload={false} />
    );

    rerender(
      <AcademicMentorshipManager
        {...baseProps}
        includeHistory={false}
        initialGroups={[nextGroup]}
        canEdit={false}
        canUpload={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Fresh Student")).toBeInTheDocument();
      expect(screen.queryByText("Ravi Student")).not.toBeInTheDocument();
    });
  });

  it("adds a Mapping and refreshes the table", async () => {
    const user = userEvent.setup();
    const refreshedGroup = {
      mentor: activeGroup.mentor,
      menteeCount: 1,
      mappings: [
        {
          id: 9,
          mentee: {
            studentPkId: 203,
            name: "Fresh Student",
            studentId: "STU003",
            grade: 11,
            programId: 64,
          },
          assignedDate: "2026-07-02",
          endedDate: null,
          status: "active" as const,
        },
      ],
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("type=mentors")) {
        return Promise.resolve(
          Response.json({
            options: [{ userId: 101, name: "Anita Mentor", email: "anita@avantifellows.org" }],
          })
        );
      }
      if (url.includes("type=mentees")) {
        return Promise.resolve(
          Response.json({
            options: [{ studentPkId: 203, name: "Fresh Student", studentId: "STU003", grade: 11 }],
          })
        );
      }
      if (init?.method === "POST") {
        return Promise.resolve(Response.json({ success: true, mappingId: 9 }, { status: 201 }));
      }
      return Promise.resolve(Response.json({ groups: [refreshedGroup] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<AcademicMentorshipManager {...baseProps} canEdit />);

    await user.click(screen.getByRole("button", { name: "Add Mapping" }));
    const mentorInput = screen.getByLabelText("Academic Mentor");
    await user.type(mentorInput, "Anita");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("type=mentors"))
    );
    await user.clear(mentorInput);
    await user.type(mentorInput, "Anita Mentor (anita@avantifellows.org)");
    const menteeInput = screen.getByLabelText("Mentee");
    await user.type(menteeInput, "STU");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("type=mentees"))
    );
    await user.clear(menteeInput);
    await user.type(menteeInput, "Fresh Student (STU003)");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/academic-mentorship/mappings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mentor_user_id: 101,
          student_id: 203,
        }),
      })
    );
    expect(await screen.findByText("Mapping added.")).toBeInTheDocument();
    expect(await screen.findByText("Fresh Student")).toBeInTheDocument();
  });

  it("shows concurrent Mapping conflicts and still refreshes the table", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("type=mentors")) {
        return Promise.resolve(
          Response.json({
            options: [{ userId: 101, name: "Anita Mentor", email: "anita@avantifellows.org" }],
          })
        );
      }
      if (url.includes("type=mentees")) {
        return Promise.resolve(
          Response.json({
            options: [{ studentPkId: 201, name: "Meena Student", studentId: "STU001", grade: 11 }],
          })
        );
      }
      if (init?.method === "POST") {
        return Promise.resolve(
          Response.json({ error: "Student already has a mentor mapped" }, { status: 409 })
        );
      }
      return Promise.resolve(Response.json({ groups: [activeGroup] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<AcademicMentorshipManager {...baseProps} canEdit />);

    await user.click(screen.getByRole("button", { name: "Add Mapping" }));
    const mentorInput = screen.getByLabelText("Academic Mentor");
    await user.type(mentorInput, "Anita");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("type=mentors"))
    );
    await user.clear(mentorInput);
    await user.type(mentorInput, "Anita Mentor (anita@avantifellows.org)");
    const menteeInput = screen.getByLabelText("Mentee");
    await user.type(menteeInput, "STU");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("type=mentees"))
    );
    await user.clear(menteeInput);
    await user.type(menteeInput, "Meena Student (STU001)");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText("Student already has a mentor mapped")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/academic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027&include_history=true"
    );
  });

  it("confirms removal, ends active rows only, and refreshes the table", async () => {
    const user = userEvent.setup();
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(Response.json({ success: true, mappingId: 7 }));
      }
      return Promise.resolve(Response.json({ groups: [] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<AcademicMentorshipManager {...baseProps} canEdit />);

    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(confirmMock).toHaveBeenCalledWith(
      "This Student will no longer have an active Academic Mentor."
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/academic-mentorship/mappings",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
        }),
      })
    );
    expect(await screen.findByText("Mapping removed.")).toBeInTheDocument();
    expect(screen.getByText("No Academic Mentor-Mentee Mappings found.")).toBeInTheDocument();
  });

  it("reassigns active rows and excludes the current Academic Mentor", async () => {
    const user = userEvent.setup();
    const reassignedGroup = {
      mentor: { userId: 102, name: "New Mentor", email: "new@avantifellows.org" },
      menteeCount: 1,
      mappings: [
        {
          id: 9,
          mentee: activeGroup.mappings[0].mentee,
          assignedDate: "2026-07-03",
          endedDate: null,
          status: "active" as const,
        },
      ],
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("type=mentors")) {
        return Promise.resolve(
          Response.json({
            options: [
              { userId: 101, name: "Anita Mentor", email: "anita@avantifellows.org" },
              { userId: 102, name: "New Mentor", email: "new@avantifellows.org" },
            ],
          })
        );
      }
      if (init?.method === "PATCH") {
        return Promise.resolve(Response.json({ success: true, mappingId: 9 }));
      }
      return Promise.resolve(Response.json({ groups: [reassignedGroup] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<AcademicMentorshipManager {...baseProps} canEdit />);

    expect(screen.getAllByRole("button", { name: "Reassign" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Reassign" }));
    const replacementInput = screen.getByLabelText("Replacement Academic Mentor");
    await user.type(replacementInput, "Mentor");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("type=mentors"))
    );
    expect(
      document.querySelector('option[value="Anita Mentor (anita@avantifellows.org)"]')
    ).toBeNull();
    await user.clear(replacementInput);
    await user.type(replacementInput, "New Mentor (new@avantifellows.org)");
    await user.click(screen.getByRole("button", { name: "Confirm Reassign" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/academic-mentorship/mappings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
          mentor_user_id: 102,
        }),
      })
    );
    expect(await screen.findByText("Mapping reassigned.")).toBeInTheDocument();
    expect(await screen.findByText("New Mentor")).toBeInTheDocument();
  });

  it("shows reassignment conflicts and still refreshes the table", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("type=mentors")) {
        return Promise.resolve(
          Response.json({
            options: [{ userId: 102, name: "New Mentor", email: "new@avantifellows.org" }],
          })
        );
      }
      if (init?.method === "PATCH") {
        return Promise.resolve(
          Response.json({ error: "Student already has a mentor mapped" }, { status: 409 })
        );
      }
      return Promise.resolve(Response.json({ groups: [activeGroup] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<AcademicMentorshipManager {...baseProps} canEdit />);

    await user.click(screen.getByRole("button", { name: "Reassign" }));
    const replacementInput = screen.getByLabelText("Replacement Academic Mentor");
    await user.type(replacementInput, "New");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("type=mentors"))
    );
    await user.clear(replacementInput);
    await user.type(replacementInput, "New Mentor (new@avantifellows.org)");
    await user.click(screen.getByRole("button", { name: "Confirm Reassign" }));

    expect(await screen.findByText("Student already has a mentor mapped")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/academic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027&include_history=true"
    );
  });

  it("shows a CSV template link and refreshes after a successful upload", async () => {
    const user = userEvent.setup();
    const refreshedGroup = {
      mentor: { userId: 103, name: "CSV Mentor", email: "csv@avantifellows.org" },
      menteeCount: 1,
      mappings: [
        {
          id: 31,
          mentee: {
            studentPkId: 301,
            name: "CSV Student",
            studentId: "CSV001",
            grade: 11,
            programId: 64,
          },
          assignedDate: "2026-07-04",
          endedDate: null,
          status: "active" as const,
        },
      ],
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/academic-mentorship/mappings/import") {
        return Promise.resolve(
          Response.json({ success: true, insertedCount: 2 }, { status: 201 })
        );
      }
      return Promise.resolve(Response.json({ groups: [refreshedGroup] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<AcademicMentorshipManager {...baseProps} canEdit />);

    expect(screen.getByRole("link", { name: "Template" })).toHaveAttribute(
      "href",
      "/api/academic-mentorship/mappings/import?school_code=SCH001&academic_year=2026-2027"
    );
    await user.click(screen.getByRole("button", { name: "Upload CSV" }));
    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["mentor_email,student_id\ncsv@x,CSV001\n"], "mappings.csv", {
        type: "text/csv",
      })
    );
    await user.click(screen.getAllByRole("button", { name: "Upload CSV" }).at(-1)!);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/academic-mentorship/mappings/import",
      expect.objectContaining({ method: "POST" })
    );
    const uploadBody = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(uploadBody.get("school_code")).toBe("SCH001");
    expect(uploadBody.get("academic_year")).toBe("2026-2027");
    expect(uploadBody.get("file")).toBeInstanceOf(File);
    expect(await screen.findByText("Imported 2 mappings.")).toBeInTheDocument();
    expect(await screen.findByText("CSV Student")).toBeInTheDocument();
  });

  it("shows upload row errors and exposes an error CSV download", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/academic-mentorship/mappings/import") {
        return Promise.resolve(
          Response.json(
            {
              error: "CSV upload has row errors",
              errors: [{ rowNumber: 2, field: "student_id", error: "student_id is required" }],
              errorCsv: "mentor_email,student_id,error_reason\nanita@x,,student_id is required\n",
            },
            { status: 422 }
          )
        );
      }
      return Promise.resolve(Response.json({ groups: [activeGroup] }));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<AcademicMentorshipManager {...baseProps} canEdit />);

    await user.click(screen.getByRole("button", { name: "Upload CSV" }));
    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["mentor_email,student_id\nanita@x,\n"], "mappings.csv", {
        type: "text/csv",
      })
    );
    await user.click(screen.getAllByRole("button", { name: "Upload CSV" }).at(-1)!);

    expect(await screen.findByText("CSV upload has row errors")).toBeInTheDocument();
    expect(screen.getByText("Upload failed. 0 rows were saved.")).toBeInTheDocument();
    expect(screen.getByText("student_id")).toBeInTheDocument();
    expect(screen.getByText("student_id is required")).toBeInTheDocument();
    const errorLink = await screen.findByRole("link", { name: "Download error CSV" });
    expect(errorLink).toHaveAttribute(
      "download",
      "academic-mentorship-import-errors.csv"
    );
    expect(errorLink.getAttribute("href")).toContain("student_id%20is%20required");
  });
});
