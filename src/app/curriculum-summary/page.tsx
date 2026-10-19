import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import PageHeader from "@/components/PageHeader";
import { Badge, Card } from "@/components/ui";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import { SUBJECT_GROUPS } from "@/lib/curriculum-plan-rules";
import CentreFilterOptions from "./CentreFilterOptions";
import CurriculumSummaryPageSizeSelect from "./CurriculumSummaryPageSizeSelect";
import UrlFilterForm from "./UrlFilterForm";
import {
  CURRICULUM_SUMMARY_GRADES,
  CURRICULUM_SUMMARY_SUBJECTS,
  defaultSortDirection,
  getCurriculumSummary,
  normalizeCurriculumSummarySearchParams,
  type CurriculumSummaryCentreOption,
  type CurriculumSummaryQuery,
  type CurriculumSummaryResult,
  type CurriculumSummaryRow,
  type CurriculumSummarySort,
  type CurriculumSummarySortKey,
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
  SegmentLinks,
  SortableTableHead,
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

function SummaryView({ summary, params: requested }: { summary: SummaryData; params: CurriculumSummaryQuery }) {
  const { header } = summary;
  // Links and the filter bar carry only the Centres the Summary applied.
  const params = { ...requested, centreIds: summary.selectedCentreIds };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:max-w-3xl sm:grid-cols-4">
        <HeaderNumber
          label="Centres on plan"
          value={`${header.centresOnPlan}/${header.centresTotal}`}
          testId="summary-centres-on-plan"
        />
        {SUBJECT_GROUPS.map((group) => (
          <HeaderNumber
            key={group}
            label={`${group} chapters behind`}
            value={String(header.chaptersBehind[group])}
            testId={`summary-${group.toLowerCase()}-chapters-behind`}
          />
        ))}
        <HeaderNumber
          label="Chapter tests overdue"
          value={String(header.testsOverdue)}
          testId="summary-tests-overdue"
        />
      </div>

      <SummaryFilters
        params={params}
        regionOptions={summary.regionOptions}
        centreOptions={summary.centreOptions}
      />

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
  const filtered = params.regions.length > 0 || params.centreIds.length > 0 || params.onlyBehind;
  return filtered
    ? "No classes match these filters."
    : `No Centres with Exam Tracks for Grade ${params.grade} are in your scope.`;
}

interface SummaryHrefOverrides {
  grade?: number;
  page?: number;
  sort?: CurriculumSummarySort;
}

// Filters and sort carried by every Summary link; page and limit are added per link.
function filterSearchParams(
  params: CurriculumSummaryQuery,
  overrides: SummaryHrefOverrides = {}
): URLSearchParams {
  const search = new URLSearchParams();
  for (const region of params.regions) search.append("regions", region);
  for (const centreId of params.centreIds) search.append("centres", String(centreId));
  search.set("grade", String(overrides.grade ?? params.grade));
  search.set("as_of", params.asOf);
  if (params.onlyBehind) search.set("only_behind", "1");
  const sort = overrides.sort ?? params.sort;
  if (sort) {
    search.set("sort", sort.key);
    search.set("dir", sort.dir);
  }
  return search;
}

function summaryHref(params: CurriculumSummaryQuery, overrides: SummaryHrefOverrides = {}): string {
  const search = filterSearchParams(params, overrides);
  if (params.pageSize !== DEFAULT_PAGE_SIZE) search.set("limit", String(params.pageSize));
  if (overrides.page && overrides.page > 1) search.set("page", String(overrides.page));
  return `/curriculum-summary?${search.toString()}`;
}

function SummaryFilters({
  params,
  regionOptions,
  centreOptions,
}: {
  params: CurriculumSummaryQuery;
  regionOptions: string[];
  centreOptions: CurriculumSummaryCentreOption[];
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
      {/* Submitting drops `page`, so changed filters start again at page 1. Keyed on the
          filters so a client-side navigation re-renders the controls from the new URL. */}
      <UrlFilterForm
        key={summaryHref(params)}
        action="/curriculum-summary"
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="grade" value={params.grade} />
        <HiddenField name="limit" value={params.pageSize !== DEFAULT_PAGE_SIZE ? params.pageSize : null} />
        <HiddenField name="sort" value={params.sort?.key ?? null} />
        <HiddenField name="dir" value={params.sort?.dir ?? null} />
        <RegionFilter regionOptions={regionOptions} selected={params.regions} />
        <CentreFilter centreOptions={centreOptions} selected={params.centreIds} />
        <AsOfField asOf={params.asOf} />
        <label className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-text-primary">
          <input type="checkbox" name="only_behind" value="1" defaultChecked={params.onlyBehind} />
          Only behind
        </label>
        <ApplyButton />
      </UrlFilterForm>
    </Card>
  );
}

// A checkbox list behind a summary button showing the selection, like a multi-select.
function FilterDisclosure({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <details className="relative">
      <summary className="flex min-h-[44px] cursor-pointer list-none flex-col justify-end gap-1 text-xs font-bold uppercase tracking-wide text-text-muted">
        {label}
        <span className="max-w-xs truncate rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal normal-case text-text-primary">
          {value}
        </span>
      </summary>
      <fieldset className="absolute z-10 mt-1 flex max-h-64 min-w-48 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-bg-card p-3 shadow-md">
        <legend className="sr-only">{label}</legend>
        {children}
      </fieldset>
    </details>
  );
}

function RegionFilter({ regionOptions, selected }: { regionOptions: string[]; selected: string[] }) {
  return (
    <FilterDisclosure label="Region" value={selected.length === 0 ? "All regions" : selected.join(", ")}>
      {regionOptions.length === 0 ? (
        <span className="text-sm text-text-muted">No regions in scope</span>
      ) : (
        regionOptions.map((region) => (
          <label key={region} className="flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" name="regions" value={region} defaultChecked={selected.includes(region)} />
            {region}
          </label>
        ))
      )}
    </FilterDisclosure>
  );
}

// The Centres in scope for the Grade and chosen Regions, by id; the search box is client-side.
function CentreFilter({
  centreOptions,
  selected,
}: {
  centreOptions: CurriculumSummaryCentreOption[];
  selected: number[];
}) {
  const selectedNames = centreOptions
    .filter((option) => selected.includes(option.id))
    .map((option) => option.name);
  return (
    <FilterDisclosure label="Centre" value={selectedNames.length === 0 ? "All centres" : selectedNames.join(", ")}>
      {centreOptions.length === 0 ? (
        <span className="text-sm text-text-muted">No centres in scope</span>
      ) : (
        <CentreFilterOptions options={centreOptions} selected={selected} />
      )}
    </FilterDisclosure>
  );
}

// Subject pills, then PCM Behind and PCB Behind.
const MEASURE_COLUMNS = CURRICULUM_SUMMARY_SUBJECTS.length + SUBJECT_GROUPS.length;

const lowercase = <T extends string>(label: T) => label.toLowerCase() as Lowercase<T>;

const SUMMARY_COLUMNS: { label: string; sortKey: CurriculumSummarySortKey }[] = [
  { label: "Centre", sortKey: "centre" },
  { label: "Program", sortKey: "program" },
  { label: "Tracks", sortKey: "tracks" },
  { label: "Region", sortKey: "region" },
  ...CURRICULUM_SUMMARY_SUBJECTS.map((subject) => ({ label: subject, sortKey: lowercase(subject) })),
  ...SUBJECT_GROUPS.map((group) => ({ label: `${group} Behind`, sortKey: lowercase(group) })),
  { label: "Tests overdue", sortKey: "tests_overdue" },
  { label: "Plan", sortKey: "plan" },
];

// Every header links to its sort from page 1, keeping the filters: the active column's link
// reverses its direction, any other column's starts in its first-click direction.
function sortableHeaders(params: CurriculumSummaryQuery) {
  return SUMMARY_COLUMNS.map(({ label, sortKey: key }) => {
    const direction = params.sort?.key === key ? params.sort.dir : null;
    const nextDirection = direction ? (direction === "asc" ? "desc" : "asc") : defaultSortDirection(key);
    return { label, direction, href: summaryHref(params, { sort: { key, dir: nextDirection } }) };
  });
}

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
        <SortableTableHead headers={sortableHeaders(params)} />
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
      </td>
      <td className={`${CELL_CLASS_NAME} whitespace-nowrap`}>{row.programName}</td>
      <td className={CELL_CLASS_NAME}>
        <TracksLabel label={row.tracksLabel} />
      </td>
      <td className={CELL_CLASS_NAME}>{row.region ?? "—"}</td>
      <RowMetrics row={row} />
    </tr>
  );
}

