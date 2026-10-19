import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import { authOptions } from "@/lib/auth";
import { currentAcademicYearIST } from "@/lib/curriculum-plan-rules";
import { requireCurriculumPlanAdmin } from "@/lib/curriculum-plans";
import { checkCurriculumPlansSchema } from "@/lib/curriculum-schema";
import CurriculumPlanMetadataForm from "../CurriculumPlanMetadataForm";
import PlanSchemaUnavailable from "../PlanSchemaUnavailable";

export default async function NewCurriculumPlanPage() {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session);

  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  const schema = await checkCurriculumPlansSchema();

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="New Curriculum Plan"
        subtitle="New plans are saved as Draft"
        backHref="/curriculum-summary/plans"
        userEmail={access.email}
        containerClassName="w-full px-4 py-3 sm:px-6 lg:px-8"
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        {!schema.ok ? (
          <PlanSchemaUnavailable result={schema} />
        ) : (
          <CurriculumPlanMetadataForm
            initialValues={{
              title: "",
              examTracks: [],
              academicYear: currentAcademicYearIST(),
              grade: 11,
              closureDate: "",
            }}
            readOnly={Boolean(access.permission.read_only)}
          />
        )}
      </main>
    </div>
  );
}
