"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Download, Plus, RotateCcw, Upload, XCircle } from "lucide-react";

import Toast from "@/components/Toast";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import type { AcademicMentorshipMappingGroup } from "@/lib/academic-mentorship";

type MappingGroup = AcademicMentorshipMappingGroup;

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

type Mapping = MappingGroup["mappings"][number];
type ReassigningState = {
  mappingId: number | string;
  currentMentorUserId: number;
} | null;
type ToastState = { variant: "success" | "error"; message: string } | null;
type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface MappingControls {
  canEdit: boolean;
  busy: boolean;
  reassigning: ReassigningState;
  replacementMentorSearch: string;
  replacementMentorUserId: string;
  replacementMentorOptions: MentorOption[];
  onStartReassign: (mappingId: number | string, currentMentorUserId: number) => void;
  onRemove: (mappingId: number | string) => void;
  onReplacementMentorSearch: (value: string) => void;
  onReplacementMentorSelect: (value: string) => void;
  onConfirmReassign: () => void;
  onCancelReassign: () => void;
}

interface MappingRowProps extends MappingControls {
  mapping: Mapping;
  mentorUserId: number;
  includeHistory: boolean;
}

interface MappingGroupCardProps extends MappingControls {
  group: MappingGroup;
  includeHistory: boolean;
}

interface MappingGroupsSectionProps extends MappingControls {
  groups: MappingGroup[];
  includeHistory: boolean;
}

interface AcademicMentorshipManagerProps {
  schoolCode: string;
  academicYear: string;
  includeHistory: boolean;
  canEdit: boolean;
  initialGroups: MappingGroup[];
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
  includeHistory: boolean
): Promise<MappingGroup[]> {
  const params = new URLSearchParams({
    school_code: schoolCode,
    academic_year: academicYear,
  });
  if (includeHistory) params.set("include_history", "true");

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
  search: string
): URLSearchParams {
  return new URLSearchParams({
    type: "mentees",
    school_code: schoolCode,
    academic_year: academicYear,
    q: search,
  });
}

async function addMappingAction(args: {
  schoolCode: string;
  academicYear: string;
  mentorUserId: string;
  studentPkId: string;
  refreshMappings: () => Promise<void>;
  setMentorUserId: StateSetter<string>;
  setStudentPkId: StateSetter<string>;
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
    args.setMentorUserId("");
    args.setStudentPkId("");
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
  setErrorCsv: StateSetter<string | null>;
  setBusy: StateSetter<boolean>;
  setToast: StateSetter<ToastState>;
}) {
  if (!args.csvFile) {
    args.setToast({ variant: "error", message: "Select a CSV file" });
    return;
  }

  args.setBusy(true);
  args.setErrorCsv(null);
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
      args.setErrorCsv(payloadErrorCsv(payload));
      args.setToast({ variant: "error", message: apiError(payload, "Failed to upload CSV") });
      return;
    }
    await args.refreshMappings();
    const insertedCount = payloadInsertedCount(payload);
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
  setBusy: StateSetter<boolean>;
  setToast: StateSetter<ToastState>;
}) {
  if (!args.reassigning || !args.replacementMentorUserId) {
    args.setToast({ variant: "error", message: "Select a replacement Academic Mentor" });
    return;
  }
  if (!window.confirm("This will end the old Mapping and create a new Mapping.")) {
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
    args.setToast({ variant: "success", message: "Mapping reassigned." });
  } catch {
    args.setToast({ variant: "error", message: "Failed to reassign Mapping" });
  } finally {
    args.setBusy(false);
  }
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
  mappingId,
  mentorUserId,
  onStartReassign,
  onRemove,
}: {
  canEdit: boolean;
  isActive: boolean;
  busy: boolean;
  mappingId: number | string;
  mentorUserId: number;
  onStartReassign: (mappingId: number | string, currentMentorUserId: number) => void;
  onRemove: (mappingId: number | string) => void;
}) {
  if (!canEdit || !isActive) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onStartReassign(mappingId, mentorUserId)}
        disabled={busy}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        Reassign
      </Button>
      <Button
        type="button"
        variant="danger-ghost"
        size="sm"
        onClick={() => onRemove(mappingId)}
        disabled={busy}
      >
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Remove
      </Button>
    </div>
  );
}

