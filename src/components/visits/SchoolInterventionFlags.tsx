import Link from "next/link";

import { Badge, Card } from "@/components/ui";
import { formatIstDate } from "@/lib/visit-summary";
import type { VisitSummaryFlagRow, VisitSummaryFlags } from "@/lib/visit-summary-school";

// The School page's Intervention flags section (#470): the School's open flags (JNV NVS ones never
// reach it), each opening that Student's flag on the School's Enrollment tab.

function FlagRow({ schoolCode, flag }: { schoolCode: string; flag: VisitSummaryFlagRow }) {
  const params = new URLSearchParams({ tab: "enrollment", flag: String(flag.id) });
  return (
    <li>
      <Link
        href={`/school/${encodeURIComponent(schoolCode)}?${params.toString()}`}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-border bg-bg-card p-3 text-sm hover:border-accent"
      >
        <Badge variant="danger">Open</Badge>
        <span className="font-medium text-text-primary">{flag.studentName}</span>
        {flag.grade !== null && <span className="text-text-secondary">Grade {flag.grade}</span>}
        {flag.centreTag && (
          <span className="inline-flex border border-border bg-bg-card-alt px-1.5 py-0.5 text-xs font-bold uppercase text-text-secondary">
            {flag.centreTag}
          </span>
        )}
        <span className="text-xs text-text-muted">
          Raised by {flag.raisedBy} on {formatIstDate(flag.raisedAt)}
        </span>
        {flag.updateCount > 1 && <span className="text-xs font-bold text-text-secondary">{flag.updateCount} updates</span>}
      </Link>
    </li>
  );
}

export function SchoolInterventionFlags({ schoolCode, flags }: { schoolCode: string; flags: VisitSummaryFlags }) {
  return (
    <Card elevation="sm" className="p-4">
      <section aria-labelledby="intervention-flags-heading" className="space-y-3">
        <span className="flex items-baseline gap-2">
          <h2 id="intervention-flags-heading" className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Intervention flags
          </h2>
          <span className="text-xs text-text-muted">
            {flags.open.length} open
            {flags.resolvedCount > 0 && ` · ${flags.resolvedCount} resolved`}
          </span>
        </span>
        {flags.open.length === 0 ? (
          <p className="text-sm text-text-muted">No open flags</p>
        ) : (
          <ul className="space-y-2">
            {flags.open.map((flag) => (
              <FlagRow key={flag.id} schoolCode={schoolCode} flag={flag} />
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
