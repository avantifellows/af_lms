"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Toast from "@/components/Toast";
import {
  GurukulFormatOptions,
  TestFormatOptions,
} from "@/lib/quiz-session-options";
import { addHours, toDateTimeLocalValue } from "@/lib/quiz-session-time";
import { parseBatchStream } from "@/lib/batch-code";
import {
  CMS_SOURCE,
  CMS_TEST_TYPE_OPTIONS,
  type CmsTestType,
} from "@/lib/cms-tests";
import type { ExamTrack } from "@/types/curriculum";

interface BatchOption {
  id: number;
  name: string;
  batch_id: string;
  parent_id: number | null;
  program_id: number | null;
}

interface QuizSession {
  id: number;
  name: string;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean | null;
  portal_link?: string | null;
  meta_data?: Record<string, unknown> | null;
}

interface EditQuizSessionValues {
  name: string;
  startTime: string;
  endTime: string;
  showAnswers: boolean;
  showScores: boolean;
  shuffle: boolean;
  gurukulFormatType: string;
}

interface FeedbackToast {
  variant: "error" | "warning" | "success" | "info";
  message: string;
}

type SessionLifecycleState = "starts_later" | "live" | "ended" | "unknown";
type CreateTimingMode = "start_now" | "schedule";
type FetchSessionsOptions = {
  background?: boolean;
};
type RowActionKind = "regenerate" | "toggle" | "end_now";

interface QuizTemplateOption {
  id: number;
  code: string;
  name: string;
  grade: number | null;
  course: string;
  stream: string;
  testFormat: string;
  testPurpose: string;
  testType: string;
  optionalLimits: string;
  cmsLink: string;
  cmsSourceId: string;
  questionPdf: string;
  solutionPdf: string;
  rankingCutoffDate: string;
  sheetName: string;
}

interface BatchDerivation {
  error: string | null;
  stream: string;
  parentBatchId: string;
  parentBatchName: string;
}

const PER_PAGE = 50;
const DEFAULT_DURATION_HOURS = 4;
const AUTO_SYNC_INTERVAL_MINUTES = 60;
const QA_GURUKUL_FORMAT = "qa";
const GradeOptions = [11, 12];

// New-CMS chapter-test picker (source toggle inside session creation). Test subtypes +
// their labels are shared with the server routes via CMS_TEST_TYPE_OPTIONS (@/lib/cms-tests).
type TestSource = "legacy" | "cms";
const EXAM_TRACK_OPTIONS: { value: ExamTrack; label: string }[] = [
  { value: "jee_main", label: "JEE Main" },
  { value: "jee_advanced", label: "JEE Advanced" },
  { value: "neet", label: "NEET" },
];
const CMS_SUBJECT_OPTIONS = ["Physics", "Chemistry", "Maths", "Biology"];

interface CmsChapterOption {
  id: number;
  code: string;
  name: string;
}

interface CmsTestOption {
  id: number;
  code: string;
  name: string;
  chapterId: number | null;
  marks: number | null;
  duration: string | null;
}

function getDefaultSessionName(baseName: string): string {
  return baseName.trim();
}

function getGurukulFormatForShuffle(gurukulFormatType: string, shuffle: boolean) {
  return shuffle ? QA_GURUKUL_FORMAT : gurukulFormatType;
}

function getCompactBatchLabel(values: string[] | undefined): string {
  if (!values?.length) return "-";
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function toDateTimeInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return toDateTimeLocalValue(parsed);
}

function getStatusLabel(status?: string) {
  if (!status) return "unknown";
  return status.toLowerCase();
}

function getSyncLabel(meta: Record<string, unknown> | null | undefined) {
  const normalized = getStatusLabel(getMetaString(meta, "etl_sync_status"));
  const hasSyncedToBq = meta?.has_synced_to_bq;

  if (normalized === "pending") return "Queued";
  if (normalized === "failed") return "Sync Failed";
  if (normalized === "synced") return "Synced";
  if (hasSyncedToBq === true) return "Synced";
  if (hasSyncedToBq === false) return "Not Synced";
  return "Unknown";
}

function getSyncToneClasses(meta: Record<string, unknown> | null | undefined) {
  const normalized = getStatusLabel(getMetaString(meta, "etl_sync_status"));
  const hasSyncedToBq = meta?.has_synced_to_bq;

  if (normalized === "pending") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }
  if (normalized === "failed") {
    return "border border-red-200 bg-red-50 text-red-700";
  }
  if (normalized === "synced") {
    return "border border-border-accent bg-success-bg text-accent";
  }
  if (hasSyncedToBq === true) {
    return "border border-border-accent bg-success-bg text-accent";
  }
  return "border border-border bg-bg-card-alt text-text-secondary";
}

function getLastSyncedAt(meta: Record<string, unknown> | null | undefined): string | null {
  const timestampKeys = [
    "last_synced_at",
    "last_sync_at",
    "synced_at",
    "etl_synced_at",
    "etl_last_synced_at",
    "bq_synced_at",
    "bq_last_synced_at",
  ];

  for (const key of timestampKeys) {
    const value = getMetaString(meta, key);
    if (value) return value;
  }

  return null;
}

function getMetaString(
  meta: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" ? value : undefined;
}

function getMetaScalar(
  meta: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const value = meta?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function getMetaBoolean(
  meta: Record<string, unknown> | null | undefined,
  key: string
): boolean | undefined {
  const value = meta?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function getOmrAdminLink(meta: Record<string, unknown> | null | undefined): string {
  const explicitOmrAdmin = getMetaString(meta, "admin_testing_omr_link");
  if (explicitOmrAdmin) return explicitOmrAdmin;

  const adminTestingLink = getMetaString(meta, "admin_testing_link");
  if (!adminTestingLink) return "";

  return adminTestingLink.includes("?")
    ? `${adminTestingLink}&omrMode=true`
    : `${adminTestingLink}?omrMode=true`;
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    window.prompt("Copy link:", value);
  }
}

function toYesNo(value: boolean | undefined): string {
  return value ? "Yes" : "No";
}

function getSessionLifecycleState(
  session: Pick<QuizSession, "start_time" | "end_time">,
  nowMs = Date.now()
): SessionLifecycleState {
  if (!session.start_time || !session.end_time) return "unknown";

  const startTime = new Date(session.start_time).getTime();
  const endTime = new Date(session.end_time).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return "unknown";
  }

  if (endTime <= nowMs) return "ended";
  if (startTime > nowMs) return "starts_later";
  return "live";
}

function getLifecycleLabel(state: SessionLifecycleState): string {
  if (state === "live") return "Live";
  if (state === "starts_later") return "Scheduled";
  if (state === "ended") return "Ended";
  return "Unknown";
}

function getLifecycleClasses(state: SessionLifecycleState): string {
  if (state === "live") {
    return "border border-border-accent bg-success-bg text-accent";
  }
  if (state === "starts_later") {
    return "border border-sky-200 bg-sky-50 text-sky-700";
  }
  if (state === "ended") {
    return "border border-border bg-bg-card-alt text-text-secondary";
  }
  return "border border-border bg-bg-card-alt text-text-secondary";
}

function isSessionProcessing(session: QuizSession | null | undefined): boolean {
  if (!session) return false;
  return getStatusLabel(getMetaString(session.meta_data, "status")) === "pending";
}

function canEndNow(session: QuizSession | null | undefined, nowMs = Date.now()): boolean {
  if (!session || isSessionProcessing(session)) return false;
  if (session.is_active === false) return false;
  return getSessionLifecycleState(session, nowMs) === "live";
}

function areSessionsEqual(previous: QuizSession[], next: QuizSession[]): boolean {
  return JSON.stringify(previous) === JSON.stringify(next);
}

