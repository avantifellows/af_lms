import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TestAttendanceTab from "./TestAttendanceTab";

const mockFetch = vi.fn();
const { mockDownload } = vi.hoisted(() => ({ mockDownload: vi.fn() }));

// Building the file is the export module's own test; here only what is asked for.
vi.mock("@/lib/test-attendance-export", () => ({ downloadTestAttendance: mockDownload }));

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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

    const enrolled = await screen.findByRole("region", { name: "Enrolled" });
    expect(within(enrolled).getByText("3")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/school/24120100101/test-attendance");
  });

  it("says there are no Monthly Tests yet when none has opened", async () => {
    mockFetch.mockResolvedValue(ok(threeStudents));

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

    expect(await screen.findByText("No Monthly Tests yet")).toBeInTheDocument();
  });

  it.each([
    ["an error status", () => mockFetch.mockResolvedValueOnce(failed(500))],
    ["a network failure", () => mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
  ])("shows an error panel, never zeros, after %s", async (_label, fail) => {
    fail();

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load Test Attendance");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Enrolled" })).not.toBeInTheDocument();
    expect(screen.queryByText("No Monthly Tests yet")).not.toBeInTheDocument();
  });

  it("loads again on Retry", async () => {
    mockFetch.mockResolvedValueOnce(failed(500)).mockResolvedValueOnce(ok(threeStudents));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

    const buttons = await periodButtons();
    expect(buttons.map((b) => b.textContent)).toEqual(["All year", "November live", "October", "July"]);
  });

  it("keeps the live mark readable on the selected button and on an unselected one", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
    const live = within(await screen.findByRole("button", { name: "November live" })).getByText("live");
    // Selected: white on the button's red, with a white ring.
    expect(live).toHaveClass("text-text-on-accent", "border-text-on-accent");
    expect(live).not.toHaveClass("bg-success");

    await user.click(screen.getByRole("button", { name: "October" }));
    // Unselected: white on solid green.
    expect(live).toHaveClass("text-text-on-accent", "bg-success");
  });

  it("opens on the running month", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

    expect(await screen.findByRole("button", { name: "Retest live" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "November live" })).toHaveAttribute("aria-pressed", "false");
  });

  it("opens on All year with the Enrolled count when no Monthly Test is running", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z", [july, october])));

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

    expect(await screen.findByRole("button", { name: "All year" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("region", { name: "Enrolled" })).getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("No Monthly Tests yet")).not.toBeInTheDocument();
  });

  it("opens a closed month in one click and says its tests have closed", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
    await user.click(await screen.findByRole("button", { name: "October" }));

    expect(screen.getByRole("button", { name: "October" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All year" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("October tests have closed.")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("goes back to All year in one click", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
    await user.click(await screen.findByRole("button", { name: "November live" }));

    expect(screen.getByText(banner)).toBeInTheDocument();
  });

  it("writes a morning closing time in IST with am", async () => {
    // Closes 22 Nov 2026, 9:05 am IST = 03:35 UTC; server time 21 Nov, 2:00 pm IST.
    const morning = { ...november, closesAt: "2026-11-22T03:35:00.000Z" };
    mockFetch.mockResolvedValue(ok(withTests("2026-11-21T08:30:00.000Z", [morning])));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
    await user.click(await screen.findByRole("button", { name: "November live" }));

    expect(screen.getByText("November tests are running. They close tomorrow at 9:05 am")).toBeInTheDocument();
  });

  it("shows no period strip when no Monthly Test has opened", async () => {
    mockFetch.mockResolvedValue(ok(threeStudents));

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

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
  render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
  await user.click(await screen.findByRole("button", { name }));
  return user;
}

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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
    await user.click(await screen.findByRole("button", { name: "All year" }));
    await user.click(filterButton("Grade", "12"));

    expect(within(tile("Enrolled")).getByText("1")).toBeInTheDocument();
  });

  it("applies the Grade filter to every number and list on a month page, and keeps it when the period changes", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = userEvent.setup();

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
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
  render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
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

    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

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
  render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);
  await user.click(await screen.findByRole("button", { name: "All year" }));
  return user;
}

function allStudentsTable() {
  return screen.getByRole("table", { name: "All students" });
}

function allStudentNames() {
  return within(allStudentsTable())
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);
}

describe("TestAttendanceTab — All year", () => {
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

  it("shows no chart when no Monthly Test has opened", async () => {
    mockFetch.mockResolvedValue(ok({ ...yearData, monthlyTests: [] }));
    render(<TestAttendanceTab schoolUdise="24120100101" schoolCode="14042" />);

    expect(await screen.findByText("No Monthly Tests yet")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Attendance by Monthly Test" })).not.toBeInTheDocument();
  });
});

// Excel downloads (#530): each list downloads as it is on screen, built in the
// browser from the response already loaded.
describe("TestAttendanceTab — Download", () => {
  beforeEach(() => {
    mockDownload.mockReset().mockResolvedValue(undefined);
  });

  it("downloads a month's list from the loaded data with the selected period, filters and list filter", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = await openMonth("November live");
    await user.click(filterButton("Grade", "11"));
    await user.click(within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name: "In progress" }));

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(mockDownload).toHaveBeenCalledWith(
      monthData,
      { period: "november", filters: { grade: 11, examPreparingFor: "all" }, list: "opened" },
      "14042",
    );
    // Built from the response on screen: no new request.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("downloads a month's default list, Absent on a closed month", async () => {
    mockFetch.mockResolvedValue(ok(monthData));
    const user = await openMonth("October");
    await user.click(filterButton("Exam Preparing For", "Not set"));

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(mockDownload).toHaveBeenCalledWith(
      monthData,
      { period: "october", filters: { grade: "all", examPreparingFor: "Not set" }, list: "not_opened" },
      "14042",
    );
  });

  it("downloads the All year list with the filters and list filter", async () => {
    const user = await openAllYear();
    await user.click(filterButton("Exam Preparing For", "Engineering"));
    await user.click(within(screen.getByRole("group", { name: "Show Students" })).getByRole("button", { name: "Need follow-up" }));

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(mockDownload).toHaveBeenCalledWith(
      yearData,
      { period: "all", filters: { grade: "all", examPreparingFor: "Engineering" }, list: "follow_up" },
      "14042",
    );
  });

  it("says so when the file cannot be made", async () => {
    mockDownload.mockRejectedValue(new Error("chunk failed"));
    const user = await openAllYear();

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't download this list. Please try again.");
  });

  it("offers no Download when the All year page has no list yet", async () => {
    await openAllYear({ ...yearData, monthlyTests: [november] });

    expect(screen.getByText("Attendance and tags appear once a Monthly Test closes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });
});
