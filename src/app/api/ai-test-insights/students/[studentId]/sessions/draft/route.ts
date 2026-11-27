import { NextResponse } from "next/server";

import { saveSessionNotes } from "@/lib/ai-test-insights-session-notes";
import {
  parseSessionNotesRequest,
  SESSION_NOTES_STALE_CODE,
  type SessionNotesDraftResponse,
  type SessionNotesStaleResponse,
} from "@/lib/ai-test-insights-session-notes-rules";
import { withAiTestInsightsStudentWrite } from "@/lib/ai-test-insights-student-routes";

// The Session Notes draft autosave (#574, physical centres only). Saves the
// acting Teacher's own draft for the Student. The Student route opening
// gates first, as a write: 401 no session, 422 bad id, 403 no
// `ai_test_insights` view, 403 access not `edit` (before any Student read),
// 404 Student missing, not listed or out of scope; then the body (422 with
// the failing field: wrong types, a field over 2,000 characters, an
// impossible date, a bad `expectedRevision`); then the acting User (409
// `no_linked_user`). Then the Session Notes module's answer: 200
// `{ revision }`, or 409 `stale` with `currentRevision` when another tab saved
// first. No log line holds note text.
//
// An optional `centre` query value, as on the Student page, picks the centre
// whose School and Program a new draft records.
export const PUT = withAiTestInsightsStudentWrite(
  { log: "AI Test Insights session draft save failed", message: "Session Notes could not be saved" },
  (raw) => parseSessionNotesRequest(raw, "draft"),
  async ({ student, actorUserId, body }) => {
    const { expectedRevision, ...notes } = body;
    const result = await saveSessionNotes({ mode: "draft", student, actorUserId, notes, expectedRevision });
    if (result.outcome === "invalid") {
      return NextResponse.json({ error: result.error, field: result.field }, { status: 422 });
    }
    if (result.outcome === "stale") {
      const stale: SessionNotesStaleResponse = {
        error: "These notes were changed in another tab.",
        code: SESSION_NOTES_STALE_CODE,
        currentRevision: result.currentRevision,
      };
      return NextResponse.json(stale, { status: 409 });
    }
    const saved: SessionNotesDraftResponse = { revision: result.revision };
    return NextResponse.json(saved);
  },
);
