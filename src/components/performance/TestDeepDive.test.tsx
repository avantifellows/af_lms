import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestDeepDiveData } from "@/types/quiz";
import TestDeepDive from "./TestDeepDive";

vi.mock("./SubjectAnalysisSection", () => ({
  default: () => null,
}));
vi.mock("./ChapterAnalysisSection", () => ({
  default: () => null,
}));
vi.mock("./StudentResultsTable", () => ({
  default: ({ testName }: { testName: string }) => <div>{testName}</div>,
}));

function deepDive(testName: string): TestDeepDiveData {
  return {
    summary: {
      test_name: testName,
      start_date: "2026-10-08",
      students_appeared: 0,
      students_submitted: 0,
      avg_score: 0,
      min_score: 0,
      max_score: 0,
      avg_marks: 0,
      min_marks: 0,
      max_marks: 0,
      total_marks: 0,
      avg_accuracy: 0,
      avg_attempt_rate: 0,
    },
    subjects: [],
    chapters: [],
    students: [],
  };
}

function deferredResponse(data: TestDeepDiveData) {
  let resolve!: (response: { ok: true; json: () => Promise<TestDeepDiveData> }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ ok: true; json: () => Promise<TestDeepDiveData> }>(
    (done, fail) => {
      resolve = done;
      reject = fail;
    }
  );
  return {
    promise,
    resolve: () => resolve({ ok: true, json: async () => data }),
    reject,
  };
}

describe("TestDeepDive request lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores a delayed response after moving to another report", async () => {
    const reportA = deferredResponse(deepDive("Report A"));
    const reportB = deferredResponse(deepDive("Report B"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(reportA.promise).mockReturnValueOnce(reportB.promise)
    );
    const onReportALoaded = vi.fn();
    const onReportBLoaded = vi.fn();

    const view = render(
      <TestDeepDive
        schoolUdise="school-1"
        grade={12}
        sessionId="report-a"
        onDataLoaded={onReportALoaded}
      />
    );

    view.rerender(
      <TestDeepDive
        schoolUdise="school-1"
        grade={12}
        sessionId="report-b"
        onDataLoaded={onReportBLoaded}
      />
    );

    await act(async () => {
      reportB.resolve();
      await reportB.promise;
    });
    await waitFor(() => expect(screen.getByText("Report B")).toBeInTheDocument());
    expect(onReportBLoaded).toHaveBeenCalledWith("Report B");

    await act(async () => {
      reportA.resolve();
      await reportA.promise;
    });

    expect(screen.getByText("Report B")).toBeInTheDocument();
    expect(screen.queryByText("Report A")).not.toBeInTheDocument();
    expect(onReportALoaded).not.toHaveBeenCalled();
  });

  it("keeps the current request loading when an obsolete request fails", async () => {
    const reportA = deferredResponse(deepDive("Report A"));
    const reportB = deferredResponse(deepDive("Report B"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(reportA.promise).mockReturnValueOnce(reportB.promise)
    );

    const view = render(
      <TestDeepDive schoolUdise="school-1" grade={12} sessionId="report-a" />
    );
    view.rerender(
      <TestDeepDive schoolUdise="school-1" grade={12} sessionId="report-b" />
    );

    await act(async () => {
      reportA.reject(new Error("obsolete failure"));
      await reportA.promise.catch(() => undefined);
    });

    expect(screen.getByText("Loading test details...")).toBeInTheDocument();
    expect(screen.queryByText("obsolete failure")).not.toBeInTheDocument();

    await act(async () => {
      reportB.resolve();
      await reportB.promise;
    });
    await waitFor(() => expect(screen.getByText("Report B")).toBeInTheDocument());
  });
});
