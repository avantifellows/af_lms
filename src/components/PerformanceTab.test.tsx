import { cloneElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import PerformanceTab from "./PerformanceTab";

const mockReplace = vi.fn();
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();
// A stand-in for the App Router: by default a push or replace lands, and the
// tab re-renders with the new query. A test that needs a navigation to stay
// outstanding swaps in a no-op implementation and lands it by hand.
const mockUrlListeners = vi.hoisted(() => new Set<() => void>());
let mockUrlVersion = 0;
function landUrl(url: string) {
  mockSearchParams = new URLSearchParams(url.replace(/^\?/, ""));
  mockUrlVersion++;
  mockUrlListeners.forEach((l) => l());
}
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (l: () => void) => {
    mockUrlListeners.add(l);
    return () => mockUrlListeners.delete(l);
  };
  return {
    useRouter: vi.fn(() => ({ replace: mockReplace, push: mockPush })),
    useSearchParams: vi.fn(() => {
      useSyncExternalStore(subscribe, () => mockUrlVersion);
      return mockSearchParams;
    }),
  };
});

interface BatchOverviewProps {
  schoolUdise: string;
  grade: number;
  testCategory: string;
  program?: string;
  stream?: string;
  subject?: string;
  testGrade?: number;
  isNvs?: boolean;
  onFilterOptions?: (opts: {
    streams: string[];
    subjects: string[];
    testGrades: number[];
  }) => void;
}

