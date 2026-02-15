import { render, screen, waitFor } from "@testing-library/react";
import VisitsTab from "./VisitsTab";

vi.mock("./SchoolTabs", () => ({
  VisitHistorySection: ({ visits, schoolCode }: any) => (
    <div data-testid="visit-history-section">
      VisitHistory: {visits.length} visits, code={schoolCode}
    </div>
  ),
}));

describe("VisitsTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading spinner initially", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as any
    );

    render(<VisitsTab schoolCode="SC001" />);
    expect(screen.getByText("Loading visit history...")).toBeInTheDocument();
  });

  it("renders VisitHistorySection after successful fetch", async () => {
    const visits = [
      {
        id: 1,
        visit_date: "2025-01-15",
        status: "completed",
        inserted_at: "2025-01-15T10:00:00Z",
        ended_at: "2025-01-15T12:00:00Z",
      },
      {
        id: 2,
        visit_date: "2025-01-20",
        status: "in_progress",
        inserted_at: "2025-01-20T09:00:00Z",
        ended_at: null,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ visits }),
        })
      ) as any
    );

    render(<VisitsTab schoolCode="SC001" />);

    await waitFor(() => {
      expect(screen.getByTestId("visit-history-section")).toBeInTheDocument();
    });

    expect(screen.getByText(/2 visits/)).toBeInTheDocument();
    expect(screen.getByText(/code=SC001/)).toBeInTheDocument();
  });

  it("shows error message on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 500 })
      ) as any
    );

    render(<VisitsTab schoolCode="SC001" />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load visit data")).toBeInTheDocument();
    });
  });

  it("shows error message on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("Network error"))) as any
    );

    render(<VisitsTab schoolCode="SC001" />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load visit data")).toBeInTheDocument();
    });
  });

  it("fetches from the correct URL with school code", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ visits: [] }),
      })
    ) as any;
    vi.stubGlobal("fetch", mockFetch);

    render(<VisitsTab schoolCode="MYSCHOOL" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/pm/visits?school_code=MYSCHOOL"
      );
    });
  });
});
