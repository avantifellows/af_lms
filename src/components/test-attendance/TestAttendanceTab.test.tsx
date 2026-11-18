import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TestAttendanceTab from "./TestAttendanceTab";

const mockFetch = vi.fn();

const threeStudents = {
  monthlyTests: [],
  students: [
    { userId: "10", name: "Nisha Rao", studentId: "NVS001", grade: 11, examPreparingFor: "Engineering", attendance: {} },
    { userId: "12", name: "Ravi Das", studentId: "NVS003", grade: 11, examPreparingFor: null, attendance: {} },
    { userId: "14", name: "Maya Iyer", studentId: "NVS002", grade: 12, examPreparingFor: "Medical", attendance: {} },
  ],
  serverTime: "2026-11-18T08:30:00.000Z",
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const failed = (status: number) => ({ ok: false, status, json: async () => ({ error: "Failed to load Test Attendance" }) });

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TestAttendanceTab", () => {
  it("loads the School's Test Attendance and shows the Enrolled count", async () => {
    mockFetch.mockResolvedValue(ok(threeStudents));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    const enrolled = await screen.findByRole("region", { name: "Enrolled" });
    expect(within(enrolled).getByText("3")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/school/24120100101/test-attendance");
  });

  it("says there are no Monthly Tests yet when none has opened", async () => {
    mockFetch.mockResolvedValue(ok(threeStudents));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    expect(await screen.findByText("No Monthly Tests yet")).toBeInTheDocument();
  });

  it.each([
    ["an error status", () => mockFetch.mockResolvedValueOnce(failed(500))],
    ["a network failure", () => mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
  ])("shows an error panel, never zeros, after %s", async (_label, fail) => {
    fail();

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load Test Attendance");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Enrolled" })).not.toBeInTheDocument();
    expect(screen.queryByText("No Monthly Tests yet")).not.toBeInTheDocument();
  });

  it("loads again on Retry", async () => {
    mockFetch.mockResolvedValueOnce(failed(500)).mockResolvedValueOnce(ok(threeStudents));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" />);
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    const enrolled = await screen.findByRole("region", { name: "Enrolled" });
    expect(within(enrolled).getByText("3")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// Monthly Tests as the endpoint returns them: ordered by closing time, UTC.
const july = {
  key: "july", name: "July", shortName: "Jul",
  opensAt: "2026-07-21T23:30:00.000Z", closesAt: "2026-07-28T18:15:00.000Z", state: "closed", grades: [12],
};
const october = {
  key: "october", name: "October", shortName: "Oct",
  opensAt: "2026-10-05T23:30:00.000Z", closesAt: "2026-10-10T18:25:00.000Z", state: "closed", grades: [11, 12],
};
// Closes 21 Nov 2026, 11:55 pm IST.
const november = {
  key: "november", name: "November", shortName: "Nov",
  opensAt: "2026-11-16T23:30:00.000Z", closesAt: "2026-11-21T18:25:00.000Z", state: "running", grades: [11, 12],
};

const withTests = (serverTime: string, monthlyTests: unknown[] = [july, october, november]) => ({
  ...threeStudents,
  monthlyTests,
  serverTime,
});

async function periodButtons() {
  const strip = await screen.findByRole("group", { name: "Period" });
  return within(strip).getAllByRole("button");
}

describe("TestAttendanceTab — period strip", () => {
  it("lists All year first, then the months newest first, with the running month marked live", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    const buttons = await periodButtons();
    expect(buttons.map((b) => b.textContent)).toEqual(["All year", "November live", "October", "July"]);
  });

  it("opens on the running month", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    expect(await screen.findByRole("button", { name: "November live" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All year" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("November tests are running. They close on 21 Nov at 11:55 pm")).toBeInTheDocument();
  });

  it.each([
    // Opens 18 Nov, closes 20 Nov: opened after November, closes before it.
    ["closes first", { opensAt: "2026-11-17T23:30:00.000Z", closesAt: "2026-11-20T18:25:00.000Z" }, ["retest", "november"]],
    // Opens 18 Nov, closes 23 Nov: opened after November, closes after it.
    ["closes last", { opensAt: "2026-11-17T23:30:00.000Z", closesAt: "2026-11-23T18:25:00.000Z" }, ["november", "retest"]],
  ])("opens on the running month that opened last when two are running and it %s", async (_label, times, order) => {
    const retest = { ...november, key: "retest", name: "Retest", shortName: "Ret", ...times };
    const running = { november, retest };
    mockFetch.mockResolvedValue(
      ok(withTests("2026-11-18T08:30:00.000Z", [july, october, ...order.map((key) => running[key as keyof typeof running])])),
    );

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    expect(await screen.findByRole("button", { name: "Retest live" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "November live" })).toHaveAttribute("aria-pressed", "false");
  });

  it("opens on All year with the Enrolled count when no Monthly Test is running", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z", [july, october])));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    expect(await screen.findByRole("button", { name: "All year" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("region", { name: "Enrolled" })).getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("No Monthly Tests yet")).not.toBeInTheDocument();
  });

  it("opens a closed month in one click and says its tests have closed", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" />);
    await user.click(await screen.findByRole("button", { name: "October" }));

    expect(screen.getByRole("button", { name: "October" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All year" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("October tests have closed.")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("goes back to All year in one click", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" />);
    await user.click(await screen.findByRole("button", { name: "October" }));
    await user.click(screen.getByRole("button", { name: "All year" }));

    expect(screen.queryByText("October tests have closed.")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Enrolled" })).toBeInTheDocument();
  });

  it.each([
    // 21 Nov, 2:00 pm IST: closes the same IST day.
    ["today", "2026-11-21T08:30:00.000Z", "November tests are running. They close today at 11:55 pm"],
    // 21 Nov, 12:30 am IST (still 20 Nov in UTC): closes the same IST day.
    ["today just after IST midnight", "2026-11-20T19:00:00.000Z", "November tests are running. They close today at 11:55 pm"],
    // 20 Nov, 2:00 pm IST.
    ["tomorrow", "2026-11-20T08:30:00.000Z", "November tests are running. They close tomorrow at 11:55 pm"],
    // 18 Nov, 2:00 pm IST.
    ["a later date", "2026-11-18T08:30:00.000Z", "November tests are running. They close on 21 Nov at 11:55 pm"],
  ])("says when a running month closes: %s", async (_label, serverTime, banner) => {
    mockFetch.mockResolvedValue(ok(withTests(serverTime)));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" />);
    await user.click(await screen.findByRole("button", { name: "November live" }));

    expect(screen.getByText(banner)).toBeInTheDocument();
  });

  it("writes a morning closing time in IST with am", async () => {
    // Closes 22 Nov 2026, 9:05 am IST = 03:35 UTC; server time 21 Nov, 2:00 pm IST.
    const morning = { ...november, closesAt: "2026-11-22T03:35:00.000Z" };
    mockFetch.mockResolvedValue(ok(withTests("2026-11-21T08:30:00.000Z", [morning])));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" />);
    await user.click(await screen.findByRole("button", { name: "November live" }));

    expect(screen.getByText("November tests are running. They close tomorrow at 9:05 am")).toBeInTheDocument();
  });

  it("shows no period strip when no Monthly Test has opened", async () => {
    mockFetch.mockResolvedValue(ok(threeStudents));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    expect(await screen.findByText("No Monthly Tests yet")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Period" })).not.toBeInTheDocument();
  });
});

// A running November and a closed October, Grades 11 and 12, counted by hand.
// Ekta (Grade 12) has no November mark: November has no Grade 12 Paper.
const monthStudents = [
  { userId: "1", name: "Zara Khan", studentId: "NVS1", grade: 11, examPreparingFor: "Engineering", attendance: { october: "submitted", november: "submitted" } },
  { userId: "2", name: "Arun Mehta", studentId: "NVS2", grade: 11, examPreparingFor: null, attendance: { october: "not_opened", november: "not_opened" } },
  { userId: "3", name: "Bina Shah", studentId: "NVS3", grade: 11, examPreparingFor: "Medical", attendance: { october: "opened", november: "opened" } },
  { userId: "4", name: "Charu Pal", studentId: "NVS4", grade: 11, examPreparingFor: "NDA", attendance: { october: "submitted", november: "not_opened" } },
  { userId: "5", name: "Ekta Jain", studentId: "NVS5", grade: 12, examPreparingFor: "CLAT", attendance: { october: "not_opened" } },
];
const monthData = {
  monthlyTests: [october, { ...november, grades: [11] }],
  students: monthStudents,
  serverTime: "2026-11-18T08:30:00.000Z",
};

function tile(name: string) {
  return screen.getByRole("region", { name });
}

function studentRows() {
  const table = screen.getByRole("table", { name: "Students" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
}

async function openMonth(name: string) {
  const user = userEvent.setup();
  render(<TestAttendanceTab schoolUdise="24120100101" />);
  await user.click(await screen.findByRole("button", { name }));
  return user;
}

describe("TestAttendanceTab — month page", () => {
  it("shows Enrolled, Submitted, In progress and Yet to start for a running month", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    await openMonth("November live");

    // Counted for November: the four Grade 11 Students.
    expect(tile("Enrolled")).toHaveTextContent("4");
    expect(tile("Enrolled")).toHaveTextContent("Attended 2 of 4");
    expect(tile("Submitted")).toHaveTextContent("1 of 4");
    expect(tile("Submitted")).toHaveTextContent("25%");
    expect(tile("In progress")).toHaveTextContent("1 of 4");
    expect(tile("Yet to start")).toHaveTextContent("2 of 4");
    expect(tile("Yet to start")).toHaveTextContent("50%");
  });

  it("shows Enrolled, Submitted, Opened, not submitted and Absent for a closed month", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    await openMonth("October");

    // Counted for October: all five.
    expect(tile("Enrolled")).toHaveTextContent("5");
    expect(tile("Enrolled")).toHaveTextContent("Attended 3 of 5");
    expect(tile("Submitted")).toHaveTextContent("2 of 5");
    expect(tile("Submitted")).toHaveTextContent("40%");
    expect(tile("Opened, not submitted")).toHaveTextContent("1 of 5");
    expect(tile("Absent")).toHaveTextContent("2 of 5");
    expect(screen.queryByRole("region", { name: "In progress" })).not.toBeInTheDocument();
  });

  it("shows a dash, never 0%, when nobody is counted for the month", async () => {
    mockFetch.mockResolvedValue(ok({ ...monthData, students: [monthStudents[4]] }));

    await openMonth("November live");

    expect(tile("Submitted")).toHaveTextContent("0 of 0");
    expect(tile("Submitted")).toHaveTextContent("—");
    expect(tile("Submitted")).not.toHaveTextContent("0%");
  });

  it("opens the Students list on Yet to start, by grade then name", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    await openMonth("November live");

    expect(screen.getByRole("button", { name: "Yet to start" })).toHaveAttribute("aria-pressed", "true");
    expect(studentRows()).toEqual([
      ["Arun Mehta", "11", "Not set", "Yet to start", "Missed Oct"],
      ["Charu Pal", "11", "NDA", "Yet to start", ""],
    ]);
  });

  it("opens a closed month's list on Absent", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    await openMonth("October");

    expect(screen.getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    expect(studentRows()).toEqual([
      ["Arun Mehta", "11", "Not set", "Absent", ""],
      ["Ekta Jain", "12", "CLAT", "Absent", ""],
    ]);
  });

  it("shows the Students in progress in one click", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    const user = await openMonth("November live");
    await user.click(screen.getByRole("button", { name: "In progress" }));

    expect(studentRows()).toEqual([["Bina Shah", "11", "Medical", "In progress", "Not submitted Oct"]]);
  });

  it("shows every counted Student under All", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    const user = await openMonth("October");
    await user.click(within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name: "All" }));

    expect(studentRows()).toEqual([
      ["Arun Mehta", "11", "Not set", "Absent", ""],
      ["Bina Shah", "11", "Medical", "Opened, not submitted", ""],
      ["Charu Pal", "11", "NDA", "Submitted", ""],
      ["Zara Khan", "11", "Engineering", "Submitted", ""],
      ["Ekta Jain", "12", "CLAT", "Absent", ""],
    ]);
  });

  it("has the columns Student, Grade, Exam Preparing For, Status and Previous 3 tests", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    await openMonth("November live");

    const table = screen.getByRole("table", { name: "Students" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Student",
      "Grade",
      "Exam Preparing For",
      "Status",
      "Previous 3 tests",
    ]);
  });

  it("notes the earlier tests a Student missed or did not submit, red with a miss and amber without", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    const user = await openMonth("November live");
    await user.click(within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name: "All" }));

    // November's window is October, the one closed Monthly Test before it.
    expect(studentRows()).toEqual([
      ["Arun Mehta", "11", "Not set", "Yet to start", "Missed Oct"],
      ["Bina Shah", "11", "Medical", "In progress", "Not submitted Oct"],
      ["Charu Pal", "11", "NDA", "Yet to start", ""],
      ["Zara Khan", "11", "Engineering", "Submitted", ""],
    ]);
    expect(screen.getByText("Missed Oct")).toHaveClass("text-danger");
    expect(screen.getByText("Not submitted Oct")).toHaveClass("text-warning-text");
  });

  it("leaves Previous 3 tests blank on the first Monthly Test of the year", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    const user = await openMonth("October");
    await user.click(within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name: "All" }));

    expect(studentRows().map((row) => row[4])).toEqual(["", "", "", "", ""]);
  });

  it("shows 25 rows, then all of them after Show all", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      userId: String(100 + i),
      name: `Student ${String(i + 1).padStart(2, "0")}`,
      studentId: null,
      grade: 11,
      examPreparingFor: "Engineering",
      attendance: { november: "not_opened" },
    }));
    mockFetch.mockResolvedValue(ok({ ...monthData, students: many }));

    const user = await openMonth("November live");

    expect(studentRows()).toHaveLength(25);
    expect(studentRows()[24][0]).toBe("Student 25");
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(studentRows()).toHaveLength(30);
    expect(studentRows()[29][0]).toBe("Student 30");
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
  });
});

