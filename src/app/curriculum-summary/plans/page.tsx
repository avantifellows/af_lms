import Link from "next/link";

import PageHeader from "@/components/PageHeader";
import { Badge, Card } from "@/components/ui";
import { listCentreCoverage } from "@/lib/curriculum-plan-assignments";
import {
  listCurriculumPlans,
  normalizeCurriculumPlanListFilters,
  type CurriculumPlanListFilters,
  type CurriculumPlanSummary,
} from "@/lib/curriculum-plans";
import { formatExamTrack } from "@/lib/exam-tracks";
import CentreCoverage from "./CentreCoverage";
import PlanSchemaUnavailable from "./PlanSchemaUnavailable";
import { requirePlanAdminPage } from "./plan-page-access";
import { PLAN_STATUS_BADGE_VARIANTS, PLAN_STATUS_LABELS } from "./plan-status";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

type PlansTab = "plans" | "coverage";

const TABS: Array<{ id: PlansTab; label: string }> = [
  { id: "plans", label: "Plans" },
  { id: "coverage", label: "Centre coverage" },
];

const fieldClassName =
  "min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary";

// The Plans tab lists the academic year's plans (optionally one Grade); the Centre coverage tab
// lists every eligible Centre's plan per Grade for the academic year.
async function loadTab(tab: PlansTab, filters: CurriculumPlanListFilters, readOnly: boolean) {
  if (tab === "coverage") {
    const coverage = await listCentreCoverage(filters.academicYear);
    if (!coverage.ok) return coverage;
    return {
      ok: true as const,
      content: (
        <CentreCoverage
          academicYear={coverage.academicYear}
          centres={coverage.centres}
          plans={coverage.plans}
          readOnly={readOnly}
        />
      ),
    };
  }
  const plans = await listCurriculumPlans(filters);
  if (!plans.ok) return plans;
  return {
    ok: true as const,
    content: <PlansTable plans={plans.plans} academicYear={filters.academicYear} />,
  };
}

function tabHref(id: PlansTab, filters: CurriculumPlanListFilters): string {
  const params = new URLSearchParams({ academic_year: filters.academicYear });
  if (id === "coverage") params.set("tab", "coverage");
  else if (filters.grade !== null) params.set("grade", String(filters.grade));
  return `/curriculum-summary/plans?${params.toString()}`;
}

export default async function CurriculumPlansPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const access = await requirePlanAdminPage();
  const readOnly = Boolean(access.permission.read_only);
  const filters = normalizeCurriculumPlanListFilters(resolvedSearchParams);
  const tab: PlansTab = resolvedSearchParams.tab === "coverage" ? "coverage" : "plans";
  const result = await loadTab(tab, filters, readOnly);

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Curriculum Plans"
        subtitle="Chapter Due Dates per academic year and Grade"
        backHref="/curriculum-summary"
        userEmail={access.email}
        containerClassName="w-full px-4 py-3 sm:px-6 lg:px-8"
      />
      <main className="w-full space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <nav aria-label="Curriculum Plans views" className="flex gap-2 border-b border-border">
          {TABS.map(({ id, label }) => (
            <Link
              key={id}
              href={tabHref(id, filters)}
              aria-current={tab === id ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-bold ${
                tab === id
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-muted hover:text-accent-hover"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        {result.ok ? (
          <>
            <PlansFilters tab={tab} filters={filters} readOnly={readOnly} />
            {result.content}
          </>
        ) : (
          <PlanSchemaUnavailable result={result} />
        )}
      </main>
    </div>
  );
}

function PlansFilters({
  tab,
  filters,
  readOnly,
}: {
  tab: PlansTab;
  filters: CurriculumPlanListFilters;
  readOnly: boolean;
}) {
  return (
    <Card className="p-4">
      <form action="/curriculum-summary/plans" className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
          Academic year
          <input
            name="academic_year"
            defaultValue={filters.academicYear}
            placeholder="2026-2027"
            className={fieldClassName}
          />
        </label>
        {tab === "coverage" ? (
          <input type="hidden" name="tab" value="coverage" />
        ) : (
          <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
            Grade
            <select name="grade" defaultValue={filters.grade ?? ""} className={fieldClassName}>
              <option value="">All</option>
              <option value="11">11</option>
              <option value="12">12</option>
            </select>
          </label>
        )}
        <button
          type="submit"
          className="min-h-[44px] rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
        >
          Apply
        </button>
        <div className="ml-auto">
          <NewPlanAction readOnly={readOnly} />
        </div>
      </form>
    </Card>
  );
}

function NewPlanAction({ readOnly }: { readOnly: boolean }) {
  if (readOnly) {
    return (
      <button
        type="button"
        disabled
        className="min-h-[44px] cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text-muted opacity-60"
      >
        New plan
      </button>
    );
  }
  return (
    <Link
      href="/curriculum-summary/plans/new"
      className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
    >
      New plan
    </Link>
  );
}

function PlansTable({ plans, academicYear }: { plans: CurriculumPlanSummary[]; academicYear: string }) {
  return (
    <Card className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted">
          <tr>
            {["Plan", "Grade", "Exam Tracks", "Status", "Closure date", "Centres assigned"].map(
              (header) => (
                <th
                  key={header}
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted"
                >
                  {header}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {plans.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-text-secondary">
                No Curriculum Plans for {academicYear}.
              </td>
            </tr>
          ) : (
            plans.map((plan) => (
              <tr key={plan.id}>
                <td className="px-4 py-3 font-bold">
                  <Link
                    href={`/curriculum-summary/plans/${plan.id}`}
                    className="text-accent hover:text-accent-hover"
                  >
                    {plan.title}
                  </Link>
                </td>
                <td className="px-4 py-3">{plan.grade}</td>
                <td className="px-4 py-3">{plan.examTracks.map(formatExamTrack).join(", ")}</td>
                <td className="px-4 py-3">
                  <Badge variant={PLAN_STATUS_BADGE_VARIANTS[plan.displayStatus]}>
                    {PLAN_STATUS_LABELS[plan.displayStatus]}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-mono">{plan.closureDate}</td>
                <td className="px-4 py-3">{plan.assignmentCount}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
