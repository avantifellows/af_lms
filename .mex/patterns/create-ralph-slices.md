---
name: create-ralph-slices
description: Publish idempotent AFK implementation slices from a Ralph parent PRD with native sub-issue links and exact blocking edges.
triggers:
  - "create-and-review-slices"
  - "implementation sub-issues"
edges:
  - target: context/architecture.md
    condition: when choosing behavior and test boundaries
last_updated: 2026-10-07
---

# Create Ralph implementation slices

## Context

Read the parent issue and comments, project context and ADRs, the to-tickets skill,
and the matching workspace step's reviewRounds (missing means zero). Inspect both
native sub-issues and repository issues referencing the parent before publishing.

## Steps

1. Ground narrow, independently demoable behaviors in existing module boundaries.
   Include acceptance criteria, focused verification, write boundaries and exclusions.
   Reuse existing seams; do not invent a prefactor ticket without a concrete need.
2. Run exactly the configured council rounds. For nonzero rounds, use the caller's
   read-only review command, before/after worktree protection, source verification
   of every finding, and reviewer attribution rules. Zero means skip council.
3. Create/reuse issues in dependency order with AFK: true and Parent: #number.
   Resolve dependencies to actual GitHub numbers in every published body. Reuse
   matching existing issues, including issues not yet linked to the parent.
4. Capture each publication in a workspace manifest before the next mutation so
   interrupted runs can resume. Use body files and structured subprocess arguments.
5. Resolve parent/child node IDs and add missing relationships with addSubIssue.
   Markdown Parent references alone do not establish native sub-issues.
6. List blocked_by edges per final issue. Add missing edges using numeric issue
   database IDs and delete stale edges. If the API is unavailable, record that
   limitation; the body references remain authoritative.
7. Read back and compare bodies, sub-issue membership and exact dependency sets.
   Write slices.md with issue numbers, creation/reuse/link status, review attribution
   and verification results. Preserve the parent PRD and unrelated local changes.

## Gotchas

- Shared-file overlap alone is not a behavior dependency. Assign narrow edit regions
  and avoid broad rewrites; only block work that needs a predecessor's behavior.
- Native dependency IDs are database IDs, not issue numbers or GraphQL node IDs.
- History changes need native browser acceptance; SQL predicates need a real local
  fixture. Include these checks in their behavior slices, not a final test-only ticket.
- Planning does not establish implemented behavior or passing feature tests.

## Verify

Every final issue is AFK, exists, is linked natively and has the exact declared native
blockers (or a documented API limitation). Output status and review attribution match
actual operations. No duplicate intended slice or ordinal dependency references.

## Debug

On partial publication, inspect the manifest and live GitHub state before retrying.
Do not recreate an issue merely because linking or dependency synchronization failed.

## Update Scaffold

Record the issue map as planned work in ROUTER and the relevant context, update
last_updated, and log sequencing rationale with mex log.
