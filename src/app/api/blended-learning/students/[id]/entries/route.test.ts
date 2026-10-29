import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));
// After commit: the notifier and the Mentee list read model have their own tests.
vi.mock("@/lib/blended-learning-wellbeing-notifier", () => ({ notifyWellbeingFlag: vi.fn() }));
vi.mock("@/lib/blended-learning-mentees", () => ({ listMentees: vi.fn() }));

import { withTransaction } from "@/lib/db";
import { notifyWellbeingFlag } from "@/lib/blended-learning-wellbeing-notifier";
import { listMentees } from "@/lib/blended-learning-mentees";
import { MAPPING, MENTOR, READ_ONLY_ADMIN, mockBlendedDb, pgError, rows, signedInAs } from "@/app/api/blended-learning/test-db";
import { POST } from "./route";

const mockNotify = vi.mocked(notifyWellbeingFlag);
const s3 = mockClient(S3Client);

const PHOTO = "lms-documents/blended-learning/photos/501/0d6f1d8e-1b2c-4c1a-9f3e-5a6b7c8d9e01.jpg";
const RECORDING = "lms-documents/blended-learning/recordings/501/2b1f0c3e-7d4a-4e8b-9c1d-5f6a7b8c9d0e.m4a";
const TRANSCRIPT = "lms-documents/blended-learning/transcripts/501/2b1f0c3e.json";
const MENTEE_ROW = { studentId: 501, name: "Ira Sharma" };
const CONVERSATION = {
  kind: "conversation",
  occurredOn: "2026-10-21",
  mode: "call",
  spokeWith: "both",
  durationMinutes: 35,
  summary: "Talked through the mock test plan.",
};
const SAVED = rows({ id: 700, occurred_on: "2026-10-21" });

let clientQuery: ReturnType<typeof mockBlendedDb>["clientQuery"];

