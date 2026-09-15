---
name: debug-holistic-progress
description: Trace empty HTTP 500 responses and database timeouts in Holistic Admin progress.
last_updated: 2026-09-11
---

# Debug Holistic Admin progress

## Steps

1. Read architecture, data-access context, and the progress route. Record request filters, response status/body length, and timestamp. Check the deployed Amplify commit against local source.
2. Read production CloudWatch logs for the screenshot timestamp; distinguish PostgreSQL statement timeout (`57014`) from connection timeout, auth errors, and infrastructure failures. An `Error from cloudfront` header alone does not identify the root cause.
3. Trace `listHolisticProgress`: reconciliation runs first, then the main SELECT, then route filter/coverage/year queries. **Do not invoke this function against production as a read-only probe:** its reconciliation can end Mappings and erase drafts.
4. Capture SQL with database calls replaced locally, then execute only SELECT/EXPLAIN through the existing DB helper inside an explicitly READ ONLY transaction. To inspect reconciliation, isolate its candidate SELECT and remove `FOR UPDATE` and all mutation CTEs. Keep the production timeout; never EXPLAIN ANALYZE a mutation.
5. Inspect the live `centre_students` definition and query plan. Correlated eligibility EXISTS can repeatedly expand roster membership for every Mapping after view changes. Compare a query-local materialized Program/year roster in both eligibility and Grade lookup; preserve authorization and historical behavior. Never replace the production view for diagnosis.
6. Check client error handling separately: parsing an empty 500 body as JSON masks the server error, while reset counters may falsely look like zero Students.

## Verify

- Production probes are read-only, with credentials kept in memory and no Student/Notes rows printed.
- Identify the failing query separately from the reconciliation candidate check.
- Clearly label proposed-query timing versus shipped behavior; matching row counts alone do not establish full result parity.
- For a fix, test permissions, current/historical year semantics, conflicting Grades, filters, pagination/counts/CSV, and empty/non-JSON server failures, plus representative query performance.
- Record findings in ROUTER.md and data-access context; bump changed scaffold dates and run mex log.
