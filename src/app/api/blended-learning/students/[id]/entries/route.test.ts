import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
// SES is the notifier's process boundary.
const ses = mockClient(SESClient);
// S3 is where uploaded photos already sit; HeadObject reads their stored size.
const s3 = mockClient(S3Client);

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

// Open Action Items by id, as the UPDATE's WHERE (status = 'open' AND
// student_id) reads them. Item 801 is already done; 811 is Student 601's.
const ACTION_ITEMS: Record<number, { student_id: number; status: "open" | "done" }> = {
  801: { student_id: 501, status: "done" },
  802: { student_id: 501, status: "open" },
  803: { student_id: 501, status: "open" },
  811: { student_id: 601, status: "open" },
};

// Conversation Drafts by id. 901 is Student 501's ready draft; 902 is still
// transcribing; 903 was already saved; 911 is Student 601's ready draft.
type DraftRow = {
  student_id: number;
  state: string;
  call_recording_s3_key: string;
  transcript_s3_key: string | null;
  saved_conversation_id: unknown;
};
const RECORDING_901 = "lms-documents/blended-learning/recordings/501/2b1f0c3e-7d4a-4e8b-9c1d-5f6a7b8c9d0e.m4a";
const TRANSCRIPT_901 = "lms-documents/blended-learning/transcripts/501/2b1f0c3e.json";
function givenDrafts(): Record<number, DraftRow> {
  return {
    901: { student_id: 501, state: "ready", call_recording_s3_key: RECORDING_901, transcript_s3_key: TRANSCRIPT_901, saved_conversation_id: null },
    902: { student_id: 501, state: "transcribing", call_recording_s3_key: "lms-documents/blended-learning/recordings/501/a.mp3", transcript_s3_key: null, saved_conversation_id: null },
    903: { student_id: 501, state: "saved", call_recording_s3_key: "lms-documents/blended-learning/recordings/501/b.mp3", transcript_s3_key: "lms-documents/blended-learning/transcripts/501/b.json", saved_conversation_id: 650 },
    911: { student_id: 601, state: "ready", call_recording_s3_key: "lms-documents/blended-learning/recordings/601/c.wav", transcript_s3_key: "lms-documents/blended-learning/transcripts/601/c.json", saved_conversation_id: null },
  };
}
// Committed draft rows, as the save's draft lock and state change see them.
let drafts: Record<number, DraftRow>;

// Committed rows, by table, as column → value. A transaction's inserts and
// ticks land here only when its callback resolves; a throw rolls them back.
let inserted: Record<string, Record<string, unknown>[]>;
// Committed Mentor Flags by id, with notification_sent_at as the notifier sets it.
let committedFlags: Record<number, Record<string, unknown> & { notification_sent_at: string | null }>;
let ticked: { id: number; completed_by_conversation_id: unknown; completed_by_email: unknown }[];
let nextId: number;
// When set, the Conversation insert fails with this Postgres error code.
let insertErrorCode: string | null;

