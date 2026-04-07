import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PerformanceTab from "./PerformanceTab";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("./performance/BatchOverview", () => ({
  default: ({ schoolUdise, grade, testCategory, program }: any) => (
    <div data-testid="batch-overview">
      BatchOverview: udise={schoolUdise}, grade={grade}, category={testCategory}, program={program ?? "none"}
    </div>
  ),
}));

vi.mock("./performance/TestDeepDive", () => ({
  default: () => <div data-testid="test-deep-dive">TestDeepDive</div>,
}));

function mockGradesResponse(grades: number[], programs: string[] = []) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ grades, programs }),
    })
  ) as any;
}

describe("PerformanceTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading spinner initially", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as any
    );

    render(<PerformanceTab schoolUdise="12345" />);
    expect(screen.getByText("Loading quiz data...")).toBeInTheDocument();
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

  it("shows 'No quiz data' when grades and programs are empty", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([], []));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(
        screen.getByText("No quiz data available for this school yet.")
      ).toBeInTheDocument();
    });
  });

  it("fetches grades from the correct URL", async () => {
    const mockFetch = mockGradesResponse([], []);
    vi.stubGlobal("fetch", mockFetch);

    render(<PerformanceTab schoolUdise="99887766" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/quiz-analytics/99887766/grades",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it("auto-selects grade and renders BatchOverview when single program and single grade", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    expect(screen.getByText(/grade=11/)).toBeInTheDocument();
  });

  it("shows grade selector when multiple grades exist", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([10, 11, 12], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByText("Select a grade to view performance data.")).toBeInTheDocument();
    });
    expect(screen.getByText("Select grade...")).toBeInTheDocument();
  });

  it("shows program tabs when multiple programs exist", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([10], ["JNV CoE", "JNV Nodal", "JNV NVS"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByText("JNV CoE")).toBeInTheDocument();
      expect(screen.getByText("JNV Nodal")).toBeInTheDocument();
      expect(screen.getByText("JNV NVS")).toBeInTheDocument();
    });
  });

  it("does not show program tabs for single program", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([10], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    expect(screen.queryByText("JNV CoE")).not.toBeInTheDocument();
  });
});