function ReassignPanel({
  currentMentorUserId,
  replacementMentorSearch,
  replacementMentorUserId,
  replacementMentorOptions,
  busy,
  onSearch,
  onSelect,
  onConfirm,
  onCancel,
}: {
  currentMentorUserId: number;
  replacementMentorSearch: string;
  replacementMentorUserId: string;
  replacementMentorOptions: MentorOption[];
  busy: boolean;
  onSearch: (value: string) => void;
  onSelect: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const options = replacementMentorOptions.filter(
    (mentor) => mentor.userId !== currentMentorUserId
  );

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-bg-card-alt p-3 md:col-span-5 md:grid-cols-[1fr_1fr_auto_auto]">
      <label className="grid gap-1 text-sm font-semibold text-text-primary">
        Search replacement mentor
        <Input
          value={replacementMentorSearch}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-text-primary">
        Replacement Academic Mentor
        <Select
          value={replacementMentorUserId}
          onChange={(event) => onSelect(event.target.value)}
          className="w-full min-w-0"
        >
          <option value="">Select mentor</option>
          {options.map((mentor) => (
            <option key={mentor.userId} value={mentor.userId}>
              {mentor.name} ({mentor.email})
            </option>
          ))}
        </Select>
      </label>
      <Button
        type="button"
        size="sm"
        onClick={onConfirm}
        disabled={busy}
        className="self-end"
      >
        Confirm Reassign
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={busy}
        className="self-end"
      >
        Cancel
      </Button>
    </div>
  );
}

function reassigningMentorId(
  reassigning: ReassigningState,
  mappingId: number | string
): number | null {
  if (!reassigning) return null;
  return String(reassigning.mappingId) === String(mappingId)
    ? reassigning.currentMentorUserId
    : null;
}

function MappingReassignPanel({
  reassigning,
  mappingId,
  replacementMentorSearch,
  replacementMentorUserId,
  replacementMentorOptions,
  busy,
  onReplacementMentorSearch,
  onReplacementMentorSelect,
  onConfirmReassign,
  onCancelReassign,
}: {
  reassigning: ReassigningState;
  mappingId: number | string;
  replacementMentorSearch: string;
  replacementMentorUserId: string;
  replacementMentorOptions: MentorOption[];
  busy: boolean;
  onReplacementMentorSearch: (value: string) => void;
  onReplacementMentorSelect: (value: string) => void;
  onConfirmReassign: () => void;
  onCancelReassign: () => void;
}) {
  const currentMentorUserId = reassigningMentorId(reassigning, mappingId);
  if (currentMentorUserId === null) return null;

  return (
    <ReassignPanel
      currentMentorUserId={currentMentorUserId}
      replacementMentorSearch={replacementMentorSearch}
      replacementMentorUserId={replacementMentorUserId}
      replacementMentorOptions={replacementMentorOptions}
      busy={busy}
      onSearch={onReplacementMentorSearch}
      onSelect={onReplacementMentorSelect}
      onConfirm={onConfirmReassign}
      onCancel={onCancelReassign}
    />
  );
}

