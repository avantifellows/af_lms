import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";

import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import {
  getCurriculumConfigList,
  normalizeCurriculumConfigListParams,
  requireCurriculumConfigAdmin,
  type CurriculumConfigListResult,
  type CurriculumConfigSyllabusStatus,
} from "@/lib/curriculum-config";
import type { ExamTrack } from "@/types/curriculum";
import CurriculumConfigTable from "./CurriculumConfigTable";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const EXAM_TRACK_OPTIONS: Array<{ value: ExamTrack; label: string }> = [
  { value: "jee_main", label: "JEE Main" },
  { value: "jee_advanced", label: "JEE Advanced" },
  { value: "neet", label: "NEET" },
];

const SYLLABUS_STATUS_OPTIONS: Array<{
  value: CurriculumConfigSyllabusStatus;
  label: string;
}> = [
  { value: "in_syllabus", label: "In syllabus" },
  { value: "out_of_syllabus", label: "Out of syllabus" },
  { value: "all", label: "All" },
];

export default async function CurriculumConfigPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumConfigAdmin(session);

  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  const params = normalizeCurriculumConfigListParams(resolvedSearchParams);
  const result = await getCurriculumConfigList(params);

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Curriculum Config"
        subtitle="Manage global LMS Chapter Exam Config rows"
        backHref="/curriculum-summary"
        userEmail={access.email}
        containerClassName="w-full px-4 py-3 sm:px-6 lg:px-8"
      />
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        {!result.ok ? (
          <SchemaUnavailable result={result} />
        ) : (
          <div className="space-y-5">
            <ConfigFilters result={result} />
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
                    Editable
                  </p>
                  <h2 className="text-lg font-bold text-text-primary">
                    LMS Chapter Exam Config rows
                  </h2>
                  <p className="text-sm text-text-secondary">
                    {result.totalRowCount} row{result.totalRowCount === 1 ? "" : "s"} matching current filters
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text-muted"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Export
                  </button>
                </div>
              </div>

              <CurriculumConfigTable
                rows={result.rows}
                activeFilters={result.activeFilters}
              />

              <ConfigPagination result={result} />
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function SchemaUnavailable({
  result,
}: {
  result: Extract<CurriculumConfigListResult, { ok: false }>;
}) {
  return (
    <Card className="border-l-4 border-l-warning-border p-6">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-warning-text">
          Schema unavailable
        </p>
        <h2 className="text-lg font-bold text-text-primary">{result.error}</h2>
        <p className="text-sm text-text-secondary">
          Curriculum Config cannot load until the LMS Chapter Exam Config
          management columns are available.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm font-mono text-text-secondary">
          {result.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function ConfigFilters({
  result,
}: {
  result: Extract<CurriculumConfigListResult, { ok: true }>;
}) {
  return (
    <Card className="p-4">
      <form
        action="/curriculum-summary/config"
        className="grid gap-4 md:grid-cols-6"
      >
        <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
          Exam Track
          <select
            name="exam_track"
            defaultValue={result.activeFilters.examTrack}
            className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
          >
            {EXAM_TRACK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
          Grade
          <select
            name="grade"
            defaultValue={result.activeFilters.grade ?? ""}
            className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
          >
            <option value="">All</option>
            {result.filterOptions.grades.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
          Subject
          <select
            name="subject"
            defaultValue={result.activeFilters.subject ?? ""}
            className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
          >
            <option value="">All</option>
            {result.filterOptions.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
          Syllabus status
          <select
            name="syllabus_status"
            defaultValue={result.activeFilters.syllabusStatus}
            className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
          >
            {SYLLABUS_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-text-primary md:col-span-2">
          Chapter search
          <input
            name="search"
            defaultValue={result.activeFilters.search}
            className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
            placeholder="Code or name"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
          Rows per page
          <select
            name="limit"
            defaultValue={result.limit}
            className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary"
          >
            {[10, 20, 50, 100].map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-3 md:col-span-5">
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
          >
            Apply filters
          </button>
          <Link
            href="/curriculum-summary/config"
            className="text-sm font-bold text-accent hover:text-accent-hover"
          >
            Clear filters
          </Link>
        </div>
      </form>
    </Card>
  );
}

function ConfigPagination({
  result,
}: {
  result: Extract<CurriculumConfigListResult, { ok: true }>;
}) {
  const displayTotalPages = result.totalPages || 1;
  const hasPrevious = result.currentPage > 1;
  const hasNext = result.totalPages > 0 && result.currentPage < result.totalPages;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between">
      <span>
        Page {result.currentPage} of {displayTotalPages}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasPrevious ? (
          <Link
            href={pageHref(result.currentPage - 1, result)}
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
            href={pageHref(result.currentPage + 1, result)}
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
  result: Extract<CurriculumConfigListResult, { ok: true }>
): string {
  const params = new URLSearchParams();
  params.set("exam_track", result.activeFilters.examTrack);
  if (result.activeFilters.grade) params.set("grade", String(result.activeFilters.grade));
  if (result.activeFilters.subject) params.set("subject", result.activeFilters.subject);
  if (result.activeFilters.search) params.set("search", result.activeFilters.search);
  params.set("syllabus_status", result.activeFilters.syllabusStatus);
  params.set("limit", String(result.limit));
  params.set("sort", result.sort);
  params.set("dir", result.dir);
  params.set("page", String(page));
  return `/curriculum-summary/config?${params.toString()}`;
}
