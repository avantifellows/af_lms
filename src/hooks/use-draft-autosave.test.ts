import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftAutosave, useDraftAutosaveRefs } from "./use-draft-autosave";

// The draft autosave shared by Holistic Post-Session Notes and AI Test
// Insights Session Notes: a change is sent a pause after the last one, one
// save at a time, and the newest value is sent next.
type Value = { text: string };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(initial: Value, options: { enabled?: boolean; stopped?: () => boolean } = {}) {
  const save = vi.fn<(value: Value) => Promise<void>>();
  const events: string[] = [];
  const hook = renderHook(
    ({ value, enabled, failed }: { value: Value; enabled: boolean; failed: boolean }) => {
      const refs = useDraftAutosaveRefs(initial);
      return useDraftAutosave({
        value,
        refs,
        enabled,
        canFlush: enabled,
        failed,
        delayMs: 1000,
        save,
        isStopped: options.stopped,
        onSaving: () => events.push("saving"),
        onSaved: (saved) => events.push(`saved ${saved.text}`),
        onFailed: () => events.push("failed"),
        onDrained: () => events.push("drained"),
      });
    },
    { initialProps: { value: initial, enabled: options.enabled ?? true, failed: false } },
  );
  const type = (text: string, props: { enabled?: boolean; failed?: boolean } = {}) =>
    hook.rerender({ value: { text }, enabled: props.enabled ?? options.enabled ?? true, failed: props.failed ?? false });
  return { hook, save, events, type };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDraftAutosave", () => {
  it("saves nothing for the value it started with", async () => {
    const { save } = setup({ text: "" });

    await tick(5000);

    expect(save).not.toHaveBeenCalled();
  });

  it("saves once, a pause after the last change, and not before", async () => {
    const { save, events, type } = setup({ text: "" });
    save.mockResolvedValue();

    type("a");
    await tick(600);
    type("ab");
    await tick(999);
    expect(save).not.toHaveBeenCalled();

    await tick(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ text: "ab" });
    expect(events).toEqual(["saving", "saved ab", "drained"]);
  });

  it("sends one save at a time and the newest value next, skipping the ones in between", async () => {
    const { save, events, type } = setup({ text: "" });
    const first = deferred();
    save.mockReturnValueOnce(first.promise).mockResolvedValue();

    type("one");
    await tick(1000);
    type("two");
    await tick(1000);
    type("three");
    await tick(1000);
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve());
    await tick(0);

    expect(save.mock.calls.map(([value]) => value.text)).toEqual(["one", "three"]);
    expect(events).toEqual(["saving", "saved one", "saving", "saved three", "drained"]);
  });

  it("saves nothing while disabled, and the change once enabled", async () => {
    const { save, type } = setup({ text: "" }, { enabled: false });
    save.mockResolvedValue();

    type("too long", { enabled: false });
    await tick(5000);
    expect(save).not.toHaveBeenCalled();

    type("fits", { enabled: true });
    await tick(1000);
    expect(save).toHaveBeenCalledWith({ text: "fits" });
  });

  it("does not save again a value that matches the saved one", async () => {
    const { save, type } = setup({ text: "kept" });

    type("kepts");
    type("kept");
    await tick(5000);

    expect(save).not.toHaveBeenCalled();
  });

  it("sends the saved value again when the typing goes back to it while a newer save is in flight", async () => {
    const { save, events, type } = setup({ text: "A" });
    const inFlight = deferred();
    save.mockReturnValueOnce(inFlight.promise).mockResolvedValue();

    type("AB");
    await tick(1000);
    expect(save).toHaveBeenCalledTimes(1);
    // Undo back to what the server held before "AB" went out.
    type("A");
    await act(async () => inFlight.resolve());
    await tick(5000);

    expect(save.mock.calls.map(([value]) => value.text)).toEqual(["AB", "A"]);
    expect(events.at(-2)).toBe("saved A");
  });

  it("flush sends the saved value again when the typing went back to it while a newer save was in flight", async () => {
    const { hook, save, type } = setup({ text: "A" });
    const inFlight = deferred();
    save.mockReturnValueOnce(inFlight.promise).mockResolvedValue();

    type("AB");
    await tick(1000);
    type("A");
    let flushed: Promise<boolean> = Promise.resolve(false);
    act(() => {
      flushed = hook.result.current();
    });
    await act(async () => inFlight.resolve());

    expect(await flushed).toBe(true);
    expect(save.mock.calls.map(([value]) => value.text)).toEqual(["AB", "A"]);
  });

  it("sends nothing more when the typing goes back to the value in flight", async () => {
    const { save, type } = setup({ text: "A" });
    const inFlight = deferred();
    save.mockReturnValueOnce(inFlight.promise).mockResolvedValue();

    type("AB");
    await tick(1000);
    type("ABC");
    type("AB");
    await act(async () => inFlight.resolve());
    await tick(5000);

    expect(save.mock.calls.map(([value]) => value.text)).toEqual(["AB"]);
  });

  it("reports a failed save, and flush sends the same value again", async () => {
    const { hook, save, events, type } = setup({ text: "" });
    save.mockRejectedValueOnce(new Error("offline")).mockResolvedValue();

    type("note");
    await tick(1000);
    expect(events).toEqual(["saving", "failed"]);

    type("note", { failed: true });
    let flushed = false;
    await act(async () => {
      flushed = await hook.result.current();
    });

    expect(flushed).toBe(true);
    expect(save.mock.calls.map(([value]) => value.text)).toEqual(["note", "note"]);
    expect(events).toEqual(["saving", "failed", "saving", "saved note", "drained"]);
  });

  it("flush sends a pending change at once and waits for it", async () => {
    const { hook, save, type } = setup({ text: "" });
    save.mockResolvedValue();

    type("now");
    let flushed = false;
    await act(async () => {
      flushed = await hook.result.current();
    });

    expect(flushed).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    await tick(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("drops what is queued once stopped", async () => {
    let stopped = false;
    const { save, events, type } = setup({ text: "" }, { stopped: () => stopped });
    const first = deferred();
    save.mockReturnValueOnce(first.promise).mockResolvedValue();

    type("one");
    await tick(1000);
    type("two");
    await tick(1000);
    stopped = true;
    await act(async () => first.resolve());
    await tick(5000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["saving", "saved one"]);
  });
});
