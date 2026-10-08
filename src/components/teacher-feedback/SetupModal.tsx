"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui";
import { addHours, toDateTimeLocalValue } from "@/lib/quiz-session-time";
import { DEFAULT_DURATION_HOURS, formatDateTime, istMonth, parseDbTime } from "./format";
import { SectionCard } from "./shared";
import type { BatchOption, Cycle, FeedbackCentre, FeedbackTeacher } from "./types";

export interface SetupResponse {
  cycleLabel: string;
  createdCount: number;
  failedCount: number;
}

type TimingMode = "start_now" | "schedule";

const PICKER_BOX = "max-h-64 overflow-y-auto rounded-lg border border-border";
const NOTE = "px-3 py-4 text-sm text-text-secondary";
const INPUT =
  "min-h-[44px] w-full rounded-lg border-2 border-border bg-bg-input px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

const teacherKey = (t: FeedbackTeacher) => t.id ?? t.name;

function toggle<T>(list: T[], item: T, key: (x: T) => unknown = (x) => x): T[] {
  return list.some((x) => key(x) === key(item)) ? list.filter((x) => key(x) !== key(item)) : [...list, item];
}

/**
 * Teachers and batches for the chosen centre. Both reload when the centre
 * changes, and the caller clears its selections, so a batch picked for one
 * centre can never be submitted against another.
 */
function useCentreOptions(centreId: number | null) {
  // Each result remembers the centre it was fetched for; a mismatch means the
  // current centre's lists are still loading.
  const [result, setResult] = useState<{
    centreId: number;
    teachers: FeedbackTeacher[];
    batches: BatchOption[];
    batchNotice: string | null;
  } | null>(null);

  useEffect(() => {
    if (centreId === null) return;
    let cancelled = false;
    const get = (path: string) =>
      fetch(`/api/teacher-feedback/${path}?centre_id=${centreId}`, { cache: "no-store" }).then((r) => r.json());
    (async () => {
      const [t, b] = await Promise.allSettled([get("teachers"), get("batches")]);
      if (cancelled) return;
      const teacherList = t.status === "fulfilled" ? t.value.teachers : null;
      const batchBody = b.status === "fulfilled" ? b.value : null;
      setResult({
        centreId,
        teachers: Array.isArray(teacherList) ? teacherList : [],
        batches: Array.isArray(batchBody?.batches) ? batchBody.batches : [],
        batchNotice: batchBody
          ? typeof batchBody.reason === "string" ? batchBody.reason : null
          : "Failed to load batches for this centre.",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [centreId]);

  const current = result && result.centreId === centreId ? result : null;
  const loading = centreId !== null && current === null;
  const teachers = current?.teachers ?? [];
  const batches = useMemo(() => current?.batches ?? [], [current]);
  const batchNotice = current?.batchNotice ?? null;

  // Class batches are the leaves: a batch that is some other batch's parent is
  // the quiz batch. parentBatchId is best-effort (first selected batch's parent)
  // for the group attach.
  const classBatches = useMemo(() => {
    const parents = new Set(batches.map((b) => b.parent_id).filter((id) => id !== null));
    return batches.filter((b) => b.parent_id !== null && !parents.has(b.id));
  }, [batches]);
  const parentBatchIdFor = (classBatchIds: string[]) => {
    const parentId = classBatchIds
      .map((id) => batches.find((b) => b.batch_id === id)?.parent_id)
      .find((id) => id != null);
    return batches.find((b) => b.id === parentId)?.batch_id ?? "";
  };

  return { teachers, classBatches, batchNotice, loading, parentBatchIdFor };
}

function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-3 text-sm last:border-b-0 ${
        checked ? "bg-success-bg" : "bg-bg-card"
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-accent" />
      {children}
    </label>
  );
}

function CentrePicker({
  centres,
  loading,
  centreId,
  onChange,
}: {
  centres: FeedbackCentre[];
  loading: boolean;
  centreId: number | null;
  onChange: (id: number | null) => void;
}) {
  if (loading) return <div className="text-sm text-text-secondary">Loading centres…</div>;
  if (centres.length === 0) {
    return <div className="text-sm text-text-secondary">No active centre is linked to this school.</div>;
  }
  return (
    <select
      value={centreId ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={`${INPUT} max-w-md`}
    >
      <option value="">Select a centre…</option>
      {centres.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/** The centre-dependent states every picker shares; null when the list can show. */
function pickerNote(centreId: number | null, loading: boolean, what: string, empty: boolean, emptyText: string) {
  if (centreId === null) return "Select a centre first.";
  if (loading) return `Loading ${what}…`;
  return empty ? emptyText : null;
}

/** Under a batch that already had a round in the month being set up. */
function ExistingRoundNote({ round, sameMonth, onExtendInstead }: {
  round: Cycle;
  sameMonth: boolean;
  onExtendInstead: (setupRunId: string) => void;
}) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-warning-text">
      <span>
        Already had feedback {sameMonth ? "this month" : "that month"} ({formatDateTime(round.startTime)}).
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault(); // inside the batch's <label>: don't toggle the checkbox
          onExtendInstead(round.setupRunId);
        }}
        className="rounded-md border border-warning-border bg-bg-card px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-text-primary hover:bg-hover-bg"
      >
        Extend that round instead
      </button>
    </span>
  );
}

function TimingPicker({
  mode,
  onMode,
  startTime,
  endTime,
  onStart,
  onEnd,
}: {
  mode: TimingMode;
  onMode: (mode: TimingMode) => void;
  startTime: string;
  endTime: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}) {
  const option = (value: TimingMode, title: string, body: string) => (
    <button
      type="button"
      onClick={() => onMode(value)}
      className={`rounded-lg border px-4 py-4 text-left shadow-sm transition-colors ${
        mode === value ? "border-border-accent bg-success-bg" : "border-border bg-bg-card hover:bg-hover-bg"
      }`}
    >
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="mt-1 text-sm text-text-secondary">{body}</div>
    </button>
  );
  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-text-muted">{label}</label>
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
    </div>
  );
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {option("start_now", "Start now", `Opens now and closes ${DEFAULT_DURATION_HOURS} hours later.`)}
        {option("schedule", "Schedule", "Pick the exact start and end time.")}
      </div>
      {mode === "schedule" && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {field("Start Time", startTime, onStart)}
          {field("End Time", endTime, onEnd)}
        </div>
      )}
    </>
  );
}

/** Start and end for the request, or an error message for a bad schedule. */
function resolveWindow(mode: TimingMode, startTime: string, endTime: string): { start: Date; end: Date } | string {
  if (mode === "start_now") {
    const start = new Date();
    return { start, end: addHours(start, DEFAULT_DURATION_HOURS) };
  }
  const start = new Date(startTime), end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return "End time must be after start time.";
  }
  return { start, end };
}

