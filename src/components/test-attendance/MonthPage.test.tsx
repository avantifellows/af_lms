import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MonthPage from "./MonthPage";
import type { TestAttendanceMonthlyTest, TestAttendanceStudent } from "@/types/test-attendance";

// A running November and a closed October, Grades 11 and 12, counted by hand.
// Ekta (Grade 12) has no November mark: November has no Grade 12 Paper.
const october: TestAttendanceMonthlyTest = {
  key: "october", name: "October", shortName: "Oct",
  opensAt: "2026-10-05T23:30:00.000Z", closesAt: "2026-10-10T18:25:00.000Z", state: "closed", grades: [11, 12],
};
const november: TestAttendanceMonthlyTest = {
  key: "november", name: "November", shortName: "Nov",
  opensAt: "2026-11-16T23:30:00.000Z", closesAt: "2026-11-21T18:25:00.000Z", state: "running", grades: [11],
};
const monthlyTests = [october, november];

const students: TestAttendanceStudent[] = [
  { userId: "1", name: "Zara Khan", studentId: "NVS1", apaarId: "111122223333", grade: 11, examPreparingFor: "Engineering", attendance: { october: "submitted", november: "submitted" } },
  { userId: "2", name: "Arun Mehta", studentId: "NVS2", apaarId: null, grade: 11, examPreparingFor: null, attendance: { october: "not_opened", november: "not_opened" } },
  { userId: "3", name: "Bina Shah", studentId: "NVS3", apaarId: "333344445555", grade: 11, examPreparingFor: "Medical", attendance: { october: "opened", november: "opened" } },
  { userId: "4", name: "Charu Pal", studentId: null, apaarId: "444455556666", grade: 11, examPreparingFor: "NDA", attendance: { october: "submitted", november: "not_opened" } },
  { userId: "5", name: "Ekta Jain", studentId: "NVS5", apaarId: "555566667777", grade: 12, examPreparingFor: "CLAT", attendance: { october: "not_opened" } },
];

function renderMonth(test: TestAttendanceMonthlyTest, list: TestAttendanceStudent[] = students) {
  const onDownload = vi.fn(async () => {});
  const user = userEvent.setup();
  render(<MonthPage test={test} monthlyTests={monthlyTests} students={list} onDownload={onDownload} />);
  return { user, onDownload };
}

const tile = (name: string) => screen.getByRole("region", { name });

