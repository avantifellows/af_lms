"use client";

import {
  useId,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Download, Plus, RotateCcw, Upload, XCircle } from "lucide-react";

import Toast from "@/components/Toast";
import { Badge, Button, Card, Input, Modal } from "@/components/ui";
import type { AcademicMentorshipMappingGroup } from "@/lib/academic-mentorship";
import { parseCsvText } from "@/lib/csv-parser";

type MappingGroup = AcademicMentorshipMappingGroup;
type Mapping = MappingGroup["mappings"][number];
type ToastState = { variant: "success" | "error"; message: string } | null;
type StateSetter<T> = Dispatch<SetStateAction<T>>;

type MentorOption = {
  userId: number;
  name: string;
  email: string;
};

type MenteeOption = {
  studentPkId: number;
  name: string;
  studentId: string | null;
  grade: number | null;
};

type ReassigningState = {
  mappingId: number | string;
  currentMentorUserId: number;
  menteeName: string;
} | null;
type CsvUploadRow = { mentor_email: string; student_id: string };
type CsvUploadError = { rowNumber: number; field: string; error: string };

interface AcademicMentorshipManagerProps {
  schoolCode: string;
  academicYear: string;
  programId: number | null;
  includeHistory: boolean;
  canEdit: boolean;
  canUpload: boolean;
  initialGroups: MappingGroup[];
}

interface MappingControls {
  canEdit: boolean;
  busy: boolean;
  onStartReassign: (mapping: Mapping, currentMentorUserId: number) => void;
  onRemove: (mappingId: number | string) => void;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return fallback;
  return typeof payload.error === "string" && payload.error.trim() ? payload.error : fallback;
}

function payloadErrorCsv(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("errorCsv" in payload)) return null;
  return typeof payload.errorCsv === "string" ? payload.errorCsv : null;
}

function valueAsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string") ?? "";
}

function csvUploadError(error: unknown): CsvUploadError | null {
  const row = valueAsRecord(error);
  if (!row) return null;

  const rowNumber = Number(row.rowNumber ?? row.row);
  const message = firstString(row.error, row.message);
  if (!Number.isFinite(rowNumber) || !message) return null;

  return {
    rowNumber,
    field: firstString(row.field) || "-",
    error: message,
  };
}

function payloadCsvErrors(payload: unknown): CsvUploadError[] {
  if (!payload || typeof payload !== "object" || !("errors" in payload)) return [];
  const { errors } = payload as { errors?: unknown };
  if (!Array.isArray(errors)) return [];
  return errors.map(csvUploadError).filter((error): error is CsvUploadError => Boolean(error));
}

function payloadInsertedCount(payload: unknown): number {
  if (!payload || typeof payload !== "object" || !("insertedCount" in payload)) return 0;
  return typeof payload.insertedCount === "number" ? payload.insertedCount : 0;
}

function payloadGroups(payload: unknown): MappingGroup[] {
  if (!payload || typeof payload !== "object" || !("groups" in payload)) return [];
  const { groups } = payload as { groups?: unknown };
  return Array.isArray(groups) ? (groups as MappingGroup[]) : [];
}

function payloadOptions<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== "object" || !("options" in payload)) return [];
  const { options } = payload as { options?: unknown };
  return Array.isArray(options) ? (options as T[]) : [];
}

async function fetchMappingGroups(
  schoolCode: string,
  academicYear: string,
  includeHistory: boolean,
  programId: number | null
): Promise<MappingGroup[]> {
  const params = new URLSearchParams({
    school_code: schoolCode,
    academic_year: academicYear,
  });
  if (includeHistory) params.set("include_history", "true");
  if (programId !== null) params.set("program_id", String(programId));

  const response = await fetch(`/api/academic-mentorship/mappings?${params.toString()}`);
  return response.ok ? payloadGroups(await readJson(response)) : [];
}

async function fetchOptions<T>(params: URLSearchParams): Promise<T[]> {
  const response = await fetch(`/api/academic-mentorship/options?${params.toString()}`);
  return response.ok ? payloadOptions<T>(await readJson(response)) : [];
}

