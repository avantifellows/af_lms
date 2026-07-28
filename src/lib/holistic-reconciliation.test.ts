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
      academicYear: "2026-2027",
      schoolId: 4,
      studentIds: [41, 41, 42],
    })).resolves.toBe(2);

    expect(mockClientQuery).toHaveBeenCalledOnce();
    const [sql, values] = mockClientQuery.mock.calls[0];
    expect(sql).toContain("mapping.ended_at IS NULL");
    expect(sql).toContain("end_source = 'af_lms_student_eligibility'");
    expect(sql).toContain("'student_program_changed'");
    expect(sql).toContain("'student_school_changed'");
    expect(sql).toContain("'student_grade_changed'");
    expect(sql).toContain("'student_dropout'");
    expect(sql).toContain("DELETE FROM holistic_mentorship_post_session_answers");
    expect(sql).toContain("'draft_erased_on_mapping_end'");
    expect(sql).toContain("active_mapping.academic_year > ended.academic_year");
    expect(sql).not.toMatch(/\bfor\s*\(/i);
    expect(values).toEqual([1, "2026-2027", 4, null, [41, 42]]);
  });

  it("rejects an unbounded reconciliation", async () => {
    await expect(reconcileHolisticMappings({})).rejects.toThrow("bounded scope");
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
