"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Pencil, Search, Users, X } from "lucide-react";
import { Button, Card, Modal, Select } from "@/components/ui";
import AlumniForm, { type AlumniEntryRef } from "./AlumniForm";
import BulkEditPanel, { type BulkStudent } from "./BulkEditPanel";
import ReferencePicker from "./ReferencePicker";
import type { BulkResult } from "@/lib/alumni/bulk-types";
import { TABLE_FIELDS, type AlumniTableRow, type FieldFilter, type TableField, type TableSummary } from "@/lib/alumni/table-fields";

// The alumni team's "missing data" table: everyone who passed out from one
// school (school tab) or every school in scope (/alumni), with filters for
// what's filled or missing, summary counts, a download, and the record form
// one click away. Tick students to fill in the same answers for all of them
// at once (bulk edit), or pick a branch right in a row. Filters run on the server (/api/alumni/table), so counts,
// pages and the download always agree.

interface Props {
  /** Fixed school (the school's Alumni tab); omit for every school in scope. */
  schoolCode?: string;
  canEdit?: boolean;
}

interface Filters {
  year: string;
  record: "" | "added" | "not-added";
  school: string;
  q: string;
  fields: Partial<Record<TableField, FieldFilter>>;
}

interface TableData {
  rows: AlumniTableRow[];
  total: number;
  page: number;
  pageCount: number;
  summary: TableSummary;
  years: string[];
  schools: { code: string; name: string }[];
}

const NO_FILTERS: Filters = { year: "", record: "", school: "", q: "", fields: {} };

/** The query string the table and download routes read (see table-request.ts). */
export function tableQuery(filters: Filters, fixedSchool: string | undefined, page = 1): string {
  const p = new URLSearchParams();
  const school = fixedSchool ?? filters.school;
  if (school) p.set("school", school);
  if (filters.year) p.set("year", filters.year);
  if (filters.record) p.set("record", filters.record);
  if (filters.q.trim()) p.set("q", filters.q.trim());
  for (const [key, want] of Object.entries(filters.fields)) if (want) p.set(key, want);
  if (page > 1) p.set("page", String(page));
  return p.toString();
}

