"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

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

export default function ActionPointList({
  visitId,
  actions,
  readOnly = false,
}: ActionPointListProps) {
  const [items, setItems] = useState<VisitActionListItem[]>(actions);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingActionId, setDeletingActionId] = useState<number | null>(null);
  const [startingActionId, setStartingActionId] = useState<number | null>(null);
  const [startState, setStartState] = useState<"idle" | "acquiring" | "submitting">("idle");
  const cancelStartRef = useRef<(() => void) | null>(null);

  const isBusy = useMemo(() => {
    return isAdding || deletingActionId !== null || startingActionId !== null;
  }, [deletingActionId, isAdding, startingActionId]);

  async function handleAddAction(actionType: string) {
    setError(null);
    setWarning(null);
    setIsAdding(true);

    try {
      const response = await fetch(`/api/pm/visits/${visitId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: actionType }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to add action point"));
      }

      if (
        !payload ||
        typeof payload !== "object" ||
        !("action" in payload) ||
        typeof payload.action !== "object" ||
        payload.action === null
      ) {
        throw new Error("Failed to add action point");
      }

      const createdAction = payload.action as VisitActionListItem;
      setItems((current) => [...current, createdAction]);
      setIsAddModalOpen(false);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to add action point"));
    } finally {
      setIsAdding(false);
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
            className="inline-flex items-center justify-center bg-accent px-4 py-2.5 text-xs font-bold text-text-on-accent uppercase tracking-wide hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 w-full sm:w-auto"
          >
            Add Action Point
          </button>
        )}
      </div>

      {warning && (
        <div className="mx-4 sm:mx-6 mt-4 border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text" role="alert">
          {warning}
        </div>
      )}

      {error && (
        <div className="mx-4 sm:mx-6 mt-4 border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </div>
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {action.status === "pending" && !readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void handleStartAction(action.id);
                      }}
                      disabled={isBusy}
                      className="inline-flex items-center bg-accent px-3 py-1.5 text-xs font-bold text-text-on-accent uppercase tracking-wide hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
                  <Link
                    href={`/visits/${visitId}/actions/${action.id}`}
                    className="inline-flex items-center border border-border-accent bg-success-bg px-3 py-1.5 text-xs font-bold text-accent uppercase tracking-wide hover:bg-hover-bg"
                  >
                    Open
                  </Link>
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
        onClose={() => {
          if (!isAdding) {
            setIsAddModalOpen(false);
          }
        }}
        onSubmit={(actionType) => {
          void handleAddAction(actionType);
        }}
      />
    </div>
  );
}
