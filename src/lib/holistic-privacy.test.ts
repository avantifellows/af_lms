import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ withTransaction: vi.fn() }));

import { withTransaction } from "./db";
import { deleteHolisticStudentContent } from "./holistic-privacy";

const mockTransaction = vi.mocked(withTransaction);

describe("approved Holistic privacy deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redacts Profile and Notes content while retaining content-free audit history", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ actor_user_id: "9" }] })
      .mockResolvedValueOnce({ rows: [{ count: "5" }] })
      .mockResolvedValueOnce({ rows: [{ count: "2" }] }) };
    mockTransaction.mockImplementation(async (work) => work(client as never));

    await expect(deleteHolisticStudentContent({
      email: "admin@af.org", studentId: 41, reason: "AF-approved request",
    })).resolves.toEqual({ ok: true, profilesErased: 5, notesErased: 2 });

    const sql = client.query.mock.calls.map(([text]) => String(text)).join("\n");
    expect(sql).toContain("permission.role = 'admin'");
    expect(sql).toContain("UPDATE holistic_mentorship_student_profile_summaries");
    expect(sql).toContain("DELETE FROM holistic_mentorship_post_session_answers");
    expect(sql).toContain("'privacy_content_erased'");
    expect(sql).not.toContain("DELETE FROM holistic_mentorship_post_session_notes");
    expect(client.query.mock.calls[2][1]).toEqual([41, 9, "AF-approved request"]);
  });

  it("propagates a write failure so the transaction wrapper can roll back every erasure", async () => {
    mockTransaction.mockRejectedValue(new Error("audit insert failed"));
    await expect(deleteHolisticStudentContent({
      email: "admin@af.org", studentId: 41, reason: "AF-approved request",
    })).rejects.toThrow("audit insert failed");
  });
});
