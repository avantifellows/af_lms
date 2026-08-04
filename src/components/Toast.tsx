"use client";

import { useEffect, useId } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

type ToastVariant = "error" | "warning" | "success" | "info";

interface ToastProps {
  variant: ToastVariant;
  message: string;
  details?: string[];
  onDismiss: () => void;
  autoDismissMs?: number;
  placement?: "top" | "bottom-right";
}

const variantConfig = {
  error: {
    icon: AlertCircle,
    iconClass: "text-danger",
    borderClass: "border-danger/30",
    accentClass: "bg-danger",
    titleClass: "text-danger",
    detailTestId: "toast-error-details",
  },
  warning: {
    icon: TriangleAlert,
    iconClass: "text-warning-text",
    borderClass: "border-warning-border/40",
    accentClass: "bg-warning-border",
    titleClass: "text-warning-text",
    detailTestId: "toast-warning-details",
  },
  success: {
    icon: CheckCircle2,
    iconClass: "text-success",
    borderClass: "border-success/30",
    accentClass: "bg-success",
    titleClass: "text-success",
    detailTestId: "toast-success-details",
  },
  info: {
    icon: Info,
    iconClass: "text-accent",
    borderClass: "border-border",
    accentClass: "bg-accent",
    titleClass: "text-text-primary",
    detailTestId: "toast-info-details",
  },
} as const;

function ToastCard({
  variant,
  message,
  details,
  onDismiss,
}: Pick<ToastProps, "variant" | "message" | "details" | "onDismiss">) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div
      role="alert"
      className={`relative w-full overflow-hidden rounded-lg border bg-bg-card shadow-lg ${config.borderClass}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${config.accentClass}`} />
      <div className="flex items-start gap-3 px-4 py-3 pl-5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${config.iconClass}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          <p className={`font-semibold leading-5 ${config.titleClass}`}>{message}</p>
          {details && details.length > 0 && (
            <ul
              className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text-secondary"
              data-testid={config.detailTestId}
            >
              {details.map((detail, index) => (
                <li key={`${detail}-${index}`}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 text-text-muted hover:bg-hover-bg hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function Toast({
  variant,
  message,
  details,
  onDismiss,
  autoDismissMs = 6000,
  placement = "top",
}: ToastProps) {
  const toastId = useId();

  useEffect(() => {
    if (process.env.NODE_ENV === "test") return;

    toast.custom(
      (id) => (
        <ToastCard
          variant={variant}
          message={message}
          details={details}
          onDismiss={() => {
            toast.dismiss(id);
            onDismiss();
          }}
        />
      ),
      {
        id: toastId,
        dismissible: false,
        duration: autoDismissMs > 0 ? autoDismissMs : Infinity,
        onAutoClose: onDismiss,
        position: placement === "bottom-right" ? "bottom-right" : "top-center",
      },
    );

  }, [autoDismissMs, details, message, onDismiss, placement, toastId, variant]);

  if (process.env.NODE_ENV === "test") {
    return (
      <div
        className={
          placement === "bottom-right"
            ? "fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-md"
            : "fixed left-4 right-4 top-4 z-50 mx-auto max-w-lg"
        }
      >
        <ToastCard variant={variant} message={message} details={details} onDismiss={onDismiss} />
      </div>
    );
  }

  return null;
}
