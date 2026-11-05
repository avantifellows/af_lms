import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query, withTransaction } from "./db";
import type { BlendedLearningAccess } from "./blended-learning-access";
import {
  createCommonActionItem,
  listCommonActionItems,
  listTargetMentors,
  previewCommonTarget,
  pushCommonActionItem,
  removeCommonActionItem,
  updateCommonActionItem,
} from "./blended-learning-common-action-items";

const mockQuery = vi.mocked(query);
const clientQuery = vi.fn();

const ADMIN: BlendedLearningAccess = {
  kind: "admin", role: "admin", readOnly: false, actorEmail: "admin@avantifellows.org",
};
const READ_ONLY_ADMIN: BlendedLearningAccess = { ...ADMIN, role: "blended_admin", readOnly: true };
const MENTOR: BlendedLearningAccess = {
  kind: "mentor", role: "blended_mentor", readOnly: false, actorEmail: "faizan@avantifellows.org", mentorUserId: 9001,
};
const YEAR = "2026-2027";

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue([]);
  clientQuery.mockReset();
  clientQuery.mockResolvedValue(result());
  vi.mocked(withTransaction).mockReset();
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn({ query: clientQuery } as never));
});

describe("access", () => {
  it.each([
    ["a Mentor", MENTOR],
    ["a read-only admin", READ_ONLY_ADMIN],
  ])("refuses %s every read and write without touching the database", async (_who, access) => {
    const forbidden = { ok: false, status: 403, error: "Forbidden" };
    expect(await previewCommonTarget(access, { kind: "all" })).toEqual(forbidden);
    expect(await createCommonActionItem(access, { text: "x", owner: "student", target: { kind: "all" } })).toEqual(forbidden);
    expect(await pushCommonActionItem(access, 1)).toEqual(forbidden);
    expect(await updateCommonActionItem(access, 1, { text: "x", owner: "student" })).toEqual(forbidden);
    expect(await removeCommonActionItem(access, 1)).toEqual(forbidden);
    expect(await listCommonActionItems(access)).toEqual([]);
    expect(await listTargetMentors(access)).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("previewCommonTarget", () => {
  it.each([
    [{ kind: "all" }, ["all", null, null, null, YEAR]],
    [{ kind: "grade", grade: "13" }, ["grade", 13, null, null, YEAR]],
    [{ kind: "mentor", mentorUserId: "77" }, ["mentor", null, 77, null, YEAR]],
  ])("counts the Students %j reaches through active Mappings and the list's grade", async (target, params) => {
    mockQuery.mockResolvedValue([{ count: "5" }]);

    expect(await previewCommonTarget(ADMIN, target)).toEqual({ ok: true, count: 5, notFound: [], noMentor: [] });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, bound] = mockQuery.mock.calls[0];
    expect(bound).toEqual(params);
    expect(sql).toMatch(/academic_year = \$5 AND mapping\.ended_at IS NULL/);
    expect(sql).toMatch(/er\.group_type = 'grade' AND er\.is_current IS TRUE/);
    expect(sql).toMatch(/st\.student_id = ANY\(\$4::text\[\]\)/);
  });

  it("counts listed Student IDs that have an active Mapping and names the ones that don't", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes("unnest")
        ? [
            { student_id: "01234567890", found: true, mapped: true },
            { student_id: "12345678", found: false, mapped: false },
            { student_id: "0098765432", found: true, mapped: false },
          ]
        : [{ count: "1" }]
    );

    expect(
      await previewCommonTarget(ADMIN, { kind: "students", studentIds: " 01234567890,12345678\n0098765432 01234567890 " })
    ).toEqual({ ok: true, count: 1, notFound: ["12345678"], noMentor: ["0098765432"] });
    const ids = ["01234567890", "12345678", "0098765432"];
    expect(mockQuery.mock.calls[0][1]).toEqual(["students", null, null, ids, YEAR]);
    const [unmatchedSql, unmatchedParams] = mockQuery.mock.calls[1];
    expect(unmatchedSql).toMatch(/unnest\(\$1::text\[\]\) WITH ORDINALITY/);
    expect(unmatchedParams).toEqual([ids, YEAR]);
  });

  it("is a 422 for an incomplete target", async () => {
    expect(await previewCommonTarget(ADMIN, { kind: "mentor" })).toMatchObject({
      ok: false,
      status: 422,
      fieldErrors: { mentorUserId: "Choose a mentor." },
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("listTargetMentors", () => {
  it("lists Mentors with active Mappings and their Student counts", async () => {
    mockQuery.mockResolvedValue([{ user_id: "77", name: "Faizan Khan", students: "46" }]);

    expect(await listTargetMentors(ADMIN)).toEqual([{ userId: 77, name: "Faizan Khan", students: 46 }]);
    expect(mockQuery.mock.calls[0][1]).toEqual([YEAR]);
  });
});

describe("listCommonActionItems", () => {
  it("maps each item in force with its target and counts", async () => {
    mockQuery.mockResolvedValue([
      {
        id: "3", text: "Fill in the form", owner: "student", target_kind: "mentor", target_grade: null,
        target_mentor_user_id: "77", target_mentor_name: "Faizan Khan", open_count: "4", done_count: "1",
        not_yet_added: "2", created_on: "2026-10-27",
      },
      {
        id: "2", text: "Bring the admit card", owner: "parent", target_kind: "grade", target_grade: 12,
        target_mentor_user_id: null, target_mentor_name: null, open_count: 0, done_count: 0,
        not_yet_added: 0, created_on: "2026-10-26",
      },
      {
        id: "1", text: "Revise", owner: "mentor", target_kind: "all", target_grade: null,
        target_mentor_user_id: null, target_mentor_name: null, open_count: 9, done_count: 0,
        not_yet_added: 0, created_on: "2026-10-25",
      },
      {
        id: "0", text: "Bring the form", owner: "parent", target_kind: "students", target_grade: null,
        target_mentor_user_id: null, target_student_ids: ["0012345678", "12345678"], target_mentor_name: null,
        open_count: 2, done_count: 0, not_yet_added: 0, created_on: "2026-10-24",
      },
    ]);

    expect(await listCommonActionItems(ADMIN)).toEqual([
      {
        id: 3, text: "Fill in the form", owner: "student", target: { kind: "mentor", mentorUserId: 77 },
        targetMentorName: "Faizan Khan", openCount: 4, doneCount: 1, notYetAdded: 2, createdOn: "2026-10-27",
      },
      {
        id: 2, text: "Bring the admit card", owner: "parent", target: { kind: "grade", grade: 12 },
        targetMentorName: null, openCount: 0, doneCount: 0, notYetAdded: 0, createdOn: "2026-10-26",
      },
      {
        id: 1, text: "Revise", owner: "mentor", target: { kind: "all" },
        targetMentorName: null, openCount: 9, doneCount: 0, notYetAdded: 0, createdOn: "2026-10-25",
      },
      {
        id: 0, text: "Bring the form", owner: "parent", target: { kind: "students", studentIds: ["0012345678", "12345678"] },
        targetMentorName: null, openCount: 2, doneCount: 0, notYetAdded: 0, createdOn: "2026-10-24",
      },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE common\.removed_at IS NULL/);
    expect(params).toEqual([YEAR]);
  });
});

describe("createCommonActionItem", () => {
  const body = { text: " Fill in the form ", owner: "student", target: { kind: "mentor", mentorUserId: 77 } };

  it("saves it and pushes it to the target in one transaction, idempotently per Student", async () => {
    clientQuery.mockResolvedValueOnce(result([{ id: "12" }])).mockResolvedValueOnce(result([{ id: 1 }, { id: 2 }]));

    expect(await createCommonActionItem(ADMIN, body)).toEqual({ ok: true, id: 12, added: 2 });
    expect(clientQuery.mock.calls[0][1]).toEqual(["Fill in the form", "student", "mentor", null, 77, null, ADMIN.actorEmail]);
    const [pushSql, pushParams] = clientQuery.mock.calls[1];
    expect(pushSql).toMatch(/ON CONFLICT \(common_action_item_id, student_id\) WHERE common_action_item_id IS NOT NULL DO NOTHING/);
    expect(pushSql).toMatch(/common\.removed_at IS NULL/);
    expect(pushParams).toEqual([12, YEAR]);
  });

  it("stores listed Student IDs, leading zeros and all, so a later push reaches them", async () => {
    clientQuery.mockResolvedValueOnce(result([{ id: "13" }])).mockResolvedValueOnce(result([{ id: 1 }]));

    expect(
      await createCommonActionItem(ADMIN, { text: "Bring the form", owner: "parent", target: { kind: "students", studentIds: "0012345678 0012345678" } })
    ).toEqual({ ok: true, id: 13, added: 1 });
    expect(clientQuery.mock.calls[0][1]).toEqual(["Bring the form", "parent", "students", null, null, ["0012345678"], ADMIN.actorEmail]);
    expect(clientQuery.mock.calls[1][0]).toMatch(/st\.student_id = ANY\(common\.target_student_ids\)/);
  });

  it("saves nothing when the target reaches no Student, or an unknown Mentor", async () => {
    clientQuery.mockResolvedValueOnce(result([{ id: "12" }])).mockResolvedValueOnce(result([], 0));
    const noStudents = {
      ok: false,
      status: 422,
      error: "No students match this target. Choose another.",
      fieldErrors: { target: "No students match this target. Choose another." },
    };
    expect(await createCommonActionItem(ADMIN, body)).toEqual(noStudents);

    clientQuery.mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "23503" }));
    expect(await createCommonActionItem(ADMIN, body)).toEqual(noStudents);
  });

  it("rethrows any other database error", async () => {
    clientQuery.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "XX000" }));
    await expect(createCommonActionItem(ADMIN, body)).rejects.toThrow("boom");
  });

  it("returns field errors without a transaction", async () => {
    expect(await createCommonActionItem(ADMIN, { text: "", owner: "student", target: { kind: "grade", grade: 11 } })).toEqual({
      ok: false,
      status: 422,
      error: "Enter the action item.",
      fieldErrors: { text: "Enter the action item.", grade: "Choose grade 12 or 13." },
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("pushCommonActionItem", () => {
  it("adds it to targeted Students who don't have it yet", async () => {
    clientQuery.mockResolvedValueOnce(result([{ id: 12 }])).mockResolvedValueOnce(result([{ id: 9 }]));

    expect(await pushCommonActionItem(ADMIN, 12)).toEqual({ ok: true, added: 1 });
    expect(clientQuery.mock.calls[0][0]).toMatch(/removed_at IS NULL FOR UPDATE/);
  });

  it("is a 404 for a removed or unknown item", async () => {
    expect(await pushCommonActionItem(ADMIN, 12)).toMatchObject({ status: 404 });
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(await pushCommonActionItem(ADMIN, 0)).toMatchObject({ status: 404 });
  });
});

describe("updateCommonActionItem", () => {
  it("updates it and its still-open Action Items only", async () => {
    clientQuery
      .mockResolvedValueOnce(result([{ id: 12 }]))
      .mockResolvedValueOnce(result([], 1))
      .mockResolvedValueOnce(result([], 3));

    expect(await updateCommonActionItem(ADMIN, 12, { text: "New text", owner: "parent" })).toEqual({
      ok: true,
      updatedOpen: 3,
    });
    const [sql, params] = clientQuery.mock.calls[2];
    expect(sql).toMatch(/WHERE common_action_item_id = \$1 AND status = 'open'/);
    expect(params).toEqual([12, "New text", "parent"]);
  });

  it("is a 404 for a removed item and a 422 for bad text", async () => {
    expect(await updateCommonActionItem(ADMIN, 12, { text: "New", owner: "parent" })).toMatchObject({ status: 404 });
    expect(await updateCommonActionItem(ADMIN, 12, { text: " ", owner: "parent" })).toMatchObject({ status: 422 });
    expect(await updateCommonActionItem(ADMIN, -2, { text: "New", owner: "parent" })).toMatchObject({ status: 404 });
  });
});

describe("removeCommonActionItem", () => {
  it("soft-removes it with the remover and deletes only its still-open Action Items", async () => {
    clientQuery
      .mockResolvedValueOnce(result([{ id: 12 }]))
      .mockResolvedValueOnce(result([], 1))
      .mockResolvedValueOnce(result([], 4));

    expect(await removeCommonActionItem(ADMIN, 12)).toEqual({ ok: true, deletedOpen: 4 });
    expect(clientQuery.mock.calls[1]).toEqual([expect.stringMatching(/SET removed_at = now\(\), removed_by_email = \$2/), [12, ADMIN.actorEmail]]);
    expect(clientQuery.mock.calls[2][0]).toMatch(/DELETE FROM blended_learning_action_items WHERE common_action_item_id = \$1 AND status = 'open'/);
  });

  it("is a 404 for an item already removed", async () => {
    expect(await removeCommonActionItem(ADMIN, 12)).toMatchObject({ status: 404 });
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(await removeCommonActionItem(ADMIN, 0)).toMatchObject({ status: 404 });
  });
});
