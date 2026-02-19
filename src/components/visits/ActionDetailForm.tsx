"use client";

import { useMemo, useRef, useState } from "react";

import { getAccurateLocation } from "@/lib/geolocation";
import { getActionTypeLabel, isActionType, type ActionType } from "@/lib/visit-actions";

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
    description: "Record observations, strengths, and support needs.",
    fields: [
      { key: "class_details", label: "Class Details", placeholder: "Grade/subject/teacher context" },
      {
        key: "observations",
        label: "Observations",
        placeholder: "What did you observe in class?",
        multiline: true,
      },
      {
        key: "support_needed",
        label: "Support Needed",
        placeholder: "What support is required?",
        multiline: true,
      },
    ],
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

function actionStatusClass(status: string): string {
  if (status === "completed") {
    return "bg-green-100 text-green-800";
  }
  if (status === "in_progress") {
    return "bg-yellow-100 text-yellow-800";
  }
  return "bg-gray-100 text-gray-700";
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
    data: action.data && typeof action.data === "object" && !Array.isArray(action.data)
      ? action.data as Record<string, unknown>
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
  const [action, setAction] = useState<ActionRecord>(initialAction);
  const [formData, setFormData] = useState<Record<string, unknown>>(initialAction.data ?? {});
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const cancelEndRef = useRef<(() => void) | null>(null);

  const config = useMemo(() => {
    if (isActionType(action.action_type)) {
      return ACTION_FORM_CONFIGS[action.action_type];
    }
    return FALLBACK_FORM_CONFIG;
  }, [action.action_type]);

  const isVisitCompleted = visitStatus === "completed";
  const canSave = !isVisitCompleted && canWrite && (action.status !== "completed" || isAdmin);
  const canEnd = !isVisitCompleted && canWrite && action.status === "in_progress";
  const isBusy = state !== "idle";

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave || isBusy) {
      return;
    }

    setError(null);
    setWarning(null);
    setState("saving");

    try {
      const response = await fetch(`/api/pm/visits/${visitId}/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: formData }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to save action details"));
      }

      const updatedAction = readActionFromPayload(payload);
      if (!updatedAction) {
        throw new Error("Failed to save action details");
      }

      setAction(updatedAction);
      setFormData(updatedAction.data ?? {});
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to save action details"));
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
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to end action"));
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
        throw new Error("Failed to end action");
      }

      setAction(endedAction);
      setFormData(endedAction.data ?? {});
    } catch (err) {
      if (!isLocationCancelled(err)) {
        setError(extractErrorMessage(err, "Failed to end action"));
      }
    } finally {
      cancelEndRef.current = null;
      setState("idle");
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {toActionTypeLabel(action.action_type)}
            </h1>
            <p className="mt-1 text-sm text-gray-500">{config.description}</p>
          </div>
          <span
            className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${actionStatusClass(action.status)}`}
          >
            {toActionStatusLabel(action.status)}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>Started: {formatTimestamp(action.started_at)}</span>
          <span>Ended: {formatTimestamp(action.ended_at)}</span>
        </div>
      </div>

      {warning && (
        <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2">
          {warning}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {state === "acquiring" && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-sm text-blue-800">Getting location to end action...</span>
          <button
            type="button"
            onClick={() => {
              cancelEndRef.current?.();
            }}
            className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
          >
            Cancel
          </button>
        </div>
      )}

      {!canSave && !canEnd && (
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
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
        className="bg-white shadow rounded-lg p-6 space-y-4"
        data-testid={`action-renderer-${action.action_type}`}
      >
        <h2 className="text-lg font-semibold text-gray-900">{config.title}</h2>

        {config.fields.map((field) => (
          <label key={field.key} className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{field.label}</span>
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
            )}
          </label>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {canSave && (
            <button
              type="submit"
              disabled={isBusy}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
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
