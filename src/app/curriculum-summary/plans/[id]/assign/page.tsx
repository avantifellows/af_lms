import PageHeader from "@/components/PageHeader";
import {
  listPlanAssignmentCentres,
  type PlanAssignmentCentresResult,
} from "@/lib/curriculum-plan-assignments";
import PlanSchemaUnavailable from "../../PlanSchemaUnavailable";
import { orNotFound, requirePlanAdminPage } from "../../plan-page-access";
import CurriculumPlanAssignForm from "./CurriculumPlanAssignForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

type AssignPageResult = Exclude<PlanAssignmentCentresResult, { status: 404 }>;

function pageHeading(result: AssignPageResult): { title: string; subtitle?: string } {
  if (!result.ok) return { title: "Assign Curriculum Plan" };
  return {
    title: `Assign ${result.plan.title}`,
    subtitle: `Grade ${result.plan.grade} · ${result.plan.academicYear}`,
  };
}

export default async function CurriculumPlanAssignPage({ params }: PageProps) {
  const { id } = await params;
  const access = await requirePlanAdminPage();
  const result = orNotFound(await listPlanAssignmentCentres(Number(id)));

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        {...pageHeading(result)}
        backHref={`/curriculum-summary/plans/${id}`}
        userEmail={access.email}
        containerClassName="w-full px-4 py-3 sm:px-6 lg:px-8"
      />
      <main className="w-full space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {result.ok ? (
          <CurriculumPlanAssignForm
            planId={result.plan.id}
            centres={result.centres}
            readOnly={Boolean(access.permission.read_only)}
          />
        ) : (
          <PlanSchemaUnavailable result={result} />
        )}
      </main>
    </div>
  );
}
