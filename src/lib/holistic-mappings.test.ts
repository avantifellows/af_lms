import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./holistic-reconciliation", () => ({ reconcileHolisticMappings: vi.fn() }));

import { query, withTransaction } from "./db";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import {
  assignHolisticMentees,
  listHolisticAssignmentRoster,
  removeHolisticMentees,
} from "./holistic-mappings";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const mockReconcile = vi.mocked(reconcileHolisticMappings);
const mockClientQuery = vi.fn();

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

  it("lists only the limited eligible School roster with active ownership facts", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        student_id: "41",
        name: "Asha Rao",
        external_student_id: "ST-41",
        grade: "11",
        active_phase_id: "73",
        active_notes_state: "draft",
        mapping_id: "73",
        mentor_user_id: "9",
        mentor_name: "Nila Sen",
      },
    ]);

    await expect(
      listHolisticAssignmentRoster({
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
        activeNotesState: "draft",
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
    expect(sql).not.toContain("enrollment_record");
    expect(sql).toContain("ORDER BY phase.position DESC");
    expect(sql).toContain("mapping.school_id = $1");
    expect(sql).toContain("mapping.program_id = $3");
    expect(sql).not.toMatch(/profile|historical|academic_mentorship/i);
    expect(sql).not.toContain("LIMIT 100");
    expect(params).toEqual([4, "2026-2027", 1, "%asha%", 11]);
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      schoolId: 4,
    });
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
        actorUserId: 9,
        schoolId: 4,
        academicYear: "2026-2027",
        selections: [
          { studentId: 41, expectedMappingId: null },
          { studentId: 42, expectedMappingId: null },
        ],
        takeoverConfirmed: false,
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
    expect(sql).not.toContain("enrollment_record");
    expect(sql).toContain("ORDER BY st.id\n         FOR UPDATE OF st");
    expect(sql).toContain("FOR UPDATE");
    const inserts = mockClientQuery.mock.calls.filter(([text]) =>
      String(text).includes("INSERT INTO holistic_mentorship_mentor_mentee_mappings")
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toEqual([41, 9, 4, 1, "2026-2027", 9, "af_lms_teacher_claim"]);
    const mappingLock = mockClientQuery.mock.calls.find(([text]) =>
      String(text).includes("FROM holistic_mentorship_mentor_mentee_mappings")
    );
    expect(mappingLock?.[1]).toEqual([[41, 42], "2026-2027", 4, 1]);
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      studentIds: [41, 42],
    });
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
        actorUserId: 9,
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
      String(sql).includes("end_reason = $3")
    );
    expect(update?.[1]).toEqual([9, "af_lms_teacher", "teacher_removal", [73, 74]]);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("DELETE FROM holistic_mentorship_mentor_mentee_mappings")
    )).toBe(false);
    const cleanup = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("holistic_mentorship_post_session_answers")
    );
    expect(String(cleanup?.[0])).toContain("state = 'draft'");
    expect(String(cleanup?.[0])).toContain("FOR UPDATE");
  });

  it("takes over only the exact confirmed current Mapping and records both lifecycle actions", async () => {
    mockClientQuery.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("FROM teacher")) return { rows: [{ user_id: 9 }] };
      if (text.includes("FOR UPDATE OF st")) return { rows: [{ student_id: 41 }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings")) {
        return { rows: [{ id: 73, student_id: 41, mentor_user_id: 8 }] };
      }
      return { rows: [{ id: 81 }] };
    });

    await expect(assignHolisticMentees({
      actorUserId: 9,
      schoolId: 4,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: 73 }],
      takeoverConfirmed: true,
    })).resolves.toEqual({ ok: true, changed: 1 });

    const end = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes("end_reason = $3"));
    expect(end?.[1]).toEqual([9, "af_lms_teacher", "teacher_takeover", [73]]);
    const insert = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO holistic_mentorship_mentor_mentee_mappings")
    );
    expect(insert?.[1]).toEqual([41, 9, 4, 1, "2026-2027", 9, "af_lms_teacher_takeover"]);
    const draftCleanup = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("holistic_mentorship_post_session_answers")
    );
    expect(String(draftCleanup?.[0])).toContain(
      "holistic_mentorship_post_session_note_audits"
    );
    expect(String(draftCleanup?.[0])).toContain("state = 'draft'");
    expect(draftCleanup?.[1]).toEqual([[41], 9, "teacher_takeover"]);
  });

  it("requires a fresh takeover confirmation before ending another Mentor's Mapping", async () => {
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
      actorUserId: 9,
      schoolId: 4,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: 73 }],
      takeoverConfirmed: false,
    })).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: "Confirm takeover using the refreshed roster",
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
      actorUserId: 9,
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
      actorUserId: 9,
      schoolId: 4,
      academicYear: "2026-2027",
      selections: [
        { studentId: 41, expectedMappingId: null },
        { studentId: 42, expectedMappingId: null },
      ],
      takeoverConfirmed: false,
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
      actorUserId: 9,
      schoolId: 4,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: null }],
      takeoverConfirmed: false,
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
