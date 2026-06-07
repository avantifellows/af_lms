"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Edit2,
  Link2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Button, Input, Select } from "@/components/ui";
import type {
  CentreBooleanFilter,
  CentreListFilters,
  CentreListRow,
  CentreListSummary,
  CentreOption,
  CentreOptionSet,
  CentreOptionSetCode,
  CentreSearchSuggestion,
  CentreSchoolLinkFilter,
} from "@/lib/centres";

interface CentreGridProps {
  initialRows: CentreListRow[];
  initialSummary: CentreListSummary;
  initialFilters: CentreListFilters;
  initialPagination: {
    page: number;
    limit: number;
    totalRows: number;
    totalPages: number;
  };
  optionSets: CentreOptionSet[];
}

type EditMode = "create" | "edit";

interface SchoolSearchResult {
  id: number;
  code: string;
  name: string;
  udise_code?: string | null;
  udiseCode?: string | null;
  region?: string | null;
  state?: string | null;
  district?: string | null;
}

interface CentreFormState {
  id: number | null;
  name: string;
  schoolId: number | null;
  schoolLabel: string;
  typeCode: string;
  categoryCode: string;
  subCategoryCode: string;
  streamCodes: string[];
  isPhysical: boolean;
  isActive: boolean;
}

const EMPTY_FILTERS: CentreListFilters = {
  search: "",
  searchTerms: [],
  active: "all",
  schoolLink: "all",
  typeCode: null,
  categoryCode: null,
  subCategoryCode: null,
  streamCode: null,
  isPhysical: "all",
};

