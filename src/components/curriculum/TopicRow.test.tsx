import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TopicRow from "./TopicRow";
import type { Topic } from "@/types/curriculum";

const baseTopic: Topic = {
  id: 1,
  code: "PHY-11-01-01",
  name: "Newton's Laws of Motion",
  chapterId: 10,
};

describe("TopicRow", () => {
  it("renders topic name and code", () => {
    render(<TopicRow topic={baseTopic} isCompleted={false} />);

    expect(screen.getByText("Newton's Laws of Motion")).toBeInTheDocument();
    expect(screen.getByText("PHY-11-01-01")).toBeInTheDocument();
  });

  it("renders uncompleted style when isCompleted is false", () => {
    const { container } = render(
      <TopicRow topic={baseTopic} isCompleted={false} />
    );

    // Checkbox span has uncompleted border style
    const checkbox = container.querySelector("span.border-gray-300");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox?.classList.contains("bg-white")).toBe(true);

    // No checkmark SVG rendered
    expect(container.querySelector("svg")).toBeNull();

    // Topic name has darker text
    expect(screen.getByText("Newton's Laws of Motion").className).toContain(
      "text-gray-700"
    );
  });

  it("renders completed style when isCompleted is true", () => {
    const { container } = render(
      <TopicRow topic={baseTopic} isCompleted={true} />
    );

    // Checkbox span has completed green style
    const checkbox = container.querySelector("span.bg-green-500");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox?.classList.contains("border-green-500")).toBe(true);
    expect(checkbox?.classList.contains("text-white")).toBe(true);

    // Checkmark SVG is rendered
    expect(container.querySelector("svg")).toBeInTheDocument();

    // Topic name has muted text
    expect(screen.getByText("Newton's Laws of Motion").className).toContain(
      "text-gray-500"
    );
  });
});
