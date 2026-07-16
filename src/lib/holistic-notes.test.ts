import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query, withTransaction } from "./db";
import { saveHolisticNotes } from "./holistic-notes";

const mockWithTransaction = vi.mocked(withTransaction);
const mockQuery = vi.mocked(query);

describe("Holistic Post-Session Notes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not create Notes for an empty initial draft", async () => {
    await expect(saveHolisticNotes({
      mode: "draft",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      expectedRevision: 0,
      answers: [{ questionId: 91, answer: "   " }],
    })).resolves.toEqual({ ok: true, changed: false, revision: 0 });

    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("creates and freezes the first non-empty draft atomically", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" }] })
      .mockResolvedValueOnce({ rows: [{ id: "91" }, { id: "92" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "501", revision: 1 }] })
      .mockResolvedValue({ rows: [] }) };
    mockWithTransaction.mockImplementation(async (work) => work(client as never));

    await expect(saveHolisticNotes({
      mode: "draft",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      expectedRevision: 0,
      answers: [{ questionId: 91, answer: "A weekly plan" }],
    })).resolves.toEqual({ ok: true, changed: true, revision: 1 });
  });

  it("rejects Submit until every configured Question has an answer", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" }] })
      .mockResolvedValueOnce({ rows: [{ id: "91" }, { id: "92" }] })
      .mockResolvedValueOnce({ rows: [{ id: "501", author_user_id: "9", state: "draft", revision: 2 }] }) };
    mockWithTransaction.mockImplementation(async (work) => work(client as never));

    await expect(saveHolisticNotes({
      mode: "submit",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      expectedRevision: 2,
      expectedMappingId: 300,
      expectedPhaseRevision: 5,
      confirmed: true,
      answers: [
        { questionId: 91, answer: "A weekly plan" },
        { questionId: 92, answer: "  " },
      ],
    })).resolves.toEqual({ ok: false, status: 422, error: "Answer every Question before submitting" });
  });

  it("submits a complete current draft with optimistic revisions", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" }] })
      .mockResolvedValueOnce({ rows: [{ id: "91" }, { id: "92" }] })
      .mockResolvedValueOnce({ rows: [{ id: "501", author_user_id: "9", state: "draft", revision: 2 }] })
      .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
      .mockResolvedValue({ rows: [] }) };
    mockWithTransaction.mockImplementation(async (work) => work(client as never));

    await expect(saveHolisticNotes({
      mode: "submit",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      expectedRevision: 2,
      expectedMappingId: 300,
      expectedPhaseRevision: 5,
      confirmed: true,
      answers: [
        { questionId: 91, answer: "A weekly plan" },
        { questionId: 92, answer: "Ask for feedback" },
      ],
    })).resolves.toEqual({ ok: true, changed: true, revision: 3 });
  });

  it("does not let a replacement Mentor edit another author's submitted Notes", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ mapping_id: "301", mentor_user_id: "10", phase_revision: 5, phase_state: "open" }] })
      .mockResolvedValueOnce({ rows: [{ id: "91" }] })
      .mockResolvedValueOnce({ rows: [{ id: "501", author_user_id: "9", state: "submitted", revision: 3 }] }) };
    mockWithTransaction.mockImplementation(async (work) => work(client as never));

    await expect(saveHolisticNotes({
      mode: "edit",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 10,
      expectedRevision: 3,
      expectedMappingId: 301,
      expectedPhaseRevision: 5,
      confirmed: true,
      answers: [{ questionId: 91, answer: "Changed" }],
    })).resolves.toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("lets a replacement Mentor claim an erased empty draft", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ mapping_id: "301", mentor_user_id: "10", phase_revision: 5, phase_state: "open" }] })
      .mockResolvedValueOnce({ rows: [{ id: "91" }] })
      .mockResolvedValueOnce({ rows: [{ id: "501", author_user_id: "9", state: "draft", revision: 4, has_answers: false }] })
      .mockResolvedValueOnce({ rows: [{ revision: 5 }] })
      .mockResolvedValue({ rows: [] }) };
    mockWithTransaction.mockImplementation(async (work) => work(client as never));

    await expect(saveHolisticNotes({
      mode: "draft",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 10,
      expectedRevision: 4,
      answers: [{ questionId: 91, answer: "A fresh start" }],
    })).resolves.toEqual({ ok: true, changed: true, revision: 5 });
  });

  it("corrects the author's submitted Notes without another Submit", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" }] })
      .mockResolvedValueOnce({ rows: [{ id: "91" }] })
      .mockResolvedValueOnce({ rows: [{ id: "501", author_user_id: "9", state: "submitted", revision: 3 }] })
      .mockResolvedValueOnce({ rows: [{ revision: 4 }] })
      .mockResolvedValue({ rows: [] }) };
    mockWithTransaction.mockImplementation(async (work) => work(client as never));

    await expect(saveHolisticNotes({
      mode: "edit",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      expectedRevision: 3,
      expectedMappingId: 300,
      expectedPhaseRevision: 5,
      confirmed: true,
      answers: [{ questionId: 91, answer: "Corrected answer" }],
    })).resolves.toEqual({ ok: true, changed: true, revision: 4 });
  });

  it("returns the safe current revision without replacing a stale draft", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ mapping_id: "300", mentor_user_id: "9", phase_revision: 5, phase_state: "open" }] })
      .mockResolvedValueOnce({ rows: [{ id: "91" }] })
      .mockResolvedValueOnce({ rows: [{ id: "501", author_user_id: "9", state: "draft", revision: 3 }] }) };
    mockWithTransaction.mockImplementation(async (work) => work(client as never));

    await expect(saveHolisticNotes({
      mode: "draft",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      expectedRevision: 2,
      answers: [{ questionId: 91, answer: "Stale answer" }],
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Notes changed; reload the latest version",
      currentRevision: 3,
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it("returns 409 when concurrent first drafts race on the logical Notes set", async () => {
    mockWithTransaction.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "23505" }));
    mockQuery.mockResolvedValueOnce([{ revision: 1 }]);

    await expect(saveHolisticNotes({
      mode: "draft",
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      academicYear: "2026-2027",
      actorUserId: 9,
      expectedRevision: 0,
      answers: [{ questionId: 91, answer: "First writer" }],
    })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Notes changed; reload the latest version",
      currentRevision: 1,
    });
  });
});
