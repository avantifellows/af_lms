"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  OptionalLimitOptions,
  TestFormatOptions,
  TestPurposeOptions,
  TestTypeOptions,
} from "@/lib/quiz-session-options";
import { toDateTimeLocalValue } from "@/lib/quiz-session-time";

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

const PER_PAGE = 50;

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
    timeZone: "Asia/Kolkata",
  });
}

function getStatusLabel(status?: string) {
  if (!status) return "unknown";
  return status.toLowerCase();
}

function getStatusClasses(status?: string) {
  const normalized = getStatusLabel(status);
  if (normalized === "success") return "bg-green-100 text-green-800";
  if (normalized === "failed") return "bg-red-100 text-red-800";
  if (normalized === "pending") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-700";
}

function getMetaString(
  meta: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" ? value : undefined;
}

function getMetaDisplay(
  meta: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const value = meta?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<QuizSession | null>(null);
  const [menuState, setMenuState] = useState<{
    id: number;
    left: number;
    top: number;
  } | null>(null);

  const parentIdSet = useMemo(() => {
    const set = new Set<number>();
    batches.forEach((b) => {
      if (b.parent_id !== null) {
        set.add(b.parent_id);
      }
    });
    return set;
  }, [batches]);

  const classBatches = useMemo(
    () => batches.filter((b) => b.parent_id !== null && !parentIdSet.has(b.id)),
    [batches, parentIdSet]
  );

  const batchNameMap = useMemo(() => {
    const map = new Map<string, string>();
    batches.forEach((b) => {
      map.set(b.batch_id, b.name);
    });
    return map;
  }, [batches]);

  const fetchBatches = useCallback(async () => {
    setLoadingBatches(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/quiz-sessions/batches?schoolId=${schoolId}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch batches");
      }
      const data = await response.json();
      setBatches(data.batches || []);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch batches");
    } finally {
      setLoadingBatches(false);
    }
  }, [schoolId]);

  const fetchSessions = useCallback(async (pageIndex: number, classBatchId?: string) => {
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
      setError("Failed to fetch sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, [schoolId]);

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

  const handleClassBatchFilter = (value: string) => {
    setSelectedClassBatch(value);
    setPage(0);
  };

  const handleRegenerate = async (sessionId: number) => {
    try {
      const response = await fetch(
        `/api/quiz-sessions/${sessionId}/regenerate`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error("Failed to regenerate");
      }
      await fetchSessions(page, selectedClassBatch || undefined);
    } catch (err) {
      console.error(err);
      setError("Failed to regenerate quiz");
    }
  };

  const handleCreated = async () => {
    setIsCreateOpen(false);
    await fetchSessions(0, selectedClassBatch || undefined);
  };

  return (
    <div>
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Quiz Sessions</h2>
            <p className="text-sm text-gray-500">
              Create and manage quiz sessions for this school.
            </p>
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            Create Quiz Session
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 bg-white shadow rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Filter by Class Batch
        </label>
        <select
          value={selectedClassBatch}
          onChange={(e) => handleClassBatchFilter(e.target.value)}
          disabled={loadingBatches}
          className="block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
        >
          <option value="">All class batches</option>
          {classBatches.map((batch) => (
            <option key={batch.id} value={batch.batch_id}>
              {batch.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto overflow-y-visible bg-white shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                Name
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Class Batches
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Start
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                End
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Portal Link
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Admin Link
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Status
              </th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {loadingSessions ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
                  Loading sessions...
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
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
                  (id) => batchNameMap.get(id) || id
                );
                return (
                  <tr
                    key={session.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedSession(session)}
                  >
                    <td className="py-4 pl-4 pr-3 text-sm text-gray-900 sm:pl-6">
                      {session.name}
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      {classBatchNames?.length ? classBatchNames.join(", ") : "-"}
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      {formatDateTime(session.start_time)}
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      {formatDateTime(session.end_time)}
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      <LinkIcon
                        href={
                          getMetaString(session.meta_data, "shortened_link") ??
                          session.portal_link ??
                          ""
                        }
                        label="Portal link"
                      />
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      <LinkIcon
                        href={getMetaString(session.meta_data, "admin_testing_link") ?? ""}
                        label="Admin testing link"
                      />
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusClasses(status)}`}
                      >
                        {getStatusLabel(status)}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-500">
                      <div className="relative inline-block text-left" data-menu-root>
                        <button
                          data-menu-root
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuState((prev) =>
                              prev?.id === session.id
                                ? null
                                : { id: session.id, left: rect.left, top: rect.bottom }
                            );
                          }}
                          className="text-gray-500 hover:text-gray-700 px-2 py-1"
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

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => setPage((prev) => Math.max(0, prev - 1))}
          disabled={page === 0}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:bg-gray-100"
        >
          Previous
        </button>
        <span className="text-sm text-gray-500">Page {page + 1}</span>
        <button
          onClick={() => setPage((prev) => prev + 1)}
          disabled={!hasMore}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:bg-gray-100"
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
          onClose={() => setSelectedSession(null)}
        />
      )}

      {menuState && (
        <div
          data-menu-root
          className="fixed z-50 mt-2 w-40 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5"
          style={{ left: menuState.left, top: menuState.top }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRegenerate(menuState.id);
              setMenuState(null);
            }}
            disabled={
              getMetaString(
                sessions.find((s) => s.id === menuState.id)?.meta_data,
                "status"
              ) === "pending"
            }
            className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-300"
          >
            Regenerate
          </button>
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
  onCreated: () => void;
}) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const [name, setName] = useState("");
  const [derivedGrade, setDerivedGrade] = useState<number | null>(null);
  const [derivedStream, setDerivedStream] = useState<string>("");
  const [derivedCourse, setDerivedCourse] = useState<string>("");
  const [derivedParentBatchId, setDerivedParentBatchId] = useState("");
  const [derivedParentBatchName, setDerivedParentBatchName] = useState("");
  const [classBatchIds, setClassBatchIds] = useState<string[]>([]);
  const [testType, setTestType] = useState("");
  const [testFormat, setTestFormat] = useState("");
  const [testPurpose, setTestPurpose] = useState("");
  const [optionalLimits, setOptionalLimits] = useState("");
  const [cmsUrl, setCmsUrl] = useState("");
  const [showAnswers, setShowAnswers] = useState(true);
  const [showScores, setShowScores] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const [nextStepEnabled, setNextStepEnabled] = useState(false);
  const [nextStepUrl, setNextStepUrl] = useState("");
  const [nextStepText, setNextStepText] = useState("");
  const [startTime, setStartTime] = useState(toDateTimeLocalValue(new Date()));
  const [endTime, setEndTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentIdSet = useMemo(() => {
    const set = new Set<number>();
    batches.forEach((b) => {
      if (b.parent_id !== null) {
        set.add(b.parent_id);
      }
    });
    return set;
  }, [batches]);

  const availableClassBatches = useMemo(
    () => batches.filter((b) => b.parent_id !== null && !parentIdSet.has(b.id)),
    [batches, parentIdSet]
  );

  const handleClassBatchChange = (selected: string[]) => {
    setClassBatchIds(selected);
  };

  const deriveBatchData = (selected: string[]) => {
    const selectedRows = selected
      .map((id) => batches.find((b) => b.batch_id === id))
      .filter(Boolean) as BatchOption[];
    if (selectedRows.length === 0) {
      setDerivedGrade(null);
      setDerivedStream("");
      setDerivedCourse("");
      setDerivedParentBatchId("");
      setDerivedParentBatchName("");
      setError(null);
      return null;
    }

    const parentIds = new Set(
      selectedRows
        .map((row) => row.parent_id)
        .filter((value): value is number => value !== null)
    );
    if (parentIds.size !== 1) {
      setError("Selected class batches must belong to the same parent batch.");
      setDerivedGrade(null);
      setDerivedStream("");
      setDerivedCourse("");
      setDerivedParentBatchId("");
      setDerivedParentBatchName("");
      return null;
    }

    const parentId = Array.from(parentIds)[0];
    const parentRow = batches.find((b) => b.id === parentId);
    if (!parentRow) {
      setError("Unable to find parent batch for selected class batches.");
      setDerivedGrade(null);
      setDerivedStream("");
      setDerivedCourse("");
      setDerivedParentBatchId("");
      setDerivedParentBatchName("");
      return null;
    }

    const gradeSet = new Set(
      selectedRows.map((row) => parseBatchGrade(row.batch_id)).filter((g): g is number => g !== null)
    );
    if (gradeSet.size !== 1) {
      setError("Selected class batches must have the same grade.");
      setDerivedGrade(null);
      setDerivedStream("");
      setDerivedCourse("");
      setDerivedParentBatchId("");
      setDerivedParentBatchName("");
      return null;
    }

    const streamSet = new Set(
      selectedRows
        .map((row) => {
          const id = row.batch_id;
          if (id.includes("_Engg_")) return "engineering";
          if (id.includes("_Med_")) return "medical";
          return "";
        })
        .filter(Boolean)
    );

    if (streamSet.size !== 1) {
      setError("Unable to derive stream from selected batches.");
      setDerivedGrade(null);
      setDerivedStream("");
      setDerivedCourse("");
      setDerivedParentBatchId("");
      setDerivedParentBatchName("");
      return null;
    }

    const grade = Array.from(gradeSet)[0];
    const stream = Array.from(streamSet)[0];
    const course = stream === "medical" ? "NEET" : stream === "engineering" ? "JEE" : "";
    if (!course) {
      setError("Unable to derive course from selected batches.");
      setDerivedGrade(null);
      setDerivedStream("");
      setDerivedCourse("");
      setDerivedParentBatchId("");
      setDerivedParentBatchName("");
      return null;
    }

    setDerivedGrade(grade);
    setDerivedStream(stream);
    setDerivedCourse(course);
    setDerivedParentBatchId(parentRow.batch_id);
    setDerivedParentBatchName(parentRow.name);
    setError(null);
    return {
      grade,
      stream,
      course,
      parentBatchId: parentRow.batch_id,
    };
  };

  const validate = () => {
    if (!name.trim()) return "Session name is required";
    if (classBatchIds.length === 0) return "At least one class batch is required";
    if (!derivedParentBatchId) return "Parent batch could not be derived";
    if (!derivedGrade) return "Grade could not be derived";
    if (!derivedStream) return "Stream could not be derived";
    if (!derivedCourse) return "Course could not be derived";
    if (!testType) return "Test type is required";
    if (!testFormat) return "Test format is required";
    if (!testPurpose) return "Test purpose is required";
    if (!optionalLimits) return "Optional limits are required";
    if (!cmsUrl.trim()) return "CMS URL is required";
    if (!startTime) return "Start time is required";
    if (!endTime) return "End time is required";
    if (nextStepEnabled && (!nextStepUrl.trim() || !nextStepText.trim())) {
      return "Next step URL and text are required";
    }
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return "Invalid start or end time";
    }
    if (end <= start) return "End time must be after start time";
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
      const payload = {
        name,
        grade: derivedGrade,
        parentBatchId: derivedParentBatchId,
        classBatchIds,
        testType,
        testFormat,
        testPurpose,
        course: derivedCourse,
        stream: derivedStream,
        optionalLimits,
        cmsUrl,
        showAnswers,
        showScores,
        shuffle,
        nextStepEnabled,
        nextStepUrl,
        nextStepText,
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

      onCreated();
    } catch (err) {
      console.error(err);
      setError("Failed to create session");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-20" onClick={onClose} />
      <div
        className="relative min-h-screen flex items-center justify-center p-4"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        tabIndex={-1}
      >
        <div
          className="relative bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Create Quiz Session
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Session Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Class Batches
                </label>
                <select
                  multiple
                  value={classBatchIds}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                    handleClassBatchChange(values);
                    const derived = deriveBatchData(values);
                    if (derived) {
                      setError(null);
                    }
                  }}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  {availableClassBatches.map((batch) => (
                    <option key={batch.id} value={batch.batch_id}>
                      {batch.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Hold Ctrl/Cmd to select multiple
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Parent Batch (auto)
                </label>
                <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {derivedParentBatchName || "—"}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Grade (auto)
                </label>
                <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {derivedGrade ?? "—"}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Stream (auto)
                </label>
                <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {derivedStream ? derivedStream : "—"}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Course (auto)
                </label>
                <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {derivedCourse ? derivedCourse : "—"}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Type
                </label>
                <select
                  value={testType}
                  onChange={(e) => setTestType(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select test type</option>
                  {TestTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Format
                </label>
                <select
                  value={testFormat}
                  onChange={(e) => setTestFormat(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Purpose
                </label>
                <select
                  value={testPurpose}
                  onChange={(e) => setTestPurpose(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select test purpose</option>
                  {TestPurposeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Optional Limits
                </label>
                <select
                  value={optionalLimits}
                  onChange={(e) => setOptionalLimits(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select optional limits</option>
                  {OptionalLimitOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CMS URL
                </label>
                <input
                  value={cmsUrl}
                  onChange={(e) => setCmsUrl(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Time
                </label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showAnswers}
                  onChange={(e) => setShowAnswers(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300"
                />
                Show answers
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showScores}
                  onChange={(e) => setShowScores(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300"
                />
                Show scores
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={shuffle}
                  onChange={(e) => setShuffle(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300"
                />
                Shuffle questions
              </label>
            </div>

            <div className="mt-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={nextStepEnabled}
                  onChange={(e) => setNextStepEnabled(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300"
                />
                Add next step
              </label>
              {nextStepEnabled && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Next Step URL
                    </label>
                    <input
                      value={nextStepUrl}
                      onChange={(e) => setNextStepUrl(e.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Next Step Button Text
                    </label>
                    <input
                      value={nextStepText}
                      onChange={(e) => setNextStepText(e.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              {saving ? "Creating..." : "Create Session"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkRow({ label, href }: { label: string; href?: string }) {
  const value = href?.trim();

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      window.prompt("Copy link:", value);
    }
  };

  return (
    <div className="flex items-start gap-2">
      <span className="font-medium text-gray-900">{label}:</span>
      {value ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:text-blue-800 break-all"
          >
            {value}
          </a>
          <button
            onClick={handleCopy}
            className="inline-flex items-center text-gray-600 hover:text-gray-800 border border-gray-300 rounded p-1.5"
            aria-label="Copy link"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-4 w-4"
            >
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <rect x="4" y="4" width="11" height="11" rx="2" />
            </svg>
          </button>
        </div>
      ) : (
        <span>-</span>
      )}
    </div>
  );
}

function LinkIcon({ href, label }: { href?: string; label: string }) {
  const value = href?.trim();
  if (!value) {
    return <span className="text-gray-300">—</span>;
  }
  return (
    <a
      href={value}
      target="_blank"
      rel="noreferrer"
      title={label}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800"
      aria-label={label}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-5 w-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 6.75h4.5a3 3 0 0 1 0 6h-4.5m-3 0H6a3 3 0 0 1 0-6h4.5m-2 3h7"
        />
      </svg>
    </a>
  );
}

function QuizSessionDetailsModal({
  session,
  batchNameMap,
  onClose,
}: {
  session: QuizSession;
  batchNameMap: Map<string, string>;
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
    (id) => batchNameMap.get(id) || id
  );
  const portalLink =
    getMetaString(session.meta_data, "shortened_link") ??
    session.portal_link ??
    "";
  const reportLink = getMetaString(session.meta_data, "report_link") ?? "";
  const adminLink = getMetaString(session.meta_data, "admin_testing_link") ?? "";
  const omrLink = getMetaString(session.meta_data, "shortened_omr_link") ?? "";
  const gradeLabel = getMetaDisplay(session.meta_data, "grade") ?? "-";
  const cmsUrl = getMetaString(session.meta_data, "cms_test_id") ?? "-";
  const status = getMetaString(session.meta_data, "status");

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-20" onClick={onClose} />
      <div
        className="relative min-h-screen flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="relative bg-white rounded-lg shadow-xl max-w-lg w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Session Details</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              ✕
            </button>
          </div>
          <div className="p-4 space-y-3 text-sm text-gray-700">
            <div>
              <span className="font-medium text-gray-900">Name:</span> {session.name}
            </div>
            <div>
              <span className="font-medium text-gray-900">Grade:</span>{" "}
              {gradeLabel}
            </div>
            <div>
              <span className="font-medium text-gray-900">Parent Batch:</span>{" "}
              {parentId ? batchNameMap.get(parentId) || parentId : "-"}
            </div>
            <div>
              <span className="font-medium text-gray-900">Class Batches:</span>{" "}
              {classBatchNames?.length ? classBatchNames.join(", ") : "-"}
            </div>
            <div>
              <span className="font-medium text-gray-900">CMS URL:</span>{" "}
              {cmsUrl}
            </div>
            <LinkRow label="Portal Link" href={portalLink} />
            <LinkRow label="Admin Testing Link" href={adminLink} />
            <LinkRow label="Report Link" href={reportLink} />
            <LinkRow label="OMR Link" href={omrLink} />
            <div>
              <span className="font-medium text-gray-900">Start Time:</span>{" "}
              {formatDateTime(session.start_time)}
            </div>
            <div>
              <span className="font-medium text-gray-900">End Time:</span>{" "}
              {formatDateTime(session.end_time)}
            </div>
            <div>
              <span className="font-medium text-gray-900">Status:</span>{" "}
              {getStatusLabel(status)}
            </div>
          </div>
          <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
