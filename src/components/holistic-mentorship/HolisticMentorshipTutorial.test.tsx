import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import HolisticMentorshipTutorial from "./HolisticMentorshipTutorial";

describe("HolisticMentorshipTutorial", () => {
  it("moves through the Teacher guide and keeps the approved content", async () => {
    const user = userEvent.setup();
    render(<HolisticMentorshipTutorial audience="teacher" />);

    expect(screen.getByRole("heading", { name: "Open Holistic Mentorship" }))
      .toBeInTheDocument();
    expect(screen.getByRole("img", { name: /JNV Adilabad page/ })).toBeInTheDocument();
    expect(screen.getAllByTestId("screenshot-highlight")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /Assign students/ }));
    expect(screen.getByRole("heading", { name: "Assign students to yourself" }))
      .toBeInTheDocument();
    expect(screen.getByText("Student already has a mentor?")).toBeInTheDocument();
    expect(screen.getAllByTestId("screenshot-highlight")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /Prepare/ }));
    expect(screen.getByRole("heading", { name: "Review the student context and guidance" }))
      .toBeInTheDocument();
    expect(screen.getByText("No previous session notes available?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /shown side by side/ })).toBeInTheDocument();
    expect(screen.queryAllByTestId("screenshot-highlight")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Submit notes/ }));
    expect(screen.getByText("Before submission")).toBeInTheDocument();
    expect(screen.getByText("After submission")).toBeInTheDocument();
    expect(screen.getAllByTestId("screenshot-highlight")).toHaveLength(2);
  });

  it("shows the Admin-specific steps and help", async () => {
    const user = userEvent.setup();
    render(<HolisticMentorshipTutorial audience="admin" />);

    expect(screen.getByRole("heading", { name: "Open the Mentorship Admin workspace" }))
      .toBeInTheDocument();
    expect(screen.getAllByTestId("screenshot-highlight")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /Open phase/ }));
    expect(screen.getAllByTestId("screenshot-highlight")).toHaveLength(1);

    expect(screen.getByText("Phase cannot be edited")).toBeInTheDocument();
    expect(screen.getByText("Handle student information carefully")).toBeInTheDocument();
    expect(screen.queryByText("No Holistic Mentorship tab")).not.toBeInTheDocument();
  });
});
