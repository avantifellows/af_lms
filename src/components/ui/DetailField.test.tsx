import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailField } from "./DetailField";

describe("DetailField", () => {
  it("renders the label and value", () => {
    render(<DetailField label="Phone" value="9876543210" />);
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("9876543210")).toBeInTheDocument();
  });

  it("falls back to an em-dash when value is empty/null/undefined", () => {
    const { rerender } = render(<DetailField label="City" value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();

    rerender(<DetailField label="City" value="" />);
    expect(screen.getByText("—")).toBeInTheDocument();

    rerender(<DetailField label="City" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders children instead of value when provided", () => {
    render(
      <DetailField label="Category" value="ignored">
        <span data-testid="badge">Gen</span>
      </DetailField>,
    );
    expect(screen.getByTestId("badge")).toHaveTextContent("Gen");
    expect(screen.queryByText("ignored")).not.toBeInTheDocument();
  });

  it("applies extra className to the value", () => {
    render(<DetailField label="Stream" value="science" className="capitalize" />);
    expect(screen.getByText("science")).toHaveClass("capitalize");
  });
});
