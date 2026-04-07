import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioPair } from "./RadioPair";

describe("RadioPair", () => {
  it("renders Yes and No labels", () => {
    render(<RadioPair name="test" value={null} onChange={() => {}} />);
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("checks Yes when value is true", () => {
    render(<RadioPair name="test" value={true} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toBeChecked(); // Yes
    expect(radios[1]).not.toBeChecked(); // No
  });

  it("checks No when value is false", () => {
    render(<RadioPair name="test" value={false} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).toBeChecked();
  });

  it("checks nothing when value is null", () => {
    render(<RadioPair name="test" value={null} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).not.toBeChecked();
  });

  it("calls onChange(true) when Yes is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioPair name="test" value={null} onChange={onChange} />);
    await user.click(screen.getByText("Yes"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange(false) when No is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioPair name="test" value={null} onChange={onChange} />);
    await user.click(screen.getByText("No"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("disables both radios when disabled", () => {
    render(<RadioPair name="test" value={null} onChange={() => {}} disabled />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toBeDisabled();
    expect(radios[1]).toBeDisabled();
  });

  it("applies test IDs", () => {
    render(
      <RadioPair
        name="test"
        value={null}
        onChange={() => {}}
        yesTestId="q1-yes"
        noTestId="q1-no"
      />
    );
    expect(screen.getByTestId("q1-yes")).toBeInTheDocument();
    expect(screen.getByTestId("q1-no")).toBeInTheDocument();
  });
});
