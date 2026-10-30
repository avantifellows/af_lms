import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { MenteeGroups, type MenteeGroupView } from "./MenteeList";

const TODAY = "2026-10-22";

const KABIR: MenteeRow = {
  studentId: 489985, programStudentId: null, category: null, name: "Kabir Never", gender: "Male", grade: 12, programId: 80,
  programName: "STP Voucher Delhi", lastContact: null, lastContactSource: null, latestEntryKind: null,
  openDraftState: "ready", reasons: ["no_contact"], daysSince: null, lastAttemptOn: null,
};
const IRA: MenteeRow = {
  studentId: 501, programStudentId: "00123456", category: "Gen-EWS", name: "Ira Attempt", gender: "Female", grade: 12, programId: 80,
  programName: "STP Voucher Delhi", lastContact: "2026-10-12", lastContactSource: "conversation",
  latestEntryKind: "attempt", openDraftState: null, reasons: ["attempt"], daysSince: 10,
  lastAttemptOn: "2026-10-20",
};
const MEERA: MenteeRow = {
  ...IRA, studentId: 502, name: "Meera Thirty", latestEntryKind: "conversation", reasons: ["gap_30"],
  lastContact: "2026-09-22", daysSince: 30, lastAttemptOn: null,
};
const NIKHIL: MenteeRow = {
  ...IRA, studentId: 503, name: "Nikhil Legacy", gender: "Male", grade: 13, latestEntryKind: null,
  reasons: ["gap_30"], lastContact: "2026-06-14", lastContactSource: "legacy", daysSince: 130,
  lastAttemptOn: null,
};
const ROHAN: MenteeRow = {
  ...IRA, studentId: 504, name: "Rohan Recent", gender: "Male", latestEntryKind: "conversation", reasons: [],
  lastContact: "2026-10-21", daysSince: 1, lastAttemptOn: null,
};

function groups(talkToFirst: MenteeRow[], everyoneElse: MenteeRow[] = []): MenteeGroupView[] {
  return [
    { title: "Talk to first", description: "Not reachable on the last try.", mentees: talkToFirst },
    { title: "Everyone else", description: "", mentees: everyoneElse },
  ];
}

function renderList(canLog: boolean, talkToFirst: MenteeRow[] = [KABIR], everyoneElse: MenteeRow[] = []) {
  render(<MenteeGroups groups={groups(talkToFirst, everyoneElse)} canLog={canLog} today={TODAY} />);
}

function tableGroup(name: string) {
  return within(screen.getByRole("table")).getByRole("rowgroup", { name });
}

function tableRow(name: string) {
  return within(screen.getByRole("table")).getByRole("link", { name }).closest("tr") as HTMLElement;
}

describe("MenteeGroups — one table with group header rows", () => {
  it("puts both groups in one table under one header row, with the mockup's column order", () => {
    renderList(true, [IRA], [ROHAN]);

    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Student", "Student ID", "Category", "Why now", "Grade", "Program", "Gender", "Last talked",
      "Actions",
    ]);
    expect(tableGroup("Talk to first")).toHaveTextContent("Talk to firstNot reachable on the last try. 1 of 2.");
    expect(tableGroup("Everyone else")).toHaveTextContent("Everyone else1 of 2.");
    expect(within(tableGroup("Talk to first")).getAllByRole("row")).toHaveLength(2);
  });

  it("leaves out a group with no Students", () => {
    renderList(true, [], [ROHAN]);

    expect(within(screen.getByRole("table")).queryByRole("rowgroup", { name: "Talk to first" })).toBeNull();
    expect(tableGroup("Everyone else")).toHaveTextContent("1 of 1.");
  });

  it("shows Student ID and category columns after the name, then Why now, grade, program, gender and last talked, with no duration", () => {
    renderList(true, [IRA]);

    const cells = within(tableRow("Ira Attempt")).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      "Ira Attempt", "00123456", "Gen-EWS", "Unreachable · 20 Oct", "12", "Voucher DL",
      "Female", "12 Oct10 days ago", "ViewNew log",
    ]);
    expect(within(tableRow("Ira Attempt")).getByText("00123456")).toHaveClass("font-mono");
  });

  it("shows a dash for a missing Student ID or category", () => {
    renderList(true, [KABIR]);

    const cells = within(tableRow("Kabir Never")).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells.slice(0, 3)).toEqual(["Kabir Never", "—", "—"]);
  });
});

