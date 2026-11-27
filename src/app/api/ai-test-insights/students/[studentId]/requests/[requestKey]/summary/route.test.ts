import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mockClient } from "aws-sdk-client-mock";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// The AI Summary text route (#564) through the real Student access helper,
// the real permission matrix, the real Insight Request module and the real
// artifact reader. The session and the Postgres boundary are stubbed:
// Postgres answers the permission row, centre seats, the listed-Student rows
// of one Student, the stored requests and the Item File rows declared here.
// The artifact store is the S3 client, mocked with aws-sdk-client-mock, and
// `vi.stubEnv` gives the reader's settings. `fetch` is stubbed only to prove
// that reading a finished AI Summary never wakes or enqueues the generator.
const { mockQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: mockQuery,
  withTransaction: () => {
    throw new Error("the summary route opens no transaction");
  },
}));

import { GET } from "./route";

const s3 = mockClient(S3Client);
const email = "staff@avantifellows.org";

// Student 1001 is listed by centre 301 (School 9, JNV001, Program 1). 2001 is
// listed by centre 401 of another School, JNV002.
const LISTED: Record<string, Array<Record<string, unknown>>> = {
  "1001": [
    {
      student_id: "1001", user_id: "5001", centre_id: "301", program_id: "1", grade: 11,
      school_id: "9", school_code: "JNV001", school_udise: "29000000001", school_region: "South",
    },
  ],
  "2001": [
    {
      student_id: "2001", user_id: "6001", centre_id: "401", program_id: "1", grade: 12,
      school_id: "10", school_code: "JNV002", school_udise: "29000000002", school_region: "South",
    },
  ],
};

const ROLES = [
  "teacher",
  "program_manager",
  "program_admin",
  "holistic_mentorship_admin",
  "admin",
  "pmu_manager",
  "pmu_govt_school_user",
  "blended_mentor",
  "blended_admin",
  "alumni_manager",
] as const;
const VIEW_ONLY_ROLES = ["program_manager", "program_admin", "admin"] as const;
const NO_FEATURE_ROLES = ROLES.filter(
  (role) => role !== "teacher" && !(VIEW_ONLY_ROLES as readonly string[]).includes(role),
);

const KEY = "4b0f5c1e-1111-4222-8333-944455556666";
const OTHER_STUDENT_KEY = "9c0f5c1e-2222-4222-8333-944455557777";
const ITEM = 41;

// The settings of a configured reader, written by hand.
const BUCKET = "af-ai-mentorship-artifacts";
const REPORT_KEY = "acad-mentorship/staging/items/41/output/final-report.md";
const PDF_KEY = "acad-mentorship/staging/items/41/output/report.pdf";
const MARKDOWN = "# Test Insight\n\nAsha did well in **Physics**.\n\n| Subject | Score |\n| --- | --- |\n| Physics | 62 |\n";

/** A stored request: its view columns, plus its Student and linked Item. */
type Stored = Record<string, unknown> & { student_id: number; inference_item_id: number | null };
const STORE_ONLY = new Set(["student_id", "inference_item_id"]);

const stored = (overrides: Partial<Stored> = {}): Stored => ({
  request_key: KEY,
  state: "completed",
  outcome_code: null,
  selected_test_ids: ["T9", "T4"],
  requested_at: "2026-11-27T05:30:00Z",
  requested_by_name: "Asha Teacher",
  finished_at: "2026-11-27T05:34:10Z",
  student_id: 1001,
  inference_item_id: ITEM,
  ...overrides,
});

type FileRow = { item_id: number; file_kind: string; s3_key: string };

let permissionRow: Record<string, unknown> | null;
let requests: Map<string, Stored>;
let files: FileRow[];
const mockFetch = vi.fn();

function configureReader(overrides: Record<string, string> = {}) {
  const settings: Record<string, string> = {
    AI_TEST_INSIGHTS_S3_BUCKET: BUCKET,
    AI_TEST_INSIGHTS_S3_REGION: "ap-south-1",
    AI_TEST_INSIGHTS_S3_PREFIX: "acad-mentorship",
    AI_TEST_INSIGHTS_S3_ACCESS_KEY_ID: "AKIA-READ-ONLY-E2E",
    AI_TEST_INSIGHTS_S3_SECRET_ACCESS_KEY: "read-only-secret-e2e",
    AI_TEST_INSIGHTS_S3_ENDPOINT: "",
    APP_ENV: "staging",
    ...overrides,
  };
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
}

