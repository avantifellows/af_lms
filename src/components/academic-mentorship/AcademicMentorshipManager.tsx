"use client";

import { useEffect, useState } from "react";
import { Download, Plus, RotateCcw, Upload, XCircle } from "lucide-react";

import Toast from "@/components/Toast";
import { Badge, Button, Card, Input, Select } from "@/components/ui";

type MappingGroup = {
  mentor: {
    userId: number;
    name: string;
    email: string | null;
  };
  menteeCount: number;
  mappings: Array<{
    id: number | string;
    mentee: {
      studentPkId: number;
      name: string;
      studentId: string | null;
      grade: number | null;
    };
    assignedDate: string;
    endedDate: string | null;
    status: "active" | "historical";
  }>;
};

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
}: {
  mapping: Mapping;
  mentorUserId: number;
  includeHistory: boolean;
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
}) {
  const reassigningHere =
    reassigning && String(reassigning.mappingId) === String(mapping.id)
      ? reassigning.currentMentorUserId
      : null;

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
      {reassigningHere ? (
        <ReassignPanel
          currentMentorUserId={reassigningHere}
          replacementMentorSearch={replacementMentorSearch}
          replacementMentorUserId={replacementMentorUserId}
          replacementMentorOptions={replacementMentorOptions}
          busy={busy}
          onSearch={onReplacementMentorSearch}
          onSelect={onReplacementMentorSelect}
          onConfirm={onConfirmReassign}
          onCancel={onCancelReassign}
        />
      ) : null}
    </div>
  );
}