/** The Students table's rows as cell text (the table is what `sm` and wider show). */
function studentRows() {
  return within(screen.getByRole("table", { name: "Students" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
}

function groupRows() {
  return within(screen.getByRole("table", { name: "By grade and Exam Preparing For" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => [
      within(row).getByRole("rowheader").textContent,
      ...within(row).getAllByRole("cell").map((cell) => cell.textContent),
    ]);
}

const listFilter = (name: string) => within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name });

describe("MonthPage — tiles", () => {
  it("shows Enrolled, Submitted, In progress and Yet to start for a running month", () => {
    renderMonth(november);

    // Counted for November: the four Grade 11 Students.
    expect(tile("Enrolled")).toHaveTextContent("4");
    expect(tile("Enrolled")).toHaveTextContent("Attended 2 of 4 (50%)");
    expect(tile("Submitted")).toHaveTextContent("1 of 4");
    expect(tile("Submitted")).toHaveTextContent("25%");
    expect(tile("In progress")).toHaveTextContent("1 of 4");
    expect(tile("Yet to start")).toHaveTextContent("2 of 4");
    expect(tile("Yet to start")).toHaveTextContent("50%");
  });

  it("shows Enrolled, Submitted, Opened, not submitted and Absent for a closed month", () => {
    renderMonth(october);

    // Counted for October: all five.
    expect(tile("Enrolled")).toHaveTextContent("5");
    expect(tile("Enrolled")).toHaveTextContent("Attended 3 of 5");
    expect(tile("Submitted")).toHaveTextContent("2 of 5");
    expect(tile("Submitted")).toHaveTextContent("40%");
    expect(tile("Opened, not submitted")).toHaveTextContent("1 of 5");
    expect(tile("Absent")).toHaveTextContent("2 of 5");
    expect(screen.queryByRole("region", { name: "In progress" })).not.toBeInTheDocument();
  });

  it("shows a dash, never 0%, when nobody is counted for the month", () => {
    renderMonth(november, [students[4]]);

    expect(tile("Submitted")).toHaveTextContent("0 of 0");
    expect(tile("Submitted")).toHaveTextContent("—");
    expect(tile("Submitted")).not.toHaveTextContent("0%");
  });
});

describe("MonthPage — Students list", () => {
  it("opens a running month's list on Yet to start, by grade then name, with the list filters in order", () => {
    renderMonth(november);

    expect(within(screen.getByRole("group", { name: "Show Students" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Yet to start",
      "In progress",
      "Submitted",
      "All",
    ]);
    expect(listFilter("Yet to start")).toHaveAttribute("aria-pressed", "true");
    expect(studentRows()).toEqual([
      ["Arun Mehta", "NVS2", "—", "11", "Not set", "Yet to start", "Missed Oct"],
      ["Charu Pal", "—", "444455556666", "11", "NDA", "Yet to start", ""],
    ]);
  });

  it("opens a closed month's list on Absent", () => {
    renderMonth(october);

    expect(within(screen.getByRole("group", { name: "Show Students" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Absent",
      "Opened, not submitted",
      "Submitted",
      "All",
    ]);
    expect(listFilter("Absent")).toHaveAttribute("aria-pressed", "true");
    expect(studentRows()).toEqual([
      ["Arun Mehta", "NVS2", "—", "11", "Not set", "Absent", ""],
      ["Ekta Jain", "NVS5", "555566667777", "12", "CLAT", "Absent", ""],
    ]);
  });

  it("shows the Students in progress in one click", async () => {
    const { user } = renderMonth(november);
    await user.click(listFilter("In progress"));

    expect(listFilter("In progress")).toHaveAttribute("aria-pressed", "true");
    expect(studentRows()).toEqual([["Bina Shah", "NVS3", "333344445555", "11", "Medical", "In progress", "Not submitted Oct"]]);
  });

  it("shows every counted Student under All", async () => {
    const { user } = renderMonth(october);
    await user.click(listFilter("All"));

    expect(studentRows()).toEqual([
      ["Arun Mehta", "NVS2", "—", "11", "Not set", "Absent", ""],
      ["Bina Shah", "NVS3", "333344445555", "11", "Medical", "Opened, not submitted", ""],
      ["Charu Pal", "—", "444455556666", "11", "NDA", "Submitted", ""],
      ["Zara Khan", "NVS1", "111122223333", "11", "Engineering", "Submitted", ""],
      ["Ekta Jain", "NVS5", "555566667777", "12", "CLAT", "Absent", ""],
    ]);
  });

  it("says so when nobody is in the list", async () => {
    const { user } = renderMonth(october, [students[0]]);

    expect(screen.getByText("No Students in this list.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Students" })).not.toBeInTheDocument();
    await user.click(listFilter("Submitted"));
    expect(studentRows()).toEqual([["Zara Khan", "NVS1", "111122223333", "11", "Engineering", "Submitted", ""]]);
  });

  it("has the columns Student, Student ID, APAAR ID, Grade, Exam Preparing For, Status and Previous 3 tests", () => {
    renderMonth(november);

    const table = screen.getByRole("table", { name: "Students" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Student",
      "Student ID",
      "APAAR ID",
      "Grade",
      "Exam Preparing For",
      "Status",
      "Previous 3 tests",
    ]);
    const firstRowCells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
    expect(firstRowCells[1]).toHaveClass("font-mono", "whitespace-nowrap");
    expect(firstRowCells[2]).toHaveClass("font-mono", "whitespace-nowrap");
  });

  it("notes the earlier tests a Student missed or did not submit, red with a miss and amber without", async () => {
    const { user } = renderMonth(november);
    await user.click(listFilter("All"));

    // November's window is October, the one closed Monthly Test before it.
    expect(studentRows()).toEqual([
      ["Arun Mehta", "NVS2", "—", "11", "Not set", "Yet to start", "Missed Oct"],
      ["Bina Shah", "NVS3", "333344445555", "11", "Medical", "In progress", "Not submitted Oct"],
      ["Charu Pal", "—", "444455556666", "11", "NDA", "Yet to start", ""],
      ["Zara Khan", "NVS1", "111122223333", "11", "Engineering", "Submitted", ""],
    ]);
    const table = screen.getByRole("table", { name: "Students" });
    expect(within(table).getByText("Missed Oct")).toHaveClass("text-danger");
    expect(within(table).getByText("Not submitted Oct")).toHaveClass("text-warning-text");
  });

  it("leaves Previous 3 tests blank on the first Monthly Test of the year", async () => {
    const { user } = renderMonth(october);
    await user.click(listFilter("All"));

    expect(studentRows().map((row) => row[6])).toEqual(["", "", "", "", ""]);
  });

  it("shows 25 rows, then all of them after Show all, and 25 again after the list filter changes", async () => {
    const many: TestAttendanceStudent[] = Array.from({ length: 30 }, (_, i) => ({
      userId: String(100 + i),
      name: `Student ${String(i + 1).padStart(2, "0")}`,
      studentId: null,
      apaarId: null,
      grade: 11,
      examPreparingFor: "Engineering",
      attendance: { november: i < 28 ? "not_opened" : "submitted" },
    }));
    const { user } = renderMonth(november, many);

    expect(studentRows()).toHaveLength(25);
    expect(studentRows()[24][0]).toBe("Student 25");
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(studentRows()).toHaveLength(28);
    expect(studentRows()[27][0]).toBe("Student 28");
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();

    await user.click(listFilter("All"));
    expect(studentRows()).toHaveLength(25);
    expect(screen.getByRole("button", { name: "Show all" })).toBeInTheDocument();
  });

  it("lays the same rows out as cards for phones, in the same order", async () => {
    const { user } = renderMonth(november);
    await user.click(listFilter("All"));

    const cards = within(screen.getByRole("list", { name: "Students" })).getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      "Arun MehtaYet to startStudent ID NVS2 · APAAR ID —Grade 11 · Not setPrevious 3 tests: Missed Oct",
      "Bina ShahIn progressStudent ID NVS3 · APAAR ID 333344445555Grade 11 · MedicalPrevious 3 tests: Not submitted Oct",
      "Charu PalYet to startStudent ID — · APAAR ID 444455556666Grade 11 · NDA",
      "Zara KhanSubmittedStudent ID NVS1 · APAAR ID 111122223333Grade 11 · Engineering",
    ]);
  });

  it("downloads the list under the list filter on screen", async () => {
    const { user, onDownload } = renderMonth(november);

    await user.click(screen.getByRole("button", { name: "Download" }));
    await user.click(listFilter("In progress"));
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(onDownload.mock.calls).toEqual([["not_opened"], ["opened"]]);
  });
});

describe("MonthPage — by grade and Exam Preparing For", () => {
  it("shows one row per group for a closed month, Grade 11 first, in group order", () => {
    renderMonth(october);

    const table = screen.getByRole("table", { name: "By grade and Exam Preparing For" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Group",
      "Submitted",
      "Opened, not submitted",
      "Absent",
    ]);
    expect(groupRows()).toEqual([
      ["Grade 11 · Engineering", "1 of 1 (100%)", "0", "0"],
      ["Grade 11 · Medical", "0 of 1 (0%)", "1", "0"],
      ["Grade 11 · NDA", "1 of 1 (100%)", "0", "0"],
      ["Grade 11 · Not set", "0 of 1 (0%)", "0", "1"],
      ["Grade 12 · CLAT", "0 of 1 (0%)", "0", "1"],
    ]);
  });

  it("shows In progress and Yet to start for a running month, with a two-part bar per row", () => {
    renderMonth(november);

    const table = screen.getByRole("table", { name: "By grade and Exam Preparing For" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Group",
      "Submitted",
      "In progress",
      "Yet to start",
    ]);
    // November has no Grade 12 Paper, so Ekta's group has no row.
    expect(groupRows()).toEqual([
      ["Grade 11 · Engineering", "1 of 1 (100%)", "0", "0"],
      ["Grade 11 · Medical", "0 of 1 (0%)", "1", "0"],
      ["Grade 11 · NDA", "0 of 1 (0%)", "0", "1"],
      ["Grade 11 · Not set", "0 of 1 (0%)", "0", "1"],
    ]);
    expect(within(table).getByRole("img", { name: "Grade 11 · Medical: 0 submitted, 1 in progress, of 1" })).toBeInTheDocument();
  });

  it("lays the group rows out as cards for phones", () => {
    renderMonth(november);

    const cards = within(screen.getByRole("list", { name: "By grade and Exam Preparing For" })).getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      "Grade 11 · EngineeringSubmitted 1 of 1 (100%)In progress 0 · Yet to start 0",
      "Grade 11 · MedicalSubmitted 0 of 1 (0%)In progress 1 · Yet to start 0",
      "Grade 11 · NDASubmitted 0 of 1 (0%)In progress 0 · Yet to start 1",
      "Grade 11 · Not setSubmitted 0 of 1 (0%)In progress 0 · Yet to start 1",
    ]);
    expect(within(cards[1]).getByRole("img", { name: "Grade 11 · Medical: 0 submitted, 1 in progress, of 1" })).toBeInTheDocument();
  });

  it("shows no group rows when nobody is counted", () => {
    renderMonth(november, [students[4]]);

    expect(screen.queryByRole("table", { name: "By grade and Exam Preparing For" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "By grade and Exam Preparing For" })).not.toBeInTheDocument();
  });

  it("sits between the tiles and the Students list", () => {
    renderMonth(october);

    const block = screen.getByRole("table", { name: "By grade and Exam Preparing For" });
    expect(tile("Absent").compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      block.compareDocumentPosition(screen.getByRole("table", { name: "Students" })) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
