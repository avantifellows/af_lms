"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { HolisticStudentPhaseDetail } from "@/lib/holistic-student-phase";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
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
    authorName?: string | null;
    answers?: Array<{ questionId: number; answer: string }>;
  };
  onNotesSaved: (submitted: boolean) => void;
};
type NotesEditorStatus = "idle" | "saving" | "saved" | "failed";
type OpenSelectedPhase = Extract<HolisticStudentPhaseDetail["selectedPhase"], { guidanceMarkdown: string }>;
type PhaseNavigationItem = HolisticStudentPhaseDetail["phases"][number];
type BrowserNavigation = EventTarget & {
  traverseTo: (key: string) => { committed: Promise<unknown> };
};
type BrowserNavigateEvent = Event & {
  navigationType: string;
  destination: { key: string };
};
type NotesSnapshot = Pick<NotesEditorProps, "notes" | "notesRevision">;
type NotesRouter = ReturnType<typeof useRouter>;
type BeforeNotesNavigation = () => boolean | Promise<boolean>;
const NOTES_REFRESH_URLS = "holistic-notes-refresh-urls";
const SUBMIT_BLANK_ANSWER_ERROR = "Answer every Question before submitting";
const SAVE_BLANK_ANSWER_ERROR = "Answer every Question before saving";

function browserNavigation() {
  return (window as typeof window & { navigation?: BrowserNavigation }).navigation ?? null;
}

function notesRefreshUrls() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(NOTES_REFRESH_URLS) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function markCurrentNotesForRefresh() {
  try {
    const urls = new Set(notesRefreshUrls());
    urls.add(window.location.href);
    window.sessionStorage.setItem(NOTES_REFRESH_URLS, JSON.stringify([...urls]));
  } catch {
    // The navigation guard still protects the write when session storage is unavailable.
  }
}

function notesRefreshPending() {
  return notesRefreshUrls().includes(window.location.href);
}

function clearCurrentNotesRefresh() {
  try {
    const urls = notesRefreshUrls().filter((url) => url !== window.location.href);
    if (urls.length) window.sessionStorage.setItem(NOTES_REFRESH_URLS, JSON.stringify(urls));
    else window.sessionStorage.removeItem(NOTES_REFRESH_URLS);
  } catch {
    // Nothing else needs cleanup when session storage is unavailable.
  }
}

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

function canEditSubmittedNotes(editable: boolean, notesState: "draft" | "submitted") {
  return editable && notesState === "submitted";
}

function enabledUnlessDisabled(enabled: boolean, disabled: boolean) {
  return enabled && !disabled;
}

function initialNotesRevision(props: NotesEditorProps) {
  return props.notes ? props.notes.revision : props.notesRevision;
}

function hasLocalNotesWork(answersChanged: boolean, status: NotesEditorStatus) {
  return answersChanged || ["saving", "failed"].includes(status);
}

function needsDraftNavigationGuard({ finalWriting, canAutosave, answersChanged, status }: {
  finalWriting: boolean;
  canAutosave: boolean;
  answersChanged: boolean;
  status: NotesEditorStatus;
}) {
  if (finalWriting) return true;
  if (!canAutosave) return false;
  return hasLocalNotesWork(answersChanged, status);
}

function shouldShowNotesInputs(canAutosave: boolean, editingSubmitted: boolean) {
  return canAutosave || editingSubmitted;
}

function hasBlankAnswer(questions: NotesEditorProps["questions"], answers: Record<number, string>) {
  return questions.some(({ questionId }) => !answers[questionId]?.trim());
}

function firstBlankQuestion(questions: NotesEditorProps["questions"], answers: Record<number, string>) {
  return questions.find(({ questionId }) => !answers[questionId]?.trim())?.questionId ?? null;
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

function notesApiUrl(props: NotesEditorProps) {
  return `/api/holistic-mentorship/students/${props.studentId}/phases/${props.phaseId}?${new URLSearchParams({
    school_code: props.schoolCode,
    academic_year: props.academicYear,
  })}`;
}

function useNotesMutation(props: NotesEditorProps, revisionRef: React.MutableRefObject<number>) {
  const apiUrl = notesApiUrl(props);
  return useCallback(async (
    action: "draft" | "submit" | "edit",
    value: Record<number, string>,
    confirmed = false
  ) => {
    const response = await fetch(apiUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        expected_revision: revisionRef.current,
        expected_mapping_id: props.mappingId,
        expected_phase_revision: props.phaseRevision,
        confirmed,
        answers: props.questions.map(({ questionId }) => ({
          question_id: questionId,
          answer: value[questionId] ?? "",
        })),
      }),
    });
    const result = await response.json().catch(() => ({})) as { revision?: number; error?: string };
    if (!response.ok) throw new NotesRequestError(result.error || "Could not save Notes", response.status);
    revisionRef.current = result.revision ?? revisionRef.current;
  }, [apiUrl, props.mappingId, props.phaseRevision, props.questions, revisionRef]);
}

