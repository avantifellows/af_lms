import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchableMultiSelect } from "./SearchableMultiSelect";

const REGIONS = [
  { value: "Bhopal", label: "Bhopal" },
  { value: "Chandigarh", label: "Chandigarh" },
  { value: "Hyderabad", label: "Hyderabad" },
  { value: "__none__", label: "No region (non-JNV)" },
];

function renderRegions(selected: string[] = [], onChange = vi.fn()) {
  render(
    <SearchableMultiSelect
      label="Region"
      options={REGIONS}
      selected={selected}
      allLabel="All regions"
      pluralNoun="regions"
      onChange={onChange}
    />
  );
  return onChange;
}

function regionGroup() {
  return screen.getByRole("group", { name: "Region" });
}

function toggleButton() {
  return within(regionGroup()).getByRole("button");
}

function optionNames() {
  return within(regionGroup())
    .getAllByRole("checkbox")
    .map((checkbox) => checkbox.getAttribute("aria-label") ?? checkbox.closest("label")?.textContent);
}

describe("SearchableMultiSelect", () => {
  describe("button text", () => {
    it("reads the all label when nothing is selected", () => {
      renderRegions([]);
      expect(toggleButton()).toHaveTextContent("All regions");
    });

    it("reads the single selected option's label", () => {
      renderRegions(["__none__"]);
      expect(toggleButton()).toHaveTextContent("No region (non-JNV)");
    });

    it("reads the count and plural noun when several are selected", () => {
      renderRegions(["Bhopal", "Hyderabad"]);
      expect(toggleButton()).toHaveTextContent("2 regions");
    });
  });

  describe("options", () => {
    it("stay closed until the button is pressed", () => {
      renderRegions();

      expect(toggleButton()).toHaveAttribute("aria-expanded", "false");
      expect(within(regionGroup()).queryAllByRole("checkbox")).toHaveLength(0);

      fireEvent.click(toggleButton());

      expect(toggleButton()).toHaveAttribute("aria-expanded", "true");
      expect(optionNames()).toEqual(["Bhopal", "Chandigarh", "Hyderabad", "No region (non-JNV)"]);
    });

    it("list the selected options first, ticked", () => {
      renderRegions(["Hyderabad", "__none__"]);
      fireEvent.click(toggleButton());

      expect(optionNames()).toEqual(["Hyderabad", "No region (non-JNV)", "Bhopal", "Chandigarh"]);
      expect(screen.getByRole("checkbox", { name: "Hyderabad" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "No region (non-JNV)" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Bhopal" })).not.toBeChecked();
    });

    it("report the new selection when an option is ticked or unticked", () => {
      const onChange = renderRegions(["Hyderabad"]);
      fireEvent.click(toggleButton());

      fireEvent.click(screen.getByRole("checkbox", { name: "Bhopal" }));
      expect(onChange).toHaveBeenLastCalledWith(["Hyderabad", "Bhopal"]);

      fireEvent.click(screen.getByRole("checkbox", { name: "Hyderabad" }));
      expect(onChange).toHaveBeenLastCalledWith([]);
    });
  });

  describe("search", () => {
    it("filters options case-insensitively and keeps selected matches first", () => {
      renderRegions(["Hyderabad"]);
      fireEvent.click(toggleButton());

      fireEvent.change(screen.getByRole("searchbox", { name: "Search Region" }), { target: { value: "H" } });

      expect(optionNames()).toEqual(["Hyderabad", "Bhopal", "Chandigarh"]);
      expect(screen.getByRole("checkbox", { name: "Hyderabad" })).toBeChecked();
    });

    it("says so when nothing matches", () => {
      renderRegions();
      fireEvent.click(toggleButton());

      fireEvent.change(screen.getByRole("searchbox", { name: "Search Region" }), { target: { value: "zzz" } });

      expect(within(regionGroup()).queryAllByRole("checkbox")).toHaveLength(0);
      expect(within(regionGroup()).getByText("No matches")).toBeInTheDocument();
    });
  });

  describe("keyboard", () => {
    it("focuses the search box on open and closes on Escape, returning focus to the button", () => {
      renderRegions();
      fireEvent.click(toggleButton());

      const search = screen.getByRole("searchbox", { name: "Search Region" });
      expect(search).toHaveFocus();

      fireEvent.keyDown(search, { key: "Escape" });

      expect(toggleButton()).toHaveAttribute("aria-expanded", "false");
      expect(toggleButton()).toHaveFocus();
    });
  });
});
