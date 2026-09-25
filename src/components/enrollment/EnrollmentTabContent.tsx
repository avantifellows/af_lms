"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, Upload } from "lucide-react";
import StudentTable, {
  type Grade,
  type Student,
} from "@/components/StudentTable";
import EnrollmentStatsCards, {
  type ProgramStats,
} from "./EnrollmentStatsCards";
import {
  buildProgramStats,
  studentDroppedFromProgram,
  studentHasCurrentProgram,
} from "@/lib/enrollment-stats";
import {
  buildAdmissionSummary,
  isAdmissionGrade,
  type ConsentByStudentId,
} from "@/lib/enrollment-readiness";
import type { Batch } from "@/components/EditStudentModal";
import { PROGRAM_IDS } from "@/lib/constants";
import {
  ACTIVE_REGISTRATION_MODE,
  PHONE_REGISTRATION_MODE,
  type RegistrationMode,
} from "@/lib/registration-mode";
import { Button, Modal } from "@/components/ui";
import type { InterventionFlag } from "@/lib/intervention-flag-types";
import AddStudentModal from "./AddStudentModal";
import InterventionFlagModal from "./InterventionFlagModal";
import BulkStudentUploadModal from "./BulkStudentUploadModal";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

function groupFlagsByStudent(flags: InterventionFlag[]) {
  const byStudent = new Map<string, InterventionFlag[]>();
  for (const flag of flags) {
    const list = byStudent.get(flag.student_pk_id) ?? [];
    list.push(flag);
    byStudent.set(flag.student_pk_id, list);
  }
  return byStudent;
}

interface Props {
  programs: ProgramStats[];
  activeStudents: Student[];
  dropoutStudents: Student[];
  canEdit: boolean;
  canEditStudent: boolean;
  canDropoutStudent?: boolean;
  dropoutProgramIds?: number[];
  canAddStudent: boolean;
  userProgramIds: number[] | null;
  isPasscodeUser: boolean;
  isAdmin: boolean;
  grades: Grade[];
  batches: Batch[];
  nvsStreams: string[];
  /** School UDISE used by the student write and export routes. */
  schoolUdise: string;
  /** School code/UDISE used to fetch grade 11/12 consent status. */
  schoolCode: string;
  /** Code-controlled Registration Mode; defaults to the active mode. */
  registrationMode?: RegistrationMode;
  /** Viewer may see and raise intervention flags (see lib/intervention-flags). */
  canUseInterventionFlags?: boolean;
}

