import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui";
import { SchoolConcernSections } from "@/components/visits/SchoolConcernSections";
import { authOptions } from "@/lib/auth";
import { getFeatureAccess, getResolvedPermission } from "@/lib/permissions";
import { getSchoolConcernPage } from "@/lib/visit-concerns";
import { normalizeVisitSummaryFilters } from "@/lib/visit-summary-scope";
import {
  getVisitSummarySchool,
  getVisitSummarySchoolTeachers,
  type TeacherGroup,
} from "@/lib/visit-summary-school";
import { buildVisitsActor, canViewVisitSummary } from "@/lib/visits-policy";

type SummarySearchParams = Record<string, string | undefined>;

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<SummarySearchParams>;
}

// Back to the School-wise tab with every filter (and its sort) the row link carried here.
function backHref(currentParams: SummarySearchParams): string {
  const params = new URLSearchParams({ tab: "schools" });
  for (const [key, value] of Object.entries(currentParams)) {
    if (value && key !== "tab") {
      params.set(key, value);
    }
  }
  return `/school-visit-summary?${params.toString()}`;
}

function TeachersLine({ groups }: { groups: TeacherGroup[] }) {
  return (
    <div>
      <h2 id="teachers-heading" className="text-xs font-bold uppercase tracking-wider text-text-muted">
        Teachers
      </h2>
      {groups.length === 0 ? (
        <p className="mt-1 text-sm text-text-muted">No teaching seats at this School&apos;s physical centres</p>
      ) : (
        <ul aria-labelledby="teachers-heading" className="mt-1 space-y-1">
          {groups.map((group) => (
            <li key={group.tag} className="text-sm text-text-primary">
              <span className="mr-2 inline-flex border border-border bg-bg-card-alt px-1.5 py-0.5 text-xs font-bold uppercase text-text-secondary">
                {group.tag}
              </span>{" "}
              {group.seats
                .map((seat) => `${seat.subject} - ${seat.name ?? "Vacant"}`)
                .join(" · ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function SchoolVisitSummarySchoolPage({ params, searchParams }: PageProps) {
  const [{ code }, currentParams] = await Promise.all([params, searchParams]);
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const permission = await getResolvedPermission(session.user.email);
  if (!permission) {
    redirect("/dashboard");
  }

  const visitsAccess = getFeatureAccess(permission, "visits");
  if (!visitsAccess.canView) {
    redirect("/dashboard");
  }

  const actor = buildVisitsActor(session.user.email, permission);
  if (!canViewVisitSummary(actor)) {
    if (actor.role === "program_manager") {
      redirect("/visits");
    }
    redirect("/dashboard");
  }

  const school = await getVisitSummarySchool(actor, code);
  if (!school) {
    notFound();
  }

  const [teacherGroups, concernPage] = await Promise.all([
    getVisitSummarySchoolTeachers(school.code),
    getSchoolConcernPage(actor, school.code, normalizeVisitSummaryFilters(currentParams)),
  ]);

  return (
    <div className="min-h-screen bg-bg">
      <div className="sticky top-0 z-10 border-b border-border bg-bg-card/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6 lg:px-8">
        <Link href={backHref(currentParams)} className="text-sm font-bold uppercase text-accent hover:text-accent-hover">
          &larr; Back to School-wise
        </Link>
      </div>

      <main className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="border-b-4 border-border-accent pb-4">
          <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">
            {school.name}
            {school.region && <>{" "}<span className="font-normal text-text-muted">({school.region})</span></>}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">School Visit Summary</p>
        </div>

        <Card elevation="sm" className="p-4">
          <TeachersLine groups={teacherGroups} />
        </Card>

        {/* Resolve / Comment / Reopen follow the rule the events API enforces: visits edit. */}
        <SchoolConcernSections page={concernPage} today={new Date()} canAct={visitsAccess.canEdit} />
      </main>
    </div>
  );
}