export default function SetupModal({
  schoolCode,
  centres,
  cycles,
  loading,
  onClose,
  onDone,
  onExtendInstead,
}: {
  schoolCode: string;
  centres: FeedbackCentre[];
  cycles: Cycle[];
  loading: boolean;
  onClose: () => void;
  onDone: (result: SetupResponse) => void;
  onExtendInstead: (setupRunId: string) => void;
}) {
  // Centre is picked first: it scopes BOTH the teachers and the batches. A
  // school can host a CoE and a Nodal centre, each with its own cohorts, so
  // batches must not be fetched school-wide.
  const [centreId, setCentreIdState] = useState<number | null>(null);
  const options = useCentreOptions(centreId);
  const [classBatchIds, setClassBatchIds] = useState<string[]>([]);
  const [selectedTeachers, setSelectedTeachers] = useState<FeedbackTeacher[]>([]);
  const [timingMode, setTimingMode] = useState<TimingMode>("start_now");
  const [startTime, setStartTime] = useState(() => toDateTimeLocalValue(new Date()));
  const [endTime, setEndTime] = useState(() =>
    toDateTimeLocalValue(addHours(new Date(), DEFAULT_DURATION_HOURS))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCentreId = (id: number | null) => {
    setCentreIdState(id);
    setClassBatchIds([]);
    setSelectedTeachers([]);
  };

  // Auto-select when there's exactly one centre. Centres load asynchronously, so
  // this must be an effect (a one-time state initializer would see []).
  useEffect(() => {
    if (centreId === null && centres.length === 1) setCentreIdState(centres[0].id);
  }, [centres, centreId]);

  // The month the new round would run in: now, or the scheduled start.
  const [nowMonth] = useState(() => istMonth(new Date()));
  const scheduledStart = new Date(startTime);
  const roundMonth =
    timingMode === "schedule" && !Number.isNaN(scheduledStart.getTime()) ? istMonth(scheduledStart) : nowMonth;

  // Feedback is monthly per batch: a batch that already had a round that month
  // most likely needs that round extended, not a second form. Shown on the batch
  // itself, before it's picked. (Latest round wins: cycles come newest first.)
  const roundByBatch = useMemo(() => {
    const byBatch = new Map<string, Cycle>();
    for (const c of cycles) {
      const start = parseDbTime(c.startTime);
      if (start === null || istMonth(start) !== roundMonth) continue;
      for (const id of c.batchClassIds) if (!byBatch.has(id)) byBatch.set(id, c);
    }
    return byBatch;
  }, [cycles, roundMonth]);

  const canSubmit = centreId !== null && classBatchIds.length > 0 && selectedTeachers.length > 0 && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    const window = resolveWindow(timingMode, startTime, endTime);
    if (typeof window === "string") {
      setError(window);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/teacher-feedback/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolCode,
          centreId,
          parentBatchId: options.parentBatchIdFor(classBatchIds),
          classBatchIds,
          startTime: window.start.toISOString(),
          endTime: window.end.toISOString(),
          teachers: selectedTeachers.map((t, i) => ({ id: t.id, name: t.name, order: i + 1 })),
        }),
      });
      const body = (await res.json()) as SetupResponse & { error?: string };
      if (res.ok || res.status === 207) onDone(body);
      else setError(body.error || "Failed to set up feedback");
    } catch {
      setError("Setup request failed");
    } finally {
      setSaving(false);
    }
  };

  const batchNote = pickerNote(
    centreId,
    options.loading,
    "batches",
    options.classBatches.length === 0,
    options.batchNotice ?? "No class batches available for this centre."
  );
  const teacherNote = pickerNote(
    centreId,
    options.loading,
    "teachers",
    options.teachers.length === 0,
    "No teachers found for this centre."
  );

  return (
    <Modal open onClose={onClose} className="flex max-h-[92vh] max-w-4xl flex-col border border-border">
      <div className="flex items-start justify-between border-b-4 border-border-accent px-5 py-4">
        <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">Set Up Teacher Feedback</h2>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-5">
          <SectionCard title="1. Select Centre">
            <CentrePicker centres={centres} loading={loading} centreId={centreId} onChange={setCentreId} />
          </SectionCard>

          <SectionCard title="2. Select Class Batches">
            <div className={PICKER_BOX}>
              {batchNote ? (
                <div className={NOTE}>{batchNote}</div>
              ) : (
                options.classBatches.map((b) => (
                  <CheckRow
                    key={b.id}
                    checked={classBatchIds.includes(b.batch_id)}
                    onChange={() => setClassBatchIds((prev) => toggle(prev, b.batch_id))}
                  >
                    <span>
                      <span className="block font-medium text-text-primary">{b.name}</span>
                      {roundByBatch.has(b.batch_id) && (
                        <ExistingRoundNote
                          round={roundByBatch.get(b.batch_id)!}
                          sameMonth={roundMonth === nowMonth}
                          onExtendInstead={onExtendInstead}
                        />
                      )}
                    </span>
                  </CheckRow>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard title="3. Select Teachers">
            <div className={PICKER_BOX}>
              {teacherNote ? (
                <div className={NOTE}>{teacherNote}</div>
              ) : (
                options.teachers.map((t) => (
                  <CheckRow
                    key={teacherKey(t)}
                    checked={selectedTeachers.some((x) => teacherKey(x) === teacherKey(t))}
                    onChange={() => setSelectedTeachers((prev) => toggle(prev, t, teacherKey))}
                  >
                    <span className="font-medium text-text-primary">{t.name}</span>
                    {(t.subject || t.role) && <span className="text-xs text-text-secondary">{t.subject || t.role}</span>}
                  </CheckRow>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard title="4. When">
            <TimingPicker
              mode={timingMode}
              onMode={setTimingMode}
              startTime={startTime}
              endTime={endTime}
              onStart={setStartTime}
              onEnd={setEndTime}
            />
          </SectionCard>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
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
    </Modal>
  );
}
