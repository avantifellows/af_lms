import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readRecordingMinutes, recordingMinutes } from "./recordingDuration";

describe("recordingMinutes", () => {
  it("rounds to whole minutes, at least 1", () => {
    expect(recordingMinutes(25 * 60 + 29)).toBe(25);
    expect(recordingMinutes(25 * 60 + 30)).toBe(26);
    expect(recordingMinutes(12)).toBe(1);
  });

  it("is null for an unknown length or one the form doesn't take", () => {
    expect(recordingMinutes(Number.NaN)).toBeNull();
    expect(recordingMinutes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(recordingMinutes(0)).toBeNull();
    expect(recordingMinutes(241 * 60)).toBeNull();
    expect(recordingMinutes(240 * 60)).toBe(240);
  });
});

// The browser's audio element: each test says what loading the file does.
class FakeAudio {
  static next: (audio: FakeAudio) => void = () => {};
  preload = "";
  duration = Number.NaN;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = "";
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    queueMicrotask(() => FakeAudio.next(this));
  }
  removeAttribute() {
    this.source = "";
  }
}

describe("readRecordingMinutes", () => {
  const revoke = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:recording", revokeObjectURL: revoke });
    revoke.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const file = new File([new Uint8Array(8)], "call.mp3", { type: "audio/mpeg" });

  it("reads the length from the file's metadata, then lets the file go", async () => {
    FakeAudio.next = (audio) => {
      audio.duration = 1_520;
      audio.onloadedmetadata?.();
    };
    await expect(readRecordingMinutes(file)).resolves.toBe(25);
    expect(revoke).toHaveBeenCalledWith("blob:recording");
  });

  it("is null when the browser can't read the file", async () => {
    FakeAudio.next = (audio) => audio.onerror?.();
    await expect(readRecordingMinutes(file)).resolves.toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:recording");
  });

  it("gives up when the metadata never loads", async () => {
    vi.useFakeTimers();
    FakeAudio.next = () => {};
    const read = readRecordingMinutes(file);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(read).resolves.toBeNull();
  });
});
