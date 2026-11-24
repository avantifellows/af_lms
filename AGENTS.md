# af_lms (crud_ui)

Internal LMS / field-operations web app for Avanti Fellows — school, student, and
batch admin; quiz analytics; and GPS-tracked program-manager school visits.
Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL + external DB Service.

> **`CLAUDE.md` is a symlink to this file.** Edit `AGENTS.md`; both stay in sync.

## Start every session here

1. Read **`.mex/ROUTER.md`** first — it is the map. It links to everything:
   project state, the context files, and the pattern runbooks.
2. Read **`.mex/AGENTS.md`** — the detailed project anchor: non-negotiables,
   commands, and the full identity. (This root file is only the entry point.)
3. Before a task, check **`.mex/patterns/INDEX.md`** — if a runbook covers what
   you're about to do, follow it.

Don't go spelunking through source to rebuild context that's already written down.
The `.mex/` scaffold is the source of truth for *how* this project works.

## The five non-negotiables (full list in `.mex/AGENTS.md`)

- Reads go through `query()` in `src/lib/db.ts` with `$1` placeholders — never string-interpolate SQL.
- Student/batch/quiz-session/document **writes** go to the external DB Service over HTTP, never direct to Postgres.
- Never bypass the permission layer (`src/lib/permissions.ts`) — gate before you act.
- When role permissions change, keep the permission matrix, domain policy, route guards,
  visible controls, and Admin user-management role descriptions in sync.
- Never import server-only modules (`@/lib/db`, `@/lib/permissions`) into client components.
- Never log GPS lat/lng; never commit secrets.

## Before building a feature — ask who it's for

Before planning any new feature or change to an existing one, ask:
**"Is this for physical centres (CoE/Nodal), NVS schools, or both?"**
Don't infer it from the issue text, even when it seems obvious — the decision is the team's.
Record the answer in the plan and in the PR's **Audience** line, and build so the feature
shows only where it belongs: a physical-only feature must not appear on NVS school pages,
for any role. If nobody can answer, stop and ask the issue author before building.
(T-shirt sizes, #395, and the student card fields, #431, were physical-only and got built for NVS too.)

## Before opening a PR — run the pre-PR review

Follow **`.mex/patterns/pre-pr-review.md`** before opening any PR, or marking one ready for review, and when
reviewing someone else's. Use a session or agent that didn't write the code. It runs what CI runs, compares the
branch with its base on real cases (including empty and failing ones), recomputes every number the change shows
across this year's data, and stops on any new data exposure. A diff-only read isn't a review: on #467 every unit test
passed, and only running the branch proved and sized the problems the reviewers raised.

How to run the reviewers and handle their findings is in **`.mex/patterns/review-with-agents.md`**. A finding is a
claim until it's reproduced, and nothing is fixed or posted on GitHub without the go of the person running the review.

## After every task — run GROW

- **Ground** — what actually changed in reality?
- **Record** — update `.mex/ROUTER.md` and the relevant `.mex/context/` file(s).
- **Orient** — if this work can recur, add or update a `.mex/patterns/` runbook.
- **Write** — bump `last_updated` on any scaffold file you changed; run `mex log` when the rationale matters.

The scaffold only stays useful if you keep it true. Treat updating it as part of the task, not an afterthought.
