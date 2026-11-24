import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query, withTransaction } from "./db";
import type { BlendedLearningAccess } from "./blended-learning-access";
import {
  createResource,
  deleteResource,
  listResources,
  movedOrder,
  moveResource,
  updateResource,
} from "./blended-learning-resources";

const mockQuery = vi.mocked(query);
const clientQuery = vi.fn();

const ADMIN: BlendedLearningAccess = {
  kind: "admin", role: "blended_admin", readOnly: false, actorEmail: "juned@avantifellows.org",
};
const READ_ONLY_ADMIN: BlendedLearningAccess = { ...ADMIN, readOnly: true };
const MENTOR: BlendedLearningAccess = {
  kind: "mentor", role: "blended_mentor", readOnly: false, actorEmail: "faizan@avantifellows.org", mentorUserId: 9001,
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue([]);
  clientQuery.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  vi.mocked(withTransaction).mockReset();
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn({ query: clientQuery } as never));
});

describe("listResources", () => {
  it("reads every Resource in position order", async () => {
    mockQuery.mockResolvedValue([{ id: "2", title: "Toolkit", url: "https://example.org/toolkit" }]);

    expect(await listResources()).toEqual([{ id: 2, title: "Toolkit", url: "https://example.org/toolkit" }]);
    expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY position, id/);
  });
});

describe("Resource writes need manage", () => {
  it.each([
    ["a Mentor", MENTOR],
    ["a read-only admin", READ_ONLY_ADMIN],
  ])("refuses %s without touching the database", async (_who, access) => {
    const body = { title: "Guide", url: "https://example.org" };
    for (const result of [
      await createResource(access, body),
      await updateResource(access, 1, body),
      await deleteResource(access, 1),
      await moveResource(access, 1, { direction: "up" }),
    ]) {
      expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
    }
    expect(mockQuery).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("createResource", () => {
  it("adds the Resource last, recording who added it", async () => {
    mockQuery.mockResolvedValue([{ id: 7, title: "Guide", url: "https://example.org/guide" }]);

    expect(await createResource(ADMIN, { title: " Guide ", url: "https://example.org/guide" })).toEqual({
      ok: true,
      resource: { id: 7, title: "Guide", url: "https://example.org/guide" },
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(MAX\(position\), 0\) \+ 1/);
    expect(params).toEqual(["Guide", "https://example.org/guide", ADMIN.actorEmail]);
  });

  it("returns field errors without writing", async () => {
    expect(await createResource(ADMIN, { title: "", url: "http://example.org" })).toEqual({
      ok: false,
      status: 422,
      error: "Enter a title.",
      fieldErrors: { title: "Enter a title.", url: "Enter a full link starting with https://" },
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("updateResource", () => {
  it("saves the new title and link", async () => {
    mockQuery.mockResolvedValue([{ id: "3", title: "New", url: "https://example.org/new" }]);

    expect(await updateResource(ADMIN, 3, { title: "New", url: "https://example.org/new" })).toEqual({
      ok: true,
      resource: { id: 3, title: "New", url: "https://example.org/new" },
    });
    expect(mockQuery.mock.calls[0][1]).toEqual([3, "New", "https://example.org/new", ADMIN.actorEmail]);
  });

  it("is a 404 for an unknown or invalid id and a 422 for a bad link", async () => {
    expect(await updateResource(ADMIN, 99, { title: "New", url: "https://example.org" })).toMatchObject({ status: 404 });
    expect(await updateResource(ADMIN, 0, { title: "New", url: "https://example.org" })).toMatchObject({ status: 404 });
    expect(await updateResource(ADMIN, 3, { title: "New", url: "ftp://x" })).toMatchObject({ status: 422 });
  });
});

describe("deleteResource", () => {
  it("hard-deletes it, or is a 404", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 3 }]).mockResolvedValueOnce([]);

    expect(await deleteResource(ADMIN, 3)).toEqual({ ok: true });
    expect(await deleteResource(ADMIN, 3)).toMatchObject({ status: 404 });
    expect(await deleteResource(ADMIN, -1)).toMatchObject({ status: 404 });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("movedOrder", () => {
  it("swaps with the neighbour, and leaves the ends alone", () => {
    expect(movedOrder([1, 2, 3], 2, "up")).toEqual([2, 1, 3]);
    expect(movedOrder([1, 2, 3], 2, "down")).toEqual([1, 3, 2]);
    expect(movedOrder([1, 2, 3], 1, "up")).toEqual([1, 2, 3]);
    expect(movedOrder([1, 2, 3], 3, "down")).toEqual([1, 2, 3]);
    expect(movedOrder([1, 2, 3], 9, "up")).toEqual([1, 2, 3]);
  });
});

describe("moveResource", () => {
  it("locks every Resource and renumbers them 1..n in the new order", async () => {
    clientQuery.mockResolvedValueOnce({ rows: [{ id: "4" }, { id: "9" }, { id: "6" }] });

    expect(await moveResource(ADMIN, 6, { direction: "up" })).toEqual({ ok: true });
    expect(clientQuery.mock.calls[0][0]).toMatch(/ORDER BY position, id FOR UPDATE/);
    const [sql, params] = clientQuery.mock.calls[1];
    expect(sql).toMatch(/unnest\(\$1::bigint\[\]\) WITH ORDINALITY/);
    expect(params).toEqual([[4, 6, 9], ADMIN.actorEmail]);
  });

  it("is a 404 for a Resource that is gone and a 422 without a direction", async () => {
    clientQuery.mockResolvedValueOnce({ rows: [{ id: "4" }] });
    expect(await moveResource(ADMIN, 6, { direction: "down" })).toMatchObject({ status: 404 });
    expect(clientQuery).toHaveBeenCalledTimes(1);

    expect(await moveResource(ADMIN, 6, { direction: "left" })).toMatchObject({ status: 422 });
    expect(await moveResource(ADMIN, 6, null)).toMatchObject({ status: 422 });
    expect(await moveResource(ADMIN, 0, { direction: "up" })).toMatchObject({ status: 404 });
  });
});
