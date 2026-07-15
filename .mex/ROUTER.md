---
name: router
description: Session bootstrap and navigation hub. Read at the start of every session before any task. Contains project state, routing table, and behavioural contract.
edges:
  - target: context/architecture.md
    condition: when working on system design, integrations, or understanding how components connect
  - target: context/stack.md
    condition: when working with specific technologies, libraries, or making tech decisions
  - target: context/conventions.md
    condition: when writing new code, reviewing code, or unsure about project patterns
  - target: context/decisions.md
    condition: when making architectural choices or understanding why something is built a certain way
  - target: context/setup.md
    condition: when setting up the dev environment or running the project for the first time
  - target: context/permissions.md
    condition: when gating a route, debugging a 403, or reasoning about roles/scope
  - target: context/data-access.md
    condition: when reading or writing data and unsure which backend to use
  - target: context/visits.md
    condition: when working on PM school visits or visit action types
  - target: context/student-addition.md
    condition: when working on self-service student addition, bulk upload, lateral entry, or school-facing edit/delete rollout
  - target: patterns/INDEX.md
    condition: when starting a task — check the pattern index for a matching pattern file
last_updated: 2026-07-15
---

# Session Bootstrap

If you haven't already read `AGENTS.md`, read it now — it contains the project identity, non-negotiables, and commands.

Then read this file fully before doing anything else in this session.

## Current Project State

**Working:**
- Dual auth (Google OAuth + school passcode) with dev-login personas in non-prod.
- Student enrollment CRUD (reads direct from Postgres; writes proxied to the DB Service) + school dashboard, search, grade filtering, document uploads (S3).
- Permission system: feature×role matrix, 3-level school scope, program/NVS gating, `read_only` downgrade, additive centre-seat scope.
- PM school visits: GPS-tracked lifecycle + 7 visit action types (registry pattern), scoped by `visits-policy`.
- Curriculum tracking, quiz sessions + quiz analytics (BigQuery), performance dashboard (DynamoDB), admin of users/schools/batches/centres/staff.
- Deploy via AWS Amplify; ~1341 unit tests (Vitest/RTL) + ~39 E2E (Playwright).

**Not yet built / in progress:**
- Centre rollout is mid-migration: `PROGRAM_IDS` is still hand-maintained in `src/lib/constants.ts` (target is reading `program` from the DB); non-JNV centre programs are being onboarded.
- Student Addition #197 revision is in progress. One-by-one, mixed-grade bulk, and existing-Student Edit now use the revised canonical fields and Centre-free NVS authorization; add/bulk serve the approved static workbook and support rejected-row CSV retry. Dropout remains a separate slice.

**Known issues:**
- Two write paths exist — sending a student/batch/quiz-session write to Postgres instead of the DB Service is a real bug (see `context/data-access.md`).
- The `graphify-out/` knowledge graph is not committed (regenerated locally); rebuild with `/graphify --update` after significant changes.
- Deploy is CI-only via `.github/workflows/deploy-amplify.yml` (main → prod, PRs → shared staging URL). There is no local deploy script.

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type | Load |
|-----------|------|
| Understanding how the system works | `context/architecture.md` |
| Working with a specific technology | `context/stack.md` |
| Writing or reviewing code | `context/conventions.md` |
| Making a design decision | `context/decisions.md` |
| Setting up or running the project | `context/setup.md` |
| Gating a route / access control / 403s | `context/permissions.md` |
| Reading or writing data (Postgres / DB Service / BigQuery / DynamoDB / S3) | `context/data-access.md` |
| PM school visits or visit action types | `context/visits.md` |
| Student addition / bulk upload / lateral entry | `context/student-addition.md` |
| Any specific task | Check `patterns/INDEX.md` for a matching pattern |

## Behavioural Contract

For every task, follow this loop:

1. **CONTEXT** — Load the relevant context file(s) from the routing table above. Check `patterns/INDEX.md` for a matching pattern. If one exists, follow it. Narrate what you load: "Loading architecture context..."
2. **BUILD** — Do the work. If a pattern exists, follow its Steps. If you are about to deviate from an established pattern, say so before writing any code — state the deviation and why.
3. **VERIFY** — Load `context/conventions.md` and run the Verify Checklist item by item. State each item and whether the output passes. Do not summarise — enumerate explicitly.
4. **DEBUG** — If verification fails or something breaks, check `patterns/INDEX.md` for a debug pattern. Follow it. Fix the issue and re-run VERIFY.
5. **GROW** — After meaningful work, run this binary checklist:
   - **Ground:** What changed in reality? Name the changed behavior, system, command, dependency, or workflow.
   - **Record:** If project state changed, update the "Current Project State" section above. If documented facts changed, update the relevant `context/` file surgically.
   - **Orient:** If this task can recur and no pattern exists, create one in `patterns/` using `patterns/README.md`, then add it to `patterns/INDEX.md`. If a pattern exists but you learned a gotcha, update it.
   - **Write:** Bump `last_updated` in every scaffold file you changed. If the why matters, run `mex log --type decision "<what changed and why>"` or `mex log "<note>"`.