function MappingRow({
  mapping,
  mentorUserId,
  includeHistory,
  canEdit,
  busy,
  reassigning,
  replacementMentorSearch,
  replacementMentorUserId,
  replacementMentorOptions,
  onStartReassign,
  onRemove,
  onReplacementMentorSearch,
  onReplacementMentorSelect,
  onConfirmReassign,
  onCancelReassign,
}: MappingRowProps) {
  return (
    <div
      className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_90px_120px_110px_220px] md:items-center"
    >
      <div>
        <div className="font-semibold text-text-primary">{mapping.mentee.name}</div>
        <div className="font-mono text-xs text-text-muted">
          {mapping.mentee.studentId ?? "No ID"}
        </div>
      </div>
      <div className="text-sm text-text-muted">Grade {mapping.mentee.grade ?? "-"}</div>
      <div className="font-mono text-xs text-text-muted">{mapping.assignedDate}</div>
      <MappingStatus mapping={mapping} includeHistory={includeHistory} />
      <div className="md:flex md:justify-end">
        <MappingActions
          canEdit={canEdit}
          isActive={mapping.status === "active"}
          busy={busy}
          mappingId={mapping.id}
          mentorUserId={mentorUserId}
          onStartReassign={onStartReassign}
          onRemove={onRemove}
        />
      </div>
      <MappingReassignPanel
        reassigning={reassigning}
        mappingId={mapping.id}
        replacementMentorSearch={replacementMentorSearch}
        replacementMentorUserId={replacementMentorUserId}
        replacementMentorOptions={replacementMentorOptions}
        busy={busy}
        onReplacementMentorSearch={onReplacementMentorSearch}
        onReplacementMentorSelect={onReplacementMentorSelect}
        onConfirmReassign={onConfirmReassign}
        onCancelReassign={onCancelReassign}
      />
    </div>
  );
}

