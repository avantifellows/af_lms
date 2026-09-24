---
name: debug-e2e-fixtures
description: Diagnose Playwright failures caused by stale local fixtures or app flow drift.
triggers:
  - "e2e"
  - "playwright"
  - "fixture"
  - "test:e2e"
  - "seed"
edges:
  - target: context/setup.md
    condition: for commands and local environment notes
  - target: context/visits.md
    condition: when failures are in PM school visit flows
  - target: context/data-access.md
    condition: when fixture rows need to match schema/read-path expectations
last_updated: 2026-09-24
---

# Debug E2E Fixtures

## Context
Playwright uses the local dump plus `e2e/fixtures/migrations/` and helper seeds.
Many failures are not product regressions; they are stale selectors, stale flow
expectations, or fixture rows missing a relationship the app now requires.

## Steps
1. Run the smallest failing spec first: `npm run test:e2e -- e2e/tests/<file>.spec.ts`.
2. Check whether the app behavior is already covered by unit tests before changing product code.
3. Fix fixture data at the missing relationship, not by weakening UI assertions.
4. Keep helper seeds aligned with source constants instead of copying date/year strings.
5. Re-run the changed spec, then the full `npm run test:e2e`.

## Gotchas
- Student e2e seeds must use `CURRENT_ACADEMIC_YEAR`; hard-coded academic-year strings can make `/api/pm/students` return an empty roster.
- Holistic fixture selection needs one School with an active supported-Program Centre, Batch membership, current-year Grade enrollment, and at least three eligible Students in each configured Grade. Seed that prerequisite roster before calling the shared Holistic fixture helper when the local dump does not provide it.
- `resetDatabase()` applies DB Service Holistic migrations from a sibling `../db-service_holistic_mentorship` checkout. If it is missing, symlink it to `../db-service` for the run (`ln -s db-service db-service_holistic_mentorship` from the parent folder) and remove the symlink afterwards.
- A batch `enrollment_record.group_id` holds `batch.id`, not the batch `group.id`; join `batch ON batch.id = enrollment_record.group_id` (as `permissions.ts` does). Batch *membership* (`group_user`) is the one that goes through `"group".child_id`.
- Centre-seated Teachers are confined off `/school/<code>` (Access Denied); open their Holistic workspace at `/centre/<id>`.
- `seedHolisticFixtures()` upserts the shared fixture actors' permissions, so do not call it a second time for another Program. The EMRS (Program 78) Admin journey uses the separate `LMS78` scope seeded by `seedHolisticE2eEmrsScope()` in `e2e/helpers/db.ts`.
- Holistic Student/Phase APIs return 422 without `program_id`; an access-denial assertion (404) must still send a valid Program.
- Curriculum topics need `topic_curriculum` rows in the fixture migration, not just `chapter` and `topic` rows.
- Responsive visit lists can render hidden duplicate links; target visible links or rows.
- Program-admin `/visits` redirects to `/school-visit-summary`; go directly to visit detail when asserting read-only access.
- Visit action schemas should match the canonical validator shape; do not revive older legacy payload forms just to make an e2e pass.

## Verify
- [ ] Targeted Playwright spec passes.
- [ ] Full `npm run test:e2e` passes.
- [ ] `npm test`, `npm run lint`, and `npm run build` pass if the fixture fix touched shared helpers or source constants.

## Update Scaffold
- [ ] Update this pattern if another recurring fixture gotcha appears.
- [ ] Update `context/visits.md` only if actual visit behavior changes.
