import { describe, expect, it, vi } from "vitest";

import {
  checkHolisticMentorWriteScope,
  HOLISTIC_PHASE_CLOSED_ERROR,
  loadHolisticMentorWriteScope,
} from "./holistic-mentor-write-scope";

const scopeInput = {
  studentId: 41,
  phaseId: 73,
  schoolId: 4,
  programId: 1,
  academicYear: "2026-2027",
};

describe("Holistic Mentor write scope", () => {
  it("returns null when no Mentor write scope matches", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(loadHolisticMentorWriteScope(client as never, scopeInput)).resolves.toBeNull();
  });

  const scopeRow = {
    mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open",
    phase_plan_id: "7", phase_grade_id: "3", current_year_plan: true,
  };
  const scope = { mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" as const };

  it("share-locks the Plan, then reads the Grade's Active Phase in a second statement", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [scopeRow] })
      .mockResolvedValueOnce({ rows: [{ id: "73" }] }) };

    await expect(loadHolisticMentorWriteScope(client as never, scopeInput))
      .resolves.toEqual({ ...scope, phase_active: true });

    expect(String(client.query.mock.calls[0][0])).toContain("FOR UPDATE OF mapping, phase FOR SHARE OF plan");
    const [activeSql, activeParams] = client.query.mock.calls[1];
    expect(String(activeSql)).toContain("state = 'open'");
    expect(String(activeSql)).toContain("ORDER BY position DESC LIMIT 1");
    expect(activeParams).toEqual([7, 3]);
  });

  it("is not Active when a later Phase of the Grade is Open", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [scopeRow] })
      .mockResolvedValueOnce({ rows: [{ id: "75" }] }) };

    await expect(loadHolisticMentorWriteScope(client as never, scopeInput))
      .resolves.toEqual({ ...scope, phase_active: false });
  });

  it.each([
    ["a prior-year Plan's Phase", { current_year_plan: false }],
    ["a Locked Phase", { phase_state: "locked" }],
  ])("is not Active for %s, without reading the Active Phase", async (_label, override) => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ ...scopeRow, ...override }] }) };

    const loaded = await loadHolisticMentorWriteScope(client as never, scopeInput);

    expect(loaded?.phase_active).toBe(false);
    expect(client.query).toHaveBeenCalledOnce();
  });

  it("hides missing scope and non-Mentor actors as Not found", () => {
    expect(checkHolisticMentorWriteScope(null, 9)).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(checkHolisticMentorWriteScope({ ...scope, mentor_user_id: "8", phase_active: true }, 9))
      .toEqual({ ok: false, status: 404, error: "Not found" });
  });

  it("rejects a Locked Phase, rejects a Closed Phase, and accepts the Mentor on the Active Phase", () => {
    expect(checkHolisticMentorWriteScope({ ...scope, phase_state: "locked", phase_active: false }, 9))
      .toEqual({ ok: false, status: 422, error: "Phase is not Open" });
    expect(checkHolisticMentorWriteScope({ ...scope, phase_active: false }, 9))
      .toEqual({ ok: false, status: 422, error: HOLISTIC_PHASE_CLOSED_ERROR });
    expect(checkHolisticMentorWriteScope({ ...scope, phase_active: true }, 9)).toBeNull();
  });
});
