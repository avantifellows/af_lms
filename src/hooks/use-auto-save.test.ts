import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutoSave, type AutoSaveStatus } from "./use-auto-save";

function makePersistFn() {
  return vi.fn<
    (data: Record<string, unknown>) => Promise<
      | { ok: true; action: { data: Record<string, unknown> } }
      | { ok: false; status: number; error: { message: string; details: string[] } }
    >
  >();
}

function identity(_actionType: string, data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

interface HookProps {
  formData: Record<string, unknown>;
  actionType: string;
  canSave: boolean;
  isBusy: boolean;
  persistFn: ReturnType<typeof makePersistFn>;
  sanitizeFn: (actionType: string, data: Record<string, unknown>) => Record<string, unknown>;
  onSuccess: (action: Record<string, unknown>) => void;
  debounceMs?: number;
}

function defaultProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    formData: { note: "initial" },
    actionType: "principal_interaction",
    canSave: true,
    isBusy: false,
    persistFn: makePersistFn(),
    sanitizeFn: identity,
    onSuccess: vi.fn(),
    debounceMs: 2000,
    ...overrides,
  };
}

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with idle status when data matches baseline", () => {
    const props = defaultProps();
    const { result } = renderHook(() => useAutoSave(props));

    expect(result.current.saveStatus).toBe("idle");
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it("does not save when canSave is false", () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ canSave: false, persistFn });

    const { rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    rerender({ ...props, formData: { note: "changed" } });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(persistFn).not.toHaveBeenCalled();
  });

  it("does not save when isBusy is true", () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ isBusy: true, persistFn });

    const { rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    rerender({ ...props, formData: { note: "changed" } });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(persistFn).not.toHaveBeenCalled();
  });

  it("transitions idle → unsaved → saving → saved → idle", async () => {
    const persistFn = makePersistFn();
    const onSuccess = vi.fn();
    const props = defaultProps({ persistFn, onSuccess });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    expect(result.current.saveStatus).toBe("idle");

    // Change data
    persistFn.mockResolvedValueOnce({
      ok: true,
      action: { data: { note: "changed" }, id: 1 },
    });

    rerender({ ...props, formData: { note: "changed" } });

    expect(result.current.saveStatus).toBe("unsaved");

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.saveStatus).toBe("saved");
    expect(persistFn).toHaveBeenCalledWith({ note: "changed" });
    expect(onSuccess).toHaveBeenCalledWith({ data: { note: "changed" }, id: 1 });

    // Auto-dismiss after 3s
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.saveStatus).toBe("idle");
  });

  it("sets error status on failed persist", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    persistFn.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: { message: "Server error", details: [] },
    });

    rerender({ ...props, formData: { note: "changed" } });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.saveStatus).toBe("error");
  });

  it("sets error status when persist throws", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    persistFn.mockRejectedValueOnce(new Error("Network failure"));

    rerender({ ...props, formData: { note: "changed" } });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.saveStatus).toBe("error");
  });

  it("resets debounce timer on rapid changes", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    // First change
    rerender({ ...props, formData: { note: "first" } });
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Second change before debounce fires
    persistFn.mockResolvedValueOnce({
      ok: true,
      action: { data: { note: "second" }, id: 1 },
    });
    rerender({ ...props, formData: { note: "second" } });

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // First debounce should not have fired yet (1500 < 2000 from the second change)
    expect(persistFn).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(persistFn).toHaveBeenCalledTimes(1);
    expect(persistFn).toHaveBeenCalledWith({ note: "second" });
  });

  it("cancelAutoSave cancels pending debounce timer", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    rerender({ ...props, formData: { note: "changed" } });

    act(() => {
      result.current.cancelAutoSave();
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(persistFn).not.toHaveBeenCalled();
  });

  it("flushAndCancel cancels debounce and waits for in-flight to complete", async () => {
    const persistFn = makePersistFn();
    const onSuccess = vi.fn();
    const props = defaultProps({ persistFn, onSuccess });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    // Start an in-flight save
    let resolveInFlight!: (v: { ok: true; action: { data: Record<string, unknown> } }) => void;
    persistFn.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInFlight = resolve; })
    );

    rerender({ ...props, formData: { note: "changed" } });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.saveStatus).toBe("saving");

    // Call flushAndCancel — should set abort flag
    let flushed = false;
    const flushPromise = act(async () => {
      await result.current.flushAndCancel();
      flushed = true;
    });

    expect(flushed).toBe(false);

    // Resolve in-flight
    await act(async () => {
      resolveInFlight({ ok: true, action: { data: { note: "changed" } } });
    });
    await flushPromise;

    expect(flushed).toBe(true);
    // onSuccess should be skipped because abort flag was set
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("markSynced updates baseline and resets status to idle", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    // Change data and see unsaved
    rerender({ ...props, formData: { note: "changed" } });
    expect(result.current.saveStatus).toBe("unsaved");

    // Mark as synced with the new data
    act(() => {
      result.current.markSynced({ note: "changed" });
    });

    expect(result.current.saveStatus).toBe("idle");

    // Advancing timer should not trigger save since baseline matches
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(persistFn).not.toHaveBeenCalled();
  });

  it("markSynced prevents re-save of identical data", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    // Mark synced with "changed" data
    act(() => {
      result.current.markSynced({ note: "changed" });
    });

    // Now set formData to "changed" — should not trigger save since baseline matches
    rerender({ ...props, formData: { note: "changed" } });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(persistFn).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("idle");
  });

  it("registers beforeunload listener when unsaved", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const props = defaultProps();

    const { rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    expect(addSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));

    rerender({ ...props, formData: { note: "changed" } });

    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    // Reset to synced
    rerender({ ...props, formData: { note: "initial" } });

    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("uses sanitizeFn to compare data", async () => {
    const persistFn = makePersistFn();
    // sanitizeFn strips everything except "note"
    const sanitizeFn = (_actionType: string, data: Record<string, unknown>) => {
      return { note: data.note };
    };
    const props = defaultProps({ persistFn, sanitizeFn });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    // Change a key that sanitize strips — should NOT trigger save
    rerender({ ...props, formData: { note: "initial", extra: "stuff" }, sanitizeFn });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(persistFn).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("idle");
  });

  it("uses formDataRef.current at fire time, not stale closure value", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    // First change triggers debounce
    rerender({ ...props, formData: { note: "first" } });

    // Advance 1500ms
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Change again before debounce fires — resets the timer
    persistFn.mockResolvedValueOnce({
      ok: true,
      action: { data: { note: "second" }, id: 1 },
    });
    rerender({ ...props, formData: { note: "second" } });

    // The new timer fires at 2000ms from the second change
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // persist should be called with the latest data
    expect(persistFn).toHaveBeenCalledTimes(1);
    expect(persistFn).toHaveBeenCalledWith({ note: "second" });
  });

  it("error clears on next successful save cycle", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    // First save fails
    persistFn.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: { message: "Server error", details: [] },
    });
    rerender({ ...props, formData: { note: "changed" } });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.saveStatus).toBe("error");

    // Another change triggers a new save
    persistFn.mockResolvedValueOnce({
      ok: true,
      action: { data: { note: "changed2" }, id: 1 },
    });
    rerender({ ...props, formData: { note: "changed2" } });

    expect(result.current.saveStatus).toBe("unsaved");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.saveStatus).toBe("saved");
  });

  it("does not save if data returns to baseline before debounce fires", () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    // Change then revert before debounce
    rerender({ ...props, formData: { note: "changed" } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender({ ...props, formData: { note: "initial" } });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(persistFn).not.toHaveBeenCalled();
  });

  it("cancels debounce timer when canSave flips to false", () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    const { rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    rerender({ ...props, formData: { note: "changed" } });

    // Now canSave becomes false
    rerender({ ...props, formData: { note: "changed" }, canSave: false });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(persistFn).not.toHaveBeenCalled();
  });

  it("flushAndCancel resolves immediately if no in-flight save", async () => {
    const props = defaultProps();
    const { result } = renderHook(() => useAutoSave(props));

    // Should resolve immediately without hanging
    await act(async () => {
      await result.current.flushAndCancel();
    });
  });

  it("hasPendingChanges is true during unsaved and saving states", async () => {
    const persistFn = makePersistFn();
    const props = defaultProps({ persistFn });

    let resolveInFlight!: (v: { ok: true; action: { data: Record<string, unknown> } }) => void;
    persistFn.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInFlight = resolve; })
    );

    const { result, rerender } = renderHook((p: HookProps) => useAutoSave(p), {
      initialProps: props,
    });

    expect(result.current.hasPendingChanges).toBe(false);

    rerender({ ...props, formData: { note: "changed" } });
    expect(result.current.hasPendingChanges).toBe(true); // unsaved

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.hasPendingChanges).toBe(true); // saving

    await act(async () => {
      resolveInFlight({ ok: true, action: { data: { note: "changed" } } });
    });
    expect(result.current.hasPendingChanges).toBe(false); // saved
  });
});