function snapshotAnswers(questions: NotesEditorProps["questions"], snapshot: NotesSnapshot) {
  return Object.fromEntries(questions.map(({ questionId }) => [
    questionId,
    snapshot.notes?.answers?.find((answer) => answer.questionId === questionId)?.answer ?? "",
  ]));
}

function snapshotEditorState(snapshot: NotesSnapshot) {
  if (!snapshot.notes) return { notesState: "draft" as const, status: "idle" as const };
  return {
    notesState: snapshot.notes.state,
    status: snapshot.notes.state === "draft" ? "saved" as const : "idle" as const,
  };
}

function shouldHydrateNotes({ serverRevision, acceptedRevision, authoritative, busy }: {
  serverRevision: number;
  acceptedRevision: number;
  authoritative: boolean;
  busy: boolean;
}) {
  if (serverRevision < acceptedRevision) return false;
  if (!authoritative && serverRevision === acceptedRevision) return null;
  return !busy;
}

function clickedNavigationAnchor(event: MouseEvent) {
  const modified = [event.metaKey, event.ctrlKey, event.shiftKey, event.altKey].some(Boolean);
  if (event.defaultPrevented || event.button !== 0 || modified) return null;
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a") ?? null;
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return null;
  return anchor;
}

function followNavigationAnchor(anchor: HTMLAnchorElement, router: NotesRouter) {
  const target = new URL(anchor.href, window.location.href);
  if (target.origin === window.location.origin && !target.pathname.startsWith("/api/")) {
    router.push(`${target.pathname}${target.search}${target.hash}`);
    return;
  }
  window.location.assign(target.href);
}

