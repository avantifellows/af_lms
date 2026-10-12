import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  // getFeatureAccess stays real, so these tests exercise the actual matrix row.
  return { ...actual, getResolvedPermission: vi.fn(), canAccessSchool: vi.fn() };
});

import { getServerSession } from "next-auth";
import { canAccessSchool, getResolvedPermission, type UserPermission } from "@/lib/permissions";
import { authorizeAlumni } from "./access";

const session = (email = "someone@avantifellows.org") => ({ user: { email }, expires: "" });
const perm = (overrides: Partial<UserPermission>): UserPermission =>
  ({ email: "someone@avantifellows.org", level: 3, role: "admin", program_ids: [], read_only: false, ...overrides }) as UserPermission;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getServerSession).mockResolvedValue(session() as never);
  vi.mocked(getResolvedPermission).mockResolvedValue(perm({}));
  vi.mocked(canAccessSchool).mockResolvedValue(true);
});

describe("authorizeAlumni", () => {
  it("401 without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const r = await authorizeAlumni();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("403 with no permission row", async () => {
    vi.mocked(getResolvedPermission).mockResolvedValue(null);
    const r = await authorizeAlumni();
    if (!r.ok) expect(r.response.status).toBe(403);
    else throw new Error("expected denial");
  });

  it.each(["teacher", "program_manager", "program_admin", "holistic_mentorship_admin", "pmu_manager", "pmu_govt_school_user"] as const)(
    "403 for %s (alumni is admin-only)",
    async (role) => {
      vi.mocked(getResolvedPermission).mockResolvedValue(perm({ role }));
      const r = await authorizeAlumni();
      if (!r.ok) expect(r.response.status).toBe(403);
      else throw new Error("expected denial");
    },
  );

  it("lets an admin in", async () => {
    expect((await authorizeAlumni({ schoolCode: "59525", requireEdit: true })).ok).toBe(true);
  });

  it("lets a read-only admin view but not save", async () => {
    vi.mocked(getResolvedPermission).mockResolvedValue(perm({ read_only: true }));
    expect((await authorizeAlumni()).ok).toBe(true);
    const r = await authorizeAlumni({ requireEdit: true });
    if (!r.ok) expect(r.response.status).toBe(403);
    else throw new Error("expected denial");
  });

  it("403 when the school is out of scope", async () => {
    vi.mocked(canAccessSchool).mockResolvedValue(false);
    const r = await authorizeAlumni({ schoolCode: "59525" });
    if (!r.ok) expect(r.response.status).toBe(403);
    else throw new Error("expected denial");
  });
});
