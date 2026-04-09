"use client";

import { useMemo, useState } from "react";

import { ACTION_TYPE_VALUES, getActionTypeLabel, type ActionType } from "@/lib/visit-actions";
import { Modal } from "@/components/ui";

interface ActionTypePickerModalProps {
  isOpen: boolean;
  submitting?: boolean;
  submittingLabel?: string;
  onClose: () => void;
  onSubmit: (actionType: ActionType) => void;
}

export default function ActionTypePickerModal({
  isOpen,
  submitting = false,
  submittingLabel,
  onClose,
  onSubmit,
}: ActionTypePickerModalProps) {
  const [selectedType, setSelectedType] = useState<ActionType | "">("");

  const canSubmit = useMemo(() => {
    return selectedType !== "" && !submitting;
  }, [selectedType, submitting]);

  return (
    <Modal
      open={isOpen}
      onClose={submitting ? undefined : onClose}
      zIndex="z-40"
      className="max-h-[90vh] flex flex-col"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-type-picker-title"
      >
        <div className="border-b-4 border-border-accent px-5 py-4 shrink-0">
          <h3 id="action-type-picker-title" className="text-base font-bold uppercase tracking-tight text-text-primary">
            Add Action Point
          </h3>
          <p className="mt-1 text-sm text-text-muted">Pick one action type to add.</p>
        </div>

        <div className="space-y-2 px-5 py-4 overflow-y-auto">
          {ACTION_TYPE_VALUES.map((actionType) => (
              <label
                key={actionType}
                className={`flex items-center gap-4 border-2 px-4 py-3 transition-colors ${
                  selectedType === actionType
                    ? "cursor-pointer border-accent bg-success-bg"
                    : "cursor-pointer border-border hover:bg-hover-bg hover:border-accent/50"
                }`}
              >
                <input
                  type="radio"
                  name="action-type"
                  value={actionType}
                  checked={selectedType === actionType}
                  onChange={() => {
                    setSelectedType(actionType);
                  }}
                  className="h-5 w-5 accent-accent"
                />
                <span className="text-base font-medium text-text-primary">
                  {getActionTypeLabel(actionType)}
                </span>
              </label>
            ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4 shrink-0">
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
            className="inline-flex items-center rounded-lg bg-accent px-3 py-2 text-sm font-bold uppercase text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (submittingLabel ?? "Adding...") : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