function useNotesNavigationGuard({ beforeNavigation, guardNeeded, draftEditor, router }: {
  beforeNavigation: BeforeNotesNavigation;
  guardNeeded: boolean;
  draftEditor: boolean;
  router: NotesRouter;
}) {
  const historyGuardInFlight = useRef(false);
  const replayingHistory = useRef(false);
  const guardNeededRef = useRef(guardNeeded);
  const beforeNavigationRef = useRef(beforeNavigation);
  const draftEditorRef = useRef(draftEditor);

  useEffect(() => {
    guardNeededRef.current = guardNeeded;
    beforeNavigationRef.current = beforeNavigation;
    draftEditorRef.current = draftEditor;
  }, [beforeNavigation, draftEditor, guardNeeded]);

  useEffect(() => {
    const navigation = browserNavigation();
    if (!navigation) return;
    const handleHistoryNavigation = (rawEvent: Event) => {
      const event = rawEvent as BrowserNavigateEvent;
      const cannotGuard = [replayingHistory.current, !guardNeededRef.current,
        !event.cancelable, !event.destination.key].some(Boolean);
      if (event.navigationType !== "traverse" || cannotGuard) return;
      event.preventDefault();
      if (historyGuardInFlight.current) return;
      historyGuardInFlight.current = true;
      const finishGuard = (allowed: boolean) => {
        if (!allowed) {
          historyGuardInFlight.current = false;
          return;
        }
        if (draftEditorRef.current) markCurrentNotesForRefresh();
        replayingHistory.current = true;
        window.setTimeout(() => {
          try {
            void navigation.traverseTo(event.destination.key).committed.then(() => {
              router.refresh();
            }).catch(() => undefined).finally(() => {
              replayingHistory.current = false;
              historyGuardInFlight.current = false;
            });
          } catch {
            replayingHistory.current = false;
            historyGuardInFlight.current = false;
          }
        }, 0);
      };
      const decision = beforeNavigationRef.current();
      if (typeof decision === "boolean") finishGuard(decision);
      else void decision.then(finishGuard).catch(() => finishGuard(false));
    };
    navigation.addEventListener("navigate", handleHistoryNavigation);
    return () => navigation.removeEventListener("navigate", handleHistoryNavigation);
  }, [router]);

  useEffect(() => {
    if (!guardNeeded) return;
    const handleClick = (event: MouseEvent) => {
      const anchor = clickedNavigationAnchor(event);
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      void Promise.resolve(beforeNavigation()).then((allowed) => {
        if (!allowed) return;
        if (draftEditorRef.current) markCurrentNotesForRefresh();
        followNavigationAnchor(anchor, router);
      });
    };
    const handleUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", handleClick, true);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [beforeNavigation, guardNeeded, router]);
}

function PostSessionNotesEditor(props: NotesEditorProps) {
  const router = useRouter();
  const initialAnswers = initialNotesAnswers(props);
  const initialEditor = initialEditorState(props);
  const [answers, setAnswers] = useState<Record<number, string>>(initialAnswers);
  const [savedAnswers, setSavedAnswers] = useState<Record<number, string>>(initialAnswers);
  const [notesState, setNotesState] = useState(initialEditor.notesState);
  const [editingSubmitted, setEditingSubmitted] = useState(false);
  const [status, setStatus] = useState<NotesEditorStatus>(initialEditor.status);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);
  const [finalWriting, setFinalWriting] = useState(false);
  const saved = useRef(JSON.stringify(initialAnswers));
  const queued = useRef<Record<number, string> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const textareas = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const hydratedServerRevision = useRef(initialNotesRevision(props));
  const mutationRevision = useRef(initialEditor.revision);
  const validationErrorId = useId();
  const mutate = useNotesMutation(props, mutationRevision);
  const apiUrl = notesApiUrl(props);
  const canAutosave = canAutosaveNotes(props.editable, notesState);
  const autosaveEnabled = enabledUnlessDisabled(canAutosave, finalWriting);
  const answersChanged = JSON.stringify(answers) !== JSON.stringify(savedAnswers);
  const localDirty = hasLocalNotesWork(answersChanged, status);
  const localDirtyRef = useRef(localDirty);
  const finalWritingRef = useRef(finalWriting);
  localDirtyRef.current = localDirty;
  finalWritingRef.current = finalWriting;

  const hydrateServerNotes = useCallback((snapshot: NotesSnapshot, authoritative = false) => {
    const serverRevision = snapshot.notes?.revision ?? snapshot.notesRevision;
    const acceptedRevision = Math.max(hydratedServerRevision.current, mutationRevision.current);
    const decision = shouldHydrateNotes({
      serverRevision,
      acceptedRevision,
      authoritative,
      busy: localDirtyRef.current || finalWritingRef.current,
    });
    if (decision !== true) return decision === null;
    const nextAnswers = snapshotAnswers(props.questions, snapshot);
    const nextEditor = snapshotEditorState(snapshot);
    hydratedServerRevision.current = serverRevision;
    mutationRevision.current = serverRevision;
    saved.current = JSON.stringify(nextAnswers);
    queued.current = null;
    setAnswers(nextAnswers);
    setSavedAnswers(nextAnswers);
    setNotesState(nextEditor.notesState);
    setStatus(nextEditor.status);
    setEditingSubmitted(false);
    setError("");
    setValidationError("");
    setConflict(false);
    return true;
  }, [props.questions]);
  const hydrateServerNotesRef = useRef(hydrateServerNotes);
  hydrateServerNotesRef.current = hydrateServerNotes;

  useEffect(() => {
    hydrateServerNotes({ notes: props.notes, notesRevision: props.notesRevision });
  }, [finalWriting, hydrateServerNotes, localDirty, props.notes, props.notesRevision]);

  useEffect(() => {
    if (!notesRefreshPending()) return;
    const controller = new AbortController();
    void fetch(apiUrl, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (response.ok) return response.json();
        if ([401, 403, 404].includes(response.status)) {
          clearCurrentNotesRefresh();
          window.location.reload();
        }
        return null;
      })
      .then((detail: HolisticStudentPhaseDetail | null) => {
        if (!detail || controller.signal.aborted) return;
        const selected = selectedOpenPhase(detail);
        if (!selected || selected.phaseId !== props.phaseId) return;
        if (hydrateServerNotesRef.current({ notes: selected.notes, notesRevision: selected.notesRevision }, true)) {
          if (selected.notes?.state === "draft") markCurrentNotesForRefresh();
          else clearCurrentNotesRefresh();
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, props.phaseId]);

  useEffect(() => {
    if (notesState === "draft" && status === "saved") markCurrentNotesForRefresh();
    if (notesState === "submitted") clearCurrentNotesRefresh();
  }, [notesState, status]);

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
          markCurrentNotesForRefresh();
          saved.current = JSON.stringify(value);
          setSavedAnswers(value);
        } catch (caught) {
          setStatus("failed");
          setError(caught instanceof NotesRequestError ? caught.message : "Could not save Notes");
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

  const cancelAutosaveTimer = useCallback(() => {
    if (autosaveTimer.current === null) return;
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
  }, []);

  const flushDraft = useCallback(async () => {
    cancelAutosaveTimer();
    if (!canAutosave) return true;
    if (JSON.stringify(answers) !== saved.current || status === "failed") queued.current = answers;
    while (queued.current || inFlight.current) {
      if (!(await pump())) return false;
    }
    return true;
  }, [answers, canAutosave, cancelAutosaveTimer, pump, status]);

  useEffect(() => {
    if (!autosaveEnabled || JSON.stringify(answers) === saved.current) return;
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      queued.current = answers;
      void pump();
    }, 750);
    return cancelAutosaveTimer;
  }, [answers, autosaveEnabled, cancelAutosaveTimer, pump]);

  const submittedEditDirty = editingSubmitted && answersChanged;
  const draftNeedsGuard = needsDraftNavigationGuard({
    finalWriting,
    canAutosave,
    answersChanged,
    status,
  });
  const discardSubmittedChanges = useCallback(() => {
    if (!window.confirm("Discard unsaved Notes changes?")) return false;
    setAnswers(savedAnswers);
    setEditingSubmitted(false);
    setStatus("idle");
    setError("");
    setValidationError("");
    setSuccess("");
    setConflict(false);
    return true;
  }, [savedAnswers]);
  const beforeNavigation = useCallback((): boolean | Promise<boolean> => {
    if (finalWriting) return false;
    if (submittedEditDirty) return discardSubmittedChanges();
    return draftNeedsGuard ? flushDraft() : true;
  }, [discardSubmittedChanges, draftNeedsGuard, finalWriting, flushDraft, submittedEditDirty]);

  const guardNeeded = [submittedEditDirty, draftNeedsGuard].some(Boolean);
  useNotesNavigationGuard({ beforeNavigation, guardNeeded, draftEditor: canAutosave, router });

  const retry = () => {
    void flushDraft();
  };
  const focusFirstBlank = () => {
    const questionId = firstBlankQuestion(props.questions, answers);
    if (questionId !== null) textareas.current[questionId]?.focus();
  };
  const submit = async () => {
    if (hasBlankAnswer(props.questions, answers)) {
      setValidationError(SUBMIT_BLANK_ANSWER_ERROR);
      focusFirstBlank();
      return;
    }
    setValidationError("");
    setFinalWriting(true);
    if (!(await flushDraft()) || !window.confirm("Submit these Post-Session Notes?")) {
      setFinalWriting(false);
      return;
    }
    setStatus("saving");
    setSuccess("");
    try {
      await mutate("submit", answers, true);
      saved.current = JSON.stringify(answers);
      setSavedAnswers(answers);
      setNotesState("submitted");
      setStatus("saved");
      setSuccess("Notes submitted. Phase completed.");
      props.onNotesSaved(true);
      router.refresh();
    } catch (caught) {
      setStatus("failed");
      setError(caught instanceof NotesRequestError ? caught.message : "Could not submit Notes");
      setConflict(caught instanceof NotesRequestError && caught.status === 409);
    } finally {
      setFinalWriting(false);
    }
  };
  const saveCorrection = async () => {
    if (hasBlankAnswer(props.questions, answers)) {
      setValidationError(SAVE_BLANK_ANSWER_ERROR);
      focusFirstBlank();
      return;
    }
    setValidationError("");
    setFinalWriting(true);
    if (!window.confirm("Save changes to submitted Notes?")) {
      setFinalWriting(false);
      return;
    }
    setStatus("saving");
    setSuccess("");
    try {
      await mutate("edit", answers, true);
      saved.current = JSON.stringify(answers);
      setSavedAnswers(answers);
      setEditingSubmitted(false);
      setStatus("saved");
      setSuccess("Submitted Notes updated.");
      props.onNotesSaved(false);
      router.refresh();
    } catch (caught) {
      setStatus("failed");
      setError(caught instanceof NotesRequestError ? caught.message : "Could not save Notes");
    } finally {
      setFinalWriting(false);
    }
  };

  const beginCorrection = () => {
    setEditingSubmitted(true);
    setStatus("idle");
    setValidationError("");
    setSuccess("");
  };
  const cancelCorrection = () => {
    if (JSON.stringify(answers) !== JSON.stringify(savedAnswers)) {
      void discardSubmittedChanges();
      return;
    }
    setEditingSubmitted(false);
    setStatus("idle");
  };
  const updateAnswer = (questionId: number, answer: string) => {
    const nextAnswers = { ...answers, [questionId]: answer };
    setAnswers(nextAnswers);
    setError("");
    if (validationError && !hasBlankAnswer(props.questions, nextAnswers)) setValidationError("");
    setSuccess("");
  };

  return <NotesEditorContent showInputs={shouldShowNotesInputs(canAutosave, editingSubmitted)}
    questions={props.questions} answers={answers} status={status} error={error}
    validationError={validationError} validationErrorId={validationErrorId} success={success}
    canEdit={canEditSubmittedNotes(props.editable, notesState)}
    canRetry={enabledUnlessDisabled(autosaveEnabled, conflict)}
    editingSubmitted={editingSubmitted} disabled={finalWriting} onEdit={beginCorrection}
    onAnswerChange={updateAnswer}
    onTextarea={(questionId, element) => { textareas.current[questionId] = element; }}
    onRetry={retry} onSaveCorrection={saveCorrection} onCancelCorrection={cancelCorrection} onSubmit={submit} />;
}

function NotesEditorContent({ showInputs, questions, answers, status, error, validationError,
  validationErrorId, success, canEdit,
  canRetry, editingSubmitted, disabled, onEdit, onAnswerChange, onTextarea, onRetry,
  onSaveCorrection, onCancelCorrection, onSubmit }: {
  showInputs: boolean;
  questions: NotesEditorProps["questions"];
  answers: Record<number, string>;
  status: NotesEditorStatus;
  error: string;
  validationError: string;
  validationErrorId: string;
  success: string;
  canEdit: boolean;
  canRetry: boolean;
  editingSubmitted: boolean;
  disabled: boolean;
  onEdit: () => void;
  onAnswerChange: (questionId: number, answer: string) => void;
  onTextarea: (questionId: number, element: HTMLTextAreaElement | null) => void;
  onRetry: () => void;
  onSaveCorrection: () => Promise<void>;
  onCancelCorrection: () => void;
  onSubmit: () => Promise<void>;
}) {
  if (showInputs) {
    return <EditableNotesForm questions={questions} answers={answers} status={status} error={error}
      validationError={validationError} validationErrorId={validationErrorId}
      canRetry={canRetry} editingSubmitted={editingSubmitted} disabled={disabled}
      onAnswerChange={onAnswerChange} onTextarea={onTextarea} onRetry={onRetry}
      onSaveCorrection={onSaveCorrection} onCancelCorrection={onCancelCorrection} onSubmit={onSubmit} />;
  }
  return <><SubmittedNotesView questions={questions} answers={answers} canEdit={canEdit} onEdit={onEdit} />
    {success && <p role="status" className="text-sm font-medium text-success">{success}</p>}</>;
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

function EditableNotesForm({ questions, answers, status, error, validationError, validationErrorId,
  canRetry, editingSubmitted,
  disabled, onAnswerChange, onTextarea, onRetry, onSaveCorrection, onCancelCorrection, onSubmit }: {
  questions: NotesEditorProps["questions"];
  answers: Record<number, string>;
  status: NotesEditorStatus;
  error: string;
  validationError: string;
  validationErrorId: string;
  canRetry: boolean;
  editingSubmitted: boolean;
  disabled: boolean;
  onAnswerChange: (questionId: number, answer: string) => void;
  onTextarea: (questionId: number, element: HTMLTextAreaElement | null) => void;
  onRetry: () => void;
  onSaveCorrection: () => Promise<void>;
  onCancelCorrection: () => void;
  onSubmit: () => Promise<void>;
}) {
  return <>
    {questions.map((question) => {
      const invalid = Boolean(validationError && !answers[question.questionId]?.trim());
      return <label key={question.questionId} className="block space-y-1 text-sm font-semibold text-text-secondary">
        {question.text}
        <textarea ref={(element) => onTextarea(question.questionId, element)} aria-label={question.text}
        aria-invalid={invalid} aria-describedby={invalid ? validationErrorId : undefined} rows={4}
        disabled={disabled}
        value={answers[question.questionId] ?? ""}
        onChange={(event) => onAnswerChange(question.questionId, event.target.value)}
        className="w-full resize-y rounded-md border border-border bg-bg-card p-3 font-normal text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
      </label>;
    })}
    <NotesEditorActions status={status} error={error} validationError={validationError}
      validationErrorId={validationErrorId} canRetry={canRetry} editingSubmitted={editingSubmitted}
      disabled={disabled}
      onRetry={onRetry} onSaveCorrection={onSaveCorrection} onCancelCorrection={onCancelCorrection} onSubmit={onSubmit} />
  </>;
}

function NotesEditorActions({ status, error, validationError, validationErrorId, canRetry,
  editingSubmitted, onRetry, onSaveCorrection,
  disabled, onCancelCorrection, onSubmit }: {
  status: NotesEditorStatus;
  error: string;
  validationError: string;
  validationErrorId: string;
  canRetry: boolean;
  editingSubmitted: boolean;
  disabled: boolean;
  onRetry: () => void;
  onSaveCorrection: () => Promise<void>;
  onCancelCorrection: () => void;
  onSubmit: () => Promise<void>;
}) {
  return <div className="flex min-h-11 flex-wrap items-center gap-3" aria-live="polite">
    {validationError && <span id={validationErrorId} role="alert" className="text-sm text-danger">
      {validationError}
    </span>}
    {status === "saving" && <span className="text-sm text-text-muted">Saving</span>}
    {status === "saved" && <span className="text-sm font-medium text-success">Saved</span>}
    {status === "failed" && <>
      <span className="text-sm text-danger">{error}</span>
      {canRetry && <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={onRetry}>Retry</Button>}
    </>}
    {editingSubmitted
      ? <><Button type="button" onClick={() => void onSaveCorrection()} disabled={disabled || status === "saving"}>Save Changes</Button>
          <Button type="button" variant="ghost" disabled={disabled} onClick={onCancelCorrection}>Cancel</Button></>
      : <Button type="button" onClick={() => void onSubmit()} disabled={disabled || status === "saving"}>Submit Notes</Button>}
  </div>;
}

type PhaseStage = "Completed" | "Open" | "Skipped" | "Locked";

function phaseStage(phase: PhaseNavigationItem): PhaseStage {
  if (phase.phaseId === null || ("locked" in phase && phase.locked)) return "Locked";
  if (phase.progress === "completed") return "Completed";
  return phase.progress === "skipped" ? "Skipped" : "Open";
}

function PhaseStatusBadge({ stage }: { stage: PhaseStage }) {
  const variant: Record<PhaseStage, BadgeVariant> = {
    Completed: "success",
    Open: "info",
    Skipped: "warning",
    Locked: "default",
  };
  return <Badge variant={variant[stage]} className="mt-1 gap-1 px-2 py-0.5">
    {stage === "Locked" && <Lock aria-hidden="true" className="h-3 w-3" />}
    {stage}
  </Badge>;
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
  const [completedPhaseIds, setCompletedPhaseIds] = useState<Set<number>>(() => new Set());
  const phases = detail.phases.map((phase) =>
    phase.phaseId !== null && "locked" in phase && !phase.locked && completedPhaseIds.has(phase.phaseId)
      ? { ...phase, progress: "completed" as const, draftSaved: false }
      : phase
  );
  const selected = selectedOpenPhase(detail);
  const visibleSelected = selected && completedPhaseIds.has(selected.phaseId)
    ? { ...selected, progress: "completed" as const, draftSaved: false }
    : selected;
  return (
    <div className="space-y-6">
      <StudentIdentity student={detail.student} readOnly={detail.readOnly} />
      <PhaseNavigation studentId={detail.student.id} phases={phases}
        selectedPhaseId={detail.selectedPhase.phaseId} schoolCode={schoolCode} academicYear={academicYear} />
      <InactivePhasePanels studentId={detail.student.id} phases={phases}
        selectedPhaseId={detail.selectedPhase.phaseId} />
      <SelectedPhaseContent phase={visibleSelected} studentId={detail.student.id}
        selectedPhase={detail.selectedPhase}
        readOnly={detail.readOnly} schoolCode={schoolCode} academicYear={academicYear}
        onSubmitted={(phaseId) => setCompletedPhaseIds((current) => new Set(current).add(phaseId))} />
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
    </div>
    {readOnly && <span className="text-sm font-medium text-text-muted">Read-only</span>}
  </header>;
}

function studentPhaseHref(studentId: number, phaseId: number, schoolCode: string, academicYear: string) {
  const query = new URLSearchParams({ school_code: schoolCode, academic_year: academicYear });
  return `/holistic-mentorship/students/${studentId}/phases/${phaseId}?${query}`;
}

function phaseTabId(studentId: number, phase: Pick<PhaseNavigationItem, "phaseId" | "number">) {
  return `holistic-phase-tab-${studentId}-${phase.phaseId ?? `placeholder-${phase.number}`}`;
}

function phasePanelId(studentId: number, phase: Pick<PhaseNavigationItem, "phaseId" | "number">) {
  return `holistic-phase-panel-${studentId}-${phase.phaseId ?? `placeholder-${phase.number}`}`;
}

function InactivePhasePanels({ studentId, phases, selectedPhaseId }: {
  studentId: number;
  phases: HolisticStudentPhaseDetail["phases"];
  selectedPhaseId: number | null;
}) {
  return <>{phases.filter((phase) =>
    phase.phaseId !== null && "locked" in phase && !phase.locked && phase.phaseId !== selectedPhaseId
  ).map((phase) => <div key={phase.phaseId} id={phasePanelId(studentId, phase)} role="tabpanel"
    aria-labelledby={phaseTabId(studentId, phase)} hidden />)}</>;
}

function PhaseNavigation({ studentId, phases, selectedPhaseId, schoolCode, academicYear }: {
  studentId: number;
  phases: HolisticStudentPhaseDetail["phases"];
  selectedPhaseId: number | null;
  schoolCode: string;
  academicYear: string;
}) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!new Set(["ArrowLeft", "ArrowRight", "Home", "End"]).has(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="tab"]:not([aria-disabled="true"])'
    ));
    if (!tabs.length) return;
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    const start = current < 0 ? Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true")) : current;
    const next = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : event.key === "ArrowRight" ? (start + 1) % tabs.length
          : (start - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  };
  return <nav role="tablist" aria-label="Holistic Phases" onKeyDown={onKeyDown}
    className="flex gap-2 overflow-x-auto pb-2">
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
    return <button id={phaseTabId(studentId, phase)} type="button" role="tab"
      aria-disabled="true" aria-selected="false" tabIndex={-1} disabled
      className="min-h-11 shrink-0 rounded-md border border-border bg-bg-card-alt px-3 text-left text-sm text-text-muted opacity-60">
      <span className="block font-semibold">Phase {phase.number}</span>
      <span className="block max-w-40 truncate text-xs">{phase.title}</span>
      <PhaseStatusBadge stage="Locked" />
    </button>;
  }
  const className = current
    ? "border-accent bg-accent text-text-on-accent"
    : "border-border bg-bg-card text-text-secondary hover:bg-hover-bg";
  return <Link href={studentPhaseHref(studentId, phase.phaseId, schoolCode, academicYear)}
    id={phaseTabId(studentId, phase)} role="tab" aria-selected={current} tabIndex={current ? 0 : -1}
    aria-controls={phasePanelId(studentId, phase)}
    aria-label={`Phase ${phase.number} - ${phase.title} - ${phaseStage(phase)}`}
    className={`min-h-11 shrink-0 rounded-md border px-3 py-2 text-sm ${className}`}>
    <span className="block font-semibold">Phase {phase.number}</span>
    <span className="block max-w-40 truncate text-xs">{phase.title}</span>
    <PhaseStatusBadge stage={phaseStage(phase)} />
  </Link>;
}

