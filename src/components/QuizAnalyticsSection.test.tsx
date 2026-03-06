import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuizSummary } from "@/types/quiz";

// Mock recharts — SVG components don't render in jsdom
// Bar and Pie render children so Cell map callbacks on lines 190/223 execute
vi.mock("recharts", () => {
  type P = { children?: React.ReactNode };
  type FmtP = P & { formatter?: (v: number) => unknown };
  type LblP = P & { label?: (d: { name: string; value: number }) => string };
  return {
    BarChart: ({ children }: P) => <div data-testid="bar-chart">{children}</div>,
    Bar: ({ children }: P) => <div data-testid="bar">{children}</div>,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: ({ formatter }: FmtP) => { if (typeof formatter === "function") formatter(50); return null; },
    ResponsiveContainer: ({ children }: P) => <div>{children}</div>,
    PieChart: ({ children }: P) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({ children, label }: LblP) => <div data-testid="pie">{children}{typeof label === "function" && label({ name: "Test", value: 1 })}</div>,
    Cell: () => null,
    Legend: () => null,
  };
});

// Import after mocks
import QuizAnalyticsSection from "./QuizAnalyticsSection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function makeSessions(count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    session_id: `session-${i + 1}`,
    test_name: `Quiz ${i + 1}`,
    start_date: `2025-06-0${i + 1}`,
    student_count: 30 + i,
  }));
}

function makeSummary(overrides: Partial<QuizSummary> = {}): QuizSummary {
  return {
    total_students: 40,
    present_count: 35,
    absent_count: 5,
    avg_score: 72.5,
    min_score: 20,
    max_score: 98,
    score_distribution: [
      { range: "0-20", count: 1 },
      { range: "21-40", count: 3 },
      { range: "41-60", count: 8 },
      { range: "61-80", count: 15 },
      { range: "81-100", count: 8 },
    ],
    subject_scores: [
      { subject_name: "Math", avg_percentage: 68, student_count: 35 },
      { subject_name: "Science", avg_percentage: 77, student_count: 35 },
    ],
    student_results: Array.from({ length: 5 }, (_, i) => ({
      student_name: `Student ${i + 1}`,
      attendance_status: i < 4 ? "Present" : "Absent",
      marks_obtained: i < 4 ? 60 + i * 5 : null,
      total_marks: i < 4 ? 100 : null,
      percentage: i < 4 ? 60 + i * 5 : null,
    })),
    ...overrides,
  };
}

function fetchOk(summary: QuizSummary | null) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => (summary ? { summary } : { message: "No data available" }),
  });
}

function fetchFail() {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
}