async function mappingJsonMutation(
  method: "POST" | "DELETE" | "PATCH",
  body: Record<string, unknown>
): Promise<{ response: Response; payload: unknown }> {
  const response = await fetch("/api/academic-mentorship/mappings", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, payload: await readJson(response) };
}

function mentorLabel(mentor: MentorOption): string {
  return `${mentor.name} (${mentor.email})`;
}

function menteeLabel(mentee: MenteeOption): string {
  return `${mentee.name} (${mentee.studentId ?? "no id"})`;
}

function mentorOptionParams(schoolCode: string, search: string): URLSearchParams {
  return new URLSearchParams({
    type: "mentors",
    school_code: schoolCode,
    q: search,
  });
}

function menteeOptionParams(
  schoolCode: string,
  academicYear: string,
  programId: number | null,
  search: string
): URLSearchParams {
  const params = new URLSearchParams({
    type: "mentees",
    school_code: schoolCode,
    academic_year: academicYear,
    q: search,
  });
  if (programId !== null) params.set("program_id", String(programId));
  return params;
}

function SearchablePicker<T>({
  label,
  value,
  options,
  placeholder,
  getLabel,
  getValue,
  onSearch,
  onSelect,
}: {
  label: string;
  value: string;
  options: T[];
  placeholder: string;
  getLabel: (option: T) => string;
  getValue: (option: T) => string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  const listId = useId();
  function handleValue(nextValue: string) {
    onSearch(nextValue);
    const selected = options.find((option) => getLabel(option) === nextValue);
    onSelect(selected ? getValue(selected) : "");
  }

  return (
    <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
      {label}
      <Input
        value={value}
        list={listId}
        placeholder={placeholder}
        onFocus={() => onSearch(value)}
        onChange={(event) => handleValue(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={getValue(option)} value={getLabel(option)} />
        ))}
      </datalist>
    </label>
  );
}

async function addMappingAction(args: {
  schoolCode: string;
  academicYear: string;
  mentorUserId: string;
  studentPkId: string;
  refreshMappings: () => Promise<void>;
  setMentorInput: StateSetter<string>;
  setMentorUserId: StateSetter<string>;
  setMenteeInput: StateSetter<string>;
  setStudentPkId: StateSetter<string>;
  setAddOpen: StateSetter<boolean>;
  setBusy: StateSetter<boolean>;
  setToast: StateSetter<ToastState>;
}) {
  if (!args.mentorUserId || !args.studentPkId) {
    args.setToast({ variant: "error", message: "Select an Academic Mentor and Mentee" });
    return;
  }

  args.setBusy(true);
  try {
    const { response, payload } = await mappingJsonMutation("POST", {
      school_code: args.schoolCode,
      academic_year: args.academicYear,
      mentor_user_id: Number(args.mentorUserId),
      student_id: Number(args.studentPkId),
    });
    await args.refreshMappings();
    if (!response.ok) {
      args.setToast({ variant: "error", message: apiError(payload, "Failed to add Mapping") });
      return;
    }
    args.setMentorInput("");
    args.setMentorUserId("");
    args.setMenteeInput("");
    args.setStudentPkId("");
    args.setAddOpen(false);
    args.setToast({ variant: "success", message: "Mapping added." });
  } catch {
    args.setToast({ variant: "error", message: "Failed to add Mapping" });
  } finally {
    args.setBusy(false);
  }
}

