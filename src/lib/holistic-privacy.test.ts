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
const marker = "Content erased under approved privacy request";

function mockPrivacyTransaction(counts: {
  profiles: number;
  historical: number;
  postSession: number;
  challenges?: number;
  followUp: number;
}, options: { failAt?: number; missingAudit?: boolean } = {}) {
  const replies = [
    { rows: [] },
    { rows: [{ actor_user_id: "9" }] },
    { rows: [{ count: String(counts.profiles) }] },
    { rows: [{ count: String(counts.historical) }] },
    { rows: [{ answers: String(counts.postSession), challenges: String(counts.challenges ?? 0) }] },
    { rows: [] }, // Tombstone may already exist: ON CONFLICT DO NOTHING.
    { rows: [{ count: String(counts.followUp) }] },
    { rows: options.missingAudit ? [] : [{ id: 27 }] },
  ];
  let call = 0;
  const client = { query: vi.fn(async () => {
    const index = call++;
    if (index === options.failAt) throw new Error("write failed");
    return replies[index];
  }) };
  mockTransaction.mockImplementation(async (work) => work(client as never));
  return client;
}

describe("approved Holistic privacy deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("erases all content families and records the actual Follow-up answer count", async () => {
    const client = mockPrivacyTransaction({ profiles: 5, historical: 1, postSession: 2, challenges: 3, followUp: 4 });

    await expect(deleteHolisticStudentContent(deletionRequest)).resolves.toEqual({
      ok: true,
      profileSummariesErased: 5,
      postSessionAnswersErased: 2,
      postSessionChallengesErased: 3,
      historicalAnswersErased: 1,
      followUpAnswersErased: 4,
    });

    const calls = client.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0]).toEqual(["SELECT pg_advisory_xact_lock($1, 0)", [41]]);
    expect(calls[1][0]).toContain("permission.role = 'admin'");
    expect(calls[2][0]).toContain("UPDATE holistic_mentorship_student_profile_summaries");
    expect(calls[2][1]).toEqual([41, marker]);
    expect(calls[3][0]).toContain("UPDATE holistic_mentorship_historical_note_answers");
    expect(calls[4][0]).toContain("DELETE FROM holistic_mentorship_post_session_answers");
    expect(calls[4][0]).toContain("DELETE FROM holistic_mentorship_post_session_note_challenges");
    expect(calls[4][0]).toContain("(SELECT COUNT(*) FROM erased_answers) AS answers");
    expect(calls[4][0]).toContain("(SELECT COUNT(*) FROM erased_challenges) AS challenges");
    expect(calls[4][0]).toContain("'privacy_content_erased'");
    expect(calls[4][1]).toEqual([41, 9, "AF-approved request"]);
    // Existing content guards require these erasures before the tombstone, and
    // the Follow-up trigger requires the tombstone in a preceding statement.
    expect(calls[5][0]).toContain("INSERT INTO holistic_mentorship_privacy_deletions");
    expect(calls[5][0]).toContain(
      "post_session_answers_erased, post_session_challenges_erased, historical_answers_erased"
    );
    expect(calls[5][1]).toEqual([41, 9, "AF-approved request", 5, 2, 3, 1]);
    expect(calls[6][0]).toContain("UPDATE holistic_mentorship_follow_up_notes");
    expect(calls[6][0]).toContain("RETURNING target.pending_count");
    expect(calls[6][1]).toEqual([41, marker]);
    expect(calls[7][0]).toContain("INSERT INTO holistic_mentorship_follow_up_erasures");
    expect(calls[7][1]).toEqual([41, 9, "AF-approved request", 4]);
    expect(calls).toHaveLength(8);
  });

  it("keeps an existing tombstone immutable while auditing newly erased Follow-up answers", async () => {
    const client = mockPrivacyTransaction({ profiles: 0, historical: 0, postSession: 0, followUp: 2 });
    const result = await deleteHolisticStudentContent(deletionRequest);
    expect(result).toMatchObject({ ok: true, followUpAnswersErased: 2 });
    const calls = client.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[5][0]).toContain("ON CONFLICT (student_id) DO NOTHING");
    const sql = calls.map(([text]) => text).join("\n");
    expect(sql).not.toContain("UPDATE holistic_mentorship_privacy_deletions");
    expect(sql).not.toContain("DELETE FROM holistic_mentorship_follow_up_notes");
    expect(calls[7][1]).toEqual([41, 9, "AF-approved request", 2]);
    expect(calls[7][0]).not.toContain("ON CONFLICT");
  });

  it("makes an unchanged repeat a no-op without duplicating either audit", async () => {
    const client = mockPrivacyTransaction({ profiles: 0, historical: 0, postSession: 0, followUp: 0 });
    await expect(deleteHolisticStudentContent(deletionRequest)).resolves.toEqual({
      ok: true,
      profileSummariesErased: 0,
      postSessionAnswersErased: 0,
      postSessionChallengesErased: 0,
      historicalAnswersErased: 0,
      followUpAnswersErased: 0,
    });
    expect(client.query).toHaveBeenCalledTimes(7);
  });

  it("records Categories-only Notes as Category rows erased, not answers", async () => {
    const client = mockPrivacyTransaction({ profiles: 0, historical: 0, postSession: 0, challenges: 2, followUp: 0 });
    await expect(deleteHolisticStudentContent(deletionRequest)).resolves.toMatchObject({
      ok: true, postSessionAnswersErased: 0, postSessionChallengesErased: 2,
    });
    const calls = client.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[5][1]).toEqual([41, 9, "AF-approved request", 0, 0, 2, 0]);
  });

  it("refuses a missing or unauthorized actor/student scope before any erasure", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockTransaction.mockImplementation(async (work) => work(client as never));
    await expect(deleteHolisticStudentContent(deletionRequest)).resolves.toEqual({
      ok: false, status: 404, error: "Student not found",
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it.each([6, 7])("throws when new write %i fails so withTransaction can roll back", async (failAt) => {
    const client = mockPrivacyTransaction(
      { profiles: 1, historical: 1, postSession: 1, followUp: 1 }, { failAt }
    );
    await expect(deleteHolisticStudentContent(deletionRequest)).rejects.toThrow("write failed");
    expect(client.query).toHaveBeenCalledTimes(failAt + 1);
  });

  it("throws if a positive erasure count has no durable audit", async () => {
    mockPrivacyTransaction(
      { profiles: 0, historical: 0, postSession: 0, followUp: 1 }, { missingAudit: true }
    );
    await expect(deleteHolisticStudentContent(deletionRequest)).rejects.toThrow(
      "Follow-up erasure audit was not recorded"
    );
  });
});
