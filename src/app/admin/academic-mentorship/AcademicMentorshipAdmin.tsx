"use client";

import { useEffect, useState } from "react";

import { getAcademicYearChoices } from "@/lib/academic-year";
import type { UserRole } from "@/lib/permissions";

interface SchoolOption {
  code: string;
  name: string;
}

interface AcademicMentorshipAdminProps {
  schools: SchoolOption[];
  canView: boolean;
  canEdit: boolean;
  role: UserRole;
}

interface AcademicMentorshipMapping {
  id: number;
  mentor_name: string | null;
  mentee_name: string | null;
  mentee_grade: number | null;
  mentee_student_id: string | null;
  created_by: string;
  inserted_at: string;
}

type LoadState = "idle" | "loading" | "loaded" | "error";

function formatAssignedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function AcademicMentorshipAdmin({
  schools,
  canView,
  canEdit,
  role,
}: AcademicMentorshipAdminProps) {
  const academicYears = getAcademicYearChoices();
  const [selectedSchoolCode, setSelectedSchoolCode] = useState("");
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(academicYears[0] ?? "");
  const [mappings, setMappings] = useState<AcademicMentorshipMapping[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  useEffect(() => {
    if (!selectedSchoolCode || !selectedAcademicYear) {
      return;
    }

    let ignore = false;
    const params = new URLSearchParams({
      school_code: selectedSchoolCode,
      academic_year: selectedAcademicYear,
    });

    fetch(`/api/academic-mentorship?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load mappings");
        return response.json() as Promise<{ mappings?: AcademicMentorshipMapping[] }>;
      })
      .then((data) => {
        if (ignore) return;
        setMappings(data.mappings ?? []);
        setLoadState("loaded");
      })
      .catch(() => {
        if (ignore) return;
        setMappings([]);
        setLoadState("error");
      });

    return () => {
      ignore = true;
    };
  }, [selectedSchoolCode, selectedAcademicYear]);

  function handleSchoolChange(schoolCode: string) {
    setSelectedSchoolCode(schoolCode);
    setMappings([]);
    setLoadState(schoolCode ? "loading" : "idle");
  }

  function handleAcademicYearChange(academicYear: string) {
    setSelectedAcademicYear(academicYear);
    setMappings([]);
    setLoadState(selectedSchoolCode && academicYear ? "loading" : "idle");
  }

  const messageColSpan = canEdit ? 7 : 6;

  return (
    <section
      className="space-y-4"
      data-can-view={canView}
      data-can-edit={canEdit}
      data-role={role}
    >
      <div className="rounded-lg border border-border bg-bg-card p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_180px]">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              School
            </span>
            <select
              value={selectedSchoolCode}
              onChange={(event) => handleSchoolChange(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border-2 border-border px-3 py-2.5 text-sm"
            >
              <option value="">Select a school</option>
              {schools.map((school) => (
                <option key={school.code} value={school.code}>
                  {school.name} ({school.code})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              Academic Year
            </span>
            <select
              value={selectedAcademicYear}
              onChange={(event) => handleAcademicYearChange(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border-2 border-border px-3 py-2.5 text-sm"
            >
              {academicYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          {canEdit ? <div aria-label="Mutation controls" /> : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
        <table className="min-w-full table-fixed divide-y divide-border text-sm">
          <thead className="bg-bg-card-alt text-left text-xs font-bold uppercase tracking-wide text-text-muted">
            <tr>
              <th className="w-1/5 px-4 py-3">Mentor Name</th>
              <th className="w-1/5 px-4 py-3">Mentee Name</th>
              <th className="w-24 px-4 py-3">Mentee Grade</th>
              <th className="w-32 px-4 py-3">Mentee Student ID</th>
              <th className="w-1/5 px-4 py-3">Created By</th>
              <th className="w-36 px-4 py-3">Assigned Date</th>
              {canEdit ? <th className="w-24 px-4 py-3">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {!selectedSchoolCode ? (
              <tr>
                <td colSpan={messageColSpan} className="px-4 py-8 text-center text-text-muted">
                  Select a school to view mappings
                </td>
              </tr>
            ) : null}
            {selectedSchoolCode && loadState === "loading" ? (
              <tr>
                <td colSpan={messageColSpan} className="px-4 py-8 text-center text-text-muted">
                  Loading mappings...
                </td>
              </tr>
            ) : null}
            {selectedSchoolCode && loadState === "error" ? (
              <tr>
                <td colSpan={messageColSpan} className="px-4 py-8 text-center text-danger">
                  Unable to load mappings
                </td>
              </tr>
            ) : null}
            {selectedSchoolCode && loadState === "loaded" && mappings.length === 0 ? (
              <tr>
                <td colSpan={messageColSpan} className="px-4 py-8 text-center text-text-muted">
                  No mappings found
                </td>
              </tr>
            ) : null}
            {mappings.map((mapping) => (
              <tr key={mapping.id} className="border-t border-border">
                <td className="px-4 py-3 text-text-primary">{mapping.mentor_name ?? "-"}</td>
                <td className="px-4 py-3 text-text-primary">{mapping.mentee_name ?? "-"}</td>
                <td className="px-4 py-3 text-text-primary">{mapping.mentee_grade ?? "-"}</td>
                <td className="px-4 py-3 font-mono text-text-primary">
                  {mapping.mentee_student_id ?? "-"}
                </td>
                <td className="px-4 py-3 text-text-primary">{mapping.created_by}</td>
                <td className="px-4 py-3 text-text-primary">
                  {formatAssignedDate(mapping.inserted_at)}
                </td>
                {canEdit ? <td className="px-4 py-3" aria-label="Mapping actions" /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
