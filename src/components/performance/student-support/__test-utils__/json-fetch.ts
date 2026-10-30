import { vi } from "vitest";

/** A JSON response, or "pending" for a request that never settles. */
export type JsonReply = { ok: boolean; body: unknown } | "pending";

/** Stubs the global fetch, answering each URL with `reply(url)`. Undo with
 *  vi.unstubAllGlobals(). */
export function stubJsonFetch(reply: (url: string) => JsonReply | undefined) {
  const fetchMock = vi.fn((url: string) => {
    const r = reply(url);
    if (!r || r === "pending") return new Promise(() => {});
    return Promise.resolve({ ok: r.ok, json: () => Promise.resolve(r.body) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
