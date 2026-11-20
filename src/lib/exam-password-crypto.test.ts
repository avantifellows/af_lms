import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
