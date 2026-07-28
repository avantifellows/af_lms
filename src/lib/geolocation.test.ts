import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAccuracyStatus, getAccurateLocation } from "./geolocation";

describe("getAccuracyStatus", () => {
  it("returns 'good' for accuracy <= 100m", () => {
    expect(getAccuracyStatus(50)).toBe("good");
    expect(getAccuracyStatus(100)).toBe("good");
  });

  it("returns 'moderate' for accuracy 101-500m", () => {
    expect(getAccuracyStatus(101)).toBe("moderate");
    expect(getAccuracyStatus(300)).toBe("moderate");
    expect(getAccuracyStatus(500)).toBe("moderate");
  });

  it("returns 'poor' for accuracy > 500m", () => {
    expect(getAccuracyStatus(501)).toBe("poor");
    expect(getAccuracyStatus(1000)).toBe("poor");
  });
});

describe("getAccurateLocation", () => {
  let mockWatchPosition: ReturnType<typeof vi.fn>;
  let mockClearWatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWatchPosition = vi.fn();
    mockClearWatch = vi.fn();

    vi.stubGlobal("navigator", {
      geolocation: {
        watchPosition: mockWatchPosition,
        clearWatch: mockClearWatch,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function setSecureOrigin(secure: boolean, search = "") {
    if (secure) {
      vi.stubGlobal("window", {
        location: {
          protocol: "https:",
          hostname: "app.example.com",
          search,
        },
      });
    } else {
      vi.stubGlobal("window", {
        location: {
          protocol: "http:",
          hostname: "app.example.com",
          search,
        },
      });
    }
  }

  function setLocalhostOrigin() {
    vi.stubGlobal("window", {
      location: { protocol: "http:", hostname: "localhost" },
    });
  }

  it("rejects with INSECURE_ORIGIN on http non-localhost", async () => {
    setSecureOrigin(false);

    const { promise } = getAccurateLocation();
    await expect(promise).rejects.toMatchObject({ code: "INSECURE_ORIGIN" });
  });

  it("rejects with NOT_SUPPORTED when navigator.geolocation is missing", async () => {
    setSecureOrigin(true);
    vi.stubGlobal("navigator", {});

    const { promise } = getAccurateLocation();
    await expect(promise).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("resolves on good accuracy (<=100m) from https origin", async () => {
    setSecureOrigin(true);
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: { latitude: 23.0, longitude: 72.5, accuracy: 50 },
      } as GeolocationPosition);
      return 1;
    });

    const { promise } = getAccurateLocation();
    const result = await promise;
    expect(result).toEqual({ lat: 23.0, lng: 72.5, accuracy: 50 });
  });

  it("resolves on good accuracy from localhost", async () => {
    setLocalhostOrigin();
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: { latitude: 23.0, longitude: 72.5, accuracy: 80 },
      } as GeolocationPosition);
      return 1;
    });

    const { promise } = getAccurateLocation();
    const result = await promise;
    expect(result).toEqual({ lat: 23.0, lng: 72.5, accuracy: 80 });
  });

  it("rejects with PERMISSION_DENIED on geolocation error", async () => {
    setSecureOrigin(true);
    mockWatchPosition.mockImplementation((_success: PositionCallback, error: PositionErrorCallback) => {
      error({
        code: 1,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: "denied",
      } as GeolocationPositionError);
      return 1;
    });

    const { promise } = getAccurateLocation();
    await expect(promise).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("rejects with POSITION_UNAVAILABLE on geolocation error", async () => {
    setSecureOrigin(true);
    mockWatchPosition.mockImplementation((_success: PositionCallback, error: PositionErrorCallback) => {
      error({
        code: 2,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: "unavailable",
      } as GeolocationPositionError);
      return 1;
    });

    const { promise } = getAccurateLocation();
    await expect(promise).rejects.toMatchObject({ code: "POSITION_UNAVAILABLE" });
  });

  it("logs opt-in diagnostics for unavailable positions", async () => {
    setSecureOrigin(true, "?debugGps=1");
    const permissionStatus = {
      state: "granted",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("navigator", {
      userAgent: "Chrome test",
      platform: "MacIntel",
      language: "en-IN",
      onLine: true,
      cookieEnabled: true,
      geolocation: {
        watchPosition: mockWatchPosition,
        clearWatch: mockClearWatch,
      },
      permissions: {
        query: vi.fn().mockResolvedValue(permissionStatus),
      },
      connection: {
        effectiveType: "4g",
        downlink: 10,
        rtt: 50,
        saveData: false,
      },
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWatchPosition.mockImplementation(
      (_success: PositionCallback, onError: PositionErrorCallback) => {
        onError({
          code: 2,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: "Core Location unavailable",
        } as GeolocationPositionError);
        return 7;
      }
    );

    const { promise } = getAccurateLocation();
    await expect(promise).rejects.toMatchObject({
      code: "POSITION_UNAVAILABLE",
    });
    await Promise.resolve();

    const logs = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .filter(([prefix]) => prefix === "[GPS diagnostics]")
      .map(([, details]) => details as Record<string, unknown>);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "attempt-started",
          platform: "MacIntel",
          permissionsApiSupported: true,
        }),
        expect.objectContaining({
          event: "position-error",
          errorName: "POSITION_UNAVAILABLE",
          browserMessage: "Core Location unavailable",
        }),
        expect.objectContaining({
          event: "settled",
          outcome: "reject",
          code: "POSITION_UNAVAILABLE",
        }),
        expect.objectContaining({
          event: "permission-state",
          state: "granted",
        }),
      ])
    );
  });

  it("never includes coordinates in opt-in diagnostics", async () => {
    setSecureOrigin(true, "?debugGps=1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: { latitude: 23.0, longitude: 72.5, accuracy: 50 },
      } as GeolocationPosition);
      return 8;
    });

    const { promise } = getAccurateLocation();
    await expect(promise).resolves.toEqual({
      lat: 23.0,
      lng: 72.5,
      accuracy: 50,
    });

    const positionLog = info.mock.calls
      .filter(([prefix]) => prefix === "[GPS diagnostics]")
      .map(([, details]) => details as Record<string, unknown>)
      .find((details) => details.event === "position-received");
    expect(positionLog).toBeDefined();
    expect(positionLog).not.toHaveProperty("lat");
    expect(positionLog).not.toHaveProperty("lng");
    expect(positionLog).not.toHaveProperty("latitude");
    expect(positionLog).not.toHaveProperty("longitude");
    expect(positionLog).toMatchObject({
      coordinatesFinite: true,
      accuracyMeters: 50,
    });
  });

  it("resolves with best reading on timeout when accuracy <= 500m", async () => {
    setSecureOrigin(true);
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      // Report a moderate-accuracy reading
      success({
        coords: { latitude: 23.0, longitude: 72.5, accuracy: 300 },
      } as GeolocationPosition);
      return 1;
    });

    const { promise } = getAccurateLocation();
    // Advance past the 60s timeout
    vi.advanceTimersByTime(60_000);
    const result = await promise;
    expect(result).toEqual({ lat: 23.0, lng: 72.5, accuracy: 300 });
  });

  it("rejects with TIMEOUT when no readings received", async () => {
    setSecureOrigin(true);
    mockWatchPosition.mockReturnValue(1);

    const { promise } = getAccurateLocation();
    vi.advanceTimersByTime(60_000);
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects with TIMEOUT when best reading > 500m", async () => {
    setSecureOrigin(true);
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: { latitude: 23.0, longitude: 72.5, accuracy: 800 },
      } as GeolocationPosition);
      return 1;
    });

    const { promise } = getAccurateLocation();
    vi.advanceTimersByTime(60_000);
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects with TIMEOUT on cancel", async () => {
    setSecureOrigin(true);
    mockWatchPosition.mockReturnValue(1);

    const { promise, cancel } = getAccurateLocation();
    cancel();
    await expect(promise).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Location request was cancelled.",
    });
  });

  it("keeps the best accuracy reading across multiple updates", async () => {
    setSecureOrigin(true);
    let successCallback: PositionCallback;
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      successCallback = success;
      return 1;
    });

    const { promise } = getAccurateLocation();

    // Fire multiple readings — progressively better accuracy
    successCallback!({
      coords: { latitude: 23.0, longitude: 72.5, accuracy: 400 },
    } as GeolocationPosition);
    successCallback!({
      coords: { latitude: 23.1, longitude: 72.6, accuracy: 200 },
    } as GeolocationPosition);
    successCallback!({
      coords: { latitude: 23.2, longitude: 72.7, accuracy: 350 },
    } as GeolocationPosition);

    // Timeout should resolve with the best (200m) reading
    vi.advanceTimersByTime(60_000);
    const result = await promise;
    expect(result.accuracy).toBe(200);
    expect(result.lat).toBe(23.1);
  });

  it("ignores watchPosition TIMEOUT error (lets outer timeout handle it)", async () => {
    setSecureOrigin(true);
    let successCallback: PositionCallback;
    let errorCallback: PositionErrorCallback;
    mockWatchPosition.mockImplementation((success: PositionCallback, error: PositionErrorCallback) => {
      successCallback = success;
      errorCallback = error;
      return 1;
    });

    const { promise } = getAccurateLocation();

    // Fire a moderate reading first
    successCallback!({
      coords: { latitude: 23.0, longitude: 72.5, accuracy: 300 },
    } as GeolocationPosition);

    // Fire watchPosition TIMEOUT error (code 3) — should be ignored
    errorCallback!({
      code: 3,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
      message: "timeout",
    } as GeolocationPositionError);

    // Our own setTimeout should still resolve with best reading
    vi.advanceTimersByTime(60_000);
    const result = await promise;
    expect(result).toEqual({ lat: 23.0, lng: 72.5, accuracy: 300 });
  });

  it("allows 127.0.0.1 as secure origin", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", hostname: "127.0.0.1" },
    });
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      Promise.resolve().then(() => {
        success({
          coords: { latitude: 10.0, longitude: 20.0, accuracy: 50 },
        } as GeolocationPosition);
      });
      return 1;
    });

    const { promise } = getAccurateLocation();
    const result = await promise;
    expect(result).toEqual({ lat: 10.0, lng: 20.0, accuracy: 50 });
  });

  it("does not double-settle (second settle is ignored)", async () => {
    setSecureOrigin(true);
    let successCallback: PositionCallback;
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      successCallback = success;
      return 1;
    });

    const { promise, cancel } = getAccurateLocation();

    // Fire a good reading — resolves immediately
    successCallback!({
      coords: { latitude: 23.0, longitude: 72.5, accuracy: 50 },
    } as GeolocationPosition);

    const result = await promise;
    expect(result).toEqual({ lat: 23.0, lng: 72.5, accuracy: 50 });

    // Cancel after already resolved — should be a no-op (settled guard)
    cancel();
    // Advance timeout — also a no-op since already settled
    vi.advanceTimersByTime(60_000);
    // No error thrown, promise already resolved
  });

  it("clears watch on resolve", async () => {
    setSecureOrigin(true);
    // Fire success async so watchId is assigned before cleanup runs
    mockWatchPosition.mockImplementation((success: PositionCallback) => {
      Promise.resolve().then(() => {
        success({
          coords: { latitude: 23.0, longitude: 72.5, accuracy: 50 },
        } as GeolocationPosition);
      });
      return 42;
    });

    const { promise } = getAccurateLocation();
    await promise;
    expect(mockClearWatch).toHaveBeenCalledWith(42);
  });
});
