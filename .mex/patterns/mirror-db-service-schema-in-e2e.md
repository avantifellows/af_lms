---
name: mirror-db-service-schema-in-e2e
description: Mirror db-service tables that db-dump.sql lacks into an e2e fixture migration, and prove the DDL is identical.
triggers:
  - "fixture migration"
  - "e2e schema"
  - "re-diff"
  - "PR #804"
  - "blended_learning"
edges:
  - target: patterns/debug-e2e-fixtures.md
    condition: when the e2e run itself fails
  - target: context/data-access.md
    condition: for which tables LMS reads and writes directly
last_updated: 2026-10-28
---

# Mirror db-service schema in e2e

## Context
`e2e/fixtures/db-dump.sql` predates newer db-service tables, and `resetDatabase()` runs only
db-service's `*holistic*.exs` migrations through `mix`. Any other table the LMS reads directly
needs an SQL migration under `e2e/fixtures/migrations/` that matches db-service exactly
(columns and order, CHECKs, partial unique indexes, FKs, functions, triggers). Mocked SQL
cannot prove scoping or trigger behaviour, so the fixture DDL has to be the real thing.
Example: `20261022130000_add_blended_learning_schema.sql` (#442). An `alter table` migration
can be mirrored alone: build the table from the earlier fixture SQL in both scratch DBs, then
run only the new `.exs` into one (as for `20261027100000_add_blended_learning_legacy_conversation.sql`,
2026-10-28; column `COMMENT`s show in the dump, so mirror them). Ignore pg_dump's random
`\restrict` / `\unrestrict` token lines when diffing (`diff -I restrict`).

## Steps
1. Copy the migrations into a temp dir without touching the db-service checkout:
   `git -C ../db-service show <ref>:priv/repo/migrations/<file>.exs > /tmp/<dir>/<file>.exs`.
2. Create two scratch DBs with stub parents (`student`, `"user"`, `school`, `program`, each
   `id bigserial PRIMARY KEY`, matching the dump's `bigint` ids).
3. Run the Ecto migrations into the first DB from `../db-service` (same snippet as
   `applyHolisticDbServiceSchema`, with `Path.wildcard("/tmp/<dir>/*.exs")`). Use the real
   Elixir binaries and `MIX_HOME=$HOME/.mix` (see `debug-e2e-fixtures.md`).
4. Write the SQL by hand in migration order. Apply it to the second DB with
   `psql -v ON_ERROR_STOP=1 -f`.
5. `pg_dump --schema-only --no-owner --no-privileges -T schema_migrations -T student -T '"user"' -T school -T program`
   both DBs and `diff` them. Done only when they are identical.
6. Drop the scratch DBs and temp dir.

## Gotchas
- Ecto names FKs `<table>_<column>_fkey`; Postgres truncates names over 63 characters (with a
  NOTICE), so write the full Ecto name and let Postgres truncate it the same way.
- `references(..., with: [student_id: :student_id])` is a composite FK
  `FOREIGN KEY (col, student_id) REFERENCES t(id, student_id)`, named after the first column.
- Ecto `:string` is `varchar(255)`, `:utc_datetime` and `timestamps()` are `timestamp(0)`.
  Columns added by a later `alter table` go at the end, so keep migration order.
- For an "ensure" migration (idempotent re-create), mirror it with `IF NOT EXISTS` and a
  `DO` block that adds missing CHECKs.
- A migration that seeds rows (`execute("INSERT …")`, e.g. the Mentor Toolkit Resource in
  `20261027120000_add_blended_learning_manage.sql`) needs the same INSERT in the fixture; a
  schema-only dump won't see it, so also compare `SELECT` output from both scratch DBs. Recent
  `pg_dump` prints a random `\restrict` token per dump; drop those lines before diffing.
- Function bodies are compared verbatim, so copy them exactly. Comments inside a body show up
  in the diff.

## Verify
- [ ] `diff` of the two schema dumps is empty.
- [ ] The targeted Playwright spec passes against a fresh `resetDatabase()`.

## Update Scaffold
- [ ] Note the mirrored tables in `context/data-access.md`.
