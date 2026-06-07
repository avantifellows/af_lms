"use client";

import { useMemo, useState } from "react";
import { Edit2, Plus, RotateCcw, Search, X } from "lucide-react";

import { Button, Input, Select } from "@/components/ui";
import type {
  CentreBooleanFilter,
  CentreListFilters,
  CentreListRow,
  CentreOption,
  CentreOptionSet,
  CentreOptionSetCode,
  CentreSchoolLinkFilter,
} from "@/lib/centres";

interface CentreGridProps {
  initialRows: CentreListRow[];
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
  initialFilters,
  initialPagination,
  optionSets,
}: CentreGridProps) {
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState<CentreListFilters>(initialFilters);
  const [pagination, setPagination] = useState(initialPagination);
  const [loading, setLoading] = useState(false);
  const [tableError, setTableError] = useState("");
  const [modal, setModal] = useState<{ mode: EditMode; form: CentreFormState } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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

  const applyFilters = async (nextFilters = filters) => {
    setLoading(true);
    setTableError("");

    try {
      const params = new URLSearchParams();
      appendFilterParams(params, nextFilters);
      params.set("page", "1");
      params.set("limit", String(pagination.limit));
      const response = await fetch(`/api/admin/centres?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load Centres");
      }
      setRows(data.rows ?? []);
      setPagination(data.pagination ?? pagination);
      setFilters(data.filters ?? nextFilters);
    } catch (error) {
      setTableError(error instanceof Error ? error.message : "Failed to load Centres");
    } finally {
      setLoading(false);
    }
  };

  const resetFilters = async () => {
    setFilters(EMPTY_FILTERS);
    await applyFilters(EMPTY_FILTERS);
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

  const searchSchools = async () => {
    const query = schoolSearch.trim();
    if (!query) {
      setSchoolResults([]);
      return;
    }
    setSchoolSearching(true);
    try {
      const response = await fetch(`/api/admin/schools?q=${encodeURIComponent(query)}`);
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

  const activeRows = rows.filter((row) => row.isActive).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-bold uppercase text-text-primary">Centres</h2>
          <p className="text-xs font-mono text-text-muted">
            {pagination.totalRows} rows · {activeRows} active on this page
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Centre
        </Button>
      </div>

      <div className="grid gap-3 rounded-md border border-border bg-bg-card p-3 md:grid-cols-[minmax(220px,1fr)_repeat(6,minmax(130px,auto))_auto]">
        <label className="text-xs font-semibold uppercase text-text-muted">
          Search
          <Input
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="Centre, School, code, UDISE"
            className="mt-1"
          />
        </label>
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
        <div className="flex items-end gap-2">
          <Button size="sm" onClick={() => applyFilters()} disabled={loading}>
            <Search className="h-4 w-4" aria-hidden="true" />
            {loading ? "Loading" : "Apply"}
          </Button>
          <Button size="sm" variant="secondary" onClick={resetFilters} disabled={loading} aria-label="Reset filters">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {tableError && (
        <div className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          {tableError}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border bg-white shadow-sm">
        <table className="min-w-[1320px] divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
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
                "Category",
                "Sub-category",
                "Centre Streams",
                "Physical",
                "Active",
                "Updated",
                "Actions",
              ].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-left text-xs font-bold uppercase text-gray-600"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-3 py-10 text-center text-sm text-text-muted">
                  No Centres match the current filters
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="max-w-[220px] px-3 py-2 font-semibold text-gray-900">
                    {row.name}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.school ? row.school.name : <span className="text-gray-400">Unlinked</span>}
                  </td>
                  <BlankableCell value={row.school?.code} />
                  <BlankableCell value={row.school?.udiseCode} />
                  <BlankableCell value={row.school?.region} />
                  <BlankableCell value={row.school?.state} />
                  <BlankableCell value={row.school?.district} />
                  <td className="px-3 py-2">
                    <OptionBadge label={row.typeLabel ?? row.typeCode} active={row.typeOptionActive} />
                  </td>
                  <td className="px-3 py-2">
                    <OptionBadge label={row.categoryLabel ?? row.categoryCode} active={row.categoryOptionActive} />
                  </td>
                  <td className="px-3 py-2">
                    <OptionBadge
                      label={row.subCategoryLabel ?? row.subCategoryCode}
                      active={row.subCategoryOptionActive}
                    />
                  </td>
                  <td className="px-3 py-2">
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
                      <span className="text-gray-400">No streams</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill active={row.isPhysical} trueLabel="Physical" falseLabel="Non-physical" />
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill active={row.isActive} trueLabel="Active" falseLabel="Inactive" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
                    {formatDate(row.updatedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                      <Edit2 className="h-4 w-4" aria-hidden="true" />
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
      {value || <span className="text-gray-400">-</span>}
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
  if (!label) return <span className="text-gray-400">-</span>;
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
        active === false ? "bg-gray-100 text-gray-500" : "bg-blue-50 text-blue-700"
      }`}
    >
      {label}
    </span>
  );
}

function StatusPill({
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
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
        active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
      }`}
    >
      {active ? trueLabel : falseLabel}
    </span>
  );
}

function appendFilterParams(params: URLSearchParams, filters: CentreListFilters) {
  if (filters.search) params.set("search", filters.search);
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
