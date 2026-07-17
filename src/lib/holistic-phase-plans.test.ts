import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

import { query, withTransaction } from "@/lib/db";
import { addHolisticPhase, createHolisticPhasePlan, deleteHolisticPhase, getHolisticPhasePlan, reorderHolisticPhases, setHolisticPhaseState, updateHolisticPhase } from "./holistic-phase-plans";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);

describe("Holistic Phase Plans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns stable numeric identities, dynamic Phase numbers, and Active per Grade", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: "7", program_id: "1", academic_year: "2026-2027" }])
      .mockResolvedValueOnce([
        { id: "21", grade_id: "11", grade: "11", title: "Belonging", position: 1, state: "open", guidance_markdown: "Talk", revision: 2, frozen_at: null, ever_opened: true, used: false },
        { id: "23", grade_id: "12", grade: "12", title: "Choices", position: 2, state: "locked", guidance_markdown: "", revision: 1, frozen_at: null, ever_opened: false, used: false },
        { id: "22", grade_id: "11", grade: "11", title: "Goals", position: 3, state: "open", guidance_markdown: "Plan", revision: 1, frozen_at: null, ever_opened: true, used: false },
      ])
      .mockResolvedValueOnce([
        { id: "41", phase_id: "21", text: "What matters?", position: 1 },
      ]);

    await expect(getHolisticPhasePlan("2026-2027")).resolves.toMatchObject({
      id: 7,
      programId: 1,
      phases: [
        { id: 21, number: 1, gradeId: 11, grade: 11, active: false, questions: [{ id: 41 }] },
        { id: 23, number: 2, active: false },
        { id: 22, number: 3, active: true },
      ],
    });
  });

  it("rejects a stale definition save with safe reload metadata", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: "21", revision: 4 }] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(
      updateHolisticPhase({
        phaseId: 21,
        expectedRevision: 3,
        actorUserId: 9,
        title: "My unsaved title",
        grade: 11,
        guidanceMarkdown: "My unsaved guidance",
        questions: [{ id: 41, text: "My unsaved question" }],
        confirmed: false,
      })
    ).resolves.toEqual({ ok: false, status: 409, error: "Phase changed", currentRevision: 4 });
  });

  it("updates and audits the full definition of an opened but unused Phase after confirmation", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", position: 1, revision: 2, state: "open",
          guidance_markdown: "Old Guidance", academic_year: "2026-2027", frozen_at: null,
          ever_opened: true, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [{ id: "41" }] })
        .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(updateHolisticPhase({
      phaseId: 21,
      expectedRevision: 2,
      actorUserId: 9,
      title: "New title",
      grade: 12,
      guidanceMarkdown: "New Guidance",
      questions: [{ id: 41, text: "New Question" }],
      confirmed: true,
    })).resolves.toEqual({ ok: true, id: 21, revision: 3 });

    expect(String(client.query.mock.calls[2][0])).not.toContain("CASE WHEN");
    expect(client.query.mock.calls[2][1]).toEqual([21, 12, "New title", "New Guidance", 2]);
    expect(client.query.mock.calls.at(-1)?.[1]).toEqual([7, 21, "definition_updated", 9]);
  });

  it("opens a complete Phase out of sequence and records the confirmed actor transition", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
        .mockResolvedValueOnce({ rows: [{ grade: "11", title: "Belonging", guidance_markdown: "Discuss goals", question_count: "2", valid_question_count: "2" }] })
        .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ phaseId: 21, expectedRevision: 2, state: "open", actorUserId: 9, confirmed: true }))
      .resolves.toEqual({ ok: true, id: 21, revision: 3 });
    expect(client.query.mock.calls[3][1]).toEqual([21, "locked", "open", 9]);
  });

  it("does not open a Phase whose stored Question is blank", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
        .mockResolvedValueOnce({ rows: [{ grade: "11", title: "Belonging", guidance_markdown: "Discuss goals", question_count: "1", valid_question_count: "0" }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ phaseId: 21, expectedRevision: 2, state: "open", actorUserId: 9, confirmed: true }))
      .resolves.toEqual({ ok: false, status: 422, error: "Complete Grade, title, Guidance, and Questions before opening" });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an unsupported Grade", { grade: "10", question_count: "1", valid_question_count: "1" }],
    ["more than four Questions", { grade: "11", question_count: "5", valid_question_count: "5" }],
  ])("does not open a Phase with %s", async (_case, definition) => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
        .mockResolvedValueOnce({ rows: [{ title: "Belonging", guidance_markdown: "Discuss goals", ...definition }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ phaseId: 21, expectedRevision: 2, state: "open", actorUserId: 9, confirmed: true }))
      .resolves.toEqual({ ok: false, status: 422, error: "Complete Grade, title, Guidance, and Questions before opening" });
  });

  it("does not delete a Phase that has ever opened", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: "21", revision: 3, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: true, used: false }] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(deleteHolisticPhase({ phaseId: 21, expectedRevision: 3, actorUserId: 9 }))
      .resolves.toEqual({ ok: false, status: 422, error: "Only never-opened, unused Locked Phases can be deleted" });
  });

  it("reorders never-opened Locked Phases without changing their stable IDs", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [
          { id: "21", phase_plan_id: "7", position: 1, revision: 1, state: "locked", frozen_at: null, ever_opened: false, used: false },
          { id: "22", phase_plan_id: "7", position: 2, revision: 2, state: "locked", frozen_at: null, ever_opened: false, used: false },
        ] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(reorderHolisticPhases({ academicYear: "2026-2027", actorUserId: 9, phases: [
      { id: 22, expectedRevision: 2 }, { id: 21, expectedRevision: 1 },
    ] })).resolves.toEqual({ ok: true });
    expect(client.query.mock.calls[1][1]).toEqual([[22, 21]]);
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes("phase_mutation_audits")))
      .toHaveLength(2);
  });

  it("copies only prior definitions into independent Locked Phases", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "5" }] })
        .mockResolvedValueOnce({ rows: [{ id: "7" }] })
        .mockResolvedValueOnce({ rows: [{ old_id: "21", new_id: "31" }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(createHolisticPhasePlan({
      academicYear: "2026-2027",
      copyFromAcademicYear: "2025-2026",
      actorUserId: 9,
    }))
      .resolves.toEqual({ ok: true, id: 7 });
    expect(String(client.query.mock.calls[2][0])).toContain("'locked'");
    expect(client.query.mock.calls[3][1]).toEqual([31, 21]);
    expect(client.query.mock.calls[4][1]).toEqual([7, 31, "created", 9]);
  });

  it("audits a newly added Phase", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "21", phase_plan_id: "7" }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(addHolisticPhase({
      academicYear: "2026-2027",
      actorUserId: 9,
      grade: 11,
      title: "Belonging",
      guidanceMarkdown: "Discuss goals",
      questions: [{ text: "What matters?" }],
    })).resolves.toEqual({ ok: true, id: 21, revision: 1 });

    expect(client.query.mock.calls.at(-1)?.[1]).toEqual([7, 21, "created", 9]);
  });

  it("deletes a future mutable Phase, compacts later mutable positions, and audits both changes", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", position: 2, revision: 1, state: "locked",
          academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [{
          id: "22", phase_plan_id: "7", position: 3, revision: 1, state: "locked",
          frozen_at: null, ever_opened: false, used: false,
        }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(deleteHolisticPhase({ phaseId: 21, expectedRevision: 1, actorUserId: 9 }))
      .resolves.toEqual({ ok: true, id: 21 });

    const auditArgs = client.query.mock.calls
      .filter(([sql]) => String(sql).includes("phase_mutation_audits"))
      .map(([, params]) => params);
    expect(auditArgs).toEqual([
      [7, 21, "deleted", 9],
      [7, 22, "reordered", 9],
    ]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("position = position - 10001")))
      .toBe(true);
  });

  it("rejects deletion when compaction would move an immutable Phase", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", position: 2, revision: 1, state: "locked",
          academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [{
          id: "22", phase_plan_id: "7", position: 3, revision: 2, state: "open",
          frozen_at: null, ever_opened: true, used: false,
        }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(deleteHolisticPhase({ phaseId: 21, expectedRevision: 1, actorUserId: 9 }))
      .resolves.toEqual({
        ok: false,
        status: 422,
        error: "Deleting this Phase would move an opened or used Phase",
      });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("rejects raw HTML, embedded images, and unsafe Guidance links", async () => {
    for (const guidanceMarkdown of ["<iframe src='x'>", "![image](https://x)", "[bad](javascript:alert(1))"]) {
      const result = await addHolisticPhase({
        academicYear: "2026-2027", actorUserId: 9, grade: 11, title: "Safety", guidanceMarkdown,
        questions: [{ text: "What matters?" }],
      });
      expect(result).toMatchObject({ ok: false, status: 422 });
    }
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