// fallow-ignore-next-line complexity
export default function EnrollmentTabContent({
  programs,
  activeStudents,
  dropoutStudents,
  canEdit,
  canEditStudent,
  canDropoutStudent = false,
  dropoutProgramIds,
  canAddStudent,
  userProgramIds,
  isPasscodeUser,
  isAdmin,
  grades,
  batches,
  nvsStreams,
  schoolUdise,
  schoolCode,
  registrationMode = ACTIVE_REGISTRATION_MODE,
  canUseInterventionFlags = false,
}: Props) {
  const phoneMode = registrationMode === PHONE_REGISTRATION_MODE;
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(
    programs[0]?.id ?? null,
  );
  const [selectedGrade, setSelectedGrade] = useState<string>("all");
  const [selectedStream, setSelectedStream] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [createdStudentId, setCreatedStudentId] = useState<string | null>(null);
  const [createdPenNumber, setCreatedPenNumber] = useState<string | null>(null);
  const [createdOpen, setCreatedOpen] = useState(false);
  const selectedProgramId = programs.some(
    (program) => program.id === selectedId,
  )
    ? selectedId
    : (programs[0]?.id ?? null);

  // Consent status for the school's grade 11/12 students, keyed by
  // student_pk_id. Fetched client-side so the (default) enrollment tab isn't
  // blocked on the per-student document lookups.
  const [consent, setConsent] = useState<ConsentByStudentId>({});
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentError, setConsentError] = useState(false);
  // Bumped after a save/upload in the roster so the consent map refetches and
  // the admission summary updates without a full page reload.
  const [consentReloadKey, setConsentReloadKey] = useState(0);

  // Refetch when the school changes or after an upload. State is only mutated
  // inside async callbacks (not synchronously in the effect body) to avoid
  // cascading renders.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ consent: ConsentByStudentId }>(
      `/api/schools/${encodeURIComponent(schoolCode)}/consent-status`,
    )
      .then((data) => {
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

  // Intervention flags for the school, keyed by student_pk_id (newest first).
  const [flagsByStudent, setFlagsByStudent] = useState<
    Map<string, InterventionFlag[]>
  >(new Map());
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [flagStudent, setFlagStudent] = useState<Student | null>(null);
  const flagsUrl = `/api/schools/${encodeURIComponent(schoolCode)}/intervention-flags`;

  useEffect(() => {
    if (!canUseInterventionFlags) return;
    let cancelled = false;
    fetchJson<{ flags: InterventionFlag[] }>(flagsUrl)
      .then((data) => {
        if (!cancelled) setFlagsByStudent(groupFlagsByStudent(data.flags ?? []));
      })
      // A failed fetch leaves the roster usable, just without flag markers.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canUseInterventionFlags, flagsUrl]);

  // Called by the flag dialog after a write (or a 409) and awaited, so the
  // dialog only leaves its saving state once it shows the refreshed flag.
  const reloadFlags = useCallback(async () => {
    try {
      const data = await fetchJson<{ flags: InterventionFlag[] }>(flagsUrl);
      setFlagsByStudent(groupFlagsByStudent(data.flags ?? []));
    } catch {
      // Keep the current flags; the next page load refetches.
    }
  }, [flagsUrl]);

  const openFlagStudentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, flags] of flagsByStudent) {
      if (flags.some((flag) => flag.status === "open")) ids.add(id);
    }
    return ids;
  }, [flagsByStudent]);

  const filteredActive = useMemo(() => {
    if (selectedProgramId == null) return [];
    return activeStudents.filter((s) =>
      studentHasCurrentProgram(s, selectedProgramId),
    );
  }, [activeStudents, selectedProgramId]);

  const filteredDropouts = useMemo(() => {
    if (selectedProgramId == null) return [];
    return dropoutStudents.filter((s) =>
      studentDroppedFromProgram(s, selectedProgramId),
    );
  }, [dropoutStudents, selectedProgramId]);

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

  const streamOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of filteredActive) {
      const stream = student.stream?.trim();
      if (stream) counts.set(stream, (counts.get(stream) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredActive]);

  // Recompute the program pills scoped to the selected grade so every number
  // (total, gender, category) corresponds to the applied program + grade.
  const scopedPrograms = useMemo(() => {
    const scopedActive = activeStudents.filter(
      (student) =>
        (selectedGrade === "all" || student.grade === Number(selectedGrade)) &&
        (selectedStream === "all" ||
          student.stream?.toLowerCase() === selectedStream.toLowerCase()),
    );
    return programs.map((p) => buildProgramStats(scopedActive, p.id));
  }, [programs, activeStudents, selectedGrade, selectedStream]);

  // Active students of the selected program after the grade and stream
  // filters. Drives the flag count and the "Showing X of Y" hint.
  const gradeStreamActive = useMemo(
    () =>
      filteredActive.filter(
        (student) =>
          (selectedGrade === "all" ||
            student.grade === Number(selectedGrade)) &&
          (selectedStream === "all" ||
            student.stream?.toLowerCase() === selectedStream.toLowerCase()),
      ),
    [filteredActive, selectedGrade, selectedStream],
  );
  const flaggedCount = gradeStreamActive.filter(
    (s) => s.student_pk_id && openFlagStudentIds.has(s.student_pk_id),
  ).length;
  const flagFilterOn = canUseInterventionFlags && flaggedOnly;
  const activeFilteredCount = flagFilterOn ? flaggedCount : gradeStreamActive.length;

  const showAddStudent = canAddStudent && selectedProgramId === PROGRAM_IDS.NVS;

  const closeCreatedModal = () => {
    setCreatedOpen(false);
    setCreatedStudentId(null);
    setCreatedPenNumber(null);
  };

  const handleAddAnother = () => {
    closeCreatedModal();
    setAddOpen(true);
  };

  const handleStudentCreated = (
    studentId: string | null,
    penNumber: string | null,
  ) => {
    setAddOpen(false);
    setCreatedStudentId(studentId);
    setCreatedPenNumber(penNumber);
    setCreatedOpen(true);
    router.refresh();
  };

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
      <Modal open={createdOpen} onClose={closeCreatedModal} className="p-0">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-text-primary">
            {createdStudentId
              ? `Student successfully added with ${createdStudentId}`
              : "Student successfully added"}
          </h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-text-secondary">
            {phoneMode
              ? "Parent phone number is the Student ID. Portal login remains Student ID + Date of Birth; enter the phone number as the Student ID."
              : createdStudentId && createdPenNumber
                ? "Student can login using either Student ID or PEN + DoB"
                : createdStudentId
                  ? "Student can login using their Student ID + DoB"
                  : "Student can login using their PEN + DoB"}
          </p>
        </div>
        <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
          <Button type="button" variant="secondary" onClick={closeCreatedModal}>
            Close
          </Button>
          <Button type="button" onClick={handleAddAnother}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add another student
          </Button>
        </div>
      </Modal>
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
        <label
          htmlFor="streamFilter"
          className="text-sm font-medium text-gray-700"
        >
          Filter by Stream:
        </label>
        <select
          id="streamFilter"
          value={selectedStream}
          onChange={(event) => setSelectedStream(event.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
        >
          <option value="all">All Streams ({filteredActive.length})</option>
          {streamOptions.map(([stream, count]) => (
            <option key={stream} value={stream}>
              {stream} ({count})
            </option>
          ))}
        </select>
        {canUseInterventionFlags && (
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(event) => setFlaggedOnly(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
            />
            Needs intervention only ({flaggedCount})
          </label>
        )}
        {(selectedGrade !== "all" || selectedStream !== "all" || flagFilterOn) && (
          <span className="text-sm text-gray-500">
            Showing {activeFilteredCount} of {filteredActive.length} students
          </span>
        )}
        {showAddStudent && (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setBulkOpen(true)}
              className="ml-auto"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Bulk Upload
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const params = new URLSearchParams();
                if (selectedGrade !== "all") params.set("grade", selectedGrade);
                if (selectedStream !== "all")
                  params.set("stream", selectedStream);
                window.location.assign(
                  `/api/school/${encodeURIComponent(schoolUdise)}/students/export${params.size ? `?${params}` : ""}`,
                );
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download List
            </Button>
            <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Student
            </Button>
          </>
        )}
      </div>

      {selectedProgramId != null && (
        <EnrollmentStatsCards
          programs={scopedPrograms}
          selectedId={selectedProgramId}
          onSelect={(id) => {
            setSelectedId(id);
            setSelectedGrade("all");
            setSelectedStream("all");
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
        canEditStudent={canEditStudent}
        canDropoutStudent={canDropoutStudent}
        selectedProgramId={selectedProgramId}
        dropoutProgramIds={dropoutProgramIds}
        userProgramIds={userProgramIds}
        isPasscodeUser={isPasscodeUser}
        isAdmin={isAdmin}
        grades={grades}
        batches={batches}
        nvsStreams={nvsStreams}
        selectedGrade={selectedGrade}
        onGradeChange={setSelectedGrade}
        selectedStream={selectedStream}
        hideGradeFilterUI
        onDataChanged={() => setConsentReloadKey((k) => k + 1)}
        openFlagStudentIds={canUseInterventionFlags ? openFlagStudentIds : undefined}
        onOpenInterventionFlag={canUseInterventionFlags ? setFlagStudent : undefined}
        flaggedOnly={flagFilterOn}
      />

      {flagStudent?.student_pk_id && (
        <InterventionFlagModal
          open
          onClose={() => setFlagStudent(null)}
          onChanged={reloadFlags}
          schoolCode={schoolCode}
          studentPkId={flagStudent.student_pk_id}
          studentName={
            [flagStudent.first_name, flagStudent.last_name]
              .filter(Boolean)
              .join(" ") || "Student"
          }
          flags={flagsByStudent.get(flagStudent.student_pk_id) ?? []}
        />
      )}

      <AddStudentModal
        open={addOpen}
        schoolUdise={schoolUdise}
        schoolCode={schoolCode}
        registrationMode={registrationMode}
        onClose={() => setAddOpen(false)}
        onCreated={handleStudentCreated}
      />
      <BulkStudentUploadModal
        open={bulkOpen}
        schoolUdise={schoolUdise}
        schoolCode={schoolCode}
        registrationMode={registrationMode}
        onClose={() => setBulkOpen(false)}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}