/** The store answers `text` for the report key, with its length in bytes. */
function storeHolds(text: string | Uint8Array) {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  s3.on(GetObjectCommand).resolves({
    ContentLength: bytes.byteLength,
    // @ts-expect-error a minimal stand-in for the SDK's stream body
    Body: { transformToByteArray: async () => bytes },
  });
}

function row(role: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    level: role === "admin" ? 3 : 1,
    role,
    school_codes: role === "admin" ? null : ["JNV001"],
    regions: null,
    program_ids: role.startsWith("pmu") ? [64] : [1, 2],
    read_only: false,
    user_id: 777,
    ...overrides,
  };
}

/** Everything any console method was called with, as one string. */
function logged(): string {
  return (["error", "warn", "info", "log"] as const)
    .flatMap((method) => vi.mocked(console[method]).mock.calls.flat())
    .map((value) => (value instanceof Error ? `${value.name} ${value.message}` : String(value)))
    .join(" ");
}

beforeEach(() => {
  vi.resetAllMocks();
  s3.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", mockFetch);
  configureReader();
  storeHolds(MARKDOWN);
  permissionRow = row("teacher");
  requests = new Map([
    [KEY, stored()],
    [OTHER_STUDENT_KEY, stored({ request_key: OTHER_STUDENT_KEY, student_id: 2001, inference_item_id: 42 })],
  ]);
  files = [
    { item_id: ITEM, file_kind: "report", s3_key: REPORT_KEY },
    { item_id: ITEM, file_kind: "report_pdf", s3_key: PDF_KEY },
    { item_id: 42, file_kind: "report", s3_key: "acad-mentorship/staging/items/42/output/final-report.md" },
  ];
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM centre_positions")) return [];
    if (sql.includes("centre_students")) return LISTED[String(params[0])] ?? [];
    if (sql.includes("acad_mentorship_inference_item_files")) {
      // The request's Item's file of one kind, for a completed request of that Student.
      const [studentId, requestKey, fileKind] = params;
      const request = requests.get(String(requestKey));
      if (!request || request.student_id !== Number(studentId) || request.state !== "completed") return [];
      return files
        .filter((file) => file.item_id === request.inference_item_id && file.file_kind === fileKind)
        .map((file) => ({ item_id: String(file.item_id), s3_key: file.s3_key }));
    }
    if (sql.includes("ai_test_insight_requests") && sql.includes("r.request_key = $2")) {
      const found = requests.get(String(params[1]));
      if (!found || found.student_id !== Number(params[0])) return [];
      return [Object.fromEntries(Object.entries(found).filter(([column]) => !STORE_ONLY.has(column)))];
    }
    return [];
  });
});

async function get(studentId: string, requestKey: string) {
  return GET(
    new NextRequest(`http://localhost/api/ai-test-insights/students/${studentId}/requests/${requestKey}/summary`),
    { params: Promise.resolve({ studentId, requestKey }) },
  );
}

const reads = () => s3.commandCalls(GetObjectCommand).map((call) => call.args[0].input);

