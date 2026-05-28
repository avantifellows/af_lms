"use client";

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

  function handleSchoolChange(schoolCode: string) {
    setSelectedSchoolCode(schoolCode);
    setMappings([]);
    setLoadState(schoolCode ? "loading" : "idle");
    closeAddForm();
  }

  function handleAcademicYearChange(academicYear: string) {
    setSelectedAcademicYear(academicYear);
    setMappings([]);
    setLoadState(selectedSchoolCode && academicYear ? "loading" : "idle");
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
              {canEdit ? <th className="w-24 px-4 py-3">Actions</th> : null}
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
                {canEdit ? <td className="px-4 py-3" aria-label="Mapping actions" /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
