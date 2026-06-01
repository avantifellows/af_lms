import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { type ReactNode } from "react";

import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import CurriculumSummaryFiltersForm from "./CurriculumSummaryFiltersForm";
import CurriculumSummaryPageSizeSelect from "./CurriculumSummaryPageSizeSelect";
import CurriculumSummaryTableRows from "./CurriculumSummaryTableRows";
import {
  getCurriculumSummary,
  normalizeCurriculumSummaryPage,
  normalizeCurriculumSummaryPageSize,
  normalizeCurriculumSummarySearchParams,
  normalizeCurriculumSummarySort,
  type CurriculumSummaryDatePreset,
  type CurriculumSummaryChapterRow,
  type CurriculumSummaryFilterOptions,
  type CurriculumSummaryFilters,
  type CurriculumSummaryRow,
  type CurriculumSummarySortDirection,
  type CurriculumSummarySortKey,
} from "@/lib/curriculum-summary";
import {
  getFeatureAccess,
  getProgramContextSync,
  getUserPermission,
} from "@/lib/permissions";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const SORT_COLUMNS: Record<
  CurriculumSummarySortKey,
  { label: string; defaultDir: CurriculumSummarySortDirection }
> = {
  school: { label: "School", defaultDir: "asc" },
  program: { label: "Program", defaultDir: "asc" },
  grade: { label: "Grade", defaultDir: "asc" },
  subject: { label: "Subject", defaultDir: "asc" },
  exam_track: { label: "Exam Track", defaultDir: "asc" },
  completed: { label: "Completed", defaultDir: "asc" },
  prescribed: { label: "Prescribed", defaultDir: "asc" },
  delta: { label: "Delta %", defaultDir: "asc" },
  actual: { label: "Actual Hours", defaultDir: "asc" },
  flagged: { label: "Flagged", defaultDir: "desc" },
};

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
  const pageSize = normalizeCurriculumSummaryPageSize(resolvedSearchParams.limit);
  const summary = await getCurriculumSummary({
    actorEmail: email,
    permission,
    filters,
    sort,
    dir,
    page,
    pageSize,
    todayIstDate,
  });

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Curriculum Summary"
        subtitle="Read-only cross-school Curriculum Progress"
        backHref="/dashboard"
        userEmail={email}
        actions={
          permission.role === "admin" ? (
            <Link
              href="/curriculum-summary/config"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
            >
              Manage config
            </Link>
          ) : undefined
        }
        containerClassName="w-full px-4 py-3 sm:px-6 lg:px-8"
      />
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
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
        ) : summary.rowCountGuardTripped ? (
          <div className="space-y-5">
            <CurriculumSummaryFiltersCard
              filters={summary.activeFilters}
              options={summary.filterOptions}
            />
            <Card className="border-l-4 border-l-warning-border p-6">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-warning-text">
                  Too many rows
                </p>
                <h2 className="text-lg font-bold text-text-primary">
                  Narrow filters to load Curriculum Summary
                </h2>
                <p className="text-sm text-text-secondary">
                  More than 10,000 expected Curriculum Summary rows match the
                  current School, Program, Grade, Subject, Exam Track, and
                  geography filters. Narrow at least one filter to run the
                  detailed summary query.
                </p>
              </div>
            </Card>
          </div>
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
                <CurriculumSummaryTable
                  rows={summary.rows}
                  chapterRowsByParentKey={summary.chapterRowsByParentKey}
                  sort={summary.sort}
                  dir={summary.dir}
                  currentParams={resolvedSearchParams}
                />
              )}

              <CurriculumSummaryPagination
                currentPage={summary.currentPage}
                totalPages={summary.totalPages}
                pageSize={pageSize}
                currentParams={resolvedSearchParams}
              />
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
      <details open>
        <summary className="cursor-pointer text-sm font-bold text-text-primary">
          Filters
        </summary>
        <CurriculumSummaryFiltersForm
          key={JSON.stringify(filters)}
          filters={filters}
          options={options}
        />
      </details>
    </Card>
  );
}

