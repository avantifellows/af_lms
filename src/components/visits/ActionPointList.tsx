"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import Toast from "@/components/Toast";
import { Modal } from "@/components/ui";
import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction";
import { CLASSROOM_OBSERVATION_RUBRIC } from "@/lib/classroom-observation-rubric";
import { GROUP_STUDENT_DISCUSSION_CONFIG } from "@/lib/group-student-discussion";
import { INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG } from "@/lib/individual-af-teacher-interaction";
import { PRINCIPAL_INTERACTION_CONFIG } from "@/lib/principal-interaction";
import { SCHOOL_STAFF_INTERACTION_CONFIG } from "@/lib/school-staff-interaction";
import { getAccurateLocation } from "@/lib/geolocation";
import {
  ACTION_STATUS_VALUES,
  getActionTypeLabel,
  isActionType,
  statusBadgeClass,
  type ActionStatus,
} from "@/lib/visit-actions";
import ActionTypePickerModal from "./ActionTypePickerModal";

export interface VisitActionListItem {
  id: number;
  action_type: string;
  status: string;
  data?: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  start_accuracy?: string | null;
  end_accuracy?: string | null;
  inserted_at: string;
  updated_at?: string;
}

interface ActionPointListProps {
  visitId: number;
  actions: VisitActionListItem[];
  readOnly?: boolean;
}

interface ApiErrorPayload {
  error?: unknown;
  details?: unknown;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallback;
}

function parseApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const { error, details } = payload as ApiErrorPayload;
  const errorMessage = typeof error === "string" ? error : fallback;
  if (Array.isArray(details) && details.length > 0) {
    const detailText = details
      .filter((detail): detail is string => typeof detail === "string")
      .join("; ");
    if (detailText) {
      return `${errorMessage}: ${detailText}`;
    }
  }

  return errorMessage;
}

function isLocationCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    error.message === "Location request was cancelled."
  );
}

function formatActionType(actionType: string): string {
  if (isActionType(actionType)) {
    return getActionTypeLabel(actionType);
  }

  return actionType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatActionStatus(status: string): string {
  if (!ACTION_STATUS_VALUES.includes(status as ActionStatus)) {
    return status;
  }

  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });
}

interface ClassroomObservationStats {
  teacherName: string | null;
  grade: string | null;
  answeredCount: number;
  totalParams: number;
  score: number;
  maxScore: number;
}

function getClassroomObservationStats(data: Record<string, unknown> | undefined): ClassroomObservationStats | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const teacherName = typeof data.teacher_name === "string" ? data.teacher_name : null;
  const grade = typeof data.grade === "string" ? data.grade : null;
  const params = data.params && typeof data.params === "object" && !Array.isArray(data.params)
    ? (data.params as Record<string, unknown>)
    : {};

  let answeredCount = 0;
  let score = 0;

  for (const parameter of CLASSROOM_OBSERVATION_RUBRIC.parameters) {
    const paramValue = params[parameter.key];
    if (paramValue && typeof paramValue === "object" && "score" in paramValue) {
      const paramScore = (paramValue as { score: unknown }).score;
      if (typeof paramScore === "number" && parameter.options.some((o) => o.score === paramScore)) {
        answeredCount += 1;
        score += paramScore;
      }
    }
  }

  return {
    teacherName,
    grade,
    answeredCount,
    totalParams: CLASSROOM_OBSERVATION_RUBRIC.parameters.length,
    score,
    maxScore: CLASSROOM_OBSERVATION_RUBRIC.maxScore,
  };
}

export interface AFTeamInteractionStats {
  teacherCount: number;
  answeredCount: number;
  totalQuestions: number;
}

