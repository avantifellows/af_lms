import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import ActionDetailForm from "@/components/visits/ActionDetailForm";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { getFeatureAccess, getResolvedPermission } from "@/lib/permissions";
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
  searchParams: Promise<{ from?: string }>;
}

async function getActionDetail(visitId: string, actionId: string): Promise<ActionDetail> {
  const visits = await query<VisitRow>(
    `SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status, v.completed_at,
            s.name AS school_name, s.region AS school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1
       AND v.deleted_at IS NULL`,
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

function backLinkLabel(backHref: string) {
  return backHref === "/school-visit-summary" ? "← Back to Visit Summary" : "← Back to Visits";
}

function notFoundState(title: string, description: string, backHref = "/visits") {
  return (
    <main className="min-h-screen bg-bg">
      <div className="px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">
        <div className="mb-4">
          <Link href={backHref} className="text-sm text-accent hover:text-accent-hover font-semibold uppercase">
            {backLinkLabel(backHref)}
          </Link>
        </div>
        <div className="border border-danger/20 bg-danger-bg p-4" role="alert">
          <h1 className="text-base font-semibold text-danger">{title}</h1>
          <p className="mt-1 text-sm text-danger">{description}</p>
        </div>
      </div>
    </main>
  );
}

function forbiddenState(backHref = "/visits") {
  return (
    <main className="min-h-screen bg-bg">
      <div className="px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">
        <div className="mb-4">
          <Link href={backHref} className="text-sm text-accent hover:text-accent-hover font-semibold uppercase">
            {backLinkLabel(backHref)}
          </Link>
        </div>
        <div className="border border-warning-border bg-warning-bg p-4" role="alert">
          <p className="text-warning-text">You do not have access to this action.</p>
        </div>
      </div>
    </main>
  );
}

export default async function VisitActionDetailPage({ params, searchParams }: PageProps) {
  const { id, actionId } = await params;
  const { from } = await searchParams;
  const backToSummary = from === "summary";
  const fallbackBackHref = backToSummary ? "/school-visit-summary" : "/visits";
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

  const permission = await getResolvedPermission(session.user.email);
  if (!permission) {
    redirect("/dashboard");
  }

  if (!getFeatureAccess(permission, "visits").canView) {
    redirect("/dashboard");
  }

  const detail = await getActionDetail(id, actionId);
  if (!detail.visit) {
    return notFoundState("Visit not found", "The requested visit does not exist.", fallbackBackHref);
  }

  const actor = buildVisitsActor(session.user.email, permission);
  const canView = canViewVisit(actor, {
    pmEmail: detail.visit.pm_email,
    schoolCode: detail.visit.school_code,
    schoolRegion: detail.visit.school_region,
  });

  if (!canView) {
    return forbiddenState(fallbackBackHref);
  }

  if (!detail.action) {
    return notFoundState("Action not found", "This action may have been deleted.", fallbackBackHref);
  }

  const canWrite = backToSummary
    ? false
    : canEditVisit(actor, {
        pmEmail: detail.visit.pm_email,
        schoolCode: detail.visit.school_code,
        schoolRegion: detail.visit.school_region,
      });

  return (
    <main className="min-h-screen bg-bg">
      <div className="px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 md:-mx-16 lg:-mx-32 xl:-mx-64 2xl:-mx-96 px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 bg-bg py-3 mb-1">
          <Link
            href={backToSummary ? `/school-visit-summary/${id}` : `/visits/${detail.visit.id}`}
            className="text-sm text-accent hover:text-accent-hover font-semibold uppercase"
          >
            {backToSummary ? "← Back to Visit Summary" : "← Back to Visit"}
          </Link>
        </div>

        {backToSummary && (
          <div className="mb-4 border border-border bg-bg-card-alt px-4 py-3 text-sm text-text-muted">
            View-only mode — editing is not available from the summary view.
          </div>
        )}

        <ActionDetailForm
          visitId={detail.visit.id}
          visitStatus={detail.visit.status}
          initialAction={detail.action}
          canWrite={canWrite}
          isAdmin={permission.role === "admin"}
          schoolCode={detail.visit.school_code}
        />
      </div>
    </main>
  );
}
