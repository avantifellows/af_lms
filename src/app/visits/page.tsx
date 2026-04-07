import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserPermission, getFeatureAccess } from "@/lib/permissions";
import { query } from "@/lib/db";
import {
  buildVisitScopePredicate,
  buildVisitsActor,
  isScopedVisitsRole,
} from "@/lib/visits-policy";
import Link from "next/link";
import { Card, Input, Select, FormLabel, Button } from "@/components/ui";

interface Visit {
  id: number;
  school_code: string;
  pm_email: string;
  school_name?: string;
  visit_date: string;
  status: string;
  inserted_at: string;
  completed_at: string | null;
}

interface VisitFilters {
  schoolCode?: string;
  status?: "in_progress" | "completed";
  pmEmail?: string;
}

interface PageProps {
  searchParams: Promise<{
    school_code?: string;
    status?: string;
    pm_email?: string;
  }>;
}

function normalizeVisitFilters(raw: {
  school_code?: string;
  status?: string;
  pm_email?: string;
}): VisitFilters {
  const schoolCode = raw.school_code?.trim() || "";
  const pmEmail = raw.pm_email?.trim() || "";
  const status = raw.status === "completed" || raw.status === "in_progress"
    ? raw.status
    : undefined;

  return {
    schoolCode: schoolCode || undefined,
    pmEmail: pmEmail || undefined,
    status,
  };
}

async function getVisits(
  actorEmail: string,
  permission: NonNullable<Awaited<ReturnType<typeof getUserPermission>>>,
  filters: VisitFilters
): Promise<Visit[]> {
  const actor = buildVisitsActor(actorEmail, permission);
  const whereClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (actor.role === "program_manager") {
    whereClauses.push(`LOWER(v.pm_email) = LOWER($${paramIndex})`);
    params.push(actor.email);
    paramIndex += 1;
  } else if (filters.pmEmail) {
    whereClauses.push(`LOWER(v.pm_email) = LOWER($${paramIndex})`);
    params.push(filters.pmEmail);
    paramIndex += 1;
  }

  if (filters.schoolCode) {
    whereClauses.push(`v.school_code = $${paramIndex}`);
    params.push(filters.schoolCode);
    paramIndex += 1;
  }

  if (filters.status) {
    whereClauses.push(`v.status = $${paramIndex}`);
    params.push(filters.status);
    paramIndex += 1;
  }

  if (isScopedVisitsRole(actor)) {
    const scope = buildVisitScopePredicate(actor, {
      startIndex: paramIndex,
      schoolCodeColumn: "v.school_code",
      schoolRegionColumn: "s.region",
    });
    if (scope.clause) {
      whereClauses.push(scope.clause);
      params.push(...scope.params);
    }
  }

  return query<Visit>(
    `SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status,
            v.inserted_at, v.completed_at,
            s.name as school_name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
     ORDER BY v.visit_date DESC, v.inserted_at DESC`,
    params
  );
}