export function getAFTeamInteractionStats(
  data: Record<string, unknown> | undefined
): AFTeamInteractionStats | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const teachers = data.teachers;
  const teacherCount = Array.isArray(teachers) ? teachers.length : 0;

  const questions = data.questions;
  let answeredCount = 0;
  if (questions && typeof questions === "object" && !Array.isArray(questions)) {
    const questionsRecord = questions as Record<string, unknown>;
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      const value = questionsRecord[key];
      if (value && typeof value === "object" && "answer" in value) {
        const answer = (value as { answer: unknown }).answer;
        if (typeof answer === "boolean") {
          answeredCount += 1;
        }
      }
    }
  }

  const totalQuestions = AF_TEAM_INTERACTION_CONFIG.allQuestionKeys.length;

  if (teacherCount === 0 && answeredCount === 0) {
    return null;
  }

  return { teacherCount, answeredCount, totalQuestions };
}

export interface IndividualTeacherInteractionStats {
  recordedCount: number;
  presentCount: number;
  onLeaveCount: number;
  absentCount: number;
}

export function getIndividualTeacherInteractionStats(
  data: Record<string, unknown> | undefined
): IndividualTeacherInteractionStats | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const teachers = data.teachers;
  if (!Array.isArray(teachers) || teachers.length === 0) {
    return null;
  }

  let presentCount = 0;
  let onLeaveCount = 0;
  let absentCount = 0;

  for (const entry of teachers) {
    if (!entry || typeof entry !== "object") continue;
    const attendance = (entry as Record<string, unknown>).attendance;
    if (attendance === "present") presentCount++;
    else if (attendance === "on_leave") onLeaveCount++;
    else if (attendance === "absent") absentCount++;
  }

  return {
    recordedCount: teachers.length,
    presentCount,
    onLeaveCount,
    absentCount,
  };
}

export interface PrincipalInteractionStats {
  answeredCount: number;
  totalQuestions: number;
}

export function getPrincipalInteractionStats(
  data: Record<string, unknown> | undefined
): PrincipalInteractionStats | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const questions = data.questions;
  let answeredCount = 0;
  if (questions && typeof questions === "object" && !Array.isArray(questions)) {
    const questionsRecord = questions as Record<string, unknown>;
    for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
      const value = questionsRecord[key];
      if (value && typeof value === "object" && "answer" in value) {
        const answer = (value as { answer: unknown }).answer;
        if (typeof answer === "boolean") {
          answeredCount += 1;
        }
      }
    }
  }

  const totalQuestions = PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys.length;

  if (answeredCount === 0) {
    return null;
  }

  return { answeredCount, totalQuestions };
}

export interface GroupStudentDiscussionStats {
  grade: number | null;
  answeredCount: number;
  totalQuestions: number;
}

export function getGroupStudentDiscussionStats(
  data: Record<string, unknown> | undefined
): GroupStudentDiscussionStats | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const grade = typeof data.grade === "number" ? data.grade : null;

  const questions = data.questions;
  let answeredCount = 0;
  if (questions && typeof questions === "object" && !Array.isArray(questions)) {
    const questionsRecord = questions as Record<string, unknown>;
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      const value = questionsRecord[key];
      if (value && typeof value === "object" && "answer" in value) {
        const answer = (value as { answer: unknown }).answer;
        if (typeof answer === "boolean") {
          answeredCount += 1;
        }
      }
    }
  }

  const totalQuestions = GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.length;

  if (grade === null && answeredCount === 0) {
    return null;
  }

  return { grade, answeredCount, totalQuestions };
}

export interface IndividualStudentDiscussionStats {
  studentCount: number;
}

export function getIndividualStudentDiscussionStats(
  data: Record<string, unknown> | undefined
): IndividualStudentDiscussionStats | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const students = data.students;
  if (!Array.isArray(students) || students.length === 0) {
    return null;
  }

  return { studentCount: students.length };
}

export interface SchoolStaffInteractionStats {
  answeredCount: number;
  totalQuestions: number;
}

