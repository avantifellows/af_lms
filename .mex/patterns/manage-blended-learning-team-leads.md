---
name: manage-blended-learning-team-leads
description: Start or end a Blended Learning Supervision (a team-lead Mentor viewing another Mentor's Students, read-only) from the Manage page's Team leads section.
triggers:
  - "supervisor"
  - "supervision"
  - "team lead"
  - "reportee"
  - "blended_learning_mentor_supervisions"
edges:
  - target: context/permissions.md
    condition: for what a Supervision grants (view only) and where the access policy checks it
  - target: context/data-access.md
    condition: for the Supervision table and the Mapping source it mirrors
last_updated: 2026-11-24
---

# Manage Blended Learning Team Leads

## Context
A **Supervision** (`blended_learning_mentor_supervisions`, db-service migration
`20261112120442`) lets a team-lead Mentor (`supervisor_user_id`) view another Mentor's
(`mentor_user_id`) Students for one academic year: the team lead lands on Team cards for
themselves and that Mentor, whose card opens their Mentee list (`/blended-learning/mentors/<id>`),
their Mentees' pages and notes, and their flags in the Flags tab. View only: logging, drafts,
uploads and every other write stay with the mapped Mentor (and Blended Learning Admins as before).

Supervisions are managed only in the app: a Blended Learning Admin who may manage (not read-only)
adds and ends them in **Manage → Team leads** (`/blended-learning/manage`). There is no operator
script (the bulk loader was removed on 2026-11-19). Code: `src/lib/blended-learning-team-leads.ts`,
`POST /api/blended-learning/team-leads`, `POST /api/blended-learning/team-leads/[id]/end`,
`src/app/blended-learning/manage/TeamLeadsManager.tsx`. Rows carry `assignment_source`/`end_source`
`af_lms_manage_ui` and the admin's email. af_lms is a public repo: no staff names or emails in
code, tests, runbooks or PR text.

## Steps
1. Deploy db-service `20261112120442` to the target environment first (the af_lms change reads
   the table on every Mentor page and fails without it).
2. As a Blended Learning Admin, open Manage → Team leads, pick the **Team lead** and the **Mentor
   they lead**, and Add. Both dropdowns list only live `blended_mentor` permissions (not revoked);
   when two Mentors share a display name, their emails are shown to tell them apart.
3. To end one (team change), press **End** on its row and confirm. It sets `ended_at`,
   `ended_by_email`, `end_source = af_lms_manage_ui`, `end_reason = supervision_ended`; rows are
   never deleted. The end matches the row by its id, so a pair ended and re-added meanwhile keeps
   its new row. A link given a future end outside the app shows "ending on <date>"; End cuts it
   short to now and records the admin as who ended it.

## Gotchas
- The user id is resolved as the app resolves it: `user_permission.user_id`, else the lowest-id
  `user` row with that email. If the Mentor's Mappings point at a different id, the team lead
  sees an empty list: fix the permission row's `user_id`, not the Supervision.
- A reportee whose `blended_mentor` permission is revoked drops out of their team lead's access
  at once (`supervisedMentorIds` requires a live permission), even before the Supervision is ended.
  The row stays in Manage → Team leads with a note ("<Name> is no longer a mentor, so this link
  has no effect"; the same for a revoked team lead, or both) so the admin can End it. The note
  uses the access check's own rule (`liveBlendedMentorSql`), so the two cannot disagree.
- A `blended_admin` already sees everyone and is not offered as a team lead.
- Supervisions are per academic year (`CURRENT_ACADEMIC_YEAR`); add them again for a new year.

## Verify
- [ ] The new row shows in Manage → Team leads with today's date.
- [ ] The team lead lands on Team cards with the reportee's card; the reportee's list says
      "View only." and has no "New log for" buttons; a reportee's Student page has no "Log
      conversation" button and no draft Review/Retry/Discard (not even greyed out).

## Update Scaffold
- [ ] Note bulk changes (date, environment, pair count, never names) in `.mex/ROUTER.md` if they
      change the project state.
