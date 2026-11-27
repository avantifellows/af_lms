# The NVS Performance tab reads BigQuery only and counts unsubmitted attempts

Decided by Dhyanesh and Deepansh on 27 Nov 2026, for the NVS Performance tab redesign (#553).

The redesigned Performance tab on JNV NVS school pages reads every number from BigQuery. It no longer reads the DynamoDB student report documents, which lack questions, chapter time and attempt rate. Every count, average and list includes Students who opened a Paper but did not submit it, and a score is marks divided by maximum marks, so it can be negative. The all-JNV and region averages come from small summary tables built with the nightly warehouse build in `etl-next`, not worked out on each page load.

This differs on purpose from the Performance tab for physical centres and from the old NVS view, which read DynamoDB for a test's deep dive and count only submitted attempts (`has_quiz_ended IS NOT FALSE`). The team treats opening a Paper as attempting it; getting Students to submit is followed up through the Test Attendance Tab.

## Considered Options

- **Work out all-JNV and region averages live in BigQuery.** Rejected. Each page load would read about 0.5 GB at subject level and about 4.5 GB at chapter level.
- **Keep DynamoDB for the deep dive and BigQuery for the rest.** Rejected. Two sources can disagree, and DynamoDB still cannot give chapters and questions in full.
- **Use the warehouse `percentage` column for scores.** Rejected. It turns every negative result into 0%, which would disagree with the marks shown beside it.

## Consequences

- The same test can show different numbers on an NVS school page and a physical-centre page, because only the NVS tab counts unsubmitted attempts.
- The comparison phase of #553 includes work in `etl-next`, and comparisons are as fresh as the nightly build.
- The shared Performance components stay as they are for physical centres; the NVS tab has its own.
