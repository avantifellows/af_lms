import { cloneElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import PerformanceTab from "./PerformanceTab";

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockBack = vi.fn();
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
    useRouter: vi.fn(() => ({ replace: mockReplace, push: mockPush, back: mockBack })),
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
  onTestClick?: (sessionId: string, testName: string) => void;
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
        <button onClick={() => props.onTestClick?.("sess-a", "Test A")}>Open Test A</button>
        <button onClick={() => props.onTestClick?.("sess-b", "Test B")}>Open Test B</button>
      </div>
    );
  },
}));

// Each deep dive's onDataLoaded, by the session it was rendered for — so a
// test can deliver a report's name late, after the report has changed.
let deepDiveLoaders = new Map<string, (testName: string) => void>();
vi.mock("./performance/TestDeepDive", async () => {
  const { useState } = await import("react");
  return {
    default: function TestDeepDive(props: { sessionId: string; onDataLoaded?: (testName: string) => void }) {
      // Local state stands in for the real deep dive's loaded data: it shows
      // which report this instance was first mounted for.
      const [mountedFor] = useState(props.sessionId);
      if (props.onDataLoaded && !deepDiveLoaders.has(props.sessionId)) {
        deepDiveLoaders.set(props.sessionId, props.onDataLoaded);
      }
      return (
        <div data-testid="test-deep-dive" data-mounted-for={mountedFor}>
          TestDeepDive
        </div>
      );
    },
  };
});

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
    mockBack.mockReset();
    mockSearchParams = new URLSearchParams();
    batchOverviewRenders = [];
    deepDiveLoaders = new Map();
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

  describe("Report history", () => {
    // A stand-in for the browser's session history: push and replace write
    // entries, Back/Forward move between them, and every landing re-renders the
    // mounted tab with that entry's query.
    function browserHistory(initial: string) {
      const entries = [initial];
      let at = 0;
      const strip = (url: string) => url.replace(/^\?/, "");
      mockSearchParams = new URLSearchParams(initial);
      mockPush.mockImplementation((url: string) => {
        entries.splice(at + 1);
        entries.push(strip(url));
        at++;
        landUrl(url);
      });
      mockReplace.mockImplementation((url: string) => {
        entries[at] = strip(url);
        landUrl(url);
      });
      const go = (delta: number) => {
        at += delta;
        landUrl(entries[at]);
      };
      mockBack.mockImplementation(() => go(-1));
      return {
        entries,
        get current() {
          return entries[at];
        },
        back: () => act(() => go(-1)),
        forward: () => act(() => go(1)),
      };
    }

    const heading = () => screen.getByRole("heading", { level: 2 });

    it("opening a report pushes one step; Back returns to the filtered overview and Forward restores it", async () => {
      const history = browserHistory("tab=performance&grade=12&stream=pcm&category=chapter&from=holistic");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Test A" }));
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(
        "?tab=performance&grade=12&stream=pcm&category=chapter&from=holistic&session=sess-a",
        { scroll: false }
      );
      expect(mockReplace).not.toHaveBeenCalled();
      expect(await screen.findByTestId("test-deep-dive")).toBeInTheDocument();
      expect(heading()).toHaveTextContent("Test A");

      history.back();
      expect(history.current).toBe("tab=performance&grade=12&stream=pcm&category=chapter&from=holistic");
      expect(await screen.findByTestId("batch-overview")).toBeInTheDocument();
      expect(batchOverviewRenders.at(-1)).toMatchObject({ grade: 12, stream: "pcm", testCategory: "chapter" });

      history.forward();
      expect(await screen.findByTestId("test-deep-dive")).toBeInTheDocument();
      expect(heading()).toHaveTextContent("Test A");
      expect(history.entries).toHaveLength(2);
    });

    it("Back to overview consumes the report step it proves followed its overview", async () => {
      const history = browserHistory("tab=performance&grade=12&stream=pcm");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Test A" }));
      fireEvent.click(await screen.findByRole("button", { name: /back to overview/i }));

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(history.current).toBe("tab=performance&grade=12&stream=pcm");
      expect(history.entries).toEqual([
        "tab=performance&grade=12&stream=pcm",
        "tab=performance&grade=12&stream=pcm&session=sess-a",
      ]);
      expect(await screen.findByTestId("batch-overview")).toBeInTheDocument();
    });

    it("tracks the report entry through a Grade change and Back, then consumes it", async () => {
      const history = browserHistory("tab=performance&grade=12");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Test A" }));
      await screen.findByTestId("test-deep-dive");
      const gradeGroup = screen.getByRole("group", { name: "Grade" });
      fireEvent.click(within(gradeGroup).getByRole("button", { name: "11" }));
      expect(history.current).toBe("tab=performance&grade=11");

      history.back();
      expect(history.current).toBe("tab=performance&grade=12&session=sess-a");
      fireEvent.click(await screen.findByRole("button", { name: /back to overview/i }));

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(history.current).toBe("tab=performance&grade=12");
      expect(history.entries).toEqual([
        "tab=performance&grade=12",
        "tab=performance&grade=12&session=sess-a",
        "tab=performance&grade=11",
      ]);
    });

    it("tracks the report entry through Back then Forward, then consumes it", async () => {
      const history = browserHistory("tab=performance&grade=12");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Test A" }));
      history.back();
      await screen.findByTestId("batch-overview");
      history.forward();
      fireEvent.click(await screen.findByRole("button", { name: /back to overview/i }));

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(history.current).toBe("tab=performance&grade=12");
      expect(history.entries).toHaveLength(2);
    });

    it("a direct-linked report clears only its session, by replace, without leaving", async () => {
      const history = browserHistory(
        "tab=performance&grade=12&stream=pcm&category=chapter&subject=Physics&program_id=94&source=progress&session=sess-a"
      );
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: /back to overview/i }));

      expect(mockBack).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith(
        "?tab=performance&grade=12&stream=pcm&category=chapter&subject=Physics&program_id=94&source=progress",
        { scroll: false }
      );
      expect(history.entries).toEqual([
        "tab=performance&grade=12&stream=pcm&category=chapter&subject=Physics&program_id=94&source=progress",
      ]);
      expect(await screen.findByTestId("batch-overview")).toBeInTheDocument();
    });

    it("a remounted report has unknown provenance and clears only its session", async () => {
      const history = browserHistory("tab=performance&grade=12");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      const { unmount } = render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Test A" }));
      await screen.findByTestId("test-deep-dive");
      // Another School section is shown, then Performance comes back.
      unmount();
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: /back to overview/i }));
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenLastCalledWith("?tab=performance&grade=12", { scroll: false });
      expect(history.entries).toEqual(["tab=performance&grade=12", "tab=performance&grade=12"]);
    });

    it("an outside navigation of the report entry invalidates its provenance", async () => {
      const history = browserHistory("tab=performance&grade=12");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      render(<PerformanceTab schoolUdise="12345" />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Test A" }));
      await screen.findByTestId("test-deep-dive");
      // Something else rewrites this entry's URL in place.
      act(() => landUrl("tab=performance&grade=12&session=sess-a&source=progress"));

      fireEvent.click(await screen.findByRole("button", { name: /back to overview/i }));
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenLastCalledWith("?tab=performance&grade=12&source=progress", { scroll: false });
      expect(history.entries).toHaveLength(2);
    });

    it("a report reached by history starts nameless, and a late name for another report can't label it", async () => {
      const history = browserHistory("tab=performance&grade=12&session=sess-a");
      vi.stubGlobal("fetch", mockGradesResponse([11, 12], ["JNV CoE"]));
      const ui = <PerformanceTab schoolUdise="12345" />;
      render(ui);

      await screen.findByTestId("test-deep-dive");
      expect(heading()).toHaveTextContent("Loading...");
      const lateA = deepDiveLoaders.get("sess-a")!;

      // History moves to report B before A's data arrives.
      act(() => landUrl("tab=performance&grade=12&session=sess-b"));
      expect(heading()).toHaveTextContent("Loading...");
      expect(screen.getByTestId("test-deep-dive")).toHaveAttribute("data-mounted-for", "sess-b");

      act(() => lateA("Test A"));
      expect(heading()).toHaveTextContent("Loading...");

      act(() => deepDiveLoaders.get("sess-b")!("Test B"));
      expect(heading()).toHaveTextContent("Test B");
      // Naming a report is not navigation.
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(history.entries).toHaveLength(1);
    });
  });
});
