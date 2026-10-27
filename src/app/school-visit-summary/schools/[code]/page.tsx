import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui";
import { AcademicLevelCards } from "@/components/visits/AcademicLevelCards";
import { SchoolConcernSections } from "@/components/visits/SchoolConcernSections";
import { SchoolInterventionFlags } from "@/components/visits/SchoolInterventionFlags";
import { canViewSchoolInterventionFlags } from "@/lib/intervention-flags";
import { canAccessSchoolSync, getFeatureAccess } from "@/lib/permissions";
import { getSchoolConcernPage } from "@/lib/visit-concerns";
import { searchParamsWithout } from "@/lib/visit-summary";
import { requireVisitSummaryPage } from "@/lib/visit-summary-page";
import { normalizeVisitSummaryFilters } from "@/lib/visit-summary-scope";
import {
  getVisitSummaryAcademicLevelCards,
  getVisitSummarySchool,
  getVisitSummarySchoolFlags,
  getVisitSummarySchoolTeachers,
  type TeacherGroup,
} from "@/lib/visit-summary-school";

type SummarySearchParams = Record<string, string | undefined>;

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<SummarySearchParams>;
}

// Back to the School-wise tab with every filter (and its sort) the row link carried here.
function backHref(currentParams: SummarySearchParams): string {
  return `/school-visit-summary?${searchParamsWithout(currentParams, ["tab"], { tab: "schools" }).toString()}`;
}

// This page with the same filters, for a Visit's detail page to come Back to.
function selfHref(schoolCode: string, currentParams: SummarySearchParams): string {
  const query = searchParamsWithout(currentParams, []).toString();
  return `/school-visit-summary/schools/${encodeURIComponent(schoolCode)}${query ? `?${query}` : ""}`;
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
  const { actor, visitsAccess } = await requireVisitSummaryPage();
  const { permission } = actor;

  const school = await getVisitSummarySchool(actor, code);
  if (!school) {
    notFound();
  }

  // Academic levels follow the Performance gate the cumulative-ALs API uses: School access plus
  // `performance` view. Without it the strip has no cards and BigQuery is never queried.
  const canViewPerformance =
    canAccessSchoolSync(permission, school.code, school.region ?? undefined) &&
    getFeatureAccess(permission, "performance").canView;

  // Flags follow the rule behind `authorizeInterventionFlags(…, "view")`; without it the section is
  // omitted and flags are never read.
  const canViewFlags = canViewSchoolInterventionFlags(permission, school);

  const [teacherGroups, concernPage, academicLevels, flags] = await Promise.all([
    getVisitSummarySchoolTeachers(school.code),
    getSchoolConcernPage(actor, school.code, normalizeVisitSummaryFilters(currentParams)),
    canViewPerformance ? getVisitSummaryAcademicLevelCards(school) : null,
    canViewFlags ? getVisitSummarySchoolFlags(school.code) : null,
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

        <Card elevation="sm" className="space-y-4 p-4">
          <TeachersLine groups={teacherGroups} />
          {academicLevels && <AcademicLevelCards data={academicLevels} />}
        </Card>

        {/* Resolve / Comment / Reopen follow the rule the events API enforces: visits edit. */}
        <SchoolConcernSections
          page={concernPage}
          today={new Date()}
          canAct={visitsAccess.canEdit}
          visitBackHref={selfHref(school.code, currentParams)}
          flags={flags && <SchoolInterventionFlags schoolCode={school.code} flags={flags} />}
        />
      </main>
    </div>
  );
}
