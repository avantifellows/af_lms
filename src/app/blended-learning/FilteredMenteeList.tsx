"use client";

import { useState } from "react";

import { Button, Card, FormLabel, Input, Select } from "@/components/ui";
import type { MenteeList, MenteeRow } from "@/lib/blended-learning-mentees";
import { thirtyDaysOrMore } from "@/lib/blended-learning-talk-to-first";

import { MenteeGroup } from "./MenteeList";

// The Mentee list with name search and filters. Filtering keeps the
// server's Talk to First / Everyone else grouping and sort order.

// Blended Learning Mentees are in Grade 12 or 13.
const GRADES = [12, 13];

// "" means "All" for each select.
type Filters = {
  search: string;
  gender: string;
  grade: string;
  programId: string;
  thirtyDaysOrMore: boolean;
};

const NO_FILTERS: Filters = {
  search: "",
  gender: "",
  grade: "",
  programId: "",
  thirtyDaysOrMore: false,
};

function matches(mentee: MenteeRow, filters: Filters): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search !== "" && !mentee.name.toLowerCase().includes(search)) return false;
  if (filters.gender !== "" && mentee.gender !== filters.gender) return false;
  if (filters.grade !== "" && mentee.grade !== Number(filters.grade)) return false;
  if (filters.programId !== "" && mentee.programId !== Number(filters.programId)) return false;
  if (filters.thirtyDaysOrMore && !thirtyDaysOrMore(mentee.daysSince)) return false;
  return true;
}

function distinctSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function programOptions(mentees: MenteeRow[]): { value: string; label: string }[] {
  const programs = new Map<number, string>();
  for (const mentee of mentees) {
    programs.set(mentee.programId, mentee.programName ?? `Program ${mentee.programId}`);
  }
  return [...programs]
    .map(([id, name]) => ({ value: String(id), label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function FilterSelect({
  id,
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function FilteredMenteeList({ list }: { list: MenteeList }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const everyone = [...list.talkToFirst, ...list.everyoneElse];
  const genders = distinctSorted(everyone.map((mentee) => mentee.gender));
  const talkToFirst = list.talkToFirst.filter((mentee) => matches(mentee, filters));
  const everyoneElse = list.everyoneElse.filter((mentee) => matches(mentee, filters));
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="space-y-5">
      <Card elevation="sm" className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-4">
          <Input
            type="search"
            aria-label="Search by name"
            placeholder="Search by name"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </div>
        <FilterSelect
          id="mentee-filter-gender"
          label="Gender"
          value={filters.gender}
          allLabel="All"
          options={genders.map((gender) => ({ value: gender, label: gender }))}
          onChange={(gender) => setFilters({ ...filters, gender })}
        />
        <FilterSelect
          id="mentee-filter-grade"
          label="Grade"
          value={filters.grade}
          allLabel="All grades"
          options={GRADES.map((grade) => ({ value: String(grade), label: `Grade ${grade}` }))}
          onChange={(grade) => setFilters({ ...filters, grade })}
        />
        <div className="col-span-2">
          <FilterSelect
            id="mentee-filter-program"
            label="Program"
            value={filters.programId}
            allLabel="All programs"
            options={programOptions(everyone)}
            onChange={(programId) => setFilters({ ...filters, programId })}
          />
        </div>
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 sm:col-span-4">
          <label className="flex min-h-11 items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              className="h-5 w-5 accent-accent"
              checked={filters.thirtyDaysOrMore}
              onChange={(event) => setFilters({ ...filters, thirtyDaysOrMore: event.target.checked })}
            />
            30 days or more
          </label>
          {filtering && (
            <Button variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>
      </Card>
      {talkToFirst.length + everyoneElse.length === 0 ? (
        <Card elevation="sm" className="p-4 sm:p-6">
          <p className="text-sm text-text-secondary">No Mentees match your search and filters.</p>
        </Card>
      ) : (
        <>
          <MenteeGroup
            title="Talk to First"
            description="Last try didn't connect, never reached, or 30+ days since you last talked."
            mentees={talkToFirst}
            emptyText={filtering ? "No one here matches your filters." : "Everyone has been talked to recently."}
          />
          <MenteeGroup
            title="Everyone else"
            description="Talked to in the last 30 days."
            mentees={everyoneElse}
            emptyText={filtering ? "No one here matches your filters." : "No one here yet."}
          />
        </>
      )}
    </div>
  );
}
