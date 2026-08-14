import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import HolisticMentorshipWorkspace from "./HolisticMentorshipWorkspace";

describe("HolisticMentorshipWorkspace", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the single-page Teacher workspace with assignment and Mentee sections", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ students: [], actorUserId: 9 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<HolisticMentorshipWorkspace mode="teacher" schoolCode="SCH001" />);

    expect(screen.getByRole("heading", { name: "Holistic Mentorship" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(await screen.findByText("No eligible Students at this School")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/holistic-mentorship/mappings?school_code=SCH001&program_id=1&academic_year=2026-2027&search=",
      { signal: expect.any(AbortSignal) }
    );

    expect(screen.getByText("Assign Students")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My Mentees" })).toBeInTheDocument();
    expect(screen.getByText("No Mentees assigned")).toBeInTheDocument();
    expect(screen.getByText("2026-2027")).toBeInTheDocument();
  });

  it("links the Admin workspace tabs to their panel and supports the full keyboard pattern", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url.includes("/progress?") ? {
        rows: [], counts: { totalMapped: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [], mentors: [], phases: [] }, pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-07-17T10:00:00.000Z",
      } : { plan: null },
    })));
    const user = userEvent.setup();
    render(<HolisticMentorshipWorkspace mode="admin" />);

    const tablist = screen.getByRole("tablist", { name: "Holistic Mentorship sections" });
    const progress = screen.getByRole("tab", { name: "Students & Progress" });
    const phases = screen.getByRole("tab", { name: "Phase Setup" });
    const panel = screen.getByRole("tabpanel", { name: "Students & Progress" });
    expect(tablist).toContainElement(progress);
    expect(progress).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", progress.id);
    expect(progress).toHaveAttribute("tabindex", "0");
    expect(phases).toHaveAttribute("tabindex", "-1");

    progress.focus();
    await user.keyboard("{ArrowRight}");
    expect(phases).toHaveFocus();
    expect(phases).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Phase Setup" })).toBe(panel);

    await user.keyboard("{ArrowRight}");
    expect(progress).toHaveFocus();
    await user.keyboard("{End}");
    expect(phases).toHaveFocus();
    await user.keyboard("{Home}");
    expect(progress).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(phases).toHaveFocus();
  });

  it("shows the Program-wide Admin progress and setup workspaces", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url.includes("/progress?") ? {
        rows: [], counts: { totalMapped: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [], mentors: [], phases: [] }, pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-07-17T10:00:00.000Z",
      } : { plan: null },
    })));
    const user = userEvent.setup();
    render(<HolisticMentorshipWorkspace mode="admin" />);

    expect(screen.getByRole("link", { name: "View tutorial" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/tutorial",
    );
    expect(screen.getByRole("tab", { name: "Students & Progress" })).toBeInTheDocument();
    expect(await screen.findByText("No mapped Students exist for this Academic Year.")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "2026-2027" })).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "2025-2026" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Phase Setup" }));
    expect(await screen.findByRole("button", { name: "Start blank" })).toBeInTheDocument();
    expect(screen.getByLabelText("Program")).toBeEnabled();
    expect(screen.getByLabelText("Program")).toHaveValue("1");
    expect(screen.getByLabelText("Academic Year")).toHaveValue("2026-2027");
  });

  it("loads EMRS data after the Admin selects Program 78", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [],
        counts: { totalMapped: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [], mentors: [], phases: [] },
        pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-07-17T10:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<HolisticMentorshipWorkspace mode="admin" />);

    await user.selectOptions(screen.getByLabelText("Program"), "78");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("program_id=78"),
      expect.anything()
    ));
    expect(screen.getByLabelText("Program")).toHaveValue("78");
  });

  it("renders scoped Program Manager and Program Admin workspaces with read-only Student detail links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [{
          studentId: 41, studentName: "Student One", externalStudentId: "AF-41", grade: 11,
          schoolName: "School One", schoolCode: "SCH001", mentorName: "Mentor One",
          mentorEmail: "mentor@example.com", phaseId: 70, phaseNumber: 1,
          phaseTitle: "Check-in", phaseState: "active", progress: "pending",
          completedAt: null, notesAuthor: null, notesAuthorEmail: null,
          notesLastEditedAt: null, answers: [],
        }],
        counts: { totalMapped: 1, pending: 1, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [{ code: "SCH001", name: "School One" }], mentors: [], phases: [] },
        pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-07-17T10:00:00.000Z",
      }),
    }));

    render(<HolisticMentorshipWorkspace
      mode="admin"
      canEdit={false}
      initialProgramId={78}
      availableProgramIds={[78]}
    />);

    expect(await screen.findByText("Student One")).toBeInTheDocument();
    expect(screen.getByLabelText("Program")).toHaveValue("78");
    expect(screen.getAllByRole("option", { name: "78 - EMRS CoE" })).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Phase Setup" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Student One" })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/70?school_code=SCH001&academic_year=2026-2027&program_id=78",
    );
  });
});