async function uploadCsvAction(args: {
  schoolCode: string;
  academicYear: string;
  csvFile: File | null;
  refreshMappings: () => Promise<void>;
  setCsvOpen: StateSetter<boolean>;
  setCsvFile: StateSetter<File | null>;
  setCsvRows: StateSetter<CsvUploadRow[]>;
  setCsvErrors: StateSetter<CsvUploadError[]>;
  setCsvFileError: StateSetter<string>;
  setErrorCsv: StateSetter<string | null>;
  setBusy: StateSetter<boolean>;
  setToast: StateSetter<ToastState>;
}) {
  if (!args.csvFile) {
    args.setCsvFileError("Choose a CSV file with at least one row");
    return;
  }

  args.setBusy(true);
  args.setErrorCsv(null);
  args.setCsvErrors([]);
  args.setCsvFileError("");
  try {
    const formData = new FormData();
    formData.set("school_code", args.schoolCode);
    formData.set("academic_year", args.academicYear);
    formData.set("file", args.csvFile);
    const response = await fetch("/api/academic-mentorship/mappings/import", {
      method: "POST",
      body: formData,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const rowErrors = payloadCsvErrors(payload);
      args.setErrorCsv(payloadErrorCsv(payload));
      args.setCsvErrors(rowErrors);
      args.setCsvFileError(
        rowErrors.length > 0 ? "Upload failed. 0 rows were saved." : apiError(payload, "Failed to upload CSV")
      );
      args.setToast({ variant: "error", message: apiError(payload, "Failed to upload CSV") });
      return;
    }
    await args.refreshMappings();
    const insertedCount = payloadInsertedCount(payload);
    args.setCsvOpen(false);
    args.setCsvFile(null);
    args.setCsvRows([]);
    args.setCsvErrors([]);
    args.setCsvFileError("");
    args.setToast({
      variant: "success",
      message: `Imported ${insertedCount} mapping${insertedCount === 1 ? "" : "s"}.`,
    });
  } catch {
    args.setToast({ variant: "error", message: "Failed to upload CSV" });
  } finally {
    args.setBusy(false);
  }
}

async function removeMappingAction(args: {
  schoolCode: string;
  academicYear: string;
  mappingId: number | string;
  refreshMappings: () => Promise<void>;
  setBusy: StateSetter<boolean>;
  setToast: StateSetter<ToastState>;
}) {
  if (!window.confirm("This Student will no longer have an active Academic Mentor.")) {
    return;
  }

  args.setBusy(true);
  try {
    const { response, payload } = await mappingJsonMutation("DELETE", {
      school_code: args.schoolCode,
      academic_year: args.academicYear,
      mapping_id: Number(args.mappingId),
    });
    await args.refreshMappings();
    if (!response.ok) {
      args.setToast({ variant: "error", message: apiError(payload, "Failed to remove Mapping") });
      return;
    }
    args.setToast({ variant: "success", message: "Mapping removed." });
  } catch {
    args.setToast({ variant: "error", message: "Failed to remove Mapping" });
  } finally {
    args.setBusy(false);
  }
}

async function reassignMappingAction(args: {
  schoolCode: string;
  academicYear: string;
  reassigning: ReassigningState;
  replacementMentorUserId: string;
  refreshMappings: () => Promise<void>;
  setReassigning: StateSetter<ReassigningState>;
  setReplacementMentorUserId: StateSetter<string>;
  setReplacementMentorInput: StateSetter<string>;
  setBusy: StateSetter<boolean>;
  setToast: StateSetter<ToastState>;
}) {
  if (!args.reassigning || !args.replacementMentorUserId) {
    args.setToast({ variant: "error", message: "Select a replacement Academic Mentor" });
    return;
  }

  args.setBusy(true);
  try {
    const { response, payload } = await mappingJsonMutation("PATCH", {
      school_code: args.schoolCode,
      academic_year: args.academicYear,
      mapping_id: Number(args.reassigning.mappingId),
      mentor_user_id: Number(args.replacementMentorUserId),
    });
    await args.refreshMappings();
    if (!response.ok) {
      args.setToast({ variant: "error", message: apiError(payload, "Failed to reassign Mapping") });
      return;
    }
    args.setReassigning(null);
    args.setReplacementMentorUserId("");
    args.setReplacementMentorInput("");
    args.setToast({ variant: "success", message: "Mapping reassigned." });
  } catch {
    args.setToast({ variant: "error", message: "Failed to reassign Mapping" });
  } finally {
    args.setBusy(false);
  }
}

function ManagerToast({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  return <Toast variant={toast.variant} message={toast.message} onDismiss={onDismiss} />;
}

function MappingStatus({
  mapping,
  includeHistory,
}: {
  mapping: Mapping;
  includeHistory: boolean;
}) {
  const active = mapping.status === "active";
  return (
    <div className="text-sm font-semibold text-text-primary">
      <Badge variant={active ? "success" : "default"} className="w-fit">
        {active ? "Active" : "Historical"}
      </Badge>
      {includeHistory && mapping.endedDate ? (
        <span className="mt-1 block font-mono text-xs font-normal text-text-muted">
          Ended {mapping.endedDate}
        </span>
      ) : null}
    </div>
  );
}

function MappingActions({
  canEdit,
  isActive,
  busy,
  mapping,
  mentorUserId,
  onStartReassign,
  onRemove,
}: {
  canEdit: boolean;
  isActive: boolean;
  busy: boolean;
  mapping: Mapping;
  mentorUserId: number;
  onStartReassign: (mapping: Mapping, currentMentorUserId: number) => void;
  onRemove: (mappingId: number | string) => void;
}) {
  if (!canEdit || !isActive) return null;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onStartReassign(mapping, mentorUserId)}
        disabled={busy}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        Reassign
      </Button>
      <Button
        type="button"
        variant="danger-ghost"
        size="sm"
        onClick={() => onRemove(mapping.id)}
        disabled={busy}
      >
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Remove
      </Button>
    </div>
  );
}

