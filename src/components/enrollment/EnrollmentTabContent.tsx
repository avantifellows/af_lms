"use client";

import { useMemo, useState } from "react";
import StudentTable, { type Grade } from "@/components/StudentTable";
import EnrollmentStatsCards, {
  type ProgramStats,
} from "./EnrollmentStatsCards";
import type { Batch } from "@/components/EditStudentModal";

interface Student {
  group_user_id: string;
  user_id: string;
  student_pk_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  student_id: string | null;
  apaar_id: string | null;
  category: string | null;
  stream: string | null;
  gender: string | null;
  program_name: string | null;
  program_id: number | null;
  grade: number | null;
  grade_id: string | null;
  status: string | null;
  updated_at: string | null;
}

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
    if (selectedId == null) return activeStudents;
    return activeStudents.filter((s) => Number(s.program_id) === selectedId);
  }, [activeStudents, selectedId]);

  const filteredDropouts = useMemo(() => {
    if (selectedId == null) return dropoutStudents;
    return dropoutStudents.filter((s) => Number(s.program_id) === selectedId);
  }, [dropoutStudents, selectedId]);

  return (
    <>
      {programs.length > 0 && (
        <EnrollmentStatsCards
          programs={programs}
          selectedId={selectedId ?? programs[0].id}
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
