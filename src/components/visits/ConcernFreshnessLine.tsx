import type { ConcernFreshness } from "@/lib/visit-concerns";
import { formatIstTimestamp, formatVisitCount } from "@/lib/visit-summary";

// How fresh the Visit Concerns are (#470): the latest summary run and the completed Visits in view
// still waiting for one. Shared by the School-wise tab and the School page.
export function ConcernFreshnessLine({ freshness }: { freshness: ConcernFreshness }) {
  return (
    <p className="text-xs text-text-muted">
      {freshness.summarisedUpTo
        ? `Visit notes summarised up to ${formatIstTimestamp(freshness.summarisedUpTo)} · ${formatVisitCount(freshness.waitingVisits)} waiting`
        : "Visit notes haven't been summarised yet"}
    </p>
  );
}
