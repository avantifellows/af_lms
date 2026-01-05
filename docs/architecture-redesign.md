# School Dashboard Architecture Redesign

## Overview

This document outlines the redesigned architecture for the school dashboard, supporting two user roles (Teachers and PMs) with a unified school-level experience.

---

## User Roles & Access

| Role | School Access | Features |
|------|---------------|----------|
| **Teacher** | Assigned schools | Enrollment, Performance, Mentorship |
| **PM** | Assigned schools | Everything Teachers see + PM Summary + School Visits |

---

## Information Architecture

```
Teacher View
├── /dashboard                    # List of accessible schools
│   └── Click school →
└── /school/[udise]              # School detail page
    ├── [Tab] Enrollment         # Student list, add/edit/remove
    ├── [Tab] Performance        # Quiz analytics
    └── [Tab] Mentorship         # Mentorship notes & sessions

PM View
├── /pm                          # PM Dashboard
│   ├── Summary Section          # Aggregated stats across schools
│   ├── School Visits Section    # Existing visit tracking
│   └── Schools List             # Click to go to school page
└── /school/[udise]              # Same as Teacher view (no difference)
```

---

## Wireframes

### 1. Teacher Dashboard (`/dashboard`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Logo]  School Dashboard                      teacher@school.org ▼ │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  My Schools                                                         │
│  ───────────                                                        │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ JNV Hassan                                                   │   │
│  │ Karnataka | UDISE: 29230607302                              │   │
│  │ 156 students | 12 pending mentorship notes                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ JNV Bangalore                                                │   │
│  │ Karnataka | UDISE: 29210100123                              │   │
│  │ 203 students | 5 pending mentorship notes                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. School Page with Tabs (`/school/[udise]`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back    JNV Hassan                          teacher@school.org ▼ │
│            Karnataka | UDISE: 29230607302                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │  Enrollment  │ │  Performance │ │  Mentorship  │                │
│  │   (active)   │ │              │ │     (3)      │  ← badge count │
│  └──────────────┘ └──────────────┘ └──────────────┘                │
│                                                                     │
│  ═══════════════════════════════════════════════════════════════   │
│                                                                     │
│                    [Tab Content Area]                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2a. Enrollment Tab (Current Student Table)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Enrollment                                                         │
│  ───────────                                                        │
│                                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │Total NVS│ │Grade 11 │ │Grade 12 │ │  Engg   │ │ Medical │       │
│  │   156   │ │   82    │ │   74    │ │   98    │ │   58    │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│                                                                     │
│  [+ Add Student]                    [Search: _______________]       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Active Students │ Dropouts (12) │                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────┬────────────────┬───────┬────────┬─────────┬──────────┐   │
│  │Grade │ Name           │ Phone │ Stream │ Category│ Actions  │   │
│  ├──────┼────────────────┼───────┼────────┼─────────┼──────────┤   │
│  │  11  │ Rahul Kumar    │ 98xxx │ Engg   │ General │ Edit     │   │
│  │  11  │ Priya Singh    │ 87xxx │ Medical│ OBC     │ Edit     │   │
│  │  12  │ Amit Sharma    │ 76xxx │ Engg   │ SC      │ Edit     │   │
│  └──────┴────────────────┴───────┴────────┴─────────┴──────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2b. Performance Tab (Quiz Analytics)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Performance                                                        │
│  ───────────                                                        │
│                                                                     │
│  Select Quiz: [ AIET-06-G11-PCM - 2025-12-20 (46 students)    ▼ ]  │
│                                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Total   │ │ Present │ │ Absent  │ │Avg Score│ │Max Score│       │
│  │   54    │ │   46    │ │    8    │ │  45.2%  │ │  89.0%  │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│                                                                     │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐   │
│  │    Score Distribution       │ │    Subject Performance      │   │
│  │                             │ │                             │   │
│  │  ████████ 80-100%: 5       │ │  Physics:  ████████  65%    │   │
│  │  ██████████ 60-80%: 12     │ │  Chemistry:██████    52%    │   │
│  │  ████████████ 40-60%: 18   │ │  Maths:    ██████████ 71%   │   │
│  │  ██████ 20-40%: 8          │ │                             │   │
│  │  ███ 0-20%: 3              │ │                             │   │
│  └─────────────────────────────┘ └─────────────────────────────┘   │
│                                                                     │
│  Student Results                                                    │
│  ┌──────┬────────────────┬────────┬───────────┬────────────────┐   │
│  │ Rank │ Name           │ Status │ Marks     │ Percentage     │   │
│  ├──────┼────────────────┼────────┼───────────┼────────────────┤   │
│  │  1   │ Priya Singh    │Present │ 267/300   │ 89.0%          │   │
│  │  2   │ Amit Sharma    │Present │ 245/300   │ 81.7%          │   │
│  │  -   │ Rahul Kumar    │Absent  │ -         │ -              │   │
│  └──────┴────────────────┴────────┴───────────┴────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2c. Mentorship Tab (NEW)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Mentorship                                                         │
│  ───────────                                                        │
│                                                                     │
│  ┌───────────────────┐ ┌───────────────────┐                       │
│  │   My Mentees (8)  │ │  All Students     │  ← Toggle view        │
│  └───────────────────┘ └───────────────────┘                       │
│                                                                     │
│  [Search: _______________]                                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ┌─────┐  Priya Singh                          Grade 11 Engg │   │
│  │ │ PS  │  Last session: Dec 20, 2025                         │   │
│  │ └─────┘  "Discussed JEE prep strategy, needs help with..."  │   │
│  │          [View Details] [+ Add Note]          ← only for    │   │
│  │                                                 my mentees   │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ┌─────┐  Amit Sharma                          Grade 12 Engg │   │
│  │ │ AS  │  Last session: Dec 18, 2025                         │   │
│  │ └─────┘  "Mock test review, improved in Physics..."         │   │
│  │          [View Details] [+ Add Note]                        │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ┌─────┐  Rahul Kumar                          Grade 11 Engg │   │
│  │ │ RK  │  No sessions yet                      ⚠️ Pending    │   │
│  │ └─────┘                                                      │   │
│  │          [View Details] [+ Add Note]                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2d. Mentorship - Student Detail Modal

```
┌─────────────────────────────────────────────────────────────────────┐
│  Priya Singh - Mentorship History                              [X] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Grade 11 | Engineering | JNV Hassan                                │
│  Mentor: teacher@school.org                                         │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Dec 20, 2025 - by teacher@school.org                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Discussed JEE preparation strategy. Student is strong in    │   │
│  │ Physics but needs more practice in Organic Chemistry.       │   │
│  │ Assigned extra problems from HC Verma Chapter 12.           │   │
│  │                                                              │   │
│  │ Next steps: Review in 1 week                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Dec 13, 2025 - by teacher@school.org                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ First mentorship session. Understood student's background   │   │
│  │ and academic goals. Targeting 150+ in JEE Mains.            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  [+ Add New Note]  ← Only visible if this is my mentee             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3. PM Dashboard (`/pm`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Logo]  PM Dashboard                              pm@af.org ▼      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │   Summary    │ │ School Visits│ │   Schools    │                │
│  │   (active)   │ │              │ │              │                │
│  └──────────────┘ └──────────────┘ └──────────────┘                │
│                                                                     │
│  ═══════════════════════════════════════════════════════════════   │
│                                                                     │
│  Summary Across All Schools                                         │
│  ──────────────────────────                                         │
│                                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Schools │ │Students │ │Avg Quiz │ │Mentorship│ │ Visits  │       │
│  │   12    │ │  1,847  │ │  52.3%  │ │  78%     │ │  8/12   │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│                                                                     │
│  Schools Overview                                                   │
│  ┌────────────────┬──────────┬──────────┬───────────┬───────────┐  │
│  │ School         │ Students │ Avg Quiz │ Mentorship│ Last Visit│  │
│  ├────────────────┼──────────┼──────────┼───────────┼───────────┤  │
│  │ JNV Hassan     │ 156      │ 48.2%    │ 85%       │ Dec 15    │  │
│  │ JNV Bangalore  │ 203      │ 55.1%    │ 72%       │ Dec 10    │  │
│  │ JNV Mysore     │ 178      │ 51.8%    │ 80%       │ Nov 28 ⚠️ │  │
│  └────────────────┴──────────┴──────────┴───────────┴───────────┘  │
│                                                                     │
│  Click any school to view details →                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3b. PM School Visits Tab (Existing)

```
┌─────────────────────────────────────────────────────────────────────┐
│  School Visits                                                      │
│  ─────────────                                                      │
│                                                                     │
│  [+ Schedule New Visit]                                             │
│                                                                     │
│  Upcoming Visits                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Dec 28, 2025 - JNV Mysore                                    │   │
│  │ Purpose: Monthly review meeting                              │   │
│  │ [Edit] [Cancel]                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Past Visits                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Dec 15, 2025 - JNV Hassan                         [View]     │   │
│  │ Dec 10, 2025 - JNV Bangalore                      [View]     │   │
│  │ Nov 28, 2025 - JNV Mysore                         [View]     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Model Changes

### New Tables Required

```sql
-- Mentorship assignments (which teacher mentors which students)
CREATE TABLE mentor_assignment (
  id SERIAL PRIMARY KEY,
  mentor_user_id INTEGER REFERENCES "user"(id),
  student_user_id INTEGER REFERENCES "user"(id),
  school_id INTEGER REFERENCES school(id),
  assigned_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(mentor_user_id, student_user_id)
);

-- Mentorship session notes
CREATE TABLE mentorship_note (
  id SERIAL PRIMARY KEY,
  mentor_assignment_id INTEGER REFERENCES mentor_assignment(id),
  created_by_user_id INTEGER REFERENCES "user"(id),
  note_text TEXT NOT NULL,
  next_steps TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## Refactor Scope Assessment

### Low Effort (Existing, just reorganize)
- [ ] School page with tabs layout
- [ ] Enrollment tab (current student table)
- [ ] Performance tab (current quiz analytics)
- [ ] PM school visits (already exists)

### Medium Effort (New features)
- [ ] Mentorship tab UI
- [ ] Mentorship data model & API
- [ ] PM summary dashboard
- [ ] Mentor assignment management

### High Effort (If needed)
- [ ] Bulk mentor assignment tool
- [ ] Mentorship analytics/reporting
- [ ] Email notifications for pending mentorship

---

## Implementation Order (Suggested)

### Phase 1: Reorganize School Page (1-2 days)
1. Add tab navigation to school page
2. Move student table to "Enrollment" tab
3. Move quiz analytics to "Performance" tab
4. Add placeholder "Mentorship" tab

### Phase 2: PM Summary (1 day)
1. Add summary stats to PM dashboard
2. Add schools overview table with key metrics

### Phase 3: Mentorship Feature (3-4 days)
1. Create database tables
2. Build mentor assignment API
3. Build mentorship notes API
4. Create Mentorship tab UI
5. Create add/view notes modals

---

## Questions for Team

1. **Mentor Assignment**: How are mentors assigned to students?
   - Manual assignment by PM?
   - Auto-assigned based on some criteria?
   - Teachers choose their mentees?

2. **Mentorship Frequency**: Is there an expected frequency for mentorship sessions?
   - Should we show "overdue" warnings?

3. **Note Visibility**: Can all teachers see all notes, or only notes for their school?

4. **PM School Access**: Do PMs have the same edit permissions as teachers, or view-only?

---

## Summary

| Aspect | Assessment |
|--------|------------|
| **Scope** | Moderate refactor |
| **New Features** | Mentorship (main new work) |
| **Existing Reuse** | ~70% (student table, quiz analytics, visits) |
| **Estimated Effort** | 5-7 days for full implementation |
| **Risk** | Low - mostly additive, not disruptive |
