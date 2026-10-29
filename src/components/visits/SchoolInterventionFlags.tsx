import Link from "next/link";

import { Card } from "@/components/ui";
import { formatIstDate } from "@/lib/visit-summary";
import type { VisitSummaryFlagRow, VisitSummaryFlags } from "@/lib/visit-summary-school";

// The School page's Intervention flags section (#470): the School's open flags (JNV NVS ones never
// reach it), one row each with the Student's initials (full name on hover) and a "Notes in LMS"
// link that opens that Student's flag on an Enrollment tab the viewer can open (the School's, or
// for a Centre-seated PM their Centre's; the server picks it). With none, the row has no link.

// "Asha Rani Verma" → "A. R. V.".
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(" ");
}

function FlagRow({ flag }: { flag: VisitSummaryFlagRow }) {
  const initials = initialsOf(flag.studentName);
  const gradeAndCentre = [flag.grade !== null ? `G${flag.grade}` : null, flag.centreTag].filter(Boolean).join(" ");
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
      <span className="rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-warning-text">
        Open
      </span>
      <span className="font-bold text-text-primary" title={flag.studentName}>
        {initials}
      </span>
      {gradeAndCentre && <span className="text-text-secondary">{gradeAndCentre}</span>}
      <span className="text-text-muted">
        Raised by {flag.raisedBy} · {formatIstDate(flag.raisedAt)}
      </span>
      {flag.updateCount > 1 && <span className="text-xs font-bold text-text-secondary">{flag.updateCount} updates</span>}
      {flag.notesHref && (
        <Link
          href={flag.notesHref}
          aria-label={`Notes in LMS for ${initials}`}
          className="ml-auto text-xs font-bold uppercase tracking-wide text-accent hover:text-accent-hover"
        >
          Notes in LMS <span aria-hidden>↗</span>
        </Link>
      )}
    </li>
  );
}

export function SchoolInterventionFlags({ flags }: { flags: VisitSummaryFlags }) {
  return (
    <section aria-labelledby="intervention-flags-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5 text-sm font-bold uppercase tracking-wider text-warning-text">
          <span aria-hidden>⚑</span>
          <h2 id="intervention-flags-heading">Intervention flags</h2>
        </div>
        <span className="text-sm text-text-muted">
          {flags.open.length} open
          {flags.resolvedCount > 0 && ` · ${flags.resolvedCount} resolved`}
        </span>
      </div>
      <Card elevation="sm">
        {flags.open.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-muted">No open flags</p>
        ) : (
          <ul className="divide-y divide-border">
            {flags.open.map((flag) => (
              <FlagRow key={flag.id} flag={flag} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