export default function QuizSessionsTab({
  schoolId,
  canEdit = false,
  programId,
}: {
  schoolId: string;
  canEdit?: boolean;
  // When set (centre pages), restricts every batch surface (selector, session
  // creation) to this program's batches.
  programId?: number;
}) {
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [selectedClassBatch, setSelectedClassBatch] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<FeedbackToast | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<QuizSession | null>(null);
  const [editingSession, setEditingSession] = useState<QuizSession | null>(null);
  const [savingAction, setSavingAction] = useState<{
    id: number;
    kind: RowActionKind;
  } | null>(null);
  const [menuState, setMenuState] = useState<{
    id: number;
    left: number;
    top: number;
  } | null>(null);

  const parentIdSet = useMemo(() => {
    const set = new Set<number>();
    batches.forEach((batch) => {
      if (batch.parent_id !== null) {
        set.add(batch.parent_id);
      }
    });
    return set;
  }, [batches]);

  const classBatches = useMemo(
    () => batches.filter((batch) => batch.parent_id !== null && !parentIdSet.has(batch.id)),
    [batches, parentIdSet]
  );

  const batchNameMap = useMemo(() => {
    const map = new Map<string, string>();
    batches.forEach((batch) => {
      map.set(batch.batch_id, batch.name);
    });
    return map;
  }, [batches]);

  const fetchBatches = useCallback(async () => {
    setLoadingBatches(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/quiz-sessions/batches?schoolId=${schoolId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch batches");
      }
      const data = await response.json();
      const fetched: BatchOption[] = data.batches || [];
      // Centre pages see only their program's batches; school pages see all.
      setBatches(
        programId != null
          ? fetched.filter((b) => b.program_id === programId)
          : fetched,
      );
    } catch (err) {
      console.error(err);
      setLoadError("Failed to fetch class batches.");
    } finally {
      setLoadingBatches(false);
    }
  }, [schoolId, programId]);

  const fetchSessions = useCallback(
    async (
      pageIndex: number,
      classBatchId?: string,
      options?: FetchSessionsOptions
    ) => {
      const background = options?.background ?? false;
      if (!background) {
        setLoadingSessions(true);
        setLoadError(null);
      }
      try {
        const params = new URLSearchParams({
          schoolId,
          page: String(pageIndex),
          per_page: String(PER_PAGE),
        });
        if (classBatchId) {
          params.set("classBatchId", classBatchId);
        }

        const response = await fetch(`/api/quiz-sessions?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Failed to fetch sessions");
        }

        const data = await response.json();
        const nextSessions = data.sessions || [];
        setSessions((previous) =>
          areSessionsEqual(previous, nextSessions) ? previous : nextSessions
        );
        setHasMore(Boolean(data.hasMore));
        setSelectedSession((previous) => {
          if (!previous) return previous;
          const refreshed = nextSessions.find((session: QuizSession) => session.id === previous.id);
          return refreshed ?? previous;
        });
      } catch (err) {
        console.error(err);
        if (!background) {
          setLoadError("Failed to fetch quiz sessions.");
        }
      } finally {
        if (!background) {
          setLoadingSessions(false);
        }
      }
    },
    [schoolId]
  );

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  useEffect(() => {
    fetchSessions(page, selectedClassBatch || undefined);
  }, [page, selectedClassBatch, fetchSessions]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchSessions(page, selectedClassBatch || undefined, { background: true });
    }, 40000);
    return () => window.clearInterval(intervalId);
  }, [page, selectedClassBatch, fetchSessions]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!menuState) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest("[data-menu-root]")) return;
      setMenuState(null);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [menuState]);

  const handleRegenerate = async (sessionId: number) => {
    try {
      setSavingAction({ id: sessionId, kind: "regenerate" });
      setFeedbackToast(null);
      const response = await fetch(`/api/quiz-sessions/${sessionId}/regenerate`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(data?.error || "Failed to request regeneration");
      }
      setFeedbackToast({
        variant: "info",
        message: data?.message || "Regeneration requested. Session links will refresh shortly.",
      });
      await fetchSessions(page, selectedClassBatch || undefined);
    } catch (err) {
      console.error(err);
      setFeedbackToast({
        variant: "error",
        message: "Failed to request regeneration.",
      });
    } finally {
      setSavingAction(null);
    }
  };

  const handleCreated = async (message?: string) => {
    setIsCreateOpen(false);
    setPage(0);
    if (message) {
      setFeedbackToast({ variant: "success", message });
    }
    await fetchSessions(0, selectedClassBatch || undefined);
  };

  const handleUpdated = async (message?: string) => {
    setEditingSession(null);
    setSelectedSession(null);
    if (message) {
      setFeedbackToast({ variant: "success", message });
    }
    await fetchSessions(page, selectedClassBatch || undefined);
  };

  const handleToggleEnabled = async (session: QuizSession) => {
    try {
      setSavingAction({ id: session.id, kind: "toggle" });
      setFeedbackToast(null);

      const response = await fetch(`/api/quiz-sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isActive: !(session.is_active ?? true),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to update session");
      }

      setSelectedSession(null);
      setFeedbackToast({
        variant: session.is_active === false ? "success" : "info",
        message:
          session.is_active === false ? "Session enabled." : "Session disabled.",
      });
      await fetchSessions(page, selectedClassBatch || undefined);
    } catch (err) {
      console.error(err);
      setFeedbackToast({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to update session.",
      });
    } finally {
      setSavingAction(null);
    }
  };

  const handleEndNow = async (session: QuizSession) => {
    try {
      setSavingAction({ id: session.id, kind: "end_now" });
      setFeedbackToast(null);

      const response = await fetch(`/api/quiz-sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end_now",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to end session");
      }

      setSelectedSession(null);
      setFeedbackToast({
        variant: "success",
        message: "Session ended now.",
      });
      await fetchSessions(page, selectedClassBatch || undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to end session.";
      if (message !== "Only live sessions can be ended now") {
        console.error(err);
      }
      setFeedbackToast({
        variant: message === "Only live sessions can be ended now" ? "warning" : "error",
        message,
      });
      await fetchSessions(page, selectedClassBatch || undefined, { background: true });
    } finally {
      setSavingAction(null);
    }
  };

  return (
    <div className="space-y-4">
      {feedbackToast && (
        <Toast
          variant={feedbackToast.variant}
          message={feedbackToast.message}
          placement="bottom-right"
          autoDismissMs={3600}
          onDismiss={() => setFeedbackToast(null)}
        />
      )}

      <div className="rounded-lg border border-border bg-bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b-4 border-border-accent px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Quiz Sessions</h2>
          {canEdit ? (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent shadow-sm hover:bg-accent-hover"
            >
              <span aria-hidden="true" className="relative inline-block h-3.5 w-3.5 shrink-0">
                <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-current" />
                <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-current" />
              </span>
              <span>Create Quiz Session</span>
            </button>
          ) : null}
        </div>
      </div>

      {loadError && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="flex flex-col gap-3 px-1 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Class Batch
          </label>
          <select
            value={selectedClassBatch}
            onChange={(event) => {
              setSelectedClassBatch(event.target.value);
              setPage(0);
            }}
            disabled={loadingBatches}
            className="block min-h-[44px] w-full max-w-sm rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-bg-card-alt"
          >
            <option value="">All class batches</option>
            {classBatches.map((batch) => (
              <option key={batch.id} value={batch.batch_id}>
                {batch.name}
              </option>
            ))}
          </select>
        </div>
        <div className="text-xs leading-5 text-text-secondary">
          Results sync automatically every {AUTO_SYNC_INTERVAL_MINUTES} minutes. Manual sync is not needed.
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
          <thead className="bg-bg-card-alt border-b-2 border-border-accent">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Class Batches
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Window
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Sync
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-bg-card">
            {loadingSessions && sessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-text-secondary">
                  Loading sessions...
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-text-secondary">
                  No quiz sessions found.
                </td>
              </tr>
            ) : (
              sessions.map((session) => {
                const lifecycle = getSessionLifecycleState(session, currentTimeMs);
                const testCode = getMetaString(session.meta_data, "test_code");
                const classBatchIds = getMetaString(session.meta_data, "batch_id")
                  ?.split(",")
                  .filter(Boolean);
                const classBatchNames = classBatchIds?.map(
                  (batchId) => batchNameMap.get(batchId) || batchId
                );
                const regenerateBusy =
                  savingAction?.id === session.id && savingAction.kind === "regenerate";
                const sessionProcessing = isSessionProcessing(session);

                return (
                  <tr
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    className={`cursor-pointer hover:bg-hover-bg ${
                      lifecycle === "ended" ? "opacity-80" : ""
                    }`}
                  >
                    <td className="px-4 py-4 text-sm">
                      <div className="font-semibold text-text-primary">{session.name}</div>
                      {testCode ? (
                        <div className="mt-1 font-mono text-xs text-text-secondary">
                          {testCode}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 text-sm text-text-secondary">
                      {getCompactBatchLabel(classBatchNames)}
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <SessionWindowSummary session={session} lifecycle={lifecycle} />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <StatusSummary
                        session={session}
                        sessionProcessing={sessionProcessing}
                        regenerateBusy={regenerateBusy}
                      />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <SyncSummary session={session} />
                    </td>
                    <td
                      className={`px-4 py-4 text-sm text-text-secondary ${
                        sessionProcessing ? "opacity-60" : ""
                      }`}
                    >
                      {canEdit ? (
                        <div className="relative inline-block text-left" data-menu-root>
                          <button
                            data-menu-root
                            onClick={(event) => {
                              event.stopPropagation();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setMenuState((previous) =>
                                previous?.id === session.id
                                  ? null
                                  : { id: session.id, left: rect.left, top: rect.bottom }
                              );
                            }}
                            className="rounded-lg px-2 py-1 text-text-secondary hover:bg-hover-bg hover:text-text-primary"
                            aria-label="Open actions"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="h-5 w-5"
                              aria-hidden="true"
                            >
                              <circle cx="5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="19" cy="12" r="1.8" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-text-muted">View only</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => setPage((previous) => Math.max(0, previous - 1))}
          disabled={page === 0}
          className="min-h-[44px] rounded-lg border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted"
        >
          Previous
        </button>
        <span className="text-sm font-mono text-text-secondary">Page {page + 1}</span>
        <button
          onClick={() => setPage((previous) => previous + 1)}
          disabled={!hasMore}
          className="min-h-[44px] rounded-lg border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted"
        >
          Next
        </button>
      </div>

      {isCreateOpen && (
        <QuizSessionCreateModal
          batches={batches}
          onClose={() => setIsCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {selectedSession && (
        <QuizSessionDetailsModal
          session={selectedSession}
          batchNameMap={batchNameMap}
          canEdit={canEdit}
          onEdit={() => {
            setEditingSession(selectedSession);
            setSelectedSession(null);
          }}
          onClose={() => setSelectedSession(null)}
        />
      )}

      {editingSession && (
        <QuizSessionEditModal
          session={editingSession}
          batchNameMap={batchNameMap}
          onClose={() => setEditingSession(null)}
          onSaved={handleUpdated}
        />
      )}

      {canEdit && menuState && (
        <div
          data-menu-root
          className="fixed z-50 w-48 overflow-hidden rounded-lg border border-border bg-bg-card shadow-md"
          style={{ left: menuState.left, top: menuState.top }}
        >
          {(() => {
            const currentSession = sessions.find((session) => session.id === menuState.id);
            const sessionProcessing = isSessionProcessing(currentSession);
            const busy = savingAction?.id === menuState.id;
            const enabled = currentSession?.is_active !== false;
            const endNowAvailable = canEndNow(currentSession, currentTimeMs);
            // Regenerate fires the legacy SNS -> etl-data-flow path, which cannot rebuild a
            // new-CMS quiz. Hide it for CMS sessions until the CMS regenerate path ships;
            // clicking it would flip the session to a stuck "pending" and brick its actions.
            const isCmsSession =
              getMetaString(currentSession?.meta_data, "cms_source") === CMS_SOURCE;

            return (
              <>
                {/* Edit is hidden for new-CMS sessions only: their edit path fires the
                    legacy SNS patch, which KeyErrors on the absent meta_data.course and
                    flips the session to "failed". Legacy sessions still edit normally.
                    Re-enable for CMS once the CMS session-patch fix ships. */}
                {!isCmsSession ? (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!currentSession) return;
                      setEditingSession(currentSession);
                      setMenuState(null);
                    }}
                    disabled={sessionProcessing || busy}
                    className="block w-full px-4 py-2 text-left text-sm font-medium text-text-primary hover:bg-hover-bg disabled:text-text-muted"
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!currentSession) return;
                    handleToggleEnabled(currentSession);
                    setMenuState(null);
                  }}
                  disabled={sessionProcessing || busy}
                  className="block w-full px-4 py-2 text-left text-sm font-medium text-text-primary hover:bg-hover-bg disabled:text-text-muted"
                >
                  {enabled ? "Disable Session" : "Enable Session"}
                </button>
                {endNowAvailable ? (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!currentSession) return;
                      handleEndNow(currentSession);
                      setMenuState(null);
                    }}
                    disabled={busy}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-text-primary hover:bg-hover-bg disabled:text-text-muted"
                  >
                    <span>End Now</span>
                    <span className="text-base leading-none text-amber-700" aria-hidden="true">
                      ⏱
                    </span>
                  </button>
                ) : null}
                {!isCmsSession ? (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRegenerate(menuState.id);
                      setMenuState(null);
                    }}
                    disabled={sessionProcessing || busy}
                    className="block w-full px-4 py-2 text-left text-sm font-medium text-text-primary hover:bg-hover-bg disabled:text-text-muted"
                  >
                    Regenerate
                  </button>
                ) : null}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function QuizSessionCreateModal({
  batches,
  onClose,
  onCreated,
}: {
  batches: BatchOption[];
  onClose: () => void;
  onCreated: (message?: string) => void;
}) {
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [classBatchIds, setClassBatchIds] = useState<string[]>([]);
  const [selectedGrade, setSelectedGrade] = useState("");
  const [testFormat, setTestFormat] = useState("");
  const [templates, setTemplates] = useState<QuizTemplateOption[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [timingMode, setTimingMode] = useState<CreateTimingMode>("start_now");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [showScores, setShowScores] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const [gurukulFormatType, setGurukulFormatType] = useState("both");
  const [startTime, setStartTime] = useState(() => {
    const now = new Date();
    return toDateTimeLocalValue(now);
  });
  const [endTime, setEndTime] = useState(() => {
    const now = new Date();
    return toDateTimeLocalValue(addHours(now, DEFAULT_DURATION_HOURS));
  });
  const [endTimeEdited, setEndTimeEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // New-CMS test picker. chapter_test drills Exam track -> Grade -> Subject -> Chapter -> test;
  // major_test skips subject/chapter and lists straight off exam track + grade.
  const [testSource, setTestSource] = useState<TestSource>("legacy");
  const [cmsTestType, setCmsTestType] = useState<CmsTestType>("chapter_test");
  const [cmsExamTrack, setCmsExamTrack] = useState<ExamTrack | "">("");
  const [cmsGrade, setCmsGrade] = useState("");
  const [cmsSubject, setCmsSubject] = useState("");
  const [cmsChapters, setCmsChapters] = useState<CmsChapterOption[]>([]);
  const [cmsChapterId, setCmsChapterId] = useState<number | null>(null);
  const [cmsTests, setCmsTests] = useState<CmsTestOption[]>([]);
  const [loadingCmsChapters, setLoadingCmsChapters] = useState(false);
  const [loadingCmsTests, setLoadingCmsTests] = useState(false);
  const [cmsError, setCmsError] = useState<string | null>(null);
  const [selectedCmsTestId, setSelectedCmsTestId] = useState<number | null>(null);

  const parentIdSet = useMemo(() => {
    const set = new Set<number>();
    batches.forEach((batch) => {
      if (batch.parent_id !== null) {
        set.add(batch.parent_id);
      }
    });
    return set;
  }, [batches]);

  const availableClassBatches = useMemo(
    () => batches.filter((batch) => batch.parent_id !== null && !parentIdSet.has(batch.id)),
    [batches, parentIdSet]
  );

  const batchDerivation = useMemo<BatchDerivation>(() => {
    const selectedRows = classBatchIds
      .map((batchId) => batches.find((batch) => batch.batch_id === batchId))
      .filter(Boolean) as BatchOption[];

    if (selectedRows.length === 0) {
      return {
        error: null,
        stream: "",
        parentBatchId: "",
        parentBatchName: "",
      };
    }

    const parentIds = new Set(
      selectedRows
        .map((row) => row.parent_id)
        .filter((value): value is number => value !== null)
    );
    if (parentIds.size !== 1) {
      return {
        error: "Selected class batches must belong to the same parent batch.",
        stream: "",
        parentBatchId: "",
        parentBatchName: "",
      };
    }

    const parentId = Array.from(parentIds)[0];
    const parentRow = batches.find((batch) => batch.id === parentId);
    if (!parentRow) {
      return {
        error: "Unable to find the parent batch for the selected class batches.",
        stream: "",
        parentBatchId: "",
        parentBatchName: "",
      };
    }

    const streamSet = new Set(
      selectedRows
        .map((row) => parseBatchStream(row.batch_id))
        .filter(Boolean)
    );
    if (streamSet.size !== 1) {
      return {
        error: "Unable to derive stream from the selected class batches.",
        stream: "",
        parentBatchId: "",
        parentBatchName: "",
      };
    }

    return {
      error: null,
      stream: Array.from(streamSet)[0],
      parentBatchId: parentRow.batch_id,
      parentBatchName: parentRow.name,
    };
  }, [batches, classBatchIds]);

  useEffect(() => {
    if (endTimeEdited) return;
    const parsedStart = new Date(startTime);
    if (Number.isNaN(parsedStart.getTime())) return;
    setEndTime(toDateTimeLocalValue(addHours(parsedStart, DEFAULT_DURATION_HOURS)));
  }, [startTime, endTimeEdited]);

  useEffect(() => {
    if (!batchDerivation.stream || !selectedGrade || !testFormat) {
      setTemplates([]);
      setSelectedTemplateId(null);
      setTemplateError(null);
      return;
    }

    let cancelled = false;
    async function fetchTemplates() {
      setLoadingTemplates(true);
      setTemplateError(null);

      try {
        const params = new URLSearchParams({
          grade: selectedGrade,
          stream: batchDerivation.stream,
          testFormat,
        });

        const response = await fetch(`/api/quiz-sessions/templates?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Failed to fetch templates");
        }

        const data = await response.json();
        if (cancelled) return;
        setTemplates(data.templates || []);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setTemplates([]);
          setTemplateError("Failed to load papers for the selected batch and format.");
        }
      } finally {
        if (!cancelled) {
          setLoadingTemplates(false);
        }
      }
    }

    fetchTemplates();
    return () => {
      cancelled = true;
    };
  }, [
    batchDerivation.stream,
    selectedGrade,
    testFormat,
  ]);

  useEffect(() => {
    if (selectedTemplateId && !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(null);
    }
  }, [selectedTemplateId, templates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );

  // CMS cascade: fetch in-syllabus chapters once exam-track + grade + subject are chosen.
  // Only chapter tests drill by chapter; major tests skip this step entirely.
  useEffect(() => {
    if (
      testSource !== "cms" ||
      cmsTestType !== "chapter_test" ||
      !cmsExamTrack ||
      !cmsGrade ||
      !cmsSubject
    ) {
      setCmsChapters([]);
      setCmsChapterId(null);
      return;
    }
    let cancelled = false;
    async function run() {
      setLoadingCmsChapters(true);
      setCmsError(null);
      try {
        const params = new URLSearchParams({
          exam_track: cmsExamTrack,
          grade: cmsGrade,
          subject: cmsSubject,
        });
        const res = await fetch(`/api/cms/chapters?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch chapters");
        const data = await res.json();
        if (!cancelled) setCmsChapters(data.chapters ?? []);
      } catch (err) {
        if (!cancelled) {
          setCmsError((err as Error).message);
          setCmsChapters([]);
        }
      } finally {
        if (!cancelled) setLoadingCmsChapters(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [testSource, cmsTestType, cmsExamTrack, cmsGrade, cmsSubject]);

  useEffect(() => {
    if (cmsChapterId && !cmsChapters.some((chapter) => chapter.id === cmsChapterId)) {
      setCmsChapterId(null);
    }
  }, [cmsChapterId, cmsChapters]);

  // CMS cascade: fetch tests once the type's inputs are complete — chapter tests need a
  // chapter selected; major tests list straight off exam track + grade.
  const cmsTestsReady =
    testSource === "cms" &&
    !!cmsExamTrack &&
    !!cmsGrade &&
    (cmsTestType === "major_test" || cmsChapterId !== null);
  useEffect(() => {
    if (!cmsTestsReady) {
      setCmsTests([]);
      setSelectedCmsTestId(null);
      return;
    }
    let cancelled = false;
    async function run() {
      setLoadingCmsTests(true);
      setCmsError(null);
      try {
        const params = new URLSearchParams({
          exam_track: cmsExamTrack,
          grade: cmsGrade,
          test_type: cmsTestType,
        });
        if (cmsTestType === "chapter_test" && cmsChapterId !== null) {
          params.set("chapter_id", String(cmsChapterId));
        }
        const res = await fetch(`/api/cms/tests?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch tests");
        const data = await res.json();
        if (!cancelled) {
          const tests: CmsTestOption[] = data.tests ?? [];
          setCmsTests(tests);
          // The list may have been refetched under new filters (e.g. exam track changed
          // with major_test still ready) — drop any selection the new list doesn't contain.
          setSelectedCmsTestId((previous) =>
            previous !== null && tests.some((test) => test.id === previous)
              ? previous
              : null
          );
        }
      } catch (err) {
        if (!cancelled) {
          setCmsError((err as Error).message);
          setCmsTests([]);
        }
      } finally {
        if (!cancelled) setLoadingCmsTests(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [cmsTestsReady, testSource, cmsTestType, cmsExamTrack, cmsGrade, cmsChapterId]);

  useEffect(() => {
    if (!selectedTemplate) {
      if (!nameEdited) {
        setName("");
      }
      return;
    }
    if (!nameEdited || !name.trim()) {
      setName(getDefaultSessionName(selectedTemplate.name));
    }
  }, [name, nameEdited, selectedTemplate]);

  const toggleBatch = (batchId: string) => {
    setClassBatchIds((previous) =>
      previous.includes(batchId)
        ? previous.filter((value) => value !== batchId)
        : [...previous, batchId]
    );
  };

  const toggleTemplate = (templateId: number) => {
    setSelectedTemplateId((previous) =>
      previous === templateId ? null : templateId
    );
  };

  const validate = () => {
    if (classBatchIds.length === 0) return "At least one class batch is required.";
    if (batchDerivation.error) return batchDerivation.error;
    if (!batchDerivation.parentBatchId) return "Parent batch could not be derived.";
    if (!batchDerivation.stream) {
      return "Batch details could not be derived.";
    }

    if (testSource === "cms") {
      if (!cmsExamTrack) return "Exam track is required.";
      if (!cmsGrade) return "Grade is required.";
      if (cmsTestType === "chapter_test" && cmsChapterId === null) {
        return "Chapter is required.";
      }
      if (selectedCmsTestId === null) return "Please select a CMS test.";
    } else {
      if (!selectedGrade) return "Grade is required.";
      if (!testFormat) return "Test format is required.";
      if (!selectedTemplate) return "Please select a paper.";
      if (selectedTemplate.grade === null) {
        return "Selected paper is missing grade metadata.";
      }
    }

    if (timingMode === "schedule") {
      const start = new Date(startTime);
      const end = new Date(endTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return "Start time and end time must be valid.";
      }
      if (end <= start) {
        return "End time must be after start time.";
      }
    }

    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const computedStart =
        timingMode === "start_now" ? new Date() : new Date(startTime);
      const computedEnd =
        timingMode === "start_now"
          ? addHours(computedStart, DEFAULT_DURATION_HOURS)
          : new Date(endTime);

      if (testSource === "cms") {
        // Synchronous CMS path: af_lms builds the quiz + materializes the session itself
        // (no SNS/Lambda), so the session is ready when this returns.
        const selectedCmsTest = cmsTests.find(
          (test) => test.id === selectedCmsTestId
        );
        if (!selectedCmsTest) {
          throw new Error("Selected test is no longer in the list — pick it again.");
        }
        const cmsPayload = {
          name: name.trim() || selectedCmsTest.name || "",
          cmsTestId: selectedCmsTest.id,
          testType: cmsTestType,
          examTrack: cmsExamTrack,
          grade: Number(cmsGrade),
          testName: selectedCmsTest.name,
          testCode: selectedCmsTest.code,
          parentBatchId: batchDerivation.parentBatchId,
          classBatchIds,
          stream: batchDerivation.stream,
          showAnswers,
          showScores,
          shuffle,
          gurukulFormatType: getGurukulFormatForShuffle(gurukulFormatType, shuffle),
          startTime: computedStart.toISOString(),
          endTime: computedEnd.toISOString(),
        };

        const response = await fetch("/api/quiz-sessions/from-cms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cmsPayload),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to create session");
        }

        // Surface non-fatal quiz-build warnings (e.g. question subtypes the mapper had to
        // approximate) — the quiz is live, but the creator should eyeball it.
        const warnings: string[] = data.warnings ?? [];
        onCreated(
          warnings.length
            ? `Session created with warnings: ${warnings.join("; ")}`
            : "Session created."
        );
        return;
      }

      if (!selectedTemplate || selectedTemplate.grade === null) return;

      const payload = {
        name: name.trim() || getDefaultSessionName(selectedTemplate.name),
        resourceId: selectedTemplate.id,
        grade: selectedTemplate.grade,
        parentBatchId: batchDerivation.parentBatchId,
        classBatchIds,
        stream: batchDerivation.stream,
        showAnswers,
        showScores,
        shuffle,
        gurukulFormatType: getGurukulFormatForShuffle(gurukulFormatType, shuffle),
        startTime: computedStart.toISOString(),
        endTime: computedEnd.toISOString(),
      };

      const response = await fetch("/api/quiz-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create session");
      }

      onCreated("Session created. Links will appear shortly.");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to create session.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/25" onClick={onClose} />
      <div
        className="relative flex min-h-screen items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-bg-card shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
                Create Quiz Session
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary"
              aria-label="Close create modal"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="space-y-5">
              <SectionCard title="1. Select Class Batches">
                <div className="space-y-4">
                  <div className="text-sm text-text-secondary">
                    Select one or more class batches from the same parent batch.
                  </div>

                  <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                    {availableClassBatches.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-text-secondary">
                        No class batches are available.
                      </div>
                    ) : (
                      availableClassBatches.map((batch) => {
                        const checked = classBatchIds.includes(batch.batch_id);
                        return (
                          <label
                            key={batch.id}
                            className={`flex cursor-pointer items-start gap-3 border-b border-border px-3 py-3 text-sm last:border-b-0 ${
                              checked ? "bg-success-bg" : "bg-bg-card"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleBatch(batch.batch_id)}
                              className="mt-0.5 h-4 w-4 accent-accent"
                            />
                            <span className="min-w-0">
                              <span className="block font-medium text-text-primary">
                                {batch.name}
                              </span>
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>

                  {batchDerivation.error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {batchDerivation.error}
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="2. Select Paper">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { value: "legacy", label: "Legacy paper" },
                        { value: "cms", label: "New CMS Test" },
                      ] as { value: TestSource; label: string }[]
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setTestSource(option.value)}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                          testSource === option.value
                            ? "border-accent bg-accent text-text-on-accent"
                            : "border-border bg-bg-card text-text-primary hover:bg-hover-bg"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {testSource === "legacy" && (
                  <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor="quiz-session-grade"
                        className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted"
                      >
                        Grade
                      </label>
                      <select
                        id="quiz-session-grade"
                        value={selectedGrade}
                        onChange={(event) => {
                          setSelectedGrade(event.target.value);
                          setSelectedTemplateId(null);
                        }}
                        className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        <option value="">Select grade</option>
                        {GradeOptions.map((grade) => (
                          <option key={grade} value={grade}>
                            {grade}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="quiz-session-test-format"
                        className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted"
                      >
                        Test Format
                      </label>
                      <select
                        id="quiz-session-test-format"
                        value={testFormat}
                        onChange={(event) => {
                          setTestFormat(event.target.value);
                          setSelectedTemplateId(null);
                        }}
                        className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        <option value="">Select test format</option>
                        {TestFormatOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {!classBatchIds.length ||
                  !batchDerivation.stream ||
                  batchDerivation.error ||
                  !selectedGrade ||
                  !testFormat ? (
                    <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                      Choose class batches, grade, and test format first.
                    </div>
                  ) : loadingTemplates ? (
                    <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                      Loading papers...
                    </div>
                  ) : templateError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                      {templateError}
                    </div>
                  ) : templates.length === 0 ? (
                    <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                      No papers are available for this batch and format.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                      {templates.map((template) => {
                        const isSelected = template.id === selectedTemplateId;
                        return (
                          <div
                            key={template.id}
                            role="button"
                            aria-pressed={isSelected}
                            tabIndex={0}
                            onClick={() => toggleTemplate(template.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleTemplate(template.id);
                              }
                            }}
                            className={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left last:border-b-0 ${
                              isSelected
                                ? "bg-success-bg"
                                : "bg-bg-card hover:bg-hover-bg"
                            }`}
                          >
                            <span
                              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center border text-[11px] leading-none ${
                                isSelected
                                  ? "border-accent bg-accent text-text-on-accent"
                                  : "border-border bg-bg-card text-transparent"
                              }`}
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-text-primary">
                                {template.name}
                              </div>
                              <div className="mt-1 font-mono text-xs text-accent">
                                {template.code || "-"}
                              </div>
                              <div className="mt-1 text-xs text-text-secondary">
                                Ranking cutoff: {formatDate(template.rankingCutoffDate)}
                              </div>
                              <div className="mt-2">
                                <PaperResourceLinks
                                  questionHref={template.questionPdf}
                                  solutionHref={template.solutionPdf}
                                  inline
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  </div>
                  )}

                  {testSource === "cms" && (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                            Test type
                          </label>
                          <select
                            value={cmsTestType}
                            onChange={(event) => {
                              setCmsTestType(event.target.value as CmsTestType);
                              // Chapter/subject are only meaningful for chapter tests; clear
                              // them (and any selection) when the type changes.
                              setCmsSubject("");
                              setCmsChapterId(null);
                              setSelectedCmsTestId(null);
                            }}
                            className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                          >
                            {CMS_TEST_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                            Exam Track
                          </label>
                          <select
                            value={cmsExamTrack}
                            onChange={(event) => {
                              setCmsExamTrack(event.target.value as ExamTrack | "");
                              setCmsChapterId(null);
                            }}
                            className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                          >
                            <option value="">Select exam track</option>
                            {EXAM_TRACK_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                            Grade
                          </label>
                          <select
                            value={cmsGrade}
                            onChange={(event) => {
                              setCmsGrade(event.target.value);
                              setCmsChapterId(null);
                            }}
                            className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                          >
                            <option value="">Select grade</option>
                            {GradeOptions.map((grade) => (
                              <option key={grade} value={grade}>
                                {grade}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {cmsTestType === "chapter_test" && (
                        <div className="grid gap-4 md:grid-cols-3">
                          <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                              Subject
                            </label>
                            <select
                              value={cmsSubject}
                              onChange={(event) => {
                                setCmsSubject(event.target.value);
                                setCmsChapterId(null);
                              }}
                              className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                            >
                              <option value="">Select subject</option>
                              {CMS_SUBJECT_OPTIONS.map((subject) => (
                                <option key={subject} value={subject}>
                                  {subject}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-2">
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                              Chapter
                            </label>
                            <select
                              value={cmsChapterId ?? ""}
                              onChange={(event) =>
                                setCmsChapterId(
                                  event.target.value ? Number(event.target.value) : null
                                )
                              }
                              disabled={
                                !cmsExamTrack || !cmsGrade || !cmsSubject || loadingCmsChapters
                              }
                              className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
                            >
                              <option value="">
                                {loadingCmsChapters ? "Loading chapters..." : "Select chapter"}
                              </option>
                              {cmsChapters.map((chapter) => (
                                <option key={chapter.id} value={chapter.id}>
                                  {chapter.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}

                      {cmsError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          {cmsError}
                        </div>
                      )}

                      {!cmsTestsReady ? (
                        <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                          {cmsTestType === "chapter_test"
                            ? "Choose exam track, grade, subject, and chapter to see its tests."
                            : "Choose exam track and grade to see the major tests."}
                        </div>
                      ) : loadingCmsTests ? (
                        <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                          Loading tests...
                        </div>
                      ) : cmsTests.length === 0 ? (
                        <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                          {cmsTestType === "chapter_test"
                            ? "No chapter tests found for this chapter."
                            : "No major tests found for this exam track and grade."}
                        </div>
                      ) : (
                        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                          {cmsTests.map((test) => {
                            const isSelected = test.id === selectedCmsTestId;
                            return (
                              <div
                                key={test.id}
                                role="button"
                                aria-pressed={isSelected}
                                tabIndex={0}
                                onClick={() =>
                                  setSelectedCmsTestId((previous) =>
                                    previous === test.id ? null : test.id
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setSelectedCmsTestId((previous) =>
                                      previous === test.id ? null : test.id
                                    );
                                  }
                                }}
                                className={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left last:border-b-0 ${
                                  isSelected
                                    ? "bg-success-bg"
                                    : "bg-bg-card hover:bg-hover-bg"
                                }`}
                              >
                                <span
                                  className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center border text-[11px] leading-none ${
                                    isSelected
                                      ? "border-accent bg-accent text-text-on-accent"
                                      : "border-border bg-bg-card text-transparent"
                                  }`}
                                  aria-hidden="true"
                                >
                                  ✓
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-text-primary">
                                    {test.name}
                                  </div>
                                  <div className="mt-1 font-mono text-xs text-accent">
                                    {test.code || "-"}
                                  </div>
                                  <div className="mt-1 text-xs text-text-secondary">
                                    {test.marks !== null ? `${test.marks} marks` : ""}
                                    {test.duration ? ` · ${test.duration} min` : ""}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-2 text-xs text-text-secondary">
                        The quiz is built and the session is created in one step when you
                        click Create Session — this may take a few seconds.
                      </div>
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="3. When And How">
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setTimingMode("start_now")}
                      className={`rounded-lg border px-4 py-4 text-left shadow-sm transition-colors ${
                        timingMode === "start_now"
                          ? "border-border-accent bg-success-bg"
                          : "border-border bg-bg-card hover:bg-hover-bg"
                      }`}
                    >
                      <div className="text-sm font-semibold text-text-primary">Start now</div>
                      <div className="mt-1 text-sm text-text-secondary">
                        Starts when you create the session and ends {DEFAULT_DURATION_HOURS} hours later.
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTimingMode("schedule")}
                      className={`rounded-lg border px-4 py-4 text-left shadow-sm transition-colors ${
                        timingMode === "schedule"
                          ? "border-border-accent bg-success-bg"
                          : "border-border bg-bg-card hover:bg-hover-bg"
                      }`}
                    >
                      <div className="text-sm font-semibold text-text-primary">Schedule</div>
                      <div className="mt-1 text-sm text-text-secondary">
                        Pick the exact start and end time.
                      </div>
                    </button>
                  </div>

                  {timingMode === "schedule" ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                          Start Time
                        </label>
                        <input
                          type="datetime-local"
                          value={startTime}
                          onChange={(event) => setStartTime(event.target.value)}
                          className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                          End Time
                        </label>
                        <input
                          type="datetime-local"
                          value={endTime}
                          onChange={(event) => {
                            setEndTime(event.target.value);
                            setEndTimeEdited(true);
                          }}
                          className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                        <p className="mt-1 text-xs text-text-secondary">
                          Default window is {DEFAULT_DURATION_HOURS} hours.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div className="overflow-hidden rounded-lg border border-border bg-bg-card-alt">
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((value) => !value)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <span className="text-sm font-semibold text-text-primary">
                        Advanced Settings
                      </span>
                      <ChevronDownIcon
                        className={`h-5 w-5 text-text-secondary transition-transform ${
                          advancedOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {advancedOpen ? (
                      <div className="space-y-4 border-t border-border px-4 py-4">
                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                            Session Name
                          </label>
                          <input
                            value={name}
                            onChange={(event) => {
                              setName(event.target.value);
                              setNameEdited(true);
                            }}
                            placeholder="Session name"
                            className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                          />
                        </div>

                        <label className="flex items-center gap-2 text-sm text-text-primary">
                          <input
                            type="checkbox"
                            checked={showScores}
                            onChange={(event) => setShowScores(event.target.checked)}
                            className="h-4 w-4 accent-accent"
                          />
                          Show scores after submission
                        </label>
                        <label className="flex items-center gap-2 text-sm text-text-primary">
                          <input
                            type="checkbox"
                            checked={showAnswers}
                            onChange={(event) => setShowAnswers(event.target.checked)}
                            className="h-4 w-4 accent-accent"
                          />
                          Show answers after submission
                        </label>
                        <label className="flex items-center gap-2 text-sm text-text-primary">
                          <input
                            type="checkbox"
                            checked={shuffle}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setShuffle(checked);
                              if (checked) setGurukulFormatType(QA_GURUKUL_FORMAT);
                            }}
                            className="h-4 w-4 accent-accent"
                          />
                          Shuffle question order
                        </label>

                        <div className="space-y-2">
                          <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                            Gurukul Format
                          </div>
                          <div className="inline-flex w-full flex-wrap overflow-hidden rounded-lg border border-border sm:w-auto">
                            {GurukulFormatOptions.map((option) => {
                              const selected = gurukulFormatType === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => {
                                    if (shuffle && option.value !== QA_GURUKUL_FORMAT) return;
                                    setGurukulFormatType(option.value);
                                  }}
                                  disabled={shuffle && option.value !== QA_GURUKUL_FORMAT}
                                  className={`min-h-[44px] px-3 py-2 text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50 ${
                                    selected
                                      ? "bg-accent text-text-on-accent"
                                      : "bg-bg-card text-text-primary hover:bg-hover-bg"
                                  }`}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>

          <div className="border-t border-border px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-[20px] flex-1">
                {error ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    {error}
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] rounded-lg border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="min-h-[44px] rounded-lg bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Session"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizSessionEditModal({
  session,
  batchNameMap,
  onClose,
  onSaved,
}: {
  session: QuizSession;
  batchNameMap: Map<string, string>;
  onClose: () => void;
  onSaved: (message?: string) => void;
}) {
  const [name, setName] = useState(session.name);
  const [startTime, setStartTime] = useState(() => toDateTimeInputValue(session.start_time));
  const [endTime, setEndTime] = useState(() => toDateTimeInputValue(session.end_time));
  const [showAnswers, setShowAnswers] = useState(
    getMetaBoolean(session.meta_data, "show_answers") ?? false
  );
  const [showScores, setShowScores] = useState(
    getMetaBoolean(session.meta_data, "show_scores") ?? true
  );
  const initialShuffle = getMetaBoolean(session.meta_data, "shuffle") ?? false;
  const [shuffle, setShuffle] = useState(initialShuffle);
  const [gurukulFormatType, setGurukulFormatType] = useState(
    getGurukulFormatForShuffle(
      getMetaString(session.meta_data, "gurukul_format_type") || "both",
      initialShuffle
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const classBatchIds = getMetaString(session.meta_data, "batch_id")
    ?.split(",")
    .filter(Boolean);
  const classBatchNames = classBatchIds?.map(
    (batchId) => batchNameMap.get(batchId) || batchId
  );

  const validate = () => {
    if (!name.trim()) return "Session name is required.";

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return "Start time and end time must be valid.";
    }
    if (end <= start) {
      return "End time must be after start time.";
    }

    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    const payload: EditQuizSessionValues = {
      name: name.trim(),
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      showAnswers,
      showScores,
      shuffle,
      gurukulFormatType: getGurukulFormatForShuffle(gurukulFormatType, shuffle),
    };

    try {
      const response = await fetch(`/api/quiz-sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to update session");
      }

      onSaved("Session updated. Changes will reflect shortly.");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to update session.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/25" onClick={onClose} />
      <div
        className="relative flex min-h-screen items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="relative flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-bg-card shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
            <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
              Edit Quiz Session
            </h2>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary"
              aria-label="Close edit modal"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="space-y-5">
              <SectionCard title="Selected Batch And Paper">
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoRow
                    label="Paper"
                    value={getMetaString(session.meta_data, "resource_name") || session.name}
                  />
                  <InfoRow
                    label="Test Code"
                    value={getMetaString(session.meta_data, "test_code") || "-"}
                    mono
                  />
                  <InfoRow
                    label="Class Batches"
                    value={classBatchNames?.length ? classBatchNames.join(", ") : "-"}
                  />
                  <InfoRow
                    label="Session ID"
                    value={String(session.id)}
                    mono
                  />
                </div>
              </SectionCard>

              <SectionCard title="When And How">
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                      Session Name
                    </label>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                        Start Time
                      </label>
                      <input
                        type="datetime-local"
                        value={startTime}
                        onChange={(event) => setStartTime(event.target.value)}
                        className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                        End Time
                      </label>
                      <input
                        type="datetime-local"
                        value={endTime}
                        onChange={(event) => setEndTime(event.target.value)}
                        className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      />
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Advanced Settings">
                <div className="space-y-4">
                  <div className="space-y-3 rounded-lg border border-border bg-bg-card-alt p-4">
                    <label className="flex items-center gap-2 text-sm text-text-primary">
                      <input
                        type="checkbox"
                        checked={showScores}
                        onChange={(event) => setShowScores(event.target.checked)}
                        className="h-4 w-4 accent-accent"
                      />
                      Show scores after submission
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text-primary">
                      <input
                        type="checkbox"
                        checked={showAnswers}
                        onChange={(event) => setShowAnswers(event.target.checked)}
                        className="h-4 w-4 accent-accent"
                      />
                      Show answers after submission
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text-primary">
                      <input
                        type="checkbox"
                        checked={shuffle}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setShuffle(checked);
                          if (checked) setGurukulFormatType(QA_GURUKUL_FORMAT);
                        }}
                        className="h-4 w-4 accent-accent"
                      />
                      Shuffle question order
                    </label>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                        Gurukul Format
                      </div>
                      <div className="inline-flex w-full flex-wrap overflow-hidden rounded-lg border border-border sm:w-auto">
                        {GurukulFormatOptions.map((option) => {
                          const selected = gurukulFormatType === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                if (shuffle && option.value !== QA_GURUKUL_FORMAT) return;
                                setGurukulFormatType(option.value);
                              }}
                              disabled={shuffle && option.value !== QA_GURUKUL_FORMAT}
                              className={`min-h-[44px] px-3 py-2 text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50 ${
                                selected
                                  ? "bg-accent text-text-on-accent"
                                  : "bg-bg-card text-text-primary hover:bg-hover-bg"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>

          <div className="border-t border-border px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-[20px] flex-1">
                {error ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    {error}
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] rounded-lg border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="min-h-[44px] rounded-lg bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizSessionDetailsModal({
  session,
  batchNameMap,
  canEdit,
  onEdit,
  onClose,
}: {
  session: QuizSession;
  batchNameMap: Map<string, string>;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const classBatchIds = getMetaString(session.meta_data, "batch_id")
    ?.split(",")
    .filter(Boolean);
  const classBatchNames = classBatchIds?.map(
    (batchId) => batchNameMap.get(batchId) || batchId
  );
  // Edit is hidden for new-CMS sessions until the CMS session-patch fix ships (the legacy
  // edit path KeyErrors on the absent meta_data.course). Legacy sessions edit normally.
  const isCmsSession = getMetaString(session.meta_data, "cms_source") === CMS_SOURCE;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/25" onClick={onClose} />
      <div
        className="relative flex min-h-screen items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-3xl rounded-xl border border-border bg-bg-card shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
                Session Details
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {canEdit && !isCmsSession ? (
                <button
                  type="button"
                  onClick={onEdit}
                  disabled={isSessionProcessing(session)}
                  className="min-h-[36px] rounded-lg border-2 border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted"
                >
                  Edit
                </button>
              ) : null}
              <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
                ✕
              </button>
            </div>
          </div>

          <div className="space-y-5 p-5 text-sm text-text-secondary">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoRow label="Session ID" value={String(session.id)} mono />
              <InfoRow label="Session Name" value={session.name} />
              <InfoRow
                label="Data Sync"
                value={getSyncLabel(session.meta_data)}
              />
              <InfoRow
                label="Class Batches"
                value={classBatchNames?.length ? classBatchNames.join(", ") : "-"}
              />
              <InfoRow
                label="Availability"
                value={session.is_active === false ? "Disabled" : "Enabled"}
              />
              <InfoRow
                label="Start Time"
                value={formatDateTime(session.start_time)}
                mono
              />
              <InfoRow label="End Time" value={formatDateTime(session.end_time)} mono />
            </div>

            <SectionCard title="Paper">
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoRow
                  label="Test Name"
                  value={getMetaString(session.meta_data, "resource_name") || session.name}
                />
                <InfoRow
                  label="Test Code"
                  value={getMetaString(session.meta_data, "test_code") || "-"}
                  mono
                />
                <InfoRow
                  label="Ranking Cutoff"
                  value={formatDate(getMetaString(session.meta_data, "ranking_cutoff_date"))}
                />
                <CmsAwarePaperLinks meta={session.meta_data} />
              </div>
            </SectionCard>

            <SectionCard title="Additional Settings">
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoRow
                  label="Show Scores"
                  value={toYesNo(getMetaBoolean(session.meta_data, "show_scores"))}
                />
                <InfoRow
                  label="Show Answers"
                  value={toYesNo(getMetaBoolean(session.meta_data, "show_answers"))}
                />
                <InfoRow
                  label="Shuffle Questions"
                  value={toYesNo(getMetaBoolean(session.meta_data, "shuffle"))}
                />
                <InfoRow
                  label="Gurukul Format"
                  value={getMetaString(session.meta_data, "gurukul_format_type") || "-"}
                />
              </div>
            </SectionCard>

            <SectionCard title="Access Links">
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionLinkRow
                  label="Q&A Link"
                  href={getMetaString(session.meta_data, "shortened_link") || session.portal_link || ""}
                />
                <ActionLinkRow
                  label="OMR Link"
                  href={getMetaString(session.meta_data, "shortened_omr_link")}
                />
                <ActionLinkRow
                  label="Q&A Admin Link"
                  href={getMetaString(session.meta_data, "admin_testing_link")}
                />
                <ActionLinkRow
                  label="OMR Admin Link"
                  href={getOmrAdminLink(session.meta_data)}
                />
                <ActionLinkRow
                  label="Report Link"
                  href={getMetaString(session.meta_data, "report_link")}
                />
              </div>
            </SectionCard>
          </div>

          <div className="flex justify-end border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionWindowSummary({
  session,
  lifecycle,
}: {
  session: QuizSession;
  lifecycle: SessionLifecycleState;
}) {
  const showLifecycleBadge = lifecycle === "live" || lifecycle === "ended";

  return (
    <div className="space-y-2">
      {showLifecycleBadge ? (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex min-h-6 items-center justify-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${getLifecycleClasses(
              lifecycle
            )}`}
          >
            {getLifecycleLabel(lifecycle)}
          </span>
        </div>
      ) : null}
      <div className="space-y-1 font-mono text-text-secondary">
        <div>Start {formatDateTime(session.start_time)}</div>
        <div>End {formatDateTime(session.end_time)}</div>
      </div>
    </div>
  );
}

function SyncSummary({ session }: { session: QuizSession }) {
  const syncLabel = getSyncLabel(session.meta_data);
  const lastSyncedAt = getLastSyncedAt(session.meta_data);
  const showMissingSyncTime = syncLabel === "Synced" && !lastSyncedAt;
  const syncIcon =
    syncLabel === "Synced"
      ? "✓"
      : syncLabel === "Sync Failed"
        ? "!"
        : syncLabel === "Queued"
          ? "…"
          : "•";

  return (
    <div className="space-y-2">
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${getSyncToneClasses(
          session.meta_data
        )}`}
      >
        <span aria-hidden="true" className="mr-1 text-[11px] leading-none">
          {syncIcon}
        </span>
        {syncLabel}
      </span>
      {lastSyncedAt ? (
        <div className="text-xs leading-5 text-text-secondary">
          Last synced: {formatDateTime(lastSyncedAt)}
        </div>
      ) : showMissingSyncTime ? (
        <div className="text-xs leading-5 text-text-secondary">
          Sync time not recorded
        </div>
      ) : null}
    </div>
  );
}

function StatusSummary({
  session,
  sessionProcessing,
  regenerateBusy,
}: {
  session: QuizSession;
  sessionProcessing: boolean;
  regenerateBusy: boolean;
}) {
  let label = "Enabled";
  let classes = "border border-border-accent bg-success-bg text-accent";

  if (regenerateBusy) {
    label = "Regenerating";
    classes = "border border-amber-200 bg-amber-50 text-amber-700";
  } else if (sessionProcessing) {
    label = "Processing";
    classes = "border border-amber-200 bg-amber-50 text-amber-700";
  } else if (session.is_active === false) {
    label = "Disabled";
    classes = "border border-border bg-bg-card-alt text-text-secondary";
  }

  return (
    <span
      className={`inline-flex min-h-6 min-w-[96px] items-center justify-center rounded-full px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-wide ${classes}`}
    >
      {label}
    </span>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-card shadow-sm">
      <div className="border-b-2 border-border-accent px-4 py-3">
        <div className="text-sm font-bold uppercase tracking-wide text-text-primary">
          {title}
        </div>
        {subtitle ? <div className="mt-1 text-xs text-text-secondary">{subtitle}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-1 text-sm text-text-primary ${mono ? "font-mono" : ""}`}>
        {value || "-"}
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path d="M6 3h7v7" />
      <path d="M13 3 3 13" />
      <path d="M10 13H3V6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <path d="M8 2v8" />
      <path d="m4.5 7 3.5 3.5L11.5 7" />
      <path d="M3 13h10" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <path d="m3.5 6 4.5 4 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 10V3.5A1.5 1.5 0 0 1 4.5 2H11" />
    </svg>
  );
}

function LinkIconButton({
  href,
  title,
}: {
  href?: string;
  title: string;
}) {
  const value = href?.trim();
  if (!value) return null;

  return (
    <div className="flex items-center gap-2">
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        title={title}
        aria-label={title}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-card text-accent hover:border-accent hover:text-accent-hover"
      >
        <ExternalLinkIcon />
      </a>
      <button
        type="button"
        onClick={() => copyToClipboard(value)}
        title={`Copy ${title}`}
        aria-label={`Copy ${title}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-card text-text-primary hover:border-accent hover:text-accent"
      >
        <CopyIcon />
      </button>
    </div>
  );
}

function PaperLinkChip({
  href,
  label,
}: {
  href?: string;
  label: string;
}) {
  const value = href?.trim();
  if (!value) return null;

  return (
    <a
      href={value}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card px-2.5 py-1 text-xs font-medium text-text-primary hover:border-accent hover:text-accent"
    >
      <span>{label}</span>
      <ExternalLinkIcon />
    </a>
  );
}

// Icon-only companion to PaperLinkChip: saves the file instead of opening it. Only
// rendered when a same-origin download href exists (the CMS proxy with download=1).
function PaperDownloadChip({
  href,
  label,
}: {
  href?: string;
  label: string;
}) {
  const value = href?.trim();
  if (!value) return null;

  return (
    <a
      href={value}
      download
      title={label}
      aria-label={label}
      className="inline-flex items-center rounded-full border border-border bg-bg-card px-2 py-1 text-xs font-medium text-text-primary hover:border-accent hover:text-accent"
    >
      <DownloadIcon />
    </a>
  );
}

// Chooses PDF links for the session-details Paper card: for new-CMS sessions the PDFs are
// generated on demand (proxy route), rebuilt from the CMS ids stored at create time; for
// legacy sessions they're the stored question_pdf/solution_pdf URLs.
function CmsAwarePaperLinks({
  meta,
}: {
  meta: Record<string, unknown> | null | undefined;
}) {
  const cmsSource = getMetaString(meta, "cms_source");
  // Ids may be stored as numbers (older sessions) or strings — accept both.
  const cmsTestId = getMetaScalar(meta, "cms_test_id");
  const curriculumId = getMetaScalar(meta, "cms_curriculum_id");
  const gradeId = getMetaScalar(meta, "cms_grade_id");

  if (cmsSource && cmsTestId && curriculumId && gradeId) {
    const base =
      `/api/cms/test-pdf?testId=${encodeURIComponent(cmsTestId)}` +
      `&curriculumId=${encodeURIComponent(curriculumId)}` +
      `&gradeId=${encodeURIComponent(gradeId)}`;
    return (
      <PaperResourceLinks
        questionHref={`${base}&type=questions`}
        solutionHref={`${base}&type=answers`}
        questionDownloadHref={`${base}&type=questions&download=1`}
        solutionDownloadHref={`${base}&type=answers&download=1`}
      />
    );
  }

  return (
    <PaperResourceLinks
      questionHref={getMetaString(meta, "question_pdf")}
      solutionHref={getMetaString(meta, "solution_pdf")}
    />
  );
}

function PaperResourceLinks({
  questionHref,
  solutionHref,
  questionDownloadHref,
  solutionDownloadHref,
  inline = false,
}: {
  questionHref?: string;
  solutionHref?: string;
  questionDownloadHref?: string;
  solutionDownloadHref?: string;
  inline?: boolean;
}) {
  if (!questionHref?.trim() && !solutionHref?.trim()) {
    return inline ? <span className="text-xs text-text-secondary">No test paper files</span> : (
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
          Paper Files
        </div>
        <div className="mt-1 text-sm text-text-secondary">-</div>
      </div>
    );
  }

  const content = (
    <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <PaperLinkChip href={questionHref} label="Question PDF" />
      <PaperDownloadChip href={questionDownloadHref} label="Download Question PDF" />
      <PaperLinkChip href={solutionHref} label="Answer PDF" />
      <PaperDownloadChip href={solutionDownloadHref} label="Download Answer PDF" />
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Test Paper Files</div>
      <div className="mt-2">{content}</div>
    </div>
  );
}

function ActionLinkRow({ label, href }: { label: string; href?: string }) {
  const value = href?.trim();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-card-alt px-3 py-3">
      <div className="min-w-0 text-xs font-bold uppercase tracking-wide text-text-muted">
        {label}
      </div>
      {value ? (
        <div className="flex shrink-0 items-center gap-2">
          <LinkIconButton href={value} title={label} />
        </div>
      ) : (
        <div className="shrink-0 text-sm text-text-secondary">N/A</div>
      )}
    </div>
  );
}
