"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Toast from "@/components/Toast";
import {
  GurukulFormatOptions,
  TestFormatOptions,
} from "@/lib/quiz-session-options";
import { addHours, toDateTimeLocalValue } from "@/lib/quiz-session-time";

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
type RowActionKind = "sync" | "regenerate" | "toggle" | "end_now";

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
  grade: number | null;
  stream: string;
  parentBatchId: string;
  parentBatchName: string;
}

const PER_PAGE = 50;
const DEFAULT_DURATION_HOURS = 4;
const LMS_SESSION_PREFIX = "[LMS] ";

function getDefaultSessionName(baseName: string): string {
  return baseName.startsWith(LMS_SESSION_PREFIX)
    ? baseName
    : `${LMS_SESSION_PREFIX}${baseName}`;
}

function getCompactBatchLabel(values: string[] | undefined): string {
  if (!values?.length) return "-";
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

function parseBatchGrade(batchId: string): number | null {
  const parts = batchId.split("_");
  if (parts.length < 2) return null;
  const value = Number(parts[1]);
  return Number.isNaN(value) ? null : value;
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

function getMetaString(
  meta: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" ? value : undefined;
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

function isSyncPending(session: QuizSession | null | undefined): boolean {
  if (!session) return false;
  return getStatusLabel(getMetaString(session.meta_data, "etl_sync_status")) === "pending";
}

function canEndNow(session: QuizSession | null | undefined, nowMs = Date.now()): boolean {
  if (!session || isSessionProcessing(session)) return false;
  if (session.is_active === false) return false;
  return getSessionLifecycleState(session, nowMs) === "live";
}

function areSessionsEqual(previous: QuizSession[], next: QuizSession[]): boolean {
  return JSON.stringify(previous) === JSON.stringify(next);
}

export default function QuizSessionsTab({ schoolId }: { schoolId: string }) {
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
      setBatches(data.batches || []);
    } catch (err) {
      console.error(err);
      setLoadError("Failed to fetch class batches.");
    } finally {
      setLoadingBatches(false);
    }
  }, [schoolId]);

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

  const handleSync = async (sessionId: number) => {
    try {
      setSavingAction({ id: sessionId, kind: "sync" });
      setFeedbackToast(null);
      const response = await fetch(`/api/quiz-sessions/${sessionId}/sync`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as
        | { message?: string; warning?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(data?.error || "Failed to request sync");
      }
      setFeedbackToast({
        variant: "info",
        message:
          data?.warning ||
          data?.message ||
          "Sync requested. Updated results should appear shortly.",
      });
      await fetchSessions(page, selectedClassBatch || undefined);
    } catch (err) {
      console.error(err);
      setFeedbackToast({
        variant: "error",
        message: "Could not request sync.",
      });
    } finally {
      setSavingAction(null);
    }
  };

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
        </div>
      </div>

      {loadError && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center">
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
                      <SyncSummary
                        session={session}
                        busy={savingAction?.id === session.id && savingAction.kind === "sync"}
                        onSync={() => handleSync(session.id)}
                      />
                    </td>
                    <td
                      className={`px-4 py-4 text-sm text-text-secondary ${
                        sessionProcessing ? "opacity-60" : ""
                      }`}
                    >
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

      {menuState && (
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

            return (
              <>
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
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!currentSession) return;
                    handleToggleEnabled(currentSession);
                    setMenuState(null);
                  }}
                  disabled={sessionProcessing || busy}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-text-primary hover:bg-hover-bg disabled:text-text-muted"
                >
                  <span>{enabled ? "Disable Session" : "Enable Session"}</span>
                  <span
                    className={`text-base leading-none ${
                      enabled ? "text-accent" : "text-red-700"
                    }`}
                    aria-hidden="true"
                  >
                    {enabled ? "✓" : "✕"}
                  </span>
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
        grade: null,
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
        grade: null,
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
        grade: null,
        stream: "",
        parentBatchId: "",
        parentBatchName: "",
      };
    }

    const gradeSet = new Set(
      selectedRows
        .map((row) => parseBatchGrade(row.batch_id))
        .filter((grade): grade is number => grade !== null)
    );
    if (gradeSet.size !== 1) {
      return {
        error: "Selected class batches must have the same grade.",
        grade: null,
        stream: "",
        parentBatchId: "",
        parentBatchName: "",
      };
    }

    const streamSet = new Set(
      selectedRows
        .map((row) => {
          if (row.batch_id.includes("_Engg_")) return "engineering";
          if (row.batch_id.includes("_Med_")) return "medical";
          return "";
        })
        .filter(Boolean)
    );
    if (streamSet.size !== 1) {
      return {
        error: "Unable to derive stream from the selected class batches.",
        grade: null,
        stream: "",
        parentBatchId: "",
        parentBatchName: "",
      };
    }

    return {
      error: null,
      grade: Array.from(gradeSet)[0],
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
    if (
      !batchDerivation.grade ||
      !batchDerivation.stream ||
      !testFormat
    ) {
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
          grade: String(batchDerivation.grade),
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
    batchDerivation.grade,
    batchDerivation.stream,
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

  const validate = () => {
    if (classBatchIds.length === 0) return "At least one class batch is required.";
    if (batchDerivation.error) return batchDerivation.error;
    if (!batchDerivation.parentBatchId) return "Parent batch could not be derived.";
    if (!batchDerivation.grade || !batchDerivation.stream) {
      return "Batch details could not be derived.";
    }
    if (!testFormat) return "Test format is required.";
    if (!selectedTemplate) return "Please select a paper.";

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

    if (!selectedTemplate || !batchDerivation.grade) return;

    setSaving(true);
    setError(null);

    try {
      const computedStart =
        timingMode === "start_now" ? new Date() : new Date(startTime);
      const computedEnd =
        timingMode === "start_now"
          ? addHours(computedStart, DEFAULT_DURATION_HOURS)
          : new Date(endTime);

      const payload = {
        name: name.trim() || getDefaultSessionName(selectedTemplate.name),
        resourceId: selectedTemplate.id,
        grade: batchDerivation.grade,
        parentBatchId: batchDerivation.parentBatchId,
        classBatchIds,
        stream: batchDerivation.stream,
        showAnswers,
        showScores,
        shuffle,
        gurukulFormatType,
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
            {error && (
              <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

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
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                      Test Format
                    </label>
                    <select
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

                  {!classBatchIds.length ||
                  !batchDerivation.grade ||
                  !batchDerivation.stream ||
                  batchDerivation.error ||
                  !testFormat ? (
                    <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                      Choose class batches and a test format first.
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
                            tabIndex={0}
                            onClick={() => setSelectedTemplateId(template.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedTemplateId(template.id);
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
                            onChange={(event) => setShuffle(event.target.checked)}
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
                                  onClick={() => setGurukulFormatType(option.value)}
                                  className={`min-h-[44px] px-3 py-2 text-xs font-bold uppercase tracking-wide ${
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

          <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
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
  const [shuffle, setShuffle] = useState(getMetaBoolean(session.meta_data, "shuffle") ?? false);
  const [gurukulFormatType, setGurukulFormatType] = useState(
    getMetaString(session.meta_data, "gurukul_format_type") || "both"
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
      gurukulFormatType,
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
            {error && (
              <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

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
                        onChange={(event) => setShuffle(event.target.checked)}
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
                              onClick={() => setGurukulFormatType(option.value)}
                              className={`min-h-[44px] px-3 py-2 text-xs font-bold uppercase tracking-wide ${
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

          <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
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
  );
}

function QuizSessionDetailsModal({
  session,
  batchNameMap,
  onEdit,
  onClose,
}: {
  session: QuizSession;
  batchNameMap: Map<string, string>;
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
              <button
                type="button"
                onClick={onEdit}
                disabled={isSessionProcessing(session)}
                className="min-h-[36px] rounded-lg border-2 border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted"
              >
                Edit
              </button>
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
                <PaperResourceLinks
                  questionHref={getMetaString(session.meta_data, "question_pdf")}
                  solutionHref={getMetaString(session.meta_data, "solution_pdf")}
                />
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

function SyncSummary({
  session,
  busy,
  onSync,
}: {
  session: QuizSession;
  busy: boolean;
  onSync: () => void;
}) {
  const syncLabel = getSyncLabel(session.meta_data);
  const pending = isSyncPending(session);
  const buttonLabel =
    syncLabel === "Synced"
      ? "Sync Again"
      : syncLabel === "Sync Failed"
        ? "Retry Sync"
        : "Sync Now";
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
      {!pending ? (
        <div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSync();
            }}
            disabled={busy}
            className="inline-flex min-h-[36px] items-center rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted"
          >
            {busy ? "Syncing..." : buttonLabel}
          </button>
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

function PaperResourceLinks({
  questionHref,
  solutionHref,
  inline = false,
}: {
  questionHref?: string;
  solutionHref?: string;
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
      <PaperLinkChip href={solutionHref} label="Answer PDF" />
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
