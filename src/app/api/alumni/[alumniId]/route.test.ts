import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ canAccessAlumni: vi.fn(), getAlumniPermission: vi.fn() }));
vi.mock("@/lib/alumni/entry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alumni/entry")>();
  return { ...actual, getAlumnusContext: vi.fn() };
});
vi.mock("@/lib/alumni/reference", () => ({ lookupCodes: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/db-service-config", () => ({ getDbServiceConfig: vi.fn() }));

import { getServerSession } from "next-auth";
import { getAlumnusContext, type EntryContext } from "@/lib/alumni/entry";
import { lookupCodes } from "@/lib/alumni/reference";
import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { canAccessAlumni, getAlumniPermission } from "@/lib/permissions";
import { GET, POST } from "./route";

const fetchMock = vi.fn();
const session = { user: { email: "caller@avantifellows.org" }, expires: "" };
const params = (alumniId = "8340") => ({ params: Promise.resolve({ alumniId }) });
const get = (alumniId?: string) => GET(new Request("http://localhost"), params(alumniId));
const post = (body: unknown, alumniId = "8340") =>
  POST(new Request(`http://localhost/api/alumni/${alumniId}`, { method: "POST", body: JSON.stringify(body) }), params(alumniId));

function context(overrides: Partial<EntryContext> = {}): EntryContext {
  return {
    kind: "edit",
    ids: { enrollmentUserId: "86655", studentId: "86544", alumniId: "8340" },
    name: "Ampoli Ram Charan",
    afid: "2632401171",
    program: "JNV CoE",
    school: "JNV Adilabad",
    schoolCode: "59525",
    cohortYear: "2025-2026",
    profile: { student_g12_graduating_year: "2026" },
    alumni: { ug_status: "Studying", which_competitive_exam_did_you_appear_for: "Other" },
    codeNames: {},
    version: "v1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getServerSession).mockResolvedValue(session as never);
  vi.mocked(canAccessAlumni).mockResolvedValue(true);
  vi.mocked(getAlumniPermission).mockResolvedValue({ role: "alumni_manager" } as never);
  vi.mocked(getAlumnusContext).mockResolvedValue(context());
  vi.mocked(lookupCodes).mockResolvedValue({ college: new Map(), branch: new Map() });
  vi.mocked(query).mockResolvedValue([{ id: "8340" }]);
  vi.mocked(getDbServiceConfig).mockReturnValue({
    baseUrl: "https://db.test/api",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
  });
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 8340 }), text: async () => "{}" });
});

describe("GET /api/alumni/[alumniId]", () => {
  it("401 without a session, 400 for a bad id", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);
    expect((await get()).status).toBe(401);
    expect((await get("abc")).status).toBe(400);
  });

  it("checks access with canAccessAlumni (alumni are not Students)", async () => {
    vi.mocked(canAccessAlumni).mockResolvedValue(false);
    expect((await get()).status).toBe(403);
    expect(canAccessAlumni).toHaveBeenCalledWith(session, "8340", { requireEdit: false });
    expect(getAlumnusContext).not.toHaveBeenCalled();
  });

  it("returns the alumnus, or 404 when there's no such row", async () => {
    expect((await (await get()).json()).ids.alumniId).toBe("8340");
    vi.mocked(getAlumnusContext).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });
});

describe("POST /api/alumni/[alumniId]", () => {
  it("needs edit access", async () => {
    vi.mocked(canAccessAlumni).mockResolvedValue(false);
    expect((await post({ values: { ug_status: "Studying" } })).status).toBe(403);
    expect(canAccessAlumni).toHaveBeenCalledWith(session, "8340", { requireEdit: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves the changed field as a call by the person (answers + history together)", async () => {
    const res = await post({ values: { ug_status: "Studying", which_competitive_exam_did_you_appear_for: "State CET" }, version: "v1" });
    expect(await res.json()).toMatchObject({ action: "updated" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.test/api/alumni/8340/journey");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      source: "call",
      data: { which_competitive_exam_did_you_appear_for: "State CET" },
      actor_email: "caller@avantifellows.org",
      actor_role: "alumni_manager",
    });
  });

  it("never erases a saved value: blanking a field alone is refused", async () => {
    const res = await post({ values: { ug_status: "" }, version: "v1" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the version through: a save made on an older version is refused (409)", async () => {
    const res = await post({ values: { ug_status: "Studying", which_competitive_exam_did_you_appear_for: "State CET" }, version: "v0" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Someone else saved/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("call remark", () => {
    const values = { ug_status: "Studying", which_competitive_exam_did_you_appear_for: "Other" };

    it("Other without its text is a field error", async () => {
      const res = await post({ values, version: "v1", remark: { option: "Other", details: "" } });
      expect(res.status).toBe(400);
      expect((await res.json()).fieldErrors).toEqual({ remark: "Write the remark." });
    });

    it("with history on, a remark alone is saved as the call's history row", async () => {
      vi.mocked(query).mockResolvedValue([{ id: "8340", data: {}, contact_status: null, version: "v1" }]);
      const res = await post({ values, version: "v1", remark: { option: "Preparing for other exams", details: "GATE" } });
      expect(await res.json()).toMatchObject({ ok: true, changed: [], remark: "Preparing for other exams: GATE" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://db.test/api/alumni/8340/journey");
      expect(JSON.parse(init.body)).toMatchObject({
        source: "call",
        data: {},
        actor_email: "caller@avantifellows.org",
        actor_role: "alumni_manager",
        notes: "Preparing for other exams: GATE",
      });
    });
  });

  it("400 for a bad body, 404 for no such alumnus", async () => {
    expect((await post({})).status).toBe(400);
    vi.mocked(getAlumnusContext).mockResolvedValue(null);
    expect((await post({ values: { ug_status: "Studying" } })).status).toBe(404);
  });
});
