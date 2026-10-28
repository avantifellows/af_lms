---
name: pre-pr-review
description: Review an af_lms branch or open PR the way a human reviewer would. Several independent reviewers plus a second model read the diff, then the branch is run against the base on real data, every number it shows is recomputed, and new data exposure stops for a decision. Findings are verified and sized before anyone posts them.
triggers:
  - "pre-pr review"
  - "review before pr"
  - "ready for a pr"
  - "open a pr"
  - "review this pr"
edges:
  - target: patterns/local-browser-qa.md
    condition: for running the base and the branch side by side (worktree, port, env, login)
  - target: context/permissions.md
    condition: when checking the gate on new routes and queries (step 5)
  - target: context/data-access.md
    condition: when recomputing numbers in BigQuery (step 4)
  - target: patterns/review-with-agents.md
    condition: for running the reviewers, verifying their findings, re-reviewing and posting
last_updated: 2026-10-28
---

# Pre-PR review for af_lms

A diff-only read is not a review. On #467, reviewers reading the diff raised four real problems, and every unit test
still passed. Running the branch is what proved them, sized them, and found a fifth:

- the new report had no fallback, so about 180 real tests lost their report;
- class accuracy was averaged over the wrong denominator (171 of 3,714 reports off);
- "X of Y appeared" was counted two ways in two places (42 showed over 100%);
- a new table showed other schools' results to teachers;
- found only in the browser: in every error state the heading stayed on "Loading...".

Each step below exists because of one of those, or of a miss on another PR this month (named in the step).
**Don't open the PR, or approve someone else's, until every finding is fixed or the PR's owner has accepted it.**
Decisions (scope, who sees what) go to the owner as questions; they are not yours to settle.

**When:** before opening a PR, and when reviewing an open one, yours or a teammate's. For an open PR the verdict is
**merge** or **don't merge yet** instead of ready / not ready.

**Who runs it:** a session or agent that did not write the code, given the branch, its base and the PR's
"What and why". The author's session already believes the code is right. How to run the reviewers, verify what
they find, and post it is in `review-with-agents.md`.

**Roles**, as used here and in `review-with-agents.md`:
- **author:** whoever wrote the change, a person or an agent session;
- **owner:** the person the PR belongs to. They answer product questions (scope, who sees what) and accept or
  reject findings on their PR;
- **person running the review:** whoever started it. They see the findings first, and decide what is fixed now and
  what goes on GitHub.

On your own PR, the owner and the person running the review are you. The agent session doing the review still
mustn't be the one that wrote the code.

## 0. Scope the change

- Check out the branch in its own worktree (`git fetch origin pull/<n>/head:pr-<n>`, then `git worktree add`).
  Confirm `git rev-parse HEAD` is the PR's head, and use the PR's actual base (`gh pr view <n> --json baseRefName`),
  not the one you assume. Don't change the tree while reviewers are reading it.
- Run `npm ci` in every worktree you make, this one and the base one in step 3. Without it `npx fallow` and
  `npx tsc` fetch the latest release instead of the repo's pinned version.
- Base: `origin/main`, or the parent branch for a stacked PR. `git diff <base>...HEAD --stat`.
- A small change (a copy fix, one component, a docs-only PR) needs only steps 0 to 2 and the parts below that the
  diff touches. Step 1 can be one lens plus the second model.
- Sort the diff into the parts below. A part that doesn't apply is skipped, and the report says so:
  - **reviewers and mechanical:** always (steps 1 and 2);
  - **behaviour:** any page, component or API route change (step 3);
  - **numbers:** any figure a user sees, added or changed (step 4);
  - **exposure / permissions:** any new query, route or field reaching the browser (step 5);
  - **audience:** any feature work (step 6);
  - **docs:** any `.mex/` or `AGENTS.md` line about code the diff touches (step 7);
  - **other repos:** any db-service, etl-next or CMS change the code depends on (step 8).

## 1. Reviewers: several lenses, a second model, one consolidator

Before running anything, have the diff read by 2 to 5 read-only reviewers in parallel, each with one lens, plus one
run of a second model family on the same commit. Verify every finding before it reaches anyone, and keep or discard
it with a reason. `review-with-agents.md` has the briefs, the lenses, and what counts as verified.

Steps 2 to 8 then prove, size and add to what the reviewers found.

## 2. Mechanical: what CI runs, before CI runs it

```
npm run lint
npx tsc --noEmit                 # compare with the base: main already has errors in test files
npm run test:unit:coverage
npx fallow audit --base <base> --coverage unit-coverage/coverage-final.json
npm run build                    # when routes, config or server/client boundaries changed
```

