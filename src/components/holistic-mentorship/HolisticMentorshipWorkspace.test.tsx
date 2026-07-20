import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import HolisticMentorshipWorkspace from "./HolisticMentorshipWorkspace";

describe("HolisticMentorshipWorkspace", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the Teacher assignment and Mentee empty workspaces", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ students: [], actorUserId: 9 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<HolisticMentorshipWorkspace mode="teacher" schoolCode="SCH001" />);

    expect(screen.getByRole("tab", { name: "Assign Students" })).toBeInTheDocument();
    expect(await screen.findByText("No eligible Students to show yet.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/holistic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027&search=",
      { signal: expect.any(AbortSignal) }
    );

    await user.click(screen.getByRole("tab", { name: "My Mentees" }));
    expect(screen.getByText("No Mentees assigned yet.")).toBeInTheDocument();
  });

  it("restores the Teacher's last Mapping subview", async () => {
    sessionStorage.setItem("holistic-mappings-view:SCH001", "mentees");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ students: [], actorUserId: 9 }),
    }));

    render(<HolisticMentorshipWorkspace mode="teacher" schoolCode="SCH001" />);

    expect(screen.getByRole("tab", { name: "My Mentees" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(await screen.findByText("No Mentees assigned yet.")).toBeInTheDocument();
  });

  it("links the workspace tabs to their panel and supports the full keyboard pattern", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ students: [], actorUserId: 9 }),
    }));
    const user = userEvent.setup();
    render(<HolisticMentorshipWorkspace mode="teacher" schoolCode="SCH001" />);

    const tablist = screen.getByRole("tablist", { name: "Holistic Mentorship sections" });
    const assign = screen.getByRole("tab", { name: "Assign Students" });
    const mentees = screen.getByRole("tab", { name: "My Mentees" });
    const panel = screen.getByRole("tabpanel", { name: "Assign Students" });
    expect(tablist).toContainElement(assign);
    expect(assign).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", assign.id);
    expect(assign).toHaveAttribute("tabindex", "0");
    expect(mentees).toHaveAttribute("tabindex", "-1");

    assign.focus();
    await user.keyboard("{ArrowRight}");
    expect(mentees).toHaveFocus();
    expect(mentees).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "My Mentees" })).toBe(panel);

    await user.keyboard("{ArrowRight}");
    expect(assign).toHaveFocus();
    await user.keyboard("{End}");
    expect(mentees).toHaveFocus();
    await user.keyboard("{Home}");
    expect(assign).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(mentees).toHaveFocus();
    expect(sessionStorage.getItem("holistic-mappings-view:SCH001")).toBe("mentees");
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

    expect(screen.getByRole("tab", { name: "Students & Progress" })).toBeInTheDocument();
    expect(await screen.findByText("No mapped Students exist for this Academic Year.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Phase Setup" }));
    expect(await screen.findByRole("button", { name: "Start blank" })).toBeInTheDocument();
    expect(screen.getByLabelText("Program")).toBeDisabled();
    expect(screen.getByLabelText("Academic Year")).toHaveValue("2026-2027");
  });
});
