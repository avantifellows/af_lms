import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/school-visit-summary",
  useRouter: () => ({ replace: mockReplace }),
}));

import VisitSummaryFilterBar from "./VisitSummaryFilterBar";

function openFilter(label: string) {
  const group = screen.getByRole("group", { name: label });
  fireEvent.click(within(group).getByRole("button"));
  return group;
}

describe("VisitSummaryFilterBar", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    vi.useFakeTimers();
  });

  it("debounces school filter URL updates, resets page, and preserves sorting", () => {
    render(
      <VisitSummaryFilterBar
        regionOptions={[]}
        schoolOptions={[{ code: "SC001", name: "Test School" }]}
        pmOptions={[]}
        currentParams={{ sort: "pm_email", dir: "asc", page: "3" }}
      />
    );

    openFilter("School");
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
        regionOptions={[]}
        schoolOptions={[{ code: "SC001", name: "Test School" }]}
        pmOptions={[]}
        currentParams={{ schools: "SC999" }}
      />
    );

    const group = screen.getByRole("group", { name: "School" });
    expect(within(group).getByRole("button")).toHaveTextContent("SC999 (not in results)");

    openFilter("School");
    expect(within(group).getByRole("checkbox", { name: "SC999 (not in results)" })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "Test School (SC001)" })).not.toBeChecked();
  });

  it("clears preset params when a manual date is edited", () => {
    render(
      <VisitSummaryFilterBar
        regionOptions={[]}
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
        regionOptions={[]}
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
        regionOptions={[]}
        schoolOptions={[]}
        pmOptions={[{ email: "pm@example.org", name: "Program Manager" }]}
        currentParams={{ page: "2" }}
      />
    );

    openFilter("PM");
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

    fireEvent.change(screen.getByLabelText("Required Completion"), { target: { value: "partial" } });
    vi.advanceTimersByTime(300);
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/school-visit-summary?page=1&bucket=partial",
      { scroll: false }
    );
  });

  it("coalesces rapid filter changes into a single debounced URL update", () => {
    render(
      <VisitSummaryFilterBar
        regionOptions={[]}
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
        regionOptions={[]}
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

  it("writes the Region selection as a comma list, resets page and keeps the other filters", () => {
    render(
      <VisitSummaryFilterBar
        regionOptions={[
          { value: "Bhopal", label: "Bhopal" },
          { value: "__none__", label: "No region (non-JNV)" },
        ]}
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{ schools: "SC001", page: "3" }}
      />
    );

    const region = openFilter("Region");
    fireEvent.click(within(region).getByRole("checkbox", { name: "Bhopal" }));
    fireEvent.click(within(region).getByRole("checkbox", { name: "No region (non-JNV)" }));
    vi.advanceTimersByTime(300);

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?schools=SC001&page=1&regions=Bhopal%2C__none__",
      { scroll: false }
    );
    expect(within(region).getByRole("button", { name: "2 regions" })).toBeInTheDocument();
  });

  it("drops the regions param when the last Region is unticked", () => {
    render(
      <VisitSummaryFilterBar
        regionOptions={[{ value: "Bhopal", label: "Bhopal" }]}
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{ regions: "Bhopal" }}
      />
    );

    const region = screen.getByRole("group", { name: "Region" });
    expect(within(region).getByRole("button")).toHaveTextContent("Bhopal");

    openFilter("Region");
    fireEvent.click(within(region).getByRole("checkbox", { name: "Bhopal" }));
    vi.advanceTimersByTime(300);

    expect(mockReplace).toHaveBeenCalledWith("/school-visit-summary?page=1", { scroll: false });
    expect(within(region).getByRole("button", { name: "All regions" })).toBeInTheDocument();
  });

  it("orders the filters Region, School, PM, Status, Required actions, Date preset, From, To", () => {
    render(
      <VisitSummaryFilterBar
        regionOptions={[]}
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{}}
      />
    );

    const labels = screen
      .getAllByText(/^(Region|School|PM|Status|Required Completion|Date Preset|From|To)$/)
      .map((element) => element.textContent);

    expect(labels).toEqual([
      "Region",
      "School",
      "PM",
      "Status",
      "Required Completion",
      "Date Preset",
      "From",
      "To",
    ]);
  });
});
