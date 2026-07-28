import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ withTransaction: vi.fn() }));

import { withTransaction } from "./db";
import { deleteHolisticStudentContent } from "./holistic-privacy";

const mockTransaction = vi.mocked(withTransaction);
const deletionRequest = {
  actorUserId: 9,
  studentId: 41,
  reason: "AF-approved request",
};

function mockPrivacyTransaction(counts: {
  profiles: number;
  historical: number;
  postSession: number;
}) {
  const client = { query: vi.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ actor_user_id: "9" }] })
    .mockResolvedValueOnce({ rows: [{ count: String(counts.profiles) }] })
    .mockResolvedValueOnce({ rows: [{ count: String(counts.historical) }] })
    .mockResolvedValueOnce({ rows: [{ count: String(counts.postSession) }] })
    .mockResolvedValueOnce({ rows: [] }) };
  mockTransaction.mockImplementation(async (work) => work(client as never));
  return client;
}

describe("approved Holistic privacy deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redacts Profile and Notes content while retaining content-free audit history", async () => {
    const client = mockPrivacyTransaction({ profiles: 5, historical: 1, postSession: 2 });

    await expect(deleteHolisticStudentContent(deletionRequest)).resolves.toEqual({
      ok: true,
      profileSummariesErased: 5,
      postSessionAnswersErased: 2,
      historicalAnswersErased: 1,
    });

    const sql = client.query.mock.calls.map(([text]) => String(text)).join("\n");
    expect(sql).toContain("permission.role = 'admin'");
    expect(sql).toContain("UPDATE holistic_mentorship_student_profile_summaries");
    expect(sql).toContain("UPDATE holistic_mentorship_historical_note_answers");
    expect(sql).toContain("DELETE FROM holistic_mentorship_post_session_answers");
    expect(sql).toContain("'privacy_content_erased'");
    expect(sql).toContain("INSERT INTO holistic_mentorship_privacy_deletions");
    expect(sql).toContain("ON CONFLICT (student_id) DO NOTHING");
    expect(sql).not.toContain("DELETE FROM holistic_mentorship_post_session_notes");
    expect(sql).not.toContain("DELETE FROM holistic_mentorship_historical_notes");
    expect(client.query.mock.calls[0]).toEqual(["SELECT pg_advisory_xact_lock($1, 0)", [41]]);
    expect(client.query.mock.calls[4][1]).toEqual([41, 9, "AF-approved request"]);
    expect(client.query.mock.calls[5][1]).toEqual([41, 9, "AF-approved request", 5, 2, 1]);
  });

  it("makes an unchanged repeat a no-op without duplicating the privacy tombstone", async () => {
    const client = mockPrivacyTransaction({ profiles: 0, historical: 0, postSession: 0 });

    await expect(deleteHolisticStudentContent(deletionRequest)).resolves.toEqual({
      ok: true,
      profileSummariesErased: 0,
      postSessionAnswersErased: 0,
      historicalAnswersErased: 0,
    });
    expect(client.query).toHaveBeenCalledTimes(6);
    expect(client.query.mock.calls[5][0]).toContain("ON CONFLICT (student_id) DO NOTHING");
  });

  it("propagates a write failure so the transaction wrapper can roll back every erasure", async () => {
    mockTransaction.mockRejectedValue(new Error("audit insert failed"));
    await expect(deleteHolisticStudentContent(deletionRequest)).rejects.toThrow("audit insert failed");
  });
});
