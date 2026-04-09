import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("applies primary variant by default", () => {
    render(<Button>Primary</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-accent");
  });

  it("applies secondary variant", () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole("button")).toHaveClass("border-border");
  });

  it("applies danger variant", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-danger");
  });

  it("applies ghost variant", () => {
    render(<Button variant="ghost">Link</Button>);
    expect(screen.getByRole("button")).toHaveClass("text-accent");
  });

  it("applies size variants", () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button")).toHaveClass("min-h-[36px]");

    rerender(<Button size="lg">Large</Button>);
    expect(screen.getByRole("button")).toHaveClass("min-h-[48px]");
  });

  it("passes className through", () => {
    render(<Button className="mt-4">Styled</Button>);
    expect(screen.getByRole("button")).toHaveClass("mt-4");
  });

  it("handles click events", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("supports disabled state", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
