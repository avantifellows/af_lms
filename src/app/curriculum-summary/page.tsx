import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { checkCurriculumSchema } from "@/lib/curriculum-schema";
import {
  getFeatureAccess,
  getProgramContextSync,
  getUserPermission,
} from "@/lib/permissions";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function CurriculumSummaryPage({ searchParams }: PageProps) {
  await searchParams;
  const session = await getServerSession(authOptions);

  if (session?.isPasscodeUser) {
    redirect(session.schoolCode ? `/school/${session.schoolCode}` : "/dashboard");
  }

  if (!session?.user?.email) {
    redirect("/");
  }

  const email = session.user.email;
  const permission = await getUserPermission(email);

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

  const schemaStatus = await checkCurriculumSchema();

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Curriculum Summary"
        subtitle="Read-only cross-school Curriculum Progress"
        backHref="/dashboard"
        userEmail={email}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {!schemaStatus.ok ? (
          <Card className="border-l-4 border-l-warning-border p-6">
            <div className="flex flex-col gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-warning-text">
                Schema unavailable
              </p>
              <h2 className="text-lg font-bold text-text-primary">
                {schemaStatus.error}
              </h2>
              <p className="text-sm text-text-secondary">
                Curriculum Summary is read-only and cannot load until the LMS
                Curriculum schema is available.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm font-mono text-text-secondary">
                {schemaStatus.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
          </Card>
        ) : (
          <Card className="p-6">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
                Read only
              </p>
              <h2 className="text-lg font-bold text-text-primary">
                Curriculum Summary
              </h2>
              <p className="text-sm text-text-secondary">
                Summary data is not available yet.
              </p>
              <Link
                href="/dashboard"
                className="mt-2 inline-flex w-fit text-sm font-bold text-accent hover:text-accent-hover"
              >
                Back to schools
              </Link>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
