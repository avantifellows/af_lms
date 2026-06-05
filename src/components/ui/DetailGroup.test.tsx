import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailGroup } from "./DetailGroup";

describe("DetailGroup", () => {
  it("renders the title and children", () => {
    render(
      <DetailGroup title="Personal">
        <span>child content</span>
      </DetailGroup>,
    );
    expect(screen.getByRole("heading", { name: "Personal" })).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("defaults to a 3-column grid", () => {
    render(
      <DetailGroup title="Academic">
        <span>x</span>
      </DetailGroup>,
    );
    const grid = screen.getByText("x").parentElement;
    expect(grid?.className).toContain("sm:grid-cols-3");
  });

  it("honors the columns prop", () => {
    render(
      <DetailGroup title="Academic" columns={2}>
        <span>y</span>
      </DetailGroup>,
    );
    const grid = screen.getByText("y").parentElement;
    expect(grid?.className).toContain("sm:grid-cols-2");
  });
});
