import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ canAccessAlumni: vi.fn() }));
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
import { canAccessAlumni } from "@/lib/permissions";
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getServerSession).mockResolvedValue(session as never);
  vi.mocked(canAccessAlumni).mockResolvedValue(true);
  vi.mocked(getAlumnusContext).mockResolvedValue(context());
  vi.mocked(lookupCodes).mockResolvedValue(new Map());
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

  it("updates the row (PATCH) with only the changed field", async () => {
    const res = await post({ values: { ug_status: "Studying", which_competitive_exam_did_you_appear_for: "State CET" } });
    expect(await res.json()).toMatchObject({ action: "updated" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.test/api/alumni/8340");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ which_competitive_exam_did_you_appear_for: "State CET" });
  });

  it("never erases a saved value: blanking a field alone is refused", async () => {
    const res = await post({ values: { ug_status: "" } });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 for a bad body, 404 for no such alumnus", async () => {
    expect((await post({})).status).toBe(400);
    vi.mocked(getAlumnusContext).mockResolvedValue(null);
    expect((await post({ values: { ug_status: "Studying" } })).status).toBe(404);
  });
});
