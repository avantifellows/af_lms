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

export interface Job {
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

function createdAtMs(job: Job): number {
  const t = new Date(job.created_at).getTime();
  return isNaN(t) ? 0 : t;
}

// Each regenerate fully replaces the PDF, so show only the newest run — plus
// the newest finished one while a rebuild is in flight or failed, so the last
// good download doesn't vanish.
export function visibleJobs(jobs: Job[]): Job[] {
  const sorted = [...jobs].sort((a, b) => createdAtMs(b) - createdAtMs(a));
  const latest = sorted[0];
  if (!latest) return [];
  if (latest.status === "done") return [latest];
  const latestDone = sorted.find((job) => job.status === "done");
  return latestDone ? [latest, latestDone] : [latest];
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
  // Generation eligibility comes from the API rather than being recomputed here,
  // so the button can never disagree with what POST will actually allow.
  const [canGenerate, setCanGenerate] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [sessionEndTime, setSessionEndTime] = useState<string | null>(null);
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
      setCanGenerate(Boolean(data.can_generate));
      setBlockedMessage(data.blocked_message ?? null);
      setBlockedReason(data.blocked_reason ?? null);
      setSessionEndTime(data.session_end_time ?? null);
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

  const generate = async (regenerate = false) => {
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
          ...(regenerate ? { regenerate: true } : {}),
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

  // A finished report is the one blocked state ops can act on: the data behind it
  // may have been fixed since, so offer a deliberate rebuild rather than a dead end.
  const alreadyGenerated = blockedReason === "already_generated";
  // Keep the label on "Regenerate" while the rebuild is in flight — it flips to
  // job_in_progress the moment the job is queued, and reverting the wording
  // mid-run reads as the button having reset.
  const hasFinishedReport = jobs.some((j) => j.status === "done");

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
          onClick={() => generate(alreadyGenerated)}
          disabled={submitting || loading || (!canGenerate && !alreadyGenerated)}
          title={alreadyGenerated ? undefined : blockedMessage ?? undefined}
          className="px-4 py-2 min-h-[44px] text-xs md:text-sm font-bold uppercase tracking-wide rounded-lg bg-accent text-text-on-accent shadow-sm transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting
            ? "Starting…"
            : hasFinishedReport
              ? "Regenerate"
              : "Generate combined report"}
        </button>
      </div>

      {/* Not an error — the ordinary state of a test that is still open, or one
          whose report has already been produced. */}
      {!loading && blockedMessage && !alreadyGenerated && (
        <div className="p-2 bg-bg-card border border-border text-text-muted rounded text-xs">
          {blockedMessage}
          {blockedReason === "session_not_ended" && sessionEndTime && (
            <> Session ends {formatTime(sessionEndTime)}.</>
          )}
        </div>
      )}

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
          {visibleJobs(jobs).map((job) => (
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
                    className="inline-flex items-center justify-center px-3 py-1.5 min-h-[36px] text-xs font-bold uppercase tracking-wide rounded-lg bg-accent text-text-on-accent hover:opacity-90"
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