export default function CentreGrid({
  initialRows,
  initialSummary,
  initialFilters,
  initialPagination,
  optionSets,
}: CentreGridProps) {
  const [rows, setRows] = useState(initialRows);
  const [summary, setSummary] = useState(initialSummary);
  const [filters, setFilters] = useState<CentreListFilters>(initialFilters);
  const [pagination, setPagination] = useState(initialPagination);
  const [loading, setLoading] = useState(false);
  const [tableError, setTableError] = useState("");
  const [modal, setModal] = useState<{ mode: EditMode; form: CentreFormState } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [searchSuggestions, setSearchSuggestions] = useState<CentreSearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [searchingSuggestions, setSearchingSuggestions] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [schoolResults, setSchoolResults] = useState<SchoolSearchResult[]>([]);
  const [schoolSearching, setSchoolSearching] = useState(false);

  const optionsBySet = useMemo(() => {
    const map = new Map<CentreOptionSetCode, CentreOption[]>();
    for (const optionSet of optionSets) {
      map.set(optionSet.code, optionSet.options);
    }
    return map;
  }, [optionSets]);

  const resetSaveState = () => {
    setSaveError("");
    setFieldErrors({});
  };

  useEffect(() => {
    const search = filters.search.trim();
    if (search.length < 2) {
      setSearchSuggestions([]);
      setSuggestionsOpen(false);
      setSearchingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchingSuggestions(true);
      try {
        const response = await fetch(
          `/api/admin/centres/search-suggestions?q=${encodeURIComponent(search)}&limit=8`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load search suggestions");
        setSearchSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        setSuggestionsOpen(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchSuggestions([]);
        setSuggestionsOpen(false);
      } finally {
        if (!controller.signal.aborted) {
          setSearchingSuggestions(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [filters.search]);

  const applyFilters = async (nextFilters = filters, page = 1) => {
    setLoading(true);
    setTableError("");

    try {
      const params = new URLSearchParams();
      appendFilterParams(params, nextFilters);
      params.set("page", String(page));
      params.set("limit", String(pagination.limit));
      const response = await fetch(`/api/admin/centres?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load Centres");
      }
      setRows(data.rows ?? []);
      setSummary(data.summary ?? deriveSummary(data.rows ?? [], data.pagination?.totalRows ?? 0));
      setPagination(data.pagination ?? { ...pagination, page });
      setFilters(data.filters ?? nextFilters);
    } catch (error) {
      setTableError(error instanceof Error ? error.message : "Failed to load Centres");
    } finally {
      setLoading(false);
    }
  };

  const resetFilters = async () => {
    setFilters(EMPTY_FILTERS);
    setSearchSuggestions([]);
    setSuggestionsOpen(false);
    await applyFilters(EMPTY_FILTERS);
  };

  const goToPage = async (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), Math.max(pagination.totalPages, 1));
    if (nextPage === pagination.page) return;
    await applyFilters(filters, nextPage);
  };

  const openCreate = () => {
    setModal({ mode: "create", form: emptyForm() });
    resetSaveState();
  };

  const openEdit = (row: CentreListRow) => {
    setModal({
      mode: "edit",
      form: {
        id: row.id,
        name: row.name,
        schoolId: row.schoolId,
        schoolLabel: schoolLabel(row),
        typeCode: row.typeCode ?? "",
        categoryCode: row.categoryCode ?? "",
        subCategoryCode: row.subCategoryCode ?? "",
        streamCodes: row.streamCodes,
        isPhysical: row.isPhysical,
        isActive: row.isActive,
      },
    });
    setSchoolSearch("");
    setSchoolResults([]);
    resetSaveState();
  };

  const closeModal = () => {
    setModal(null);
    setSchoolSearch("");
    setSchoolResults([]);
    resetSaveState();
  };

  const patchForm = (patch: Partial<CentreFormState>) => {
    setModal((current) =>
      current ? { ...current, form: { ...current.form, ...patch } } : current
    );
  };

  const toggleStream = (code: string) => {
    if (!modal) return;
    const streamCodes = modal.form.streamCodes.includes(code)
      ? modal.form.streamCodes.filter((value) => value !== code)
      : [...modal.form.streamCodes, code];
    patchForm({ streamCodes });
  };

  const toggleSearchTerm = async (value: string) => {
    const exists = filters.searchTerms.includes(value);
    const nextFilters = {
      ...filters,
      search: "",
      searchTerms: exists
        ? filters.searchTerms.filter((term) => term !== value)
        : [...filters.searchTerms, value],
    };
    setFilters(nextFilters);
    setSearchSuggestions([]);
    setSuggestionsOpen(false);
    await applyFilters(nextFilters);
  };

  const removeSearchTerm = async (value: string) => {
    const nextFilters = {
      ...filters,
      searchTerms: filters.searchTerms.filter((term) => term !== value),
    };
    setFilters(nextFilters);
    await applyFilters(nextFilters);
  };

  const searchSchools = async () => {
    const query = schoolSearch.trim();
    if (!query) {
      setSchoolResults([]);
      return;
    }
    setSchoolSearching(true);
    try {
      const response = await fetch(
        `/api/admin/schools?scope=centres&q=${encodeURIComponent(query)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to search Schools");
      setSchoolResults(Array.isArray(data) ? data : []);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to search Schools");
    } finally {
      setSchoolSearching(false);
    }
  };

  const chooseSchool = (school: SchoolSearchResult) => {
    patchForm({
      schoolId: school.id,
      schoolLabel: `${school.name} (${school.code}${schoolUdise(school) ? ` / ${schoolUdise(school)}` : ""})`,
    });
    setSchoolSearch("");
    setSchoolResults([]);
  };

  const saveCentre = async () => {
    if (!modal) return;
    setSaving(true);
    resetSaveState();

    const payload = formToPayload(modal.form);
    try {
      const response = await fetch(
        modal.mode === "create"
          ? "/api/admin/centres"
          : `/api/admin/centres/${modal.form.id}`,
        {
          method: modal.mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        setFieldErrors(data.fields ?? {});
        throw new Error(data.error || "Failed to save Centre");
      }

      const saved = data.centre as CentreListRow;
      setRows((current) =>
        modal.mode === "create"
          ? [saved, ...current]
          : current.map((row) => (row.id === saved.id ? saved : row))
      );
      setSummary((current) => updateSummaryAfterSave(current, rows, saved, modal.mode));
      setPagination((current) =>
        modal.mode === "create"
          ? { ...current, totalRows: current.totalRows + 1 }
          : current
      );
      closeModal();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save Centre");
    } finally {
      setSaving(false);
    }
  };

  const pageStart =
    pagination.totalRows === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const pageEnd = Math.min(pagination.page * pagination.limit, pagination.totalRows);
  const visibleLinkedRows = rows.filter((row) => row.schoolId !== null).length;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-bold uppercase text-text-primary">Centres</h2>
          <p className="mt-1 text-sm text-text-muted">
            Spreadsheet-style management for Centre records and School links.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Centre
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
          label="Total Centres"
          value={summary.totalCentres}
          detail={`${pageStart}-${pageEnd} visible`}
        />
        <SummaryTile
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          label="Active Centres"
          value={summary.activeCentres}
          detail={`${summary.totalCentres - summary.activeCentres} inactive`}
        />
        <SummaryTile
          icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
          label="Centres linked to Schools"
          value={summary.linkedCentres}
          detail={`${summary.totalCentres - summary.linkedCentres} unlinked`}
        />
        <SummaryTile
          icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
          label="Total Physical Centres"
          value={summary.physicalCentres}
          detail={`${summary.totalCentres - summary.physicalCentres} non-physical`}
        />
      </div>

      <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase text-text-primary">
          <SlidersHorizontal className="h-4 w-4 text-accent" aria-hidden="true" />
          Filters
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(240px,1.2fr)_repeat(3,minmax(140px,1fr))] xl:grid-cols-[minmax(280px,1.4fr)_repeat(6,minmax(132px,1fr))_auto]">
          <div className="text-xs font-semibold uppercase text-text-muted">
            <label htmlFor="centre-search">Search</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
              <Input
                id="centre-search"
                value={filters.search}
                onChange={(event) => {
                  setFilters({ ...filters, search: event.target.value });
                  setSuggestionsOpen(true);
                }}
                onFocus={() => {
                  if (searchSuggestions.length > 0) setSuggestionsOpen(true);
                }}
                placeholder="Centre, School, code, UDISE"
                className="pl-9"
              />
              {suggestionsOpen && (searchSuggestions.length > 0 || searchingSuggestions) && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-lg border border-border bg-bg-card shadow-xl">
                  <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase text-text-muted">
                    {searchingSuggestions ? "Searching" : "Best matches"}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {searchSuggestions.map((suggestion) => (
                      <button
                        key={`${suggestion.kind}:${suggestion.value}`}
                        type="button"
                        className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-hover-bg"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => toggleSearchTerm(suggestion.value)}
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            filters.searchTerms.includes(suggestion.value)
                              ? "border-accent bg-accent text-text-on-accent"
                              : "border-border bg-bg-input"
                          }`}
                          aria-hidden="true"
                        >
                          {filters.searchTerms.includes(suggestion.value) ? (
                            <Check className="h-3 w-3" aria-hidden="true" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-text-primary">
                            {suggestion.label}
                          </span>
                          <span className="block truncate text-xs text-text-muted">
                            {suggestion.detail}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {filters.searchTerms.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {filters.searchTerms.map((term) => (
                  <button
                    key={term}
                    type="button"
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-hover-bg px-2.5 py-1 text-xs font-semibold normal-case text-accent-hover"
                    onClick={() => removeSearchTerm(term)}
                  >
                    <span className="truncate">{term}</span>
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <FilterSelect
            label="Active"
            value={filters.active}
            onChange={(active) => setFilters({ ...filters, active })}
            options={[
              ["all", "All"],
              ["true", "Active"],
              ["false", "Inactive"],
            ]}
          />
          <FilterSelect
            label="School Link"
            value={filters.schoolLink}
            onChange={(schoolLink) => setFilters({ ...filters, schoolLink })}
            options={[
              ["all", "All"],
              ["linked", "Linked"],
              ["unlinked", "Unlinked"],
            ]}
          />
          <OptionFilter
            label="Type"
            value={filters.typeCode ?? ""}
            options={optionsBySet.get("type") ?? []}
            onChange={(typeCode) => setFilters({ ...filters, typeCode: typeCode || null })}
          />
          <OptionFilter
            label="Category"
            value={filters.categoryCode ?? ""}
            options={optionsBySet.get("category") ?? []}
            onChange={(categoryCode) =>
              setFilters({ ...filters, categoryCode: categoryCode || null })
            }
          />
          <OptionFilter
            label="Stream"
            value={filters.streamCode ?? ""}
            options={optionsBySet.get("stream") ?? []}
            onChange={(streamCode) => setFilters({ ...filters, streamCode: streamCode || null })}
          />
          <FilterSelect
            label="Physical"
            value={filters.isPhysical}
            onChange={(isPhysical) => setFilters({ ...filters, isPhysical })}
            options={[
              ["all", "All"],
              ["true", "Physical"],
              ["false", "Non-physical"],
            ]}
          />
          <div className="flex items-start gap-2 pt-6">
            <Button size="md" onClick={() => applyFilters()} disabled={loading} className="min-w-24">
              <Search className="h-4 w-4" aria-hidden="true" />
              {loading ? "Loading" : "Apply"}
            </Button>
            <Button size="md" variant="secondary" onClick={resetFilters} disabled={loading} aria-label="Reset filters">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {tableError && (
        <div className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          {tableError}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
        <div className="flex flex-col gap-2 border-b border-border bg-bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase text-text-primary">Centre directory</p>
            <p className="text-xs text-text-muted">
              Viewing <span className="font-semibold text-text-primary">{pageStart}</span>-
              <span className="font-semibold text-text-primary">{pageEnd}</span> of{" "}
              <span className="font-semibold text-text-primary">{pagination.totalRows}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-success-bg px-2.5 py-1 font-semibold text-success">
              {visibleLinkedRows} linked
            </span>
            <span className="rounded-full bg-warning-bg px-2.5 py-1 font-semibold text-warning-text">
              {rows.length - visibleLinkedRows} unlinked
            </span>
          </div>
        </div>
        <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[1360px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-bg-card-alt shadow-[inset_0_-1px_0_var(--color-border)]">
            <tr>
              {[
                "Centre",
                "Linked School",
                "School Code",
                "UDISE",
                "Region",
                "State",
                "District",
                "Type",
                "Centre Streams",
                "Category",
                "Sub-category",
                "Updated",
              ].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-3 text-left text-xs font-bold uppercase text-text-muted ${
                    header === "Centre" ? "sticky left-0 z-30 min-w-[300px] bg-bg-card-alt" : ""
                  }`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-bg-card">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-12 text-center text-sm text-text-muted">
                  No Centres match the current filters
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="group">
                  <td className="sticky left-0 z-10 max-w-[300px] border-b border-border bg-bg-card px-4 py-3 shadow-[1px_0_0_var(--color-border)] transition-colors group-hover:bg-[#fff3e9]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold leading-5 text-text-primary">{row.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <StatusDot active={row.isActive} trueLabel="Active" falseLabel="Inactive" />
                          <StatusDot active={row.isPhysical} trueLabel="Physical" falseLabel="Non-physical" />
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(row)} className="shrink-0 px-2">
                        <Edit2 className="h-4 w-4" aria-hidden="true" />
                        Edit
                      </Button>
                    </div>
                  </td>
                  <td className="max-w-[240px] border-b border-border px-3 py-3 text-text-primary transition-colors group-hover:bg-[#fff3e9]">
                    {row.school ? (
                      <div>
                        <div className="font-medium leading-5">{row.school.name}</div>
                        <div className="mt-1 text-xs text-text-muted">Linked school</div>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning-text">
                        <CircleOff className="h-3.5 w-3.5" aria-hidden="true" />
                        Unlinked
                      </span>
                    )}
                  </td>
                  <BlankableCell value={row.school?.code} />
                  <BlankableCell value={row.school?.udiseCode} />
                  <BlankableCell value={row.school?.region} />
                  <BlankableCell value={row.school?.state} />
                  <BlankableCell value={row.school?.district} />
                  <td className="border-b border-border px-3 py-3 transition-colors group-hover:bg-[#fff3e9]">
                    <OptionBadge label={row.typeLabel ?? row.typeCode} active={row.typeOptionActive} />
                  </td>
                  <td className="border-b border-border px-3 py-3 transition-colors group-hover:bg-[#fff3e9]">
                    {row.streams.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.streams.map((stream) => (
                          <OptionBadge
                            key={stream.code}
                            label={stream.label || stream.code}
                            active={stream.isActive}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-muted/60">No streams</span>
                    )}
                  </td>
                  <td className="border-b border-border px-3 py-3 transition-colors group-hover:bg-[#fff3e9]">
                    <OptionBadge label={row.categoryLabel ?? row.categoryCode} active={row.categoryOptionActive} />
                  </td>
                  <td className="border-b border-border px-3 py-3 transition-colors group-hover:bg-[#fff3e9]">
                    <OptionBadge
                      label={row.subCategoryLabel ?? row.subCategoryCode}
                      active={row.subCategoryOptionActive}
                    />
                  </td>
                  <td className="whitespace-nowrap border-b border-border px-3 py-3 font-mono text-xs text-text-muted transition-colors group-hover:bg-[#fff3e9]">
                    {formatDate(row.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {pagination.totalPages > 1 && (
        <div
          className="flex flex-col gap-3 rounded-md border border-border bg-white px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
          aria-label="Centre pagination"
        >
          <p className="text-gray-600">
            Showing <span className="font-semibold text-gray-900">{pageStart}</span>-
            <span className="font-semibold text-gray-900">{pageEnd}</span> of{" "}
            <span className="font-semibold text-gray-900">{pagination.totalRows}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => goToPage(pagination.page - 1)}
              disabled={loading || pagination.page <= 1}
              aria-label="Previous Centre page"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Previous
            </Button>
            <span className="min-w-28 text-center text-xs font-semibold uppercase text-gray-600">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => goToPage(pagination.page + 1)}
              disabled={loading || pagination.page >= pagination.totalPages}
              aria-label="Next Centre page"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/30" onClick={closeModal} aria-hidden="true" />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-3xl rounded-md bg-white p-5 shadow-xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold uppercase text-gray-900">
                    {modal.mode === "create" ? "New Centre" : "Edit Centre"}
                  </h3>
                  <p className="text-xs text-gray-500">School metadata is derived from the selected School.</p>
                </div>
                <Button variant="icon" aria-label="Close Centre form" onClick={closeModal}>
                  <X className="h-5 w-5" aria-hidden="true" />
                </Button>
              </div>

              {saveError && (
                <div className="mb-4 rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
                  {saveError}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Centre name" error={fieldErrors.name}>
                  <Input
                    value={modal.form.name}
                    onChange={(event) => patchForm({ name: event.target.value })}
                  />
                </Field>

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-gray-600">Linked School</div>
                  <div className="rounded-md border border-border p-3">
                    <div className="mb-2 min-h-5 text-sm text-gray-700">
                      {modal.form.schoolLabel || <span className="text-gray-400">Unlinked</span>}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={schoolSearch}
                        onChange={(event) => setSchoolSearch(event.target.value)}
                        placeholder="Search name, code, UDISE"
                      />
                      <Button type="button" size="sm" onClick={searchSchools} disabled={schoolSearching}>
                        <Search className="h-4 w-4" aria-hidden="true" />
                        {schoolSearching ? "Searching" : "Search"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => patchForm({ schoolId: null, schoolLabel: "" })}
                      >
                        Unlink
                      </Button>
                    </div>
                    {schoolResults.length > 0 && (
                      <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-border">
                        {schoolResults.map((school) => (
                          <button
                            key={school.id}
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                            onClick={() => chooseSchool(school)}
                          >
                            <span className="font-medium">{school.name}</span>
                            <span className="ml-2 font-mono text-xs text-gray-500">
                              {school.code}
                              {schoolUdise(school) ? ` / ${schoolUdise(school)}` : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {fieldErrors.school_id && (
                    <p className="mt-1 text-xs text-danger">{fieldErrors.school_id}</p>
                  )}
                </div>

                <OptionSelectField
                  label="Type"
                  value={modal.form.typeCode}
                  options={selectOptions({
                    options: optionsBySet.get("type") ?? [],
                    currentCode: modal.form.typeCode,
                    includeInactiveCurrent: modal.mode === "edit",
                  })}
                  error={fieldErrors.type_code}
                  onChange={(typeCode) => patchForm({ typeCode })}
                />
                <OptionSelectField
                  label="Category"
                  value={modal.form.categoryCode}
                  options={selectOptions({
                    options: optionsBySet.get("category") ?? [],
                    currentCode: modal.form.categoryCode,
                    includeInactiveCurrent: modal.mode === "edit",
                  })}
                  error={fieldErrors.category_code}
                  onChange={(categoryCode) => patchForm({ categoryCode })}
                />
                <OptionSelectField
                  label="Sub-category"
                  value={modal.form.subCategoryCode}
                  options={selectOptions({
                    options: optionsBySet.get("sub_category") ?? [],
                    currentCode: modal.form.subCategoryCode,
                    includeInactiveCurrent: modal.mode === "edit",
                  })}
                  error={fieldErrors.sub_category_code}
                  onChange={(subCategoryCode) => patchForm({ subCategoryCode })}
                />

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase text-gray-600">Centre Streams</div>
                  <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                    {selectOptions({
                      options: optionsBySet.get("stream") ?? [],
                      currentCodes: modal.form.streamCodes,
                      includeInactiveCurrent: modal.mode === "edit",
                    }).map((option) => (
                      <label key={option.code} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={modal.form.streamCodes.includes(option.code)}
                          onChange={() => toggleStream(option.code)}
                        />
                        <span>{option.label}</span>
                        {!option.isActive && <span className="text-xs text-gray-400">inactive</span>}
                      </label>
                    ))}
                  </div>
                  {fieldErrors.stream_codes && (
                    <p className="mt-1 text-xs text-danger">{fieldErrors.stream_codes}</p>
                  )}
                </div>

                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={modal.form.isPhysical}
                    onChange={(event) => patchForm({ isPhysical: event.target.checked })}
                  />
                  Physical Centre
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={modal.form.isActive}
                    onChange={(event) => patchForm({ isActive: event.target.checked })}
                  />
                  Active Centre
                </label>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" onClick={closeModal} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={saveCentre} disabled={saving}>
                  {saving ? "Saving" : "Save Centre"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FilterSelect<T extends CentreBooleanFilter | CentreSchoolLinkFilter>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="text-xs font-semibold uppercase text-text-muted">
      {label}
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 w-full"
      >
        {options.map(([code, optionLabel]) => (
          <option key={code} value={code}>
            {optionLabel}
          </option>
        ))}
      </Select>
    </label>
  );
}

function OptionFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: CentreOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-semibold uppercase text-text-muted">
      {label}
      <Select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full">
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-text-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-hover-bg text-accent">
          {icon}
        </span>
        {label}
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-2xl font-bold text-text-primary">{value}</span>
        <span className="pb-1 text-xs text-text-muted">{detail}</span>
      </div>
    </div>
  );
}

function deriveSummary(rows: CentreListRow[], totalCentres: number): CentreListSummary {
  return {
    totalCentres,
    activeCentres: rows.filter((row) => row.isActive).length,
    linkedCentres: rows.filter((row) => row.schoolId !== null).length,
    physicalCentres: rows.filter((row) => row.isPhysical).length,
  };
}

function updateSummaryAfterSave(
  summary: CentreListSummary,
  rows: CentreListRow[],
  saved: CentreListRow,
  mode: EditMode
): CentreListSummary {
  if (mode === "create") {
    return {
      totalCentres: summary.totalCentres + 1,
      activeCentres: summary.activeCentres + (saved.isActive ? 1 : 0),
      linkedCentres: summary.linkedCentres + (saved.schoolId !== null ? 1 : 0),
      physicalCentres: summary.physicalCentres + (saved.isPhysical ? 1 : 0),
    };
  }

  const previous = rows.find((row) => row.id === saved.id);
  if (!previous) return summary;

  return {
    totalCentres: summary.totalCentres,
    activeCentres:
      summary.activeCentres + booleanDelta(previous.isActive, saved.isActive),
    linkedCentres:
      summary.linkedCentres +
      booleanDelta(previous.schoolId !== null, saved.schoolId !== null),
    physicalCentres:
      summary.physicalCentres + booleanDelta(previous.isPhysical, saved.isPhysical),
  };
}

function booleanDelta(previous: boolean, next: boolean): number {
  if (previous === next) return 0;
  return next ? 1 : -1;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs font-semibold uppercase text-gray-600">
      {label}
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs normal-case text-danger">{error}</p>}
    </label>
  );
}

function OptionSelectField({
  label,
  value,
  options,
  error,
  onChange,
}: {
  label: string;
  value: string;
  options: CentreOption[];
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} error={error}>
      <Select value={value} onChange={(event) => onChange(event.target.value)} className="w-full">
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
            {!option.isActive ? " (inactive)" : ""}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function BlankableCell({ value }: { value?: string | null }) {
  return (
    <td className="whitespace-nowrap border-b border-border px-3 py-3 text-text-secondary transition-colors group-hover:bg-[#fff3e9]">
      {value || <span className="text-text-muted/60">-</span>}
    </td>
  );
}

function OptionBadge({
  label,
  active,
}: {
  label?: string | null;
  active: boolean | null;
}) {
  if (!label) return <span className="text-text-muted/60">-</span>;
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
        active === false ? "bg-bg-card-alt text-text-muted" : "bg-brand-blue-bg text-accent-hover"
      }`}
    >
      {label}
    </span>
  );
}

function StatusDot({
  active,
  trueLabel,
  falseLabel,
}: {
  active: boolean;
  trueLabel: string;
  falseLabel: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        active ? "bg-success-bg text-success" : "bg-bg-card-alt text-text-muted"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-success" : "bg-text-muted"
        }`}
        aria-hidden="true"
      />
      {active ? trueLabel : falseLabel}
    </span>
  );
}

function appendFilterParams(params: URLSearchParams, filters: CentreListFilters) {
  if (filters.search) params.set("search", filters.search);
  if (filters.searchTerms.length > 0) {
    params.set("search_terms", JSON.stringify(filters.searchTerms));
  }
  if (filters.active !== "all") params.set("active", filters.active);
  if (filters.schoolLink !== "all") params.set("school_link", filters.schoolLink);
  if (filters.typeCode) params.set("type", filters.typeCode);
  if (filters.categoryCode) params.set("category", filters.categoryCode);
  if (filters.subCategoryCode) params.set("sub_category", filters.subCategoryCode);
  if (filters.streamCode) params.set("stream", filters.streamCode);
  if (filters.isPhysical !== "all") params.set("is_physical", filters.isPhysical);
}

function emptyForm(): CentreFormState {
  return {
    id: null,
    name: "",
    schoolId: null,
    schoolLabel: "",
    typeCode: "",
    categoryCode: "",
    subCategoryCode: "",
    streamCodes: [],
    isPhysical: false,
    isActive: true,
  };
}

function formToPayload(form: CentreFormState) {
  return {
    name: form.name,
    school_id: form.schoolId,
    type_code: form.typeCode || null,
    category_code: form.categoryCode || null,
    sub_category_code: form.subCategoryCode || null,
    stream_codes: form.streamCodes,
    is_physical: form.isPhysical,
    is_active: form.isActive,
  };
}

function selectOptions(params: {
  options: CentreOption[];
  currentCode?: string;
  currentCodes?: string[];
  includeInactiveCurrent: boolean;
}): CentreOption[] {
  const currentCodes = new Set(
    params.currentCodes ?? (params.currentCode ? [params.currentCode] : [])
  );
  return params.options.filter(
    (option) =>
      option.isActive ||
      (params.includeInactiveCurrent && currentCodes.has(option.code))
  );
}

function schoolLabel(row: CentreListRow): string {
  if (!row.school) return "";
  return `${row.school.name} (${row.school.code}${row.school.udiseCode ? ` / ${row.school.udiseCode}` : ""})`;
}

function schoolUdise(school: SchoolSearchResult): string {
  return String(school.udise_code ?? school.udiseCode ?? "");
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}
