import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AllYearPage from "./AllYearPage";
import type { TestAttendanceMonthlyTest, TestAttendanceStudent } from "@/types/test-attendance";

// Window: August, September, October; November is running.
const monthlyTest = (key: string, name: string, state: "closed" | "running" = "closed", grades = [11, 12]): TestAttendanceMonthlyTest => ({
  key, name, shortName: name.slice(0, 3), opensAt: "2026-08-17T23:30:00.000Z", closesAt: "2026-08-22T18:25:00.000Z", state, grades,
});
const august = monthlyTest("august", "August");
const september = monthlyTest("september", "September");
const october = monthlyTest("october", "October");
const november = monthlyTest("november", "November", "running");
const monthlyTests = [august, september, october, november];

const students: TestAttendanceStudent[] = [
  { userId: "1", name: "Zoya Ali", studentId: "NVS1", apaarId: "111122223333", grade: 11, examPreparingFor: "Engineering", attendance: { august: "submitted", september: "submitted", october: "submitted", november: "submitted" } },
  { userId: "2", name: "Kiran Das", studentId: "NVS2", apaarId: null, grade: 12, examPreparingFor: "Medical", attendance: { august: "not_opened", september: "not_opened", october: "submitted", november: "not_opened" } },
  { userId: "3", name: "Neel Jha", studentId: null, apaarId: "333344445555", grade: 11, examPreparingFor: "Engineering", attendance: { august: "opened", september: "submitted", october: "opened", november: "not_opened" } },
  { userId: "4", name: "Asha Bose", studentId: "NVS4", apaarId: "444455556666", grade: 11, examPreparingFor: "Engineering", attendance: { august: "not_opened", september: "not_opened", october: "not_opened", november: "submitted" } },
  { userId: "5", name: "Bala Nair", studentId: "NVS5", apaarId: "555566667777", grade: 11, examPreparingFor: null, attendance: { august: "submitted", september: "opened", october: "submitted", november: "submitted" } },
  // Joined in November: counted for none of the window's tests.
  { userId: "6", name: "Omar Khan", studentId: "NVS6", apaarId: "666677778888", grade: 12, examPreparingFor: "Engineering", attendance: { november: "not_opened" } },
];

function renderAllYear(tests: TestAttendanceMonthlyTest[] = monthlyTests, list: TestAttendanceStudent[] = students) {
  const onDownload = vi.fn(async () => {});
  const user = userEvent.setup();
  render(<AllYearPage monthlyTests={tests} students={list} onDownload={onDownload} />);
  return { user, onDownload };
}

const tile = (name: string) => screen.getByRole("region", { name });
const table = () => screen.getByRole("table", { name: "All students" });
const rows = () => within(table()).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell");
const names = () => rows().map((row) => cells(row)[0].textContent);
const boxes = (row: HTMLElement) => within(row).getAllByRole("img").map((box) => box.getAttribute("aria-label"));
const listFilter = (name: string) => within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name });

describe("AllYearPage — tiles", () => {
  it("shows Enrolled, attendance over the window and Need follow-up", () => {
    renderAllYear();

    // Hand count. Sittings: five Students x 3 tests (Omar counted for none) = 15.
    // Attended: Zoya 3, Kiran 1, Neel 3, Asha 0, Bala 3 = 10 (67%). Opened, not submitted: Neel 2, Bala 1 = 3.
    // Follow Up: Asha, Kiran = 2 of 6.
    expect(within(tile("Enrolled")).getByText("6")).toBeInTheDocument();
    expect(tile("Attendance")).toHaveTextContent("67%");
    expect(tile("Attendance")).toHaveTextContent("10 of 15 sittings");
    expect(tile("Attendance")).toHaveTextContent("of these, 3 opened, not submitted");
    expect(tile("Need follow-up")).toHaveTextContent("2 of 6");
    expect(tile("Need follow-up")).toHaveTextContent("33%");
  });

  it("shows a dash, never 0%, when there is no sitting", () => {
    renderAllYear(monthlyTests, []);

    expect(tile("Attendance")).toHaveTextContent("—");
    expect(tile("Attendance")).toHaveTextContent("0 of 0 sittings");
    expect(tile("Need follow-up")).toHaveTextContent("—");
    expect(tile("Attendance")).not.toHaveTextContent("0%");
    expect(screen.getByText("No Students in this list.")).toBeInTheDocument();
  });
});

