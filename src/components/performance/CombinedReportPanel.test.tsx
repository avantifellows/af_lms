import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CombinedReportPanel, { visibleJobs, type Job } from "./CombinedReportPanel";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    job_id: overrides.job_id ?? "job-1",
    status: "done",
    student_count: 41,
    matched_count: 40,
    missing_count: 1,
    error: null,
    download_url: "https://example.com/report.pdf",
    created_at: "2026-08-21T18:22:39+05:30",
    updated_at: "2026-08-21T18:25:00+05:30",
    retry_count: 0,
    ...overrides,
  };
}

describe("visibleJobs", () => {
  it("shows only the newest finished report, hiding superseded downloads", () => {
    const jobs = [
      makeJob({ job_id: "old-1", created_at: "2026-08-17T21:48:26+05:30" }),
      makeJob({ job_id: "new", created_at: "2026-08-21T18:22:39+05:30" }),
      makeJob({ job_id: "old-2", created_at: "2026-08-21T14:43:58+05:30" }),
    ];

    expect(visibleJobs(jobs).map((j) => j.job_id)).toEqual(["new"]);
  });

  it("keeps the last good report downloadable while a regenerate is in flight", () => {
    const jobs = [
      makeJob({ job_id: "prev-done", created_at: "2026-08-21T18:22:39+05:30" }),
      makeJob({ job_id: "older-done", created_at: "2026-08-17T21:48:26+05:30" }),
      makeJob({
        job_id: "rebuild",
        status: "processing",
        download_url: null,
        created_at: "2026-08-22T10:00:00+05:30",
      }),
    ];

    expect(visibleJobs(jobs).map((j) => j.job_id)).toEqual(["rebuild", "prev-done"]);
  });

  it("keeps the last good report next to a failed rebuild", () => {
    const jobs = [
      makeJob({ job_id: "prev-done", created_at: "2026-08-21T18:22:39+05:30" }),
      makeJob({
        job_id: "failed",
        status: "errored",
        error: "boom",
        download_url: null,
        created_at: "2026-08-22T10:00:00+05:30",
      }),
    ];

    expect(visibleJobs(jobs).map((j) => j.job_id)).toEqual(["failed", "prev-done"]);
  });

  it("shows a lone in-flight or failed job when nothing has finished yet", () => {
    const jobs = [
      makeJob({
        job_id: "first-run",
        status: "queued",
        download_url: null,
        created_at: "2026-08-22T10:00:00+05:30",
      }),
    ];

    expect(visibleJobs(jobs).map((j) => j.job_id)).toEqual(["first-run"]);
  });

  it("returns nothing for no jobs", () => {
    expect(visibleJobs([])).toEqual([]);
  });
});

// The panel takes its verdict from GET; a read-only caller gets
// can_generate=false / read_only, and the API 403s generate and retry. The UI
// must not offer either click.
describe("CombinedReportPanel for a read-only caller", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubListResponse(body: Record<string, unknown>) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const props = {
    schoolUdise: "27361106702",
    sessionId: "EnableStudents_abc",
    testName: "Test 1",
    grade: 12,
  };

  it("disables Generate with the read-only message and hides Retry on failed jobs", async () => {
    stubListResponse({
      jobs: [
        makeJob({ job_id: "failed", status: "errored", error: "boom", download_url: null }),
      ],
      session_end_time: "2026-06-23T18:03:00.000Z",
      can_generate: false,
      blocked_reason: "read_only",
      blocked_message: "Your access is read-only.",
    });

    render(<CombinedReportPanel {...props} />);

    const generate = await screen.findByRole("button", { name: /generate combined report/i });
    await waitFor(() => expect(generate).toBeDisabled());
    expect(screen.getByText("Your access is read-only.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("still offers Retry to a full-access caller", async () => {
    stubListResponse({
      jobs: [
        makeJob({ job_id: "failed", status: "errored", error: "boom", download_url: null }),
      ],
      session_end_time: "2026-06-23T18:03:00.000Z",
      can_generate: true,
      blocked_reason: null,
      blocked_message: null,
    });

    render(<CombinedReportPanel {...props} />);

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
