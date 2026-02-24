# Quiz Session Create (EnableStudents) — af_lms Plan

## Scope
- Quiz sessions only.
- Only for `EnableStudents` auth group.
- Only `sign-in` sessions with `ID,DOB`.
- `id_generation = false`.
- Single-screen Create modal (no multi-step timeline).
 - Timing is continuous and not editable by teachers.

## What We Need To Build In af_lms
1) **Quiz Sessions tab** under school page (JNV school view).  
2) **List view** for quiz sessions tied to the current school.  
3) **Create modal** (single screen) with prefilled + dropdown-driven fields.  
4) **Server routes** in `af_lms` for:
   - Fetching batch options (school batches + fallback to all EnableStudents batches)
   - Fetching sessions list (quiz only, school-scoped)
   - Creating a session (POST `/session` to db-service)
   - Publishing SNS `action: db_id` to trigger sessionCreator lambda

## Data Sources (DB-Service + LMS DB)
- **db-service** (via `DB_SERVICE_URL`):
  - `GET /batch` (filter batches)
  - `GET /session` (list quiz sessions)
  - `POST /session` (create session)
  - `GET /school-batch` (map school → batches)
- **af_lms DB** (via `src/lib/db.ts`):
  - Current school lookup (already done on school page)
  - No enrollment_record queries for this feature
  - `school_batch` is kept up-to-date from the new sheet mapping

## Batch Filtering (Resolved)
We will show batches relevant to **this school** and **this teacher’s program ids**.

**Approach:**
- Use `/school-batch?school_id=...` as the mapping source.
- Fetch those batches and filter by:
  - `auth_group_id == EnableStudents`
  - `program_id IN teacher.program_ids`

## Create Payload (Example + Annotations)
Below is the exact shape we will POST to db-service. It matches quiz-creator + sessionCreator expectations.

```jsonc
{
  "name": "<user input>",

  // Prefilled constants
  "platform": "quiz",
  "type": "sign-in",
  "auth_type": "ID,DOB",
  "redirection": true,
  "id_generation": false,
  "signup_form": false,
  "popup_form": false,
  "signup_form_id": null,
  "popup_form_id": null,

  // Session identifiers — lambda fills after SNS
  "session_id": "",
  "platform_id": "",
  "platform_link": "",
  "portal_link": "",

  // Timing — continuous only, not editable by teacher
  "start_time": "<auto now>",
  "end_time": "<auto now + default duration>",
  "repeat_schedule": { "type": "continuous", "params": [1,2,3,4,5,6,7] },
  "is_active": true,

  "purpose": { "type": "attendance", "params": "quiz" },

  "meta_data": {
    "group": "EnableStudents",
    "parent_id": "<parent batch id>",
    "batch_id": "<comma-separated class batch ids>",
    "grade": 10,

    "course": "<user input>",
    "stream": "<user input>",
    "test_format": "<user input>",
    "test_purpose": "<user input>",
    "test_type": "<user input>",
    "gurukul_format_type": "qa",
    "optional_limits": "<user input>",
    "cms_test_id": "<full CMS url>",

    "show_answers": true,
    "show_scores": true,
    "shuffle": false,

    "next_step_url": "<optional>",
    "next_step_text": "<optional>",

    "test_takers_count": 100,
    "status": "pending",
    "date_created": "<set on create>"
  }
}
```

## UI: Single-Screen Create Modal (Fields + Dropdown Sources)

### Prefilled + Hidden
- `platform = quiz`
- `group = EnableStudents`
- `type = sign-in`
- `auth_type = ID,DOB`
- `redirection = true`
- `id_generation = false`
- `signup_form = false`
- `popup_form = false`
- `repeat_schedule = continuous`

### User Inputs (with dropdown sources)
1) **Session Name** — text
   - No default template yet.

2) **Grade** — dropdown
   - Options: **10 / 11 / 12** (hardcoded list).

3) **Parent Batch** — dropdown
   - Source: `/school-batch` mapping filtered by `EnableStudents` + teacher program ids.
   - Fallback: all `EnableStudents` batches (like quiz-creator), still filtered by program ids.

4) **Class Batch** — multi-select dropdown
   - Source: child batches of selected parent batch.

5) **Quiz Details** (all user input):
   - **Test Type** (from quiz-creator): `assessment`, `homework`, `form`, `omr-assessment`
   - **Test Format**: `part_test`, `major_test`, `chapter_test`, `combined_chapter_test`, `full_syllabus_test`, `evaluation_test`, `hiring_test`, `mock_test`, `homework`, `questionnaire`
   - **Test Purpose**: `baseline`, `endline`, `weekly_test`, `monthly_test`, `reshuffling_test`, `selection_test`, `one_time`, `practice_test`, `class_hw`, `assignment`
   - **Course**: `NEET`, `Catalyst`, `Alpha`, `Hiring`, `Certification`, `Foundation`, `Photon`, `JEE`, `CUET`, `CA`, `CLAT`
   - **Stream**: `engineering`, `medical`, `maths`, `science`, `maths_science`, `physics`, `chemistry`, `biology`, `pcmb`, `botany`, `zoology`, `pcmba`, `tbd`, `business_studies`, `economics`, `nda`, `Others`, `ca`, `clat`
   - **Optional Limits**: `N/A`, `NEET`, `JEE`, `CUET`, `NA`
   - **CMS URL**: full CMS URL string required (text input)
   - **Gurukul Format**: fixed to `Q & A` (qa) by default
   - **Show Answers / Show Scores / Shuffle**: switches with defaults same as quiz-creator (show_answers=true, show_scores=true, shuffle=false)
   - **Next Step**: toggle; if on → ask for `next_step_url` + `next_step_text`

6) **Expected Attendance** — default `100` (not editable)

## List View (Quiz Sessions Table)
- Source: db-service `GET /session` with `is_quiz=true` and group filter `EnableStudents`.
- Filter by parent batch ids for this school.
- Show key columns: name, grade, batch, start/end, status, active.

## SNS + Lambda Trigger
- Add SNS publish helper in af_lms (like quiz-creator’s `Aws.js`).
- On successful POST `/session`, publish:
  - `{ action: "db_id", id: <session_pk_id>, environment: APP_ENV }`
- Lambda `sessionCreator` will create quiz, update session links, etc.

## Open Questions / Needs Before Implementation
1) **Session naming**: should we keep name empty or auto-fill a simple template?