describe("AllYearPage — list", () => {
  it("lists Follow Up by pattern, then Not Submitting, then everyone else by grade and name, with tagged rows highlighted", () => {
    renderAllYear();

    expect(names()).toEqual(["Asha Bose", "Kiran Das", "Neel Jha", "Bala Nair", "Zoya Ali", "Omar Khan"]);
    const [asha, kiran, neel, bala] = rows();
    expect(asha).toHaveClass("bg-danger-bg");
    expect(kiran).toHaveClass("bg-danger-bg");
    expect(neel).toHaveClass("bg-warning-bg");
    expect(bala).not.toHaveClass("bg-danger-bg");
    expect(bala).not.toHaveClass("bg-warning-bg");
  });

  it("shows each Student's tag and note, the tag as a red or amber badge", () => {
    renderAllYear();

    expect(rows().map((row) => cells(row)[9].textContent)).toEqual([
      "Follow upMissed Aug, Sep, Oct",
      "Follow upMissed Aug, Sep · attended Oct",
      "Not submittingNot submitted Aug, Oct",
      "Not submitted Sep",
      "",
      "",
    ]);
    const [asha, , neel] = rows();
    expect(within(asha).getByText("Follow up")).toHaveClass("bg-danger-bg", "text-danger");
    expect(within(neel).getByText("Not submitting")).toHaveClass("bg-warning-bg", "text-warning-text");
  });

  it("colours a note red when it has a miss and amber when it has only non-submissions", () => {
    renderAllYear();

    expect(within(table()).getByText("Missed Aug, Sep, Oct")).toHaveClass("text-danger");
    expect(within(table()).getByText("Not submitted Sep")).toHaveClass("text-warning-text");
  });

  it("has the columns Student, Student ID, APAAR ID, Grade, Exam Preparing For, the window's months, Attended and Follow-up", () => {
    renderAllYear();

    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Student", "Student ID", "APAAR ID", "Grade", "Exam Preparing For", "Aug", "Sep", "Oct", "Attended", "Follow-up",
    ]);
    expect(rows().map((row) => [cells(row)[0].textContent, cells(row)[1].textContent, cells(row)[2].textContent])).toEqual([
      ["Asha Bose", "NVS4", "444455556666"],
      ["Kiran Das", "NVS2", "—"],
      ["Neel Jha", "—", "333344445555"],
      ["Bala Nair", "NVS5", "555566667777"],
      ["Zoya Ali", "NVS1", "111122223333"],
      ["Omar Khan", "NVS6", "666677778888"],
    ]);
    const [asha] = rows();
    expect(cells(asha)[1]).toHaveClass("font-mono", "whitespace-nowrap");
    expect(cells(asha)[2]).toHaveClass("font-mono", "whitespace-nowrap");
  });

  it("shows a month box for each window test: Absent, Opened, not submitted, Submitted, or not counted", () => {
    renderAllYear();

    const row = (name: string) => rows().find((r) => cells(r)[0].textContent === name)!;
    expect(boxes(row("Neel Jha"))).toEqual(["Aug: Opened, not submitted", "Sep: Submitted", "Oct: Opened, not submitted"]);
    expect(boxes(row("Kiran Das"))).toEqual(["Aug: Absent", "Sep: Absent", "Oct: Submitted"]);
    expect(boxes(row("Omar Khan"))).toEqual(["Aug: not counted", "Sep: not counted", "Oct: not counted"]);
  });

  it("shows Attended as x of y with a percentage, or a dash when counted for none", () => {
    renderAllYear();

    expect(rows().map((row) => cells(row)[8].textContent)).toEqual([
      "0 of 3 (0%)", "1 of 3 (33%)", "3 of 3 (100%)", "3 of 3 (100%)", "3 of 3 (100%)", "—",
    ]);
  });

  it("states the counted tests and the tag rules above the list", () => {
    renderAllYear();

    expect(
      screen.getByText(
        "Tags look at each Student's last 3 closed tests they are counted for (shown: Aug, Sep, Oct). November is added once it closes. Follow up: Absent in 2 or more of them. Not submitting: Opened, not submitted in 2 or more of them.",
      ),
    ).toBeInTheDocument();
  });

  it("filters the list to Need follow-up and to Not submitting", async () => {
    const { user } = renderAllYear();
    expect(within(screen.getByRole("group", { name: "Show Students" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All students",
      "Need follow-up",
      "Not submitting",
    ]);
    expect(listFilter("All students")).toHaveAttribute("aria-pressed", "true");

    await user.click(listFilter("Need follow-up"));
    expect(names()).toEqual(["Asha Bose", "Kiran Das"]);

    await user.click(listFilter("Not submitting"));
    expect(names()).toEqual(["Neel Jha"]);
  });

  it("judges each Student over their own last 3 counted tests, with four columns when a grade skipped a month", () => {
    // Grade 12 had no Paper in October. Closed: Aug, Sep, Oct, Nov; December is running.
    renderAllYear(
      [august, september, { ...october, grades: [11] }, { ...november, state: "closed" }, monthlyTest("december", "December", "running")],
      [
        { userId: "1", name: "Gita Rao", studentId: "NVS1", apaarId: "123456789012", grade: 12, examPreparingFor: "Medical", attendance: { august: "not_opened", september: "not_opened", november: "submitted" } },
        { userId: "2", name: "Hari Sen", studentId: "NVS2", apaarId: null, grade: 11, examPreparingFor: "Engineering", attendance: { august: "not_opened", september: "submitted", october: "submitted", november: "submitted" } },
      ],
    );

    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Student", "Student ID", "APAAR ID", "Grade", "Exam Preparing For", "Aug", "Sep", "Oct", "Nov", "Attended", "Follow-up",
    ]);
    const [gita, hari] = rows();
    expect(cells(gita)[0]).toHaveTextContent("Gita Rao");
    expect(boxes(gita)).toEqual(["Aug: Absent", "Sep: Absent", "Oct: not counted", "Nov: Submitted"]);
    // Hari was counted for August, but it is not in his last 3.
    expect(boxes(hari)).toEqual(["Aug: not counted", "Sep: Submitted", "Oct: Submitted", "Nov: Submitted"]);
    expect(cells(gita)[9]).toHaveTextContent("1 of 3 (33%)");
    expect(cells(gita)[10]).toHaveTextContent("Follow upMissed Aug, Sep · attended Nov");
    expect(gita).toHaveClass("bg-danger-bg");
    expect(tile("Need follow-up")).toHaveTextContent("1 of 2");
    expect(
      screen.getByText(
        "Tags look at each Student's last 3 closed tests they are counted for (shown: Aug, Sep, Oct, Nov). December is added once it closes. Follow up: Absent in 2 or more of them. Not submitting: Opened, not submitted in 2 or more of them.",
      ),
    ).toBeInTheDocument();
  });

  it("lays the same rows out as cards for phones, in the same order, tinted and with the same month boxes", async () => {
    const { user } = renderAllYear();
    await user.click(listFilter("Need follow-up"));

    const cards = within(screen.getByRole("list", { name: "All students" })).getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      "Asha BoseStudent ID NVS4 · APAAR ID 444455556666Grade 11 · EngineeringFollow upAugSepOctAttended 0 of 3 (0%)Missed Aug, Sep, Oct",
      "Kiran DasStudent ID NVS2 · APAAR ID —Grade 12 · MedicalFollow upAugSepOctAttended 1 of 3 (33%)Missed Aug, Sep · attended Oct",
    ]);
    expect(boxes(cards[1])).toEqual(["Aug: Absent", "Sep: Absent", "Oct: Submitted"]);
    expect(cards[0].querySelector(".bg-danger-bg")).not.toBeNull();
  });

  it("downloads the list under the list filter on screen", async () => {
    const { user, onDownload } = renderAllYear();

    await user.click(listFilter("Not submitting"));
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(onDownload).toHaveBeenCalledWith("not_submitting");
  });
});

describe("AllYearPage — chart and before the first closed test", () => {
  it("shows the chart of the Students it is given between the tiles and the list", () => {
    renderAllYear();

    const chart = screen.getByRole("region", { name: "Attendance by Monthly Test" });
    expect(within(chart).getAllByRole("listitem").map((bar) => bar.textContent)).toEqual([
      "Aug60%3 of 51 not submitted",
      "Sep60%3 of 51 not submitted",
      "Oct80%4 of 51 not submitted",
      "Nov so far50%3 of 60 not submitted",
    ]);
    expect(tile("Need follow-up").compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chart.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows Enrolled, the running month so far and no list or Download when no test has closed yet", () => {
    renderAllYear([november]);

    expect(within(tile("Enrolled")).getByText("6")).toBeInTheDocument();
    expect(screen.getByText("Attendance and tags appear once a Monthly Test closes.")).toBeInTheDocument();
    const chart = screen.getByRole("region", { name: "Attendance by Monthly Test" });
    expect(within(chart).getAllByRole("listitem").map((bar) => bar.textContent)).toEqual(["Nov so far50%3 of 60 not submitted"]);
    expect(screen.queryByRole("region", { name: "Attendance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Need follow-up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "All students" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });
});
