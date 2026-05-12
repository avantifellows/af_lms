import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import PerformanceTab from "./PerformanceTab";

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

interface BatchOverviewProps {
  schoolUdise: string;
  grade: number;
  testCategory: string;
  program?: string;
  stream?: string;
  subject?: string;
  onFilterOptions?: (opts: { streams: string[]; subjects: string[] }) => void;
}

let lastBatchOverviewProps: BatchOverviewProps | null = null;
vi.mock("./performance/BatchOverview", () => ({
  default: (props: BatchOverviewProps) => {
    lastBatchOverviewProps = props;
    // simulate the real component reporting available filter options
    if (props.onFilterOptions) {
      Promise.resolve().then(() =>
        props.onFilterOptions?.({
          streams: ["pcm", "pcb"],
          subjects: ["Physics", "Chemistry"],
        })
      );
    }
    return (
      <div data-testid="batch-overview">
        BatchOverview: udise={props.schoolUdise}, grade={props.grade}, category={props.testCategory}, program={props.program ?? "none"}, stream={props.stream ?? "none"}, subject={props.subject ?? "none"}
      </div>
    );
  },
}));

vi.mock("./performance/TestDeepDive", () => ({
  default: () => <div data-testid="test-deep-dive">TestDeepDive</div>,
}));

interface CumulativeALProps {
  schoolUdise: string;
  grade: number;
  program?: string;
  stream?: string;
}
vi.mock("./performance/CumulativeALTable", () => ({
  default: (props: CumulativeALProps) => (
    <div data-testid="cumulative-al-table">
      CumulativeALTable: udise={props.schoolUdise}, grade={props.grade}, stream={props.stream ?? "none"}
    </div>
  ),
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
    mockReplace.mockReset();
    mockSearchParams = new URLSearchParams();
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

  it("renders stream filter pills once BatchOverview reports streams, and forwards selection", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));
    lastBatchOverviewProps = null;

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    // Pills appear after BatchOverview reports filter options
    const pcmBtn = await screen.findByRole("button", { name: "PCM" });
    expect(screen.getByRole("button", { name: "PCB" })).toBeInTheDocument();

    fireEvent.click(pcmBtn);
    await waitFor(() => {
      expect(lastBatchOverviewProps?.stream).toBe("pcm");
    });
  });

  it("renders subject filter pills only on chapter tab", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    expect(await screen.findByRole("button", { name: "Physics" })).toBeInTheDocument();

    // Switch to Full Tests — subject pills should disappear
    fireEvent.click(screen.getByRole("button", { name: "Full Tests" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Physics" })).not.toBeInTheDocument();
    });
  });

  it("seeds testCategory from ?category=full and writes ?category= when toggled", async () => {
    mockSearchParams = new URLSearchParams("category=full");
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    // Sub-tab is Full-only, so its presence proves we landed on Full
    expect(await screen.findByRole("button", { name: "Cumulative" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chapter Tests" }));
    await waitFor(() => {
      // Switching back to chapter should drop the category param
      const calls = mockReplace.mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => !url.includes("category="))).toBe(true);
    });
  });

  it("renders Per Test/Cumulative sub-tab on Full Tests, and switches to CumulativeALTable", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });

    // Sub-tab not visible on chapter
    expect(screen.queryByRole("button", { name: "Cumulative" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Full Tests" }));
    expect(await screen.findByRole("button", { name: "Cumulative" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cumulative" }));
    await waitFor(() => {
      expect(screen.getByTestId("cumulative-al-table")).toBeInTheDocument();
      expect(screen.queryByTestId("batch-overview")).not.toBeInTheDocument();
    });
  });
});
