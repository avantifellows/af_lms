import { NextResponse } from "next/server";

import { parseAiTestInsightsId } from "@/lib/ai-test-insights-access";
import { saveSessionNotes } from "@/lib/ai-test-insights-session-notes";
import {
  parseSessionNotesEditRequest,
  type SessionNotesDraftRequest,
  type SessionNotesEditResponse,
} from "@/lib/ai-test-insights-session-notes-rules";
import { sessionNotesRefusalResponse, withAiTestInsightsStudentWrite } from "@/lib/ai-test-insights-student-routes";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

type Params = { studentId: string; sessionId: string };

// The author's edit of submitted Session Notes (#578, physical centres only):
// "Save changes" on the author's own History entry. The Student route opening
// gates first, as a write: 401 no session, 422 bad Student id, 403 no
// `ai_test_insights` view, 403 access not `edit` (before any Student read),
// 404 Student missing, not listed or out of scope; then the body (422 with the
// failing field: the final rule, with today in India from the server's clock;
// an `expectedRevision` below 1); then the acting User (409
// `no_linked_user`). Then the Session Notes module's answer: 404 when the id
// names no submitted session of this Student (a draft's id, another Student's
// session and a malformed id included); 403 when the caller is not its author;
// 409 `stale` with `currentRevision`; 200 `{ revision }`, the same revision
// when nothing changed. The session keeps its `submitted_at`, linked request,
// School, Program, academic year and author. No log line holds note text: a
// failure logs the Student's `student.id`, the session id, the status and the
// error name.
export const PATCH = withAiTestInsightsStudentWrite<SessionNotesDraftRequest, Params>(
  {
    log: "AI Test Insights session edit failed",
    message: "Session Notes could not be saved",
    logIds: ({ sessionId }) => `session=${parseAiTestInsightsId(sessionId) ?? "invalid"}`,
  },
  (raw) => parseSessionNotesEditRequest(raw, getTodayIST()),
  async ({ student, actorUserId, body, params }) => {
    const sessionId = parseAiTestInsightsId(params.sessionId);
    if (sessionId === null) return notFound();
    const { expectedRevision, ...notes } = body;
    const result = await saveSessionNotes({ mode: "edit", student, actorUserId, notes, expectedRevision, sessionId });
    if (result.outcome === "not_found") return notFound();
    if (result.outcome === "not_author") {
      return NextResponse.json({ error: "Only the author can edit these notes." }, { status: 403 });
    }
    if (result.outcome !== "saved") return sessionNotesRefusalResponse(result);
    const saved: SessionNotesEditResponse = { revision: result.revision };
    return NextResponse.json(saved);
  },
);

function notFound(): Response {
  return NextResponse.json({ error: "Insight Session not found" }, { status: 404 });
}
