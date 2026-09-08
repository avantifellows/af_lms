import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireCmsServiceAccess: vi.fn(),
  buildTransientKey: vi.fn(),
  uploadTransientObject: vi.fn(),
  presignDocumentPage: vi.fn(),
}));

vi.mock("@/lib/cms-service", () => ({
  requireCmsServiceAccess: mocks.requireCmsServiceAccess,
}));
vi.mock("@/lib/s3", () => ({
  buildTransientKey: mocks.buildTransientKey,
  uploadTransientObject: mocks.uploadTransientObject,
  presignDocumentPage: mocks.presignDocumentPage,
}));

import { GET } from "./route";

const CMS = { url: "https://cms.test", token: "cms-token" };
const SIGNED_URL = "https://bucket.s3.ap-south-1.amazonaws.com/k?X-Amz-Signature=sig";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 fake");

function req(query: string) {
  return new NextRequest(`https://lms.test/api/cms/test-pdf?${query}`);
}

function cmsOk(headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    arrayBuffer: async () => PDF_BYTES.buffer.slice(0),
    text: async () => "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.requireCmsServiceAccess.mockResolvedValue({ ok: true, cms: CMS });
  mocks.buildTransientKey.mockReturnValue("lms-documents/tmp/cms-test-pdf/uuid.pdf");
  mocks.uploadTransientObject.mockResolvedValue(undefined);
  mocks.presignDocumentPage.mockResolvedValue(SIGNED_URL);
});

describe("GET /api/cms/test-pdf", () => {
  it("returns the access response when the caller is not allowed", async () => {
    const denied = new Response(null, { status: 401 });
    mocks.requireCmsServiceAccess.mockResolvedValue({ ok: false, response: denied });

    const res = await GET(req("testId=7"));

    expect(res.status).toBe(401);
    expect(mocks.uploadTransientObject).not.toHaveBeenCalled();
  });

  it("400s without a testId", async () => {
    const res = await GET(req("type=questions"));
    expect(res.status).toBe(400);
  });

  it("stages the PDF in S3 and redirects to a presigned URL instead of returning the bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      cmsOk({ "content-disposition": 'inline; filename="paper.pdf"' })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(req("testId=7&type=questions"));

    // The CMS is called with the service bearer token.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cms.test/api/service/test-pdf?id=7&type=questions",
      expect.objectContaining({
        headers: { Authorization: "Bearer cms-token" },
      })
    );

    // The bytes go to a transient key, never back through this response.
    expect(mocks.buildTransientKey).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cms-test-pdf", extension: "pdf" })
    );
    const upload = mocks.uploadTransientObject.mock.calls[0][0];
    expect(upload.s3Key).toBe("lms-documents/tmp/cms-test-pdf/uuid.pdf");
    expect(upload.contentType).toBe("application/pdf");
    expect(Buffer.isBuffer(upload.body)).toBe(true);
    expect(upload.body.toString()).toBe("%PDF-1.4 fake");

    expect(mocks.presignDocumentPage).toHaveBeenCalledWith({
      s3Key: "lms-documents/tmp/cms-test-pdf/uuid.pdf",
      ttlSeconds: 300,
      responseContentType: "application/pdf",
      responseContentDisposition: 'inline; filename="paper.pdf"',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(SIGNED_URL);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).not.toBe("application/pdf");
  });

  // The motivating bug: Amplify's Lambda caps SSR responses at ~5.7MB, so any paper bigger
  // than that 504'd when proxied. Pin that a PDF well over the cap never enters this route's
  // response body — it goes to S3 whole, and the browser gets only a redirect.
  it("never carries a >6MB PDF in the response body", async () => {
    const eightMb = 8 * 1024 * 1024;
    const big = new Uint8Array(eightMb);
    big.set(new TextEncoder().encode("%PDF-1.4"), 0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ...cmsOk(),
        arrayBuffer: async () => big.buffer,
      })
    );

    const res = await GET(req("testId=7"));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(SIGNED_URL);
    // A redirect has no payload; the bytes must not have come back through Lambda.
    expect(res.body).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();

    const upload = mocks.uploadTransientObject.mock.calls[0][0];
    expect(upload.body.byteLength).toBe(eightMb);
    expect(upload.body.subarray(0, 8).toString()).toBe("%PDF-1.4");
  });

  it("uses a fresh key per request", async () => {
    mocks.buildTransientKey.mockRestore();
    const { buildTransientKey } = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");
    process.env.S3_DOCS_PREFIX = "lms-documents";
    mocks.buildTransientKey.mockImplementation(buildTransientKey);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(cmsOk()));

    await GET(req("testId=7"));
    await GET(req("testId=7"));

    const [a, b] = mocks.uploadTransientObject.mock.calls.map((c) => c[0].s3Key as string);
    expect(a).toMatch(/^lms-documents\/tmp\/cms-test-pdf\/[0-9a-f-]{36}\.pdf$/);
    expect(a).not.toBe(b);
  });

  it("forces an attachment disposition when download=1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        cmsOk({ "content-disposition": 'inline; filename="paper.pdf"' })
      )
    );

    await GET(req("testId=7&download=1"));

    expect(mocks.presignDocumentPage).toHaveBeenCalledWith(
      expect.objectContaining({
        responseContentDisposition: 'attachment; filename="paper.pdf"',
      })
    );
  });

  it("defaults the filename when the CMS sends no disposition", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(cmsOk()));

    await GET(req("testId=7"));

    expect(mocks.presignDocumentPage).toHaveBeenCalledWith(
      expect.objectContaining({
        responseContentDisposition: 'inline; filename="test.pdf"',
      })
    );
  });

  it("passes a CMS failure status through without touching S3", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => "no such test",
      })
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("testId=7"));

    expect(res.status).toBe(404);
    expect(mocks.uploadTransientObject).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("502s when the CMS is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("testId=7"));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to reach CMS" });
    errSpy.mockRestore();
  });

  it("502s (no redirect) when staging in S3 fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(cmsOk()));
    mocks.uploadTransientObject.mockRejectedValue(new Error("AccessDenied"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("testId=7"));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to stage PDF" });
    expect(res.headers.get("location")).toBeNull();
    expect(mocks.presignDocumentPage).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
