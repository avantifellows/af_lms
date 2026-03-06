"use client";

import { useMemo, useState } from "react";

import { ACTION_TYPE_VALUES, getActionTypeLabel, type ActionType } from "@/lib/visit-actions";

interface ActionTypePickerModalProps {
  isOpen: boolean;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (actionType: ActionType) => void;
}

export default function ActionTypePickerModal({
  isOpen,
  submitting = false,
  onClose,
  onSubmit,
}: ActionTypePickerModalProps) {
  const [selectedType, setSelectedType] = useState<ActionType | "">("");

  const canSubmit = useMemo(() => {
    return selectedType !== "" && !submitting;
  }, [selectedType, submitting]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-type-picker-title"
        className="w-full max-w-lg bg-bg-card shadow-xl"
      >
        <div className="border-b-4 border-border-accent px-5 py-4">
          <h3 id="action-type-picker-title" className="text-base font-bold uppercase tracking-tight text-text-primary">
            Add Action Point
          </h3>
          <p className="mt-1 text-sm text-text-muted">Pick one action type to create a pending card.</p>
        </div>

        <div className="space-y-2 px-5 py-4">
          {ACTION_TYPE_VALUES.map((actionType) => {
            const enabled = actionType === "classroom_observation";
            return (
              <label
                key={actionType}
                className={`flex items-center gap-4 border-2 px-4 py-3 transition-colors ${
                  !enabled
                    ? "cursor-not-allowed border-border opacity-40"
                    : selectedType === actionType
                      ? "cursor-pointer border-accent bg-success-bg"
                      : "cursor-pointer border-border hover:bg-hover-bg hover:border-accent/50"
                }`}
              >
                <input
                  type="radio"
                  name="action-type"
                  value={actionType}
                  checked={selectedType === actionType}
                  disabled={!enabled}
                  onChange={() => {
                    setSelectedType(actionType);
                  }}
                  className="h-5 w-5 accent-accent"
                />
                <span className={`text-base font-medium ${enabled ? "text-text-primary" : "text-text-muted"}`}>
                  {getActionTypeLabel(actionType)}
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex items-center border border-border bg-bg-card px-3 py-2 text-sm font-medium text-text-secondary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedType !== "") {
                onSubmit(selectedType);
              }
            }}
            disabled={!canSubmit}
            className="inline-flex items-center bg-accent px-3 py-2 text-sm font-bold uppercase text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
