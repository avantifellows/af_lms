import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import {
  __resetKmsClientForTesting,
  decryptExamPassword,
  encryptExamPassword,
} from "./exam-password-crypto";

const kms = mockClient(KMSClient);
const KEY = "arn:aws:kms:ap-south-1:111122223333:key/test";
const CONTEXT = { purpose: "student_exam_record.application_password", student_id: "7" };

beforeEach(() => {
  kms.reset();
  __resetKmsClientForTesting();
  process.env.EXAM_PASSWORD_KMS_KEY_ID = KEY;
});

afterEach(() => {
  delete process.env.EXAM_PASSWORD_KMS_KEY_ID;
});

describe("encryptExamPassword", () => {
  it("encrypts under the configured key, bound to the Student, as base64", async () => {
    kms.on(EncryptCommand).resolves({ CiphertextBlob: new Uint8Array([1, 2, 3]) });

    expect(await encryptExamPassword("hunter2", 7)).toBe("AQID");

    const input = kms.commandCalls(EncryptCommand)[0].args[0].input;
    expect(input.KeyId).toBe(KEY);
    expect(input.EncryptionContext).toEqual(CONTEXT);
    expect(new TextDecoder().decode(input.Plaintext)).toBe("hunter2");
  });

  it("refuses to run without a key configured", async () => {
    delete process.env.EXAM_PASSWORD_KMS_KEY_ID;

    await expect(encryptExamPassword("hunter2", 7)).rejects.toThrow(
      "EXAM_PASSWORD_KMS_KEY_ID is not set",
    );
    expect(kms.commandCalls(EncryptCommand)).toHaveLength(0);
  });

  it("fails when KMS returns no ciphertext", async () => {
    kms.on(EncryptCommand).resolves({});

    await expect(encryptExamPassword("hunter2", 7)).rejects.toThrow("no ciphertext");
  });
});

describe("decryptExamPassword", () => {
  it("decrypts with the key pinned and the same Student's context", async () => {
    kms.on(DecryptCommand).resolves({ Plaintext: new TextEncoder().encode("hunter2") });

    expect(await decryptExamPassword("AQID", 7)).toBe("hunter2");

    const input = kms.commandCalls(DecryptCommand)[0].args[0].input;
    expect(input.KeyId).toBe(KEY);
    expect(input.EncryptionContext).toEqual(CONTEXT);
    expect(Array.from(input.CiphertextBlob as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("surfaces KMS refusing a ciphertext made for another Student", async () => {
    kms.on(DecryptCommand).rejects(new Error("InvalidCiphertextException"));

    await expect(decryptExamPassword("AQID", 8)).rejects.toThrow("InvalidCiphertextException");
  });
});

describe("the EXAM_PASSWORD_KMS_ENDPOINT override (the e2e fake KMS)", () => {
  // The endpoint the KMS client was built with, or undefined for AWS's own.
  async function endpointUsed(): Promise<string | undefined> {
    kms.on(EncryptCommand).resolves({ CiphertextBlob: new Uint8Array([1]) });
    await encryptExamPassword("fake-portal-pass", 7);
    const client = kms.send.getCall(0).thisValue as KMSClient;
    const endpoint = await client.config.endpoint?.();
    return endpoint ? `${endpoint.protocol}//${endpoint.hostname}${endpoint.port ? `:${endpoint.port}` : ""}` : undefined;
  }

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("ignores a remote host in production, warning once without naming it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXAM_PASSWORD_KMS_ENDPOINT", "https://kms.attacker.example:8443/kms");

    expect(await endpointUsed()).toBeUndefined();
    await encryptExamPassword("fake-portal-pass", 7);
    expect(warn.mock.calls).toEqual([
      ["EXAM_PASSWORD_KMS_ENDPOINT ignored in production: only a localhost endpoint is honoured."],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("attacker");
  });

  it.each(["http://localhost:3902/kms", "http://127.0.0.1:3902/kms", "http://[::1]:3902/kms"])(
    "uses a loopback endpoint in production: %s",
    async (endpoint) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("EXAM_PASSWORD_KMS_ENDPOINT", endpoint);

      expect(await endpointUsed()).toBe(new URL(endpoint).origin);
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it("uses any endpoint outside production, as before", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EXAM_PASSWORD_KMS_ENDPOINT", "https://kms.fake-remote.example");

    expect(await endpointUsed()).toBe("https://kms.fake-remote.example");
    expect(warn).not.toHaveBeenCalled();
  });

  // "localhost:3902" parses as a URL with scheme "localhost:" and no host.
  it.each(["not a url", "localhost:3902"])("ignores a malformed endpoint in production: %s", async (endpoint) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXAM_PASSWORD_KMS_ENDPOINT", endpoint);

    expect(await endpointUsed()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("uses AWS's own endpoint when none is set, with no warning", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXAM_PASSWORD_KMS_ENDPOINT", "");

    expect(await endpointUsed()).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