function CurriculumSummaryTable({
  rows,
  chapterRowsByParentKey,
  sort,
  dir,
  currentParams,
}: {
  rows: CurriculumSummaryRow[];
  chapterRowsByParentKey: Record<string, CurriculumSummaryChapterRow[]>;
  sort: CurriculumSummarySortKey;
  dir: CurriculumSummarySortDirection;
  currentParams: Record<string, string | undefined>;
}) {
  const headers: Array<
    | { label: string; sortKey: CurriculumSummarySortKey }
    | { label: string; sortKey?: undefined }
  > = [
    { label: "School", sortKey: "school" },
    { label: "Program", sortKey: "program" },
    { label: "Grade", sortKey: "grade" },
    { label: "Subject", sortKey: "subject" },
    { label: "Exam Track", sortKey: "exam_track" },
    { label: "Completed", sortKey: "completed" },
    { label: "Prescribed", sortKey: "prescribed" },
    { label: "Delta %", sortKey: "delta" },
    { label: "Lecture vs prescribed", sortKey: "actual" },
    { label: "Flagged", sortKey: "flagged" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted">
          <tr>
            {headers.map((header) => (
              <th
                key={header.label}
                scope="col"
                className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted"
              >
                {header.sortKey ? (
                  <SortHeader
                    column={header.sortKey}
                    currentSort={sort}
                    currentDir={dir}
                    currentParams={currentParams}
                  >
                    {header.label}
                  </SortHeader>
                ) : (
                  header.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <CurriculumSummaryTableRows
          rows={rows}
          chapterRowsByParentKey={chapterRowsByParentKey}
        />
      </table>
    </div>
  );
}

function SortHeader({
  column,
  currentSort,
  currentDir,
  currentParams,
  children,
}: {
  column: CurriculumSummarySortKey;
  currentSort: CurriculumSummarySortKey;
  currentDir: CurriculumSummarySortDirection;
  currentParams: Record<string, string | undefined>;
  children: ReactNode;
}) {
  const active = currentSort === column;
  const nextDir: CurriculumSummarySortDirection = active
    ? currentDir === "asc"
      ? "desc"
      : "asc"
    : SORT_COLUMNS[column].defaultDir;
  const indicator = active ? (currentDir === "asc" ? "↑" : "↓") : "";

  return (
    <Link
      href={sortHref(column, nextDir, currentParams)}
      className="inline-flex items-center gap-1 text-text-muted hover:text-text-primary"
    >
      <span>
        {children}
        {indicator ? ` ${indicator}` : ""}
      </span>
    </Link>
  );
}

function sortHref(
  column: CurriculumSummarySortKey,
  dir: CurriculumSummarySortDirection,
  currentParams: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (value && key !== "sort" && key !== "dir" && key !== "page") {
      params.set(key, value);
    }
  }
  params.set("sort", column);
  params.set("dir", dir);
  return `/curriculum-summary?${params.toString()}`;
}

function CurriculumSummaryPagination({
  currentPage,
  totalPages,
  pageSize,
  currentParams,
}: {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  currentParams: Record<string, string | undefined>;
}) {
  const displayTotalPages = totalPages || 1;
  const hasPrevious = currentPage > 1;
  const hasNext = totalPages > 0 && currentPage < totalPages;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between">
      <span>
        Page {currentPage} of {displayTotalPages}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CurriculumSummaryPageSizeSelect
          currentParams={currentParams}
          pageSize={pageSize}
        />
        {hasPrevious ? (
          <Link
            href={pageHref(currentPage - 1, currentParams)}
            className="rounded-md border border-border px-3 py-1.5 font-bold text-accent hover:text-accent-hover"
          >
            Previous
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1.5 font-bold text-text-muted">
            Previous
          </span>
        )}
        {hasNext ? (
          <Link
            href={pageHref(currentPage + 1, currentParams)}
            className="rounded-md border border-border px-3 py-1.5 font-bold text-accent hover:text-accent-hover"
          >
            Next
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1.5 font-bold text-text-muted">
            Next
          </span>
        )}
      </div>
    </div>
  );
}

function pageHref(
  page: number,
  currentParams: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (value && key !== "page") {
      params.set(key, value);
    }
  }
  params.set("page", String(page));
  return `/curriculum-summary?${params.toString()}`;
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

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
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
