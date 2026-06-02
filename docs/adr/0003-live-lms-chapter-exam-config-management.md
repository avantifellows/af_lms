# Manage LMS Chapter Exam Config as live admin-edited data

Curriculum Config Management edits the live `lms_chapter_exam_configs` rows directly in v1 instead of introducing draft, versioned, or publishable config sets. This keeps the first admin tool small and useful after the one-time db-service loader bootstrap, but requires admin-only access, explicit confirmations, export support, and lightweight impact counts because changes immediately affect Curriculum options, school-level progress, and Curriculum Summary metrics for all schools.
