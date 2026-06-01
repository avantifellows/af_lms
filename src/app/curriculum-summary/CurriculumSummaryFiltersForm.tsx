"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  CurriculumSummaryFilterOptions,
  CurriculumSummaryFilters,
} from "@/lib/curriculum-summary";
import type { ExamTrack } from "@/types/curriculum";
import SchoolFilterSelect, {
  DerivedFilterChips,
  ExamTrackFilterSelect,
  GradeFilterSelect,
  ProgramFilterSelect,
  StringFilterSelect,
  SubjectFilterSelect,
} from "./SchoolFilterSelect";

interface CurriculumSummaryFiltersFormProps {
  filters: CurriculumSummaryFilters;
  options: CurriculumSummaryFilterOptions;
}

export default function CurriculumSummaryFiltersForm({
  filters,
  options,
}: CurriculumSummaryFiltersFormProps) {
  const [selectedSchoolCodes, setSelectedSchoolCodes] = useState(filters.schools);
  const [selectedProgramIds, setSelectedProgramIds] = useState(filters.programs);
  const [selectedGrades, setSelectedGrades] = useState(filters.grades);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState(filters.subjects);
  const [selectedExamTracks, setSelectedExamTracks] = useState<ExamTrack[]>(
    filters.examTracks
  );
  const derivedLocationFilters = useMemo(
    () => deriveLocationFiltersFromSelectedSchools(selectedSchoolCodes, options),
    [selectedSchoolCodes, options]
  );

  function handleSelectedSchoolCodesChange(nextSchoolCodes: string[]) {
    setSelectedSchoolCodes(nextSchoolCodes);

    if (nextSchoolCodes.length === 0) {
      return;
    }

    setSelectedProgramIds((current) =>
      current.length > 0 || !options.programs[0] ? current : [options.programs[0].id]
    );
    setSelectedGrades((current) =>
      current.length > 0 || !options.grades[0] ? current : [options.grades[0]]
    );
    setSelectedSubjectIds((current) =>
      current.length > 0 || !options.subjects[0] ? current : [options.subjects[0].id]
    );
    setSelectedExamTracks((current) =>
      current.length > 0 || !options.examTracks[0] ? current : [options.examTracks[0]]
    );
  }

  return (
    <form action="/curriculum-summary" method="get" className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <SchoolFilterSelect
          key={`schools:${filters.schools.join(",")}`}
          options={options.schools}
          selectedCodes={filters.schools}
          onSelectedCodesChange={handleSelectedSchoolCodesChange}
        />
        <ProgramFilterSelect
          options={options.programs}
          selectedIds={selectedProgramIds}
          onSelectedIdsChange={setSelectedProgramIds}
        />
        <GradeFilterSelect
          options={options.grades}
          selectedGrades={selectedGrades}
          onSelectedGradesChange={setSelectedGrades}
        />
        <SubjectFilterSelect
          options={options.subjects}
          selectedIds={selectedSubjectIds}
          onSelectedIdsChange={setSelectedSubjectIds}
        />
        <ExamTrackFilterSelect
          options={options.examTracks}
          selectedTracks={selectedExamTracks}
          onSelectedTracksChange={setSelectedExamTracks}
        />
        {derivedLocationFilters ? (
          <>
            <DerivedFilterChips
              label="Regions"
              name="regions"
              values={derivedLocationFilters.regions}
            />
            <DerivedFilterChips
              label="States"
              name="states"
              values={derivedLocationFilters.states}
            />
            <DerivedFilterChips
              label="Districts"
              name="districts"
              values={derivedLocationFilters.districts}
            />
          </>
        ) : (
          <>
            <StringFilterSelect
              key={`regions:${filters.regions.join(",")}`}
              label="Regions"
              name="regions"
              inputId="curriculum-summary-region-filter"
              placeholder="Search region"
              noMatchesText="No matching regions"
              options={options.regions}
              selectedValues={filters.regions}
            />
            <StringFilterSelect
              key={`states:${filters.states.join(",")}`}
              label="States"
              name="states"
              inputId="curriculum-summary-state-filter"
              placeholder="Search state"
              noMatchesText="No matching states"
              options={options.states}
              selectedValues={filters.states}
            />
            <StringFilterSelect
              key={`districts:${filters.districts.join(",")}`}
              label="Districts"
              name="districts"
              inputId="curriculum-summary-district-filter"
              placeholder="Search district"
              noMatchesText="No matching districts"
              options={options.districts}
              selectedValues={filters.districts}
            />
          </>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
          Date preset
          <select
            name="preset"
            defaultValue={filters.preset}
            className="rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
          >
            <option value="today">Today</option>
            <option value="last_7_days">Last 7 days</option>
            <option value="last_30_days">Last 30 days</option>
            <option value="current_academic_year">Current academic year</option>
            <option value="all">All dates</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <FilterField label="From" name="from" value={filters.from ?? ""} />
        <FilterField label="To" name="to" value={filters.to ?? ""} />
        <label className="flex items-center gap-2 pt-6 text-sm font-medium text-text-secondary">
          <input
            type="checkbox"
            name="flagged"
            value="true"
            defaultChecked={filters.flagged}
            className="h-4 w-4 rounded border-border text-accent"
          />
          Only flagged
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
        >
          Apply filters
        </button>
        <Link
          href="/curriculum-summary"
          className="text-sm font-bold text-accent hover:text-accent-hover"
        >
          Clear filters
        </Link>
      </div>
    </form>
  );
}

function deriveLocationFiltersFromSelectedSchools(
  selectedSchoolCodes: string[],
  options: CurriculumSummaryFilterOptions
): Pick<CurriculumSummaryFilters, "regions" | "states" | "districts"> | null {
  if (selectedSchoolCodes.length === 0) {
    return null;
  }

  const selectedCodes = new Set(selectedSchoolCodes);
  const selectedSchools = options.schools.filter((school) =>
    selectedCodes.has(school.code)
  );

  return {
    regions: uniqueSorted(selectedSchools.map((school) => school.region)),
    states: uniqueSorted(selectedSchools.map((school) => school.state)),
    districts: uniqueSorted(selectedSchools.map((school) => school.district)),
  };
}

function uniqueSorted(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(
    (a, b) => a.localeCompare(b)
  );
}

function FilterField({
  label,
  name,
  value,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
      {label}
      <input
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        className="rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
      />
    </label>
  );
}
