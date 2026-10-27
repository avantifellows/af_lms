import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  VisitConcernEventError,
  commentOnConcern,
  reopenConcern,
  resolveConcern,
  type ConcernEventParams,
} from "./visit-concern-events";

// A transaction client over one stored concern row (or none): the locking read returns it, the
// status UPDATE changes it and the event INSERT appends to its history.
function fakeClient(row: { kind: "concern" | "highlight"; status: "open" | "resolved" | null } | null) {
  const state = { row, events: [] as { concernId: number; kind: string; body: string; author: string }[] };
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/FOR UPDATE/.test(sql)) return { rows: state.row ? [{ ...state.row }] : [] };
      if (/^\s*UPDATE lms_visit_concerns/.test(sql)) {
        state.row = { ...state.row!, status: params[1] as "open" | "resolved" };
        return { rows: [] };
      }
      if (/^\s*INSERT INTO lms_visit_concern_events/.test(sql)) {
        const [concernId, kind, body, author] = params as [number, string, string, string];
        state.events.push({ concernId, kind, body, author });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { client: client as unknown as PoolClient, state };
}

const PARAMS: ConcernEventParams = { concernId: 9004801, actorEmail: "Ravi.PM@AvantiFellows.org", body: "Lab kits delivered" };

async function rejection(promise: Promise<unknown>): Promise<VisitConcernEventError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(VisitConcernEventError);
  return error as VisitConcernEventError;
}

describe("visit concern event writers", () => {
  it("resolve: an open concern becomes resolved with the explanation as a resolved event", async () => {
    const { client, state } = fakeClient({ kind: "concern", status: "open" });

    await resolveConcern(client, PARAMS);

    expect(state.row?.status).toBe("resolved");
    expect(state.events).toEqual([
      { concernId: 9004801, kind: "resolved", body: "Lab kits delivered", author: "ravi.pm@avantifellows.org" },
    ]);
  });

  it("comment: a resolved concern stays resolved and gains a comment event", async () => {
    const { client, state } = fakeClient({ kind: "concern", status: "resolved" });

    await commentOnConcern(client, { ...PARAMS, body: "Checked again" });

    expect(state.row?.status).toBe("resolved");
    expect(state.events.map((event) => [event.kind, event.body])).toEqual([["comment", "Checked again"]]);
  });

  it("reopen: a resolved concern becomes open with the reason as a reopened event", async () => {
    const { client, state } = fakeClient({ kind: "concern", status: "resolved" });

    await reopenConcern(client, { ...PARAMS, body: "Kits went missing" });

    expect(state.row?.status).toBe("open");
    expect(state.events.map((event) => [event.kind, event.body])).toEqual([["reopened", "Kits went missing"]]);
  });

  it.each([
    ["resolve", resolveConcern],
    ["comment", commentOnConcern],
    ["reopen", reopenConcern],
  ] as const)("%s on a missing concern is 404 and writes nothing", async (_label, write) => {
    const { client, state } = fakeClient(null);

    const error = await rejection(write(client, PARAMS));

    expect(error.status).toBe(404);
    expect(error.message).toBe("Concern not found");
    expect(state.events).toEqual([]);
  });

  it.each([
    ["resolve", resolveConcern],
    ["comment", commentOnConcern],
    ["reopen", reopenConcern],
  ] as const)("%s on a highlight is 409 and writes nothing", async (_label, write) => {
    const { client, state } = fakeClient({ kind: "highlight", status: null });

    const error = await rejection(write(client, PARAMS));

    expect(error.status).toBe(409);
    expect(error.message).toBe("Highlights can't be resolved, commented on or reopened");
    expect(state.row?.status).toBeNull();
    expect(state.events).toEqual([]);
  });

  it.each([
    ["resolve on a resolved concern", resolveConcern, "resolved", "This concern is already resolved"],
    ["comment on an open concern", commentOnConcern, "open", "Only resolved concerns take comments; this one is open"],
    ["reopen on an open concern", reopenConcern, "open", "This concern is already open"],
  ] as const)("%s is 409 and leaves the status alone", async (_label, write, status, message) => {
    const { client, state } = fakeClient({ kind: "concern", status });

    const error = await rejection(write(client, PARAMS));

    expect(error.status).toBe(409);
    expect(error.message).toBe(message);
    expect(state.row?.status).toBe(status);
    expect(state.events).toEqual([]);
  });
});
