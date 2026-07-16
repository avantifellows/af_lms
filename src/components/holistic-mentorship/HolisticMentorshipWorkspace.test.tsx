import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import HolisticMentorshipWorkspace from "./HolisticMentorshipWorkspace";

describe("HolisticMentorshipWorkspace", () => {
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
    sessionStorage.clear();
  });

  it("shows the Program-wide Admin progress and setup workspaces", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: null }) }));
    const user = userEvent.setup();
    render(<HolisticMentorshipWorkspace mode="admin" />);

    expect(screen.getByRole("tab", { name: "Students & Progress" })).toBeInTheDocument();
    expect(screen.getByText("No mapped Students to show yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Phase Setup" }));
    expect(await screen.findByRole("button", { name: "Create blank Plan" })).toBeInTheDocument();
  });
});
