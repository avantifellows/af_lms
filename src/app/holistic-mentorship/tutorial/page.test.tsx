import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockGuide } = vi.hoisted(() => ({
  mockGuide: vi.fn(({ audience }: { audience: string }) => <div>{audience} tutorial</div>),
}));
vi.mock("@/components/holistic-mentorship/HolisticMentorshipTutorial", () => ({
  default: mockGuide,
}));
vi.mock("@/components/PageHeader", () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import HolisticMentorshipTutorialPage from "./page";

describe("HolisticMentorshipTutorialPage", () => {
  it("shows the Teacher guide publicly when a School is provided", async () => {
    render(await HolisticMentorshipTutorialPage({
      searchParams: Promise.resolve({ school_code: "SCH001" }),
    }));

    expect(screen.getByRole("heading", { name: "Holistic Mentorship Teacher guide" }))
      .toBeInTheDocument();
    expect(screen.getByText("teacher tutorial")).toBeInTheDocument();
  });

  it("shows the Admin guide publicly by default", async () => {
    render(await HolisticMentorshipTutorialPage());

    expect(screen.getByRole("heading", { name: "Holistic Mentorship Admin guide" }))
      .toBeInTheDocument();
    expect(screen.getByText("admin tutorial")).toBeInTheDocument();
  });
});
