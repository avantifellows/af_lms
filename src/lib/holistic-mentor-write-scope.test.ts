import { describe, expect, it, vi } from "vitest";

import {
  checkHolisticMentorWriteScope,
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

  it("returns the locked Mapping and Phase row when present", async () => {
    const row = { mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" };
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [row] }) };

    await expect(loadHolisticMentorWriteScope(client as never, scopeInput)).resolves.toEqual({
      mapping_id: "300",
      mentor_user_id: "9",
      phase_revision: 5,
      phase_state: "open",
    });
  });

  it("hides missing scope and non-Mentor actors as Not found", () => {
    expect(checkHolisticMentorWriteScope(null, 9)).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(checkHolisticMentorWriteScope(
      { mapping_id: "300", mentor_user_id: "8", phase_revision: 5, phase_state: "open" }, 9
    )).toEqual({ ok: false, status: 404, error: "Not found" });
  });

  it("rejects a Phase that is not Open and accepts the Mentor on an Open Phase", () => {
    expect(checkHolisticMentorWriteScope(
      { mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "locked" }, 9
    )).toEqual({ ok: false, status: 422, error: "Phase is not Open" });
    expect(checkHolisticMentorWriteScope(
      { mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" }, 9
    )).toBeNull();
  });
});
