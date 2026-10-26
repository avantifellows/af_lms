import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders the accent variant as brand red text on a brand-red tint, not on a green fill", () => {
    render(<Badge variant="accent">Draft ready to review</Badge>);

    const badge = screen.getByText("Draft ready to review");
    expect(badge).toHaveClass("bg-hover-bg", "text-accent");
    expect(badge).not.toHaveClass("bg-success-bg");
  });

  it("keeps the other variants' colours", () => {
    render(
      <>
        <Badge>Default</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="danger">Danger</Badge>
      </>
    );

    expect(screen.getByText("Default")).toHaveClass("bg-gray-100", "text-gray-700");
    expect(screen.getByText("Warning")).toHaveClass("bg-warning-bg", "text-warning-text");
    expect(screen.getByText("Danger")).toHaveClass("bg-danger-bg", "text-danger");
  });
});
