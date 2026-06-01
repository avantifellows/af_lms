"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

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
  const [selectedStates, setSelectedStates] = useState(filters.states);
  const [selectedDistricts, setSelectedDistricts] = useState(filters.districts);
  const derivedLocationFilters = useMemo(
    () => deriveLocationFiltersFromSelectedSchools(selectedSchoolCodes, options),
    [selectedSchoolCodes, options]
  );
  const manuallyFilteredSchools = useMemo(
    () =>
      filterSchoolsByLocation(options.schools, {
        regions: selectedRegions,
        states: selectedStates,
        districts: selectedDistricts,
      }),
    [options.schools, selectedDistricts, selectedRegions, selectedStates]
  );
  const schoolOptions = derivedLocationFilters ? options.schools : manuallyFilteredSchools;
  const regionOptions = useMemo(
    () =>
      locationValuesForSchools(
        filterSchoolsByLocation(options.schools, {
          states: selectedStates,
          districts: selectedDistricts,
        }),
        "region",
        options.regions
      ),
    [options.regions, options.schools, selectedDistricts, selectedStates]
  );
  const stateOptions = useMemo(
    () =>
      locationValuesForSchools(
        filterSchoolsByLocation(options.schools, {
          regions: selectedRegions,
          districts: selectedDistricts,
        }),
        "state",
        options.states
      ),
    [options.schools, options.states, selectedDistricts, selectedRegions]
  );
  const districtOptions = useMemo(
    () =>
      locationValuesForSchools(
        filterSchoolsByLocation(options.schools, {
          regions: selectedRegions,
          states: selectedStates,
        }),
        "district",
        options.districts
      ),
    [options.districts, options.schools, selectedRegions, selectedStates]
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

  function handleRegionsChange(nextRegions: string[]) {
    setSelectedRegions(nextRegions);

    const matchingSchools = filterSchoolsByLocation(options.schools, {
      regions: nextRegions,
    });
    setSelectedStates((current) => pruneLocationValues(current, matchingSchools, "state"));
    setSelectedDistricts((current) =>
      pruneLocationValues(current, matchingSchools, "district")
    );
  }

  function handleStatesChange(nextStates: string[]) {
    setSelectedStates(nextStates);

    const matchingSchools = filterSchoolsByLocation(options.schools, {
      states: nextStates,
      districts: selectedDistricts,
    });
    const derivedRegions = uniqueSorted(matchingSchools.map((school) => school.region));
    if (nextStates.length > 0 || selectedDistricts.length > 0) {
      setSelectedRegions(derivedRegions);
    }
    setSelectedDistricts((current) =>
      pruneLocationValues(
        current,
        filterSchoolsByLocation(options.schools, { states: nextStates }),
        "district"
      )
    );
  }

  function handleDistrictsChange(nextDistricts: string[]) {
    setSelectedDistricts(nextDistricts);

    if (nextDistricts.length === 0) {
      return;
    }

    const matchingSchools = filterSchoolsByLocation(options.schools, {
      districts: nextDistricts,
    });
    setSelectedStates(uniqueSorted(matchingSchools.map((school) => school.state)));
    setSelectedRegions(uniqueSorted(matchingSchools.map((school) => school.region)));
  }

  function handleClearFilters() {
    setSelectedSchoolCodes([]);
    setSelectedProgramIds([]);
    setSelectedGrades([]);
    setSelectedSubjectIds([]);
    setSelectedExamTracks([]);
    setSelectedRegions([]);
    setSelectedStates([]);
    setSelectedDistricts([]);
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
              options={regionOptions}
              selectedValues={selectedRegions}
              onSelectedValuesChange={handleRegionsChange}
            />
            <StringFilterSelect
              label="States"
              name="states"
              inputId="curriculum-summary-state-filter"
              placeholder="Search state"
              noMatchesText="No matching states"
              options={stateOptions}
              selectedValues={selectedStates}
              onSelectedValuesChange={handleStatesChange}
            />
            <StringFilterSelect
              label="Districts"
              name="districts"
              inputId="curriculum-summary-district-filter"
              placeholder="Search district"
              noMatchesText="No matching districts"
              options={districtOptions}
              selectedValues={selectedDistricts}
              onSelectedValuesChange={handleDistrictsChange}
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

function filterSchoolsByLocation(
  schools: CurriculumSummaryFilterOptions["schools"],
  filters: Partial<Pick<CurriculumSummaryFilters, "regions" | "states" | "districts">>
) {
  const regions = new Set(filters.regions ?? []);
  const states = new Set(filters.states ?? []);
  const districts = new Set(filters.districts ?? []);

  return schools.filter((school) => {
    if (regions.size > 0 && (!school.region || !regions.has(school.region))) {
      return false;
    }
    if (states.size > 0 && (!school.state || !states.has(school.state))) {
      return false;
    }
    if (
      districts.size > 0 &&
      (!school.district || !districts.has(school.district))
    ) {
      return false;
    }
    return true;
  });
}

function locationValuesForSchools(
  schools: CurriculumSummaryFilterOptions["schools"],
  key: "region" | "state" | "district",
  fallbackValues: string[]
) {
  const values = uniqueSorted(schools.map((school) => school[key]));
  return values.length > 0 ? values : fallbackValues;
}

function pruneLocationValues(
  values: string[],
  schools: CurriculumSummaryFilterOptions["schools"],
  key: "region" | "state" | "district"
) {
  const allowedValues = new Set(uniqueSorted(schools.map((school) => school[key])));
  return values.filter((value) => allowedValues.has(value));
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
