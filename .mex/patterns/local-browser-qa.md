---
name: local-browser-qa
description: Run a PR branch from a git worktree on a spare port and QA it in headless Chromium against the local dbservice_dev database.
triggers:
  - "local qa"
  - "browser qa"
  - "worktree"
  - "headless"
  - "screenshot"
  - "dev login"
edges:
  - target: context/setup.md
    condition: for env var names and the Dev Login personas
  - target: patterns/deploy-staging-pr.md
    condition: when the QA must happen on shared staging instead of locally
  - target: patterns/debug-e2e-fixtures.md
    condition: when the local dump lacks the rows the flow needs
last_updated: 2026-09-16
---

# Local Browser QA of a PR Branch

## Context
The main checkout holds the only `.env.local` (gitignored). It points at the local
`dbservice_dev` Postgres and DB Service on port 4000, with `NEXTAUTH_URL` on port 3000.
A fresh worktree has neither `node_modules` nor `.env.local`. Dev Login personas are
defined in `src/lib/auth.ts` and their emails exist in the local `user_permission` table.

## Steps
1. `git worktree add -b <branch> ../.agent-worktrees/af-lms-<issue> origin/main` (or check out the PR branch).
2. `npm ci` inside the worktree.
3. Copy env with the port swapped so NextAuth callbacks resolve:
   `sed -E 's#^NEXTAUTH_URL=.*#NEXTAUTH_URL="http://localhost:33NN"#' <main>/.env.local > .env.local`
4. Start: `npx next dev --port 33NN > /tmp/af-lms-<issue>-dev.log 2>&1 &`, then `curl -s -o /dev/null -w '%{http_code}' http://localhost:33NN/`.
5. Drive it with the worktree's own `playwright-core` (a Node script under `/tmp`), not `agent-browser`;
   its Chromium build usually does not match the installed shells. If launch fails with
   "Executable doesn't exist", run `npx playwright install chromium-headless-shell` once.
6. Log in by clicking the persona button. Button text includes a subtitle, so match on
   `hasText: /^Admin\s*\n?\s*Level 3/` (not an exact "Admin" match), then `waitForURL(/\/dashboard/)`.
7. Navigate straight to the tab under test, e.g. `/school/<code>?tab=visits`, and assert on
   rendered text plus `page.request.get('/api/...')` for the same data.
8. Screenshot desktop (1280) and mobile (390) and **look at the images**.
9. Pick QA schools from the DB first (`psql` with the `.env.local` values) so every branch of the
   new UI has real rows; add synthetic rows only when no real case exists, and delete them by id afterwards.
10. Stop the server: `pkill -f 'next dev --port 33NN'`.

## Gotchas
- Two dev servers on the same port fight silently; check `lsof -iTCP:33NN -sTCP:LISTEN` first.
- `user_permission.email` is unique only case-sensitively; inserting a duplicate for QA needs a case variant.
- A PM persona outside a School's region gets the "Access Denied" card for that School page; that is scope, not a regression.
- `zsh` does not word-split a `$CMD` string; wrap `psql` in a shell function.
- The local dump is real-shaped data; do not paste PM names or emails into public places.

## Verify
- [ ] Every UI state the diff introduces was seen in a screenshot.
- [ ] The API the UI calls returns the same values the UI shows.
- [ ] `console.error`/`pageerror` lists are empty.
- [ ] Any synthetic rows are deleted and the dev server is stopped.

## Update Scaffold
- [ ] Note the QA outcome on the PR and in `ROUTER.md`.
