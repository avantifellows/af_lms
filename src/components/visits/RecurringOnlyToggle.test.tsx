import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/school-visit-summary",
  useRouter: () => ({ replace: mockReplace }),
}));

import RecurringOnlyToggle from "./RecurringOnlyToggle";

describe("RecurringOnlyToggle", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it("writes recurring=1 when ticked, keeping the other params and dropping page", () => {
    render(
      <RecurringOnlyToggle
        currentParams={{ tab: "schools", pms: "pm@example.org", sort: "visits", dir: "asc", page: "2" }}
      />
    );

    const toggle = screen.getByRole("checkbox", { name: "Recurring concerns only" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    expect(mockReplace).toHaveBeenCalledWith(
      "/school-visit-summary?tab=schools&pms=pm%40example.org&sort=visits&dir=asc&recurring=1",
      { scroll: false }
    );
  });

  it("drops the recurring param when unticked", () => {
    render(<RecurringOnlyToggle currentParams={{ tab: "schools", recurring: "1" }} />);

    const toggle = screen.getByRole("checkbox", { name: "Recurring concerns only" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(mockReplace).toHaveBeenCalledWith("/school-visit-summary?tab=schools", { scroll: false });
  });

  it("goes to the bare path when no other params are left", () => {
    render(<RecurringOnlyToggle currentParams={{ recurring: "1" }} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Recurring concerns only" }));

    expect(mockReplace).toHaveBeenCalledWith("/school-visit-summary", { scroll: false });
  });
});
