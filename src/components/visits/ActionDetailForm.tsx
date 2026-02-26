"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import Toast from "@/components/Toast";
import ClassroomObservationForm from "@/components/visits/ClassroomObservationForm";
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

const ACTION_FORM_CONFIGS: Record<ActionType, ActionFormConfig> = {
  principal_meeting: {
    title: "Principal Meeting Details",
    description: "Capture attendees, key discussion points, and follow-ups.",
    fields: [
      { key: "attendees", label: "Attendees", placeholder: "Who attended this meeting?" },
      {
        key: "key_discussion",
        label: "Key Discussion",
        placeholder: "What was discussed?",
        multiline: true,
      },
      {
        key: "follow_ups",
        label: "Follow-ups",
        placeholder: "Any follow-up actions?",
        multiline: true,
      },
    ],
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
    title: "Group Student Discussion Details",
    description: "Capture discussion highlights from student groups.",
    fields: [
      {
        key: "participant_group",
        label: "Participant Group",
        placeholder: "Which group of students participated?",
      },
      {
        key: "discussion_points",
        label: "Discussion Points",
        placeholder: "What came up in discussion?",
        multiline: true,
      },
      {
        key: "next_steps",
        label: "Next Steps",
        placeholder: "Any agreed next steps?",
        multiline: true,
      },
    ],
  },
  individual_student_discussion: {
    title: "Individual Student Discussion Details",
    description: "Log the conversation and follow-up for a student interaction.",
    fields: [
      { key: "student_name", label: "Student Name", placeholder: "Who did you speak with?" },
      {
        key: "discussion_notes",
        label: "Discussion Notes",
        placeholder: "Summarize the discussion",
        multiline: true,
      },
      {
        key: "action_items",
        label: "Action Items",
        placeholder: "Any action items?",
        multiline: true,
      },
    ],
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

  return sanitized;
}

function bootstrapClassroomPayload(data: unknown): Record<string, unknown> {
  const sanitized = sanitizeClassroomPayload(data);

  if (typeof sanitized.rubric_version !== "string") {
    sanitized.rubric_version = CURRENT_RUBRIC_VERSION;
  }

  return sanitized;
}

function normalizeFormDataForAction(actionType: string, data: unknown): Record<string, unknown> {
  if (actionType === CLASSROOM_ACTION_TYPE) {
    return bootstrapClassroomPayload(data);
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

export default function ActionDetailForm({
  visitId,
  visitStatus,
  initialAction,
  canWrite,
  isAdmin,
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

    setError(null);
    setWarning(null);

    if (isClassroomObservation) {
      setState("saving");

      try {
        const saveResult = await persistActionData(sanitizePatchData(action.action_type, formData));

        if (!saveResult.ok) {
          setError({
            message: "Could not save observation. Fix errors and try End again.",
            details: saveResult.error.details,
          });
          return;
        }

        setAction(saveResult.action);
        setFormData(saveResult.action.data ?? {});
      } catch {
        setError({
          message: "Could not save observation. Fix errors and try End again.",
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

        if (isClassroomObservation && response.status === 422) {
          setError({
            message: "Please complete all required rubric scores before ending this observation.",
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
              {state === "saving" ? "Saving..." : "Save"}
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
