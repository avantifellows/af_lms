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
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Action Points</h2>
          <span className="text-xs text-gray-500">
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
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Action Point
          </button>
        )}
      </div>

      {warning && (
        <div className="mx-6 mt-4 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          {warning}
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {startState === "acquiring" && startingActionId !== null && (
        <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-sm text-blue-800">Getting location to start action...</span>
          <button
            type="button"
            onClick={() => {
              cancelStartRef.current?.();
            }}
            className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
          >
            Cancel
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-6 py-8 text-sm text-gray-500">
          No action points added yet.
        </div>
      ) : (
        <div className="divide-y divide-gray-200">
          {items.map((action) => (
            <div
              key={action.id}
              data-testid={`action-card-${action.id}`}
              data-action-type={action.action_type}
              data-action-status={action.status}
              className="px-6 py-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {formatActionType(action.action_type)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Added: {formatTimestamp(action.inserted_at)}
                  </div>
                </div>
                <span
                  className={`inline-flex ${statusBadgeClass(action.status)}`}
                >
                  {formatActionStatus(action.status)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
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
                      className="inline-flex items-center rounded-md bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-600 disabled:cursor-not-allowed disabled:opacity-50"
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
                      className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingActionId === action.id ? "Deleting..." : "Delete"}
                    </button>
                  </>
                )}
                {action.status === "in_progress" && (
                  <Link
                    href={`/visits/${visitId}/actions/${action.id}`}
                    className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    Open
                  </Link>
                )}
                {action.status === "completed" && (
                  <Link
                    href={`/visits/${visitId}/actions/${action.id}`}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
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
