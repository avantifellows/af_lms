import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SegmentedControl } from "./SegmentedControl";

const OPTIONS = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
];

function buttonRow() {
  return screen.getByRole("button", { name: "A" }).parentElement as HTMLElement;
}

describe("SegmentedControl", () => {
  it("keeps its buttons on one row by default", () => {
    render(<SegmentedControl label="Pick" options={OPTIONS} value="a" onChange={() => {}} />);
    expect(buttonRow()).not.toHaveClass("flex-wrap");
  });

  it("lets the buttons wrap when asked, for a long list on a phone", () => {
    render(<SegmentedControl label="Pick" options={OPTIONS} value="a" onChange={() => {}} wrap />);
    expect(buttonRow()).toHaveClass("flex-wrap", "max-w-full");
  });
});
