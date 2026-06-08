"use client";

import {
  GraduationCap,
  Users,
  UserCheck,
  ClipboardCheck,
  FileCheck2,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui";
import {
  ADMISSION_GRADES,
  type AdmissionSummary,
} from "@/lib/enrollment-readiness";

interface Props {
  /** Combined figures across all admission grades. */
  combined: AdmissionSummary;
  /** Per-grade breakdown, one entry per admission grade. */
  perGrade: { grade: number; summary: AdmissionSummary }[];
  /** True while consent data is still being fetched. */
  loading?: boolean;
  /** Set when the consent fetch failed; consent metrics fall back to 0. */
  error?: boolean;
}

const DASH = "—";
const gradeList = ADMISSION_GRADES.join(" & ");

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card-alt px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium uppercase tracking-wide text-text-muted">
          {label}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold text-text-primary">{value}</span>
          {hint && <span className="text-xs text-text-muted">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

export default function AdmissionReadinessCard({
  combined,
  perGrade,
  loading = false,
  error = false,
}: Props) {
  return (
    <Card elevation="md" className="mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
        <GraduationCap className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="text-base font-semibold text-text-primary">
          Admission Tracking
        </h2>
        <span className="rounded-full border border-border bg-bg-card-alt px-2 py-0.5 text-xs font-medium text-text-muted">
          Grades {gradeList}
        </span>
        <span className="ml-auto text-xs">
          {loading ? (
            <span className="text-text-muted">Loading consent…</span>
          ) : error ? (
            <span className="text-danger">Consent data unavailable</span>
          ) : null}
        </span>
      </div>

      {/* Combined headline metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label="Total Students" value={String(combined.total)} />
        <Stat
          icon={UserCheck}
          label="Reported"
          value={loading ? DASH : String(combined.reported)}
          hint={loading ? undefined : `of ${combined.total}`}
        />
        <Stat
          icon={ClipboardCheck}
          label="% Info Available"
          value={`${combined.infoAvailablePct}%`}
        />
        <Stat
          icon={FileCheck2}
          label="% Documents Available"
          value={loading ? DASH : `${combined.docsAvailablePct}%`}
        />
      </div>

      {/* Per-grade breakdown */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {perGrade.map(({ grade, summary }) => (
            <div
              key={grade}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-bg-card-alt px-4 py-2.5 text-sm"
            >
              <span className="font-semibold text-text-primary">
                Grade {grade}
              </span>
              <span className="text-text-muted">
                {summary.total} student{summary.total === 1 ? "" : "s"}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                <span>
                  Reported{" "}
                  <span className="font-bold text-text-primary">
                    {loading ? DASH : summary.reported}
                  </span>
                </span>
                <span>
                  Info{" "}
                  <span className="font-bold text-text-primary">
                    {summary.infoAvailablePct}%
                  </span>
                </span>
                <span>
                  Docs{" "}
                  <span className="font-bold text-text-primary">
                    {loading ? DASH : `${summary.docsAvailablePct}%`}
                  </span>
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