describe("MenteeGroups — Why now and last conversation copy", () => {
  it("dates the failed try in red, and counts the days since contact", () => {
    renderList(true, [IRA, MEERA]);

    const ira = within(tableRow("Ira Attempt")).getByText("Unreachable · 20 Oct");
    expect(ira).toHaveClass("bg-danger-bg", "whitespace-nowrap");
    expect(within(tableRow("Meera Thirty")).getByText("No contact · 30 days")).toHaveClass("bg-warning-bg");
  });

  it("says when a Student has no conversation yet, with Never for the last one", () => {
    renderList(true, [KABIR]);

    const kabir = within(tableRow("Kabir Never"));
    expect(kabir.getByText("No conversation")).toBeInTheDocument();
    expect(kabir.getByText("Never")).toBeInTheDocument();
  });

  it("shows a pre-app legacy date as its day, marked before app, and counts days from it", () => {
    renderList(true, [NIKHIL]);

    const nikhil = within(tableRow("Nikhil Legacy"));
    expect(nikhil.getByText("No contact · 130 days")).toBeInTheDocument();
    expect(nikhil.getByText(/^14 Jun/)).toBeInTheDocument();
    expect(nikhil.getByText("before app")).toBeInTheDocument();
  });

  it("says Yesterday for a conversation one day ago", () => {
    renderList(true, [], [ROHAN]);
    expect(within(tableRow("Rohan Recent")).getByText("Yesterday")).toBeInTheDocument();
  });
});

describe("MenteeGroups — a ready draft's chip", () => {
  it("opens the draft on the log page for a viewer who can log", () => {
    renderList(true);

    // The table (1024 px up) and the cards (below) each carry the chip.
    const chips = screen.getAllByRole("link", { name: "Draft ready to review" });
    expect(chips).toHaveLength(2);
    for (const chip of chips) expect(chip).toHaveAttribute("href", "/blended-learning/students/489985/log");
  });

  it("is a plain label for a read-only viewer, not a link into a form they can't use (QA-14)", () => {
    renderList(false);

    expect(screen.queryByRole("link", { name: "Draft ready to review" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Draft ready to review")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Kabir Never" })[0]).toHaveAttribute(
      "href",
      "/blended-learning/students/489985"
    );
  });
});

describe("MenteeGroups — row actions", () => {
  it("gives a viewer who can log View and New log text buttons per Student, and the name opens the Student", () => {
    renderList(true);

    const logLinks = screen.getAllByRole("link", { name: "New log for Kabir Never" });
    expect(logLinks).toHaveLength(2);
    for (const link of logLinks) {
      expect(link).toHaveAttribute("href", "/blended-learning/students/489985/log");
      expect(link).toHaveTextContent("New log");
      expect(link).toHaveClass("min-h-11", "bg-accent");
      expect(link.querySelector("svg")).not.toBeNull();
    }
    for (const link of screen.getAllByRole("link", { name: "View Kabir Never" })) {
      expect(link).toHaveAttribute("href", "/blended-learning/students/489985");
      expect(link).toHaveTextContent("View");
      expect(link).toHaveClass("min-h-11", "border-border");
    }
    // In the table the labels show from 1280 px; below that each is a 44 px
    // icon button named by its aria-label.
    const [tableView] = screen.getAllByRole("link", { name: "View Kabir Never" });
    expect(tableView).toHaveClass("min-w-11");
    expect(within(tableView).getByText("View")).toHaveClass("hidden", "xl:inline");
    // The name's link covers the whole row or card.
    const [rowName, cardName] = screen.getAllByRole("link", { name: "Kabir Never" });
    expect(rowName).toHaveAttribute("href", "/blended-learning/students/489985");
    expect(rowName.closest("tr")).toHaveClass("relative");
    expect(cardName.closest("li")).toHaveClass("relative");
  });

  it("offers a viewer who can't log View alone, with no New log at all", () => {
    renderList(false);

    expect(screen.queryByRole("link", { name: /New log/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New log/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View Kabir Never" })).toHaveLength(2);
  });
});

describe("MenteeGroups — phone cards", () => {
  it("renders a labelled card per Student inside its group", () => {
    renderList(true, [IRA], [ROHAN]);

    const talkToFirst = screen.getByRole("region", { name: "Talk to first" });
    const card = within(talkToFirst).getByRole("listitem");
    expect(card).toHaveTextContent("Ira AttemptID 00123456Category Gen-EWS");
    expect(within(card).getByText("00123456")).toHaveClass("font-mono");
    expect(card).toHaveTextContent("Unreachable · 20 Oct");
    expect(card).toHaveTextContent("ProgramVoucher DL");
    expect(card).toHaveTextContent("Grade12");
    expect(card).toHaveTextContent("GenderFemale");
    expect(card).toHaveTextContent("Last talked12 Oct10 days ago");
    expect(card).not.toHaveTextContent("Duration");
    expect(card).toHaveTextContent("ViewNew log");
    expect(within(screen.getByRole("region", { name: "Everyone else" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows a dash for a missing Student ID or category on the card's line", () => {
    renderList(true, [KABIR]);

    const card = within(screen.getByRole("region", { name: "Talk to first" })).getByRole("listitem");
    expect(card).toHaveTextContent("Kabir NeverID —Category —");
  });
});
