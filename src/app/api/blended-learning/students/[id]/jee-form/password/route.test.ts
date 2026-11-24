import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/exam-password-crypto", () => ({ decryptExamPassword: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { decryptExamPassword } from "@/lib/exam-password-crypto";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockDecrypt = vi.mocked(decryptExamPassword);

const MENTOR_A = "bl-mentor@example.org";
const MENTOR_READ_ONLY = "bl-mentor-read-only@example.org";
const ADMIN = "bl-admin@example.org";
const ADMIN_READ_ONLY = "bl-viewer@example.org";
const LMS_ADMIN = "lms-admin@example.org";
const TEACHER = "teacher@example.org";
// A team-lead Mentor (9004) who supervises Mentor 9002 (Student 601) and
// mentors Student 701 themself.
const SUPERVISOR = "bl-team-lead@example.org";

const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [MENTOR_READ_ONLY]: { role: "blended_mentor", read_only: true, user_id: 9001 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [LMS_ADMIN]: { role: "admin", read_only: false, user_id: 13 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
  [SUPERVISOR]: { role: "blended_mentor", read_only: false, user_id: 9004 },
};
// Active current-year Supervisions: supervisor → supervised Mentors.
const SUPERVISIONS: Record<number, number[]> = { 9004: [9002] };
// Active current-year Mappings: student → Mentor user id. 503 is unmapped.
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002, 502: 9001, 701: 9004 };
// 502 is a JNV NVS-only Student (a safety net: no Mentee is one today).
const NVS_ONLY = new Set([502]);
const CIPHERTEXT = "ZmFrZS1jaXBoZXJ0ZXh0";
const PASSWORD = "fake-portal-pass-1";

let ciphertexts: Record<number, string>;
let sql: string[];
let events: string[];
let reveals: unknown[][];
let logFails: boolean;

async function fakeQuery(text: string, params: unknown[] = []) {
  sql.push(text);
  // The permission read (the Supervisions read also checks user_permission).
  if (text.includes("FROM user_permission") && !text.includes("FROM blended_learning_mentor_supervisions")) {
    const email = String(params[0]).toLowerCase();
    const row = PERMISSIONS[email];
    return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
  }
  if (text.includes("FROM blended_learning_mentor_supervisions")) {
    return (SUPERVISIONS[Number(params[0])] ?? []).map((id) => ({ mentor_user_id: id }));
  }
  if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
    const mentor = MAPPINGS[Number(params[0])];
    return mentor ? [{ mentor_user_id: mentor }] : [];
  }
  if (text.includes("FROM student s")) return [{ nvs: NVS_ONLY.has(Number(params[0])), other: false }];
  if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
  if (text.includes("FROM student_exam_record")) {
    const ciphertext = ciphertexts[Number(params[0])];
    return ciphertext ? [{ id: 77, exam_id: 1, application_password_ciphertext: ciphertext }] : [];
  }
  if (text.includes("INSERT INTO lms_exam_password_reveals")) {
    events.push("log");
    if (logFails) throw new Error("insert failed");
    reveals.push(params);
    return [];
  }
  return [];
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function reveal(id: string) {
  const res = await POST(new Request(`http://localhost/api/blended-learning/students/${id}/jee-form/password`, { method: "POST" }), routeParams({ id }));
  const text = await res.text();
  events.push("response");
  return { status: res.status, text, body: JSON.parse(text), cacheControl: res.headers.get("cache-control") };
}

