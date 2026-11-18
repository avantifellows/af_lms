import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TestAttendanceTab from "./TestAttendanceTab";

const mockFetch = vi.fn();

const threeStudents = {
  monthlyTests: [],
  students: [
    { userId: "10", name: "Nisha Rao", studentId: "NVS001", grade: 11, examPreparingFor: "Engineering" },
    { userId: "12", name: "Ravi Das", studentId: "NVS003", grade: 11, examPreparingFor: null },
    { userId: "14", name: "Maya Iyer", studentId: "NVS002", grade: 12, examPreparingFor: "Medical" },
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

  it("opens on All year with the Enrolled count", async () => {
    mockFetch.mockResolvedValue(ok(withTests("2026-11-18T08:30:00.000Z")));

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
