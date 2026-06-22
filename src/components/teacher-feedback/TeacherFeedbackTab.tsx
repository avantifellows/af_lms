"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Toast from "@/components/Toast";
import { parseBatchStream } from "@/lib/batch-code";

interface BatchOption {
  id: number;
  name: string;
  batch_id: string;
  parent_id: number | null;
  program_id: number | null;
}

interface FeedbackTeacher {
  id: string | null;
  name: string;
  role: string | null;
  subject: string | null;
  source?: string;
}

interface SelectedTeacher {
  id: string | null;
  name: string;
}

interface TeacherResult {
  teacherName: string;
  teacherOrder: number;
  status: "created" | "failed";
  sessionId?: string;
  portalLink?: string;
  error?: string;
}

interface SetupResponse {
  cycleLabel: string;
  createdCount: number;
  failedCount: number;
  teachers: TeacherResult[];
}

const GRADES = [11, 12];

export default function TeacherFeedbackTab({
  schoolId,
  schoolCode,
  canEdit,
}: {
  schoolId: string;
  schoolCode: string;
  canEdit: boolean;
}) {
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [grade, setGrade] = useState<number | "">("");
  const [parentBatchId, setParentBatchId] = useState<string>("");
  const [selectedClassBatchIds, setSelectedClassBatchIds] = useState<string[]>([]);

  const [teachers, setTeachers] = useState<FeedbackTeacher[]>([]);
  const [teacherSource, setTeacherSource] = useState<string>("");
  const [selected, setSelected] = useState<SelectedTeacher[]>([]);
  const [freeText, setFreeText] = useState("");

  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");

  const [loadingBatches, setLoadingBatches] = useState(false);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ variant: "error" | "success" | "info"; message: string } | null>(null);
  const [result, setResult] = useState<SetupResponse | null>(null);

  // --- batches ---
  const fetchBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const res = await fetch(`/api/quiz-sessions/batches?schoolId=${schoolId}`);
      const body = await res.json();
      setBatches(Array.isArray(body.batches) ? body.batches : []);
    } catch {
      setToast({ variant: "error", message: "Failed to load batches" });
    } finally {
      setLoadingBatches(false);
    }
  }, [schoolId]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Parent (grade) batches = those that are a parent of some class batch.
  const parentIdSet = useMemo(() => {
    const set = new Set<number>();
    for (const b of batches) if (b.parent_id !== null) set.add(b.parent_id);
    return set;
  }, [batches]);

  const parentBatches = useMemo(
    () => batches.filter((b) => parentIdSet.has(b.id)),
    [batches, parentIdSet]
  );

  // Class batches under the chosen parent.
  const classBatches = useMemo(() => {
    const parent = parentBatches.find((b) => b.batch_id === parentBatchId);
    if (!parent) return [];
    return batches.filter((b) => b.parent_id === parent.id);
  }, [batches, parentBatches, parentBatchId]);

  // Filter parent batches to the chosen grade (grade encoded in batch_id, e.g. _11_).
  const parentBatchesForGrade = useMemo(() => {
    if (grade === "") return parentBatches;
    return parentBatches.filter((b) => b.batch_id.includes(`_${grade}_`) || b.batch_id.includes(`_${grade}`));
  }, [parentBatches, grade]);

  // --- teachers ---
  const fetchTeachers = useCallback(async () => {
    setLoadingTeachers(true);
    try {
      const res = await fetch(`/api/teacher-feedback/teachers?school_code=${encodeURIComponent(schoolCode)}`);
      const body = await res.json();
      setTeachers(Array.isArray(body.teachers) ? body.teachers : []);
      setTeacherSource(body.source ?? "");
    } catch {
      setToast({ variant: "error", message: "Failed to load teachers" });
    } finally {
      setLoadingTeachers(false);
    }
  }, [schoolCode]);

  useEffect(() => {
    fetchTeachers();
  }, [fetchTeachers]);

  const isSelected = (t: FeedbackTeacher) =>
    selected.some((s) => (t.id ? s.id === t.id : s.name === t.name));

  const toggleTeacher = (t: FeedbackTeacher) => {
    setSelected((prev) => {
      const exists = prev.some((s) => (t.id ? s.id === t.id : s.name === t.name));
      if (exists) return prev.filter((s) => !(t.id ? s.id === t.id : s.name === t.name));
      return [...prev, { id: t.id, name: t.name }];
    });
  };

  const addFreeText = () => {
    const name = freeText.trim();
    if (!name) return;
    if (selected.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setFreeText("");
      return;
    }
    setSelected((prev) => [...prev, { id: null, name }]);
    setFreeText("");
  };

  const removeSelected = (s: SelectedTeacher) =>
    setSelected((prev) => prev.filter((x) => x !== s));

  const canSubmit =
    canEdit &&
    grade !== "" &&
    parentBatchId !== "" &&
    selectedClassBatchIds.length > 0 &&
    selected.length > 0 &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/teacher-feedback/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolCode,
          parentBatchId,
          classBatchIds: selectedClassBatchIds,
          grade,
          startTime: startTime ? new Date(startTime).toISOString() : undefined,
          endTime: endTime ? new Date(endTime).toISOString() : undefined,
          teachers: selected.map((s, i) => ({ id: s.id, name: s.name, order: i + 1 })),
        }),
      });
      const body = (await res.json()) as SetupResponse & { error?: string };
      if (!res.ok && res.status !== 207) {
        setToast({ variant: "error", message: body.error || "Setup failed" });
        return;
      }
      setResult(body);
      setToast({
        variant: body.failedCount > 0 ? "info" : "success",
        message:
          body.failedCount > 0
            ? `Created ${body.createdCount}, ${body.failedCount} failed`
            : `Created ${body.createdCount} feedback session(s) for ${body.cycleLabel}`,
      });
    } catch {
      setToast({ variant: "error", message: "Setup request failed" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="bg-bg-card-alt border border-border rounded-lg p-8 text-center">
        <p className="text-text-secondary">You have read-only access to this school.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} />}

      <div className="rounded-lg border border-border bg-bg-card p-5 space-y-5">
        <div>
          <h3 className="text-base font-semibold text-text">Set up Teacher Feedback</h3>
          <p className="text-sm text-text-secondary">
            Pick the batch and the teachers to be rated. One feedback form per teacher is
            created and surfaces on the students&apos; Gurukul.
          </p>
        </div>

        {/* Grade + batch */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-text">Grade</span>
            <select
              className="w-full rounded-md border border-border bg-bg px-3 py-2"
              value={grade}
              onChange={(e) => {
                setGrade(e.target.value ? Number(e.target.value) : "");
                setParentBatchId("");
                setSelectedClassBatchIds([]);
              }}
            >
              <option value="">Select grade…</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  Grade {g}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-text">Batch</span>
            <select
              className="w-full rounded-md border border-border bg-bg px-3 py-2 disabled:opacity-50"
              value={parentBatchId}
              disabled={grade === "" || loadingBatches}
              onChange={(e) => {
                setParentBatchId(e.target.value);
                setSelectedClassBatchIds([]);
              }}
            >
              <option value="">{loadingBatches ? "Loading…" : "Select batch…"}</option>
              {parentBatchesForGrade.map((b) => (
                <option key={b.id} value={b.batch_id}>
                  {b.name || b.batch_id}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Class batches */}
        {parentBatchId && (
          <div className="text-sm">
            <span className="mb-1 block font-medium text-text">Class batches</span>
            {classBatches.length === 0 ? (
              <p className="text-text-muted">No class batches under this batch.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {classBatches.map((b) => {
                  const checked = selectedClassBatchIds.includes(b.batch_id);
                  const stream = parseBatchStream(b.batch_id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() =>
                        setSelectedClassBatchIds((prev) =>
                          checked ? prev.filter((x) => x !== b.batch_id) : [...prev, b.batch_id]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs ${
                        checked
                          ? "border-accent bg-accent/10 text-accent-hover"
                          : "border-border bg-bg text-text-secondary"
                      }`}
                    >
                      {b.name || b.batch_id}
                      {stream ? ` · ${stream}` : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Teachers */}
        <div className="text-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-text">Teachers to rate</span>
            {teacherSource === "user_permission" && (
              <span className="text-xs text-warning-text">
                No centre roster — showing permission-based list
              </span>
            )}
          </div>

          {loadingTeachers ? (
            <p className="text-text-muted">Loading teachers…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {teachers.map((t) => (
                <button
                  key={t.id ?? t.name}
                  type="button"
                  onClick={() => toggleTeacher(t)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    isSelected(t)
                      ? "border-accent bg-accent/10 text-accent-hover"
                      : "border-border bg-bg text-text-secondary"
                  }`}
                >
                  {t.name}
                  {t.subject ? ` · ${t.subject}` : t.role ? ` · ${t.role}` : ""}
                </button>
              ))}
              {teachers.length === 0 && (
                <p className="text-text-muted">No teachers found — add by name below.</p>
              )}
            </div>
          )}

          {/* Free-text add */}
          <div className="mt-3 flex gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm"
              placeholder="Add a teacher by name…"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFreeText();
                }
              }}
            />
            <button
              type="button"
              onClick={addFreeText}
              className="rounded-md border border-border px-3 py-2 text-sm text-text-secondary"
            >
              Add
            </button>
          </div>

          {/* Selected chips (ordered) */}
          {selected.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.map((s, i) => (
                <span
                  key={s.id ?? s.name}
                  className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent-hover"
                >
                  {i + 1}. {s.name}
                  <button
                    type="button"
                    onClick={() => removeSelected(s)}
                    className="ml-1 text-accent-hover/70 hover:text-accent-hover"
                    aria-label={`Remove ${s.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Window (optional) */}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-text-secondary">
            Schedule window (optional — defaults to now for ~1 day)
          </summary>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-text-secondary">Start</span>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-text-secondary">End</span>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
          </div>
        </details>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Setting up…" : "Set up feedback"}
          </button>
          {selected.length > 0 && (
            <span className="text-xs text-text-muted">
              {selected.length} teacher(s) · {selectedClassBatchIds.length} batch(es)
            </span>
          )}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="rounded-lg border border-border bg-bg-card p-5">
          <h4 className="mb-3 text-sm font-semibold text-text">
            {result.cycleLabel} — created {result.createdCount}
            {result.failedCount > 0 ? `, failed ${result.failedCount}` : ""}
          </h4>
          <ul className="space-y-1 text-sm">
            {result.teachers.map((t) => (
              <li key={`${t.teacherOrder}-${t.teacherName}`} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    t.status === "created" ? "bg-success" : "bg-danger"
                  }`}
                />
                <span className="text-text">{t.teacherName}</span>
                {t.status === "created" ? (
                  <span className="text-text-muted">· {t.sessionId}</span>
                ) : (
                  <span className="text-danger">· {t.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
