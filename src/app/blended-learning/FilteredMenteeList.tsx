"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { FormLabel, Input, Select } from "@/components/ui";
import type { MenteeList, MenteeRow } from "@/lib/blended-learning-mentees";
import { thirtyDaysOrMore } from "@/lib/blended-learning-talk-to-first";

import { MenteeGroups } from "./MenteeList";

// The Student list with name search and filters, in one row above the list.
// Filtering keeps the server's Talk to first / Everyone else grouping and
// sort order. The copy names no viewer, so it reads the same to a Mentor and
// to an admin looking at a Mentor's list.

// Blended Learning Students are in Grade 12 or 13.
const GRADES = ["12", "13"];

const LAST_CONTACT_OPTIONS = [{ value: "30", label: "30 days or more" }];

const TALK_TO_FIRST_DESCRIPTION = "Not reachable on the last try, or no conversation in 30 days or more.";

// "" means "All" for each select.
type Filters = {
  search: string;
  gender: string;
  grade: string;
  programId: string;
  // "30": no Last Contact, or 30 days or more since it.
  lastContact: string;
};

const NO_FILTERS: Filters = { search: "", gender: "", grade: "", programId: "", lastContact: "" };

// Each check passes when its filter is "All" ("") or the Student matches it.
const CHECKS: ((mentee: MenteeRow, filters: Filters) => boolean)[] = [
  (mentee, { search }) => mentee.name.toLowerCase().includes(search.trim().toLowerCase()),
  (mentee, { gender }) => gender === "" || mentee.gender === gender,
  (mentee, { grade }) => grade === "" || mentee.grade === Number(grade),
  (mentee, { programId }) => programId === "" || mentee.programId === Number(programId),
  (mentee, { lastContact }) => lastContact === "" || thirtyDaysOrMore(mentee.daysSince),
];

function matches(mentee: MenteeRow, filters: Filters): boolean {
  return CHECKS.every((check) => check(mentee, filters));
}

function distinctSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function asOptions(values: string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: value }));
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

// Two per row on a phone; sized to their content from 640 px up.
function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const active = value === "" ? "" : "border-accent! bg-hover-bg font-semibold";
  return (
    <div className="min-w-[8rem] flex-1 basis-[calc(50%-0.3125rem)] sm:flex-none sm:basis-auto">
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Select id={id} value={value} className={`sm:w-auto ${active}`} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative w-full sm:w-60">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
      />
      <Input
        type="search"
        aria-label="Search by name"
        placeholder="Search by name"
        autoComplete="off"
        className="pl-9"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// `canLog`: whether the viewer may log for these Students, so a ready draft's
// chip can open the log page; a read-only viewer gets a plain chip. `today` is
// the IST date, so this year's dates drop the year.
export function FilteredMenteeList({ list, canLog, today }: { list: MenteeList; canLog: boolean; today?: string }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const set = (change: Partial<Filters>) => setFilters({ ...filters, ...change });
  const everyone = [...list.talkToFirst, ...list.everyoneElse];
  const talkToFirst = list.talkToFirst.filter((mentee) => matches(mentee, filters));
  const everyoneElse = list.everyoneElse.filter((mentee) => matches(mentee, filters));
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="space-y-4">
      <div role="search" aria-label="Filter students" className="flex flex-wrap items-end gap-2.5">
        <SearchBox value={filters.search} onChange={(search) => set({ search })} />
        <FilterSelect
          id="mentee-filter-gender"
          label="Gender"
          value={filters.gender}
          options={asOptions(distinctSorted(everyone.map((mentee) => mentee.gender)))}
          onChange={(gender) => set({ gender })}
        />
        <FilterSelect
          id="mentee-filter-grade"
          label="Grade"
          value={filters.grade}
          options={asOptions(GRADES)}
          onChange={(grade) => set({ grade })}
        />
        <FilterSelect
          id="mentee-filter-program"
          label="Program"
          value={filters.programId}
          options={programOptions(everyone)}
          onChange={(programId) => set({ programId })}
        />
        <FilterSelect
          id="mentee-filter-last-contact"
          label="Last contact"
          value={filters.lastContact}
          options={LAST_CONTACT_OPTIONS}
          onChange={(lastContact) => set({ lastContact })}
        />
        {filtering && (
          <button
            type="button"
            className="min-h-11 px-1.5 text-sm text-text-muted underline underline-offset-4 hover:text-text-primary"
            onClick={() => setFilters(NO_FILTERS)}
          >
            Clear filters
          </button>
        )}
      </div>
      {talkToFirst.length + everyoneElse.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-bg-card px-4 py-10 text-center text-sm text-text-muted">
          No students match these filters.
        </p>
      ) : (
        <MenteeGroups
          canLog={canLog}
          today={today}
          groups={[
            { title: "Talk to first", description: TALK_TO_FIRST_DESCRIPTION, mentees: talkToFirst },
            { title: "Everyone else", description: "", mentees: everyoneElse },
          ]}
        />
      )}
    </div>
  );
}
