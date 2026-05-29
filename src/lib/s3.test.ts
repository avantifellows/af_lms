import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import {
  buildKey,
  extensionFor,
  uploadDocumentPages,
  deleteDocumentObjects,
  presignDocumentPage,
  S3UploadError,
  __resetS3ClientForTesting,
} from "./s3";

const s3Mock = mockClient(S3Client);

beforeAll(() => {
  process.env.S3_DOCS_BUCKET = "test-bucket";
  process.env.S3_DOCS_PREFIX = "test-prefix";
  process.env.S3_DOCS_REGION = "ap-south-1";
  process.env.S3_DOCS_ACCESS_KEY_ID = "test-key";
  process.env.S3_DOCS_SECRET_ACCESS_KEY = "test-secret";
});

beforeEach(() => {
  s3Mock.reset();
  __resetS3ClientForTesting();
});

describe("extensionFor", () => {
  it("maps known MIME types to extensions", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("image/heic")).toBe("heic");
    expect(extensionFor("application/pdf")).toBe("pdf");
  });

  it("throws on unknown MIME types", () => {
    expect(() => extensionFor("image/gif")).toThrow(/No extension mapping/);
    expect(() => extensionFor("text/plain")).toThrow(/No extension mapping/);
  });
});

describe("buildKey", () => {
  it("produces the expected nested path", () => {
    expect(
      buildKey({
        studentId: 42,
        documentType: "wise_research_consent",
        documentUuid: "abc-123",
        pageNumber: 1,
        extension: "jpg",
      }),
    ).toBe("test-prefix/students/42/wise_research_consent/abc-123/page-1.jpg");
  });

  it("respects S3_DOCS_PREFIX env at call time", () => {
    process.env.S3_DOCS_PREFIX = "alt-prefix";
    expect(
      buildKey({
        studentId: 7,
        documentType: "income_certificate",
        documentUuid: "u",
        pageNumber: 2,
        extension: "pdf",
      }),
    ).toBe("alt-prefix/students/7/income_certificate/u/page-2.pdf");
    process.env.S3_DOCS_PREFIX = "test-prefix";
  });
});

describe("uploadDocumentPages", () => {
  it("uploads each page with the expected bucket/key/body and returns keys in input order", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await uploadDocumentPages({
      studentId: 99,
      documentType: "wise_research_consent",
      documentUuid: "doc-1",
      pages: [
        { buffer: Buffer.from("page-1"), mimeType: "image/jpeg", pageNumber: 1 },
        { buffer: Buffer.from("page-2-bytes"), mimeType: "image/png", pageNumber: 2 },
      ],
    });

    expect(result).toEqual([
      {
        s3_key: "test-prefix/students/99/wise_research_consent/doc-1/page-1.jpg",
        page_number: 1,
        mime_type: "image/jpeg",
        byte_size: 6,
      },
      {
        s3_key: "test-prefix/students/99/wise_research_consent/doc-1/page-2.png",
        page_number: 2,
        mime_type: "image/png",
        byte_size: 12,
      },
    ]);

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: "test-prefix/students/99/wise_research_consent/doc-1/page-1.jpg",
      ContentType: "image/jpeg",
    });
    expect(calls[1].args[0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: "test-prefix/students/99/wise_research_consent/doc-1/page-2.png",
      ContentType: "image/png",
    });
  });

  it("uploads a single PDF with a .pdf extension", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await uploadDocumentPages({
      studentId: 5,
      documentType: "caste_certificate",
      documentUuid: "pdf-uuid",
      pages: [
        { buffer: Buffer.from("%PDF-1.4..."), mimeType: "application/pdf", pageNumber: 1 },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].s3_key).toBe(
      "test-prefix/students/5/caste_certificate/pdf-uuid/page-1.pdf",
    );
    expect(result[0].mime_type).toBe("application/pdf");
  });

  it("throws S3UploadError on first failure with the keys already uploaded", async () => {
    let calls = 0;
    s3Mock.on(PutObjectCommand).callsFake(() => {
      calls += 1;
      if (calls === 2) throw new Error("S3 down");
      return {};
    });

    let error: unknown;
    try {
      await uploadDocumentPages({
        studentId: 1,
        documentType: "other",
        documentUuid: "u",
        pages: [
          { buffer: Buffer.from("a"), mimeType: "image/jpeg", pageNumber: 1 },
          { buffer: Buffer.from("b"), mimeType: "image/jpeg", pageNumber: 2 },
          { buffer: Buffer.from("c"), mimeType: "image/jpeg", pageNumber: 3 },
        ],
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(S3UploadError);
    const s3Err = error as S3UploadError;
    expect(s3Err.uploaded).toHaveLength(1);
    expect(s3Err.uploaded[0].s3_key).toBe(
      "test-prefix/students/1/other/u/page-1.jpg",
    );
    // Should have stopped after the failing PUT — no third call.
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
  });
});

describe("deleteDocumentObjects", () => {
  it("issues a DeleteObjectCommand per key", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});

    await deleteDocumentObjects([
      "test-prefix/students/1/x/u/page-1.jpg",
      "test-prefix/students/1/x/u/page-2.jpg",
    ]);

    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: "test-prefix/students/1/x/u/page-1.jpg",
    });
  });

  it("swallows individual failures and continues", async () => {
    let calls = 0;
    s3Mock.on(DeleteObjectCommand).callsFake(() => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return {};
    });

    await expect(
      deleteDocumentObjects(["a", "b", "c"]),
    ).resolves.toBeUndefined();
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(3);
  });

  it("is a no-op for an empty key list", async () => {
    await expect(deleteDocumentObjects([])).resolves.toBeUndefined();
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });
});

describe("presignDocumentPage", () => {
  it("returns a signed URL that includes the bucket, key, and an expiry", async () => {
    const url = await presignDocumentPage({
      s3Key: "test-prefix/students/1/wise_research_consent/u/page-1.jpg",
      ttlSeconds: 600,
    });

    // AWS SigV4 GET URLs include these query params.
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain("test-bucket");
    expect(url).toContain("page-1.jpg");
    expect(url).toContain("X-Amz-Expires=600");
    expect(url).toContain("X-Amz-Signature=");
  });

  it("passes ResponseContentType into the signed URL when provided", async () => {
    const url = await presignDocumentPage({
      s3Key: "test-prefix/students/1/caste_certificate/u/page-1.pdf",
      ttlSeconds: 600,
      responseContentType: "application/pdf",
    });

    expect(url).toContain("response-content-type=application");
  });
});
