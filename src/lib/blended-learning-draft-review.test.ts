import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCanAccessBlendedStudent } = vi.hoisted(() => ({ mockCanAccessBlendedStudent: vi.fn() }));

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./s3", () => ({
  blendedLearningRecordingPrefix: (studentId: number) => `blended-learning/recordings/${studentId}/`,
  headObject: vi.fn(),
  presignUpload: vi.fn(),
}));
vi.mock("./blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./blended-learning-access")>()),
  canAccessBlendedStudent: mockCanAccessBlendedStudent,
}));

import { query } from "./db";
import type { BlendedLearningAccess } from "./blended-learning-access";
import { getDraftForReview } from "./blended-learning-drafts";

const mockQuery = vi.mocked(query);

const MENTOR: BlendedLearningAccess = {
  kind: "mentor", role: "blended_mentor", readOnly: false,
  actorEmail: "faizan@avantifellows.org", mentorUserId: 9001,
};
const READ_ONLY_ADMIN: BlendedLearningAccess = {
  kind: "admin", role: "blended_admin", readOnly: true,
  actorEmail: "viewer@avantifellows.org",
};

beforeEach(() => {
  mockQuery.mockReset();
  mockCanAccessBlendedStudent.mockReset();
  mockCanAccessBlendedStudent.mockResolvedValue(true);
});

describe("getDraftForReview", () => {
  it("gives a read-only user nothing without checking scope or reading", async () => {
    expect(await getDraftForReview(READ_ONLY_ADMIN, 501)).toBeNull();
    expect(mockCanAccessBlendedStudent).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("gives nothing for a Student out of the actor's scope", async () => {
    mockCanAccessBlendedStudent.mockResolvedValue(false);

    expect(await getDraftForReview(MENTOR, 601)).toBeNull();
    expect(mockCanAccessBlendedStudent).toHaveBeenCalledWith(MENTOR, 601);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("gives nothing when the Mentee has no ready draft", async () => {
    mockQuery.mockResolvedValue([]);

    expect(await getDraftForReview(MENTOR, 501)).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("draft.state = 'ready'"), [501]);
  });

  it("maps a ready draft with session details, action items and notes", async () => {
    mockQuery.mockResolvedValue([{
      id: "41", occurred_on: "2026-10-20", mode: "call", spoke_with: "both", duration_minutes: 25,
      draft_summary: "Talked about mock test scores.",
      draft_action_items: [
        { text: "Revise rotational motion", owner: "student" },
        { text: "Call the parent", owner: "mentor" },
      ],
      draft_notes: [{ heading: "Academics", points: ["Physics is weak"] }],
    }]);

    expect(await getDraftForReview(MENTOR, 501)).toEqual({
      id: 41,
      occurredOn: "2026-10-20",
      mode: "call",
      spokeWith: "both",
      durationMinutes: 25,
      summary: "Talked about mock test scores.",
      actionItems: [
        { text: "Revise rotational motion", owner: "student" },
        { text: "Call the parent", owner: "mentor" },
      ],
      notes: [{ heading: "Academics", points: ["Physics is weak"] }],
    });
  });

  it("reads a draft without session details or drafted lists as empty lists", async () => {
    mockQuery.mockResolvedValue([{
      id: 42, occurred_on: null, mode: null, spoke_with: null, duration_minutes: null,
      draft_summary: "Short call.",
      draft_action_items: null, draft_notes: null,
    }]);

    expect(await getDraftForReview(MENTOR, 501)).toEqual({
      id: 42,
      occurredOn: null,
      mode: null,
      spokeWith: null,
      durationMinutes: null,
      summary: "Short call.",
      actionItems: [],
      notes: [],
    });
  });
});