function SelectedPhaseContent({ phase, selectedPhase, studentId, readOnly, schoolCode, academicYear, onSubmitted }: {
  phase: OpenSelectedPhase | null;
  selectedPhase: HolisticStudentPhaseDetail["selectedPhase"];
  studentId: number;
  readOnly: boolean;
  schoolCode: string;
  academicYear: string;
  onSubmitted: (phaseId: number) => void;
}) {
  const [mobilePanel, setMobilePanel] = useState<"context" | "guidance">("context");
  const tabId = phaseTabId(studentId, selectedPhase);
  const panelId = phasePanelId(studentId, selectedPhase);
  if (!phase) {
    return <p id={panelId} role="tabpanel" aria-labelledby={tabId} tabIndex={0}
      className="border-y border-border py-10 text-center text-sm text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      This Phase is locked.
    </p>;
  }
  return <section id={panelId} role="tabpanel" aria-labelledby={tabId} tabIndex={0}
    className="space-y-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
    <PhaseHeading phase={phase} />
    <div role="group" aria-label="Preparation panel" className="grid grid-cols-2 rounded-md border border-border lg:hidden">
      <button type="button" aria-pressed={mobilePanel === "context"}
        className={`min-h-11 px-3 text-sm font-semibold ${mobilePanel === "context" ? "bg-accent text-text-on-accent" : "bg-bg-card text-text-secondary"}`}
        onClick={() => setMobilePanel("context")}>Student Context</button>
      <button type="button" aria-pressed={mobilePanel === "guidance"}
        className={`min-h-11 px-3 text-sm font-semibold ${mobilePanel === "guidance" ? "bg-accent text-text-on-accent" : "bg-bg-card text-text-secondary"}`}
        onClick={() => setMobilePanel("guidance")}>Phase Guidance</button>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <div className={`${mobilePanel === "context" ? "block" : "hidden"} lg:block lg:h-[32rem] lg:overflow-y-auto lg:pr-3`}>
        <StudentContext context={phase.context} />
      </div>
      <div className={`${mobilePanel === "guidance" ? "block" : "hidden"} lg:block lg:h-[32rem] lg:overflow-y-auto lg:pr-3`}>
        <section aria-labelledby="guidance-heading" className="space-y-4 border-t border-border pt-4">
          <h2 id="guidance-heading" className="text-lg font-semibold text-text-primary">Phase Guidance</h2>
          <GuidancePreview markdown={phase.guidanceMarkdown} />
        </section>
      </div>
    </div>
    <PostSessionNotes key={`${phase.phaseId}-${phase.mappingId}-${phase.revision}`}
      phase={phase} studentId={studentId} readOnly={readOnly}
      schoolCode={schoolCode} academicYear={academicYear} onSubmitted={() => onSubmitted(phase.phaseId)} />
  </section>;
}

