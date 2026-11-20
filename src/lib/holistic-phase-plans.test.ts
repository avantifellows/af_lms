import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

import { query, withTransaction } from "@/lib/db";
import { HOLISTIC_CLOSING_PHASE_CHANGED_ERROR } from "./holistic-phase-messages";
import { addHolisticPhase, createHolisticPhasePlan, deleteHolisticPhase, getHolisticPhaseOpenImpact, getHolisticPhasePlan, HOLISTIC_OPEN_PHASE_GRADE_ERROR, reorderHolisticPhases, setHolisticPhaseState, updateHolisticPhase } from "./holistic-phase-plans";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const actor = { actorEmail: "hm-admin@example.com", actorUserId: 9 };
const newPhase = {
  programId: 1,
  academicYear: "2026-2027",
  ...actor,
  grade: 11 as const,
  title: "Belonging",
  guidanceMarkdown: "Discuss goals",
  questions: [{ text: "What matters?" }],
};

function deletePhaseClient(laterPhase: Record<string, unknown>) {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "7" }] })
      .mockResolvedValueOnce({ rows: [{
        id: "21", phase_plan_id: "7", position: 2, revision: 1, state: "locked",
        academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false,
      }] })
      .mockResolvedValueOnce({ rows: [laterPhase] })
      .mockResolvedValue({ rows: [] }),
  };
}

async function deletePhaseWithLater(laterPhase: Record<string, unknown>) {
  const client = deletePhaseClient(laterPhase);
  mockWithTransaction.mockImplementation(async (fn) => fn(client as never));
  const result = await deleteHolisticPhase({
    programId: 1,
    phaseId: 21,
    expectedRevision: 1,
    ...actor,
  });
  return { client, result };
}

// Phase update and state change lock the Plan row before the Phase row.
const planLock = { rows: [{ id: "7" }] };

