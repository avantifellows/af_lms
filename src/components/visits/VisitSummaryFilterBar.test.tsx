import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/school-visit-summary",
  useRouter: () => ({ replace: mockReplace }),
}));

import VisitSummaryFilterBar from "./VisitSummaryFilterBar";

describe("VisitSummaryFilterBar", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    vi.useFakeTimers();
  });

  it("debounces school filter URL updates, resets page, and preserves sorting", () => {
    render(
      <VisitSummaryFilterBar
        schoolOptions={[{ code: "SC001", name: "Test School" }]}
        pmOptions={[]}
        currentParams={{ sort: "pm_email", dir: "asc", page: "3" }}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Test School (SC001)" }));

    expect(mockReplace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(mockReplace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?sort=pm_email&dir=asc&page=1&schools=SC001",
      { scroll: false }
    );
  });

  it("shows selected school values missing from options with a not-in-results indicator", () => {
    render(
      <VisitSummaryFilterBar
        schoolOptions={[{ code: "SC001", name: "Test School" }]}
        pmOptions={[]}
        currentParams={{ schools: "SC999" }}
      />
    );

    expect(screen.getByText("SC999 (not in results)")).toBeInTheDocument();
  });

  it("clears preset params when a manual date is edited", () => {
    render(
      <VisitSummaryFilterBar
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{ sort: "visit_date", dir: "desc" }}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-05-01" } });
    vi.advanceTimersByTime(300);

    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?sort=visit_date&dir=desc&page=1&from=2026-05-01",
      { scroll: false }
    );
  });

  it("hides manual date inputs when a preset is selected", () => {
    render(
      <VisitSummaryFilterBar
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{ preset: "7d" }}
      />
    );

    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("To")).not.toBeInTheDocument();
  });

  it("updates PM, status, and action-completion bucket params", () => {
    render(
      <VisitSummaryFilterBar
        schoolOptions={[]}
        pmOptions={[{ email: "pm@example.org", name: "Program Manager" }]}
        currentParams={{ page: "2" }}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Program Manager (pm@example.org)" }));
    vi.advanceTimersByTime(300);
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/school-visit-summary?page=1&pms=pm%40example.org",
      { scroll: false }
    );

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    vi.advanceTimersByTime(300);
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/school-visit-summary?page=1&status=completed",
      { scroll: false }
    );

    fireEvent.change(screen.getByLabelText("Action Completion"), { target: { value: "partial" } });
    vi.advanceTimersByTime(300);
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/school-visit-summary?page=1&bucket=partial",
      { scroll: false }
    );
  });

  it("coalesces rapid filter changes into a single debounced URL update", () => {
    render(
      <VisitSummaryFilterBar
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{}}
      />
    );

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in_progress" } });
    vi.advanceTimersByTime(100);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    vi.advanceTimersByTime(299);

    expect(mockReplace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?page=1&status=completed",
      { scroll: false }
    );
  });

  it("renders the CSV placeholder and clears filter params while preserving sort", () => {
    render(
      <VisitSummaryFilterBar
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{ schools: "SC001", status: "completed", page: "4", sort: "school_name", dir: "asc" }}
      />
    );

    const csvButton = screen.getByRole("button", { name: "Download CSV" });
    expect(csvButton).toBeDisabled();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?sort=school_name&dir=asc",
      { scroll: false }
    );
  });
});