function filterButton(filter: "Grade" | "Exam Preparing For", name: string) {
  return within(screen.getByRole("group", { name: filter })).getByRole("button", { name });
}

function groupRows() {
  const table = screen.getByRole("table", { name: "By grade and Exam Preparing For" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => [
      within(row).getByRole("rowheader").textContent,
      ...within(row).getAllByRole("cell").map((cell) => cell.textContent),
    ]);
}

describe("TestAttendanceTab — filters", () => {
  it("puts the Grade and Exam Preparing For filters above the period strip", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    const strip = await screen.findByRole("group", { name: "Period" });
    for (const name of ["Grade", "Exam Preparing For"]) {
      const filter = screen.getByRole("group", { name });
      expect(filter.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(screen.getByRole("group", { name: "Grade" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All",
      "11",
      "12",
    ]);
    expect(filterButton("Grade", "All")).toHaveAttribute("aria-pressed", "true");
    expect(filterButton("Exam Preparing For", "All")).toHaveAttribute("aria-pressed", "true");
  });

  it("offers Not set when some listed Student has no Exam Preparing For", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    const filter = await screen.findByRole("group", { name: "Exam Preparing For" });
    expect(within(filter).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All",
      "Engineering",
      "Medical",
      "CLAT",
      "CA",
      "NDA",
      "Not set",
    ]);
  });

  it("offers no Not set when every listed Student has an Exam Preparing For", async () => {
    mockFetch.mockResolvedValue(ok({ ...monthData, students: monthStudents.filter((s) => s.examPreparingFor != null) }));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    const filter = await screen.findByRole("group", { name: "Exam Preparing For" });
    expect(within(filter).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All",
      "Engineering",
      "Medical",
      "CLAT",
      "CA",
      "NDA",
    ]);
  });

  it("applies the Grade filter to the All year Enrolled count", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" />);
    await user.click(await screen.findByRole("button", { name: "All year" }));
    await user.click(filterButton("Grade", "12"));

    expect(within(tile("Enrolled")).getByText("1")).toBeInTheDocument();
  });

  it("applies the Grade filter to every number and list on a month page, and keeps it when the period changes", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" />);
    await screen.findByRole("group", { name: "Grade" });
    await user.click(filterButton("Grade", "12"));
    await user.click(screen.getByRole("button", { name: "October" }));

    expect(filterButton("Grade", "12")).toHaveAttribute("aria-pressed", "true");
    // Grade 12 in October: Ekta only, Absent.
    expect(tile("Enrolled")).toHaveTextContent("1");
    expect(tile("Enrolled")).toHaveTextContent("Attended 0 of 1");
    expect(tile("Submitted")).toHaveTextContent("0 of 1");
    expect(tile("Opened, not submitted")).toHaveTextContent("0 of 1");
    expect(tile("Absent")).toHaveTextContent("1 of 1");
    expect(studentRows()).toEqual([["Ekta Jain", "12", "CLAT", "Absent", ""]]);
    expect(groupRows()).toEqual([["Grade 12 · CLAT", "0 of 1 (0%)", "0", "1"]]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the Exam Preparing For filter set when the period changes", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = userEvent.setup();

    await openMonth("October");
    await user.click(filterButton("Exam Preparing For", "Not set"));
    // Not set in October: Arun only, Absent.
    expect(tile("Absent")).toHaveTextContent("1 of 1");

    await user.click(screen.getByRole("button", { name: "November live" }));

    expect(filterButton("Exam Preparing For", "Not set")).toHaveAttribute("aria-pressed", "true");
    expect(tile("Yet to start")).toHaveTextContent("1 of 1");
    expect(studentRows()).toEqual([["Arun Mehta", "11", "Not set", "Yet to start", "Missed Oct"]]);
    expect(groupRows()).toEqual([["Grade 11 · Not set", "0 of 1 (0%)", "0", "1"]]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("shows a dash on the tiles and no group rows when the filters leave nobody counted", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = userEvent.setup();

    await openMonth("October");
    await user.click(filterButton("Exam Preparing For", "CA"));

    expect(tile("Submitted")).toHaveTextContent("0 of 0");
    expect(tile("Submitted")).toHaveTextContent("—");
    expect(tile("Submitted")).not.toHaveTextContent("0%");
    expect(screen.queryByRole("table", { name: "By grade and Exam Preparing For" })).not.toBeInTheDocument();
  });
});

describe("TestAttendanceTab — by grade and Exam Preparing For", () => {
  it("shows one row per group for a closed month, Grade 11 first, in group order", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    await openMonth("October");

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

  it("shows In progress and Yet to start for a running month, with a two-part bar per row", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    await openMonth("November live");

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

  it("sits between the tiles and the Students list", async () => {
    mockFetch.mockResolvedValue(ok(monthData));

    await openMonth("October");

    const block = screen.getByRole("table", { name: "By grade and Exam Preparing For" });
    expect(tile("Absent").compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      block.compareDocumentPosition(screen.getByRole("table", { name: "Students" })) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// The running November of `monthData`, as a later fetch returns it: Arun has
// since submitted. Server time 18 Nov, 2:15 pm IST.
const monthDataLater = {
  ...monthData,
  students: monthStudents.map((student) =>
    student.name === "Arun Mehta" ? { ...student, attendance: { ...student.attendance, november: "submitted" } } : student,
  ),
  lastRefreshed: "2026-11-18T08:45:00.000Z",
  serverTime: "2026-11-18T08:45:10.000Z",
};

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** Lets pending fetches resolve and React render, under fake timers. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function renderWithFakeTimers() {
  vi.useFakeTimers();
  render(<TestAttendanceTab schoolUdise="24120100101" />);
  await settle();
}

describe("TestAttendanceTab — refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches again every 15 minutes while the running month is open", async () => {
    mockFetch.mockResolvedValueOnce(ok(monthData)).mockResolvedValue(ok(monthDataLater));
    await renderWithFakeTimers();
    expect(tile("Submitted")).toHaveTextContent("1 of 4");

    await advance(FIFTEEN_MINUTES - 1000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await advance(1000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(tile("Submitted")).toHaveTextContent("2 of 4");

    await advance(FIFTEEN_MINUTES);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("does not fetch again on a closed month", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    await renderWithFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "October" }));

    await advance(4 * FIFTEEN_MINUTES);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not fetch again on All year", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    await renderWithFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "All year" }));

    await advance(4 * FIFTEEN_MINUTES);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not fetch again when no Monthly Test is running", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z", [july, october])));
    await renderWithFakeTimers();

    await advance(4 * FIFTEEN_MINUTES);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fetches again when Refresh is pressed", async () => {
    mockFetch.mockResolvedValueOnce(ok(monthData)).mockResolvedValue(ok(monthDataLater));
    await renderWithFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(tile("Submitted")).toHaveTextContent("2 of 4");
    expect(screen.queryByText("Loading Test Attendance…")).not.toBeInTheDocument();
  });

  it("keeps the current page on screen while Refresh is fetching", async () => {
    let finish: (value: unknown) => void = () => {};
    mockFetch.mockResolvedValueOnce(ok(monthData)).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await renderWithFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await settle();

    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    expect(tile("Submitted")).toHaveTextContent("1 of 4");
    finish(ok(monthDataLater));
    await settle();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(tile("Submitted")).toHaveTextContent("2 of 4");
  });

  it("keeps the selected period and filters after a re-fetch", async () => {
    mockFetch.mockResolvedValueOnce(ok(monthData)).mockResolvedValue(ok(monthDataLater));
    await renderWithFakeTimers();
    fireEvent.click(filterButton("Exam Preparing For", "Not set"));
    expect(tile("Yet to start")).toHaveTextContent("1 of 1");

    await advance(FIFTEEN_MINUTES);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "November live" })).toHaveAttribute("aria-pressed", "true");
    expect(filterButton("Exam Preparing For", "Not set")).toHaveAttribute("aria-pressed", "true");
    // Arun, the only Not set Student, has since submitted.
    expect(tile("Submitted")).toHaveTextContent("1 of 1");
    expect(tile("Yet to start")).toHaveTextContent("0 of 1");
  });

  it("keeps a filter that a re-fetch leaves nobody in, still shown as selected", async () => {
    const withoutNotSet = { ...monthDataLater, students: monthStudents.filter((s) => s.examPreparingFor != null) };
    mockFetch.mockResolvedValueOnce(ok(monthData)).mockResolvedValue(ok(withoutNotSet));
    await renderWithFakeTimers();
    fireEvent.click(filterButton("Exam Preparing For", "Not set"));

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await settle();

    expect(filterButton("Exam Preparing For", "Not set")).toHaveAttribute("aria-pressed", "true");
    expect(tile("Submitted")).toHaveTextContent("0 of 0");
  });

  it("shows a Monthly Test that closed while the page was open as closed after the next fetch, and stops fetching", async () => {
    // 22 Nov, 12:05 am IST: November closed at 11:55 pm.
    const closedNovember = {
      ...monthData,
      monthlyTests: [october, { ...november, grades: [11], state: "closed" }],
      serverTime: "2026-11-21T18:35:00.000Z",
    };
    mockFetch.mockResolvedValueOnce(ok(monthData)).mockResolvedValue(ok(closedNovember));
    await renderWithFakeTimers();

    await advance(FIFTEEN_MINUTES);

    expect(screen.getByRole("button", { name: "November" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("November tests have closed.")).toBeInTheDocument();
    expect(tile("Absent")).toHaveTextContent("2 of 4");
    await advance(4 * FIFTEEN_MINUTES);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("shows the error panel with Retry, never zeros, when a re-fetch fails", async () => {
    mockFetch.mockResolvedValueOnce(ok(monthData)).mockResolvedValueOnce(failed(500)).mockResolvedValue(ok(monthDataLater));
    await renderWithFakeTimers();

    await advance(FIFTEEN_MINUTES);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load Test Attendance");
    expect(screen.queryByRole("region", { name: "Submitted" })).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await settle();

    expect(screen.getByRole("button", { name: "November live" })).toHaveAttribute("aria-pressed", "true");
    expect(tile("Submitted")).toHaveTextContent("2 of 4");
  });
});

describe("TestAttendanceTab — last refreshed", () => {
  it.each([
    // 2:15 pm IST, same IST day as the server time (2:20 pm IST).
    ["today", "2026-11-18T08:45:00.000Z", "Last refreshed today at 2:15 pm"],
    // 17 Nov, 11:05 pm IST.
    ["yesterday", "2026-11-17T17:35:00.000Z", "Last refreshed yesterday at 11:05 pm"],
    // 15 Nov, 9:00 am IST.
    ["an earlier date", "2026-11-15T03:30:00.000Z", "Last refreshed on 15 Nov at 9:00 am"],
    ["unknown", null, "Last refreshed: unknown"],
  ])("shows when the attendance data was last refreshed next to the closing text: %s", async (_label, lastRefreshed, text) => {
    mockFetch.mockResolvedValue(ok({ ...monthData, lastRefreshed, serverTime: "2026-11-18T08:50:00.000Z" }));

    render(<TestAttendanceTab schoolUdise="24120100101" />);

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("shows no last-refreshed time or Refresh button on a closed month", async () => {
    mockFetch.mockResolvedValue(ok({ ...monthData, lastRefreshed: "2026-11-18T08:45:00.000Z" }));

    await openMonth("October");

    expect(screen.queryByText(/Last refreshed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });
});

// All year (#527). Window: August, September, October; November is running.
const august = {
  key: "august", name: "August", shortName: "Aug",
  opensAt: "2026-08-17T23:30:00.000Z", closesAt: "2026-08-22T18:25:00.000Z", state: "closed", grades: [11, 12],
};
const september = {
  key: "september", name: "September", shortName: "Sep",
  opensAt: "2026-09-14T23:30:00.000Z", closesAt: "2026-09-19T18:25:00.000Z", state: "closed", grades: [11, 12],
};
const yearStudents = [
  { userId: "1", name: "Zoya Ali", studentId: "NVS1", grade: 11, examPreparingFor: "Engineering", attendance: { august: "submitted", september: "submitted", october: "submitted", november: "submitted" } },
  { userId: "2", name: "Kiran Das", studentId: "NVS2", grade: 12, examPreparingFor: "Medical", attendance: { august: "not_opened", september: "not_opened", october: "submitted", november: "not_opened" } },
  { userId: "3", name: "Neel Jha", studentId: "NVS3", grade: 11, examPreparingFor: "Engineering", attendance: { august: "opened", september: "submitted", october: "opened", november: "not_opened" } },
  { userId: "4", name: "Asha Bose", studentId: "NVS4", grade: 11, examPreparingFor: "Engineering", attendance: { august: "not_opened", september: "not_opened", october: "not_opened", november: "submitted" } },
  { userId: "5", name: "Bala Nair", studentId: "NVS5", grade: 11, examPreparingFor: null, attendance: { august: "submitted", september: "opened", october: "submitted", november: "submitted" } },
  // Joined in November: counted for none of the window's tests.
  { userId: "6", name: "Omar Khan", studentId: "NVS6", grade: 12, examPreparingFor: "Engineering", attendance: { november: "not_opened" } },
];
const yearData = {
  monthlyTests: [august, september, october, november],
  students: yearStudents,
  serverTime: "2026-11-18T08:30:00.000Z",
};

async function openAllYear(data: unknown = yearData) {
  mockFetch.mockResolvedValue(ok(data));
  const user = userEvent.setup();
  render(<TestAttendanceTab schoolUdise="24120100101" />);
  await user.click(await screen.findByRole("button", { name: "All year" }));
  return user;
}

function allStudentsTable() {
  return screen.getByRole("table", { name: "All students" });
}

function allStudentRows() {
  return within(allStudentsTable()).getAllByRole("row").slice(1);
}

function allStudentNames() {
  return allStudentRows().map((row) => within(row).getAllByRole("cell")[0].textContent);
}

describe("TestAttendanceTab — All year", () => {
  it("shows Enrolled, attendance over the window and Need follow-up", async () => {
    await openAllYear();

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

  it("lists Follow Up by pattern, then Not Submitting, then everyone else by grade and name, with tagged rows highlighted", async () => {
    await openAllYear();

    expect(allStudentNames()).toEqual(["Asha Bose", "Kiran Das", "Neel Jha", "Bala Nair", "Zoya Ali", "Omar Khan"]);
    const [asha, kiran, neel, bala] = allStudentRows();
    expect(asha).toHaveClass("bg-danger-bg");
    expect(kiran).toHaveClass("bg-danger-bg");
    expect(neel).toHaveClass("bg-warning-bg");
    expect(bala).not.toHaveClass("bg-danger-bg");
    expect(bala).not.toHaveClass("bg-warning-bg");
  });

  it("shows each Student's tag and note", async () => {
    await openAllYear();

    const followUp = allStudentRows().map((row) => within(row).getAllByRole("cell")[7].textContent);
    expect(followUp).toEqual([
      "Follow upMissed Aug, Sep, Oct",
      "Follow upMissed Aug, Sep · attended Oct",
      "Not submittingNot submitted Aug, Oct",
      "Not submitted Sep",
      "",
      "",
    ]);
  });

  it("colours a note red when it has a miss and amber when it has only non-submissions", async () => {
    await openAllYear();

    expect(screen.getByText("Missed Aug, Sep, Oct")).toHaveClass("text-danger");
    expect(screen.getByText("Not submitted Sep")).toHaveClass("text-warning-text");
  });

  it("has the columns Student, Grade, Exam Preparing For, the window's months, Attended and Follow-up", async () => {
    await openAllYear();

    const headers = within(allStudentsTable()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Student", "Grade", "Exam Preparing For", "Aug", "Sep", "Oct", "Attended", "Follow-up"]);
  });

  it("shows a month box for each window test: Absent, Opened, not submitted, Submitted, or not counted", async () => {
    await openAllYear();

    const boxes = (name: string) => {
      const row = allStudentRows().find((r) => within(r).getAllByRole("cell")[0].textContent === name)!;
      return within(row).getAllByRole("img").map((box) => box.getAttribute("aria-label"));
    };
    expect(boxes("Neel Jha")).toEqual(["Aug: Opened, not submitted", "Sep: Submitted", "Oct: Opened, not submitted"]);
    expect(boxes("Kiran Das")).toEqual(["Aug: Absent", "Sep: Absent", "Oct: Submitted"]);
    expect(boxes("Omar Khan")).toEqual(["Aug: not counted", "Sep: not counted", "Oct: not counted"]);
  });

  it("shows Attended as x of y with a percentage, or a dash when counted for none", async () => {
    await openAllYear();

    const attended = allStudentRows().map((row) => within(row).getAllByRole("cell")[6].textContent);
    expect(attended).toEqual(["0 of 3 (0%)", "1 of 3 (33%)", "3 of 3 (100%)", "3 of 3 (100%)", "3 of 3 (100%)", "—"]);
  });

  it("states the counted tests and the tag rules above the list", async () => {
    await openAllYear();

    expect(
      screen.getByText(
        "Counts tests that have closed: Aug, Sep, Oct. November is added once it closes. Follow up: Absent in 2 or more of them. Not submitting: Opened, not submitted in 2 or more of them.",
      ),
    ).toBeInTheDocument();
  });

  it("filters the list to Need follow-up and to Not submitting", async () => {
    const user = await openAllYear();
    const listFilter = screen.getByRole("group", { name: "Show Students" });
    expect(within(listFilter).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All students",
      "Need follow-up",
      "Not submitting",
    ]);
    expect(within(listFilter).getByRole("button", { name: "All students" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(listFilter).getByRole("button", { name: "Need follow-up" }));
    expect(allStudentNames()).toEqual(["Asha Bose", "Kiran Das"]);

    await user.click(within(listFilter).getByRole("button", { name: "Not submitting" }));
    expect(allStudentNames()).toEqual(["Neel Jha"]);
  });

  it("applies the Grade filter to the tiles and the list", async () => {
    const user = await openAllYear();
    await user.click(filterButton("Grade", "12"));

    // Kiran and Omar. Sittings: Kiran 3. Attended: Kiran 1 (33%). Follow Up: Kiran = 1 of 2.
    expect(within(tile("Enrolled")).getByText("2")).toBeInTheDocument();
    expect(tile("Attendance")).toHaveTextContent("1 of 3 sittings");
    expect(tile("Attendance")).toHaveTextContent("of these, 0 opened, not submitted");
    expect(tile("Need follow-up")).toHaveTextContent("1 of 2");
    expect(allStudentNames()).toEqual(["Kiran Das", "Omar Khan"]);
  });

  it("shows a dash, never 0%, when there is no sitting", async () => {
    const user = await openAllYear();
    await user.click(filterButton("Exam Preparing For", "CLAT"));

    expect(tile("Attendance")).toHaveTextContent("—");
    expect(tile("Attendance")).toHaveTextContent("0 of 0 sittings");
    expect(tile("Need follow-up")).toHaveTextContent("—");
    expect(tile("Attendance")).not.toHaveTextContent("0%");
  });

  it("shows Enrolled and says attendance and tags appear once a test closes when none has closed yet", async () => {
    await openAllYear({ ...yearData, monthlyTests: [november] });

    expect(within(tile("Enrolled")).getByText("6")).toBeInTheDocument();
    expect(screen.getByText("Attendance and tags appear once a Monthly Test closes.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Attendance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Need follow-up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "All students" })).not.toBeInTheDocument();
  });
});

// All year chart (#528), counted by hand from yearData. Omar joined in November,
// so he is counted only for November.
function chartBars() {
  const chart = screen.getByRole("region", { name: "Attendance by Monthly Test" });
  return within(chart)
    .getAllByRole("listitem")
    .map((bar) => Array.from(bar.children).map((line) => line.textContent));
}

describe("TestAttendanceTab — All year chart", () => {
  it("shows a bar per closed Monthly Test oldest first, then the running one so far, each with its percentage, x of y and not-submitted count", async () => {
    await openAllYear();

    // Aug: Zoya, Bala submitted; Neel opened; Kiran, Asha absent. 3 of 5.
    // Sep: Zoya, Neel submitted; Bala opened; Kiran, Asha absent. 3 of 5.
    // Oct: Zoya, Kiran, Bala submitted; Neel opened; Asha absent. 4 of 5.
    // Nov (running): Zoya, Asha, Bala submitted; Kiran, Neel, Omar not yet. 3 of 6.
    expect(chartBars()).toEqual([
      ["Aug", "60%", "3 of 5", "1 not submitted"],
      ["Sep", "60%", "3 of 5", "1 not submitted"],
      ["Oct", "80%", "4 of 5", "1 not submitted"],
      ["Nov so far", "50%", "3 of 6", "0 not submitted"],
    ]);
  });

  it("sits after the tiles and before the student list", async () => {
    await openAllYear();
    const chart = screen.getByRole("region", { name: "Attendance by Monthly Test" });

    expect(tile("Need follow-up").compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chart.compareDocumentPosition(allStudentsTable()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("applies the Grade filter to every bar", async () => {
    const user = await openAllYear();
    await user.click(filterButton("Grade", "12"));

    // Kiran (and Omar, November only). Kiran: absent Aug, Sep; submitted Oct; not yet Nov.
    expect(chartBars()).toEqual([
      ["Aug", "0%", "0 of 1", "0 not submitted"],
      ["Sep", "0%", "0 of 1", "0 not submitted"],
      ["Oct", "100%", "1 of 1", "0 not submitted"],
      ["Nov so far", "0%", "0 of 2", "0 not submitted"],
    ]);
  });

  it("shows a dash, never 0%, on a bar with nobody counted", async () => {
    const user = await openAllYear();
    await user.click(filterButton("Exam Preparing For", "CLAT"));

    expect(chartBars().map(([month, percent, of]) => [month, percent, of])).toEqual([
      ["Aug", "—", "0 of 0"],
      ["Sep", "—", "0 of 0"],
      ["Oct", "—", "0 of 0"],
      ["Nov so far", "—", "0 of 0"],
    ]);
  });

  it("shows the running month so far when no Monthly Test has closed yet", async () => {
    await openAllYear({ ...yearData, monthlyTests: [november] });

    expect(chartBars()).toEqual([["Nov so far", "50%", "3 of 6", "0 not submitted"]]);
  });

  it("shows no chart when no Monthly Test has opened", async () => {
    mockFetch.mockResolvedValue(ok({ ...yearData, monthlyTests: [] }));
    render(<TestAttendanceTab schoolUdise="24120100101" />);

    expect(await screen.findByText("No Monthly Tests yet")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Attendance by Monthly Test" })).not.toBeInTheDocument();
  });
});

// Excel downloads (#530): each list downloads as it is on screen.
describe("TestAttendanceTab — Download", () => {
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  it("downloads a month's list with the selected period, filters and list filter", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = await openMonth("November live");
    await user.click(filterButton("Grade", "11"));
    await user.click(within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name: "In progress" }));

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(assign).toHaveBeenCalledWith(
      "/api/school/24120100101/test-attendance/export?period=november&grade=11&examPreparingFor=all&list=opened",
    );
  });

  it("downloads a month's default list, Absent on a closed month", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = await openMonth("October");
    await user.click(filterButton("Exam Preparing For", "Not set"));

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(assign).toHaveBeenCalledWith(
      "/api/school/24120100101/test-attendance/export?period=october&grade=all&examPreparingFor=Not+set&list=not_opened",
    );
  });

  it("downloads the All year list with the filters and list filter", async () => {
    const user = await openAllYear();
    await user.click(filterButton("Exam Preparing For", "Engineering"));
    await user.click(within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name: "Need follow-up" }));

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(assign).toHaveBeenCalledWith(
      "/api/school/24120100101/test-attendance/export?period=all&grade=all&examPreparingFor=Engineering&list=follow_up",
    );
  });

  it("offers no Download when the All year page has no list yet", async () => {
    await openAllYear({ ...yearData, monthlyTests: [november] });

    expect(screen.getByText("Attendance and tags appear once a Monthly Test closes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });
});
