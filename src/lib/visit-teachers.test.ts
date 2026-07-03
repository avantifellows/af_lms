import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  query: vi.fn(),
}));

import { query } from "./db";
import { getVisitTeachersForSchool } from "./visit-teachers";

const mockQuery = vi.mocked(query);

describe("getVisitTeachersForSchool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns visit teachers from active Staff Management seats for a school", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 7, email: "teacher@school.org", full_name: "Staff Person" },
    ] as never);

    const teachers = await getVisitTeachersForSchool("SCH001");

    expect(teachers).toEqual([
      { id: 7, email: "teacher@school.org", full_name: "Staff Person" },
    ]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("JOIN centre_positions cp"),
      ["SCH001", ["apm", "pm", "spm", "ph"]]
    );
  });

  it("uses Staff Management eligibility rules instead of broad teacher permissions", async () => {
    mockQuery.mockResolvedValueOnce([] as never);

    await getVisitTeachersForSchool("SCH002");

    const [sql] = mockQuery.mock.calls[0];
    const text = String(sql);
    expect(text).toContain("DISTINCT ON (up.id)");
    expect(text).toContain("t.is_af_teacher = true");
    expect(text).toContain("t.exit_date IS NULL");
    expect(text).toContain("up.revoked_at IS NULL");
    expect(text).toContain("cp.deleted_at IS NULL");
    expect(text).toContain("NOT (cp.role = ANY($2::text[]))");
    expect(text).toContain("c.is_active IS TRUE");
    expect(text).toContain("JOIN school s ON s.id = c.school_id");
    expect(text).toContain("WHERE s.code = $1");
    expect(text).toContain("COALESCE(");
    expect(text).not.toContain("LIMIT 1");
    expect(text).not.toContain("up.role = 'teacher'");
    expect(text).not.toContain("school_codes @>");
    expect(text).not.toContain("regions @>");
  });
});
