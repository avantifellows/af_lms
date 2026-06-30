import { getServerSession } from "next-auth";
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
import { Card } from "@/components/ui";

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

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-text-muted hover:text-text-primary p-1 -m-1">
              <span aria-hidden="true">{"<"}</span>
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-text-primary uppercase tracking-tight">
                Academic Mentorship
              </h1>
              <p className="text-xs text-text-muted font-mono">{session.user.email}</p>
            </div>
          </div>
          <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">
            Sign out
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Card className="p-4">
          <form action="/admin/academic-mentorship" className="grid gap-4 md:grid-cols-[1fr_220px_auto]">
            <label className="grid gap-1 text-sm font-semibold text-text-primary" htmlFor="school_code">
              School
              <select
                id="school_code"
                name="school_code"
                defaultValue={selectedSchoolCode}
                className="rounded-md border border-border bg-bg-card px-3 py-2 font-normal"
              >
                <option value="">Select a School</option>
                {schools.map((school) => (
                  <option key={school.code} value={school.code}>
                    {school.name} ({school.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-text-primary" htmlFor="academic_year">
              Academic year
              <select
                id="academic_year"
                name="academic_year"
                defaultValue={selectedAcademicYear}
                className="rounded-md border border-border bg-bg-card px-3 py-2 font-normal"
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
            <button className="self-end rounded-md bg-accent px-4 py-2 text-sm font-bold text-white">
              Apply
            </button>
          </form>
        </Card>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-text-muted">
            {canEdit ? "Edit access" : "View-only"}
          </div>
          {selectedSchool && (
            <Link href={historyHref} className="text-sm font-bold text-accent hover:text-accent-hover">
              {includeHistory ? "Hide history" : "Show history"}
            </Link>
          )}
        </div>

        <section className="mt-4 space-y-4">
          {!selectedSchool ? (
            <Card className="p-6 text-sm text-text-muted">Select a School to view mappings.</Card>
          ) : groups.length === 0 ? (
            <Card className="p-6 text-sm text-text-muted">
              No Academic Mentor-Mentee Mappings found.
            </Card>
          ) : (
            groups.map((group) => (
              <Card key={group.mentor.userId} className="p-0">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="font-bold text-text-primary">{group.mentor.name}</h2>
                  <p className="text-sm text-text-muted">{group.menteeCount} mentee{group.menteeCount === 1 ? "" : "s"}</p>
                </div>
                <div className="divide-y divide-border">
                  {group.mappings.map((mapping) => (
                    <div key={String(mapping.id)} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_120px_140px_120px]">
                      <div>
                        <div className="font-semibold text-text-primary">{mapping.mentee.name}</div>
                        <div className="text-sm text-text-muted">{mapping.mentee.studentId}</div>
                      </div>
                      <div className="text-sm text-text-muted">Grade {mapping.mentee.grade ?? "-"}</div>
                      <div className="text-sm text-text-muted">{mapping.assignedDate}</div>
                      <div className="text-sm font-semibold text-text-primary">
                        {mapping.status === "active" ? "Active" : "Historical"}
                        {includeHistory && mapping.endedDate ? (
                          <span className="block font-normal text-text-muted">Ended {mapping.endedDate}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
