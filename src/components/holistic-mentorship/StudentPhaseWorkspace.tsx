"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { HolisticStudentPhaseDetail } from "@/lib/holistic-student-phase";
import { Button } from "@/components/ui/Button";
import GuidancePreview from "./GuidancePreview";

type NotesEditorProps = {
  studentId: number;
  phaseId: number;
  phaseRevision: number;
  mappingId: number;
  notesRevision: number;
  schoolCode: string;
  academicYear: string;
  editable: boolean;
  questions: Array<{ questionId: number; text: string }>;
  notes: null | {
    state: "draft" | "submitted";
    revision: number;
    answers?: Array<{ questionId: number; answer: string }>;
  };
};

class NotesRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function PostSessionNotesEditor(props: NotesEditorProps) {
  const initialAnswers = Object.fromEntries(props.questions.map(({ questionId }) => [
    questionId,
    props.notes?.answers?.find((answer) => answer.questionId === questionId)?.answer ?? "",
  ]));
  const [answers, setAnswers] = useState<Record<number, string>>(initialAnswers);
  const [notesState, setNotesState] = useState(props.notes?.state ?? "draft");
  const [editingSubmitted, setEditingSubmitted] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">(
    props.notes?.state === "draft" ? "saved" : "idle"
  );
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const revision = useRef(props.notes?.revision ?? props.notesRevision);
  const saved = useRef(JSON.stringify(initialAnswers));
  const queued = useRef<Record<number, string> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const apiUrl = `/api/holistic-mentorship/students/${props.studentId}/phases/${props.phaseId}?${new URLSearchParams({
    school_code: props.schoolCode,
    academic_year: props.academicYear,
  })}`;
  const mutate = useCallback(async (
    action: "draft" | "submit" | "edit",
    value: Record<number, string>,
    confirmed = false
  ) => {
    const response = await fetch(apiUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        expected_revision: revision.current,
        expected_mapping_id: props.mappingId,
        expected_phase_revision: props.phaseRevision,
        confirmed,
        answers: props.questions.map(({ questionId }) => ({
          question_id: questionId,
          answer: value[questionId] ?? "",
        })),
      }),
    });
    const result = await response.json() as { revision?: number; error?: string };
    if (!response.ok) throw new NotesRequestError(result.error || "Could not save Notes", response.status);
    revision.current = result.revision ?? revision.current;
  }, [apiUrl, props.mappingId, props.phaseRevision, props.questions]);

  const pump = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const work = (async () => {
      while (queued.current) {
        const value = queued.current;
        queued.current = null;
        setStatus("saving");
        setError("");
        setConflict(false);
        try {
          await mutate("draft", value);
          saved.current = JSON.stringify(value);
        } catch (caught) {
          setStatus("failed");
          setError(caught instanceof Error ? caught.message : "Could not save Notes");
          setConflict(caught instanceof NotesRequestError && caught.status === 409);
          return false;
        }
      }
      setStatus("saved");
      return true;
    })().finally(() => { inFlight.current = null; });
    inFlight.current = work;
    return work;
  }, [mutate]);

  const canAutosave = props.editable && notesState === "draft";
  useEffect(() => {
    if (!canAutosave || JSON.stringify(answers) === saved.current) return;
    const timer = window.setTimeout(() => {
      queued.current = answers;
      void pump();
    }, 750);
    return () => window.clearTimeout(timer);
  }, [answers, canAutosave, pump]);

  const retry = () => {
    queued.current = answers;
    void pump();
  };
  const submit = async () => {
    if (props.questions.some(({ questionId }) => !answers[questionId]?.trim())) {
      setStatus("failed");
      setError("Answer every Question before submitting");
      return;
    }
    queued.current = answers;
    if (!(await pump()) || !window.confirm("Submit these Post-Session Notes?")) return;
    setStatus("saving");
    try {
      await mutate("submit", answers, true);
      setNotesState("submitted");
      setStatus("saved");
    } catch (caught) {
      setStatus("failed");
      setError(caught instanceof Error ? caught.message : "Could not submit Notes");
    }
  };
  const saveCorrection = async () => {
    if (props.questions.some(({ questionId }) => !answers[questionId]?.trim())) {
      setStatus("failed");
      setError("Answer every Question before saving");
      return;
    }
    setStatus("saving");
    try {
      await mutate("edit", answers, true);
      saved.current = JSON.stringify(answers);
      setEditingSubmitted(false);
      setStatus("saved");
    } catch (caught) {
      setStatus("failed");
      setError(caught instanceof Error ? caught.message : "Could not save Notes");
    }
  };

  const showInputs = canAutosave || editingSubmitted;
  if (!showInputs) {
    return (
      <>
        {props.questions.map((question) => (
          <div key={question.questionId}>
            <h3 className="text-sm font-semibold text-text-secondary">{question.text}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
              {answers[question.questionId] || "Not submitted"}
            </p>
          </div>
        ))}
        {props.editable && notesState === "submitted" && (
          <Button type="button" variant="secondary" onClick={() => {
            if (window.confirm("Edit your submitted Post-Session Notes?")) {
              setEditingSubmitted(true);
              setStatus("idle");
            }
          }}>Edit Notes</Button>
        )}
      </>
    );
  }

  return (
    <>
      {props.questions.map((question) => (
        <label key={question.questionId} className="block space-y-1 text-sm font-semibold text-text-secondary">
          {question.text}
          <textarea
            aria-label={question.text}
            rows={4}
            value={answers[question.questionId] ?? ""}
            onChange={(event) => setAnswers((current) => ({
              ...current,
              [question.questionId]: event.target.value,
            }))}
            className="w-full resize-y rounded-md border border-border bg-bg-card p-3 font-normal text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </label>
      ))}
      <div className="flex min-h-11 flex-wrap items-center gap-3" aria-live="polite">
        {status === "saving" && <span className="text-sm text-text-muted">Saving</span>}
        {status === "saved" && <span className="text-sm font-medium text-success">Saved</span>}
        {status === "failed" && (
          <>
            <span className="text-sm text-danger">{error}</span>
            {canAutosave && !conflict && <Button type="button" variant="secondary" size="sm" onClick={retry}>Retry</Button>}
          </>
        )}
        {editingSubmitted ? (
          <>
            <Button type="button" onClick={() => void saveCorrection()} disabled={status === "saving"}>Save Changes</Button>
            <Button type="button" variant="ghost" onClick={() => {
              setAnswers(initialAnswers);
              setEditingSubmitted(false);
              setStatus("idle");
            }}>Cancel</Button>
          </>
        ) : (
          <Button type="button" onClick={() => void submit()} disabled={status === "saving"}>Submit Notes</Button>
        )}
      </div>
    </>
  );
}

