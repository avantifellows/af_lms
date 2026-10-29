"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const FIELD_LABEL_CLASS = "text-[11px] font-bold uppercase tracking-wide text-text-muted";
const FIELD_INPUT_CLASS = "mt-1 w-full border border-border bg-bg-card px-2.5 py-1 text-sm text-text-primary";

type Params = Record<string, string | undefined>;

const FILTER_PARAM_KEYS = ["regions", "schools", "pms", "status", "bucket", "preset", "from", "to"] as const;

// The URL's filter values, as one string to compare.
function filterSignature(params: Params): string {
  return JSON.stringify(FILTER_PARAM_KEYS.map((key) => params[key] || ""));
}

// Every param, as one string to compare: a tab switch changes the URL but keeps the filters.
function paramsSignature(params: Params): string {
  return JSON.stringify(Object.entries(params).filter(([, value]) => value));
}

// `base` with `updates` applied. A filter change goes back to the first page: drop `page` rather
// than pin `page=1`.
function withUpdates(base: Params, updates: Params): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(base)) {
    if (value && !Object.hasOwn(updates, key)) {
      params.set(key, value);
    }
  }
  params.delete("page");
  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }
  return params;
}

export default function VisitSummaryFilterBar({
  regionOptions,
  schoolOptions,
  pmOptions,
  currentParams,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sectionRef = useRef<HTMLElement>(null);
  const debounceRef = useRef<number | null>(null);
  const pendingUpdatesRef = useRef<Params>({});
  // What the next update builds on: the URL as last seen, or the update last sent if newer, so a
  // second update sent before the first lands keeps it.
  const baseParamsRef = useRef<Params>(currentParams);
  const [selectedRegions, setSelectedRegions] = useState(() => parseListParam(currentParams.regions));
  const [selectedSchools, setSelectedSchools] = useState(() => parseListParam(currentParams.schools));
  const [selectedPms, setSelectedPms] = useState(() => parseListParam(currentParams.pms));
  const [status, setStatus] = useState(currentParams.status || "");
  const [preset, setPreset] = useState(currentParams.preset || "");
  const [from, setFrom] = useState(currentParams.from || "");
  const [to, setTo] = useState(currentParams.to || "");
  const [bucket, setBucket] = useState(currentParams.bucket || "");
  const [seenParams, setSeenParams] = useState(() => paramsSignature(currentParams));
  // The filters of the update this bar last sent, until it lands.
  const [sentFilters, setSentFilters] = useState<string | null>(null);

  function showFilters(params: Params) {
    setSelectedRegions(parseListParam(params.regions));
    setSelectedSchools(parseListParam(params.schools));
    setSelectedPms(parseListParam(params.pms));
    setStatus(params.status || "");
    setPreset(params.preset || "");
    setFrom(params.from || "");
    setTo(params.to || "");
    setBucket(params.bucket || "");
  }

  // A new URL. When it carries the filters this bar sent, its own update landed: the fields already
  // show it, and any pick made meanwhile. Otherwise (Clear filters, Back, a navigation that replaced
  // this bar's update) the fields show the URL. Not a remount, so an open list and focus stay.
  const urlSignature = paramsSignature(currentParams);
  if (urlSignature !== seenParams) {
    setSeenParams(urlSignature);
    if (filterSignature(currentParams) === sentFilters) {
      setSentFilters(null);
    } else {
      showFilters(currentParams);
    }
  }

  useEffect(() => {
    baseParamsRef.current = currentParams;
  }, [currentParams]);

  const send = useCallback((params: URLSearchParams) => {
    baseParamsRef.current = Object.fromEntries(params);
    setSentFilters(filterSignature(baseParamsRef.current));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);

  const dropPending = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = null;
    pendingUpdatesRef.current = {};
  }, []);

  const sendPending = useCallback(() => {
    const updates = pendingUpdatesRef.current;
    dropPending();
    send(withUpdates(baseParamsRef.current, updates));
  }, [dropPending, send]);

  // A pointer or focus landing outside the bar sends a waiting update at once, before any navigation
  // that click starts (a tab, a sort header, a School row): Next discards the earlier navigation, so
  // a waiting update can never land after a tab switch and undo it. Back/Forward drops it instead,
  // and forgets the update last sent, so the fields always show the URL it lands on.
  useEffect(() => {
    function sendBeforeLeaving(event: Event) {
      if (debounceRef.current !== null && !sectionRef.current?.contains(event.target as Node)) {
        sendPending();
      }
    }
    function onHistoryMove() {
      dropPending();
      setSentFilters(null);
    }
    document.addEventListener("pointerdown", sendBeforeLeaving, true);
    document.addEventListener("focusin", sendBeforeLeaving, true);
    window.addEventListener("popstate", onHistoryMove);
    return () => {
      document.removeEventListener("pointerdown", sendBeforeLeaving, true);
      document.removeEventListener("focusin", sendBeforeLeaving, true);
      window.removeEventListener("popstate", onHistoryMove);
    };
  }, [dropPending, sendPending]);

  // Nothing is sent after the bar unmounts.
  useEffect(() => dropPending, [dropPending]);

  function replaceWith(updates: Params) {
    Object.assign(pendingUpdatesRef.current, updates);
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(sendPending, 300);
  }

  function clearFilters() {
    dropPending();
    showFilters({});
    const params = new URLSearchParams();
    for (const key of ["tab", "sort", "dir"]) {
      if (currentParams[key]) {
        params.set(key, currentParams[key]);
      }
    }
    send(params);
  }

  return (
    <section ref={sectionRef} aria-labelledby="visit-summary-filters-heading" className="mb-4 rounded-lg border border-border bg-bg-card px-3 py-2.5 shadow-sm sm:px-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 id="visit-summary-filters-heading" className="text-sm font-bold uppercase tracking-wider text-text-primary">
          Filters
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="group relative">
            <button
              type="button"
              disabled
              className="border border-border px-2.5 py-1 text-xs font-bold uppercase text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
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
            className="border border-border px-2.5 py-1 text-xs font-bold uppercase text-accent hover:bg-hover-bg"
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* grid-cols-1 (minmax(0, 1fr)) and min-w-0 on each field keep a long selected label truncated
          in its button on a narrow screen instead of widening the column. */}
      <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)_minmax(0,1.2fr)_repeat(2,minmax(0,1fr))]">
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

        <div className="min-w-0">
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

        <div className="min-w-0">
          <label htmlFor="visit-summary-bucket" className={FIELD_LABEL_CLASS}>
            Required actions
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
            <option value="">All visits</option>
            <option value="none">No actions started</option>
            <option value="partial">Few actions started</option>
            <option value="all_present">All actions started, but incomplete</option>
            <option value="all_complete">All actions complete</option>
          </select>
        </div>

        <div className="min-w-0">
          <label htmlFor="visit-summary-preset" className={FIELD_LABEL_CLASS}>
            Date preset
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
            <div className="min-w-0">
              <label htmlFor="visit-summary-from" className={FIELD_LABEL_CLASS}>
                From
              </label>
              <input
                id="visit-summary-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  replaceWith({ from: event.target.value || undefined, preset: undefined });
                }}
                className={FIELD_INPUT_CLASS}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="visit-summary-to" className={FIELD_LABEL_CLASS}>
                To
              </label>
              <input
                id="visit-summary-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  replaceWith({ to: event.target.value || undefined, preset: undefined });
                }}
                className={FIELD_INPUT_CLASS}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
