"use client";

import { useEffect, useRef, useState } from "react";
import { addHours, toDateTimeLocalValue } from "@/lib/quiz-session-time";
import { DEFAULT_DURATION_HOURS, formatDateTime, formatPct, parseDbTime } from "./format";
import { CopyLink } from "./shared";
import type { Cycle, CycleTeacher, TeacherResponses } from "./types";

/** Responded counts and scores, fetched when the round is opened (it hits BigQuery). */
function useRoundResponses(setupRunId: string, open: boolean) {
  const [responses, setResponses] = useState<Map<number, TeacherResponses> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/teacher-feedback/cycles/${encodeURIComponent(setupRunId)}/responses`,
          { cache: "no-store" }
        );
        const body = await res.json();
        if (!res.ok) throw new Error();
        if (!cancelled) {
          setResponses(new Map((body.teachers as TeacherResponses[]).map((t) => [t.teacherOrder, t])));
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, setupRunId]);

  return { responses, failed };
}

function FormStatus({ teacher, onCopy }: { teacher: CycleTeacher; onCopy: (msg: string) => void }) {
  if (teacher.status === "failed") {
    return <span className="text-sm font-medium text-danger">Setup failed</span>;
  }
  if (teacher.buildFailed) {
    // sessionCreator reported a failed build; without this the card would pulse
    // "Generating links…" forever.
    return (
      <span className="text-sm font-medium text-danger" title="The quiz build failed. Set this teacher up again.">
        Quiz build failed
      </span>
    );
  }
  if (!teacher.portalLink) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-warning-text">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning-text" />
        Generating links…
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-4">
      <CopyLink label="Session link" href={teacher.portalLink} onCopy={onCopy} />
      <CopyLink label="Admin test" href={teacher.adminTestingLink} onCopy={onCopy} />
    </span>
  );
}

function PendingList({ pending, showBatch }: { pending: TeacherResponses["notResponded"]; showBatch: boolean }) {
  return (
    <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md bg-bg-card-alt px-3 py-2 text-sm text-text-primary">
      {pending.map((s) => (
        <li key={`${s.studentId}-${s.name}`}>
          {s.name || "Unnamed"}
          <span className="text-text-muted">
            {" "}· {s.studentId ?? "no ID"}
            {showBatch ? ` · ${s.batchId}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One box per teacher: score, who has responded, links, and the way into Analysis. */
function TeacherCard({
  teacher,
  responses,
  multiBatch,
  live,
  onAnalyze,
  onCopy,
}: {
  teacher: CycleTeacher;
  responses: TeacherResponses | undefined;
  multiBatch: boolean;
  /** Whether students can still answer: "pending" while live, "didn't respond" after. */
  live: boolean;
  onAnalyze: (quizId: string, teacherName: string) => void;
  onCopy: (msg: string) => void;
}) {
  const [showPending, setShowPending] = useState(false);
  const pending = responses?.notResponded ?? [];
  const scored = responses && responses.responseCount > 0;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-lg font-semibold text-text-primary">{teacher.teacherName}</span>
        <span className="text-3xl font-bold text-text-primary" title="Overall score">
          {scored ? formatPct(responses.percentage) : "–"}
        </span>
      </div>

      {responses && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={pending.length === 0}
            onClick={() => setShowPending((v) => !v)}
            aria-expanded={showPending}
            className="text-left text-base text-text-secondary hover:text-text-primary disabled:hover:text-text-secondary"
          >
            <span className="font-semibold text-text-primary">{responses.responded}</span>/{responses.total} responded
            {pending.length > 0 &&
              ` · ${pending.length} ${live ? "pending" : "didn’t respond"} ${showPending ? "▾" : "▸"}`}
          </button>
          {responses.outsideBatches > 0 && (
            <div
              className="text-sm text-warning-text"
              title="Answered, but not in this round's batches today (left, moved batch, or given this link by mistake). The score includes them."
            >
              +{responses.outsideBatches} from outside these batches
            </div>
          )}
          {showPending && <PendingList pending={pending} showBatch={multiBatch} />}
          {responses.seriousConcerns > 0 && (
            <div className="text-sm font-medium text-danger" title="From the summary — see View analysis">
              ⚑ {responses.seriousConcerns} serious concern{responses.seriousConcerns === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}

      <FormStatus teacher={teacher} onCopy={onCopy} />

      <button
        type="button"
        disabled={!teacher.quizId}
        title={teacher.quizId ? undefined : "Available once the form is generated"}
        onClick={() => teacher.quizId && onAnalyze(teacher.quizId, teacher.teacherName)}
        className="mt-auto rounded-lg border-2 border-accent px-4 py-2 text-sm font-bold uppercase tracking-wide text-accent hover:bg-accent hover:text-text-on-accent disabled:border-border disabled:text-text-muted disabled:hover:bg-transparent"
      >
        View analysis
      </button>
    </li>
  );
}

function RoundHeader({ cycle, open, live, onToggle }: {
  cycle: Cycle;
  open: boolean;
  live: boolean;
  onToggle: () => void;
}) {
  const batches = cycle.batchClassNames.join(", ") || `${cycle.batchClassIds.length} batches`;
  const teachers = `${cycle.teachers.length} teacher${cycle.teachers.length === 1 ? "" : "s"}`;
  const where = cycle.centreName ? `${cycle.centreName} · ` : "";
  const badge = live ? "bg-success-bg text-accent-hover" : "bg-bg-card-alt text-text-secondary";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-hover-bg sm:px-5"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-text-muted">{open ? "▾" : "▸"}</span>
          <span className="text-lg font-semibold text-text-primary">{cycle.cycleLabel}</span>
          <span className="text-base text-text-primary">{batches}</span>
        </div>
        <div className="mt-0.5 pl-5 text-sm text-text-secondary">
          {where}
          {teachers} · {formatDateTime(cycle.startTime)} → {formatDateTime(cycle.endTime)}
        </div>
      </div>
      <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${badge}`}>{live ? "Live" : "Ended"}</span>
    </button>
  );
}

export default function CycleCard({
  cycle,
  canEdit,
  focused,
  onAnalyze,
  onCopy,
  onExtended,
}: {
  cycle: Cycle;
  canEdit: boolean;
  focused: boolean;
  onAnalyze: (quizId: string, teacherName: string) => void;
  onCopy: (msg: string) => void;
  onExtended: (message: string, variant: "success" | "info") => void;
}) {
  const [open, setOpen] = useState(focused);
  const cardRef = useRef<HTMLDivElement>(null);
  // Scroll once when the setup nudge sends the PM here; the card remounts on focus.
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);
  // Capture "now" once at mount (lazy initializer) to keep render pure.
  const [nowMs] = useState(() => new Date().getTime());
  const end = parseDbTime(cycle.endTime)?.getTime() ?? null;
  const live = end !== null && end > nowMs;
  const { responses, failed } = useRoundResponses(cycle.setupRunId, open);

  return (
    <div
      ref={cardRef}
      className={`overflow-hidden rounded-lg border bg-bg-card shadow-sm ${
        focused ? "border-accent ring-2 ring-accent/30" : "border-border"
      }`}
    >
      <RoundHeader cycle={cycle} open={open} live={live} onToggle={() => setOpen((v) => !v)} />

      {open && (
        <div className="border-t border-border">
          {canEdit && (
            <ExtendRound
              setupRunId={cycle.setupRunId}
              currentEndMs={end}
              nowMs={nowMs}
              onExtended={onExtended}
            />
          )}
          {failed && <div className="px-5 pt-3 text-sm text-danger">Couldn’t load who has responded.</div>}
          <ul className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            {cycle.teachers.map((t) => (
              <TeacherCard
                key={`${t.teacherOrder}-${t.teacherName}`}
                teacher={t}
                responses={t.quizId ? responses?.get(t.teacherOrder) : undefined}
                multiBatch={cycle.batchClassIds.length > 1}
                live={live}
                onAnalyze={onAnalyze}
                onCopy={onCopy}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExtendRound({
  setupRunId,
  currentEndMs,
  nowMs,
  onExtended,
}: {
  setupRunId: string;
  currentEndMs: number | null;
  nowMs: number;
  onExtended: (message: string, variant: "success" | "info") => void;
}) {
  // Default: a day past whichever is later, the current end or now.
  const [endTime, setEndTime] = useState(() =>
    toDateTimeLocalValue(addHours(new Date(Math.max(currentEndMs ?? nowMs, nowMs)), DEFAULT_DURATION_HOURS))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extend = async () => {
    const end = new Date(endTime);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Math.max(Date.now(), currentEndMs ?? 0)) {
      setError("Pick a time after the current end.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/teacher-feedback/cycles/${encodeURIComponent(setupRunId)}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endTime: end.toISOString() }),
      });
      const body = await res.json();
      if (res.status === 502) {
        // Partly extended: refresh so the card shows the teachers that did move.
        onExtended(body.error || "Some teachers could not be extended", "info");
        return;
      }
      if (!res.ok) {
        setError(body.error || "Failed to extend");
        return;
      }
      onExtended(`Extended to ${formatDateTime(body.endTime)}`, "success");
    } catch {
      setError("Extend request failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-card-alt px-5 py-3 text-sm">
      <span className="font-medium text-text-secondary">Extend deadline to</span>
      <input
        type="datetime-local"
        value={endTime}
        onChange={(e) => setEndTime(e.target.value)}
        className="rounded-md border border-border bg-bg-input px-2 py-1.5 text-sm text-text-primary"
      />
      <button
        type="button"
        onClick={extend}
        disabled={saving}
        className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? "Extending…" : "Extend"}
      </button>
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