// "JEE Main + JEE Advanced" breaks only between tracks, never inside a track name.
function TracksLabel({ label }: { label: string }) {
  return label.split(" + ").map((track, index) => (
    <Fragment key={track}>
      {index > 0 ? " + " : null}
      <span className="whitespace-nowrap">{track}</span>
    </Fragment>
  ));
}

function RowMetrics({ row }: { row: CurriculumSummaryRow }) {
  if (row.kind === "plan" && row.subjects && row.subjectGroups) {
    return <PlanCells row={row} subjects={row.subjects} subjectGroups={row.subjectGroups} />;
  }
  if (row.kind === "no_plan") return <NoPlanCells testsConducted={row.testsConducted ?? 0} />;
  return (
    <td
      colSpan={MEASURE_COLUMNS + 2}
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
  subjectGroups,
}: {
  row: CurriculumSummaryRow;
  subjects: NonNullable<CurriculumSummaryRow["subjects"]>;
  subjectGroups: NonNullable<CurriculumSummaryRow["subjectGroups"]>;
}) {
  return (
    <>
      {CURRICULUM_SUMMARY_SUBJECTS.map((subject) => (
        <td key={subject} data-subject={subject} className={CELL_CLASS_NAME}>
          <ProgressPill progress={subjects[subject]} />
        </td>
      ))}
      {SUBJECT_GROUPS.map((group) => (
        <td key={group} data-subject-group={group} className={CELL_CLASS_NAME}>
          <ProgressPill progress={subjectGroups[group]} />
        </td>
      ))}
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

// A subject pill or a PCM / PCB Behind cell: the pill reads "N behind" or "On track", with
// "done/due done" centred under it. Screen readers get one phrase instead of the two fragments.
function ProgressPill({ progress }: { progress: CurriculumSummarySubjectProgress | null }) {
  if (!progress) return <span className="text-text-muted">—</span>;
  const chapters = progress.due === 1 ? "chapter" : "chapters";
  return (
    <>
      <span data-progress-text className="sr-only">
        {`${progress.label}, ${progress.done} of ${progress.due} due ${chapters} done`}
      </span>
      <span aria-hidden="true" className="inline-flex flex-col items-center gap-1">
        <Badge variant={TONE_BADGE_VARIANTS[progress.tone]} data-tone={progress.tone} className="whitespace-nowrap">
          {progress.label}
        </Badge>
        <span data-done className="whitespace-nowrap text-xs text-text-muted">
          {progress.done}/{progress.due} done
        </span>
      </span>
    </>
  );
}

function NoPlanCells({ testsConducted }: { testsConducted: number }) {
  return (
    <>
      <td colSpan={MEASURE_COLUMNS} className={`${CELL_CLASS_NAME} text-text-muted`}>
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
