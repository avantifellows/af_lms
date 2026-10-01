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
      { rows: [{
        id: "601",
        submitted_at: "2026-08-03T10:00:00Z",
        author_first_name: "Nila",
        author_last_name: "Sen",
        author_email: "nila.sen@example.com",
        challenges_answer: "Exam stress",
        solutions_answer: null,
        action_plan_answer: "Yes, mostly",
      }] },
    );

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: true,
      followUpNote: {
        id: 601,
        submittedAt: "2026-08-03T10:00:00Z",
        authorName: "Nila Sen",
        answers: [
          { key: "challenges", answer: "Exam stress" },
          { key: "action_plan", answer: "Yes, mostly" },
        ],
      },
    });
    expect(client.query).toHaveBeenLastCalledWith(
      expect.any(String),
      [41, 73, 9, "nila.sen@example.com", "Exam stress", null, "Yes, mostly"],
    );
  });

  it("reports a Student changed by a privacy tombstone race as a conflict", async () => {
    const client = transactionClient({ rows: [openScope] }, { rows: [{ state: "submitted" }] });
    client.query.mockRejectedValueOnce(Object.assign(new Error("blocked"), { code: "23514" }));

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Student changed; reload before saving",
    });
  });

  it("rethrows unrelated database errors", async () => {
    const client = transactionClient({ rows: [openScope] }, { rows: [{ state: "submitted" }] });
    const failure = Object.assign(new Error("deadlock"), { code: "40P01" });
    client.query.mockRejectedValueOnce(failure);

    await expect(addHolisticFollowUpNote(input)).rejects.toBe(failure);
  });

  const insertedRow = {
    id: "602",
    submitted_at: "2026-08-04T10:00:00Z",
    author_first_name: null,
    author_last_name: null,
    author_email: "nila.sen@example.com",
    challenges_answer: "Exam stress",
    solutions_answer: null,
    action_plan_answer: "Yes, mostly",
  };

  it("does not insert when the Mentor write scope is missing", async () => {
    const client = transactionClient({ rows: [] });

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false, status: 404, error: "Not found",
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("does not insert for an actor who is not the Mapping's Mentor", async () => {
    const client = transactionClient({ rows: [{ ...openScope, mentor_user_id: "12" }] });

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false, status: 404, error: "Not found",
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("does not insert on a Phase that is not Open", async () => {
    const client = transactionClient({ rows: [{ ...openScope, phase_state: "locked" }] });

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false, status: 422, error: "Phase is not Open",
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["draft Post-Session Notes", [{ state: "draft" }]],
    ["no Post-Session Notes", []],
  ])("does not insert with %s", async (_label, notesRows) => {
    const client = transactionClient({ rows: [openScope] }, { rows: notesRows });

    await expect(addHolisticFollowUpNote(input)).resolves.toEqual({
      ok: false, status: 422, error: "Submit Post-Session Notes first",
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("lets a reassigned Mentor follow up on another author's submitted Notes", async () => {
    transactionClient(
      { rows: [openScope] },
      { rows: [{ state: "submitted", author_user_id: "12" }] },
      { rows: [insertedRow] },
    );

    await expect(addHolisticFollowUpNote(input)).resolves.toMatchObject({
      ok: true,
      followUpNote: { id: 602, authorName: "nila.sen@example.com" },
    });
  });

  it("saves on an applicable prior-year Grade 11 Phase", async () => {
    const client = transactionClient(
      { rows: [openScope] },
      { rows: [{ state: "submitted" }] },
      { rows: [insertedRow] },
    );

    await expect(addHolisticFollowUpNote({ ...input, phaseId: 70 })).resolves.toMatchObject({
      ok: true,
      followUpNote: { id: 602 },
    });
    expect(client.query.mock.calls[0][1]).toEqual([70, 41, 4, 1, "2026-2027", "2025-2026"]);
  });
});
