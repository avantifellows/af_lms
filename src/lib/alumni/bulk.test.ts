import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/permissions", () => ({ canAccessAlumni: vi.fn() }));
vi.mock("./entry", () => ({ getAlumnusContext: vi.fn(), loadAlumniRecords: vi.fn() }));
vi.mock("./pass-out", () => ({ loadPassOut: vi.fn() }));
vi.mock("./save", () => ({
  prepareSave: vi.fn(),
  saveAlumni: vi.fn(),
  fieldLabels: (columns: string[]) => columns.map((c) => `L:${c}`),
}));
vi.mock("./table", () => ({ loadAlumniTable: vi.fn() }));

import { canAccessAlumni, type UserPermission } from "@/lib/permissions";
import type { BulkRequest } from "./bulk-types";
import { loadCommonAnswers, runBulk, studentValues } from "./bulk";
import { getAlumnusContext, loadAlumniRecords, type EntryContext } from "./entry";
import { loadPassOut } from "./pass-out";
import { prepareSave, saveAlumni } from "./save";
import { loadAlumniTable } from "./table";

const PERM = { email: "a@x", level: 3, role: "alumni_manager", read_only: false } as UserPermission;
const ctx = (kind: "new" | "edit", alumni: Record<string, string> = {}) =>
  ({ kind, name: kind === "new" ? "New One" : "Old One", alumni, version: "v1", ids: { alumniId: "8340" } }) as unknown as EntryContext;
const request = (overrides: Partial<BulkRequest> = {}): BulkRequest => ({
  targets: [{ kind: "alumnus", id: "8340" }],
  values: { ug_status: "Studying" },
  confirmed: [],
  overwrite: false,
  replace: [],
  dryRun: true,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(canAccessAlumni).mockResolvedValue(true);
  vi.mocked(getAlumnusContext).mockResolvedValue(ctx("edit"));
  vi.mocked(prepareSave).mockResolvedValue({ ok: true, values: {}, changed: ["ug_status"], notCleared: [], codes: {} as never });
});

describe("studentValues", () => {
  it("fills blanks; keeps a different saved answer unless overwrite or replace", () => {
    const answers = { ug_status: "Studying", degree_ug: "BSc", junk: "x", pg_status: " " };
    const saved = { ug_status: "Graduated", degree_ug: "BSc" };
    expect(studentValues(answers, saved, false)).toEqual({ values: { degree_ug: "BSc" }, kept: ["ug_status"] });
    expect(studentValues(answers, saved, true)).toEqual({ values: { ug_status: "Studying", degree_ug: "BSc" }, kept: [] });
    expect(studentValues(answers, saved, false, ["ug_status"])).toEqual({ values: { ug_status: "Studying", degree_ug: "BSc" }, kept: [] });
  });
});

describe("runBulk", () => {
  it("checks an alumnus without saving (dry run)", async () => {
    const [r] = await runBulk(request(), "a@x", PERM);
    expect(r).toMatchObject({ name: "Old One", result: "update", changed: ["L:ug_status"] });
    expect(saveAlumni).not.toHaveBeenCalled();
    expect(canAccessAlumni).toHaveBeenCalledWith({ user: { email: "a@x" } }, "8340", { requireEdit: true });
  });

  it("a pass-out would be created; one added since becomes an update of that record", async () => {
    vi.mocked(loadPassOut)
      .mockResolvedValueOnce({ ok: true, context: ctx("new") })
      .mockResolvedValueOnce({ ok: false, status: 409, error: "added", alumniId: "8340" } as never);
    const results = await runBulk(request({ targets: [{ kind: "pass-out", id: "1" }, { kind: "pass-out", id: "2" }] }), "a@x", PERM);
    expect(results.map((r) => r.result)).toEqual(["create", "update"]);
  });

  it("saves as a bulk upload by the person", async () => {
    vi.mocked(saveAlumni).mockResolvedValue({ ok: true, alumniId: "8340", action: "updated", changed: ["UG status"], notCleared: [], version: "v2" });
    const [r] = await runBulk(request({ dryRun: false }), "a@x", PERM);
    expect(r).toMatchObject({ result: "update", changed: ["UG status"], alumniId: "8340" });
    expect(saveAlumni).toHaveBeenCalledWith(expect.anything(), { ug_status: "Studying" }, [], "v1", {
      source: "bulk_upload",
      actorEmail: "a@x",
      actorRole: "alumni_manager",
    });
  });

  it("reports nothing to change, a confirm, a field error, no access, and goes on after a crash", async () => {
    vi.mocked(prepareSave)
      .mockResolvedValueOnce({ ok: false, status: 400, error: "Nothing changed.", nothing: true })
      .mockResolvedValueOnce({ ok: false, status: 409, error: "Unusual.", warnings: [{ id: "w" }] as never })
      .mockResolvedValueOnce({ ok: false, status: 400, error: "Fix.", fieldErrors: { ug_status: "Bad" } });
    vi.mocked(canAccessAlumni).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(getAlumnusContext).mockResolvedValueOnce(ctx("edit")).mockResolvedValueOnce(ctx("edit")).mockResolvedValueOnce(ctx("edit")).mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = ["1", "2", "3", "4", "x", "5"];
    const results = await runBulk(request({ targets: ids.map((id) => ({ kind: "alumnus", id })) }), "a@x", PERM);
    expect(results.map((r) => r.result)).toEqual(["unchanged", "confirm", "error", "denied", "error", "error"]);
    expect(results[2].message).toBe("L:ug_status: Bad");
    expect(results[4].message).toBe("Invalid student.");
  });

  it("an alumnus gone since the table loaded", async () => {
    vi.mocked(getAlumnusContext).mockResolvedValue(null);
    expect((await runBulk(request(), "a@x", PERM))[0]).toMatchObject({ result: "error", message: "No such alumnus." });
  });
});

describe("loadCommonAnswers", () => {
  it("looks only at students in the person's scope", async () => {
    vi.mocked(loadAlumniTable).mockResolvedValue([{ kind: "alumnus", id: "1" }, { kind: "pass-out", id: "9" }] as never);
    vi.mocked(loadAlumniRecords).mockResolvedValue(
      new Map([["1", { alumni: { ug_status: "Studying", college_id_ug: "C-1" }, codeNames: { college_id_ug: "IIT" } }]]),
    );
    const common = await loadCommonAnswers(
      [{ kind: "alumnus", id: "1" }, { kind: "pass-out", id: "9" }, { kind: "alumnus", id: "77" }],
      PERM,
    );
    expect(loadAlumniRecords).toHaveBeenCalledWith(["1"]);
    expect(common).toMatchObject({ total: 2, mixed: { ug_status: 1, college_id_ug: 1 } });
    expect(common.gates).toEqual([{ ug_status: "Studying" }, {}]);
  });
});