function expectNothingRevealed() {
  expect(mockDecrypt).not.toHaveBeenCalled();
  expect(reveals).toEqual([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  ciphertexts = { 501: CIPHERTEXT, 601: CIPHERTEXT, 502: CIPHERTEXT, 701: CIPHERTEXT };
  sql = [];
  events = [];
  reveals = [];
  logFails = false;
  mockQuery.mockImplementation(fakeQuery as typeof query);
  mockDecrypt.mockImplementation(async () => {
    events.push("decrypt");
    return PASSWORD;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/blended-learning/students/[id]/jee-form/password: who may reveal", () => {
  it("refuses a signed-out caller (401) and a user without Blended Learning access (403)", async () => {
    signedInAs(null);
    expect((await reveal("501")).status).toBe(401);
    signedInAs(TEACHER);
    expect((await reveal("501")).status).toBe(403);
    expectNothingRevealed();
  });

  it("reveals a Mentor's own Mentee's password, logged with the Mentor's email and role before it is returned", async () => {
    signedInAs(MENTOR_A);
    const res = await reveal("501");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ password: PASSWORD });
    expect(res.cacheControl).toBe("no-store");
    expect(mockDecrypt).toHaveBeenCalledWith(CIPHERTEXT, 501);
    expect(reveals).toEqual([[501, 77, 1, MENTOR_A, "blended_mentor"]]);
    expect(events).toEqual(["decrypt", "log", "response"]);
  });

  it("refuses (403) another Mentor's Mentee and an unmapped Student, revealing nothing", async () => {
    signedInAs(MENTOR_A);
    for (const id of ["601", "503"]) {
      const res = await reveal(id);
      expect(res.status).toBe(403);
      expect(res.cacheControl).toBe("no-store");
    }
    expectNothingRevealed();
  });

  it("lets a team lead reveal only their own Mentee's password, never a supervised Mentor's (403, nothing read)", async () => {
    signedInAs(SUPERVISOR);
    const refused = await reveal("601");
    expect(refused.status).toBe(403);
    expect(refused.text).not.toContain(PASSWORD);
    expectNothingRevealed();
    expect(sql.some((text) => text.includes("FROM student_exam_record"))).toBe(false);

    expect((await reveal("701")).status).toBe(200);
    expect(reveals).toEqual([[701, 77, 1, SUPERVISOR, "blended_mentor"]]);
  });

  it("refuses (403) read-only accounts, Mentor or admin, even in scope: nothing decrypted or logged", async () => {
    for (const [email, id] of [
      [MENTOR_READ_ONLY, "501"],
      [ADMIN_READ_ONLY, "601"],
    ] as const) {
      signedInAs(email);
      const res = await reveal(id);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
      expect(res.text).not.toContain(PASSWORD);
    }
    expectNothingRevealed();
    expect(sql.some((text) => text.includes("FROM student_exam_record"))).toBe(false);
  });

  it("lets Blended Learning Admins and LMS admins (not read-only) reveal for any mapped Student, each logged with their role", async () => {
    for (const email of [ADMIN, LMS_ADMIN]) {
      signedInAs(email);
      expect((await reveal("601")).status).toBe(200);
    }
    expect(reveals).toEqual([
      [601, 77, 1, ADMIN, "blended_admin"],
      [601, 77, 1, LMS_ADMIN, "admin"],
    ]);

    signedInAs(ADMIN);
    expect((await reveal("503")).status).toBe(403);
  });

  it("refuses (403) a JNV NVS-only Student, as the Exams tab does", async () => {
    signedInAs(MENTOR_A);
    const res = await reveal("502");
    expect(res.status).toBe(403);
    expectNothingRevealed();
  });
});

describe("POST /api/blended-learning/students/[id]/jee-form/password: what is revealed", () => {
  it("answers 404 when no ciphertext is saved, reading only the ciphertext column", async () => {
    ciphertexts = {};
    signedInAs(MENTOR_A);
    const res = await reveal("501");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No password saved" });
    expectNothingRevealed();
    for (const text of sql) expect(text).not.toMatch(/application_password(?!_ciphertext)/);
  });

  it("reveals nothing (500) when the reveal can't be logged", async () => {
    logFails = true;
    signedInAs(MENTOR_A);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await reveal("501");

    expect(res.status).toBe(500);
    expect(res.text).not.toContain(PASSWORD);
    expect(error.mock.calls).toEqual([["JEE form password reveal failed:", "Error"]]);
  });

  it("reveals nothing (500) when KMS fails, logging only the error's name", async () => {
    mockDecrypt.mockRejectedValueOnce(Object.assign(new Error(`cannot decrypt ${CIPHERTEXT}`), { name: "InvalidCiphertextException" }));
    signedInAs(MENTOR_A);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await reveal("501");

    expect(res.status).toBe(500);
    expect(reveals).toEqual([]);
    expect(error.mock.calls).toEqual([["JEE form password reveal failed:", "InvalidCiphertextException"]]);
    expect(JSON.stringify(error.mock.calls)).not.toContain(CIPHERTEXT);
  });
});
