import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

  it("shows its label by default", () => {
    render(<SegmentedControl label="Pick" options={OPTIONS} value="a" onChange={() => {}} />);
    expect(screen.getByText("Pick")).not.toHaveClass("sr-only");
  });

  it("can keep its label for screen readers only, still naming the group", () => {
    render(<SegmentedControl label="Pick" options={OPTIONS} value="a" onChange={() => {}} hideLabel />);
    expect(screen.getByText("Pick")).toHaveClass("sr-only");
    expect(screen.getByRole("group", { name: "Pick" })).toBeInTheDocument();
  });

  it("takes a node as an option label and reports a change of option only", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentedControl
        label="Pick"
        options={[...OPTIONS, { value: "c", label: <>C <span>new</span></> }]}
        value="a"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "A" }));
    await user.click(screen.getByRole("button", { name: "C new" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("c");
  });
});
