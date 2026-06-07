"use client";

import { Card } from "@/components/ui";
import { ADMISSION_GRADE, type AdmissionSummary } from "@/lib/enrollment-readiness";

interface Props {
  summary: AdmissionSummary;
  /** True while consent data is still being fetched. */
  loading?: boolean;
  /** Set when the consent fetch failed; metrics fall back to 0 / not reported. */
  error?: boolean;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-card-alt px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-text-primary">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-text-muted">{hint}</div>}
    </div>
  );
}

export default function AdmissionReadinessCard({
  summary,
  loading = false,
  error = false,
}: Props) {
  const { total, reported, infoAvailablePct, docsAvailablePct } = summary;
  const dash = "—";

  return (
    <Card elevation="md" className="mx-auto mb-4 max-w-3xl p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-text-primary">
          Grade {ADMISSION_GRADE} Admission Tracking
        </h2>
        {loading && (
          <span className="text-xs text-text-muted">Loading consent…</span>
        )}
        {error && !loading && (
          <span className="text-xs text-danger">
            Consent data unavailable
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Students" value={String(total)} />
        <Stat
          label="Reported"
          value={loading ? dash : String(reported)}
          hint={loading ? undefined : `of ${total}`}
        />
        <Stat
          label="% Info Available"
          value={`${infoAvailablePct}%`}
        />
        <Stat
          label="% Documents Available"
          value={loading ? dash : `${docsAvailablePct}%`}
        />
      </div>
    </Card>
  );
}
