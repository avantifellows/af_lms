import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import {
  getResolvedPermission,
  canAccessCentreSync,
  getFeatureAccess,
} from "@/lib/permissions";
import { query } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import SchoolTabs from "@/components/SchoolTabs";
import QuizSessionsTab from "@/components/quiz-sessions/QuizSessionsTab";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface CentreRow {
  id: number;
  name: string;
  school_name: string | null;
}

export default async function CentrePage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!session?.user?.email) {
    redirect("/");
  }

  const centreId = Number(id);
  if (!Number.isInteger(centreId) || centreId <= 0) {
    notFound();
  }

  const permission = await getResolvedPermission(session.user.email);

  // Seat-gated: the user must hold a seat at this centre (admins pass).
  if (!canAccessCentreSync(permission, centreId)) {
    redirect("/centres");
  }

  const rows = await query<CentreRow>(
    `SELECT c.id, c.name, s.name AS school_name
     FROM centres c
     LEFT JOIN school s ON s.id = c.school_id
     WHERE c.id = $1 AND c.is_active = true
     LIMIT 1`,
    [centreId]
  );
  const centre = rows[0];
  if (!centre) {
    notFound();
  }

  const quizSessionsAccess = getFeatureAccess(permission, "quiz_sessions");

  const tabs = [
    {
      id: "quiz_sessions",
      label: "Quiz Sessions",
      content: (
        <QuizSessionsTab centreId={String(centre.id)} canEdit={quizSessionsAccess.canEdit} />
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title={centre.name}
        subtitle={centre.school_name || undefined}
        backHref="/centres"
        userEmail={session.user.email}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SchoolTabs tabs={tabs} defaultTab="quiz_sessions" />
      </main>
    </div>
  );
}
