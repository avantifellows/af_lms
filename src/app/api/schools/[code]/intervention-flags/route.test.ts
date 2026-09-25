import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ withTransaction: vi.fn((fn) => fn({})) }));
vi.mock("@/lib/permissions", () => ({ getStudentSchool: vi.fn() }));
vi.mock("@/lib/intervention-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intervention-flags")>();
  return {
    ...actual,
    authorizeInterventionFlags: vi.fn(),
    listSchoolFlags: vi.fn(),
    raiseFlag: vi.fn(),
  };
});

import { withTransaction } from "@/lib/db";
import {
  InterventionFlagError,
  authorizeInterventionFlags,
  listSchoolFlags,
  raiseFlag,
} from "@/lib/intervention-flags";
import { getStudentSchool } from "@/lib/permissions";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";
import { GET, POST } from "./route";

const mockAuthorize = vi.mocked(authorizeInterventionFlags);
const mockRaiseFlag = vi.mocked(raiseFlag);
const mockGetStudentSchool = vi.mocked(getStudentSchool);

const SCHOOL = { id: "7", code: "70705", udise_code: "09123", name: "JNV Test", region: null };
const ACTOR = { email: "teacher@avantifellows.org", userId: 42, permission: {} as never };

function post(body: unknown) {
  return new NextRequest("http://localhost/api/schools/70705/intervention-flags", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(withTransaction).mockImplementation((fn) => fn({} as never));
  mockAuthorize.mockResolvedValue({ ok: true, actor: ACTOR, school: SCHOOL });
});

describe("GET /api/schools/[code]/intervention-flags", () => {
  it("returns the gate's response when access is denied", async () => {
    mockAuthorize.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await GET(new NextRequest("http://localhost"), routeParams({ code: "70705" }));
    expect(res.status).toBe(403);
    expect(listSchoolFlags).not.toHaveBeenCalled();
  });

  it("lists the school's flags", async () => {
    vi.mocked(listSchoolFlags).mockResolvedValue([]);
    const res = await GET(new NextRequest("http://localhost"), routeParams({ code: "70705" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flags: [] });
    expect(listSchoolFlags).toHaveBeenCalledWith("7");
  });
});

describe("POST /api/schools/[code]/intervention-flags", () => {
  it("requires a positive integer studentPkId and a note", async () => {
    expect((await POST(post({ studentPkId: "abc", note: "x" }), routeParams({ code: "70705" }))).status).toBe(400);
    expect((await POST(post({ studentPkId: 5, note: "  " }), routeParams({ code: "70705" }))).status).toBe(400);
    expect(mockRaiseFlag).not.toHaveBeenCalled();
  });

  it("refuses a student who is not at this school", async () => {
    mockGetStudentSchool.mockResolvedValue({ code: "11111", region: null, program_id: 1 });
    const res = await POST(post({ studentPkId: 5, note: "x" }), routeParams({ code: "70705" }));
    expect(res.status).toBe(404);
    expect(mockRaiseFlag).not.toHaveBeenCalled();
  });

  it("raises the flag with the student's current program", async () => {
    mockGetStudentSchool.mockResolvedValue({ code: "70705", region: null, program_id: 1 });
    mockRaiseFlag.mockResolvedValue({ id: 9 });

    const res = await POST(post({ studentPkId: 5, note: " Lost a parent " }), routeParams({ code: "70705" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ flag: { id: 9 } });
    expect(mockRaiseFlag).toHaveBeenCalledWith(expect.anything(), {
      studentPkId: 5, schoolId: "7", programId: 1, actor: ACTOR, note: "Lost a parent",
    });
  });

  it("surfaces an already-open flag as 409", async () => {
    mockGetStudentSchool.mockResolvedValue({ code: "70705", region: null, program_id: null });
    mockRaiseFlag.mockRejectedValue(new InterventionFlagError(409, "This student already has an open flag"));

    const res = await POST(post({ studentPkId: 5, note: "x" }), routeParams({ code: "70705" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This student already has an open flag" });
  });
});
