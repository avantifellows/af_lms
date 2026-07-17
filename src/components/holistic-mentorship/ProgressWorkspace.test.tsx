import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProgressWorkspace from "./ProgressWorkspace";

const payload = {
  rows: [{
    studentId: 41, studentName: "Student One", externalStudentId: "AF-41", grade: 11,
    schoolName: "School One", schoolCode: "SCH001", mentorName: "Mentor One", mentorEmail: "mentor@example.com",
    phaseId: 70, phaseNumber: 2, phaseTitle: "Check-in", phaseState: "open", progress: "completed",
    completedAt: "2026-07-01", notesAuthor: "Mentor One", notesLastEditedAt: "2026-07-01", answers: [],
  }],
  counts: { totalMapped: 73, pending: 30, completed: 20, skipped: 18, noActivePhase: 5 },
  options: {
    schools: [{ code: "SCH001", name: "School One" }],
    mentors: [{ userId: 9, name: "Mentor One" }],
    phases: [{ id: 70, number: 2, title: "Check-in", grade: 11, state: "open" }],
  },
  pageSize: 50,
  refreshedAt: "2026-07-17T10:00:00.000Z",
};

describe("ProgressWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    })));
  });

  it("shows full-result counts, mapped rows, refresh time, and read-only drill-down", async () => {
    render(<ProgressWorkspace />);

    expect(await screen.findByText("Student One")).toBeInTheDocument();
    expect(screen.getByText("73")).toBeInTheDocument();
    expect(screen.getByText(/Last refreshed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Student One/ })).toHaveAttribute(
      "href", "/holistic-mentorship/students/41/phases/70?school_code=SCH001&academic_year=2026-2027"
    );
  });

  it("loads on filter change and manual Refresh without polling", async () => {
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.change(screen.getByLabelText("Filter by School"), { target: { value: "SCH001" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });

  it("clears year-specific selectors when the Academic Year changes", async () => {
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.change(screen.getByLabelText("Phase lens"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Filter by School"), { target: { value: "SCH001" } });
    fireEvent.change(screen.getByLabelText("Filter by Mentor"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Academic Year"), { target: { value: "2025-2026" } });

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      "/api/holistic-mentorship/progress?academic_year=2025-2026&page=1&sort=student_name&direction=asc",
      expect.anything()
    ));
  });

  it("reuses a queued regeneration request key for idempotent delivery retry", async () => {
    const requestKey = "d16e7d82-dc60-4b79-a064-9ed80badc119";
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input.includes("/profiles/41") && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, requestKey, state: "queued" })));
      }
      if (input.includes("/profiles/41")) {
        return Promise.resolve(new Response(JSON.stringify({
          summaries: [], regeneration: { requestKey, state: "queued", requestedAt: "2026-07-17T10:00:00.000Z" },
        })));
      }
      return Promise.resolve(new Response(JSON.stringify(payload)));
    }));

    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.click(screen.getByRole("button", { name: "Profile for Student One" }));
    await screen.findByText("Regeneration status:");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate Profile" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/holistic-mentorship/profiles/41",
      expect.objectContaining({ body: JSON.stringify({ request_key: requestKey, force: true }) })
    ));
  });
});
