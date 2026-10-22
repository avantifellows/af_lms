import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { getServerSession } from "next-auth";
import { query, withTransaction } from "@/lib/db";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);

const MENTOR_A = "faizan@avantifellows.org";
const MENTOR_B = "lokesh@avantifellows.org";
const ADMIN = "juned@avantifellows.org";
const ADMIN_READ_ONLY = "shalinijha@avantifellows.org";
const LMS_ADMIN = "panchali@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

// Fixture tables, keyed the way the SQL reads them.
const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [MENTOR_B]: { role: "blended_mentor", read_only: false, user_id: 9002 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [LMS_ADMIN]: { role: "admin", read_only: false, user_id: 13 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active Mappings by Student. Student 503 has none.
const MAPPINGS: Record<number, { mentor_user_id: number; program_id: number; academic_year: string }> = {
  501: { mentor_user_id: 9001, program_id: 80, academic_year: "2026-2027" },
  601: { mentor_user_id: 9002, program_id: 91, academic_year: "2026-2027" },
};

// Student 501 on the list after an Attempt today: last Conversation 5 days ago.
const LIST_ROWS = [
  {
    student_id: 501,
    first_name: "Ira",
    last_name: "Sharma",
    gender: "Female",
    grade: 12,
    program_id: 80,
    program_name: "STP Voucher Delhi",
    last_conversation_on: "2026-10-17",
    last_conversation_id: 650,
    last_attempt_on: "2026-10-22",
    last_attempt_id: 700,
    legacy_last_contact_month: null,
    open_draft_state: null,
  },
];

// Rows the transaction inserted, by table, as column → value.
let inserted: Record<string, Record<string, unknown>[]>;
let nextId: number;
// When set, the Conversation insert fails with this Postgres error code.
let insertErrorCode: string | null;

function givenTables() {
  inserted = {};
  nextId = 700;
  insertErrorCode = null;
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_permission")) {
      const email = String(params?.[0]).toLowerCase();
      const row = PERMISSIONS[email];
      return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
    }
    // The Mentee list read model, after commit: Student 501's row as the
    // list would now read it.
    if (sql.includes("latest_attempt")) {
      return LIST_ROWS.filter((row) => params?.includes(row.student_id));
    }
    return [];
  });
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) {
        const mapping = MAPPINGS[Number(params[0])];
        return { rows: mapping ? [mapping] : [] };
      }
      const insert = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/);
      if (insert) {
        if (insertErrorCode) throw Object.assign(new Error("violates check constraint"), { code: insertErrorCode });
        const columns = insert[2].split(",").map((column) => column.trim());
        const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
        (inserted[insert[1]] ??= []).push(row);
        return { rows: [{ id: String(nextId++), occurred_on: row.occurred_on }] };
      }
      return { rows: [] };
    }),
  };
  mockWithTransaction.mockImplementation(async (fn) => fn(client as never));
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function postEntry(studentId: string, body: unknown) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/students/${studentId}/entries`, { method: "POST", body }),
    routeParams({ id: studentId })
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Today in IST is 2026-10-22.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T06:00:00Z"));
  givenTables();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/blended-learning/students/[id]/entries", () => {
  it("returns 401 when signed out", async () => {
    signedInAs(null);
    const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-20" });
    expect(res.status).toBe(401);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in user without Blended Learning access", async () => {
    signedInAs(TEACHER);
    expect((await postEntry("501", { kind: "attempt", occurredOn: "2026-10-20" })).status).toBe(403);
  });

  it("logs an Attempt for the Mentor's own Mentee, snapshotting the Mapping", async () => {
    signedInAs(MENTOR_A);
    const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-22", note: "No answer twice" });

    expect(res.status).toBe(201);
    expect(res.body.entry).toEqual({ id: 700, kind: "attempt", occurredOn: "2026-10-22" });
    expect(inserted.blended_learning_conversations).toEqual([
      {
        student_id: 501,
        program_id: 80,
        academic_year: "2026-2027",
        mentor_user_id: 9001,
        logged_by_user_id: 9001,
        logged_by_email: MENTOR_A,
        kind: "attempt",
        occurred_on: "2026-10-22",
        mode: null,
        spoke_with: null,
        duration_minutes: null,
        summary: null,
        notes_html: null,
        attempt_note: "No answer twice",
      },
    ]);
  });

  it("returns what the Mentee list will now say about the Mentee", async () => {
    signedInAs(MENTOR_A);
    const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-22" });

    expect(res.body.mentee).toMatchObject({
      studentId: 501,
      name: "Ira Sharma",
      lastContact: "2026-10-17",
      lastContactSource: "conversation",
      latestEntryKind: "attempt",
      reasons: ["attempt"],
      daysSince: 5,
    });
  });

  const CONVERSATION = {
    kind: "conversation",
    occurredOn: "2026-10-21",
    mode: "call",
    spokeWith: "both",
    durationMinutes: 35,
    summary: "Talked through the mock test plan.",
  };

  it("logs a Conversation and stores the sanitiser's output as notes_html", async () => {
    signedInAs(MENTOR_A);
    const res = await postEntry("501", {
      ...CONVERSATION,
      notesHtml:
        '<h3 style="color:red">Plan</h3><p><strong>Revise</strong> <em>optics</em> <a href="https://x.test">here</a></p><script>alert(1)</script>',
    });

    expect(res.status).toBe(201);
    expect(res.body.entry).toEqual({ id: 700, kind: "conversation", occurredOn: "2026-10-21" });
    expect(inserted.blended_learning_conversations).toEqual([
      {
        student_id: 501,
        program_id: 80,
        academic_year: "2026-2027",
        mentor_user_id: 9001,
        logged_by_user_id: 9001,
        logged_by_email: MENTOR_A,
        kind: "conversation",
        occurred_on: "2026-10-21",
        mode: "call",
        spoke_with: "both",
        duration_minutes: 35,
        summary: "Talked through the mock test plan.",
        notes_html: "<h3>Plan</h3><p><b>Revise</b> <i>optics</i> here</p>",
        attempt_note: null,
      },
    ]);
  });

  it("stores no notes when the editor is left empty", async () => {
    signedInAs(MENTOR_A);
    await postEntry("501", { ...CONVERSATION, notesHtml: "<p></p>" });
    expect(inserted.blended_learning_conversations[0].notes_html).toBeNull();
  });

  it.each([
    [ADMIN, 11],
    [LMS_ADMIN, 13],
  ])("lets admin %s log on the mapped Mentor's behalf", async (email, actorUserId) => {
    signedInAs(email);
    const res = await postEntry("601", CONVERSATION);

    expect(res.status).toBe(201);
    expect(inserted.blended_learning_conversations[0]).toMatchObject({
      student_id: 601,
      program_id: 91,
      mentor_user_id: 9002,
      logged_by_user_id: actorUserId,
      logged_by_email: email,
    });
  });

  it("returns 403 to a read-only Blended Learning Admin and writes nothing", async () => {
    signedInAs(ADMIN_READ_ONLY);
    const res = await postEntry("501", CONVERSATION);
    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when a Mentor posts for another Mentor's Mentee", async () => {
    signedInAs(MENTOR_A);
    const res = await postEntry("601", CONVERSATION);
    expect(res.status).toBe(404);
    expect(inserted.blended_learning_conversations).toBeUndefined();
  });

  it("returns 404 for an unmapped Student and a malformed id", async () => {
    signedInAs(ADMIN);
    expect((await postEntry("503", CONVERSATION)).status).toBe(404);
    expect((await postEntry("50x", CONVERSATION)).status).toBe(404);
    expect(inserted.blended_learning_conversations).toBeUndefined();
  });

  it.each([
    ["a future date", { occurredOn: "2026-10-23" }, "occurredOn", "The date can't be in the future."],
    ["an impossible date", { occurredOn: "2026-02-30" }, "occurredOn", "Enter the date."],
    ["a 0-minute duration", { durationMinutes: 0 }, "durationMinutes", "Duration must be between 1 and 240 minutes."],
    ["a 241-minute duration", { durationMinutes: 241 }, "durationMinutes", "Duration must be between 1 and 240 minutes."],
    ["a fractional duration", { durationMinutes: 30.5 }, "durationMinutes", "Duration must be between 1 and 240 minutes."],
    ["a blank summary", { summary: "   " }, "summary", "Add a summary."],
    ["an unknown mode", { mode: "video" }, "mode", "Choose call or in person."],
    ["an unknown spoke-with", { spokeWith: "teacher" }, "spokeWith", "Choose who you spoke with."],
    ["notes over 100 KB", { notesHtml: `<p>${"a".repeat(102_400)}</p>` }, "notesHtml", "Notes must be 100 KB or less."],
  ])("rejects a Conversation with %s (422)", async (_case, change, field, message) => {
    signedInAs(MENTOR_A);
    const res = await postEntry("501", { ...CONVERSATION, ...change });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe(message);
    expect(res.body.fieldErrors).toEqual({ [field]: message });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("accepts the 1- and 240-minute duration bounds", async () => {
    signedInAs(MENTOR_A);
    expect((await postEntry("501", { ...CONVERSATION, durationMinutes: 1 })).status).toBe(201);
    expect((await postEntry("501", { ...CONVERSATION, durationMinutes: 240 })).status).toBe(201);
  });

  it("rejects an Attempt dated in the future (422) and an unknown kind", async () => {
    signedInAs(MENTOR_A);
    const future = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-23" });
    expect(future).toEqual({
      status: 422,
      body: {
        error: "The date can't be in the future.",
        fieldErrors: { occurredOn: "The date can't be in the future." },
      },
    });
    expect((await postEntry("501", { kind: "session", occurredOn: "2026-10-22" })).status).toBe(422);
  });

  it("rejects a body that is not JSON (422)", async () => {
    signedInAs(MENTOR_A);
    const res = await POST(
      new Request("http://localhost/api/blended-learning/students/501/entries", { method: "POST", body: "{" }),
      routeParams({ id: "501" })
    );
    expect(res.status).toBe(422);
  });

  it.each([
    ["23514", "a check or append-only trigger"],
    ["23505", "a unique index"],
  ])("maps a %s violation (%s) to 409, not 500", async (code) => {
    signedInAs(MENTOR_A);
    insertErrorCode = code;
    const res = await postEntry("501", CONVERSATION);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This entry conflicts with what is already saved. Reload and try again." });
  });
});