describe("Holistic Phase Plans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns stable numeric identities, per-Grade Phase numbers, and Active per Grade", async () => {
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
        { id: 23, number: 4, active: false },
        { id: 22, number: 2, active: true },
      ],
    });
  });

  it("numbers the JNV CoE Plan from issue #516 as Grade 11 = 1, 2 and Grade 12 = 4, 5", async () => {
    const phase = (id: string, grade: string, position: number) => ({
      id, grade_id: grade, grade, title: `Phase ${id}`, position, state: "open", guidance_markdown: "Talk",
      revision: 1, frozen_at: null, ever_opened: true, used: true,
    });
    mockQuery
      .mockResolvedValueOnce([{ id: "1", program_id: "1", academic_year: "2026-2027" }])
      .mockResolvedValueOnce([phase("1", "11", 1), phase("2", "12", 2), phase("15", "11", 3), phase("16", "12", 4)])
      .mockResolvedValueOnce([]);

    const plan = await getHolisticPhasePlan("2026-2027", 1);

    expect(plan?.phases.map(({ id, grade, number }) => [id, grade, number])).toEqual([
      [1, 11, 1], [2, 12, 4], [15, 11, 2], [16, 12, 5],
    ]);
  });

  it("numbers Grade 12 from 4 even when it was created before Grade 11", async () => {
    const phase = (id: string, grade: string, position: number) => ({
      id, grade_id: grade, grade, title: `Phase ${id}`, position, state: "open", guidance_markdown: "Talk",
      revision: 1, frozen_at: null, ever_opened: true, used: false,
    });
    mockQuery
      .mockResolvedValueOnce([{ id: "5", program_id: "94", academic_year: "2026-2027" }])
      .mockResolvedValueOnce([phase("9", "12", 1), phase("10", "11", 2)])
      .mockResolvedValueOnce([]);

    const plan = await getHolisticPhasePlan("2026-2027", 94);

    expect(plan?.phases.map(({ id, number }) => [id, number])).toEqual([[9, 4], [10, 1]]);
  });

  it("has no Active Phase in a past Academic Year's Plan", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: "5", program_id: "1", academic_year: "2025-2026" }])
      .mockResolvedValueOnce([
        { id: "11", grade_id: "11", grade: "11", title: "Belonging", position: 1, state: "open", guidance_markdown: "Talk", revision: 2, frozen_at: null, ever_opened: true, used: true },
        { id: "12", grade_id: "11", grade: "11", title: "Goals", position: 2, state: "open", guidance_markdown: "Plan", revision: 1, frozen_at: null, ever_opened: true, used: true },
      ])
      .mockResolvedValueOnce([]);

    // Its latest Open Phase would be Active this year; in a past year it is Closed.
    await expect(getHolisticPhasePlan("2025-2026", 1)).resolves.toMatchObject({
      editable: false,
      phases: [{ id: 11, active: false }, { id: 12, active: false }],
    });
  });

  it("rejects a stale definition save with safe reload metadata", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce(planLock).mockResolvedValueOnce({ rows: [{ id: "21", revision: 4 }] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(
      updateHolisticPhase({
      programId: 1,
        phaseId: 21,
        expectedRevision: 3,
        ...actor,
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
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", position: 1, revision: 2, state: "open",
          guidance_markdown: "Old Guidance", academic_year: "2026-2027", frozen_at: null,
          grade: "12", ever_opened: true, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [{ id: "41" }] })
        .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(updateHolisticPhase({
      programId: 1,
      phaseId: 21,
      expectedRevision: 2,
      ...actor,
      title: "New title",
      grade: 12,
      guidanceMarkdown: "New Guidance",
      questions: [{ id: 41, text: "New Question" }],
      confirmed: true,
    })).resolves.toEqual({ ok: true, id: 21, revision: 3 });

    expect(String(client.query.mock.calls[3][0])).not.toContain("CASE WHEN");
    expect(client.query.mock.calls[3][1]).toEqual([21, 12, "New title", "New Guidance", 2]);
    expect(client.query.mock.calls.at(-1)?.[1]).toEqual([7, 21, "definition_updated", 9, actor.actorEmail]);
  });

  it("refuses to move a Phase into a Grade that already has 3 Phases, and changes nothing", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", grade: "11", position: 4, revision: 1, state: "locked",
          guidance_markdown: "", academic_year: "2026-2027", frozen_at: null,
          ever_opened: false, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [{ count: "3" }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(updateHolisticPhase({
      programId: 1,
      phaseId: 21,
      expectedRevision: 1,
      ...actor,
      title: "Fourth",
      grade: 12,
      guidanceMarkdown: "",
      questions: [{ text: "What next?" }],
      confirmed: false,
    })).resolves.toEqual({ ok: false, status: 422, error: "Grade 12 already has 3 Phases" });

    expect(client.query).toHaveBeenCalledTimes(3);
  });

  // An opened or used Phase keeps its number: a Grade change before it would renumber it.
  it("refuses a Grade change that would renumber a later opened Phase, and changes nothing", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", grade: "11", position: 2, revision: 1, state: "locked",
          guidance_markdown: "", academic_year: "2026-2027", frozen_at: null,
          ever_opened: false, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(updateHolisticPhase({
      programId: 1,
      phaseId: 21,
      expectedRevision: 1,
      ...actor,
      title: "Moved",
      grade: 12,
      guidanceMarkdown: "",
      questions: [{ text: "What next?" }],
      confirmed: false,
    })).resolves.toEqual({
      ok: false, status: 422, error: "Changing the Grade would renumber an opened or used Phase",
    });

    const laterCheck = String(client.query.mock.calls[3][0]);
    expect(laterCheck).toContain("later.position > $2");
    expect(laterCheck).toContain("later.state <> 'locked'");
    expect(laterCheck).toContain("later.frozen_at IS NOT NULL");
    expect(laterCheck).toContain("t.to_state = 'open'");
    expect(laterCheck).toContain("holistic_mentorship_post_session_notes");
    expect(client.query.mock.calls[3][1]).toEqual([7, 2, [11, 12]]);
    expect(client.query).toHaveBeenCalledTimes(4);
  });

  // A Plan that already holds more than 3 Phases in a Grade must stay editable.
  it("saves a Phase that stays in its Grade without counting the Grade", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", grade: "11", position: 4, revision: 1, state: "locked",
          guidance_markdown: "", academic_year: "2026-2027", frozen_at: null,
          ever_opened: false, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ revision: 2 }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(updateHolisticPhase({
      programId: 1,
      phaseId: 21,
      expectedRevision: 1,
      ...actor,
      title: "Fourth Grade 11 Phase, renamed",
      grade: 11,
      guidanceMarkdown: "",
      questions: [{ text: "What next?" }],
      confirmed: false,
    })).resolves.toEqual({ ok: true, id: 21, revision: 2 });

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("COUNT(*) AS count"))).toBe(false);
    expect(statements.some((sql) => sql.includes("later.position"))).toBe(false);
    expect(statements.some((sql) => sql.includes("revision = later.revision + 1"))).toBe(false);
  });

  it.each([
    ["refuses a Grade change while the Phase is Open", "open", { ok: false, status: 422, error: HOLISTIC_OPEN_PHASE_GRADE_ERROR }, 2],
    ["allows a Grade change once the Phase is back to Locked", "locked", { ok: true, id: 21, revision: 3 }, null],
  ] as const)("%s", async (_name, state, expected, queries) => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", position: 1, revision: 2, state,
          guidance_markdown: "Guidance", academic_year: "2026-2027", frozen_at: null,
          grade: "11", ever_opened: true, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [{ count: "2" }] }) // Grade 12 has room (#516)
        .mockResolvedValueOnce({ rows: [] }) // no later opened or used Phase (#516)
        .mockResolvedValueOnce({ rows: [{ id: "41" }] })
        .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(updateHolisticPhase({
      programId: 1, phaseId: 21, expectedRevision: 2, ...actor, title: "Title", grade: 12,
      guidanceMarkdown: "Guidance", questions: [{ id: 41, text: "Question" }], confirmed: true,
    })).resolves.toEqual(expected);

    // Refused before anything is written: only the Plan lock and the Phase read ran.
    if (queries !== null) expect(client.query).toHaveBeenCalledTimes(queries);
    else {
      // Allowed: the target Grade is counted without this Phase, then later Phases of
      // both Grades (11 and 12) are checked for one already opened or used (#516).
      expect(client.query.mock.calls[2][1]).toEqual([7, 12, 21]);
      expect(client.query.mock.calls[3][1]).toEqual([7, 1, [11, 12]]);
      // The later Phases of both Grades are renumbered, so their revision moves too:
      // an Admin acting on a page that shows the old number gets "Phase changed".
      const [renumberedSql, renumberedParams] = client.query.mock.calls[6];
      expect(String(renumberedSql)).toContain("SET revision = later.revision + 1");
      expect(String(renumberedSql)).toContain("later.position > $2");
      expect(renumberedParams).toEqual([7, 1, [11, 12]]);
    }
  });

  it("locks the Plan row before the Phase row on a state change", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce(planLock).mockResolvedValueOnce({ rows: [] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await setHolisticPhaseState({ programId: 1, phaseId: 21, expectedRevision: 2, state: "open", ...actor, confirmed: true });

    const [planSql] = client.query.mock.calls[0];
    expect(String(planSql)).toContain("FOR UPDATE OF plan");
    const [phaseSql] = client.query.mock.calls[1];
    expect(String(phaseSql)).toContain("FOR UPDATE OF p");
    expect(String(phaseSql)).not.toContain("FOR UPDATE OF plan");
  });

  it("opens a complete Phase with more than four Questions", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
        .mockResolvedValueOnce({ rows: [] }) // no later Open Phase for the Grade
        .mockResolvedValueOnce({ rows: [{ grade: "11", title: "Belonging", guidance_markdown: "Discuss goals", question_count: "5", valid_question_count: "5" }] })
        .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ phaseId: 21, expectedRevision: 2, state: "open", ...actor, confirmed: true }))
      .resolves.toEqual({ ok: true, id: 21, revision: 3 });
    expect(client.query.mock.calls[5][1]).toEqual([21, "locked", "open", 9, actor.actorEmail]);
  });

  it("does not open a Phase ordered before one already Open for the same Grade", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
        .mockResolvedValueOnce({ rows: [{ number: "3" }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ programId: 1, phaseId: 21, expectedRevision: 2, state: "open", ...actor, confirmed: true }))
      .resolves.toEqual({
        ok: false, status: 422,
        error: "This Phase cannot be opened while Phase 3, a later Phase for this Grade, is Open",
      });
    // Stopped before the readiness check and before any write.
    expect(client.query).toHaveBeenCalledTimes(3);
    const [sql, params] = client.query.mock.calls[2];
    expect(String(sql)).toContain("later.grade_id = target.grade_id");
    expect(String(sql)).toContain("later.state = 'open' AND later.position > target.position");
    expect(params).toEqual([21]);
  });

  describe("the Phase the Admin was told would close", () => {
    const lockedPhase = { rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] };
    const ready = { rows: [{ grade: "11", title: "Belonging", guidance_markdown: "Discuss goals", question_count: "1", valid_question_count: "1" }] };

    function openWith(closingNow: { id: string }[], expectedClosingPhaseId: number | null) {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce(planLock)
          .mockResolvedValueOnce(lockedPhase)
          .mockResolvedValueOnce({ rows: [] }) // no later Open Phase for the Grade
          .mockResolvedValueOnce({ rows: closingNow })
          .mockResolvedValueOnce(ready)
          .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(client as never));
      return { client, result: setHolisticPhaseState({
        programId: 1, phaseId: 21, expectedRevision: 2, state: "open", ...actor, confirmed: true, expectedClosingPhaseId,
      }) };
    }

    it.each([
      ["the same Phase is still the one that closes", [{ id: "15" }], 15],
      ["no Phase closes, as the Admin was told", [], null],
    ] as const)("opens when %s", async (_name, closingNow, expected) => {
      const { client, result } = openWith([...closingNow], expected);

      await expect(result).resolves.toEqual({ ok: true, id: 21, revision: 3 });
      // Read under the Plan lock: the Grade's latest Open Phase.
      const [sql, params] = client.query.mock.calls[3];
      expect(String(sql)).toContain("active.grade_id = target.grade_id");
      expect(String(sql)).toContain("ORDER BY active.position DESC LIMIT 1");
      expect(params).toEqual([21]);
    });

    it.each([
      ["another Admin opened a different Phase in between", [{ id: "18" }], 15],
      ["a Phase would close but the Admin was told none would", [{ id: "15" }], null],
      ["the Phase the Admin was told about is no longer Open", [], 15],
    ] as const)("refuses, and writes nothing, when %s", async (_name, closingNow, expected) => {
      const { client, result } = openWith([...closingNow], expected);

      await expect(result).resolves.toEqual({ ok: false, status: 409, error: HOLISTIC_CLOSING_PHASE_CHANGED_ERROR });
      expect(client.query).toHaveBeenCalledTimes(4);
    });

    it("is not checked when the Phase returns to Locked", async () => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce(planLock)
          .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "open", academic_year: "2026-2027", frozen_at: null, ever_opened: true, used: false }] })
          .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

      await expect(setHolisticPhaseState({
        programId: 1, phaseId: 21, expectedRevision: 2, state: "locked", ...actor, confirmed: true, expectedClosingPhaseId: 15,
      })).resolves.toEqual({ ok: true, id: 21, revision: 3 });
      expect(client.query).toHaveBeenCalledTimes(4);
    });
  });

  it("is not found, and locks no Phase row, when the Phase is not in this Program", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ programId: 1, phaseId: 21, expectedRevision: 2, state: "open", ...actor, confirmed: true }))
      .resolves.toEqual({ ok: false, status: 404, error: "Phase not found" });
    expect(client.query).toHaveBeenCalledOnce();
  });

  it("returns an unused Active Phase to Locked without the open-order check", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "open", academic_year: "2026-2027", frozen_at: null, ever_opened: true, used: false }] })
        .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ programId: 1, phaseId: 21, expectedRevision: 2, state: "locked", ...actor, confirmed: true }))
      .resolves.toEqual({ ok: true, id: 21, revision: 3 });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[3][1]).toEqual([21, "open", "locked", 9, actor.actorEmail]);
  });

  it("does not open a Phase whose stored Question is blank", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
        .mockResolvedValueOnce({ rows: [] }) // no later Open Phase for the Grade
        .mockResolvedValueOnce({ rows: [{ grade: "11", title: "Belonging", guidance_markdown: "Discuss goals", question_count: "1", valid_question_count: "0" }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ phaseId: 21, expectedRevision: 2, state: "open", ...actor, confirmed: true }))
      .resolves.toEqual({ ok: false, status: 422, error: "Complete Grade, title, Guidance, and Questions before opening" });
    expect(client.query).toHaveBeenCalledTimes(4);
  });

  it("does not open a Phase with an unsupported Grade", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(planLock)
        .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
        .mockResolvedValueOnce({ rows: [] }) // no later Open Phase for the Grade
        .mockResolvedValueOnce({ rows: [{
          grade: "10", title: "Belonging", guidance_markdown: "Discuss goals",
          question_count: "1", valid_question_count: "1",
        }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(setHolisticPhaseState({ phaseId: 21, expectedRevision: 2, state: "open", ...actor, confirmed: true }))
      .resolves.toEqual({ ok: false, status: 422, error: "Complete Grade, title, Guidance, and Questions before opening" });
  });

  it("does not delete a Phase that has ever opened", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "7" }] })
      .mockResolvedValueOnce({ rows: [{ id: "21", revision: 3, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: true, used: false }] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(deleteHolisticPhase({ phaseId: 21, expectedRevision: 3, ...actor }))
      .resolves.toEqual({ ok: false, status: 422, error: "Only never-opened, unused Locked Phases can be deleted" });
  });

  it("reorders never-opened Locked Phases without changing their stable IDs", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "7" }] })
        .mockResolvedValueOnce({ rows: [
          { id: "21", phase_plan_id: "7", position: 1, revision: 1, state: "locked", frozen_at: null, ever_opened: false, used: false },
          { id: "22", phase_plan_id: "7", position: 2, revision: 2, state: "locked", frozen_at: null, ever_opened: false, used: false },
        ] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(reorderHolisticPhases({ academicYear: "2026-2027", ...actor, phases: [
      { id: 22, expectedRevision: 2 }, { id: 21, expectedRevision: 1 },
    ] })).resolves.toEqual({ ok: true });
    expect(String(client.query.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(String(client.query.mock.calls[1][0])).toContain("FOR UPDATE");
    expect(client.query.mock.calls[2][1]).toEqual([[22, 21]]);
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes("phase_mutation_audits")))
      .toHaveLength(2);
  });

  // The server side of a same-Grade move: 22 swaps with 21 across the other Grade's
  // Phase 31. The reorder code is older than issue #516; which Phases Phase Setup
  // swaps is covered in PhasePlanSetup.test.tsx.
  it("swaps two Phases around a Phase that keeps its position", async () => {
    const row = (id: string, position: number, overrides = {}) => ({
      id, phase_plan_id: "7", position, revision: 1, state: "locked", frozen_at: null,
      ever_opened: false, used: false, ...overrides,
    });
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "7" }] })
        .mockResolvedValueOnce({ rows: [
          row("21", 1), row("31", 2, { state: "open", ever_opened: true, used: true }), row("22", 3),
        ] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(reorderHolisticPhases({ programId: 1, academicYear: "2026-2027", ...actor, phases: [
      { id: 22, expectedRevision: 1 }, { id: 31, expectedRevision: 1 }, { id: 21, expectedRevision: 1 },
    ] })).resolves.toEqual({ ok: true });

    const positionWrites = client.query.mock.calls
      .filter(([sql]) => String(sql).includes("SET position = $2"))
      .map(([, params]) => params);
    expect(positionWrites).toEqual([[22, 1, 1], [21, 3, 1]]);
    expect(client.query.mock.calls[2][1]).toEqual([[22, 21]]);
  });

  it("copies only prior definitions into independent Locked Phases", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "5" }] })
        .mockResolvedValueOnce({ rows: [] }) // no Grade of the prior Plan is over the limit
        .mockResolvedValueOnce({ rows: [{ id: "7" }] })
        .mockResolvedValueOnce({ rows: [{ old_id: "21", new_id: "31" }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(createHolisticPhasePlan({
      programId: 1,
      academicYear: "2026-2027",
      copyFromAcademicYear: "2025-2026",
      ...actor,
    }))
      .resolves.toEqual({ ok: true, id: 7 });
    expect(client.query.mock.calls[1][1]).toEqual([5, 3]);
    expect(String(client.query.mock.calls[3][0])).toContain("'locked'");
    expect(client.query.mock.calls[4][1]).toEqual([31, 21]);
    expect(client.query.mock.calls[5][1]).toEqual([7, 31, "created", 9, actor.actorEmail]);
  });

  // A Plan made before the limit: copying 4 Grade 11 Phases would show two "Phase 4".
  it("refuses to copy a prior Plan with more than 3 Phases in a Grade, and creates nothing", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "5" }] })
        .mockResolvedValueOnce({ rows: [{ grade: "11" }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(createHolisticPhasePlan({
      programId: 1,
      academicYear: "2026-2027",
      copyFromAcademicYear: "2025-2026",
      ...actor,
    })).resolves.toEqual({ ok: false, status: 422, error: "The prior Plan has more than 3 Phases in Grade 11" });

    const [overLimitSql, overLimitParams] = client.query.mock.calls[1];
    expect(String(overLimitSql)).toContain("HAVING COUNT(*) > $2");
    expect(overLimitParams).toEqual([5, 3]);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("audits a newly added Phase", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "7" }] })
        .mockResolvedValueOnce({ rows: [{ count: "2" }] })
        .mockResolvedValueOnce({ rows: [{ id: "21", phase_plan_id: "7" }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(addHolisticPhase(newPhase))
      .resolves.toEqual({ ok: true, id: 21, revision: 1 });

    expect(String(client.query.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(client.query.mock.calls[0][1]).toEqual([1, "2026-2027"]);
    expect(client.query.mock.calls[1][1]).toEqual([7, 11, null]);
    expect(String(client.query.mock.calls[2][0])).toContain("MAX(position) + 1");
    expect(client.query.mock.calls.at(-1)?.[1]).toEqual([7, 21, "created", 9, actor.actorEmail]);
  });

  it("refuses a 4th Phase in a Grade and inserts nothing", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "7" }] })
        .mockResolvedValueOnce({ rows: [{ count: "3" }] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(addHolisticPhase(newPhase))
      .resolves.toEqual({ ok: false, status: 422, error: "Grade 11 already has 3 Phases" });

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO"))).toBe(false);
  });

  it("returns before calculating a Phase position when the locked Plan is missing", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    await expect(addHolisticPhase(newPhase))
      .resolves.toEqual({ ok: false, status: 404, error: "Plan not found" });

    expect(client.query).toHaveBeenCalledOnce();
    expect(String(client.query.mock.calls[0][0])).toContain("FOR UPDATE");
  });

  it("deletes a future mutable Phase, compacts later mutable positions, and audits both changes", async () => {
    const { client, result } = await deletePhaseWithLater({
      id: "22", phase_plan_id: "7", position: 3, revision: 1, state: "locked",
      frozen_at: null, ever_opened: false, used: false,
    });
    expect(result).toEqual({ ok: true, id: 21 });

    expect(String(client.query.mock.calls[0][0])).toContain("FOR UPDATE OF plan");
    expect(String(client.query.mock.calls[1][0])).toContain("FOR UPDATE");
    const auditArgs = client.query.mock.calls
      .filter(([sql]) => String(sql).includes("phase_mutation_audits"))
      .map(([, params]) => params);
    expect(auditArgs).toEqual([
      [7, 21, "deleted", 9, actor.actorEmail],
      [7, 22, "reordered", 9, actor.actorEmail],
    ]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("position = position - 10001")))
      .toBe(true);
  });

  it("rejects deletion when compaction would move an immutable Phase", async () => {
    const { client, result } = await deletePhaseWithLater({
      id: "22", phase_plan_id: "7", position: 3, revision: 2, state: "open",
      frozen_at: null, ever_opened: true, used: false,
    });
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "Deleting this Phase would move an opened or used Phase",
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it("rejects raw HTML, embedded images, and unsafe Guidance links", async () => {
    for (const guidanceMarkdown of ["<iframe src='x'>", "![image](https://x)", "[bad](javascript:alert(1))"]) {
      const result = await addHolisticPhase({
      programId: 1,
        academicYear: "2026-2027", ...actor, grade: 11, title: "Safety", guidanceMarkdown,
        questions: [{ text: "What matters?" }],
      });
      expect(result).toMatchObject({ ok: false, status: 422 });
    }
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  describe("what opening a Locked Phase would close", () => {
    const target = { phase_plan_id: "7", grade_id: "3", grade: "12", position: 4, academic_year: "2026-2027" };

    it("is not found for a Phase that is missing, in another Program, or not Locked", async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(getHolisticPhaseOpenImpact(1, 16)).resolves.toBeNull();

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(String(mockQuery.mock.calls[0][0])).toContain("phase.state = 'locked'");
      // A past year's Plan is read-only, so nothing in it can be opened.
      expect(String(mockQuery.mock.calls[0][0])).toContain("plan.academic_year = $3");
      expect(mockQuery.mock.calls[0][1]).toEqual([16, 1, "2026-2027"]);
    });

    it("closes nothing when the Grade has no earlier Active Phase", async () => {
      mockQuery.mockResolvedValueOnce([target]).mockResolvedValueOnce([]);

      await expect(getHolisticPhaseOpenImpact(1, 16)).resolves.toEqual({ closing: null });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      // Same Plan and Grade, ordered before the Phase being opened.
      expect(mockQuery.mock.calls[1][1]).toEqual([7, 3, 4]);
    });

    it("counts the Grade's assigned Mentees still without submitted Notes in the Active Phase", async () => {
      mockQuery
        .mockResolvedValueOnce([target])
        .mockResolvedValueOnce([{ id: "15", number: "2" }])
        .mockResolvedValueOnce([{ without_notes: "45", drafts: "1" }]);

      // The id goes back with the open, so the server can tell if it changed.
      await expect(getHolisticPhaseOpenImpact(1, 16)).resolves.toEqual({
        closing: { id: 15, number: 2, menteesWithoutNotes: 45, unsubmittedDrafts: 1 },
      });

      const [sql, params] = mockQuery.mock.calls[2];
      // Program, Academic Year, Grade, and the Phase that will close.
      expect(params).toEqual([1, "2026-2027", 12, 15]);
      // The Mentor write scope's Mentee set: active Mapping, not a dropout,
      // one unambiguous roster Grade, no privacy tombstone.
      expect(String(sql)).toContain("mapping.ended_at IS NULL");
      expect(String(sql)).toContain("st.status IS DISTINCT FROM 'dropout'");
      expect(String(sql)).toContain("HAVING COUNT(DISTINCT roster_student.grade) = 1");
      // The Centre membership view is read once for the Program and year, not
      // once per Mapping (that shape timed out in production, #321).
      expect(String(sql)).toContain("roster_snapshot AS MATERIALIZED");
      expect(String(sql)).not.toContain("LATERAL");
      expect(String(sql)).toContain("holistic_mentorship_privacy_deletions");
      expect(String(sql)).toContain("notes.state IS DISTINCT FROM 'submitted'");
    });
  });
});
