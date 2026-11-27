// AWS KMS encryption for exam-portal passwords (server-only).
//
// `student_exam_record.application_password_ciphertext` holds what this module
// produces. The DB Service stores it opaquely and BigQuery gets a copy, but
// neither holds a key that can read it: only this app's IAM user has
// kms:Encrypt / kms:Decrypt on the key, and only the reveal route decrypts.
//
// The encryption context binds each ciphertext to its Student, so a value
// copied onto another Student's row fails to decrypt instead of revealing the
// first Student's password under the second one's name.

import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";

const PURPOSE = "student_exam_record.application_password";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
let _warnedIgnoredEndpoint = false;

function isLoopback(endpoint: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

// EXAM_PASSWORD_KMS_ENDPOINT is for the fake KMS in e2e
// (e2e/helpers/db-service-stub.mjs) and is unset everywhere else, so the SDK
// uses the real regional endpoint. In production it is honoured only for a
// loopback host (localhost, 127.0.0.1, ::1): set by mistake to anything
// else, plaintext passwords and signed AWS requests would go to that host,
// so it is ignored with a warning that never names the value.
function endpointOverride(): string | undefined {
  const endpoint = process.env.EXAM_PASSWORD_KMS_ENDPOINT;
  if (!endpoint) return undefined;
  if (process.env.NODE_ENV !== "production" || isLoopback(endpoint)) return endpoint;
  if (!_warnedIgnoredEndpoint) {
    _warnedIgnoredEndpoint = true;
    console.warn("EXAM_PASSWORD_KMS_ENDPOINT ignored in production: only a localhost endpoint is honoured.");
  }
  return undefined;
}

let _client: KMSClient | null = null;
function client(): KMSClient {
  if (!_client) {
    _client = new KMSClient({
      region: process.env.EXAM_PASSWORD_KMS_REGION || "ap-south-1",
      endpoint: endpointOverride(),
      credentials: {
        accessKeyId: process.env.EXAM_PASSWORD_KMS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.EXAM_PASSWORD_KMS_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _client;
}

// Test-only hook: clear the cached client so a new one picks up updated env vars.
export function __resetKmsClientForTesting(): void {
  _client = null;
  _warnedIgnoredEndpoint = false;
}

function keyId(): string {
  const id = process.env.EXAM_PASSWORD_KMS_KEY_ID;
  if (!id) throw new Error("EXAM_PASSWORD_KMS_KEY_ID is not set");
  return id;
}

function encryptionContext(studentId: number): Record<string, string> {
  return { purpose: PURPOSE, student_id: String(studentId) };
}

/** Base64 KMS ciphertext of `plaintext`, bound to `studentId`. */
export async function encryptExamPassword(
  plaintext: string,
  studentId: number,
): Promise<string> {
  const out = await client().send(
    new EncryptCommand({
      KeyId: keyId(),
      Plaintext: new TextEncoder().encode(plaintext),
      EncryptionContext: encryptionContext(studentId),
    }),
  );
  if (!out.CiphertextBlob) throw new Error("KMS returned no ciphertext");
  return Buffer.from(out.CiphertextBlob).toString("base64");
}

/**
 * The password behind a ciphertext from {@link encryptExamPassword}. Throws if
 * the ciphertext was made for another Student or under another key.
 */
export async function decryptExamPassword(
  ciphertext: string,
  studentId: number,
): Promise<string> {
  const out = await client().send(
    new DecryptCommand({
      // Pinning the key means a ciphertext made under any other key is
      // refused, not decrypted with whatever key it names.
      KeyId: keyId(),
      CiphertextBlob: Buffer.from(ciphertext, "base64"),
      EncryptionContext: encryptionContext(studentId),
    }),
  );
  if (!out.Plaintext) throw new Error("KMS returned no plaintext");
  return new TextDecoder().decode(out.Plaintext);
}
