import { describe, it, expect, beforeEach, vi } from "vitest";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";
import {
  examRecordsPermissionRow,
  queueExamRecordsGate,
} from "@/app/api/__test-utils__/exam-records-gate";

vi.mock("@/lib/exam-password-crypto", () => ({ decryptExamPassword: vi.fn() }));
vi.mock("@/lib/student-exam-records", () => ({
  getExamPasswordSource: vi.fn(),
  recordExamPasswordReveal: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import {
  getExamPasswordSource,
  recordExamPasswordReveal,
} from "@/lib/student-exam-records";
import { decryptExamPassword } from "@/lib/exam-password-crypto";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockSource = vi.mocked(getExamPasswordSource);
const mockLog = vi.mocked(recordExamPasswordReveal);
const mockDecrypt = vi.mocked(decryptExamPassword);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockSource.mockResolvedValue({
    recordId: 10,
    examId: 1,
    ciphertext: "Q0lQSEVS",
    legacyPlaintext: null,
  });
  mockDecrypt.mockResolvedValue("hunter2");
  mockLog.mockResolvedValue(undefined);
});

/**
 * The gate's three queries, then the permission row `exam_passwords` is read
 * from — unless the gate stops first.
 */
function authorize({ readOnly = false, pmuOnly = false, viewerRole = "admin" } = {}) {
  queueExamRecordsGate(mockSession, mockQuery, { readOnly, pmuOnly });
  mockQuery.mockResolvedValueOnce([examRecordsPermissionRow({ role: viewerRole })]);
}

function reveal(id = "7", recordId = "10") {
  return POST(new Request("http://test", { method: "POST" }), routeParams({ id, recordId }));
}

function expectNothingRevealed() {
  expect(mockDecrypt).not.toHaveBeenCalled();
  expect(mockLog).not.toHaveBeenCalled();
}

describe("POST /api/students/[id]/exam-records/[recordId]/password", () => {
  it("refuses an unauthenticated caller", async () => {
    mockSession.mockResolvedValue(null);

    expect((await reveal()).status).toBe(401);
    expect(mockSource).not.toHaveBeenCalled();
    expectNothingRevealed();
  });

  it("refuses a read-only user", async () => {
    authorize({ readOnly: true });

    expect((await reveal()).status).toBe(403);
    expect(mockSource).not.toHaveBeenCalled();
    expectNothingRevealed();
  });

  it("refuses a JNV NVS Student", async () => {
    authorize({ pmuOnly: true });

    expect((await reveal()).status).toBe(403);
    expectNothingRevealed();
  });

  it("refuses a role without exam_passwords view, even past the Student gate", async () => {
    authorize({ viewerRole: "holistic_mentorship_admin" });

    expect((await reveal()).status).toBe(403);
    expect(mockSource).not.toHaveBeenCalled();
    expectNothingRevealed();
  });

  it("rejects a record id that is not an integer", async () => {
    authorize();

    expect((await reveal("7", "10abc")).status).toBe(400);
    expectNothingRevealed();
  });

  it("answers 404 for a record that is not this Student's", async () => {
    authorize();
    mockSource.mockResolvedValue(null);

    const res = await reveal();

    expect(res.status).toBe(404);
    expect(mockSource).toHaveBeenCalledWith(7, 10);
    expectNothingRevealed();
  });

  it("answers 404 when no password is stored", async () => {
    authorize();
    mockSource.mockResolvedValue({
      recordId: 10,
      examId: 1,
      ciphertext: null,
      legacyPlaintext: null,
    });

    expect((await reveal()).status).toBe(404);
    expectNothingRevealed();
  });

  it("decrypts against this Student, logs the reveal, and is never cached", async () => {
    authorize();

    const res = await reveal();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ password: "hunter2" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mockDecrypt).toHaveBeenCalledWith("Q0lQSEVS", 7);
    expect(mockLog).toHaveBeenCalledWith({
      studentId: 7,
      recordId: 10,
      examId: 1,
      viewerEmail: "admin@avantifellows.org",
      viewerRole: "admin",
    });
  });

  it("reveals a not-yet-backfilled plaintext password, and still logs it", async () => {
    authorize();
    mockSource.mockResolvedValue({
      recordId: 10,
      examId: 1,
      ciphertext: null,
      legacyPlaintext: "legacy-pw",
    });

    const res = await reveal();

    expect(await res.json()).toEqual({ password: "legacy-pw" });
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledTimes(1);
  });

  it("returns no password when the reveal cannot be logged", async () => {
    authorize();
    mockLog.mockRejectedValue(new Error("insert failed"));

    const res = await reveal();

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
  });

  it("logs nothing when decryption fails", async () => {
    authorize();
    mockDecrypt.mockRejectedValue(new Error("InvalidCiphertextException"));

    expect((await reveal()).status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
  });
});