describe("GET /api/ai-test-insights/students/[studentId]/requests/[requestKey]/summary", () => {
  it("answers the Test Insight text of a completed request, read from the report file of its Item", async () => {
    const response = await get("1001", KEY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ markdown: MARKDOWN });
    expect(reads()).toEqual([{ Bucket: BUCKET, Key: REPORT_KEY }]);
  });

  it("is never stored by a browser or a proxy", async () => {
    expect((await get("1001", KEY)).headers.get("Cache-Control")).toBe("no-store");
  });

  it("never wakes or enqueues the generator, and writes nothing", async () => {
    await get("1001", KEY);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.filter(([sql]) => /\b(UPDATE|INSERT INTO|DELETE FROM)\b/.test(sql))).toHaveLength(0);
  });

  it("logs neither the text nor the S3 key when it answers", async () => {
    await get("1001", KEY);

    expect(logged()).not.toContain("Physics");
    expect(logged()).not.toContain("acad-mentorship/");
  });

  describe("404", () => {
    it.each(["queued", "running", "no_data", "failed"])("answers 404 for a %s request, and reads nothing", async (state) => {
      Object.assign(requests.get(KEY)!, {
        state,
        inference_item_id: null,
        finished_at: state === "queued" || state === "running" ? null : "2026-11-27T05:34:10Z",
      });

      expect((await get("1001", KEY)).status).toBe(404);
      expect(reads()).toHaveLength(0);
    });

    it("answers 404 for a completed request whose Item has no report file, even with a PDF", async () => {
      files = files.filter((file) => file.file_kind !== "report");

      expect((await get("1001", KEY)).status).toBe(404);
      expect(reads()).toHaveLength(0);
    });

    it("answers 404 for a request key of another Student, and for an unknown key", async () => {
      expect((await get("1001", OTHER_STUDENT_KEY)).status).toBe(404);
      expect((await get("1001", "no-such-key")).status).toBe(404);
      expect(reads()).toHaveLength(0);
    });
  });

  describe("503 when reading is not configured", () => {
    it.each([
      "AI_TEST_INSIGHTS_S3_BUCKET",
      "AI_TEST_INSIGHTS_S3_ACCESS_KEY_ID",
      "AI_TEST_INSIGHTS_S3_SECRET_ACCESS_KEY",
      "APP_ENV",
    ])("answers 503 when %s is blank after trimming, and reads nothing", async (name) => {
      configureReader({ [name]: "   " });

      const response = await get("1001", KEY);

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "not_configured" });
      expect(reads()).toHaveLength(0);
    });

    it("answers 503 when APP_ENV is neither staging nor production", async () => {
      configureReader({ APP_ENV: "development" });

      expect((await get("1001", KEY)).status).toBe(503);
      expect(reads()).toHaveLength(0);
    });
  });

  describe("settings", () => {
    it("uses the default region and prefix when theirs are blank, and virtual-host addressing with no endpoint", async () => {
      configureReader({ AI_TEST_INSIGHTS_S3_REGION: " ", AI_TEST_INSIGHTS_S3_PREFIX: " " });

      const response = await get("1001", KEY);

      expect(response.status).toBe(200);
      const client = s3.commandCalls(GetObjectCommand)[0].thisValue as S3Client;
      expect(await client.config.region()).toBe("ap-south-1");
      expect(client.config.forcePathStyle).toBe(false);
      expect(await client.config.credentials()).toMatchObject({
        accessKeyId: "AKIA-READ-ONLY-E2E",
        secretAccessKey: "read-only-secret-e2e",
      });
    });

    it("checks the key against its own prefix setting", async () => {
      configureReader({ AI_TEST_INSIGHTS_S3_PREFIX: "other-prefix" });

      expect((await get("1001", KEY)).status).toBe(502);
      expect(reads()).toHaveLength(0);
    });

    it("reads through the endpoint override with path-style addressing", async () => {
      configureReader({ AI_TEST_INSIGHTS_S3_ENDPOINT: "http://127.0.0.1:3051", AI_TEST_INSIGHTS_S3_REGION: "us-east-1" });

      expect((await get("1001", KEY)).status).toBe(200);
      const client = s3.commandCalls(GetObjectCommand)[0].thisValue as S3Client;
      expect(client.config.forcePathStyle).toBe(true);
      expect(await client.config.region()).toBe("us-east-1");
      const endpoint = await client.config.endpoint!();
      expect(`${endpoint.protocol}//${endpoint.hostname}:${endpoint.port}`).toBe("http://127.0.0.1:3051");
    });
  });

  describe("502", () => {
    it.each([
      ["another environment", "acad-mentorship/production/items/41/output/final-report.md"],
      ["another Item's folder", "acad-mentorship/staging/items/42/output/final-report.md"],
      ["a folder whose id only starts with the Item's", "acad-mentorship/staging/items/410/output/final-report.md"],
      ["a dot-dot segment", "acad-mentorship/staging/items/41/../../../production/items/41/output/final-report.md"],
      ["another prefix", "other/staging/items/41/output/final-report.md"],
    ])("answers 502 for a key in %s, without reading it", async (_label, key) => {
      files = [{ item_id: ITEM, file_kind: "report", s3_key: key }];

      const response = await get("1001", KEY);

      expect(response.status).toBe(502);
      expect(reads()).toHaveLength(0);
      expect(logged()).not.toContain(key);
    });

    it("answers 502 for text larger than 1 MB", async () => {
      storeHolds(new Uint8Array(1024 * 1024 + 1).fill(97));

      expect((await get("1001", KEY)).status).toBe(502);
    });

    it("answers text of exactly 1 MB", async () => {
      storeHolds(new Uint8Array(1024 * 1024).fill(97));

      const response = await get("1001", KEY);

      expect(response.status).toBe(200);
      expect((await response.json()).markdown).toHaveLength(1024 * 1024);
    });

    it("answers 502 when the store says the text is larger than 1 MB, before reading it", async () => {
      const transformToByteArray = vi.fn();
      // @ts-expect-error a minimal stand-in for the SDK's stream body
      s3.on(GetObjectCommand).resolves({ ContentLength: 5 * 1024 * 1024, Body: { transformToByteArray } });

      expect((await get("1001", KEY)).status).toBe(502);
      expect(transformToByteArray).not.toHaveBeenCalled();
    });

    it("answers 502 when the store read fails, logging only the request key, the Student and the error name", async () => {
      s3.on(GetObjectCommand).rejects(
        Object.assign(new Error(`Access Denied for ${REPORT_KEY}`), { name: "AccessDenied" }),
      );

      const response = await get("1001", KEY);

      expect(response.status).toBe(502);
      expect(logged()).toContain("AccessDenied");
      expect(logged()).toContain(KEY);
      expect(logged()).toContain("1001");
      expect(logged()).not.toContain("acad-mentorship/");
    });

    it("answers 502 when the store answers no body", async () => {
      s3.on(GetObjectCommand).resolves({});

      expect((await get("1001", KEY)).status).toBe(502);
    });
  });

  describe("refusal order", () => {
    it("answers 401 without a session, before checking the id", async () => {
      mockGetServerSession.mockResolvedValue(null);

      expect((await get("1001", KEY)).status).toBe(401);
      expect((await get("abc", KEY)).status).toBe(401);
    });

    it.each(["abc", "0", "-1", "1.5"])("answers 422 for the id %j, before the feature check", async (id) => {
      permissionRow = row("pmu_manager");

      expect((await get(id, KEY)).status).toBe(422);
    });

    it.each(NO_FEATURE_ROLES)("answers 403 to %s, whose role has no AI Test Insights view", async (role) => {
      permissionRow = row(role);

      expect((await get("1001", KEY)).status).toBe(403);
      expect((await get("9999", KEY)).status).toBe(403);
      expect(reads()).toHaveLength(0);
    });

    it("answers 403 to a Teacher with only JNV NVS", async () => {
      permissionRow = row("teacher", { program_ids: [64] });

      expect((await get("1001", KEY)).status).toBe(403);
    });

    it.each([...VIEW_ONLY_ROLES, "teacher"])("answers %s the text, so viewers read the AI Summary", async (role) => {
      permissionRow = row(role);

      const response = await get("1001", KEY);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ markdown: MARKDOWN });
    });

    it("answers a read_only Teacher the text", async () => {
      permissionRow = row("teacher", { read_only: true });

      expect((await get("1001", KEY)).status).toBe(200);
    });

    it.each([...VIEW_ONLY_ROLES, "teacher"])(
      "answers 404 to %s for a Student who does not exist, or who no centre they may list lists",
      async (role) => {
        permissionRow = row(role);

        expect((await get("9999", KEY)).status).toBe(404);
        if (role !== "admin") expect((await get("2001", OTHER_STUDENT_KEY)).status).toBe(404);
        expect(reads()).toHaveLength(0);
      },
    );
  });
});
