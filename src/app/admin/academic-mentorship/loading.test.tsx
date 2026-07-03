import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AcademicMentorshipLoading from "./loading";

describe("AcademicMentorshipLoading", () => {
  it("shows a route-level loading state", () => {
    render(<AcademicMentorshipLoading />);

    expect(screen.getByText("Academic Mentorship")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading mentorship mappings...");
  });
});
