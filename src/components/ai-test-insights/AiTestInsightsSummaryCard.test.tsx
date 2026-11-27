import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiTestInsightsSummaryCard from "./AiTestInsightsSummaryCard";
import type { AiTestInsightsTest } from "@/lib/ai-test-insights-shared";

// The AI Summary card's test picker (#559), from a picker read written by
// hand: three tests, newest first.
const TESTS: AiTestInsightsTest[] = [
  { id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" },
  { id: "T7", name: "Full Syllabus Test 1", date: "2026-10-20", format: "full_syllabus_test" },
  { id: "T4", name: "Major Test 2", date: "2026-10-12", format: "major_test" },
];

const card = () => screen.getByRole("region", { name: "AI Summary" });
const box = (name: RegExp) => within(card()).getByRole("checkbox", { name });
const ticked = () =>
  within(card())
    .getAllByRole("checkbox")
    .filter((checkbox) => (checkbox as HTMLInputElement).checked)
    .map((checkbox) => checkbox.getAttribute("value"));

describe("AiTestInsightsSummaryCard", () => {
  it("lists the tests newest first, each with its date and kind, with the newest ticked", () => {
    render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: TESTS }} canEdit onRetry={() => {}} />);

    const rows = within(card()).getAllByRole("listitem").map((item) => item.textContent);
    expect(rows).toEqual([
      "Mock Test 12 Nov 2026 · Mock test",
      "Full Syllabus Test 120 Oct 2026 · Full Syllabus test",
      "Major Test 212 Oct 2026 · Major test",
    ]);
    expect(ticked()).toEqual(["T9"]);
  });

  it("lets a Teacher tick more tests and untick them again", async () => {
    const user = userEvent.setup();
    render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: TESTS }} canEdit onRetry={() => {}} />);

    await user.click(box(/Major Test 2/));
    await user.click(box(/Full Syllabus Test 1/));
    expect(ticked()).toEqual(["T9", "T7", "T4"]);

    await user.click(box(/Mock Test 1/));
    expect(ticked()).toEqual(["T7", "T4"]);
  });

  it("keeps the last ticked test ticked", async () => {
    const user = userEvent.setup();
    render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: TESTS }} canEdit onRetry={() => {}} />);

    expect(box(/Mock Test 1/)).toBeDisabled();
    await user.click(box(/Mock Test 1/));
    expect(ticked()).toEqual(["T9"]);
    expect(within(card()).getByText("At least one test stays ticked.")).toBeInTheDocument();

    await user.click(box(/Major Test 2/));
    expect(box(/Mock Test 1/)).toBeEnabled();
    await user.click(box(/Mock Test 1/));
    expect(ticked()).toEqual(["T4"]);
    expect(box(/Major Test 2/)).toBeDisabled();
  });

  it("shows a viewer the picker read-only, with the newest test ticked", async () => {
    const user = userEvent.setup();
    render(
      <AiTestInsightsSummaryCard tests={{ status: "loaded", tests: TESTS }} canEdit={false} onRetry={() => {}} />,
    );

    const checkboxes = within(card()).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    for (const checkbox of checkboxes) expect(checkbox).toBeDisabled();
    await user.click(box(/Major Test 2/));
    expect(ticked()).toEqual(["T9"]);
    expect(within(card()).queryByText("At least one test stays ticked.")).not.toBeInTheDocument();
  });

  it("says when the Student has no submitted Major, Full Syllabus or Mock test this year", () => {
    render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: [] }} canEdit onRetry={() => {}} />);

    expect(
      within(card()).getByText("This student has no submitted Major, Full Syllabus or Mock test this year."),
    ).toBeInTheDocument();
    expect(within(card()).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("says the tests could not be loaded, and Retry asks again", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<AiTestInsightsSummaryCard tests={{ status: "failed" }} canEdit onRetry={onRetry} />);

    expect(within(card()).getByRole("alert")).toHaveTextContent("Tests could not be loaded");
    await user.click(within(card()).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says it is loading the tests", () => {
    render(<AiTestInsightsSummaryCard tests={{ status: "loading" }} canEdit onRetry={() => {}} />);

    expect(within(card()).getByText("Loading tests…")).toBeInTheDocument();
  });
});
