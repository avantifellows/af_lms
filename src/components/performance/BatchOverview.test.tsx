import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import BatchOverview from "./BatchOverview";
import { RetainedHeightFrame } from "./PerformanceStates";
import type { BatchOverviewData, TestTrendPoint } from "@/types/quiz";

function test(overrides: Partial<TestTrendPoint>): TestTrendPoint {
  return {
    session_id: "s",
    test_name: "Test",
    start_date: "2026-07-01",
    student_count: 0,
    stream_student_count: 0,
    test_format: null,
    test_stream: null,
    test_grade: null,
    subjects: [],
    ...overrides,
  };
}

function mockOverview(data: Omit<BatchOverviewData, "summary">) {
  const body: BatchOverviewData = { summary: { tests_conducted: 0, avg_participation: 0 }, ...data };
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Hand-written: three mandated tests spanning formats and target grades, none
// with a test stream, so attendance is the plain student count.
const MANDATED_TESTS: TestTrendPoint[] = [
  test({ session_id: "m1", test_name: "Mandated Chapter Test", test_format: "chapter_test", test_grade: 11, student_count: 40, subjects: ["Physics"] }),
  test({ session_id: "m2", test_name: "Mandated Full Test", test_format: "full_test", test_grade: 12, student_count: 50 }),
  test({ session_id: "m3", test_name: "Mandated Homework", test_format: "homework", test_grade: null, student_count: 30 }),
];

const noop = () => {};

describe("BatchOverview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("NVS lists every mandated test whatever its format and test grade", async () => {
    mockOverview({ tests: MANDATED_TESTS, totalEnrolled: 60, enrolledByStream: {}, streams: [] });

    render(
      <BatchOverview
        schoolUdise="12345"
        grade={12}
        testCategory="full"
        program="JNV NVS"
        testGrade={12}
        subject="Physics"
        isNvs
        onTestClick={noop}
      />
    );

    expect(await screen.findByText("Mandated Chapter Test")).toBeInTheDocument();
    expect(screen.getByText("Mandated Full Test")).toBeInTheDocument();
    expect(screen.getByText("Mandated Homework")).toBeInTheDocument();
    // Stat cards count the listed tests: 3 tests, (40 + 50 + 30) / 3 = 40.
    expect(screen.getByText("Tests Conducted").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Avg Attendance").parentElement).toHaveTextContent("40");
  });

  it("NVS shows the mandated-test empty state when no tests come back", async () => {
    mockOverview({ tests: [], totalEnrolled: 60, enrolledByStream: {}, streams: [] });

    render(
      <BatchOverview schoolUdise="12345" grade={12} testCategory="chapter" program="JNV NVS" isNvs onTestClick={noop} />
    );

    expect(
      await screen.findByText("No system-wide mandated tests yet for this grade/stream")
    ).toBeInTheDocument();
  });

  it("non-NVS keeps the Chapter/Full split, subject filter, and its empty-state copy", async () => {
    mockOverview({ tests: MANDATED_TESTS, totalEnrolled: 60, enrolledByStream: {}, streams: [] });

    const { rerender } = render(
      <BatchOverview schoolUdise="12345" grade={12} testCategory="full" program="JNV CoE" onTestClick={noop} />
    );

    expect(await screen.findByText("Mandated Full Test")).toBeInTheDocument();
    expect(screen.queryByText("Mandated Chapter Test")).not.toBeInTheDocument();
    expect(screen.queryByText("Mandated Homework")).not.toBeInTheDocument();

    rerender(
      <BatchOverview schoolUdise="12345" grade={12} testCategory="chapter" program="JNV CoE" onTestClick={noop} />
    );
    expect(screen.getByText("Mandated Chapter Test")).toBeInTheDocument();
    expect(screen.getByText("Mandated Homework")).toBeInTheDocument();
    expect(screen.queryByText("Mandated Full Test")).not.toBeInTheDocument();

    rerender(
      <BatchOverview schoolUdise="12345" grade={12} testCategory="chapter" program="JNV CoE" subject="Physics" testGrade={11} onTestClick={noop} />
    );
    expect(screen.getByText("Mandated Chapter Test")).toBeInTheDocument();
    expect(screen.queryByText("Mandated Homework")).not.toBeInTheDocument();

    rerender(
      <BatchOverview schoolUdise="12345" grade={12} testCategory="full" program="JNV CoE" testGrade={11} onTestClick={noop} />
    );
    expect(
      screen.getByText("No full tests targeting grade 11 available for this grade yet.")
    ).toBeInTheDocument();
  });

  it("non-NVS keeps its no-data copy", async () => {
    mockOverview({ tests: [], totalEnrolled: null, enrolledByStream: {}, streams: [] });

    render(
      <BatchOverview schoolUdise="12345" grade={12} testCategory="full" program="JNV CoE" onTestClick={noop} />
    );

    expect(
      await screen.findByText("No quiz data available for this grade yet.")
    ).toBeInTheDocument();
  });

  // The overview's request is bound to its School/Grade/Program/Stream: once
  // the tab moves on (a filter click or Back/Forward), the old request's late
  // answer must not land in the new view.
  describe("obsolete responses", () => {
    function controlledOverviewFetch() {
      const pending = new Map<string, { resolve: (v: unknown) => void }>();
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => new Promise((resolve) => pending.set(url, { resolve })))
      );
      const settle = async (url: string, response: unknown) => {
        const p = pending.get(url);
        if (!p) throw new Error(`no pending request for ${url}`);
        await act(async () => p.resolve(response));
      };
      return {
        respond: (url: string, data: Omit<BatchOverviewData, "summary">) =>
          settle(url, {
            ok: true,
            json: () => Promise.resolve({ summary: { tests_conducted: 0, avg_participation: 0 }, ...data }),
          }),
        fail: (url: string) => settle(url, { ok: false, status: 500 }),
      };
    }

    const PCM_URL = "/api/quiz-analytics/12345/batch-overview?grade=12&program=JNV%20CoE&stream=pcm";
    const PCB_URL = "/api/quiz-analytics/12345/batch-overview?grade=12&program=JNV%20CoE&stream=pcb";
    const PCM_TEST = test({ session_id: "p1", test_name: "PCM Full Test", test_format: "full_test", student_count: 10 });
    const PCB_TEST = test({ session_id: "b1", test_name: "PCB Full Test", test_format: "full_test", student_count: 20 });

    function overview(stream: string, onFilterOptions = vi.fn()) {
      return (
        <BatchOverview
          schoolUdise="12345" grade={12} testCategory="full" program="JNV CoE" stream={stream}
          onTestClick={noop} onFilterOptions={onFilterOptions}
        />
      );
    }

    it("ignores a late success, and its finalisation, for a stream history has left", async () => {
      const f = controlledOverviewFetch();
      const onFilterOptions = vi.fn();
      const { rerender } = render(overview("pcm", onFilterOptions));
      rerender(overview("pcb", onFilterOptions));

      await f.respond(PCM_URL, { tests: [PCM_TEST], totalEnrolled: 10, enrolledByStream: {}, streams: ["pcm", "pcb"] });
      expect(screen.queryByText("PCM Full Test")).not.toBeInTheDocument();
      expect(screen.getByText("Loading batch overview...")).toBeInTheDocument();
      expect(onFilterOptions).not.toHaveBeenCalledWith(expect.objectContaining({ streams: ["pcm", "pcb"] }));

      await f.respond(PCB_URL, { tests: [PCB_TEST], totalEnrolled: 20, enrolledByStream: {}, streams: ["pcm", "pcb"] });
      expect(screen.getByText("PCB Full Test")).toBeInTheDocument();
      expect(onFilterOptions).toHaveBeenLastCalledWith({ streams: ["pcm", "pcb"], subjects: [], testGrades: [] });
    });

    it("retains height while loading, then releases excess height for a shorter result", async () => {
      let contentHeight = 640;
      let currentScrollY = 120;
      const resizeCallbacks = new Map<Element, ResizeObserverCallback>();
      const disconnects = vi.fn();
      class TestResizeObserver {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) { resizeCallbacks.set(target, this.callback); }
        unobserve(target: Element) { resizeCallbacks.delete(target); }
        disconnect() { disconnects(); }
      }
      vi.stubGlobal("ResizeObserver", TestResizeObserver);
      const addEventListener = vi.spyOn(window, "addEventListener");
      const removeEventListener = vi.spyOn(window, "removeEventListener");
      const rect = (height: number, top = 0) => ({
        width: 800,
        height,
        top,
        right: 800,
        bottom: top + height,
        left: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
      const displayedHeight = (element: HTMLElement, naturalHeight: number) =>
        Math.max(naturalHeight, Number.parseFloat(element.style.minHeight) || 0);
      const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function () {
          const top = 300 - currentScrollY;
          if (this.dataset.testid === "batch-overview-frame-content") return rect(contentHeight, top);
          if (this.dataset.testid === "batch-overview-frame") return rect(displayedHeight(this, contentHeight), top);
          if (this.dataset.testid === "performance-frame-content") {
            const batchFrame = this.querySelector<HTMLElement>('[data-testid="batch-overview-frame"]');
            return rect(batchFrame ? displayedHeight(batchFrame, contentHeight) : contentHeight, top);
          }
          if (this.dataset.testid === "performance-frame") {
            const child = this.querySelector<HTMLElement>('[data-testid="batch-overview-frame"]');
            return rect(displayedHeight(this, child ? displayedHeight(child, contentHeight) : contentHeight), top);
          }
          return rect(0);
        });
      const scrollY = vi.spyOn(window, "scrollY", "get").mockImplementation(() => currentScrollY);
      const innerHeight = vi.spyOn(window, "innerHeight", "get").mockReturnValue(450);
      const f = controlledOverviewFetch();
      const framedOverview = (stream: string) => (
        <RetainedHeightFrame loading={false} testId="performance-frame">
          {overview(stream)}
        </RetainedHeightFrame>
      );
      const { rerender, unmount } = render(framedOverview("pcm"));
      await f.respond(PCM_URL, {
        tests: [PCM_TEST], totalEnrolled: 10, enrolledByStream: {}, streams: ["pcm", "pcb"],
      });

      rerender(framedOverview("pcb"));

      expect(screen.getByTestId("batch-overview-frame")).toHaveStyle({ minHeight: "640px" });
      expect(screen.getByTestId("performance-frame")).toHaveStyle({ minHeight: "640px" });
      expect(screen.getByText("Loading batch overview...")).toBeInTheDocument();
      expect(disconnects).toHaveBeenCalledTimes(1);
      expect(removeEventListener.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1);

      contentHeight = 240;
      await f.respond(PCB_URL, {
        tests: [PCB_TEST], totalEnrolled: 20, enrolledByStream: {}, streams: ["pcm", "pcb"],
      });
      expect(screen.getByText("PCB Full Test")).toBeInTheDocument();
      // 270px is the minimum that keeps y=120 scrollable in a 450px viewport
      // when the frame starts at document y=300. The old 640px is released.
      expect(screen.getByTestId("batch-overview-frame")).toHaveStyle({ minHeight: "270px" });
      await act(async () => {
        resizeCallbacks.get(screen.getByTestId("performance-frame-content"))?.([], {} as ResizeObserver);
      });
      expect(screen.getByTestId("performance-frame")).toHaveStyle({ minHeight: "270px" });

      currentScrollY = 40;
      act(() => window.dispatchEvent(new Event("scroll")));
      expect(screen.getByTestId("batch-overview-frame")).toHaveStyle({ minHeight: "240px" });
      await act(async () => {
        resizeCallbacks.get(screen.getByTestId("performance-frame-content"))?.([], {} as ResizeObserver);
      });
      expect(screen.getByTestId("performance-frame")).toHaveStyle({ minHeight: "240px" });

      currentScrollY = 160;
      act(() => window.dispatchEvent(new Event("scroll")));
      expect(screen.getByTestId("batch-overview-frame")).toHaveStyle({ minHeight: "240px" });
      expect(screen.getByTestId("performance-frame")).toHaveStyle({ minHeight: "240px" });

      rerender(framedOverview("pcb"));
      await act(async () => {
        resizeCallbacks.get(screen.getByTestId("batch-overview-frame-content"))?.([], {} as ResizeObserver);
        resizeCallbacks.get(screen.getByTestId("performance-frame-content"))?.([], {} as ResizeObserver);
      });
      expect(screen.getByTestId("batch-overview-frame")).toHaveStyle({ minHeight: "240px" });
      expect(screen.getByTestId("performance-frame")).toHaveStyle({ minHeight: "240px" });

      contentHeight = 400;
      await act(async () => {
        resizeCallbacks.get(screen.getByTestId("batch-overview-frame-content"))?.([], {} as ResizeObserver);
      });
      await act(async () => {
        resizeCallbacks.get(screen.getByTestId("performance-frame-content"))?.([], {} as ResizeObserver);
      });
      expect(screen.getByTestId("batch-overview-frame")).toHaveStyle({ minHeight: "400px" });
      expect(screen.getByTestId("performance-frame")).toHaveStyle({ minHeight: "400px" });

      const addedScrollListeners = addEventListener.mock.calls
        .filter(([type]) => type === "scroll")
        .map(([, listener]) => listener);
      unmount();
      const removedScrollListeners = removeEventListener.mock.calls
        .filter(([type]) => type === "scroll")
        .map(([, listener]) => listener);
      expect(disconnects).toHaveBeenCalledTimes(3);
      expect(addedScrollListeners.every((listener) => removedScrollListeners.includes(listener))).toBe(true);
      bounds.mockRestore();
      scrollY.mockRestore();
      innerHeight.mockRestore();
      addEventListener.mockRestore();
      removeEventListener.mockRestore();
    });

    it("ignores a late failure for a stream history has left", async () => {
      const f = controlledOverviewFetch();
      const { rerender } = render(overview("pcm"));
      rerender(overview("pcb"));

      await f.fail(PCM_URL);
      expect(screen.queryByText("Failed to fetch batch overview")).not.toBeInTheDocument();
      expect(screen.getByText("Loading batch overview...")).toBeInTheDocument();
    });

    it("a new request clears the old error, and recovers", async () => {
      const f = controlledOverviewFetch();
      const { rerender } = render(overview("pcm"));
      await f.fail(PCM_URL);
      expect(screen.getByText("Failed to fetch batch overview")).toBeInTheDocument();

      rerender(overview("pcb"));
      expect(screen.queryByText("Failed to fetch batch overview")).not.toBeInTheDocument();
      await f.respond(PCB_URL, { tests: [PCB_TEST], totalEnrolled: 20, enrolledByStream: {}, streams: [] });
      expect(screen.getByText("PCB Full Test")).toBeInTheDocument();
    });

    it("a current empty result clears the option groups published before it", async () => {
      const f = controlledOverviewFetch();
      const onFilterOptions = vi.fn();
      const { rerender } = render(overview("pcm", onFilterOptions));
      await f.respond(PCM_URL, {
        tests: [test({ session_id: "p1", test_format: "full_test", test_grade: 12, subjects: ["Physics"] })],
        totalEnrolled: 10, enrolledByStream: {}, streams: ["pcm", "pcb"],
      });
      expect(onFilterOptions).toHaveBeenLastCalledWith({ streams: ["pcm", "pcb"], subjects: ["Physics"], testGrades: [12] });

      rerender(overview("pcb", onFilterOptions));
      await f.respond(PCB_URL, { tests: [], totalEnrolled: 0, enrolledByStream: {}, streams: [] });
      expect(onFilterOptions).toHaveBeenLastCalledWith({ streams: [], subjects: [], testGrades: [] });
    });
  });
});

