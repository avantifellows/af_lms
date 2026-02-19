import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserPermission, getFeatureAccess } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";
import CompleteVisitButton from "@/components/visits/CompleteVisitButton";
import ActionPointList from "@/components/visits/ActionPointList";
import { buildVisitsActor, canEditVisit, canViewVisit } from "@/lib/visits-policy";

interface Visit {
  id: number;
  school_code: string;
  school_region?: string | null;
  pm_email: string;
  visit_date: string;
  status: string;
  completed_at: string | null;
  inserted_at: string;
  updated_at: string;
  school_name?: string | null;
}

interface VisitAction {
  id: number;
  visit_id: number;
  action_type: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  inserted_at: string;
  updated_at: string;
}

interface VisitDetail {
  visit: Visit | null;
  actions: VisitAction[];
}

async function getVisitDetail(id: string): Promise<VisitDetail> {
  const visits = await query<Visit>(
    `SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status,
            v.completed_at, v.inserted_at, v.updated_at,
            s.name as school_name, s.region as school_region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1`,
    [id]
  );

  if (visits.length === 0) {
    return { visit: null, actions: [] };
  }

  const actions = await query<VisitAction>(
    `SELECT id, visit_id, action_type, status,
            started_at, ended_at, inserted_at, updated_at
     FROM lms_pm_visit_actions
     WHERE visit_id = $1
       AND deleted_at IS NULL
     ORDER BY inserted_at ASC, id ASC`,
    [id]
  );

  return { visit: visits[0], actions };
}

function visitStatusClass(status: string): string {
  if (status === "completed") {
    return "bg-green-100 text-green-800";
  }
  return "bg-yellow-100 text-yellow-800";
}

function formatVisitStatus(status: string): string {
  if (status === "completed") {
    return "Completed";
  }
  return "In Progress";
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VisitDetailPage({ params }: PageProps) {
  const { id } = await params;
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
  if (!getFeatureAccess(permission, "visits").canView) {
    redirect("/dashboard");
  }

  if (!permission) {
    redirect("/dashboard");
  }

  const { visit, actions } = await getVisitDetail(id);

  if (!visit) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Visit not found.</p>
        </div>
      </main>
    );
  }

  const actor = buildVisitsActor(session.user.email, permission);
  const canView = canViewVisit(actor, {
    pmEmail: visit.pm_email,
    schoolCode: visit.school_code,
    schoolRegion: visit.school_region,
  });
  if (!canView) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">You do not have access to this visit.</p>
        </div>
      </main>
    );
  }

  const completedCount = actions.filter((action) => action.status === "completed").length;
  const progressPercent = actions.length === 0
    ? 0
    : Math.round((completedCount / actions.length) * 100);
  const canEdit = canEditVisit(actor, {
    pmEmail: visit.pm_email,
    schoolCode: visit.school_code,
    schoolRegion: visit.school_region,
  });
  const isReadOnlyVisit = visit.status === "completed" || !canEdit;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Dashboard
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {visit.school_name || visit.school_code}
            </h1>
            <p className="mt-1 text-gray-500">
              Visit on {new Date(visit.visit_date).toLocaleDateString("en-IN", {
                year: "numeric",
                month: "short",
                day: "numeric",
                timeZone: "Asia/Kolkata",
              })}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
              <span>
                Started: {formatTimestamp(visit.inserted_at)}
              </span>
              {visit.completed_at && (
                <span>
                  Completed: {formatTimestamp(visit.completed_at)}
                </span>
              )}
            </div>
          </div>
          <span
            className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${visitStatusClass(visit.status)}`}
          >
            {formatVisitStatus(visit.status)}
          </span>
        </div>

        <div className="mt-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Action Progress</span>
            <span>
              {completedCount} of {actions.length} action points completed
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-600 h-2 rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mb-6">
        {visit.status === "completed" ? (
          <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-4 py-3">
            This visit is completed and read-only.
          </p>
        ) : canEdit ? (
          <CompleteVisitButton visitId={visit.id} />
        ) : (
          <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-4 py-3">
            This visit is read-only for your role.
          </p>
        )}
      </div>

      <ActionPointList visitId={visit.id} actions={actions} readOnly={isReadOnlyVisit} />
    </main>
  );
}
