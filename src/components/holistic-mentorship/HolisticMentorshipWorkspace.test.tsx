import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import HolisticMentorshipWorkspace from "./HolisticMentorshipWorkspace";

describe("HolisticMentorshipWorkspace", () => {
  it("shows the Teacher assignment and Mentee empty workspaces", async () => {
    const user = userEvent.setup();
    render(<HolisticMentorshipWorkspace mode="teacher" />);

    expect(screen.getByRole("tab", { name: "Assign Students" })).toBeInTheDocument();
    expect(screen.getByText("No eligible Students to show yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "My Mentees" }));
    expect(screen.getByText("No Mentees assigned yet.")).toBeInTheDocument();
  });

  it("shows the Program-wide Admin progress and setup workspaces", async () => {
    const user = userEvent.setup();
    render(<HolisticMentorshipWorkspace mode="admin" />);

    expect(screen.getByRole("tab", { name: "Students & Progress" })).toBeInTheDocument();
    expect(screen.getByText("No mapped Students to show yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Phase Setup" }));
    expect(screen.getByText("No Holistic Phases configured yet.")).toBeInTheDocument();
  });
});
