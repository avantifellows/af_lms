import { NextResponse } from "next/server";

import { actorUserId } from "@/lib/actor-user";
import { readTimeline } from "@/lib/ai-test-insights-history";
import { NO_STORE } from "@/lib/ai-test-insights-request-routes";
import { readOwnDraft, saveSessionNotes } from "@/lib/ai-test-insights-session-notes";
import {
  parseSessionNotesSubmitRequest,
  type AiTestInsightsSessionsResponse,
  type SessionNotesAccess,
  type SessionNotesDraft,
  type SessionNotesSubmitResponse,
} from "@/lib/ai-test-insights-session-notes-rules";
import {
  sessionNotesRefusalResponse,
  withAiTestInsightsStudent,
  withAiTestInsightsStudentWrite,
} from "@/lib/ai-test-insights-student-routes";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

// The Session Notes read of the AI Test Insights Student page (#574, physical
// centres only), never cached. The Student route opening gates first, as a
// read: 401 no session, 422 bad id, 403 no `ai_test_insights` view, 404
// Student missing, not listed or out of scope.
//
// 200 `{ timeline, draft, notesAccess }`. `notesAccess` is `write` (access
// `edit` and a User, found by the shared actor lookup), `no_linked_user`
// (access `edit`, no User) or `read`. `draft` is the caller's own draft, or
// null: a draft is never returned to anyone but its author, and a viewer
// writes none, so it is read for a Teacher with a User only. `timeline` is
// the Student's History (#576): every submitted Insight Session and every
// `completed` Test Insight no session records, newest first, across all
// years, Teachers, Schools and Programs. `isAuthor` is true only on the
// caller's own sessions, and only for a caller who may write notes.
export const GET = withAiTestInsightsStudent(
  { log: "AI Test Insights sessions read failed", message: "Session Notes could not be loaded", headers: NO_STORE },
  async ({ student, actor }) => {
    let notesAccess: SessionNotesAccess = "read";
    let draft: SessionNotesDraft | null = null;
    let author: number | null = null;
    if (student.canEdit) {
      author = await actorUserId(actor.email, actor.linkedUserId);
      notesAccess = author === null ? "no_linked_user" : "write";
      if (author !== null) draft = await readOwnDraft(student.studentId, author);
    }
    const timeline = await readTimeline(student.studentId, author);
    const response: AiTestInsightsSessionsResponse = { timeline, draft, notesAccess };
    return NextResponse.json(response, { headers: NO_STORE });
  },
);

// Submit (#575): turns the acting Teacher's saved draft into an Insight
// Session, linked to the AI Summary open on the page (`openRequestKey`, null
// for none). The Student route opening gates first, as a write: 401 no
// session, 422 bad id, 403 no `ai_test_insights` view, 403 access not `edit`
// (before any Student read), 404 Student missing, not listed or out of scope;
// then the body (422 with the failing field: the final rule, with today in
// India from the server's clock; an `expectedRevision` below 1; no `draftId`;
// a bad `openRequestKey`); then the acting User (409 `no_linked_user`). Then
// the Session Notes module's answer: 201 `{ sessionId, revision }`; 409
// `stale` with `currentRevision` (0 when the caller has no draft) when there
// is no draft with that id at that revision, so a second press (or a second
// tab) makes no second session; 422
// `openRequestKey` when the key is not a `completed` request of this Student.
// No log line holds note text.
//
// An optional `centre` query value, as on the Student page, picks the centre
// whose School and Program the Insight Session records.
export const POST = withAiTestInsightsStudentWrite(
  { log: "AI Test Insights session submit failed", message: "Session Notes could not be submitted" },
  (raw) => parseSessionNotesSubmitRequest(raw, getTodayIST()),
  async ({ student, actorUserId: author, body }) => {
    const { expectedRevision, draftId, openRequestKey, ...notes } = body;
    const result = await saveSessionNotes({
      mode: "submit",
      student,
      actorUserId: author,
      notes,
      expectedRevision,
      draftId,
      openRequestKey,
    });
    if (result.outcome !== "submitted") return sessionNotesRefusalResponse(result);
    const submitted: SessionNotesSubmitResponse = { sessionId: result.sessionId, revision: result.revision };
    return NextResponse.json(submitted, { status: 201 });
  },
);
