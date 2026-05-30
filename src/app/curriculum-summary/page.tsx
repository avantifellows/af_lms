import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import {
  getCurriculumSummary,
  normalizeCurriculumSummaryPage,
  normalizeCurriculumSummarySearchParams,
  normalizeCurriculumSummarySort,
  type CurriculumSummaryDatePreset,
  type CurriculumSummaryFilterOptions,
  type CurriculumSummaryFilters,
  type CurriculumSummaryRow,
} from "@/lib/curriculum-summary";
import {
  getFeatureAccess,
  getProgramContextSync,
  getUserPermission,
} from "@/lib/permissions";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function CurriculumSummaryPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const session = await getServerSession(authOptions);

  if (session?.isPasscodeUser) {
    redirect(session.schoolCode ? `/school/${session.schoolCode}` : "/dashboard");
  }

  if (!session?.user?.email) {
    redirect("/");
  }

  const email = session.user.email;
  const permission = await getUserPermission(email);

  if (!permission) {
    redirect("/dashboard");
  }

  if (
    permission.role !== "program_manager" &&
    permission.role !== "program_admin" &&
    permission.role !== "admin"
  ) {
    redirect("/dashboard");
  }

  if (!getFeatureAccess(permission, "curriculum").canView) {
    redirect("/dashboard");
  }

  const programContext = getProgramContextSync(permission);
  if (!programContext.hasCoEOrNodal) {
    redirect("/dashboard");
  }

  const todayIstDate = getTodayIST();
  const filters = normalizeCurriculumSummarySearchParams(
    resolvedSearchParams,
    todayIstDate
  );
  const { sort, dir } = normalizeCurriculumSummarySort(
    resolvedSearchParams.sort,
    resolvedSearchParams.dir
  );
  const page = normalizeCurriculumSummaryPage(resolvedSearchParams.page);
  const summary = await getCurriculumSummary({
    actorEmail: email,
    permission,
    filters,
    sort,
    dir,
    page,
    pageSize: 10,
    todayIstDate,
  });

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Curriculum Summary"
        subtitle="Read-only cross-school Curriculum Progress"
        backHref="/dashboard"
        userEmail={email}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {!summary.ok ? (
          <Card className="border-l-4 border-l-warning-border p-6">
            <div className="flex flex-col gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-warning-text">
                Schema unavailable
              </p>
              <h2 className="text-lg font-bold text-text-primary">
                {summary.error}
              </h2>
              <p className="text-sm text-text-secondary">
                Curriculum Summary is read-only and cannot load until the LMS
                Curriculum schema is available.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm font-mono text-text-secondary">
                {summary.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
          </Card>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <StatCard label="Total Rows" value={summary.stats.totalRows} size="sm" />
              <StatCard label="Flagged Rows" value={summary.stats.flaggedRows} size="sm" />
              <StatCard
                label="Avg Completion"
                value={formatPercent(summary.stats.avgCompletionPercent)}
                size="sm"
              />
              <StatCard
                label="Avg Prescribed"
                value={formatPercent(summary.stats.avgPrescribedPercent)}
                size="sm"
              />
              <StatCard
                label="Actual Hours"
                value={formatHours(summary.stats.actualMinutes)}
                size="sm"
              />
              <StatCard
                label="Prescribed Hours"
                value={formatHours(summary.stats.prescribedMinutes)}
                size="sm"
              />
            </div>

            <CurriculumSummaryFiltersCard
              filters={summary.activeFilters}
              options={summary.filterOptions}
            />

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
                    Read only
                  </p>
                  <h2 className="text-lg font-bold text-text-primary">
                    Expected Curriculum Summary rows
                  </h2>
                  <p className="text-sm text-text-secondary">
                    {formatDateRange(summary.activeFilters)}
                  </p>
                  <p className="mt-1 max-w-3xl text-xs text-text-muted">
                    Top-level Actual Hours use raw LMS Curriculum Log duration
                    for the selected date range and may include time that is
                    not visible in current in-syllabus chapter expansion.
                  </p>
                </div>
                <Link
                  href="/dashboard"
                  className="inline-flex w-fit text-sm font-bold text-accent hover:text-accent-hover"
                >
                  Back to schools
                </Link>
              </div>

              {summary.rows.length === 0 ? (
                <div className="px-4 py-10 text-sm text-text-secondary">
                  No Curriculum Summary rows match the selected filters.
                </div>
              ) : (
                <CurriculumSummaryTable rows={summary.rows} />
              )}

              <div className="border-t border-border px-4 py-3 text-sm text-text-secondary">
                Page {summary.currentPage} of {summary.totalPages || 1}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function CurriculumSummaryFiltersCard({
  filters,
  options,
}: {
  filters: CurriculumSummaryFilters;
  options: CurriculumSummaryFilterOptions;
}) {
  return (
    <Card className="p-4">
      <form action="/curriculum-summary" method="get" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <FilterField
            label="Schools"
            name="schools"
            value={filters.schools.join(",")}
            placeholder={options.schools.map((school) => school.code).join(",")}
          />
          <FilterField
            label="Programs"
            name="programs"
            value={filters.programs.join(",")}
            placeholder={options.programs.map((program) => String(program.id)).join(",")}
          />
          <FilterField
            label="Grades"
            name="grades"
            value={filters.grades.join(",")}
            placeholder={options.grades.join(",")}
          />
          <FilterField
            label="Subjects"
            name="subjects"
            value={filters.subjects.join(",")}
            placeholder={options.subjects.map((subject) => String(subject.id)).join(",")}
          />
          <FilterField
            label="Exam Track"
            name="exam_tracks"
            value={filters.examTracks.join(",")}
            placeholder={options.examTracks.join(",")}
          />
          <FilterField
            label="Regions"
            name="regions"
            value={filters.regions.join(",")}
            placeholder={options.regions.join(",")}
          />
          <FilterField
            label="States"
            name="states"
            value={filters.states.join(",")}
            placeholder={options.states.join(",")}
          />
          <FilterField
            label="Districts"
            name="districts"
            value={filters.districts.join(",")}
            placeholder={options.districts.join(",")}
          />
          <label className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
            Date preset
            <select
              name="preset"
              defaultValue={filters.preset}
              className="rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
            >
              <option value="today">Today</option>
              <option value="last_7_days">Last 7 days</option>
              <option value="last_30_days">Last 30 days</option>
              <option value="current_academic_year">Current academic year</option>
              <option value="all">All dates</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <FilterField label="From" name="from" value={filters.from ?? ""} />
          <FilterField label="To" name="to" value={filters.to ?? ""} />
          <label className="flex items-center gap-2 pt-6 text-sm font-medium text-text-secondary">
            <input
              type="checkbox"
              name="flagged"
              value="true"
              defaultChecked={filters.flagged}
              className="h-4 w-4 rounded border-border text-accent"
            />
            Only flagged
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
          >
            Apply filters
          </button>
          <Link
            href="/curriculum-summary"
            className="text-sm font-bold text-accent hover:text-accent-hover"
          >
            Clear filters
          </Link>
        </div>
      </form>
    </Card>
  );
}

function FilterField({
  label,
  name,
  value,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
      {label}
      <input
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        className="rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
      />
    </label>
  );
}

function CurriculumSummaryTable({ rows }: { rows: CurriculumSummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted">
          <tr>
            {[
              "School",
              "Program",
              "Grade",
              "Subject",
              "Exam Track",
              "Completed",
              "Prescribed",
              "Delta %",
              "Lecture vs prescribed",
              "Flagged",
            ].map((header) => (
              <th
                key={header}
                scope="col"
                className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-bg-card">
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td className="whitespace-nowrap px-4 py-3 font-medium text-text-primary">
                <span>{row.schoolName}</span>{" "}
                <span className="text-text-muted">{row.schoolCode}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {row.programName}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {row.grade}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {row.subjectName}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatExamTrack(row.examTrack)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatCoverage(row.completedChapters, row.totalConfiguredChapters)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatCoverage(row.prescribedChapters, row.totalConfiguredChapters)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatDelta(row.deltaPercent)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                {formatHours(row.actualMinutes)} / {formatHours(row.prescribedMinutes)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-text-primary">
                <div className="flex max-w-xs flex-col gap-1">
                  <span className={row.flagged ? "font-bold text-danger" : ""}>
                    {row.flagged ? "Yes" : "No"}
                  </span>
                  {row.flagReasons.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {row.flagReasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded border border-warning-border bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-text"
                        >
                          {formatFlagReason(reason)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDateRange(filters: CurriculumSummaryFilters): string {
  const label = formatPreset(filters.preset);
  if (!filters.from && !filters.to) {
    return `${label}: all dates`;
  }
  return `${label}: ${filters.from ?? "—"} to ${filters.to ?? "—"}`;
}

function formatPreset(preset: CurriculumSummaryDatePreset): string {
  switch (preset) {
    case "today":
      return "Today";
    case "last_7_days":
      return "Last 7 days";
    case "last_30_days":
      return "Last 30 days";
    case "all":
      return "All dates";
    case "custom":
      return "Custom";
    default:
      return "Current academic year";
  }
}

function formatExamTrack(track: string): string {
  if (track === "jee_main") return "JEE Main";
  if (track === "jee_advanced") return "JEE Advanced";
  if (track === "neet") return "NEET";
  return track;
}

function formatCoverage(count: number, total: number): string {
  const pct = total > 0 ? ` (${formatPercent((count / total) * 100)})` : "";
  return `${count}/${total}${pct}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatDelta(value: number | null): string {
  return formatPercent(value);
}

function formatHours(minutes: number): string {
  if (minutes <= 0) {
    return "0h";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function formatFlagReason(reason: string): string {
  switch (reason) {
    case "under_prescribed_hours":
      return "Under prescribed hours";
    case "over_prescribed_hours":
      return "Over prescribed hours";
    case "completion_below_prescribed_coverage":
      return "Completion below prescribed coverage";
    case "actual_time_on_zero_prescribed_minutes":
      return "Actual time on zero prescribed minutes";
    default:
      return reason;
  }
}
