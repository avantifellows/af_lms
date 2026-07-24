import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import GuidanceEditor from "./GuidanceEditor";

describe("GuidanceEditor", () => {
  it("previews unsaved Guidance through the accessible narrow-screen switch", async () => {
    const user = userEvent.setup();
    render(<GuidanceEditor value="" onChange={() => {}} previewValue="## Unsaved Guidance" />);

    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Unsaved Guidance" })).toBeInTheDocument();
  });
});
