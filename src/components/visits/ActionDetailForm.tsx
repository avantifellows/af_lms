"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { useAutoSave, type AutoSaveStatus } from "@/hooks/use-auto-save";

import Toast from "@/components/Toast";
import AFTeamInteractionForm from "@/components/visits/AFTeamInteractionForm";
import ClassroomObservationForm from "@/components/visits/ClassroomObservationForm";
import IndividualAFTeacherInteractionForm from "@/components/visits/IndividualAFTeacherInteractionForm";
import GroupStudentDiscussionForm from "@/components/visits/GroupStudentDiscussionForm";
import IndividualStudentDiscussionForm from "@/components/visits/IndividualStudentDiscussionForm";
import PrincipalInteractionForm from "@/components/visits/PrincipalInteractionForm";
import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction";
import { GROUP_STUDENT_DISCUSSION_CONFIG } from "@/lib/group-student-discussion";
import { INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG } from "@/lib/individual-af-teacher-interaction";
import { INDIVIDUAL_STUDENT_DISCUSSION_CONFIG } from "@/lib/individual-student-discussion";
import { PRINCIPAL_INTERACTION_CONFIG } from "@/lib/principal-interaction";
import {
  CURRENT_RUBRIC_VERSION,
  getRubricConfig,
} from "@/lib/classroom-observation-rubric";
import { getAccurateLocation } from "@/lib/geolocation";
import { getActionTypeLabel, isActionType, statusBadgeClass, type ActionType } from "@/lib/visit-actions";

interface ActionRecord {
  id: number;
  visit_id: number;
  action_type: string;
  status: string;
  data: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  inserted_at: string;
  updated_at: string;
}

interface ActionDetailFormProps {
  visitId: number;
  visitStatus: string;
  initialAction: ActionRecord;
  canWrite: boolean;
  isAdmin: boolean;
  schoolCode: string;
}

type FormState = "idle" | "saving" | "acquiring" | "ending";

interface FieldConfig {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
}

interface ActionFormConfig {
  title: string;
  description: string;
  fields: FieldConfig[];
}

interface ApiErrorPayload {
  error?: unknown;
  details?: unknown;
}

interface StructuredError {
  message: string;
  details: string[];
}

const CLASSROOM_ACTION_TYPE = "classroom_observation";
const AF_TEAM_ACTION_TYPE = "af_team_interaction" as const;
const INDIVIDUAL_TEACHER_ACTION_TYPE = "individual_af_teacher_interaction" as const;
const PRINCIPAL_INTERACTION_ACTION_TYPE = "principal_interaction" as const;
const GROUP_STUDENT_DISCUSSION_ACTION_TYPE = "group_student_discussion" as const;
const INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE = "individual_student_discussion" as const;
const SAVE_BEFORE_END_TYPES = new Set([CLASSROOM_ACTION_TYPE, AF_TEAM_ACTION_TYPE, INDIVIDUAL_TEACHER_ACTION_TYPE, PRINCIPAL_INTERACTION_ACTION_TYPE, GROUP_STUDENT_DISCUSSION_ACTION_TYPE, INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE]);

