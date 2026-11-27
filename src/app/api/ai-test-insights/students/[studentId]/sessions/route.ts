import { NextResponse } from "next/server";

import { actorUserId } from "@/lib/actor-user";
import { NO_STORE } from "@/lib/ai-test-insights-request-routes";
import { readOwnDraft } from "@/lib/ai-test-insights-session-notes";
import type { AiTestInsightsSessionsResponse, SessionNotesAccess, SessionNotesDraft } from "@/lib/ai-test-insights-session-notes-rules";
import { withAiTestInsightsStudent } from "@/lib/ai-test-insights-student-routes";

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
// empty until the history timeline (#576).
export const GET = withAiTestInsightsStudent(
  { log: "AI Test Insights sessions read failed", message: "Session Notes could not be loaded", headers: NO_STORE },
  async ({ student, actor }) => {
    let notesAccess: SessionNotesAccess = "read";
    let draft: SessionNotesDraft | null = null;
    if (student.canEdit) {
      const author = await actorUserId(actor.email, actor.linkedUserId);
      notesAccess = author === null ? "no_linked_user" : "write";
      if (author !== null) draft = await readOwnDraft(student.studentId, author);
    }
    const response: AiTestInsightsSessionsResponse = { timeline: [], draft, notesAccess };
    return NextResponse.json(response, { headers: NO_STORE });
  },
);
