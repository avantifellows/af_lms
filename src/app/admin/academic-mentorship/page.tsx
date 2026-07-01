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
  listAcademicMentorshipProgramSchoolLinks,
  listAcademicMentorshipProgramsForSchools,
  listAccessibleAcademicMentorshipSchools,
  requireAcademicMentorshipAccess,
  type AcademicMentorshipMappingGroup,
  type AcademicMentorshipProgram,
  type AcademicMentorshipProgramSchoolLink,
  type AcademicMentorshipSchool,
} from "@/lib/academic-mentorship";
import { Badge, Card } from "@/components/ui";
import AcademicMentorshipManager from "@/components/academic-mentorship/AcademicMentorshipManager";
import AcademicMentorshipSelectionForm from "@/components/academic-mentorship/AcademicMentorshipSelectionForm";

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
  selectedProgramId: number | null;
  includeHistory: boolean;
  programs: AcademicMentorshipProgram[];
  programSchoolLinks: AcademicMentorshipProgramSchoolLink[];
  schools: AcademicMentorshipSchool[];
  selectedSchool: AcademicMentorshipSchool | undefined;
  groups: AcademicMentorshipMappingGroup[];
  canEdit: boolean;
  canUpload: boolean;
  historyHref: string;
  accessLabel: string;
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function selectionUrl(params: {
  schoolCode?: string;
  academicYear: string;
  programId?: number | null;
  includeHistory?: boolean;
}) {
  const searchParams = new URLSearchParams();
  if (params.schoolCode) searchParams.set("school_code", params.schoolCode);
  searchParams.set("academic_year", params.academicYear);
  if (params.programId) searchParams.set("program_id", String(params.programId));
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
  const programId = Number(firstParam(searchParams.program_id));
  return {
    academicYear: firstParam(searchParams.academic_year) || academicYears[0],
    schoolCode: firstParam(searchParams.school_code),
    programId: Number.isInteger(programId) && programId > 0 ? programId : null,
    includeHistory: firstParam(searchParams.include_history) === "true",
  };
}

function historyUrl(
  schoolCode: string | undefined,
  academicYear: string,
  programId: number | null,
  includeHistory: boolean
) {
  return schoolCode
    ? selectionUrl({ schoolCode, academicYear, programId, includeHistory: !includeHistory })
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
  selectedProgramId: number | null;
  includeHistory: boolean;
}) {
  if (params.selectedSchoolCode || params.schools.length !== 1) return;
  redirect(
    selectionUrl({
      schoolCode: params.schools[0].code,
      academicYear: params.selectedAcademicYear,
      programId: params.selectedProgramId,
      includeHistory: params.includeHistory,
    })
  );
}

function schoolsForProgram(
  schools: AcademicMentorshipSchool[],
  programSchoolLinks: AcademicMentorshipProgramSchoolLink[],
  programId: number | null
): AcademicMentorshipSchool[] {
  if (programId === null) return schools;
  const schoolIds = new Set(
    programSchoolLinks
      .filter((link) => link.programId === programId)
      .map((link) => link.schoolId)
  );
  return schools.filter((school) => schoolIds.has(school.id));
}

function redirectInvalidSchoolSelection(params: {
  selectedSchoolCode: string;
  selectedSchool: AcademicMentorshipSchool | undefined;
  selectedAcademicYear: string;
  selectedProgramId: number | null;
  includeHistory: boolean;
}) {
  if (!params.selectedSchoolCode || params.selectedSchool) return;
  redirect(
    selectionUrl({
      academicYear: params.selectedAcademicYear,
      programId: params.selectedProgramId,
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
  includeHistory: boolean,
  programId: number | null
): Promise<AcademicMentorshipMappingGroup[]> {
  if (!selectedAccess?.school) return [];
  return listAcademicMentorshipMappings({
    schoolId: selectedAccess.school.id,
    academicYear: selectedAcademicYear,
    includeHistory,
    programId,
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
    programId: selectedProgramId,
    includeHistory,
  } = selectedFilters(resolvedSearchParams, academicYears);
  const accessibleSchools = await listAccessibleAcademicMentorshipSchools(baseAccess.permission);
  const accessibleSchoolIds = accessibleSchools.map((school) => school.id);
  const programs = await listAcademicMentorshipProgramsForSchools(
    accessibleSchoolIds,
    selectedAcademicYear
  );
  const programSchoolLinks = await listAcademicMentorshipProgramSchoolLinks(
    accessibleSchoolIds,
    selectedAcademicYear
  );
  const schoolsForSelectedProgram = schoolsForProgram(
    accessibleSchools,
    programSchoolLinks,
    selectedProgramId
  );

  redirectToOnlySchool({
    schools: schoolsForSelectedProgram,
    selectedSchoolCode,
    selectedAcademicYear,
    selectedProgramId,
    includeHistory,
  });

  const selectedSchool = schoolsForSelectedProgram.find(
    (school) => school.code === selectedSchoolCode
  );
  redirectInvalidSchoolSelection({
    selectedSchoolCode,
    selectedSchool,
    selectedAcademicYear,
    selectedProgramId,
    includeHistory,
  });
  const selectedAccess = await resolveSelectedAccess(
    session,
    selectedSchool,
    selectedAcademicYear
  );
  const groups = await loadSelectedGroups(
    selectedAccess,
    selectedAcademicYear,
    includeHistory,
    selectedProgramId
  );
  const canEdit = canEditSelection(selectedAccess, selectedAcademicYear);
  const canUpload = selectedAccess?.canEdit === true;
  const historyHref = historyUrl(
    selectedSchool?.code,
    selectedAcademicYear,
    selectedProgramId,
    includeHistory
  );
  const accessLabel = canEdit ? "Edit access" : canUpload ? "CSV-only backfill" : "View-only";

  return {
    academicYears,
    selectedAcademicYear,
    selectedSchoolCode,
    selectedProgramId,
    includeHistory,
    programs,
    programSchoolLinks,
    schools: accessibleSchools,
    selectedSchool,
    groups,
    canEdit,
    canUpload,
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
  selectedProgramId,
  includeHistory,
  canEdit,
  canUpload,
  groups,
}: Pick<
  PageModel,
  | "selectedSchool"
  | "selectedAcademicYear"
  | "selectedProgramId"
  | "includeHistory"
  | "canEdit"
  | "canUpload"
  | "groups"
>) {
  if (!selectedSchool) {
    return <Card className="mt-4 p-6 text-sm text-text-muted">Select a School to view mappings.</Card>;
  }

  return (
    <AcademicMentorshipManager
      schoolCode={selectedSchool.code}
      academicYear={selectedAcademicYear}
      programId={selectedProgramId}
      includeHistory={includeHistory}
      canEdit={canEdit}
      canUpload={canUpload}
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
        <AcademicMentorshipSelectionForm {...model} />
        <SelectionSummary {...model} />
        <SelectedSchoolContent {...model} />
      </main>
    </div>
  );
}
