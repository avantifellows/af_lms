import { getServerSession } from "next-auth";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import {
  getAcademicMentorshipAcademicYears,
  isAcademicMentorshipEditableYear,
  isValidAcademicYear,
  listAcademicMentorshipMappings,
  listAccessibleAcademicMentorshipSchools,
  requireAcademicMentorshipAccess,
  type AcademicMentorshipMappingGroup,
  type AcademicMentorshipSchool,
} from "@/lib/academic-mentorship";
import { Badge, Card } from "@/components/ui";
import AcademicMentorshipManager from "@/components/academic-mentorship/AcademicMentorshipManager";

interface PageProps {
  searchParams?:
    | Promise<{ [key: string]: string | string[] | undefined }>
    | { [key: string]: string | string[] | undefined };
}

type SearchParams = { [key: string]: string | string[] | undefined };
type Session = NonNullable<Awaited<ReturnType<typeof getServerSession>>>;
type AuthenticatedSession = Session & { user: { email: string } };
type AcademicMentorshipAccess = Awaited<
  ReturnType<typeof requireAcademicMentorshipAccess>
>;
type AcademicMentorshipOkAccess = Extract<AcademicMentorshipAccess, { ok: true }>;

interface PageModel {
  academicYears: string[];
  selectedAcademicYear: string;
  selectedSchoolCode: string;
  includeHistory: boolean;
  schools: AcademicMentorshipSchool[];
  selectedSchool: AcademicMentorshipSchool | undefined;
  groups: AcademicMentorshipMappingGroup[];
  canEdit: boolean;
  historyHref: string;
  accessLabel: string;
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function selectionUrl(params: {
  schoolCode: string;
  academicYear: string;
  includeHistory?: boolean;
}) {
  const searchParams = new URLSearchParams({
    school_code: params.schoolCode,
    academic_year: params.academicYear,
  });
  if (params.includeHistory) searchParams.set("include_history", "true");
  return `/admin/academic-mentorship?${searchParams.toString()}`;
}

async function requirePageAccess(session: Session) {
  const access = await requireAcademicMentorshipAccess(session, "view");
  const role = access.ok ? access.permission.role : null;
  if (!access.ok || (role !== "admin" && role !== "program_admin")) {
    redirect("/dashboard");
  }
  return access;
}

function selectedFilters(searchParams: SearchParams, academicYears: string[]) {
  return {
    academicYear: firstParam(searchParams.academic_year) || academicYears[0],
    schoolCode: firstParam(searchParams.school_code),
    includeHistory: firstParam(searchParams.include_history) === "true",
  };
}

function historyUrl(
  schoolCode: string | undefined,
  academicYear: string,
  includeHistory: boolean
) {
  return schoolCode
    ? selectionUrl({ schoolCode, academicYear, includeHistory: !includeHistory })
    : "#";
}

async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/");
  }
  return session as AuthenticatedSession;
}

async function resolveSearchParams(
  searchParams: PageProps["searchParams"]
): Promise<SearchParams> {
  return searchParams ? Promise.resolve(searchParams) : {};
}

function redirectToOnlySchool(params: {
  schools: AcademicMentorshipSchool[];
  selectedSchoolCode: string;
  selectedAcademicYear: string;
  includeHistory: boolean;
}) {
  if (params.selectedSchoolCode || params.schools.length !== 1) return;
  redirect(
    selectionUrl({
      schoolCode: params.schools[0].code,
      academicYear: params.selectedAcademicYear,
      includeHistory: params.includeHistory,
    })
  );
}

async function resolveSelectedAccess(
  session: AuthenticatedSession,
  selectedSchool: AcademicMentorshipSchool | undefined,
  selectedAcademicYear: string
): Promise<AcademicMentorshipOkAccess | null> {
  if (!selectedSchool || !isValidAcademicYear(selectedAcademicYear)) return null;
  const access = await requireAcademicMentorshipAccess(session, "view", {
    schoolCode: selectedSchool.code,
  });
  if (!access.ok) {
    redirect("/dashboard");
  }
  return access;
}

async function loadSelectedGroups(
  selectedAccess: AcademicMentorshipOkAccess | null,
  selectedAcademicYear: string,
  includeHistory: boolean
): Promise<AcademicMentorshipMappingGroup[]> {
  if (!selectedAccess?.school) return [];
  return listAcademicMentorshipMappings({
    schoolId: selectedAccess.school.id,
    academicYear: selectedAcademicYear,
    includeHistory,
  });
}

function canEditSelection(
  selectedAccess: AcademicMentorshipOkAccess | null,
  selectedAcademicYear: string
) {
  return (
    selectedAccess?.canEdit === true &&
    isAcademicMentorshipEditableYear(selectedAcademicYear)
  );
}

