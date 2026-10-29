import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui";
import { AcademicLevelCards } from "@/components/visits/AcademicLevelCards";
import { SchoolConcernSections } from "@/components/visits/SchoolConcernSections";
import { SchoolInterventionFlags } from "@/components/visits/SchoolInterventionFlags";
import { canViewSchoolInterventionFlags } from "@/lib/intervention-flags";
import { canAccessSchoolSync, getFeatureAccess } from "@/lib/permissions";
import { getSchoolConcernPage, type SchoolConcernPage } from "@/lib/visit-concerns";
import { RECURRING_CONCERN_MIN_VISITS, formatIstDate, searchParamsWithout } from "@/lib/visit-summary";
import { requireVisitSummaryPage } from "@/lib/visit-summary-page";
import { normalizeVisitSummaryFilters } from "@/lib/visit-summary-scope";
import {
  getVisitSummaryAcademicLevelCards,
  getVisitSummarySchool,
  getVisitSummarySchoolFlags,
  getVisitSummarySchoolTeachers,
  type TeacherGroup,
  type VisitSummarySchool,
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
    <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <h2 id="teachers-heading" className="pt-1 text-xs font-bold uppercase tracking-wider text-text-muted">
        Teachers
      </h2>
      {groups.length === 0 ? (
        <p className="text-sm text-text-muted">No teachers at this School&apos;s physical centres</p>
      ) : (
        <ul aria-labelledby="teachers-heading" className="space-y-2">
          {groups.map((group) => (
            <li key={group.tag} className="flex items-start gap-2">
              <span className="mt-1.5 shrink-0 rounded bg-accent px-2 py-1 text-xs font-bold uppercase leading-none text-text-on-accent">
                {group.tag}
              </span>
              <ul aria-label={`${group.tag} teachers`} className="flex min-w-0 flex-wrap gap-2">
                {group.seats.map((seat, index) => (
                  <li key={index} className="rounded-full bg-bg-card-alt px-3 py-1 text-sm text-text-primary">
                    <span className="text-xs font-bold uppercase tracking-wide text-text-muted">{seat.subject}</span>
                    {" - "}
                    <span>{seat.name}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// The School name, its code, region and Visits in view, and the concern counts — every number
// from the same concern page (and so the same filters) as the sections below.
function SchoolHeader({ school, page }: { school: VisitSummarySchool; page: SchoolConcernPage }) {
  const lastVisit = page.visitNotes[0]?.visitDate;
  const subline = [
    school.code,
    school.region,
    plural(page.visitNotes.length, "visit"),
    lastVisit ? `last ${formatIstDate(lastVisit)}` : null,
  ].filter(Boolean);
  const recurring = page.needsAttention.filter((card) => card.visitCount >= RECURRING_CONCERN_MIN_VISITS).length;
  const chips = [
    { label: `${plural(page.needsAttention.length, "open concern")}`, className: "bg-danger-bg text-danger" },
    { label: `${recurring} recurring`, className: "bg-accent text-text-on-accent" },
    { label: plural(page.goingWell.length, "highlight"), className: "bg-success-bg text-success" },
    { label: `${page.resolved.length} resolved`, className: "border border-border bg-bg-card text-text-secondary" },
  ];
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-4 border-border-accent pb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">{school.name}</h1>
        <p className="mt-1 text-sm text-text-secondary">{subline.join(" · ")}</p>
      </div>
      <ul aria-label="Concern counts" className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.label} className={`rounded-full px-3 py-1 text-sm font-bold ${chip.className}`}>
            {chip.label}
          </li>
        ))}
      </ul>
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
    canViewFlags ? getVisitSummarySchoolFlags(school, permission) : null,
  ]);

  return (
    <div className="min-h-screen bg-bg">
      <div className="sticky top-0 z-10 border-b border-border bg-bg-card/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6 lg:px-8">
        <Link href={backHref(currentParams)} className="text-sm font-bold uppercase text-accent hover:text-accent-hover">
          &larr; Back to School-wise
        </Link>
      </div>

      <main className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <SchoolHeader school={school} page={concernPage} />

        <Card elevation="sm" className="divide-y divide-border px-4">
          <div className="py-4">
            <TeachersLine groups={teacherGroups} />
          </div>
          {academicLevels && (
            <div className="py-4">
              <AcademicLevelCards data={academicLevels} />
            </div>
          )}
        </Card>

        {/* Resolve / Comment / Reopen follow the rule the events API enforces: visits edit. */}
        <SchoolConcernSections
          page={concernPage}
          today={new Date()}
          canAct={visitsAccess.canEdit}
          visitBackHref={selfHref(school.code, currentParams)}
          flags={flags && <SchoolInterventionFlags flags={flags} />}
        />
      </main>
    </div>
  );
}
