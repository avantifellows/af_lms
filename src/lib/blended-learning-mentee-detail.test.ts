import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCanAccessBlendedStudent } = vi.hoisted(() => ({ mockCanAccessBlendedStudent: vi.fn() }));

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./s3", () => ({ getObjectText: vi.fn(), headObject: vi.fn(), presignDocumentPage: vi.fn() }));
vi.mock("./blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./blended-learning-access")>()),
  canAccessBlendedStudent: mockCanAccessBlendedStudent,
}));

import { query } from "./db";
import type { BlendedLearningAccess } from "./blended-learning-access";
import { getMenteeDetail } from "./blended-learning-mentee-detail";

const mockQuery = vi.mocked(query);

const MENTOR: BlendedLearningAccess = {
  kind: "mentor", role: "blended_mentor", readOnly: false,
  actorEmail: "faizan@avantifellows.org", actorUserId: 9001, mentorUserId: 9001,
};

type Rows = { profile: unknown[]; entries?: unknown[]; actionItems?: unknown[]; flags?: unknown[] };

// Answer each of getMenteeDetail's reads by the table it selects from.
function givenRows({ profile, entries = [], actionItems = [], flags = [] }: Rows) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) return profile;
    if (sql.includes("FROM blended_learning_conversations")) return entries;
    if (sql.includes("FROM blended_learning_action_items")) return actionItems;
    if (sql.includes("FROM blended_learning_mentor_flags")) return flags;
    throw new Error(`Unexpected query: ${sql}`);
  });
}

const PROFILE = {
  first_name: "Ira", last_name: "Sharma", gender: "Female", grade: "12", program_name: "STP Voucher Delhi",
  phone: "+91 98765 43210", whatsapp_phone: "9876543210",
  profile_doc_url: "  https://docs.example/ira  ", screener_url: "   ",
  open_draft_id: null, open_draft_state: null,
  mentor_user_id: "9001", mentor_first_name: "Faizan",
};

function entry(overrides: Record<string, unknown>) {
  return {
    id: "1", kind: "conversation", occurred_on: "2026-10-20", mode: "call", spoke_with: "student",
    duration_minutes: "20", summary: "Summary", attempt_note: null,
    has_notes: false, has_recording: false, has_transcript: false, photo_count: "0",
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockCanAccessBlendedStudent.mockReset();
  mockCanAccessBlendedStudent.mockResolvedValue(true);
});

describe("getMenteeDetail", () => {
  it("gives nothing for a Student out of the actor's scope, without reading", async () => {
    mockCanAccessBlendedStudent.mockResolvedValue(false);

    expect(await getMenteeDetail(MENTOR, 601)).toBeNull();
    expect(mockCanAccessBlendedStudent).toHaveBeenCalledWith(MENTOR, 601);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("gives nothing when the Student has no active Mapping profile row", async () => {
    givenRows({ profile: [] });

    expect(await getMenteeDetail(MENTOR, 501)).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual([501, "2026-2027"]);
  });

  it("maps the profile: name, numeric grade, one contact number, trimmed links and no draft", async () => {
    givenRows({ profile: [PROFILE] });

    expect(await getMenteeDetail(MENTOR, 501)).toEqual({
      studentId: 501,
      name: "Ira Sharma",
      gender: "Female",
      grade: 12,
      programName: "STP Voucher Delhi",
      phone: "+91 98765 43210",
      // Same last ten digits as `phone`, so it is not shown twice.
      whatsappPhone: null,
      profileDocUrl: "https://docs.example/ira",
      screenerUrl: null,
      openDraft: null,
      openActionItems: [],
      history: [],
      mentor: { userId: 9001, firstName: "Faizan" },
    });
  });

  it("keeps a different WhatsApp number, a missing grade and last name, and an open draft", async () => {
    givenRows({
      profile: [{
        ...PROFILE, last_name: null, grade: null, phone: null, whatsapp_phone: " 91234 56789 ",
        profile_doc_url: null, screener_url: "https://forms.example/screener",
        open_draft_id: "41", open_draft_state: "ready",
      }],
    });

    const detail = await getMenteeDetail(MENTOR, 501);

    expect(detail).toMatchObject({
      name: "Ira",
      grade: null,
      phone: null,
      whatsappPhone: "91234 56789",
      profileDocUrl: null,
      screenerUrl: "https://forms.example/screener",
      openDraft: { id: 41, state: "ready" },
    });
  });

  it("treats a draft id without a state as no open draft", async () => {
    givenRows({ profile: [{ ...PROFILE, open_draft_id: 41, open_draft_state: null }] });

    expect((await getMenteeDetail(MENTOR, 501))?.openDraft).toBeNull();
  });

  it("interleaves Conversations and Attempts newest first with their items, flags and media", async () => {
    givenRows({
      profile: [PROFILE],
      entries: [
        entry({
          id: "12", occurred_on: "2026-10-20", mode: "in_person", spoke_with: "both", duration_minutes: "35",
          summary: "Planned the week.", has_notes: true, has_recording: true, has_transcript: true, photo_count: "2",
        }),
        entry({ id: "11", kind: "attempt", occurred_on: "2026-10-18", attempt_note: "No answer", mode: null }),
        entry({
          id: "10", occurred_on: "2026-10-12", mode: null, spoke_with: null, duration_minutes: 15, summary: null,
        }),
      ],
      actionItems: [
        { conversation_id: "10", id: "100", text: "Old open item", owner: "parent", due_on: null, status: "open" },
        { conversation_id: "12", id: "120", text: "Revise optics", owner: "student", due_on: "2026-10-27", status: "open" },
        { conversation_id: 12, id: 121, text: "Share notes", owner: "mentor", due_on: null, status: "done" },
      ],
      flags: [
        { conversation_id: "12", recipient: "emotional_wellbeing", comment: "Seemed anxious" },
        { conversation_id: "12", recipient: "physics", comment: null },
      ],
    });

    const detail = await getMenteeDetail(MENTOR, 501);

    expect(detail?.history).toEqual([
      {
        kind: "conversation",
        id: 12,
        occurredOn: "2026-10-20",
        mode: "in_person",
        spokeWith: "both",
        durationMinutes: 35,
        summary: "Planned the week.",
        hasNotes: true,
        hasRecording: true,
        hasTranscript: true,
        photoCount: 2,
        actionItems: [
          { id: 120, text: "Revise optics", owner: "student", dueOn: "2026-10-27", status: "open" },
          { id: 121, text: "Share notes", owner: "mentor", dueOn: null, status: "done" },
        ],
        flags: [
          { recipient: "emotional_wellbeing", comment: "Seemed anxious" },
          { recipient: "physics", comment: null },
        ],
      },
      { kind: "attempt", id: 11, occurredOn: "2026-10-18", note: "No answer" },
      {
        // A Conversation row missing its session details reads with defaults.
        kind: "conversation",
        id: 10,
        occurredOn: "2026-10-12",
        mode: "call",
        spokeWith: "student",
        durationMinutes: 15,
        summary: "",
        hasNotes: false,
        hasRecording: false,
        hasTranscript: false,
        photoCount: 0,
        actionItems: [{ id: 100, text: "Old open item", owner: "parent", dueOn: null, status: "open" }],
        flags: [],
      },
    ]);
    // Only open items, newest Conversation first, dated by the Conversation.
    expect(detail?.openActionItems).toEqual([
      { id: 120, text: "Revise optics", owner: "student", dueOn: "2026-10-27", agreedOn: "2026-10-20" },
      { id: 100, text: "Old open item", owner: "parent", dueOn: null, agreedOn: "2026-10-12" },
    ]);
  });
});
