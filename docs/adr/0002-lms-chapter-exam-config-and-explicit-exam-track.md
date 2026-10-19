# Store LMS Chapter Exam Config by chapter and explicit exam track

Curriculum filtering and prescribed lecture time need durable config, so `db-service` will own an `lms_chapter_exam_configs` table with one row per chapter and exam track. `af_lms` will ask users to select the Exam Track explicitly in Curriculum rather than deriving it from teacher, school, or program, because current LMS data only records program access/assignment and does not reliably encode NEET/JEE orientation. LMS Curriculum Logs and Chapter Completion are also scoped by the selected Exam Track so actual progress does not mix across JEE Main, JEE Advanced, and NEET.

ADR 0006 supersedes only the global explicit Exam Track selection decision: issue #252 derives available Tracks from Centre Management. The chapter-and-track configuration and log scoping decisions remain active.

ADR 0008 narrows the log-scoping decision for reporting only: the Curriculum Summary counts a shared JEE Main and NEET class once across both tracks, while stored logs and Chapter Completion stay track-scoped.
