"use client";

import { useEffect } from "react";

interface ToastProps {
  variant: "error" | "warning";
  message: string;
  details?: string[];
  onDismiss: () => void;
  autoDismissMs?: number;
}

export default function Toast({
  variant,
  message,
  details,
  onDismiss,
  autoDismissMs = 6000,
}: ToastProps) {
  useEffect(() => {
    if (autoDismissMs <= 0) {
      return;
    }
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  const isError = variant === "error";

  return (
    <div
      role="alert"
      style={{ backgroundColor: isError ? "#fef2f2" : "#fef3c7" }}
      className={`fixed top-4 left-4 right-4 z-50 mx-auto max-w-lg border-2 px-4 py-3 shadow-lg ${
        isError
          ? "border-danger text-danger"
          : "border-warning-border text-warning-text"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 text-sm">
          <p className="font-medium">{message}</p>
          {details && details.length > 0 && (
            <ul className="mt-1 list-disc pl-5" data-testid={isError ? "toast-error-details" : "toast-warning-details"}>
              {details.map((detail, index) => (
                <li key={`${detail}-${index}`}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 text-lg font-bold leading-none ${
            isError ? "text-danger hover:text-danger/70" : "text-warning-text hover:text-warning-text/70"
          }`}
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
