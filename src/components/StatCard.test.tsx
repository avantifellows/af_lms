import { render, screen } from "@testing-library/react";
import StatCard from "./StatCard";

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="Total Students" value={150} />);
    expect(screen.getByText("Total Students")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("renders string value", () => {
    render(<StatCard label="Status" value="Active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies text-2xl for default (md) size", () => {
    render(<StatCard label="Count" value={10} />);
    const valueEl = screen.getByText("10");
    expect(valueEl.className).toContain("text-2xl");
  });

  it("applies text-lg for sm size", () => {
    render(<StatCard label="Count" value={10} size="sm" />);
    const valueEl = screen.getByText("10");
    expect(valueEl.className).toContain("text-lg");
  });

  it("applies text-3xl for lg size", () => {
    render(<StatCard label="Count" value={10} size="lg" />);
    const valueEl = screen.getByText("10");
    expect(valueEl.className).toContain("text-3xl");
  });

  it("has font-semibold on value", () => {
    render(<StatCard label="Count" value={10} />);
    const valueEl = screen.getByText("10");
    expect(valueEl.className).toContain("font-semibold");
  });

  it("renders label with text-sm text-gray-500", () => {
    render(<StatCard label="My Label" value={0} />);
    const labelEl = screen.getByText("My Label");
    expect(labelEl.className).toContain("text-sm");
    expect(labelEl.className).toContain("text-gray-500");
  });

  it("renders value of 0 correctly", () => {
    render(<StatCard label="Empty" value={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
