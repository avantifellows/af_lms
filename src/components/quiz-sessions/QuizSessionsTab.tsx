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

function getStatusClasses(status?: string) {
  const normalized = getStatusLabel(status);
  if (normalized === "success") {
    return "border border-border-accent bg-success-bg text-accent";
  }
  if (normalized === "failed") {
    return "border border-red-200 bg-red-50 text-red-700";
  }
  if (normalized === "pending") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
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

function isSessionPending(session: QuizSession | null | undefined): boolean {
  if (!session) return false;
  return getStatusLabel(getMetaString(session.meta_data, "status")) === "pending";
}

function canEndNow(session: QuizSession | null | undefined): boolean {
  if (!session || isSessionPending(session) || !session.end_time) return false;

  const now = Date.now();
  const endTime = new Date(session.end_time).getTime();
  if (Number.isNaN(endTime) || endTime <= now) return false;

  if (!session.start_time) return true;

  const startTime = new Date(session.start_time).getTime();
  if (Number.isNaN(startTime)) return true;

  return startTime <= now;
}

export default function QuizSessionsTab({ schoolId }: { schoolId: string }) {
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [selectedClassBatch, setSelectedClassBatch] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<FeedbackToast | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<QuizSession | null>(null);
  const [editingSession, setEditingSession] = useState<QuizSession | null>(null);
  const [savingActionId, setSavingActionId] = useState<number | null>(null);
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
    setError(null);
    try {
      const response = await fetch(`/api/quiz-sessions/batches?schoolId=${schoolId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch batches");
      }
      const data = await response.json();
      setBatches(data.batches || []);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch class batches.");
    } finally {
      setLoadingBatches(false);
    }
  }, [schoolId]);

  const fetchSessions = useCallback(
    async (pageIndex: number, classBatchId?: string) => {
      setLoadingSessions(true);
      setError(null);
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
        setSessions(data.sessions || []);
        setHasMore(Boolean(data.hasMore));
      } catch (err) {
        console.error(err);
        setError("Failed to fetch quiz sessions.");
      } finally {
        setLoadingSessions(false);
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
      fetchSessions(page, selectedClassBatch || undefined);
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [page, selectedClassBatch, fetchSessions]);

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
      setSavingActionId(sessionId);
      setFeedbackToast(null);
      const response = await fetch(`/api/quiz-sessions/${sessionId}/regenerate`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to regenerate");
      }
      setFeedbackToast({
        variant: "info",
        message: "Regeneration requested. Links will update shortly.",
      });
      await fetchSessions(page, selectedClassBatch || undefined);
    } catch (err) {
      console.error(err);
      setError("Failed to regenerate quiz.");
      setFeedbackToast({
        variant: "error",
        message: "Failed to regenerate quiz.",
      });
    } finally {
      setSavingActionId(null);
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
      setSavingActionId(session.id);
      setError(null);
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
        variant: "success",
        message:
          session.is_active === false ? "Session enabled." : "Session disabled.",
      });
      await fetchSessions(page, selectedClassBatch || undefined);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to update session.");
      setFeedbackToast({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to update session.",
      });
    } finally {
      setSavingActionId(null);
    }
  };

  const handleEndNow = async (session: QuizSession) => {
    try {
      setSavingActionId(session.id);
      setError(null);
      setFeedbackToast(null);

      const response = await fetch(`/api/quiz-sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endTime: new Date().toISOString(),
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
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to end session.");
      setFeedbackToast({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to end session.",
      });
    } finally {
      setSavingActionId(null);
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

      <div className="bg-bg-card border border-border shadow-sm">
        <div className="flex flex-col gap-4 border-b-4 border-border-accent px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
              Quiz Sessions
            </h2>
            <p className="text-sm text-text-secondary">
              Create and manage quiz sessions for this school.
            </p>
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center justify-center bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent hover:bg-accent-hover"
          >
            Create Quiz Session
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-bg-card border border-border shadow-sm">
        <div className="border-b-2 border-border-accent px-4 py-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-primary">
            Filter Sessions
          </h3>
        </div>
        <div className="p-4">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
            Class Batch
          </label>
          <select
            value={selectedClassBatch}
            onChange={(event) => {
              setSelectedClassBatch(event.target.value);
              setPage(0);
            }}
            disabled={loadingBatches}
            className="block w-full max-w-sm border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none disabled:bg-bg-card-alt"
          >
            <option value="">All class batches</option>
            {classBatches.map((batch) => (
              <option key={batch.id} value={batch.batch_id}>
                {batch.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto bg-bg-card border border-border shadow-sm">
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
                Start
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                End
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Enabled
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-bg-card">
            {loadingSessions ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-text-secondary">
                  Loading sessions...
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-text-secondary">
                  No quiz sessions found.
                </td>
              </tr>
            ) : (
              sessions.map((session) => {
                const status = getMetaString(session.meta_data, "status");
                const classBatchIds = getMetaString(session.meta_data, "batch_id")
                  ?.split(",")
                  .filter(Boolean);
                const classBatchNames = classBatchIds?.map(
                  (batchId) => batchNameMap.get(batchId) || batchId
                );

                return (
                  <tr
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    className="cursor-pointer hover:bg-hover-bg"
                  >
                    <td className="px-4 py-4 text-sm font-semibold text-text-primary">
                      {session.name}
                    </td>
                    <td className="px-4 py-4 text-sm text-text-secondary">
                      {classBatchNames?.length ? classBatchNames.join(", ") : "-"}
                    </td>
                    <td className="px-4 py-4 text-sm font-mono text-text-secondary">
                      {formatDateTime(session.start_time)}
                    </td>
                    <td className="px-4 py-4 text-sm font-mono text-text-secondary">
                      {formatDateTime(session.end_time)}
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <span
                        className={`inline-flex px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${getStatusClasses(status)}`}
                      >
                        {getStatusLabel(status)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                          session.is_active === false
                            ? "border border-red-200 bg-red-50 text-red-700"
                            : "border border-border-accent bg-success-bg text-accent"
                        }`}
                      >
                        <span aria-hidden="true">{session.is_active === false ? "✕" : "✓"}</span>
                        <span>{session.is_active === false ? "Disabled" : "Enabled"}</span>
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-text-secondary">
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
                          className="px-2 py-1 text-text-secondary hover:text-text-primary"
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

      <div className="flex items-center justify-between">
        <button
          onClick={() => setPage((previous) => Math.max(0, previous - 1))}
          disabled={page === 0}
          className="border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted"
        >
          Previous
        </button>
        <span className="text-sm font-mono text-text-secondary">Page {page + 1}</span>
        <button
          onClick={() => setPage((previous) => previous + 1)}
          disabled={!hasMore}
          className="border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted"
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
          className="fixed z-50 w-48 border border-border bg-bg-card shadow-md"
          style={{ left: menuState.left, top: menuState.top }}
        >
          {(() => {
            const currentSession = sessions.find((session) => session.id === menuState.id);
            const pending = isSessionPending(currentSession);
            const busy = savingActionId === menuState.id;
            const enabled = currentSession?.is_active !== false;
            const endNowAvailable = canEndNow(currentSession);

            return (
              <>
          <button
            onClick={(event) => {
              event.stopPropagation();
              if (!currentSession) return;
              setEditingSession(currentSession);
              setMenuState(null);
            }}
            disabled={pending || busy}
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
            disabled={pending || busy}
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
          <button
            onClick={(event) => {
              event.stopPropagation();
              if (!currentSession) return;
              handleEndNow(currentSession);
              setMenuState(null);
            }}
            disabled={!endNowAvailable || busy}
            className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-text-primary hover:bg-hover-bg disabled:text-text-muted"
          >
            <span>End Now</span>
            <span className="text-base leading-none text-amber-700" aria-hidden="true">
              ⏱
            </span>
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              handleRegenerate(menuState.id);
              setMenuState(null);
            }}
            disabled={pending || busy}
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
  const [batchSearch, setBatchSearch] = useState("");
  const [testFormat, setTestFormat] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templates, setTemplates] = useState<QuizTemplateOption[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
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

  const filteredClassBatches = useMemo(() => {
    const search = batchSearch.trim().toLowerCase();
    if (!search) return availableClassBatches;
    return availableClassBatches.filter((batch) =>
      `${batch.name} ${batch.batch_id}`.toLowerCase().includes(search)
    );
  }, [availableClassBatches, batchSearch]);

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
        setName(selectedTemplate.name);
      }
  }, [name, nameEdited, selectedTemplate]);

  const filteredTemplates = useMemo(() => {
    const search = templateSearch.trim().toLowerCase();
    if (!search) return templates;
    return templates.filter((template) =>
      `${template.name} ${template.code}`.toLowerCase().includes(search)
    );
  }, [templateSearch, templates]);

  const selectedBatchNames = useMemo(
    () =>
      classBatchIds
        .map((batchId) => batches.find((batch) => batch.batch_id === batchId)?.name || batchId),
    [batches, classBatchIds]
  );

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

    if (!selectedTemplate || !batchDerivation.grade) return;

    setSaving(true);
    setError(null);

    try {
      const payload = {
        name: name.trim() || selectedTemplate.name,
        resourceId: selectedTemplate.id,
        grade: batchDerivation.grade,
        parentBatchId: batchDerivation.parentBatchId,
        classBatchIds,
        stream: batchDerivation.stream,
        showAnswers,
        showScores,
        shuffle,
        gurukulFormatType,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
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
          className="relative flex max-h-[92vh] w-full max-w-5xl flex-col border border-border bg-bg-card shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
                Create Quiz Session
              </h2>
              <p className="text-sm text-text-secondary">
                Pick the class batch, choose the paper, then set the test window.
              </p>
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
              <SectionCard
                title="Who Is Taking The Test"
                subtitle="Choose one or more class batches from the same parent batch."
              >
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                      Search Class Batches
                    </label>
                    <input
                      value={batchSearch}
                      onChange={(event) => setBatchSearch(event.target.value)}
                      placeholder="Search by batch name"
                      className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div className="max-h-64 overflow-y-auto border border-border">
                    {filteredClassBatches.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-text-secondary">
                        No class batches match your search.
                      </div>
                    ) : (
                      filteredClassBatches.map((batch) => {
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
                              <span className="block font-mono text-xs text-text-secondary">
                                {batch.batch_id}
                              </span>
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>

                  {selectedBatchNames.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedBatchNames.map((batchName) => (
                        <span
                          key={batchName}
                          className="inline-flex border border-border-accent bg-success-bg px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent"
                        >
                          {batchName}
                        </span>
                      ))}
                    </div>
                  )}

                  {batchDerivation.error && (
                    <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {batchDerivation.error}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <ReadOnlyField label="Parent Batch" value={batchDerivation.parentBatchName} />
                    <ReadOnlyField
                      label="Grade"
                      value={batchDerivation.grade ? String(batchDerivation.grade) : ""}
                    />
                    <ReadOnlyField label="Stream" value={batchDerivation.stream} />
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Which Paper"
                subtitle="Pick the format first. Then choose from the papers available for that batch."
              >
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
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
                        className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                      >
                        <option value="">Select test format</option>
                        {TestFormatOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                        Search Paper
                      </label>
                      <input
                        value={templateSearch}
                        onChange={(event) => setTemplateSearch(event.target.value)}
                        placeholder="Search by paper name"
                        disabled={!testFormat}
                        className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none disabled:bg-bg-card-alt"
                      />
                    </div>
                  </div>

                  {!classBatchIds.length ||
                  !batchDerivation.grade ||
                  !batchDerivation.stream ||
                  batchDerivation.error ||
                  !testFormat ? (
                    <div className="border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                      Choose the class batch and test format to load papers.
                    </div>
                  ) : loadingTemplates ? (
                    <div className="border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                      Loading papers...
                    </div>
                  ) : templateError ? (
                    <div className="border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                      {templateError}
                    </div>
                  ) : filteredTemplates.length === 0 ? (
                    <div className="border border-border bg-bg-card-alt px-3 py-3 text-sm text-text-secondary">
                      No papers are available for this batch and format.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto border border-border">
                      {filteredTemplates.map((template) => {
                        const isSelected = template.id === selectedTemplateId;
                        return (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => setSelectedTemplateId(template.id)}
                            className={`flex w-full items-start justify-between border-b border-border px-3 py-3 text-left last:border-b-0 ${
                              isSelected
                                ? "bg-success-bg"
                                : "bg-bg-card hover:bg-hover-bg"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-text-primary">
                                {template.name}
                              </div>
                              <div className="mt-1 text-xs text-text-secondary">
                                Ranking cutoff: {formatDate(template.rankingCutoffDate)}
                              </div>
                            </div>
                            <span
                              className={`ml-3 mt-0.5 h-4 w-4 shrink-0 border ${
                                isSelected
                                  ? "border-accent bg-accent"
                                  : "border-border bg-bg-card"
                              }`}
                              aria-hidden="true"
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedTemplate && (
                    <div className="border border-border-accent bg-success-bg p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                            Selected Paper
                          </div>
                          <div className="text-base font-semibold text-text-primary">
                            {selectedTemplate.name}
                          </div>
                          <div className="font-mono text-sm text-accent">
                            {selectedTemplate.code || "-"}
                          </div>
                          <div className="text-sm text-text-secondary">
                            Ranking cutoff: {formatDate(selectedTemplate.rankingCutoffDate)}
                          </div>
                        </div>
                        <div className="space-y-2 sm:min-w-60">
                          <CompactLinkRow label="Question PDF" href={selectedTemplate.questionPdf} />
                          <CompactLinkRow label="Solution PDF" href={selectedTemplate.solutionPdf} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title="When And How"
                subtitle="Set the session window and student-facing test behaviour."
              >
                <div className="space-y-4">
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
                      className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
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
                        className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
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
                        className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                      />
                      <p className="mt-1 text-xs text-text-secondary">
                        Default window is {DEFAULT_DURATION_HOURS} hours.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 border border-border bg-bg-card-alt p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                      Student Experience
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

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                        Gurukul Format
                      </div>
                      <div className="inline-flex w-full flex-wrap border border-border sm:w-auto">
                        {GurukulFormatOptions.map((option) => {
                          const selected = gurukulFormatType === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setGurukulFormatType(option.value)}
                              className={`px-3 py-2 text-xs font-bold uppercase tracking-wide ${
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

                  <div className="border border-border bg-bg-card-alt p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                      Ready To Create
                    </div>
                    <div className="mt-2 space-y-2 text-sm text-text-secondary">
                      <div>
                        <span className="font-medium text-text-primary">Batch:</span>{" "}
                        {selectedBatchNames.length ? selectedBatchNames.join(", ") : "-"}
                      </div>
                      <div>
                        <span className="font-medium text-text-primary">Paper:</span>{" "}
                        {selectedTemplate?.name || "-"}
                      </div>
                      <div>
                        <span className="font-medium text-text-primary">Window:</span>{" "}
                        {startTime ? formatDateTime(new Date(startTime).toISOString()) : "-"} to{" "}
                        {endTime ? formatDateTime(new Date(endTime).toISOString()) : "-"}
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
              className="border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
          className="relative flex max-h-[92vh] w-full max-w-3xl flex-col border border-border bg-bg-card shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
                Edit Quiz Session
              </h2>
              <p className="text-sm text-text-secondary">
                Update timing and session settings. Paper and batch selection stay fixed.
              </p>
            </div>
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
              <SectionCard
                title="Fixed Context"
                subtitle="These parts are carried from the original session and cannot be changed here."
              >
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

              <SectionCard
                title="Timing"
                subtitle="Adjust the test window if the schedule changes."
              >
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                      Session Name
                    </label>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
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
                        className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
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
                        className="w-full border-2 border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Session Settings"
                subtitle="These match the teacher-controlled options from session creation."
              >
                <div className="space-y-4">
                  <div className="space-y-3 border border-border bg-bg-card-alt p-4">
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
                      <div className="inline-flex w-full flex-wrap border border-border sm:w-auto">
                        {GurukulFormatOptions.map((option) => {
                          const selected = gurukulFormatType === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setGurukulFormatType(option.value)}
                              className={`px-3 py-2 text-xs font-bold uppercase tracking-wide ${
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
              className="border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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

  const parentId = getMetaString(session.meta_data, "parent_id");
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
          className="relative w-full max-w-3xl border border-border bg-bg-card shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
                Session Details
              </h2>
              <p className="text-sm text-text-secondary">
                Links, paper details, and session settings.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onEdit}
                disabled={isSessionPending(session)}
                className="border-2 border-border px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:bg-bg-card-alt disabled:text-text-muted"
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
                label="Status"
                value={getStatusLabel(getMetaString(session.meta_data, "status"))}
              />
              <InfoRow
                label="Parent Batch"
                value={parentId ? batchNameMap.get(parentId) || parentId : "-"}
              />
              <InfoRow
                label="Class Batches"
                value={classBatchNames?.length ? classBatchNames.join(", ") : "-"}
              />
              <InfoRow
                label="Start Time"
                value={formatDateTime(session.start_time)}
                mono
              />
              <InfoRow label="End Time" value={formatDateTime(session.end_time)} mono />
            </div>

            <SectionCard title="Paper" subtitle="Template and paper details used for this session.">
              <div className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoRow
                    label="Paper Name"
                    value={getMetaString(session.meta_data, "resource_name") || session.name}
                  />
                  <InfoRow
                    label="Test Code"
                    value={getMetaString(session.meta_data, "test_code") || "-"}
                    mono
                  />
                  <InfoRow
                    label="Test Format"
                    value={getMetaString(session.meta_data, "test_format") || "-"}
                  />
                  <InfoRow
                    label="Test Purpose"
                    value={getMetaString(session.meta_data, "test_purpose") || "-"}
                  />
                  <InfoRow
                    label="Test Type"
                    value={getMetaString(session.meta_data, "test_type") || "-"}
                  />
                  <InfoRow
                    label="Ranking Cutoff"
                    value={formatDate(getMetaString(session.meta_data, "ranking_cutoff_date"))}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ActionLinkRow
                    label="Question PDF"
                    href={getMetaString(session.meta_data, "question_pdf")}
                  />
                  <ActionLinkRow
                    label="Solution PDF"
                    href={getMetaString(session.meta_data, "solution_pdf")}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Session Settings" subtitle="These are the options used while creating the session.">
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoRow
                  label="Enabled"
                  value={toYesNo(session.is_active ?? true)}
                />
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

            <SectionCard title="Access Links" subtitle="Open or copy the session links from here.">
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
              className="border-2 border-border px-4 py-2 text-sm font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
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
    <div className="border border-border bg-bg-card">
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

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className="border border-border bg-bg-card-alt px-3 py-2 text-sm text-text-primary">
        {value || "—"}
      </div>
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

function CompactLinkRow({ label, href }: { label: string; href?: string }) {
  const value = href?.trim();
  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-bg-card px-3 py-2">
      <div className="text-xs font-bold uppercase tracking-wide text-text-muted">{label}</div>
      {value ? (
        <div className="flex items-center gap-2">
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-bold uppercase tracking-wide text-accent hover:text-accent-hover"
          >
            Open
          </a>
          <button
            type="button"
            onClick={() => copyToClipboard(value)}
            className="border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent"
          >
            Copy
          </button>
        </div>
      ) : (
        <span className="text-sm text-text-secondary">-</span>
      )}
    </div>
  );
}

function ActionLinkRow({ label, href }: { label: string; href?: string }) {
  const value = href?.trim();

  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-bg-card-alt px-3 py-3">
      <div className="min-w-0 text-xs font-bold uppercase tracking-wide text-text-muted">
        {label}
      </div>
      {value ? (
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="bg-accent px-3 py-2 text-xs font-bold uppercase tracking-wide text-text-on-accent hover:bg-accent-hover"
          >
            Open
          </a>
          <button
            type="button"
            onClick={() => copyToClipboard(value)}
            className="border-2 border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-text-primary hover:border-accent hover:text-accent"
          >
            Copy
          </button>
        </div>
      ) : (
        <div className="shrink-0 text-sm text-text-secondary">N/A</div>
      )}
    </div>
  );
}
