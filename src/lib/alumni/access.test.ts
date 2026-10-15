import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  // getFeatureAccess and canAccessSchoolSync stay real, so these tests exercise
  // the actual matrix row and scope rules.
  return { ...actual, getAlumniPermission: vi.fn() };
});

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { getAlumniPermission, type UserPermission } from "@/lib/permissions";
import { authorizeAlumni, reachesSchool } from "./access";

const session = (email = "someone@avantifellows.org") => ({ user: { email }, expires: "" });
const perm = (overrides: Partial<UserPermission>): UserPermission =>
  ({ email: "someone@avantifellows.org", level: 3, role: "admin", program_ids: [], read_only: false, ...overrides }) as UserPermission;

async function expectDenied(promise: ReturnType<typeof authorizeAlumni>, status: number) {
  const r = await promise;
  if (r.ok) throw new Error("expected denial");
  expect(r.response.status).toBe(status);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getServerSession).mockResolvedValue(session() as never);
  vi.mocked(getAlumniPermission).mockResolvedValue(perm({}));
});

describe("authorizeAlumni", () => {
  it("401 without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    await expectDenied(authorizeAlumni(), 401);
  });

  it("403 with no permission row", async () => {
    vi.mocked(getAlumniPermission).mockResolvedValue(null);
    await expectDenied(authorizeAlumni(), 403);
  });

  it.each(["teacher", "program_manager", "program_admin", "holistic_mentorship_admin", "pmu_manager", "pmu_govt_school_user"] as const)(
    "403 for %s (no alumni feature)",
    async (role) => {
      vi.mocked(getAlumniPermission).mockResolvedValue(perm({ role }));
      await expectDenied(authorizeAlumni(), 403);
    },
  );

  it("lets an admin in", async () => {
    expect((await authorizeAlumni({ schoolCode: "59525", requireEdit: true })).ok).toBe(true);
  });

  it("lets an alumni manager into a school in scope, and refuses others", async () => {
    vi.mocked(getAlumniPermission).mockResolvedValue(perm({ role: "alumni_manager", level: 1, school_codes: ["59525"] }));
    expect((await authorizeAlumni({ schoolCode: "59525", requireEdit: true })).ok).toBe(true);
    await expectDenied(authorizeAlumni({ schoolCode: "11111" }), 403);
  });

  it("lets a read-only user view but not save", async () => {
    vi.mocked(getAlumniPermission).mockResolvedValue(perm({ read_only: true }));
    expect((await authorizeAlumni()).ok).toBe(true);
    await expectDenied(authorizeAlumni({ requireEdit: true }), 403);
  });
});

describe("reachesSchool", () => {
  it("checks school codes at level 1 without a lookup", async () => {
    const p = perm({ role: "alumni_manager", level: 1, school_codes: ["59525"] });
    expect(await reachesSchool(p, "59525")).toBe(true);
    expect(await reachesSchool(p, "11111")).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("looks up the school's region at level 2", async () => {
    const p = perm({ role: "alumni_manager", level: 2, regions: ["Pune"] });
    vi.mocked(query).mockResolvedValueOnce([{ region: "Pune" }]).mockResolvedValueOnce([]);
    expect(await reachesSchool(p, "59525")).toBe(true);
    expect(await reachesSchool(p, "00000")).toBe(false);
  });
});
