"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import type {
  CurriculumSummaryFilterOptions,
  CurriculumSummaryFilters,
} from "@/lib/curriculum-summary";
import type { ExamTrack } from "@/types/curriculum";
import SchoolFilterSelect, {
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
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedSchoolCodes, setSelectedSchoolCodes] = useState(filters.schools);
  const [selectedProgramIds, setSelectedProgramIds] = useState(filters.programs);
  const [selectedGrades, setSelectedGrades] = useState(filters.grades);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState(filters.subjects);
  const [selectedExamTracks, setSelectedExamTracks] = useState<ExamTrack[]>(
    filters.examTracks
  );
  const [selectedRegions, setSelectedRegions] = useState(filters.regions);
  const schoolOptions = useMemo(
    () => filterSchoolsByRegion(options.schools, selectedRegions),
    [options.schools, selectedRegions]
  );
  const regionOptions = useMemo(
    () => uniqueSorted(options.schools.map((school) => school.region)),
    [options.schools]
  );

  function handleClearFilters() {
    setSelectedSchoolCodes([]);
    setSelectedProgramIds([]);
    setSelectedGrades([]);
    setSelectedSubjectIds([]);
    setSelectedExamTracks([]);
    setSelectedRegions([]);
    formRef.current?.reset();
    router.push("/curriculum-summary");
  }

  return (
    <form
      ref={formRef}
      action="/curriculum-summary"
      method="get"
      className="mt-4 space-y-4"
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <SchoolFilterSelect
          key={`schools:${filters.schools.join(",")}`}
          options={schoolOptions}
          selectedCodes={selectedSchoolCodes}
          onSelectedCodesChange={setSelectedSchoolCodes}
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
        <StringFilterSelect
          key={`regions:${filters.regions.join(",")}`}
          label="Regions"
          name="regions"
          inputId="curriculum-summary-region-filter"
          placeholder="Search region"
          noMatchesText="No matching regions"
          options={regionOptions.length > 0 ? regionOptions : options.regions}
          selectedValues={selectedRegions}
          onSelectedValuesChange={setSelectedRegions}
        />
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
        <button
          type="button"
          onClick={handleClearFilters}
          className="text-sm font-bold text-accent hover:text-accent-hover"
        >
          Clear filters
        </button>
      </div>
    </form>
  );
}

function filterSchoolsByRegion(
  schools: CurriculumSummaryFilterOptions["schools"],
  regions: string[]
) {
  const selected = new Set(regions);
  return selected.size === 0
    ? schools
    : schools.filter((school) => school.region && selected.has(school.region));
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
