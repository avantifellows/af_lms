import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import GpsMapLink from "@/components/visits/GpsMapLink";
import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { getFeatureAccess, getUserPermission } from "@/lib/permissions";
import {
  ACTION_TYPE_VALUES,
  ACTION_TYPES,
  isActionType,
  statusBadgeClass,
  type ActionType,
} from "@/lib/visit-actions";
import {
  dispatchComputeInlineStats,
  dispatchExtractRemarks,
  type RemarkEntry,
} from "@/lib/visit-summary";
import {
  buildVisitScopePredicate,
  buildVisitsActor,
  isScopedVisitsRole,
} from "@/lib/visits-policy";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface VisitSummaryDetail {
  id: number;
  school_code: string;
  school_name: string | null;
  pm_email: string;
  pm_name: string | null;
  visit_date: string;
  status: string;
  inserted_at: string;
  updated_at: string;
  completed_at: string | null;
  start_lat: number | string | null;
  start_lng: number | string | null;
  start_accuracy: number | string | null;
  end_lat: number | string | null;
  end_lng: number | string | null;
  end_accuracy: number | string | null;
}

interface VisitActionDetail {
  id: number;
  visit_id: number;
  action_type: string;
  status: string;
  data: unknown;
  started_at: string | null;
  ended_at: string | null;
  inserted_at: string;
  updated_at: string;
}

