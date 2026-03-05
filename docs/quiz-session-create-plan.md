# Quiz Session Create (EnableStudents) — af_lms Plan (Updated)

## Scope
- Quiz sessions only.
- Only for `EnableStudents` auth group.
- Only `sign-in` sessions with `ID,DOB`.
- `id_generation = false`.
- Single-screen Create modal (no multi-step wizard).
- Timing is **continuous**; start defaults to now, end is teacher-provided.

## What’s Built in af_lms
1) **Quiz Sessions tab** on the school page.
2) **List view** of quiz sessions scoped to this school.
3) **Create modal** (single screen) with auto-derived fields + required inputs.
4) **Details modal** (read-only) with links + copy actions.
5) **Regenerate** action in table (3‑dot menu), disabled when status is `pending`.
6) **Auto refresh** every 30s to update status.
7) **Server routes**:
   - Fetch batches (school‑scoped + fallback).
   - Fetch sessions list.
   - Create session (db‑service).
   - Regenerate session (SNS).
8) **Seed script** to populate `school_batch` from the mapping sheet.

## Data Sources
- **af_lms DB** (`src/lib/db.ts`)
  - `school_batch`, `batch` for batch dropdown + filtering
  - `session` for list view (quiz sessions only)
- **db-service** (`DB_SERVICE_URL`)
  - `POST /session` to create the quiz session row
- **SNS**
  - Publish `{ action: "db_id", id: <session_pk_id>, environment: APP_ENV }` to trigger `sessionCreator`

## Batch Filtering (Resolved)
- Use **school_batch mapping** from the sheet (seeded into `school_batch`).
- Only **class batches** are shown (leaf batches; names shown, not ids).
- Filter to teacher’s `program_ids`.
- If school mapping is missing, fallback to all `EnableStudents` batches for teacher’s programs.

## Derived Fields (Auto)
From selected class batches:
- **Parent batch**: from `parent_id` (must be same for all selections)
- **Grade**: parsed from batch id (e.g. `EnableStudents_11_...` → `11`)
- **Stream**: parsed from batch id (`_Engg_` → `engineering`, `_Med_` → `medical`)
- **Course**: `medical → NEET`, `engineering → JEE`

Validations enforce that all selected class batches share the same parent, grade, and stream.

## Create Payload (db-service) — Example + Notes
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

  // IDs/links are filled by sessionCreator after SNS
  "session_id": "",
  "platform_id": "",
  "platform_link": "",
  "portal_link": "",

  // Timing
  "start_time": "<teacher input, default now>",
  "end_time": "<teacher input>",
  "repeat_schedule": { "type": "continuous", "params": [1,2,3,4,5,6,7] },
  "is_active": true,

  "purpose": { "type": "attendance", "params": "quiz" },

  "meta_data": {
    "group": "EnableStudents",
    "parent_id": "<derived parent batch id>",
    "batch_id": "<comma-separated class batch ids>",
    "grade": 11,
    "stream": "engineering",
    "course": "JEE",

    "test_type": "<user input>",
    "test_format": "<user input>",
    "test_purpose": "<user input>",
    "optional_limits": "<user input>",
    "cms_test_id": "<full CMS url>",

    // Defaults from quiz-creator
    "gurukul_format_type": "qa",
    "show_answers": true,
    "show_scores": true,
    "shuffle": false,
    "test_takers_count": 100,

    "next_step_url": "<optional>",
    "next_step_text": "<optional>",

    // Required by sessionCreator
    "status": "pending",
    "date_created": "<set on create>",
    "marking_scheme": "<4,-1 or 1,0 depending on test_type>",
    "has_synced_to_bq": false,
    "infinite_session": false,
    "number_of_fields_in_popup_form": "",

    // Filled later by sessionCreator
    "shortened_link": "",
    "report_link": "",
    "shortened_omr_link": "",
    "admin_testing_link": ""
  }
}
```

## Create Modal — Teacher Inputs
Required:
- **Session Name** (text)
- **Class Batches** (multi‑select, names shown)
- **Test Type** (dropdown)
- **Test Format** (dropdown)
- **Test Purpose** (dropdown)
- **Optional Limits** (dropdown)
- **CMS URL** (full CMS url)
- **Start Time** (datetime, default now)
- **End Time** (datetime)

Optional (only if enabled):
- **Next Step URL**
- **Next Step Text**

Auto‑filled (read‑only):
- Parent batch
- Grade
- Stream
- Course
- Show answers/scores/shuffle defaults (from quiz‑creator)
- Test takers count = 100

## List View (Table)
- Columns: **Name**, **Class Batches**, **Start**, **End**, **Portal Link**, **Admin Link**, **Status**, **Actions**
- Link icons in table; only icon click opens link.
- Row click opens details modal (read‑only).
- Top filter by **Class Batch**.

## Env / Config
Add these to Amplify env / `.env.production`:
- `DB_SERVICE_URL`, `DB_SERVICE_TOKEN`
- `AF_ACCESS_KEY_ID`, `AF_SECRET_ACCESS_KEY`, `AF_TOPIC_ARN`, `APP_ENV`

## Open Question
- **Session naming default** (no template yet). Decide if we want a standard prefix.
