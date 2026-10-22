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
last_updated: 2026-10-22
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
- That step shells out to `mix`. The asdf shim fails there: no version is pinned for `db-service`, and its per-version `MIX_HOME` has no Hex. Put the real binaries first: `PATH="$HOME/.asdf/installs/elixir/1.18.4-otp-27/bin:$HOME/.asdf/installs/erlang/27.0/bin:$PATH" MIX_HOME=$HOME/.mix npx playwright test`.
- `relation "lms_student_intervention_flags" does not exist` in the webServer log (surfacing as browser 500s in the Holistic responsive/health test) means the local `e2e/fixtures/db-dump.sql` predates that table; nothing in the e2e migrations creates it. Refresh the dump rather than loosening the health assertions. `column s.tshirt_size does not exist` (a Next.js runtime-error overlay on `/centre/<id>`, so the Teacher's "Holistic Mentorship" tab never renders) is the same stale-dump problem: the uniform-size `student` columns come from db-service `20260925130000_add_uniform_sizes_and_g10_school_to_student`, and `resetDatabase()` only applies db-service `*holistic*` migrations. Run e2e from a worktree by symlinking the gitignored `.env.test` and the dump from the main checkout (and remove the symlinks after).
- A batch `enrollment_record.group_id` holds `batch.id`, not the batch `group.id`; join `batch ON batch.id = enrollment_record.group_id` (as `permissions.ts` does). Batch *membership* (`group_user`) is the one that goes through `"group".child_id`.
- The `pmPage` fixture owns no Schools or Centres on `/dashboard` ("My Schools 0", empty card grids). Use `adminPage` for dashboard card → destination journeys.
- Centre-seated Teachers are confined off `/school/<code>` (Access Denied); open their Holistic workspace at `/centre/<id>`.
- `seedHolisticFixtures()` upserts the shared fixture actors' permissions, so do not call it a second time for another Program. The EMRS (Program 78) Admin journey uses the separate `LMS78` scope seeded by `seedHolisticE2eEmrsScope()` in `e2e/helpers/db.ts`.
- Challenge Categories (#457) need the `holistic_mentorship_post_session_note_challenges` table from db-service #806, so the sibling DB Service checkout must include it; without it every Notes write fails. Only "Synthetic Grade 12 Active" carries prod-wording Questions (`seedHolisticE2eChallengeQuestions()`), so its groups sit under those Questions; every other Synthetic Phase shows the trailing "Challenge Categories" block. The seeded submitted Note on "Synthetic Grade 11 Completed" is the pre-release (untagged) Note; specs that tag it must delete its Category rows afterwards. The only fixture Note with Categories is the second Grade 12 Student's submitted Note on "Synthetic Grade 12 Skipped" (Phase 4): Exam/Test related issues + Time management & distractions. `holistic-challenge-categories.spec.ts` reads exact heatmap cells from it, so keep that Phase otherwise untagged. The fixture draft (second Grade 11 Student, "Synthetic Grade 11 Active") is submitted by `holistic-mentorship.spec.ts`, so a later spec that needs a draft must seed and delete its own.
- Holistic Student/Phase APIs return 422 without `program_id`; an access-denial assertion (404) must still send a valid Program.
- Centre-switcher journeys (#388) use `seedCentreSwitcherFixture()` / `removeCentreSwitcherFixture()` in `e2e/helpers/db.ts` (seed in `beforeAll`, remove in `afterAll` so other specs' Centre lists are unchanged) and `signInAs()` from `e2e/fixtures/auth.ts` for its synthetic seated and School-scoped users. Its "Switcher E2E …" Centres sit at Schools 19269/19006/19260, which no other fixture uses.
- The dashboard's default tab heading is "JNV NVS Schools"; "My Schools" is only the stat label.
- The Curriculum tab shows a Program selector only when the School has more than one Program from active physical Centres; single-Centre fixture Schools (e.g. `LMS75EMPTY`) have none.
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