function PhaseHeading({ phase }: { phase: OpenSelectedPhase }) {
  return <section aria-labelledby="phase-heading" className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <h2 id="phase-heading" className="text-xl font-semibold text-text-primary">Phase {phase.number}: {phase.title}</h2>
      <PhaseStatusBadge stage={phase.progress === "completed" ? "Completed" : phase.progress === "skipped" ? "Skipped" : "Open"} />
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

function PostSessionNotes({ phase, studentId, readOnly, schoolCode, academicYear, onSubmitted }: {
  phase: OpenSelectedPhase;
  studentId: number;
  readOnly: boolean;
  schoolCode: string;
  academicYear: string;
  onSubmitted: () => void;
}) {
  const [visibleNotesOverride, setVisibleNotes] = useState<OpenSelectedPhase["notes"] | undefined>();
  const visibleNotes = visibleNotesOverride === undefined ? phase.notes : visibleNotesOverride;
  const apiUrl = `/api/holistic-mentorship/students/${studentId}/phases/${phase.phaseId}?${new URLSearchParams({
    school_code: schoolCode,
    academic_year: academicYear,
  })}`;

  const refreshNotesMetadata = useCallback((submitted: boolean) => {
    if (submitted) onSubmitted();
    void fetch(apiUrl, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((detail: HolisticStudentPhaseDetail | null) => {
        if (!detail) return;
        const selected = selectedOpenPhase(detail);
        if (selected?.phaseId === phase.phaseId) setVisibleNotes(selected.notes);
      })
      .catch(() => undefined);
  }, [apiUrl, onSubmitted, phase.phaseId]);

  return <section aria-labelledby="notes-heading" className="space-y-4 border-t border-border pt-4">
    <h2 id="notes-heading" className="text-lg font-semibold text-text-primary">Post-Session Notes</h2>
    {visibleNotes && <NotesTimestamp notes={visibleNotes} />}
    <PostSessionNotesEditor key={`${phase.phaseId}-${phase.mappingId}-${phase.revision}`}
      studentId={studentId} phaseId={phase.phaseId} phaseRevision={phase.revision}
      mappingId={phase.mappingId} notesRevision={phase.notesRevision} schoolCode={schoolCode}
      academicYear={academicYear} editable={!readOnly && phase.canEditNotes}
      questions={phase.questions} notes={phase.notes} onNotesSaved={refreshNotesMetadata} />
  </section>;
}

function NotesTimestamp({ notes }: { notes: NonNullable<OpenSelectedPhase["notes"]> }) {
  const submitted = notes.firstSubmittedAt
    ? `${notes.authorName ? `Submitted by ${notes.authorName} on ` : "Submitted "}${formatDate(notes.firstSubmittedAt)}`
    : "Draft saved";
  return <p className="text-xs text-text-muted">{submitted}{` · Last edited ${formatDate(notes.lastEditedAt)}`}</p>;
}