const ACTION_FORM_CONFIGS: Record<ActionType, ActionFormConfig> = {
  principal_interaction: {
    title: "Principal Interaction Details",
    description: "Record observations from the interaction with the school Principal.",
    fields: [],
  },
  leadership_meeting: {
    title: "Leadership Meeting Details",
    description: "Summarize agenda, decisions, and follow-up ownership.",
    fields: [
      { key: "agenda", label: "Agenda", placeholder: "What was the agenda?", multiline: true },
      {
        key: "decisions",
        label: "Decisions",
        placeholder: "What decisions were made?",
        multiline: true,
      },
      {
        key: "owners",
        label: "Owners",
        placeholder: "Who owns the next steps?",
      },
    ],
  },
  classroom_observation: {
    title: "Classroom Observation Details",
    description: "Complete the classroom observation rubric and summaries.",
    fields: [],
  },
  group_student_discussion: {
    title: "Student Interaction Details",
    description: "Record observations from student group interaction.",
    fields: [],
  },
  individual_student_discussion: {
    title: "Individual Student Interaction Details",
    description: "Record individual interactions with students.",
    fields: [],
  },
  individual_staff_meeting: {
    title: "Individual Staff Meeting Details",
    description: "Capture notes from one-on-one staff interaction.",
    fields: [
      { key: "staff_member", label: "Staff Member", placeholder: "Who did you meet?" },
      {
        key: "discussion_summary",
        label: "Discussion Summary",
        placeholder: "Summarize the meeting",
        multiline: true,
      },
      {
        key: "follow_ups",
        label: "Follow-ups",
        placeholder: "Any follow-up commitments?",
        multiline: true,
      },
    ],
  },
  team_staff_meeting: {
    title: "Team Staff Meeting Details",
    description: "Track team-level discussion and commitments.",
    fields: [
      { key: "participants", label: "Participants", placeholder: "Who attended?" },
      {
        key: "discussion_summary",
        label: "Discussion Summary",
        placeholder: "What was discussed?",
        multiline: true,
      },
      {
        key: "commitments",
        label: "Commitments",
        placeholder: "What commitments were made?",
        multiline: true,
      },
    ],
  },
  teacher_feedback: {
    title: "Teacher Feedback Details",
    description: "Capture teacher feedback details and planned support.",
    fields: [
      { key: "teacher_name", label: "Teacher Name", placeholder: "Which teacher?" },
      {
        key: "feedback_summary",
        label: "Feedback Summary",
        placeholder: "What feedback was shared?",
        multiline: true,
      },
      {
        key: "agreed_actions",
        label: "Agreed Actions",
        placeholder: "What actions were agreed?",
        multiline: true,
      },
    ],
  },
  af_team_interaction: {
    title: "AF Team Interaction Details",
    description: "Record observations from team interaction with teachers.",
    fields: [],
  },
  individual_af_teacher_interaction: {
    title: "Individual AF Teacher Interaction Details",
    description: "Record individual interactions with each teacher at the school.",
    fields: [],
  },
};

const FALLBACK_FORM_CONFIG: ActionFormConfig = {
  title: "Action Details",
  description: "Capture notes for this action.",
  fields: [
    {
      key: "notes",
      label: "Notes",
      placeholder: "Add your notes here",
      multiline: true,
    },
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readErrorDetails(details: unknown): string[] {
  if (!Array.isArray(details)) {
    return [];
  }

  return details.filter((detail): detail is string => typeof detail === "string" && detail.length > 0);
}

function extractErrorState(error: unknown, fallback: string): StructuredError {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    const details = "details" in error ? readErrorDetails(error.details) : [];
    return { message: error.message, details };
  }

  return { message: fallback, details: [] };
}

function parseApiError(payload: unknown, fallback: string): StructuredError {
  if (!payload || typeof payload !== "object") {
    return { message: fallback, details: [] };
  }

  const { error, details } = payload as ApiErrorPayload;
  const message = typeof error === "string" && error.trim().length > 0 ? error : fallback;

  return {
    message,
    details: readErrorDetails(details),
  };
}

function isLocationCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    error.message === "Location request was cancelled."
  );
}

function sanitizeClassroomPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};

  if (typeof data.rubric_version === "string") {
    sanitized.rubric_version = data.rubric_version;
  }

  if (isPlainObject(data.params)) {
    const params: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data.params)) {
      if (!isPlainObject(value)) {
        continue;
      }

      const nextValue: Record<string, unknown> = {};

      if (typeof value.score === "number" && Number.isFinite(value.score)) {
        nextValue.score = value.score;
      }

      if (typeof value.remarks === "string") {
        nextValue.remarks = value.remarks;
      }

      if (Object.keys(nextValue).length > 0) {
        params[key] = nextValue;
      }
    }

    sanitized.params = params;
  }

  if (typeof data.observer_summary_strengths === "string") {
    sanitized.observer_summary_strengths = data.observer_summary_strengths;
  }

  if (typeof data.observer_summary_improvements === "string") {
    sanitized.observer_summary_improvements = data.observer_summary_improvements;
  }

  if (typeof data.teacher_id === "number" && Number.isFinite(data.teacher_id) && data.teacher_id > 0) {
    sanitized.teacher_id = data.teacher_id;
  }

  if (typeof data.teacher_name === "string") {
    sanitized.teacher_name = data.teacher_name;
  }

  if (typeof data.grade === "string") {
    sanitized.grade = data.grade;
  }

  return sanitized;
}

