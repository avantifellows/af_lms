import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alumni/access", () => ({ authorizeAlumni: vi.fn() }));
vi.mock("@/lib/alumni/entry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alumni/entry")>();
  return { ...actual, getEntryContext: vi.fn() };
});
vi.mock("@/lib/alumni/reference", () => ({ lookupCodes: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/db-service-config", () => ({ getDbServiceConfig: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ canAccessSchool: vi.fn() }));

import { authorizeAlumni } from "@/lib/alumni/access";
import { getEntryContext, type EntryContext } from "@/lib/alumni/entry";
import { lookupCodes } from "@/lib/alumni/reference";
import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { canAccessSchool } from "@/lib/permissions";
import { GET, POST } from "./route";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const ADMIN = { ok: true as const, email: "admin@avantifellows.org", permission: { level: 3, role: "admin" } as never };
const denied = (status: number) => ({ ok: false as const, response: Response.json({ error: "x" }, { status }) as never });
const params = (userId = "86655") => ({ params: Promise.resolve({ userId }) });
const post = (body: unknown, userId = "86655") =>
  POST(new Request(`http://localhost/api/alumni/student/${userId}`, { method: "POST", body: JSON.stringify(body) }), params(userId));

function context(overrides: Partial<EntryContext> = {}): EntryContext {
  return {
    kind: "new",
    ids: { enrollmentUserId: "86655", studentId: "86544", alumniId: "" },
    name: "Ampoli Ram Charan",
    afid: "2632401171",
    program: "JNV CoE",
    school: "JNV Adilabad",
    schoolCode: "59525",
    cohortYear: "2025-2026",
    profile: { student_g12_graduating_year: "2026" },
    alumni: {},
    codeNames: {},
    ...overrides,
  };
}

const okJson = (status: number, body: unknown) => ({ ok: true, status, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(authorizeAlumni).mockResolvedValue(ADMIN);
  vi.mocked(getEntryContext).mockResolvedValue(context());
  vi.mocked(canAccessSchool).mockResolvedValue(true);
  vi.mocked(lookupCodes).mockResolvedValue(new Map([["C-19609", { id: "40947", name: "Nalla Malla Reddy Engineering College" }]]));
  vi.mocked(query).mockResolvedValue([]); // no alumni row yet
  vi.mocked(getDbServiceConfig).mockReturnValue({
    baseUrl: "https://db.test/api",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
  });
  fetchMock.mockResolvedValue(okJson(201, { id: 8340 }));
});

describe("GET /api/alumni/student/[userId]", () => {
  it("passes the gate's denial through", async () => {
    vi.mocked(authorizeAlumni).mockResolvedValue(denied(401));
    expect((await GET(new Request("http://localhost"), params())).status).toBe(401);
  });

  it("403 when the student's school is out of scope", async () => {
    vi.mocked(canAccessSchool).mockResolvedValue(false);
    expect((await GET(new Request("http://localhost"), params())).status).toBe(403);
  });

  it("404 for someone who isn't a pass-out or alumnus", async () => {
    vi.mocked(getEntryContext).mockResolvedValue(null);
    expect((await GET(new Request("http://localhost"), params())).status).toBe(404);
  });

  it("returns the entry context", async () => {
    const res = await GET(new Request("http://localhost"), params());
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Ampoli Ram Charan");
  });
});

describe("POST /api/alumni/student/[userId]", () => {
  it("requires edit access", async () => {
    vi.mocked(authorizeAlumni).mockResolvedValue(denied(403));
    expect((await post({ values: { ug_status: "Studying" } })).status).toBe(403);
    expect(vi.mocked(authorizeAlumni)).toHaveBeenCalledWith({ requireEdit: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a new alumni row through the DB Service (POST), sending only filled fields", async () => {
    const res = await post({
      values: { ug_status: "Studying", college_id_ug: "C-19609", degree_ug: "BTech/BE", start_year_ug: "2026", pg_status: "" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alumniId: "8340", action: "inserted" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.test/api/alumni");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      student_id: 86544,
      ug_status: "Studying",
      college_id_ug: 40947,
      degree_ug: "BTech/BE",
      start_year_ug: 2026,
    });
  });

  it("updates an existing row (PATCH) with only the changed field", async () => {
    vi.mocked(getEntryContext).mockResolvedValue(
      context({ kind: "edit", alumni: { ug_status: "Studying", which_competitive_exam_did_you_appear_for: "Other" } }),
    );
    vi.mocked(query).mockResolvedValue([{ id: "8340" }]);
    fetchMock.mockResolvedValue(okJson(200, { id: 8340 }));
    const res = await post({ values: { ug_status: "Studying", which_competitive_exam_did_you_appear_for: "State CET" } });
    expect(await res.json()).toMatchObject({ action: "updated" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://db.test/api/alumni/8340");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ which_competitive_exam_did_you_appear_for: "State CET" });
  });

  it("never erases a saved value: blanking a field alone is refused", async () => {
    vi.mocked(getEntryContext).mockResolvedValue(context({ kind: "edit", alumni: { ug_status: "Studying" } }));
    const res = await post({ values: { ug_status: "" } });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks impossible answers without calling the DB Service", async () => {
    const res = await post({ values: { ug_status: "Studying", branch_id_ug: "CSIT057", degree_ug: "MBBS" } });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors).toHaveProperty("degree_ug");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks to confirm unusual answers, and saves once confirmed", async () => {
    const first = await post({ values: { ug_status: "Studying", start_year_ug: "2025" } });
    expect(first.status).toBe(409);
    expect((await first.json()).warnings[0].id).toBe("ug-before-g12");
    expect(fetchMock).not.toHaveBeenCalled();

    const second = await post({ values: { ug_status: "Studying", start_year_ug: "2025" }, confirmed: ["ug-before-g12"] });
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown college code", async () => {
    const res = await post({ values: { ug_status: "Studying", college_id_ug: "C-0" } });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a DB Service failure as 502", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await post({ values: { ug_status: "Studying" } })).status).toBe(502);
  });

  it("403 when the student's school is out of scope", async () => {
    vi.mocked(canAccessSchool).mockResolvedValue(false);
    expect((await post({ values: { ug_status: "Studying" } })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
