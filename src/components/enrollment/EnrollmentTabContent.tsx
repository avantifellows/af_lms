"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload } from "lucide-react";
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
import type { Batch } from "@/components/EditStudentModal";
import { PROGRAM_IDS } from "@/lib/constants";
import { Button, Modal } from "@/components/ui";
import AddStudentModal from "./AddStudentModal";
import BulkStudentUploadModal from "./BulkStudentUploadModal";

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
  schoolUdise: string;
  schoolCode: string;
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
}: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(
    programs[0]?.id ?? null,
  );
  const [selectedGrade, setSelectedGrade] = useState<string>("all");
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

  const handleStudentCreated = (studentId: string | null, penNumber: string | null) => {
    setAddOpen(false);
    setCreatedStudentId(studentId);
    setCreatedPenNumber(penNumber);
    setCreatedOpen(true);
    router.refresh();
  };

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
            {createdStudentId && createdPenNumber
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
      <div className="max-w-3xl mx-auto mb-4 flex flex-wrap items-center gap-3 sm:gap-4">
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
          }}
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
        hideGradeFilterUI
      />

      <AddStudentModal
        open={addOpen}
        schoolUdise={schoolUdise}
        schoolCode={schoolCode}
        onClose={() => setAddOpen(false)}
        onCreated={handleStudentCreated}
      />
      <BulkStudentUploadModal
        open={bulkOpen}
        schoolUdise={schoolUdise}
        schoolCode={schoolCode}
        onClose={() => setBulkOpen(false)}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}