export function getSchoolStaffInteractionStats(
  data: Record<string, unknown> | undefined
): SchoolStaffInteractionStats | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const questions = data.questions;
  let answeredCount = 0;
  if (questions && typeof questions === "object" && !Array.isArray(questions)) {
    const questionsRecord = questions as Record<string, unknown>;
    for (const key of SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys) {
      const value = questionsRecord[key];
      if (value && typeof value === "object" && "answer" in value) {
        const answer = (value as { answer: unknown }).answer;
        if (typeof answer === "boolean") {
          answeredCount += 1;
        }
      }
    }
  }

  const totalQuestions = SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys.length;

  if (answeredCount === 0) {
    return null;
  }

  return { answeredCount, totalQuestions };
}

export default function ActionPointList({
  visitId,
  actions,
  readOnly = false,
}: ActionPointListProps) {
  const router = useRouter();
  const [items, setItems] = useState<VisitActionListItem[]>(actions);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addState, setAddState] = useState<"idle" | "acquiring" | "creating" | "starting">("idle");
  const [deletingActionId, setDeletingActionId] = useState<number | null>(null);
  const [confirmDeleteActionId, setConfirmDeleteActionId] = useState<number | null>(null);
  const [startingActionId, setStartingActionId] = useState<number | null>(null);
  const [startState, setStartState] = useState<"idle" | "acquiring" | "submitting">("idle");
  const cancelStartRef = useRef<(() => void) | null>(null);
  const cancelAddRef = useRef<(() => void) | null>(null);

  const isBusy = useMemo(() => {
    return isAdding || deletingActionId !== null || startingActionId !== null;
  }, [deletingActionId, isAdding, startingActionId]);

  const dismissError = useCallback(() => setError(null), []);
  const dismissWarning = useCallback(() => setWarning(null), []);

  async function handleAddAction(actionType: string) {
    setError(null);
    setWarning(null);
    setIsAdding(true);
    setAddState("acquiring");

    let createdAction: VisitActionListItem | null = null;

    try {
      // Step 1: Acquire GPS
      const locationHandle = getAccurateLocation();
      cancelAddRef.current = locationHandle.cancel;
      const location = await locationHandle.promise;

      // Step 2: Create action
      setAddState("creating");
      const createResponse = await fetch(`/api/pm/visits/${visitId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: actionType }),
      });
      const createPayload: unknown = await createResponse.json();

      if (!createResponse.ok) {
        throw new Error(parseApiError(createPayload, "Failed to add action point"));
      }

      if (
        !createPayload ||
        typeof createPayload !== "object" ||
        !("action" in createPayload) ||
        typeof createPayload.action !== "object" ||
        createPayload.action === null
      ) {
        throw new Error("Failed to add action point");
      }

      createdAction = createPayload.action as VisitActionListItem;

      // Step 3: Start action with GPS
      setAddState("starting");
      const startResponse = await fetch(`/api/pm/visits/${visitId}/actions/${createdAction.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: location.lat,
          start_lng: location.lng,
          start_accuracy: location.accuracy,
        }),
      });
      const startPayload: unknown = await startResponse.json();

      if (!startResponse.ok) {
        // Create succeeded but start failed — add as pending, show error, don't redirect
        setItems((current) => [...current, createdAction!]);
        setIsAddModalOpen(false);
        throw new Error(parseApiError(startPayload, "Action created but failed to start"));
      }

      if (
        startPayload &&
        typeof startPayload === "object" &&
        "warning" in startPayload &&
        typeof startPayload.warning === "string"
      ) {
        setWarning(startPayload.warning);
      }

      if (
        !startPayload ||
        typeof startPayload !== "object" ||
        !("action" in startPayload) ||
        typeof startPayload.action !== "object" ||
        startPayload.action === null
      ) {
        setItems((current) => [...current, createdAction!]);
        setIsAddModalOpen(false);
        throw new Error("Action created but failed to start");
      }

      const startedAction = startPayload.action as VisitActionListItem;
      setItems((current) => [...current, startedAction]);
      setIsAddModalOpen(false);
      router.push(`/visits/${visitId}/actions/${startedAction.id}`);
    } catch (err) {
      if (!isLocationCancelled(err)) {
        setError(extractErrorMessage(err, "Failed to add action point"));
      }
    } finally {
      cancelAddRef.current = null;
      setIsAdding(false);
      setAddState("idle");
    }
  }

  async function handleDeleteAction(actionId: number) {
    setError(null);
    setWarning(null);
    setDeletingActionId(actionId);

    try {
      const response = await fetch(`/api/pm/visits/${visitId}/actions/${actionId}`, {
        method: "DELETE",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to delete action point"));
      }

      setItems((current) => current.filter((action) => action.id !== actionId));
      setConfirmDeleteActionId(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to delete action point"));
    } finally {
      setDeletingActionId(null);
    }
  }

  async function handleStartAction(actionId: number) {
    setError(null);
    setWarning(null);
    setStartingActionId(actionId);
    setStartState("acquiring");

    try {
      const locationHandle = getAccurateLocation();
      cancelStartRef.current = locationHandle.cancel;
      const location = await locationHandle.promise;

      setStartState("submitting");
      const response = await fetch(`/api/pm/visits/${visitId}/actions/${actionId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: location.lat,
          start_lng: location.lng,
          start_accuracy: location.accuracy,
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to start action point"));
      }

      if (
        payload &&
        typeof payload === "object" &&
        "warning" in payload &&
        typeof payload.warning === "string"
      ) {
        setWarning(payload.warning);
      }

      if (
        !payload ||
        typeof payload !== "object" ||
        !("action" in payload) ||
        typeof payload.action !== "object" ||
        payload.action === null
      ) {
        throw new Error("Failed to start action point");
      }

      const startedAction = payload.action as VisitActionListItem;
      setItems((current) =>
        current.map((action) => (action.id === startedAction.id ? startedAction : action))
      );
      router.push(`/visits/${visitId}/actions/${actionId}`);
    } catch (err) {
      if (!isLocationCancelled(err)) {
        setError(extractErrorMessage(err, "Failed to start action point"));
      }
    } finally {
      cancelStartRef.current = null;
      setStartingActionId(null);
      setStartState("idle");
    }
  }

  return (
    <div className="bg-bg-card border border-border overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b-2 border-border-accent flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">Action Points</h2>
          <span className="text-xs text-text-muted">
            {readOnly ? "Read-only" : "Creation-order timeline"}
          </span>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setWarning(null);
              setIsAddModalOpen(true);
            }}
            disabled={isBusy}
            className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-xs font-bold text-text-on-accent uppercase tracking-wide hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 w-full sm:w-auto"
          >
            Add Action Point
          </button>
        )}
      </div>

      {warning && (
        <Toast variant="warning" message={warning} onDismiss={dismissWarning} />
      )}

      {error && (
        <Toast variant="error" message={error} onDismiss={dismissError} />
      )}

      {startState === "acquiring" && startingActionId !== null && (
        <div className="mx-4 sm:mx-6 mt-4 flex items-center justify-between gap-3 border border-border bg-bg-card-alt px-3 py-2">
          <span className="text-sm text-text-primary">Getting location to start action...</span>
          <button
            type="button"
            onClick={() => {
              cancelStartRef.current?.();
            }}
            className="text-xs font-medium text-accent underline hover:text-accent-hover"
          >
            Cancel
          </button>
        </div>
      )}

      {addState === "acquiring" && isAdding && (
        <div className="mx-4 sm:mx-6 mt-4 flex items-center justify-between gap-3 border border-border bg-bg-card-alt px-3 py-2">
          <span className="text-sm text-text-primary">Getting location to add action...</span>
          <button
            type="button"
            onClick={() => {
              cancelAddRef.current?.();
            }}
            className="text-xs font-medium text-accent underline hover:text-accent-hover"
          >
            Cancel
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-4 sm:px-6 py-8 text-sm text-text-muted uppercase tracking-wide">
          No action points added yet.
        </div>
      ) : (
        <div>
          {items.map((action) => (
            <div
              key={action.id}
              data-testid={`action-card-${action.id}`}
              data-action-type={action.action_type}
              data-action-status={action.status}
              className="px-4 sm:px-6 py-4 border-b border-border"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {formatActionType(action.action_type)}
                  </div>
                  <div className="text-xs text-text-muted mt-1 font-mono">
                    Added: {formatTimestamp(action.inserted_at)}
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 self-start sm:self-auto ${statusBadgeClass(action.status)}`}
                >
                  {formatActionStatus(action.status)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted font-mono">
                <span>Started: {formatTimestamp(action.started_at)}</span>
                <span>Ended: {formatTimestamp(action.ended_at)}</span>
              </div>
              {action.action_type === "classroom_observation" && (() => {
                const stats = getClassroomObservationStats(action.data);
                if (!stats) {
                  return null;
                }

                const progressPercent = stats.totalParams === 0
                  ? 0
                  : Math.round((stats.answeredCount / stats.totalParams) * 100);

                return (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={`observation-stats-${action.id}`}>
                    {stats.teacherName && (
                      <span className="text-text-secondary">
                        <span className="text-text-muted">Teacher:</span> {stats.teacherName}
                      </span>
                    )}
                    {stats.grade && (
                      <span className="text-text-secondary">
                        <span className="text-text-muted">Grade:</span> {stats.grade}
                      </span>
                    )}
                    <span className="font-mono text-accent font-bold">
                      Score: {stats.score}/{stats.maxScore}
                    </span>
                    <span className="font-mono text-text-secondary">
                      {stats.answeredCount}/{stats.totalParams} ({progressPercent}%)
                    </span>
                  </div>
                );
              })()}
              {action.action_type === "af_team_interaction" && (() => {
                const stats = getAFTeamInteractionStats(action.data);
                if (!stats) {
                  return null;
                }

                const progressPercent = stats.totalQuestions === 0
                  ? 0
                  : Math.round((stats.answeredCount / stats.totalQuestions) * 100);

                return (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={`af-team-stats-${action.id}`}>
                    <span className="text-text-secondary">
                      <span className="text-text-muted">Teachers:</span> {stats.teacherCount}
                    </span>
                    <span className="font-mono text-text-secondary">
                      {stats.answeredCount}/{stats.totalQuestions} ({progressPercent}%)
                    </span>
                  </div>
                );
              })()}
              {action.action_type === "individual_af_teacher_interaction" && (() => {
                const stats = getIndividualTeacherInteractionStats(action.data);
                if (!stats) {
                  return null;
                }

                return (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={`individual-teacher-stats-${action.id}`}>
                    <span className="text-text-secondary">
                      <span className="text-text-muted">Teachers:</span> {stats.recordedCount} ({stats.presentCount} present, {stats.onLeaveCount} leave, {stats.absentCount} absent)
                    </span>
                  </div>
                );
              })()}
              {action.action_type === "principal_interaction" && (() => {
                const stats = getPrincipalInteractionStats(action.data);
                if (!stats) {
                  return null;
                }

                const progressPercent = stats.totalQuestions === 0
                  ? 0
                  : Math.round((stats.answeredCount / stats.totalQuestions) * 100);

                return (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={`principal-interaction-stats-${action.id}`}>
                    <span className="font-mono text-text-secondary">
                      {stats.answeredCount}/{stats.totalQuestions} ({progressPercent}%)
                    </span>
                  </div>
                );
              })()}
              {action.action_type === "group_student_discussion" && (() => {
                const stats = getGroupStudentDiscussionStats(action.data);
                if (!stats) {
                  return null;
                }

                const progressPercent = stats.totalQuestions === 0
                  ? 0
                  : Math.round((stats.answeredCount / stats.totalQuestions) * 100);

                return (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={`group-student-stats-${action.id}`}>
                    {stats.grade !== null && (
                      <span className="text-text-secondary">
                        <span className="text-text-muted">Grade:</span> {stats.grade}
                      </span>
                    )}
                    <span className="font-mono text-text-secondary">
                      {stats.answeredCount}/{stats.totalQuestions} ({progressPercent}%)
                    </span>
                  </div>
                );
              })()}
              {action.action_type === "individual_student_discussion" && (() => {
                const stats = getIndividualStudentDiscussionStats(action.data);
                if (!stats) {
                  return null;
                }

                return (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={`individual-student-stats-${action.id}`}>
                    <span className="text-text-secondary">
                      <span className="text-text-muted">Students:</span> {stats.studentCount}
                    </span>
                  </div>
                );
              })()}
              {action.action_type === "school_staff_interaction" && (() => {
                const stats = getSchoolStaffInteractionStats(action.data);
                if (!stats) {
                  return null;
                }

                const progressPercent = stats.totalQuestions === 0
                  ? 0
                  : Math.round((stats.answeredCount / stats.totalQuestions) * 100);

                return (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid={`school-staff-interaction-stats-${action.id}`}>
                    <span className="font-mono text-text-secondary">
                      {stats.answeredCount}/{stats.totalQuestions} ({progressPercent}%)
                    </span>
                  </div>
                );
              })()}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {action.status === "pending" && !readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void handleStartAction(action.id);
                      }}
                      disabled={isBusy}
                      className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-text-on-accent uppercase tracking-wide hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {startingActionId === action.id
                        ? startState === "acquiring"
                          ? "Getting location..."
                          : "Starting..."
                        : "Start"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleDeleteAction(action.id);
                      }}
                      disabled={isBusy}
                      className="inline-flex items-center border border-danger/20 bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-bg/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingActionId === action.id ? "Deleting..." : "Delete"}
                    </button>
                  </>
                )}
                {action.status === "in_progress" && (
                  <>
                    <Link
                      href={`/visits/${visitId}/actions/${action.id}`}
                      className="inline-flex items-center border border-border-accent bg-success-bg px-3 py-1.5 text-xs font-bold text-accent uppercase tracking-wide hover:bg-hover-bg"
                    >
                      Open
                    </Link>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteActionId(action.id);
                        }}
                        disabled={isBusy}
                        className="inline-flex items-center border border-danger/20 bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-bg/80 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
                {action.status === "completed" && (
                  <Link
                    href={`/visits/${visitId}/actions/${action.id}`}
                    className="inline-flex items-center border border-border bg-bg-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover-bg"
                  >
                    View Details
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ActionTypePickerModal
        isOpen={isAddModalOpen}
        submitting={isAdding}
        submittingLabel={
          addState === "acquiring"
            ? "Getting location..."
            : addState === "creating"
              ? "Creating..."
              : addState === "starting"
                ? "Starting..."
                : undefined
        }
        onClose={() => {
          if (!isAdding) {
            setIsAddModalOpen(false);
          }
        }}
        onSubmit={(actionType) => {
          void handleAddAction(actionType);
        }}
      />

      <Modal
        open={confirmDeleteActionId !== null}
        onClose={deletingActionId !== null ? undefined : () => setConfirmDeleteActionId(null)}
        zIndex="z-40"
        className="max-w-md"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <div className="border-b-4 border-danger/30 px-5 py-4">
            <h3 id="delete-confirm-title" className="text-base font-bold uppercase tracking-tight text-text-primary">
              Delete Action Point
            </h3>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-text-secondary">
              This action point and all its data will be permanently removed. This cannot be undone.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={() => {
                setConfirmDeleteActionId(null);
              }}
              disabled={deletingActionId !== null}
              className="inline-flex items-center border border-border bg-bg-card px-3 py-2 text-sm font-medium text-text-secondary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirmDeleteActionId !== null) {
                  void handleDeleteAction(confirmDeleteActionId);
                }
              }}
              disabled={deletingActionId !== null}
              className="inline-flex items-center bg-danger px-3 py-2 text-sm font-bold uppercase text-white hover:bg-danger/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingActionId === confirmDeleteActionId ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