async function postEntry(studentId: string, body: unknown) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/students/${studentId}/entries`, { method: "POST", body }),
    routeParams({ id: studentId })
  );
  return { status: res.status, body: await res.json() };
}

// The Nth query inside the transaction, as SQL fragment and params.
function expectWrite(n: number, sql: string, params: unknown[]) {
  expect(clientQuery).toHaveBeenNthCalledWith(n, expect.stringContaining(sql), params);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Today in IST is 2026-10-22.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T06:00:00Z"));
  vi.stubEnv("S3_DOCS_BUCKET", "test-bucket");
  vi.stubEnv("S3_DOCS_PREFIX", "lms-documents");
  ({ clientQuery } = mockBlendedDb());
  mockNotify.mockResolvedValue("sent");
  vi.mocked(listMentees).mockResolvedValue({ talkToFirst: [], everyoneElse: [MENTEE_ROW] } as never);
  s3.reset();
  s3.on(HeadObjectCommand).rejects(Object.assign(new Error("NotFound"), { name: "NotFound" }));
  s3.on(HeadObjectCommand, { Key: PHOTO }).resolves({ ContentLength: 412_345 });
  signedInAs(MENTOR);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/blended-learning/students/[id]/entries", () => {
  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await postEntry("501", { kind: "attempt", occurredOn: "2026-10-20" })).status).toBe(401);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a user without Blended Learning access", "no access" as const],
    ["a read-only Blended Learning Admin", READ_ONLY_ADMIN],
  ])("returns 403 to %s", async (_case, who) => {
    signedInAs(who);
    expect((await postEntry("501", { kind: "attempt", occurredOn: "2026-10-20" })).status).toBe(403);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 for another Mentor's Mentee and for a malformed id", async () => {
    clientQuery.mockResolvedValueOnce(rows({ ...MAPPING, mentor_user_id: 9002 }));
    expect(await postEntry("601", { kind: "attempt", occurredOn: "2026-10-20" })).toEqual({
      status: 404,
      body: { error: "Not found" },
    });
    expect(clientQuery).toHaveBeenCalledTimes(1);

    expect((await postEntry("5x", { kind: "attempt", occurredOn: "2026-10-20" })).status).toBe(404);
  });

  it("passes validation errors through as 422 and saves nothing", async () => {
    const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-23" });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ occurredOn: expect.any(String) });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("logs an Attempt, snapshotting the Mapping, and returns the Mentee's new list row", async () => {
    clientQuery.mockResolvedValueOnce(rows(MAPPING)).mockResolvedValueOnce(rows({ id: 700, occurred_on: "2026-10-22" }));

    const res = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-22", note: "No answer twice" });

    expect(res).toEqual({
      status: 201,
      body: { entry: { id: 700, kind: "attempt", occurredOn: "2026-10-22" }, mentee: MENTEE_ROW },
    });
    expect(clientQuery).toHaveBeenNthCalledWith(1, expect.stringContaining("FOR SHARE"), [501, MAPPING.academic_year]);
    expectWrite(2, "INSERT INTO blended_learning_conversations", [
      501, 80, MAPPING.academic_year, 9001, MENTOR.actorEmail, "attempt", "2026-10-22",
      null, null, null, null, null, "No answer twice", null, null, null, null,
    ]);
    expect(clientQuery).toHaveBeenCalledTimes(2);
    expect(listMentees).toHaveBeenCalledWith({ access: MENTOR, mentorUserId: 9001, studentId: 501, today: "2026-10-22" });
  });

  it("saves a Conversation with its Action Items, photo, flags and ticks in one transaction, then emails", async () => {
    clientQuery
      .mockResolvedValueOnce(rows(MAPPING))
      .mockResolvedValueOnce(SAVED)
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows({ id: 41 }))
      .mockResolvedValueOnce(rows({ id: 42 }))
      .mockResolvedValueOnce(rows({ id: 802 }, { id: 803 }));

    const res = await postEntry("501", {
      ...CONVERSATION,
      actionItems: [{ owner: "student", text: "Revise optics" }, { owner: "parent", text: "Call back" }],
      photoKeys: [PHOTO],
      flags: [{ recipient: "emotional_wellbeing", comment: "Seemed anxious" }, { recipient: "physics" }],
      completeActionItemIds: [802, 803],
    });

    expect(res.status).toBe(201);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expectWrite(2, "INSERT INTO blended_learning_conversations", [
      501, 80, MAPPING.academic_year, 9001, MENTOR.actorEmail, "conversation", "2026-10-21",
      "call", "both", 35, CONVERSATION.summary, null, null, null, null, null, null,
    ]);
    expectWrite(3, "INSERT INTO blended_learning_action_items", [700, 501, 1, "student", "Revise optics"]);
    expectWrite(4, "INSERT INTO blended_learning_action_items", [700, 501, 2, "parent", "Call back"]);
    expectWrite(5, "INSERT INTO blended_learning_conversation_photos", [700, PHOTO, "image/jpeg", 412_345, 1]);
    expectWrite(6, "INSERT INTO blended_learning_mentor_flags", [700, 501, "emotional_wellbeing", "Seemed anxious", MENTOR.actorEmail]);
    expectWrite(7, "INSERT INTO blended_learning_mentor_flags", [700, 501, "physics", null, MENTOR.actorEmail]);
    expectWrite(8, "UPDATE blended_learning_action_items", [700, MENTOR.actorEmail, [802, 803], 501]);
    // Only the Emotional Well-being flag emails, after commit.
    expect(mockNotify.mock.calls).toEqual([[41]]);
  });

  it("returns 422 for a photo whose upload never reached S3, and saves nothing", async () => {
    const missing = PHOTO.replace("0d6f1d8e", "ffffffff");
    const res = await postEntry("501", { ...CONVERSATION, photoKeys: [missing] });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ "photoKeys.0": expect.any(String) });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("keeps the save when the email fails", async () => {
    clientQuery.mockResolvedValueOnce(rows(MAPPING)).mockResolvedValueOnce(SAVED).mockResolvedValueOnce(rows({ id: 41 }));
    mockNotify.mockResolvedValueOnce("failed");

    const res = await postEntry("501", { ...CONVERSATION, flags: [{ recipient: "emotional_wellbeing" }] });

    expect(res.status).toBe(201);
    expect(mockNotify).toHaveBeenCalledWith(41);
  });

  describe("conflicts roll the save back and send no email (409)", () => {
    const WELLBEING = { ...CONVERSATION, flags: [{ recipient: "emotional_wellbeing" }] };

    it("a ticked Action Item that is already done or not this Mentee's", async () => {
      clientQuery
        .mockResolvedValueOnce(rows(MAPPING))
        .mockResolvedValueOnce(SAVED)
        .mockResolvedValueOnce(rows({ id: 41 }))
        .mockResolvedValueOnce(rows({ id: 802 }));

      const res = await postEntry("501", { ...WELLBEING, completeActionItemIds: [801, 802] });

      expect(res).toEqual({ status: 409, body: { error: expect.stringContaining("already done") } });
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it.each([["23505"], ["23514"]])("a database conflict (%s)", async (code) => {
      clientQuery.mockResolvedValueOnce(rows(MAPPING)).mockRejectedValueOnce(pgError(code));

      const res = await postEntry("501", WELLBEING);

      expect(res).toEqual({ status: 409, body: { error: expect.stringContaining("conflicts") } });
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe("the screener answer and the once-per-Student Screener Feedback", () => {
    const SCREENER_STATE = (hasLink: boolean, feedbackGiven: boolean) =>
      rows({ has_link: hasLink, feedback_given: feedbackGiven });
    const RATINGS = { helpedUnderstand: 4, moreComfortable: 2 };

    // Mapping, the screener state, then the Conversation (with no parts).
    function scriptSave(hasLink: boolean, feedbackGiven: boolean) {
      clientQuery
        .mockResolvedValueOnce(rows(MAPPING))
        .mockResolvedValueOnce(SCREENER_STATE(hasLink, feedbackGiven))
        .mockResolvedValueOnce(SAVED);
    }

    it("saves the tick on the Conversation and the first feedback with it, in the same transaction", async () => {
      scriptSave(true, false);

      const res = await postEntry("501", { ...CONVERSATION, screenerUsed: true, screenerFeedback: RATINGS });

      expect(res.status).toBe(201);
      expect(withTransaction).toHaveBeenCalledTimes(1);
      expectWrite(2, "blended_learning_screener_feedback", [501]);
      expectWrite(3, "INSERT INTO blended_learning_conversations", [
        501, 80, MAPPING.academic_year, 9001, MENTOR.actorEmail, "conversation", "2026-10-21",
        "call", "both", 35, CONVERSATION.summary, null, null, null, null, null, true,
      ]);
      expectWrite(4, "INSERT INTO blended_learning_screener_feedback", [501, 700, 9001, 4, 2]);
      expect(clientQuery).toHaveBeenCalledTimes(4);
    });

    it.each([
      ["unticked", false, false],
      ["ticked after the Student's feedback was given", true, true],
    ])("records only the answer when %s", async (_case, used, feedbackGiven) => {
      scriptSave(true, feedbackGiven);

      const res = await postEntry("501", { ...CONVERSATION, screenerUsed: used });

      expect(res.status).toBe(201);
      expect(clientQuery.mock.calls[2][1].at(-1)).toBe(used);
      expect(clientQuery).toHaveBeenCalledTimes(3);
    });

    it("requires both ratings when the feedback is due (422, nothing saved)", async () => {
      scriptSave(true, false);

      const res = await postEntry("501", { ...CONVERSATION, screenerUsed: true });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({
        "screenerFeedback.helpedUnderstand": expect.stringContaining("1 (not at all) to 5 (a lot)"),
        "screenerFeedback.moreComfortable": expect.stringContaining("1 (not at all) to 5 (a lot)"),
      });
      expect(clientQuery).toHaveBeenCalledTimes(2);
    });

    // The Screener link can change while the form is open: what the form
    // asked no longer matches, so the Conversation saves as not asked.
    it("saves an answer for a Student whose Screener link is gone as not asked (NULL, no feedback)", async () => {
      scriptSave(false, false);

      const res = await postEntry("501", { ...CONVERSATION, screenerUsed: true, screenerFeedback: RATINGS });

      expect(res.status).toBe(201);
      expect(clientQuery.mock.calls[2][1].at(-1)).toBeNull();
      expect(clientQuery).toHaveBeenCalledTimes(3);
    });

    it("saves no answer for a Student given a Screener link meanwhile as not asked, without reading the link", async () => {
      // The link's state is scripted but never read.
      clientQuery
        .mockResolvedValueOnce(rows(MAPPING))
        .mockResolvedValueOnce(SAVED)
        .mockResolvedValueOnce(SCREENER_STATE(true, false));

      const res = await postEntry("501", CONVERSATION);

      expect(res.status).toBe(201);
      expectWrite(2, "INSERT INTO blended_learning_conversations", [
        501, 80, MAPPING.academic_year, 9001, MENTOR.actorEmail, "conversation", "2026-10-21",
        "call", "both", 35, CONVERSATION.summary, null, null, null, null, null, null,
      ]);
      expect(clientQuery).toHaveBeenCalledTimes(2);
    });

    it("rejects ratings once the Student's feedback is given (409, the form drops the questions)", async () => {
      scriptSave(true, true);

      const res = await postEntry("501", { ...CONVERSATION, screenerUsed: true, screenerFeedback: RATINGS });

      expect(res).toEqual({
        status: 409,
        body: {
          error: expect.stringContaining("already saved"),
          fieldErrors: { screenerFeedback: expect.stringContaining("Save again") },
        },
      });
      expect(clientQuery).toHaveBeenCalledTimes(2);
    });

    it("turns a racing second feedback (the UNIQUE student_id) into the same 409", async () => {
      scriptSave(true, false);
      clientQuery.mockRejectedValueOnce(
        Object.assign(pgError("23505"), { constraint: "bl_screener_feedback_student_unique" })
      );

      const res = await postEntry("501", { ...CONVERSATION, screenerUsed: true, screenerFeedback: RATINGS });

      expect(res.status).toBe(409);
      expect(res.body.fieldErrors).toEqual({ screenerFeedback: expect.stringContaining("already saved") });
    });

    it("rejects ratings with the box unticked, and an Attempt's screener answer, before the transaction", async () => {
      const unticked = await postEntry("501", { ...CONVERSATION, screenerUsed: false, screenerFeedback: RATINGS });
      expect(unticked.status).toBe(422);
      expect(unticked.body.fieldErrors).toEqual({ screenerFeedback: expect.any(String) });

      const attempt = await postEntry("501", { kind: "attempt", occurredOn: "2026-10-20", screenerUsed: false });
      expect(attempt.status).toBe(422);
      expect(attempt.body.fieldErrors).toEqual({ screenerUsed: expect.any(String) });
      expect(withTransaction).not.toHaveBeenCalled();
    });
  });

  describe("saving a reviewed Conversation Draft", () => {
    const READY = { id: 901, state: "ready", call_recording_s3_key: RECORDING, transcript_s3_key: TRANSCRIPT };

    it("moves the recording and transcript onto the Conversation and marks the draft saved", async () => {
      clientQuery
        .mockResolvedValueOnce(rows(MAPPING))
        .mockResolvedValueOnce(rows(READY))
        .mockResolvedValueOnce(SAVED)
        .mockResolvedValueOnce(rows({ id: 901 }));

      const res = await postEntry("501", { ...CONVERSATION, draftId: 901 });

      expect(res.status).toBe(201);
      expectWrite(2, "FOR UPDATE", [901, 501]);
      expectWrite(3, "INSERT INTO blended_learning_conversations", [
        501, 80, MAPPING.academic_year, 9001, MENTOR.actorEmail, "conversation", "2026-10-21",
        "call", "both", 35, CONVERSATION.summary, null, null, RECORDING, TRANSCRIPT, 901, null,
      ]);
      expectWrite(4, "SET state = 'saved'", [901]);
    });

    it("refuses a draft that is no longer ready (409)", async () => {
      clientQuery.mockResolvedValueOnce(rows(MAPPING)).mockResolvedValueOnce(rows({ ...READY, state: "saved" }));

      const res = await postEntry("501", { ...CONVERSATION, draftId: 901 });

      expect(res).toEqual({ status: 409, body: { error: expect.stringContaining("no longer ready") } });
      expect(clientQuery).toHaveBeenCalledTimes(2);
    });
  });
});
