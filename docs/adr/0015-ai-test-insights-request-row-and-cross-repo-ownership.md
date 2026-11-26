---
status: accepted
---

# AI Test Insights: the LMS owns the request row, AI Mentorship Guide generates from it

A Teacher asks for a Test Insight from the LMS, but the generator is AI Mentorship Guide: a separate app on one server that stops when idle, has one shared login with no per-user identity, and has no staging copy. We decided that the LMS writes an Insight Request row in Main Postgres, wakes the server through its public wake endpoint, and calls one token-protected enqueue endpoint. The generator reads only that row, runs its usual pipeline on the tests the row names, and records the result against it. The request row is the whole contract between the two apps.

- `db-service` owns the migrations and constraints for the `ai_test_insight_*` tables and exposes no API for them.
- `af_lms` owns authenticated reads and writes of those tables (Insight Requests, Session Notes) through its existing Postgres boundary, as it does for Holistic Mentorship (ADR 0005). It copies the Student's relevant earlier Session Notes onto the request row, reads run status from Main Postgres, and reads the Test Insight text and PDF from S3 with a read-only key.
- `ai-mentorship-guide` owns generation: the enqueue endpoint, running the tests named on the row instead of its own Tests To Consider list, picking up queued requests when it starts, and writing the outcome. One server serves staging and production. The enqueue call names its environment, and the server uses that environment's database connection and S3 prefix, as `etl-next` does for Holistic Student Profiles.

## Considered Options

- **The LMS logs in with the shared App Gate login and uses the existing AI Mentorship Guide APIs.** Rejected: there is no per-Teacher identity to record, and opening an old Test Insight would need the server awake.
- **Keep the server always on.** Rejected on cost. The server exists to be idle most of the day.
- **A second server for staging.** Rejected on cost and upkeep.
- **The generator reads the LMS Session Notes tables itself.** Rejected: it ties two apps to the notes schema, and the request row would no longer show what a Test Insight was built from.

## Consequences

- A Teacher's request is not lost while the server boots, which takes about two minutes: the row waits, and the generator also picks up queued requests on start-up.
- Past Test Insights open without waking the server.
- The production AI Mentorship Guide server holds staging database credentials.
- Validation stays off in AI Mentorship Guide, so v1 shows no validator warnings.
