import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import { listEligibleHolisticMentors } from "./holistic-mentor-eligibility";

const mockQuery = vi.mocked(query);

describe("Holistic Mentor eligibility", () => {
  beforeEach(() => mockQuery.mockReset());

  it("lists APC and Subject TBD Teachers while excluding every PM-tier seat", async () => {
    mockQuery.mockResolvedValueOnce([
      { user_id: "27", name: "Asha APC", email: "asha@example.com" },
      { user_id: "28", name: "Nila Teacher", email: "nila@example.com" },
    ]);

    await expect(listEligibleHolisticMentors({ schoolId: 4, programId: 78 }))
      .resolves.toEqual([
        { userId: 27, name: "Asha APC", email: "asha@example.com" },
        { userId: 28, name: "Nila Teacher", email: "nila@example.com" },
      ]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("up.role = 'teacher'");
    expect(String(sql)).toContain("t.is_af_teacher = true");
    expect(String(sql)).toContain("t.exit_date IS NULL");
    expect(String(sql)).toContain("cp.deleted_at IS NULL");
    expect(String(sql)).toContain("NOT (cp.role = ANY($3::text[]))");
    expect(params).toEqual([4, 78, ["apm", "pm", "spm", "ph"]]);
  });
});
