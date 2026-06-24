"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Toast from "@/components/Toast";
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

interface FeedbackCentre {
  id: number;
  name: string;
  typeCode: string | null;
}

interface CycleTeacher {
  teacherName: string;
  teacherOrder: number;
  teacherId: string | null;
  quizId: string | null;
  sessionId: string | null;
  status: string;
  portalLink: string;
  adminTestingLink: string;
}

interface Cycle {
  setupRunId: string;
  cycleLabel: string;
  centreName: string | null;
  batchClassIds: string[];
  batchClassNames: string[];
  grade: number;
  startTime: string | null;
  endTime: string | null;
  createdBy: string;
  createdAt: string;
  teachers: CycleTeacher[];
}

const DEFAULT_DURATION_HOURS = 24;

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value.includes("T") || value.includes("Z") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
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
  const [centres, setCentres] = useState<FeedbackCentre[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingCentres, setLoadingCentres] = useState(true);
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [analysisQuiz, setAnalysisQuiz] = useState<{ quizId: string; teacherName: string } | null>(null);
  const [toast, setToast] = useState<{ variant: "error" | "success" | "info"; message: string } | null>(null);

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

  const fetchCentres = useCallback(async () => {
    setLoadingCentres(true);
    try {
      const res = await fetch(`/api/teacher-feedback/centres?school_code=${encodeURIComponent(schoolCode)}`);
      const body = await res.json();
      setCentres(Array.isArray(body.centres) ? body.centres : []);
    } catch {
      setToast({ variant: "error", message: "Failed to load centres" });
    } finally {
      setLoadingCentres(false);
    }
  }, [schoolCode]);

  const fetchCycles = useCallback(async () => {
    setLoadingCycles(true);
    try {
      const res = await fetch(`/api/teacher-feedback/cycles?school_code=${encodeURIComponent(schoolCode)}`);
      const body = await res.json();
      setCycles(Array.isArray(body.cycles) ? body.cycles : []);
    } catch {
      setToast({ variant: "error", message: "Failed to load feedback rounds" });
    } finally {
      setLoadingCycles(false);
    }
  }, [schoolCode]);

  useEffect(() => {
    fetchBatches();
    fetchCentres();
    fetchCycles();
  }, [fetchBatches, fetchCentres, fetchCycles]);

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
      </div>

      {loadingCycles ? (
        <div className="rounded-lg border border-border bg-bg-card px-4 py-10 text-center text-sm text-text-secondary">
          Loading feedback rounds…
        </div>
      ) : cycles.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-card-alt px-4 py-10 text-center text-sm text-text-secondary">
          No feedback rounds yet. Use “Set Up Feedback” to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {cycles.map((c) => (
            <CycleCard
              key={c.setupRunId}
              cycle={c}
              onAnalyze={(quizId, teacherName) => setAnalysisQuiz({ quizId, teacherName })}
              onCopy={(msg) => setToast({ variant: "success", message: msg })}
            />
          ))}
        </div>
      )}

      {isCreateOpen && (
        <SetupModal
          schoolCode={schoolCode}
          batches={batches}
          centres={centres}
          loading={loadingBatches || loadingCentres}
          onClose={() => setIsCreateOpen(false)}
          onDone={(result) => {
            setIsCreateOpen(false);
            setToast({
              variant: result.failedCount > 0 ? "info" : "success",
              message:
                result.failedCount > 0
                  ? `Created ${result.createdCount}, ${result.failedCount} failed`
                  : `Created ${result.createdCount} feedback form(s) for ${result.cycleLabel}`,
            });
            fetchCycles();
          }}
        />
      )}

      {analysisQuiz && (
        <AnalysisModal
          quizId={analysisQuiz.quizId}
          teacherName={analysisQuiz.teacherName}
          onClose={() => setAnalysisQuiz(null)}
        />
      )}
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
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

function CopyLink({ label, href, onCopy }: { label: string; href: string; onCopy: (msg: string) => void }) {
  if (!href) return <span className="text-xs text-text-muted">{label}: -</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      onCopy(`${label} copied`);
    } catch {
      window.prompt(`Copy ${label}:`, href);
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-accent hover:underline"
      >
        {label}
      </a>
      <button
        type="button"
        onClick={copy}
        className="text-text-muted hover:text-text-primary"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        ⧉
      </button>
    </span>
  );
}

