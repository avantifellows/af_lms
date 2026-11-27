import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import TestInsightText from "./TestInsightText";

// The AI Summary text (#564): Markdown with GitHub tables, from hand-written
// strings, with raw HTML never rendered as HTML.
const text = () => screen.getByRole("article", { name: "AI Summary text" });

describe("TestInsightText", () => {
  it("renders headings, lists and a table", () => {
    render(
      <TestInsightText
        markdown={[
          "# Test Insight",
          "",
          "## Physics",
          "",
          "- Kinematics is strong",
          "- Optics needs work",
          "",
          "1. Revise optics",
          "",
          "| Subject | Score | Rank |",
          "| --- | --- | --- |",
          "| Physics | 62 | 14 |",
          "| Chemistry | 48 | 30 |",
        ].join("\n")}
      />,
    );

    expect(within(text()).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Test Insight",
      "Physics",
    ]);
    expect(within(text()).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Kinematics is strong",
      "Optics needs work",
      "Revise optics",
    ]);
    const table = within(text()).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Subject",
      "Score",
      "Rank",
    ]);
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent)),
    ).toEqual([
      ["Physics", "62", "14"],
      ["Chemistry", "48", "30"],
    ]);
  });

  it("never renders raw HTML in the text as HTML", () => {
    const { container } = render(
      <TestInsightText
        markdown={
          'Before <b>bold</b> <img src="x" onerror="alert(1)"> after\n\n<script>alert(1)</script>\n\n<div class="x">block</div>'
        }
      />,
    );

    expect(container.querySelector("b, img, script, div.x")).toBeNull();
    expect(text()).toHaveTextContent("Before");
    expect(text()).toHaveTextContent("after");
  });

  it("opens only web links, in a new tab, and drops images", () => {
    render(
      <TestInsightText markdown={"[Report](https://example.org/r) [Bad](javascript:alert(1)) ![chart](https://example.org/c.png)"} />,
    );

    const links = within(text()).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.org/r");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(text()).toHaveTextContent("Bad");
    expect(within(text()).queryByRole("img")).not.toBeInTheDocument();
  });
});
