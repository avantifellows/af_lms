# Historical Holistic Mentorship Notes Mapping Audit

- **Research date:** 2026-07-14
- **Wayfinder ticket:** [Audit returning-school historical notes and mapping quality](https://github.com/avantifellows/af_lms/issues/181)

## Answer

The supplied historical source contains **3,301 rows for 159 Students**. The rows represent one expanded Sheet response group per source Student ID, not 3,301 separate mentoring sessions. Each group has three identity questions and exactly four substantive note questions.

The safe v1 migration cohort is **42 current Grade 12 Students in Program ID `1` across four Schools**. Every one of those 42 resolves uniquely to a canonical LMS Student, User, School, current Grade, and Program. The historical source cannot resolve a canonical Holistic Phase because it contains no Phase, Grade, Program, academic-year, form-version, or submission identifier. It should therefore be treated as legacy starting context, not silently converted into ordinary LMS-authored Post-Session Notes. The exact context record and Phase linkage remain decisions for [Student Context resolution](https://github.com/avantifellows/af_lms/issues/187) and [cross-repo ownership](https://github.com/avantifellows/af_lms/issues/192).

The source is usable with controlled exceptions:

- import only exact, unique business Student ID matches in the current Program 1 cohort;
- preserve partial question sets rather than inventing missing answers;
- keep the canonical historical Mentor nullable when the source Teacher ID cannot be verified;
- preserve source prompt, option, answer, and timestamp provenance;
- quarantine unmatched identities instead of guessing between numeric ID namespaces.

## Sources and Method

The primary source was the private Google Sheet `post-mentorship-responses`, tab `mentorship_form_responses_all`, inspected through the existing read-only service account. The snapshot was read on 2026-07-14 at 00:16 IST. Its URL and raw rows are intentionally omitted from this public repository; the private planning thread holds the source reference.

Aggregate joins were checked against production LMS Postgres in an explicitly read-only transaction. The current launch roster was defined as academic year `2026-2027`, Grade 12, Program ID `1`, and not dropped out. Student, User, Teacher, School, Centre, membership, and enrollment tables were queried only for identity and aggregate validation. No production or Sheet data was changed or copied into the repository.

The LMS distinguishes canonical `student.id` and `user.id` from the external `student.student_id`; see the db-service [Student schema](https://github.com/avantifellows/db-service/blob/91820ae6072d8e0412b800e963f4bccad36360b5/lib/dbservice/users/student.ex#L13-L65) and [User schema](https://github.com/avantifellows/db-service/blob/91820ae6072d8e0412b800e963f4bccad36360b5/lib/dbservice/users/user.ex#L17-L42). The current Centre roster view derives Program attribution from School membership, current Grade enrollment, and batch Program membership: [centre_students view](https://github.com/avantifellows/db-service/blob/91820ae6072d8e0412b800e963f4bccad36360b5/priv/repo/migrations/20260706120000_create_centre_students_view.exs#L27-L74). This audit also follows the identifier separation established in the [2026 Student Profile source research](holistic-student-profile-source-and-identity.md#identity-evidence).

## Source Shape and Completeness

The source has nine columns: source Student ID, question position/type/text, combined response, matrix option/response, and start/end timestamps. It has seven stable question positions:

| Position | Meaning | Students with an answer | Students without an answer |
| ---: | --- | ---: | ---: |
| 0 | AF Teacher ID | 142 | 17 |
| 1 | Student Name | 141 | 18 |
| 2 | Mentor Name | 141 | 18 |
| 3 | Academic challenges | 133 | 26 |
| 4 | Academic recommendations | 125 | 34 |
| 5 | Non-academic challenges | 122 | 37 |
| 6 | Non-academic recommendations/support | 110 | 49 |

All 159 Students have a row for every question position. Matrix answers expand one Student-question into one row per option; the `matrix_option` and `matrix_response` columns are the clean migration fields. The combined `user_response` is repeated and denormalized for those questions and should not be imported as another answer.

Across the four substantive questions:

| Questions answered | Students |
| ---: | ---: |
| 4 | 107 |
| 3 | 12 |
| 2 | 11 |
| 1 | 4 |
| 0 | 25 |

There are no exact duplicate rows and no duplicate `(source Student ID, question position, matrix option)` keys. Every unanswered substantive question is represented by one clean blank placeholder. Every populated option has a populated response. Some nonblank answers are terse values such as variants of "no", "NA", or "nothing"; migration must preserve them as source content rather than infer richer meaning.

The source option labels contain spelling variants such as `Prepration`, `Helath`, and `Accomodation`, plus singular/plural variants of "No major issue(s) reported." A migration may map these through an explicit canonical-label table for display, but must retain the original source label for provenance.

## Student, School, and Program Mapping

The source Student ID is a legacy business identifier. Exact matching to `student.student_id` gives:

| Result | Source Students |
| --- | ---: |
| Exactly one canonical Student | 148 |
| Ambiguous exact matches | 0 |
| Unmatched | 11 |

All 148 exact matches also resolve to a canonical User and exactly one School. They span ten source Schools. The 11 unmatched values are not recovered by trimming, case normalization, or APAAR ID. Seven happen to collide with values in internal numeric Student/User ID namespaces, but that is not evidence that the source changed identifier type. Falling back to those namespaces would risk attaching sensitive notes to the wrong Student.

Applying current launch eligibility to the 148 exact matches produces this deterministic split:

| Disposition | Students |
| --- | ---: |
| Current Grade 12, Program 1, not dropped out | 42 |
| Current Grade 12, Program 78 | 11 |
| No current Grade enrollment | 95 |

The 42 migration candidates are distributed across four Program 1 Schools:

| School | LMS School ID | UDISE | Students |
| --- | ---: | --- | ---: |
| JNV Burdwan | 489 | 19260902703 | 4 |
| JNV Kokrajhar | 294 | 18250217004 | 30 |
| JNV Mahisagar | 372 | 24310504424 | 3 |
| JNV Puducherry | 573 | 34020101506 | 5 |

Each School has exactly one active Program 1 Centre, and every candidate has one current School/Program/Grade result. The 11 Program 78 Students are outside the agreed Program 1 launch. Historical or graduated Students with no current Grade are also outside the initial migration cohort.

The source itself does not prove School or Program at the time of collection. As a historical consistency check, all 42 launch candidates also have 2025-2026 Grade 11 Program 1 enrollment evidence, and the 11 excluded current Program 78 Students have 2025-2026 Grade 11 Program 78 evidence. This supports the cohort split but does not replace the current roster as the launch filter; older enrollment history contains multiple records for some Users.

The import must use this rule, without fallback:

```text
source student_id = student.student_id (exactly one match)
  -> canonical student.id and user.id
  -> exactly one current 2026-2027 Grade 12 School roster
  -> roster Program ID = 1
  -> Student is not dropped out
```

## Target-Cohort Note Quality

The 42 migration candidates have these substantive-note counts:

| Questions answered | Students |
| ---: | ---: |
| 4 | 29 |
| 3 | 4 |
| 2 | 4 |
| 1 | 2 |
| 0 | 3 |

Question-level coverage is 39 Students for academic challenges, 35 for academic recommendations, 34 for non-academic challenges, and 30 for non-academic recommendations/support. The cohort contains 573 populated matrix-answer rows. Two candidates lack AF Teacher ID, one lacks Student Name, and two lack Mentor Name.

Partial sets are valid historical evidence. The import must not synthesize missing answers. The three candidates with no substantive answer should not receive an empty historical-context record that appears to contain prior notes; their runtime fallback belongs to the Student Context decision.

## Mentor Mapping

AF Teacher ID is safer than Mentor Name, but is not complete enough to be mandatory:

| Result | All 159 source Students | 42 migration candidates |
| --- | ---: | ---: |
| Unique canonical Teacher match | 117 | 32 |
| Blank source Teacher ID | 17 | 2 |
| Unmatched source Teacher ID | 25 | 8 |

All 32 matched candidate Teachers are active and currently seated at the candidate Student's School. Thirty of their normalized Mentor Names agree with the canonical Teacher name; two are blank or differ. Across the full source, Mentor Name spellings are inconsistent and some names correspond to multiple Teacher IDs. Name alone is therefore not a safe canonical join.

The ten unresolved candidate Mentors require a reviewed exception mapping if a canonical Mentor link is needed. Their source Teacher ID and Mentor Name may be preserved as migration provenance, but the canonical Mentor field must remain nullable. Historical attribution must not create or change a live Holistic Mentor-Mentee Mapping.

## Timestamp Quality

Every Student has one consistent start time across their expanded rows, and at most one consistent end time.

| Check | Result |
| --- | --- |
| Start timestamps | 159/159 present and parseable |
| End timestamps | 126/159 present; 33 absent |
| Date range | 2025-12-17 through 2026-01-10 |
| End before start | 0 |
| Completed duration | 85 seconds minimum; 847.5 seconds median; 719,571 seconds maximum |
| Completed durations over 24 hours | 3 |

The Sheet timezone is `Asia/Calcutta`, while timestamp cells contain no timezone offset. Migration must interpret them in the Sheet timezone and preserve that provenance. The long-duration outliers show that start/end differences are not reliable meeting-duration measures. Three groups also share a start timestamp across multiple Students, so timestamps must not be used as unique submission keys.

## Phase and Session Limits

The source contains no School, Program, Grade, academic year, Holistic Phase, form/version, or submission ID. School, current Grade, and current Program can be reconstructed from the canonical Student roster for launch eligibility; a historical Phase cannot.

The common four-question structure and December-January date window show that the records belong to one historical collection exercise, but do not identify a future Holistic Phase. Assigning these rows directly to a new Phase ID would manufacture certainty the source does not contain. The four source question positions are stable, but they do not reference future admin-authored Holistic Question IDs; they must remain legacy question definitions unless a later contract explicitly maps them. The supplied PRD identifies returning-school notes as Grade 12 starting Student Context. The context-resolution and architecture tickets must decide how that provenance is stored and connected to the first available Grade 12 Phase.

## Migration Gate

The historical data is ready for a controlled migration design with these requirements:

1. Select only the 42 exact current Grade 12 Program 1 Student matches.
2. Quarantine the 11 unmatched source Student IDs; never try alternate numeric namespaces automatically.
3. Import populated matrix option/response rows and preserve partial question sets.
4. Preserve the source question position/text, original option label, source timestamps/timezone, and a source-snapshot identifier.
5. Do not create a historical-context record for the three candidates with no substantive answer.
6. Link the 32 verified candidate Mentors when useful; leave the other ten canonical Mentor links null unless a reviewed exception map resolves them.
7. Do not create live Mentor-Mentee Mappings or claim a canonical Phase from this source.
8. Make the later migration idempotent using source dataset + canonical Student + question position + matrix option, not timestamps or names; preserve the snapshot identifier separately for provenance.

This audit settles the source quality and deterministic eligibility rules. It does not choose the final table, API owner, context fallback, target Phase-linking mechanism, or reconciliation workflow.
