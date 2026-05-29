# Store LMS Curriculum Logs in db-service tables and expose LMS APIs from af_lms

LMS Curriculum Logs need durable shared storage, so their database tables and migrations belong in `db-service` alongside the existing curriculum, chapter, and topic schema. The LMS-facing APIs stay in `af_lms` because they depend on NextAuth session state, LMS feature permissions, school/program scope, and UI-specific progress aggregation; `db-service` remains the schema owner rather than the place where LMS authorization rules are duplicated.
