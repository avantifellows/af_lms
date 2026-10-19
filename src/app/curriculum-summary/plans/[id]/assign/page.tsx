import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import { authOptions } from "@/lib/auth";
import { listPlanAssignmentCentres } from "@/lib/curriculum-plan-assignments";
import { requireCurriculumPlanAdmin } from "@/lib/curriculum-plans";
import PlanSchemaUnavailable from "../../PlanSchemaUnavailable";
import CurriculumPlanAssignForm from "./CurriculumPlanAssignForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CurriculumPlanAssignPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session);

  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  const result = await listPlanAssignmentCentres(Number(id));
  if (!result.ok && result.status === 404) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title={result.ok ? `Assign ${result.plan.title}` : "Assign Curriculum Plan"}
        subtitle={
          result.ok ? `Grade ${result.plan.grade} · ${result.plan.academicYear}` : undefined
        }
        backHref={`/curriculum-summary/plans/${id}`}
        userEmail={access.email}
        containerClassName="w-full px-4 py-3 sm:px-6 lg:px-8"
      />
      <main className="w-full space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {!result.ok ? (
          <PlanSchemaUnavailable result={result} />
        ) : (
          <CurriculumPlanAssignForm
            planId={result.plan.id}
            centres={result.centres}
            readOnly={Boolean(access.permission.read_only)}
          />
        )}
      </main>
    </div>
  );
}
