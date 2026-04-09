# Performance Dashboard Improvements

Status: **Spec / TODO** — not yet implementing

## Current State

The Performance tab (per school, per grade) has two views:

1. **Batch Overview**: Test cards with avg score, participation, gender split, subject bars. Filterable by chapter tests vs full tests.
2. **Test Deep Dive** (click into a test): Summary stats, subject analysis, chapter analysis, student results table.

Data sources: BigQuery tables `fact_student_test_results_overall` (student × section), `fact_student_test_results_chapter_level` (student × chapter), `dim_student`.

---

## Feature 1: Question-Level Analysis

**Goal**: Within the Test Deep Dive view, let teachers see which questions their students struggled with most, sorted by lowest accuracy first. Teachers use this to prioritize which questions to review in class.

### UI
- New expandable section in `TestDeepDive` below the existing Chapter Analysis
- Header: "Question Analysis" with count (e.g. "30 questions")
- Default: collapsed. Expands to a table/list sorted by % correct ascending
- Each row shows:
  - Question number/label (e.g. "Q1", "Q12")
  - Subject and chapter (if available)
  - % students correct (out of all who appeared)
  - Total attempts vs total appeared
  - Expandable sub-row: list of students who got it wrong (stretch goal)

### Data
- Source table: `all_responses_question_level` (or newer replacement — TBD, to be updated)
- Key columns needed: question identifier, student identifier, whether answer was correct, session_id, school UDISE, grade
- Query: aggregate by question, compute `correct_count / appeared_count`, order ASC
- Filter to same session_id + school + grade as the parent deep dive

### Open Questions
- [ ] Confirm exact table name and schema (newer table may exist)
- [ ] What question identifier is available? (question text, question number, question ID?) — need to check what the table has
- [ ] Do we want to show the question text inline or just a label?

### API
- New endpoint: `GET /api/quiz-analytics/[udise]/question-analysis?grade=X&sessionId=Y`
- Returns: `{ questions: QuestionAnalysisRow[] }` sorted by pct_correct ASC

---

## Feature 2: At-Risk Students

**Goal**: Flag students whose test performance is significantly below their assessed potential. The "potential" score is computed outside the LMS and stored in `dim_student`.

### UI
- New section in Batch Overview, above the test cards grid: "At-Risk Students" alert panel
- Shows students where actual performance is below their potential (threshold TBD)
- Each row: student name, potential score/level, actual avg %, gap
- Clickable to expand or navigate to the student's cumulative view (Feature 3)
- Visual indicator: red/orange badge or icon

### Data
- Potential field: column in `dim_student` (name TBD, e.g. `potential_score` or `potential_level`)
- Actual: computed from `fact_student_test_results_overall` — avg percentage across recent tests
- Comparison algorithm: **TBD** — placeholder until algorithm is defined

### Open Questions
- [ ] Exact column name for potential in `dim_student`
- [ ] Algorithm for "at risk" determination (absolute gap? percentage gap? z-score?)
- [ ] How many recent tests to consider for "actual" performance
- [ ] Should this appear on Batch Overview only, or also on the dashboard school cards?

### API
- New endpoint: `GET /api/quiz-analytics/[udise]/at-risk?grade=X`
- Returns: `{ students: AtRiskStudentRow[] }` — cannot implement until potential field and algorithm are defined

---

## Feature 3: Cumulative Student Performance

**Goal**: Show a per-student cumulative report across all full tests for a grade. Like a report card view with expandable rows per student.

### UI
- New view accessible from the PerformanceTab — likely a third view type alongside Batch Overview and Test Deep Dive (or a sub-tab within Batch Overview)
- Top-level: table of students, one row per student, sorted by cumulative avg % descending
- Columns: Student name, # tests taken, cumulative avg %, trend (improving/declining/stable), subject-wise avg %
- Expandable row per student showing:
  - Test-by-test breakdown: test name, date, score %, subject scores
  - Sparkline or mini trend chart (stretch goal)
- Filter: full tests only (likely; revisit if needed)

### Data
- Source: `fact_student_test_results_overall` filtered to full tests (non-chapter format), per school + grade
- Per student: aggregate across all sessions — avg percentage, per-subject avg, count of tests
- Trend: compare first half vs second half of tests, or last 3 vs prior

### API
- New endpoint: `GET /api/quiz-analytics/[udise]/cumulative?grade=X`
- Returns: `{ students: CumulativeStudentRow[] }` with nested `tests: CumulativeTestRow[]` per student

---

## Feature 4: Cross-CoE Rank & Comparison

**Goal**: For a given test, show how this school ranks against all other CoE schools that took the same test. Teachers see their school's position relative to the network.

### UI
- New section in Test Deep Dive, near the top (below summary stats): "Network Comparison"
- Shows:
  - This school's avg score for the test
  - Network average (across all CoEs for same test)
  - Rank: "Rank X out of Y schools"
  - Visual: bar or position indicator showing where this school falls
- Optional: subject-wise comparison (this school vs network avg per subject)

### Data
- Key insight: same test across schools is identified by `cms_test_id` (or similar column), NOT `session_id`. Each school gets its own session_id for the same underlying test.
- Query: for the given test's `cms_test_id`, aggregate across ALL schools — compute per-school avg, then rank
- Need to map from `session_id` → `cms_test_id` to find sibling sessions

### Open Questions
- [ ] Exact column name for the shared test identifier (`cms_test_id`? `test_id`? something else?)
- [ ] Is `cms_test_id` available in `fact_student_test_results_overall` or do we need a join?
- [ ] Should we filter to only CoE/Nodal schools (exclude NVS)?
- [ ] Privacy: confirmed — show rank and comparison to average, no individual school names

### API
- New endpoint: `GET /api/quiz-analytics/[udise]/network-comparison?grade=X&sessionId=Y`
- Needs to: look up `cms_test_id` from the session, then query all schools with same `cms_test_id`, compute per-school avg, return rank + network avg

---

## Implementation Order (Suggested)

1. **Feature 1 (Question Analysis)** — most self-contained, just needs the question-level table confirmed
2. **Feature 4 (Cross-CoE Comparison)** — needs `cms_test_id` column confirmed, then straightforward aggregation
3. **Feature 3 (Cumulative)** — uses existing data, just a new aggregation view
4. **Feature 2 (At-Risk)** — blocked on potential score field + algorithm definition

Features 1 and 4 both extend the existing Test Deep Dive view. Feature 3 is a new view. Feature 2 is a new section in Batch Overview but depends on external inputs.

---

## Shared Blockers

- [ ] Confirm question-level table name and schema
- [ ] Confirm `cms_test_id` column name and location
- [ ] Confirm `potential` column in `dim_student`
- [ ] Define at-risk algorithm