describe("RetainedHeightFrame viewport recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function rect(height: number, top: number) {
    return {
      width: 800,
      height,
      top,
      right: 800,
      bottom: top + height,
      left: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  }

  it("brings a shorter overview back into view after leaving a deeply-scrolled report", () => {
    let currentScrollY = 3_000;
    let contentHeight = 3_500;
    const documentTop = 300;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => currentScrollY);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(450);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((options) => {
      currentScrollY = typeof options === "number" ? options : options.top ?? currentScrollY;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const height = this.dataset.testid === "recovery-frame-content"
        ? contentHeight
        : Math.max(contentHeight, Number.parseFloat(this.style.minHeight) || 0);
      return rect(height, documentTop - currentScrollY);
    });

    const view = (recoverViewportOnEnter: boolean) => (
      <RetainedHeightFrame
        loading={false}
        testId="recovery-frame"
        recoverViewportOnEnter={recoverViewportOnEnter}
      >
        <div>Performance content</div>
      </RetainedHeightFrame>
    );
    const { rerender } = render(view(false));
    expect(screen.getByTestId("recovery-frame")).toHaveStyle({ minHeight: "3500px" });

    contentHeight = 640;
    rerender(view(true));

    expect(scrollTo).toHaveBeenCalledWith({ top: 490, behavior: "auto" });
    expect(screen.getByTestId("recovery-frame")).toHaveStyle({ minHeight: "640px" });
  });

  it("keeps the scroll position when the overview already overlaps the viewport", () => {
    let contentHeight = 2_000;
    const currentScrollY = 120;
    const documentTop = 300;
    vi.spyOn(window, "scrollY", "get").mockReturnValue(currentScrollY);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(450);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const height = this.dataset.testid === "recovery-frame-content"
        ? contentHeight
        : Math.max(contentHeight, Number.parseFloat(this.style.minHeight) || 0);
      return rect(height, documentTop - currentScrollY);
    });

    const view = (recoverViewportOnEnter: boolean) => (
      <RetainedHeightFrame
        loading={false}
        testId="recovery-frame"
        recoverViewportOnEnter={recoverViewportOnEnter}
      >
        <div>Performance content</div>
      </RetainedHeightFrame>
    );
    const { rerender } = render(view(false));

    contentHeight = 640;
    rerender(view(true));

    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByTestId("recovery-frame")).toHaveStyle({ minHeight: "640px" });
  });
});
