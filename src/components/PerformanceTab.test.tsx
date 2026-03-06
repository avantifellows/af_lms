import { render, screen, waitFor } from "@testing-library/react";
import PerformanceTab from "./PerformanceTab";

vi.mock("./QuizAnalyticsSection", () => ({
  default: ({ sessions, schoolUdise }: any) => (
    <div data-testid="quiz-analytics-section">
      QuizAnalyticsSection: {sessions.length} sessions, udise={schoolUdise}
    </div>
  ),
}));

describe("PerformanceTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading spinner initially", () => {
    // Fetch that never resolves to keep loading state
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as any
    );

    render(<PerformanceTab schoolUdise="12345" />);
    expect(screen.getByText("Loading quiz data...")).toBeInTheDocument();
  });

  it("renders QuizAnalyticsSection after successful fetch", async () => {
    const sessions = [
      {
        session_id: "s1",
        test_name: "Math Quiz",
        start_date: "2025-01-01",
        student_count: 30,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ sessions }),
        })
      ) as any
    );

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("quiz-analytics-section")).toBeInTheDocument();
    });

    expect(screen.getByText(/1 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/udise=12345/)).toBeInTheDocument();
  });

  it("shows error message on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 500 })
      ) as any
    );

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load quiz data")).toBeInTheDocument();
    });
  });

  it("shows error message on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("Network error"))) as any
    );

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load quiz data")).toBeInTheDocument();
    });
  });

  it("shows 'No quiz data' when sessions array is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ sessions: [] }),
        })
      ) as any
    );

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(
        screen.getByText("No quiz data available for this school yet.")
      ).toBeInTheDocument();
    });
  });

  it("fetches from the correct URL with school udise", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessions: [] }),
      })
    ) as any;
    vi.stubGlobal("fetch", mockFetch);

    render(<PerformanceTab schoolUdise="99887766" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/quiz-analytics/99887766/sessions"
      );
    });
  });
});
