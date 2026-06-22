"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Toast from "@/components/Toast";
import { parseBatchStream } from "@/lib/batch-code";
import { addHours, toDateTimeLocalValue } from "@/lib/quiz-session-time";

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
}

interface TeacherResult {
  teacherName: string;
  teacherOrder: number;
  status: "created" | "failed";
  sessionId?: string;
  error?: string;
}

interface SetupResponse {
  cycleLabel: string;
  createdCount: number;
  failedCount: number;
  teachers: TeacherResult[];
}

type TimingMode = "start_now" | "schedule";

const DEFAULT_DURATION_HOURS = 24;

function getCompactBatchLabel(values: string[]): string {
  if (values.length === 0) return "-";
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

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
  const [teachers, setTeachers] = useState<FeedbackTeacher[]>([]);
  const [teacherSource, setTeacherSource] = useState<string>("");
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [toast, setToast] = useState<{ variant: "error" | "success" | "info"; message: string } | null>(null);
  const [lastResult, setLastResult] = useState<SetupResponse | null>(null);

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
    fetchBatches();
    fetchTeachers();
  }, [fetchBatches, fetchTeachers]);

  return (
    <div className="space-y-4">
      {toast && (
        <Toast
          variant={toast.variant}
          message={toast.message}
          placement="bottom-right"
          autoDismissMs={4000}
          onDismiss={() => setToast(null)}
        />
      )}

      <div className="rounded-lg border border-border bg-bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b-4 border-border-accent px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Teacher Feedback</h2>
          {canEdit ? (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent shadow-sm hover:bg-accent-hover"
            >
              <span aria-hidden="true" className="relative inline-block h-3.5 w-3.5 shrink-0">
                <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-current" />
                <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-current" />
              </span>
              <span>Set Up Feedback</span>
            </button>
          ) : null}
        </div>
        <div className="px-4 py-3 text-sm text-text-secondary">
          Select the class batches and the teachers to be rated. One feedback form per
          teacher is created and surfaces on those students&apos; Gurukul. Once students
          respond, the analysis appears in the report below.
        </div>
      </div>

      {/* Result of the most recent setup (the "list" until the report lands). */}
      {lastResult ? (
        <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="border-b-2 border-border-accent px-4 py-3 text-sm font-bold uppercase tracking-wide text-text-muted">
            {lastResult.cycleLabel} — {lastResult.createdCount} created
            {lastResult.failedCount > 0 ? `, ${lastResult.failedCount} failed` : ""}
          </div>
          <ul className="divide-y divide-border">
            {lastResult.teachers.map((t) => (
              <li key={`${t.teacherOrder}-${t.teacherName}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    t.status === "created" ? "bg-success" : "bg-danger"
                  }`}
                />
                <span className="font-medium text-text-primary">{t.teacherName}</span>
                {t.status === "created" ? (
                  <span className="text-text-secondary">{t.sessionId}</span>
                ) : (
                  <span className="text-danger">{t.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-bg-card-alt px-4 py-10 text-center text-sm text-text-secondary">
          No feedback rounds set up yet in this session.
        </div>
      )}

      {/* Report placeholder — filled once responses exist (next phase). */}
      <div className="rounded-lg border border-dashed border-border bg-bg-card-alt px-4 py-6 text-center text-sm text-text-secondary">
        Feedback analysis (per-teacher scores &amp; comments) will appear here once
        students submit their responses.
      </div>

      {isCreateOpen && (
        <SetupModal
          schoolCode={schoolCode}
          batches={batches}
          teachers={teachers}
          teacherSource={teacherSource}
          loading={loadingBatches || loadingTeachers}
          onClose={() => setIsCreateOpen(false)}
          onDone={(result) => {
            setLastResult(result);
            setIsCreateOpen(false);
            setToast({
              variant: result.failedCount > 0 ? "info" : "success",
              message:
                result.failedCount > 0
                  ? `Created ${result.createdCount}, ${result.failedCount} failed`
                  : `Created ${result.createdCount} feedback form(s) for ${result.cycleLabel}`,
            });
          }}
        />
      )}
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
    <div className="rounded-lg border border-border bg-bg-card shadow-sm">
      <div className="border-b-2 border-border-accent px-4 py-3">
        <div className="text-sm font-bold uppercase tracking-wide text-text-primary">{title}</div>
        {subtitle ? <div className="mt-1 text-xs text-text-secondary">{subtitle}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function SetupModal({
  schoolCode,
  batches,
  teachers,
  teacherSource,
  loading,
  onClose,
  onDone,
}: {
  schoolCode: string;
  batches: BatchOption[];
  teachers: FeedbackTeacher[];
  teacherSource: string;
  loading: boolean;
  onClose: () => void;
  onDone: (result: SetupResponse) => void;
}) {
  const [classBatchIds, setClassBatchIds] = useState<string[]>([]);
  const [selectedTeachers, setSelectedTeachers] = useState<FeedbackTeacher[]>([]);
  const [timingMode, setTimingMode] = useState<TimingMode>("start_now");
  const [startTime, setStartTime] = useState(() => toDateTimeLocalValue(new Date()));
  const [endTime, setEndTime] = useState(() =>
    toDateTimeLocalValue(addHours(new Date(), DEFAULT_DURATION_HOURS))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  // Class batches = leaf batches (have a parent, are not themselves a parent).
  const parentIdSet = useMemo(() => {
    const set = new Set<number>();
    batches.forEach((b) => b.parent_id !== null && set.add(b.parent_id));
    return set;
  }, [batches]);
  const availableClassBatches = useMemo(
    () => batches.filter((b) => b.parent_id !== null && !parentIdSet.has(b.id)),
    [batches, parentIdSet]
  );

  // Derive the parent batch + grade from the selected class batches (like quiz sessions).
  const derivation = useMemo(() => {
    const rows = classBatchIds
      .map((id) => batches.find((b) => b.batch_id === id))
      .filter(Boolean) as BatchOption[];
    if (rows.length === 0) return { error: null as string | null, parentBatchId: "", grade: null as number | null };

    const parentIds = new Set(rows.map((r) => r.parent_id).filter((v): v is number => v !== null));
    if (parentIds.size !== 1) {
      return { error: "Selected class batches must belong to the same batch.", parentBatchId: "", grade: null };
    }
    const parent = batches.find((b) => b.id === Array.from(parentIds)[0]);
    if (!parent) return { error: "Could not find the parent batch.", parentBatchId: "", grade: null };

    // Grade from the parent batch_id (e.g. EnableStudents_11_...).
    const m = parent.batch_id.match(/_(\d{1,2})(?:_|$)/);
    const grade = m ? Number(m[1]) : null;
    if (grade !== 11 && grade !== 12) {
      return { error: "Could not derive grade (11/12) from the batch.", parentBatchId: "", grade: null };
    }
    return { error: null, parentBatchId: parent.batch_id, grade };
  }, [classBatchIds, batches]);

  const toggleBatch = (batchId: string) =>
    setClassBatchIds((prev) =>
      prev.includes(batchId) ? prev.filter((x) => x !== batchId) : [...prev, batchId]
    );

  const toggleTeacher = (t: FeedbackTeacher) =>
    setSelectedTeachers((prev) => {
      const key = (x: FeedbackTeacher) => x.id ?? x.name;
      return prev.some((x) => key(x) === key(t))
        ? prev.filter((x) => key(x) !== key(t))
        : [...prev, t];
    });

  const canSubmit =
    classBatchIds.length > 0 &&
    !derivation.error &&
    derivation.parentBatchId !== "" &&
    selectedTeachers.length > 0 &&
    !saving;

  const submit = async () => {
    if (!canSubmit) return;
    if (timingMode === "schedule") {
      const s = new Date(startTime), e = new Date(endTime);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
        setError("End time must be after start time.");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const start = timingMode === "start_now" ? new Date() : new Date(startTime);
      const end = timingMode === "start_now" ? addHours(start, DEFAULT_DURATION_HOURS) : new Date(endTime);
      const res = await fetch("/api/teacher-feedback/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolCode,
          parentBatchId: derivation.parentBatchId,
          classBatchIds,
          grade: derivation.grade,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          teachers: selectedTeachers.map((t, i) => ({ id: t.id, name: t.name, order: i + 1 })),
        }),
      });
      const body = (await res.json()) as SetupResponse & { error?: string };
      if (!res.ok && res.status !== 207) {
        setError(body.error || "Failed to set up feedback");
        return;
      }
      onDone(body);
    } catch {
      setError("Setup request failed");
    } finally {
      setSaving(false);
    }
  };

  const teacherKey = (t: FeedbackTeacher) => t.id ?? t.name;
  const isTeacherSelected = (t: FeedbackTeacher) =>
    selectedTeachers.some((x) => teacherKey(x) === teacherKey(t));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
          <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">Set Up Teacher Feedback</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-5">
            <SectionCard
              title="1. Select Class Batches"
              subtitle="Selected batches decide which students see the feedback forms."
            >
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                {loading ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">Loading batches…</div>
                ) : availableClassBatches.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">No class batches available.</div>
                ) : (
                  availableClassBatches.map((b) => {
                    const checked = classBatchIds.includes(b.batch_id);
                    const stream = parseBatchStream(b.batch_id);
                    return (
                      <label
                        key={b.id}
                        className={`flex cursor-pointer items-start gap-3 border-b border-border px-3 py-3 text-sm last:border-b-0 ${
                          checked ? "bg-success-bg" : "bg-bg-card"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBatch(b.batch_id)}
                          className="mt-0.5 h-4 w-4 accent-accent"
                        />
                        <span className="block font-medium text-text-primary">
                          {b.name}
                          {stream ? <span className="ml-2 text-xs text-text-secondary">{stream}</span> : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              {derivation.error && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {derivation.error}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="2. Select Teachers"
              subtitle={
                teacherSource === "user_permission"
                  ? "No centre roster for this school — showing the permission-based list."
                  : "Teachers placed at this school's centre."
              }
            >
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                {loading ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">Loading teachers…</div>
                ) : teachers.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">
                    No teachers found for this school.
                  </div>
                ) : (
                  teachers.map((t) => {
                    const checked = isTeacherSelected(t);
                    return (
                      <label
                        key={teacherKey(t)}
                        className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-3 text-sm last:border-b-0 ${
                          checked ? "bg-success-bg" : "bg-bg-card"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTeacher(t)}
                          className="h-4 w-4 accent-accent"
                        />
                        <span className="font-medium text-text-primary">{t.name}</span>
                        {(t.subject || t.role) && (
                          <span className="text-xs text-text-secondary">{t.subject || t.role}</span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </SectionCard>

            <SectionCard title="3. When">
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
                    Opens now and closes {DEFAULT_DURATION_HOURS} hours later.
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
                  <div className="mt-1 text-sm text-text-secondary">Pick the exact start and end time.</div>
                </button>
              </div>

              {timingMode === "schedule" && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">
                      Start Time
                    </label>
                    <input
                      type="datetime-local"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
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
                      onChange={(e) => setEndTime(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                </div>
              )}
            </SectionCard>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <div className="text-xs text-text-secondary">
            {selectedTeachers.length} teacher(s) ·{" "}
            {getCompactBatchLabel(
              classBatchIds.map((id) => batches.find((b) => b.batch_id === id)?.name || id)
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-hover-bg"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-bold uppercase tracking-wide text-text-on-accent shadow-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "Setting up…" : "Create Feedback Forms"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