export default function AcademicMentorshipManager({
  schoolCode,
  academicYear,
  includeHistory,
  canEdit,
  initialGroups,
}: AcademicMentorshipManagerProps) {
  const [groups, setGroups] = useState(initialGroups);
  const [mentorOptions, setMentorOptions] = useState<MentorOption[]>([]);
  const [menteeOptions, setMenteeOptions] = useState<MenteeOption[]>([]);
  const [mentorSearch, setMentorSearch] = useState("");
  const [menteeSearch, setMenteeSearch] = useState("");
  const [mentorUserId, setMentorUserId] = useState("");
  const [studentPkId, setStudentPkId] = useState("");
  const [reassigning, setReassigning] = useState<ReassigningState>(null);
  const [replacementMentorOptions, setReplacementMentorOptions] = useState<MentorOption[]>([]);
  const [replacementMentorSearch, setReplacementMentorSearch] = useState("");
  const [replacementMentorUserId, setReplacementMentorUserId] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [errorCsv, setErrorCsv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);
  const templateParams = new URLSearchParams({
    school_code: schoolCode,
    academic_year: academicYear,
  });
  const templateHref = `/api/academic-mentorship/mappings/import?${templateParams.toString()}`;

  useEffect(() => {
    setGroups(initialGroups);
  }, [schoolCode, academicYear, includeHistory, initialGroups]);

  async function refreshMappings() {
    const params = new URLSearchParams({
      school_code: schoolCode,
      academic_year: academicYear,
    });
    if (includeHistory) params.set("include_history", "true");
    const response = await fetch(`/api/academic-mentorship/mappings?${params.toString()}`);
    const payload = await readJson(response);
    if (response.ok && payload && typeof payload === "object" && "groups" in payload) {
      setGroups((payload.groups as MappingGroup[]) ?? []);
    }
  }

  async function loadMentorOptions(
    search: string,
    setOptions: (options: MentorOption[]) => void
  ) {
    const params = new URLSearchParams({
      type: "mentors",
      school_code: schoolCode,
      q: search,
    });
    const response = await fetch(`/api/academic-mentorship/options?${params.toString()}`);
    const payload = await readJson(response);
    if (response.ok && payload && typeof payload === "object" && "options" in payload) {
      setOptions((payload.options as MentorOption[]) ?? []);
    }
  }

  async function loadMentors(search: string) {
    await loadMentorOptions(search, setMentorOptions);
  }

  async function loadReplacementMentors(search: string) {
    await loadMentorOptions(search, setReplacementMentorOptions);
  }

  async function loadMentees(search: string) {
    const params = new URLSearchParams({
      type: "mentees",
      school_code: schoolCode,
      academic_year: academicYear,
      q: search,
    });
    const response = await fetch(`/api/academic-mentorship/options?${params.toString()}`);
    const payload = await readJson(response);
    if (response.ok && payload && typeof payload === "object" && "options" in payload) {
      setMenteeOptions((payload.options as MenteeOption[]) ?? []);
    }
  }

  async function addMapping() {
    if (!mentorUserId || !studentPkId) {
      setToast({ variant: "error", message: "Select an Academic Mentor and Mentee" });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/academic-mentorship/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: schoolCode,
          academic_year: academicYear,
          mentor_user_id: Number(mentorUserId),
          student_id: Number(studentPkId),
        }),
      });
      const payload = await readJson(response);
      await refreshMappings();
      if (!response.ok) {
        setToast({ variant: "error", message: apiError(payload, "Failed to add Mapping") });
        return;
      }
      setMentorUserId("");
      setStudentPkId("");
      setToast({ variant: "success", message: "Mapping added." });
    } catch {
      setToast({ variant: "error", message: "Failed to add Mapping" });
    } finally {
      setBusy(false);
    }
  }

  async function uploadCsv() {
    if (!csvFile) {
      setToast({ variant: "error", message: "Select a CSV file" });
      return;
    }

    setBusy(true);
    setErrorCsv(null);
    try {
      const formData = new FormData();
      formData.set("school_code", schoolCode);
      formData.set("academic_year", academicYear);
      formData.set("file", csvFile);
      const response = await fetch("/api/academic-mentorship/mappings/import", {
        method: "POST",
        body: formData,
      });
      const payload = await readJson(response);
      if (!response.ok) {
        setErrorCsv(payloadErrorCsv(payload));
        setToast({ variant: "error", message: apiError(payload, "Failed to upload CSV") });
        return;
      }
      await refreshMappings();
      const insertedCount = payloadInsertedCount(payload);
      setToast({
        variant: "success",
        message: `Imported ${insertedCount} mapping${insertedCount === 1 ? "" : "s"}.`,
      });
    } catch {
      setToast({ variant: "error", message: "Failed to upload CSV" });
    } finally {
      setBusy(false);
    }
  }

  async function removeMapping(mappingId: number | string) {
    if (!window.confirm("This Student will no longer have an active Academic Mentor.")) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/academic-mentorship/mappings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: schoolCode,
          academic_year: academicYear,
          mapping_id: Number(mappingId),
        }),
      });
      const payload = await readJson(response);
      await refreshMappings();
      if (!response.ok) {
        setToast({ variant: "error", message: apiError(payload, "Failed to remove Mapping") });
        return;
      }
      setToast({ variant: "success", message: "Mapping removed." });
    } catch {
      setToast({ variant: "error", message: "Failed to remove Mapping" });
    } finally {
      setBusy(false);
    }
  }

  function startReassign(mappingId: number | string, currentMentorUserId: number) {
    setReassigning({ mappingId, currentMentorUserId });
    setReplacementMentorOptions([]);
    setReplacementMentorSearch("");
    setReplacementMentorUserId("");
  }

  function searchReplacementMentors(value: string) {
    setReplacementMentorSearch(value);
    void loadReplacementMentors(value);
  }

  async function reassignMapping() {
    if (!reassigning || !replacementMentorUserId) {
      setToast({ variant: "error", message: "Select a replacement Academic Mentor" });
      return;
    }
    if (!window.confirm("This will end the old Mapping and create a new Mapping.")) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/academic-mentorship/mappings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: schoolCode,
          academic_year: academicYear,
          mapping_id: Number(reassigning.mappingId),
          mentor_user_id: Number(replacementMentorUserId),
        }),
      });
      const payload = await readJson(response);
      await refreshMappings();
      if (!response.ok) {
        setToast({ variant: "error", message: apiError(payload, "Failed to reassign Mapping") });
        return;
      }
      setReassigning(null);
      setReplacementMentorUserId("");
      setToast({ variant: "success", message: "Mapping reassigned." });
    } catch {
      setToast({ variant: "error", message: "Failed to reassign Mapping" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {toast ? (
        <Toast
          variant={toast.variant}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      ) : null}

      {canEdit ? (
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
                  onChange={(event) => {
                    const value = event.target.value;
                    setMentorSearch(value);
                    void loadMentors(value);
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
                Academic Mentor
                <Select
                  value={mentorUserId}
                  onChange={(event) => setMentorUserId(event.target.value)}
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
                  onChange={(event) => {
                    const value = event.target.value;
                    setMenteeSearch(value);
                    void loadMentees(value);
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-text-primary">
                Mentee
                <Select
                  value={studentPkId}
                  onChange={(event) => setStudentPkId(event.target.value)}
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
            <Button type="button" onClick={() => void addMapping()} disabled={busy} className="self-end">
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
                onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void uploadCsv()}
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
      ) : null}

      <section className="mt-4 space-y-3">
        {groups.length === 0 ? (
          <Card className="border-dashed p-8 text-center text-sm text-text-muted">
            <div className="font-semibold text-text-primary">
              No Academic Mentor-Mentee Mappings found.
            </div>
            <p className="mt-1">Mappings will appear here after a manual add or CSV upload.</p>
          </Card>
        ) : (
          groups.map((group) => (
            <Card key={group.mentor.userId} className="overflow-hidden p-0">
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
                    onStartReassign={startReassign}
                    onRemove={(mappingId) => void removeMapping(mappingId)}
                    onReplacementMentorSearch={searchReplacementMentors}
                    onReplacementMentorSelect={setReplacementMentorUserId}
                    onConfirmReassign={() => void reassignMapping()}
                    onCancelReassign={() => setReassigning(null)}
                  />
                ))}
              </div>
            </Card>
          ))
        )}
      </section>
    </>
  );
}
