import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { withTransaction } from "./db";
import { addHolisticFollowUpNote } from "./holistic-follow-up-notes";

const mockWithTransaction = vi.mocked(withTransaction);

const openScope = { mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" };
const input = {
  studentId: 41,
  phaseId: 73,
  schoolId: 4,
  programId: 1,
  academicYear: "2026-2027",
  actorUserId: 9,
  actorEmail: " Nila.Sen@Example.com ",
  answers: { challenges: "Exam stress", solutions: null, action_plan: "Yes, mostly" },
};

function transactionClient(...results: Array<{ rows: unknown[] }>) {
  const client = { query: vi.fn() };
  client.query.mockResolvedValueOnce({ rows: [] }); // per-Student privacy lock
  for (const result of results) client.query.mockResolvedValueOnce(result);
  mockWithTransaction.mockImplementation(async (work) => work(client as never));
  return client;
}

describe("addHolisticFollowUpNote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the current Mentor's Follow-up Note on submitted Post-Session Notes", async () => {
    const client = transactionClient(
      { rows: [openScope] },
      { rows: [{ state: "submitted" }] },
      { rows: [{ id: "601" }] },
    );

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({ ok: true, id: 601 });
    expect(client.query).toHaveBeenLastCalledWith(
      expect.stringContaining("RETURNING id"),
      [41, 73, 9, "nila.sen@example.com", "Exam stress", null, "Yes, mostly"],
    );
  });

  it("takes the per-Student privacy lock before the write-scope row locks", async () => {
    const client = transactionClient({ rows: [openScope] }, { rows: [{ state: "submitted" }] }, { rows: [{ id: "602" }] });

    await addHolisticFollowUpNote(input);

    expect(client.query.mock.calls[0]).toEqual(["SELECT pg_advisory_xact_lock($1, 0)", [41]]);
    expect(String(client.query.mock.calls[1][0])).toContain("FOR UPDATE OF mapping, phase");
  });

  it("does not insert when the Mentor write scope is missing", async () => {
    const client = transactionClient({ rows: [] });

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false, status: 404, error: "Not found",
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("does not insert for an actor who is not the Mapping's Mentor", async () => {
    const client = transactionClient({ rows: [{ ...openScope, mentor_user_id: "12" }] });

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false, status: 404, error: "Not found",
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("does not insert on a Phase that is not Open", async () => {
    const client = transactionClient({ rows: [{ ...openScope, phase_state: "locked" }] });

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false, status: 422, error: "Phase is not Open",
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["draft Post-Session Notes", [{ state: "draft" }]],
    ["no Post-Session Notes", []],
  ])("does not insert with %s", async (_label, notesRows) => {
    const client = transactionClient({ rows: [openScope] }, { rows: notesRows });

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false, status: 422, error: "Submit Post-Session Notes first",
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });
});
