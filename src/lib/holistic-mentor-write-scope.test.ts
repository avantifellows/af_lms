import { describe, expect, it, vi } from "vitest";

import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  checkHolisticMentorWriteScope,
  loadHolisticMentorWriteScope,
} from "./holistic-mentor-write-scope";
import { HOLISTIC_PHASE_CLOSED_ERROR } from "./holistic-phase-messages";

const scopeInput = {
  studentId: 41,
  phaseId: 73,
  schoolId: 4,
  programId: 1,
  academicYear: "2026-2027",
};

const planLock = { rows: [{ id: "7" }] };

describe("Holistic Mentor write scope", () => {
  it("returns null when no Mentor write scope matches", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce(planLock).mockResolvedValueOnce({ rows: [] }) };

    await expect(loadHolisticMentorWriteScope(client as never, scopeInput)).resolves.toBeNull();
  });

  it("returns null without locking a Mapping or Phase when the Phase is not in this Program", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(loadHolisticMentorWriteScope(client as never, scopeInput)).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledOnce();
  });

  const scopeRow = {
    mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open",
    phase_plan_id: "7", phase_grade_id: "3", current_year_plan: true,
  };
  const scope = { mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" as const };

  it("share-locks the Plan first, then the Mapping and Phase, then reads the Grade's Active Phase", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce(planLock)
      .mockResolvedValueOnce({ rows: [scopeRow] })
      .mockResolvedValueOnce({ rows: [{ id: "73" }] }) };

    await expect(loadHolisticMentorWriteScope(client as never, scopeInput))
      .resolves.toEqual({ ...scope, phase_active: true });

    // Plan before Phase: the order every Phase Plan change uses, so the two never deadlock.
    const [planSql, planParams] = client.query.mock.calls[0];
    expect(String(planSql)).toContain("FOR SHARE OF plan");
    expect(String(planSql)).not.toContain("FOR UPDATE");
    expect(planParams).toEqual([scopeInput.phaseId, scopeInput.programId]);
    const scopeSql = String(client.query.mock.calls[1][0]);
    expect(scopeSql).toContain("FOR UPDATE OF mapping, phase");
    expect(scopeSql).not.toContain("FOR SHARE");
    const [activeSql, activeParams] = client.query.mock.calls[2];
    expect(String(activeSql)).toContain("state = 'open'");
    expect(String(activeSql)).toContain("ORDER BY position DESC LIMIT 1");
    expect(activeParams).toEqual([7, 3]);
  });

  it("is not Active when a later Phase of the Grade is Open", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce(planLock)
      .mockResolvedValueOnce({ rows: [scopeRow] })
      .mockResolvedValueOnce({ rows: [{ id: "75" }] }) };

    await expect(loadHolisticMentorWriteScope(client as never, scopeInput))
      .resolves.toEqual({ ...scope, phase_active: false });
  });

  it.each([
    ["a prior-year Plan's Phase", { current_year_plan: false }],
    ["a Locked Phase", { phase_state: "locked" }],
  ])("is not Active for %s, without reading the Active Phase", async (_label, override) => {
    const client = { query: vi.fn().mockResolvedValueOnce(planLock)
      .mockResolvedValueOnce({ rows: [{ ...scopeRow, ...override }] }) };

    const loaded = await loadHolisticMentorWriteScope(client as never, scopeInput);

    expect(loaded?.phase_active).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("calls a Plan current by the real current Academic Year, not the year the request names", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce(planLock).mockResolvedValueOnce({ rows: [] }) };

    await loadHolisticMentorWriteScope(client as never, { ...scopeInput, academicYear: "2025-2026" });

    const [scopeSql, scopeParams] = client.query.mock.calls[1];
    expect(String(scopeSql)).toContain("(plan.academic_year = $7) AS current_year_plan");
    // $5 is the requested year (the Mapping's); $7 is the server's current year.
    expect(scopeParams[4]).toBe("2025-2026");
    expect(scopeParams[6]).toBe(CURRENT_ACADEMIC_YEAR);
    expect(CURRENT_ACADEMIC_YEAR).not.toBe("2025-2026");
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
