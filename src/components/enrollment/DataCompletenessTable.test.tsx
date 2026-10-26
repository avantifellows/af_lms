import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataCompletenessTable from "./DataCompletenessTable";
import type { DataCompleteness } from "@/lib/data-completeness";

const completeness: DataCompleteness = {
  total: 10,
  groups: [
    {
      key: "info",
      title: "Info",
      pct: 63,
      items: [
        {
          key: "info:pen_or_roll",
          label: "PEN / Grade 10 Roll no",
          missing: 10,
          filterLabel: "Missing PEN / Grade 10 Roll no",
          locked: true,
          required: false,
        },
        {
          key: "info:address",
          label: "Address",
          missing: 3,
          filterLabel: "Missing Address",
          locked: false,
          required: false,
        },
        {
          key: "info:phone",
          label: "Parents Phone Number",
          missing: 1,
          filterLabel: "Missing Parents Phone Number",
          locked: false,
          required: false,
        },
      ],
      complete: ["Gender", "Category"],
      notes: [],
      pending: false,
    },
    {
      key: "documents",
      title: "Documents",
      pct: 45,
      items: [
        {
          key: "doc:parent_undertaking",
          label: "Signed undertaking - Parent",
          missing: 6,
          filterLabel: "Missing Signed undertaking - Parent",
          locked: false,
          required: true,
        },
      ],
      complete: [],
      notes: [],
      pending: false,
    },
    {
      key: "exams",
      title: "Exams",
      pct: 0,
      items: [
        {
          key: "exam:JEE Mains",
          label: "JEE Mains",
          missing: 10,
          filterLabel: "Not registered for JEE Mains",
          locked: false,
          required: true,
        },
      ],
      complete: [],
      notes: ["NEET not expected — no Student on PCB or PCMB"],
      pending: false,
    },
  ],
};

function renderTable(overrides: Partial<Parameters<typeof DataCompletenessTable>[0]> = {}) {
  const props = {
    completeness,
    activeFilter: null,
    onFilterChange: vi.fn(),
    activeFilterLabel: null,
    filteredCount: 0,
    scopeNoun: "students",
    ...overrides,
  };
  render(<DataCompletenessTable {...props} />);
  return props;
}

describe("DataCompletenessTable", () => {
  it("shows one chip per item with the count of Students missing it", () => {
    renderTable();

    const info = screen.getByTestId("completeness-row-info");
    expect(within(info).getByRole("button", { name: "3 of 10 students missing Address" })).toBeInTheDocument();
    expect(
      within(info).getByRole("button", { name: "10 of 10 students missing PEN / Grade 10 Roll no" }),
    ).toBeInTheDocument();
  });

  it("shows each group's percentage", () => {
    renderTable();

    expect(screen.getByText("63%")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("folds the items nobody is missing into one chip, naming them on hover", () => {
    renderTable();

    const complete = screen.getByText("✓ 2 complete");
    expect(complete).toHaveAttribute("title", "Gender, Category");
  });

  it("says when an exam no Student is expected to sit is absent", () => {
    renderTable();

    expect(
      screen.getByText("NEET not expected — no Student on PCB or PCMB"),
    ).toBeInTheDocument();
  });

  it("marks a required item with a star", () => {
    renderTable();

    const documents = screen.getByTestId("completeness-row-documents");
    expect(
      within(documents).getByRole("button", { name: "6 of 10 students missing Signed undertaking - Parent" }),
    ).toBeInTheDocument();
  });

  it("filters on a chip, and the same chip again clears it", async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderTable();

    await user.click(screen.getByRole("button", { name: "3 of 10 students missing Address" }));
    expect(onFilterChange).toHaveBeenCalledWith("info:address");

    onFilterChange.mockClear();
    renderTable({ activeFilter: "info:address", onFilterChange });
    await user.click(screen.getAllByRole("button", { name: "3 of 10 students missing Address" })[1]);
    expect(onFilterChange).toHaveBeenCalledWith(null);
  });

  it("filters on a group label", async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderTable();

    await user.click(screen.getByRole("button", { name: /^Info/ }));

    expect(onFilterChange).toHaveBeenCalledWith("group:info");
  });

  it("marks the active chip as pressed", () => {
    renderTable({ activeFilter: "info:address" });

    expect(screen.getByRole("button", { name: "3 of 10 students missing Address" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("names the filter, counts it and offers Clear", async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderTable({
      activeFilter: "info:address",
      activeFilterLabel: "Missing Address",
      filteredCount: 3,
    });

    const bar = screen.getByTestId("completeness-filter-bar");
    expect(within(bar).getByText("Missing Address")).toBeInTheDocument();
    expect(within(bar).getByText("3 of 10 students")).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(onFilterChange).toHaveBeenCalledWith(null);
  });

  it("follows the grade filter's wording in the count line", () => {
    renderTable({
      activeFilter: "info:address",
      activeFilterLabel: "Missing Address",
      filteredCount: 2,
      scopeNoun: "Grade 11 students",
    });

    expect(screen.getByText("2 of 10 Grade 11 students")).toBeInTheDocument();
  });

  it("collapses to the heading, keeping the filter bar visible", async () => {
    const user = userEvent.setup();
    renderTable({
      activeFilter: "info:address",
      activeFilterLabel: "Missing Address",
      filteredCount: 3,
    });

    await user.click(screen.getByRole("button", { name: /Hide/ }));

    expect(screen.queryByTestId("completeness-row-info")).not.toBeInTheDocument();
    expect(screen.getByTestId("completeness-filter-bar")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Show/ }));
    expect(screen.getByTestId("completeness-row-info")).toBeInTheDocument();
  });

  it("says the documents are still loading rather than counting them as gaps", () => {
    renderTable({
      completeness: {
        ...completeness,
        groups: completeness.groups.map((group) =>
          group.key === "documents"
            ? { ...group, pending: true, items: [], complete: [] }
            : group,
        ),
      },
    });

    expect(screen.getByText("Loading documents…")).toBeInTheDocument();
    expect(screen.queryByText("45%")).not.toBeInTheDocument();
  });

  it("says so when the documents read failed", () => {
    renderTable({ documentsError: true });

    expect(
      screen.getByText("Documents couldn't be loaded. Reload to try again."),
    ).toBeInTheDocument();
  });
});
