# 2026 Holistic Student Profile Source and Identity Contract

- **Research date:** 2026-07-13
- **Wayfinder ticket:** [Establish the 2026 Holistic Student Profile source and identity contract](https://github.com/avantifellows/af_lms/issues/178)

## Answer

The operational source of truth for the 2026 Student Profile questionnaire is Quiz MongoDB, not LMS Postgres and not the reporting DynamoDB table. The Grade-specific Quiz forms hold the current questionnaire definition, and each student's answers are embedded in a Quiz Session. The existing `etl-data-flow` pipeline projects those records into BigQuery.

For the inspected 2026 production records, Quiz `user_id` is the canonical LMS `user.id` rendered as a string. Resolve it through `student.user_id`, require exactly one Student match, and use the resulting `student.id` as the canonical Holistic Mentorship foreign key:

```text
quiz.sessions.user_id (string)
    = user.id (rendered as string)
    = student.user_id (rendered as string)
    -> student.id
```

Do not join current 2026 responses to `student.student_id`. Historical records need a separate, explicit migration mapping because at least one 2025 profile uses the business Student ID instead.

The source has no explicit questionnaire version. A Quiz ID can currently be regenerated in place, and existing responses do not contain a questionnaire snapshot. The later profile-lifecycle and architecture decisions must therefore define a freeze/version rule before relying on Quiz ID as a stable revision.

## Live 2026 Forms

Read-only production LMS and Quiz API inspection found these active forms:

| Grade | AF Session row | AF Session ID | Quiz/Form ID | Quiz title |
| --- | ---: | --- | --- | --- |
| 11 | `17391` | `EnableStudents_6a44a83d1184e717b920c499` | `6a44a83d1184e717b920c499` | Student Profile Grade 11 |
| 12 | `17459` | `EnableStudents_6a4deca8e030ebe34669fb0f` | `6a4deca8e030ebe34669fb0f` | Student Profile Grade 12 |

Product sign-off on 2026-07-15 confirmed these two AF Sessions and Quiz IDs as the v1 Student Profile inputs. The separately supplied `Student Mentoring Baseline G11` (`6a4f2714271be5caf8cf4ccd`) and `Student Mentoring Baseline G12` (`6a4f2ba6e4ee4031d40231db`) forms are explicitly excluded from Profile generation.

Both forms are open from July through August 2026 and were created from Google Sheet `1F_W58M6Uw2U-XsGgK3ocAfnH2ifPcZRCfaNCt9i_c1E`, tab `Student Profile Questions`. The live payloads are the primary questionnaire evidence: [Grade 11 form](https://quiz-backend.avantifellows.org/form/6a44a83d1184e717b920c499?single_page_mode=true) and [Grade 12 form](https://quiz-backend.avantifellows.org/form/6a4deca8e030ebe34669fb0f?single_page_mode=true).

The two forms currently have the same shape:

| Property | Current value |
| --- | --- |
| Questions | 34 |
| Themes | 5 |
| Question types | 14 single-choice, 5 multi-choice, 15 matrix-rating |
| Attempts allowed | 1 |
| Require every question | No |
| Shuffle | No |
| Priority | All 34 questions are `low` |

Theme counts are 3 Student and Family Background, 6 Academic Performance and Perception, 10 Career Aspiration/Readiness/Exposure/Skill, 7 Support System and Guidance Access, and 8 Barriers and Challenges.

The 66-question Grade 11 PDF in the supplied PRD assets is explicitly a 2025 sample. It is useful as a legacy output example, not as the 2026 questionnaire schema.

## Source and Writer

The Google Sheet is the authoring/import input. After creation, Quiz MongoDB is the operational source:

- The form endpoint reads the Quiz document from `quiz.quizzes` and its Questions from `quiz.questions`: [Quiz form endpoint](https://github.com/avantifellows/quiz-backend/blob/22ff7bc93638af1961a57efdb3f7769e2def9574/app/routers/forms.py#L13-L60).
- The Quiz model holds form metadata and Question metadata, while a Quiz Session holds `user_id`, `quiz_id`, lifecycle timestamps, completion state, and embedded Session Answers: [Quiz and Session models](https://github.com/avantifellows/quiz-backend/blob/22ff7bc93638af1961a57efdb3f7769e2def9574/app/models.py#L101-L150), [Session Answer and Session models](https://github.com/avantifellows/quiz-backend/blob/22ff7bc93638af1961a57efdb3f7769e2def9574/app/models.py#L406-L476).
- The Quiz frontend creates a Session with the authenticated Portal User ID and Quiz ID: [Portal identity lookup](https://github.com/avantifellows/quiz-frontend/blob/29c9c6b968b66c8accb7bd6bfc2c0207f7f34a1f/src/services/portalAuth.ts#L97-L126), [Session creation](https://github.com/avantifellows/quiz-frontend/blob/29c9c6b968b66c8accb7bd6bfc2c0207f7f34a1f/src/services/API/Session.ts#L44-L60).
- Answer writes update the embedded answer and bump the Session's `updated_at`: [answer update](https://github.com/avantifellows/quiz-backend/blob/22ff7bc93638af1961a57efdb3f7769e2def9574/app/routers/session_answers.py#L59-L72), [single-answer update](https://github.com/avantifellows/quiz-backend/blob/22ff7bc93638af1961a57efdb3f7769e2def9574/app/routers/session_answers.py#L87-L159).
- Ending a Session sets the completion flag and end timestamp, but the answer-update endpoints do not reject later changes: [end Session](https://github.com/avantifellows/quiz-backend/blob/22ff7bc93638af1961a57efdb3f7769e2def9574/app/routers/sessions.py#L545-L587), [answer update](https://github.com/avantifellows/quiz-backend/blob/22ff7bc93638af1961a57efdb3f7769e2def9574/app/routers/session_answers.py#L87-L159).

The old `etl-data-flow` pipeline resolves an AF Session to its Quiz ID, reads the latest Quiz Session for each User, expands the embedded answers, and writes the projections to BigQuery `avantifellows.assessments.form_responses` and `avantifellows.assessments.all_responses_form_level`: [target definitions](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/quizzes/lambda_function.py#L77-L94), [form extraction](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/quizzes/lambda_function.py#L726-L830), [response shaping](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/quizzes/lambda_function.py#L1597-L1669), [BigQuery writes](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/quizzes/lambda_function.py#L1351-L1387).

`etl-next` does not currently ingest form responses. Its registered flows and declared assessment sources contain no form-response source: [flow registry](https://github.com/avantifellows/etl-next/blob/f86ac4acb25d1f484297ed94557e336910cdf08f/orchestrator/flows/__init__.py#L31-L54), [dbt sources](https://github.com/avantifellows/etl-next/blob/f86ac4acb25d1f484297ed94557e336910cdf08f/dbt/models/sources.yml#L4-L47).

## Identity Evidence

The LMS distinguishes these identifiers:

- `user.id`: canonical User primary key.
- `student.id`: canonical Student primary key and the appropriate Holistic Mentorship foreign-key target.
- `student.user_id`: foreign key to `user.id`.
- `student.student_id`: external/business Student ID.

The schema evidence is in the db-service [User schema](https://github.com/avantifellows/db-service/blob/91820ae6072d8e0412b800e963f4bccad36360b5/lib/dbservice/users/user.ex#L17-L42) and [Student schema](https://github.com/avantifellows/db-service/blob/91820ae6072d8e0412b800e963f4bccad36360b5/lib/dbservice/users/student.ex#L13-L65). ETL also keeps these identities separate: [student identity fields](https://github.com/avantifellows/etl-next/blob/f86ac4acb25d1f484297ed94557e336910cdf08f/dbt/models/intermediate/student/int_student_profile.sql#L5-L12) and [dimension aliases](https://github.com/avantifellows/etl-next/blob/f86ac4acb25d1f484297ed94557e336910cdf08f/dbt/models/production/student/dim_student.sql#L32-L36).

Read-only production snapshots on 2026-07-13 independently checked the live form IDs in BigQuery and their Users in LMS Postgres:

| Grade | Quiz Users | Canonical Student matches | Business Student ID matches | Unmatched |
| --- | ---: | ---: | ---: | ---: |
| 11 | 76 | 75 | 0 | 1 (`test_admin`) |
| 12 | 36 | 35 | 0 | 1 (`test_admin`) |

The 75 Grade 11 and 35 Grade 12 real Users each joined exactly one production `student` row through `student.user_id`. The current production `student` snapshot also had no null or duplicate `student.user_id` values across 493,711 rows. That is observed data quality, not a database uniqueness guarantee, so ingestion must still require exactly one match.

The legacy 2025 sample demonstrates identifier drift: its source value `2759526011` matches `student.student_id`, while that Student's canonical `user.id` is different. An existing migration script also documents historical conversion from Student IDs to User IDs: [legacy DynamoDB User ID migration](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/quizzes/migrate_ddb_user_id.py#L1-L10). This proves that historical datasets cannot safely use the live 2026 join rule without an explicit migration inventory.

## Version and Update Semantics

The source does not expose a form-level revision, `created_at`, `updated_at`, or content hash. The GSheet importer maps rows to ordered Questions and sets `priority=high` only when the Sheet's `Summary` cell is `yes`: [GSheet mapping](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/sessionCreator/GsheetInterface.py#L608-L671), [priority mapping](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/sessionCreator/GsheetInterface.py#L313-L327).

A new import creates a new Quiz ID, but the regenerate path updates the existing Quiz and Questions by array position without recording a revision: [regeneration](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/sessionCreator/SessionCreator.py#L165-L206), [in-place Question updates](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/sessionCreator/SessionCreator.py#L501-L527). Because a Quiz Session stores Question IDs and answers rather than a full questionnaire snapshot, a later in-place change can alter how an older response is interpreted.

The source has answer-level and Session-level timestamps, and Session `updated_at` is the best available incremental cursor. The current BigQuery projection does not retain that source timestamp or a schema version. Completion also does not imply a complete or immutable response because all questions are optional and the answer API permits later updates.

### Required follow-up contract

These are requirements for the later lifecycle and architecture decisions, not claims about current behavior:

1. Once a form has responses, freeze that Quiz ID. Questionnaire changes must create a new Grade-specific Quiz ID.
2. Preserve the Quiz/Form ID, AF Session ID, per-User Quiz Session ID, raw source User ID, Question IDs and positions, completion state, source `updated_at`, and a questionnaire schema snapshot or content hash.
3. Resolve 2026 User IDs only through `user.id`/`student.user_id`; reject test, missing, or ambiguous records instead of guessing.
4. Handle legacy Student IDs through a declared migration mapping. Never silently fall back from User ID to business Student ID.
5. Decide the authoritative ingestion boundary between Quiz MongoDB and its BigQuery projection in [Define Holistic Mentorship data ownership and cross-repo contracts](https://github.com/avantifellows/af_lms/issues/192).

## Reporting Compatibility

The current reporting app is not a usable 2026 source:

- It reads only DynamoDB `form_question_responses`: [reader](https://github.com/avantifellows/reporting/blob/459b6dbb90566622481ab67a3e8ffaff3c0287f2/app/db/form_responses_db.py#L15-L37).
- The old ETL's DynamoDB upload is disabled: [disabled writer](https://github.com/avantifellows/etl-data-flow/blob/19c62508217c59a7cf1a49bc3ee30072ff95f430/flows/quizzes/lambda_function.py#L1449-L1455).
- A read-only production DynamoDB snapshot on 2026-07-13 found zero rows for either 2026 Quiz ID. Its Student Profile rows are legacy 2025-shaped data.
- Reporting includes only themes with at least one `high` priority question and generates the AI summary on every HTML or PDF request: [theme filtering and request-time generation](https://github.com/avantifellows/reporting/blob/459b6dbb90566622481ab67a3e8ffaff3c0287f2/app/routers/form_responses.py#L138-L204).
- It sends up to eight answered high-priority responses and the raw User ID to OpenRouter, without storing the result: [LLM request](https://github.com/avantifellows/reporting/blob/459b6dbb90566622481ab67a3e8ffaff3c0287f2/app/utils/llm_summary.py#L35-L93).

Because every current 2026 question is `low`, current reporting would render no response themes or AI summaries even if the rows existed in DynamoDB. The later lifecycle decision therefore ignores Quiz priority, uses every answered Question, generates one durable summary per ordered Question Set, and retains outputs by prompt version and model.

## Environment Status

| Environment | Evidence on 2026-07-13 |
| --- | --- |
| Production | Both AF Sessions exist; both forms return live Quiz schemas; BigQuery contains current response projections; real source User IDs resolve to one Student each. |
| Staging | No matching Grade 11 or Grade 12 AF Session registration exists in LMS Postgres. |
| Local | No maintained 2026 form-response fixture or sync path exists in `etl-next`. |

Identity is therefore proven for the inspected production records, not across every environment. Staging and local verification require an explicit non-production source or fixture. Production data must not silently serve as the staging contract.

## Decision Boundary

This research settled the source and current identity interpretation. Subsequent Wayfinder decisions settled privacy in [#179](https://github.com/avantifellows/af_lms/issues/179) and generation lifecycle in [#186](https://github.com/avantifellows/af_lms/issues/186). The maintained BigQuery reader, durable writer, table ownership, and cross-repo execution contract remain for [#192](https://github.com/avantifellows/af_lms/issues/192); this investigation does not create a separate implementation ticket.
