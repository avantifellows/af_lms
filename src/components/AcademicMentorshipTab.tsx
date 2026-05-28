"use client";

import { useEffect, useMemo, useState } from "react";

import { getCurrentAcademicYear } from "@/lib/academic-year";

interface AcademicMentorshipMapping {
  id: number;
  mentor_id: number;
  mentor_name: string;
  mentor_email: string | null;
  mentee_id: number;
  mentee_name: string | null;
  mentee_grade: number | null;
  mentee_student_id: string | null;
  academic_year: string;
  created_by: string;
  inserted_at: string;
}

interface Props {
  schoolCode: string;
  canView: boolean;
  canEdit: boolean;
  role: string;
}

function MenteeRow({ mapping, showAction }: { mapping: AcademicMentorshipMapping; showAction: boolean }) {
  return (
    <div className="flex flex-col gap-3 border border-border bg-bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium text-text-primary">
          {mapping.mentee_name || `Student ${mapping.mentee_id}`}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
          <span>{mapping.mentee_grade ? `Grade ${mapping.mentee_grade}` : "Grade unavailable"}</span>
          {mapping.mentee_student_id && <span className="font-mono">{mapping.mentee_student_id}</span>}
        </div>
      </div>
      {showAction && (
        <button
          type="button"
          disabled
          title="Detailed view coming in a future release"
          className="self-start border border-border bg-bg-card-alt px-4 py-2 text-xs font-bold uppercase tracking-wide text-text-muted disabled:cursor-not-allowed disabled:opacity-70 sm:self-center"
        >
          Coming Soon
        </button>
      )}
    </div>
  );
}

export default function AcademicMentorshipTab({
  schoolCode,
  canView,
  canEdit,
  role,
}: Props) {
  void canEdit;
  const academicYear = useMemo(() => getCurrentAcademicYear(), []);
  const [mappings, setMappings] = useState<AcademicMentorshipMapping[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;

    let cancelled = false;
    async function fetchMappings() {
      try {
        const params = new URLSearchParams({
          school_code: schoolCode,
          academic_year: academicYear,
        });
        const response = await fetch(`/api/academic-mentorship?${params.toString()}`);
        if (!response.ok) throw new Error("Failed to fetch academic mentorship mappings");
        const data = (await response.json()) as { mappings?: AcademicMentorshipMapping[] };
        if (!cancelled) {
          setMappings(data.mappings ?? []);
        }
      } catch (err) {
        console.error("Failed to fetch academic mentorship mappings:", err);
        if (!cancelled) {
          setError("Failed to load academic mentorship data");
        }
      }
    }

    fetchMappings();
    return () => {
      cancelled = true;
    };
  }, [academicYear, canView, schoolCode]);

  if (!canView) return null;

  if (error) {
    return (
      <div className="border border-danger/20 bg-danger-bg p-4 text-danger">
        {error}
      </div>
    );
  }

  if (mappings === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-accent" />
        <span className="ml-3 text-text-secondary">Loading academic mentorship...</span>
      </div>
    );
  }

  if (mappings.length === 0) {
    return (
      <div className="border border-border bg-bg-card-alt p-6 text-center">
        <p className="text-text-muted">No mentees assigned for {academicYear}</p>
      </div>
    );
  }

  if (role === "teacher") {
    return (
      <div className="space-y-3">
        {mappings.map((mapping) => (
          <MenteeRow key={mapping.id} mapping={mapping} showAction />
        ))}
      </div>
    );
  }

  const groupedMappings = mappings.reduce<Map<number, AcademicMentorshipMapping[]>>(
    (groups, mapping) => {
      const existing = groups.get(mapping.mentor_id) ?? [];
      existing.push(mapping);
      groups.set(mapping.mentor_id, existing);
      return groups;
    },
    new Map()
  );

  return (
    <div className="space-y-4">
      {[...groupedMappings.entries()].map(([mentorId, mentorMappings]) => {
        const first = mentorMappings[0];
        return (
          <section key={mentorId} className="border border-border bg-bg-card p-5">
            <div className="mb-4">
              <h3 className="font-semibold text-text-primary">{first.mentor_name}</h3>
              {first.mentor_email && (
                <p className="mt-1 text-sm text-text-secondary">{first.mentor_email}</p>
              )}
            </div>
            <div className="space-y-3">
              {mentorMappings.map((mapping) => (
                <MenteeRow key={mapping.id} mapping={mapping} showAction={false} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
