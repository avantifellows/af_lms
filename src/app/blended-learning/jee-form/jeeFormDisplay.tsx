import { Badge } from "@/components/ui";
import { formatCalendarDate } from "@/lib/blended-learning-format";
import {
  jeeFormReasonLabel,
  type JeeFormStatusSummary,
  type JeeFormUpdate,
} from "@/lib/blended-learning-jee-form-input";

// How a JEE form status reads wherever it is shown: the JEE Form tab's rows
// and the Mentee page's status line. No hooks, so server and client
// components both use it. Each takes the whole update or a view-only status
// summary (JeeFormStatusSummary: no application number).

// The current update or status, as either shape carries it.
type CurrentStatus = (JeeFormStatusSummary & { applicationNumber?: string | null }) | null;

const JEE_TAB_PATH = "/blended-learning/jee-form";

// The JEE Form tab opened on one Student's row.
export function jeeTabHref(studentId: number): string {
  return `${JEE_TAB_PATH}?student=${studentId}`;
}

export function JeeStatusBadge({ current }: { current: CurrentStatus }) {
  if (!current) return <Badge>Not recorded</Badge>;
  return current.status === "filled" ? (
    <Badge className="bg-success-bg font-bold text-success">Filled</Badge>
  ) : (
    <Badge className="bg-warning-bg font-bold text-warning-text">Not filled</Badge>
  );
}

function reasonsText(update: Pick<JeeFormUpdate, "reasons">): string {
  return update.reasons.map(jeeFormReasonLabel).join("; ");
}

// "Filled · 2703…" or "Not filled · reason; reason", for history lines.
export function updateSummary(update: JeeFormUpdate): string {
  if (update.status === "filled") return `Filled · ${update.applicationNumber}`;
  return `Not filled · ${reasonsText(update)}`;
}

// The application number and the exam record's sessions applied (Filled) or
// the reasons (Not filled), on one line. A view-only status has neither the
// number nor the sessions, so Filled shows nothing more.
export function JeeStatusDetail({
  current,
  sessionsApplied = [],
}: {
  current: CurrentStatus;
  sessionsApplied?: number[];
}) {
  if (!current) return null;
  if (current.status === "filled") {
    if (!current.applicationNumber && sessionsApplied.length === 0) return null;
    return (
      <span className="min-w-0 break-words text-text-primary">
        {current.applicationNumber && (
          <>
            <span className="text-text-muted">App no. </span>
            <span className="font-mono">{current.applicationNumber}</span>
          </>
        )}
        {current.applicationNumber && sessionsApplied.length > 0 && " · "}
        {sessionsApplied.length > 0 && (
          <>
            <span className="text-text-muted">{sessionsApplied.length === 1 ? "Session " : "Sessions "}</span>
            <span className="font-mono">{sessionsApplied.join(", ")}</span>
          </>
        )}
      </span>
    );
  }
  return <span className="min-w-0 break-words text-text-primary">{reasonsText(current)}</span>;
}

export function RecordedOn({ current }: { current: Pick<JeeFormStatusSummary, "recordedOn"> | null }) {
  if (!current) return null;
  return (
    <span className="text-xs text-text-muted">
      Recorded <span className="font-mono">{formatCalendarDate(current.recordedOn)}</span>
    </span>
  );
}
