import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import HolisticMentorshipWorkspace from "./HolisticMentorshipWorkspace";

describe("HolisticMentorshipWorkspace", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/admin/holistic-mentorship");
  });

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
        rows: [], counts: { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
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
        rows: [], counts: { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
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
    expect(await screen.findByText("No assigned Students exist for this Academic Year.")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "2026-2027" })).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "2025-2026" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Phase Setup" }));
    expect(await screen.findByRole("button", { name: "Start blank" })).toBeInTheDocument();
    expect(screen.getByLabelText("Program")).toBeEnabled();
    expect(screen.getByLabelText("Program")).toHaveValue("1");
    expect(screen.getByLabelText("Academic Year")).toHaveValue("2026-2027");
  });

  it("keeps Phase Setup visible without mutation controls for a read-only program-wide Admin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url.includes("/progress?") ? {
        rows: [], counts: { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [], mentors: [], phases: [] }, pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-07-17T10:00:00.000Z",
      } : { plan: null },
    })));
    const user = userEvent.setup();

    render(<HolisticMentorshipWorkspace
      mode="admin"
      canEdit={false}
      canViewPhaseSetup
    />);

    await user.click(screen.getByRole("tab", { name: "Phase Setup" }));

    expect(await screen.findByRole("region", { name: "Phase Setup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start blank" })).not.toBeInTheDocument();
  });

  it("loads EMRS data after the Admin selects Program 78", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [],
        counts: { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [], mentors: [], phases: [] },
        pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-07-17T10:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const view = render(<HolisticMentorshipWorkspace mode="admin" />);

    await user.selectOptions(screen.getByLabelText("Program"), "78");
    view.rerender(<HolisticMentorshipWorkspace mode="admin" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("program_id=78"),
      expect.anything()
    ));
    expect(screen.getByLabelText("Program")).toHaveValue("78");
    expect(window.location.pathname + window.location.search).toBe(
      "/admin/holistic-mentorship?program_id=78",
    );
  });

  it("replaces the URL while preserving unrelated query parameters and the hash", async () => {
    window.history.replaceState(
      null,
      "",
      "/admin/holistic-mentorship?view=compact&program_id=1#coverage",
    );
    const replaceState = vi.spyOn(window.history, "replaceState");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [],
        counts: { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [], mentors: [], phases: [] },
        pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-07-17T10:00:00.000Z",
      }),
    }));
    const user = userEvent.setup();
    const historyLength = window.history.length;
    render(<HolisticMentorshipWorkspace mode="admin" availableProgramIds={[1, 78]} />);

    await user.selectOptions(screen.getByLabelText("Program"), "78");

    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/admin/holistic-mentorship?view=compact&program_id=78#coverage",
    );
    expect(window.history.length).toBe(historyLength);
  });

  it("restores a validated Program from the URL after remounting", async () => {
    window.history.replaceState(null, "", "/admin/holistic-mentorship?program_id=94");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [],
        counts: { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [], mentors: [], phases: [] },
        pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-07-17T10:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<HolisticMentorshipWorkspace
      mode="admin"
      initialProgramId={1}
      availableProgramIds={[1, 94]}
    />);
    expect(screen.getByLabelText("Program")).toHaveValue("94");
    first.unmount();

    render(<HolisticMentorshipWorkspace
      mode="admin"
      initialProgramId={1}
      availableProgramIds={[1, 94]}
    />);
    expect(screen.getByLabelText("Program")).toHaveValue("94");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("program_id=94"),
      expect.anything(),
    ));
  });

  it.each([
    { query: "program_id=94&program_id=1", available: [1, 94], initial: 1 },
    { query: "program_id=94&program_id=94", available: [1, 94], initial: 1 },
    { query: "program_id=999", available: [1, 94], initial: 1 },
    { query: "program_id=invalid", available: [1, 94], initial: 1 },
    { query: "program_id=94", available: [78], initial: 78 },
  ])("uses the permitted fallback for $query with available $available", async ({ query, available, initial }) => {
    window.history.replaceState(null, "", `/admin/holistic-mentorship?${query}`);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [],
        counts: { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        options: { schools: [], mentors: [], phases: [] },
        pageSize: 50,
        academicYears: ["2026-2027"],
        refreshedAt: "2026-09-17T10:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HolisticMentorshipWorkspace
      mode="admin" initialProgramId={initial} availableProgramIds={available}
    />);

    expect(screen.getByLabelText("Program")).toHaveValue(String(initial));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`program_id=${initial}`), expect.anything(),
    ));
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
        counts: { total: 1, pending: 1, completed: 0, skipped: 0, noActivePhase: 0 },
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
      "/holistic-mentorship/students/41/phases/70?school_code=SCH001&academic_year=2026-2027&program_id=78&source=progress",
    );
  });
});
