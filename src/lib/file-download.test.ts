import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadFile, saveBlob } from "./file-download";

describe("file-download", () => {
  let clicked: { href: string; download: string }[];

  beforeEach(() => {
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });
    URL.createObjectURL = vi.fn(() => "blob:file-1");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("saveBlob saves a file the browser holds under the given name and frees its URL", () => {
    const blob = new Blob(["a,b"], { type: "text/csv" });

    saveBlob(blob, "list.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: "blob:file-1", download: "list.csv" }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:file-1");
  });

  it("downloadFile saves the response body under the name taken from the response", async () => {
    const body = new Blob(["x"]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => body })));

    await downloadFile("/api/x", "Unable to export", () => "x.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(body);
    expect(clicked).toEqual([{ href: "blob:file-1", download: "x.csv" }]);
  });

  it("downloadFile throws the response's error and saves nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "Access denied" }) })));

    await expect(downloadFile("/api/x", "Unable to export", () => "x.csv")).rejects.toThrow("Access denied");
    expect(clicked).toEqual([]);
  });
});