function bootstrapClassroomPayload(data: unknown): Record<string, unknown> {
  const sanitized = sanitizeClassroomPayload(data);

  if (typeof sanitized.rubric_version !== "string") {
    sanitized.rubric_version = CURRENT_RUBRIC_VERSION;
  }

  return sanitized;
}

function sanitizeAFTeamPayload(data: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { teachers: [], questions: {} };
  }

  const teachers: Array<{ id: number; name: string }> = [];
  if (Array.isArray(data.teachers)) {
    for (const entry of data.teachers) {
      if (
        isPlainObject(entry) &&
        typeof entry.id === "number" &&
        Number.isFinite(entry.id) &&
        typeof entry.name === "string"
      ) {
        teachers.push({ id: entry.id, name: entry.name });
      }
    }
  }

  const questions: Record<string, unknown> = {};
  if (isPlainObject(data.questions)) {
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      const value = (data.questions as Record<string, unknown>)[key];
      if (isPlainObject(value)) {
        const entry: Record<string, unknown> = {};
        if (value.answer === null || typeof value.answer === "boolean") {
          entry.answer = value.answer;
        }
        if (typeof value.remark === "string") {
          entry.remark = value.remark;
        }
        if (Object.keys(entry).length > 0) {
          questions[key] = entry;
        }
      }
    }
  }

  return { teachers, questions };
}

function bootstrapAFTeamPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { teachers: [], questions: {} };
  }
  return sanitizeAFTeamPayload(data);
}

function sanitizeIndividualTeacherPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { teachers: [] };
  }

  const teachers: Array<Record<string, unknown>> = [];
  if (Array.isArray(data.teachers)) {
    for (const entry of data.teachers) {
      if (
        !isPlainObject(entry) ||
        typeof entry.id !== "number" ||
        !Number.isFinite(entry.id) ||
        typeof entry.name !== "string"
      ) {
        continue;
      }

      const sanitizedEntry: Record<string, unknown> = {
        id: entry.id,
        name: entry.name,
        attendance: typeof entry.attendance === "string" ? entry.attendance : "present",
      };

      const questions: Record<string, unknown> = {};
      if (isPlainObject(entry.questions)) {
        for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
          const value = (entry.questions as Record<string, unknown>)[key];
          if (isPlainObject(value)) {
            const qEntry: Record<string, unknown> = {};
            if (value.answer === null || typeof value.answer === "boolean") {
              qEntry.answer = value.answer;
            }
            if (typeof value.remark === "string") {
              qEntry.remark = value.remark;
            }
            if (Object.keys(qEntry).length > 0) {
              questions[key] = qEntry;
            }
          }
        }
      }

      sanitizedEntry.questions = questions;
      teachers.push(sanitizedEntry);
    }
  }

  return { teachers };
}

function bootstrapIndividualTeacherPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { teachers: [] };
  }
  return sanitizeIndividualTeacherPayload(data);
}

function sanitizePrincipalInteractionPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { questions: {} };
  }

  const questions: Record<string, unknown> = {};
  if (isPlainObject(data.questions)) {
    for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
      const value = (data.questions as Record<string, unknown>)[key];
      if (isPlainObject(value)) {
        const entry: Record<string, unknown> = {};
        if (value.answer === null || typeof value.answer === "boolean") {
          entry.answer = value.answer;
        }
        if (typeof value.remark === "string") {
          entry.remark = value.remark;
        }
        if (Object.keys(entry).length > 0) {
          questions[key] = entry;
        }
      }
    }
  }

  return { questions };
}

function bootstrapPrincipalInteractionPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { questions: {} };
  }
  return sanitizePrincipalInteractionPayload(data);
}

function sanitizeGroupStudentDiscussionPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { grade: null, questions: {} };
  }

  const grade = typeof data.grade === "number" && Number.isFinite(data.grade) ? data.grade : null;

  const questions: Record<string, unknown> = {};
  if (isPlainObject(data.questions)) {
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      const value = (data.questions as Record<string, unknown>)[key];
      if (isPlainObject(value)) {
        const entry: Record<string, unknown> = {};
        if (value.answer === null || typeof value.answer === "boolean") {
          entry.answer = value.answer;
        }
        if (typeof value.remark === "string") {
          entry.remark = value.remark;
        }
        if (Object.keys(entry).length > 0) {
          questions[key] = entry;
        }
      }
    }
  }

  return { grade, questions };
}

function bootstrapGroupStudentDiscussionPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { grade: null, questions: {} };
  }
  return sanitizeGroupStudentDiscussionPayload(data);
}

function sanitizeIndividualStudentDiscussionPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { students: [] };
  }

  const students: Array<Record<string, unknown>> = [];
  if (Array.isArray(data.students)) {
    for (const entry of data.students) {
      if (
        !isPlainObject(entry) ||
        typeof entry.id !== "number" ||
        !Number.isFinite(entry.id) ||
        typeof entry.name !== "string"
      ) {
        continue;
      }

      const sanitizedEntry: Record<string, unknown> = {
        id: entry.id,
        name: entry.name,
        grade: typeof entry.grade === "number" ? entry.grade : null,
      };

      const questions: Record<string, unknown> = {};
      if (isPlainObject(entry.questions)) {
        for (const key of INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
          const value = (entry.questions as Record<string, unknown>)[key];
          if (isPlainObject(value)) {
            const qEntry: Record<string, unknown> = {};
            if (value.answer === null || typeof value.answer === "boolean") {
              qEntry.answer = value.answer;
            }
            if (typeof value.remark === "string") {
              qEntry.remark = value.remark;
            }
            if (Object.keys(qEntry).length > 0) {
              questions[key] = qEntry;
            }
          }
        }
      }

      sanitizedEntry.questions = questions;
      students.push(sanitizedEntry);
    }
  }

  return { students };
}

function bootstrapIndividualStudentDiscussionPayload(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) {
    return { students: [] };
  }
  return sanitizeIndividualStudentDiscussionPayload(data);
}

function normalizeFormDataForAction(actionType: string, data: unknown): Record<string, unknown> {
  if (actionType === CLASSROOM_ACTION_TYPE) {
    return bootstrapClassroomPayload(data);
  }

  if (actionType === AF_TEAM_ACTION_TYPE) {
    return bootstrapAFTeamPayload(data);
  }

  if (actionType === INDIVIDUAL_TEACHER_ACTION_TYPE) {
    return bootstrapIndividualTeacherPayload(data);
  }

  if (actionType === PRINCIPAL_INTERACTION_ACTION_TYPE) {
    return bootstrapPrincipalInteractionPayload(data);
  }

  if (actionType === GROUP_STUDENT_DISCUSSION_ACTION_TYPE) {
    return bootstrapGroupStudentDiscussionPayload(data);
  }

  if (actionType === INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE) {
    return bootstrapIndividualStudentDiscussionPayload(data);
  }

  if (!isPlainObject(data)) {
    return {};
  }

  return { ...data };
}

function sanitizePatchData(actionType: string, data: Record<string, unknown>): Record<string, unknown> {
  if (actionType === CLASSROOM_ACTION_TYPE) {
    return bootstrapClassroomPayload(data);
  }

  if (actionType === AF_TEAM_ACTION_TYPE) {
    return sanitizeAFTeamPayload(data);
  }

  if (actionType === INDIVIDUAL_TEACHER_ACTION_TYPE) {
    return sanitizeIndividualTeacherPayload(data);
  }

  if (actionType === PRINCIPAL_INTERACTION_ACTION_TYPE) {
    return sanitizePrincipalInteractionPayload(data);
  }

  if (actionType === GROUP_STUDENT_DISCUSSION_ACTION_TYPE) {
    return sanitizeGroupStudentDiscussionPayload(data);
  }

  if (actionType === INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE) {
    return sanitizeIndividualStudentDiscussionPayload(data);
  }

  return data;
}

