"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

interface SchoolOption {
  code: string;
  name: string;
}

interface PmOption {
  email: string;
  name: string | null;
}

interface FilterBarProps {
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

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function optionLabel(label: string, value: string): string {
  return label === value ? value : `${label} (${value})`;
}

export default function VisitSummaryFilterBar({
  schoolOptions,
  pmOptions,
  currentParams,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<number | null>(null);
  const pendingUpdatesRef = useRef<Record<string, string | undefined>>({});
  const [selectedSchools, setSelectedSchools] = useState(() => parseListParam(currentParams.schools));
  const [selectedPms, setSelectedPms] = useState(() => parseListParam(currentParams.pms));
  const [status, setStatus] = useState(currentParams.status || "");
  const [preset, setPreset] = useState(currentParams.preset || "");
  const [from, setFrom] = useState(currentParams.from || "");
  const [to, setTo] = useState(currentParams.to || "");
  const [bucket, setBucket] = useState(currentParams.bucket || "");
  const schoolOptionCodes = useMemo(
    () => new Set(schoolOptions.map((school) => school.code)),
    [schoolOptions]
  );
  const pmOptionEmails = useMemo(
    () => new Set(pmOptions.map((pm) => pm.email)),
    [pmOptions]
  );
  const missingSchools = selectedSchools.filter((code) => !schoolOptionCodes.has(code));
  const missingPms = selectedPms.filter((email) => !pmOptionEmails.has(email));

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
    for (const key of ["sort", "dir"]) {
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
        <div className="flex flex-wrap gap-2">
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

      <div className="grid gap-4 lg:grid-cols-5">
        <fieldset>
          <legend className="text-xs font-bold uppercase tracking-wide text-text-muted">School</legend>
          <div className="mt-2 space-y-2">
            {missingSchools.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  const next = selectedSchools.filter((schoolCode) => schoolCode !== code);
                  setSelectedSchools(next);
                  replaceWith({ schools: next.join(",") || undefined });
                }}
                className="block text-left text-sm text-text-muted"
              >
                {code} (not in results)
              </button>
            ))}
            {schoolOptions.map((school) => (
              <label key={school.code} className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={selectedSchools.includes(school.code)}
                  onChange={() => {
                    const next = toggleValue(selectedSchools, school.code);
                    setSelectedSchools(next);
                    replaceWith({ schools: next.join(",") || undefined });
                  }}
                />
                <span>{school.name} ({school.code})</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-bold uppercase tracking-wide text-text-muted">PM</legend>
          <div className="mt-2 space-y-2">
            {missingPms.map((email) => (
              <button
                key={email}
                type="button"
                onClick={() => {
                  const next = selectedPms.filter((pmEmail) => pmEmail !== email);
                  setSelectedPms(next);
                  replaceWith({ pms: next.join(",") || undefined });
                }}
                className="block text-left text-sm text-text-muted"
              >
                {email} (not in results)
              </button>
            ))}
            {pmOptions.length === 0 && missingPms.length === 0 ? (
              <div className="text-sm text-text-muted">All PMs</div>
            ) : pmOptions.map((pm) => (
              <label key={pm.email} className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={selectedPms.includes(pm.email)}
                  onChange={() => {
                    const next = toggleValue(selectedPms, pm.email);
                    setSelectedPms(next);
                    replaceWith({ pms: next.join(",") || undefined });
                  }}
                />
                <span>{optionLabel(pm.name || pm.email, pm.email)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="visit-summary-status" className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Status
          </label>
          <select
            id="visit-summary-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              replaceWith({ status: event.target.value || undefined });
            }}
            className="mt-2 w-full border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
          >
            <option value="">Any status</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div>
          <label htmlFor="visit-summary-bucket" className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Required Completion
          </label>
          <select
            id="visit-summary-bucket"
            value={bucket}
            onChange={(event) => {
              setBucket(event.target.value);
              replaceWith({ bucket: event.target.value || undefined });
            }}
            className="mt-2 w-full border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
          >
            <option value="">Any required completion</option>
            <option value="none">No required actions</option>
            <option value="partial">Partially started</option>
            <option value="all_present">All required present but incomplete</option>
            <option value="all_complete">All required complete</option>
          </select>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="visit-summary-preset" className="text-xs font-bold uppercase tracking-wide text-text-muted">
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
              className="mt-2 w-full border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
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
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-bold uppercase tracking-wide text-text-muted">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    replaceWith({ from: event.target.value || undefined, preset: undefined });
                  }}
                  className="mt-2 w-full border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wide text-text-muted">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    replaceWith({ to: event.target.value || undefined, preset: undefined });
                  }}
                  className="mt-2 w-full border border-border bg-bg-card px-3 py-2 text-sm text-text-primary"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
