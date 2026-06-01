"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  CurriculumSummaryProgramOption,
  CurriculumSummarySchoolOption,
  CurriculumSummarySubjectOption,
} from "@/lib/curriculum-summary";
import type { ExamTrack } from "@/types/curriculum";

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

interface DerivedFilterChipsProps {
  label: string;
  name: string;
  values: string[];
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

export function DerivedFilterChips({
  label,
  name,
  values,
}: DerivedFilterChipsProps) {
  return (
    <div className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
      <span>{label}</span>
      <input type="hidden" name={name} value={values.join(",")} />
      <div className="min-h-9 rounded-md border border-border bg-bg-muted px-3 py-2">
        {values.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {values.map((value) => (
              <span
                key={value}
                className="inline-flex max-w-full items-center rounded-md border border-border bg-hover-bg px-2 py-1 text-xs text-text-primary"
              >
                <span className="truncate">{value}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm text-text-muted">No location data</span>
        )}
      </div>
      <span className="text-xs font-normal text-text-muted">
        Derived from selected schools
      </span>
    </div>
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
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setSelected(selectedValues);
  }, [selectedValues]);

  const optionByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options]
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleOptions = useMemo(
    () =>
      options
        .filter((option) => !selectedSet.has(option.value))
        .filter((option) => matchesOption(option, query))
        .slice(0, MAX_VISIBLE_OPTIONS),
    [options, query, selectedSet]
  );

  function updateSelected(nextSelected: string[]) {
    setSelected(nextSelected);
    onSelectedValuesChange?.(nextSelected);
  }

  function addOption(value: string) {
    if (!selected.includes(value)) {
      updateSelected([...selected, value]);
    }
    setQuery("");
    setActiveIndex(0);
    setIsOpen(false);
  }

  function removeOption(value: string) {
    updateSelected(selected.filter((selectedValue) => selectedValue !== value));
  }

  function clearOptions() {
    updateSelected([]);
    setQuery("");
    setActiveIndex(0);
    setIsOpen(false);
  }

  function getOptionDisplayLabel(option: SearchableFilterOption): string {
    return option.meta ? `${option.label} (${option.meta})` : option.label;
  }

  return (
    <div className="flex flex-col gap-1 text-sm font-medium text-text-secondary">
      <label htmlFor={inputId}>{label}</label>
      <input type="hidden" name={name} value={selected.join(",")} />
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={`${inputId}-options`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 100);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((index) =>
                visibleOptions.length === 0
                  ? 0
                  : Math.min(index + 1, visibleOptions.length - 1)
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && isOpen && visibleOptions[activeIndex]) {
              event.preventDefault();
              addOption(visibleOptions[activeIndex].value);
            } else if (event.key === "Escape") {
              setIsOpen(false);
            } else if (event.key === "Backspace" && query === "" && selected.length > 0) {
              removeOption(selected[selected.length - 1]);
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
        />

        {isOpen && (
          <div
            id={`${inputId}-options`}
            role="listbox"
            className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-bg-card shadow-lg"
          >
            {visibleOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-muted">
                {noMatchesText}
              </div>
            ) : (
              visibleOptions.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-label={getOptionDisplayLabel(option)}
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addOption(option.value)}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    index === activeIndex ? "bg-hover-bg text-text-primary" : "text-text-secondary"
                  } hover:bg-hover-bg hover:text-text-primary`}
                >
                  <span className="font-medium">{option.label}</span>
                  {option.meta && (
                    <span className="ml-2 font-mono text-xs text-text-muted">
                      {option.meta}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {selected.map((value) => {
            const option = optionByValue.get(value);
            const chipLabel = option
              ? getOptionDisplayLabel(option)
              : `${value} (not in results)`;

            return (
              <span
                key={value}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-hover-bg px-2 py-1 text-xs text-text-primary"
              >
                <span className="truncate">{chipLabel}</span>
                <button
                  type="button"
                  onClick={() => removeOption(value)}
                  aria-label={`Remove ${chipLabel}`}
                  className="font-bold text-accent hover:text-accent-hover"
                >
                  x
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={clearOptions}
            className="text-xs font-bold text-accent hover:text-accent-hover"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function formatExamTrack(track: string): string {
  if (track === "jee_main") return "JEE Main";
  if (track === "jee_advanced") return "JEE Advanced";
  if (track === "neet") return "NEET";
  return track;
}

function isExamTrack(value: string): value is ExamTrack {
  return value === "jee_main" || value === "jee_advanced" || value === "neet";
}
