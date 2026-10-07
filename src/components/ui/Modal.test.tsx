import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

function ModalHarness({ empty = false }: { empty?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <button type="button">Behind</button>
      <Modal open={open} onClose={() => setOpen(false)} aria-label="Test dialog">
        {!empty && <>
          <button type="button">First</button>
          <textarea aria-label="Notes" />
          <button type="button" disabled>Disabled</button>
          <button type="button" onClick={() => setOpen(false)}>Last</button>
        </>}
      </Modal>
    </>
  );
}

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

  it("exposes the dialog role and modal state, letting callers add their own aria props", () => {
    render(<Modal open={true} aria-labelledby="title"><h2 id="title">Edit</h2></Modal>);
    const dialog = screen.getByRole("dialog", { name: "Edit" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  describe("focus management", () => {
    it("moves focus to the first focusable element on open", async () => {
      const user = userEvent.setup();
      render(<ModalHarness />);
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    });

    it("focuses the dialog itself when it has nothing focusable", async () => {
      const user = userEvent.setup();
      render(<ModalHarness empty />);
      await user.click(screen.getByRole("button", { name: "Open" }));
      const dialog = screen.getByRole("dialog", { name: "Test dialog" });
      expect(dialog).toHaveFocus();
      await user.tab();
      expect(dialog).toHaveFocus();
    });

    it("wraps Tab from the last focusable element back to the first", async () => {
      const user = userEvent.setup();
      render(<ModalHarness />);
      await user.click(screen.getByRole("button", { name: "Open" }));
      await user.tab();
      expect(screen.getByRole("textbox", { name: "Notes" })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    });

    it("wraps Shift+Tab from the first focusable element to the last", async () => {
      const user = userEvent.setup();
      render(<ModalHarness />);
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
      await user.tab({ shift: true });
      expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    });

    it("keeps a <details> summary reachable inside the focus trap", async () => {
      const user = userEvent.setup();
      render(<Modal open={true} aria-label="Flags">
        <details><summary>Past flags</summary>Old flag</details>
        <button type="button">Close</button>
      </Modal>);
      expect(screen.getByText("Past flags")).toHaveFocus();
      screen.getByRole("button", { name: "Close" }).focus();
      await user.tab();
      expect(screen.getByText("Past flags")).toHaveFocus();
    });

    it("pulls focus back into the dialog when it has escaped to the page", async () => {
      const user = userEvent.setup();
      render(<ModalHarness />);
      await user.click(screen.getByRole("button", { name: "Open" }));
      screen.getByRole("button", { name: "Behind", hidden: true }).focus();
      await user.tab();
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    });

    it.each([
      ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
      ["a button inside the dialog", async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole("button", { name: "Last" }))],
    ])("restores focus to the opener after closing via %s", async (_how, close) => {
      const user = userEvent.setup();
      render(<ModalHarness />);
      const opener = screen.getByRole("button", { name: "Open" });
      await user.click(opener);
      expect(opener).not.toHaveFocus();
      await close(user);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
  });
});
