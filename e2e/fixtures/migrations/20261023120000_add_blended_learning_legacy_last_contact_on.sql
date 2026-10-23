-- Blended Learning Student Links' exact legacy last-contact date for e2e.
-- Mirrors db-service PR #804 migration 20261023120000 (nullable date, no
-- default, no CHECK).
ALTER TABLE blended_learning_student_links ADD COLUMN legacy_last_contact_on date;
