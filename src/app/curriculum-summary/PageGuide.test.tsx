import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PageGuide from "./PageGuide";

function renderGuide() {
  render(
    <div>
      <PageGuide items={["**Status**: how far along a Chapter is.", "Second point."]} />
      <p>Elsewhere on the page</p>
    </div>
  );
  return screen.getByRole("button", { name: "How to read this page" });
}

describe("PageGuide", () => {
  it("starts closed and opens the guide with focus inside it", () => {
    const button = renderGuide();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(button);

    const dialog = screen.getByRole("dialog", { name: "How to read this page" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", dialog.id);
    expect(dialog).toHaveFocus();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Status: how far along a Chapter is.",
      "Second point.",
    ]);
    expect(screen.getByText("Status").tagName).toBe("STRONG");
  });

  it("closes on Esc and returns focus to the button", () => {
    const button = renderGuide();
    fireEvent.click(button);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a click outside but not on a click inside", () => {
    const button = renderGuide();
    fireEvent.click(button);

    fireEvent.mouseDown(screen.getByText("Second point."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("Elsewhere on the page"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles closed from its button", () => {
    const button = renderGuide();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
