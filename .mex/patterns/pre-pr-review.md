---
name: pre-pr-review
description: Review an af_lms branch the way a human reviewer would, before any PR is opened or marked ready. Runs what CI runs, compares behaviour with the base branch on real data, recomputes every number the change shows, and stops on new data exposure.
triggers:
  - "pre-pr review"
  - "review before pr"
  - "ready for a pr"
  - "open a pr"
edges:
  - target: patterns/local-browser-qa.md
    condition: for running the base and the branch side by side (worktree, port, env, login)
  - target: context/permissions.md
    condition: when checking the gate on new routes and queries (step 4)
  - target: context/data-access.md
    condition: when recomputing numbers in BigQuery (step 3)
last_updated: 2026-10-27
---

# Pre-PR review for af_lms

A diff-only read is not a review. On #467 a diff-only bug pass called the branch clean, and the human reviewer
then found four real problems by running it:

- the new report had no fallback, so about 180 real tests lost their report;
- class accuracy was averaged over the wrong denominator (171 of 3,714 reports off);
- "X of Y appeared" was counted two ways in two places (42 showed over 100%);
- a new table showed other schools' results to teachers.

Each step below exists because of one of those. **Don't open the PR until every finding is fixed or Pritam has
accepted it.** Decisions (scope, who sees what) go to Pritam as questions; they are not yours to settle.

**Who runs it:** a session or agent that did not write the code, given the branch, its base and the PR's
"What and why". The author's session already believes the code is right.

## 0. Scope the change

- Base: `origin/main`, or the parent branch for a stacked PR. `git diff <base>...HEAD --stat`.
- Sort the diff into the parts below. A part that doesn't apply is skipped, and the report says so:
  - **mechanical:** always;
  - **behaviour:** any page, component or API route change (step 2);
  - **numbers:** any figure a user sees, added or changed (step 3);
  - **exposure / permissions:** any new query, route or field reaching the browser (step 4);
  - **audience:** any feature work (step 5);
  - **docs:** any `.mex/` or `AGENTS.md` line about code the diff touches (step 6).

## 1. Mechanical: what CI runs, before CI runs it

```
npm run lint
npx tsc --noEmit
npm run test:unit:coverage
npx fallow audit --base <base> --coverage unit-coverage/coverage-final.json
npm run build        # when routes, config or server/client boundaries changed
```

Fallow's gate is new-only on changed files, the same as `.github/workflows/fallow.yml`. Fix the findings; don't
suppress them unless the repo already suppresses that kind.

## 2. Behaviour: base vs branch, side by side, on real cases

- Run both, following `local-browser-qa.md` for worktree, port, env and login:
  - the branch in its worktree;
  - the base in a temporary detached worktree (`git worktree add --detach <path> <base>`).

  Point both at the same data. Real cases usually need the staging DB and prod BigQuery, because the local dump may
  not have them. Remove the base worktree afterwards.
- Pick **named real cases** with SQL first (prod BigQuery, via `mcp__claude_ai_Avanti_Data__run_query`), and
  record their ids in the report:
  - the happy path;
  - empty: started but nobody submitted, no data for the filter;
  - partial: a few students, one student;
  - every variant the code branches on: combined test, homework, old-CMS vs new-CMS, physical vs NVS, each stream;
  - failure: force the new API or query to fail. Make a local, uncommitted change that throws, and revert it after.
- Compare each case in two passes. Unit tests alone don't count: they check what the author thought of, and on #467
  every test passed while the page was broken.
  1. **API, every case.** Call each route the change touches on both ports, with the same session and parameters
     (authenticated, the way `local-browser-qa.md` logs in), and diff the JSON. Cheap, and it catches wrong or
     missing data.
  2. **Page, for UI changes.** Open the same cases in headless Chromium (`local-browser-qa.md`'s playwright-core
     script, never a personal browser) and screenshot base and branch. This catches what an API diff can't: a stuck
     "Loading...", a fallback that never renders, a missing panel.
- For each case, write what the base shows next to what the branch shows. **Anything the base showed that the branch
  no longer shows is a finding**, unless the PR says it was removed on purpose.
- When the change replaces a screen, the old screen must still appear wherever the new one doesn't apply or fails.
  Decide which one to show before loading either.
- **Every difference found here becomes a unit test**, so it stays covered after the review.
- Login caveat: Dev Login personas exist only in the database that has them (the local `dbservice_dev`). Against
  the staging DB, check `user_permission` for the persona emails first. If they're missing, say so in the report;
  don't add rows to a shared database without Pritam's go.

## 3. Numbers: recompute every figure, across all the data

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

## 4. Data exposure and permissions: stop, don't build

- Does any viewer now see data from outside their own scope: another school, another student, names, UDISE, or a
  small group whose "average" is one student's score? If so, **it is a product decision for Pritam before it is
  code.** Write it up as questions (who sees it, which schools count, same grade only, minimum group size), and don't
  ship it as is.
- Check the gate for each new route and query: `src/lib/permissions.ts`, `getFeatureAccess`, the school scope check.
  Then check each role that can reach the page, including read-only admin and passcode users.
- When role permissions change, check the five places in `AGENTS.md`'s non-negotiables are still in sync.

## 5. Audience

- The PR's **Audience** line (physical centres, NVS schools, or both) must match the code's gate.
- Open an NVS school page and a physical-centre page. The side the feature isn't for must look exactly as it does
  on the base.

## 6. Docs

- Re-read every `.mex/` line the diff adds or touches, **after** the last code change, and check each claim against
  the code: parameters, which tests and programs it covers, which status codes it returns.
- Follow `AGENTS.md`'s GROW step.

## Report

One finding per problem, written so a reader with no context can act on it, in this shape:

- **headline:** what goes wrong, in user terms;
- **a real example:** the school, test or session id, with what the base shows and what the branch shows;
- **impact:** counts over this year's data;
- **repro:** the steps;
- **suggested fix.**

Decisions go to Pritam as numbered questions. List the steps you skipped, and why. End with a verdict: **ready for
PR**, or **not ready**, with what is blocking it.
