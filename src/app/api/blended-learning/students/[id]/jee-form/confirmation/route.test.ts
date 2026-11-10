import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { GET } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  "bl-mentor@example.org": { role: "blended_mentor", read_only: false, user_id: 9001 },
  "bl-viewer@example.org": { role: "blended_admin", read_only: true, user_id: 12 },
  "teacher@example.org": { role: "teacher", read_only: false, user_id: 40 },
};
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002 };
const KEY = "lms-documents/students/501/jee_main_confirmation/0f0e/page-1.pdf";
let pages: unknown[] | null;
let sql: string[];

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function open(id: string) {
  return GET(new Request(`http://localhost/api/blended-learning/students/${id}/jee-form/confirmation`), routeParams({ id }));
}

beforeEach(() => {
  vi.clearAllMocks();
  pages = [{ s3_key: KEY, page_number: 1, mime_type: "application/pdf", byte_size: 5 }];
  sql = [];
  mockQuery.mockImplementation((async (text: string, params?: unknown[]) => {
    sql.push(text);
    if (text.includes("FROM user_permission")) {
      const email = String(params?.[0]).toLowerCase();
      const row = PERMISSIONS[email];
      return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
    }
    if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
      const mentor = MAPPINGS[Number(params?.[0])];
      return mentor ? [{ mentor_user_id: mentor }] : [];
    }
    if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
    if (text.includes("JOIN lms_student_documents doc")) return pages ? [{ pages }] : [];
    return [];
  }) as typeof query);
  vi.stubEnv("S3_DOCS_BUCKET", "test-bucket");
  vi.stubEnv("S3_DOCS_PREFIX", "lms-documents");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/blended-learning/students/[id]/jee-form/confirmation", () => {
  it("redirects the Mentor, or a read-only admin, to a 5-minute presigned GET of the current confirmation", async () => {
    for (const email of ["bl-mentor@example.org", "bl-viewer@example.org"]) {
      signedInAs(email);
      const res = await open("501");
      expect(res.status).toBe(302);
      const url = new URL(res.headers.get("location")!);
      expect(url.pathname).toBe(`/${KEY}`);
      expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
      expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    }
    const [documentSql] = sql.filter((text) => text.includes("lms_student_documents"));
    expect(documentSql).toContain("doc.deleted_at IS NULL");
    expect(documentSql).toContain("doc.student_id = $1");
  });

  it("answers 404 without a confirmation, out of scope or for another role's 403", async () => {
    signedInAs("bl-mentor@example.org");
    expect((await open("601")).status).toBe(404);
    pages = null;
    expect((await open("501")).status).toBe(404);
    signedInAs("teacher@example.org");
    expect((await open("501")).status).toBe(403);
    signedInAs(null);
    expect((await open("501")).status).toBe(401);
  });
});
