import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alumni/access", () => ({ authorizeAlumni: vi.fn() }));
vi.mock("@/lib/alumni/table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alumni/table")>();
  return { ...actual, loadAlumniTable: vi.fn() };
});

import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { loadAlumniTable, type AlumniTableRow } from "@/lib/alumni/table";
import type { UserPermission } from "@/lib/permissions";
import { GET as exportTable } from "./export/route";
import { GET } from "./route";

const PERM = { email: "a@x", level: 3, role: "admin" } as UserPermission;
const get = (qs = "") => GET(new Request(`http://localhost/api/alumni/table?${qs}`));

const row = (id: string, overrides: Partial<AlumniTableRow> = {}): AlumniTableRow => ({
  kind: "alumnus",
  id,
  name: `Alumnus ${id}`,
  afid: `0${id}`,
  phone: "09876",
  whatsapp: "",
  cohortYear: "2025-2026",
  program: "JNV CoE",
  schoolCode: "59525",
  schoolName: "JNV Adilabad",
  values: { contact_status: "", current_status: "", ug_status: "Studying", college_id_ug: "", branch_id_ug: "", degree_ug: "", employment_status: "" },
  filledPct: 50,
  missing: ["college_id_ug"],
  updatedAt: "2026-11-23",
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorizeAlumni).mockResolvedValue({ ok: true, email: "a@x", permission: PERM });
  vi.mocked(loadAlumniTable).mockResolvedValue([
    row("1"),
    row("2", { kind: "pass-out", schoolCode: "49060", schoolName: "JNV Bangalore Urban", missing: [] }),
  ]);
});

describe("GET /api/alumni/table", () => {
  it("checks the school when one is asked for", async () => {
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    expect((await get("school=59525")).status).toBe(403);
    expect(authorizeAlumni).toHaveBeenCalledWith({ schoolCode: "59525" });
  });

  it("returns a page with the summary, years and schools", async () => {
    const body = await (await get("college_id_ug=missing")).json();
    expect(body.rows.map((r: AlumniTableRow) => r.id)).toEqual(["1"]);
    expect(body).toMatchObject({ total: 1, page: 1, pageCount: 1, years: ["2025-2026"] });
    expect(body.summary).toMatchObject({ total: 2, notAdded: 1 });
    // By name.
    expect(body.schools).toEqual([{ code: "59525", name: "JNV Adilabad" }, { code: "49060", name: "JNV Bangalore Urban" }]);
    expect(loadAlumniTable).toHaveBeenCalledWith(PERM, undefined);
  });

  it("pages by 100 and keeps the page in range", async () => {
    vi.mocked(loadAlumniTable).mockResolvedValue(Array.from({ length: 150 }, (_, i) => row(String(i + 1))));
    const body = await (await get("page=9")).json();
    expect(body).toMatchObject({ page: 2, pageCount: 2, total: 150 });
    expect(body.rows).toHaveLength(50);
  });

  it("refs=1 returns everyone matching, not a page", async () => {
    expect(await (await get("refs=1&record=added")).json()).toEqual({ refs: [{ kind: "alumnus", id: "1", name: "Alumnus 1" }] });
  });

  it("500s when the table can't load", async () => {
    vi.mocked(loadAlumniTable).mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get()).status).toBe(500);
  });
});

describe("GET /api/alumni/table/export", () => {
  const download = (qs = "") => exportTable(new Request(`http://localhost/api/alumni/table/export?${qs}`));

  it("is an Excel file of every matching row, ids and phones as text", async () => {
    const res = await download("school=59525&record=added");
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="alumni-59525-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await res.arrayBuffer());
    const sheet = workbook.getWorksheet("Alumni")!;
    expect(sheet.rowCount).toBe(2); // header + 1 matching row
    expect(sheet.getRow(2).getCell(2).value).toBe("01");
    expect(sheet.getRow(2).getCell(3).value).toBe("09876");
    expect(sheet.getColumn(2).numFmt).toBe("@");
  });

  it("names the all-schools file, and passes on a refusal or failure", async () => {
    expect((await download()).headers.get("Content-Disposition")).toContain("alumni-all-schools-");
    vi.mocked(loadAlumniTable).mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await download()).status).toBe(500);
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) });
    expect((await download()).status).toBe(401);
  });
});
