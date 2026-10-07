---
name: refresh-ralph-prd
description: Refresh an existing issue PRD while preserving the first issue body and obeying Ralph review configuration.
triggers:
  - "create-and-review-prd"
  - "refresh PRD"
edges:
  - target: context/architecture.md
    condition: when identifying module and test boundaries
last_updated: 2026-10-07
---

# Refresh a Ralph PRD

## Context

Read the scaffold, project CONTEXT.md, CLAUDE.md, ADRs, and Ralph's to-spec skill
and domain-awareness reference. Load the current issue and the matching step's
`reviewRounds` from the issue workspace state. Missing means zero.

## Steps

1. Capture the exact issue body from `gh issue view --json body` using exclusive
   creation of `original-issue.md`; never replace an existing original.
2. Inspect relevant code and existing tests. Separate planned behavior from
   already shipped behavior and preserve earlier scope splits.
3. Draft `final-prd.md` with the requested section order and numbered actor /
   feature / benefit stories. Put acceptance behaviors inside implementation
   and testing decisions; avoid a duplicate second specification.
4. Prefer public rendered-page/component and browser seams. Existing mocked
   router calls cannot establish real Back/Forward; mocked counts cannot prove
   SQL ownership/deletion predicates. Use independent expected fixture values.
5. Execute only configured council rounds, following the invoking task's exact
   reviewer command, before/after worktree protection, feedback verification,
   and attribution rules. Zero rounds means no council or attribution section.
6. Verify headings, stories, preserved original, scope, and ADR compatibility.
   Update the same issue with `gh issue edit --body-file`, then read it back and
   compare the body byte-for-byte with the final local file.

## Gotchas

- A re-run can start from an existing PRD; do not overwrite the first original
  or append another PRD below it.
- Read the current source: a default-view change affects shortcuts, return
  links, pagination, and summary data loaded only on one view.
- Document test plans as future checks; do not claim they passed during a
  documentation-only task.

## Verify

- Exactly one of each requested top-level section, in order.
- Every User Story includes actor, feature, and benefit.
- Council count/attribution agrees with the state and actual executed rounds.
- GitHub body equals the final file; original remains unchanged.

## Debug

If publication fails, retain the files and error for retry. If the issue changed
concurrently, reconcile the latest body before replacing it; keep the original.

## Update Scaffold

Record PRD scope as planned work in ROUTER and the relevant context, update
`last_updated`, and log meaningful planning rationale with `mex log`.