async function selectSession(user: ReturnType<typeof userEvent.setup>, index = 0) {
  const sessions = makeSessions();
  const select = screen.getByRole("combobox");
  await user.selectOptions(select, sessions[index].session_id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QuizAnalyticsSection", () => {
  // ---- Rendering / null cases ----

  it("returns null when sessions array is empty", () => {
    const { container } = render(
      <QuizAnalyticsSection sessions={[]} schoolUdise="123456" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null when all sessions lack session_id", () => {
    const invalid = [
      { session_id: "", test_name: "Q1", start_date: "2025-01-01", student_count: 10 },
    ];
    const { container } = render(
      <QuizAnalyticsSection sessions={invalid} schoolUdise="123456" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders heading and session selector with valid sessions", () => {
    const sessions = makeSessions();
    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="123456" />,
    );

    expect(screen.getByText("Quiz Analytics")).toBeInTheDocument();
    expect(screen.getByText("Select Quiz")).toBeInTheDocument();

    const select = screen.getByRole("combobox");
    // Default placeholder + 2 sessions = 3 options
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Choose a quiz...");
    expect(options[1]).toHaveTextContent("Quiz 1 - 2025-06-01 (30 students)");
    expect(options[2]).toHaveTextContent("Quiz 2 - 2025-06-02 (31 students)");
  });

  // ---- Loading state ----

  it("shows loading spinner after selecting a session", async () => {
    // Never resolve, so loading remains visible
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );

    await selectSession(user);

    expect(screen.getByText("Loading analytics...")).toBeInTheDocument();
  });

  // ---- Successful fetch ----

  it("shows analytics data after successful fetch", async () => {
    const summary = makeSummary();
    fetchOk(summary);
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );

    await selectSession(user);

    await waitFor(() => {
      expect(screen.queryByText("Loading analytics...")).not.toBeInTheDocument();
    });

    // Stat card labels
    expect(screen.getByText("Total Students")).toBeInTheDocument();
    expect(screen.getByText("Avg Score")).toBeInTheDocument();
    expect(screen.getByText("Min Score")).toBeInTheDocument();
    expect(screen.getByText("Max Score")).toBeInTheDocument();

    // Stat card values (use getAllByText for "Present"/"Absent" which also appear in table)
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getAllByText("Present").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Absent").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("72.5%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("98%")).toBeInTheDocument();
  });

  it("renders charts (bar chart, pie chart, subject-wise)", async () => {
    fetchOk(makeSummary());
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.queryByText("Loading analytics...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Score Distribution")).toBeInTheDocument();
    expect(screen.getByText("Attendance")).toBeInTheDocument();
    expect(screen.getByText("Subject-wise Performance")).toBeInTheDocument();

    // Mocked chart elements
    expect(screen.getAllByTestId("bar-chart").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
  });

  it("does not render subject-wise section when subject_scores is empty", async () => {
    fetchOk(makeSummary({ subject_scores: [] }));
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.queryByText("Loading analytics...")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Subject-wise Performance")).not.toBeInTheDocument();
  });

  // ---- Student results table ----

  it("shows student results table with correct data", async () => {
    fetchOk(makeSummary());
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.getByText("Student Results")).toBeInTheDocument();
    });

    // Table headers
    expect(screen.getByText("Rank")).toBeInTheDocument();
    expect(screen.getByText("Student Name")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Marks")).toBeInTheDocument();
    expect(screen.getByText("Percentage")).toBeInTheDocument();

    // Student rows
    expect(screen.getByText("Student 1")).toBeInTheDocument();
    expect(screen.getByText("60/100")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();

    // Absent student shows dashes
    expect(screen.getByText("Student 5")).toBeInTheDocument();
  });

  it('shows "Showing top 20 of N students" when more than 20 results', async () => {
    const manyResults = Array.from({ length: 25 }, (_, i) => ({
      student_name: `Student ${i + 1}`,
      attendance_status: "Present",
      marks_obtained: 50 + i,
      total_marks: 100,
      percentage: 50 + i,
    }));
    fetchOk(makeSummary({ student_results: manyResults }));
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.getByText("Student Results")).toBeInTheDocument();
    });

    expect(screen.getByText("Showing top 20 of 25 students")).toBeInTheDocument();
    // Only 20 student rows rendered (plus 1 header row = 21 total tr elements)
    const table = screen.getByText("Student Results").closest("div.bg-gray-50")!;
    const rows = within(table).getAllByRole("row");
    // 1 header row + 20 data rows
    expect(rows).toHaveLength(21);
  });

  it('does not show "Showing top 20" when 20 or fewer results', async () => {
    fetchOk(makeSummary()); // default has 5 results
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.getByText("Student Results")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Showing top 20/)).not.toBeInTheDocument();
  });

  // ---- Error state ----

  it("shows error message on fetch failure", async () => {
    fetchFail();
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.getByText("Failed to load quiz analytics")).toBeInTheDocument();
    });

    // No analytics displayed
    expect(screen.queryByText("Total Students")).not.toBeInTheDocument();
  });

  it('shows "No data available" when response has no summary', async () => {
    fetchOk(null);
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.getByText("No data available")).toBeInTheDocument();
    });
  });

  // ---- Deselecting ----

  it("clears analytics when session is deselected", async () => {
    fetchOk(makeSummary());
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );

    // Select a session and wait for data
    await selectSession(user);
    await waitFor(() => {
      expect(screen.getByText("Total Students")).toBeInTheDocument();
    });

    // Deselect by choosing the placeholder option
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "");

    // Analytics should be gone
    expect(screen.queryByText("Total Students")).not.toBeInTheDocument();
    expect(screen.queryByText("Student Results")).not.toBeInTheDocument();
  });

  // ---- Fetch call correctness ----

  it("sends POST to correct endpoint with quizId in body", async () => {
    fetchOk(makeSummary());
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE999" />,
    );
    await selectSession(user, 0);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/quiz-analytics/UDISE999", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId: "session-1" }),
    });
  });

  it("fetches new analytics when switching sessions", async () => {
    const summary1 = makeSummary({ avg_score: 55 });
    const summary2 = makeSummary({ avg_score: 88 });
    fetchOk(summary1);
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );

    // Select first session
    await selectSession(user, 0);
    await waitFor(() => {
      expect(screen.getByText("55%")).toBeInTheDocument();
    });

    // Select second session
    fetchOk(summary2);
    await selectSession(user, 1);
    await waitFor(() => {
      expect(screen.getByText("88%")).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // ---- Network error ----

  it("shows error message on network failure (fetch throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.getByText("Failed to load quiz analytics")).toBeInTheDocument();
    });
  });

  // ---- Fallback message when data.message is missing ----

  it('shows "No data available" when response has no summary and no message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const user = userEvent.setup();
    const sessions = makeSessions();

    render(
      <QuizAnalyticsSection sessions={sessions} schoolUdise="UDISE001" />,
    );
    await selectSession(user);

    await waitFor(() => {
      expect(screen.getByText("No data available")).toBeInTheDocument();
    });
  });
});