function normalizeActionForState(action: ActionRecord): ActionRecord {
  return {
    ...action,
    data: normalizeFormDataForAction(action.action_type, action.data),
  };
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toActionTypeLabel(actionType: string): string {
  if (isActionType(actionType)) {
    return getActionTypeLabel(actionType);
  }

  return actionType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toActionStatusLabel(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function readStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function readActionFromPayload(payload: unknown): ActionRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!("action" in payload) || !payload.action || typeof payload.action !== "object") {
    return null;
  }
  const action = payload.action as Partial<ActionRecord>;
  const actionId = readNumericValue(action.id);
  if (actionId === null) {
    return null;
  }

  const visitId = readNumericValue(action.visit_id);

  return {
    id: actionId,
    visit_id: visitId ?? 0,
    action_type: typeof action.action_type === "string" ? action.action_type : "unknown",
    status: typeof action.status === "string" ? action.status : "pending",
    data:
      action.data && typeof action.data === "object" && !Array.isArray(action.data)
        ? (action.data as Record<string, unknown>)
        : {},
    started_at: typeof action.started_at === "string" ? action.started_at : null,
    ended_at: typeof action.ended_at === "string" ? action.ended_at : null,
    inserted_at: typeof action.inserted_at === "string" ? action.inserted_at : "",
    updated_at: typeof action.updated_at === "string" ? action.updated_at : "",
  };
}

const AUTO_SAVE_STATUS_CONFIG: Record<
  Exclude<AutoSaveStatus, "idle">,
  { label: string; className: string }
> = {
  unsaved: { label: "Unsaved changes", className: "text-warning-text" },
  saving: { label: "Saving...", className: "text-text-muted" },
  saved: { label: "Saved", className: "text-accent" },
  error: { label: "Save failed", className: "text-danger" },
};

function SaveStatusIndicator({ status }: { status: AutoSaveStatus }) {
  if (status === "idle") return null;
  const config = AUTO_SAVE_STATUS_CONFIG[status];
  return (
    <span
      role="status"
      data-testid="auto-save-status"
      className={`text-sm font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

export default function ActionDetailForm({
  visitId,
  visitStatus,
  initialAction,
  canWrite,
  isAdmin,
  schoolCode,
}: ActionDetailFormProps) {
  const [action, setAction] = useState<ActionRecord>(() => normalizeActionForState(initialAction));
  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    normalizeFormDataForAction(initialAction.action_type, initialAction.data)
  );
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<StructuredError | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const cancelEndRef = useRef<(() => void) | null>(null);

  const dismissError = useCallback(() => setError(null), []);
  const dismissWarning = useCallback(() => setWarning(null), []);

  const config = useMemo(() => {
    if (isActionType(action.action_type)) {
      return ACTION_FORM_CONFIGS[action.action_type];
    }
    return FALLBACK_FORM_CONFIG;
  }, [action.action_type]);

  const isClassroomObservation = action.action_type === CLASSROOM_ACTION_TYPE;
  const rubricVersion = typeof formData.rubric_version === "string" ? formData.rubric_version : null;
  const hasUnsupportedRubricVersion =
    isClassroomObservation && rubricVersion !== null && getRubricConfig(rubricVersion) === null;

  const isVisitCompleted = visitStatus === "completed";
  const canSave =
    !isVisitCompleted &&
    canWrite &&
    !hasUnsupportedRubricVersion &&
    (action.status !== "completed" || isAdmin);
  const canEnd =
    !isVisitCompleted &&
    canWrite &&
    !hasUnsupportedRubricVersion &&
    action.status === "in_progress";
  const isBusy = state !== "idle";

  const { saveStatus, cancelAutoSave, flushAndCancel, markSynced } = useAutoSave({
    formData,
    actionType: action.action_type,
    canSave,
    isBusy,
    persistFn: persistActionData,
    sanitizeFn: sanitizePatchData,
    onSuccess: (updatedAction) => {
      setAction((prev) => ({ ...prev, ...updatedAction } as ActionRecord));
    },
  });

  async function persistActionData(dataToPersist: Record<string, unknown>) {
    const response = await fetch(`/api/pm/visits/${visitId}/actions/${action.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: dataToPersist }),
    });

    const payload = await readJsonSafely(response);

    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        error: parseApiError(payload, "Failed to save action details"),
      };
    }

    const updatedAction = readActionFromPayload(payload);
    if (!updatedAction) {
      return {
        ok: false as const,
        status: response.status,
        error: { message: "Failed to save action details", details: [] },
      };
    }

    return {
      ok: true as const,
      action: normalizeActionForState(updatedAction),
    };
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave || isBusy) {
      return;
    }

    cancelAutoSave();
    setError(null);
    setWarning(null);
    setState("saving");

    try {
      const result = await persistActionData(sanitizePatchData(action.action_type, formData));

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setAction(result.action);
      setFormData(result.action.data ?? {});
      markSynced(result.action.data ?? {});
    } catch (err) {
      setError(extractErrorState(err, "Failed to save action details"));
    } finally {
      setState("idle");
    }
  }

  async function handleEndAction() {
    if (!canEnd || isBusy) {
      return;
    }

    await flushAndCancel();
    setError(null);
    setWarning(null);

    if (SAVE_BEFORE_END_TYPES.has(action.action_type)) {
      const saveErrorMessage = isClassroomObservation
        ? "Could not save observation. Fix errors and try End again."
        : "Could not save form data. Fix errors and try End again.";

      setState("saving");

      try {
        const saveResult = await persistActionData(sanitizePatchData(action.action_type, formData));

        if (!saveResult.ok) {
          setError({
            message: saveErrorMessage,
            details: saveResult.error.details,
          });
          return;
        }

        setAction(saveResult.action);
        setFormData(saveResult.action.data ?? {});
        markSynced(saveResult.action.data ?? {});
      } catch {
        setError({
          message: saveErrorMessage,
          details: [],
        });
        return;
      }
    }

    setState("acquiring");

    try {
      const locationHandle = getAccurateLocation();
      cancelEndRef.current = locationHandle.cancel;
      const location = await locationHandle.promise;

      setState("ending");
      const response = await fetch(`/api/pm/visits/${visitId}/actions/${action.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          end_lat: location.lat,
          end_lng: location.lng,
          end_accuracy: location.accuracy,
        }),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const parsedError = parseApiError(payload, "Failed to end action");

        if (SAVE_BEFORE_END_TYPES.has(action.action_type) && response.status === 422) {
          const endErrorMessage = isClassroomObservation
            ? "Please complete all required rubric scores before ending this observation."
            : action.action_type === INDIVIDUAL_TEACHER_ACTION_TYPE
              ? "Please complete all required fields and record all teachers before ending this interaction."
              : action.action_type === INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE
                ? "Please complete all required fields and add at least one student before ending this interaction."
                : "Please complete all required fields before ending this interaction.";
          setError({
            message: endErrorMessage,
            details: parsedError.details,
          });
          return;
        }

        setError(parsedError);
        return;
      }

      if (
        payload &&
        typeof payload === "object" &&
        "warning" in payload &&
        typeof payload.warning === "string"
      ) {
        setWarning(payload.warning);
      }

      const endedAction = readActionFromPayload(payload);
      if (!endedAction) {
        setError({ message: "Failed to end action", details: [] });
        return;
      }

      const normalizedEndedAction = normalizeActionForState(endedAction);
      setAction(normalizedEndedAction);
      setFormData(normalizedEndedAction.data ?? {});
      markSynced(normalizedEndedAction.data ?? {});
    } catch (err) {
      if (!isLocationCancelled(err)) {
        setError(extractErrorState(err, "Failed to end action"));
      }
    } finally {
      cancelEndRef.current = null;
      setState("idle");
    }
  }

  const unsupportedVersionMessage = hasUnsupportedRubricVersion && rubricVersion
    ? `Unsupported classroom observation rubric version: ${rubricVersion}. This observation is read-only until migrated.`
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-bg-card border border-border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary uppercase tracking-tight">
              {toActionTypeLabel(action.action_type)}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">{config.description}</p>
          </div>
          <span
            className={`inline-flex ${statusBadgeClass(action.status)}`}
          >
            {toActionStatusLabel(action.status)}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted font-mono">
          <span>Started: {formatTimestamp(action.started_at)}</span>
          <span>Ended: {formatTimestamp(action.ended_at)}</span>
        </div>
      </div>

      {canSave && <SaveStatusIndicator status={saveStatus} />}

      {unsupportedVersionMessage && (
        <p
          className="text-sm text-warning-text bg-warning-bg border border-warning-border px-3 py-2"
          data-testid="classroom-unsupported-version-warning"
          role="alert"
        >
          {unsupportedVersionMessage}
        </p>
      )}

      {!unsupportedVersionMessage && warning && (
        <Toast variant="warning" message={warning} onDismiss={dismissWarning} />
      )}

      {error && (
        <Toast variant="error" message={error.message} details={error.details} onDismiss={dismissError} />
      )}

      {state === "acquiring" && (
        <div className="flex items-center justify-between gap-3 border border-border bg-bg-card-alt px-3 py-2">
          <span className="text-sm text-text-primary">Getting location to end action...</span>
          <button
            type="button"
            onClick={() => {
              cancelEndRef.current?.();
            }}
            className="text-xs font-medium text-accent underline hover:text-accent-hover"
          >
            Cancel
          </button>
        </div>
      )}

      {!unsupportedVersionMessage && !canSave && !canEnd && (
        <p className="text-sm text-text-secondary bg-bg-card-alt border border-border px-3 py-2">
          {isVisitCompleted
            ? "This visit is completed and read-only."
            : action.status === "completed" && !isAdmin
              ? "Completed actions are read-only for your role."
              : "This action is read-only for your role."}
        </p>
      )}

      <form
        onSubmit={(event) => {
          void handleSave(event);
        }}
        className="bg-bg-card border border-border p-6 space-y-4"
        data-testid={`action-renderer-${action.action_type}`}
      >
        <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">{config.title}</h2>

        {isClassroomObservation ? (
          <ClassroomObservationForm
            data={formData}
            setData={setFormData}
            disabled={!canSave || isBusy}
            schoolCode={schoolCode}
          />
        ) : action.action_type === AF_TEAM_ACTION_TYPE ? (
          <AFTeamInteractionForm
            data={formData}
            setData={setFormData}
            disabled={!canSave || isBusy}
            schoolCode={schoolCode}
          />
        ) : action.action_type === INDIVIDUAL_TEACHER_ACTION_TYPE ? (
          <IndividualAFTeacherInteractionForm
            data={formData}
            setData={setFormData}
            disabled={!canSave || isBusy}
            schoolCode={schoolCode}
          />
        ) : action.action_type === PRINCIPAL_INTERACTION_ACTION_TYPE ? (
          <PrincipalInteractionForm
            data={formData}
            setData={setFormData}
            disabled={!canSave || isBusy}
          />
        ) : action.action_type === GROUP_STUDENT_DISCUSSION_ACTION_TYPE ? (
          <GroupStudentDiscussionForm
            data={formData}
            setData={setFormData}
            disabled={!canSave || isBusy}
          />
        ) : action.action_type === INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE ? (
          <IndividualStudentDiscussionForm
            data={formData}
            setData={setFormData}
            disabled={!canSave || isBusy}
            schoolCode={schoolCode}
          />
        ) : (
          config.fields.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">{field.label}</span>
              {field.multiline ? (
                <textarea
                  value={readStringValue(formData[field.key])}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setFormData((current) => ({ ...current, [field.key]: nextValue }));
                  }}
                  disabled={!canSave || isBusy}
                  placeholder={field.placeholder}
                  rows={4}
                  className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-bg-card-alt"
                />
              ) : (
                <input
                  value={readStringValue(formData[field.key])}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setFormData((current) => ({ ...current, [field.key]: nextValue }));
                  }}
                  disabled={!canSave || isBusy}
                  placeholder={field.placeholder}
                  className="w-full border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-bg-card-alt"
                />
              )}
            </label>
          ))
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {canSave && (
            <button
              type="submit"
              disabled={isBusy}
              className="inline-flex items-center bg-accent px-4 py-2 text-sm font-bold uppercase text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === "saving" ? "Saving..." : "Save Now"}
            </button>
          )}
          {canEnd && (
            <button
              type="button"
              onClick={() => {
                void handleEndAction();
              }}
              disabled={isBusy}
              className="inline-flex items-center bg-accent px-4 py-2 text-sm font-bold uppercase text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === "acquiring"
                ? "Getting location..."
                : state === "ending"
                  ? "Ending..."
                  : "End Action"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
