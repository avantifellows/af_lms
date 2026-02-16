# School Visit Geo-Tracking — How It Works (Simple Guide)

## What's changing in one line?

**Today:** A PM says "I visited this school" and we just trust them.
**After:** When a PM starts or ends a visit, their phone records **where they are** (GPS) and **when** (timestamp). It's like a digital attendance stamp.

---

## The Two Moments We Capture

```
    PM arrives at school              PM leaves school
           │                                │
           ▼                                ▼
    ┌─────────────┐                  ┌─────────────┐
    │  START VISIT │                  │  END VISIT  │
    │             │                  │             │
    │  GPS: ✓     │                  │  GPS: ✓     │
    │  Time: ✓    │                  │  Time: ✓    │
    └─────────────┘                  └─────────────┘

    That's it. Two stamps. Start and End.
```

---

## What the PM Sees

### Step 1: Starting a Visit

PM is at the school, opens the app, taps "Start Visit":

```
┌─────────────────────────────────────┐
│  JNV Raipur                         │
│                                     │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │    [Start Visit]              │  │
│  │                               │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘

         PM taps "Start Visit"
                 │
                 ▼

┌─────────────────────────────────────┐
│  JNV Raipur                         │
│                                     │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │    Getting your location...   │  │
│  │                               │  │
│  │         [Cancel]              │  │
│  │                               │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘

     Phone finds GPS (can take a few seconds)
                 │
                 ▼

┌─────────────────────────────────────┐
│  Visit started!                     │
│  Redirects to visit detail page...  │
└─────────────────────────────────────┘
```

---

### Step 2: PM Does Their Work

The visit is now in progress. PM fills in forms (principal meeting, etc.) — this part doesn't change.

---

### Step 3: Ending a Visit

PM is done, taps "End Visit":

```
┌─────────────────────────────────────┐
│  Visit: JNV Raipur                  │
│  Started: 10:00 AM                  │
│  Status: In Progress                │
│                                     │
│  ... (action forms, etc.) ...       │
│                                     │
│  ┌───────────────────────────────┐  │
│  │     [End Visit]               │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘

         PM taps "End Visit"
                 │
                 ▼

┌─────────────────────────────────────┐
│                                     │
│    Getting your location...         │
│                                     │
│         [Cancel]                    │
│                                     │
└─────────────────────────────────────┘

     Phone finds GPS again
                 │
                 ▼

┌─────────────────────────────────────┐
│  Visit: JNV Raipur                  │
│  Started: 10:00 AM                  │
│  Ended:   3:30 PM                   │
│  Status: In Progress (ended)        │
└─────────────────────────────────────┘
```

---

## What gets saved in the database

```
Before (today):
┌────┬─────────────┬──────────┬────────────┬────────────┐
│ id │ school_code │ pm_email │ visit_date │ status     │
├────┼─────────────┼──────────┼────────────┼────────────┤
│ 1  │ 09101       │ pm@af.org│ 2026-02-06 │ in_progress│
└────┴─────────────┴──────────┴────────────┴────────────┘
  That's all. No proof they were actually there.


After (with geo-tracking):
┌────┬─────────────┬──────────┬────────────┬────────────┐
│ id │ school_code │ pm_email │ visit_date │ status     │
├────┼─────────────┼──────────┼────────────┼────────────┤
│ 1  │ 09101       │ pm@af.org│ 2026-02-06 │ in_progress│
└────┴─────────────┴──────────┴────────────┴────────────┘
  PLUS these new columns:
  ┌──────────────────────────────────────────────────────┐
  │ START stamp                │ END stamp               │
  │ start_lat:   23.25943200  │ ended_at:  3:30 PM      │
  │ start_lng:   77.41261700  │ end_lat:   23.25940100  │
  │ start_accuracy: 15 meters │ end_lng:   77.41258900  │
  │ (time = inserted_at)      │ end_accuracy: 12 meters │
  └──────────────────────────────────────────────────────┘
```

---

## GPS Accuracy — What happens with bad signal?

The phone reports how accurate its reading is (in meters). We handle it like this:

```
Accuracy          What happens
─────────────────────────────────────────────

  0 - 100m        ACCEPT
                   "Good reading, saved!"

100 - 500m        WARN but ACCEPT
                   "Location saved, but accuracy
                    is low (~250m). Reading may
                    not be precise."

500m+             REJECT
                   "Could not get accurate location.
                    Move to an open area and try again."
                   Phone keeps trying for up to 60 sec.

No GPS at all     BLOCKED
                   "Location is required. Please
                    enable location access and
                    try again."
```

