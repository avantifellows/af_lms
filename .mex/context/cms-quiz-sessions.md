---
name: cms-quiz-sessions
description: The CMS-sourced quiz-session lifecycle (create / edit / regenerate) across af_lms, quiz-backend and db-service — which field lives in which store, the IST time convention, and the invariants that break silently. Load before touching quiz-session create, edit, regenerate, or session timing.
triggers:
  - "quiz session"
  - "cms session"
  - "chapter test"
  - "shuffle"
  - "show answers"
  - "show scores"
  - "review_immediate"
  - "session_end_time"
  - "answer visibility"
  - "regenerate"
  - "session occurrence"
  - "nex-gen-cms"
edges:
  - target: context/data-access.md
    condition: when deciding which backend a quiz-session field is written to
  - target: context/architecture.md
    condition: when tracing the request flow across af_lms / quiz-backend / db-service
  - target: patterns/db-service-write.md
    condition: when adding a session or occurrence write
last_updated: 2026-07-28
---

# CMS-sourced quiz sessions

Sessions built from the new CMS (`meta_data.cms_source === "nex-gen-cms"`, `CMS_SOURCE` in
`src/lib/cms-tests.ts`) are created synchronously by af_lms, replacing the legacy
SNS → etl-data-flow `sessionCreator` Lambda. Legacy sheet-driven sessions still go through
that Lambda, so **both paths are live** and must stay at feature parity.

## The one thing that breaks silently: two homes per setting

Display/scoring settings exist in **two stores**, and only one of them is what students see:

| Setting | Session `meta_data` | Quiz doc | What the quiz player reads |
|---|---|---|---|
| shuffle | `shuffle` | `shuffle` | **quiz doc** |
| show scores | `show_scores` | `show_scores` | **quiz doc** |
| show answers | `show_answers` | **`review_immediate`** | **quiz doc** |
| name | session row `name` | `title` | quiz doc (display) |
| gurukul format | `gurukul_format_type` | — | *no quiz-doc home* |

Writing only the session `meta_data` makes the LMS UI look correct while the quiz behaves the
opposite way. That was a real shipped bug: the CMS create path wrote meta_data only, so every
chapter test ran with shuffle off and answers shown immediately regardless of the form
(`map_cms_test_to_quiz` hardcodes `shuffle: False`; the `Quiz` model defaults the other two to
True). Fixed by sending all three to `POST /quiz/from-cms`.

Note the rename: the form's **"show answers"** is the quiz doc's **`review_immediate`**, *not*
`display_solution`. It means "review answers immediately after submission" and is turned off
during concurrent testing so a later slot can't get answers from an earlier one.

etl-data-flow fixed the same gap for the Lambda path in `NewCmsInterface.configure_new_cms_quiz`
(2026-07-15). If you change settings behaviour, change both or they diverge.

## Answer visibility: the offset belongs to quiz-backend

`quiz.metadata.session_end_time` is **not** the session window end — it is the window end
**plus the quiz duration** (`time_limit.max`), i.e. the moment the last possible attempt could
finish. Storing the raw end opens a copying window for students still mid-test.

**quiz-backend owns that offset** (`app/services/quiz_time.py`, ported from the Lambda's
`_quiz_answer_visibility_end_time`). af_lms sends the **raw** window end. Pre-offsetting in the
LMS double-counts it.

If `session_end_time` is null the frontend never gates review, so `review_immediate=false`
silently shows answers immediately — send the window end on create *and* on timing edits.

## IST times: the `Z` is a lie, deliberately

`utcToISTDate` shifts a true-UTC instant by +5:30 and re-serializes with a `Z`. So
`2026-04-15T14:00:00.000Z` in the session row means **2:00 PM IST**. The session row and
`session_occurrence` both rely on that convention — don't "fix" it.

quiz-backend parses a *naive* datetime, so the quiz doc gets the bare wall-clock with the `Z`
dropped, via the single helper `istWallClockWindowEnd` (`src/lib/quiz-session-time.ts`). All
three paths (create / edit / regenerate) use it so they cannot drift.

## Portal gates on the occurrence, not the session row

`portal-backend` decides whether a quiz is open from **`session_occurrence`**, not the session
row. A timing edit that updates only the session row leaves the quiz opening and closing at the
**old** time while the LMS shows the new one.

Quiz sessions are `continuous` → exactly **one** occurrence per session. So:
`GET /session-occurrence?session_id=…` → `PATCH /session-occurrence/{id}`. af_lms owns this;
no etl-data-flow involvement. If the lookup returns `[]` the route **502s** rather than
returning 200 — a silent success here is the precise failure the sync exists to prevent.

## Regenerate is in-place and does not re-score

CMS sessions regenerate via `PUT /quiz/{id}/from-cms`, which re-ingests the corrected test into
the **same** quiz/set/question `_id`s so the session and already-submitted attempts stay linked.
The legacy SNS `regenerate_quiz` cannot rebuild a CMS quiz at all (it rebuilds from a sheet row)
and only parks the session in a stuck `pending`.

Two consequences to respect:

- **409 on structure change.** If the corrected test reorders questions or deletes-and-adds one,
  quiz-backend refuses rather than remapping answer keys onto the wrong questions. Surface that
  message verbatim — it needs a human decision, not a retry.
- **No re-scoring.** Attempts keep their original scores against the *old* answer key; scoring
  happens only at attempt time. The UI confirms this explicitly before proceeding. Re-scoring is
  unbuilt (Stream 3).

## Audit fields

`created_by` / `last_edited_by` / `last_edited_at` / `last_regenerated_by` /
`last_regenerated_at` live in session `meta_data`. etl-data-flow only ever **reads** them
(sheet round-trip + `session_action_audit.log_session_action`), so **whoever performs the action
writes them** — with the SNS hop gone, that is af_lms. Field names must match
`sessionCreator/session_action_audit.py`'s `ACTION_ACTOR_FIELDS`.

## Deploy order

quiz-backend ships **first**. The LMS edit path calls `PATCH /quiz/{id}` and the create path
sends the settings fields; if af_lms deploys first, CMS session edits 502 and create silently
falls back to defaults. `QUIZ_BACKEND_URL` must be set (Amplify staging + prod).

## Known debt

- **Orphan quiz on partial create failure** — the quiz is written to Mongo before the session
  row exists; if `/session` fails the quiz is orphaned and each retry builds another.
  quiz-backend has no `DELETE /quiz`.
- **Non-atomic regenerate** — question docs are written before the quiz doc, un-transactioned;
  a mid-loop infra failure leaves refreshed questions with a stale embedded grading subset.
- **Non-atomic edit** — session row / occurrence / quiz doc are three stores. Every write is an
  idempotent `$set`/PATCH, so a retry converges.
