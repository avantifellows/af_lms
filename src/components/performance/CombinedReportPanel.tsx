"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  schoolUdise: string;
  sessionId: string;
  testName: string;
  grade: number;
  program?: string;
  stream?: string;
}

type JobStatus = "queued" | "started" | "processing" | "done" | "errored";

interface Job {
  job_id: string;
  status: JobStatus;
  student_count: number | null;
  matched_count: number | null;
  missing_count: number | null;
  error: string | null;
  download_url: string | null;
  created_at: string;
  updated_at: string;
  retry_count: number;
}

const ACTIVE: JobStatus[] = ["queued", "started", "processing"];
const POLL_MS = 4000;

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: "bg-bg-card-alt text-text-muted border-border",
  started: "bg-accent/10 text-accent border-accent/30",
  processing: "bg-accent/10 text-accent border-accent/30",
  done: "bg-success-bg text-success border-success",
  errored: "bg-danger-bg text-danger border-danger",
};

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  started: "Started",
  processing: "Processing",
  done: "Ready",
  errored: "Failed",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function CombinedReportPanel({
  schoolUdise,
  sessionId,
  testName,
  grade,
  program,
  stream,
}: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const base = `/api/quiz-analytics/${schoolUdise}/combined-reports`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `${base}?session_id=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load reports");
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [base, sessionId]);

  // Initial load + reload when the selected test changes.
  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Poll while any job is still in flight.
  useEffect(() => {
    const hasActive = jobs.some((j) => ACTIVE.includes(j.status));
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(refresh, POLL_MS);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobs, refresh]);

  const generate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          test_name: testName || null,
          grade,
          program,
          stream,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to start report");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start report");
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async (jobId: string) => {
    setError(null);
    try {
      const res = await fetch(`${base}/${jobId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to retry");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to retry");
    }
  };

  return (
    <div className="bg-bg-card-alt border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-primary">
            Combined student reports
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Generate one printable PDF of every student&apos;s report for this test.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={submitting}
          className="px-4 py-2 min-h-[44px] text-xs md:text-sm font-bold uppercase tracking-wide rounded-lg bg-accent text-text-on-accent shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {submitting
            ? "Starting…"
            : jobs.some((j) => j.status === "done")
              ? "Regenerate"
              : "Generate combined report"}
        </button>
      </div>

      {error && (
        <div className="p-2 bg-danger-bg border border-danger text-danger rounded text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-xs text-text-muted">
          No reports generated yet for this test.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((job) => (
            <li
              key={job.job_id}
              className="py-2 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide rounded border ${STATUS_STYLE[job.status]}`}
                >
                  {STATUS_LABEL[job.status]}
                </span>
                <span className="text-xs text-text-muted">
                  {formatTime(job.created_at)}
                </span>
                {job.status === "done" && job.matched_count != null && (
                  <span className="text-xs text-text-muted">
                    {job.matched_count} of {job.student_count} students
                    {job.missing_count ? ` · ${job.missing_count} missing` : ""}
                  </span>
                )}
                {job.status === "errored" && job.error && (
                  <span className="text-xs text-danger">{job.error}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {job.status === "done" && job.download_url && (
                  <a
                    href={job.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 min-h-[36px] text-xs font-bold uppercase tracking-wide rounded-lg bg-accent text-text-on-accent hover:opacity-90"
                  >
                    Download
                  </a>
                )}
                {job.status === "errored" && (
                  <button
                    onClick={() => retry(job.job_id)}
                    className="px-3 py-1.5 min-h-[36px] text-xs font-bold uppercase tracking-wide rounded-lg bg-bg-card-alt text-text-primary border border-border hover:border-accent/50"
                  >
                    Retry
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
