import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiTestInsightsTab from "./AiTestInsightsTab";

const mockFetch = vi.fn();

const twoStudents = {
  students: [
    { studentId: 1001, name: "Asha Kumar", studentCode: "STU1001", grade: 11 },
    { studentId: 1002, name: "Bilal Khan", studentCode: null, grade: 12 },
  ],
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const failed = (status: number) => ({ ok: false, status, json: async () => ({ error: "Access denied" }) });

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiTestInsightsTab", () => {
  it("shows a loading state until the list arrives", async () => {
    let resolve: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<AiTestInsightsTab schoolCode="JNV001" />);

    expect(screen.getByText("Loading AI Test Insights…")).toBeInTheDocument();
    resolve(ok(twoStudents));
    expect(await screen.findByRole("table", { name: "AI Test Insights students" })).toBeInTheDocument();
    expect(screen.queryByText("Loading AI Test Insights…")).not.toBeInTheDocument();
  });

  it("asks for the School's list on a School page", async () => {
    mockFetch.mockResolvedValue(ok(twoStudents));

    render(<AiTestInsightsTab schoolCode="JNV001" />);

    await screen.findByRole("table", { name: "AI Test Insights students" });
    expect(mockFetch).toHaveBeenCalledWith("/api/school/JNV001/ai-test-insights");
  });

  it("asks for the centre's list on a Centre page", async () => {
    mockFetch.mockResolvedValue(ok(twoStudents));

    render(<AiTestInsightsTab schoolCode="JNV001" centreId={301} />);

    await screen.findByRole("table", { name: "AI Test Insights students" });
    expect(mockFetch).toHaveBeenCalledWith("/api/school/JNV001/ai-test-insights?centre_id=301");
  });

  it("lists each Student with their name, Student ID and Grade, in the order given", async () => {
    mockFetch.mockResolvedValue(ok(twoStudents));

    render(<AiTestInsightsTab schoolCode="JNV001" />);

    const table = await screen.findByRole("table", { name: "AI Test Insights students" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["Asha KumarSTU1001", "11"],
      ["Bilal Khan—", "12"],
    ]);
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Student",
      "Grade",
    ]);
  });

  it("says no Student is listed when the list is empty", async () => {
    mockFetch.mockResolvedValue(ok({ students: [] }));

    render(<AiTestInsightsTab schoolCode="JNV001" />);

    expect(
      await screen.findByText("No JEE Students in Grade 11 or 12 are listed here."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it.each([
    ["an error status", () => mockFetch.mockResolvedValueOnce(failed(403))],
    ["a network failure", () => mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
  ])("shows an error panel, never an empty list, after %s", async (_label, fail) => {
    fail();

    render(<AiTestInsightsTab schoolCode="JNV001" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load AI Test Insights. Please try again.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("No JEE Students in Grade 11 or 12 are listed here.")).not.toBeInTheDocument();
  });

  it("loads the list again on Retry", async () => {
    mockFetch.mockResolvedValueOnce(failed(500)).mockResolvedValueOnce(ok(twoStudents));
    const user = userEvent.setup();

    render(<AiTestInsightsTab schoolCode="JNV001" />);
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table", { name: "AI Test Insights students" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
