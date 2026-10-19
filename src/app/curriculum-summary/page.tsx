import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import { Badge, Card, type BadgeVariant } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import type { BehindPillTone } from "@/lib/curriculum-plan-rules";
import CurriculumSummaryPageSizeSelect from "./CurriculumSummaryPageSizeSelect";
import {
  CURRICULUM_SUMMARY_GRADES,
  CURRICULUM_SUMMARY_SUBJECTS,
  getCurriculumSummary,
  normalizeCurriculumSummarySearchParams,
  type CurriculumSummaryQuery,
  type CurriculumSummaryRow,
} from "@/lib/curriculum-summary";
import {
  getFeatureAccess,
  getProgramContextSync,
  getResolvedPermission,
} from "@/lib/permissions";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const TONE_BADGE_VARIANTS: Record<BehindPillTone, BadgeVariant> = {
  green: "success",
  amber: "warning",
  red: "danger",
};

export default async function CurriculumSummaryPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const email = session.user.email;
  const permission = await getResolvedPermission(email);

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

  const params = normalizeCurriculumSummarySearchParams(resolvedSearchParams, getTodayIST());
  const summary = await getCurriculumSummary(permission, params);

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Curriculum Summary"
        subtitle="Each class's progress against its Curriculum Plan"
        backHref="/dashboard"
        userEmail={email}
        actions={
          permission.role === "admin" ? (
            <div className="flex items-center gap-2">
              <Link
                href="/curriculum-summary/plans"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
              >
                Plans
              </Link>
              <Link
                href="/curriculum-summary/config"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
              >
                Manage config
              </Link>
            </div>
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
              <h2 className="text-lg font-bold text-text-primary">{summary.error}</h2>
              <p className="text-sm text-text-secondary">
                Curriculum Summary is read-only and cannot load until the LMS Curriculum and
                Curriculum Plan schema is available.
              </p>
              <ul className="list-disc space-y-1 pl-5 font-mono text-sm text-text-secondary">
                {summary.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
          </Card>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <HeaderNumber
                label="Centres on plan"
                value={`${summary.header.centresOnPlan}/${summary.header.centresTotal}`}
                testId="summary-centres-on-plan"
              />
              <HeaderNumber
                label="Chapters behind"
                value={String(summary.header.chaptersBehind)}
                testId="summary-chapters-behind"
              />
            </div>

            <SummaryFilters params={params} />

            <Card className="overflow-hidden">
              {summary.rows.length === 0 ? (
                <div className="px-4 py-10 text-sm text-text-secondary">
                  No Centres with Exam Tracks for Grade {params.grade} are in your scope.
                </div>
              ) : (
                <SummaryTable rows={summary.rows} params={params} />
              )}
              <SummaryPagination
                page={summary.pagination.page}
                totalPages={summary.pagination.totalPages}
                params={params}
              />
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function HeaderNumber({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card elevation="sm" className="p-3 sm:p-4">
      <span className="block text-xs uppercase tracking-wider text-text-muted">{label}</span>
      <span data-testid={testId} className="mt-1 block font-mono text-2xl font-bold text-text-primary">
        {value}
      </span>
    </Card>
  );
}

function summaryHref(
  params: CurriculumSummaryQuery,
  overrides: { grade?: number; page?: number } = {}
): string {
  const search = new URLSearchParams({
    grade: String(overrides.grade ?? params.grade),
    as_of: params.asOf,
  });
  if (params.pageSize !== 20) search.set("limit", String(params.pageSize));
  if (overrides.page && overrides.page > 1) search.set("page", String(overrides.page));
  return `/curriculum-summary?${search.toString()}`;
}

function SummaryFilters({ params }: { params: CurriculumSummaryQuery }) {
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted">Grade</span>
        <nav aria-label="Grade" className="flex gap-1">
          {CURRICULUM_SUMMARY_GRADES.map((grade) => (
            <Link
              key={grade}
              href={summaryHref(params, { grade })}
              aria-current={params.grade === grade ? "page" : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm font-bold ${
                params.grade === grade
                  ? "border-accent bg-accent text-white"
                  : "border-border text-accent hover:text-accent-hover"
              }`}
            >
              Grade {grade}
            </Link>
          ))}
        </nav>
      </div>
      <form action="/curriculum-summary" className="flex items-end gap-2">
        <input type="hidden" name="grade" value={params.grade} />
        {params.pageSize !== 20 ? (
          <input type="hidden" name="limit" value={params.pageSize} />
        ) : null}
        <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-text-muted">
          As of
          <input
            type="date"
            name="as_of"
            defaultValue={params.asOf}
            className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal normal-case text-text-primary"
          />
        </label>
        <button
          type="submit"
          className="min-h-[44px] rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
        >
          Apply
        </button>
      </form>
    </Card>
  );
}

function SummaryTable({
  rows,
  params,
}: {
  rows: CurriculumSummaryRow[];
  params: CurriculumSummaryQuery;
}) {
  const headers = ["Centre", "Program", "Tracks", "Region", ...CURRICULUM_SUMMARY_SUBJECTS, "Behind", "Plan"];
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted">
          <tr>
            {headers.map((header) => (
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
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <SummaryTableRow key={row.centreId} row={row} params={params} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryTableRow({ row, params }: { row: CurriculumSummaryRow; params: CurriculumSummaryQuery }) {
  const timelineHref = `/curriculum-summary/centres/${row.centreId}?${new URLSearchParams({
    grade: String(params.grade),
    as_of: params.asOf,
  }).toString()}`;
  const cellClassName = "px-4 py-3 align-top";

  return (
    <tr data-summary-row data-centre={row.centreName} data-kind={row.kind}>
      <td className={cellClassName}>
        <Link href={timelineHref} className="font-bold text-accent hover:text-accent-hover">
          {row.centreName}
        </Link>
        <span className="block text-xs text-text-muted">{row.schoolName}</span>
      </td>
      <td className={cellClassName}>{row.programName}</td>
      <td className={cellClassName}>{row.tracksLabel}</td>
      <td className={cellClassName}>{row.region ?? "—"}</td>
      {row.kind === "plan" && row.subjects ? (
        <>
          {CURRICULUM_SUMMARY_SUBJECTS.map((subject) => {
            const progress = row.subjects?.[subject] ?? null;
            return (
              <td key={subject} data-subject={subject} className={cellClassName}>
                {progress ? (
                  <Badge variant={TONE_BADGE_VARIANTS[progress.tone]} data-tone={progress.tone}>
                    {progress.label} · {progress.done}/{progress.due}
                  </Badge>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </td>
            );
          })}
          <td data-behind className={`${cellClassName} font-mono font-bold`}>
            {row.behind}
          </td>
          <td data-plan className={cellClassName}>
            {row.plan?.title}
            {row.plan?.closed ? (
              <Badge className="ml-2" data-plan-closed>
                Closed
              </Badge>
            ) : null}
          </td>
        </>
      ) : row.kind === "no_plan" ? (
        <>
          <td colSpan={CURRICULUM_SUMMARY_SUBJECTS.length + 1} className={`${cellClassName} text-text-muted`}>
            Not measured without an Active plan
          </td>
          <td data-plan className={`${cellClassName} text-text-muted`}>
            No plan
          </td>
        </>
      ) : (
        <td
          colSpan={CURRICULUM_SUMMARY_SUBJECTS.length + 2}
          data-explanation
          className={`${cellClassName} font-bold text-warning-text`}
        >
          {row.explanation}
        </td>
      )}
    </tr>
  );
}

function SummaryPagination({
  page,
  totalPages,
  params,
}: {
  page: number;
  totalPages: number;
  params: CurriculumSummaryQuery;
}) {
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;
  const linkClassName = "rounded-md border border-border px-3 py-1.5 font-bold text-accent hover:text-accent-hover";
  const disabledClassName = "rounded-md border border-border px-3 py-1.5 font-bold text-text-muted";

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between">
      <span>
        Page {page} of {totalPages || 1}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CurriculumSummaryPageSizeSelect
          currentParams={{ grade: String(params.grade), as_of: params.asOf }}
          pageSize={params.pageSize}
        />
        {hasPrevious ? (
          <Link href={summaryHref(params, { page: page - 1 })} className={linkClassName}>
            Previous
          </Link>
        ) : (
          <span className={disabledClassName}>Previous</span>
        )}
        {hasNext ? (
          <Link href={summaryHref(params, { page: page + 1 })} className={linkClassName}>
            Next
          </Link>
        ) : (
          <span className={disabledClassName}>Next</span>
        )}
      </div>
    </div>
  );
}
