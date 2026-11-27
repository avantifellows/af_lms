import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import AttendanceChart from "./AttendanceChart";
import type { AttendanceChartBar } from "@/lib/test-attendance-rules";

const bar = (overrides: Partial<AttendanceChartBar>): AttendanceChartBar => ({
  key: "october",
  shortName: "Oct",
  running: false,
  counted: 5,
  attended: 4,
  openedNotSubmitted: 1,
  percent: "80%",
  submittedShare: 60,
  openedShare: 20,
  ...overrides,
});

/** Each bar's text under the drawing: month, percentage, x of y, not submitted. */
function barTexts() {
  const chart = screen.getByRole("region", { name: "Attendance by Monthly Test" });
  return within(chart)
    .getAllByRole("listitem")
    .map((item) => Array.from(item.children).map((line) => line.textContent));
}

describe("AttendanceChart", () => {
  it("reads every bar as text, in the order given, with the running one marked so far", () => {
    render(
      <AttendanceChart
        bars={[
          bar({ key: "september", shortName: "Sep", attended: 3, percent: "60%" }),
          bar({}),
          bar({ key: "november", shortName: "Nov", running: true, counted: 6, attended: 3, openedNotSubmitted: 0, percent: "50%" }),
        ]}
      />,
    );

    expect(barTexts()).toEqual([
      ["Sep", "60%", "3 of 5", "1 not submitted"],
      ["Oct", "80%", "4 of 5", "1 not submitted"],
      ["Nov so far", "50%", "3 of 6", "0 not submitted"],
    ]);
  });

  it("shows a bar's dash as given when nobody is counted", () => {
    render(<AttendanceChart bars={[bar({ counted: 0, attended: 0, openedNotSubmitted: 0, percent: "—" })]} />);

    expect(barTexts()).toEqual([["Oct", "—", "0 of 0", "0 not submitted"]]);
  });

  it("explains the colours and hides the drawing itself from screen readers", () => {
    render(<AttendanceChart bars={[bar({})]} />);

    const chart = screen.getByRole("region", { name: "Attendance by Monthly Test" });
    expect(chart).toHaveTextContent("Submitted");
    expect(chart).toHaveTextContent("Opened, not submitted");
    expect(chart).toHaveTextContent("So far (test still running)");
    expect(chart.querySelector(".h-40")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows nothing when there is no bar", () => {
    const { container } = render(<AttendanceChart bars={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
