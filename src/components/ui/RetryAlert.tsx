import type { ReactNode } from "react";

import { Button } from "./Button";

/** A failed load or save: what went wrong, and a button to try again ("Retry" unless named otherwise). */
export function RetryAlert({
  children,
  onRetry,
  retryLabel = "Retry",
}: {
  children: ReactNode;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger bg-danger-bg p-4">
      <p className="text-sm text-text-primary">{children}</p>
      <Button variant="secondary" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