- Fallow's gate is new-only on changed files, the same as `.github/workflows/fallow.yml`. Use the major version in
  that workflow's `uses: fallow-rs/fallow@vN` line (a newer major gave different results on #435). If a unit test
  times out, vitest writes no coverage file and Fallow silently falls back to an estimate; rerun with
  `npm run test:unit:coverage -- --testTimeout=30000`. Fix the findings; don't suppress them unless the repo
  already suppresses that kind.
- For tsc and failing tests, the base is the baseline: run the same command on the base worktree, and report only
  what the branch adds. A red that is red on the base too is labelled inherited, not ignored.
- When the PR adds tests, run the touched suites in shuffled order a few times
  (`npx vitest run --sequence.shuffle <files>`); an order-dependent test on #405 failed 4 runs in 6.

## 3. Behaviour: base vs branch, side by side, on real cases

- Run both, following `local-browser-qa.md` for worktree, port, env and login:
  - the branch in its worktree;
  - the base in a temporary detached worktree (`git worktree add --detach <path> <base>`).

  Point both at the same local data: `dbservice_dev` when its dump has the cases, otherwise a clone of the newest
  local production snapshot (`CREATE DATABASE <scratch> TEMPLATE <snapshot>`, as in `local-browser-qa.md`). BigQuery
  numbers come from prod, read-only. On a clone, set `DB_SERVICE_URL` to a dead port, except for the write test
  below. Remove the base worktree afterwards.
- **Staging only on request, and only after approval.** Don't use the staging DB or the deployed staging app on
  your own, even just to read: Holistic reads reconcile mappings, and that writes (`reconcileHolisticMappings` in
  `src/lib/holistic-progress.ts`). If a case exists only on staging, say so in the report and ask. Use staging only
  when the person running the review asks for it and approves the plan, for example through `deploy-staging-pr.md`.
- A new screen has no base to compare. Run the branch alone on the same cases, and still check that every screen it
  touches or replaces looks the same as on the base where the feature doesn't apply.
