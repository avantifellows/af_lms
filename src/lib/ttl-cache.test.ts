import { afterEach, describe, expect, it, vi } from "vitest";
import { ttlCache } from "./ttl-cache";

afterEach(() => vi.useRealTimers());

describe("ttlCache", () => {
  it("reuses a value until it expires", async () => {
    vi.useFakeTimers();
    const cached = ttlCache<number>(1000);
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await cached("k", load)).toBe(1);
    expect(await cached("k", load)).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await cached("k", load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight read between concurrent callers", async () => {
    const cached = ttlCache<number>(1000);
    const load = vi.fn().mockResolvedValue(7);
    const [a, b] = await Promise.all([cached("k", load), cached("k", load)]);
    expect([a, b]).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed read", async () => {
    const cached = ttlCache<number>(1000);
    await expect(cached("k", () => Promise.reject(new Error("bq down")))).rejects.toThrow("bq down");
    expect(await cached("k", () => Promise.resolve(3))).toBe(3);
  });

  it("drops the oldest key past the size limit", async () => {
    const cached = ttlCache<number>(1000, 2);
    await cached("a", async () => 1);
    await cached("b", async () => 2);
    await cached("c", async () => 3);
    const load = vi.fn().mockResolvedValue(9);
    expect(await cached("a", load)).toBe(9);
    expect(await cached("c", load)).toBe(3);
  });
});