```
Visual:

     You ──┐
            │  15m accuracy = great
            ○  (you're somewhere in this tiny circle)

     You ──┐
            │  250m accuracy = okay but fuzzy
        ┌───────┐
        │   ○   │  (you're somewhere in this area)
        └───────┘

     You ──┐
            │  600m accuracy = too fuzzy, rejected
    ┌───────────────┐
    │               │
    │       ○       │  (could be anywhere in here)
    │               │
    └───────────────┘
```

---

## Three words that mean different things

```
START          END              COMPLETE
─────          ───              ────────
Create the     Record end       Mark visit as
visit +        GPS + time.      fully done
record GPS.                     (forms checked).

Always first.  Can happen       NOT in Phase 1.
               anytime after    Will be added
               Start.           later.

  START ──────────► END ──────────► COMPLETE
  (Phase 1)        (Phase 1)       (Later)
```

**Why separate End and Complete?**
- A PM might end their visit (leave school) but still need to fill in some forms later.
- Phase 1 only cares about: "were you there?" (GPS proof).
- Checking if all forms are filled comes later.

---

## Edge Cases (What if things go wrong?)

```
Scenario                          What happens
────────────────────────────────────────────────────────

Phone dies mid-visit              PM can end the visit later
                                  from any device. GPS will be
                                  from wherever they are at that
                                  point (not the school). That's
                                  okay for now.

PM forgets to end visit           No auto-expiry. Visit stays
                                  "in progress" forever.
                                  (Future: admin dashboard will
                                  flag visits open > 48 hours)

PM visits same school twice       Allowed. No restrictions on
in one day                        duplicate visits.

Admin needs to close a            Admins (level 4) can end any
PM's stuck visit                  visit on behalf of the PM.

PM is in basement, no GPS         60-second timeout, then:
                                  "Move to an open area and
                                  try again." [Try Again] button.
```

---

## What we are NOT doing (on purpose)

```
┌─────────────────────────────────────────────────┐
│  NOT checking if PM is actually at the school   │
│                                                 │
│  Why? We don't have school GPS coordinates      │
│  in the database yet. Phase 1 just records      │
│  where the PM was. Checking distance to the     │
│  school = future feature.                       │
├─────────────────────────────────────────────────┤
│  NOT doing offline support                      │
│                                                 │
│  If PM has no internet, they can't start/end    │
│  a visit. Offline capture + sync = future.      │
├─────────────────────────────────────────────────┤
│  NOT giving GPS setup help                      │
│                                                 │
│  No "Go to Settings > Privacy > Location"       │
│  instructions. Just a basic error message.      │
│  We'll add detailed help after we see what      │
│  PMs actually struggle with.                    │
└─────────────────────────────────────────────────┘
```

---

## Who can see the GPS data?

```
Role              What they see
────────────────────────────────────────
PM (visit owner)  Start time, end time,
                  exact lat/lng coordinates

Admin (level 4)   Same as PM — full GPS data

Everyone else     Start time, end time only
                  (no coordinates)
```

GPS coordinates are treated as **sensitive** — not logged in server logs either.

---

## Summary

| Question | Answer |
|----------|--------|
| What is geo-tracking? | Recording GPS location when a visit starts and ends |
| Is GPS required? | Yes, can't start or end without it |
| What if signal is bad? | Accept up to 500m accuracy with a warning; reject above 500m |
| Does it check if PM is at the school? | No, not yet. Just records where they are. |
| What's the timeout? | 60 seconds to get GPS, then "try again" |
| Can PM end visit later from another device? | Yes |
| Who sees the coordinates? | Only the PM who owns the visit + admins |

---

## How this connects to Action Points

```
Phase 1 (this plan):          Phase 2 (action points plan):
GPS at visit level            GPS at each action level

  Visit                         Visit
  ├── Start GPS                 ├── Start GPS
  ├── ... forms ...             ├── Action 1 (start GPS, end GPS)
  └── End GPS                   ├── Action 2 (start GPS, end GPS)
                                ├── Action 3 (start GPS, end GPS)
                                └── End GPS
```

Phase 1 ships first. Phase 2 (action points) builds on top of it.
