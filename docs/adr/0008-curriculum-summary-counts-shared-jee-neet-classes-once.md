# Curriculum Summary counts a shared JEE and NEET class once

At Centres that run a JEE track and NEET in the same Grade, Physics and Chemistry are taught as one class, but teachers log and mark Chapter Completion under only one of the two Exam Tracks, so a per-track Summary showed the other track as untaught. Issue #417 therefore makes the Curriculum Summary and chapter timeline count logs and Chapter Completion from both tracks once for that shared class, while Curriculum logging, Chapter Completion, and the School Curriculum tab stay scoped by Exam Track as ADR 0002 decided. Two pairs are combined: JEE Main with NEET, and (curriculum owner decision Q20) JEE Advanced with NEET. JEE Main and JEE Advanced are taught to separate students, so a Centre and Grade mapped to both, with or without NEET, is treated as a Centre Management setup problem rather than merged.

## Consequences

- ADR 0002's "progress does not mix across Exam Tracks" still holds for stored data and the teacher-facing Curriculum tab, but not for the Curriculum Summary.
- If a teacher logs the same class under both of its tracks, the Summary counts its hours twice; logging stays unchanged, so this is accepted rather than deduplicated.
- Prescribed lecture time for the shared class comes from its JEE track, the Primary Exam Track: JEE Main for JEE Main + NEET, JEE Advanced for JEE Advanced + NEET. A Chapter the JEE track doesn't cover (such as Biology) uses NEET's.
- A shared class shows both PCM Behind and PCB Behind.
