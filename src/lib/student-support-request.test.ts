import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// The real School gate and feature matrix; only the session, the School row
// and the caller's permission row are stubbed.
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getResolvedPermission: vi.fn(),
  canAccessSchool: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { query } from "@/lib/db";
import { canAccessSchool, getResolvedPermission } from "@/lib/permissions";
import { withStudentSupportRead } from "./student-support-request";
import { PMU_MANAGER_PERMISSION, getRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

const SCHOOL = { id: 1, code: "70705", name: "JNV", region: "North", af_school_category: "JNV" };

const row = (over: object) =>
  ({ email: "u@avantifellows.org", level: 3, school_codes: null, regions: null, read_only: false, ...over }) as never;

const handler = vi.fn(async () => NextResponse.json({ ok: true }));
const GET = withStudentSupportRead(handler);
const call = (program: string) =>
  GET(
    getRequest("http://localhost/api/quiz-analytics/70705/student-support", { grade: "12", program }),
    routeParams({ udise: "70705" })
  );

beforeEach(() => {
  vi.resetAllMocks();
  handler.mockImplementation(async () => NextResponse.json({ ok: true }));
  vi.mocked(getSession).mockResolvedValue({ user: { email: "u@avantifellows.org" } } as never);
  vi.mocked(query).mockResolvedValue([SCHOOL]);
  vi.mocked(canAccessSchool).mockResolvedValue(true);
});

describe("withStudentSupportRead: the caller's programs", () => {
  it("lets a teacher read their own program", async () => {
    vi.mocked(getResolvedPermission).mockResolvedValue(row({ role: "teacher", level: 1, program_ids: [1] }));
    expect((await call("JNV CoE")).status).toBe(200);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ program: "JNV CoE", schoolCode: "70705" }), "70705");
  });

  it("refuses a teacher another program at the same School", async () => {
    vi.mocked(getResolvedPermission).mockResolvedValue(row({ role: "teacher", level: 1, program_ids: [1] }));
    for (const program of ["Punjab CoE", "JNV Nodal", "Not a program"]) {
      expect((await call(program)).status).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets an admin read any program, with or without program_ids, read-only too", async () => {
    for (const over of [{ program_ids: null }, { program_ids: [1] }, { program_ids: [], read_only: true }]) {
      vi.mocked(getResolvedPermission).mockResolvedValue(row({ role: "admin", ...over }));
      expect((await call("Punjab CoE")).status).toBe(200);
    }
  });

  it("lets a Program Manager read their programs and no other", async () => {
    vi.mocked(getResolvedPermission).mockResolvedValue(row({ role: "program_manager", level: 2, program_ids: [1, 74] }));
    expect((await call("JNV CoE")).status).toBe(200);
    expect((await call("Punjab CoE")).status).toBe(200);
    expect((await call("EMRS CoE")).status).toBe(403);
  });

  it("still refuses a PMU role (pinned to JNV NVS) and a caller with no permission row", async () => {
    vi.mocked(getResolvedPermission).mockResolvedValue(PMU_MANAGER_PERMISSION as never);
    expect((await call("JNV CoE")).status).toBe(403);
    // A retired passcode session has no permission row: no Performance access.
    vi.mocked(getSession).mockResolvedValue({ user: { email: "passcode-70705@school.local" } } as never);
    vi.mocked(getResolvedPermission).mockResolvedValue(null);
    expect((await call("JNV CoE")).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
