import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ withTransaction: vi.fn() }));

import { withTransaction } from "./db";
import { reconcileHolisticMappings } from "./holistic-reconciliation";

const mockWithTransaction = vi.mocked(withTransaction);
const mockClientQuery = vi.fn();

describe("Holistic Mapping reconciliation", () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockWithTransaction.mockReset();
    mockWithTransaction.mockImplementation(async (callback) =>
      callback({ query: mockClientQuery } as never)
    );
  });

  it("ends stale Mappings and erases drafts in one bounded set-based statement", async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ ended_count: "2" }] });

    await expect(reconcileHolisticMappings({
      programId: 1,
      academicYear: "2026-2027",
      schoolId: 4,
      studentIds: [41, 41, 42],
    })).resolves.toBe(2);

    expect(mockClientQuery).toHaveBeenCalledOnce();
    const [sql, values] = mockClientQuery.mock.calls[0];
    expect(sql).toContain("mapping.ended_at IS NULL");
    expect(sql).toContain("mapping.academic_year = $2");
    expect(sql).toContain("end_source = 'af_lms_student_eligibility'");
    expect(sql).toContain("'student_roster_changed'");
    expect(sql).toContain("'student_dropout'");
    expect(sql).not.toContain("enrollment_record");
    expect(sql).not.toContain("group_user");
    expect(sql).toContain("HAVING COUNT(DISTINCT roster_student.grade) = 1");
    expect(sql).toContain("DELETE FROM holistic_mentorship_post_session_answers");
    expect(sql).toContain("'draft_erased_on_mapping_end'");
    expect(sql).toContain("active_mapping.academic_year > ended.academic_year");
    expect(sql).not.toMatch(/\bfor\s*\(/i);
    expect(values).toEqual([1, "2026-2027", 4, null, [41, 42]]);
  });

  it("limits reconciliation side effects to the actor's resolved School scope", async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ ended_count: "1" }] });

    await reconcileHolisticMappings({
      programId: 1,
      academicYear: "2026-2027",
      permission: {
        email: "pm@example.com",
        level: 1,
        role: "program_manager",
        school_codes: ["SCH001"],
        program_ids: [1],
      },
    });

    const [sql, values] = mockClientQuery.mock.calls[0];
    expect(sql).toContain("JOIN school mapping_school ON mapping_school.id = mapping.school_id");
    expect(sql).toContain("mapping_school.code = ANY($6::text[])");
    expect(sql.indexOf("mapping_school.code = ANY($6::text[])"))
      .toBeLessThan(sql.indexOf("UPDATE holistic_mentorship_mentor_mentee_mappings"));
    expect(values).toEqual([1, "2026-2027", null, null, null, ["SCH001"]]);
  });

  it("does not reconcile an older Academic Year", async () => {
    await expect(reconcileHolisticMappings({
      programId: 1,
      academicYear: "2025-2026",
      studentIds: [41],
    })).resolves.toBe(0);

    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("is idempotent after the active Mapping has already ended", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ ended_count: "1" }] })
      .mockResolvedValueOnce({ rows: [{ ended_count: "0" }] });

    await expect(reconcileHolisticMappings({ programId: 1, studentIds: [41] })).resolves.toBe(1);
    await expect(reconcileHolisticMappings({ programId: 1, studentIds: [41] })).resolves.toBe(0);

    expect(mockClientQuery).toHaveBeenCalledTimes(2);
    expect(mockClientQuery.mock.calls[1][1]).toEqual([1, "2026-2027", null, null, [41]]);
  });

  it("rejects an unbounded reconciliation", async () => {
    await expect(reconcileHolisticMappings({ programId: 1 })).rejects.toThrow("bounded scope");
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
