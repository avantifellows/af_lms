import Link from "next/link";

import PageHeader from "@/components/PageHeader";
import { Badge, Card } from "@/components/ui";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import CurriculumSummaryPageSizeSelect from "./CurriculumSummaryPageSizeSelect";
import {
  CURRICULUM_SUMMARY_GRADES,
  CURRICULUM_SUMMARY_SUBJECTS,
  getCurriculumSummary,
  normalizeCurriculumSummarySearchParams,
  type CurriculumSummaryQuery,
  type CurriculumSummaryResult,
  type CurriculumSummaryRow,
  type CurriculumSummarySubjectProgress,
} from "@/lib/curriculum-summary";
import { requireCurriculumSummaryViewer } from "./summary-access";
import {
  ApplyButton,
  AsOfField,
  HeaderNumber,
  HiddenField,
  PAGE_CONTAINER_CLASS_NAME,
  SchemaUnavailableCard,
  SearchField,
  SegmentLinks,
  TableHead,
  TONE_BADGE_VARIANTS,
} from "./summary-ui";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type SummaryData = Extract<CurriculumSummaryResult, { ok: true }>;

const DEFAULT_PAGE_SIZE = 20;
const ACTION_LINK_CLASS_NAME =
  "rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover";
const CELL_CLASS_NAME = "px-4 py-3 align-top";

export default async function CurriculumSummaryPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { email, permission } = await requireCurriculumSummaryViewer();
  const params = normalizeCurriculumSummarySearchParams(resolvedSearchParams, getTodayIST());
  const summary = await getCurriculumSummary(permission, params);

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Curriculum Summary"
        subtitle="Each class's progress against its Curriculum Plan"
        backHref="/dashboard"
        userEmail={email}
        actions={permission.role === "admin" ? <AdminLinks /> : undefined}
        containerClassName={PAGE_CONTAINER_CLASS_NAME}
      />
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        {summary.ok ? (
          <SummaryView summary={summary} params={params} />
        ) : (
          <SchemaUnavailableCard error={summary.error} details={summary.details}>
            <p className="text-sm text-text-secondary">
              Curriculum Summary is read-only and cannot load until the LMS Curriculum and
              Curriculum Plan schema is available.
            </p>
          </SchemaUnavailableCard>
        )}
      </main>
    </div>
  );
}

function AdminLinks() {
  return (
    <div className="flex items-center gap-2">
      <Link href="/curriculum-summary/plans" className={ACTION_LINK_CLASS_NAME}>
        Plans
      </Link>
      <Link href="/curriculum-summary/config" className={ACTION_LINK_CLASS_NAME}>
        Manage config
      </Link>
    </div>
  );
}

function SummaryView({ summary, params }: { summary: SummaryData; params: CurriculumSummaryQuery }) {
  const { header } = summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3 sm:max-w-2xl">
        <HeaderNumber
          label="Centres on plan"
          value={`${header.centresOnPlan}/${header.centresTotal}`}
          testId="summary-centres-on-plan"
        />
        <HeaderNumber label="Chapters behind" value={String(header.chaptersBehind)} testId="summary-chapters-behind" />
        <HeaderNumber
          label="Chapter tests overdue"
          value={String(header.testsOverdue)}
          testId="summary-tests-overdue"
        />
      </div>

      <SummaryFilters params={params} regionOptions={summary.regionOptions} />

      <Card className="overflow-hidden">
        {summary.rows.length === 0 ? (
          <div className="px-4 py-10 text-sm text-text-secondary">{emptyMessage(params)}</div>
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
  );
}

function emptyMessage(params: CurriculumSummaryQuery): string {
  const filtered = params.regions.length > 0 || params.schoolSearch !== "" || params.onlyBehind;
  return filtered
    ? "No classes match these filters."
    : `No Centres with Exam Tracks for Grade ${params.grade} are in your scope.`;
}

// Filters carried by every Summary link; page and limit are added per link.
function filterSearchParams(
  params: CurriculumSummaryQuery,
  overrides: { grade?: number } = {}
): URLSearchParams {
  const search = new URLSearchParams();
  for (const region of params.regions) search.append("regions", region);
  if (params.schoolSearch) search.set("q", params.schoolSearch);
  search.set("grade", String(overrides.grade ?? params.grade));
  search.set("as_of", params.asOf);
  if (params.onlyBehind) search.set("only_behind", "1");
  return search;
}

function summaryHref(
  params: CurriculumSummaryQuery,
  overrides: { grade?: number; page?: number } = {}
): string {
  const search = filterSearchParams(params, overrides);
  if (params.pageSize !== DEFAULT_PAGE_SIZE) search.set("limit", String(params.pageSize));
  if (overrides.page && overrides.page > 1) search.set("page", String(overrides.page));
  return `/curriculum-summary?${search.toString()}`;
}

function SummaryFilters({
  params,
  regionOptions,
}: {
  params: CurriculumSummaryQuery;
  regionOptions: string[];
}) {
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
      <SegmentLinks
        label="Grade"
        navLabel="Grade"
        links={CURRICULUM_SUMMARY_GRADES.map((grade) => ({
          key: String(grade),
          label: `Grade ${grade}`,
          href: summaryHref(params, { grade }),
          active: params.grade === grade,
        }))}
      />
      {/* Submitting drops `page`, so changed filters start again at page 1. */}
      <form action="/curriculum-summary" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="grade" value={params.grade} />
        <HiddenField name="limit" value={params.pageSize !== DEFAULT_PAGE_SIZE ? params.pageSize : null} />
        <RegionFilter regionOptions={regionOptions} selected={params.regions} />
        <SearchField name="q" label="School" value={params.schoolSearch} placeholder="Name or code" />
        <AsOfField asOf={params.asOf} />
        <label className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-text-primary">
          <input type="checkbox" name="only_behind" value="1" defaultChecked={params.onlyBehind} />
          Only behind
        </label>
        <ApplyButton />
      </form>
    </Card>
  );
}