function MappingRow({
  mapping,
  mentorUserId,
  includeHistory,
  canEdit,
  busy,
  onStartReassign,
  onRemove,
}: {
  mapping: Mapping;
  mentorUserId: number;
  includeHistory: boolean;
} & MappingControls) {
  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_90px_120px_110px_220px] md:items-center">
      <div>
        <div className="font-semibold text-text-primary">{mapping.mentee.name}</div>
        <div className="font-mono text-xs text-text-muted">
          {mapping.mentee.studentId ?? "No ID"}
        </div>
      </div>
      <div className="text-sm text-text-muted">Grade {mapping.mentee.grade ?? "-"}</div>
      <div className="font-mono text-xs text-text-muted">{mapping.assignedDate}</div>
      <MappingStatus mapping={mapping} includeHistory={includeHistory} />
      <MappingActions
        canEdit={canEdit}
        isActive={mapping.status === "active"}
        busy={busy}
        mapping={mapping}
        mentorUserId={mentorUserId}
        onStartReassign={onStartReassign}
        onRemove={onRemove}
      />
    </div>
  );
}

function MappingGroupCard({
  group,
  includeHistory,
  canEdit,
  busy,
  onStartReassign,
  onRemove,
}: {
  group: MappingGroup;
  includeHistory: boolean;
} & MappingControls) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-border bg-bg-card-alt px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold text-text-primary">{group.mentor.name}</h2>
          {group.mentor.email ? (
            <p className="text-sm text-text-muted">{group.mentor.email}</p>
          ) : null}
        </div>
        <Badge variant="accent" className="w-fit font-mono">
          {group.menteeCount} mentee{group.menteeCount === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="divide-y divide-border">
        <div className="hidden bg-bg-card px-4 py-2 text-xs font-bold uppercase tracking-wide text-text-muted md:grid md:grid-cols-[minmax(0,1.6fr)_90px_120px_110px_220px]">
          <div>Mentee</div>
          <div>Grade</div>
          <div>Assigned</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>
        {group.mappings.map((mapping) => (
          <MappingRow
            key={String(mapping.id)}
            mapping={mapping}
            mentorUserId={group.mentor.userId}
            includeHistory={includeHistory}
            canEdit={canEdit}
            busy={busy}
            onStartReassign={onStartReassign}
            onRemove={onRemove}
          />
        ))}
      </div>
    </Card>
  );
}

