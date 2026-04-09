import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemarkField } from "./RemarkField";

describe("RemarkField", () => {
  it("shows 'Add remark' button when empty and not disabled", () => {
    render(<RemarkField value="" onChange={() => {}} />);
    expect(screen.getByText("Add remark")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("reveals textarea when 'Add remark' is clicked", async () => {
    const user = userEvent.setup();
    render(<RemarkField value="" onChange={() => {}} />);
    await user.click(screen.getByText("Add remark"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByText("Add remark")).not.toBeInTheDocument();
  });

  it("starts revealed when value is non-empty", () => {
    render(<RemarkField value="existing remark" onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("existing remark");
  });

  it("starts revealed when defaultRevealed is true", () => {
    render(<RemarkField value="" onChange={() => {}} defaultRevealed />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("calls onChange when text is typed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RemarkField value="" onChange={onChange} defaultRevealed />);
    await user.type(screen.getByRole("textbox"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("disables textarea when disabled", () => {
    render(<RemarkField value="text" onChange={() => {}} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("hides completely when disabled and empty", () => {
    render(<RemarkField value="" onChange={() => {}} disabled />);
    expect(screen.queryByText("Add remark")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("applies testId to textarea", () => {
    render(<RemarkField value="x" onChange={() => {}} testId="remark-q1" />);
    expect(screen.getByTestId("remark-q1")).toBeInTheDocument();
  });
});
