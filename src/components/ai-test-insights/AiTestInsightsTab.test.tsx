import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiTestInsightsTab from "./AiTestInsightsTab";

const mockFetch = vi.fn();

const NO_INSIGHTS = { insightSessionsCompleted: 0, testInsightsGenerated: 0, lastInsightSessionDate: null };

const twoStudents = {
  students: [
    {
      studentId: 1001,
      name: "Asha Kumar",
      studentCode: "STU1001",
      grade: 11,
      insightSessionsCompleted: 3,
      testInsightsGenerated: 2,
      lastInsightSessionDate: "2026-11-14",
    },
    { studentId: 1002, name: "Bilal Khan", studentCode: null, grade: 12, ...NO_INSIGHTS },
  ],
};

const threeStudents = {
  students: [
    ...twoStudents.students,
    { studentId: 1003, name: "Chitra Nair", studentCode: "STU1003", grade: 11, ...NO_INSIGHTS },
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

function shownRows(table: HTMLElement) {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
}

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

  it("lists each Student with their name, Student ID, Grade and Insight counts, in the order given", async () => {
    mockFetch.mockResolvedValue(ok(twoStudents));

    render(<AiTestInsightsTab schoolCode="JNV001" />);

    const table = await screen.findByRole("table", { name: "AI Test Insights students" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Student",
      "Grade",
      "Insight Sessions completed",
      "Test Insights generated",
      "Last Insight Session",
      "Open",
    ]);
    // Bilal has had no attention yet: 0, 0 and an empty date.
    expect(shownRows(table)).toEqual([
      ["Asha KumarSTU1001", "11", "3", "2", "14 Nov 2026", "Open"],
      ["Bilal Khan—", "12", "0", "0", "", "Open"],
    ]);
  });

  it("opens each Student's page from a School page", async () => {
    mockFetch.mockResolvedValue(ok(twoStudents));

    render(<AiTestInsightsTab schoolCode="JNV001" />);

    expect(await screen.findByRole("link", { name: "Open Asha Kumar" })).toHaveAttribute(
      "href",
      "/ai-test-insights/students/1001",
    );
    expect(screen.getByRole("link", { name: "Open Bilal Khan" })).toHaveAttribute(
      "href",
      "/ai-test-insights/students/1002",
    );
  });

  it("carries the centre id to the Student's page from a Centre page", async () => {
    mockFetch.mockResolvedValue(ok(twoStudents));

    render(<AiTestInsightsTab schoolCode="JNV001" centreId={301} />);

    expect(await screen.findByRole("link", { name: "Open Asha Kumar" })).toHaveAttribute(
      "href",
      "/ai-test-insights/students/1001?centre=301",
    );
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

  describe("search and Grade filter", () => {
    async function renderThree() {
      mockFetch.mockResolvedValue(ok(threeStudents));
      const user = userEvent.setup();
      render(<AiTestInsightsTab schoolCode="JNV001" />);
      const table = await screen.findByRole("table", { name: "AI Test Insights students" });
      return { user, table };
    }

    const names = () =>
      within(screen.getByRole("table", { name: "AI Test Insights students" }))
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0].firstChild?.textContent);

    it("narrows the list by part of a name, in any case, without a new request", async () => {
      const { user } = await renderThree();

      await user.type(screen.getByRole("searchbox", { name: "Search by name or Student ID" }), "cHiT");

      expect(names()).toEqual(["Chitra Nair"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("narrows the list by Student ID, in any case", async () => {
      const { user } = await renderThree();

      await user.type(screen.getByRole("searchbox", { name: "Search by name or Student ID" }), " stu1003 ");

      expect(names()).toEqual(["Chitra Nair"]);
    });

    it("filters by Grade 11, Grade 12 and back to All, without a new request", async () => {
      const { user } = await renderThree();
      const grade = screen.getByRole("combobox", { name: "Grade" });
      expect(within(grade).getAllByRole("option").map((option) => option.textContent)).toEqual(["All", "11", "12"]);

      await user.selectOptions(grade, "11");
      expect(names()).toEqual(["Asha Kumar", "Chitra Nair"]);

      await user.selectOptions(grade, "12");
      expect(names()).toEqual(["Bilal Khan"]);

      await user.selectOptions(grade, "All");
      expect(names()).toEqual(["Asha Kumar", "Bilal Khan", "Chitra Nair"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("combines the search with the Grade filter", async () => {
      const { user } = await renderThree();

      await user.selectOptions(screen.getByRole("combobox", { name: "Grade" }), "11");
      await user.type(screen.getByRole("searchbox", { name: "Search by name or Student ID" }), "STU100");

      expect(names()).toEqual(["Asha Kumar", "Chitra Nair"]);
    });

    it.each([
      ["a search", async (user: ReturnType<typeof userEvent.setup>) =>
        user.type(screen.getByRole("searchbox", { name: "Search by name or Student ID" }), "Zubin")],
      ["a search and Grade filter", async (user: ReturnType<typeof userEvent.setup>) => {
        await user.selectOptions(screen.getByRole("combobox", { name: "Grade" }), "12");
        await user.type(screen.getByRole("searchbox", { name: "Search by name or Student ID" }), "Asha");
      }],
    ])("says plainly that nothing matches %s, without the error panel", async (_label, narrow) => {
      const { user } = await renderThree();

      await narrow(user);

      expect(screen.getByText("No Students match your search.")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("No JEE Students in Grade 11 or 12 are listed here.")).not.toBeInTheDocument();
      // The controls stay, so the Teacher can widen the search again.
      expect(screen.getByRole("searchbox", { name: "Search by name or Student ID" })).toBeInTheDocument();
    });
  });
});