export default async function VisitsListPage({ searchParams }: PageProps) {
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

  const filters = normalizeVisitFilters(rawSearchParams);
  const isScopedRole = permission.role === "admin" || permission.role === "program_admin";
  const scopedFilters: VisitFilters = {
    schoolCode: filters.schoolCode,
    status: filters.status,
    pmEmail: isScopedRole ? filters.pmEmail : undefined,
  };

  const visits = await getVisits(session.user.email, permission, scopedFilters);

  const inProgress = visits.filter((v) => v.status === "in_progress");
  const completed = visits.filter((v) => v.status === "completed");

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://cdn.avantifellows.org/af_logos/avanti_logo_black_text.webp" alt="Avanti Fellows" className="h-8 sm:h-10" />
            <nav className="flex gap-4">
              <Link
                href="/dashboard"
                className="text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-1"
              >
                Schools
              </Link>
              <Link
                href="/visits"
                className="text-sm font-bold text-text-primary uppercase tracking-wide border-b-2 border-accent pb-1"
              >
                Visits
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {permission.role === "admin" && (
              <Link
                href="/admin"
                className="text-sm font-bold text-accent hover:text-accent-hover uppercase"
              >
                Admin
              </Link>
            )}
            <span className="text-sm text-text-muted font-mono hidden sm:inline">{session.user.email}</span>
            <Link
              href="/api/auth/signout"
              className="text-sm font-bold text-danger hover:text-danger/80"
            >
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6 border-b-4 border-border-accent pb-4">
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">All Visits</h1>
          <div className="text-sm text-text-secondary font-mono">
            {visits.length} total ({inProgress.length} in progress)
          </div>
        </div>

        {isScopedRole && (
          <form method="get">
          <Card elevation="sm" className="mb-6 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <FormLabel htmlFor="school_code">
                  School Code
                </FormLabel>
                <Input
                  id="school_code"
                  name="school_code"
                  defaultValue={scopedFilters.schoolCode || ""}
                  placeholder="e.g. 70705"
                />
              </div>
              <div>
                <FormLabel htmlFor="status">
                  Status
                </FormLabel>
                <Select
                  id="status"
                  name="status"
                  defaultValue={scopedFilters.status || ""}
                >
                  <option value="">All</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </Select>
              </div>
              <div>
                <FormLabel htmlFor="pm_email">
                  PM Email
                </FormLabel>
                <Input
                  id="pm_email"
                  name="pm_email"
                  type="email"
                  defaultValue={scopedFilters.pmEmail || ""}
                  placeholder="pm@avantifellows.org"
                />
              </div>
              <div className="flex items-end gap-2 sm:col-span-1">
                <Button
                  type="submit"
                  size="sm"
                  className="flex-1 sm:flex-none uppercase tracking-wide"
                >
                  Apply
                </Button>
                <Link
                  href="/visits"
                  className="inline-flex items-center justify-center rounded-lg border border-border bg-bg-card px-4 text-sm font-bold uppercase tracking-wide text-text-secondary shadow-sm hover:bg-hover-bg active:bg-bg-card-alt min-h-[36px] py-1.5 flex-1 sm:flex-none"
                >
                  Reset
                </Link>
              </div>
            </div>
          </Card>
          </form>
        )}

        {/* In Progress Section */}
        {inProgress.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide mb-4 border-b-2 border-brand-amber pb-2">
              In Progress
            </h2>

            {/* Mobile: card layout */}
            <div className="sm:hidden space-y-3">
              {inProgress.map((visit) => (
                <Card key={visit.id} elevation="sm" className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-3">
                    <div>
                      <div className="text-sm font-medium text-text-primary">
                        {visit.school_name || visit.school_code}
                      </div>
                      <div className="text-xs text-text-muted">Code: {visit.school_code}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted font-mono mb-3">
                    <span>Visit: {new Date(visit.visit_date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Kolkata" })}</span>
                    <span>Started: {new Date(visit.inserted_at).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Kolkata" })}</span>
                  </div>
                  <Link
                    href={`/visits/${visit.id}`}
                    className="inline-flex items-center justify-center w-full rounded-lg bg-accent px-4 text-sm font-bold text-text-on-accent shadow-sm hover:bg-accent-hover active:bg-accent-hover/90 min-h-[44px] py-2.5 uppercase tracking-wide"
                  >
                    Continue
                  </Link>
                </Card>
              ))}
            </div>

            {/* Desktop: table layout */}
            <Card elevation="sm" className="hidden sm:block overflow-hidden">
              <table className="min-w-full">
                <thead className="bg-bg-card-alt border-b-2 border-border-accent">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      School
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      Visit Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      Started
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-text-muted uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-bg-card">
                  {inProgress.map((visit) => (
                    <tr key={visit.id} className="border-b border-border/40 hover:bg-hover-bg">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-text-primary">
                          {visit.school_name || visit.school_code}
                        </div>
                        <div className="text-xs text-text-muted">
                          Code: {visit.school_code}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary font-mono">
                        {new Date(visit.visit_date).toLocaleDateString("en-IN", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary font-mono">
                        {new Date(visit.inserted_at).toLocaleDateString("en-IN", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          href={`/visits/${visit.id}`}
                          className="inline-flex items-center rounded-lg bg-accent px-3 py-1 text-sm font-bold uppercase tracking-wide text-text-on-accent shadow-sm hover:bg-accent-hover"
                        >
                          Continue
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* Completed Section */}
        {completed.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide mb-4 border-b-2 border-brand-gold pb-2">Completed</h2>

            {/* Mobile: card layout */}
            <div className="sm:hidden space-y-3">
              {completed.map((visit) => (
                <Card key={visit.id} elevation="sm" className="p-4">
                  <div className="mb-3">
                    <div className="text-sm font-medium text-text-primary">
                      {visit.school_name || visit.school_code}
                    </div>
                    <div className="text-xs text-text-muted">Code: {visit.school_code}</div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted font-mono mb-3">
                    <span>Visit: {new Date(visit.visit_date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Kolkata" })}</span>
                    <span>Completed: {new Date(visit.completed_at || visit.inserted_at).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Kolkata" })}</span>
                  </div>
                  <Link
                    href={`/visits/${visit.id}`}
                    className="inline-flex items-center justify-center w-full px-4 py-2.5 text-sm font-bold uppercase tracking-wide border-2 border-accent text-accent hover:bg-accent hover:text-text-on-accent transition-colors"
                  >
                    View
                  </Link>
                </Card>
              ))}
            </div>

            {/* Desktop: table layout */}
            <Card elevation="sm" className="hidden sm:block overflow-hidden">
              <table className="min-w-full">
                <thead className="bg-bg-card-alt border-b-2 border-border-accent">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      School
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      Visit Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      Completed
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-text-muted uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-bg-card">
                  {completed.map((visit) => (
                    <tr key={visit.id} className="border-b border-border/40 hover:bg-hover-bg">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-text-primary">
                          {visit.school_name || visit.school_code}
                        </div>
                        <div className="text-xs text-text-muted">
                          Code: {visit.school_code}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary font-mono">
                        {new Date(visit.visit_date).toLocaleDateString("en-IN", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary font-mono">
                        {new Date(visit.completed_at || visit.inserted_at).toLocaleDateString("en-IN", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          href={`/visits/${visit.id}`}
                          className="text-accent hover:text-accent-hover font-bold uppercase"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {visits.length === 0 && (
          <div className="text-center py-12">
            <div className="text-text-muted mb-4 uppercase tracking-wide">No visits recorded yet.</div>
            <Link
              href="/dashboard"
              className="text-accent hover:text-accent-hover font-bold uppercase"
            >
              Go to dashboard to start a visit
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
