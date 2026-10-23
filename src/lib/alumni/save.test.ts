import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/db-service-config", () => ({ getDbServiceConfig: vi.fn() }));
vi.mock("./reference", () => ({ lookupCodes: vi.fn() }));

import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import type { EntryContext } from "./entry";
import { lookupCodes } from "./reference";
import { saveAlumni } from "./save";

const mockQuery = vi.mocked(query);
const mockFetch = vi.fn();

const NEW: EntryContext = {
  kind: "new",
  ids: { enrollmentUserId: "86655", studentId: "86544", alumniId: "" },
  name: "Ampoli Ram",
  afid: "2632401171",
  program: "JNV CoE",
  school: "JNV Adilabad",
  schoolCode: "59525",
  cohortYear: "2025-2026",
  profile: { student_g12_graduating_year: "2026" },
  alumni: {},
  codeNames: {},
  version: "",
};
const EDIT: EntryContext = {
  ...NEW,
  kind: "edit",
  ids: { ...NEW.ids, alumniId: "8340" },
  alumni: { current_status: "Studying", ug_status: "Studying", degree_ug: "BTech/BE", start_year_ug: "2026" },
  version: "2026-10-01 10:00:00.123+00",
};

/** Codes on record: one college and one branch, with ids that overlap (as in the real tables). */
function knownCodes() {
  vi.mocked(lookupCodes).mockResolvedValue({
    college: new Map([["C-19609", { id: "40947", name: "Nalla Malla Reddy Engineering College" }]]),
    branch: new Map([["CSIT013", { id: "13", name: "Computer Science" }]]),
  });
}

function dbServiceAnswers(status: number, body: unknown = { id: 8340 }) {
  mockFetch.mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

const sent = () => {
  const [url, init] = mockFetch.mock.calls[0];
  return { url, method: init.method, body: JSON.parse(init.body) };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getDbServiceConfig).mockReturnValue({
    baseUrl: "https://db.test/api",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
  });
  knownCodes();
  mockQuery.mockResolvedValue([]); // no alumni row yet
  dbServiceAnswers(200);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveAlumni", () => {
  it("POSTs a new alumni row with ids and numbers converted", async () => {
    const result = await saveAlumni(NEW, {
      current_status: "Studying", ug_status: "Studying", college_id_ug: "C-19609", branch_id_ug: "CSIT013",
      degree_ug: "BTech/BE", start_year_ug: "2026",
    });
    expect(result).toMatchObject({ ok: true, action: "inserted", alumniId: "8340" });
    expect(sent()).toEqual({
      url: "https://db.test/api/alumni",
      method: "POST",
      body: {
        student_id: 86544, current_status: "Studying", ug_status: "Studying",
        college_id_ug: 40947, branch_id_ug: 13, degree_ug: "BTech/BE", start_year_ug: 2026,
      },
    });
  });

  it("PATCHes only the changed fields of an existing row", async () => {
    mockQuery.mockResolvedValue([{ id: "8340" }]);
    const result = await saveAlumni(EDIT, { ...EDIT.alumni, current_status: "Seeking Work", skilling_programs: "NPTEL" }, [], EDIT.version);
    expect(result).toMatchObject({ ok: true, action: "updated" });
    expect(sent()).toMatchObject({
      url: "https://db.test/api/alumni/8340",
      method: "PATCH",
      body: { current_status: "Seeking Work", skilling_programs: "NPTEL" },
    });
    expect(sent().body).not.toHaveProperty("degree_ug");
  });

  it("refuses an edit made on an older version of the record (409), without writing", async () => {
    const result = await saveAlumni(EDIT, { ...EDIT.alumni, current_status: "Employed" }, [], "2026-09-01 08:00:00+00");
    expect(result).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/Someone else saved/) });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses an edit that sends no version", async () => {
    expect(await saveAlumni(EDIT, { ...EDIT.alumni, current_status: "Employed" })).toMatchObject({ status: 409 });
  });

  it("rejects a branch code saved as the college", async () => {
    const result = await saveAlumni(NEW, { current_status: "Studying", ug_status: "Studying", college_id_ug: "CSIT013" });
    expect(result).toMatchObject({ ok: false, status: 400, fieldErrors: { college_id_ug: expect.stringMatching(/Unknown code/) } });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks clearing the start year to save a 1-year course", async () => {
    const result = await saveAlumni(EDIT, { ...EDIT.alumni, ug_status: "Graduated", start_year_ug: "", year_of_graduation_ug: "2026" }, [], EDIT.version);
    expect(result).toMatchObject({ ok: false, status: 400, fieldErrors: { year_of_graduation_ug: expect.any(String) } });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("doesn't send values that no longer apply", async () => {
    await saveAlumni(NEW, { current_status: "Seeking Work", employment_status: "Not Employed - Seeking Work", current_org_name: "Infosys" });
    expect(sent().body).not.toHaveProperty("current_org_name");
  });

  it("asks to confirm unusual answers, then saves once they're confirmed", async () => {
    const values = { current_status: "Studying", ug_status: "Studying", which_competitive_exam_did_you_appear_for: "NEET", degree_ug: "BTech/BE" };
    const asked = await saveAlumni(NEW, values);
    expect(asked).toMatchObject({ ok: false, status: 409, warnings: [expect.objectContaining({ id: "exam-vs-degree" })] });
    expect(await saveAlumni(NEW, values, ["exam-vs-degree"])).toMatchObject({ ok: true });
  });

  it("says when nothing changed", async () => {
    expect(await saveAlumni(EDIT, EDIT.alumni, [], EDIT.version)).toMatchObject({ ok: false, status: 400, error: "Nothing changed from the alumni record." });
  });

  it("refuses to add someone another person added since the form opened (409, nothing written)", async () => {
    mockQuery.mockResolvedValue([{ id: "9001" }]); // their row exists now
    const result = await saveAlumni(NEW, { current_status: "Studying", ug_status: "Studying", degree_ug: "MBBS" });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns the record's new version, so the next save isn't taken for a clash", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      (sql.includes("updated_at::text") ? [{ version: "2026-10-22 09:00:00" }] : [{ id: "8340" }]) as never);
    const result = await saveAlumni(EDIT, { ...EDIT.alumni, current_status: "Seeking Work" }, [], EDIT.version);
    expect(result).toMatchObject({ ok: true, version: "2026-10-22 09:00:00" });
  });

  it("reports a DB Service error as 502", async () => {
    dbServiceAnswers(500, { error: "boom" });
    expect(await saveAlumni(NEW, { current_status: "Studying" })).toMatchObject({ ok: false, status: 502 });
  });

  it("reports a missing DB Service as 503", async () => {
    vi.mocked(getDbServiceConfig).mockReturnValue(null);
    expect(await saveAlumni(NEW, { current_status: "Studying" })).toMatchObject({ ok: false, status: 503 });
  });
});
