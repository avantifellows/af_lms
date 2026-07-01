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
} from "@/lib/academic-mentorship";
import { Badge, Card } from "@/components/ui";
import AcademicMentorshipManager from "@/components/academic-mentorship/AcademicMentorshipManager";

interface PageProps {
  searchParams?:
    | Promise<{ [key: string]: string | string[] | undefined }>
    | { [key: string]: string | string[] | undefined };
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

export default async function AcademicMentorshipPage({ searchParams }: PageProps = {}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/");
  }

  const baseAccess = await requireAcademicMentorshipAccess(session, "view");
  const role = baseAccess.ok ? baseAccess.permission.role : null;
  if (!baseAccess.ok || (role !== "admin" && role !== "program_admin")) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = searchParams
    ? await Promise.resolve(searchParams)
    : {};
  const academicYears = getAcademicMentorshipAcademicYears();
  const selectedAcademicYear =
    firstParam(resolvedSearchParams.academic_year) || academicYears[0];
  const selectedSchoolCode = firstParam(resolvedSearchParams.school_code);
  const includeHistory = firstParam(resolvedSearchParams.include_history) === "true";
  const schools = await listAccessibleAcademicMentorshipSchools(baseAccess.permission);

  if (!selectedSchoolCode && schools.length === 1) {
    redirect(
      selectionUrl({
        schoolCode: schools[0].code,
        academicYear: selectedAcademicYear,
        includeHistory,
      })
    );
  }

  const selectedSchool = schools.find((school) => school.code === selectedSchoolCode);
  const selectedAccess =
    selectedSchool && isValidAcademicYear(selectedAcademicYear)
      ? await requireAcademicMentorshipAccess(session, "view", {
          schoolCode: selectedSchool.code,
        })
      : null;
  if (selectedAccess && !selectedAccess.ok) {
    redirect("/dashboard");
  }

  const groups =
    selectedAccess?.ok && selectedAccess.school
      ? await listAcademicMentorshipMappings({
          schoolId: selectedAccess.school.id,
          academicYear: selectedAcademicYear,
          includeHistory,
        })
      : [];
  const canEdit =
    selectedAccess?.ok === true &&
    selectedAccess.canEdit &&
    isAcademicMentorshipEditableYear(selectedAcademicYear);

  const historyHref = selectedSchool
    ? selectionUrl({
        schoolCode: selectedSchool.code,
        academicYear: selectedAcademicYear,
        includeHistory: !includeHistory,
      })
    : "#";
  const accessLabel = canEdit ? "Edit access" : "View-only";

  return (
    <div className="min-h-screen bg-bg">
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
              <p className="font-mono text-xs text-text-muted">{session.user.email}</p>
            </div>
          </div>
          <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">
            Sign out
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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

        {!selectedSchool ? (
          <Card className="mt-4 p-6 text-sm text-text-muted">Select a School to view mappings.</Card>
        ) : (
          <AcademicMentorshipManager
            schoolCode={selectedSchool.code}
            academicYear={selectedAcademicYear}
            includeHistory={includeHistory}
            canEdit={canEdit}
            initialGroups={groups}
          />
        )}
      </main>
    </div>
  );
}
