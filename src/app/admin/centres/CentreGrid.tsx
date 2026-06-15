"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Edit2,
  Link2,
  Plus,
  RotateCcw,
  Save,
  Search,
  School,
  SlidersHorizontal,
  X,
} from "lucide-react";

import StatCard from "@/components/StatCard";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { DetailField } from "@/components/ui/DetailField";
import { DetailGroup } from "@/components/ui/DetailGroup";
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
  ProgramOption,
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
  programId: number | null;
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
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [searchSuggestions, setSearchSuggestions] = useState<CentreSearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [searchingSuggestions, setSearchingSuggestions] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [schoolResults, setSchoolResults] = useState<SchoolSearchResult[]>([]);
  const [schoolSuggestionsOpen, setSchoolSuggestionsOpen] = useState(false);
  const [schoolSearching, setSchoolSearching] = useState(false);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const modalOpen = modal !== null;

  useEffect(() => {
    let active = true;
    fetch("/api/admin/programs")
      .then((response) => response.json())
      .then((data) => {
        if (active && Array.isArray(data.programs)) setPrograms(data.programs);
      })
      .catch(() => {
        /* program selector falls back to "None" only */
      });
    return () => {
      active = false;
    };
  }, []);

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

  useEffect(() => {
    const query = schoolSearch.trim();
    if (!modalOpen || query.length < 2) {
      setSchoolResults([]);
      setSchoolSuggestionsOpen(false);
      setSchoolSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSchoolSearching(true);
      try {
        const response = await fetch(
          `/api/admin/schools?scope=centres&q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to search Schools");
        setSchoolResults(Array.isArray(data) ? data : []);
        setSchoolSuggestionsOpen(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSchoolResults([]);
        setSchoolSuggestionsOpen(false);
        setSaveError(error instanceof Error ? error.message : "Failed to search Schools");
      } finally {
        if (!controller.signal.aborted) {
          setSchoolSearching(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [schoolSearch, modalOpen]);

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
      syncCentreGridUrl(data.filters ?? nextFilters, data.pagination?.page ?? page);
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

  const toggleExpanded = (id: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const goToPage = async (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), Math.max(pagination.totalPages, 1));
    if (nextPage === pagination.page) return;
    await applyFilters(filters, nextPage);
  };

  const openCreate = () => {
    setModal({ mode: "create", form: emptyForm() });
    setSchoolSearch("");
    setSchoolResults([]);
    setSchoolSuggestionsOpen(false);
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
        programId: row.programId,
      },
    });
    setSchoolSearch("");
    setSchoolResults([]);
    setSchoolSuggestionsOpen(false);
    resetSaveState();
  };

  const closeModal = () => {
    setModal(null);
    setSchoolSearch("");
    setSchoolResults([]);
    setSchoolSuggestionsOpen(false);
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

  const chooseSchool = (school: SchoolSearchResult) => {
    patchForm({
      schoolId: school.id,
      schoolLabel: `${school.name} (${school.code}${schoolUdise(school) ? ` / ${schoolUdise(school)}` : ""})`,
    });
    setSchoolSearch("");
    setSchoolResults([]);
    setSchoolSuggestionsOpen(false);
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
            Manage Centre records and their School links.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Centre
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Centres" value={summary.totalCentres} size="sm" />
        <StatCard label="Active Centres" value={summary.activeCentres} size="sm" />
        <StatCard label="Centres linked to Schools" value={summary.linkedCentres} size="sm" />
        <StatCard label="Total Physical Centres" value={summary.physicalCentres} size="sm" />
      </div>

      <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase text-text-primary">
          <SlidersHorizontal className="h-4 w-4 text-accent" aria-hidden="true" />
          Filters
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="text-xs font-semibold uppercase text-text-muted sm:col-span-2">
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
          <div className="flex items-end gap-2 pb-0.5">
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

      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-text-secondary">
            Viewing <span className="font-semibold text-text-primary">{pageStart}</span>-
            <span className="font-semibold text-text-primary">{pageEnd}</span> of{" "}
            <span className="font-semibold text-text-primary">{pagination.totalRows}</span> Centres
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-success-bg px-2.5 py-1 font-semibold text-success">
              {visibleLinkedRows} linked
            </span>
            <span className="rounded-full bg-warning-bg px-2.5 py-1 font-semibold text-warning-text">
              {rows.length - visibleLinkedRows} unlinked
            </span>
          </div>
        </div>

        {rows.length === 0 ? (
          <Card elevation="sm" className="p-8 text-center text-sm text-text-muted">
            No Centres match the current filters
          </Card>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <CentreCard
                key={row.id}
                row={row}
                expanded={expandedIds.has(row.id)}
                onToggle={() => toggleExpanded(row.id)}
                onEdit={() => openEdit(row)}
              />
            ))}
          </ul>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div
          className="flex flex-col gap-3 rounded-md border border-border bg-bg-card px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
          aria-label="Centre pagination"
        >
          <p className="text-text-secondary">
            Showing <span className="font-semibold text-text-primary">{pageStart}</span>-
            <span className="font-semibold text-text-primary">{pageEnd}</span> of{" "}
            <span className="font-semibold text-text-primary">{pagination.totalRows}</span>
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
            <span className="min-w-28 text-center text-xs font-semibold uppercase text-text-secondary">
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
          <div className="fixed inset-0 bg-text-primary/35" onClick={closeModal} aria-hidden="true" />
          <div className="flex min-h-full items-center justify-center p-3 sm:p-6">
            <div
              className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-bg-card shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="centre-form-title"
            >
              <div className="flex items-start justify-between gap-4 border-b border-border bg-bg-card px-5 py-4">
                <div className="min-w-0">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-bg-card-alt px-2.5 py-1 text-xs font-semibold uppercase text-text-muted">
                    <Building2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    Centre record
                  </div>
                  <h3
                    id="centre-form-title"
                    className="text-lg font-bold uppercase text-text-primary"
                  >
                    {modal.mode === "create" ? "New Centre" : "Edit Centre"}
                  </h3>
                  <p className="mt-1 text-sm text-text-muted">
                    {modal.form.schoolLabel || "No School linked"}
                  </p>
                </div>
                <Button variant="icon" aria-label="Close Centre form" onClick={closeModal}>
                  <X className="h-5 w-5" aria-hidden="true" />
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {saveError && (
                  <div className="mb-4 rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
                    {saveError}
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-bg-card px-4 py-4">
                      <div className="mb-4 flex items-center gap-2 text-sm font-bold uppercase text-text-primary">
                        <Building2 className="h-4 w-4 text-accent" aria-hidden="true" />
                        Centre details
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Centre name" error={fieldErrors.name} className="md:col-span-2">
                          <Input
                            value={modal.form.name}
                            onChange={(event) => patchForm({ name: event.target.value })}
                          />
                        </Field>

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
                        <Field label="Program" error={fieldErrors.program_id}>
                          <Select
                            value={
                              modal.form.programId === null
                                ? ""
                                : String(modal.form.programId)
                            }
                            onChange={(event) =>
                              patchForm({
                                programId:
                                  event.target.value === ""
                                    ? null
                                    : Number(event.target.value),
                              })
                            }
                            className="w-full"
                          >
                            <option value="">None</option>
                            {programs.map((program) => (
                              <option key={program.id} value={program.id}>
                                {program.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-bg-card px-4 py-4">
                      <div className="mb-4 flex items-center gap-2 text-sm font-bold uppercase text-text-primary">
                        <Link2 className="h-4 w-4 text-accent" aria-hidden="true" />
                        Centre streams
                      </div>
                      <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border border-border bg-bg-input p-3 sm:grid-cols-2">
                        {selectOptions({
                          options: optionsBySet.get("stream") ?? [],
                          currentCodes: modal.form.streamCodes,
                          includeInactiveCurrent: modal.mode === "edit",
                        }).map((option) => (
                          <label
                            key={option.code}
                            className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-text-primary hover:bg-hover-bg"
                          >
                            <input
                              type="checkbox"
                              checked={modal.form.streamCodes.includes(option.code)}
                              onChange={() => toggleStream(option.code)}
                              className="h-4 w-4 accent-[var(--color-accent)]"
                            />
                            <span>{option.label}</span>
                            {!option.isActive && (
                              <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-text">
                                inactive
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                      {fieldErrors.stream_codes && (
                        <p className="mt-1 text-xs text-danger">{fieldErrors.stream_codes}</p>
                      )}
                    </div>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-lg border border-border bg-bg-card px-4 py-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-bold uppercase text-text-primary">
                          <School className="h-4 w-4 text-accent" aria-hidden="true" />
                          Linked School
                        </div>
                        {modal.form.schoolId ? (
                          <span className="rounded-full bg-success-bg px-2.5 py-1 text-xs font-semibold text-success">
                            Linked
                          </span>
                        ) : (
                          <span className="rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning-text">
                            Unlinked
                          </span>
                        )}
                      </div>

                      <div className="mb-3 rounded-lg border border-border bg-bg-card-alt px-3 py-3">
                        <div className="text-xs font-semibold uppercase text-text-muted">Current School</div>
                        <div className="mt-1 min-h-6 text-sm font-semibold text-text-primary">
                          {modal.form.schoolLabel || (
                            <span className="font-normal text-text-muted">Unlinked</span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="relative">
                          <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
                            aria-hidden="true"
                          />
                          <Input
                            value={schoolSearch}
                            onChange={(event) => {
                              setSchoolSearch(event.target.value);
                              setSchoolSuggestionsOpen(true);
                            }}
                            onFocus={() => {
                              if (schoolSearch.trim().length >= 2) {
                                setSchoolSuggestionsOpen(true);
                              }
                            }}
                            placeholder="Search name, code, UDISE"
                            className="pl-9"
                          />
                          {schoolSuggestionsOpen &&
                            schoolSearch.trim().length >= 2 &&
                            (schoolResults.length > 0 || schoolSearching) && (
                              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-border bg-bg-card shadow-xl">
                                <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase text-text-muted">
                                  {schoolSearching ? "Searching" : "Best matches"}
                                </div>
                                <div className="max-h-60 overflow-y-auto">
                                  {schoolResults.map((school) => (
                                    <button
                                      key={school.id}
                                      type="button"
                                      className="flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-hover-bg"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => chooseSchool(school)}
                                    >
                                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hover-bg text-accent">
                                        <School className="h-4 w-4" aria-hidden="true" />
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate font-semibold text-text-primary">
                                          {school.name}
                                        </span>
                                        <span className="mt-0.5 block truncate font-mono text-xs text-text-muted">
                                          {school.code}
                                          {schoolUdise(school) ? ` / ${schoolUdise(school)}` : ""}
                                        </span>
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                        </div>
                        <Button
                          type="button"
                          size="md"
                          variant="secondary"
                          onClick={() => {
                            patchForm({ schoolId: null, schoolLabel: "" });
                            setSchoolSearch("");
                            setSchoolResults([]);
                            setSchoolSuggestionsOpen(false);
                          }}
                          className="w-full"
                        >
                          <CircleOff className="h-4 w-4" aria-hidden="true" />
                          Unlink
                        </Button>
                        {schoolSearching && (
                          <div className="text-xs font-semibold uppercase text-text-muted">
                            Searching Schools
                          </div>
                        )}
                        {schoolSuggestionsOpen &&
                          schoolSearch.trim().length >= 2 &&
                          !schoolSearching &&
                          schoolResults.length === 0 && (
                            <div className="rounded-lg border border-border bg-bg-card-alt px-3 py-2 text-sm text-text-muted">
                              No matching Schools found
                            </div>
                          )}
                        </div>
                      {fieldErrors.school_id && (
                        <p className="mt-1 text-xs text-danger">{fieldErrors.school_id}</p>
                      )}
                    </div>

                    <div className="rounded-lg border border-border bg-bg-card px-4 py-4">
                      <div className="mb-3 text-sm font-bold uppercase text-text-primary">
                        Status
                      </div>
                      <div className="grid gap-2">
                        <ToggleField
                          label="Physical Centre"
                          checked={modal.form.isPhysical}
                          onChange={(isPhysical) => patchForm({ isPhysical })}
                        />
                        <ToggleField
                          label="Active Centre"
                          checked={modal.form.isActive}
                          onChange={(isActive) => patchForm({ isActive })}
                        />
                      </div>
                    </div>
                  </aside>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-border bg-bg-card-alt px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
                <Button variant="secondary" onClick={closeModal} disabled={saving}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Cancel
                </Button>
                <Button onClick={saveCentre} disabled={saving} className="min-w-36">
                  <Save className="h-4 w-4" aria-hidden="true" />
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
  className = "",
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`text-xs font-semibold uppercase text-text-muted ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs normal-case text-danger">{error}</p>}
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-bg-input px-3 text-sm font-semibold text-text-primary hover:bg-hover-bg">
      <span>{label}</span>
      <span className="inline-flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            checked ? "bg-success-bg text-success" : "bg-bg-card-alt text-text-muted"
          }`}
        >
          {checked ? "Yes" : "No"}
        </span>
        <input
          type="checkbox"
          checked={checked}
          aria-label={label}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
      </span>
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

function CentreCard({
  row,
  expanded,
  onToggle,
  onEdit,
}: {
  row: CentreListRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    <li>
      <Card elevation="md" className="overflow-hidden">
        <div className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-text-primary">{row.name}</h3>
                <Badge variant={row.isActive ? "success" : "default"}>
                  {row.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant={row.isPhysical ? "info" : "default"}>
                  {row.isPhysical ? "Physical" : "Non-physical"}
                </Badge>
              </div>
            </div>
            <Button
              variant="icon"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} details for ${row.name}`}
              className="shrink-0"
            >
              <ChevronDown
                className={`h-5 w-5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text-secondary">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">School:</span>
              {row.school ? (
                <span className="font-medium text-text-primary">{row.school.name}</span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning-text">
                  <CircleOff className="h-3 w-3" aria-hidden="true" />
                  Unlinked
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">Type:</span>
              <OptionBadge label={row.typeLabel ?? row.typeCode} active={row.typeOptionActive} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">Category:</span>
              <OptionBadge
                label={row.categoryLabel ?? row.categoryCode}
                active={row.categoryOptionActive}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">Sub-category:</span>
              <OptionBadge
                label={row.subCategoryLabel ?? row.subCategoryCode}
                active={row.subCategoryOptionActive}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">Program:</span>
              {row.programName ? (
                <span className="font-medium text-text-primary">{row.programName}</span>
              ) : (
                <span className="text-text-muted/60">None</span>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Edit2 className="h-4 w-4" aria-hidden="true" />
              Edit
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="space-y-3 border-t border-border bg-bg-card-alt px-4 pb-4 pt-4">
            {row.school ? (
              <DetailGroup title="Linked School" columns={3}>
                <DetailField label="School Name" value={row.school.name} />
                <DetailField label="School Code" value={row.school.code} />
                <DetailField label="UDISE" value={row.school.udiseCode} />
                <DetailField label="Region" value={row.school.region} />
                <DetailField label="State" value={row.school.state} />
                <DetailField label="District" value={row.school.district} />
              </DetailGroup>
            ) : (
              <div className="rounded-lg border border-border bg-bg-card px-4 py-3 text-sm text-text-muted shadow-sm">
                No School linked to this Centre
              </div>
            )}
            <DetailGroup title="Centre Details" columns={3}>
              <div className="col-span-2">
                <DetailField label="Centre Streams">
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
                </DetailField>
              </div>
              <DetailField label="Program" value={row.programName ?? "None"} />
              <DetailField label="Updated">
                <span className="font-mono text-xs text-text-muted">
                  {formatDate(row.updatedAt)}
                </span>
              </DetailField>
            </DetailGroup>
          </div>
        )}
      </Card>
    </li>
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

function syncCentreGridUrl(filters: CentreListFilters, page: number) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  appendFilterParams(params, filters);
  if (page > 1) params.set("page", String(page));

  const queryString = params.toString();
  const nextUrl = queryString ? `/admin/centres?${queryString}` : "/admin/centres";
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (currentUrl !== nextUrl) {
    window.history.pushState(null, "", nextUrl);
  }
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
    programId: null,
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
    program_id: form.programId,
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
