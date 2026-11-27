import type { ReactNode } from "react";

import { Button } from "./Button";

/** A failed load: what could not be loaded, and Retry. */
export function RetryAlert({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger bg-danger-bg p-4">
      <p className="text-sm text-text-primary">{children}</p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
