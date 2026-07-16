import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import GuidancePreview from "./GuidancePreview";

describe("GuidancePreview", () => {
  it("renders safe Markdown links without rendering raw HTML or unsafe links", () => {
    render(<GuidancePreview markdown={"## Prepare\n[Guide](https://example.org)\n<script>alert(1)</script>\n[Bad](javascript:alert(1))"} />);

    expect(screen.getByRole("heading", { name: "Prepare" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Guide" })).toHaveAttribute("href", "https://example.org");
    expect(screen.queryByRole("link", { name: "Bad" })).not.toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});