/** One page of the table, or why it couldn't load. */
async function fetchTable(query: string): Promise<{ ok: true; data: TableData } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/alumni/table?${query}`);
    const body = await res.json();
    return res.ok ? { ok: true, data: body } : { ok: false, error: body?.error || "Couldn't load the table." };
  } catch {
    return { ok: false, error: "Couldn't load the table." };
  }
}

/**
 * Loads a page; `reload` refetches (after a save). The search box waits for
 * typing to pause. `schools` is kept from the last load not narrowed to one
 * school, so the School filter keeps every choice.
 */
function useTableData(query: string) {
  const [data, setData] = useState<TableData | null>(null);
  const [schools, setSchools] = useState<TableData["schools"]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await fetchTable(query);
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        if (!new URLSearchParams(query).has("school")) setSchools(result.data.schools ?? []);
        setError("");
      } else {
        setError(result.error);
      }
      setLoading(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, version]);
  return { data, schools, error, loading, reload: () => setVersion((v) => v + 1) };
}

const rowKey = (r: { kind: string; id: string }) => `${r.kind}-${r.id}`;
const asStudent = (r: AlumniTableRow): BulkStudent => ({ kind: r.kind, id: r.id, name: r.name });

/** The ticked students, kept across pages and filter changes until cleared. */
function useSelection() {
  const [selected, setSelected] = useState<Map<string, BulkStudent>>(new Map());
  const update = (fn: (next: Map<string, BulkStudent>) => void) =>
    setSelected((prev) => {
      const next = new Map(prev);
      fn(next);
      return next;
    });
  return {
    selected,
    toggle: (s: BulkStudent) => update((m) => (m.has(rowKey(s)) ? m.delete(rowKey(s)) : m.set(rowKey(s), s))),
    setMany: (list: BulkStudent[], on: boolean) => update((m) => list.forEach((s) => (on ? m.set(rowKey(s), s) : m.delete(rowKey(s))))),
    replace: (list: BulkStudent[]) => setSelected(new Map(list.map((s) => [rowKey(s), s]))),
    clear: () => setSelected(new Map()),
  };
}

/** Filters and page; changing a filter goes back to page 1. */
function useFilters(schoolCode: string | undefined) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const query = useMemo(() => tableQuery(filters, schoolCode, page), [filters, schoolCode, page]);
  return {
    filters,
    query,
    setPage,
    /** The filters' query without the page (download, "select all"). */
    allPages: tableQuery(filters, schoolCode),
    change: (next: Partial<Filters>) => {
      setFilters((f) => ({ ...f, ...next }));
      setPage(1);
    },
  };
}

/** Ticks every student matching the filters (all pages). */
async function selectAllMatching(allPages: string, replace: (list: BulkStudent[]) => void) {
  try {
    const res = await fetch(`/api/alumni/table?${allPages}&refs=1`);
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error);
    replace(body.refs);
  } catch {
    toast.error("Couldn't select everyone. Try again.");
  }
}

export default function AlumniDataTable({ schoolCode, canEdit = true }: Props) {
  const view = useFilters(schoolCode);
  const [open, setOpen] = useState<AlumniEntryRef | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  /** A bulk check or save is running: its popup stays open. */
  const [bulkBusy, setBulkBusy] = useState(false);
  /** A bulk save happened: the selection clears when its popup closes (however it's closed). */
  const [bulkSaved, setBulkSaved] = useState(false);
  const selection = useSelection();
  const selectedStudents = useMemo(() => [...selection.selected.values()], [selection.selected]);
  const table = useTableData(view.query);
  const { data, reload } = table;

  const closeBulk = () => {
    if (bulkBusy) return;
    setBulkOpen(false);
    if (bulkSaved) selection.clear();
    setBulkSaved(false);
  };

  return (
    <div className="space-y-4">
      <FilterBar
        filters={view.filters}
        years={data?.years ?? []}
        schools={schoolCode ? [] : table.schools}
        onChange={view.change}
        downloadHref={`/api/alumni/table/export?${view.allPages}`}
      />
      {data && <SummaryChips summary={data.summary} filters={view.filters} onChange={view.change} />}
      {table.error && <p className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{table.error}</p>}
      <TableCard
        table={table}
        showSchool={!schoolCode}
        selection={canEdit ? selection : undefined}
        onSelectAll={() => selectAllMatching(view.allPages, selection.replace)}
        onEditSelected={() => setBulkOpen(true)}
        onOpen={setOpen}
        onPage={view.setPage}
      />
      <ClosableModal open={open !== null} onClose={() => setOpen(null)}>
        {open && <AlumniForm entry={open} canEdit={canEdit} onSaved={reload} />}
      </ClosableModal>
      <ClosableModal open={bulkOpen} onClose={closeBulk} locked={bulkBusy}>
        {bulkOpen && (
          <BulkEditPanel
            students={selectedStudents}
            onBusyChange={setBulkBusy}
            onSaved={() => {
              setBulkSaved(true);
              reload();
            }}
            onDone={closeBulk}
          />
        )}
      </ClosableModal>
    </div>
  );
}

/** The rows: count, the selection bar (people who can edit), the table and its pages. */
function TableCard({ table, showSchool, selection, onSelectAll, onEditSelected, onOpen, onPage }: {
  table: ReturnType<typeof useTableData>;
  showSchool: boolean;
  /** Absent for view-only access: no ticking. */
  selection?: ReturnType<typeof useSelection>;
  onSelectAll: () => void;
  onEditSelected: () => void;
  onOpen: (ref: AlumniEntryRef) => void;
  onPage: (page: number) => void;
}) {
  const { data } = table;
  return (
    <Card elevation="sm" className="overflow-hidden rounded-xl">
      <TableHeaderRow total={data?.total} loading={table.loading} />
      {selection && (
        <SelectionBar
          count={selection.selected.size}
          total={data?.total ?? 0}
          onSelectAll={onSelectAll}
          onClear={selection.clear}
          onEdit={onEditSelected}
        />
      )}
      <RowsTable rows={data?.rows ?? []} showSchool={showSchool} onOpen={onOpen} select={selection} onSaved={table.reload} />
      {data && data.pageCount > 1 && <Pager page={data.page} pageCount={data.pageCount} onPage={onPage} />}
    </Card>
  );
}

/** A wide modal with a close button in its corner; `locked` (work running) keeps it open. */
function ClosableModal({ open, onClose, locked = false, children }: {
  open: boolean;
  onClose: () => void;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Modal open={open} onClose={locked ? undefined : onClose} className="max-w-4xl p-6">
      {open && (
        <>
          {!locked && (
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded p-1 text-text-muted hover:bg-hover-bg">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
          {children}
        </>
      )}
    </Modal>
  );
}

const FIELD_OPTIONS: [FieldFilter | "", string][] = [["", "Any"], ["missing", "Missing"], ["filled", "Filled"]];

function FilterBar({ filters, years, schools, onChange, downloadHref }: {
  filters: Filters;
  years: string[];
  schools: { code: string; name: string }[];
  onChange: (next: Partial<Filters>) => void;
  downloadHref: string;
}) {
  return (
    <Card elevation="sm" className="space-y-3 rounded-xl p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            type="search"
            value={filters.q}
            maxLength={100}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Name or AFID"
            aria-label="Search by name or AFID"
            className="w-full rounded-md border border-border bg-bg-card py-2 pl-9 pr-3 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <LabeledSelect label="Pass-out year" value={filters.year} onChange={(year) => onChange({ year })}
          options={[["", "All years"], ...years.map((y): [string, string] => [y, y])]} />
        <LabeledSelect label="Record" value={filters.record} onChange={(record) => onChange({ record: record as Filters["record"] })}
          options={[["", "Everyone"], ["not-added", "Not added yet"], ["added", "Added"]]} />
        {schools.length > 1 && (
          <LabeledSelect label="School" value={filters.school} onChange={(school) => onChange({ school })}
            options={[["", "All schools"], ...schools.map((s): [string, string] => [s.code, s.name])]} />
        )}
        <a href={downloadHref} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-hover-bg">
          <Download className="h-4 w-4" aria-hidden /> Download Excel
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {TABLE_FIELDS.map((f) => (
          <LabeledSelect key={f.key} label={f.label} value={filters.fields[f.key] ?? ""} options={FIELD_OPTIONS}
            onChange={(want) => onChange({ fields: { ...filters.fields, [f.key]: (want || undefined) as FieldFilter | undefined } })} />
        ))}
      </div>
    </Card>
  );
}

function LabeledSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-[140px] text-xs font-medium uppercase tracking-wide text-text-muted">
      {label}
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 normal-case tracking-normal">
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </Select>
    </label>
  );
}

/** Totals for the filtered year/record/school/search; each chip applies its filter. */
function SummaryChips({ summary, filters, onChange }: {
  summary: TableSummary;
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
}) {
  const chip = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-text-primary">{summary.total.toLocaleString()} people</span>
      <button type="button" onClick={() => onChange({ record: filters.record === "not-added" ? "" : "not-added" })}
        className={`${chip} ${filters.record === "not-added" ? "border-brand-coral bg-brand-coral-bg text-brand-coral" : "border-border text-text-secondary hover:bg-hover-bg"}`}>
        {summary.notAdded.toLocaleString()} not added yet
      </button>
      {TABLE_FIELDS.map((f) => {
        const active = filters.fields[f.key] === "missing";
        const next = { ...filters.fields, [f.key]: active ? undefined : "missing" as const };
        return (
          <button key={f.key} type="button" onClick={() => onChange({ fields: next })}
            className={`${chip} ${active ? "border-accent bg-hover-bg text-text-primary" : "border-border text-text-secondary hover:bg-hover-bg"}`}>
            {summary.missing[f.key].toLocaleString()} missing {chipLabel(f.label)}
          </button>
        );
      })}
    </div>
  );
}

/** "College" → "college", but "UG status" keeps its acronym. */
const chipLabel = (label: string) => (/^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

function TableHeaderRow({ total, loading }: { total?: number; loading: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-text-muted">
      <span>{total === undefined ? "" : `${total.toLocaleString()} matching`}</span>
      {loading && <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…</span>}
    </div>
  );
}

const SHORT_LABEL: Partial<Record<TableField, string>> = { contact_status: "Contact", current_status: "Current", ug_status: "UG" };

/** Ticking rows (people who can edit). */
interface RowSelect {
  selected: Map<string, BulkStudent>;
  toggle: (s: BulkStudent) => void;
  setMany: (list: BulkStudent[], on: boolean) => void;
}

/** "12 selected · Select all 340 matching · Clear · Edit selected". */
function SelectionBar({ count, total, onSelectAll, onClear, onEdit }: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onEdit: () => void;
}) {
  if (!count) {
    return (
      <p className="border-b border-border bg-bg-card-alt/40 px-4 py-2 text-xs text-text-muted">
        Tick students to fill in the same answers for all of them at once.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-brand-coral-bg/40 px-4 py-2 text-sm">
      <span className="font-semibold text-text-primary">{count.toLocaleString()} selected</span>
      {count < total && (
        <button type="button" onClick={onSelectAll} className="text-accent hover:underline">
          Select all {total.toLocaleString()} matching
        </button>
      )}
      <button type="button" onClick={onClear} className="text-text-muted hover:underline">Clear</button>
      <Button type="button" size="sm" onClick={onEdit} className="ml-auto">
        <Users className="h-4 w-4" aria-hidden /> Edit {count.toLocaleString()} selected
      </Button>
    </div>
  );
}

function RowsTable({ rows, showSchool, onOpen, select, onSaved }: {
  rows: AlumniTableRow[];
  showSchool: boolean;
  onOpen: (ref: AlumniEntryRef) => void;
  select?: RowSelect;
  onSaved: () => void;
}) {
  if (!rows.length) return <p className="px-4 py-10 text-center text-sm text-text-muted">No one matches these filters.</p>;
  const allTicked = !!select && rows.every((r) => select.selected.has(rowKey(r)));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-bg-card-alt text-xs uppercase tracking-wide text-text-muted">
          <tr>
            {select && (
              <th className="w-8 pl-4 pr-1">
                <input type="checkbox" aria-label="Select this page" checked={allTicked}
                  onChange={(e) => select.setMany(rows.map(asStudent), e.target.checked)} />
              </th>
            )}
            <th className="px-4 py-2 font-semibold">Name</th>
            {showSchool && <th className="px-3 py-2 font-semibold">School</th>}
            <th className="px-3 py-2 font-semibold">Year</th>
            <th className="px-3 py-2 font-semibold">Record</th>
            {TABLE_FIELDS.map((f) => <th key={f.key} className="whitespace-nowrap px-2 py-2 font-semibold">{SHORT_LABEL[f.key] ?? f.label}</th>)}
            <th className="px-3 py-2 font-semibold">Filled</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <DataRow key={rowKey(r)} row={r} showSchool={showSchool} onOpen={onOpen} select={select} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataRow({ row, showSchool, onOpen, select, onSaved }: {
  row: AlumniTableRow;
  showSchool: boolean;
  onOpen: (ref: AlumniEntryRef) => void;
  select?: RowSelect;
  onSaved: () => void;
}) {
  const open = () => onOpen({ kind: row.kind === "alumnus" ? "alumnus" : "pass-out", id: row.id });
  const ticked = select?.selected.has(rowKey(row)) ?? false;
  return (
    <tr onClick={open} className={`cursor-pointer hover:bg-hover-bg ${ticked ? "bg-brand-coral-bg/30" : ""}`}>
      {select && (
        <td className="w-8 pl-4 pr-1" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" aria-label={`Select ${row.name}`} checked={ticked} onChange={() => select.toggle(asStudent(row))} />
        </td>
      )}
      <td className="px-4 py-2">
        <button type="button" onClick={open} className="text-left font-medium text-text-primary hover:underline">{row.name}</button>
        <div className="font-mono text-[11px] text-text-muted">{row.afid || "no AFID"}</div>
      </td>
      {showSchool && <td className="px-3 py-2 text-text-secondary">{row.schoolName || "No school on record"}</td>}
      <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{row.cohortYear || "—"}</td>
      <td className="px-3 py-2">
        {row.kind === "alumnus"
          ? <span className="whitespace-nowrap rounded-full bg-brand-gold-bg px-2 py-0.5 text-xs text-text-primary">Added</span>
          : <span className="whitespace-nowrap rounded-full bg-brand-coral-bg px-2 py-0.5 text-xs text-brand-coral">Not added</span>}
      </td>
      {TABLE_FIELDS.map((f) => (
        <td key={f.key} className="max-w-[150px] truncate px-2 py-2 text-xs text-text-secondary" title={row.values[f.key]}>
          {f.key === "branch_id_ug" && select ? (
            <BranchCell row={row} onSaved={onSaved} />
          ) : (
            <FieldCell value={row.values[f.key]} missing={row.missing.includes(f.key)} />
          )}
        </td>
      ))}
      <td className="px-3 py-2"><FilledBar pct={row.filledPct} /></td>
    </tr>
  );
}

/** A value; a red dash when it applies but is blank; a grey n/a when it doesn't apply (e.g. College in a gap year). */
function FieldCell({ value, missing }: { value: string; missing: boolean }) {
  if (value) return <>{value}</>;
  if (missing) return <span className="text-danger/70" title="Missing">—</span>;
  return <span className="text-text-muted/60" title="Doesn't apply">n/a</span>;
}

/** Saves one field for one student, through the bulk route (same checks, replaces what's there). */
async function saveOneField(row: AlumniTableRow, column: string, value: string): Promise<BulkResult | null> {
  try {
    const res = await fetch("/api/alumni/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: [{ kind: row.kind, id: row.id }], values: { [column]: value }, overwrite: true, dryRun: false }),
    });
    const body = await res.json();
    if (res.ok) return body.results?.[0] ?? null;
    return { target: row, name: row.name, result: "error", message: body?.error, changed: [], kept: [] };
  } catch {
    return null;
  }
}

/**
 * The branch, with a pencil to pick it right here: branches differ even
 * within one college, so bulk edit leaves them to this. Only where a branch
 * applies (UG status says they're in college).
 */
function BranchCell({ row, onSaved }: { row: AlumniTableRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const value = row.values.branch_id_ug;
  const missing = row.missing.includes("branch_id_ug");
  if (!value && !missing) return <FieldCell value="" missing={false} />;

  const pick = async (code: string) => {
    if (!code) return;
    setSaving(true);
    const result = await saveOneField(row, "branch_id_ug", code);
    setSaving(false);
    if (result?.result === "create" || result?.result === "update") {
      toast.success(`Branch saved: ${row.name}`);
      setEditing(false);
      onSaved();
    } else {
      toast.error(`Branch not saved: ${row.name}`, { description: result?.message || "Open the record to fix it.", duration: 8000 });
    }
  };

  if (editing) {
    return (
      <div className="w-64 whitespace-normal" onClick={(e) => e.stopPropagation()}>
        {saving ? (
          <span className="inline-flex items-center gap-1 text-text-muted"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…</span>
        ) : (
          <>
            <ReferencePicker kind="branch" id={`branch-${row.id}`} code="" name="" onChange={(code) => pick(code)} />
            <button type="button" onClick={() => setEditing(false)} className="mt-1 text-[11px] text-text-muted hover:underline">Cancel</button>
          </>
        )}
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <FieldCell value={value} missing={missing} />
      <button type="button" aria-label={`Pick branch for ${row.name}`} title="Pick branch"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className="rounded p-0.5 text-text-muted hover:bg-hover-bg hover:text-accent">
        <Pencil className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

function FilledBar({ pct }: { pct: number }) {
  const tone = pct >= 75 ? "bg-success" : pct >= 40 ? "bg-brand-gold" : "bg-brand-coral";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-bg-card-alt">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-xs text-text-muted">{pct}%</span>
    </div>
  );
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm">
      <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="text-text-muted">Page {page} of {pageCount}</span>
      <Button type="button" variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}
