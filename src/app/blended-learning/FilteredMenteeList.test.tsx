import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { FilteredMenteeList } from "./FilteredMenteeList";

function mentee(studentId: number, name: string, overrides: Partial<MenteeRow> = {}): MenteeRow {
  return {
    studentId, name, gender: "Female", grade: 12, programId: 80, programName: "STP Voucher Delhi",
    lastContact: "2026-10-12", lastContactSource: "conversation", latestEntryKind: "conversation",
    openDraftState: null, reasons: [], daysSince: 10, lastAttemptOn: null, lastDurationMinutes: 25,
    ...overrides,
  };
}

const KABIR = mentee(1, "Kabir Never", {
  gender: "Male", grade: 13, lastContact: null, lastContactSource: null, latestEntryKind: null,
  reasons: ["no_contact"], daysSince: null, lastDurationMinutes: null,
});
const ZOYA = mentee(2, "Zoya TwentyNine", { daysSince: 29 });
const ROHAN = mentee(3, "Rohan Recent", { gender: "Male", daysSince: 3 });

function renderList() {
  render(<FilteredMenteeList list={{ talkToFirst: [KABIR], everyoneElse: [ZOYA, ROHAN] }} canLog today="2026-10-22" />);
}

function tableNames(): string[] {
  return within(screen.getByRole("table"))
    .queryAllByRole("link", { name: /^[A-Z][a-z]+ [A-Za-z]+$/ })
    .map((link) => link.textContent ?? "");
}

describe("FilteredMenteeList", () => {
  it("lays out search, Gender, Grade, Program and Last contact as one filter row, each select defaulting to All", () => {
    renderList();

    const filters = screen.getByRole("search", { name: "Filter students" });
    expect(within(filters).getByRole("searchbox", { name: "Search by name" })).toBeInTheDocument();
    for (const name of ["Gender", "Grade", "Program", "Last contact"]) {
      expect(within(filters).getByRole("combobox", { name })).toHaveDisplayValue("All");
    }
    expect(within(filters).queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("narrows to 30 days or more with the Last contact select, marking it active, and Clear filters restores all", async () => {
    const user = userEvent.setup();
    renderList();

    const lastContact = screen.getByRole("combobox", { name: "Last contact" });
    await user.selectOptions(lastContact, "30 days or more");

    expect(lastContact).toHaveClass("bg-hover-bg");
    expect(tableNames()).toEqual(["Kabir Never"]);
    expect(screen.queryByRole("rowgroup", { name: "Everyone else" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(lastContact).toHaveValue("");
    expect(tableNames()).toEqual(["Kabir Never", "Zoya TwentyNine", "Rohan Recent"]);
  });

  it("counts each group out of the filtered total", async () => {
    const user = userEvent.setup();
    renderList();

    expect(screen.getByRole("rowgroup", { name: "Everyone else" })).toHaveTextContent("2 of 3.");
    await user.selectOptions(screen.getByRole("combobox", { name: "Gender" }), "Male");

    expect(screen.getByRole("rowgroup", { name: "Talk to first" })).toHaveTextContent("1 of 2.");
    expect(screen.getByRole("rowgroup", { name: "Everyone else" })).toHaveTextContent("1 of 2.");
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByRole("searchbox", { name: "Search by name" }), "nobody");

    expect(screen.getByText("No students match these filters.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
