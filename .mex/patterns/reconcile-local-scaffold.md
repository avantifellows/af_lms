---
name: reconcile-local-scaffold
description: Reconcile local scaffold leftovers with current main without reverting newer documentation.
last_updated: 2026-09-23
---

# Reconcile local scaffold notes

1. Save a private external backup of every changed/untracked file, the tracked diff,
   original status and content hashes before cleanup.
2. Check the current GitHub PR states and main tree. Untracked on an old branch
   does not mean absent from main; different worktrees may already have committed
   related context and runbooks.
3. Use a clean main-based branch. Preserve main's behavior and permission contracts;
   add only missing durable facts and runbook lessons. Condense investigation stages
   into dated outcomes; distinguish merged code, deployed code and local rehearsals.
4. Keep post-merge results and cross-repository operational notes in a separate
   LMS documentation change. Do not reopen merged feature PRs to add later history.
5. Verify the diff is documentation-only, all new pattern links resolve and dates
   are updated. Record the reconciliation with mex log and submit the docs PR.
6. Only after the reconciled change is safely committed/pushed, verify the original
   files still match the backup hashes and clear those exact leftover paths. Preserve
   any concurrent edits and all unrelated files/worktrees.

Do not copy whole old context files onto main: doing so can silently restore stale
permission rules or erase recently shipped behavior. Preserve the raw local notes
privately when condensing them, so investigation detail can still be recovered.
