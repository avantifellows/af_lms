import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import ActionDetailForm from "@/components/visits/ActionDetailForm";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { getFeatureAccess, getUserPermission } from "@/lib/permissions";
import { buildVisitsActor, canEditVisit, canViewVisit } from "@/lib/visits-policy";

interface VisitRow {
  id: number;
  school_code: string;
  school_region: string | null;
  school_name: string | null;
  pm_email: string;
  visit_date: string;
  status: string;
  completed_at: string | null;
}

interface ActionRow {
  id: number;
  visit_id: number;
  action_type: string;
  status: string;
  data: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  inserted_at: string;
  updated_at: string;
}

interface ActionDetail {
  visit: VisitRow | null;
  action: ActionRow | null;
}

interface PageProps {
  params: Promise<{ id: string; actionId: string }>;
}

async function getActionDetail(visitId: string, actionId: string): Promise<ActionDetail> {
  const visits = await query<VisitRow>(
    `SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status, v.completed_at,
            s.name AS school_name, s.region AS school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1`,
    [visitId]
  );

  if (visits.length === 0) {
    return { visit: null, action: null };
  }

  const actions = await query<ActionRow>(
    `SELECT id, visit_id, action_type, status, data,
            started_at, ended_at, inserted_at, updated_at
     FROM lms_pm_school_visit_actions
     WHERE visit_id = $1
       AND id = $2
       AND deleted_at IS NULL`,
    [visitId, actionId]
  );

  return {
    visit: visits[0],
    action: actions[0] ?? null,
  };
}

function notFoundState(title: string, description: string) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4">
        <Link href="/visits" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Visits
        </Link>
      </div>
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <h1 className="text-base font-semibold text-red-800">{title}</h1>
        <p className="mt-1 text-sm text-red-700">{description}</p>
      </div>
    </main>
  );
}

function forbiddenState() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4">
        <Link href="/visits" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Visits
        </Link>
      </div>
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <p className="text-yellow-800">You do not have access to this action.</p>
      </div>
    </main>
  );
}

export default async function VisitActionDetailPage({ params }: PageProps) {
  const { id, actionId } = await params;
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/");
  }

  if (session.isPasscodeUser) {
    if (session.schoolCode) {
      redirect(`/school/${session.schoolCode}`);
    }
    redirect("/dashboard");
  }

  if (!session.user?.email) {
    redirect("/");
  }

  const permission = await getUserPermission(session.user.email);
  if (!permission) {
    redirect("/dashboard");
  }

  if (!getFeatureAccess(permission, "visits").canView) {
    redirect("/dashboard");
  }

  const detail = await getActionDetail(id, actionId);
  if (!detail.visit) {
    return notFoundState("Visit not found", "The requested visit does not exist.");
  }

  const actor = buildVisitsActor(session.user.email, permission);
  const canView = canViewVisit(actor, {
    pmEmail: detail.visit.pm_email,
    schoolCode: detail.visit.school_code,
    schoolRegion: detail.visit.school_region,
  });

  if (!canView) {
    return forbiddenState();
  }

  if (!detail.action) {
    return notFoundState("Action not found", "This action may have been deleted.");
  }

  const canWrite = canEditVisit(actor, {
    pmEmail: detail.visit.pm_email,
    schoolCode: detail.visit.school_code,
    schoolRegion: detail.visit.school_region,
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4">
        <Link href={`/visits/${detail.visit.id}`} className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Visit
        </Link>
      </div>

      <ActionDetailForm
        visitId={detail.visit.id}
        visitStatus={detail.visit.status}
        initialAction={detail.action}
        canWrite={canWrite}
        isAdmin={permission.role === "admin"}
      />
    </main>
  );
}
