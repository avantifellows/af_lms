import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import GpsMapLink from "@/components/visits/GpsMapLink";
import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { getFeatureAccess, getUserPermission, type UserPermission } from "@/lib/permissions";
import { statusBadgeClass } from "@/lib/visit-actions";
import {
  buildVisitScopePredicate,
  buildVisitsActor,
  isScopedVisitsRole,
} from "@/lib/visits-policy";

const VISITS_PER_PAGE = 20;

interface SummaryVisit {
  id: number;
  school_code: string;
  school_name: string | null;
  pm_email: string;
  pm_name: string | null;
  visit_date: string;
  status: string;
  inserted_at: string;
  completed_at: string | null;
  start_lat: number | string | null;
  start_lng: number | string | null;
  start_accuracy: number | string | null;
  end_lat: number | string | null;
  end_lng: number | string | null;
  end_accuracy: number | string | null;
}

interface SummaryResult {
  visits: SummaryVisit[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  sort: SortKey;
  dir: SortDirection;
}

interface PageProps {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}

type SortKey = "visit_date" | "school_name" | "pm_email" | "status" | "inserted_at" | "completed_at";
type SortDirection = "asc" | "desc";

const SORT_COLUMNS: Record<SortKey, { sql: string; defaultDir: SortDirection }> = {
  visit_date: { sql: "v.visit_date", defaultDir: "desc" },
  school_name: { sql: "s.name", defaultDir: "asc" },
  pm_email: { sql: "v.pm_email", defaultDir: "asc" },
  status: { sql: "v.status", defaultDir: "asc" },
  inserted_at: { sql: "v.inserted_at", defaultDir: "desc" },
  completed_at: { sql: "v.completed_at", defaultDir: "desc" },
};

function isSortKey(value: string | undefined): value is SortKey {
  return Boolean(value && value in SORT_COLUMNS);
}

function normalizeSort(sortParam?: string, dirParam?: string): { sort: SortKey; dir: SortDirection } {
  const sort = isSortKey(sortParam) ? sortParam : "visit_date";
  const dir = dirParam === "asc" || dirParam === "desc"
    ? dirParam
    : SORT_COLUMNS[sort].defaultDir;

  return { sort, dir };
}

function normalizePage(pageParam?: string): number {
  const parsed = Number.parseInt(pageParam || "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

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

function formatStatus(status: string): string {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "in_progress") {
    return "In Progress";
  }
  return status;
}

function formatSchool(visit: SummaryVisit): string {
  return visit.school_name ? `${visit.school_name} (${visit.school_code})` : visit.school_code;
}

function formatPm(visit: SummaryVisit): string {
  return visit.pm_name || visit.pm_email;
}

function formatDuration(visit: SummaryVisit, now = new Date()): string {
  const start = new Date(visit.inserted_at).getTime();
  const end = visit.completed_at ? new Date(visit.completed_at).getTime() : now.getTime();
  const minutes = Math.max(0, Math.floor((end - start) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}h ${remainingMinutes}m`;
}

function buildWhereClause(
  permission: UserPermission,
  actorEmail: string
): { whereSql: string; params: unknown[] } {
  const actor = buildVisitsActor(actorEmail, permission);
  const predicates = ["v.deleted_at IS NULL"];
  const params: unknown[] = [];

  const scope = buildVisitScopePredicate(actor, {
    startIndex: params.length + 1,
    schoolCodeColumn: "v.school_code",
    schoolRegionColumn: "s.region",
  });

  if (scope.clause) {
    predicates.push(scope.clause);
    params.push(...scope.params);
  }

  return {
    whereSql: predicates.join(" AND "),
    params,
  };
}

function buildOrderClause(sort: SortKey, dir: SortDirection): string {
  const sortColumn = SORT_COLUMNS[sort].sql;
  const nullsClause = sort === "completed_at" && dir === "asc" ? " NULLS LAST" : "";

  return `${sortColumn} ${dir.toUpperCase()}${nullsClause}, v.id DESC`;
}

async function getSummaryVisits(
  actorEmail: string,
  permission: UserPermission,
  searchParams: { sort?: string; dir?: string; page?: string }
): Promise<SummaryResult> {
  const { sort, dir } = normalizeSort(searchParams.sort, searchParams.dir);
  const requestedPage = normalizePage(searchParams.page);
  const { whereSql, params } = buildWhereClause(permission, actorEmail);

  const countRows = await query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE ${whereSql}`,
    params
  );
  const totalCount = Number.parseInt(countRows[0]?.total || "0", 10);
  const totalPages = Math.max(1, Math.ceil(totalCount / VISITS_PER_PAGE));
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * VISITS_PER_PAGE;
  const limitIndex = params.length + 1;
  const offsetIndex = params.length + 2;

  const visits = totalCount === 0
    ? []
    : await query<SummaryVisit>(
      `SELECT v.id, v.school_code, s.name AS school_name, v.pm_email,
              up.full_name AS pm_name, v.visit_date, v.status, v.inserted_at,
              v.completed_at, v.start_lat, v.start_lng, v.start_accuracy,
              v.end_lat, v.end_lng, v.end_accuracy
       FROM lms_pm_school_visits v
       LEFT JOIN school s ON s.code = v.school_code
       LEFT JOIN user_permission up ON LOWER(up.email) = LOWER(v.pm_email)
       WHERE ${whereSql}
       ORDER BY ${buildOrderClause(sort, dir)}
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...params, VISITS_PER_PAGE, offset]
    );

  return { visits, totalCount, currentPage, totalPages, sort, dir };
}

function sortHref(column: SortKey, currentSort: SortKey, currentDir: SortDirection): string {
  const dir = column === currentSort
    ? currentDir === "asc" ? "desc" : "asc"
    : SORT_COLUMNS[column].defaultDir;
  const params = new URLSearchParams({ sort: column, dir });
  return `/school-visit-summary?${params.toString()}`;
}

function SortHeader({
  column,
  currentSort,
  currentDir,
  children,
}: {
  column: SortKey;
  currentSort: SortKey;
  currentDir: SortDirection;
  children: React.ReactNode;
}) {
  const active = column === currentSort;

  return (
    <Link
      href={sortHref(column, currentSort, currentDir)}
      className="inline-flex items-center gap-1 hover:text-text-primary"
    >
      {children}
      {active && <span aria-hidden="true">{currentDir === "asc" ? "↑" : "↓"}</span>}
    </Link>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  sort,
  dir,
}: {
  currentPage: number;
  totalPages: number;
  sort: SortKey;
  dir: SortDirection;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const hrefFor = (page: number) => {
    const params = new URLSearchParams({ sort, dir });
    if (page > 1) {
      params.set("page", String(page));
    }
    return `/school-visit-summary?${params.toString()}`;
  };

  return (
    <nav className="mt-6 flex items-center justify-between border-t border-border bg-bg-card px-4 py-3 text-sm text-text-secondary">
      <span className="font-mono">
        Page {currentPage} of {totalPages}
      </span>
      <div className="flex gap-2">
        {currentPage > 1 ? (
          <Link href={hrefFor(currentPage - 1)} className="border border-border px-3 py-2 font-bold uppercase hover:bg-hover-bg">
            Previous
          </Link>
        ) : (
          <span className="border border-border px-3 py-2 text-text-muted">Previous</span>
        )}
        {currentPage < totalPages ? (
          <Link href={hrefFor(currentPage + 1)} className="border border-border px-3 py-2 font-bold uppercase hover:bg-hover-bg">
            Next
          </Link>
        ) : (
          <span className="border border-border px-3 py-2 text-text-muted">Next</span>
        )}
      </div>
    </nav>
  );
}

function VisitMobileCard({ visit }: { visit: SummaryVisit }) {
  return (
    <Link href={`/school-visit-summary/${visit.id}`} aria-label="View visit">
      <Card elevation="sm" className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-text-primary">{formatSchool(visit)}</div>
            <div className="mt-1 text-xs text-text-muted">{formatPm(visit)}</div>
          </div>
          <span className={`inline-flex shrink-0 ${statusBadgeClass(visit.status)}`}>
            {formatStatus(visit.status)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-text-muted">
          <span>{formatDate(visit.visit_date)}</span>
          <span>{formatDuration(visit)}</span>
        </div>
      </Card>
    </Link>
  );
}

function VisitDesktopTable({
  visits,
  sort,
  dir,
}: {
  visits: SummaryVisit[];
  sort: SortKey;
  dir: SortDirection;
}) {
  return (
    <Card elevation="sm" className="hidden overflow-x-auto sm:block">
      <table className="min-w-full">
        <thead className="border-b-2 border-border-accent bg-bg-card-alt">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="school_name" currentSort={sort} currentDir={dir}>School</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="pm_email" currentSort={sort} currentDir={dir}>PM</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="visit_date" currentSort={sort} currentDir={dir}>Visit Date</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="status" currentSort={sort} currentDir={dir}>Status</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="inserted_at" currentSort={sort} currentDir={dir}>Started At</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="completed_at" currentSort={sort} currentDir={dir}>Completed At</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              Duration
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              Start GPS
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              End GPS
            </th>
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
              Detail
            </th>
          </tr>
        </thead>
        <tbody className="bg-bg-card">
          {visits.map((visit) => (
            <tr key={visit.id} className="border-b border-border/40 hover:bg-hover-bg">
              <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-text-primary">
                {formatSchool(visit)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm text-text-secondary">
                <div>{formatPm(visit)}</div>
                {visit.pm_name && <div className="text-xs text-text-muted">{visit.pm_email}</div>}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                {formatDate(visit.visit_date)}
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                <span className={`inline-flex ${statusBadgeClass(visit.status)}`}>
                  {formatStatus(visit.status)}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                {formatTimestamp(visit.inserted_at)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                {formatTimestamp(visit.completed_at)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                {formatDuration(visit)}
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                <GpsMapLink lat={visit.start_lat} lng={visit.start_lng} accuracy={visit.start_accuracy} />
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                <GpsMapLink lat={visit.end_lat} lng={visit.end_lng} accuracy={visit.end_accuracy} />
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-right text-sm">
                <Link
                  href={`/school-visit-summary/${visit.id}`}
                  aria-label="View visit"
                  className="font-bold uppercase text-accent hover:text-accent-hover"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default async function SchoolVisitSummaryPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const rawSearchParams = await searchParams;

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

  const { visits, totalCount, currentPage, totalPages, sort, dir } = await getSummaryVisits(
    session.user.email,
    permission,
    rawSearchParams
  );

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-bg-card shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.avantifellows.org/af_logos/avanti_logo_black_text.webp"
              alt="Avanti Fellows"
              className="h-8 shrink-0 sm:h-10"
            />
            <nav className="flex gap-3 sm:gap-4">
              <Link
                href="/dashboard"
                className="pb-1 text-sm font-medium uppercase tracking-wide text-text-muted hover:text-text-primary"
              >
                Schools
              </Link>
              <Link
                href="/school-visit-summary"
                className="border-b-2 border-accent pb-1 text-sm font-bold uppercase tracking-wide text-text-primary"
              >
                Visit Summary
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            {permission.role === "admin" && (
              <Link href="/admin" className="text-sm font-bold uppercase text-accent hover:text-accent-hover">
                Admin
              </Link>
            )}
            <span className="hidden font-mono text-sm text-text-muted sm:inline">{session.user.email}</span>
            <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-2 border-b-4 border-border-accent pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">
              School Visit Summary
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {totalCount} visit{totalCount === 1 ? "" : "s"} found
            </p>
          </div>
        </div>

        {visits.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-text-muted uppercase tracking-wide">No visits found</div>
          </div>
        ) : (
          <>
            <div className="space-y-3 sm:hidden">
              {visits.map((visit) => (
                <VisitMobileCard key={visit.id} visit={visit} />
              ))}
            </div>

            <VisitDesktopTable visits={visits} sort={sort} dir={dir} />

            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              sort={sort}
              dir={dir}
            />
          </>
        )}
      </main>
    </div>
  );
}
