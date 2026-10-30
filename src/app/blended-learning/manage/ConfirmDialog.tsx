"use client";

import { useId, type ReactNode } from "react";

import { Button, Modal } from "@/components/ui";

// A confirmation before a push or a removal: what will happen, then Cancel
// and the action. While the action runs both buttons are disabled; an error
// shows above them. The action is also off while confirmDisabled.
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  busy,
  confirmDisabled = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  confirmDisabled?: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  return (
    <Modal open={open} onClose={busy ? undefined : onCancel} aria-labelledby={titleId} className="max-w-md">
      <div className="space-y-4 p-5">
        <h2 id={titleId} className="text-lg font-bold text-text-primary">
          {title}
        </h2>
        <div className="space-y-2 text-sm text-text-secondary">{children}</div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