function RegionFilter({ regionOptions, selected }: { regionOptions: string[]; selected: string[] }) {
  return (
    <details className="relative">
      <summary className="flex min-h-[44px] cursor-pointer list-none flex-col justify-end gap-1 text-xs font-bold uppercase tracking-wide text-text-muted">
        Region
        <span className="rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal normal-case text-text-primary">
          {selected.length === 0 ? "All regions" : selected.join(", ")}
        </span>
      </summary>
      <fieldset className="absolute z-10 mt-1 flex max-h-64 min-w-48 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-bg-card p-3 shadow-md">
        <legend className="sr-only">Region</legend>
        {regionOptions.length === 0 ? (
          <span className="text-sm text-text-muted">No regions in scope</span>
        ) : (
          regionOptions.map((region) => (
            <label key={region} className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                name="regions"
                value={region}
                defaultChecked={selected.includes(region)}
              />
              {region}
            </label>
          ))
        )}
      </fieldset>
    </details>
  );
}

const SUMMARY_HEADERS = [
  "Centre",
  "Program",
  "Tracks",
  "Region",
  ...CURRICULUM_SUMMARY_SUBJECTS,
  "Behind",
  "Tests overdue",
  "Plan",
];

function SummaryTable({
  rows,
  params,
}: {
  rows: CurriculumSummaryRow[];
  params: CurriculumSummaryQuery;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <TableHead headers={SUMMARY_HEADERS} />
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

  return (
    <tr data-summary-row data-centre={row.centreName} data-kind={row.kind}>
      <td className={CELL_CLASS_NAME}>
        <Link href={timelineHref} className="font-bold text-accent hover:text-accent-hover">
          {row.centreName}
        </Link>
        <span className="block text-xs text-text-muted">{row.schoolName}</span>
      </td>
      <td className={CELL_CLASS_NAME}>{row.programName}</td>
      <td className={CELL_CLASS_NAME}>{row.tracksLabel}</td>
      <td className={CELL_CLASS_NAME}>{row.region ?? "—"}</td>
      <RowMetrics row={row} />
    </tr>
  );
}

function RowMetrics({ row }: { row: CurriculumSummaryRow }) {
  if (row.kind === "plan" && row.subjects) return <PlanCells row={row} subjects={row.subjects} />;
  if (row.kind === "no_plan") return <NoPlanCells testsConducted={row.testsConducted ?? 0} />;
  return (
    <td
      colSpan={CURRICULUM_SUMMARY_SUBJECTS.length + 3}
      data-explanation
      className={`${CELL_CLASS_NAME} font-bold text-warning-text`}
    >
      {row.explanation}
    </td>
  );
}

function PlanCells({
  row,
  subjects,
}: {
  row: CurriculumSummaryRow;
  subjects: NonNullable<CurriculumSummaryRow["subjects"]>;
}) {
  return (
    <>
      {CURRICULUM_SUMMARY_SUBJECTS.map((subject) => (
        <td key={subject} data-subject={subject} className={CELL_CLASS_NAME}>
          <SubjectPill progress={subjects[subject]} />
        </td>
      ))}
      <td data-behind className={`${CELL_CLASS_NAME} font-mono font-bold`}>
        {row.behind}
      </td>
      <td data-tests-overdue className={`${CELL_CLASS_NAME} font-mono font-bold`}>
        {row.testsOverdue}
      </td>
      <td data-plan className={CELL_CLASS_NAME}>
        {row.plan?.title}
        {row.plan?.closed ? (
          <Badge className="ml-2" data-plan-closed>
            Closed
          </Badge>
        ) : null}
      </td>
    </>
  );
}

function SubjectPill({ progress }: { progress: CurriculumSummarySubjectProgress | null }) {
  if (!progress) return <span className="text-text-muted">—</span>;
  return (
    <Badge variant={TONE_BADGE_VARIANTS[progress.tone]} data-tone={progress.tone}>
      {progress.label} · {progress.done}/{progress.due}
    </Badge>
  );
}

function NoPlanCells({ testsConducted }: { testsConducted: number }) {
  return (
    <>
      <td colSpan={CURRICULUM_SUMMARY_SUBJECTS.length + 1} className={`${CELL_CLASS_NAME} text-text-muted`}>
        Not measured without an Active plan
      </td>
      <td data-tests-conducted className={`${CELL_CLASS_NAME} text-text-secondary`}>
        {testsConducted} conducted
      </td>
      <td data-plan className={`${CELL_CLASS_NAME} text-text-muted`}>
        No plan
      </td>
    </>
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
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between">
      <span>
        Page {page} of {totalPages || 1}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CurriculumSummaryPageSizeSelect
          filterQuery={filterSearchParams(params).toString()}
          pageSize={params.pageSize}
        />
        <PageLink label="Previous" href={page > 1 ? summaryHref(params, { page: page - 1 }) : null} />
        <PageLink label="Next" href={page < totalPages ? summaryHref(params, { page: page + 1 }) : null} />
      </div>
    </div>
  );
}

function PageLink({ label, href }: { label: string; href: string | null }) {
  if (!href) {
    return <span className="rounded-md border border-border px-3 py-1.5 font-bold text-text-muted">{label}</span>;
  }
  return (
    <Link href={href} className="rounded-md border border-border px-3 py-1.5 font-bold text-accent hover:text-accent-hover">
      {label}
    </Link>
  );
}
