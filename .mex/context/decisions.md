---
name: decisions
description: Key architectural and technical decisions with reasoning. Load when making design choices or understanding why something is built a certain way.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "we chose"
edges:
  - target: context/architecture.md
    condition: when a decision relates to system structure
  - target: context/stack.md
    condition: when a decision relates to technology choice
  - target: context/data-access.md
    condition: when a decision relates to the reads-vs-writes split
  - target: context/permissions.md
    condition: when a decision relates to access control
last_updated: 2026-06-25
---

# Decisions

<!-- When a decision changes: mark the old entry Superseded, add the new one above it.
     History is preserved — this is the event clock. -->

## Decision Log

### Reads go direct to Postgres; some writes proxy to the DB Service
**Date:** 2025-11-27
**Status:** Active
**Decision:** All reads use `query()` against Postgres directly. Student, batch, quiz-session, and document **writes** are proxied over HTTP to the external DB Service; PM-visit and curriculum writes go direct to Postgres.
**Reasoning:** The DB Service (separate Elixir/Phoenix repo) owns the canonical write/business logic for the shared student/batch schema. Reading directly keeps dashboards fast and simple; routing those writes through the Service keeps a single source of truth and its validations. Visit/curriculum tables are LMS-owned (`lms_*`), so this app writes them itself.
**Alternatives considered:** All writes through the DB Service (rejected — it has no visit/curriculum endpoints and adds latency for LMS-owned data); all writes direct to Postgres (rejected — duplicates/bypasses the Service's student/batch invariants).
**Consequences:** Two write paths to keep straight (see `context/data-access.md`). A write to the wrong backend is a real bug — student writes must never hit Postgres directly.

### Raw `pg` with parameterised SQL, no ORM
**Date:** 2025-11-27
**Status:** Active
**Decision:** Use `pg` directly through `query<T>(sql, params)`; always `$1` placeholders.
**Reasoning:** The schema is shared with and owned by the DB Service (Ecto). An ORM here would fight that ownership and obscure the exact SQL. Raw SQL keeps the read shapes explicit and reviewable.
**Alternatives considered:** Prisma/Drizzle (rejected — schema ownership conflict, migration drift risk, opaque queries).
**Consequences:** Hand-written SQL everywhere; discipline on placeholders is mandatory (interpolation = injection). A single shared pool singleton in `src/lib/db.ts`.

### Feature×role permission matrix + scope levels + centre seats
**Date:** 2025-11-27 (matrix), extended 2026 (centre seats)
**Status:** Active
**Decision:** Access = a `FEATURE_PERMISSIONS[feature][role]` matrix (`none`/`view`/`edit`), intersected with a 3-level school scope, with NVS-program gating, a `read_only` downgrade, and additive centre-seat-derived scope.
**Reasoning:** Roles, school scope, and program eligibility are independent axes; a single matrix + scope resolver keeps every route gating the same way instead of ad-hoc checks. Centre seats let staff reach a centre's school/program without explicit `school_codes`.
**Alternatives considered:** Per-route boolean flags (rejected — unauditable, drifts); RBAC library (rejected — the program/scope/seat axes don't map cleanly).
**Consequences:** All gating funnels through `src/lib/permissions.ts` (+ `src/lib/visits-policy.ts` for visits). See `context/permissions.md`. Adding a feature means adding a matrix row.

### Dual auth: Google OAuth + school passcode (NextAuth v4)
**Date:** 2025-11-27
**Status:** Active
**Decision:** NextAuth v4 with a Google provider for staff and a passcode `CredentialsProvider` for school users without Google; dev-login personas added only when `NODE_ENV !== "production"`.
**Reasoning:** Field schools often lack Google accounts but need student access; staff need SSO. Passcode users are deliberately restricted to the `students` feature only.
**Alternatives considered:** Google-only (rejected — locks out passcode schools); custom session layer (rejected — NextAuth already handles JWT/session).
**Consequences:** Routes must handle `session.isPasscodeUser` explicitly — passcode users are blocked from visits and most features. Tests reach the passcode `authorize` at `provider.options.authorize`.

### Visit action types as a per-type registry (config + validator + form)
**Date:** 2026-03-06
**Status:** Active
**Decision:** Each of the 7 visit action types is one `src/lib/<type>.ts` (config, `validate*Save`/`validate*Complete`, bootstrap/sanitize) + one `src/components/visits/<Type>Form.tsx`, registered in `ACTION_TYPES` (`src/lib/visit-actions.ts`) and dispatched by `ActionDetailForm.tsx`.
**Reasoning:** Action types share lifecycle (GPS start → fill → complete) but have wholly different question sets. A registry keeps each type self-contained and uniformly validated, save vs complete.
**Alternatives considered:** One mega-form with conditionals (rejected — unmaintainable); free-form JSON only (rejected — no per-type validation/completeness rules).
**Consequences:** Adding a type touches ~8 coordinated files. See `context/visits.md` and `patterns/add-visit-action-type.md`.

### Deploy via AWS Amplify, env synced by GitHub Actions
**Date:** 2026-01-29
**Status:** Active
**Decision:** Host on AWS Amplify (region `ap-south-1`, app `dr1eqhpsk9y2d`). `.github/workflows/deploy-amplify.yml` syncs env vars and triggers builds; `main` auto-builds to prod, PRs deploy to a shared `staging` branch URL.
**Reasoning:** Amplify gives managed Next.js hosting; GitHub Actions keeps env vars and build triggers reproducible and reviewable rather than hand-set in the console.
**Alternatives considered:** Vercel (rejected — AWS-aligned infra/secrets); manual console deploys (rejected — drift, no audit trail). Deploy is CI-only — there is no local deploy script.
**Consequences:** Production env is whatever the workflow last synced; `main` builds automatically (no `start-job` to avoid racing auto-build).
