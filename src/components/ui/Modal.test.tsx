import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false}>Content</Modal>);
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
  });

  it("renders children when open", () => {
    render(<Modal open={true}>Content</Modal>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Modal open={true} onClose={onClose}>Content</Modal>);
    // Click the backdrop (aria-hidden div)
    const backdrop = document.querySelector("[aria-hidden='true']")!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape key", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Modal open={true} onClose={onClose}>Content</Modal>);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses z-50 by default", () => {
    render(<Modal open={true}>Content</Modal>);
    const container = document.querySelector(".fixed.inset-0");
    expect(container).toHaveClass("z-50");
  });

  it("supports z-40 for secondary modals", () => {
    render(<Modal open={true} zIndex="z-40">Content</Modal>);
    const container = document.querySelector(".fixed.inset-0");
    expect(container).toHaveClass("z-40");
  });
});
