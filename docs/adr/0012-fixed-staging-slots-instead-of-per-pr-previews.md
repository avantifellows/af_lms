# Fixed Staging Slots, not per-PR preview environments

**Decision.** To test branches in parallel we use a small fixed set of named Staging Slots (three to start). Each slot has a fixed LMS URL, a fixed DB Service host and its own database on the existing staging database server. We do not create an environment for every PR.

**Why.** Before `ef1e9f61` (2026-03-01) every LMS PR got its own Amplify branch. We dropped that because Google OAuth needs every redirect URI registered exactly, with no wildcards. We stayed on NextAuth v4, which has no redirect proxy for preview URLs. A fixed slot URL is registered once and needs no auth changes.

**Why each slot has its own database.** Most DB Service PRs add migrations (49 of 71 in Sep–Oct 2026). On one shared staging database those migrations were applied permanently, and switching PRs left the schema ahead of the code. A separate database in each slot, reset from Staging on every new claim, keeps each branch's migrations to its own slot. The slot databases live on the same instance, so the extra cost is disk only.

Staging itself runs only `main`, because quiz, portal and the ETLs depend on it.

## Considered Options

- **A per-PR environment (Amplify PR previews plus a DB Service per PR).** Rejected for now. It needs an Auth.js v5 upgrade or a custom OAuth proxy, roughly doubles the build effort, and costs more each month. Revisit it if three slots are not enough.
- **One staging with a claim/lock.** Rejected. It turns being bumped off staging into waiting in a queue. The DB Service approval gate already acted as this lock, and 98 of 167 staging deploy runs were cancelled while waiting.
- **A separate RDS instance per slot, Neon branching, or Aurora clones.** Rejected. A separate instance costs more and is not needed, Neon has no Mumbai region for near-real student data, and Aurora would need staging migrated to Aurora.

## Consequences

- LMS flows that finish through ETL (Holistic profiles, Blended Learning drafts) write to Staging, not to the slot. Test them on Staging after merge.
- Staging and the slots sign in through their own non-production Google OAuth client and `NEXTAUTH_SECRET`, so no slot or staging session is valid on production. Each slot URL is registered on that client once.
- The number of parallel testers is capped at the number of slots. Adding a slot means one more redirect URI, one more DB Service, and about 2 GB more disk.
