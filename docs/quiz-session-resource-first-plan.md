## **Quick Summary**

- Curriculum team prepares one clean CSV with CMS link + PDFs.
- System prepares quiz resources in advance.
- When teacher creates a session, system creates a **fresh quiz_id** for that run and links it to that session.
- Teacher only picks batch + test format + quiz, then starts test.
- On **End + Sync**, data is synced for that session.
- For cross-school merged analytics, we group by **cms_test_id** (same paper identity), while session reports continue by `session_id`.

## **What We Already Have**

- Teachers can already create quiz sessions in LMS (current PR direction).
- `sessionCreator` + DB service already handle session writes, duplication, patches.
- Quiz sync pipeline is triggered by `session_id` and writes to BigQuery + DynamoDB.
- Reporting reads student report data by `session_id + user_id`.

---

## **What We Will Add**

### **Recommended direction**

Use one stable content identity from CMS, but create a fresh Mongo `quiz_id` whenever a teacher creates a session.

- Stable cross-school identity: `cms_test_id` from CMS link (this is the merge key across schools).
- Runtime execution identity: new `quiz_id` (Mongo `_id`) for each created session.
- Reporting identity remains: `session_id`.

This keeps current sync/reporting flow mostly unchanged and avoids cross-school attempt mixing.

### **End-to-end flow (CSV -> resource -> session -> test -> sync -> reports)**

#### **1) Curriculum CSV (first step)**

One row = one pre-created test resource.

**Mandatory columns only**

- `test_name`
- `test_format`
- `cms_link`
- `question_pdf`
- `solution_pdf`

**Rules**

- No merged cells.
- No blank headers.
- `cms_link` must be full URL.
- Grade can be auto-derived from selected batch at session creation time (no separate mandatory grade column needed in CSV).

#### **2) Resource creation (a priori, before schools start sessions)**

For each CSV row:

- Parse `cms_link` and store `cms_test_id` internally.
- Create one base quiz resource in Mongo (`base_quiz_id`) and store links/metadata in resource table.
- Keep `cms_test_id` as the future merged analytics key.

**Example resource row**

| field | value |
|---|---|
| `resource_id` | `R_2026_0012` |
| `test_name` | `AIET-01-G11-PCM` |
| `test_format` | `fst` |
| `cms_link` | `https://cms.peerlearning.com/tests/6874d45b...` |
| `cms_test_id` (merge key) | `6874d45b...` |
| `question_pdf` | `https://drive.google.com/.../question.pdf` |
| `solution_pdf` | `https://drive.google.com/.../solution.pdf` |
| `base_quiz_id` | `66ed30e393b2012d9f18e796` |
| `status` | `ready` |

#### **3) Teacher creates session in LMS**

Teacher effort should stay minimal:

- Select `Batch`
- Select `Test Format`
- Select a `Quiz` from shortlist (list from resource table -- which got filled from curriculum sheet)

Auto behavior:

- Grade auto-derived from selected batch.
- Start time default = now.
- End time default = start + default duration (for example 6h).
- `session_id` must be unique per run. If every run gets a fresh `quiz_id`, `group + quiz_id` is acceptable.

When teacher clicks **Create**:

- System clones base quiz to a fresh `quiz_id` (or generates fresh quiz from source).
- Session is created against this fresh `quiz_id`.
- Session occurrence is created.
- LMS shows `question_pdf` and `solution_pdf` links in session details.

#### **4) During test (student + teacher experience)**

- Students see only sessions allowed by their mapped groups/batches.
- Teacher sees one live number: **Started** (count of distinct students who have started).
- Attendance source: `user_session` + active session occurrence. (can also rely on mongoDB here)

#### **5) Teacher clicks End + Sync**

- On click, patch actual session end time to click timestamp.
- Sync event is queued by `session_id`.
- Status shown to teacher: queued -> processing -> done.

#### **6) After sync (BQ + reporting)**

- Existing session-level reports continue to work (`session_id + user_id`).
- For cross-school merged views, group by `cms_test_id`.
- No major rewrite needed in current reporting routes for session-level usage.

### **Why “base resource + fresh quiz per session” can still help**

- **Base resource** gives pre-validated content and links before exam day.
- **Fresh quiz per session** gives clean attempt isolation for sync/reporting.
- Yes, questions are reused from the same source; benefit is operational reliability and lower sync risk, not new content generation.

---

### **Concrete sessionCreator changes**

- Input to session creation should include selected `resource_id`.
- Resolve `base_quiz_id` from resource.
- Create fresh `quiz_id` from base quiz.
- Create unique `session_id` per run (current `group + quiz_id` is okay if quiz is always fresh).
- Patch session with links/status as today.
- On `End + Sync`, patch occurrence/session end time and enqueue sync.

---

### **Alternative: shared `quiz_id` across schools**

This means Adilabad and Palghar both run the same Mongo `quiz_id` directly.

**What is good**

- Fewer quiz docs in Mongo.
- Easy to say “same exact quiz object reused”.

**What is risky today**

- Current quizzes ETL fetches attempts by `quiz_id`; this can mix attempts from both schools if same quiz is reused.
- If one school needs quiz-doc-level changes (for example shuffle true/false), shared quiz gets tricky.

**What is needed if we choose this**

- Add explicit auth-session reference in mongo session docs.
- ETL must filter by that session reference, not only by `quiz_id`.
- Strict policy on what can/cannot mutate on shared quiz doc.

---

### **Tradeoffs (recommended vs alternative)**

| Choice | Pros | Cons |
|---|---|---|
| **Fresh quiz instance per session (Recommended now)** | Clean attempt isolation; no clash if `session_id = group + quiz_id`; minimal risk to existing sync/reporting | More quiz docs; need merge by `cms_test_id` for cross-school view |
| **Shared quiz_id reuse** | Fewer quiz docs; one common quiz object | ETL/report mixing risk unless attempt model changes; shared mutation conflicts |

---

## **What A Teacher Will Do (Effort Required)**

1. Open Quiz Sessions tab.
2. Select batch.
3. Select test format.
4. Select quiz from shortlist.
5. Click Create.
6. Monitor one live number: Started.
7. Click End + Sync when test is over.

---

## **What The Teacher Gets After Clicking Create**

- Session appears immediately.
- Student link is ready.
- Question and solution PDF links are visible.
- Live Started count during the test.
- Sync status after ending the test.
- Session-level reports once sync finishes.

---

## **Why This Is Useful**

- Teacher flow is simpler and faster.
- Curriculum team can pre-create tests in a consistent CSV process.
- Session-level reporting remains stable with minimal backend disruption.
- Cross-school merged analytics stay possible using `cms_test_id`.

---

## **Open Question**

1. When should cross-school rank be marked “final” for the same `cms_test_id` (same-day cutoff vs manual finalize)?