- Pick **named real cases** with SQL first (prod BigQuery, via `mcp__claude_ai_Avanti_Data__run_query`), and
  record their ids in the report. Pick them with the same rule the page uses to list them, or they 404 (on #467 the
  first picks were schools the LMS doesn't show):
  - the happy path;
  - empty: started but nobody submitted, no data for the filter;
  - partial: a few students, one student;
  - every variant the code branches on: combined test, homework, old-CMS vs new-CMS, physical vs NVS, each stream;
  - failure: force the new API or query to fail. Intercept it in the browser
    (`page.route(..., r => r.fulfill({ status: 500 }))`) and label it simulated. Only if that can't reach it, make a
    local, uncommitted change that throws, and revert it.
- Compare each case in two passes. Unit tests alone don't count: they check what the author thought of, and on #467
  every test passed while the page was broken.
  1. **API, every case.** Call each route the change touches on both ports, with the same session and parameters
     (authenticated, the way `local-browser-qa.md` logs in), and diff the JSON. Cheap, and it catches wrong or
     missing data.
  2. **Page, for UI changes.** Open the same cases in headless Chromium (`local-browser-qa.md`'s playwright-core
     script, never a personal browser) and screenshot base and branch, at desktop and phone width. This catches what
     an API diff can't: a stuck "Loading...", a fallback that never renders, a missing panel, an error banner off
     screen (#437: 1,651 px below the fold on a laptop, so "minor" became "major").
- **Writes, when the change saves anything.** Reading is not enough: on #405 the blocker only showed up by saving.
  Clone the database (`CREATE DATABASE <scratch> TEMPLATE dbservice_dev`). Postgres refuses while anything is
  connected to `dbservice_dev`, so stop the DB Service on :4000 and the dev servers first. Point both the af_lms
  server (`DATABASE_NAME`) and a DB Service worktree at the clone, so reads and writes see the same rows. Then save
  through the real page or route and read the row back with SQL. The clone starts from the local dump, not staging,
  so pick write cases the dump has, or insert the rows a real case needs into the clone. Take a
  real record and change one field at a time, including blanking it: rules that check the submitted form instead of
  the saved record let impossible combinations through. Drop the clone afterwards.
- For each case, write what the base shows next to what the branch shows. **Anything the base showed that the branch
  no longer shows is a finding**, unless the PR says it was removed on purpose.
- When the change replaces a screen, the old screen must still appear wherever the new one doesn't apply or fails.
  Decide which one to show before loading either.
- **Every difference found here becomes a unit test that fails on the base** (or without the fix), so it stays
  covered after the review.
- Login caveat: Dev Login personas exist only in the database that has them (the local `dbservice_dev`). In a
  cloned database, insert the `user_permission` rows you need and mint a session the way `e2e/fixtures/auth.ts`
  does. Never add rows to a shared database without the owner's go.

## 4. Numbers: recompute every figure, across all the data

- List every figure the change shows: averages, rates, counts, "X of Y", ranks.
- For each one, write its definition in one line, including the denominator, and how blanks are treated. A student
  who attempted nothing has no accuracy, which is not the same as 0%.
- Recompute it directly in SQL over **all of this academic year's** relevant data, and compare with what the code
  produces. Report the impact as counts:
  - how many reports differ;
  - how many by 1 point or more;
  - the worst case, and the group size it occurs in.
- **A label shown in two places must use one rule.** Find every place the same label or figure appears (card vs
  report, overview vs deep dive). Run one consistency query over every session, and count mismatches and
  impossible values (over 100%, negative).
- When the PR changes an existing metric, count how many existing reports change, and by how much.
- **For any list, check it contains everyone it should.** Write the population independently and compare counts. On
  #405 this found 287 pass-outs under a program the code didn't list, and alumni no list could reach.

## 5. Data exposure and permissions: stop, don't build

- Does any viewer now see data from outside their own scope: another school, another student, names, UDISE, or a
  small group whose "average" is one student's score? If so, **it is a product decision for the owner before it is
  code.** Write it up as questions (who sees it, which schools count, same grade only, minimum group size), and don't
  ship it as is.
- Check the gate for each new route and query: `src/lib/permissions.ts`, `getFeatureAccess`, the school scope check.
  Then walk it: call every new route as every role that can reach the page, including read-only admin and passcode
  users, and an out-of-scope school, and record the status codes (on #405 this was a 403/200 matrix per role).
- When role permissions change, check the five places in `AGENTS.md`'s non-negotiables are still in sync.

## 6. Audience

- The PR's **Audience** line (physical centres, NVS schools, or both) must match the code's gate.
- Open an NVS school page and a physical-centre page. The side the feature isn't for must look exactly as it does
  on the base.
- On #437 four reviewers and the author missed that the new fields were never meant for NVS; a teammate caught it.
  If the PR doesn't say who it's for, ask before reviewing anything else.

## 7. Docs

- Re-read every `.mex/` line the diff adds or touches, **after** the last code change, and check each claim against
  the code: parameters, which tests and programs it covers, which status codes it returns.
- Check the PR description lists only what the code now has (on db-service #806 it still listed tests a later
  clean-up removed).
- Follow `AGENTS.md`'s GROW step.

## 8. Other repos

- For each external thing the code relies on, check it exists where the PR will run: BigQuery tables and columns,
  CMS endpoints and auth, Amplify env vars on `main` and `staging`, DB Service fields.
- Staging reads prod BigQuery but calls the staging CMS, so CMS content can't be verified on staging.
- When the PR needs a db-service change, review that PR too:
  - its migration must roll back and re-apply cleanly;
  - its version must not collide with any on `origin/main` (db-service #776 and #779 were both merged with the same
    one);
  - `pg_dump -s` of its schema must match the af_lms e2e fixture.

  Say which PR deploys first.

## Report

Send the full report to the person running the review first. Before a PR exists, the report stays there, and
anything the owner accepts as a known issue goes into the PR description when it's opened. On an open PR, post to
GitHub only what they approve, following `review-with-agents.md` §7. Replicate anything contested before it's
posted. Drop what a user can't reach from the UI, and say so.

One finding per problem, written so a reader with no context can act on it, in plain words, in this shape:

- **headline:** what goes wrong, in user terms;
- **a real example:** the school, test or session id, with what the base shows and what the branch shows. On
  GitHub, replace the id with a description ("a Grade 11 NVS school"), because af_lms is public;
- **impact:** counts over this year's data;
- **repro:** the steps;
- **suggested fix**, run on the branch before you suggest it.

Decisions go to the owner as numbered questions. af_lms is public: no student or school names or ids in comments,
and blur screenshots before attaching them. List the steps you skipped, and why. End with a verdict: **ready for
PR** / **merge**, or **not ready** / **don't merge yet**, with what is blocking it.

## Re-review after fixes

Follow `review-with-agents.md` §6: re-run each earlier finding's repro rather than trusting the reply, run a fresh
pass alongside it, and stop at decision closure rather than at zero findings.

## Clean up

Remove the worktrees, cloned databases, dev servers, scratch tests and env files, and say in the report that you did.
