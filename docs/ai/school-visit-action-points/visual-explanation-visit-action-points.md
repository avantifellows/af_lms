# Visit Action Points — How It Works (Simple Guide)

## What's changing in one line?

**Today:** A visit is one big form with fixed sections baked into a single database blob.
**After:** A visit is a list of small "action cards" — each one is its own thing you can start, fill in, and finish independently.

---

## The Screens You'll See

### Screen 1: Visit Detail Page (`/visits/123`)

This is what a PM sees after starting a visit at a school:

```
┌─────────────────────────────────────────────┐
│  Visit: JNV Raipur  •  2026-02-06           │
│  Status: In Progress                        │
│                                             │
│  ┌─ Action Points ────────────────────────┐ │
│  │                                        │ │
│  │  [+ Add Action Point]  ← button        │ │
│  │                                        │ │
│  │  ┌──────────────────────────────────┐  │ │
│  │  │ Classroom Observation            │  │ │
│  │  │ Status: Completed                │  │ │
│  │  │ Started: 10:05 AM               │  │ │
│  │  │ Ended:   10:45 AM               │  │ │
│  │  │ [View Details]                   │  │ │
│  │  └──────────────────────────────────┘  │ │
│  │                                        │ │
│  │  ┌──────────────────────────────────┐  │ │
│  │  │ Principal Meeting                │  │ │
│  │  │ Status: In Progress              │  │ │
│  │  │ Started: 11:00 AM               │  │ │
│  │  │ [Open]                           │  │ │
│  │  └──────────────────────────────────┘  │ │
│  │                                        │ │
│  │  ┌──────────────────────────────────┐  │ │
│  │  │ Group Student Discussion         │  │ │
│  │  │ Status: Pending                  │  │ │
│  │  │ [Start]                          │  │ │
│  │  └──────────────────────────────────┘  │ │
│  │                                        │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  [Complete Visit]  ← only works if at       │
│                      least 1 classroom      │
│                      observation is done     │
└─────────────────────────────────────────────┘
```

---

### What happens when you click things?

**1. `[+ Add Action Point]`** — Opens a picker:

```
┌─ Pick an Action Type ──────────────┐
│                                    │
│  ○ Principal Meeting               │
│  ○ Leadership Meeting              │
│  ○ Classroom Observation           │
│  ○ Group Student Discussion        │
│  ○ Individual Student Discussion   │
│  ○ Individual Staff Meeting        │
│  ○ Team Staff Meeting              │
│  ○ Teacher Feedback                │
│                                    │
│           [Add]  [Cancel]          │
└────────────────────────────────────┘
```

You pick one → it creates a new card in "Pending" state. You can add **as many as you want** (e.g. 3 classroom observations, 2 staff meetings).

---

**2. `[Start]` on a pending action** — This does two things behind the scenes:

```
  Phone captures GPS location
         ↓
  Sends to server:
    - timestamp (when you tapped Start)
    - lat/lng (where you are)
         ↓
  Card changes from "Pending" → "In Progress"
```

---

**3. `[Open]` on an in-progress action** — Opens the form for that specific action:

```
┌─────────────────────────────────────┐
│  Principal Meeting                  │
│  Started: 11:00 AM                  │
│                                     │
│  ┌─ Form Fields ─────────────────┐  │
│  │ Attendees: [____________]     │  │
│  │ Key Discussion: [________]    │  │
│  │ Follow-ups: [____________]    │  │
│  │ ... (varies by action type)   │  │
│  └───────────────────────────────┘  │
│                                     │
│  [Save]          [End Action]       │
└─────────────────────────────────────┘
```

- **Save** = saves form data, stays in progress
- **End Action** = captures GPS again + timestamp, marks it "Completed"

---

**4. `[Complete Visit]`** — Finishes the whole visit. The rule is simple:

```
Can I complete this visit?

  At least 1 Classroom Observation = Completed?
     YES → Visit marked complete
     NO  → "You need at least one completed
             classroom observation"
```

Everything else (principal meeting, staff meetings, etc.) is **optional**.

---

## The Life Cycle of One Action

```
                    PM taps         PM fills form       PM taps
                   "Start"          and works          "End Action"
                      │                 │                   │
                      ▼                 ▼                   ▼

  ┌─────────┐    ┌────────────┐    ┌────────────┐    ┌───────────┐
  │ PENDING │───▶│IN PROGRESS │───▶│IN PROGRESS │───▶│ COMPLETED │
  │         │    │            │    │ (has data) │    │           │
  │ no GPS  │    │ GPS saved  │    │            │    │ GPS saved │
  │ no time │    │ time saved │    │            │    │ time saved│
  └─────────┘    └────────────┘    └────────────┘    └───────────┘
     Created      Start tap          Working on it     End tap
```

---

## What's different from today?

```
TODAY (one big blob)                 AFTER (separate action cards)
─────────────────────               ──────────────────────────────

Visit                               Visit
├── principalMeeting: {...}         ├── Action #1: Principal Meeting
├── leadershipMeetings: {...}       ├── Action #2: Classroom Obs
├── classroomObservations: [...]    ├── Action #3: Classroom Obs  ← can have many!
├── studentDiscussions: {...}       ├── Action #4: Student Discussion
├── staffMeetings: {...}            └── Action #5: Teacher Feedback
├── teacherFeedback: [...]
└── issueLog: [...]                 Each card = its own row in database
                                    Each card = its own GPS + timestamps
All jammed into ONE database        Each card = its own status
column as JSON                      Add/remove cards freely
Fixed structure - must fill all
```

---

## The Database Picture

```
lms_pm_school_visits (the visit)
┌────┬─────────────┬──────────────┬────────────┐
│ id │ school_code │ pm_email     │ status     │
├────┼─────────────┼──────────────┼────────────┤
│ 1  │ 09101       │ pm@af.org    │ in_progress│
└────┴─────────────┴──────────────┴────────────┘
         │
         │ has many
         ▼
lms_pm_school_visit_actions (the action cards)
┌────┬──────────┬────────────────────┬────────────┬──────────┐
│ id │ visit_id │ action_type        │ status     │ data     │
├────┼──────────┼────────────────────┼────────────┼──────────┤
│ 1  │ 1        │ principal_meeting  │ completed  │ {form..} │
│ 2  │ 1        │ classroom_obs      │ completed  │ {form..} │
│ 3  │ 1        │ classroom_obs      │ in_progress│ {form..} │
│ 4  │ 1        │ student_discussion │ pending    │ {}       │
└────┴──────────┴────────────────────┴────────────┴──────────┘

Each row also stores: start GPS, end GPS, start time, end time
```

---

## Summary

| Question | Answer |
|----------|--------|
| What is an action point? | One task during a visit (e.g. one classroom observation) |
| How many can I add? | As many as you want, any combination |
| What must I complete? | At least 1 classroom observation to finish the visit |
| Is there a fixed order? | No, do them in any order |
| What GPS is captured? | Location when you tap Start + location when you tap End |
| What about the old forms? | Principal meeting form gets rewritten to use this new system |