function givenTables() {
  inserted = {};
  committedFlags = {};
  ticked = [];
  nextId = 700;
  insertErrorCode = null;
  drafts = givenDrafts();
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
    // The notifier, after commit, reads and marks only committed flags.
    if (sql.trim().startsWith("UPDATE blended_learning_mentor_flags")) {
      const flag = committedFlags[Number(params?.[0])];
      if (!flag || flag.notification_sent_at !== null) return [];
      flag.notification_sent_at = "2026-10-22 06:00:01";
      return [{ id: params?.[0] }];
    }
    if (sql.includes("FROM blended_learning_mentor_flags")) {
      const flag = committedFlags[Number(params?.[0])];
      return flag
        ? [{ ...flag, student_first_name: "Ira", student_last_name: "Sharma", grade: 12, program_name: "STP Voucher Delhi", mentor_first_name: "Faizan", mentor_last_name: "Ali", mentor_email: MENTOR_A, occurred_on: "2026-10-21" }]
        : [];
    }
    return [];
  });
  mockWithTransaction.mockImplementation(async (fn) => {
    const pending: Record<string, Record<string, unknown>[]> = {};
    const pendingFlags: typeof committedFlags = {};
    const pendingTicks: typeof ticked = [];
    const pendingDrafts: Record<number, DraftRow> = {};
    const client = {
      // fallow-ignore-next-line complexity
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("FROM blended_learning_conversation_drafts")) {
          // WHERE id = $1 AND student_id = $2 FOR UPDATE
          const [draftId, studentId] = params as [number, number];
          const draft = drafts[draftId];
          return { rows: draft && draft.student_id === studentId ? [{ id: String(draftId), ...draft }] : [] };
        }
        if (sql.includes("UPDATE blended_learning_conversation_drafts")) {
          // SET state = 'saved', saved_conversation_id = $1 WHERE id = $2 AND state = 'ready'
          const [conversationId, draftId] = params as [number, number];
          const draft = drafts[draftId];
          if (!draft || draft.state !== "ready") return { rows: [], rowCount: 0 };
          pendingDrafts[draftId] = { ...draft, state: "saved", saved_conversation_id: conversationId };
          return { rows: [{ id: String(draftId) }], rowCount: 1 };
        }
        if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) {
          const mapping = MAPPINGS[Number(params[0])];
          return { rows: mapping ? [mapping] : [] };
        }
        if (sql.includes("UPDATE blended_learning_action_items")) {
          // SET status = 'done', completed_by_conversation_id = $1, completed_by_email = $2
          // WHERE id = ANY($3) AND status = 'open' AND student_id = $4
          const [conversationId, email, ids, studentId] = params as [unknown, unknown, number[], number];
          const rows = ids
            .filter((id) => ACTION_ITEMS[id]?.status === "open" && ACTION_ITEMS[id].student_id === studentId)
            .map((id) => ({ id: String(id) }));
          for (const row of rows) {
            pendingTicks.push({ id: Number(row.id), completed_by_conversation_id: conversationId, completed_by_email: email });
          }
          return { rows, rowCount: rows.length };
        }
        const insert = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/);
        if (insert) {
          if (insertErrorCode) throw Object.assign(new Error("violates check constraint"), { code: insertErrorCode });
          const columns = insert[2].split(",").map((column) => column.trim());
          const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
          (pending[insert[1]] ??= []).push(row);
          const id = nextId++;
          if (insert[1] === "blended_learning_mentor_flags") pendingFlags[id] = { id, ...row, notification_sent_at: null };
          return { rows: [{ id: String(id), occurred_on: row.occurred_on }] };
        }
        return { rows: [] };
      }),
    };
    const result = await fn(client as never);
    for (const [table, rows] of Object.entries(pending)) (inserted[table] ??= []).push(...rows);
    Object.assign(committedFlags, pendingFlags);
    ticked.push(...pendingTicks);
    Object.assign(drafts, pendingDrafts);
    return result;
  });
}

