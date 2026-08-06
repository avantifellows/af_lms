"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import type {
  CurriculumSummaryProgramOption,
  CurriculumSummarySchoolOption,
  CurriculumSummarySubjectOption,
} from "@/lib/curriculum-summary";
import { formatExamTrack, isExamTrack, type ExamTrack } from "@/lib/exam-tracks";

interface SchoolFilterSelectProps {
  options: CurriculumSummarySchoolOption[];
  selectedCodes: string[];
  onSelectedCodesChange?: (selectedCodes: string[]) => void;
}

interface ProgramFilterSelectProps {
  options: CurriculumSummaryProgramOption[];
  selectedIds: number[];
  onSelectedIdsChange?: (selectedIds: number[]) => void;
}

interface GradeFilterSelectProps {
  options: number[];
  selectedGrades: number[];
  onSelectedGradesChange?: (selectedGrades: number[]) => void;
}

interface SubjectFilterSelectProps {
  options: CurriculumSummarySubjectOption[];
  selectedIds: number[];
  onSelectedIdsChange?: (selectedIds: number[]) => void;
}

interface ExamTrackFilterSelectProps {
  options: ExamTrack[];
  selectedTracks: ExamTrack[];
  onSelectedTracksChange?: (selectedTracks: ExamTrack[]) => void;
}

interface StringFilterSelectProps {
  label: string;
  name: string;
  inputId: string;
  placeholder: string;
  noMatchesText: string;
  options: string[];
  selectedValues: string[];
  onSelectedValuesChange?: (selectedValues: string[]) => void;
}

interface SearchableFilterOption {
  value: string;
  label: string;
  meta?: string;
  searchText: string;
}

interface SearchableMultiSelectFilterProps {
  label: string;
  name: string;
  inputId: string;
  placeholder: string;
  noMatchesText: string;
  options: SearchableFilterOption[];
  selectedValues: string[];
  onSelectedValuesChange?: (selectedValues: string[]) => void;
}

const MAX_VISIBLE_OPTIONS = 20;

function matchesOption(option: SearchableFilterOption, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return option.searchText.toLowerCase().includes(normalizedQuery);
}

export default function SchoolFilterSelect({
  options,
  selectedCodes,
  onSelectedCodesChange,
}: SchoolFilterSelectProps) {
  const selectOptions = useMemo(
    () =>
      options.map((school) => ({
        value: school.code,
        label: school.name,
        meta: school.code,
        searchText: `${school.name} ${school.code}`,
      })),
    [options]
  );

  return (
    <SearchableMultiSelectFilter
      label="Schools"
      name="schools"
      inputId="curriculum-summary-school-filter"
      placeholder="Search by school name or code"
      noMatchesText="No matching schools"
      options={selectOptions}
      selectedValues={selectedCodes}
      onSelectedValuesChange={onSelectedCodesChange}
    />
  );
}

export function ProgramFilterSelect({
  options,
  selectedIds,
  onSelectedIdsChange,
}: ProgramFilterSelectProps) {
  const selectOptions = useMemo(
    () =>
      options.map((program) => ({
        value: String(program.id),
        label: program.name,
        meta: String(program.id),
        searchText: `${program.name} ${program.id}`,
      })),
    [options]
  );

  return (
    <SearchableMultiSelectFilter
      label="Programs"
      name="programs"
      inputId="curriculum-summary-program-filter"
      placeholder="Search by program name or ID"
      noMatchesText="No matching programs"
      options={selectOptions}
      selectedValues={selectedIds.map(String)}
      onSelectedValuesChange={(values) => onSelectedIdsChange?.(values.map(Number))}
    />
  );
}

export function GradeFilterSelect({
  options,
  selectedGrades,
  onSelectedGradesChange,
}: GradeFilterSelectProps) {
  const selectOptions = useMemo(
    () =>
      options.map((grade) => ({
        value: String(grade),
        label: `Grade ${grade}`,
        searchText: String(grade),
      })),
    [options]
  );

  return (
    <SearchableMultiSelectFilter
      label="Grades"
      name="grades"
      inputId="curriculum-summary-grade-filter"
      placeholder="Search grade"
      noMatchesText="No matching grades"
      options={selectOptions}
      selectedValues={selectedGrades.map(String)}
      onSelectedValuesChange={(values) =>
        onSelectedGradesChange?.(values.map(Number))
      }
    />
  );
}

