import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BlendedSelect } from "./BlendedSelect";

describe("BlendedSelect", () => {
  it("replaces the native arrow with an inset chevron and leaves room for it", () => {
    const { container } = render(
      <BlendedSelect aria-label="Flag Recipient" wrapperClassName="col-span-2" className="bg-bg-input" defaultValue="">
        <option value="">All recipients</option>
      </BlendedSelect>
    );

    const select = screen.getByRole("combobox", { name: "Flag Recipient" });
    expect(select).toHaveClass("appearance-none", "pr-9", "bg-bg-input");
    expect(select.parentElement).toHaveClass("relative", "col-span-2");
    const chevron = container.querySelector("svg");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveClass("pointer-events-none", "absolute", "right-3");
  });
});