// Uploaded photo objects by key, with their stored size. Any other key has no object.
function givenS3Objects(sizes: Record<string, number>) {
  s3.reset();
  s3.on(HeadObjectCommand).callsFake(async (input: { Key: string }) => {
    if (input.Key in sizes) return { ContentLength: sizes[input.Key] };
    throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
  });
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
  ses.reset();
  ses.on(SendEmailCommand).resolves({ MessageId: "ses-message-1" });
  vi.stubEnv("BLENDED_LEARNING_SES_ACCESS_KEY_ID", "AKIATEST");
  vi.stubEnv("BLENDED_LEARNING_SES_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("BLENDED_LEARNING_WELLBEING_EMAILS", "shalinijha@avantifellows.org");
  vi.stubEnv("NEXTAUTH_URL", "https://lms.avantifellows.org");
  vi.stubEnv("S3_DOCS_BUCKET", "test-bucket");
  vi.stubEnv("S3_DOCS_PREFIX", "lms-documents");
  givenS3Objects({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
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
        call_recording_s3_key: null,
        transcript_s3_key: null,
        source_draft_id: null,
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
        call_recording_s3_key: null,
        transcript_s3_key: null,
        source_draft_id: null,
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

  describe("Action Items", () => {
    it("stores a Conversation's Action Items with positions 1..n in the same save", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", {
        ...CONVERSATION,
        actionItems: [
          { owner: "student", text: "  Finish the optics DPP  ", dueOn: "2026-10-29" },
          { owner: "parent", text: "Confirm the hostel fee date" },
        ],
      });

      expect(res.status).toBe(201);
      expect(inserted.blended_learning_action_items).toEqual([
        { conversation_id: 700, student_id: 501, position: 1, owner: "student", text: "Finish the optics DPP", due_on: "2026-10-29" },
        { conversation_id: 700, student_id: 501, position: 2, owner: "parent", text: "Confirm the hostel fee date", due_on: null },
      ]);
    });

    it.each([
      ["no owner", { text: "Revise optics" }, "actionItems.0.owner", "Choose who owns this Action Item."],
      ["an unknown owner", { owner: "teacher", text: "Revise optics" }, "actionItems.0.owner", "Choose who owns this Action Item."],
      ["blank text", { owner: "mentor", text: "   " }, "actionItems.0.text", "Add the Action Item."],
      ["an impossible due date", { owner: "mentor", text: "Revise optics", dueOn: "2026-02-30" }, "actionItems.0.dueOn", "Enter a valid due date."],
    ])("rejects an Action Item with %s (422) and saves nothing", async (_case, item, field, message) => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, actionItems: [item] });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ [field]: message });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it("rejects Action Items that are not a list (422)", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, actionItems: "call the parent" });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ actionItems: "Action Items must be a list." });
    });

    it("ticks earlier open Action Items done by this Conversation", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, completeActionItemIds: [802, 803] });

      expect(res.status).toBe(201);
      expect(ticked).toEqual([
        { id: 802, completed_by_conversation_id: 700, completed_by_email: MENTOR_A },
        { id: 803, completed_by_conversation_id: 700, completed_by_email: MENTOR_A },
      ]);
    });

    it.each([
      ["already done", [802, 801]],
      ["another Student's", [811]],
      ["unknown", [802, 999]],
    ])("returns 409 and rolls back the whole save when a ticked item is %s", async (_case, ids) => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", {
        ...CONVERSATION,
        actionItems: [{ owner: "mentor", text: "Send the formula sheet" }],
        completeActionItemIds: ids,
      });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: "An Action Item you ticked is already done or isn't this Mentee's. Reload and try again.",
      });
      expect(inserted).toEqual({});
      expect(ticked).toEqual([]);
    });

    it.each([
      ["not a list", 802],
      ["not ids", ["802"]],
      ["a non-positive id", [0]],
    ])("rejects completeActionItemIds that are %s (422)", async (_case, ids) => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, completeActionItemIds: ids });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ completeActionItemIds: "Choose Action Items from the list." });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it.each([
      ["Action Items", { actionItems: [{ owner: "mentor", text: "Call back on Sunday" }] }, "actionItems", "An Attempt can't have Action Items."],
      ["ticks", { completeActionItemIds: [802] }, "completeActionItemIds", "Only a Conversation can tick Action Items done."],
    ])("rejects %s on an Attempt (422) and saves nothing", async (_case, change, field, message) => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-22", ...change });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ [field]: message });
      expect(mockWithTransaction).not.toHaveBeenCalled();
      expect(ticked).toEqual([]);
    });
  });

  describe("Mentor Flags", () => {
    const WELLBEING_COMMENT = "Synthetic: anxious about the mock test.";

    function emailsSent() {
      return ses.commandCalls(SendEmailCommand).map((call) => call.args[0].input);
    }

    it("stores several flags with optional comments, raised by the actor", async () => {
      signedInAs(ADMIN);
      const res = await postEntry("601", {
        ...CONVERSATION,
        flags: [
          { recipient: "physics", comment: "  Struggling with rotation  " },
          { recipient: "maths", comment: "   " },
          { recipient: "chemistry" },
        ],
      });

      expect(res.status).toBe(201);
      expect(inserted.blended_learning_mentor_flags).toEqual([
        { conversation_id: 700, student_id: 601, recipient: "physics", comment: "Struggling with rotation", raised_by_email: ADMIN },
        { conversation_id: 700, student_id: 601, recipient: "maths", comment: null, raised_by_email: ADMIN },
        { conversation_id: 700, student_id: 601, recipient: "chemistry", comment: null, raised_by_email: ADMIN },
      ]);
    });

    it("rejects the same Flag Recipient twice on one Conversation (422) and saves nothing", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", {
        ...CONVERSATION,
        flags: [{ recipient: "physics" }, { recipient: "physics", comment: "Again" }],
      });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ "flags.1.recipient": "Each Flag Recipient can be raised once." });
      expect(mockWithTransaction).not.toHaveBeenCalled();
      expect(emailsSent()).toEqual([]);
    });

    it.each([
      ["an unknown recipient", [{ recipient: "biology" }], "flags.0.recipient", "Choose who the flag is for."],
      ["a comment that is not text", [{ recipient: "maths", comment: 7 }], "flags.0.comment", "The comment must be text."],
      ["flags that are not a list", "physics", "flags", "Mentor Flags must be a list."],
    ])("rejects %s (422)", async (_case, flags, field, message) => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, flags });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ [field]: message });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it("rejects flags on an Attempt (422)", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-22", flags: [{ recipient: "maths" }] });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ flags: "An Attempt can't have Mentor Flags." });
    });

    it("emails the well-being lead once, after commit, for an Emotional Well-being flag", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", {
        ...CONVERSATION,
        flags: [
          { recipient: "emotional_wellbeing", comment: WELLBEING_COMMENT },
          { recipient: "physics" },
        ],
      });

      expect(res.status).toBe(201);
      const emails = emailsSent();
      expect(emails).toHaveLength(1);
      expect(emails[0].Destination?.ToAddresses).toEqual(["shalinijha@avantifellows.org"]);
      expect(emails[0].Message?.Body?.Text?.Data).toContain("https://lms.avantifellows.org/blended-learning/students/501");
      expect(JSON.stringify(emails[0])).not.toContain(WELLBEING_COMMENT);
      // The notifier found the flag committed and marked it sent; the Physics
      // flag (id 702) notifies no one.
      expect(committedFlags[701]).toMatchObject({ recipient: "emotional_wellbeing", notification_sent_at: "2026-10-22 06:00:01" });
      expect(committedFlags[702]).toMatchObject({ recipient: "physics", notification_sent_at: null });
    });

    it("emails no one for Physics, Chemistry and Maths flags", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", {
        ...CONVERSATION,
        flags: [{ recipient: "physics" }, { recipient: "chemistry" }, { recipient: "maths" }],
      });
      expect(res.status).toBe(201);
      expect(ses.calls()).toHaveLength(0);
    });

    it("emails no one when the save rolls back", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", {
        ...CONVERSATION,
        flags: [{ recipient: "emotional_wellbeing" }],
        completeActionItemIds: [801],
      });
      expect(res.status).toBe(409);
      expect(inserted).toEqual({});
      expect(ses.calls()).toHaveLength(0);
    });

    it("keeps the save when the email fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      ses.on(SendEmailCommand).rejects(Object.assign(new Error("Throttling"), { name: "Throttling" }));
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, flags: [{ recipient: "emotional_wellbeing" }] });

      expect(res.status).toBe(201);
      expect(inserted.blended_learning_mentor_flags).toHaveLength(1);
      expect(committedFlags[701].notification_sent_at).toBeNull();
      consoleError.mockRestore();
    });

    it("saves with no SES call when SES is unconfigured", async () => {
      vi.stubEnv("BLENDED_LEARNING_SES_ACCESS_KEY_ID", "");
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, flags: [{ recipient: "emotional_wellbeing" }] });

      expect(res.status).toBe(201);
      expect(ses.calls()).toHaveLength(0);
      expect(committedFlags[701].notification_sent_at).toBeNull();
    });
  });

  describe("Photos", () => {
    const PHOTO_1 = "lms-documents/blended-learning/photos/501/0d6f1d8e-1b2c-4c1a-9f3e-5a6b7c8d9e01.jpg";
    const PHOTO_2 = "lms-documents/blended-learning/photos/501/7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c02.png";

    it("stores a Conversation's photos with positions 1..n, type and stored size, in the same save", async () => {
      signedInAs(MENTOR_A);
      givenS3Objects({ [PHOTO_1]: 412_345, [PHOTO_2]: 98_765 });
      const res = await postEntry("501", { ...CONVERSATION, photoKeys: [PHOTO_1, PHOTO_2] });

      expect(res.status).toBe(201);
      expect(inserted.blended_learning_conversation_photos).toEqual([
        { conversation_id: 700, s3_key: PHOTO_1, content_type: "image/jpeg", byte_size: 412345, position: 1 },
        { conversation_id: 700, s3_key: PHOTO_2, content_type: "image/png", byte_size: 98765, position: 2 },
      ]);
    });

    // A key from the upload route under Student 601's prefix, and photo keys
    // shaped wrong for Student 501.
    const STUDENT_601_PHOTO = "lms-documents/blended-learning/photos/601/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e05.jpg";
    function photoKey(n: number) {
      return `lms-documents/blended-learning/photos/501/00000000-0000-4000-8000-00000000000${n}.jpg`;
    }

    it.each([
      ["under another Student's prefix", STUDENT_601_PHOTO],
      ["under this Student's documents, not photos", "lms-documents/students/501/consent/2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d06/page-1.jpg"],
      ["under another environment's prefix", "lms-documents-staging/blended-learning/photos/501/0d6f1d8e-1b2c-4c1a-9f3e-5a6b7c8d9e01.jpg"],
      ["that climbs out of the prefix", "lms-documents/blended-learning/photos/501/../601/0d6f1d8e-1b2c-4c1a-9f3e-5a6b7c8d9e01.jpg"],
      ["that is not an image", "lms-documents/blended-learning/photos/501/0d6f1d8e-1b2c-4c1a-9f3e-5a6b7c8d9e01.pdf"],
      ["that is not text", 501],
    ])("rejects a photo key %s (422) and saves nothing", async (_case, foreignKey) => {
      signedInAs(MENTOR_A);
      givenS3Objects({ [PHOTO_1]: 1000, [STUDENT_601_PHOTO]: 1000 });
      const res = await postEntry("501", { ...CONVERSATION, photoKeys: [PHOTO_1, foreignKey] });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ "photoKeys.1": "This photo isn't this Mentee's. Remove it and add it again." });
      expect(mockWithTransaction).not.toHaveBeenCalled();
      expect(inserted).toEqual({});
    });

    it("rejects six photos (422) and saves nothing", async () => {
      signedInAs(MENTOR_A);
      const keys = [1, 2, 3, 4, 5, 6].map(photoKey);
      givenS3Objects(Object.fromEntries(keys.map((key) => [key, 1000])));
      const res = await postEntry("501", { ...CONVERSATION, photoKeys: keys });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ photoKeys: "A Conversation can have at most five photos." });
      expect(mockWithTransaction).not.toHaveBeenCalled();
      expect(inserted).toEqual({});
    });

    it("stores five photos at positions 1 to 5", async () => {
      signedInAs(MENTOR_A);
      const keys = [1, 2, 3, 4, 5].map(photoKey);
      givenS3Objects(Object.fromEntries(keys.map((key) => [key, 2048])));
      const res = await postEntry("501", { ...CONVERSATION, photoKeys: keys });

      expect(res.status).toBe(201);
      expect(inserted.blended_learning_conversation_photos.map((row) => [row.s3_key, row.position])).toEqual([
        [photoKey(1), 1],
        [photoKey(2), 2],
        [photoKey(3), 3],
        [photoKey(4), 4],
        [photoKey(5), 5],
      ]);
    });

    it("rejects the same photo twice (422)", async () => {
      signedInAs(MENTOR_A);
      givenS3Objects({ [PHOTO_1]: 1000 });
      const res = await postEntry("501", { ...CONVERSATION, photoKeys: [PHOTO_1, PHOTO_1] });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ "photoKeys.1": "Each photo can be attached once." });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it("rejects a photo whose upload never reached S3 (422) and saves nothing", async () => {
      signedInAs(MENTOR_A);
      givenS3Objects({ [PHOTO_1]: 1000 });
      const res = await postEntry("501", { ...CONVERSATION, photoKeys: [PHOTO_1, PHOTO_2] });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({
        "photoKeys.1": "This photo didn't finish uploading. Remove it and add it again.",
      });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it.each([
      ["not a list", PHOTO_1, { photoKeys: "Photos must be a list." }],
    ])("rejects photo keys that are %s (422)", async (_case, photoKeys, fieldErrors) => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, photoKeys });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual(fieldErrors);
    });

    it("rejects photos on an Attempt (422)", async () => {
      signedInAs(MENTOR_A);
      givenS3Objects({ [PHOTO_1]: 1000 });
      const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-22", photoKeys: [PHOTO_1] });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ photoKeys: "An Attempt can't have photos." });
    });

    it("returns 404 when a Mentor attaches photos for another Mentor's Mentee, and saves nothing", async () => {
      signedInAs(MENTOR_A);
      givenS3Objects({ [STUDENT_601_PHOTO]: 1000 });
      const res = await postEntry("601", { ...CONVERSATION, photoKeys: [STUDENT_601_PHOTO] });
      expect(res.status).toBe(404);
      expect(inserted).toEqual({});
    });

    it("saves no photo rows when the Conversation rolls back", async () => {
      signedInAs(MENTOR_A);
      givenS3Objects({ [PHOTO_1]: 1000 });
      const res = await postEntry("501", { ...CONVERSATION, photoKeys: [PHOTO_1], completeActionItemIds: [801] });
      expect(res.status).toBe(409);
      expect(inserted).toEqual({});
    });
  });

  describe("Conversation Drafts", () => {
    it("saves a ready draft as one Conversation with its recording and transcript, and marks the draft saved", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, draftId: 901 });

      expect(res.status).toBe(201);
      expect(inserted.blended_learning_conversations).toHaveLength(1);
      expect(inserted.blended_learning_conversations[0]).toMatchObject({
        kind: "conversation",
        summary: "Talked through the mock test plan.",
        call_recording_s3_key: RECORDING_901,
        transcript_s3_key: TRANSCRIPT_901,
        source_draft_id: 901,
      });
      expect(drafts[901]).toMatchObject({ state: "saved", saved_conversation_id: 700 });
    });

    it.each([
      ["still transcribing", 902],
      ["already saved", 903],
      ["another Student's", 911],
      ["unknown", 999],
    ])("returns 409 for a draft that is %s, and saves nothing", async (_case, draftId) => {
      signedInAs(MENTOR_A);
      const before = givenDrafts();
      const res = await postEntry("501", { ...CONVERSATION, actionItems: [{ owner: "student", text: "Revise optics" }], draftId });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "This Conversation Draft is no longer ready to save. Reload and try again." });
      expect(inserted).toEqual({});
      expect(drafts).toEqual(before);
    });

    it("saves a draft once: a second save of the same draft returns 409", async () => {
      signedInAs(MENTOR_A);
      expect((await postEntry("501", { ...CONVERSATION, draftId: 901 })).status).toBe(201);
      expect((await postEntry("501", { ...CONVERSATION, draftId: 901 })).status).toBe(409);
      expect(inserted.blended_learning_conversations).toHaveLength(1);
    });

    it("leaves the draft ready when the save rolls back", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, draftId: 901, completeActionItemIds: [801] });
      expect(res.status).toBe(409);
      expect(inserted).toEqual({});
      expect(drafts[901].state).toBe("ready");
    });

    it("rejects a draft id on an Attempt (422)", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-22", draftId: 901 });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ draftId: "A Conversation Draft can only be saved as a Conversation." });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it("rejects a draft id that is not an id (422)", async () => {
      signedInAs(MENTOR_A);
      const res = await postEntry("501", { ...CONVERSATION, draftId: "901" });
      expect(res.status).toBe(422);
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it("sanitises the reviewed draft's notes before saving them", async () => {
      signedInAs(MENTOR_A);
      await postEntry("501", {
        ...CONVERSATION,
        draftId: 901,
        notesHtml: "<h3>Plan</h3><ul><li><p>&lt;script&gt;x&lt;/script&gt;</p></li></ul><img src=x onerror=alert(1)>",
      });
      expect(inserted.blended_learning_conversations[0].notes_html).toBe(
        "<h3>Plan</h3><ul><li><p>&lt;script&gt;x&lt;/script&gt;</p></li></ul>"
      );
    });
  });
});
