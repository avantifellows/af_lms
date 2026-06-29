---
name: db-service-write
description: Proxy a student/batch/quiz-session/document write to the external DB Service over HTTP. Use whenever mutating an entity the DB Service owns.
triggers:
  - "db service"
  - "student write"
  - "update student"
  - "batch write"
  - "proxy write"
  - "external api write"
edges:
  - target: context/data-access.md
    condition: for the full reads-vs-writes split and decision table
  - target: patterns/add-api-route.md
    condition: when the write lives in a new route handler
  - target: context/permissions.md
    condition: when gating the write (requireEdit + ownership)
last_updated: 2026-06-25
---

# Write via the DB Service

## Context
Students, batches, quiz sessions, and document metadata are owned by the external DB
Service (Elixir/Phoenix, separate repo). Writes to them must `fetch` the Service — never
`query()` Postgres directly. Reference: `src/app/api/student/[id]/route.ts`,
`src/app/api/batches/[id]/route.ts`. Config: `DB_SERVICE_URL`, `DB_SERVICE_TOKEN`.

## Steps
1. Gate the route (`getServerSession` → permission check; for student writes use
   `canAccessStudent(session, id, { requireEdit: true })`).
2. Parse/validate the payload; split fields by which DB Service endpoint they target.
3. `fetch` the Service with the Bearer token:
   ```ts
   const res = await fetch(`${process.env.DB_SERVICE_URL}/student/${id}`, {
     method: "PATCH",
     headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DB_SERVICE_TOKEN}` },
     body: JSON.stringify(studentFields),
   });
   if (!res.ok) { const text = await res.text(); console.error("DB service error:", text); errors.push(text); }
   else { results.student = await res.json(); }
   ```
4. For multi-entity updates (e.g. student fields + grade + batch enrollment), issue
   **separate** calls (often to `/update-group-user-by-type`) and accumulate `errors`.
5. Resolve the response: all-failed → 400 with joined `error`; partial → `{ ...results, warnings }`; success → `results`.

## Gotchas
- **Wrong backend = data-integrity bug.** A student/batch write to Postgres bypasses the Service's invariants. Always proxy.
- **Surface upstream errors** — read `await res.text()` and include it; don't swallow a non-`ok` response.
- **Enrollment updates need both `group_id` and `user_id`** — guard for the missing one and push a clear error (mirrors the student route).
- **Partial success is real** — one of N calls can fail; return `warnings` rather than pretending success or failing the whole thing.
- Don't log secrets or PII; the token comes only from env.

## Verify
- [ ] Write goes to the DB Service, not `query()`.
- [ ] Gated with `requireEdit` + ownership where a student/record is involved.
- [ ] Non-`ok` upstream responses are surfaced (text captured), not swallowed.
- [ ] Partial-success path returns `warnings`; all-fail returns 400.
- [ ] Colocated test stubs `fetch` (`vi.stubGlobal`) with sequential `mockResolvedValueOnce`.

## Debug
- 401/403 from the Service → check `DB_SERVICE_TOKEN` and that `DB_SERVICE_URL` points at the right env.
- Update "succeeds" but nothing changes → confirm field names match the Service's expected payload; check `warnings`.
- Enrollment not updating → missing `user_id`/`group_id` in the payload.

## Update Scaffold
- [ ] If a new DB Service endpoint/field shape was learned, note it in `context/data-access.md`.
- [ ] Update `.mex/ROUTER.md` if a new write capability shipped.
