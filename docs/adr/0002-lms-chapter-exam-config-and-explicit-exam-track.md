# Store LMS Chapter Exam Config by chapter and explicit exam track

Curriculum filtering and prescribed lecture time need durable config, so `db-service` will own an `lms_chapter_exam_configs` table with one row per chapter and exam track. `af_lms` will ask users to select the Exam Track explicitly in Curriculum rather than deriving it from teacher, school, or program, because current LMS data only records program access/assignment and does not reliably encode NEET/JEE orientation. LMS Curriculum Logs and Chapter Completion are also scoped by the selected Exam Track so actual progress does not mix across JEE Main, JEE Advanced, and NEET.

