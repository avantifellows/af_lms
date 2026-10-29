import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/school-visit-summary",
  useRouter: () => ({ replace: mockReplace }),
}));

import VisitSummaryFilterBar from "./VisitSummaryFilterBar";

// Sending an update sets state, so the fake clock runs inside act.
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

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

  it("debounces school filter URL updates, drops page, and preserves sorting", () => {
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

    advance(299);
    expect(mockReplace).not.toHaveBeenCalled();

    advance(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?sort=pm_email&dir=asc&schools=SC001",
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
    advance(300);

    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?sort=visit_date&dir=desc&from=2026-05-01",
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
    advance(300);
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/school-visit-summary?pms=pm%40example.org",
      { scroll: false }
    );

    // Each update builds on the one before (the URL hasn't caught up in this test).
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    advance(300);
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/school-visit-summary?pms=pm%40example.org&status=completed",
      { scroll: false }
    );

    fireEvent.change(screen.getByLabelText("Required actions"), { target: { value: "partial" } });
    advance(300);
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/school-visit-summary?pms=pm%40example.org&status=completed&bucket=partial",
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
    advance(100);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    advance(299);

    expect(mockReplace).not.toHaveBeenCalled();

    advance(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?status=completed",
      { scroll: false }
    );
  });

  it("renders the CSV placeholder and clears filter params while preserving the tab and sort", () => {
    render(
      <VisitSummaryFilterBar
        regionOptions={[]}
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{ tab: "visits", schools: "SC001", status: "completed", page: "4", sort: "school_name", dir: "asc" }}
      />
    );

    const csvButton = screen.getByRole("button", { name: "Download CSV" });
    expect(csvButton).toBeDisabled();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?tab=visits&sort=school_name&dir=asc",
      { scroll: false }
    );
  });

  it("writes the Region selection as a comma list, drops page and keeps the other filters", () => {
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
    advance(300);

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?schools=SC001&regions=Bhopal%2C__none__",
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
    advance(300);

    expect(mockReplace).toHaveBeenCalledWith("/school-visit-summary", { scroll: false });
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
      .getAllByText(/^(Region|School|PM|Status|Required actions|Date preset|From|To)$/)
      .map((element) => element.textContent);

    expect(labels).toEqual([
      "Region",
      "School",
      "PM",
      "Status",
      "Required actions",
      "Date preset",
      "From",
      "To",
    ]);
  });

  describe("following the URL", () => {
    const regionOptions = [
      { value: "Bhopal", label: "Bhopal" },
      { value: "Indore", label: "Indore" },
    ];

    // The bar beside a tab, as on the page: the button stands for anything outside the bar.
    function renderBar(currentParams: Record<string, string | undefined>) {
      const ui = (params: Record<string, string | undefined>) => (
        <>
          <VisitSummaryFilterBar regionOptions={regionOptions} schoolOptions={[]} pmOptions={[]} currentParams={params} />
          <button type="button">Visits tab</button>
        </>
      );
      const view = render(ui(currentParams));
      return { ...view, navigateTo: (params: Record<string, string | undefined>) => view.rerender(ui(params)) };
    }

    function regionButton() {
      return within(screen.getByRole("group", { name: "Region" })).getAllByRole("button")[0];
    }

    it("shows the URL's filters when they change under it, as after Clear filters", () => {
      const { navigateTo } = renderBar({ tab: "visits", regions: "Bhopal", status: "completed", from: "2026-05-01" });
      expect(regionButton()).toHaveTextContent("Bhopal");

      navigateTo({ tab: "visits" });

      expect(regionButton()).toHaveTextContent("All regions");
      expect(screen.getByLabelText("Status")).toHaveValue("");
      expect(screen.getByLabelText("From")).toHaveValue("");
    });

    it("Clear filters drops a waiting update and clears the fields at once", () => {
      renderBar({ tab: "schools" });
      const region = openFilter("Region");
      fireEvent.click(within(region).getByRole("checkbox", { name: "Bhopal" }));

      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      advance(1000);

      expect(mockReplace.mock.calls).toEqual([["/school-visit-summary?tab=schools", { scroll: false }]]);
      expect(regionButton()).toHaveTextContent("All regions");
    });

    it("sends a waiting update before a click outside the bar can navigate, so it never undoes a tab switch", () => {
      const { navigateTo } = renderBar({ tab: "schools" });
      const region = openFilter("Region");
      fireEvent.click(within(region).getByRole("checkbox", { name: "Bhopal" }));
      advance(100);

      // The pointer goes down on the Visits tab: the update goes now, ahead of the tab's navigation,
      // which Next then lets win.
      fireEvent.pointerDown(screen.getByRole("button", { name: "Visits tab" }));
      expect(mockReplace.mock.calls).toEqual([["/school-visit-summary?tab=schools&regions=Bhopal", { scroll: false }]]);

      navigateTo({ tab: "visits" });
      advance(1000);

      // Nothing more is sent after the tab switch, and the bar shows the URL it landed on.
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(regionButton()).toHaveTextContent("All regions");
    });

    it("sends a waiting update when focus moves out of the bar", () => {
      renderBar({ tab: "schools" });
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });

      fireEvent.focusIn(screen.getByRole("button", { name: "Visits tab" }));

      expect(mockReplace).toHaveBeenCalledWith("/school-visit-summary?tab=schools&status=completed", { scroll: false });
    });

    it("drops a waiting update on Back or Forward", () => {
      renderBar({ tab: "schools" });
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });

      window.dispatchEvent(new PopStateEvent("popstate"));
      advance(1000);

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("sends nothing after it unmounts", () => {
      const { unmount } = renderBar({ tab: "schools" });
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });

      unmount();
      advance(1000);

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("keeps a pick made while its own last update was on the way when that update lands", () => {
      const { navigateTo } = renderBar({ tab: "schools" });
      const region = openFilter("Region");
      fireEvent.click(within(region).getByRole("checkbox", { name: "Bhopal" }));
      advance(300);
      fireEvent.click(within(region).getByRole("checkbox", { name: "Indore" }));

      navigateTo({ tab: "schools", regions: "Bhopal" });

      // Still open, with both ticked; the second pick then goes out on top of the first.
      expect(within(region).getByRole("checkbox", { name: "Indore" })).toBeChecked();
      expect(regionButton()).toHaveTextContent("2 regions");
      advance(300);
      expect(mockReplace).toHaveBeenLastCalledWith(
        "/school-visit-summary?tab=schools&regions=Bhopal%2CIndore",
        { scroll: false }
      );
    });

    it("builds each update on the one it sent before, even before that one lands", () => {
      renderBar({ tab: "schools" });
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
      advance(300);

      fireEvent.change(screen.getByLabelText("Required actions"), { target: { value: "partial" } });
      advance(300);

      expect(mockReplace).toHaveBeenLastCalledWith(
        "/school-visit-summary?tab=schools&status=completed&bucket=partial",
        { scroll: false }
      );
    });
  });

  it("no longer carries Recurring concerns only (it sits by the School-wise table)", () => {
    render(
      <VisitSummaryFilterBar
        regionOptions={[]}
        schoolOptions={[]}
        pmOptions={[]}
        currentParams={{ tab: "schools", recurring: "1" }}
      />
    );

    expect(screen.queryByRole("checkbox", { name: "Recurring concerns only" })).not.toBeInTheDocument();
  });
});