type InlineStats = Record<string, unknown>;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function formatDuration(startValue: string, endValue: string | null, now = new Date()): string {
  const start = new Date(startValue).getTime();
  const end = endValue ? new Date(endValue).getTime() : now.getTime();
  const totalMinutes = Math.max(0, Math.floor((end - start) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatStatus(status: string): string {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "in_progress") {
    return "In Progress";
  }
  if (status === "pending") {
    return "Pending";
  }
  return status;
}

function formatSchool(visit: VisitSummaryDetail): string {
  return visit.school_name ? `${visit.school_name} (${visit.school_code})` : visit.school_code;
}

function formatPm(visit: VisitSummaryDetail): string {
  return visit.pm_name || visit.pm_email;
}

function isStats(value: unknown): value is InlineStats {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatNumber(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
    : null;
}

function statsChips(actionType: string, stats: unknown): string[] {
  if (!isStats(stats)) {
    return [];
  }

  if (actionType === "classroom_observation") {
    return [
      `Score ${stats.totalScore}/${stats.maxScore}`,
      `Remarks ${stats.remarkCount}`,
    ];
  }
  if (actionType === "af_team_interaction") {
    return [
      `Answered ${stats.answeredCount}/${stats.totalQuestions}`,
      `Teachers ${stats.teacherCount}`,
    ];
  }
  if (actionType === "individual_af_teacher_interaction") {
    const avgAnswered = formatNumber(stats.avgAnswered);
    return [
      `Teachers ${stats.teacherCount} (${stats.presentCount} present, ${stats.onLeaveCount} on leave, ${stats.absentCount} absent)`,
      `Avg answered ${avgAnswered ?? "-"}/${stats.totalQuestions}`,
    ];
  }
  if (actionType === "principal_interaction") {
    return [`Answered ${stats.answeredCount}/${stats.totalQuestions}`];
  }
  if (actionType === "group_student_discussion") {
    return [
      stats.grade === null || stats.grade === undefined ? "Grade -" : `Grade ${stats.grade}`,
      `Answered ${stats.answeredCount}/${stats.totalQuestions}`,
    ];
  }
  if (actionType === "individual_student_discussion") {
    const avgAnswered = formatNumber(stats.avgAnswered);
    const chips: string[] = [];
    if (stats.entryCount !== null) {
      chips.push(`Entries ${stats.entryCount}`);
    }
    chips.push(`Students ${stats.studentCount}`);
    chips.push(`Avg answered ${avgAnswered ?? "-"}/${stats.totalQuestions}`);
    return chips;
  }
  if (actionType === "school_staff_interaction") {
    return [`Answered ${stats.answeredCount}/${stats.totalQuestions}`];
  }
  return [];
}

function actionTypeLabel(actionType: string): string {
  return isActionType(actionType) ? ACTION_TYPES[actionType] : "Other";
}

function groupActions(actions: VisitActionDetail[]): Array<{
  key: ActionType | "other";
  label: string;
  actions: VisitActionDetail[];
}> {
  const knownGroups = ACTION_TYPE_VALUES.map((actionType) => ({
    key: actionType,
    label: ACTION_TYPES[actionType],
    actions: actions.filter((action) => action.action_type === actionType),
  })).filter((group) => group.actions.length > 0);

  const otherActions = actions.filter((action) => !isActionType(action.action_type));
  if (otherActions.length === 0) {
    return knownGroups;
  }

  return [
    ...knownGroups,
    { key: "other" as const, label: "Other", actions: otherActions },
  ];
}

function collectRemarks(actions: VisitActionDetail[]): Array<RemarkEntry & {
  actionId: number;
  actionLabel: string;
}> {
  return actions.flatMap((action) =>
    dispatchExtractRemarks(action.action_type, action.data).map((remark) => ({
      ...remark,
      actionId: action.id,
      actionLabel: actionTypeLabel(action.action_type),
    }))
  );
}

async function getVisitSummaryDetail(id: string, actorEmail: string, permission: NonNullable<Awaited<ReturnType<typeof getUserPermission>>>) {
  const actor = buildVisitsActor(actorEmail, permission);
  const scope = buildVisitScopePredicate(actor, {
    startIndex: 2,
    schoolCodeColumn: "v.school_code",
    schoolRegionColumn: "s.region",
  });
  const predicates = ["v.id = $1", "v.deleted_at IS NULL"];
  if (scope.clause) {
    predicates.push(scope.clause);
  }

  const visits = await query<VisitSummaryDetail>(
    `SELECT v.*, s.name AS school_name, up.full_name AS pm_name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     LEFT JOIN user_permission up ON LOWER(up.email) = LOWER(v.pm_email)
     WHERE ${predicates.join(" AND ")}`,
    [id, ...scope.params]
  );

  if (visits.length === 0) {
    return { visit: null, actions: [] };
  }

  const actions = await query<VisitActionDetail>(
    `SELECT id, visit_id, action_type, status, data, started_at, ended_at, inserted_at, updated_at
     FROM lms_pm_school_visit_actions
     WHERE visit_id = $1 AND deleted_at IS NULL
     ORDER BY action_type, inserted_at`,
    [id]
  );

  return { visit: visits[0], actions };
}

function MetadataGrid({ visit }: { visit: VisitSummaryDetail }) {
  const items = [
    ["School", formatSchool(visit)],
    ["PM", formatPm(visit)],
    ["Visit Date", formatDate(visit.visit_date)],
    ["Started", formatTimestamp(visit.inserted_at)],
    ["Completed", formatTimestamp(visit.completed_at)],
    ["Updated", formatTimestamp(visit.updated_at)],
    ["Duration", formatDuration(visit.inserted_at, visit.completed_at)],
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="border border-border bg-bg-card-alt px-3 py-2">
          <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">{label}</dt>
          <dd className="mt-1 text-sm font-medium text-text-primary">{value}</dd>
          {label === "PM" && visit.pm_name && (
            <dd className="mt-1 font-mono text-xs text-text-muted">{visit.pm_email}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function GpsSection({ visit }: { visit: VisitSummaryDetail }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card elevation="sm" className="p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Start GPS</div>
        <div className="mt-2">
          <GpsMapLink lat={visit.start_lat} lng={visit.start_lng} accuracy={visit.start_accuracy} />
        </div>
      </Card>
      <Card elevation="sm" className="p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-text-muted">End GPS</div>
        <div className="mt-2">
          <GpsMapLink lat={visit.end_lat} lng={visit.end_lng} accuracy={visit.end_accuracy} />
        </div>
      </Card>
    </div>
  );
}

function ActionRow({ action }: { action: VisitActionDetail }) {
  const chips = statsChips(action.action_type, dispatchComputeInlineStats(action.action_type, action.data));

  return (
    <div className="border-t border-border/60 px-4 py-4 first:border-t-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex ${statusBadgeClass(action.status)}`}>
              {formatStatus(action.status)}
            </span>
            <span className="font-mono text-xs text-text-muted">Action #{action.id}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-text-muted">
            <span>Started: {formatTimestamp(action.started_at)}</span>
            <span>Ended: {formatTimestamp(action.ended_at)}</span>
            <span>Created: {formatTimestamp(action.inserted_at)}</span>
            <span>Updated: {formatTimestamp(action.updated_at)}</span>
          </div>
          {chips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <span key={chip} className="border border-border bg-bg-card-alt px-2 py-1 font-mono text-xs text-text-secondary">
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
        <Link
          href={`/visits/${action.visit_id}/actions/${action.id}?from=summary`}
          className="shrink-0 text-sm font-bold uppercase text-accent hover:text-accent-hover"
        >
          View full detail
        </Link>
      </div>
    </div>
  );
}

function ActionsSection({ actions }: { actions: VisitActionDetail[] }) {
  const groups = groupActions(actions);

  if (groups.length === 0) {
    return (
      <Card elevation="sm" className="p-6 text-center text-sm text-text-muted">
        No actions recorded for this visit.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.key} elevation="sm" className="overflow-hidden">
          <div className="border-b border-border bg-bg-card-alt px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">
              {group.label}
            </h2>
          </div>
          {group.actions.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </Card>
      ))}
    </div>
  );
}

function RemarksSection({ remarks }: { remarks: ReturnType<typeof collectRemarks> }) {
  return (
    <Card elevation="sm" className="p-4" role="region" aria-label="Remarks">
      <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">Remarks</h2>
      {remarks.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">No remarks</p>
      ) : (
        <div className="mt-4 space-y-3">
          {remarks.map((remark, index) => (
            <div key={`${remark.actionId}-${index}`} className="border-l-4 border-border-accent pl-3">
              <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
                {remark.actionLabel} #{remark.actionId}
              </div>
              <div className="mt-1 text-sm font-medium text-text-primary">{remark.label}</div>
              <p className="mt-1 text-sm text-text-secondary">{remark.text}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default async function SchoolVisitSummaryDetailPage({ params }: PageProps) {
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
  if (!permission) {
    redirect("/dashboard");
  }

  if (!getFeatureAccess(permission, "visits").canView) {
    redirect("/dashboard");
  }

  const actor = buildVisitsActor(session.user.email, permission);
  if (!isScopedVisitsRole(actor)) {
    if (actor.role === "program_manager") {
      redirect("/visits");
    }
    redirect("/dashboard");
  }

  if (!/^\d+$/.test(id)) {
    notFound();
  }

  const { visit, actions } = await getVisitSummaryDetail(id, session.user.email, permission);
  if (!visit) {
    notFound();
  }

  const remarks = collectRemarks(actions);

  return (
    <div className="min-h-screen bg-bg">
      <div className="sticky top-0 z-10 border-b border-border bg-bg-card/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Link href="/school-visit-summary" className="text-sm font-bold uppercase text-accent hover:text-accent-hover">
            &larr; Back to Visit Summary
          </Link>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Card elevation="sm" className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 border-b-4 border-border-accent pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">
                {formatSchool(visit)}
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                Visit summary detail
              </p>
            </div>
            <span className={`inline-flex shrink-0 ${statusBadgeClass(visit.status)}`}>
              {formatStatus(visit.status)}
            </span>
          </div>
          <div className="mt-4">
            <MetadataGrid visit={visit} />
          </div>
        </Card>

        <GpsSection visit={visit} />

        <section aria-labelledby="actions-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="actions-heading" className="text-base font-bold uppercase tracking-wide text-text-primary">
              Actions
            </h2>
            <span className="font-mono text-sm text-text-muted">
              {actions.length} total
            </span>
          </div>
          <ActionsSection actions={actions} />
        </section>

        <RemarksSection remarks={remarks} />
      </main>
    </div>
  );
}
