import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import AcademicMentorshipTab from "./AcademicMentorshipTab";

const mockAcademicYear = "2026-2027";

vi.mock("@/lib/academic-year", () => ({
  getCurrentAcademicYear: () => mockAcademicYear,
}));

function successFetch(body: unknown) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response)
  ) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AcademicMentorshipTab", () => {
  it("shows loading state initially", () => {
    const pendingFetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    vi.stubGlobal("fetch", pendingFetch);

    render(
      <AcademicMentorshipTab
        schoolCode="70705"
        canView
        canEdit={false}
        role="teacher"
      />
    );

    expect(screen.getByText("Loading academic mentorship...")).toBeInTheDocument();
  });

  it("renders teacher view as a flat mentee list with disabled coming soon actions", async () => {
    const mockFetch = successFetch({
      mappings: [
        {
          id: 1,
          mentor_id: 42,
          mentor_name: "Anjali Teacher",
          mentor_email: "teacher@avantifellows.org",
          mentee_id: 1001,
          mentee_name: "Riya Shah",
          mentee_grade: 11,
          mentee_student_id: "STU001",
          academic_year: mockAcademicYear,
          created_by: "admin@avantifellows.org",
          inserted_at: "2026-05-01T00:00:00Z",
        },
      ],
    });
    vi.stubGlobal("fetch", mockFetch);

    render(
      <AcademicMentorshipTab
        schoolCode="70705"
        canView
        canEdit={false}
        role="teacher"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Riya Shah")).toBeInTheDocument();
    });

    expect(screen.getByText("Grade 11")).toBeInTheDocument();
    expect(screen.getByText("STU001")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Coming Soon" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Detailed view coming in a future release");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/academic-mentorship?school_code=70705&academic_year=2026-2027"
    );
  });

  it("renders non-teacher views grouped by mentor", async () => {
    vi.stubGlobal(
      "fetch",
      successFetch({
        mappings: [
          {
            id: 1,
            mentor_id: 42,
            mentor_name: "Anjali Teacher",
            mentor_email: "teacher@avantifellows.org",
            mentee_id: 1001,
            mentee_name: "Riya Shah",
            mentee_grade: 11,
            mentee_student_id: "STU001",
            academic_year: mockAcademicYear,
            created_by: "admin@avantifellows.org",
            inserted_at: "2026-05-01T00:00:00Z",
          },
          {
            id: 2,
            mentor_id: 42,
            mentor_name: "Anjali Teacher",
            mentor_email: "teacher@avantifellows.org",
            mentee_id: 1002,
            mentee_name: "Kabir Singh",
            mentee_grade: 12,
            mentee_student_id: "STU002",
            academic_year: mockAcademicYear,
            created_by: "admin@avantifellows.org",
            inserted_at: "2026-05-01T00:00:00Z",
          },
        ],
      })
    );

    render(
      <AcademicMentorshipTab
        schoolCode="70705"
        canView
        canEdit
        role="admin"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Anjali Teacher")).toBeInTheDocument();
    });

    expect(screen.getByText("teacher@avantifellows.org")).toBeInTheDocument();
    expect(screen.getByText("Riya Shah")).toBeInTheDocument();
    expect(screen.getByText("Kabir Singh")).toBeInTheDocument();
  });

  it("shows empty state with academic year", async () => {
    vi.stubGlobal("fetch", successFetch({ mappings: [] }));

    render(
      <AcademicMentorshipTab
        schoolCode="70705"
        canView
        canEdit={false}
        role="program_manager"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No mentees assigned for 2026-2027")).toBeInTheDocument();
    });
  });

  it("shows an error state on API failure", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 502 } as Response)
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", mockFetch);

    render(
      <AcademicMentorshipTab
        schoolCode="70705"
        canView
        canEdit={false}
        role="program_manager"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to load academic mentorship data")).toBeInTheDocument();
    });
  });
});