function ManagerToast({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  return (
    <Toast
      variant={toast.variant}
      message={toast.message}
      onDismiss={onDismiss}
    />
  );
}

function AssignmentCard({
  canEdit,
  mentorSearch,
  mentorUserId,
  mentorOptions,
  menteeSearch,
  studentPkId,
  menteeOptions,
  busy,
  templateHref,
  errorCsv,
  onMentorSearch,
  onMentorSelect,
  onMenteeSearch,
  onMenteeSelect,
  onAddMapping,
  onCsvFile,
  onUploadCsv,
}: {
  canEdit: boolean;
  mentorSearch: string;
  mentorUserId: string;
  mentorOptions: MentorOption[];
  menteeSearch: string;
  studentPkId: string;
  menteeOptions: MenteeOption[];
  busy: boolean;
  templateHref: string;
  errorCsv: string | null;
  onMentorSearch: (value: string) => void;
  onMentorSelect: (value: string) => void;
  onMenteeSearch: (value: string) => void;
  onMenteeSelect: (value: string) => void;
  onAddMapping: () => void;
  onCsvFile: (file: File | null) => void;
  onUploadCsv: () => void;
}) {
  if (!canEdit) return null;

  return (
    <Card className="mt-4 overflow-hidden p-0">
      <div className="border-b border-border bg-bg-card-alt px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-primary">
          Assign mentee
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Search before selecting so the dropdowns stay scoped to this School and year.
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
            Search mentors
            <Input
              value={mentorSearch}
              onChange={(event) => onMentorSearch(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
            Academic Mentor
            <Select
              value={mentorUserId}
              onChange={(event) => onMentorSelect(event.target.value)}
              className="w-full min-w-0"
            >
              <option value="">Select mentor</option>
              {mentorOptions.map((mentor) => (
                <option key={mentor.userId} value={mentor.userId}>
                  {mentor.name} ({mentor.email})
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
            Search mentees
            <Input
              value={menteeSearch}
              onChange={(event) => onMenteeSearch(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
            Mentee
            <Select
              value={studentPkId}
              onChange={(event) => onMenteeSelect(event.target.value)}
              className="w-full min-w-0"
            >
              <option value="">Select mentee</option>
              {menteeOptions.map((mentee) => (
                <option key={mentee.studentPkId} value={mentee.studentPkId}>
                  {mentee.name} ({mentee.studentId ?? "no id"})
                </option>
              ))}
            </Select>
          </label>
        </div>
        <Button type="button" onClick={onAddMapping} disabled={busy} className="self-end">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Mapping
        </Button>
      </div>

      <div className="grid gap-3 border-t border-border bg-bg-card-alt/60 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
        <a
          href={templateHref}
          download="academic-mentorship-template.csv"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border bg-bg-card px-4 text-sm font-medium text-text-primary shadow-sm hover:bg-hover-bg"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download CSV template
        </a>
        <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
          CSV file
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => onCsvFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          onClick={onUploadCsv}
          disabled={busy}
          className="self-end"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Upload CSV
        </Button>
        {errorCsv ? (
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(errorCsv)}`}
            download="academic-mentorship-import-errors.csv"
            className="self-end text-sm font-bold text-accent hover:text-accent-hover"
          >
            Download error CSV
          </a>
        ) : null}
      </div>
    </Card>
  );
}

function MappingGroupCard({
  group,
  includeHistory,
  canEdit,
  busy,
  reassigning,
  replacementMentorSearch,
  replacementMentorUserId,
  replacementMentorOptions,
  onStartReassign,
  onRemove,
  onReplacementMentorSearch,
  onReplacementMentorSelect,
  onConfirmReassign,
  onCancelReassign,
}: MappingGroupCardProps) {
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
            reassigning={reassigning}
            replacementMentorSearch={replacementMentorSearch}
            replacementMentorUserId={replacementMentorUserId}
            replacementMentorOptions={replacementMentorOptions}
            onStartReassign={onStartReassign}
            onRemove={onRemove}
            onReplacementMentorSearch={onReplacementMentorSearch}
            onReplacementMentorSelect={onReplacementMentorSelect}
            onConfirmReassign={onConfirmReassign}
            onCancelReassign={onCancelReassign}
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
  reassigning,
  replacementMentorSearch,
  replacementMentorUserId,
  replacementMentorOptions,
  onStartReassign,
  onRemove,
  onReplacementMentorSearch,
  onReplacementMentorSelect,
  onConfirmReassign,
  onCancelReassign,
}: MappingGroupsSectionProps) {
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
          reassigning={reassigning}
          replacementMentorSearch={replacementMentorSearch}
          replacementMentorUserId={replacementMentorUserId}
          replacementMentorOptions={replacementMentorOptions}
          onStartReassign={onStartReassign}
          onRemove={onRemove}
          onReplacementMentorSearch={onReplacementMentorSearch}
          onReplacementMentorSelect={onReplacementMentorSelect}
          onConfirmReassign={onConfirmReassign}
          onCancelReassign={onCancelReassign}
        />
      ))}
    </section>
  );
}

function useMappingGroupsState({
  schoolCode,
  academicYear,
  includeHistory,
  initialGroups,
}: AcademicMentorshipManagerProps) {
  const groupsKey = `${schoolCode}:${academicYear}:${includeHistory}`;
  const [groupState, setGroupState] = useState({ key: groupsKey, groups: initialGroups });
  const groups = groupState.key === groupsKey ? groupState.groups : initialGroups;

  async function refreshMappings() {
    setGroupState({
      key: groupsKey,
      groups: await fetchMappingGroups(schoolCode, academicYear, includeHistory),
    });
  }

  return { groups, refreshMappings };
}

function useMentorshipOptionState(schoolCode: string, academicYear: string) {
  const [mentorOptions, setMentorOptions] = useState<MentorOption[]>([]);
  const [menteeOptions, setMenteeOptions] = useState<MenteeOption[]>([]);
  const [mentorSearch, setMentorSearch] = useState("");
  const [menteeSearch, setMenteeSearch] = useState("");
  const [reassigning, setReassigning] = useState<ReassigningState>(null);
  const [replacementMentorOptions, setReplacementMentorOptions] = useState<MentorOption[]>([]);
  const [replacementMentorSearch, setReplacementMentorSearch] = useState("");
  const [replacementMentorUserId, setReplacementMentorUserId] = useState("");

  function startReassign(mappingId: number | string, currentMentorUserId: number) {
    setReassigning({ mappingId, currentMentorUserId });
    setReplacementMentorOptions([]);
    setReplacementMentorSearch("");
    setReplacementMentorUserId("");
  }

  function searchReplacementMentors(value: string) {
    setReplacementMentorSearch(value);
    void fetchOptions<MentorOption>(mentorOptionParams(schoolCode, value)).then(
      setReplacementMentorOptions
    );
  }

  function searchMentors(value: string) {
    setMentorSearch(value);
    void fetchOptions<MentorOption>(mentorOptionParams(schoolCode, value)).then(
      setMentorOptions
    );
  }

  function searchMentees(value: string) {
    setMenteeSearch(value);
    void fetchOptions<MenteeOption>(
      menteeOptionParams(schoolCode, academicYear, value)
    ).then(setMenteeOptions);
  }

  return {
    mentorOptions,
    menteeOptions,
    mentorSearch,
    menteeSearch,
    reassigning,
    replacementMentorOptions,
    replacementMentorSearch,
    replacementMentorUserId,
    setReassigning,
    setReplacementMentorUserId,
    startReassign,
    searchReplacementMentors,
    searchMentors,
    searchMentees,
  };
}

export default function AcademicMentorshipManager({
  schoolCode,
  academicYear,
  includeHistory,
  canEdit,
  initialGroups,
}: AcademicMentorshipManagerProps) {
  const { groups, refreshMappings } = useMappingGroupsState({
    schoolCode,
    academicYear,
    includeHistory,
    canEdit,
    initialGroups,
  });
  const {
    mentorOptions,
    menteeOptions,
    mentorSearch,
    menteeSearch,
    reassigning,
    replacementMentorOptions,
    replacementMentorSearch,
    replacementMentorUserId,
    setReassigning,
    setReplacementMentorUserId,
    startReassign,
    searchReplacementMentors,
    searchMentors,
    searchMentees,
  } = useMentorshipOptionState(schoolCode, academicYear);
  const [mentorUserId, setMentorUserId] = useState("");
  const [studentPkId, setStudentPkId] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [errorCsv, setErrorCsv] = useState<string | null>(null);
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

      <AssignmentCard
        canEdit={canEdit}
        mentorSearch={mentorSearch}
        mentorUserId={mentorUserId}
        mentorOptions={mentorOptions}
        menteeSearch={menteeSearch}
        studentPkId={studentPkId}
        menteeOptions={menteeOptions}
        busy={busy}
        templateHref={templateHref}
        errorCsv={errorCsv}
        onMentorSearch={searchMentors}
        onMentorSelect={setMentorUserId}
        onMenteeSearch={searchMentees}
        onMenteeSelect={setStudentPkId}
        onAddMapping={() =>
          void addMappingAction({
            schoolCode,
            academicYear,
            mentorUserId,
            studentPkId,
            refreshMappings,
            setMentorUserId,
            setStudentPkId,
            setBusy,
            setToast,
          })
        }
        onCsvFile={setCsvFile}
        onUploadCsv={() =>
          void uploadCsvAction({
            schoolCode,
            academicYear,
            csvFile,
            refreshMappings,
            setErrorCsv,
            setBusy,
            setToast,
          })
        }
      />

      <MappingGroupsSection
        groups={groups}
        includeHistory={includeHistory}
        canEdit={canEdit}
        busy={busy}
        reassigning={reassigning}
        replacementMentorSearch={replacementMentorSearch}
        replacementMentorUserId={replacementMentorUserId}
        replacementMentorOptions={replacementMentorOptions}
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
        onReplacementMentorSearch={searchReplacementMentors}
        onReplacementMentorSelect={setReplacementMentorUserId}
        onConfirmReassign={() =>
          void reassignMappingAction({
            schoolCode,
            academicYear,
            reassigning,
            replacementMentorUserId,
            refreshMappings,
            setReassigning,
            setReplacementMentorUserId,
            setBusy,
            setToast,
          })
        }
        onCancelReassign={() => setReassigning(null)}
      />
    </>
  );
}
