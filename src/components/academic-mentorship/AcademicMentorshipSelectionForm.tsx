"use client";

import { useRef } from "react";

import { Card } from "@/components/ui";
import type {
  AcademicMentorshipProgram,
  AcademicMentorshipSchool,
} from "@/lib/academic-mentorship";

interface AcademicMentorshipSelectionFormProps {
  academicYears: string[];
  selectedAcademicYear: string;
  selectedSchoolCode: string;
  selectedProgramId: number | null;
  includeHistory: boolean;
  programs: AcademicMentorshipProgram[];
  schools: AcademicMentorshipSchool[];
}

export default function AcademicMentorshipSelectionForm({
  academicYears,
  selectedAcademicYear,
  selectedSchoolCode,
  selectedProgramId,
  includeHistory,
  programs,
  schools,
}: AcademicMentorshipSelectionFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const schoolRef = useRef<HTMLSelectElement>(null);

  function submitProgramFilter() {
    if (schoolRef.current) schoolRef.current.value = "";
    formRef.current?.requestSubmit();
  }

  return (
    <Card className="overflow-hidden p-4">
      <form
        ref={formRef}
        action="/admin/academic-mentorship"
        className="grid min-w-0 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_220px_auto] lg:items-end"
      >
        <label
          className="grid min-w-0 gap-1.5 text-sm font-semibold text-text-primary"
          htmlFor="program_id"
        >
          Program
          <select
            id="program_id"
            name="program_id"
            defaultValue={selectedProgramId ?? ""}
            onChange={submitProgramFilter}
            className="min-h-[44px] w-full min-w-0 max-w-full rounded-lg border-2 border-border bg-bg-card px-3 py-2 text-sm font-normal focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="">All programs</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className="grid min-w-0 gap-1.5 text-sm font-semibold text-text-primary"
          htmlFor="school_code"
        >
          School
          <select
            ref={schoolRef}
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
        <label
          className="grid min-w-0 gap-1.5 text-sm font-semibold text-text-primary"
          htmlFor="academic_year"
        >
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
