"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  SearchableMultiSelect,
  type SearchableMultiSelectOption,
} from "@/components/ui/SearchableMultiSelect";

interface SchoolOption {
  code: string;
  name: string;
}

interface PmOption {
  email: string;
  name: string | null;
}

interface FilterBarProps {
  regionOptions: SearchableMultiSelectOption[];
  schoolOptions: SchoolOption[];
  pmOptions: PmOption[];
  currentParams: Record<string, string | undefined>;
  // The School-wise tab's "Recurring concerns only" toggle (`recurring=1`).
  showRecurringToggle?: boolean;
}

function parseListParam(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionLabel(label: string, value: string): string {
  return label === value ? value : `${label} (${value})`;
}

// A value picked earlier (or typed into the URL) that no longer has Visits in view stays listed,
// ticked, so it can be unticked.
function withMissingSelected(
  options: SearchableMultiSelectOption[],
  selected: string[]
): SearchableMultiSelectOption[] {
  const known = new Set(options.map((option) => option.value));
  const missing = selected
    .filter((value) => !known.has(value))
    .map((value) => ({ value, label: `${value} (not in results)` }));
  return [...missing, ...options];
}

const FIELD_LABEL_CLASS = "text-xs font-bold uppercase tracking-wide text-text-muted";
const FIELD_INPUT_CLASS = "mt-2 w-full border border-border bg-bg-card px-3 py-2 text-sm text-text-primary";

export default function VisitSummaryFilterBar({
  regionOptions,
  schoolOptions,
  pmOptions,
  currentParams,
  showRecurringToggle = false,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<number | null>(null);
  const pendingUpdatesRef = useRef<Record<string, string | undefined>>({});
  const [selectedRegions, setSelectedRegions] = useState(() => parseListParam(currentParams.regions));
  const [selectedSchools, setSelectedSchools] = useState(() => parseListParam(currentParams.schools));
  const [selectedPms, setSelectedPms] = useState(() => parseListParam(currentParams.pms));
  const [status, setStatus] = useState(currentParams.status || "");
  const [preset, setPreset] = useState(currentParams.preset || "");
  const [from, setFrom] = useState(currentParams.from || "");
  const [to, setTo] = useState(currentParams.to || "");
  const [bucket, setBucket] = useState(currentParams.bucket || "");
  const [recurringOnly, setRecurringOnly] = useState(currentParams.recurring === "1");

  function replaceWith(updates: Record<string, string | undefined>) {
    Object.assign(pendingUpdatesRef.current, updates);

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      const merged = pendingUpdatesRef.current;
      pendingUpdatesRef.current = {};

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(currentParams)) {
        if (value && !(key in merged)) {
          params.set(key, value);
        }
      }
      params.set("page", "1");
      for (const [key, value] of Object.entries(merged)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 300);
  }

  function clearFilters() {
    const params = new URLSearchParams();
    for (const key of ["tab", "sort", "dir"]) {
      if (currentParams[key]) {
        params.set(key, currentParams[key]);
      }
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <section className="mb-6 border border-border bg-bg-card p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">Filters</h2>
        <div className="flex flex-wrap items-center gap-2">
          {showRecurringToggle && (
            <label className="mr-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-primary">
              <input
                type="checkbox"
                checked={recurringOnly}
                onChange={(event) => {
                  setRecurringOnly(event.target.checked);
                  replaceWith({ recurring: event.target.checked ? "1" : undefined });
                }}
                className="h-4 w-4 accent-accent"
              />
              Recurring concerns only
            </label>
          )}
          <span className="group relative">
            <button
              type="button"
              disabled
              className="border border-border px-3 py-2 text-xs font-bold uppercase text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download CSV
            </button>
            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-text-primary px-2 py-1 text-xs text-bg opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              Coming soon
            </span>
          </span>
          <button
            type="button"
            onClick={clearFilters}
            className="border border-border px-3 py-2 text-xs font-bold uppercase text-accent hover:bg-hover-bg"
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <SearchableMultiSelect
          label="Region"
          options={withMissingSelected(regionOptions, selectedRegions)}
          selected={selectedRegions}
          allLabel="All regions"
          pluralNoun="regions"
          onChange={(next) => {
            setSelectedRegions(next);
            replaceWith({ regions: next.join(",") || undefined });
          }}
        />

        <SearchableMultiSelect
          label="School"
          options={withMissingSelected(
            schoolOptions.map((school) => ({ value: school.code, label: `${school.name} (${school.code})` })),
            selectedSchools
          )}
          selected={selectedSchools}
          allLabel="All schools"
          pluralNoun="schools"
          onChange={(next) => {
            setSelectedSchools(next);
            replaceWith({ schools: next.join(",") || undefined });
          }}
        />

        <SearchableMultiSelect
          label="PM"
          options={withMissingSelected(
            pmOptions.map((pm) => ({ value: pm.email, label: optionLabel(pm.name || pm.email, pm.email) })),
            selectedPms
          )}
          selected={selectedPms}
          allLabel="All PMs"
          pluralNoun="PMs"
          onChange={(next) => {
            setSelectedPms(next);
            replaceWith({ pms: next.join(",") || undefined });
          }}
        />

        <div>
          <label htmlFor="visit-summary-status" className={FIELD_LABEL_CLASS}>
            Status
          </label>
          <select
            id="visit-summary-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              replaceWith({ status: event.target.value || undefined });
            }}
            className={FIELD_INPUT_CLASS}
          >
            <option value="">Any status</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div>
          <label htmlFor="visit-summary-bucket" className={FIELD_LABEL_CLASS}>
            Required Completion
          </label>
          <select
            id="visit-summary-bucket"
            value={bucket}
            onChange={(event) => {
              setBucket(event.target.value);
              replaceWith({ bucket: event.target.value || undefined });
            }}
            className={FIELD_INPUT_CLASS}
          >
            <option value="">Any required completion</option>
            <option value="none">No required actions</option>
            <option value="partial">Partially started</option>
            <option value="all_present">All required present but incomplete</option>
            <option value="all_complete">All required complete</option>
          </select>
        </div>

        <div>
          <label htmlFor="visit-summary-preset" className={FIELD_LABEL_CLASS}>
            Date Preset
          </label>
          <select
            id="visit-summary-preset"
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value);
              setFrom("");
              setTo("");
              replaceWith({
                preset: event.target.value || undefined,
                from: undefined,
                to: undefined,
              });
            }}
            className={FIELD_INPUT_CLASS}
          >
            <option value="">Manual range</option>
            <option value="1d">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last year</option>
            <option value="all">All dates</option>
          </select>
        </div>

        {!preset && (
          <>
            <label className={FIELD_LABEL_CLASS}>
              From
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  replaceWith({ from: event.target.value || undefined, preset: undefined });
                }}
                className={FIELD_INPUT_CLASS}
              />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              To
              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  replaceWith({ to: event.target.value || undefined, preset: undefined });
                }}
                className={FIELD_INPUT_CLASS}
              />
            </label>
          </>
        )}
      </div>
    </section>
  );
}
