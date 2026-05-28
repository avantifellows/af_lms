"use client";

import { ArrowLeftRight, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { getAcademicYearChoices } from "@/lib/academic-year";
import type { UserRole } from "@/lib/permissions";

interface SchoolOption {
  code: string;
  name: string;
}

interface AcademicMentorshipAdminProps {
  schools: SchoolOption[];
  canView: boolean;
  canEdit: boolean;
  role: UserRole;
}

interface AcademicMentorshipMapping {
  id: number;
  mentor_id?: number;
  mentor_name: string | null;
  mentee_name: string | null;
  mentee_grade: number | null;
  mentee_student_id: string | null;
  created_by: string;
  inserted_at: string;
}

interface MentorOption {
  id: number;
  email: string;
  full_name: string | null;
}

interface MenteeOption {
  id: number;
  name: string | null;
  grade: number | null;
  student_id: string | null;
}

type LoadState = "idle" | "loading" | "loaded" | "error";
type AddFormState = "idle" | "loading" | "ready" | "error";
type ReassignFormState = "idle" | "loading" | "ready" | "error";

function formatAssignedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function AcademicMentorshipAdmin({
  schools,
  canView,
  canEdit,
  role,
}: AcademicMentorshipAdminProps) {
  const academicYears = getAcademicYearChoices();
  const [selectedSchoolCode, setSelectedSchoolCode] = useState("");
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(academicYears[0] ?? "");
  const [mappings, setMappings] = useState<AcademicMentorshipMapping[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [reloadCount, setReloadCount] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [mentorOptions, setMentorOptions] = useState<MentorOption[]>([]);
  const [menteeOptions, setMenteeOptions] = useState<MenteeOption[]>([]);
  const [selectedMentorEmail, setSelectedMentorEmail] = useState("");
  const [selectedMenteeId, setSelectedMenteeId] = useState("");
  const [addFormState, setAddFormState] = useState<AddFormState>("idle");
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unassignTarget, setUnassignTarget] = useState<AcademicMentorshipMapping | null>(null);
  const [reassignTarget, setReassignTarget] = useState<AcademicMentorshipMapping | null>(null);
  const [reassignMentorOptions, setReassignMentorOptions] = useState<MentorOption[]>([]);
  const [selectedReassignMentorEmail, setSelectedReassignMentorEmail] = useState("");
  const [reassignFormState, setReassignFormState] = useState<ReassignFormState>("idle");
  const [actionError, setActionError] = useState("");
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);

  useEffect(() => {
    if (!selectedSchoolCode || !selectedAcademicYear) {
      return;
    }

    let ignore = false;
    const params = new URLSearchParams({
      school_code: selectedSchoolCode,
      academic_year: selectedAcademicYear,
    });

    fetch(`/api/academic-mentorship?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load mappings");
        return response.json() as Promise<{ mappings?: AcademicMentorshipMapping[] }>;
      })
      .then((data) => {
        if (ignore) return;
        setMappings(data.mappings ?? []);
        setLoadState("loaded");
      })
      .catch(() => {
        if (ignore) return;
        setMappings([]);
        setLoadState("error");
      });

    return () => {
      ignore = true;
    };
  }, [selectedSchoolCode, selectedAcademicYear, reloadCount]);

  useEffect(() => {
    if (!showAddForm || !selectedSchoolCode || !selectedAcademicYear) {
      return;
    }

    let ignore = false;
    setAddFormState("loading");
    setAddError("");
    setAddSuccess("");
    setSelectedMentorEmail("");
    setSelectedMenteeId("");

    const mentorParams = new URLSearchParams({ school_code: selectedSchoolCode });
    const menteeParams = new URLSearchParams({
      school_code: selectedSchoolCode,
      academic_year: selectedAcademicYear,
    });

    Promise.all([
      fetch(`/api/academic-mentorship/eligible-mentors?${mentorParams.toString()}`, {
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) throw new Error("Failed to load mentors");
        return response.json() as Promise<{ mentors?: MentorOption[] }>;
      }),
      fetch(`/api/academic-mentorship/unassigned-mentees?${menteeParams.toString()}`, {
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) throw new Error("Failed to load mentees");
        return response.json() as Promise<{ students?: MenteeOption[] }>;
      }),
    ])
      .then(([mentorData, menteeData]) => {
        if (ignore) return;
        setMentorOptions(mentorData.mentors ?? []);
        setMenteeOptions(menteeData.students ?? []);
        setAddFormState("ready");
      })
      .catch(() => {
        if (ignore) return;
        setMentorOptions([]);
        setMenteeOptions([]);
        setAddFormState("error");
        setAddError("Unable to load add mapping options");
      });

    return () => {
      ignore = true;
    };
  }, [showAddForm, selectedSchoolCode, selectedAcademicYear]);

  useEffect(() => {
    if (!reassignTarget || !selectedSchoolCode) {
      return;
    }

    let ignore = false;
    setReassignFormState("loading");
    setActionError("");
    setSelectedReassignMentorEmail("");

    const mentorParams = new URLSearchParams({ school_code: selectedSchoolCode });
    fetch(`/api/academic-mentorship/eligible-mentors?${mentorParams.toString()}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load mentors");
        return response.json() as Promise<{ mentors?: MentorOption[] }>;
      })
      .then((data) => {
        if (ignore) return;
        setReassignMentorOptions(
          (data.mentors ?? []).filter((mentor) => mentor.id !== reassignTarget.mentor_id)
        );
        setReassignFormState("ready");
      })
      .catch(() => {
        if (ignore) return;
        setReassignMentorOptions([]);
        setReassignFormState("error");
        setActionError("Unable to load mentor options");
      });

    return () => {
      ignore = true;
    };
  }, [reassignTarget, selectedSchoolCode]);

  function handleSchoolChange(schoolCode: string) {
    setSelectedSchoolCode(schoolCode);
    setMappings([]);
    setLoadState(schoolCode ? "loading" : "idle");
    setUnassignTarget(null);
    setReassignTarget(null);
    setActionError("");
    closeAddForm();
  }

  function handleAcademicYearChange(academicYear: string) {
    setSelectedAcademicYear(academicYear);
    setMappings([]);
    setLoadState(selectedSchoolCode && academicYear ? "loading" : "idle");
    setUnassignTarget(null);
    setReassignTarget(null);
    setActionError("");
    closeAddForm();
  }

  function openAddForm() {
    if (!selectedSchoolCode) {
      setAddSuccess("");
      setAddError("Select a school before adding a mapping");
      return;
    }
    setShowAddForm(true);
  }

  function closeAddForm() {
    setShowAddForm(false);
    setMentorOptions([]);
    setMenteeOptions([]);
    setSelectedMentorEmail("");
    setSelectedMenteeId("");
    setAddFormState("idle");
    setAddError("");
  }

  async function handleAddMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddError("");
    setAddSuccess("");

    if (!selectedSchoolCode || !selectedAcademicYear || !selectedMentorEmail || !selectedMenteeId) {
      setAddError("Select a mentor and mentee");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/academic-mentorship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: selectedSchoolCode,
          mentor_email: selectedMentorEmail,
          mentee_user_id: Number(selectedMenteeId),
          academic_year: selectedAcademicYear,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Unable to add mapping");
      }

      closeAddForm();
      setAddSuccess("Mapping added");
      setLoadState("loading");
      setReloadCount((count) => count + 1);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Unable to add mapping");
    } finally {
      setIsSubmitting(false);
    }
  }

  function closeReassignModal() {
    setReassignTarget(null);
    setReassignMentorOptions([]);
    setSelectedReassignMentorEmail("");
    setReassignFormState("idle");
    setActionError("");
  }

  async function handleConfirmUnassign() {
    if (!unassignTarget || !selectedSchoolCode) return;

    setActionError("");
    setIsActionSubmitting(true);
    try {
      const params = new URLSearchParams({ school_code: selectedSchoolCode });
      const response = await fetch(
        `/api/academic-mentorship/${unassignTarget.id}?${params.toString()}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Unable to unassign mentee");
      }

      setUnassignTarget(null);
      setAddSuccess("Mentee unassigned");
      setLoadState("loading");
      setReloadCount((count) => count + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to unassign mentee");
    } finally {
      setIsActionSubmitting(false);
    }
  }

  async function handleConfirmReassign() {
    if (!reassignTarget || !selectedSchoolCode || !selectedReassignMentorEmail) {
      setActionError("Select a new mentor");
      return;
    }

    setActionError("");
    setIsActionSubmitting(true);
    try {
      const response = await fetch("/api/academic-mentorship/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: selectedSchoolCode,
          old_mapping_id: reassignTarget.id,
          new_mentor_email: selectedReassignMentorEmail,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Unable to reassign mentee");
      }

      closeReassignModal();
      setAddSuccess("Mapping reassigned");
      setLoadState("loading");
      setReloadCount((count) => count + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to reassign mentee");
    } finally {
      setIsActionSubmitting(false);
    }
  }

  const messageColSpan = canEdit ? 7 : 6;

  return (
    <section
      className="space-y-4"
      data-can-view={canView}
      data-can-edit={canEdit}
      data-role={role}
    >
      <div className="rounded-lg border border-border bg-bg-card p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_180px]">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              School
            </span>
            <select
              value={selectedSchoolCode}
              onChange={(event) => handleSchoolChange(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border-2 border-border px-3 py-2.5 text-sm"
            >
              <option value="">Select a school</option>
              {schools.map((school) => (
                <option key={school.code} value={school.code}>
                  {school.name} ({school.code})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
              Academic Year
            </span>
            <select
              value={selectedAcademicYear}
              onChange={(event) => handleAcademicYearChange(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border-2 border-border px-3 py-2.5 text-sm"
            >
              {academicYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          {canEdit ? (
            <div aria-label="Mutation controls" className="flex items-end justify-start md:justify-end">
              <button
                type="button"
                onClick={openAddForm}
                className="min-h-[44px] rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add Mapping
              </button>
            </div>
          ) : null}
        </div>

        {addSuccess ? (
          <div className="mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            {addSuccess}
          </div>
        ) : null}

        {addError && !showAddForm ? (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {addError}
          </div>
        ) : null}

        {showAddForm ? (
          <form
            onSubmit={handleAddMapping}
            className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
          >
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                Mentor
              </span>
              <select
                value={selectedMentorEmail}
                onChange={(event) => setSelectedMentorEmail(event.target.value)}
                disabled={addFormState !== "ready" || isSubmitting}
                className="min-h-[44px] w-full rounded-lg border-2 border-border px-3 py-2.5 text-sm"
              >
                <option value="">Select a mentor</option>
                {mentorOptions.map((mentor) => (
                  <option key={mentor.id} value={mentor.email}>
                    {(mentor.full_name?.trim() || mentor.email)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                Mentee
              </span>
              <select
                value={selectedMenteeId}
                onChange={(event) => setSelectedMenteeId(event.target.value)}
                disabled={addFormState !== "ready" || isSubmitting}
                className="min-h-[44px] w-full rounded-lg border-2 border-border px-3 py-2.5 text-sm"
              >
                <option value="">Select a mentee</option>
                {menteeOptions.map((mentee) => (
                  <option key={mentee.id} value={String(mentee.id)}>
                    {`${mentee.name ?? "Unnamed student"} | Grade ${mentee.grade ?? "-"} | ${
                      mentee.student_id ?? "-"
                    }`}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={addFormState !== "ready" || isSubmitting}
                className="min-h-[44px] rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Adding..." : "Add"}
              </button>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={closeAddForm}
                disabled={isSubmitting}
                className="min-h-[44px] rounded-lg border-2 border-border px-4 py-2 text-sm font-bold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>

            {addFormState === "loading" ? (
              <div className="text-sm text-text-muted md:col-span-4">Loading options...</div>
            ) : null}
            {addError ? (
              <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger md:col-span-4">
                {addError}
              </div>
            ) : null}
          </form>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
        <table className="min-w-full table-fixed divide-y divide-border text-sm">
          <thead className="bg-bg-card-alt text-left text-xs font-bold uppercase tracking-wide text-text-muted">
            <tr>
              <th className="w-1/5 px-4 py-3">Mentor Name</th>
              <th className="w-1/5 px-4 py-3">Mentee Name</th>
              <th className="w-24 px-4 py-3">Mentee Grade</th>
              <th className="w-32 px-4 py-3">Mentee Student ID</th>
              <th className="w-1/5 px-4 py-3">Created By</th>
              <th className="w-36 px-4 py-3">Assigned Date</th>
              {canEdit ? <th className="w-28 px-4 py-3">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {!selectedSchoolCode ? (
              <tr>
                <td colSpan={messageColSpan} className="px-4 py-8 text-center text-text-muted">
                  Select a school to view mappings
                </td>
              </tr>
            ) : null}
            {selectedSchoolCode && loadState === "loading" ? (
              <tr>
                <td colSpan={messageColSpan} className="px-4 py-8 text-center text-text-muted">
                  Loading mappings...
                </td>
              </tr>
            ) : null}
            {selectedSchoolCode && loadState === "error" ? (
              <tr>
                <td colSpan={messageColSpan} className="px-4 py-8 text-center text-danger">
                  Unable to load mappings
                </td>
              </tr>
            ) : null}
            {selectedSchoolCode && loadState === "loaded" && mappings.length === 0 ? (
              <tr>
                <td colSpan={messageColSpan} className="px-4 py-8 text-center text-text-muted">
                  No mappings found
                </td>
              </tr>
            ) : null}
            {mappings.map((mapping) => (
              <tr key={mapping.id} className="border-t border-border">
                <td className="px-4 py-3 text-text-primary">{mapping.mentor_name ?? "-"}</td>
                <td className="px-4 py-3 text-text-primary">{mapping.mentee_name ?? "-"}</td>
                <td className="px-4 py-3 text-text-primary">{mapping.mentee_grade ?? "-"}</td>
                <td className="px-4 py-3 font-mono text-text-primary">
                  {mapping.mentee_student_id ?? "-"}
                </td>
                <td className="px-4 py-3 text-text-primary">{mapping.created_by}</td>
                <td className="px-4 py-3 text-text-primary">
                  {formatAssignedDate(mapping.inserted_at)}
                </td>
                {canEdit ? (
                  <td className="px-4 py-3" aria-label="Mapping actions">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Reassign ${mapping.mentee_name ?? "mentee"}`}
                        title="Reassign"
                        onClick={() => {
                          setActionError("");
                          setReassignTarget(mapping);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-primary hover:bg-bg-card-alt focus:outline-none focus:ring-2 focus:ring-accent/40"
                      >
                        <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Unassign ${mapping.mentee_name ?? "mentee"}`}
                        title="Unassign"
                        onClick={() => {
                          setActionError("");
                          setUnassignTarget(mapping);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-danger hover:bg-danger/10 focus:outline-none focus:ring-2 focus:ring-danger/40"
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unassignTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Unassign mentee"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-card p-5 shadow-xl">
            <h2 className="text-lg font-bold text-text-primary">Unassign mentee</h2>
            <p className="mt-3 text-sm text-text-primary">
              {`Unassign ${unassignTarget.mentee_name ?? "this mentee"} from ${
                unassignTarget.mentor_name ?? "this mentor"
              }?`}
            </p>
            {actionError ? (
              <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {actionError}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setUnassignTarget(null);
                  setActionError("");
                }}
                disabled={isActionSubmitting}
                className="min-h-[40px] rounded-lg border-2 border-border px-4 py-2 text-sm font-bold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUnassign}
                disabled={isActionSubmitting}
                className="min-h-[40px] rounded-lg bg-danger px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isActionSubmitting ? "Unassigning..." : "Confirm Unassign"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reassignTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reassign mentee"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-card p-5 shadow-xl">
            <h2 className="text-lg font-bold text-text-primary">Reassign mentee</h2>
            <p className="mt-3 text-sm text-text-primary">
              {`Select a new mentor for ${reassignTarget.mentee_name ?? "this mentee"}.`}
            </p>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                New mentor
              </span>
              <select
                value={selectedReassignMentorEmail}
                onChange={(event) => setSelectedReassignMentorEmail(event.target.value)}
                disabled={reassignFormState !== "ready" || isActionSubmitting}
                className="min-h-[44px] w-full rounded-lg border-2 border-border px-3 py-2.5 text-sm"
              >
                <option value="">Select a mentor</option>
                {reassignMentorOptions.map((mentor) => (
                  <option key={mentor.id} value={mentor.email}>
                    {mentor.full_name?.trim() || mentor.email}
                  </option>
                ))}
              </select>
            </label>
            {reassignFormState === "loading" ? (
              <div className="mt-3 text-sm text-text-muted">Loading mentors...</div>
            ) : null}
            {actionError ? (
              <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {actionError}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeReassignModal}
                disabled={isActionSubmitting}
                className="min-h-[40px] rounded-lg border-2 border-border px-4 py-2 text-sm font-bold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReassign}
                disabled={
                  reassignFormState !== "ready" ||
                  isActionSubmitting ||
                  !selectedReassignMentorEmail
                }
                className="min-h-[40px] rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isActionSubmitting ? "Reassigning..." : "Reassign"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
