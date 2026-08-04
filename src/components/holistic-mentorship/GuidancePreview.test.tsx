import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import GuidancePreview from "./GuidancePreview";

describe("GuidancePreview", () => {
  it("renders the supported Markdown structure", () => {
    render(<GuidancePreview markdown={`# Prepare

Start with **trust** and *listen* carefully.

- Ask about home
- Ask about school

1. Listen
2. Plan

> Let the student lead.

---

[Open guide](https://example.org/guide)`} />);

    expect(screen.getByRole("heading", { name: "Prepare" })).toBeInTheDocument();
    expect(screen.getByText("trust").tagName).toBe("STRONG");
    expect(screen.getByText("listen", { exact: true }).tagName).toBe("EM");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(document.querySelector("blockquote")).toHaveTextContent("Let the student lead.");
    expect(screen.getByRole("separator")).toBeInTheDocument();
    const guide = screen.getByRole("link", { name: /Open guide.*opens in a new tab/ });
    expect(guide).toHaveAttribute("href", "https://example.org/guide");
    expect(guide).toHaveAttribute("target", "_blank");
    expect(guide).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("never renders raw HTML, images, or unsafe links", () => {
    render(<GuidancePreview markdown={`<script>alert(1)</script>

![Profile](https://example.org/profile.png)

[Bad](javascript:alert(1)) [Email](mailto:test@example.org) [Relative](/private)`} />);

    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bad" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Email" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Relative" })).not.toBeInTheDocument();
  });
});
