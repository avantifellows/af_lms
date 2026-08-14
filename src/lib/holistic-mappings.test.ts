import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./holistic-reconciliation", () => ({ reconcileHolisticMappings: vi.fn() }));

import { query, withTransaction } from "./db";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import {
  assignHolisticMenteeAsAdmin,
  assignHolisticMentees,
  getHolisticAssignmentCoverageSummary,
  listHolisticAssignmentRoster,
  reassignHolisticMenteeAsAdmin,
  removeHolisticMenteeAsAdmin,
  removeHolisticMentees,
} from "./holistic-mappings";
import type { UserPermission } from "./permissions";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const mockReconcile = vi.mocked(reconcileHolisticMappings);
const mockClientQuery = vi.fn();
const adminPermission: UserPermission = {
  email: "admin@example.com",
  level: 3,
  role: "admin",
  program_ids: [1, 78],
};

describe("Holistic Mentor-Mentee Mappings", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockWithTransaction.mockReset();
    mockReconcile.mockReset();
    mockReconcile.mockResolvedValue(0);
    mockWithTransaction.mockImplementation(async (fn) =>
      fn({ query: mockClientQuery } as never)
    );
  });

  it("reports an active draft as Pending without selecting its private state", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        student_id: "41",
        name: "Asha Rao",
        external_student_id: "ST-41",
        grade: "11",
        active_phase_id: "73",
        active_notes_state: null,
        mapping_id: "73",
        mentor_user_id: "9",
        mentor_name: "Nila Sen",
      },
    ]);

    await expect(
      listHolisticAssignmentRoster({
        permission: adminPermission,
        programId: 1,
        schoolId: 4,
        academicYear: "2026-2027",
        search: "asha",
        grade: 11,
      })
    ).resolves.toEqual([
      {
        studentId: 41,
        name: "Asha Rao",
        externalStudentId: "ST-41",
        grade: 11,
        activePhaseId: 73,
        activeNotesState: null,
        ownership: { mappingId: 73, mentorUserId: 9, mentorName: "Nila Sen" },
      },
    ]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM centre_students roster_student");
    expect(sql).toContain("roster_centre.school_id = $1");
    expect(sql).toContain("roster_student.academic_year = $2");
    expect(sql).toContain("roster_student.program_id = $3");
    expect(sql).toContain("st.status IS DISTINCT FROM 'dropout'");
    expect(sql).toContain("roster_student.grade IN (11, 12)");
    expect(sql).toContain("HAVING COUNT(DISTINCT roster_student.grade) = 1");
    expect(sql).not.toContain("enrollment_record");
    expect(sql).toContain("ORDER BY phase.position DESC");
    expect(sql).toContain("mapping.school_id = $1");
    expect(sql).toContain("mapping.program_id = $3");
    expect(sql).toContain("WHEN $6::boolean");
    expect(sql).toContain("active_notes.author_user_id = $7");
    expect(sql).toContain("mapping.mentor_user_id = $7");
    expect(sql).not.toContain("active_notes.state AS active_notes_state");
    expect(sql).not.toMatch(/profile|historical|academic_mentorship/i);
    expect(sql).not.toContain("LIMIT 100");
    expect(params).toEqual([4, "2026-2027", 1, "%asha%", 11, false, null]);
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      programId: 1,
      schoolId: 4,
    });
  });

  it("applies the shared actor scope to the School assignment-coverage roster", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const scopedPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001"],
      program_ids: [1],
    };

    await listHolisticAssignmentRoster({
      permission: scopedPermission,
      programId: 1,
      schoolId: 4,
      academicYear: "2026-2027",
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("scope_school.code = ANY($8::text[])");
    expect(params).toEqual([4, "2026-2027", 1, "%%", null, false, null, ["SCH001"]]);
  });

  it("reports server-scoped Assignment Coverage metrics with an exhaustive status partition", async () => {
    mockQuery.mockResolvedValueOnce([{
      eligible_count: "3",
      assigned_count: "2",
      unassigned_count: "1",
      active_mentor_count: "2",
      coverage_percentage: "66.7",
      completed_count: "1",
      pending_count: "1",
      no_active_phase_count: "1",
    }]);
    const scopedPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001"],
      program_ids: [1],
    };

    await expect(getHolisticAssignmentCoverageSummary({
      permission: scopedPermission,
      programId: 1,
      schoolId: 4,
      academicYear: "2026-2027",
    })).resolves.toEqual({
      eligible: 3,
      assigned: 2,
      unassigned: 1,
      activeMentors: 2,
      coveragePercentage: 66.7,
      completed: 1,
      pending: 1,
      noActivePhase: 1,
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("scope_school.code = ANY($4::text[])");
    expect(String(sql)).toContain("COUNT(*) FILTER (WHERE mentor_user_id IS NULL)");
    expect(String(sql)).toContain("COUNT(DISTINCT mentor_user_id)");
    expect(String(sql)).toContain("active_phase_id IS NOT NULL AND has_submitted_notes");
    expect(String(sql)).toContain("active_phase_id IS NOT NULL AND NOT has_submitted_notes");
    expect(String(sql)).toContain("active_phase_id IS NULL");
    expect(String(sql)).toContain("ROUND(assigned_count * 100.0 / eligible_count, 1)");
    expect(String(sql)).toContain("notes.student_id = st.id");
    expect(String(sql)).toContain("notes.phase_id = active_phase.id");
    expect(params).toEqual([4, "2026-2027", 1, ["SCH001"]]);
  });

  it("reports zero percent and an empty exhaustive partition when no Students are eligible", async () => {
    mockQuery.mockResolvedValueOnce([{
      eligible_count: 0,
      assigned_count: 0,
      unassigned_count: 0,
      active_mentor_count: 0,
      coverage_percentage: 0,
      completed_count: 0,
      pending_count: 0,
      no_active_phase_count: 0,
    }]);

    await expect(getHolisticAssignmentCoverageSummary({
      permission: adminPermission,
      programId: 78,
      schoolId: 4,
      academicYear: "2026-2027",
    })).resolves.toEqual({
      eligible: 0,
      assigned: 0,
      unassigned: 0,
      activeMentors: 0,
      coveragePercentage: 0,
      completed: 0,
      pending: 0,
      noActivePhase: 0,
    });

    expect(String(mockQuery.mock.calls[0][0])).toContain(
      "CASE WHEN eligible_count = 0 THEN 0",
    );
  });

  it("returns a draft state only to its authoring current Mentor", async () => {
    mockQuery.mockResolvedValueOnce([{
      student_id: "41", name: "Asha Rao", external_student_id: "ST-41", grade: "11",
      active_phase_id: "73", active_notes_state: "draft", mapping_id: "73",
      mentor_user_id: "9", mentor_name: "Nila Sen",
    }]);
    const teacherPermission: UserPermission = {
      email: "mentor@example.com", level: 1, role: "teacher", user_id: 9,
      school_codes: ["SCH001"], program_ids: [1],
    };

    const result = await listHolisticAssignmentRoster({
      permission: teacherPermission,
      programId: 1,
      schoolId: 4,
      academicYear: "2026-2027",
    });

    expect(result[0]?.activeNotesState).toBe("draft");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      4, "2026-2027", 1, "%%", null, true, 9, ["SCH001"],
    ]);
  });

  it("claims multiple eligible Students atomically with deterministic audit metadata", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 9 }] };
      if (text.includes("FOR UPDATE OF st")) {
        return { rows: [{ student_id: 41 }, { student_id: 42 }] };
      }
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [] };
      }
      if (text.includes("RETURNING id")) return { rows: [{ id: 81 }] };
      return { rows: [] };
    });

    await expect(
      assignHolisticMentees({
      programId: 1,
        actorUserId: 9,
        auditActorUserId: undefined,
        actorEmail: "teacher@example.com",
        schoolId: 4,
        academicYear: "2026-2027",
        selections: [
          { studentId: 41, expectedMappingId: null },
          { studentId: 42, expectedMappingId: null },
        ],
      })
    ).resolves.toEqual({ ok: true, changed: 2 });

    expect(mockWithTransaction).toHaveBeenCalledOnce();
    const sql = mockClientQuery.mock.calls.map(([text]) => String(text)).join("\n");
    expect(String(mockClientQuery.mock.calls[0][0])).toContain("pg_advisory_xact_lock");
    expect(mockClientQuery.mock.calls[0][1]).toEqual(["holistic_mentorship_mentor:9"]);
    expect(sql).toContain("FOR UPDATE OF st");
    expect(sql).toContain("FROM centre_students roster_student");
    expect(sql).toContain("roster_centre.school_id = $1");
    expect(sql).toContain("roster_student.academic_year = $2");
    expect(sql).toContain("HAVING COUNT(DISTINCT roster_student.grade) = 1");
    expect(sql).not.toContain("enrollment_record");
    expect(sql).toContain("ORDER BY st.id\n         FOR UPDATE OF st");
    expect(sql).toContain("FOR UPDATE");
    const inserts = mockClientQuery.mock.calls.filter(([text]) =>
      String(text).includes("INSERT INTO holistic_mentorship_mentor_mentee_mappings")
    );
    expect(inserts).toHaveLength(2);
    expect(String(inserts[0][0])).toContain("assigned_by_email");
    expect(String(inserts[0][0])).not.toContain("assignment_audit_reason");
    expect(inserts[0][1]).toEqual([
      41, 9, 4, 1, "2026-2027", null, "teacher@example.com", "af_lms_teacher_claim",
    ]);
    const mappingLock = mockClientQuery.mock.calls.find(([text]) =>
      String(text).includes("FROM holistic_mentorship_mentor_mentee_mappings")
    );
    expect(mappingLock?.[1]).toEqual([[41, 42], "2026-2027", 4, 1]);
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      programId: 1,
      studentIds: [41, 42],
    });
  });

  it("assigns an unassigned Student as Admin with locked eligibility and complete audit metadata", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 27 }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [] };
      }
      if (text.includes("RETURNING id")) return { rows: [{ id: 81 }] };
      return { rows: [] };
    });

    await expect(assignHolisticMenteeAsAdmin({
      actorEmail: " Admin@Example.com ",
      auditActorUserId: undefined,
      schoolId: 4,
      programId: 78,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: null,
      confirmed: true,
      reason: "Student requested a new mentor",
    })).resolves.toEqual({ ok: true, changed: 1 });

    expect(mockWithTransaction).toHaveBeenCalledOnce();
    expect(String(mockClientQuery.mock.calls[0][0])).toContain("pg_advisory_xact_lock");
    expect(mockClientQuery.mock.calls[0][1]).toEqual(["holistic_mentorship_mentor:27"]);
    const studentLockIndex = mockClientQuery.mock.calls.findIndex(([sql]) =>
      String(sql).includes("FOR UPDATE OF st"));
    const ownershipLockIndex = mockClientQuery.mock.calls.findIndex(([sql]) =>
      String(sql).includes("FROM holistic_mentorship_mentor_mentee_mappings"));
    const insertIndex = mockClientQuery.mock.calls.findIndex(([sql]) =>
      String(sql).includes("INSERT INTO holistic_mentorship_mentor_mentee_mappings"));
    expect(studentLockIndex).toBeGreaterThan(0);
    expect(ownershipLockIndex).toBeGreaterThan(studentLockIndex);
    expect(insertIndex).toBeGreaterThan(ownershipLockIndex);

    const insert = mockClientQuery.mock.calls[insertIndex];
    expect(String(insert[0])).toContain("assigned_by_email");
    expect(String(insert[0])).toContain("assignment_audit_reason");
    expect(insert[1]).toEqual([
      41, 27, 4, 78, "2026-2027", null, "admin@example.com",
      "af_lms_admin_assign", "Student requested a new mentor",
    ]);
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      programId: 78,
      studentIds: [41],
    });
  });

  it.each([
    [{ confirmed: false }, "Assignment confirmation is required"],
    [{ reason: "   " }, "Assignment reason is required"],
    [{ academicYear: "2025-2026" }, "Admin Mapping assignments are limited to the current Academic Year"],
  ] as const)("rejects invalid Admin assignment before reconciliation", async (override, error) => {
    await expect(assignHolisticMenteeAsAdmin({
      actorEmail: "admin@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: null,
      confirmed: true,
      reason: "Student request",
      ...override,
    })).resolves.toEqual({ ok: false, status: 422, error });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns distinct errors for an ineligible Student and ineligible Mentor", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      if (String(sql).includes("FOR UPDATE OF st")) return { rows: [] };
      return { rows: [] };
    });
    const base = {
      actorEmail: "admin@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: null as null,
      confirmed: true,
      reason: "Student request",
    };
    await expect(assignHolisticMenteeAsAdmin(base)).resolves.toEqual({
      ok: false,
      status: 422,
      error: "One or more Students are no longer eligible",
    });

    mockClientQuery.mockReset();
    mockClientQuery.mockImplementation((sql: unknown) => {
      if (String(sql).includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (String(sql).includes("FROM teacher")) return { rows: [] };
      return { rows: [] };
    });
    await expect(assignHolisticMenteeAsAdmin(base)).resolves.toEqual({
      ok: false,
      status: 422,
      error: "Mentor is not eligible for this School and Program",
    });
  });

  it("returns refreshed ownership without an insert when Admin assign loses a race", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 27 }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 73, student_id: 41, mentor_user_id: 8 }] };
      }
      return { rows: [] };
    });
    mockQuery.mockResolvedValueOnce([
      { id: 73, student_id: 41, mentor_user_id: 8, mentor_name: "Nila Sen" },
    ]);

    await expect(assignHolisticMenteeAsAdmin({
      actorEmail: "admin@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: null,
      confirmed: true,
      reason: "Student request",
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Student is already assigned",
      ownership: [{
        studentId: 41,
        ownership: { mappingId: 73, mentorUserId: 8, mentorName: "Nila Sen" },
      }],
    });
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO holistic_mentorship_mentor_mentee_mappings")))
      .toBe(false);
  });

  it("removes only confirmed actor-owned Mappings while retaining history", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 9 }] };
      if (text.includes("FOR UPDATE")) {
        return {
          rows: [
            { id: 73, student_id: 41, mentor_user_id: 9 },
            { id: 74, student_id: 42, mentor_user_id: 9 },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      removeHolisticMentees({
      programId: 1,
        actorUserId: 9,
        auditActorUserId: undefined,
        actorEmail: "teacher@example.com",
        schoolId: 4,
        academicYear: "2026-2027",
        mappings: [
          { studentId: 41, expectedMappingId: 73 },
          { studentId: 42, expectedMappingId: 74 },
        ],
        confirmed: true,
      })
    ).resolves.toEqual({ ok: true, changed: 2 });

    const update = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("ended_by_email")
    );
    expect(String(update?.[0])).not.toContain("end_audit_reason");
    expect(update?.[1]).toEqual([
      null, "teacher@example.com", "af_lms_teacher", "teacher_removal", [73, 74],
    ]);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("DELETE FROM holistic_mentorship_mentor_mentee_mappings")
    )).toBe(false);
    const cleanup = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("holistic_mentorship_post_session_answers")
    );
    expect(String(cleanup?.[0])).toContain("state = 'draft'");
    expect(String(cleanup?.[0])).toContain("FOR UPDATE");
    expect(String(cleanup?.[0])).toContain("actor_email");
    expect(cleanup?.[1]).toEqual([
      [41, 42], null, "teacher@example.com", "teacher_removal",
    ]);
  });

  it("removes one Mapping as Admin and audits the Mapping end and draft erasure atomically", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      if (String(sql).includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 73, student_id: 41, mentor_user_id: 9 }] };
      }
      return { rows: [] };
    });

    await expect(removeHolisticMenteeAsAdmin({
      actorEmail: " Admin@Example.com ",
      auditActorUserId: undefined,
      schoolId: 4,
      programId: 78,
      academicYear: "2026-2027",
      studentId: 41,
      expectedMappingId: 73,
      confirmed: true,
      reason: "  Mentor left the programme  ",
    })).resolves.toEqual({ ok: true, changed: 1 });

    expect(mockWithTransaction).toHaveBeenCalledOnce();
    expect(mockReconcile).not.toHaveBeenCalled();
    const mappingUpdate = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE holistic_mentorship_mentor_mentee_mappings"));
    expect(String(mappingUpdate?.[0])).toContain("end_audit_reason");
    expect(mappingUpdate?.[1]).toEqual([
      null,
      "admin@example.com",
      "af_lms_admin_remove",
      "admin_removal",
      "Mentor left the programme",
      73,
    ]);
    const draftErasure = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("holistic_mentorship_post_session_answers"));
    expect(String(draftErasure?.[0])).toContain("state = 'draft'");
    expect(draftErasure?.[1]).toEqual([
      [41], null, "admin@example.com", "Mentor left the programme",
    ]);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("state = 'submitted'"))).toBe(false);
  });

  it("reassigns one Mapping as Admin with matching end, start, and draft-erasure audit identity", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 27 }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 73, student_id: 41, mentor_user_id: 9 }] };
      }
      if (text.includes("RETURNING id")) return { rows: [{ id: 81 }] };
      return { rows: [] };
    });

    await expect(reassignHolisticMenteeAsAdmin({
      actorEmail: " Admin@Example.com ",
      auditActorUserId: 19,
      schoolId: 4,
      programId: 78,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: 73,
      confirmed: true,
      reason: "  Mentor handover requested  ",
    })).resolves.toEqual({ ok: true, changed: 1 });

    expect(mockWithTransaction).toHaveBeenCalledOnce();
    const mappingWrites = mockClientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("holistic_mentorship_mentor_mentee_mappings") &&
      /^(UPDATE|INSERT)/.test(String(sql).trim()));
    expect(mappingWrites).toHaveLength(2);
    expect(String(mappingWrites[0][0])).toContain("end_audit_reason");
    expect(mappingWrites[0][1]).toEqual([
      19, "admin@example.com", "af_lms_admin_reassign", "admin_reassignment",
      "Mentor handover requested", 73,
    ]);
    expect(String(mappingWrites[1][0])).toContain("assignment_audit_reason");
    expect(mappingWrites[1][1]).toEqual([
      41, 27, 4, 78, "2026-2027", 19, "admin@example.com",
      "af_lms_admin_reassign", "Mentor handover requested",
    ]);
    const draftErasure = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("holistic_mentorship_post_session_answers"));
    expect(String(draftErasure?.[0])).toContain("state = 'draft'");
    expect(draftErasure?.[1]).toEqual([
      [41], 19, "admin@example.com", "Mentor handover requested",
    ]);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("state = 'submitted'"))).toBe(false);
  });

  it.each([
    [{ confirmed: false }, "Reassignment confirmation is required"],
    [{ reason: "   " }, "Reassignment reason is required"],
    [{ academicYear: "2025-2026" }, "Admin Mapping reassignments are limited to the current Academic Year"],
  ] as const)("rejects invalid Admin reassignment before opening a transaction", async (override, error) => {
    await expect(reassignHolisticMenteeAsAdmin({
      actorEmail: "admin@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: 73,
      confirmed: true,
      reason: "Mentor handover",
      ...override,
    })).resolves.toEqual({ ok: false, status: 422, error });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns refreshed ownership without partial mutation for a stale Admin reassignment", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 27 }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 74, student_id: 41, mentor_user_id: 8 }] };
      }
      return { rows: [] };
    });
    mockQuery.mockResolvedValueOnce([
      { id: 74, student_id: 41, mentor_user_id: 8, mentor_name: "Nila Sen" },
    ]);

    await expect(reassignHolisticMenteeAsAdmin({
      actorEmail: "admin@example.com",
      auditActorUserId: 19,
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: 73,
      confirmed: true,
      reason: "Mentor handover",
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Mapping ownership changed; review the refreshed roster",
      ownership: [{
        studentId: 41,
        ownership: { mappingId: 74, mentorUserId: 8, mentorName: "Nila Sen" },
      }],
    });
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      /^(UPDATE|INSERT)/.test(String(sql).trim()))).toBe(false);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("holistic_mentorship_post_session_answers"))).toBe(false);
  });

  it("rejects an ineligible replacement Mentor before ending the current Mapping", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      if (String(sql).includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (String(sql).includes("FROM teacher")) return { rows: [] };
      return { rows: [] };
    });

    await expect(reassignHolisticMenteeAsAdmin({
      actorEmail: "admin@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 31,
      expectedMappingId: 73,
      confirmed: true,
      reason: "Mentor handover",
    })).resolves.toEqual({
      ok: false,
      status: 422,
      error: "Mentor is not eligible for this School and Program",
    });
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      /^(UPDATE|INSERT)/.test(String(sql).trim()))).toBe(false);
  });

  it.each([
    [{ confirmed: false }, "Removal confirmation is required"],
    [{ reason: "   " }, "Removal reason is required"],
    [{ academicYear: "2025-2026" }, "Admin Mapping removals are limited to the current Academic Year"],
  ] as const)("rejects invalid Admin removal before reconciliation", async (override, error) => {
    await expect(removeHolisticMenteeAsAdmin({
      actorEmail: "admin@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      expectedMappingId: 73,
      confirmed: true,
      reason: "Mentor left",
      ...override,
    })).resolves.toEqual({ ok: false, status: 422, error });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns refreshed ownership without partial mutation for a stale Admin removal", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      if (String(sql).includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 74, student_id: 41, mentor_user_id: 8 }] };
      }
      return { rows: [] };
    });
    mockQuery.mockResolvedValueOnce([
      { id: 74, student_id: 41, mentor_user_id: 8, mentor_name: "Nila Sen" },
    ]);

    await expect(removeHolisticMenteeAsAdmin({
      actorEmail: "admin@example.com",
      auditActorUserId: 19,
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      expectedMappingId: 73,
      confirmed: true,
      reason: "Mentor left",
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Mapping ownership changed; review the refreshed roster",
      ownership: [{
        studentId: 41,
        ownership: { mappingId: 74, mentorUserId: 8, mentorName: "Nila Sen" },
      }],
    });
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE holistic_mentorship_mentor_mentee_mappings"))).toBe(false);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("holistic_mentorship_post_session_answers"))).toBe(false);
  });

  it("rejects an exact current Mapping with ownership and performs no takeover writes", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 9 }] };
      if (text.includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 73, student_id: 41, mentor_user_id: 8 }] };
      }
      return { rows: [{ id: 81 }] };
    });
    mockQuery.mockResolvedValueOnce([
      { id: 73, student_id: 41, mentor_user_id: 8, mentor_name: "Nila Sen" },
    ]);

    await expect(assignHolisticMentees({
      programId: 1,
      actorUserId: 9,
      actorEmail: "teacher@example.com",
      schoolId: 4,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: 73 }],
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Student is already assigned to another Mentor",
      ownership: [{
        studentId: 41,
        ownership: { mappingId: 73, mentorUserId: 8, mentorName: "Nila Sen" },
      }],
    });

    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE holistic_mentorship_mentor_mentee_mappings")
    )).toBe(false);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO holistic_mentorship_mentor_mentee_mappings")
    )).toBe(false);
  });

  it("rejects another Mentor's Mapping without ending or replacing it", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 9 }] };
      if (text.includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 73, student_id: 41, mentor_user_id: 8 }] };
      }
      return { rows: [] };
    });
    mockQuery.mockResolvedValueOnce([
      { id: 73, student_id: 41, mentor_user_id: 8, mentor_name: "Nila Sen" },
    ]);

    await expect(assignHolisticMentees({
      programId: 1,
      actorUserId: 9,
      actorEmail: "teacher@example.com",
      schoolId: 4,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: 73 }],
    })).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: "Student is already assigned to another Mentor",
    });

    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes("end_reason = $3"))).toBe(false);
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO holistic"))).toBe(false);
    expect(mockQuery.mock.calls[0][1]).toEqual([[41], "2026-2027", 4, 1]);
  });

  it("does not remove another Mentor's Mapping or expose ownership outside the School scope", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 9 }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 73, student_id: 41, mentor_user_id: 8 }] };
      }
      return { rows: [] };
    });
    mockQuery.mockResolvedValueOnce([]);

    await expect(removeHolisticMentees({
      programId: 1,
      actorUserId: 9,
      actorEmail: "teacher@example.com",
      schoolId: 4,
      academicYear: "2026-2027",
      mappings: [{ studentId: 41, expectedMappingId: 73 }],
      confirmed: true,
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Mapping ownership changed; review the refreshed roster",
      ownership: [{ studentId: 41, ownership: null }],
    });

    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes("end_reason = $3"))).toBe(false);
    const lock = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM holistic_mentorship_mentor_mentee_mappings")
    );
    expect(lock?.[1]).toEqual([[41], "2026-2027", 4, 1]);
    expect(mockQuery.mock.calls[0][1]).toEqual([[41], "2026-2027", 4, 1]);
  });

  it("rolls back the whole selection when any Student is no longer eligible", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 9 }] };
      if (text.includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      return { rows: [] };
    });
    mockQuery.mockResolvedValue([]);

    const result = await assignHolisticMentees({
      programId: 1,
      actorUserId: 9,
      actorEmail: "teacher@example.com",
      schoolId: 4,
      academicYear: "2026-2027",
      selections: [
        { studentId: 41, expectedMappingId: null },
        { studentId: 42, expectedMappingId: null },
      ],
    });
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "One or more Students are no longer eligible",
    });
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO"))).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns refreshed safe ownership after a first-writer conflict", async () => {
    mockWithTransaction.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "23505" }));
    mockQuery.mockResolvedValueOnce([
      { id: 73, student_id: 41, mentor_user_id: 8, mentor_name: "Nila Sen" },
    ]);

    await expect(assignHolisticMentees({
      programId: 1,
      actorUserId: 9,
      actorEmail: "teacher@example.com",
      schoolId: 4,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: null }],
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Mapping ownership changed; review the refreshed roster",
      ownership: [{
        studentId: 41,
        ownership: { mappingId: 73, mentorUserId: 8, mentorName: "Nila Sen" },
      }],
    });
    expect(mockQuery.mock.calls[0][1]).toEqual([[41], "2026-2027", 4, 1]);
  });
});