async function loadPageModel(
  session: AuthenticatedSession,
  resolvedSearchParams: SearchParams
): Promise<PageModel> {
  const baseAccess = await requirePageAccess(session);
  const academicYears = getAcademicMentorshipAcademicYears();
  const {
    academicYear: selectedAcademicYear,
    schoolCode: selectedSchoolCode,
    includeHistory,
  } = selectedFilters(resolvedSearchParams, academicYears);
  const schools = await listAccessibleAcademicMentorshipSchools(baseAccess.permission);

  redirectToOnlySchool({ schools, selectedSchoolCode, selectedAcademicYear, includeHistory });

  const selectedSchool = schools.find((school) => school.code === selectedSchoolCode);
  const selectedAccess = await resolveSelectedAccess(
    session,
    selectedSchool,
    selectedAcademicYear
  );
  const groups = await loadSelectedGroups(
    selectedAccess,
    selectedAcademicYear,
    includeHistory
  );
  const canEdit = canEditSelection(selectedAccess, selectedAcademicYear);
  const historyHref = historyUrl(selectedSchool?.code, selectedAcademicYear, includeHistory);
  const accessLabel = canEdit ? "Edit access" : "View-only";

  return {
    academicYears,
    selectedAcademicYear,
    selectedSchoolCode,
    includeHistory,
    schools,
    selectedSchool,
    groups,
    canEdit,
    historyHref,
    accessLabel,
  };
}

function PageHeader({ email }: { email: string }) {
  return (
    <header className="bg-bg-card border-b border-border shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="-m-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-hover-bg hover:text-text-primary"
            aria-label="Back to admin"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">
              Academic Mentorship
            </h1>
            <p className="font-mono text-xs text-text-muted">{email}</p>
          </div>
        </div>
        <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">
          Sign out
        </Link>
      </div>
    </header>
  );
}

function SelectionForm({
  academicYears,
  selectedAcademicYear,
  selectedSchoolCode,
  includeHistory,
  schools,
}: Pick<
  PageModel,
  | "academicYears"
  | "selectedAcademicYear"
  | "selectedSchoolCode"
  | "includeHistory"
  | "schools"
>) {
  return (
    <Card className="overflow-hidden p-4">
      <form action="/admin/academic-mentorship" className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-text-primary" htmlFor="school_code">
          School
          <select
            id="school_code"
            name="school_code"
            defaultValue={selectedSchoolCode}
            className="min-h-[44px] w-full min-w-0 max-w-full rounded-lg border-2 border-border bg-bg-card px-3 py-2 text-sm font-normal focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Select a School</option>
            {schools.map((school) => (
              <option key={`${school.id}-${school.code}`} value={school.code}>
                {school.name} ({school.code})
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-text-primary" htmlFor="academic_year">
          Academic year
          <select
            id="academic_year"
            name="academic_year"
            defaultValue={selectedAcademicYear}
            className="min-h-[44px] w-full min-w-0 max-w-full rounded-lg border-2 border-border bg-bg-card px-3 py-2 text-sm font-normal focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            {!academicYears.includes(selectedAcademicYear) && (
              <option value={selectedAcademicYear}>{selectedAcademicYear}</option>
            )}
            {academicYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        {includeHistory && <input type="hidden" name="include_history" value="true" />}
        <button className="min-h-[44px] rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover">
          Apply
        </button>
      </form>
    </Card>
  );
}

function SelectionSummary({
  canEdit,
  accessLabel,
  selectedSchool,
  selectedAcademicYear,
  historyHref,
  includeHistory,
}: Pick<
  PageModel,
  | "canEdit"
  | "accessLabel"
  | "selectedSchool"
  | "selectedAcademicYear"
  | "historyHref"
  | "includeHistory"
>) {
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
        <Badge variant={canEdit ? "success" : "default"}>{accessLabel}</Badge>
        {selectedSchool ? (
          <span>
            {selectedSchool.name} | <span className="font-mono">{selectedAcademicYear}</span>
          </span>
        ) : (
          <span>Select a School to load mentorship mappings.</span>
        )}
      </div>
      {selectedSchool && (
        <Link
          href={historyHref}
          className="inline-flex min-h-9 w-fit items-center justify-center rounded-lg border border-border bg-bg-card px-3 text-sm font-bold text-accent hover:bg-hover-bg hover:text-accent-hover"
        >
          {includeHistory ? "Hide history" : "Show history"}
        </Link>
      )}
    </div>
  );
}

function SelectedSchoolContent({
  selectedSchool,
  selectedAcademicYear,
  includeHistory,
  canEdit,
  groups,
}: Pick<
  PageModel,
  "selectedSchool" | "selectedAcademicYear" | "includeHistory" | "canEdit" | "groups"
>) {
  if (!selectedSchool) {
    return <Card className="mt-4 p-6 text-sm text-text-muted">Select a School to view mappings.</Card>;
  }

  return (
    <AcademicMentorshipManager
      schoolCode={selectedSchool.code}
      academicYear={selectedAcademicYear}
      includeHistory={includeHistory}
      canEdit={canEdit}
      initialGroups={groups}
    />
  );
}

export default async function AcademicMentorshipPage({ searchParams }: PageProps = {}) {
  const session = await requireSession();
  const resolvedSearchParams = await resolveSearchParams(searchParams);
  const model = await loadPageModel(session, resolvedSearchParams);

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader email={session.user.email} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SelectionForm {...model} />
        <SelectionSummary {...model} />
        <SelectedSchoolContent {...model} />
      </main>
    </div>
  );
}