export default function StudentPhaseWorkspace({
  detail,
  schoolCode,
  academicYear,
}: {
  detail: HolisticStudentPhaseDetail;
  schoolCode: string;
  academicYear: string;
}) {
  const selected = detail.selectedPhase;
  const openSelected = "locked" in selected && !selected.locked && "guidanceMarkdown" in selected
    ? selected
    : null;
  const phaseHref = (phaseId: number) =>
    `/holistic-mentorship/students/${detail.student.id}/phases/${phaseId}?${new URLSearchParams({
      school_code: schoolCode,
      academic_year: academicYear,
    })}`;
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{detail.student.name}</h1>
          <p className="text-sm text-text-muted">
            Grade {detail.student.grade}
            {detail.student.externalStudentId ? ` · ${detail.student.externalStudentId}` : ""}
          </p>
        </div>
        {detail.readOnly && <span className="text-sm font-medium text-text-muted">Read-only</span>}
      </header>

      <nav aria-label="Holistic Phases" className="flex gap-2 overflow-x-auto pb-2">
        {detail.phases.map((phase) => {
          const label = `Phase ${phase.number} - ${phase.title}`;
          if (phase.phaseId === null || ("locked" in phase && phase.locked)) {
            return (
              <button key={`${phase.number}-${phase.title}`} type="button" disabled
                className="min-h-11 shrink-0 rounded-md border border-border bg-bg-card-alt px-3 text-left text-sm text-text-muted opacity-60">
                <span className="block font-semibold">Phase {phase.number}</span>
                <span className="block max-w-40 truncate text-xs">{phase.title}</span>
              </button>
            );
          }
          const current = phase.phaseId === selected.phaseId;
          return (
            <Link key={phase.phaseId} href={phaseHref(phase.phaseId)} aria-label={label}
              className={`min-h-11 shrink-0 rounded-md border px-3 py-2 text-sm ${current
                ? "border-accent bg-accent text-text-on-accent"
                : "border-border bg-bg-card text-text-secondary hover:bg-hover-bg"}`}>
              <span className="block font-semibold">Phase {phase.number}</span>
              <span className="block max-w-40 truncate text-xs">{phase.title}</span>
            </Link>
          );
        })}
      </nav>

      {!openSelected ? (
        <p className="border-y border-border py-10 text-center text-sm text-text-muted">
          This Phase is locked.
        </p>
      ) : (
        <>
          <section aria-labelledby="phase-heading" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="phase-heading" className="text-xl font-semibold text-text-primary">
                Phase {openSelected.number}: {openSelected.title}
              </h2>
              {openSelected.active && <span className="rounded bg-success/10 px-2 py-1 text-xs font-semibold text-success">Active</span>}
              <span className="rounded bg-bg-card-alt px-2 py-1 text-xs font-semibold text-text-secondary">
                {openSelected.progress[0].toUpperCase() + openSelected.progress.slice(1)}
              </span>
              {openSelected.draftSaved && <span className="text-xs font-medium text-text-muted">Draft saved</span>}
            </div>
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <section aria-labelledby="context-heading" className="space-y-4 border-t border-border pt-4">
              <div>
                <h2 id="context-heading" className="text-lg font-semibold text-text-primary">Student Context</h2>
                {openSelected.context.label && <p className="text-sm font-medium text-accent">{openSelected.context.label}</p>}
                {"lastUpdatedAt" in openSelected.context && openSelected.context.lastUpdatedAt && (
                  <p className="text-xs text-text-muted">Last updated {formatDate(openSelected.context.lastUpdatedAt)}</p>
                )}
              </div>
              {"missing" in openSelected.context ? (
                <p className="text-sm text-text-muted">{openSelected.context.missing}</p>
              ) : (
                <dl className="space-y-4">
                  {openSelected.context.items.map((item, index) => (
                    <div key={`${item.label}-${index}`}>
                      <dt className="text-sm font-semibold text-text-secondary">{item.label}</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-primary">{item.content}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section aria-labelledby="guidance-heading" className="space-y-4 border-t border-border pt-4">
              <h2 id="guidance-heading" className="text-lg font-semibold text-text-primary">Phase Guidance</h2>
              <GuidancePreview markdown={openSelected.guidanceMarkdown} />
            </section>
          </div>

          <section aria-labelledby="notes-heading" className="space-y-4 border-t border-border pt-4">
            <h2 id="notes-heading" className="text-lg font-semibold text-text-primary">Post-Session Notes</h2>
            {openSelected.notes && (
              <p className="text-xs text-text-muted">
                {openSelected.notes.firstSubmittedAt ? `Submitted ${formatDate(openSelected.notes.firstSubmittedAt)}` : "Draft saved"}
                {` · Last edited ${formatDate(openSelected.notes.lastEditedAt)}`}
              </p>
            )}
            <PostSessionNotesEditor
              studentId={detail.student.id}
              phaseId={openSelected.phaseId}
              phaseRevision={openSelected.revision}
              mappingId={openSelected.mappingId}
              notesRevision={openSelected.notesRevision}
              schoolCode={schoolCode}
              academicYear={academicYear}
              editable={!detail.readOnly && openSelected.canEditNotes}
              questions={openSelected.questions}
              notes={openSelected.notes}
            />
          </section>
        </>
      )}
    </div>
  );
}
