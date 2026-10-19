import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import { Badge, Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import {
  listCurriculumPlans,
  normalizeCurriculumPlanListFilters,
  requireCurriculumPlanAdmin,
} from "@/lib/curriculum-plans";
import { formatExamTrack } from "@/lib/exam-tracks";
import PlanSchemaUnavailable from "./PlanSchemaUnavailable";
import { PLAN_STATUS_BADGE_VARIANTS, PLAN_STATUS_LABELS } from "./plan-status";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const fieldClassName =
  "min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary";

export default async function CurriculumPlansPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session);

  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  const readOnly = Boolean(access.permission.read_only);
  const filters = normalizeCurriculumPlanListFilters(resolvedSearchParams);
  const result = await listCurriculumPlans(filters);

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
        {!result.ok ? (
          <PlanSchemaUnavailable result={result} />
        ) : (
          <>
            <Card className="p-4">
              <form
                action="/curriculum-summary/plans"
                className="flex flex-wrap items-end gap-4"
              >
                <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                  Academic year
                  <input
                    name="academic_year"
                    defaultValue={filters.academicYear}
                    placeholder="2026-2027"
                    className={fieldClassName}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-bold text-text-primary">
                  Grade
                  <select
                    name="grade"
                    defaultValue={filters.grade ?? ""}
                    className={fieldClassName}
                  >
                    <option value="">All</option>
                    <option value="11">11</option>
                    <option value="12">12</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="min-h-[44px] rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
                >
                  Apply
                </button>
                <div className="ml-auto">
                  {readOnly ? (
                    <button
                      type="button"
                      disabled
                      className="min-h-[44px] cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text-muted opacity-60"
                    >
                      New plan
                    </button>
                  ) : (
                    <Link
                      href="/curriculum-summary/plans/new"
                      className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
                    >
                      New plan
                    </Link>
                  )}
                </div>
              </form>
            </Card>
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
                  {result.plans.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-text-secondary">
                        No Curriculum Plans for {filters.academicYear}.
                      </td>
                    </tr>
                  ) : (
                    result.plans.map((plan) => (
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
                        <td className="px-4 py-3">
                          {plan.examTracks.map(formatExamTrack).join(", ")}
                        </td>
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
          </>
        )}
      </main>
    </div>
  );
}