function MappingGroupsSection({
  groups,
  includeHistory,
  canEdit,
  busy,
  onStartReassign,
  onRemove,
}: {
  groups: MappingGroup[];
  includeHistory: boolean;
} & MappingControls) {
  if (groups.length === 0) {
    return (
      <section className="mt-4 space-y-3">
        <Card className="border-dashed p-8 text-center text-sm text-text-muted">
          <div className="font-semibold text-text-primary">
            No Academic Mentor-Mentee Mappings found.
          </div>
          <p className="mt-1">Mappings will appear here after a manual add or CSV upload.</p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mt-4 space-y-3">
      {groups.map((group) => (
        <MappingGroupCard
          key={group.mentor.userId}
          group={group}
          includeHistory={includeHistory}
          canEdit={canEdit}
          busy={busy}
          onStartReassign={onStartReassign}
          onRemove={onRemove}
        />
      ))}
    </section>
  );
}

function ActionBar({
  canEdit,
  canUpload,
  templateHref,
  busy,
  onAdd,
  onUpload,
}: {
  canEdit: boolean;
  canUpload: boolean;
  templateHref: string;
  busy: boolean;
  onAdd: () => void;
  onUpload: () => void;
}) {
  if (!canUpload) return null;

  return (
    <Card className="mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-text-muted">
        {canEdit
          ? "Add mappings manually or upload a CSV for the selected academic year."
          : "Manual edits are disabled for this year. Use CSV upload for backfill."}
      </div>
      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button type="button" onClick={onAdd} disabled={busy}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Mapping
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onUpload} disabled={busy}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          Upload CSV
        </Button>
        <a
          href={templateHref}
          download="academic-mentorship-template.csv"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border bg-bg-card px-4 text-sm font-medium text-text-primary shadow-sm hover:bg-hover-bg"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Template
        </a>
      </div>
    </Card>
  );
}

