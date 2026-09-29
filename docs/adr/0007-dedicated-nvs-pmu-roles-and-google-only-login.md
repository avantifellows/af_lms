# Dedicated NVS PMU roles and Google-only login

JNV NVS gets two dedicated LMS roles, PMU Manager (`pmu_manager`) and PMU Govt School User (`pmu_govt_school_user`), rather than reusing `program_manager` scoped to the NVS Program. Both copy today's NVS-only Program Manager access, but they are pinned to NVS in ways the generic role cannot be. Level 3 treats a user as having CoE or Nodal access and so skips the NVS feature block, while these roles keep Visits, Curriculum, Quiz Sessions, Teacher Feedback and the PM dashboard off at every level. The PMU Govt School User also needs exactly one School and a landing page with no dashboard. School passcode login is removed for every Program at the same time. PMU Govt School Users, the external school stakeholders who used it, now sign in with their own Google account, because a shared passcode cannot be attributed to a person and carries no Program.

## Considered Options

- **Reuse `program_manager` or `program_admin` with `program_ids = [64]`.** Rejected: level 3 skips the NVS feature block, and nothing in these roles limits a user to one School or hides the dashboard.
- **Keep passcode login and make it NVS-aware.** Rejected: it would add Program awareness to a shared login that is being replaced. The only real passcode School is JNV Bhavnagar, which is an NVS School.
- **Email OTP or magic-link login for school stakeholders.** Deferred: it needs a mail provider and a new auth flow. Stakeholders use Gmail or another Google-backed account.

## Consequences

- Any JNV School can be put in scope for these roles. Inside a School they see only JNV NVS data, including in mixed Schools that also run other Programs.
- Existing NVS-only Program Managers and Program Admins are not migrated. Admins switch roles by hand.
- Google sign-in stays open to any Google account; access still comes only from the User's permission.
