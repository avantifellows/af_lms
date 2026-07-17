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
type NotesEditorStatus = "idle" | "saving" | "saved" | "failed";
type OpenSelectedPhase = Extract<HolisticStudentPhaseDetail["selectedPhase"], { guidanceMarkdown: string }>;
type PhaseNavigationItem = HolisticStudentPhaseDetail["phases"][number];

function initialNotesAnswers(props: NotesEditorProps) {
  return Object.fromEntries(props.questions.map(({ questionId }) => [
    questionId,
    props.notes?.answers?.find((answer) => answer.questionId === questionId)?.answer ?? "",
  ]));
}

function initialEditorState(props: NotesEditorProps) {
  if (!props.notes) {
    return { notesState: "draft" as const, status: "idle" as const, revision: props.notesRevision };
  }
  return {
    notesState: props.notes.state,
    status: props.notes.state === "draft" ? "saved" as const : "idle" as const,
    revision: props.notes.revision,
  };
}

function canAutosaveNotes(editable: boolean, notesState: "draft" | "submitted") {
  return editable && notesState === "draft";
}

function shouldShowNotesInputs(canAutosave: boolean, editingSubmitted: boolean) {
  return canAutosave || editingSubmitted;
}

function selectedOpenPhase(detail: HolisticStudentPhaseDetail): OpenSelectedPhase | null {
  const selected = detail.selectedPhase;
  if ("locked" in selected && !selected.locked && "guidanceMarkdown" in selected) return selected;
  return null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

class NotesRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function PostSessionNotesEditor(props: NotesEditorProps) {
  const initialAnswers = initialNotesAnswers(props);
  const initialEditor = initialEditorState(props);
  const [answers, setAnswers] = useState<Record<number, string>>(initialAnswers);
  const [notesState, setNotesState] = useState(initialEditor.notesState);
  const [editingSubmitted, setEditingSubmitted] = useState(false);
  const [status, setStatus] = useState<NotesEditorStatus>(initialEditor.status);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const revision = useRef(initialEditor.revision);
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

  const canAutosave = canAutosaveNotes(props.editable, notesState);
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

  const beginCorrection = () => {
    if (!window.confirm("Edit your submitted Post-Session Notes?")) return;
    setEditingSubmitted(true);
    setStatus("idle");
  };
  const cancelCorrection = () => {
    setAnswers(initialAnswers);
    setEditingSubmitted(false);
    setStatus("idle");
  };
  const updateAnswer = (questionId: number, answer: string) => {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
  };

  const showInputs = shouldShowNotesInputs(canAutosave, editingSubmitted);
  if (!showInputs) {
    return <SubmittedNotesView questions={props.questions} answers={answers}
      canEdit={props.editable && notesState === "submitted"} onEdit={beginCorrection} />;
  }

  return <EditableNotesForm questions={props.questions} answers={answers} status={status} error={error}
    canRetry={canAutosave && !conflict} editingSubmitted={editingSubmitted} onAnswerChange={updateAnswer}
    onRetry={retry} onSaveCorrection={saveCorrection} onCancelCorrection={cancelCorrection} onSubmit={submit} />;
}

function SubmittedNotesView({ questions, answers, canEdit, onEdit }: {
  questions: NotesEditorProps["questions"];
  answers: Record<number, string>;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return <>
    {questions.map((question) => <div key={question.questionId}>
      <h3 className="text-sm font-semibold text-text-secondary">{question.text}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{answers[question.questionId] || "Not submitted"}</p>
    </div>)}
    {canEdit && <Button type="button" variant="secondary" onClick={onEdit}>Edit Notes</Button>}
  </>;
}

function EditableNotesForm({ questions, answers, status, error, canRetry, editingSubmitted,
  onAnswerChange, onRetry, onSaveCorrection, onCancelCorrection, onSubmit }: {
  questions: NotesEditorProps["questions"];
  answers: Record<number, string>;
  status: NotesEditorStatus;
  error: string;
  canRetry: boolean;
  editingSubmitted: boolean;
  onAnswerChange: (questionId: number, answer: string) => void;
  onRetry: () => void;
  onSaveCorrection: () => Promise<void>;
  onCancelCorrection: () => void;
  onSubmit: () => Promise<void>;
}) {
  return <>
    {questions.map((question) => <label key={question.questionId}
      className="block space-y-1 text-sm font-semibold text-text-secondary">
      {question.text}
      <textarea aria-label={question.text} rows={4} value={answers[question.questionId] ?? ""}
        onChange={(event) => onAnswerChange(question.questionId, event.target.value)}
        className="w-full resize-y rounded-md border border-border bg-bg-card p-3 font-normal text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
    </label>)}
    <NotesEditorActions status={status} error={error} canRetry={canRetry} editingSubmitted={editingSubmitted}
      onRetry={onRetry} onSaveCorrection={onSaveCorrection} onCancelCorrection={onCancelCorrection} onSubmit={onSubmit} />
  </>;
}

function NotesEditorActions({ status, error, canRetry, editingSubmitted, onRetry, onSaveCorrection,
  onCancelCorrection, onSubmit }: {
  status: NotesEditorStatus;
  error: string;
  canRetry: boolean;
  editingSubmitted: boolean;
  onRetry: () => void;
  onSaveCorrection: () => Promise<void>;
  onCancelCorrection: () => void;
  onSubmit: () => Promise<void>;
}) {
  return <div className="flex min-h-11 flex-wrap items-center gap-3" aria-live="polite">
    {status === "saving" && <span className="text-sm text-text-muted">Saving</span>}
    {status === "saved" && <span className="text-sm font-medium text-success">Saved</span>}
    {status === "failed" && <>
      <span className="text-sm text-danger">{error}</span>
      {canRetry && <Button type="button" variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
    </>}
    {editingSubmitted
      ? <><Button type="button" onClick={() => void onSaveCorrection()} disabled={status === "saving"}>Save Changes</Button>
          <Button type="button" variant="ghost" onClick={onCancelCorrection}>Cancel</Button></>
      : <Button type="button" onClick={() => void onSubmit()} disabled={status === "saving"}>Submit Notes</Button>}
  </div>;
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
  return (
    <div className="space-y-6">
      <StudentIdentity student={detail.student} readOnly={detail.readOnly} />
      <PhaseNavigation studentId={detail.student.id} phases={detail.phases}
        selectedPhaseId={detail.selectedPhase.phaseId} schoolCode={schoolCode} academicYear={academicYear} />
      <SelectedPhaseContent phase={selectedOpenPhase(detail)} studentId={detail.student.id}
        readOnly={detail.readOnly} schoolCode={schoolCode} academicYear={academicYear} />
    </div>
  );
}

function StudentIdentity({ student, readOnly }: {
  student: HolisticStudentPhaseDetail["student"];
  readOnly: boolean;
}) {
  return <header className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h1 className="text-2xl font-bold text-text-primary">{student.name}</h1>
      <p className="text-sm text-text-muted">
        Grade {student.grade}{student.externalStudentId ? ` · ${student.externalStudentId}` : ""}
      </p>
    </div>
    {readOnly && <span className="text-sm font-medium text-text-muted">Read-only</span>}
  </header>;
}

function studentPhaseHref(studentId: number, phaseId: number, schoolCode: string, academicYear: string) {
  const query = new URLSearchParams({ school_code: schoolCode, academic_year: academicYear });
  return `/holistic-mentorship/students/${studentId}/phases/${phaseId}?${query}`;
}

function PhaseNavigation({ studentId, phases, selectedPhaseId, schoolCode, academicYear }: {
  studentId: number;
  phases: HolisticStudentPhaseDetail["phases"];
  selectedPhaseId: number | null;
  schoolCode: string;
  academicYear: string;
}) {
  return <nav aria-label="Holistic Phases" className="flex gap-2 overflow-x-auto pb-2">
    {phases.map((phase) => <PhaseNavigationLink key={`${phase.number}-${phase.title}`} phase={phase}
      current={phase.phaseId === selectedPhaseId} studentId={studentId} schoolCode={schoolCode} academicYear={academicYear} />)}
  </nav>;
}

function PhaseNavigationLink({ phase, current, studentId, schoolCode, academicYear }: {
  phase: PhaseNavigationItem;
  current: boolean;
  studentId: number;
  schoolCode: string;
  academicYear: string;
}) {
  if (phase.phaseId === null || ("locked" in phase && phase.locked)) {
    return <button type="button" disabled
      className="min-h-11 shrink-0 rounded-md border border-border bg-bg-card-alt px-3 text-left text-sm text-text-muted opacity-60">
      <span className="block font-semibold">Phase {phase.number}</span>
      <span className="block max-w-40 truncate text-xs">{phase.title}</span>
    </button>;
  }
  const className = current
    ? "border-accent bg-accent text-text-on-accent"
    : "border-border bg-bg-card text-text-secondary hover:bg-hover-bg";
  return <Link href={studentPhaseHref(studentId, phase.phaseId, schoolCode, academicYear)}
    aria-label={`Phase ${phase.number} - ${phase.title}`}
    className={`min-h-11 shrink-0 rounded-md border px-3 py-2 text-sm ${className}`}>
    <span className="block font-semibold">Phase {phase.number}</span>
    <span className="block max-w-40 truncate text-xs">{phase.title}</span>
  </Link>;
}

function SelectedPhaseContent({ phase, studentId, readOnly, schoolCode, academicYear }: {
  phase: OpenSelectedPhase | null;
  studentId: number;
  readOnly: boolean;
  schoolCode: string;
  academicYear: string;
}) {
  if (!phase) {
    return <p className="border-y border-border py-10 text-center text-sm text-text-muted">This Phase is locked.</p>;
  }
  return <>
    <PhaseHeading phase={phase} />
    <div className="grid gap-8 lg:grid-cols-2">
      <StudentContext context={phase.context} />
      <section aria-labelledby="guidance-heading" className="space-y-4 border-t border-border pt-4">
        <h2 id="guidance-heading" className="text-lg font-semibold text-text-primary">Phase Guidance</h2>
        <GuidancePreview markdown={phase.guidanceMarkdown} />
      </section>
    </div>
    <PostSessionNotes phase={phase} studentId={studentId} readOnly={readOnly}
      schoolCode={schoolCode} academicYear={academicYear} />
  </>;
}

function PhaseHeading({ phase }: { phase: OpenSelectedPhase }) {
  const progress = phase.progress[0].toUpperCase() + phase.progress.slice(1);
  return <section aria-labelledby="phase-heading" className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <h2 id="phase-heading" className="text-xl font-semibold text-text-primary">Phase {phase.number}: {phase.title}</h2>
      {phase.active && <span className="rounded bg-success/10 px-2 py-1 text-xs font-semibold text-success">Active</span>}
      <span className="rounded bg-bg-card-alt px-2 py-1 text-xs font-semibold text-text-secondary">{progress}</span>
      {phase.draftSaved && <span className="text-xs font-medium text-text-muted">Draft saved</span>}
    </div>
  </section>;
}

function StudentContext({ context }: { context: OpenSelectedPhase["context"] }) {
  return <section aria-labelledby="context-heading" className="space-y-4 border-t border-border pt-4">
    <div>
      <h2 id="context-heading" className="text-lg font-semibold text-text-primary">Student Context</h2>
      {context.label && <p className="text-sm font-medium text-accent">{context.label}</p>}
      {"lastUpdatedAt" in context && context.lastUpdatedAt &&
        <p className="text-xs text-text-muted">Last updated {formatDate(context.lastUpdatedAt)}</p>}
    </div>
    <StudentContextBody context={context} />
  </section>;
}

function StudentContextBody({ context }: { context: OpenSelectedPhase["context"] }) {
  if ("missing" in context) return <p className="text-sm text-text-muted">{context.missing}</p>;
  return <dl className="space-y-4">
    {context.items.map((item, index) => <div key={`${item.label}-${index}`}>
      <dt className="text-sm font-semibold text-text-secondary">{item.label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-primary">{item.content}</dd>
    </div>)}
  </dl>;
}

function PostSessionNotes({ phase, studentId, readOnly, schoolCode, academicYear }: {
  phase: OpenSelectedPhase;
  studentId: number;
  readOnly: boolean;
  schoolCode: string;
  academicYear: string;
}) {
  return <section aria-labelledby="notes-heading" className="space-y-4 border-t border-border pt-4">
    <h2 id="notes-heading" className="text-lg font-semibold text-text-primary">Post-Session Notes</h2>
    {phase.notes && <NotesTimestamp notes={phase.notes} />}
    <PostSessionNotesEditor studentId={studentId} phaseId={phase.phaseId} phaseRevision={phase.revision}
      mappingId={phase.mappingId} notesRevision={phase.notesRevision} schoolCode={schoolCode}
      academicYear={academicYear} editable={!readOnly && phase.canEditNotes}
      questions={phase.questions} notes={phase.notes} />
  </section>;
}

function NotesTimestamp({ notes }: { notes: NonNullable<OpenSelectedPhase["notes"]> }) {
  const submitted = notes.firstSubmittedAt ? `Submitted ${formatDate(notes.firstSubmittedAt)}` : "Draft saved";
  return <p className="text-xs text-text-muted">{submitted}{` · Last edited ${formatDate(notes.lastEditedAt)}`}</p>;
}
