import Link from "next/link";

import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { getCurriculumPlan } from "@/lib/curriculum-plans";
import CurriculumPlanMetadataForm from "../CurriculumPlanMetadataForm";
import PlanSchemaUnavailable from "../PlanSchemaUnavailable";
import { orNotFound, requirePlanAdminPage } from "../plan-page-access";
import CurriculumPlanChapterDates from "./CurriculumPlanChapterDates";
import CurriculumPlanCopy from "./CurriculumPlanCopy";
import CurriculumPlanLifecycle from "./CurriculumPlanLifecycle";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CurriculumPlanEditorPage({ params }: PageProps) {
  const { id } = await params;
  const access = await requirePlanAdminPage();
  const result = orNotFound(await getCurriculumPlan(Number(id)));
  const readOnly = Boolean(access.permission.read_only);

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title={result.ok ? result.plan.title : "Curriculum Plan"}
        subtitle={
          result.ok
            ? `Grade ${result.plan.grade} · ${result.plan.academicYear}`
            : undefined
        }
        backHref="/curriculum-summary/plans"
        userEmail={access.email}
        containerClassName="w-full px-4 py-3 sm:px-6 lg:px-8"
      />
      <main className="w-full space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {!result.ok ? (
          <PlanSchemaUnavailable result={result} />
        ) : (
          <>
            <CurriculumPlanLifecycle
              planId={result.plan.id}
              displayStatus={result.plan.displayStatus}
              academicYear={result.plan.academicYear}
              grade={result.plan.grade}
              chapters={result.plan.chapters}
              readOnly={readOnly}
            />
            <CurriculumPlanCopy planId={result.plan.id} readOnly={readOnly} />
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <div>
                <p className="text-sm font-bold text-text-primary">Plan Assignments</p>
                <p data-testid="plan-assignment-count" className="text-sm text-text-secondary">
                  {result.plan.assignmentCount === 1
                    ? "1 Centre assigned"
                    : `${result.plan.assignmentCount} Centres assigned`}
                </p>
              </div>
              <Link
                href={`/curriculum-summary/plans/${result.plan.id}/assign`}
                className="ml-auto inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
              >
                Assign Centres
              </Link>
            </Card>
            <CurriculumPlanMetadataForm
              planId={result.plan.id}
              initialValues={{
                title: result.plan.title,
                examTracks: result.plan.examTracks,
                academicYear: result.plan.academicYear,
                grade: result.plan.grade,
                closureDate: result.plan.closureDate,
              }}
              readOnly={readOnly}
              assignmentCount={result.plan.assignmentCount}
            />
            <CurriculumPlanChapterDates
              // Grade or served tracks change the Chapter list; start a fresh grid.
              key={`${result.plan.grade}:${result.plan.examTracks.join(",")}`}
              planId={result.plan.id}
              chapters={result.plan.chapters}
              readOnly={readOnly}
            />
          </>
        )}
      </main>
    </div>
  );
}
