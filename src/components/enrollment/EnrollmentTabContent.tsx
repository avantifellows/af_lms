"use client";

import { useMemo, useState } from "react";
import StudentTable, { type Grade, type Student } from "@/components/StudentTable";
import EnrollmentStatsCards, {
  type ProgramStats,
} from "./EnrollmentStatsCards";
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
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(
    programs[0]?.id ?? null
  );

  const filteredActive = useMemo(() => {
    if (selectedId == null) return [];
    return activeStudents.filter((s) => Number(s.program_id) === selectedId);
  }, [activeStudents, selectedId]);

  const filteredDropouts = useMemo(() => {
    if (selectedId == null) return [];
    return dropoutStudents.filter((s) => Number(s.program_id) === selectedId);
  }, [dropoutStudents, selectedId]);

  return (
    <>
      {selectedId != null && (
        <EnrollmentStatsCards
          programs={programs}
          selectedId={selectedId}
          onSelect={setSelectedId}
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
      />
    </>
  );
}
