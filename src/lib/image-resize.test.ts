import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { downscaleImage, __test__ } from "./image-resize";

const { scaledDimensions } = __test__;

describe("scaledDimensions", () => {
  it("passes through dimensions already within the cap", () => {
    expect(scaledDimensions(1000, 800, 1500)).toEqual({ width: 1000, height: 800 });
  });

  it("scales a landscape image so the longer (width) side equals maxDim", () => {
    expect(scaledDimensions(3000, 1500, 1500)).toEqual({ width: 1500, height: 750 });
  });

  it("scales a portrait image so the longer (height) side equals maxDim", () => {
    expect(scaledDimensions(1500, 3000, 1500)).toEqual({ width: 750, height: 1500 });
  });

  it("handles a square image exactly at maxDim", () => {
    expect(scaledDimensions(2000, 2000, 1500)).toEqual({ width: 1500, height: 1500 });
  });
});

describe("downscaleImage", () => {
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let imageOnloadHandlers: Array<() => void>;

  beforeEach(() => {
    imageOnloadHandlers = [];

    // Stub URL.create/revoke (jsdom implements these but spying lets us assert).
    createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:stub");
    revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    // Patch the global Image so we control onload + naturalWidth/Height.
    // jsdom's Image doesn't actually fetch the src, so onload never fires.
    class StubImage {
      onload: (() => void) | null = null;
      onerror: ((e?: unknown) => void) | null = null;
      naturalWidth = 3000;
      naturalHeight = 1500;
      private _src = "";
      get src() {
        return this._src;
      }
      set src(_v: string) {
        this._src = _v;
        // Fire onload on the microtask after src is assigned, mimicking real Image.
        queueMicrotask(() => {
          imageOnloadHandlers.push(() => this.onload?.());
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("Image", StubImage);

    // Patch canvas.toBlob — jsdom's canvas returns null without an extra dep.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.toBlob = vi.fn(function (
      this: HTMLCanvasElement,
      cb: (blob: Blob | null) => void,
      type?: string,
      quality?: number,
    ) {
      // Encode the args into the returned blob so tests can verify them.
      const bytes = new TextEncoder().encode(`stub:${type}:${quality}:${this.width}x${this.height}`);
      cb(new Blob([bytes as BlobPart], { type: type ?? "image/jpeg" }));
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it("downscales a 3000×1500 image to 1500×750 JPEG", async () => {
    const file = new File([new Uint8Array([1, 2, 3]) as BlobPart], "p.jpg", { type: "image/jpeg" });
    const blob = await downscaleImage(file);

    expect(blob.type).toBe("image/jpeg");
    const text = await blob.text();
    expect(text).toContain("image/jpeg");
    expect(text).toContain("1500x750");
    expect(text).toContain(":0.8:");
  });

  it("respects custom maxDim + quality", async () => {
    const file = new File([new Uint8Array([1]) as BlobPart], "p.jpg", { type: "image/jpeg" });
    const blob = await downscaleImage(file, { maxDim: 600, quality: 0.5 });

    const text = await blob.text();
    expect(text).toContain("600x300");
    expect(text).toContain(":0.5:");
  });

  it("releases the object URL after downscaling", async () => {
    const file = new File([new Uint8Array([1]) as BlobPart], "p.jpg", { type: "image/jpeg" });
    await downscaleImage(file);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:stub");
  });

  it("releases the object URL when decoding fails", async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingImage);

    const file = new File([new Uint8Array([1]) as BlobPart], "p.heic", { type: "image/heic" });
    await expect(downscaleImage(file)).rejects.toThrow(/Failed to decode/);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:stub");
  });
});
