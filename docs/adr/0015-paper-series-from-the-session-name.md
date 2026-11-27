# A Paper's Paper Series comes from the session name

Decided by Dhyanesh and Deepansh on 27 Nov 2026, for the NVS Performance tab redesign (#553).

The Performance tab compares a Paper with the same Paper in earlier months (previous month, last 3 months, year charts), so it must know which Papers belong to one Paper Series. A Paper's Paper Series is its grade plus the label in its `session` name: names follow `NVS G<grade> <label> <Month> Test`, and the label is matched against a fixed list of known labels (JEE, Engineering, NEET, NDA, CLAT, CA Maths & LR, CA Eco & BCK, and the four CUET papers). A Paper whose name does not match is a Paper Series of its own. The name is read from the Postgres `session` table, like the rest of the Monthly Test rule (ADR 0014), so correcting a name takes effect at once, with no data rebuild.

No field on the session identifies the series. A read-only check on production on 27 Nov 2026 covered all 60 Papers of the year: no quiz id or CMS test id repeats across months, and every name matches the pattern.

## Considered Options

- **`meta_data.stream`.** Rejected. It cannot tell apart the two CA Papers a grade sits each month, or the four CUET Papers.
- **`meta_data.course`.** Rejected. It has the same gap, and its spelling for one Paper changed mid-year ("State CET" to "CET").
- **A new series field on the session.** Rejected for now. It needs a change to how sessions are created and a backfill, and the PMU team already keeps the names consistent.

## Consequences

- The PMU team must keep a Paper's label the same from month to month. A changed or misspelt label starts a new Paper Series until the name is corrected.
- Two sessions in one month with the same grade and label count as one Paper, their Students combined. In October 2026 the Grade 12 JEE question paper was set up twice, once for the NDA batch (sessions 20797 and 20825, same CMS test); Dhyanesh confirmed these are one Paper.
- A new kind of Paper needs its label added to the fixed list; until then it still shows, as its own Paper Series.
- One small module owns the name rule and the label list, so a real series field can replace it later without touching the rest of the tab.
