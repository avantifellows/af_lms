import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import { authOptions } from "@/lib/auth";
import {
  getCurriculumPlan,
  requireCurriculumPlanAdmin,
} from "@/lib/curriculum-plans";
import CurriculumPlanMetadataForm from "../CurriculumPlanMetadataForm";
import PlanSchemaUnavailable from "../PlanSchemaUnavailable";
import CurriculumPlanChapterDates from "./CurriculumPlanChapterDates";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CurriculumPlanEditorPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session);

  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  const result = await getCurriculumPlan(Number(id));
  if (!result.ok && result.status === 404) {
    notFound();
  }

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