function CycleCard({
  cycle,
  onAnalyze,
  onCopy,
}: {
  cycle: Cycle;
  onAnalyze: (quizId: string, teacherName: string) => void;
  onCopy: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Capture "now" once at mount (lazy initializer) to keep render pure.
  const [nowMs] = useState(() => new Date().getTime());
  const end = cycle.endTime ? new Date(cycle.endTime.replace(" ", "T") + "Z").getTime() : null;
  const live = end !== null && end > nowMs;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-hover-bg"
      >
        <div className="flex items-center gap-3">
          <span className="text-text-muted">{open ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold text-text-primary">{cycle.cycleLabel}</span>
          {cycle.centreName && (
            <span className="text-xs text-text-secondary">{cycle.centreName}</span>
          )}
          <span className="text-xs text-text-secondary">
            {cycle.teachers.length} teacher{cycle.teachers.length === 1 ? "" : "s"} ·{" "}
            {cycle.batchClassIds.length} batch{cycle.batchClassIds.length === 1 ? "" : "es"}
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            live ? "bg-success-bg text-accent-hover" : "bg-bg-card-alt text-text-secondary"
          }`}
        >
          {live ? "Live" : "Ended"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="space-y-1 px-4 py-2 text-xs text-text-secondary">
            {cycle.batchClassNames.length > 0 && (
              <div>
                Batches:{" "}
                <span className="text-text-primary">{cycle.batchClassNames.join(", ")}</span>
              </div>
            )}
            <div>
              Window: {formatDateTime(cycle.startTime)} → {formatDateTime(cycle.endTime)}
            </div>
          </div>
          <ul className="divide-y divide-border">
            {cycle.teachers.map((t) => (
              <li
                key={`${t.teacherOrder}-${t.teacherName}`}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      t.status === "created" ? "bg-success" : "bg-danger"
                    }`}
                  />
                  <span className="text-sm font-medium text-text-primary">{t.teacherName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <CopyLink label="Session link" href={t.portalLink} onCopy={onCopy} />
                  <CopyLink label="Admin test" href={t.adminTestingLink} onCopy={onCopy} />
                  <button
                    type="button"
                    disabled={!t.quizId}
                    onClick={() => t.quizId && onAnalyze(t.quizId, t.teacherName)}
                    className="rounded-md border border-border px-3 py-1 text-xs font-medium text-text-secondary hover:bg-hover-bg disabled:opacity-40"
                  >
                    Analysis
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Analysis modal -----------------------------------------------------------

interface ParameterScore {
  parameter: string;
  score: number;
  maxScore: number;
}
interface ReportData {
  teacherName: string;
  responseCount: number;
  totalScore: number;
  maxTotalScore: number;
  percentage: number;
  parameters: ParameterScore[];
  comments: { role: "liked" | "improve"; text: string }[];
  batches: { batch: string; responseCount: number }[];
}

function AnalysisModal({
  quizId,
  teacherName,
  onClose,
}: {
  quizId: string;
  teacherName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/teacher-feedback/report?quiz_id=${encodeURIComponent(quizId)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load report");
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  const liked = data?.comments.filter((c) => c.role === "liked") ?? [];
  const improve = data?.comments.filter((c) => c.role === "improve") ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-text-primary">{teacherName}</h2>
            <div className="text-xs text-text-secondary">Feedback analysis</div>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-sm text-text-secondary">Loading analysis…</p>
          ) : error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : !data || data.responseCount === 0 ? (
            <p className="text-sm text-text-secondary">
              No student responses yet for this teacher.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="flex items-baseline gap-4">
                <div className="text-3xl font-bold text-text-primary">{data.percentage.toFixed(1)}%</div>
                <div className="text-sm text-text-secondary">
                  {data.totalScore.toFixed(1)} / {data.maxTotalScore} ·{" "}
                  {data.responseCount} response{data.responseCount === 1 ? "" : "s"}
                </div>
              </div>

              <SectionCard title="Parameter scores">
                <div className="space-y-2">
                  {data.parameters.map((p) => {
                    const pct = p.maxScore > 0 ? (p.score / p.maxScore) * 100 : 0;
                    return (
                      <div key={p.parameter}>
                        <div className="flex justify-between text-sm">
                          <span className="text-text-primary">{p.parameter}</span>
                          <span className="text-text-secondary">
                            {p.score.toFixed(1)} / {p.maxScore}
                          </span>
                        </div>
                        <div className="mt-1 h-2 w-full rounded-full bg-bg-card-alt">
                          <div className="h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              {data.batches.length > 0 && (
                <SectionCard title="Responses by batch">
                  <ul className="space-y-1 text-sm">
                    {data.batches.map((b) => (
                      <li key={b.batch} className="flex justify-between">
                        <span className="text-text-primary">{b.batch}</span>
                        <span className="text-text-secondary">{b.responseCount}</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              )}

              <SectionCard title="What students liked">
                {liked.length === 0 ? (
                  <p className="text-sm text-text-muted">No comments.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
                    {liked.map((c, i) => (
                      <li key={i}>{c.text}</li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard title="What could improve">
                {improve.length === 0 ? (
                  <p className="text-sm text-text-muted">No comments.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
                    {improve.map((c, i) => (
                      <li key={i}>{c.text}</li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Setup modal --------------------------------------------------------------

interface SetupResponse {
  cycleLabel: string;
  createdCount: number;
  failedCount: number;
}

type TimingMode = "start_now" | "schedule";

function SetupModal({
  schoolCode,
  batches,
  centres,
  loading,
  onClose,
  onDone,
}: {
  schoolCode: string;
  batches: BatchOption[];
  centres: FeedbackCentre[];
  loading: boolean;
  onClose: () => void;
  onDone: (result: SetupResponse) => void;
}) {
  // Centre is picked first (teachers map to a centre, not a school).
  const [centreId, setCentreId] = useState<number | null>(null);
  const [teachers, setTeachers] = useState<FeedbackTeacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
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

  // Auto-select when there's exactly one centre. Centres load asynchronously, so
  // this must be an effect (a one-time state initializer would see []).
  useEffect(() => {
    if (centreId === null && centres.length === 1) {
      setCentreId(centres[0].id);
    }
  }, [centres, centreId]);

  // Fetch teachers for the chosen centre; clear selection when centre changes.
  useEffect(() => {
    if (centreId === null) {
      setTeachers([]);
      return;
    }
    let cancelled = false;
    setLoadingTeachers(true);
    setSelectedTeachers([]);
    (async () => {
      try {
        const res = await fetch(`/api/teacher-feedback/teachers?centre_id=${centreId}`);
        const body = await res.json();
        if (!cancelled) setTeachers(Array.isArray(body.teachers) ? body.teachers : []);
      } catch {
        if (!cancelled) setTeachers([]);
      } finally {
        if (!cancelled) setLoadingTeachers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [centreId]);

  const parentIdSet = useMemo(() => {
    const set = new Set<number>();
    batches.forEach((b) => b.parent_id !== null && set.add(b.parent_id));
    return set;
  }, [batches]);
  const availableClassBatches = useMemo(
    () => batches.filter((b) => b.parent_id !== null && !parentIdSet.has(b.id)),
    [batches, parentIdSet]
  );

  // parentBatchId is best-effort (first selected batch's parent) for the group attach.
  const parentBatchId = useMemo(() => {
    const rows = classBatchIds
      .map((id) => batches.find((b) => b.batch_id === id))
      .filter(Boolean) as BatchOption[];
    const parentId = rows.find((r) => r.parent_id !== null)?.parent_id ?? null;
    return parentId !== null ? batches.find((b) => b.id === parentId)?.batch_id ?? "" : "";
  }, [classBatchIds, batches]);

  const toggleBatch = (batchId: string) =>
    setClassBatchIds((prev) =>
      prev.includes(batchId) ? prev.filter((x) => x !== batchId) : [...prev, batchId]
    );

  const teacherKey = (t: FeedbackTeacher) => t.id ?? t.name;
  const isTeacherSelected = (t: FeedbackTeacher) =>
    selectedTeachers.some((x) => teacherKey(x) === teacherKey(t));
  const toggleTeacher = (t: FeedbackTeacher) =>
    setSelectedTeachers((prev) =>
      prev.some((x) => teacherKey(x) === teacherKey(t))
        ? prev.filter((x) => teacherKey(x) !== teacherKey(t))
        : [...prev, t]
    );

  const canSubmit =
    centreId !== null && classBatchIds.length > 0 && selectedTeachers.length > 0 && !saving;

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
          centreId,
          parentBatchId,
          classBatchIds,
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
            <SectionCard title="1. Select Centre">
              {loading ? (
                <div className="text-sm text-text-secondary">Loading centres…</div>
              ) : centres.length === 0 ? (
                <div className="text-sm text-text-secondary">
                  No active centre is linked to this school.
                </div>
              ) : (
                <select
                  value={centreId ?? ""}
                  onChange={(e) => setCentreId(e.target.value ? Number(e.target.value) : null)}
                  className="min-h-[44px] w-full max-w-md rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Select a centre…</option>
                  {centres.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </SectionCard>

            <SectionCard title="2. Select Class Batches">
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                {loading ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">Loading batches…</div>
                ) : availableClassBatches.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">No class batches available.</div>
                ) : (
                  availableClassBatches.map((b) => {
                    const checked = classBatchIds.includes(b.batch_id);
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
                        <span className="block font-medium text-text-primary">{b.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </SectionCard>

            <SectionCard title="3. Select Teachers">
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                {centreId === null ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">Select a centre first.</div>
                ) : loadingTeachers ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">Loading teachers…</div>
                ) : teachers.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">No teachers found for this centre.</div>
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

            <SectionCard title="4. When">
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

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
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
  );
}
