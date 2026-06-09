"use client";

import { useEffect, useMemo, useState } from "react";
import StudentTable, { type Grade, type Student } from "@/components/StudentTable";
import EnrollmentStatsCards, {
  type ProgramStats,
} from "./EnrollmentStatsCards";
import { buildProgramStats } from "@/lib/enrollment-stats";
import {
  buildAdmissionSummary,
  isAdmissionGrade,
  type ConsentByStudentId,
} from "@/lib/enrollment-readiness";
import type { Batch } from "@/components/EditStudentModal";

interface Props {
  programs: ProgramStats[];
  activeStudents: Student[];
  dropoutStudents: Student[];
  canEdit: boolean;
  userProgramIds: number[] | null;
  isPasscodeUser: boolean;
  isAdmin: boolean;
  grades: Grade[];
  batches: Batch[];
  nvsStreams: string[];
  /** School code/UDISE used to fetch grade-11 consent status. */
  schoolCode: string;
}

export default function EnrollmentTabContent({
  programs,
  activeStudents,
  dropoutStudents,
  canEdit,
  userProgramIds,
  isPasscodeUser,
  isAdmin,
  grades,
  batches,
  nvsStreams,
  schoolCode,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(
    programs[0]?.id ?? null
  );
  const [selectedGrade, setSelectedGrade] = useState<string>("all");

  // Consent status for the school's grade-11 students, keyed by student_pk_id.
  // Fetched client-side so the (default) enrollment tab isn't blocked on the
  // per-student document lookups.
  const [consent, setConsent] = useState<ConsentByStudentId>({});
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentError, setConsentError] = useState(false);
  // Bumped after a save/upload in the roster so the consent map refetches and
  // the flags/summary update without a full page reload.
  const [consentReloadKey, setConsentReloadKey] = useState(0);

  // Refetch when the school changes or after an upload. State is only mutated
  // inside async callbacks (not synchronously in the effect body) to avoid
  // cascading renders.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/schools/${encodeURIComponent(schoolCode)}/consent-status`)
      .then((res) => {
        if (!res.ok) throw new Error(`consent-status ${res.status}`);
        return res.json();
      })
      .then((data: { consent: ConsentByStudentId }) => {
        if (cancelled) return;
        setConsent(data.consent ?? {});
        setConsentError(false);
      })
      .catch(() => {
        if (!cancelled) setConsentError(true);
      })
      .finally(() => {
        if (!cancelled) setConsentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolCode, consentReloadKey]);

  const filteredActive = useMemo(() => {
    if (selectedId == null) return [];
    return activeStudents.filter((s) => Number(s.program_id) === selectedId);
  }, [activeStudents, selectedId]);

  const filteredDropouts = useMemo(() => {
    if (selectedId == null) return [];
    return dropoutStudents.filter((s) => Number(s.program_id) === selectedId);
  }, [dropoutStudents, selectedId]);

  // Grades present in the selected program's active students, for the filter
  // dropdown. The pills + table both react to the selected grade.
  const gradeOptions = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of filteredActive) {
      if (s.grade != null) counts.set(s.grade, (counts.get(s.grade) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => a.grade - b.grade);
  }, [filteredActive]);

  // Recompute the program pills scoped to the selected grade so every number
  // (total, gender, category) corresponds to the applied program + grade.
  const scopedPrograms = useMemo(() => {
    const scopedActive =
      selectedGrade === "all"
        ? activeStudents
        : activeStudents.filter((s) => s.grade === Number(selectedGrade));
    return programs.map((p) => buildProgramStats(scopedActive, p.id));
  }, [programs, activeStudents, selectedGrade]);

  // Active students of the selected program after the grade filter — drives
  // the "Showing X of Y" hint next to the dropdown.
  const gradeFilteredActiveCount = useMemo(() => {
    if (selectedGrade === "all") return filteredActive.length;
    return filteredActive.filter((s) => s.grade === Number(selectedGrade))
      .length;
  }, [filteredActive, selectedGrade]);

  // Admission summary, scoped to the grade filter:
  //  • "all"  → combined across admission grades (11 & 12)
  //  • "11"/"12" → just that grade
  //  • a non-admission grade (9/10) → null (admission tracking doesn't apply)
  const admissionSummary = useMemo(() => {
    const gradeNum = selectedGrade === "all" ? null : Number(selectedGrade);
    if (gradeNum != null && !isAdmissionGrade(gradeNum)) return null;
    const inScope = filteredActive.filter((s) =>
      gradeNum == null ? isAdmissionGrade(s.grade) : s.grade === gradeNum,
    );
    return buildAdmissionSummary(inScope, consent);
  }, [filteredActive, consent, selectedGrade]);

  return (
    <>
      {/* Grade filter — placed above the summary so it's clear the pills react
          to it. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 sm:gap-4">
        <label
          htmlFor="gradeFilter"
          className="text-sm font-medium text-gray-700"
        >
          Filter by Grade:
        </label>
        <select
          id="gradeFilter"
          value={selectedGrade}
          onChange={(e) => setSelectedGrade(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
        >
          <option value="all">All Grades ({filteredActive.length})</option>
          {gradeOptions.map(({ grade, count }) => (
            <option key={grade} value={grade}>
              Grade {grade} ({count})
            </option>
          ))}
        </select>
        {selectedGrade !== "all" && (
          <span className="text-sm text-gray-500">
            Showing {gradeFilteredActiveCount} of {filteredActive.length}{" "}
            students
          </span>
        )}
      </div>

      {selectedId != null && (
        <EnrollmentStatsCards
          programs={scopedPrograms}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setSelectedGrade("all");
          }}
          admission={admissionSummary}
          consentLoading={consentLoading}
          consentError={consentError}
        />
      )}

      <StudentTable
        students={filteredActive}
        dropoutStudents={filteredDropouts}
        canEdit={canEdit}
        userProgramIds={userProgramIds}
        isPasscodeUser={isPasscodeUser}
        isAdmin={isAdmin}
        grades={grades}
        batches={batches}
        nvsStreams={nvsStreams}
        selectedGrade={selectedGrade}
        onGradeChange={setSelectedGrade}
        hideGradeFilterUI
        consentByStudentId={consent}
        consentLoading={consentLoading}
        onDataChanged={() => setConsentReloadKey((k) => k + 1)}
      />
    </>
  );
}
