import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import AiTestInsightsPerformanceCard from "@/components/ai-test-insights/AiTestInsightsPerformanceCard";
import AiTestInsightsStudentSections from "@/components/ai-test-insights/AiTestInsightsStudentSections";
import PageHeader from "@/components/PageHeader";
import { resolveAiTestInsightsStudentAccess } from "@/lib/ai-test-insights-access";
import { readAiTestInsightsStudentCard } from "@/lib/ai-test-insights-student-card";
import { authOptions } from "@/lib/auth";
import { PROGRAM_ID_TO_LABEL } from "@/lib/constants";

// The AI Test Insights Student page (#550, physical centres only). Student
// access gates it: no session goes to the sign-in page, and any refusal —
// bad id, no feature, a Student missing, not listed or out of scope — is the
// same not-found page, so a hidden Student cannot be told from a missing one.
// The optional `centre` value only chooses the back link. Three cards: the
// Student card, the performance card and the AI Summary card; the Student
// card's newest test line and the AI Summary card's test picker share one read.

interface PageProps {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<{ centre?: string | string[] }>;
}

function firstValue(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export default async function AiTestInsightsStudentPage({ params, searchParams }: PageProps) {
  const [{ studentId }, search] = await Promise.all([params, searchParams]);
  const access = await resolveAiTestInsightsStudentAccess(studentId, { centre: firstValue(search?.centre) });
  if (!access.authorized) {
    if (access.status === 401) redirect("/");
    notFound();
  }

  const { student } = access;
  const [card, session] = await Promise.all([readAiTestInsightsStudentCard(student), getServerSession(authOptions)]);
  if (!card) notFound();

  const backHref = access.centreNamedByPage
    ? `/centre/${student.centreId}?tab=ai_test_insights`
    : `/school/${encodeURIComponent(student.school.code)}?tab=ai_test_insights`;

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader title="AI Test Insights" subtitle={student.school.code} userEmail={session?.user?.email ?? undefined} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link
          href={backHref}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded text-sm font-bold text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span aria-hidden="true">←</span> Back to AI Test Insights
        </Link>
        <AiTestInsightsStudentSections student={card} studentId={student.studentId} canEdit={student.canEdit}>
          <AiTestInsightsPerformanceCard
            schoolUdise={student.school.udise || student.school.code}
            grade={student.grade}
            program={PROGRAM_ID_TO_LABEL[student.programId] ?? null}
            uid={String(student.userId)}
          />
        </AiTestInsightsStudentSections>
      </main>
    </div>
  );
}
