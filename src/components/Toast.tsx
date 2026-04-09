"use client";

import { useEffect } from "react";

interface ToastProps {
  variant: "error" | "warning" | "success" | "info";
  message: string;
  details?: string[];
  onDismiss: () => void;
  autoDismissMs?: number;
  placement?: "top" | "bottom-right";
}

export default function Toast({
  variant,
  message,
  details,
  onDismiss,
  autoDismissMs = 6000,
  placement = "top",
}: ToastProps) {
  useEffect(() => {
    if (autoDismissMs <= 0) {
      return;
    }
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  const variantStyles = {
    error: {
      bg: "#fef2f2",
      container: "border-danger text-danger",
      dismiss: "text-danger hover:text-danger/70",
      testId: "toast-error-details",
    },
    warning: {
      bg: "#fef3c7",
      container: "border-warning-border text-warning-text",
      dismiss: "text-warning-text hover:text-warning-text/70",
      testId: "toast-warning-details",
    },
    success: {
      bg: "var(--color-success-bg)",
      container: "border-border-accent text-accent",
      dismiss: "text-accent hover:text-accent-hover",
      testId: "toast-success-details",
    },
    info: {
      bg: "var(--color-bg-card-alt)",
      container: "border-border text-text-primary",
      dismiss: "text-text-secondary hover:text-text-primary",
      testId: "toast-info-details",
    },
  } as const;

  const styles = variantStyles[variant];
  const placementClass =
    placement === "bottom-right"
      ? "bottom-4 right-4 w-[calc(100%-2rem)] max-w-md"
      : "top-4 left-4 right-4 mx-auto max-w-lg";

  return (
    <div
      role="alert"
      style={{ backgroundColor: styles.bg }}
      className={`fixed z-50 border-2 px-4 py-3 shadow-lg ${placementClass} ${styles.container}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 text-sm">
          <p className="font-medium">{message}</p>
          {details && details.length > 0 && (
            <ul className="mt-1 list-disc pl-5" data-testid={styles.testId}>
              {details.map((detail, index) => (
                <li key={`${detail}-${index}`}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 text-lg font-bold leading-none ${styles.dismiss}`}
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