function AddMappingPanel({
  open,
  mentorInput,
  mentorUserId,
  mentorOptions,
  menteeInput,
  studentPkId,
  menteeOptions,
  busy,
  onMentorSearch,
  onMentorSelect,
  onMenteeSearch,
  onMenteeSelect,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  mentorInput: string;
  mentorUserId: string;
  mentorOptions: MentorOption[];
  menteeInput: string;
  studentPkId: string;
  menteeOptions: MenteeOption[];
  busy: boolean;
  onMentorSearch: (value: string) => void;
  onMentorSelect: (value: string) => void;
  onMenteeSearch: (value: string) => void;
  onMenteeSelect: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <Card className="mt-3 overflow-hidden p-0">
      <div className="border-b border-border bg-bg-card-alt px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">
          Add Mapping
        </h2>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end">
        <SearchablePicker
          label="Academic Mentor"
          value={mentorInput}
          options={mentorOptions}
          placeholder="Search mentor name or email"
          getLabel={mentorLabel}
          getValue={(mentor) => String(mentor.userId)}
          onSearch={onMentorSearch}
          onSelect={onMentorSelect}
        />
        <SearchablePicker
          label="Mentee"
          value={menteeInput}
          options={menteeOptions}
          placeholder="Search student name or ID"
          getLabel={menteeLabel}
          getValue={(mentee) => String(mentee.studentPkId)}
          onSearch={onMenteeSearch}
          onSelect={onMenteeSelect}
        />
        <Button
          type="button"
          onClick={onSubmit}
          disabled={busy || !mentorUserId || !studentPkId}
        >
          Submit
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function csvUploadErrorValue(error: CsvUploadError, rows: CsvUploadRow[]): string {
  const row = rows[error.rowNumber - 2];
  if (!row) return "-";
  if (error.field !== "mentor_email" && error.field !== "student_id") return "-";
  return row[error.field] || "-";
}

function CsvUploadModal({
  open,
  academicYear,
  templateHref,
  csvRows,
  csvErrors,
  csvFileError,
  errorCsv,
  busy,
  onClose,
  onFile,
  onUpload,
}: {
  open: boolean;
  academicYear: string;
  templateHref: string;
  csvRows: CsvUploadRow[];
  csvErrors: CsvUploadError[];
  csvFileError: string;
  errorCsv: string | null;
  busy: boolean;
  onClose: () => void;
  onFile: (file: File | null) => void;
  onUpload: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} className="max-w-3xl">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-bold text-text-primary">Upload CSV</h2>
        <p className="mt-1 text-sm text-text-muted">
          CSV must contain mentor_email,student_id rows for{" "}
          <strong className="font-bold text-text-primary">{academicYear}</strong>. Change the
          academic year in the page dropdown before upload if this is not correct.
        </p>
      </div>
      <div className="grid max-h-[70vh] gap-4 overflow-y-auto px-5 py-4">
        <a
          href={templateHref}
          download="academic-mentorship-template.csv"
          className="inline-flex min-h-10 w-fit items-center justify-center gap-2 rounded-lg border border-border bg-bg-card px-3 text-sm font-medium text-text-primary shadow-sm hover:bg-hover-bg"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download CSV template
        </a>
        <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
          CSV file
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </label>
        {csvFileError ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {csvFileError}
          </div>
        ) : null}
        {csvRows.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="min-w-full table-fixed divide-y divide-border text-sm">
              <thead className="bg-bg-card-alt text-left text-xs font-bold uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="w-1/2 px-4 py-3">Mentor Email</th>
                  <th className="w-1/2 px-4 py-3">Student ID</th>
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row, index) => (
                  <tr key={`${row.mentor_email}-${row.student_id}-${index}`}>
                    <td className="border-t border-border px-4 py-3 text-text-primary">
                      {row.mentor_email || "-"}
                    </td>
                    <td className="border-t border-border px-4 py-3 font-mono text-text-primary">
                      {row.student_id || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {csvErrors.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-danger/30">
            <table className="min-w-full table-fixed divide-y divide-danger/20 text-sm">
              <thead className="bg-danger/10 text-left text-xs font-bold uppercase tracking-wide text-danger">
                <tr>
                  <th className="w-20 px-4 py-3">Row</th>
                  <th className="w-48 px-4 py-3">Error Value</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {csvErrors.map((error, index) => (
                  <tr key={`${error.rowNumber}-${error.field}-${index}`}>
                    <td className="border-t border-danger/20 px-4 py-3 text-text-primary">
                      {error.rowNumber}
                    </td>
                    <td className="border-t border-danger/20 px-4 py-3 font-mono text-text-primary">
                      {csvUploadErrorValue(error, csvRows)}
                    </td>
                    <td className="border-t border-danger/20 px-4 py-3 text-danger">
                      {error.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {errorCsv ? (
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(errorCsv)}`}
            download="academic-mentorship-import-errors.csv"
            className="inline-flex min-h-10 w-fit items-center justify-center rounded-lg px-2 text-sm font-bold text-accent hover:text-accent-hover"
          >
            Download error CSV
          </a>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onUpload}
          disabled={busy || csvRows.length === 0 || Boolean(csvFileError)}
        >
          Upload CSV
        </Button>
      </div>
    </Modal>
  );
}

function ReassignModal({
  reassigning,
  replacementMentorInput,
  replacementMentorUserId,
  replacementMentorOptions,
  busy,
  onSearch,
  onSelect,
  onConfirm,
  onCancel,
}: {
  reassigning: ReassigningState;
  replacementMentorInput: string;
  replacementMentorUserId: string;
  replacementMentorOptions: MentorOption[];
  busy: boolean;
  onSearch: (value: string) => void;
  onSelect: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const options = replacementMentorOptions.filter(
    (mentor) => mentor.userId !== reassigning?.currentMentorUserId
  );

  return (
    <Modal open={reassigning !== null} onClose={onCancel}>
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-bold text-text-primary">Reassign Mentee</h2>
        <p className="mt-1 text-sm text-text-muted">
          {reassigning ? `Select a new mentor for ${reassigning.menteeName}.` : ""}
        </p>
      </div>
      <div className="px-5 py-4">
        <SearchablePicker
          label="Replacement Academic Mentor"
          value={replacementMentorInput}
          options={options}
          placeholder="Search mentor name or email"
          getLabel={mentorLabel}
          getValue={(mentor) => String(mentor.userId)}
          onSearch={onSearch}
          onSelect={onSelect}
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={onConfirm} disabled={busy || !replacementMentorUserId}>
          Confirm Reassign
        </Button>
      </div>
    </Modal>
  );
}

function useMappingGroupsState({
  schoolCode,
  academicYear,
  programId,
  includeHistory,
  initialGroups,
}: AcademicMentorshipManagerProps) {
  const groupsKey = `${schoolCode}:${academicYear}:${programId ?? "all"}:${includeHistory}`;
  const [groupState, setGroupState] = useState({ key: groupsKey, groups: initialGroups });
  const groups = groupState.key === groupsKey ? groupState.groups : initialGroups;

  async function refreshMappings() {
    setGroupState({
      key: groupsKey,
      groups: await fetchMappingGroups(schoolCode, academicYear, includeHistory, programId),
    });
  }

  return { groups, refreshMappings };
}

function useMentorshipOptionState(
  schoolCode: string,
  academicYear: string,
  programId: number | null
) {
  const [mentorOptions, setMentorOptions] = useState<MentorOption[]>([]);
  const [menteeOptions, setMenteeOptions] = useState<MenteeOption[]>([]);
  const [mentorInput, setMentorInput] = useState("");
  const [menteeInput, setMenteeInput] = useState("");
  const [reassigning, setReassigning] = useState<ReassigningState>(null);
  const [replacementMentorOptions, setReplacementMentorOptions] = useState<MentorOption[]>([]);
  const [replacementMentorInput, setReplacementMentorInput] = useState("");
  const [replacementMentorUserId, setReplacementMentorUserId] = useState("");

  function searchReplacementMentors(value: string) {
    setReplacementMentorInput(value);
    void fetchOptions<MentorOption>(mentorOptionParams(schoolCode, value)).then(
      setReplacementMentorOptions
    );
  }

  function startReassign(mapping: Mapping, currentMentorUserId: number) {
    setReassigning({
      mappingId: mapping.id,
      currentMentorUserId,
      menteeName: mapping.mentee.name,
    });
    setReplacementMentorUserId("");
    searchReplacementMentors("");
  }

  function searchMentors(value: string) {
    setMentorInput(value);
    void fetchOptions<MentorOption>(mentorOptionParams(schoolCode, value)).then(
      setMentorOptions
    );
  }

  function searchMentees(value: string) {
    setMenteeInput(value);
    void fetchOptions<MenteeOption>(
      menteeOptionParams(schoolCode, academicYear, programId, value)
    ).then(setMenteeOptions);
  }

  return {
    mentorOptions,
    menteeOptions,
    mentorInput,
    menteeInput,
    reassigning,
    replacementMentorOptions,
    replacementMentorInput,
    replacementMentorUserId,
    setMentorInput,
    setMenteeInput,
    setReassigning,
    setReplacementMentorInput,
    setReplacementMentorUserId,
    startReassign,
    searchReplacementMentors,
    searchMentors,
    searchMentees,
  };
}

function useCsvUploadState() {
  const [open, setCsvOpen] = useState(false);
  const [file, setCsvFile] = useState<File | null>(null);
  const [rows, setCsvRows] = useState<CsvUploadRow[]>([]);
  const [errors, setCsvErrors] = useState<CsvUploadError[]>([]);
  const [fileError, setCsvFileError] = useState("");
  const [errorCsv, setErrorCsv] = useState<string | null>(null);

  function resetCsvData() {
    setCsvRows([]);
    setCsvErrors([]);
    setCsvFileError("");
    setErrorCsv(null);
  }

  function close() {
    setCsvOpen(false);
    setCsvFile(null);
    resetCsvData();
  }

  async function selectFile(nextFile: File | null) {
    setCsvFile(nextFile);
    resetCsvData();
    if (!nextFile) return;

    try {
      const parsed = parseCsvText(await nextFile.text());
      const requiredColumns = ["mentor_email", "student_id"];
      const missingColumns = requiredColumns.filter((column) => !parsed.headers.includes(column));
      if (missingColumns.length > 0) {
        setCsvFileError(`Missing required columns: ${missingColumns.join(", ")}`);
        return;
      }
      const parsedRows = parsed.rows.map((row) => ({
        mentor_email: row.mentor_email ?? "",
        student_id: row.student_id ?? "",
      }));
      setCsvRows(parsedRows);
      if (parsedRows.length === 0) setCsvFileError("Choose a CSV file with at least one row");
    } catch {
      setCsvFileError("Unable to parse CSV file");
    }
  }

  return {
    open,
    file,
    rows,
    errors,
    fileError,
    errorCsv,
    openModal: () => setCsvOpen(true),
    close,
    selectFile,
    actionSetters: {
      setCsvOpen,
      setCsvFile,
      setCsvRows,
      setCsvErrors,
      setCsvFileError,
      setErrorCsv,
    },
  };
}

export default function AcademicMentorshipManager({
  schoolCode,
  academicYear,
  programId,
  includeHistory,
  canEdit,
  canUpload,
  initialGroups,
}: AcademicMentorshipManagerProps) {
  const { groups, refreshMappings } = useMappingGroupsState({
    schoolCode,
    academicYear,
    programId,
    includeHistory,
    canEdit,
    canUpload,
    initialGroups,
  });
  const {
    mentorOptions,
    menteeOptions,
    mentorInput,
    menteeInput,
    reassigning,
    replacementMentorOptions,
    replacementMentorInput,
    replacementMentorUserId,
    setMentorInput,
    setMenteeInput,
    setReassigning,
    setReplacementMentorInput,
    setReplacementMentorUserId,
    startReassign,
    searchReplacementMentors,
    searchMentors,
    searchMentees,
  } = useMentorshipOptionState(schoolCode, academicYear, programId);
  const [mentorUserId, setMentorUserId] = useState("");
  const [studentPkId, setStudentPkId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const csvUpload = useCsvUploadState();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const templateParams = new URLSearchParams({
    school_code: schoolCode,
    academic_year: academicYear,
  });
  const templateHref = `/api/academic-mentorship/mappings/import?${templateParams.toString()}`;

  return (
    <>
      <ManagerToast toast={toast} onDismiss={() => setToast(null)} />

      <ActionBar
        canEdit={canEdit}
        canUpload={canUpload}
        templateHref={templateHref}
        busy={busy}
        onAdd={() => setAddOpen(true)}
        onUpload={csvUpload.openModal}
      />

      <AddMappingPanel
        open={addOpen && canEdit}
        mentorInput={mentorInput}
        mentorUserId={mentorUserId}
        mentorOptions={mentorOptions}
        menteeInput={menteeInput}
        studentPkId={studentPkId}
        menteeOptions={menteeOptions}
        busy={busy}
        onMentorSearch={searchMentors}
        onMentorSelect={setMentorUserId}
        onMenteeSearch={searchMentees}
        onMenteeSelect={setStudentPkId}
        onSubmit={() =>
          void addMappingAction({
            schoolCode,
            academicYear,
            mentorUserId,
            studentPkId,
            refreshMappings,
            setMentorInput,
            setMentorUserId,
            setMenteeInput,
            setStudentPkId,
            setAddOpen,
            setBusy,
            setToast,
          })
        }
        onCancel={() => setAddOpen(false)}
      />

      <CsvUploadModal
        open={csvUpload.open && canUpload}
        academicYear={academicYear}
        templateHref={templateHref}
        csvRows={csvUpload.rows}
        csvErrors={csvUpload.errors}
        csvFileError={csvUpload.fileError}
        errorCsv={csvUpload.errorCsv}
        busy={busy}
        onClose={csvUpload.close}
        onFile={(file) => {
          void csvUpload.selectFile(file);
        }}
        onUpload={() =>
          void uploadCsvAction({
            schoolCode,
            academicYear,
            csvFile: csvUpload.file,
            refreshMappings,
            ...csvUpload.actionSetters,
            setBusy,
            setToast,
          })
        }
      />

      <ReassignModal
        reassigning={reassigning}
        replacementMentorInput={replacementMentorInput}
        replacementMentorUserId={replacementMentorUserId}
        replacementMentorOptions={replacementMentorOptions}
        busy={busy}
        onSearch={searchReplacementMentors}
        onSelect={setReplacementMentorUserId}
        onConfirm={() =>
          void reassignMappingAction({
            schoolCode,
            academicYear,
            reassigning,
            replacementMentorUserId,
            refreshMappings,
            setReassigning,
            setReplacementMentorUserId,
            setReplacementMentorInput,
            setBusy,
            setToast,
          })
        }
        onCancel={() => setReassigning(null)}
      />

      <MappingGroupsSection
        groups={groups}
        includeHistory={includeHistory}
        canEdit={canEdit}
        busy={busy}
        onStartReassign={startReassign}
        onRemove={(mappingId) =>
          void removeMappingAction({
            schoolCode,
            academicYear,
            mappingId,
            refreshMappings,
            setBusy,
            setToast,
          })
        }
      />
    </>
  );
}
