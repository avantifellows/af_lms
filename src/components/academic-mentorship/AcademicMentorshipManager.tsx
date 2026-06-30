"use client";

import { useState } from "react";

import Toast from "@/components/Toast";
import { Button, Card, Input, Select } from "@/components/ui";

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
  const [reassigning, setReassigning] = useState<{
    mappingId: number | string;
    currentMentorUserId: number;
  } | null>(null);
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
        if (
          payload &&
          typeof payload === "object" &&
          "errorCsv" in payload &&
          typeof payload.errorCsv === "string"
        ) {
          setErrorCsv(payload.errorCsv);
        }
        setToast({ variant: "error", message: apiError(payload, "Failed to upload CSV") });
        return;
      }
      await refreshMappings();
      const insertedCount =
        payload &&
        typeof payload === "object" &&
        "insertedCount" in payload &&
        typeof payload.insertedCount === "number"
          ? payload.insertedCount
          : 0;
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
        <Card className="mt-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-text-primary">
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
              <label className="grid gap-1 text-sm font-semibold text-text-primary">
                Academic Mentor
                <Select value={mentorUserId} onChange={(event) => setMentorUserId(event.target.value)}>
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
              <label className="grid gap-1 text-sm font-semibold text-text-primary">
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
              <label className="grid gap-1 text-sm font-semibold text-text-primary">
                Mentee
                <Select value={studentPkId} onChange={(event) => setStudentPkId(event.target.value)}>
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
              Add Mapping
            </Button>
          </div>
          <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-[auto_1fr_auto_auto]">
            <a
              href={templateHref}
              download="academic-mentorship-template.csv"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-bg-card px-4 text-sm font-medium text-text-primary shadow-sm hover:bg-hover-bg"
            >
              Download CSV template
            </a>
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
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

      <section className="mt-4 space-y-4">
        {groups.length === 0 ? (
          <Card className="p-6 text-sm text-text-muted">
            No Academic Mentor-Mentee Mappings found.
          </Card>
        ) : (
          groups.map((group) => (
            <Card key={group.mentor.userId} className="p-0">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-bold text-text-primary">{group.mentor.name}</h2>
                <p className="text-sm text-text-muted">
                  {group.menteeCount} mentee{group.menteeCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="divide-y divide-border">
                {group.mappings.map((mapping) => (
                  <div
                    key={String(mapping.id)}
                    className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_120px_140px_120px_160px]"
                  >
                    <div>
                      <div className="font-semibold text-text-primary">{mapping.mentee.name}</div>
                      <div className="text-sm text-text-muted">{mapping.mentee.studentId}</div>
                    </div>
                    <div className="text-sm text-text-muted">Grade {mapping.mentee.grade ?? "-"}</div>
                    <div className="text-sm text-text-muted">{mapping.assignedDate}</div>
                    <div className="text-sm font-semibold text-text-primary">
                      {mapping.status === "active" ? "Active" : "Historical"}
                      {includeHistory && mapping.endedDate ? (
                        <span className="block font-normal text-text-muted">
                          Ended {mapping.endedDate}
                        </span>
                      ) : null}
                    </div>
                    <div>
                      {canEdit && mapping.status === "active" ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => startReassign(mapping.id, group.mentor.userId)}
                            disabled={busy}
                          >
                            Reassign
                          </Button>
                          <Button
                            type="button"
                            variant="danger-ghost"
                            size="sm"
                            onClick={() => void removeMapping(mapping.id)}
                            disabled={busy}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {reassigning && String(reassigning.mappingId) === String(mapping.id) ? (
                      <div className="grid gap-3 rounded-lg border border-border bg-bg-card-alt p-3 md:col-span-5 md:grid-cols-[1fr_1fr_auto_auto]">
                        <label className="grid gap-1 text-sm font-semibold text-text-primary">
                          Search replacement mentor
                          <Input
                            value={replacementMentorSearch}
                            onChange={(event) => {
                              const value = event.target.value;
                              setReplacementMentorSearch(value);
                              void loadReplacementMentors(value);
                            }}
                          />
                        </label>
                        <label className="grid gap-1 text-sm font-semibold text-text-primary">
                          Replacement Academic Mentor
                          <Select
                            value={replacementMentorUserId}
                            onChange={(event) => setReplacementMentorUserId(event.target.value)}
                          >
                            <option value="">Select mentor</option>
                            {replacementMentorOptions
                              .filter(
                                (mentor) => mentor.userId !== reassigning.currentMentorUserId
                              )
                              .map((mentor) => (
                                <option key={mentor.userId} value={mentor.userId}>
                                  {mentor.name} ({mentor.email})
                                </option>
                              ))}
                          </Select>
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void reassignMapping()}
                          disabled={busy}
                          className="self-end"
                        >
                          Confirm Reassign
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setReassigning(null)}
                          disabled={busy}
                          className="self-end"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ))
        )}
      </section>
    </>
  );
}
