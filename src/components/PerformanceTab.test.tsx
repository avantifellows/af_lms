import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  testGrade?: number;
  onFilterOptions?: (opts: {
    streams: string[];
    subjects: string[];
    testGrades: number[];
  }) => void;
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
          testGrades: [11, 12],
        })
      );
    }
    return (
      <div data-testid="batch-overview">
        BatchOverview: udise={props.schoolUdise}, grade={props.grade}, category={props.testCategory}, program={props.program ?? "none"}, stream={props.stream ?? "none"}, subject={props.subject ?? "none"}, testGrade={props.testGrade ?? "none"}
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
  testGrade?: number;
}
vi.mock("./performance/CumulativeALTable", () => ({
  default: (props: CumulativeALProps) => (
    <div data-testid="cumulative-al-table">
      CumulativeALTable: udise={props.schoolUdise}, grade={props.grade}, stream={props.stream ?? "none"}, testGrade={props.testGrade ?? "none"}
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

  it("lockedProgram wins over a ?program= URL override (centre confinement)", async () => {
    // A centre page locks the tab to the centre's program; a hand-edited URL
    // param must not widen the view to another program's data.
    mockSearchParams = new URLSearchParams("program=JNV%20NVS");
    const mockFetch = mockGradesResponse([11], ["JNV CoE", "JNV NVS"]);
    vi.stubGlobal("fetch", mockFetch);

    render(<PerformanceTab schoolUdise="99887766" lockedProgram="JNV CoE" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/quiz-analytics/99887766/grades?program=JNV%20CoE",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    expect(screen.getByText(/program=JNV CoE/)).toBeInTheDocument();
    // No program tabs when locked — the override has no UI path either.
    expect(screen.queryByRole("button", { name: "JNV NVS" })).not.toBeInTheDocument();
  });

  it("auto-selects grade and renders BatchOverview when single program and single grade", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    expect(screen.getByText(/grade=11/)).toBeInTheDocument();
  });

  it("shows grade selector when multiple grades exist (and no Grade 12)", async () => {
    // Use a grade list without 12 so the Grade-12 auto-default doesn't kick in.
    vi.stubGlobal("fetch", mockGradesResponse([9, 10, 11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByText("Select a grade to view performance data.")).toBeInTheDocument();
    });
    // One button per grade, none selected yet.
    for (const g of ["9", "10", "11"]) {
      expect(screen.getByRole("button", { name: g, pressed: false })).toBeInTheDocument();
    }
  });

  it("auto-selects Grade 12 when present in available grades", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([10, 11, 12], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    const calls = mockReplace.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => url.includes("grade=12"))).toBe(true);
  });

  it("re-picks a valid grade when the program scope narrows available grades", async () => {
    // Nellore case: the all-programs grade list (CoE gr11 + NVS gr12) makes the
    // default prefer grade 12, but the PM is scoped to CoE only, which has just
    // grade 11. The program-scoped re-fetch returns [11]; the stale grade=12
    // must be reconciled to 11 so data renders instead of a blank tab.
    lastBatchOverviewProps = null;
    const fetchByProgram = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url.includes("program=")
              ? { grades: [11], programs: ["JNV CoE"] }
              : { grades: [11, 12], programs: ["JNV CoE"] }
          ),
      })
    ) as any;
    vi.stubGlobal("fetch", fetchByProgram);

    render(<PerformanceTab schoolUdise="28191100306" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    // Lands on grade 11 (CoE's only grade), not the stale default of 12.
    await waitFor(() => {
      expect(lastBatchOverviewProps?.grade).toBe(11);
      expect(lastBatchOverviewProps?.program).toBe("JNV CoE");
    });
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

  it("renders the Test Grade buttons from reported options and forwards selection", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([12], ["JNV CoE"]));
    lastBatchOverviewProps = null;

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });

    // The group appears once BatchOverview reports its test grades, with
    // "All test grades" selected by default.
    const allBtn = await screen.findByRole("button", { name: "All test grades" });
    expect(allBtn).toHaveAttribute("aria-pressed", "true");

    const testGradeGroup = screen.getByRole("group", { name: "Test grade" });
    fireEvent.click(within(testGradeGroup).getByRole("button", { name: "11" }));
    await waitFor(() => {
      expect(lastBatchOverviewProps?.testGrade).toBe(11);
    });
    expect(within(testGradeGroup).getByRole("button", { name: "11" })).toHaveAttribute("aria-pressed", "true");
  });

  it("'All test grades' clears the URL param rather than writing testGrade=0", async () => {
    mockSearchParams = new URLSearchParams("testGrade=11");
    vi.stubGlobal("fetch", mockGradesResponse([12], ["JNV CoE"]));
    lastBatchOverviewProps = null;

    render(<PerformanceTab schoolUdise="12345" />);
    await waitFor(() => expect(lastBatchOverviewProps?.testGrade).toBe(11));

    fireEvent.click(await screen.findByRole("button", { name: "All test grades" }));
    await waitFor(() => expect(lastBatchOverviewProps?.testGrade).toBeUndefined());
    const last = mockReplace.mock.calls.at(-1)?.[0] as string;
    expect(last).not.toMatch(/testGrade=/);
  });

  it("re-clicking the selected grade is a no-op (does not reset filters)", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
    lastBatchOverviewProps = null;

    render(<PerformanceTab schoolUdise="12345" />);
    await waitFor(() => expect(lastBatchOverviewProps?.grade).toBe(12));
    fireEvent.click(await screen.findByRole("button", { name: "PCM" }));
    await waitFor(() => expect(lastBatchOverviewProps?.stream).toBe("pcm"));

    const gradeGroup = screen.getByRole("group", { name: "Grade" });
    fireEvent.click(within(gradeGroup).getByRole("button", { name: "12" }));
    // Still filtered by stream — nothing was reset.
    expect(lastBatchOverviewProps?.stream).toBe("pcm");
  });

  it("keeps the 'Select a program' gate on a deep dive reached by URL", async () => {
    mockSearchParams = new URLSearchParams("grade=12&session=sess-1");
    vi.stubGlobal("fetch", mockGradesResponse([12], ["JNV CoE", "JNV Nodal"]));

    render(<PerformanceTab schoolUdise="12345" />);

    expect(await screen.findByText("Select a program to view performance data.")).toBeInTheDocument();
    expect(screen.queryByTestId("test-deep-dive")).not.toBeInTheDocument();
  });

  it("puts 'Back to overview' first on a deep dive and returns to the overview on click", async () => {
    mockSearchParams = new URLSearchParams("session=sess-1");
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    const back = await screen.findByRole("button", { name: /back to overview/i });
    expect(screen.getByTestId("test-deep-dive")).toBeInTheDocument();
    // No filter bar on the deep dive — only the grade control beside the title.
    expect(screen.queryByRole("group", { name: "Test type" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Grade" })).toBeInTheDocument();
    // The back link precedes everything else in the document.
    expect(back.compareDocumentPosition(screen.getByTestId("test-deep-dive")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(back);
    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("test-deep-dive")).not.toBeInTheDocument();
    const calls = mockReplace.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => !url.includes("session="))).toBe(true);
  });

  it("renders subject filter pills only on chapter tab", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    // Default tab is now Full Tests — subject pills should NOT be visible
    expect(screen.queryByRole("button", { name: "Physics" })).not.toBeInTheDocument();

    // Switch to Chapter Tests — subject pills should appear
    fireEvent.click(screen.getByRole("button", { name: "Chapter tests" }));
    expect(await screen.findByRole("button", { name: "Physics" })).toBeInTheDocument();
  });

  it("seeds testCategory from ?category=chapter and writes ?category= when toggled", async () => {
    mockSearchParams = new URLSearchParams("category=chapter");
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));

    render(<PerformanceTab schoolUdise="12345" />);

    // Subject pills only render on chapter — their presence proves we landed on Chapter Tests
    expect(await screen.findByRole("button", { name: "Physics" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Full tests" }));
    await waitFor(() => {
      // Switching to full (the default) should drop the category param
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

    // Default category is Full Tests — sub-tab is visible from the start.
    expect(await screen.findByRole("button", { name: "Cumulative" })).toBeInTheDocument();

    // Switching to Chapter Tests hides the sub-tab.
    fireEvent.click(screen.getByRole("button", { name: "Chapter tests" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Cumulative" })).not.toBeInTheDocument();
    });

    // Switching back to Full Tests brings it back, and Cumulative swaps the view.
    fireEvent.click(screen.getByRole("button", { name: "Full tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cumulative" }));
    await waitFor(() => {
      expect(screen.getByTestId("cumulative-al-table")).toBeInTheDocument();
      expect(screen.queryByTestId("batch-overview")).not.toBeInTheDocument();
    });
  });
});
