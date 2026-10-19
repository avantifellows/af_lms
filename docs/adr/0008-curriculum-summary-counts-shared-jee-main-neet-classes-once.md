# Curriculum Summary counts a shared JEE Main and NEET class once

At Centres that run JEE Main and NEET in the same Grade, Physics and Chemistry are taught as one class, but teachers log and mark Chapter Completion under only one of the two Exam Tracks, so a per-track Summary showed the other track as untaught. Issue #417 therefore makes the Curriculum Summary and chapter timeline count logs and Chapter Completion from both tracks once for that shared class, while Curriculum logging, Chapter Completion, and the School Curriculum tab stay scoped by Exam Track as ADR 0002 decided. Only JEE Main with NEET is combined: JEE Main and JEE Advanced are taught to separate students, so a Centre and Grade mapped to both is treated as a Centre Management setup problem rather than merged.

## Consequences

- ADR 0002's "progress does not mix across Exam Tracks" still holds for stored data and the teacher-facing Curriculum tab, but not for the Curriculum Summary.
- If a teacher logs the same class under both JEE Main and NEET, the Summary counts its hours twice; logging stays unchanged, so this is accepted rather than deduplicated.
- Prescribed lecture time for the shared class comes from JEE Main, its Primary Exam Track.