export function SubjectFilterSelect({
  options,
  selectedIds,
  onSelectedIdsChange,
}: SubjectFilterSelectProps) {
  const selectOptions = useMemo(
    () =>
      options.map((subject) => ({
        value: String(subject.id),
        label: subject.name,
        meta: String(subject.id),
        searchText: `${subject.name} ${subject.id}`,
      })),
    [options]
  );

  return (
    <SearchableMultiSelectFilter
      label="Subjects"
      name="subjects"
      inputId="curriculum-summary-subject-filter"
      placeholder="Search by subject name or ID"
      noMatchesText="No matching subjects"
      options={selectOptions}
      selectedValues={selectedIds.map(String)}
      onSelectedValuesChange={(values) => onSelectedIdsChange?.(values.map(Number))}
    />
  );
}

export function ExamTrackFilterSelect({
  options,
  selectedTracks,
  onSelectedTracksChange,
}: ExamTrackFilterSelectProps) {
  const selectOptions = useMemo(
    () =>
      options.map((track) => ({
        value: track,
        label: formatExamTrack(track),
        searchText: `${formatExamTrack(track)} ${track}`,
      })),
    [options]
  );

  return (
    <SearchableMultiSelectFilter
      label="Exam Track"
      name="exam_tracks"
      inputId="curriculum-summary-exam-track-filter"
      placeholder="Search exam track"
      noMatchesText="No matching exam tracks"
      options={selectOptions}
      selectedValues={selectedTracks}
      onSelectedValuesChange={(values) =>
        onSelectedTracksChange?.(values.filter(isExamTrack))
      }
    />
  );
}

export function StringFilterSelect({
  label,
  name,
  inputId,
  placeholder,
  noMatchesText,
  options,
  selectedValues,
  onSelectedValuesChange,
}: StringFilterSelectProps) {
  const selectOptions = useMemo(
    () =>
      options.map((value) => ({
        value,
        label: value,
        searchText: value,
      })),
    [options]
  );

  return (
    <SearchableMultiSelectFilter
      label={label}
      name={name}
      inputId={inputId}
      placeholder={placeholder}
      noMatchesText={noMatchesText}
      options={selectOptions}
      selectedValues={selectedValues}
      onSelectedValuesChange={onSelectedValuesChange}
    />
  );
}

function SearchableMultiSelectFilter({
  label,
  name,
  inputId,
  placeholder,
  noMatchesText,
  options,
  selectedValues,
  onSelectedValuesChange,
}: SearchableMultiSelectFilterProps) {
  const [selected, setSelected] = useState(selectedValues);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(selectedValues);
  }, [selectedValues]);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [isOpen]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleOptions = useMemo(
    () =>
      options
        .filter((option) => matchesOption(option, query))
        .slice(0, MAX_VISIBLE_OPTIONS),
    [options, query]
  );

  function updateSelected(nextSelected: string[]) {
    setSelected(nextSelected);
    onSelectedValuesChange?.(nextSelected);
  }

  function toggleOption(value: string) {
    updateSelected(
      selectedSet.has(value)
        ? selected.filter((selectedValue) => selectedValue !== value)
        : [...selected, value]
    );
  }

  function clearOptions() {
    updateSelected([]);
    setQuery("");
  }

  function getOptionDisplayLabel(option: SearchableFilterOption): string {
    return option.meta ? `${option.label} (${option.meta})` : option.label;
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-1 text-sm font-medium text-text-secondary"
    >
      <span>{label}</span>
      <input type="hidden" name={name} value={selected.join(",")} />
      <div className="relative">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={`${inputId}-options`}
          aria-label={`${label}: ${
            selected.length === 0 ? "All" : `${selected.length} selected`
          }`}
          onClick={() => setIsOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
        >
          <span>{selected.length === 0 ? "All" : `${selected.length} selected`}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </button>

        {isOpen && (
          <div
            id={`${inputId}-options`}
            className="absolute z-20 mt-1 w-full rounded-md border border-border bg-bg-card p-2 shadow-lg"
          >
            <input
              id={inputId}
              type="search"
              aria-label={`Search ${label}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setIsOpen(false);
              }}
              placeholder={placeholder}
              className="w-full rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
            />
            <div className="mt-2 max-h-48 overflow-y-auto">
              {visibleOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-text-muted">
                  {noMatchesText}
                </div>
              ) : (
                visibleOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 px-2 py-2 text-sm text-text-secondary hover:bg-hover-bg hover:text-text-primary"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(option.value)}
                      onChange={() => toggleOption(option.value)}
                      aria-label={getOptionDisplayLabel(option)}
                      className="h-4 w-4 rounded border-border text-accent"
                    />
                    <span>{getOptionDisplayLabel(option)}</span>
                  </label>
                ))
              )}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <button
                type="button"
                onClick={clearOptions}
                className="text-xs font-bold text-accent"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs font-bold text-accent"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
