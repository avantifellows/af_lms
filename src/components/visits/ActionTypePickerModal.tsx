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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-type-picker-title"
        className="w-full max-w-lg rounded-lg bg-white shadow-xl"
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 id="action-type-picker-title" className="text-base font-semibold text-gray-900">
            Add Action Point
          </h3>
          <p className="mt-1 text-sm text-gray-500">Pick one action type to create a pending card.</p>
        </div>

        <div className="max-h-80 space-y-2 overflow-y-auto px-5 py-4">
          {ACTION_TYPE_VALUES.map((actionType) => (
            <label
              key={actionType}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50"
            >
              <input
                type="radio"
                name="action-type"
                value={actionType}
                checked={selectedType === actionType}
                onChange={() => {
                  setSelectedType(actionType);
                }}
                className="mt-0.5"
              />
              <span className="text-sm text-gray-800">{getActionTypeLabel(actionType)}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