let lastBatchOverviewProps: BatchOverviewProps | null = null;
let batchOverviewRenders: BatchOverviewProps[] = [];
vi.mock("./performance/BatchOverview", () => ({
  default: (props: BatchOverviewProps) => {
    lastBatchOverviewProps = props;
    batchOverviewRenders.push(props);
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
  beforeEach(() => {
    mockPush.mockImplementation(landUrl);
    mockReplace.mockImplementation(landUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockReplace.mockReset();
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
    batchOverviewRenders = [];
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
    expect(batchOverviewRenders.some((p) => p.isNvs)).toBe(false);
  });

  it("scopes a single-program NVS school's overview to NVS from its very first render", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([12], ["JNV NVS"]));

    render(<PerformanceTab schoolUdise="12345" />);

    await waitFor(() => {
      expect(screen.getByTestId("batch-overview")).toBeInTheDocument();
    });
    expect(batchOverviewRenders[0]).toMatchObject({ program: "JNV NVS", isNvs: true });
    expect(batchOverviewRenders.every((p) => p.program === "JNV NVS" && p.isNvs)).toBe(true);
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

  it("keeps every stream option after one is picked, so another can be chosen directly", async () => {
    vi.stubGlobal("fetch", mockGradesResponse([11], ["JNV CoE"]));
    lastBatchOverviewProps = null;

    render(<PerformanceTab schoolUdise="12345" />);

    fireEvent.click(await screen.findByRole("button", { name: "PCM" }));
    await waitFor(() => expect(lastBatchOverviewProps?.stream).toBe("pcm"));

    const streamGroup = screen.getByRole("group", { name: "Stream" });
    expect(within(streamGroup).getByRole("button", { name: "PCM" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(streamGroup).getByRole("button", { name: "PCB" }));
    await waitFor(() => expect(lastBatchOverviewProps?.stream).toBe("pcb"));
    expect(within(streamGroup).getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(within(streamGroup).getByRole("button", { name: "PCM" })).toBeInTheDocument();
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
    // grade=12 is the automatic pick written by replace before the click.
    expect(mockPush).toHaveBeenLastCalledWith("?grade=12", { scroll: false });
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
      expect(mockPush).toHaveBeenLastCalledWith("?grade=11", { scroll: false });
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
  describe("JNV NVS", () => {
    it("gives a multi-program school's other tab back every filter and its URL view", async () => {
      mockSearchParams = new URLSearchParams("program=JNV%20NVS&grade=12&view=cumulative");
      vi.stubGlobal("fetch", mockGradesResponse([12], ["JNV CoE", "JNV NVS"]));

      render(<PerformanceTab schoolUdise="12345" />);

      // NVS: per-test overview, narrow bar, despite ?view=cumulative.
      expect(await screen.findByTestId("batch-overview")).toBeInTheDocument();
      await screen.findByRole("group", { name: "Stream" });
      expect(screen.queryByRole("group", { name: "View" })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Test type" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "JNV CoE" }));

      // CoE honours the raw cumulative view and shows the full bar.
      expect(await screen.findByTestId("cumulative-al-table")).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Test type" })).toBeInTheDocument();
    });

    it("ignores view, category, subject and testGrade from an old link, without rewriting it", async () => {
      mockSearchParams = new URLSearchParams(
        "grade=12&view=cumulative&category=chapter&subject=Physics&testGrade=11"
      );
      vi.stubGlobal("fetch", mockGradesResponse([12], ["JNV NVS"]));

      render(<PerformanceTab schoolUdise="12345" />);

      expect(await screen.findByTestId("batch-overview")).toBeInTheDocument();
      expect(screen.queryByTestId("cumulative-al-table")).not.toBeInTheDocument();
      const props = batchOverviewRenders.at(-1);
      expect(props).toMatchObject({ testCategory: "full", isNvs: true });
      expect(props?.subject).toBeUndefined();
      expect(props?.testGrade).toBeUndefined();
      // Let the reported filter options settle before checking the URL.
      await screen.findByRole("group", { name: "Stream" });
      // Any URL write that did happen must still carry the ignored params.
      for (const [url] of [...mockReplace.mock.calls, ...mockPush.mock.calls] as [string][]) {
        expect(url).toContain("view=cumulative");
        expect(url).toContain("category=chapter");
        expect(url).toContain("subject=Physics");
        expect(url).toContain("testGrade=11");
      }
    });

    it("shows only the Grade and Stream filters", async () => {
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV NVS"]));

      render(<PerformanceTab schoolUdise="12345" />);

      // Stream appears once the overview reports its options; by then the
      // other groups would have too, if they were going to.
      expect(await screen.findByRole("group", { name: "Stream" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Grade" })).toBeInTheDocument();
      for (const name of ["Test grade", "Test type", "Subject", "View"]) {
        expect(screen.queryByRole("group", { name })).not.toBeInTheDocument();
      }
    });
  });

  describe("URL history", () => {
    // A fetch whose responses the test releases by hand, keyed by request URL,
    // so delayed and out-of-order analytics responses can be staged.
    function controlledFetch() {
      const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
      const fetchMock = vi.fn(
        (url: string) =>
          new Promise((resolve, reject) => {
            pending.set(url, { resolve, reject });
          })
      ) as any;
      return {
        fetchMock,
        async respond(url: string, body: { grades: number[]; programs: string[] }) {
          const p = pending.get(url);
          if (!p) throw new Error(`no pending request for ${url}`);
          await act(async () => {
            p.resolve({ ok: true, json: () => Promise.resolve(body) });
          });
        },
        async fail(url: string) {
          const p = pending.get(url);
          if (!p) throw new Error(`no pending request for ${url}`);
          await act(async () => {
            p.resolve({ ok: false, status: 500 });
          });
        },
      };
    }

    // Simulates the router settling on a URL — a push landing, or the browser's
    // Back/Forward — by re-rendering the same mounted tab with new params.
    function urlBecomes(rerender: (ui: React.ReactElement) => void, query: string, ui: React.ReactElement) {
      mockSearchParams = new URLSearchParams(query);
      // A fresh element, so React re-renders rather than bailing out on an
      // identical one — the router's re-render is what a URL change causes.
      act(() => rerender(cloneElement(ui)));
    }

    it("rehydrates every filter and the report from each new URL on the same mount", async () => {
      mockSearchParams = new URLSearchParams(
        "grade=12&stream=pcm&category=chapter&subject=Physics&testGrade=11"
      );
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      const ui = <PerformanceTab schoolUdise="12345" />;
      const { rerender } = render(ui);

      await waitFor(() =>
        expect(batchOverviewRenders.at(-1)).toMatchObject({
          grade: 12, stream: "pcm", testCategory: "chapter", subject: "Physics", testGrade: 11,
        })
      );

      // Back to an entry with every other key removed.
      urlBecomes(rerender, "grade=11", ui);
      await waitFor(() => expect(batchOverviewRenders.at(-1)?.grade).toBe(11));
      expect(batchOverviewRenders.at(-1)).toMatchObject({ testCategory: "full" });
      expect(batchOverviewRenders.at(-1)?.stream).toBeUndefined();
      expect(batchOverviewRenders.at(-1)?.subject).toBeUndefined();
      expect(batchOverviewRenders.at(-1)?.testGrade).toBeUndefined();

      urlBecomes(rerender, "grade=12&view=cumulative", ui);
      expect(await screen.findByTestId("cumulative-al-table")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cumulative" })).toHaveAttribute("aria-pressed", "true");

      urlBecomes(rerender, "grade=12&session=sess-1", ui);
      expect(await screen.findByTestId("test-deep-dive")).toBeInTheDocument();

      urlBecomes(rerender, "grade=12", ui);
      expect(await screen.findByTestId("batch-overview")).toBeInTheDocument();
      expect(screen.queryByTestId("test-deep-dive")).not.toBeInTheDocument();
      // Rehydration is reading history, not writing it.
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("pushes one entry per deliberate filter choice, preserving unrelated params", async () => {
      mockSearchParams = new URLSearchParams("tab=performance&grade=12&from=holistic");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: "PCM" }));
      expect(mockPush).toHaveBeenLastCalledWith(
        "?tab=performance&grade=12&from=holistic&stream=pcm", { scroll: false }
      );

      fireEvent.click(screen.getByRole("button", { name: "Chapter tests" }));
      expect(mockPush).toHaveBeenLastCalledWith(
        "?tab=performance&grade=12&from=holistic&stream=pcm&category=chapter", { scroll: false }
      );

      fireEvent.click(await screen.findByRole("button", { name: "Physics" }));
      expect(mockPush).toHaveBeenLastCalledWith(
        "?tab=performance&grade=12&from=holistic&stream=pcm&category=chapter&subject=Physics",
        { scroll: false }
      );

      const testGradeGroup = screen.getByRole("group", { name: "Test grade" });
      fireEvent.click(within(testGradeGroup).getByRole("button", { name: "11" }));
      expect(mockPush).toHaveBeenLastCalledWith(
        "?tab=performance&grade=12&from=holistic&stream=pcm&category=chapter&subject=Physics&testGrade=11",
        { scroll: false }
      );

      // Leaving Chapter tests drops the subject and the test grade with it.
      fireEvent.click(screen.getByRole("button", { name: "Full tests" }));
      expect(mockPush).toHaveBeenLastCalledWith(
        "?tab=performance&grade=12&from=holistic&stream=pcm", { scroll: false }
      );

      fireEvent.click(await screen.findByRole("button", { name: "Cumulative" }));
      expect(mockPush).toHaveBeenLastCalledWith(
        "?tab=performance&grade=12&from=holistic&stream=pcm&view=cumulative", { scroll: false }
      );

      expect(mockPush).toHaveBeenCalledTimes(6);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("keeps the subject when entering Chapter tests, clearing only the test grade", async () => {
      mockSearchParams = new URLSearchParams("grade=12&subject=Physics&testGrade=11");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      await screen.findByRole("group", { name: "Test grade" });
      fireEvent.click(screen.getByRole("button", { name: "Chapter tests" }));
      expect(mockPush).toHaveBeenLastCalledWith(
        "?grade=12&subject=Physics&category=chapter", { scroll: false }
      );
    });

    it("a grade change pushes once and atomically clears the report and dependent filters", async () => {
      mockSearchParams = new URLSearchParams(
        "tab=performance&grade=12&stream=pcm&category=chapter&subject=Physics&testGrade=11&view=cumulative&session=sess-1"
      );
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      await screen.findByTestId("test-deep-dive");
      const gradeGroup = screen.getByRole("group", { name: "Grade" });
      fireEvent.click(within(gradeGroup).getByRole("button", { name: "11" }));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        "?tab=performance&grade=11&category=chapter&view=cumulative", { scroll: false }
      );
      expect(await screen.findByTestId("batch-overview")).toBeInTheDocument();
      expect(screen.queryByTestId("test-deep-dive")).not.toBeInTheDocument();
    });

    it("a program change pushes once, clears its dependents but keeps category and view", async () => {
      mockSearchParams = new URLSearchParams(
        "tab=performance&program=JNV+CoE&grade=12&stream=pcm&category=chapter&subject=Physics&testGrade=11&view=cumulative"
      );
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE", "JNV Nodal"]));
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: "JNV Nodal" }));
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        "?tab=performance&program=JNV+Nodal&category=chapter&view=cumulative", { scroll: false }
      );
      // The new program's grades arrive and grade 12 is picked automatically —
      // a replace, so the program choice stays a single history entry.
      await waitFor(() =>
        expect(mockReplace).toHaveBeenCalledWith(
          "?tab=performance&program=JNV+Nodal&category=chapter&view=cumulative&grade=12",
          { scroll: false }
        )
      );
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("reselecting the active program or filter writes nothing and resets nothing", async () => {
      mockSearchParams = new URLSearchParams("program=JNV+CoE&grade=12&stream=pcm");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE", "JNV Nodal"]));
      render(<PerformanceTab schoolUdise="12345" />);

      await waitFor(() => expect(batchOverviewRenders.at(-1)?.stream).toBe("pcm"));
      await screen.findByRole("group", { name: "Stream" });
      fireEvent.click(screen.getByRole("button", { name: "JNV CoE" }));
      fireEvent.click(within(screen.getByRole("group", { name: "Grade" })).getByRole("button", { name: "12" }));
      fireEvent.click(within(screen.getByRole("group", { name: "Stream" })).getByRole("button", { name: "PCM" }));
      fireEvent.click(screen.getByRole("button", { name: "Full tests" }));
      fireEvent.click(screen.getByRole("button", { name: "Per test" }));
      fireEvent.click(screen.getByRole("button", { name: "All test grades" }));

      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(batchOverviewRenders.at(-1)).toMatchObject({ program: "JNV CoE", grade: 12, stream: "pcm" });
    });

    it("composes rapid choices against the latest intended URL, each reversible on its own", async () => {
      mockSearchParams = new URLSearchParams("grade=12");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      const ui = <PerformanceTab schoolUdise="12345" />;
      const { rerender } = render(ui);

      await screen.findByRole("group", { name: "Stream" });
      // The router holds each navigation until the test lands it.
      mockPush.mockImplementation(() => {});
      // Chapter tests, then Stream, before the router re-renders either.
      fireEvent.click(screen.getByRole("button", { name: "Chapter tests" }));
      fireEvent.click(within(screen.getByRole("group", { name: "Stream" })).getByRole("button", { name: "PCM" }));
      // Both choices show at once; the router gets one navigation at a time.
      expect(batchOverviewRenders.at(-1)).toMatchObject({ testCategory: "chapter", stream: "pcm" });
      expect(mockPush.mock.calls).toEqual([["?grade=12&category=chapter", { scroll: false }]]);

      // The router lands the first push late: the second choice survives and
      // goes out as its own entry, composed on top of the first.
      urlBecomes(rerender, "grade=12&category=chapter", ui);
      expect(batchOverviewRenders.at(-1)).toMatchObject({ testCategory: "chapter", stream: "pcm" });
      expect(mockPush.mock.calls).toEqual([
        ["?grade=12&category=chapter", { scroll: false }],
        ["?grade=12&category=chapter&stream=pcm", { scroll: false }],
      ]);
      urlBecomes(rerender, "grade=12&category=chapter&stream=pcm", ui);
      expect(batchOverviewRenders.at(-1)).toMatchObject({ testCategory: "chapter", stream: "pcm" });

      // Back undoes Stream alone, then Chapter tests alone; Forward replays.
      urlBecomes(rerender, "grade=12&category=chapter", ui);
      expect(batchOverviewRenders.at(-1)).toMatchObject({ testCategory: "chapter" });
      expect(batchOverviewRenders.at(-1)?.stream).toBeUndefined();
      urlBecomes(rerender, "grade=12", ui);
      expect(batchOverviewRenders.at(-1)).toMatchObject({ testCategory: "full" });
      urlBecomes(rerender, "grade=12&category=chapter", ui);
      expect(batchOverviewRenders.at(-1)).toMatchObject({ testCategory: "chapter" });
      expect(mockPush).toHaveBeenCalledTimes(2);
    });

    it("Back/Forward wins over a choice whose push has not landed yet", async () => {
      mockSearchParams = new URLSearchParams("grade=12");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      const ui = <PerformanceTab schoolUdise="12345" />;
      const { rerender } = render(ui);

      const pcm = await screen.findByRole("button", { name: "PCM" });
      mockPush.mockImplementation(() => {});
      fireEvent.click(pcm);
      urlBecomes(rerender, "grade=11&category=chapter", ui);

      expect(batchOverviewRenders.at(-1)).toMatchObject({ grade: 11, testCategory: "chapter" });
      expect(batchOverviewRenders.at(-1)?.stream).toBeUndefined();
    });

    it("automatic grade normalization never overwrites a grade restored by history", async () => {
      const f = controlledFetch();
      vi.stubGlobal("fetch", f.fetchMock);
      const ui = <PerformanceTab schoolUdise="12345" />;
      const { rerender } = render(ui);

      // History restores grade 10 while the grades response is still out.
      urlBecomes(rerender, "grade=10", ui);
      await f.respond("/api/quiz-analytics/12345/grades", { grades: [10, 11, 12], programs: ["JNV CoE"] });
      await f.respond("/api/quiz-analytics/12345/grades?program=JNV%20CoE", {
        grades: [10, 11, 12], programs: ["JNV CoE"],
      });

      await waitFor(() => expect(batchOverviewRenders.at(-1)?.grade).toBe(10));
      expect(mockReplace).not.toHaveBeenCalled();

      // Same-program grade history: a restored grade that is on offer stays.
      urlBecomes(rerender, "grade=11", ui);
      expect(batchOverviewRenders.at(-1)?.grade).toBe(11);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("derives a sole program without writing it, and normalizes a missing grade by replace", async () => {
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      await waitFor(() => expect(batchOverviewRenders.at(-1)).toMatchObject({ program: "JNV CoE", grade: 12 }));
      expect(mockReplace.mock.calls).toEqual([["?grade=12", { scroll: false }]]);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("keeps the program-selection gate on a multi-program school across history", async () => {
      mockSearchParams = new URLSearchParams("program=JNV+CoE&grade=12");
      vi.stubGlobal("fetch", mockGradesResponse([12], ["JNV CoE", "JNV Nodal"]));
      const ui = <PerformanceTab schoolUdise="12345" />;
      const { rerender } = render(ui);

      await screen.findByTestId("batch-overview");
      urlBecomes(rerender, "grade=12", ui);
      expect(await screen.findByText("Select a program to view performance data.")).toBeInTheDocument();
      expect(screen.queryByTestId("batch-overview")).not.toBeInTheDocument();
    });

    it("a locked program wins over every historical program param", async () => {
      mockSearchParams = new URLSearchParams("program=JNV+CoE&grade=12");
      const fetchMock = mockGradesResponse([12], ["JNV CoE", "JNV NVS"]);
      vi.stubGlobal("fetch", fetchMock);
      const ui = <PerformanceTab schoolUdise="12345" lockedProgram="JNV CoE" />;
      const { rerender } = render(ui);

      await screen.findByTestId("batch-overview");
      urlBecomes(rerender, "program=JNV+NVS&grade=12", ui);
      await screen.findByTestId("batch-overview");

      expect(batchOverviewRenders.every((p) => p.program === "JNV CoE" && !p.isNvs)).toBe(true);
      for (const [url] of fetchMock.mock.calls as [string][]) {
        expect(url).toBe("/api/quiz-analytics/12345/grades?program=JNV%20CoE");
      }
    });

    it("ignores an obsolete program's grades, failure and normalization after Back", async () => {
      mockSearchParams = new URLSearchParams("program=JNV+CoE");
      const f = controlledFetch();
      vi.stubGlobal("fetch", f.fetchMock);
      const ui = <PerformanceTab schoolUdise="12345" />;
      const { rerender } = render(ui);

      // History moves to Nodal while CoE's request is still out.
      urlBecomes(rerender, "program=JNV+Nodal&grade=11", ui);
      await f.respond("/api/quiz-analytics/12345/grades?program=JNV%20Nodal", {
        grades: [11], programs: ["JNV CoE", "JNV Nodal"],
      });
      await waitFor(() => expect(batchOverviewRenders.at(-1)).toMatchObject({ program: "JNV Nodal", grade: 11 }));

      // CoE's late answer (a grade the Nodal page doesn't have) is inert.
      await f.respond("/api/quiz-analytics/12345/grades?program=JNV%20CoE", {
        grades: [12], programs: ["JNV CoE", "JNV Nodal"],
      });
      expect(batchOverviewRenders.at(-1)).toMatchObject({ program: "JNV Nodal", grade: 11 });
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.queryByText("Failed to load quiz data")).not.toBeInTheDocument();
    });

    it("an obsolete failure is inert; a current failure recovers when history moves on", async () => {
      mockSearchParams = new URLSearchParams("program=JNV+CoE&grade=11");
      const f = controlledFetch();
      vi.stubGlobal("fetch", f.fetchMock);
      const ui = <PerformanceTab schoolUdise="12345" />;
      const { rerender } = render(ui);

      urlBecomes(rerender, "program=JNV+Nodal&grade=11", ui);
      await f.fail("/api/quiz-analytics/12345/grades?program=JNV%20CoE");
      expect(screen.queryByText("Failed to load quiz data")).not.toBeInTheDocument();
      expect(screen.getByText("Loading quiz data...")).toBeInTheDocument();

      await f.fail("/api/quiz-analytics/12345/grades?program=JNV%20Nodal");
      expect(screen.getByText("Failed to load quiz data")).toBeInTheDocument();

      // Back to CoE: a new current request clears the old error, then recovers.
      urlBecomes(rerender, "program=JNV+CoE&grade=11", ui);
      expect(screen.queryByText("Failed to load quiz data")).not.toBeInTheDocument();
      await f.respond("/api/quiz-analytics/12345/grades?program=JNV%20CoE", {
        grades: [11], programs: ["JNV CoE", "JNV Nodal"],
      });
      expect(await screen.findByTestId("batch-overview")).toBeInTheDocument();
      expect(batchOverviewRenders.at(-1)).toMatchObject({ program: "JNV CoE", grade: 11 });
    });

    it("drops option groups published for a grade that history has left", async () => {
      mockSearchParams = new URLSearchParams("grade=12");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      const ui = <PerformanceTab schoolUdise="12345" />;
      const { rerender } = render(ui);

      await screen.findByRole("group", { name: "Stream" });
      const staleOptions = batchOverviewRenders.at(-1)!.onFilterOptions!;

      urlBecomes(rerender, "grade=11", ui);
      await screen.findByRole("group", { name: "Stream" });
      // The grade-12 overview's publication arrives late, with no streams.
      act(() => staleOptions({ streams: [], subjects: [], testGrades: [] }));
      expect(screen.getByRole("group", { name: "Stream" })).toBeInTheDocument();
    });
  });
});
